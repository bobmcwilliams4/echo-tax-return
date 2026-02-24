// Echo Tax Return — Electronic Filing Module
// Generates complete filing packages, IRS-compatible form data, and filing instructions
import { Hono } from 'hono';
import type { Env, TaxReturn, Client, IncomeItem, Deduction, Dependent, FilingStatus, Form1040 } from './types';
import { isCommander, generateId } from './auth';
import { calculateTaxReturn, generateForm1040 } from './calculator';
import { decryptSSN } from './crypto';

const efile = new Hono<{ Bindings: Env }>();

// ═══════════════════════════════════════════════════════════════
// IRS FILING CONSTANTS
// ═══════════════════════════════════════════════════════════════

const IRS_EFILE_YEARS = [2024, 2023, 2022]; // Years IRS accepts e-file (as of 2026)

const IRS_MAILING_ADDRESS_TX = {
  refund: {
    name: 'Department of the Treasury',
    line1: 'Internal Revenue Service',
    city: 'Austin',
    state: 'TX',
    zip: '73301-0002',
  },
  payment: {
    name: 'Department of the Treasury',
    line1: 'Internal Revenue Service',
    city: 'Austin',
    state: 'TX',
    zip: '73301-0052',
  },
};

const STANDARD_DEDUCTIONS: Record<number, Record<FilingStatus, number>> = {
  2024: { single: 14600, married_joint: 29200, married_separate: 14600, head_of_household: 21900, widow: 29200 },
  2023: { single: 13850, married_joint: 27700, married_separate: 13850, head_of_household: 20800, widow: 27700 },
  2022: { single: 12950, married_joint: 25900, married_separate: 12950, head_of_household: 19400, widow: 25900 },
  2021: { single: 12550, married_joint: 25100, married_separate: 12550, head_of_household: 18800, widow: 25100 },
  2020: { single: 12400, married_joint: 24800, married_separate: 12400, head_of_household: 18650, widow: 24800 },
  2019: { single: 12200, married_joint: 24400, married_separate: 12200, head_of_household: 18350, widow: 24400 },
};

// Refund claim deadlines (3 years from original due date)
const REFUND_DEADLINES: Record<number, string> = {
  2019: '2023-07-15', // COVID extension
  2020: '2024-05-17', // COVID extension
  2021: '2025-04-18',
  2022: '2026-04-18',
  2023: '2027-04-15',
  2024: '2028-04-15',
};

interface FilingPackage {
  return_id: string;
  tax_year: number;
  filing_method: 'efile' | 'paper';
  filing_status: FilingStatus;
  taxpayer: { first_name: string; last_name: string; ssn_last4: string; dob: string; address: string };
  dependents: Array<{ name: string; relationship: string; ssn_last4: string; dob: string }>;
  form_1040: Form1040;
  summary: {
    total_income: number;
    agi: number;
    deduction_method: string;
    deduction_amount: number;
    taxable_income: number;
    total_tax: number;
    total_payments: number;
    refund_or_owed: number;
    result_type: 'refund' | 'owed';
  };
  refund_claim: {
    deadline: string;
    expired: boolean;
    claimable: boolean;
    note: string;
  };
  filing_instructions: string[];
  mailing_address: typeof IRS_MAILING_ADDRESS_TX.refund | null;
  irs_free_file_url: string | null;
  form_9465_needed: boolean;
  form_5329_needed: boolean;
  estimated_penalty: number;
  status: 'ready' | 'filed' | 'accepted' | 'rejected';
  generated_at: string;
}

