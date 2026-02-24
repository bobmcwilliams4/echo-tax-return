// Echo Tax Return — Advanced Features v3.5
// SE Tax, Safe Harbor, Print Package, Communications, Key Numbers
import { Hono } from 'hono';
import type { Env, TaxReturn, Client, IncomeItem, Deduction, Dependent } from './types';
import { isCommander, generateId } from './auth';
import { getTaxBrackets, getStandardDeduction, getSSWageBase, getCTCParams } from './tax-data';

const advanced = new Hono<{ Bindings: Env }>();

// ═══════════════════════════════════════════════════════════════
// STATIC ROUTES FIRST (must come before /:id routes)
// ═══════════════════════════════════════════════════════════════

// ─── Key Numbers Reference (2019-2025) ─────────────────────────
advanced.get('/key-numbers/:year', async (c) => {
  const year = parseInt(c.req.param('year'));
  if (isNaN(year) || year < 2019 || year > 2025) {
    return c.json({ error: 'Valid year required (2019-2025)' }, 400);
  }

  const stdDed = getStandardDeduction(year as any);
  const ssBase = getSSWageBase(year as any);
  const ctcParams = getCTCParams(year as any);
  const brackets = getTaxBrackets(year as any, 'single');
  const mfjBrackets = getTaxBrackets(year as any, 'married_joint');

  return c.json({
    tax_year: year,
    standard_deduction: {
      single: stdDed.single,
      married_joint: stdDed.married_joint,
      married_separate: stdDed.married_separate,
      head_of_household: stdDed.head_of_household,
      additional_65_or_blind_single: year >= 2024 ? 1950 : 1850,
      additional_65_or_blind_married: year >= 2024 ? 1550 : 1500,
    },
    social_security: {
      wage_base: ssBase,
      tax_rate_employee: 6.2,
      tax_rate_employer: 6.2,
      medicare_rate: 1.45,
      additional_medicare_threshold: 200000,
      additional_medicare_rate: 0.9,
    },
    child_tax_credit: {
      max_credit_per_child: ctcParams.maxCredit,
      phase_out_start_single: ctcParams.phaseOutSingle,
      phase_out_start_mfj: ctcParams.phaseOutMFJ,
      qualifying_age: 'Under 17',
    },
    income_tax_brackets: {
      single: brackets.map(b => ({ rate: `${b.rate * 100}%`, up_to: b.max === Infinity ? 'No limit' : b.max })),
      married_joint: mfjBrackets.map(b => ({ rate: `${b.rate * 100}%`, up_to: b.max === Infinity ? 'No limit' : b.max })),
    },
    contribution_limits: {
      '401k': year >= 2025 ? 23500 : year >= 2024 ? 23000 : year >= 2023 ? 22500 : 20500,
      '401k_catch_up_50plus': 7500,
      ira: year >= 2024 ? 7000 : 6500,
      ira_catch_up_50plus: 1000,
      hsa_self: year >= 2025 ? 4300 : year >= 2024 ? 4150 : 3850,
      hsa_family: year >= 2025 ? 8550 : year >= 2024 ? 8300 : 7750,
      hsa_catch_up_55plus: 1000,
      sep_ira: year >= 2025 ? 70000 : year >= 2024 ? 69000 : 66000,
    },
    gift_and_estate: {
      annual_gift_exclusion: year >= 2025 ? 19000 : year >= 2024 ? 18000 : 17000,
      lifetime_estate_exemption: year >= 2025 ? 13990000 : year >= 2024 ? 13610000 : 12920000,
    },
    eitc: {
      max_credit_no_children: year >= 2024 ? 632 : 600,
      max_credit_1_child: year >= 2024 ? 4213 : 3995,
      max_credit_2_children: year >= 2024 ? 6960 : 6604,
      max_credit_3plus_children: year >= 2024 ? 7830 : 7430,
    },
    mileage_rates: {
      business: year >= 2025 ? 0.70 : year >= 2024 ? 0.67 : 0.655,
      medical_moving: year >= 2024 ? 0.21 : 0.22,
      charitable: 0.14,
    },
    foreign_earned_income_exclusion: year >= 2025 ? 130000 : year >= 2024 ? 126500 : 120000,
    section_179_limit: year >= 2025 ? 1250000 : year >= 2024 ? 1220000 : 1160000,
    kiddie_tax_threshold: year >= 2024 ? 2600 : 2500,
    nanny_tax_threshold: year >= 2024 ? 2700 : 2600,
  });
});

