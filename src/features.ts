// Echo Tax Return — Advanced Features Module
// Estimated payments, multi-year comparison, audit risk, amendments, withholding estimator
import { Hono } from 'hono';
import type { Env, TaxReturn, Client, IncomeItem, Deduction, Dependent, FilingStatus } from './types';
import { isCommander, generateId, requireAuth } from './auth';
import { calculateTaxReturn } from './calculator';
import { getTaxBrackets, getStandardDeduction, getSSWageBase, getCTCParams, getSupportedYears } from './tax-data';

const features = new Hono<{ Bindings: Env }>();

// ═══════════════════════════════════════════════════════════════
// ESTIMATED TAX PAYMENTS (quarterly tracking)
// ═══════════════════════════════════════════════════════════════

features.post('/:id/estimated-payments', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<{ quarter: 1 | 2 | 3 | 4; amount: number; date_paid?: string; confirmation?: string }>();

  if (!body.quarter || !body.amount || body.quarter < 1 || body.quarter > 4) {
    return c.json({ error: 'quarter (1-4) and amount required' }, 400);
  }

  // Ensure table exists
  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS estimated_payments (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      quarter INTEGER NOT NULL,
      amount REAL NOT NULL,
      date_paid TEXT,
      confirmation TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  const id = generateId('ep');
  await c.env.DB.prepare(
    'INSERT INTO estimated_payments (id, return_id, quarter, amount, date_paid, confirmation) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, returnId, body.quarter, body.amount, body.date_paid || null, body.confirmation || null).run();

  return c.json({ id, return_id: returnId, quarter: body.quarter, amount: body.amount, status: 'recorded' });
});

features.get('/:id/estimated-payments', async (c) => {
  const returnId = c.req.param('id');
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM estimated_payments WHERE return_id = ? ORDER BY quarter'
    ).bind(returnId).all();
    const total = result.results.reduce((s: number, r: any) => s + (r.amount || 0), 0);
    return c.json({ return_id: returnId, payments: result.results, total });
  } catch {
    return c.json({ return_id: returnId, payments: [], total: 0 });
  }
});

features.delete('/:id/estimated-payments/:epId', async (c) => {
  const returnId = c.req.param('id');
  const epId = c.req.param('epId');
  await c.env.DB.prepare('DELETE FROM estimated_payments WHERE id = ? AND return_id = ?').bind(epId, returnId).run();
  return c.json({ deleted: true });
});

// ═══════════════════════════════════════════════════════════════
// MULTI-YEAR COMPARISON
// ═══════════════════════════════════════════════════════════════

