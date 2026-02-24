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

// ─── State Tax Estimate ──────────────────────────────────────
advanced.get('/:id/state-tax', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const state = (c.req.query('state') || client?.address_state || 'TX').toUpperCase();

  // State income tax rates (simplified — top marginal rates for most common states)
  const stateTaxRates: Record<string, { rate: number; type: string; notes: string; brackets?: { rate: number; up_to: number }[] }> = {
    TX: { rate: 0, type: 'none', notes: 'Texas has no state income tax' },
    FL: { rate: 0, type: 'none', notes: 'Florida has no state income tax' },
    NV: { rate: 0, type: 'none', notes: 'Nevada has no state income tax' },
    WA: { rate: 0, type: 'none', notes: 'Washington has no state income tax (7% capital gains tax applies)' },
    WY: { rate: 0, type: 'none', notes: 'Wyoming has no state income tax' },
    AK: { rate: 0, type: 'none', notes: 'Alaska has no state income tax' },
    SD: { rate: 0, type: 'none', notes: 'South Dakota has no state income tax' },
    TN: { rate: 0, type: 'none', notes: 'Tennessee has no state income tax' },
    NH: { rate: 0, type: 'none', notes: 'New Hampshire taxes only interest/dividends (being phased out)' },
    CA: { rate: 13.3, type: 'graduated', notes: 'Highest state tax in US', brackets: [
      { rate: 1, up_to: 10412 }, { rate: 2, up_to: 24684 }, { rate: 4, up_to: 38959 },
      { rate: 6, up_to: 54081 }, { rate: 8, up_to: 68350 }, { rate: 9.3, up_to: 349137 },
      { rate: 10.3, up_to: 418961 }, { rate: 11.3, up_to: 698271 }, { rate: 12.3, up_to: 1000000 },
      { rate: 13.3, up_to: Infinity },
    ]},
    NY: { rate: 10.9, type: 'graduated', notes: 'Plus NYC tax if applicable (3.876%)', brackets: [
      { rate: 4, up_to: 8500 }, { rate: 4.5, up_to: 11700 }, { rate: 5.25, up_to: 13900 },
      { rate: 5.85, up_to: 80650 }, { rate: 6.25, up_to: 215400 }, { rate: 6.85, up_to: 1077550 },
      { rate: 9.65, up_to: 5000000 }, { rate: 10.3, up_to: 25000000 }, { rate: 10.9, up_to: Infinity },
    ]},
    NJ: { rate: 10.75, type: 'graduated', notes: 'High rate for $1M+ income' },
    IL: { rate: 4.95, type: 'flat', notes: 'Flat rate on all income' },
    PA: { rate: 3.07, type: 'flat', notes: 'Flat rate, one of the lowest' },
    MA: { rate: 5, type: 'flat', notes: 'Flat rate + 4% surtax on income over $1M' },
    NM: { rate: 5.9, type: 'graduated', notes: 'Graduated rates' },
    OK: { rate: 4.75, type: 'graduated', notes: 'Graduated rates' },
    CO: { rate: 4.4, type: 'flat', notes: 'Flat rate' },
    AZ: { rate: 2.5, type: 'flat', notes: 'Flat rate' },
    LA: { rate: 4.25, type: 'graduated', notes: 'Graduated rates' },
  };

  const stateInfo = stateTaxRates[state] || { rate: 5, type: 'graduated', notes: 'Estimated — check state-specific rates' };
  const taxableIncome = ret.taxable_income || 0;
  let stateTax = 0;

  if (stateInfo.brackets) {
    let remaining = taxableIncome;
    let prevMax = 0;
    for (const bracket of stateInfo.brackets) {
      const bracketAmount = Math.min(remaining, bracket.up_to - prevMax);
      if (bracketAmount > 0) {
        stateTax += bracketAmount * (bracket.rate / 100);
        remaining -= bracketAmount;
      }
      prevMax = bracket.up_to;
      if (remaining <= 0) break;
    }
  } else if (stateInfo.type === 'flat') {
    stateTax = taxableIncome * (stateInfo.rate / 100);
  }

  stateTax = Math.round(stateTax * 100) / 100;

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    state,
    state_tax_info: {
      type: stateInfo.type,
      top_rate: stateInfo.rate + '%',
      notes: stateInfo.notes,
    },
    calculation: {
      federal_taxable_income: taxableIncome,
      state_adjustments: 0,
      state_taxable_income: taxableIncome,
      estimated_state_tax: stateTax,
      effective_state_rate: taxableIncome > 0 ? Math.round((stateTax / taxableIncome) * 10000) / 100 + '%' : '0%',
    },
    combined_tax_burden: {
      federal_tax: ret.total_tax,
      state_tax: stateTax,
      total_combined: Math.round((ret.total_tax + stateTax) * 100) / 100,
      combined_effective_rate: ret.total_income > 0
        ? Math.round(((ret.total_tax + stateTax) / ret.total_income) * 10000) / 100 + '%'
        : '0%',
    },
    salt_deduction: {
      state_income_tax: stateTax,
      property_tax_estimate: 0,
      total_salt: stateTax,
      salt_cap: 10000,
      deductible: Math.min(stateTax, 10000),
      over_cap: stateTax > 10000 ? Math.round((stateTax - 10000) * 100) / 100 : 0,
    },
    no_income_tax_states: ['TX', 'FL', 'NV', 'WA', 'WY', 'AK', 'SD', 'TN', 'NH'],
    relocation_savings: stateInfo.rate > 0 ? {
      annual_state_tax_savings: stateTax,
      five_year_savings: Math.round(stateTax * 5 * 100) / 100,
      note: 'Savings from relocating to a no-income-tax state. Does not account for cost-of-living differences.',
    } : null,
  });
});

