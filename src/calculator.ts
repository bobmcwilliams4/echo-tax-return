// Echo Tax Return — Full 1040 Tax Calculation Engine
// Multi-year support (2019-2024) via tax-data.ts
import type { Env, FilingStatus, DeductionMethod, TaxCalculation, BracketDetail, IncomeItem, Deduction, Dependent, FormLine, Form1040, Client } from './types';
import { getTaxBrackets, getStandardDeduction, getSSWageBase, getCTCParams, getEITCParams, getSALTCap, getQBIRate, getSEIncomeFactor, getODCAmount } from './tax-data';

// ═══════════════════════════════════════════════════════════════
// MAIN CALCULATION FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function calculateTaxReturn(
  env: Env,
  returnId: string
): Promise<TaxCalculation> {
  // Load all data for this return
  const ret = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<any>();
  if (!ret) throw new Error('Return not found');

  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  if (!client) throw new Error('Client not found');

  const taxYear: number = ret.tax_year;
  const filingStatus: FilingStatus = client.filing_status || 'single';
  const seIncomeFactor = getSEIncomeFactor();
  const saltCap = getSALTCap();
  const qbiRate = getQBIRate();
  const odcAmount = getODCAmount();

  const [incomeResult, deductionResult, dependentResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>(),
    env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>(),
    env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>(),
  ]);

  const incomeItems = incomeResult.results;
  const deductions = deductionResult.results;
  const dependents = dependentResult.results;

  // Also load estimated payments from estimated_payments table (if it exists)
  let estimatedPaymentsTotal = 0;
  try {
    const epResult = await env.DB.prepare(
      'SELECT SUM(amount) as total FROM estimated_payments WHERE return_id = ?'
    ).bind(returnId).first<{ total: number | null }>();
    estimatedPaymentsTotal = epResult?.total || 0;
  } catch { /* table may not exist yet */ }

  // ─── Step 1: Calculate Income by Category ──────────────────
  const incomeSummary = {
    wages: sumByCategory(incomeItems, 'wages'),
    interest: sumByCategory(incomeItems, 'interest'),
    dividends: sumByCategory(incomeItems, 'dividends'),
    business: sumByCategory(incomeItems, 'business'),
    capital_gains: sumByCategory(incomeItems, 'capital_gains'),
    rental: sumByCategory(incomeItems, 'rental'),
    retirement: sumByCategory(incomeItems, 'retirement'),
    social_security: sumByCategory(incomeItems, 'social_security'),
    other: sumByCategory(incomeItems, 'other') + sumByCategory(incomeItems, 'unemployment'),
    total: 0,
  };

  // Social Security taxable amount (up to 85% taxable based on provisional income)
  const ssaTaxable = calculateSSATaxable(incomeSummary.social_security, incomeSummary, filingStatus);
  incomeSummary.social_security = ssaTaxable;

  incomeSummary.total = Object.values(incomeSummary).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0) - incomeSummary.total;

  // ─── Step 2: Calculate Adjustments (Schedule 1 Part II) ────
  const adjustments = {
    student_loan: Math.min(sumByCategory(deductions, 'student_loan'), 2500),
    ira: sumByCategory(deductions, 'ira'),
    hsa: sumByCategory(deductions, 'hsa'),
    se_tax: 0,
    educator: Math.min(sumByCategory(deductions, 'educator'), taxYear >= 2022 ? 300 : 250),
    alimony: sumByCategory(deductions, 'alimony'),
    total: 0,
  };

  // Self-employment tax deduction (half of SE tax)
  if (incomeSummary.business > 0) {
    const seIncome = incomeSummary.business * seIncomeFactor;
    const seTax = calculateSETax(seIncome, incomeSummary.wages, taxYear);
    adjustments.se_tax = Math.round(seTax / 2 * 100) / 100;
  }

  adjustments.total = adjustments.student_loan + adjustments.ira + adjustments.hsa +
    adjustments.se_tax + adjustments.educator + adjustments.alimony;

  // ─── Step 3: AGI ───────────────────────────────────────────
  const agi = Math.max(0, incomeSummary.total - adjustments.total);

  // ─── Step 4: Deductions (Standard vs Itemized) ─────────────
  const standardDeduction = getStandardDeduction(taxYear, filingStatus);

  // Itemized deductions (Schedule A)
  const medicalFloor = agi * 0.075;
  const medicalDeduction = Math.max(0, sumByCategory(deductions, 'medical') - medicalFloor);
  const saltDeduction = Math.min(sumByCategory(deductions, 'salt'), saltCap);
  const mortgageInterest = sumByCategory(deductions, 'mortgage_interest');
  const charitable = sumByCategory(deductions, 'charitable');
  const itemizedTotal = medicalDeduction + saltDeduction + mortgageInterest + charitable;

  const deductionMethod: DeductionMethod = itemizedTotal > standardDeduction ? 'itemized' : 'standard';
  const deductionAmount = Math.max(standardDeduction, itemizedTotal);

  // ─── Step 5: QBI Deduction (Section 199A) ──────────────────
  let qbiDeduction = 0;
  if (incomeSummary.business > 0) {
    const qbi = incomeSummary.business - adjustments.se_tax;
    const taxableBeforeQBI = agi - deductionAmount;
    qbiDeduction = Math.min(qbi * qbiRate, taxableBeforeQBI * qbiRate);
    qbiDeduction = Math.max(0, Math.round(qbiDeduction * 100) / 100);
  }

  // ─── Step 6: Taxable Income ────────────────────────────────
  const taxableIncome = Math.max(0, agi - deductionAmount - qbiDeduction);

  // ─── Step 7: Calculate Tax from Year-Specific Brackets ─────
  const brackets = getTaxBrackets(taxYear, filingStatus);
  const bracketDetail: BracketDetail[] = [];
  let regularTax = 0;
  let remaining = taxableIncome;

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const bracketWidth = bracket.max - bracket.min;
    const taxableInBracket = Math.min(remaining, bracketWidth);
    const taxInBracket = Math.round(taxableInBracket * bracket.rate * 100) / 100;
    bracketDetail.push({
      rate: bracket.rate,
      range_start: bracket.min,
      range_end: Math.min(bracket.max, bracket.min + taxableInBracket),
      taxable_in_bracket: taxableInBracket,
      tax_in_bracket: taxInBracket,
    });
    regularTax += taxInBracket;
    remaining -= taxableInBracket;
  }
  regularTax = Math.round(regularTax * 100) / 100;

  // ─── Step 8: Credits (year-aware) ──────────────────────────
  const ctcChildren = dependents.filter(d => d.qualifies_ctc).length;
  const odcDependents = dependents.filter(d => d.qualifies_odc && !d.qualifies_ctc).length;

  const credits = {
    ctc: calculateCTC(ctcChildren, agi, filingStatus, taxYear),
    eitc: calculateEITC(agi, incomeItems, dependents, filingStatus, taxYear),
    education: 0,
    other: odcDependents * odcAmount,
    total: 0,
  };
  credits.total = credits.ctc + credits.eitc + credits.education + credits.other;

  // ─── Step 9: Other Taxes ───────────────────────────────────
  const otherTaxes = {
    se_tax: 0,
    amt: 0,
    total: 0,
  };

  if (incomeSummary.business > 0) {
    const seIncome = incomeSummary.business * seIncomeFactor;
    otherTaxes.se_tax = calculateSETax(seIncome, incomeSummary.wages, taxYear);
  }
  otherTaxes.total = otherTaxes.se_tax + otherTaxes.amt;

  // ─── Step 10: Total Tax ────────────────────────────────────
  const totalTax = Math.max(0, Math.round((regularTax - credits.total + otherTaxes.total) * 100) / 100);

  // ─── Step 11: Payments / Withholding ───────────────────────
  const totalWithholding = incomeItems.reduce((sum, item) => sum + (item.tax_withheld || 0), 0);

  const payments = {
    withholding: Math.round(totalWithholding * 100) / 100,
    estimated: Math.round(estimatedPaymentsTotal * 100) / 100,
    total: Math.round((totalWithholding + estimatedPaymentsTotal) * 100) / 100,
  };

  // ─── Step 12: Refund or Amount Owed ────────────────────────
  const refundOrOwed = Math.round((payments.total - totalTax) * 100) / 100;

  // ─── Step 13: Effective & Marginal Tax Rate ────────────────
  const effectiveRate = incomeSummary.total > 0 ? Math.round((totalTax / incomeSummary.total) * 10000) / 100 : 0;
  const marginalRate = bracketDetail.length > 0 ? bracketDetail[bracketDetail.length - 1].rate * 100 : 0;

  // ─── Store Results to D1 ───────────────────────────────────
  await env.DB.prepare(`
    UPDATE returns SET
      total_income = ?, adjusted_gross_income = ?, taxable_income = ?,
      total_tax = ?, total_payments = ?, refund_or_owed = ?,
      deduction_method = ?, status = CASE WHEN status = 'intake' OR status = 'documents' THEN 'calculating' ELSE status END,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    incomeSummary.total, agi, taxableIncome,
    totalTax, payments.total, refundOrOwed,
    deductionMethod, returnId
  ).run();

  return {
    return_id: returnId,
    tax_year: taxYear,
    filing_status: filingStatus,
    income_summary: incomeSummary,
    adjustments,
    agi,
    deductions: {
      standard: standardDeduction,
      itemized: itemizedTotal,
      method: deductionMethod,
      amount: deductionAmount,
    },
    qbi_deduction: qbiDeduction,
    taxable_income: taxableIncome,
    tax_bracket_detail: bracketDetail,
    regular_tax: regularTax,
    credits,
    other_taxes: otherTaxes,
    total_tax: totalTax,
    payments,
    refund_or_owed: refundOrOwed,
    effective_rate: effectiveRate,
    marginal_rate: marginalRate,
  };
}

// ═══════════════════════════════════════════════════════════════
// GENERATE FORM 1040 DATA
// ═══════════════════════════════════════════════════════════════

export async function generateForm1040(env: Env, returnId: string): Promise<Form1040> {
  const calc = await calculateTaxReturn(env, returnId);
  const ret = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<any>();
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const dependentResult = await env.DB.prepare('SELECT * FROM dependents WHERE return_id = ?').bind(returnId).all<Dependent>();

  const lines: FormLine[] = [
    { line: '1a', description: 'Wages, salaries, tips', amount: calc.income_summary.wages },
    { line: '2a', description: 'Tax-exempt interest', amount: 0 },
    { line: '2b', description: 'Taxable interest', amount: calc.income_summary.interest },
    { line: '3a', description: 'Qualified dividends', amount: 0 },
    { line: '3b', description: 'Ordinary dividends', amount: calc.income_summary.dividends },
    { line: '4a', description: 'IRA distributions', amount: 0 },
    { line: '4b', description: 'IRA distributions (taxable)', amount: calc.income_summary.retirement },
    { line: '5a', description: 'Pensions and annuities', amount: 0 },
    { line: '5b', description: 'Pensions and annuities (taxable)', amount: 0 },
    { line: '6a', description: 'Social Security benefits', amount: calc.income_summary.social_security },
    { line: '6b', description: 'Social Security benefits (taxable)', amount: calc.income_summary.social_security },
    { line: '7', description: 'Capital gain or loss', amount: calc.income_summary.capital_gains },
    { line: '8', description: 'Other income (Schedule 1)', amount: calc.income_summary.business + calc.income_summary.rental + calc.income_summary.other },
    { line: '9', description: 'Total income', amount: calc.income_summary.total },
    { line: '10', description: 'Adjustments to income (Schedule 1)', amount: calc.adjustments.total },
    { line: '11', description: 'Adjusted gross income', amount: calc.agi },
    { line: '12', description: `${calc.deductions.method === 'standard' ? 'Standard' : 'Itemized'} deduction`, amount: calc.deductions.amount },
    { line: '13', description: 'Qualified business income deduction', amount: calc.qbi_deduction },
    { line: '14', description: 'Total deductions', amount: calc.deductions.amount + calc.qbi_deduction },
    { line: '15', description: 'Taxable income', amount: calc.taxable_income },
    { line: '16', description: 'Tax', amount: calc.regular_tax },
    { line: '17', description: 'Amount from Schedule 2 (other taxes)', amount: calc.other_taxes.total },
    { line: '18', description: 'Total tax before credits', amount: calc.regular_tax + calc.other_taxes.total },
    { line: '19', description: 'Child tax credit / other dependent credit', amount: calc.credits.ctc + calc.credits.other },
    { line: '21', description: 'Total credits', amount: calc.credits.total },
    { line: '22', description: 'Tax minus credits', amount: Math.max(0, calc.regular_tax - calc.credits.total) },
    { line: '23', description: 'Other taxes (SE tax, etc.)', amount: calc.other_taxes.total },
    { line: '24', description: 'Total tax', amount: calc.total_tax },
    { line: '25a', description: 'Federal income tax withheld from W-2', amount: calc.payments.withholding },
    { line: '26', description: 'Estimated tax payments', amount: calc.payments.estimated },
    { line: '33', description: 'Total payments', amount: calc.payments.total },
    { line: '34', description: 'Overpayment (refund)', amount: calc.refund_or_owed > 0 ? calc.refund_or_owed : 0 },
    { line: '37', description: 'Amount you owe', amount: calc.refund_or_owed < 0 ? Math.abs(calc.refund_or_owed) : 0 },
  ];

  // Schedule 1 (if applicable)
  const schedule1: FormLine[] = [];
  if (calc.income_summary.business > 0) schedule1.push({ line: 'S1-3', description: 'Business income (Schedule C)', amount: calc.income_summary.business });
  if (calc.income_summary.rental > 0) schedule1.push({ line: 'S1-5', description: 'Rental/royalty income (Schedule E)', amount: calc.income_summary.rental });
  if (calc.income_summary.other > 0) schedule1.push({ line: 'S1-8z', description: 'Other income', amount: calc.income_summary.other });
  if (calc.adjustments.se_tax > 0) schedule1.push({ line: 'S1-15', description: 'Deductible part of SE tax', amount: calc.adjustments.se_tax });
  if (calc.adjustments.hsa > 0) schedule1.push({ line: 'S1-13', description: 'HSA deduction', amount: calc.adjustments.hsa });
  if (calc.adjustments.ira > 0) schedule1.push({ line: 'S1-20', description: 'IRA deduction', amount: calc.adjustments.ira });
  if (calc.adjustments.student_loan > 0) schedule1.push({ line: 'S1-21', description: 'Student loan interest deduction', amount: calc.adjustments.student_loan });
  if (calc.adjustments.educator > 0) schedule1.push({ line: 'S1-11', description: 'Educator expenses', amount: calc.adjustments.educator });

  const schedules: Form1040['schedules'] = {};
  if (schedule1.length > 0) schedules.schedule_1 = schedule1;
  if (calc.other_taxes.se_tax > 0) {
    schedules.schedule_2 = [{ line: 'S2-4', description: 'Self-employment tax', amount: calc.other_taxes.se_tax }];
    schedules.schedule_se = [
      { line: 'SE-3', description: 'Net SE earnings', amount: calc.income_summary.business * getSEIncomeFactor() },
      { line: 'SE-12', description: 'SE tax', amount: calc.other_taxes.se_tax },
    ];
  }
  if (calc.credits.eitc > 0) {
    schedules.schedule_3 = [{ line: 'S3-27a', description: 'Earned Income Credit', amount: calc.credits.eitc }];
  }
  if (calc.deductions.method === 'itemized') {
    schedules.schedule_a = [
      { line: 'SA-1', description: 'Medical and dental expenses', amount: 0 }, // pre-floor
      { line: 'SA-4', description: 'Medical deduction (after 7.5% AGI floor)', amount: 0 },
      { line: 'SA-5d', description: 'State and local taxes (capped at $10,000)', amount: 0 },
      { line: 'SA-8a', description: 'Home mortgage interest', amount: 0 },
      { line: 'SA-12', description: 'Charitable contributions', amount: 0 },
      { line: 'SA-17', description: 'Total itemized deductions', amount: calc.deductions.amount },
    ];
  }
  if (calc.income_summary.business > 0) {
    schedules.schedule_c = [
      { line: 'SC-1', description: 'Gross receipts', amount: calc.income_summary.business },
      { line: 'SC-31', description: 'Net profit', amount: calc.income_summary.business },
    ];
  }

  return {
    tax_year: calc.tax_year,
    filing_status: calc.filing_status,
    taxpayer: {
      first_name: client?.first_name || '',
      last_name: client?.last_name || '',
      address: [client?.address_street, client?.address_city, client?.address_state, client?.address_zip].filter(Boolean).join(', '),
    },
    dependents: dependentResult.results.map(d => ({
      name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
      relationship: d.relationship || '',
    })),
    lines,
    schedules,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function sumByCategory(items: Array<{ category: string; amount: number }>, category: string): number {
  return items
    .filter(i => i.category === category)
    .reduce((sum, i) => sum + (i.amount || 0), 0);
}

function calculateSETax(seIncome: number, w2Wages: number, taxYear: number = 2024): number {
  if (seIncome <= 0) return 0;

  const ssWageBase = getSSWageBase(taxYear);

  // Social Security portion: 12.4% on income up to wage base (minus W-2 wages)
  const ssBase = Math.max(0, ssWageBase - w2Wages);
  const ssTaxableIncome = Math.min(seIncome, ssBase);
  const ssTax = ssTaxableIncome * 0.124;

  // Medicare portion: 2.9% on all SE income
  const medicareTax = seIncome * 0.029;

  // Additional Medicare: 0.9% on SE income over $200K (single) / $250K (joint)
  const additionalMedicare = Math.max(0, seIncome - 200000) * 0.009;

  return Math.round((ssTax + medicareTax + additionalMedicare) * 100) / 100;
}

function calculateSSATaxable(
  totalBenefits: number,
  income: { wages: number; interest: number; dividends: number; business: number; capital_gains: number; rental: number; other: number },
  filingStatus: FilingStatus
): number {
  if (totalBenefits <= 0) return 0;

  // Provisional income = all other income + 50% of SSA benefits
  const otherIncome = income.wages + income.interest + income.dividends +
    income.business + income.capital_gains + income.rental + income.other;
  const provisionalIncome = otherIncome + (totalBenefits * 0.5);

  const thresholds = filingStatus === 'married_joint'
    ? { low: 32000, high: 44000 }
    : { low: 25000, high: 34000 };

  if (provisionalIncome <= thresholds.low) return 0;
  if (provisionalIncome <= thresholds.high) {
    return Math.min(totalBenefits * 0.5, (provisionalIncome - thresholds.low) * 0.5);
  }
  // Up to 85% taxable
  const base = Math.min(totalBenefits * 0.5, (thresholds.high - thresholds.low) * 0.5);
  const excess = (provisionalIncome - thresholds.high) * 0.85;
  return Math.min(totalBenefits * 0.85, base + excess);
}

function calculateCTC(numChildren: number, agi: number, filingStatus: FilingStatus, taxYear: number = 2024): number {
  if (numChildren <= 0) return 0;
  const ctcParams = getCTCParams(taxYear);
  const maxCredit = numChildren * ctcParams.amount;
  const phaseoutThreshold = (filingStatus === 'married_joint') ? ctcParams.phaseout_joint : ctcParams.phaseout_single;
  const excess = Math.max(0, agi - phaseoutThreshold);
  const reduction = Math.floor(excess / 1000) * 50;
  return Math.max(0, maxCredit - reduction);
}

function calculateEITC(
  agi: number,
  incomeItems: IncomeItem[],
  dependents: Dependent[],
  filingStatus: FilingStatus,
  taxYear: number = 2024
): number {
  const qualifyingChildren = Math.min(3, dependents.filter(d => d.qualifies_ctc).length);
  const eitcParams = getEITCParams(taxYear, qualifyingChildren);
  if (!eitcParams) return 0;

  // Investment income limit (year-specific)
  const investmentIncome = sumByCategory(incomeItems, 'interest') +
    sumByCategory(incomeItems, 'dividends') +
    sumByCategory(incomeItems, 'capital_gains');
  if (investmentIncome > eitcParams.investment_income_limit) return 0;

  // Must have earned income
  const earnedIncome = sumByCategory(incomeItems, 'wages') + sumByCategory(incomeItems, 'business');
  if (earnedIncome <= 0) return 0;

  const isJoint = filingStatus === 'married_joint';
  const phaseoutStart = isJoint ? eitcParams.phaseout_start_joint : eitcParams.phaseout_start_single;
  const phaseoutEnd = isJoint ? eitcParams.phaseout_end_joint : eitcParams.phaseout_end_single;

  if (agi >= phaseoutEnd) return 0;
  if (agi <= phaseoutStart) return eitcParams.max;

  // Linear phaseout
  const phaseoutRange = phaseoutEnd - phaseoutStart;
  const reduction = ((agi - phaseoutStart) / phaseoutRange) * eitcParams.max;
  return Math.max(0, Math.round((eitcParams.max - reduction) * 100) / 100);
}