features.get('/compare', async (c) => {
  const clientId = c.req.query('client_id');
  if (!clientId) return c.json({ error: 'client_id required' }, 400);

  const returnsResult = await c.env.DB.prepare(
    'SELECT * FROM returns WHERE client_id = ? ORDER BY tax_year ASC'
  ).bind(clientId).all<TaxReturn>();

  if (returnsResult.results.length === 0) {
    return c.json({ error: 'No returns found for this client' }, 404);
  }

  const comparison = returnsResult.results.map(r => ({
    tax_year: r.tax_year,
    total_income: r.total_income,
    agi: r.adjusted_gross_income,
    taxable_income: r.taxable_income,
    deduction_method: r.deduction_method,
    total_tax: r.total_tax,
    total_payments: r.total_payments,
    refund_or_owed: r.refund_or_owed,
    effective_rate: r.total_income > 0 ? Math.round((r.total_tax / r.total_income) * 10000) / 100 : 0,
    status: r.status,
  }));

  // Calculate year-over-year changes
  const yoyChanges: any[] = [];
  for (let i = 1; i < comparison.length; i++) {
    const prev = comparison[i - 1];
    const curr = comparison[i];
    yoyChanges.push({
      from_year: prev.tax_year,
      to_year: curr.tax_year,
      income_change: curr.total_income - prev.total_income,
      income_change_pct: prev.total_income > 0 ? Math.round(((curr.total_income - prev.total_income) / prev.total_income) * 10000) / 100 : 0,
      tax_change: curr.total_tax - prev.total_tax,
      tax_change_pct: prev.total_tax > 0 ? Math.round(((curr.total_tax - prev.total_tax) / prev.total_tax) * 10000) / 100 : 0,
      effective_rate_change: curr.effective_rate - prev.effective_rate,
    });
  }

  // Summary stats
  const totalIncome = comparison.reduce((s, r) => s + r.total_income, 0);
  const totalTax = comparison.reduce((s, r) => s + r.total_tax, 0);
  const totalRefunds = comparison.filter(r => r.refund_or_owed > 0).reduce((s, r) => s + r.refund_or_owed, 0);
  const totalOwed = comparison.filter(r => r.refund_or_owed < 0).reduce((s, r) => s + Math.abs(r.refund_or_owed), 0);

  return c.json({
    client_id: clientId,
    years: comparison.length,
    comparison,
    year_over_year: yoyChanges,
    aggregate: {
      total_income_all_years: Math.round(totalIncome * 100) / 100,
      total_tax_all_years: Math.round(totalTax * 100) / 100,
      total_refunds: Math.round(totalRefunds * 100) / 100,
      total_owed: Math.round(totalOwed * 100) / 100,
      net_position: Math.round((totalRefunds - totalOwed) * 100) / 100,
      avg_effective_rate: totalIncome > 0 ? Math.round((totalTax / totalIncome) * 10000) / 100 : 0,
      avg_income_per_year: Math.round((totalIncome / comparison.length) * 100) / 100,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// AUDIT RISK SCORING
// ═══════════════════════════════════════════════════════════════

features.get('/:id/audit-risk', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const [incomeResult, deductionResult, dependentResult] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>(),
    c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>(),
    c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>(),
  ]);

  const incomeItems = incomeResult.results;
  const deductions = deductionResult.results;
  const dependents = dependentResult.results;

  const riskFactors: Array<{ factor: string; score: number; detail: string; mitigation: string }> = [];
  let totalScore = 0;

  // 1. High income increases audit risk
  if (ret.total_income > 500000) {
    riskFactors.push({ factor: 'High Income', score: 25, detail: `Income $${ret.total_income.toLocaleString()} exceeds $500K threshold`, mitigation: 'Maintain thorough documentation of all income sources' });
    totalScore += 25;
  } else if (ret.total_income > 200000) {
    riskFactors.push({ factor: 'Above Average Income', score: 10, detail: `Income $${ret.total_income.toLocaleString()} exceeds $200K`, mitigation: 'Keep records organized' });
    totalScore += 10;
  }

  // 2. Schedule C (self-employment) without clear separation
  const businessIncome = incomeItems.filter(i => i.category === 'business');
  if (businessIncome.length > 0) {
    const totalBusiness = businessIncome.reduce((s, i) => s + i.amount, 0);
    riskFactors.push({ factor: 'Self-Employment Income', score: 15, detail: `Schedule C income of $${totalBusiness.toLocaleString()}`, mitigation: 'Keep separate business accounts, maintain receipts for all expenses' });
    totalScore += 15;

    // Business losses
    if (totalBusiness < 0) {
      riskFactors.push({ factor: 'Business Loss', score: 20, detail: 'Net business loss claimed — IRS scrutinizes hobby losses', mitigation: 'Document profit motive: business plan, advertising, time invested' });
      totalScore += 20;
    }
  }

  // 3. Large charitable deductions relative to income
  const charitable = deductions.filter(d => d.category === 'charitable').reduce((s, d) => s + d.amount, 0);
  if (charitable > 0 && ret.adjusted_gross_income > 0) {
    const charitablePct = charitable / ret.adjusted_gross_income;
    if (charitablePct > 0.10) {
      riskFactors.push({ factor: 'High Charitable Deductions', score: 15, detail: `Charitable: ${Math.round(charitablePct * 100)}% of AGI (avg is 3-5%)`, mitigation: 'Keep donation receipts, bank statements, written acknowledgments for gifts >$250' });
      totalScore += 15;
    }
  }

  // 4. Rental income with consistent losses
  const rentalIncome = incomeItems.filter(i => i.category === 'rental');
  if (rentalIncome.length > 0) {
    const totalRental = rentalIncome.reduce((s, i) => s + i.amount, 0);
    if (totalRental < 0) {
      riskFactors.push({ factor: 'Rental Losses', score: 12, detail: 'Net rental loss — subject to passive activity rules', mitigation: 'Document material participation (750+ hours), keep time logs' });
      totalScore += 12;
    }
  }

  // 5. Cash-heavy business (no W-2s but high income)
  const hasW2 = incomeItems.some(i => i.category === 'wages');
  const allCash = !hasW2 && businessIncome.length > 0;
  if (allCash) {
    riskFactors.push({ factor: 'Cash Business', score: 18, detail: 'All income from self-employment, no W-2', mitigation: 'Accept electronic payments when possible, maintain detailed income logs' });
    totalScore += 18;
  }

  // 6. EITC with dependents (high audit rate historically)
  const eitcEligible = dependents.some(d => d.qualifies_ctc);
  const earnedIncome = incomeItems.filter(i => ['wages', 'business'].includes(i.category)).reduce((s, i) => s + i.amount, 0);
  if (eitcEligible && earnedIncome > 0 && earnedIncome < 60000) {
    riskFactors.push({ factor: 'EITC with Dependents', score: 8, detail: 'EITC claims have historically higher audit rates', mitigation: 'Ensure qualifying child meets all tests: age, residency (6+ months), relationship' });
    totalScore += 8;
  }

  // 7. Round numbers (suggests estimation vs. exact records)
  const roundItems = incomeItems.filter(i => i.amount > 100 && i.amount % 100 === 0).length +
    deductions.filter(d => d.amount > 100 && d.amount % 100 === 0).length;
  if (roundItems > 3) {
    riskFactors.push({ factor: 'Many Round Numbers', score: 5, detail: `${roundItems} items are round numbers — suggests estimation`, mitigation: 'Use exact amounts from documents (W-2, 1099, receipts)' });
    totalScore += 5;
  }

  // 8. Missing/incomplete dependent info
  const incompleteDeps = dependents.filter(d => !d.dob || !d.first_name);
  if (incompleteDeps.length > 0) {
    riskFactors.push({ factor: 'Incomplete Dependent Info', score: 8, detail: `${incompleteDeps.length} dependent(s) missing DOB or name`, mitigation: 'Complete all dependent details including SSN and DOB' });
    totalScore += 8;
  }

  // 9. Late filing
  if (ret.status === 'filed' && ret.filed_at) {
    const dueDate = new Date(`${ret.tax_year + 1}-04-15`);
    const filedDate = new Date(ret.filed_at);
    if (filedDate > dueDate) {
      const daysLate = Math.ceil((filedDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      riskFactors.push({ factor: 'Late Filing', score: 5, detail: `Filed ${daysLate} days after due date`, mitigation: 'File on time or request extension (Form 4868)' });
      totalScore += 5;
    }
  }

  // Overall risk level
  let riskLevel: string;
  let riskColor: string;
  if (totalScore <= 15) { riskLevel = 'LOW'; riskColor = 'green'; }
  else if (totalScore <= 35) { riskLevel = 'MODERATE'; riskColor = 'yellow'; }
  else if (totalScore <= 55) { riskLevel = 'ELEVATED'; riskColor = 'orange'; }
  else { riskLevel = 'HIGH'; riskColor = 'red'; }

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    audit_risk: {
      score: totalScore,
      max_possible: 100,
      level: riskLevel,
      color: riskColor,
    },
    factors: riskFactors.sort((a, b) => b.score - a.score),
    recommendations: [
      'Keep all tax documents for at least 7 years',
      'Maintain organized records by category',
      'Document any unusual or large deductions thoroughly',
      'Consider professional preparation for complex returns',
    ],
  });
});

// ═══════════════════════════════════════════════════════════════
// AMENDMENT TRACKING (Form 1040-X)
// ═══════════════════════════════════════════════════════════════

features.post('/:id/amendments', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<{ reason: string; changes: Array<{ field: string; original: number; corrected: number; explanation: string }> }>();

  if (!body.reason || !body.changes || body.changes.length === 0) {
    return c.json({ error: 'reason and changes[] required' }, 400);
  }

  // Ensure table exists
  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS amendments (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      changes TEXT NOT NULL,
      original_refund_owed REAL,
      amended_refund_owed REAL,
      net_change REAL,
      status TEXT DEFAULT 'draft',
      filed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const netChange = body.changes.reduce((s, ch) => s + (ch.corrected - ch.original), 0);
  const id = generateId('amd');

  await c.env.DB.prepare(
    'INSERT INTO amendments (id, return_id, reason, changes, original_refund_owed, amended_refund_owed, net_change) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, returnId, body.reason, JSON.stringify(body.changes), ret.refund_or_owed, ret.refund_or_owed + netChange, netChange).run();

  return c.json({
    amendment_id: id,
    return_id: returnId,
    tax_year: ret.tax_year,
    reason: body.reason,
    changes: body.changes,
    original_result: ret.refund_or_owed,
    projected_result: ret.refund_or_owed + netChange,
    net_change: netChange,
    status: 'draft',
    note: 'File Form 1040-X within 3 years of original due date or 2 years of tax paid (whichever is later)',
  });
});

features.get('/:id/amendments', async (c) => {
  const returnId = c.req.param('id');
  try {
    const result = await c.env.DB.prepare('SELECT * FROM amendments WHERE return_id = ? ORDER BY created_at DESC').bind(returnId).all();
    return c.json({ return_id: returnId, amendments: result.results.map((r: any) => ({ ...r, changes: JSON.parse(r.changes || '[]') })) });
  } catch {
    return c.json({ return_id: returnId, amendments: [] });
  }
});

// ═══════════════════════════════════════════════════════════════
// WITHHOLDING ESTIMATOR (W-4 recommendation)
// ═══════════════════════════════════════════════════════════════

features.post('/:id/withholding-estimate', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const incomeItems = (await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>()).results;

  const wages = incomeItems.filter(i => i.category === 'wages').reduce((s, i) => s + i.amount, 0);
  const currentWithholding = incomeItems.reduce((s, i) => s + (i.tax_withheld || 0), 0);

  // Project next year based on this year
  const nextYear = ret.tax_year + 1;
  const targetTax = ret.total_tax; // assume similar income next year

  // Calculate ideal per-paycheck withholding
  const payPeriodsRemaining = 26; // assume biweekly
  const idealWithholding = targetTax;
  const perPaycheck = Math.round((idealWithholding / payPeriodsRemaining) * 100) / 100;
  const monthlyWithholding = Math.round((idealWithholding / 12) * 100) / 100;

  // W-4 recommendation
  let w4Action: string;
  let w4Detail: string;
  const diff = currentWithholding - targetTax;

  if (Math.abs(diff) < 200) {
    w4Action = 'NO CHANGE NEEDED';
    w4Detail = `Current withholding ($${currentWithholding.toLocaleString()}) is within $200 of projected tax ($${targetTax.toLocaleString()})`;
  } else if (diff > 0) {
    const extraPerPaycheck = Math.round((diff / payPeriodsRemaining) * 100) / 100;
    w4Action = 'REDUCE WITHHOLDING';
    w4Detail = `You overpaid by $${diff.toLocaleString()}. Reduce by ~$${extraPerPaycheck}/paycheck on W-4 Line 4(b) to get more in each check`;
  } else {
    const extraPerPaycheck = Math.round((Math.abs(diff) / payPeriodsRemaining) * 100) / 100;
    w4Action = 'INCREASE WITHHOLDING';
    w4Detail = `You underpaid by $${Math.abs(diff).toLocaleString()}. Add ~$${extraPerPaycheck}/paycheck on W-4 Line 4(c) to avoid owing next year`;
  }

  return c.json({
    return_id: returnId,
    based_on_year: ret.tax_year,
    projection_year: nextYear,
    current_withholding: currentWithholding,
    projected_tax: targetTax,
    difference: diff,
    w4_recommendation: {
      action: w4Action,
      detail: w4Detail,
      ideal_per_paycheck_biweekly: perPaycheck,
      ideal_monthly: monthlyWithholding,
      ideal_annual: idealWithholding,
    },
    safe_harbor: {
      note: 'To avoid underpayment penalty, withhold at least 100% of prior year tax (110% if AGI > $150K)',
      minimum_withholding: ret.adjusted_gross_income > 150000 ? Math.round(targetTax * 1.1) : targetTax,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// TAX PROJECTION / WHAT-IF SCENARIOS
// ═══════════════════════════════════════════════════════════════

features.post('/:id/what-if', async (c) => {
  const returnId = c.req.param('id');
  const scenarios = await c.req.json<{ scenarios: Array<{ name: string; income_change?: number; deduction_change?: number; filing_status_change?: FilingStatus }> }>();

  if (!scenarios.scenarios || scenarios.scenarios.length === 0) {
    return c.json({ error: 'scenarios[] required' }, 400);
  }

  // Calculate baseline
  const baseline = await calculateTaxReturn(c.env, returnId);
  const results: any[] = [];

  for (const scenario of scenarios.scenarios) {
    // Simple projection: adjust income/deductions linearly
    const adjIncome = baseline.income_summary.total + (scenario.income_change || 0);
    const adjDeductions = baseline.deductions.amount + (scenario.deduction_change || 0);
    const adjTaxable = Math.max(0, adjIncome - baseline.adjustments.total - adjDeductions - baseline.qbi_deduction);

    const status = scenario.filing_status_change || baseline.filing_status;
    const brackets = getTaxBrackets(baseline.tax_year, status);

    let projectedTax = 0;
    let remaining = adjTaxable;
    for (const bracket of brackets) {
      if (remaining <= 0) break;
      const w = bracket.max - bracket.min;
      const t = Math.min(remaining, w);
      projectedTax += t * bracket.rate;
      remaining -= t;
    }
    projectedTax = Math.round(projectedTax * 100) / 100;
    const projectedRefund = Math.round((baseline.payments.total - projectedTax) * 100) / 100;

    results.push({
      scenario: scenario.name,
      adjustments: {
        income_change: scenario.income_change || 0,
        deduction_change: scenario.deduction_change || 0,
        filing_status: status,
      },
      projected_taxable_income: adjTaxable,
      projected_tax: projectedTax,
      projected_refund_or_owed: projectedRefund,
      change_from_baseline: {
        tax_change: Math.round((projectedTax - baseline.total_tax) * 100) / 100,
        refund_change: Math.round((projectedRefund - baseline.refund_or_owed) * 100) / 100,
      },
    });
  }

  return c.json({
    return_id: returnId,
    tax_year: baseline.tax_year,
    baseline: {
      total_income: baseline.income_summary.total,
      taxable_income: baseline.taxable_income,
      total_tax: baseline.total_tax,
      refund_or_owed: baseline.refund_or_owed,
    },
    scenarios: results,
  });
});

// ═══════════════════════════════════════════════════════════════
// RETURN SUMMARY (comprehensive single-page view)
// ═══════════════════════════════════════════════════════════════

features.get('/:id/summary', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const [incomeResult, deductionResult, dependentResult, docsResult] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>(),
    c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>(),
    c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>(),
    c.env.DB.prepare('SELECT id, doc_type, issuer_name, status FROM documents WHERE return_id = ?').bind(returnId).all(),
  ]);

  const standardDed = getStandardDeduction(ret.tax_year, client.filing_status || 'single');
  const itemizedDed = deductionResult.results.reduce((s: number, d: any) => s + (d.amount || 0), 0);

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    status: ret.status,
    client: {
      name: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
      filing_status: client.filing_status,
      address: [client.address_street, client.address_city, client.address_state, client.address_zip].filter(Boolean).join(', '),
    },
    income: {
      total: ret.total_income,
      items_count: incomeResult.results.length,
      by_category: groupByCategory(incomeResult.results),
    },
    deductions: {
      standard: standardDed,
      itemized: itemizedDed,
      method: ret.deduction_method || (itemizedDed > standardDed ? 'itemized' : 'standard'),
      savings_vs_other: Math.abs(standardDed - itemizedDed),
      items_count: deductionResult.results.length,
    },
    dependents: {
      count: dependentResult.results.length,
      ctc_eligible: dependentResult.results.filter((d: any) => d.qualifies_ctc).length,
      list: dependentResult.results.map((d: any) => ({
        name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
        relationship: d.relationship,
        ctc: !!d.qualifies_ctc,
      })),
    },
    calculation: {
      agi: ret.adjusted_gross_income,
      taxable_income: ret.taxable_income,
      total_tax: ret.total_tax,
      total_payments: ret.total_payments,
      refund_or_owed: ret.refund_or_owed,
      result: ret.refund_or_owed >= 0 ? 'REFUND' : 'OWED',
    },
    documents: {
      count: docsResult.results.length,
      list: docsResult.results,
    },
    filed_at: ret.filed_at,
    updated_at: ret.updated_at,
  });
});

// ═══════════════════════════════════════════════════════════════
// SUPPORTED TAX YEARS
// ═══════════════════════════════════════════════════════════════

features.get('/supported-years', async (c) => {
  return c.json({
    supported_years: getSupportedYears(),
    efile_years: [2024, 2023, 2022],
    current_year: new Date().getFullYear(),
    note: 'E-file available for current year + 2 prior. Older years require paper filing.',
  });
});

// ═══════════════════════════════════════════════════════════════
// TAX DEADLINE CALENDAR
// ═══════════════════════════════════════════════════════════════

features.get('/tax-calendar', async (c) => {
  const year = Number(c.req.query('year') || new Date().getFullYear());
  const filingYear = year + 1; // deadlines for filing year X returns are in year X+1

  const deadlines = [
    { date: `${filingYear}-01-15`, event: `Q4 ${year} Estimated Tax Payment Due`, applies_to: 'self-employed' },
    { date: `${filingYear}-01-31`, event: `W-2s and 1099s Due to Taxpayers`, applies_to: 'all' },
    { date: `${filingYear}-02-15`, event: `Last Day to Claim Exempt from Withholding (W-4)`, applies_to: 'employees' },
    { date: `${filingYear}-03-15`, event: `S-Corp and Partnership Returns Due (Form 1120-S/1065)`, applies_to: 'business' },
    { date: `${filingYear}-04-15`, event: `Individual Tax Return Due (Form 1040)`, applies_to: 'all' },
    { date: `${filingYear}-04-15`, event: `Q1 ${filingYear} Estimated Tax Payment Due`, applies_to: 'self-employed' },
    { date: `${filingYear}-04-15`, event: `IRA/HSA Contribution Deadline for ${year}`, applies_to: 'all' },
    { date: `${filingYear}-06-15`, event: `Q2 ${filingYear} Estimated Tax Payment Due`, applies_to: 'self-employed' },
    { date: `${filingYear}-09-15`, event: `Q3 ${filingYear} Estimated Tax Payment Due`, applies_to: 'self-employed' },
    { date: `${filingYear}-09-15`, event: `Extended Partnership/S-Corp Returns Due`, applies_to: 'business' },
    { date: `${filingYear}-10-15`, event: `Extended Individual Returns Due (Form 1040)`, applies_to: 'all' },
  ];

  const now = new Date().toISOString().split('T')[0];
  const upcoming = deadlines.filter(d => d.date >= now).slice(0, 5);
  const nextDeadline = upcoming[0] || null;
  const daysUntilNext = nextDeadline ? Math.ceil((new Date(nextDeadline.date).getTime() - Date.now()) / 86400000) : null;

  return c.json({
    tax_year: year,
    filing_year: filingYear,
    all_deadlines: deadlines,
    upcoming: upcoming,
    next_deadline: nextDeadline,
    days_until_next: daysUntilNext,
    refund_deadlines: {
      note: 'You have 3 years from the original due date to claim a refund',
      earliest_claimable: year >= (new Date().getFullYear() - 3) ? `Refund still available` : `EXPIRED — past 3-year window`,
      expires: `${year + 4}-04-15`,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// TAX TIPS (context-aware based on return data)
// ═══════════════════════════════════════════════════════════════

features.get('/:id/tips', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const incomeItems = (await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>()).results;
  const deductions = (await c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>()).results;
  const dependents = (await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>()).results;

  const tips: Array<{ category: string; tip: string; potential_savings: string; priority: 'high' | 'medium' | 'low' }> = [];
  const filingStatus = client?.filing_status || 'single';
  const hasBusinessIncome = incomeItems.some(i => i.category === 'business');
  const totalIncome = ret.total_income;
  const wages = incomeItems.filter(i => i.category === 'wages').reduce((s, i) => s + i.amount, 0);

  // Retirement savings
  if (totalIncome > 30000 && !deductions.some(d => d.category === 'ira')) {
    const maxIRA = ret.tax_year >= 2024 ? 7000 : 6500;
    tips.push({ category: 'Retirement', tip: `Consider contributing to a Traditional IRA (up to $${maxIRA}) to reduce AGI`, potential_savings: `Up to $${Math.round(maxIRA * 0.22)}`, priority: 'high' });
  }

  // HSA
  if (!deductions.some(d => d.category === 'hsa')) {
    tips.push({ category: 'Healthcare', tip: 'If you have a high-deductible health plan, maximize HSA contributions for triple tax benefit', potential_savings: 'Up to $1,100', priority: 'medium' });
  }

  // Self-employment
  if (hasBusinessIncome) {
    const bizIncome = incomeItems.filter(i => i.category === 'business').reduce((s, i) => s + i.amount, 0);
    if (bizIncome > 50000) {
      tips.push({ category: 'Self-Employment', tip: 'Consider a SEP-IRA or Solo 401(k) to shelter up to 25% of net self-employment income', potential_savings: `Up to $${Math.round(Math.min(bizIncome * 0.25, 69000))}`, priority: 'high' });
    }
    tips.push({ category: 'Self-Employment', tip: 'Track home office expenses (simplified: $5/sqft up to 300 sqft = $1,500 deduction)', potential_savings: 'Up to $330', priority: 'medium' });
  }

  // Charitable
  if (!deductions.some(d => d.category === 'charitable') && totalIncome > 50000) {
    tips.push({ category: 'Charitable', tip: 'Donate appreciated stock instead of cash to avoid capital gains AND get a deduction', potential_savings: 'Varies', priority: 'medium' });
  }

  // Filing status
  if (filingStatus === 'single' && dependents.length > 0) {
    tips.push({ category: 'Filing Status', tip: 'You may qualify for Head of Household status, which has a larger standard deduction and lower tax brackets', potential_savings: 'Up to $2,000+', priority: 'high' });
  }

  // Education
  if (dependents.some(d => {
    if (!d.dob) return false;
    const age = new Date().getFullYear() - new Date(d.dob).getFullYear();
    return age >= 17 && age <= 24;
  })) {
    tips.push({ category: 'Education', tip: 'Claim American Opportunity Credit ($2,500/student) or Lifetime Learning Credit for college expenses', potential_savings: 'Up to $2,500', priority: 'high' });
  }

  // Energy credits
  tips.push({ category: 'Energy', tip: 'Solar panels, EVs, and energy-efficient home improvements qualify for substantial tax credits', potential_savings: 'Up to $7,500 (EV)', priority: 'low' });

  // Estimated payments
  if (ret.refund_or_owed < -1000) {
    tips.push({ category: 'Planning', tip: 'Consider making estimated quarterly payments to avoid underpayment penalty next year', potential_savings: 'Avoid penalty', priority: 'high' });
  }

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    tips_count: tips.length,
    tips: tips.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return p[a.priority] - p[b.priority];
    }),
  });
});

// ═══════════════════════════════════════════════════════════════
// UNDERPAYMENT PENALTY CALCULATOR (IRS Form 2210 simplified)
// ═══════════════════════════════════════════════════════════════

features.get('/:id/penalty-estimate', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const incomeItems = (await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>()).results;

  // Get prior year return for safe harbor calculation
  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const priorYearReturn = client
    ? await c.env.DB.prepare('SELECT * FROM returns WHERE client_id = ? AND tax_year = ?').bind(ret.client_id, ret.tax_year - 1).first<TaxReturn>()
    : null;

  const totalTax = ret.total_tax;
  const totalPayments = ret.total_payments;
  const priorYearTax = priorYearReturn?.total_tax || 0;
  const agi = ret.adjusted_gross_income || 0;

  // Safe harbor thresholds
  const safeHarbor90 = Math.round(totalTax * 0.9 * 100) / 100;
  const safeHarbor100 = priorYearTax;
  const safeHarbor110 = Math.round(priorYearTax * 1.1 * 100) / 100;
  const applicablePriorYearThreshold = agi > 150000 ? safeHarbor110 : safeHarbor100;

  // Determine if penalty applies
  const meetsCurrentYearSafeHarbor = totalPayments >= safeHarbor90;
  const meetsPriorYearSafeHarbor = priorYearTax > 0 && totalPayments >= applicablePriorYearThreshold;
  const owesLessThan1000 = (totalTax - totalPayments) < 1000;
  const penaltyApplies = !meetsCurrentYearSafeHarbor && !meetsPriorYearSafeHarbor && !owesLessThan1000;

  // Penalty rate: federal short-term rate + 3%
  let penaltyRate: number;
  if (ret.tax_year >= 2024) penaltyRate = 0.08;
  else if (ret.tax_year === 2023) penaltyRate = 0.07;
  else penaltyRate = 0.06;

  // Calculate underpayment amount and penalty
  const underpaymentAmount = Math.max(0, totalTax - totalPayments);
  // Simplified method: assume underpayment for full year (365 days) from April 15 due date
  const daysUnpaid = penaltyApplies ? 365 : 0;
  const penaltyAmount = penaltyApplies
    ? Math.round((underpaymentAmount * penaltyRate * daysUnpaid / 365) * 100) / 100
    : 0;

  // Required annual payment to avoid penalty next year
  const requiredToAvoidPenalty = Math.min(safeHarbor90, applicablePriorYearThreshold > 0 ? applicablePriorYearThreshold : safeHarbor90);
  const quarterlyPayment = Math.round((requiredToAvoidPenalty / 4) * 100) / 100;

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    total_tax: totalTax,
    total_payments: totalPayments,
    underpayment: underpaymentAmount,
    penalty_applies: penaltyApplies,
    estimated_penalty: penaltyAmount,
    penalty_rate: penaltyRate,
    days_unpaid: daysUnpaid,
    safe_harbor_analysis: {
      current_year_90pct: { threshold: safeHarbor90, met: meetsCurrentYearSafeHarbor },
      prior_year_100pct: { threshold: safeHarbor100, met: priorYearTax > 0 && totalPayments >= safeHarbor100, prior_year_tax: priorYearTax },
      prior_year_110pct: { threshold: safeHarbor110, applies: agi > 150000, met: priorYearTax > 0 && totalPayments >= safeHarbor110 },
      owes_less_than_1000: owesLessThan1000,
    },
    how_to_avoid: {
      note: 'Pay at least the LESSER of 90% of current year tax or 100% of prior year tax (110% if AGI > $150K)',
      required_annual_payment: requiredToAvoidPenalty,
      quarterly_payment: quarterlyPayment,
      quarterly_due_dates: [
        `${ret.tax_year + 1}-04-15`,
        `${ret.tax_year + 1}-06-15`,
        `${ret.tax_year + 1}-09-15`,
        `${ret.tax_year + 2}-01-15`,
      ],
    },
    form: 'IRS Form 2210 (Underpayment of Estimated Tax by Individuals)',
  });
});