// ─── IRS Form Library ────────────────────────────────────────
advanced.get('/:id/required-forms', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const income = await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>();
  const deductions = await c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>();
  const dependents = await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>();

  const categories = new Set(income.results.map(i => i.category));
  const schedules = new Set(deductions.results.map(d => d.schedule).filter(Boolean));
  const forms: { form: string; name: string; reason: string; required: boolean }[] = [];

  // Always required
  forms.push({ form: '1040', name: 'U.S. Individual Income Tax Return', reason: 'Primary federal tax return', required: true });

  // Income-based
  if (categories.has('wages')) forms.push({ form: 'W-2', name: 'Wage and Tax Statement', reason: 'Employment income reported', required: true });
  if (categories.has('interest')) forms.push({ form: '1099-INT', name: 'Interest Income', reason: 'Interest income reported', required: true });
  if (categories.has('dividends')) forms.push({ form: '1099-DIV', name: 'Dividends and Distributions', reason: 'Dividend income reported', required: true });
  if (categories.has('business') || categories.has('self_employment') || categories.has('freelance')) {
    forms.push({ form: 'Schedule C', name: 'Profit or Loss from Business', reason: 'Self-employment/business income', required: true });
    forms.push({ form: 'Schedule SE', name: 'Self-Employment Tax', reason: 'SE tax calculation', required: true });
    forms.push({ form: '1099-NEC', name: 'Nonemployee Compensation', reason: 'Freelance/contract income', required: true });
  }
  if (categories.has('capital_gains')) {
    forms.push({ form: 'Schedule D', name: 'Capital Gains and Losses', reason: 'Investment transactions', required: true });
    forms.push({ form: '8949', name: 'Sales and Dispositions of Capital Assets', reason: 'Detail of each transaction', required: true });
    forms.push({ form: '1099-B', name: 'Proceeds from Broker Transactions', reason: 'Brokerage sales reported', required: true });
  }
  if (categories.has('rental')) {
    forms.push({ form: 'Schedule E', name: 'Supplemental Income and Loss', reason: 'Rental property income', required: true });
  }
  if (categories.has('retirement')) {
    forms.push({ form: '1099-R', name: 'Distributions from Pensions, Annuities, Retirement', reason: 'Retirement distributions', required: true });
  }
  if (categories.has('other') || categories.has('gambling')) {
    forms.push({ form: 'W-2G', name: 'Certain Gambling Winnings', reason: 'Gambling income reported', required: true });
  }

  // Deduction-based
  if (ret.deduction_method === 'itemized' || schedules.has('A')) {
    forms.push({ form: 'Schedule A', name: 'Itemized Deductions', reason: 'Itemized deductions claimed', required: true });
  }
  if (schedules.has('C')) forms.push({ form: 'Schedule C', name: 'Profit or Loss from Business', reason: 'Business expenses', required: true });

  // Dependent-based
  if (dependents.results.length > 0) {
    forms.push({ form: 'Schedule 8812', name: 'Credits for Qualifying Children', reason: `${dependents.results.length} dependent(s) claimed`, required: true });
  }

  // Common additional forms
  const totalIncome = ret.total_income || 0;
  if (totalIncome > 100000 || income.results.length > 3) {
    forms.push({ form: 'Schedule 1', name: 'Additional Income and Adjustments', reason: 'Additional income items or adjustments', required: true });
  }
  if ((ret.total_tax || 0) > 1000 && (ret.total_payments || 0) < (ret.total_tax || 0) * 0.9) {
    forms.push({ form: '2210', name: 'Underpayment of Estimated Tax', reason: 'Potential underpayment penalty', required: false });
  }
  forms.push({ form: 'Schedule 2', name: 'Additional Taxes', reason: 'AMT, SE tax, early distribution penalty', required: false });
  forms.push({ form: 'Schedule 3', name: 'Additional Credits and Payments', reason: 'Education credits, estimated tax payments', required: false });

  // Deduplicate
  const seen = new Set<string>();
  const uniqueForms = forms.filter(f => { if (seen.has(f.form)) return false; seen.add(f.form); return true; });

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    forms_required: uniqueForms.filter(f => f.required).length,
    forms_optional: uniqueForms.filter(f => !f.required).length,
    forms: uniqueForms,
    filing_status: ret.deduction_method || 'standard',
    income_categories: [...categories],
    schedules_needed: [...schedules],
  });
});