// ─── Client Communication Log ──────────────────────────────────
advanced.post('/communications', async (c) => {
  const body = await c.req.json<{ client_id: string; return_id?: string; type: string; subject: string; content: string; direction: string }>();
  if (!body.client_id || !body.subject || !body.content) {
    return c.json({ error: 'client_id, subject, and content required' }, 400);
  }

  await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS communications (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, return_id TEXT,
    type TEXT DEFAULT 'note', direction TEXT DEFAULT 'outbound',
    subject TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  const id = 'comm_' + generateId();
  await c.env.DB.prepare(
    'INSERT INTO communications (id, client_id, return_id, type, direction, subject, content) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.client_id, body.return_id || null, body.type || 'note', body.direction || 'outbound', body.subject, body.content).run();

  return c.json({ id, message: 'Communication logged' }, 201);
});

advanced.get('/communications/:clientId', async (c) => {
  const clientId = c.req.param('clientId');
  await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS communications (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, return_id TEXT,
    type TEXT DEFAULT 'note', direction TEXT DEFAULT 'outbound',
    subject TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  const result = await c.env.DB.prepare(
    'SELECT * FROM communications WHERE client_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(clientId).all();

  return c.json({ client_id: clientId, count: result.results.length, communications: result.results });
});

// ═══════════════════════════════════════════════════════════════
// /:id ROUTES (must come after static routes)
// ═══════════════════════════════════════════════════════════════

// ─── Self-Employment Tax Calculator (Schedule SE) ──────────────
advanced.get('/:id/se-tax', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const incomeResult = await c.env.DB.prepare(
    'SELECT * FROM income_items WHERE return_id = ? AND category IN (?, ?, ?)'
  ).bind(returnId, 'business', 'self_employment', 'freelance').all<IncomeItem>();

  const deductionResult = await c.env.DB.prepare(
    'SELECT * FROM deductions WHERE return_id = ? AND schedule = ?'
  ).bind(returnId, 'C').all<Deduction>();

  const grossSEIncome = incomeResult.results.reduce((s, i) => s + i.amount, 0);
  const businessDeductions = deductionResult.results.reduce((s, d) => s + d.amount, 0);
  const netSEIncome = grossSEIncome - businessDeductions;

  const seBase = netSEIncome * 0.9235;
  const ssWageBase = getSSWageBase(ret.tax_year);
  const ssTaxable = Math.min(seBase, ssWageBase);
  const ssTax = ssTaxable * 0.124;
  const medicareTax = seBase * 0.029;
  const additionalMedicare = seBase > 200000 ? (seBase - 200000) * 0.009 : 0;
  const totalSETax = Math.round((ssTax + medicareTax + additionalMedicare) * 100) / 100;
  const seDeduction = Math.round(totalSETax * 50) / 100;
  const quarterlyPayment = Math.round((totalSETax + (netSEIncome * 0.22)) / 4 * 100) / 100;

  const retirementOptions = [];
  if (netSEIncome > 0) {
    const sepMax = Math.min(Math.round(netSEIncome * 0.25 * 100) / 100, 69000);
    const solo401kEmployee = Math.min(netSEIncome, 23000);
    const solo401kEmployer = Math.min(Math.round(netSEIncome * 0.25 * 100) / 100, 69000 - solo401kEmployee);
    const solo401kTotal = solo401kEmployee + solo401kEmployer;
    const simpleMax = Math.min(netSEIncome, 16000);

    retirementOptions.push(
      { plan: 'SEP-IRA', max_contribution: sepMax, tax_savings: Math.round(sepMax * 0.22 * 100) / 100, note: 'Easy setup, employer contributions only. Catch-up: +$7,500 if 50+' },
      { plan: 'Solo 401(k)', max_contribution: Math.min(solo401kTotal, 69000), tax_savings: Math.round(Math.min(solo401kTotal, 69000) * 0.22 * 100) / 100, note: 'Highest limits, employee+employer. Catch-up: +$7,500 if 50+' },
      { plan: 'SIMPLE IRA', max_contribution: simpleMax, tax_savings: Math.round(simpleMax * 0.22 * 100) / 100, note: 'Lower limits, simpler administration' }
    );
  }

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    self_employment: {
      gross_se_income: grossSEIncome,
      business_deductions: businessDeductions,
      net_se_income: netSEIncome,
      se_base: Math.round(seBase * 100) / 100,
    },
    se_tax_breakdown: {
      social_security_taxable: Math.round(ssTaxable * 100) / 100,
      social_security_tax: Math.round(ssTax * 100) / 100,
      medicare_tax: Math.round(medicareTax * 100) / 100,
      additional_medicare_tax: Math.round(additionalMedicare * 100) / 100,
      total_se_tax: totalSETax,
      se_deduction: seDeduction,
    },
    quarterly_estimated: {
      recommended_payment: quarterlyPayment,
      q1_due: `${ret.tax_year + 1}-04-15`,
      q2_due: `${ret.tax_year + 1}-06-15`,
      q3_due: `${ret.tax_year + 1}-09-15`,
      q4_due: `${ret.tax_year + 2}-01-15`,
    },
    retirement_plans: retirementOptions,
    optimization_tips: [
      netSEIncome > 50000 ? 'Consider a Solo 401(k) for maximum tax deferral' : null,
      netSEIncome > 0 ? 'Deduct 50% of SE tax on Form 1040 Line 15' : null,
      grossSEIncome > 400 ? 'Must file Schedule SE if net SE income exceeds $400' : null,
      netSEIncome > 200000 ? 'Additional Medicare Tax of 0.9% applies above $200,000' : null,
      businessDeductions === 0 ? 'Review Schedule C deductions — home office, vehicle, supplies, insurance' : null,
    ].filter(Boolean),
  });
});

// ─── Safe Harbor Analysis (underpayment penalty avoidance) ─────
advanced.get('/:id/safe-harbor', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const priorYear = await c.env.DB.prepare(
    'SELECT * FROM returns WHERE client_id = ? AND tax_year = ? LIMIT 1'
  ).bind(ret.client_id, ret.tax_year - 1).first<TaxReturn>();

  const currentTax = ret.total_tax || 0;
  const currentPayments = ret.total_payments || 0;
  const priorYearTax = priorYear?.total_tax || 0;
  const agi = ret.adjusted_gross_income || 0;

  const safeHarbor90 = Math.round(currentTax * 0.9 * 100) / 100;
  const safeHarbor100 = Math.round(priorYearTax * 100) / 100;
  const safeHarbor110 = Math.round(priorYearTax * 1.1 * 100) / 100;
  const highIncome = agi > 150000;
  const requiredPayment = highIncome ? Math.min(safeHarbor90, safeHarbor110) : Math.min(safeHarbor90, safeHarbor100);
  const meetsHarbor = currentPayments >= requiredPayment;

  const estPayments = await c.env.DB.prepare(
    'SELECT * FROM estimated_payments WHERE return_id = ? ORDER BY quarter ASC'
  ).bind(returnId).all();

  const quarterlyPaid = [0, 0, 0, 0];
  for (const ep of estPayments.results as any[]) {
    if (ep.quarter >= 1 && ep.quarter <= 4) quarterlyPaid[ep.quarter - 1] = ep.amount;
  }

  const quarterlyRequired = Math.round(requiredPayment / 4 * 100) / 100;
  const quarterlyStatus = quarterlyPaid.map((paid, i) => ({
    quarter: i + 1,
    required: quarterlyRequired,
    paid,
    status: paid >= quarterlyRequired ? 'SAFE' : 'UNDERPAID',
    shortfall: paid < quarterlyRequired ? Math.round((quarterlyRequired - paid) * 100) / 100 : 0,
  }));

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    analysis: {
      current_year_tax: currentTax,
      total_payments_made: currentPayments,
      prior_year_tax: priorYearTax,
      agi,
      high_income_threshold: highIncome,
    },
    safe_harbor_thresholds: {
      pct_90_current_year: safeHarbor90,
      pct_100_prior_year: safeHarbor100,
      pct_110_prior_year: safeHarbor110,
      applicable_threshold: highIncome ? '110% prior year (AGI > $150K)' : '100% prior year',
      required_minimum: requiredPayment,
    },
    status: {
      meets_safe_harbor: meetsHarbor,
      overpayment: meetsHarbor ? Math.round((currentPayments - requiredPayment) * 100) / 100 : 0,
      underpayment: !meetsHarbor ? Math.round((requiredPayment - currentPayments) * 100) / 100 : 0,
      penalty_risk: !meetsHarbor ? 'HIGH — underpayment penalty may apply (Form 2210)' : 'NONE — safe harbor met',
    },
    quarterly_analysis: quarterlyStatus,
    recommendations: [
      !meetsHarbor ? `Increase estimated payments to cover the $${Math.round(requiredPayment - currentPayments)} shortfall` : null,
      highIncome && !priorYear ? 'No prior year return found — pay 90% of current year tax to be safe' : null,
      meetsHarbor ? 'Safe harbor met — no underpayment penalty risk' : null,
      currentPayments > currentTax * 1.1 ? 'Consider reducing estimated payments — you may be overpaying' : null,
    ].filter(Boolean),
  });
});