// ═══════════════════════════════════════════════════════════════
// CLIENT NOTES / PREPARER MEMOS
// ═══════════════════════════════════════════════════════════════

features.post('/:id/notes', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<{ content: string; category?: string; author?: string; pinned?: boolean }>();

  if (!body.content) {
    return c.json({ error: 'content is required' }, 400);
  }

  const validCategories = ['general', 'income', 'deduction', 'review', 'filing', 'client_communication'];
  const category = validCategories.includes(body.category || '') ? body.category : 'general';

  // Ensure table exists
  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS preparer_notes (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      author TEXT,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  const id = generateId('note');
  await c.env.DB.prepare(
    'INSERT INTO preparer_notes (id, return_id, author, content, category, pinned) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, returnId, body.author || 'Preparer', body.content, category, body.pinned ? 1 : 0).run();

  return c.json({
    id,
    return_id: returnId,
    author: body.author || 'Preparer',
    content: body.content,
    category,
    pinned: !!body.pinned,
    created_at: new Date().toISOString(),
  });
});

features.get('/:id/notes', async (c) => {
  const returnId = c.req.param('id');
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM preparer_notes WHERE return_id = ? ORDER BY pinned DESC, created_at DESC'
    ).bind(returnId).all();

    return c.json({
      return_id: returnId,
      count: result.results.length,
      notes: result.results.map((n: any) => ({ ...n, pinned: !!n.pinned })),
    });
  } catch {
    return c.json({ return_id: returnId, count: 0, notes: [] });
  }
});