// ─── Depreciation Calculator ─────────────────────────────────
advanced.post('/:id/depreciation', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const body = await c.req.json<{
    asset_name: string; cost_basis: number; placed_in_service: string;
    asset_class: string; method?: string; salvage_value?: number;
  }>();

  if (!body.asset_name || !body.cost_basis || !body.asset_class) {
    return c.json({ error: 'asset_name, cost_basis, and asset_class required' }, 400);
  }

  // MACRS useful life by asset class
  const macrsYears: Record<string, number> = {
    '3-year': 3, '5-year': 5, '7-year': 7, '10-year': 10, '15-year': 15,
    '20-year': 20, '27.5-year': 27, '39-year': 39,
    vehicles: 5, computers: 5, furniture: 7, equipment: 7,
    machinery: 7, buildings_residential: 27, buildings_commercial: 39,
    improvements: 15, land_improvements: 15,
  };

  const usefulLife = macrsYears[body.asset_class] || 7;
  const method = body.method || (usefulLife <= 20 ? 'double_declining' : 'straight_line');
  const costBasis = body.cost_basis;
  const salvage = body.salvage_value || 0;
  const depreciable = costBasis - salvage;

  const schedule: { year: number; depreciation: number; cumulative: number; book_value: number }[] = [];
  let cumulative = 0;

  if (method === 'straight_line') {
    const annual = Math.round((depreciable / usefulLife) * 100) / 100;
    for (let y = 1; y <= usefulLife; y++) {
      const dep = Math.min(annual, depreciable - cumulative);
      cumulative += dep;
      schedule.push({ year: y, depreciation: Math.round(dep * 100) / 100, cumulative: Math.round(cumulative * 100) / 100, book_value: Math.round((costBasis - cumulative) * 100) / 100 });
    }
  } else {
    const ddbRate = 2 / usefulLife;
    let bookValue = costBasis;
    for (let y = 1; y <= usefulLife; y++) {
      let dep = Math.round(bookValue * ddbRate * 100) / 100;
      const slRemaining = Math.round((bookValue - salvage) / (usefulLife - y + 1) * 100) / 100;
      if (slRemaining > dep) dep = slRemaining; // Switch to SL when beneficial
      dep = Math.min(dep, bookValue - salvage);
      if (dep < 0) dep = 0;
      cumulative += dep;
      bookValue -= dep;
      schedule.push({ year: y, depreciation: dep, cumulative: Math.round(cumulative * 100) / 100, book_value: Math.round(bookValue * 100) / 100 });
    }
  }

  // Section 179 analysis
  const section179Limit = ret.tax_year >= 2025 ? 1250000 : ret.tax_year >= 2024 ? 1220000 : 1160000;
  const section179Eligible = costBasis <= section179Limit;

  // Bonus depreciation (100% for assets placed before 2023, phasing down)
  const bonusPct = ret.tax_year <= 2022 ? 100 : ret.tax_year === 2023 ? 80 : ret.tax_year === 2024 ? 60 : ret.tax_year === 2025 ? 40 : 20;

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    asset: {
      name: body.asset_name,
      cost_basis: costBasis,
      salvage_value: salvage,
      depreciable_amount: depreciable,
      asset_class: body.asset_class,
      useful_life_years: usefulLife,
      method: method === 'straight_line' ? 'Straight-Line' : 'Double Declining Balance (MACRS)',
    },
    depreciation_schedule: schedule,
    first_year_deduction: schedule[0]?.depreciation || 0,
    total_depreciation: Math.round(cumulative * 100) / 100,
    accelerated_options: {
      section_179: {
        eligible: section179Eligible,
        max_deduction: section179Limit,
        immediate_deduction: section179Eligible ? costBasis : 0,
        tax_savings_estimate: section179Eligible ? Math.round(costBasis * 0.22 * 100) / 100 : 0,
      },
      bonus_depreciation: {
        rate: bonusPct + '%',
        deduction: Math.round(depreciable * (bonusPct / 100) * 100) / 100,
        tax_savings_estimate: Math.round(depreciable * (bonusPct / 100) * 0.22 * 100) / 100,
        note: bonusPct < 100 ? `Bonus depreciation is ${bonusPct}% for ${ret.tax_year} (phasing down from 100% in 2022)` : 'Full 100% bonus depreciation available',
      },
    },
    recommendations: [
      section179Eligible ? 'Section 179 allows full immediate deduction — strongest first-year benefit' : null,
      bonusPct > 0 ? `Bonus depreciation at ${bonusPct}% available as alternative to Section 179` : null,
      usefulLife > 20 ? 'Real property — must use straight-line depreciation (no bonus depreciation on structures)' : null,
      body.asset_class === 'vehicles' ? 'Vehicle depreciation limits apply (luxury auto limits). Consider Section 179 for SUVs over 6,000 lbs GVW.' : null,
    ].filter(Boolean),
  });
});