// ─── Generate Complete Filing Package ──────────────────────────
efile.get('/:id/filing-package', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  // Generate Form 1040 data
  const form1040 = await generateForm1040(c.env, returnId);

  // Get dependents
  const depResult = await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>();
  const dependents = depResult.results;

  // Determine filing method
  const canEfile = IRS_EFILE_YEARS.includes(ret.tax_year);
  const filingMethod = canEfile ? 'efile' : 'paper';

  // Refund claim analysis
  const deadline = REFUND_DEADLINES[ret.tax_year] || 'unknown';
  const deadlineDate = new Date(deadline);
  const now = new Date();
  const expired = now > deadlineDate;
  const isRefund = ret.refund_or_owed > 0;
  const claimable = isRefund && !expired;

  let refundNote = '';
  if (isRefund && expired) {
    refundNote = `REFUND EXPIRED: The 3-year claim deadline was ${deadline}. The $${ret.refund_or_owed.toLocaleString()} refund cannot be claimed. Filing is still required for compliance.`;
  } else if (isRefund && !expired) {
    const daysLeft = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    refundNote = `REFUND CLAIMABLE: ${daysLeft} days remaining to claim $${ret.refund_or_owed.toLocaleString()} refund. Deadline: ${deadline}.`;
    if (daysLeft < 90) refundNote += ' URGENT — file immediately!';
  } else {
    refundNote = `Amount owed: $${Math.abs(ret.refund_or_owed).toLocaleString()}.`;
  }

  // Check if Form 5329 needed (early distribution penalty)
  const incomeItems = (await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>()).results;
  const retirementItems = incomeItems.filter(i => i.category === 'retirement');
  const hasEarlyDistribution = retirementItems.some(i =>
    i.description?.includes('Code 1') || i.description?.includes('Code M') || i.description?.includes('early')
  );
  const form5329Needed = hasEarlyDistribution && ret.tax_year === 2024;
  let estimatedPenalty = 0;
  if (form5329Needed) {
    const earlyDistAmount = retirementItems
      .filter(i => i.description?.includes('Code 1') || i.description?.includes('Code M'))
      .reduce((sum, i) => sum + i.amount, 0);
    estimatedPenalty = Math.round(earlyDistAmount * 0.10 * 100) / 100;
  }

  // Form 9465 needed if owe more than $0
  const form9465Needed = ret.refund_or_owed < 0 && Math.abs(ret.refund_or_owed) > 0;

  // SSN last 4 (decrypt if available)
  let ssnLast4 = 'XXXX';
  if (client.ssn_encrypted) {
    try {
      const fullSSN = await decryptSSN(client.ssn_encrypted, c.env.SSN_ENCRYPTION_KEY);
      ssnLast4 = fullSSN.slice(-4);
    } catch { /* keep masked */ }
  }

  // Build filing instructions
  const instructions: string[] = [];
  if (filingMethod === 'efile') {
    instructions.push(`ELECTRONIC FILING — Tax Year ${ret.tax_year}`);
    instructions.push('1. Go to https://www.freefilefillableforms.com/ (IRS Free File Fillable Forms)');
    instructions.push('2. Create an account or sign in');
    instructions.push(`3. Select Form 1040 for tax year ${ret.tax_year}`);
    instructions.push('4. Enter the data from the form lines below');
    instructions.push('5. Review all entries carefully');
    instructions.push('6. Sign electronically (you will need your AGI from a prior year return, or your IRS IP PIN)');
    instructions.push('7. Submit the return');
    if (ret.refund_or_owed > 0) {
      instructions.push('8. For refund: Enter bank routing/account number for direct deposit');
    } else {
      instructions.push('8. For payment: You can pay via IRS Direct Pay (irs.gov/payments)');
      if (form9465Needed) {
        instructions.push('9. File Form 9465 (Installment Agreement Request) if unable to pay in full');
      }
    }
  } else {
    instructions.push(`PAPER FILING (mail) — Tax Year ${ret.tax_year}`);
    instructions.push(`1. Print Form 1040 for ${ret.tax_year} from https://www.irs.gov/forms-pubs`);
    instructions.push('2. Fill in by hand or type using the form data below');
    instructions.push('3. Sign and date on Page 2');
    instructions.push('4. Attach all W-2 copies (Copy B - To Be Filed With Employee\'s Federal Tax Return)');
    instructions.push('5. Attach any 1099-R showing federal withholding');
    if (ret.tax_year <= 2021 && isRefund) {
      instructions.push(`6. NOTE: Refund for ${ret.tax_year} has EXPIRED (deadline was ${deadline}). File anyway for compliance.`);
    }
    const addr = ret.refund_or_owed >= 0 ? IRS_MAILING_ADDRESS_TX.refund : IRS_MAILING_ADDRESS_TX.payment;
    instructions.push(`${isRefund ? '6' : '6'}. Mail to: ${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip}`);
    instructions.push('7. Send via USPS Certified Mail with Return Receipt (proof of filing date)');
    if (!isRefund) {
      instructions.push('8. Include check payable to "United States Treasury" for the amount owed');
      instructions.push(`   Write "Form 1040", "${ret.tax_year}", and SSN on the check`);
    }
  }

  const pkg: FilingPackage = {
    return_id: returnId,
    tax_year: ret.tax_year,
    filing_method: filingMethod,
    filing_status: client.filing_status || 'single',
    taxpayer: {
      first_name: client.first_name || '',
      last_name: client.last_name || '',
      ssn_last4: ssnLast4,
      dob: client.dob || '',
      address: [client.address_street, client.address_city, client.address_state, client.address_zip].filter(Boolean).join(', '),
    },
    dependents: dependents.map(d => ({
      name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
      relationship: d.relationship || '',
      ssn_last4: 'XXXX', // masked for security
      dob: d.dob || '',
    })),
    form_1040: form1040,
    summary: {
      total_income: ret.total_income,
      agi: ret.adjusted_gross_income,
      deduction_method: ret.deduction_method || 'standard',
      deduction_amount: form1040.lines.find(l => l.line === '12')?.amount || 0,
      taxable_income: ret.taxable_income,
      total_tax: ret.total_tax,
      total_payments: ret.total_payments,
      refund_or_owed: ret.refund_or_owed,
      result_type: ret.refund_or_owed >= 0 ? 'refund' : 'owed',
    },
    refund_claim: {
      deadline,
      expired,
      claimable,
      note: refundNote,
    },
    filing_instructions: instructions,
    mailing_address: filingMethod === 'paper'
      ? (ret.refund_or_owed >= 0 ? IRS_MAILING_ADDRESS_TX.refund : IRS_MAILING_ADDRESS_TX.payment)
      : null,
    irs_free_file_url: filingMethod === 'efile' ? 'https://www.freefilefillableforms.com/' : null,
    form_9465_needed: form9465Needed,
    form_5329_needed: form5329Needed,
    estimated_penalty: estimatedPenalty,
    status: 'ready',
    generated_at: new Date().toISOString(),
  };

  // Cache the package
  await c.env.CACHE.put(`filing:${returnId}`, JSON.stringify(pkg), { expirationTtl: 86400 });

  return c.json({ filing_package: pkg });
});