features.delete('/:id/notes/:noteId', async (c) => {
  const returnId = c.req.param('id');
  const noteId = c.req.param('noteId');
  await c.env.DB.prepare('DELETE FROM preparer_notes WHERE id = ? AND return_id = ?').bind(noteId, returnId).run();
  return c.json({ deleted: true });
});

// ═══════════════════════════════════════════════════════════════
// ENGAGEMENT LETTER GENERATOR
// ═══════════════════════════════════════════════════════════════

features.get('/:id/engagement-letter', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const incomeItems = (await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>()).results;
  const dependents = (await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>()).results;

  // Determine forms to be prepared
  const forms: string[] = ['Form 1040 (U.S. Individual Income Tax Return)'];
  const hasWages = incomeItems.some(i => i.category === 'wages');
  const hasBusiness = incomeItems.some(i => i.category === 'business');
  const hasRental = incomeItems.some(i => i.category === 'rental');
  const hasInvestment = incomeItems.some(i => ['capital_gains', 'dividends', 'interest'].includes(i.category));

  if (hasBusiness) forms.push('Schedule C (Profit or Loss From Business)');
  if (hasRental) forms.push('Schedule E (Supplemental Income and Loss)');
  if (hasInvestment) forms.push('Schedule D (Capital Gains and Losses)');
  if (incomeItems.some(i => i.category === 'capital_gains')) forms.push('Form 8949 (Sales and Dispositions of Capital Assets)');
  if (dependents.length > 0) forms.push('Schedule 8812 (Credits for Qualifying Children)');
  if (hasBusiness) forms.push('Schedule SE (Self-Employment Tax)');

  // Fee estimation based on complexity
  let baseFee = 200;
  if (hasBusiness) baseFee += 150;
  if (hasRental) baseFee += 100;
  if (hasInvestment) baseFee += 75;
  if (dependents.length > 2) baseFee += 50;
  if ((ret.total_income || 0) > 200000) baseFee += 100;

  const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
  const clientAddress = [client.address_street, client.address_city, client.address_state, client.address_zip].filter(Boolean).join(', ');
  const today = new Date().toISOString().split('T')[0];

  const letterText = [
    `ENGAGEMENT LETTER FOR TAX PREPARATION SERVICES`,
    ``,
    `Date: ${today}`,
    ``,
    `Preparer:`,
    `Bobby Don McWilliams II`,
    `PTIN: In Progress`,
    `Echo Prime Tax Services`,
    `Midland, TX`,
    ``,
    `Client:`,
    `${clientName}`,
    clientAddress ? `${clientAddress}` : '',
    ``,
    `Dear ${client.first_name || 'Client'},`,
    ``,
    `This letter confirms the terms of our engagement for tax preparation services.`,
    ``,
    `1. SCOPE OF SERVICES`,
    `We will prepare your federal individual income tax return for the tax year ${ret.tax_year}.`,
    `Forms to be prepared:`,
    ...forms.map(f => `  - ${f}`),
    ``,
    `2. FEES`,
    `Our fee for the preparation of the above returns is estimated at $${baseFee}.00.`,
    `This fee is based on the complexity of your return and the time required for preparation.`,
    `Additional fees may apply for amended returns, audit representation, or additional schedules.`,
    ``,
    `3. CLIENT RESPONSIBILITIES`,
    `You are responsible for providing complete and accurate information for the preparation of your return.`,
    `You are responsible for maintaining adequate records to support items reported on your tax return.`,
    `You must review the completed return and approve it before filing.`,
    ``,
    `4. PREPARER RESPONSIBILITIES`,
    `We will prepare your return based on the information you provide and applicable tax law.`,
    `We will exercise due diligence in the preparation of your return.`,
    `We will maintain the confidentiality of your tax information as required by law (IRC Section 7216).`,
    `We will e-file your return upon your approval, or prepare it for paper filing if preferred.`,
    ``,
    `5. IRS REPRESENTATION`,
    `This engagement does not include representation before the IRS in the event of an audit.`,
    `Audit representation services are available under a separate engagement.`,
    ``,
    `6. LIMITATIONS`,
    `Our work is not an audit or review of your financial statements.`,
    `We will not verify the accuracy of data you provide, though we may ask for clarification.`,
    `We are not responsible for disallowances of deductions or credits caused by incomplete information.`,
    ``,
    `7. CONFIDENTIALITY`,
    `All information provided will be kept strictly confidential and will not be disclosed to third parties`,
    `without your written consent, except as required by law.`,
    ``,
    `8. TERMS`,
    `This engagement begins upon your signature below and continues until the above services are complete.`,
    `Either party may terminate this engagement with written notice.`,
    ``,
    `Please sign and return a copy of this letter to indicate your acceptance of these terms.`,
    ``,
    `Sincerely,`,
    `Bobby Don McWilliams II`,
    `Echo Prime Tax Services`,
    ``,
    `___________________________________`,
    `Client Signature: ${clientName}`,
    `Date: _______________`,
  ].join('\n');

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    client_name: clientName,
    preparer: {
      name: 'Bobby Don McWilliams II',
      ptin: 'In Progress',
      firm: 'Echo Prime Tax Services',
      location: 'Midland, TX',
    },
    scope: {
      tax_year: ret.tax_year,
      forms,
    },
    fees: {
      estimated_total: baseFee,
      breakdown: {
        base: 200,
        schedule_c: hasBusiness ? 150 : 0,
        schedule_e: hasRental ? 100 : 0,
        investments: hasInvestment ? 75 : 0,
        dependents: dependents.length > 2 ? 50 : 0,
        high_income: (ret.total_income || 0) > 200000 ? 100 : 0,
      },
    },
    generated_date: today,
    text: letterText,
  });
});

