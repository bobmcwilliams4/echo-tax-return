// Echo Tax Return — Return Lifecycle Endpoints
import { Hono } from 'hono';
import type { Env, TaxReturn, CreateReturnRequest, AddIncomeRequest, AddDeductionRequest, AddDependentRequest, IncomeItem, Deduction, Dependent, ReturnStatus } from './types';
import { generateId, isCommander } from './auth';
import { encryptSSN } from './crypto';

const returns = new Hono<{ Bindings: Env }>();

const VALID_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  intake: ['documents'],
  documents: ['calculating'],
  calculating: ['review'],
  review: ['filed', 'documents'], // can go back to documents
  filed: ['accepted', 'rejected'],
  accepted: [],
  rejected: ['documents'], // can restart
};

// ─── Create Return ───────────────────────────────────────────
returns.post('/', async (c) => {
  const body = await c.req.json<CreateReturnRequest>();
  if (!body.client_id || !body.tax_year) {
    return c.json({ error: 'client_id and tax_year are required' }, 400);
  }
  if (body.tax_year < 2020 || body.tax_year > 2025) {
    return c.json({ error: 'tax_year must be between 2020 and 2025' }, 400);
  }

  // Verify client exists
  const client = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ?')
    .bind(body.client_id).first();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  // Check for duplicate
  const existing = await c.env.DB.prepare(
    'SELECT id FROM returns WHERE client_id = ? AND tax_year = ?'
  ).bind(body.client_id, body.tax_year).first();
  if (existing) {
    return c.json({ error: 'Return already exists for this client and year', existing_id: (existing as any).id }, 409);
  }

  const id = generateId('ret');
  await c.env.DB.prepare(`
    INSERT INTO returns (id, client_id, tax_year, preparer_ptin)
    VALUES (?, ?, ?, ?)
  `).bind(id, body.client_id, body.tax_year, body.preparer_ptin || null).run();

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(id).first<TaxReturn>();
  return c.json({ return: ret }, 201);
});

// ─── Get Return with Details ─────────────────────────────────
returns.get('/:id', async (c) => {
  const id = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(id).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const [incomeResult, deductionResult, dependentResult, docResult, optResult] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ? ORDER BY category').bind(id).all<IncomeItem>(),
    c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ? ORDER BY category').bind(id).all<Deduction>(),
    c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(id).all<Dependent>(),
    c.env.DB.prepare('SELECT id, doc_type, issuer_name, status, created_at FROM documents WHERE return_id = ?').bind(id).all(),
    c.env.DB.prepare('SELECT * FROM optimizations WHERE return_id = ? ORDER BY potential_savings DESC').bind(id).all(),
  ]);

  return c.json({
    return: ret,
    income_items: incomeResult.results,
    deductions: deductionResult.results,
    dependents: dependentResult.results,
    documents: docResult.results,
    optimizations: optResult.results,
  });
});

// ─── List Returns ────────────────────────────────────────────
returns.get('/', async (c) => {
  const clientId = c.req.query('client_id');
  const taxYear = c.req.query('tax_year');
  const status = c.req.query('status');

  let sql = 'SELECT r.*, c.first_name, c.last_name FROM returns r JOIN clients c ON r.client_id = c.id WHERE 1=1';
  const params: (string | number)[] = [];

  if (clientId) { sql += ' AND r.client_id = ?'; params.push(clientId); }
  if (taxYear) { sql += ' AND r.tax_year = ?'; params.push(parseInt(taxYear)); }
  if (status) { sql += ' AND r.status = ?'; params.push(status); }

  if (!isCommander(c)) {
    const userId = c.req.header('X-User-Id');
    if (!userId) return c.json({ error: 'X-User-Id header required' }, 400);
    sql += ' AND c.user_id = ?';
    params.push(userId);
  }

  sql += ' ORDER BY r.updated_at DESC LIMIT 200';
  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ returns: result.results, count: result.results.length });
});