// ─── Generate All Filing Packages ──────────────────────────────
efile.get('/filing-packages/all', async (c) => {
  const clientId = c.req.query('client_id');
  if (!clientId) return c.json({ error: 'client_id required' }, 400);

  const returnsResult = await c.env.DB.prepare(
    'SELECT id, tax_year, refund_or_owed, status FROM returns WHERE client_id = ? ORDER BY tax_year ASC'
  ).bind(clientId).all<TaxReturn>();

  const packages: { year: number; return_id: string; method: string; result: string; amount: number; refund_expired: boolean; deadline: string }[] = [];

  let totalRefund = 0;
  let totalOwed = 0;
  let claimableRefund = 0;

  for (const ret of returnsResult.results) {
    const canEfile = IRS_EFILE_YEARS.includes(ret.tax_year);
    const deadline = REFUND_DEADLINES[ret.tax_year] || 'unknown';
    const expired = new Date() > new Date(deadline);
    const isRefund = ret.refund_or_owed > 0;

    if (isRefund) {
      totalRefund += ret.refund_or_owed;
      if (!expired) claimableRefund += ret.refund_or_owed;
    } else {
      totalOwed += Math.abs(ret.refund_or_owed);
    }

    packages.push({
      year: ret.tax_year,
      return_id: ret.id,
      method: canEfile ? 'E-FILE' : 'PAPER (mail)',
      result: isRefund ? 'REFUND' : 'OWED',
      amount: Math.abs(ret.refund_or_owed),
      refund_expired: isRefund && expired,
      deadline,
    });
  }

  return c.json({
    client_id: clientId,
    filing_summary: {
      total_returns: packages.length,
      efile_eligible: packages.filter(p => p.method === 'E-FILE').length,
      paper_required: packages.filter(p => p.method !== 'E-FILE').length,
      total_refund_calculated: Math.round(totalRefund * 100) / 100,
      total_owed: Math.round(totalOwed * 100) / 100,
      claimable_refund: Math.round(claimableRefund * 100) / 100,
      expired_refund: Math.round((totalRefund - claimableRefund) * 100) / 100,
      net_position: Math.round((claimableRefund - totalOwed) * 100) / 100,
    },
    packages,
    filing_order: [
      '1. FILE 2022 FIRST — Refund deadline April 18, 2026 (URGENT)',
      '2. FILE 2023 — Largest refund ($7,841)',
      '3. FILE 2024 — Current year, owe $5,282',
      '4. File 2019-2021 (paper) — Refunds expired but required for compliance',
    ],
    recommended_strategy: {
      step1: 'E-file 2022 immediately to secure $3,216 refund before April 18 deadline',
      step2: 'E-file 2023 to claim $7,841 refund',
      step3: 'E-file 2024 — offset $5,282 owed against 2022+2023 refunds',
      step4: 'Paper-file 2019-2021 to establish compliance (refunds expired)',
      step5: 'Request installment agreement (Form 9465) only if needed after refund offsets',
      net_result: `After e-filing 2022+2023, refunds ($${Math.round(claimableRefund).toLocaleString()}) minus 2024 owed ($${Math.round(totalOwed).toLocaleString()}) = NET $${Math.round(claimableRefund - totalOwed).toLocaleString()} in your favor`,
    },
  });
});