// ═══════════════════════════════════════════════════════════════
// TAX DATA EXPORT (JSON or CSV)
// ═══════════════════════════════════════════════════════════════

features.get('/:id/export', async (c) => {
  const returnId = c.req.param('id');
  const format = c.req.query('format') || 'json';

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const [incomeResult, deductionResult, dependentResult, docsResult] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>(),
    c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>(),
    c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>(),
    c.env.DB.prepare('SELECT id, doc_type, issuer_name, status FROM documents WHERE return_id = ?').bind(returnId).all(),
  ]);

  const exportData = {
    return_summary: {
      return_id: ret.id,
      tax_year: ret.tax_year,
      status: ret.status,
      client_name: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
      filing_status: client.filing_status,
      total_income: ret.total_income,
      adjusted_gross_income: ret.adjusted_gross_income,
      taxable_income: ret.taxable_income,
      deduction_method: ret.deduction_method,
      total_tax: ret.total_tax,
      total_payments: ret.total_payments,
      refund_or_owed: ret.refund_or_owed,
      effective_rate: ret.total_income > 0 ? Math.round((ret.total_tax / ret.total_income) * 10000) / 100 : 0,
      filed_at: ret.filed_at,
      updated_at: ret.updated_at,
    },
    income_items: incomeResult.results.map(i => ({
      id: i.id,
      source: i.source,
      category: i.category,
      amount: i.amount,
      tax_withheld: i.tax_withheld,
      employer_ein: i.employer_ein,
    })),
    deduction_items: deductionResult.results.map((d: any) => ({
      id: d.id,
      description: d.description,
      category: d.category,
      amount: d.amount,
    })),
    dependent_list: dependentResult.results.map(d => ({
      name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
      relationship: d.relationship,
      dob: d.dob,
      ssn_last4: d.ssn ? `***-**-${d.ssn.slice(-4)}` : null,
      qualifies_ctc: !!d.qualifies_ctc,
    })),
    documents: docsResult.results,
  };

  if (format === 'csv') {
    // Build CSV text: return summary header + income rows + deduction rows + dependent rows
    const lines: string[] = [];

    lines.push('=== RETURN SUMMARY ===');
    lines.push('Field,Value');
    for (const [key, value] of Object.entries(exportData.return_summary)) {
      lines.push(`${key},"${value ?? ''}"`);
    }

    lines.push('');
    lines.push('=== INCOME ITEMS ===');
    lines.push('id,source,category,amount,tax_withheld,employer_ein');
    for (const item of exportData.income_items) {
      lines.push(`${item.id},"${item.source || ''}",${item.category},${item.amount},${item.tax_withheld || 0},"${item.employer_ein || ''}"`);
    }

    lines.push('');
    lines.push('=== DEDUCTION ITEMS ===');
    lines.push('id,description,category,amount');
    for (const item of exportData.deduction_items) {
      lines.push(`${item.id},"${item.description || ''}",${item.category},${item.amount}`);
    }

    lines.push('');
    lines.push('=== DEPENDENTS ===');
    lines.push('name,relationship,dob,ssn_last4,qualifies_ctc');
    for (const dep of exportData.dependent_list) {
      lines.push(`"${dep.name}","${dep.relationship || ''}",${dep.dob || ''},${dep.ssn_last4 || ''},${dep.qualifies_ctc}`);
    }

    const csvText = lines.join('\n');
    return c.text(csvText, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="tax_return_${ret.tax_year}_${returnId}.csv"` });
  }

  return c.json(exportData);
});

// ═══════════════════════════════════════════════════════════════
// INCOME PROJECTOR (multi-year forward projection)
// ═══════════════════════════════════════════════════════════════

features.post('/:id/project', async (c) => {
  const returnId = c.req.param('id');
  const body = await c.req.json<{ years_ahead?: number; annual_raise_pct?: number; inflation_pct?: number }>();

  const yearsAhead = Math.min(Math.max(body.years_ahead || 3, 1), 5);
  const annualRaisePct = body.annual_raise_pct ?? 3;
  const inflationPct = body.inflation_pct ?? 2;

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const filingStatus: FilingStatus = (client?.filing_status as FilingStatus) || 'single';

  const baseIncome = ret.total_income;
  const baseDeduction = ret.deduction_method === 'itemized'
    ? (ret.total_income - (ret.adjusted_gross_income || ret.total_income) + (ret.taxable_income || 0) > 0 ? ret.total_income - (ret.taxable_income || 0) : getStandardDeduction(ret.tax_year, filingStatus))
    : getStandardDeduction(ret.tax_year, filingStatus);
  const basePayments = ret.total_payments;

  const projections: Array<{
    year: number;
    projected_income: number;
    projected_deduction: number;
    projected_taxable_income: number;
    projected_tax: number;
    projected_effective_rate: number;
    projected_payments: number;
    projected_refund_or_owed: number;
    income_growth_from_base: number;
  }> = [];

  for (let i = 1; i <= yearsAhead; i++) {
    const projectedYear = ret.tax_year + i;
    const incomeMultiplier = Math.pow(1 + annualRaisePct / 100, i);
    const inflationMultiplier = Math.pow(1 + inflationPct / 100, i);

    const projectedIncome = Math.round(baseIncome * incomeMultiplier * 100) / 100;
    const projectedDeduction = Math.round(baseDeduction * inflationMultiplier * 100) / 100;
    const projectedTaxable = Math.max(0, projectedIncome - projectedDeduction);
    const projectedPayments = Math.round(basePayments * incomeMultiplier * 100) / 100;

    // Get brackets for base year and adjust for inflation
    const baseBrackets = getTaxBrackets(ret.tax_year, filingStatus);
    let projectedTax = 0;
    let remaining = projectedTaxable;

    for (const bracket of baseBrackets) {
      if (remaining <= 0) break;
      const inflatedMin = Math.round(bracket.min * inflationMultiplier);
      const inflatedMax = Math.round(bracket.max * inflationMultiplier);
      const width = inflatedMax - inflatedMin;
      const taxable = Math.min(remaining, width);
      projectedTax += taxable * bracket.rate;
      remaining -= taxable;
    }
    projectedTax = Math.round(projectedTax * 100) / 100;

    const effectiveRate = projectedIncome > 0 ? Math.round((projectedTax / projectedIncome) * 10000) / 100 : 0;

    projections.push({
      year: projectedYear,
      projected_income: projectedIncome,
      projected_deduction: projectedDeduction,
      projected_taxable_income: Math.round(projectedTaxable * 100) / 100,
      projected_tax: projectedTax,
      projected_effective_rate: effectiveRate,
      projected_payments: projectedPayments,
      projected_refund_or_owed: Math.round((projectedPayments - projectedTax) * 100) / 100,
      income_growth_from_base: Math.round((projectedIncome - baseIncome) * 100) / 100,
    });
  }

  return c.json({
    return_id: returnId,
    base_year: ret.tax_year,
    base_income: baseIncome,
    base_tax: ret.total_tax,
    base_effective_rate: baseIncome > 0 ? Math.round((ret.total_tax / baseIncome) * 10000) / 100 : 0,
    assumptions: {
      annual_raise_pct: annualRaisePct,
      inflation_pct: inflationPct,
      years_projected: yearsAhead,
      filing_status: filingStatus,
    },
    projections,
    summary: {
      total_projected_tax: Math.round(projections.reduce((s, p) => s + p.projected_tax, 0) * 100) / 100,
      avg_effective_rate: Math.round(projections.reduce((s, p) => s + p.projected_effective_rate, 0) / projections.length * 100) / 100,
      final_year_income: projections[projections.length - 1]?.projected_income || 0,
      total_income_growth: projections[projections.length - 1]?.income_growth_from_base || 0,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// RETURN DUPLICATION (copy return for new year)
// ═══════════════════════════════════════════════════════════════

features.post('/:id/duplicate', async (c) => {
  const sourceId = c.req.param('id');
  const body = await c.req.json<{ target_year?: number }>().catch(() => ({}));

  const source = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(sourceId).first<TaxReturn>();
  if (!source) return c.json({ error: 'Source return not found' }, 404);

  const targetYear = body.target_year || source.tax_year + 1;

  // Check if target already exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM returns WHERE client_id = ? AND tax_year = ?'
  ).bind(source.client_id, targetYear).first();
  if (existing) return c.json({ error: `Return for ${targetYear} already exists`, existing_id: (existing as any).id }, 409);

  const newId = generateId('ret');
  await c.env.DB.prepare(`
    INSERT INTO returns (id, client_id, tax_year, status, deduction_method, preparer_ptin)
    VALUES (?, ?, ?, 'intake', ?, ?)
  `).bind(newId, source.client_id, targetYear, source.deduction_method, source.preparer_ptin).run();

  // Copy income items
  const incomeItems = (await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(sourceId).all()).results;
  for (const item of incomeItems) {
    const i = item as any;
    await c.env.DB.prepare(
      'INSERT INTO income_items (id, return_id, document_id, category, description, amount, tax_withheld, form_line) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)'
    ).bind(generateId('inc'), newId, i.category, i.description, i.amount, i.tax_withheld || 0, i.form_line).run();
  }

  // Copy deductions
  const deductions = (await c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(sourceId).all()).results;
  for (const d of deductions) {
    const ded = d as any;
    await c.env.DB.prepare(
      'INSERT INTO deductions (id, return_id, category, description, amount, schedule, form_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(generateId('ded'), newId, ded.category, ded.description, ded.amount, ded.schedule, ded.form_line).run();
  }

  // Copy dependents
  const dependents = (await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(sourceId).all()).results;
  for (const dep of dependents) {
    const d = dep as any;
    await c.env.DB.prepare(
      'INSERT INTO dependents (id, return_id, first_name, last_name, ssn_encrypted, dob, relationship, months_lived, qualifies_ctc, qualifies_odc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(generateId('dep'), newId, d.first_name, d.last_name, d.ssn_encrypted, d.dob, d.relationship, d.months_lived, d.qualifies_ctc, d.qualifies_odc).run();
  }

  return c.json({
    new_return_id: newId,
    source_return_id: sourceId,
    target_year: targetYear,
    copied: {
      income_items: incomeItems.length,
      deductions: deductions.length,
      dependents: dependents.length,
    },
    message: `Return duplicated from ${source.tax_year} to ${targetYear}. Run /calculate to compute taxes.`,
  });
});

// ═══════════════════════════════════════════════════════════════
// CLIENT ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════

features.get('/activity/:clientId', async (c) => {
  const clientId = c.req.param('clientId');

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const [returns, documents, payments] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, tax_year, status, total_income, refund_or_owed, filed_at, created_at, updated_at FROM returns WHERE client_id = ? ORDER BY tax_year DESC'
    ).bind(clientId).all(),
    c.env.DB.prepare(`
      SELECT d.id, d.doc_type, d.issuer_name, d.status, d.created_at, r.tax_year
      FROM documents d JOIN returns r ON d.return_id = r.id
      WHERE r.client_id = ? ORDER BY d.created_at DESC LIMIT 50
    `).bind(clientId).all(),
    c.env.DB.prepare(
      'SELECT id, amount, status, created_at FROM payments WHERE client_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(clientId).all(),
  ]);

  // Build unified activity timeline
  const activities: Array<{ timestamp: string; type: string; description: string; details?: any }> = [];

  activities.push({
    timestamp: client.created_at,
    type: 'client_created',
    description: `Client profile created for ${client.first_name} ${client.last_name}`,
  });

  for (const r of returns.results) {
    const ret = r as any;
    activities.push({
      timestamp: ret.created_at,
      type: 'return_created',
      description: `Tax return created for ${ret.tax_year}`,
      details: { return_id: ret.id, tax_year: ret.tax_year },
    });
    if (ret.filed_at) {
      activities.push({
        timestamp: ret.filed_at,
        type: 'return_filed',
        description: `${ret.tax_year} return filed — ${ret.refund_or_owed >= 0 ? 'Refund' : 'Owed'}: $${Math.abs(ret.refund_or_owed).toLocaleString()}`,
        details: { return_id: ret.id, tax_year: ret.tax_year, refund_or_owed: ret.refund_or_owed },
      });
    }
  }

  for (const d of documents.results) {
    const doc = d as any;
    activities.push({
      timestamp: doc.created_at,
      type: 'document_uploaded',
      description: `${doc.doc_type.toUpperCase()} uploaded${doc.issuer_name ? ` from ${doc.issuer_name}` : ''} for ${doc.tax_year}`,
      details: { document_id: doc.id, doc_type: doc.doc_type },
    });
  }

  for (const p of payments.results) {
    const pay = p as any;
    activities.push({
      timestamp: pay.created_at,
      type: 'payment',
      description: `Payment of $${pay.amount} — ${pay.status}`,
      details: { payment_id: pay.id, amount: pay.amount, status: pay.status },
    });
  }

  // Sort by timestamp descending
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return c.json({
    client_id: clientId,
    client_name: `${client.first_name} ${client.last_name}`,
    total_activities: activities.length,
    returns_count: returns.results.length,
    documents_count: documents.results.length,
    payments_count: payments.results.length,
    activities,
  });
});

// ═══════════════════════════════════════════════════════════════
// TAX LAW QUICK REFERENCE
// ═══════════════════════════════════════════════════════════════

features.get('/tax-reference/:topic', async (c) => {
  const topic = c.req.param('topic').toLowerCase();

  const references: Record<string, any> = {
    'filing-status': {
      title: 'Filing Status Rules',
      irc_section: 'IRC Section 1, 2, 7703',
      statuses: [
        { status: 'single', description: 'Unmarried or legally separated on Dec 31', standard_deduction_2024: 14600 },
        { status: 'married_joint', description: 'Married and filing together', standard_deduction_2024: 29200 },
        { status: 'married_separate', description: 'Married filing separately', standard_deduction_2024: 14600 },
        { status: 'head_of_household', description: 'Unmarried with qualifying dependent', standard_deduction_2024: 21900 },
        { status: 'qualifying_widow', description: 'Spouse died within last 2 years, qualifying child', standard_deduction_2024: 29200 },
      ],
    },
    'standard-deduction': {
      title: 'Standard Deduction Amounts',
      irc_section: 'IRC Section 63(c)',
      by_year: {
        2024: { single: 14600, married_joint: 29200, married_separate: 14600, head_of_household: 21900 },
        2023: { single: 13850, married_joint: 27700, married_separate: 13850, head_of_household: 20800 },
        2022: { single: 12950, married_joint: 25900, married_separate: 12950, head_of_household: 19400 },
        2021: { single: 12550, married_joint: 25100, married_separate: 12550, head_of_household: 18800 },
        2020: { single: 12400, married_joint: 24800, married_separate: 12400, head_of_household: 18650 },
        2019: { single: 12200, married_joint: 24400, married_separate: 12200, head_of_household: 18350 },
      },
      additional_65_blind: { single: 1950, married: 1550 },
    },
    'brackets': {
      title: '2024 Federal Income Tax Brackets',
      irc_section: 'IRC Section 1(a)-(d)',
      brackets_2024_single: [
        { rate: 0.10, min: 0, max: 11600 },
        { rate: 0.12, min: 11600, max: 47150 },
        { rate: 0.22, min: 47150, max: 100525 },
        { rate: 0.24, min: 100525, max: 191950 },
        { rate: 0.32, min: 191950, max: 243725 },
        { rate: 0.35, min: 243725, max: 609350 },
        { rate: 0.37, min: 609350, max: Infinity },
      ],
    },
    'child-tax-credit': {
      title: 'Child Tax Credit',
      irc_section: 'IRC Section 24',
      credit_per_child: 2000,
      refundable_portion: 1700,
      age_limit: 'Under 17 at end of tax year',
      income_phase_out: { single: 200000, married_joint: 400000 },
      phase_out_rate: '$50 reduction per $1,000 over threshold',
      requirements: ['U.S. citizen, national, or resident alien', 'SSN required', 'Claimed as dependent', 'Lived with taxpayer >6 months'],
    },
    'eitc': {
      title: 'Earned Income Tax Credit',
      irc_section: 'IRC Section 32',
      max_credit_2024: { no_children: 632, one_child: 3995, two_children: 6604, three_plus: 7430 },
      income_limits_2024_single: { no_children: 18591, one_child: 46560, two_children: 52918, three_plus: 56838 },
      investment_income_limit: 11600,
      requirements: ['Must have earned income', 'Must be U.S. citizen/resident for full year', 'Filing status cannot be married_separate', 'Must meet AGI limits'],
    },
    'se-tax': {
      title: 'Self-Employment Tax',
      irc_section: 'IRC Section 1401, 1402',
      rate: 0.153,
      social_security_rate: 0.124,
      medicare_rate: 0.029,
      social_security_wage_base_2024: 168600,
      additional_medicare_threshold: { single: 200000, married_joint: 250000 },
      additional_medicare_rate: 0.009,
      deduction: '50% of SE tax is deductible on 1040 Schedule 1',
    },
    'estimated-payments': {
      title: 'Estimated Tax Payments',
      irc_section: 'IRC Section 6654',
      due_dates: ['April 15 (Q1)', 'June 15 (Q2)', 'September 15 (Q3)', 'January 15 (Q4)'],
      safe_harbor: {
        general: 'Pay 100% of prior year tax OR 90% of current year tax',
        high_income: 'If AGI > $150K ($75K MFS): pay 110% of prior year tax',
        penalty_rate: '8% (2024), varies by federal short-term rate + 3%',
      },
      form: 'Form 1040-ES',
    },
    'qbi': {
      title: 'Qualified Business Income Deduction',
      irc_section: 'IRC Section 199A',
      deduction_rate: 0.20,
      income_thresholds_2024: { single: 191950, married_joint: 383900 },
      phase_out_range: { single: 'to $241,950', married_joint: 'to $483,900' },
      sstb_limitation: 'Specified service trades/businesses (law, health, consulting, athletics, financial, brokerage) phased out above thresholds',
      w2_limitation: 'Greater of: 50% of W-2 wages OR 25% of W-2 wages + 2.5% of UBIA of qualified property',
    },
    'oil-gas': {
      title: 'Oil & Gas Tax Provisions',
      irc_sections: ['IRC 263(c) — IDC', 'IRC 611-613A — Depletion', 'IRC 469 — Passive Activity'],
      intangible_drilling_costs: {
        description: 'Costs for drilling that have no salvage value',
        treatment: 'Elect to deduct in full in year incurred (70%) or capitalize/amortize over 60 months (30%)',
        amt_preference: 'Excess IDC over 10-year amortization is AMT preference item',
      },
      depletion: {
        percentage: 'Small producers: 15% of gross income (up to 100% of net income, 65% of taxable income)',
        cost: 'Basis / estimated recoverable units * units sold',
        rule: 'Take greater of percentage or cost depletion',
      },
      passive_activity: {
        working_interest: 'Not subject to passive loss rules if held directly (not through LP)',
        royalty_interest: 'Passive income — subject to passive activity rules',
      },
    },
  };

  if (references[topic]) {
    return c.json({ topic, ...references[topic] });
  }

  return c.json({
    error: 'Topic not found',
    available_topics: Object.keys(references),
    hint: 'Use GET /returns/tax-reference/{topic} with one of the available topics',
  }, 404);
});

// ═══════════════════════════════════════════════════════════════
// RETURN HEALTH CHECK (comprehensive validation)
// ═══════════════════════════════════════════════════════════════

features.get('/:id/health', async (c) => {
  const returnId = c.req.param('id');

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const [incomeResult, deductionResult, dependentResult, docsResult] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all(),
    c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all(),
    c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all(),
    c.env.DB.prepare('SELECT * FROM documents WHERE return_id = ?').bind(returnId).all(),
  ]);

  const issues: Array<{ severity: 'error' | 'warning' | 'info'; field: string; message: string }> = [];

  // Client validation
  if (!client) {
    issues.push({ severity: 'error', field: 'client', message: 'Client record not found' });
  } else {
    if (!client.filing_status) issues.push({ severity: 'error', field: 'filing_status', message: 'Filing status not set' });
    if (!client.ssn_encrypted) issues.push({ severity: 'error', field: 'ssn', message: 'Social Security Number not provided' });
    if (!client.address_street) issues.push({ severity: 'warning', field: 'address', message: 'Mailing address incomplete' });
    if (!client.dob) issues.push({ severity: 'info', field: 'dob', message: 'Date of birth not set (needed for age-based deductions)' });
    if (!client.phone) issues.push({ severity: 'info', field: 'phone', message: 'Phone number not provided' });
    if (!client.email) issues.push({ severity: 'info', field: 'email', message: 'Email not provided' });
  }

  // Income validation
  if (incomeResult.results.length === 0) {
    issues.push({ severity: 'error', field: 'income', message: 'No income items entered' });
  } else {
    const totalIncome = incomeResult.results.reduce((s: number, i: any) => s + (i.amount || 0), 0);
    if (totalIncome <= 0) issues.push({ severity: 'error', field: 'income', message: 'Total income is zero or negative' });
    const hasWages = incomeResult.results.some((i: any) => i.category === 'wages');
    const hasWithholding = incomeResult.results.some((i: any) => (i.tax_withheld || 0) > 0);
    if (hasWages && !hasWithholding) issues.push({ severity: 'warning', field: 'withholding', message: 'W-2 wages but no tax withheld reported' });
  }

  // Return calculation check
  if (ret.total_tax === 0 && ret.total_income === 0) {
    issues.push({ severity: 'warning', field: 'calculation', message: 'Return has not been calculated yet' });
  }

  // Document check
  const wageItems = incomeResult.results.filter((i: any) => i.category === 'wages');
  const w2Docs = docsResult.results.filter((d: any) => d.doc_type === 'w2');
  if (wageItems.length > 0 && w2Docs.length === 0) {
    issues.push({ severity: 'warning', field: 'documents', message: 'Wage income entered but no W-2 documents uploaded' });
  }

  // Status check
  if (ret.status === 'intake' && incomeResult.results.length > 0) {
    issues.push({ severity: 'info', field: 'status', message: 'Return still in intake status — advance to documents or calculating' });
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    status: ret.status,
    health: errorCount === 0 ? (warningCount === 0 ? 'GOOD' : 'FAIR') : 'NEEDS_ATTENTION',
    score: Math.max(0, 100 - (errorCount * 20) - (warningCount * 10)),
    counts: {
      errors: errorCount,
      warnings: warningCount,
      info: issues.filter(i => i.severity === 'info').length,
      income_items: incomeResult.results.length,
      deductions: deductionResult.results.length,
      dependents: dependentResult.results.length,
      documents: docsResult.results.length,
    },
    issues,
  });
});

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function groupByCategory(items: any[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const item of items) {
    const cat = item.category || 'other';
    groups[cat] = (groups[cat] || 0) + (item.amount || 0);
  }
  return groups;
}

export default features;
