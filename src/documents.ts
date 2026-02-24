// Echo Tax Return — Document Upload, OCR, and Parsing
import { Hono } from 'hono';
import type { Env, TaxDocument, DocType } from './types';
import { generateId } from './auth';

const documents = new Hono<{ Bindings: Env }>();

// ─── Upload Document (multipart → R2) ───────────────────────
documents.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const returnId = formData.get('return_id') as string;
  const docType = formData.get('doc_type') as DocType;
  const issuerName = formData.get('issuer_name') as string | null;

  if (!file || !returnId || !docType) {
    return c.json({ error: 'file, return_id, and doc_type are required' }, 400);
  }

  // Verify return exists
  const ret = await c.env.DB.prepare('SELECT id FROM returns WHERE id = ?').bind(returnId).first();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  // Validate file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'File size exceeds 10MB limit' }, 400);
  }

  // Upload to R2
  const ext = file.name.split('.').pop() || 'pdf';
  const r2Key = `tax-returns/${returnId}/${docType}_${Date.now()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  await c.env.MEDIA.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: file.type },
    customMetadata: { return_id: returnId, doc_type: docType, original_name: file.name },
  });

  // Create document record
  const id = generateId('doc');
  await c.env.DB.prepare(`
    INSERT INTO documents (id, return_id, doc_type, issuer_name, r2_key, status)
    VALUES (?, ?, ?, ?, ?, 'uploaded')
  `).bind(id, returnId, docType, issuerName, r2Key).run();

  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<TaxDocument>();
  return c.json({ document: doc }, 201);
});

// ─── List Documents for a Return ─────────────────────────────
documents.get('/:return_id', async (c) => {
  const returnId = c.req.param('return_id');
  const result = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE return_id = ? ORDER BY created_at DESC'
  ).bind(returnId).all<TaxDocument>();
  return c.json({ documents: result.results, count: result.results.length });
});

// ─── Get Single Document ─────────────────────────────────────
documents.get('/detail/:id', async (c) => {
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?')
    .bind(c.req.param('id')).first<TaxDocument>();
  if (!doc) return c.json({ error: 'Document not found' }, 404);
  return c.json({ document: doc });
});

// ─── Parse Document (extract fields from OCR text) ───────────
documents.post('/:id/parse', async (c) => {
  const id = c.req.param('id');
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<TaxDocument>();
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  // Update status to processing
  await c.env.DB.prepare("UPDATE documents SET status = 'processing' WHERE id = ?").bind(id).run();

  try {
    // If OCR text was provided in body, use it; otherwise try to extract from stored data
    const body = await c.req.json<{ ocr_text?: string }>().catch(() => ({}));
    const ocrText = body.ocr_text || doc.ocr_text || '';

    if (!ocrText) {
      // No OCR text available — mark for manual entry
      await c.env.DB.prepare(
        "UPDATE documents SET status = 'error', ocr_text = 'No OCR text provided. Manual data entry required.' WHERE id = ?"
      ).bind(id).run();
      return c.json({ error: 'No OCR text available. Upload OCR text or enter data manually.' }, 400);
    }

    // Parse based on document type
    let parsedData: Record<string, unknown> = {};
    switch (doc.doc_type) {
      case 'w2':
        parsedData = parseW2(ocrText);
        break;
      case '1099_int':
        parsedData = parse1099INT(ocrText);
        break;
      case '1099_div':
        parsedData = parse1099DIV(ocrText);
        break;
      case '1099_nec':
        parsedData = parse1099NEC(ocrText);
        break;
      case '1099_misc':
        parsedData = parse1099MISC(ocrText);
        break;
      case '1099_b':
        parsedData = parse1099B(ocrText);
        break;
      case '1099_r':
        parsedData = parse1099R(ocrText);
        break;
      case '1099_ssa':
        parsedData = parse1099SSA(ocrText);
        break;
      case '1099_g':
        parsedData = parse1099G(ocrText);
        break;
      default:
        parsedData = { raw_text: ocrText, note: 'Manual review required' };
    }

    // Store parsed data
    await c.env.DB.prepare(
      "UPDATE documents SET status = 'parsed', ocr_text = ?, parsed_data = ? WHERE id = ?"
    ).bind(ocrText, JSON.stringify(parsedData), id).run();

    // Auto-create income items from parsed data
    const incomeItems = extractIncomeItems(doc.doc_type, parsedData, doc.return_id, id);
    for (const item of incomeItems) {
      await c.env.DB.prepare(`
        INSERT INTO income_items (id, return_id, document_id, category, description, amount, tax_withheld, form_line)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(item.id, item.return_id, item.document_id, item.category, item.description, item.amount, item.tax_withheld, item.form_line).run();
    }

    return c.json({
      document_id: id,
      status: 'parsed',
      parsed_data: parsedData,
      income_items_created: incomeItems.length,
    });
  } catch (err) {
    await c.env.DB.prepare("UPDATE documents SET status = 'error' WHERE id = ?").bind(id).run();
    return c.json({ error: 'Parse failed', detail: String(err) }, 500);
  }
});