// ─── Tax Strategy Planner ────────────────────────────────────
advanced.get('/:id/strategy', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const income = await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>();
  const deductions = await c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>();
  const dependents = await c.env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>();

  const agi = ret.adjusted_gross_income || 0;
  const taxableIncome = ret.taxable_income || 0;
  const totalTax = ret.total_tax || 0;
  const effectiveRate = agi > 0 ? Math.round((totalTax / agi) * 10000) / 100 : 0;
  const filingStatus = client?.filing_status || 'single';

  const strategies: { strategy: string; category: string; potential_savings: number; complexity: string; description: string; action_items: string[] }[] = [];

  // Retirement contribution strategy
  const has401k = income.results.some(i => i.category === 'wages');
  if (has401k) {
    const maxContrib = ret.tax_year >= 2025 ? 23500 : 23000;
    const savings = Math.round(maxContrib * (effectiveRate / 100) * 100) / 100;
    strategies.push({
      strategy: 'Maximize 401(k) Contributions',
      category: 'retirement',
      potential_savings: savings,
      complexity: 'Low',
      description: `Max out 401(k) at $${maxContrib.toLocaleString()} to reduce taxable income`,
      action_items: ['Contact HR to increase 401(k) contribution', 'Set up automatic increases', 'Consider catch-up contributions if 50+'],
    });
  }

  // IRA contribution
  const iraLimit = ret.tax_year >= 2024 ? 7000 : 6500;
  const iraSavings = Math.round(iraLimit * (effectiveRate / 100) * 100) / 100;
  strategies.push({
    strategy: 'Traditional IRA Contribution',
    category: 'retirement',
    potential_savings: iraSavings,
    complexity: 'Low',
    description: `Contribute $${iraLimit.toLocaleString()} to Traditional IRA for tax deduction`,
    action_items: ['Open IRA if not already established', 'Fund by April 15 deadline', 'Check MAGI limits for deductibility'],
  });

  // HSA strategy
  const hsaLimit = ret.tax_year >= 2025 ? 4300 : 4150;
  const hsaSavings = Math.round(hsaLimit * (effectiveRate / 100) * 100) / 100;
  strategies.push({
    strategy: 'HSA Contribution (if HDHP enrolled)',
    category: 'health',
    potential_savings: hsaSavings,
    complexity: 'Low',
    description: 'Triple tax benefit — deductible, grows tax-free, tax-free withdrawals for medical',
    action_items: ['Verify HDHP enrollment', 'Max out HSA contributions', 'Consider investing HSA funds for growth'],
  });

  // Charitable giving
  if (agi > 100000) {
    const charitableTarget = Math.round(agi * 0.05);
    const charSavings = Math.round(charitableTarget * (effectiveRate / 100) * 100) / 100;
    strategies.push({
      strategy: 'Charitable Giving Strategy',
      category: 'deductions',
      potential_savings: charSavings,
      complexity: 'Medium',
      description: 'Bundle charitable donations or use Donor Advised Fund for deduction timing',
      action_items: ['Consider Donor Advised Fund for bunching', 'Donate appreciated stock to avoid capital gains', 'Track all cash and non-cash donations'],
    });
  }

  // Tax-loss harvesting
  if (income.results.some(i => i.category === 'capital_gains')) {
    strategies.push({
      strategy: 'Tax-Loss Harvesting',
      category: 'investments',
      potential_savings: Math.min(3000, taxableIncome * 0.01),
      complexity: 'Medium',
      description: 'Sell losing investments to offset capital gains (up to $3,000 against ordinary income)',
      action_items: ['Review portfolio for unrealized losses', 'Harvest losses before year-end', 'Mind wash sale rule (30 days)'],
    });
  }

  // Business entity strategy
  if (income.results.some(i => ['business', 'self_employment', 'freelance'].includes(i.category))) {
    const seIncome = income.results.filter(i => ['business', 'self_employment', 'freelance'].includes(i.category)).reduce((s, i) => s + i.amount, 0);
    if (seIncome > 50000) {
      strategies.push({
        strategy: 'S-Corp Election',
        category: 'entity',
        potential_savings: Math.round(seIncome * 0.0765 * 0.4 * 100) / 100,
        complexity: 'High',
        description: 'Elect S-Corp status to split income between salary and distributions, reducing SE tax',
        action_items: ['File Form 2553 (S-Corp election)', 'Set reasonable salary (60-70% of income)', 'Run payroll monthly or quarterly', 'File Form 1120-S annually'],
      });
    }
  }

  // Dependent strategies
  if (dependents.results.length > 0) {
    strategies.push({
      strategy: 'Dependent Care Benefits',
      category: 'credits',
      potential_savings: Math.min(dependents.results.length * 2000, 6000),
      complexity: 'Low',
      description: 'Maximize Child Tax Credit and Dependent Care FSA',
      action_items: ['Enroll in employer Dependent Care FSA ($5,000 max)', 'Claim all eligible dependents', 'Check eligibility for Child and Dependent Care Credit'],
    });
  }

  // SALT optimization
  if (filingStatus === 'married_joint' && agi > 200000) {
    strategies.push({
      strategy: 'SALT Cap Workaround (PTE Tax)',
      category: 'deductions',
      potential_savings: Math.round(Math.max(0, (agi * 0.05) - 10000) * (effectiveRate / 100) * 100) / 100,
      complexity: 'High',
      description: 'Pass-through entity tax election to bypass $10K SALT deduction cap',
      action_items: ['Check if state offers PTE election', 'Evaluate with tax professional', 'File election by state deadline'],
    });
  }

  strategies.sort((a, b) => b.potential_savings - a.potential_savings);

  return c.json({
    return_id: returnId,
    tax_year: ret.tax_year,
    current_position: {
      agi,
      taxable_income: taxableIncome,
      total_tax: totalTax,
      effective_rate: effectiveRate + '%',
      filing_status: filingStatus,
      dependents: dependents.results.length,
    },
    strategies,
    total_potential_savings: Math.round(strategies.reduce((s, st) => s + st.potential_savings, 0) * 100) / 100,
    top_3_actions: strategies.slice(0, 3).map(s => s.action_items[0]),
    disclaimer: 'Tax strategies should be reviewed with a qualified tax professional. Savings estimates are approximate and depend on individual circumstances.',
  });
});