// ─── Print Package (comprehensive print-ready summary) ─────────
advanced.get('/:id/print-package', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const income = await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>();
  const deductions = await c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>();
  const dependents = await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>();
  const notes = await c.env.DB.prepare('SELECT * FROM preparer_notes WHERE return_id = ? ORDER BY created_at DESC').bind(returnId).all();
  const amendments = await c.env.DB.prepare('SELECT * FROM amendments WHERE return_id = ?').bind(returnId).all();

  const filingStatusMap: Record<string, string> = {
    single: 'Single', married_joint: 'Married Filing Jointly', married_separate: 'Married Filing Separately',
    head_of_household: 'Head of Household', qualifying_widow: 'Qualifying Surviving Spouse',
  };

  const incomeByCategory: Record<string, number> = {};
  for (const i of income.results) { incomeByCategory[i.category || 'other'] = (incomeByCategory[i.category || 'other'] || 0) + i.amount; }
  const deductionByCategory: Record<string, number> = {};
  for (const d of deductions.results) { deductionByCategory[d.category || 'other'] = (deductionByCategory[d.category || 'other'] || 0) + d.amount; }

  return c.json({
    print_package: {
      generated_at: new Date().toISOString(),
      preparer: { name: 'Bobby Don McWilliams II', ptin: 'In Progress', firm: 'Echo LGT Tax Services' },
      return_id: returnId,
    },
    taxpayer: {
      name: `${client.first_name} ${client.last_name}`,
      ssn_last4: client.ssn_encrypted ? '***-**-' + client.ssn_encrypted.slice(-4) : 'N/A',
      address: [client.address_street, client.address_city, client.address_state, client.address_zip].filter(Boolean).join(', '),
      filing_status: filingStatusMap[client.filing_status || ''] || client.filing_status || 'Unknown',
      phone: client.phone || 'N/A',
      email: client.email || 'N/A',
    },
    return_summary: {
      tax_year: ret.tax_year,
      status: ret.status,
      total_income: ret.total_income,
      adjusted_gross_income: ret.adjusted_gross_income,
      deduction_method: ret.deduction_method === 'itemized' ? 'Itemized Deductions' : 'Standard Deduction',
      taxable_income: ret.taxable_income,
      total_tax: ret.total_tax,
      total_payments: ret.total_payments,
      refund_or_owed: ret.refund_or_owed,
      effective_rate: ret.total_income > 0 ? Math.round((ret.total_tax / ret.total_income) * 10000) / 100 : 0,
    },
    income_detail: income.results.map(i => ({
      category: i.category, description: i.description, amount: i.amount,
      tax_withheld: i.tax_withheld, form_line: i.form_line,
    })),
    income_by_category: incomeByCategory,
    deduction_detail: deductions.results.map(d => ({
      category: d.category, description: d.description, amount: d.amount,
      schedule: d.schedule, form_line: d.form_line,
    })),
    deduction_by_category: deductionByCategory,
    dependents: dependents.results.map(d => ({
      name: `${d.first_name} ${d.last_name}`, relationship: d.relationship,
      dob: d.dob, qualifies_ctc: d.qualifies_ctc, qualifies_odc: d.qualifies_odc,
    })),
    preparer_notes: (notes.results as any[]).map(n => ({
      date: n.created_at, category: n.category, content: n.content, pinned: n.pinned,
    })),
    amendments: (amendments.results as any[]).map(a => ({
      date: a.created_at, reason: a.reason, changes: a.changes, status: a.status,
    })),
    disclaimer: 'This document is prepared for informational purposes. Final filing is subject to IRS acceptance. Retain all supporting documentation for a minimum of 7 years.',
  });
});