// ─── Verify Parsed Document ──────────────────────────────────
documents.put('/:id/verify', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ parsed_data?: Record<string, unknown> }>();

  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<TaxDocument>();
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  if (body.parsed_data) {
    await c.env.DB.prepare(
      "UPDATE documents SET status = 'verified', parsed_data = ? WHERE id = ?"
    ).bind(JSON.stringify(body.parsed_data), id).run();
  } else {
    await c.env.DB.prepare("UPDATE documents SET status = 'verified' WHERE id = ?").bind(id).run();
  }

  return c.json({ document_id: id, status: 'verified' });
});

// ─── Delete Document ─────────────────────────────────────────
documents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<TaxDocument>();
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  // Delete from R2
  if (doc.r2_key) {
    await c.env.MEDIA.delete(doc.r2_key);
  }

  // Delete associated income items
  await c.env.DB.prepare('DELETE FROM income_items WHERE document_id = ?').bind(id).run();
  // Delete document record
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();

  return c.json({ deleted: true, id });
});

// ─── Document Parsers ────────────────────────────────────────

function parseW2(text: string): Record<string, unknown> {
  return {
    employer_name: extractField(text, /employer['']?s?\s*name[:\s]+(.*)/i),
    employer_ein: extractField(text, /employer.*(?:ein|id)[:\s]+(\d{2}-?\d{7})/i),
    wages: extractAmount(text, /wages.*tips.*compensation[:\s]*\$?([\d,]+\.?\d*)/i) ||
           extractAmount(text, /box\s*1[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) ||
                      extractAmount(text, /box\s*2[:\s]*\$?([\d,]+\.?\d*)/i),
    social_security_wages: extractAmount(text, /social\s*security\s*wages[:\s]*\$?([\d,]+\.?\d*)/i) ||
                           extractAmount(text, /box\s*3[:\s]*\$?([\d,]+\.?\d*)/i),
    social_security_withheld: extractAmount(text, /social\s*security.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) ||
                              extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
    medicare_wages: extractAmount(text, /medicare\s*wages[:\s]*\$?([\d,]+\.?\d*)/i) ||
                    extractAmount(text, /box\s*5[:\s]*\$?([\d,]+\.?\d*)/i),
    medicare_withheld: extractAmount(text, /medicare.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) ||
                       extractAmount(text, /box\s*6[:\s]*\$?([\d,]+\.?\d*)/i),
    state: extractField(text, /state[:\s]+([A-Z]{2})/i),
    state_wages: extractAmount(text, /state\s*wages[:\s]*\$?([\d,]+\.?\d*)/i) ||
                 extractAmount(text, /box\s*16[:\s]*\$?([\d,]+\.?\d*)/i),
    state_withheld: extractAmount(text, /state.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) ||
                    extractAmount(text, /box\s*17[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

function parse1099INT(text: string): Record<string, unknown> {
  return {
    payer_name: extractField(text, /payer['']?s?\s*name[:\s]+(.*)/i),
    interest_income: extractAmount(text, /interest\s*income[:\s]*\$?([\d,]+\.?\d*)/i) ||
                     extractAmount(text, /box\s*1[:\s]*\$?([\d,]+\.?\d*)/i),
    early_withdrawal_penalty: extractAmount(text, /early\s*withdrawal[:\s]*\$?([\d,]+\.?\d*)/i) ||
                              extractAmount(text, /box\s*2[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) ||
                      extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
    tax_exempt_interest: extractAmount(text, /tax.?exempt\s*interest[:\s]*\$?([\d,]+\.?\d*)/i) ||
                         extractAmount(text, /box\s*8[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

function parse1099DIV(text: string): Record<string, unknown> {
  return {
    payer_name: extractField(text, /payer['']?s?\s*name[:\s]+(.*)/i),
    ordinary_dividends: extractAmount(text, /ordinary\s*dividends[:\s]*\$?([\d,]+\.?\d*)/i) ||
                        extractAmount(text, /box\s*1a[:\s]*\$?([\d,]+\.?\d*)/i),
    qualified_dividends: extractAmount(text, /qualified\s*dividends[:\s]*\$?([\d,]+\.?\d*)/i) ||
                         extractAmount(text, /box\s*1b[:\s]*\$?([\d,]+\.?\d*)/i),
    capital_gains: extractAmount(text, /capital\s*gain[:\s]*\$?([\d,]+\.?\d*)/i) ||
                   extractAmount(text, /box\s*2a[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) ||
                      extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

function parse1099NEC(text: string): Record<string, unknown> {
  return {
    payer_name: extractField(text, /payer['']?s?\s*name[:\s]+(.*)/i),
    nonemployee_compensation: extractAmount(text, /nonemployee\s*compensation[:\s]*\$?([\d,]+\.?\d*)/i) ||
                              extractAmount(text, /box\s*1[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) ||
                      extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

function parse1099MISC(text: string): Record<string, unknown> {
  return {
    payer_name: extractField(text, /payer['']?s?\s*name[:\s]+(.*)/i),
    rents: extractAmount(text, /rents[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*1[:\s]*\$?([\d,]+\.?\d*)/i),
    royalties: extractAmount(text, /royalties[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*2[:\s]*\$?([\d,]+\.?\d*)/i),
    other_income: extractAmount(text, /other\s*income[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*3[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

function parse1099B(text: string): Record<string, unknown> {
  return {
    payer_name: extractField(text, /(?:payer|broker)['']?s?\s*name[:\s]+(.*)/i),
    proceeds: extractAmount(text, /proceeds[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*1d[:\s]*\$?([\d,]+\.?\d*)/i),
    cost_basis: extractAmount(text, /cost.*basis[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*1e[:\s]*\$?([\d,]+\.?\d*)/i),
    gain_loss: extractAmount(text, /gain.*loss[:\s]*\$?(-?[\d,]+\.?\d*)/i),
    short_term: /short.?term/i.test(text),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

function parse1099R(text: string): Record<string, unknown> {
  return {
    payer_name: extractField(text, /payer['']?s?\s*name[:\s]+(.*)/i),
    gross_distribution: extractAmount(text, /gross\s*distribution[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*1[:\s]*\$?([\d,]+\.?\d*)/i),
    taxable_amount: extractAmount(text, /taxable\s*amount[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*2a[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
    distribution_code: extractField(text, /distribution\s*code[:\s]+(\w+)/i),
  };
}

function parse1099SSA(text: string): Record<string, unknown> {
  return {
    total_benefits: extractAmount(text, /total\s*benefits[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*3[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*5[:\s]*\$?([\d,]+\.?\d*)/i),
    benefits_repaid: extractAmount(text, /repaid[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*6[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

function parse1099G(text: string): Record<string, unknown> {
  return {
    payer_name: extractField(text, /payer['']?s?\s*name[:\s]+(.*)/i),
    unemployment_compensation: extractAmount(text, /unemployment[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*1[:\s]*\$?([\d,]+\.?\d*)/i),
    state_tax_refund: extractAmount(text, /state.*(?:refund|credit)[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*2[:\s]*\$?([\d,]+\.?\d*)/i),
    federal_withheld: extractAmount(text, /federal.*(?:tax|withheld)[:\s]*\$?([\d,]+\.?\d*)/i) || extractAmount(text, /box\s*4[:\s]*\$?([\d,]+\.?\d*)/i),
  };
}

// ─── Extract Helpers ─────────────────────────────────────────

function extractField(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function extractAmount(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const cleaned = match[1].replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function extractIncomeItems(
  docType: DocType,
  parsed: Record<string, unknown>,
  returnId: string,
  documentId: string
): Array<{ id: string; return_id: string; document_id: string; category: string; description: string; amount: number; tax_withheld: number; form_line: string }> {
  const items: Array<{ id: string; return_id: string; document_id: string; category: string; description: string; amount: number; tax_withheld: number; form_line: string }> = [];
  const withheld = (parsed.federal_withheld as number) || 0;

  switch (docType) {
    case 'w2': {
      const wages = parsed.wages as number;
      if (wages) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'wages', description: `W-2 from ${parsed.employer_name || 'employer'}`,
          amount: wages, tax_withheld: withheld, form_line: '1040 Line 1a',
        });
      }
      break;
    }
    case '1099_int': {
      const interest = parsed.interest_income as number;
      if (interest) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'interest', description: `Interest from ${parsed.payer_name || 'payer'}`,
          amount: interest, tax_withheld: withheld, form_line: '1040 Line 2b',
        });
      }
      break;
    }
    case '1099_div': {
      const dividends = parsed.ordinary_dividends as number;
      if (dividends) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'dividends', description: `Dividends from ${parsed.payer_name || 'payer'}`,
          amount: dividends, tax_withheld: withheld, form_line: '1040 Line 3b',
        });
      }
      break;
    }
    case '1099_nec': {
      const comp = parsed.nonemployee_compensation as number;
      if (comp) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'business', description: `1099-NEC from ${parsed.payer_name || 'payer'}`,
          amount: comp, tax_withheld: withheld, form_line: 'Schedule C',
        });
      }
      break;
    }
    case '1099_misc': {
      const rents = parsed.rents as number;
      if (rents) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'rental', description: `Rents from ${parsed.payer_name || 'payer'}`,
          amount: rents, tax_withheld: withheld, form_line: 'Schedule E',
        });
      }
      const other = parsed.other_income as number;
      if (other) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'other', description: `Other income from ${parsed.payer_name || 'payer'}`,
          amount: other, tax_withheld: 0, form_line: 'Schedule 1 Line 8z',
        });
      }
      break;
    }
    case '1099_b': {
      const gain = parsed.gain_loss as number;
      if (gain !== null && gain !== undefined) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'capital_gains', description: `${parsed.short_term ? 'Short' : 'Long'}-term capital gain from ${parsed.payer_name || 'broker'}`,
          amount: gain, tax_withheld: withheld, form_line: 'Schedule D',
        });
      }
      break;
    }
    case '1099_r': {
      const taxable = parsed.taxable_amount as number;
      if (taxable) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'retirement', description: `Retirement distribution from ${parsed.payer_name || 'payer'}`,
          amount: taxable, tax_withheld: withheld, form_line: '1040 Line 4b/5b',
        });
      }
      break;
    }
    case '1099_ssa': {
      const benefits = parsed.total_benefits as number;
      if (benefits) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'social_security', description: 'Social Security benefits',
          amount: benefits, tax_withheld: withheld, form_line: '1040 Line 6a',
        });
      }
      break;
    }
    case '1099_g': {
      const unemployment = parsed.unemployment_compensation as number;
      if (unemployment) {
        items.push({
          id: generateId('inc'), return_id: returnId, document_id: documentId,
          category: 'unemployment', description: 'Unemployment compensation',
          amount: unemployment, tax_withheld: withheld, form_line: 'Schedule 1 Line 7',
        });
      }
      break;
    }
  }
  return items;
}

export default documents;