// ─── Year-Over-Year Trend Analysis ───────────────────────────
advanced.get('/:id/trend', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const allReturns = await c.env.DB.prepare(
    'SELECT * FROM returns WHERE client_id = ? ORDER BY tax_year ASC'
  ).bind(ret.client_id).all<TaxReturn>();

  const years = allReturns.results;
  if (years.length < 2) return c.json({ return_id: returnId, message: 'Need at least 2 years of returns for trend analysis', years_available: years.length });

  const trends = years.map((r, i) => {
    const prev = i > 0 ? years[i - 1] : null;
    return {
      tax_year: r.tax_year,
      total_income: r.total_income,
      income_change: prev ? Math.round((r.total_income - prev.total_income) * 100) / 100 : 0,
      income_change_pct: prev && prev.total_income > 0 ? Math.round(((r.total_income - prev.total_income) / prev.total_income) * 10000) / 100 : 0,
      agi: r.adjusted_gross_income,
      taxable_income: r.taxable_income,
      total_tax: r.total_tax,
      tax_change: prev ? Math.round((r.total_tax - prev.total_tax) * 100) / 100 : 0,
      effective_rate: r.total_income > 0 ? Math.round((r.total_tax / r.total_income) * 10000) / 100 : 0,
      refund_or_owed: r.refund_or_owed,
      deduction_method: r.deduction_method,
    };
  });

  const avgIncome = Math.round(years.reduce((s, r) => s + r.total_income, 0) / years.length);
  const avgTax = Math.round(years.reduce((s, r) => s + r.total_tax, 0) / years.length * 100) / 100;
  const incomeGrowth = years.length >= 2
    ? Math.round(((years[years.length - 1].total_income - years[0].total_income) / years[0].total_income) * 10000) / 100
    : 0;

  return c.json({
    return_id: returnId,
    client_id: ret.client_id,
    years_analyzed: years.length,
    year_range: `${years[0].tax_year}-${years[years.length - 1].tax_year}`,
    trends,
    summary: {
      average_income: avgIncome,
      average_tax: avgTax,
      income_growth_total: incomeGrowth + '%',
      income_growth_annual: Math.round(incomeGrowth / Math.max(years.length - 1, 1) * 100) / 100 + '%',
      highest_income_year: years.reduce((max, r) => r.total_income > max.total_income ? r : max).tax_year,
      lowest_tax_rate_year: years.filter(r => r.total_income > 0).reduce((min, r) => {
        const rate = r.total_tax / r.total_income;
        const minRate = min.total_tax / (min.total_income || 1);
        return rate < minRate ? r : min;
      }).tax_year,
    },
    projections: {
      next_year_income_estimate: Math.round(years[years.length - 1].total_income * (1 + incomeGrowth / 100 / Math.max(years.length - 1, 1))),
      note: 'Projection based on historical growth rate — actual results may vary',
    },
  });
});

export default advanced;