// ─── Income Source Analysis ────────────────────────────────────
advanced.get('/:id/income-analysis', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const income = await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>();
  const items = income.results;

  const byCategory: Record<string, { total: number; count: number; items: any[] }> = {};
  for (const i of items) {
    const cat = i.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0, items: [] };
    byCategory[cat].total += i.amount;
    byCategory[cat].count++;
    byCategory[cat].items.push({ description: i.description, amount: i.amount, withheld: i.tax_withheld });
  }

  const totalIncome = items.reduce((s, i) => s + i.amount, 0);
  const totalWithheld = items.reduce((s, i) => s + (i.tax_withheld || 0), 0);

  const diversification = Object.keys(byCategory).length;
  const largestSource = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total)[0];
  const concentration = largestSource ? Math.round((largestSource[1].total / totalIncome) * 100) : 0;

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    summary: {
      total_income: totalIncome,
      total_withheld: totalWithheld,
      effective_withholding_rate: totalIncome > 0 ? Math.round((totalWithheld / totalIncome) * 10000) / 100 : 0,
      source_count: items.length,
      category_count: diversification,
    },
    by_category: Object.entries(byCategory).map(([cat, data]) => ({
      category: cat,
      total: Math.round(data.total * 100) / 100,
      count: data.count,
      percentage: totalIncome > 0 ? Math.round((data.total / totalIncome) * 10000) / 100 : 0,
      items: data.items,
    })).sort((a, b) => b.total - a.total),
    risk_indicators: {
      income_concentration: concentration,
      concentration_risk: concentration > 80 ? 'HIGH — over 80% from single source' : concentration > 60 ? 'MODERATE' : 'LOW — well diversified',
      largest_source: largestSource ? { category: largestSource[0], amount: largestSource[1].total } : null,
      withholding_adequacy: totalWithheld > 0 && totalIncome > 0
        ? (totalWithheld / totalIncome > 0.15 ? 'ADEQUATE' : 'LOW — may need estimated payments')
        : 'UNKNOWN',
    },
  });
});

export default advanced;
