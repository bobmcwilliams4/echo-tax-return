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