// ─── Update Return Status ────────────────────────────────────
returns.put('/:id/status', async (c) => {
  const id = c.req.param('id');
  const { status: newStatus } = await c.req.json<{ status: ReturnStatus }>();

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(id).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const allowed = VALID_TRANSITIONS[ret.status] || [];
  if (!allowed.includes(newStatus)) {
    return c.json({
      error: `Cannot transition from '${ret.status}' to '${newStatus}'`,
      allowed_transitions: allowed
    }, 400);
  }

  const filedAt = newStatus === 'filed' ? new Date().toISOString() : ret.filed_at;
  await c.env.DB.prepare(
    "UPDATE returns SET status = ?, filed_at = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newStatus, filedAt, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(id).first<TaxReturn>();
  return c.json({ return: updated });
});

// ─── Add Income Item ─────────────────────────────────────────
returns.post('/:id/income', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<AddIncomeRequest>();

  const ret = await c.env.DB.prepare('SELECT id FROM returns WHERE id = ?').bind(returnId).first();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  if (!body.category || body.amount === undefined) {
    return c.json({ error: 'category and amount are required' }, 400);
  }

  const id = generateId('inc');
  await c.env.DB.prepare(`
    INSERT INTO income_items (id, return_id, document_id, category, description, amount, tax_withheld, form_line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, returnId, body.document_id || null, body.category, body.description || null,
    body.amount, body.tax_withheld || 0, body.form_line || null
  ).run();

  const item = await c.env.DB.prepare('SELECT * FROM income_items WHERE id = ?').bind(id).first<IncomeItem>();
  return c.json({ income_item: item }, 201);
});

// ─── Delete Income Item ──────────────────────────────────────
returns.delete('/:returnId/income/:id', async (c) => {
  const { returnId, id } = c.req.param();
  await c.env.DB.prepare('DELETE FROM income_items WHERE id = ? AND return_id = ?').bind(id, returnId).run();
  return c.json({ deleted: true });
});

// ─── Add Deduction ───────────────────────────────────────────
returns.post('/:id/deductions', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<AddDeductionRequest>();

  const ret = await c.env.DB.prepare('SELECT id FROM returns WHERE id = ?').bind(returnId).first();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  if (!body.category || body.amount === undefined) {
    return c.json({ error: 'category and amount are required' }, 400);
  }

  const id = generateId('ded');
  await c.env.DB.prepare(`
    INSERT INTO deductions (id, return_id, category, description, amount, schedule, form_line)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, returnId, body.category, body.description || null,
    body.amount, body.schedule || null, body.form_line || null
  ).run();

  const item = await c.env.DB.prepare('SELECT * FROM deductions WHERE id = ?').bind(id).first<Deduction>();
  return c.json({ deduction: item }, 201);
});

// ─── Delete Deduction ────────────────────────────────────────
returns.delete('/:returnId/deductions/:id', async (c) => {
  const { returnId, id } = c.req.param();
  await c.env.DB.prepare('DELETE FROM deductions WHERE id = ? AND return_id = ?').bind(id, returnId).run();
  return c.json({ deleted: true });
});

// ─── Add Dependent ───────────────────────────────────────────
returns.post('/:id/dependents', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<AddDependentRequest>();

  const ret = await c.env.DB.prepare('SELECT id FROM returns WHERE id = ?').bind(returnId).first();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  if (!body.first_name || !body.last_name) {
    return c.json({ error: 'first_name and last_name are required' }, 400);
  }

  let ssnEnc: string | null = null;
  if (body.ssn) {
    const cleaned = body.ssn.replace(/\D/g, '');
    if (cleaned.length !== 9) return c.json({ error: 'SSN must be 9 digits' }, 400);
    ssnEnc = await encryptSSN(cleaned, c.env.SSN_ENCRYPTION_KEY);
  }

  const id = generateId('dep');
  await c.env.DB.prepare(`
    INSERT INTO dependents (id, return_id, first_name, last_name, ssn_encrypted, dob, relationship, months_lived, qualifies_ctc, qualifies_odc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, returnId, body.first_name, body.last_name, ssnEnc,
    body.dob || null, body.relationship || null, body.months_lived || 12,
    body.qualifies_ctc ? 1 : 0, body.qualifies_odc ? 1 : 0
  ).run();

  const dep = await c.env.DB.prepare('SELECT * FROM dependents WHERE id = ?').bind(id).first<Dependent>();
  return c.json({ dependent: dep }, 201);
});

// ─── Delete Dependent ────────────────────────────────────────
returns.delete('/:returnId/dependents/:id', async (c) => {
  const { returnId, id } = c.req.param();
  await c.env.DB.prepare('DELETE FROM dependents WHERE id = ? AND return_id = ?').bind(id, returnId).run();
  return c.json({ deleted: true });
});

// ─── Get Return Summary (lightweight) ────────────────────────
returns.get('/:id/summary', async (c) => {
  const id = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(id).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const [incomeCount, deductionCount, docCount, depCount] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt, SUM(amount) as total FROM income_items WHERE return_id = ?').bind(id).first<{ cnt: number; total: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt, SUM(amount) as total FROM deductions WHERE return_id = ?').bind(id).first<{ cnt: number; total: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM documents WHERE return_id = ?').bind(id).first<{ cnt: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM dependents WHERE return_id = ?').bind(id).first<{ cnt: number }>(),
  ]);

  return c.json({
    return_id: ret.id,
    status: ret.status,
    tax_year: ret.tax_year,
    income_items: incomeCount?.cnt || 0,
    total_income: incomeCount?.total || 0,
    deduction_items: deductionCount?.cnt || 0,
    total_deductions: deductionCount?.total || 0,
    documents: docCount?.cnt || 0,
    dependents: depCount?.cnt || 0,
    refund_or_owed: ret.refund_or_owed,
    calculated: ret.total_tax > 0,
  });
});

export default returns;