// ─── Mark Return as Filed ──────────────────────────────────────
efile.post('/:id/file', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<{ method: 'efile' | 'paper'; confirmation_number?: string; tracking_number?: string }>();

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  if (ret.status !== 'review' && ret.status !== 'calculating') {
    return c.json({ error: `Return must be in review status to file. Current: ${ret.status}` }, 400);
  }

  const filedAt = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE returns SET status = 'filed', filed_at = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(filedAt, returnId).run();

  // Store filing record
  const filingId = generateId('fil');
  await c.env.DB.prepare(`
    INSERT INTO filing_records (id, return_id, method, confirmation_number, tracking_number, filed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    filingId, returnId, body.method,
    body.confirmation_number || null,
    body.tracking_number || null,
    filedAt
  ).run().catch(() => {
    // Table may not exist yet — create it
    return c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS filing_records (
        id TEXT PRIMARY KEY,
        return_id TEXT NOT NULL,
        method TEXT NOT NULL,
        confirmation_number TEXT,
        tracking_number TEXT,
        filed_at TEXT NOT NULL,
        accepted_at TEXT,
        rejected_at TEXT,
        rejection_reason TEXT
      )
    `).run().then(() =>
      c.env.DB.prepare(`
        INSERT INTO filing_records (id, return_id, method, confirmation_number, tracking_number, filed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(filingId, returnId, body.method, body.confirmation_number || null, body.tracking_number || null, filedAt).run()
    );
  });

  // Notify Shared Brain
  try {
    await c.env.SHARED_BRAIN.fetch(
      new Request('https://internal/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: 'echo-tax-return',
          role: 'system',
          content: `TAX RETURN FILED: Return ${returnId}, Year ${ret.tax_year}, Method: ${body.method}, ` +
            `Result: ${ret.refund_or_owed >= 0 ? 'Refund' : 'Owed'} $${Math.abs(ret.refund_or_owed).toLocaleString()}`,
          importance: 9,
          tags: ['tax_return', 'filed', `year_${ret.tax_year}`],
        }),
      })
    );
  } catch { /* non-critical */ }

  return c.json({
    filing_id: filingId,
    return_id: returnId,
    tax_year: ret.tax_year,
    method: body.method,
    status: 'filed',
    filed_at: filedAt,
    confirmation_number: body.confirmation_number || null,
    tracking_number: body.tracking_number || null,
  });
});

// ─── Generate Printable Form Data ──────────────────────────────
efile.get('/:id/printable', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const form1040 = await generateForm1040(c.env, returnId);
  const incomeItems = (await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ? ORDER BY category').bind(returnId).all<IncomeItem>()).results;
  const dependents = (await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>()).results;

  // Generate human-readable printable format
  const printable: string[] = [];
  printable.push('═'.repeat(70));
  printable.push(`  FORM 1040 — U.S. Individual Income Tax Return — ${ret.tax_year}`);
  printable.push('═'.repeat(70));
  printable.push('');
  printable.push(`Name:           ${client.first_name} ${client.last_name}`);
  printable.push(`SSN:            XXX-XX-${(await getSSNLast4(client, c.env.SSN_ENCRYPTION_KEY))}`);
  printable.push(`Address:        ${client.address_street || ''}`);
  printable.push(`                ${client.address_city || ''}, ${client.address_state || ''} ${client.address_zip || ''}`);
  printable.push(`Filing Status:  ${formatFilingStatus(client.filing_status || 'single')}`);
  printable.push(`DOB:            ${client.dob || 'N/A'}`);
  printable.push('');

  if (dependents.length > 0) {
    printable.push('DEPENDENTS:');
    for (const dep of dependents) {
      printable.push(`  ${dep.first_name} ${dep.last_name} — ${dep.relationship || 'dependent'}, DOB: ${dep.dob || 'N/A'}`);
      if (dep.qualifies_ctc) printable.push(`    ✓ Qualifies for Child Tax Credit`);
    }
    printable.push('');
  }

  printable.push('─'.repeat(70));
  printable.push('  INCOME');
  printable.push('─'.repeat(70));
  for (const line of form1040.lines.filter(l => parseInt(l.line) <= 9 || l.line.startsWith('1') && l.line.length <= 2)) {
    if (line.amount !== 0) {
      printable.push(`  Line ${line.line.padEnd(5)} ${line.description.padEnd(45)} $${line.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }

  printable.push('');
  printable.push('─'.repeat(70));
  printable.push('  DEDUCTIONS & TAXABLE INCOME');
  printable.push('─'.repeat(70));
  for (const line of form1040.lines.filter(l => ['10', '11', '12', '13', '14', '15'].includes(l.line))) {
    printable.push(`  Line ${line.line.padEnd(5)} ${line.description.padEnd(45)} $${line.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  }

  printable.push('');
  printable.push('─'.repeat(70));
  printable.push('  TAX & CREDITS');
  printable.push('─'.repeat(70));
  for (const line of form1040.lines.filter(l => parseInt(l.line) >= 16 && parseInt(l.line) <= 24)) {
    if (line.amount !== 0 || ['16', '24'].includes(line.line)) {
      printable.push(`  Line ${line.line.padEnd(5)} ${line.description.padEnd(45)} $${line.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }

  printable.push('');
  printable.push('─'.repeat(70));
  printable.push('  PAYMENTS & RESULT');
  printable.push('─'.repeat(70));
  for (const line of form1040.lines.filter(l => parseInt(l.line) >= 25)) {
    if (line.amount !== 0 || ['33', '34', '37'].includes(line.line)) {
      printable.push(`  Line ${line.line.padEnd(5)} ${line.description.padEnd(45)} $${line.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }

  printable.push('');
  printable.push('═'.repeat(70));
  if (ret.refund_or_owed >= 0) {
    printable.push(`  ★ REFUND: $${ret.refund_or_owed.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  } else {
    printable.push(`  ★ AMOUNT OWED: $${Math.abs(ret.refund_or_owed).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  }
  printable.push('═'.repeat(70));

  // Income detail
  printable.push('');
  printable.push('─'.repeat(70));
  printable.push('  INCOME SOURCES (detail)');
  printable.push('─'.repeat(70));
  for (const item of incomeItems) {
    printable.push(`  ${item.category.padEnd(15)} ${(item.description || '').padEnd(35)} $${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}  (withheld: $${(item.tax_withheld || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
  }

  // Schedules
  for (const [schedName, schedLines] of Object.entries(form1040.schedules)) {
    if (schedLines && schedLines.length > 0) {
      printable.push('');
      printable.push('─'.repeat(70));
      printable.push(`  ${schedName.toUpperCase().replace('_', ' ')}`);
      printable.push('─'.repeat(70));
      for (const line of schedLines) {
        if (line.amount !== 0) {
          printable.push(`  ${line.line.padEnd(8)} ${line.description.padEnd(42)} $${line.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        }
      }
    }
  }

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    printable_text: printable.join('\n'),
    form_1040: form1040,
  });
});

// ─── Batch File All Returns ──────────────────────────────────
efile.post('/batch-file', async (c) => {
  if (!isCommander(c)) return c.json({ error: 'Commander access required' }, 403);

  const body = await c.req.json<{ client_id: string }>();
  if (!body.client_id) return c.json({ error: 'client_id required' }, 400);

  const returnsResult = await c.env.DB.prepare(
    "SELECT id, tax_year, status, refund_or_owed FROM returns WHERE client_id = ? AND status = 'review' ORDER BY tax_year ASC"
  ).bind(body.client_id).all<TaxReturn>();

  const results: Array<{ year: number; return_id: string; method: string; status: string; action: string }> = [];

  for (const ret of returnsResult.results) {
    const canEfile = IRS_EFILE_YEARS.includes(ret.tax_year);
    const method = canEfile ? 'efile' : 'paper';

    // Advance to filed status
    await c.env.DB.prepare(
      "UPDATE returns SET status = 'filed', filed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(ret.id).run();

    results.push({
      year: ret.tax_year,
      return_id: ret.id,
      method: canEfile ? 'E-FILE (IRS Free File)' : 'PAPER (mail to Austin TX)',
      status: 'filed',
      action: canEfile
        ? `Go to freefilefillableforms.com → File 1040 for ${ret.tax_year}`
        : `Print 1040, sign, mail to IRS Austin TX ${ret.refund_or_owed >= 0 ? '73301-0002' : '73301-0052'}`,
    });
  }

  // Store to Shared Brain
  try {
    await c.env.SHARED_BRAIN.fetch(
      new Request('https://internal/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: 'echo-tax-return',
          role: 'system',
          content: `BATCH FILING: ${results.length} returns marked as filed. Years: ${results.map(r => r.year).join(', ')}`,
          importance: 10,
          tags: ['tax_return', 'batch_filed', 'commander'],
        }),
      })
    );
  } catch { /* non-critical */ }

  return c.json({
    batch_filed: results.length,
    results,
    next_steps: [
      'PRIORITY 1: E-file 2022 at freefilefillableforms.com (refund $3,216 expires April 18, 2026)',
      'PRIORITY 2: E-file 2023 at freefilefillableforms.com (refund $7,841)',
      'PRIORITY 3: E-file 2024 at freefilefillableforms.com (owe $5,282)',
      'PRIORITY 4: Print and mail 2019-2021 to IRS Austin TX (compliance only, refunds expired)',
    ],
  });
});

// ─── Helper: Get SSN last 4 ────────────────────────────────────
async function getSSNLast4(client: Client, key: string): Promise<string> {
  if (!client.ssn_encrypted) return 'XXXX';
  try {
    const full = await decryptSSN(client.ssn_encrypted, key);
    return full.slice(-4);
  } catch {
    return 'XXXX';
  }
}

function formatFilingStatus(status: FilingStatus): string {
  const map: Record<FilingStatus, string> = {
    single: 'Single',
    married_joint: 'Married Filing Jointly',
    married_separate: 'Married Filing Separately',
    head_of_household: 'Head of Household',
    widow: 'Qualifying Surviving Spouse',
  };
  return map[status] || status;
}

export default efile;
