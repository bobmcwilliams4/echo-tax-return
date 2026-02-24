// Echo Tax Return — TX Engine Optimization Integration
// Queries echo-engine-runtime (TX01-TX14) for tax optimization suggestions
import { Hono } from 'hono';
import type { Env, TaxReturn, Client, IncomeItem, Deduction } from './types';
import { generateId } from './auth';

const optimizer = new Hono<{ Bindings: Env }>();

// Engine routing map — which TX engine handles which scenario
const ENGINE_ROUTES: Record<string, { engines: string[]; query_prefix: string }> = {
  wages: { engines: ['TX01'], query_prefix: 'W-2 wage income optimization' },
  business: { engines: ['TX01', 'TX08'], query_prefix: 'self-employment and business income optimization' },
  oil_gas: { engines: ['TX12'], query_prefix: 'oil and gas taxation optimization including IDC deductions and depletion' },
  rental: { engines: ['TX13'], query_prefix: 'rental real estate tax optimization including depreciation' },
  crypto: { engines: ['TX14'], query_prefix: 'cryptocurrency tax optimization including wash sales and cost basis methods' },
  nonprofit: { engines: ['TX11'], query_prefix: 'nonprofit and tax-exempt organization planning' },
  retirement: { engines: ['TX01', 'TX06'], query_prefix: 'retirement distribution and pension taxation optimization' },
  capital_gains: { engines: ['TX01', 'TX05'], query_prefix: 'capital gains optimization including tax-loss harvesting' },
  deductions: { engines: ['TX01', 'TX02'], query_prefix: 'deduction optimization including standard vs itemized analysis' },
  credits: { engines: ['TX01', 'TX03'], query_prefix: 'tax credit optimization including CTC, EITC, and education credits' },
  estate: { engines: ['TX04'], query_prefix: 'estate and gift tax planning optimization' },
  international: { engines: ['TX07'], query_prefix: 'international tax obligations including FBAR and FATCA' },
  partnership: { engines: ['TX09'], query_prefix: 'partnership and pass-through entity optimization' },
  corporate: { engines: ['TX10'], query_prefix: 'corporate tax planning and optimization' },
};

// ─── Get Optimization Suggestions ────────────────────────────
optimizer.post('/:id/optimize', async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(ret.client_id).first<Client>();
  const incomeResult = await c.env.DB.prepare('SELECT * FROM income_items WHERE return_id = ?').bind(returnId).all<IncomeItem>();
  const deductionResult = await c.env.DB.prepare('SELECT * FROM deductions WHERE return_id = ?').bind(returnId).all<Deduction>();

  const incomeItems = incomeResult.results;
  const filingStatus = client?.filing_status || 'single';

  // Determine which engines to query based on income types present
  const scenariosToQuery: Set<string> = new Set(['deductions', 'credits']); // always check these
  for (const item of incomeItems) {
    switch (item.category) {
      case 'wages': scenariosToQuery.add('wages'); break;
      case 'business': scenariosToQuery.add('business'); break;
      case 'capital_gains': scenariosToQuery.add('capital_gains'); break;
      case 'rental': scenariosToQuery.add('rental'); break;
      case 'retirement': scenariosToQuery.add('retirement'); break;
    }
    // Check description for oil/gas or crypto
    const desc = (item.description || '').toLowerCase();
    if (desc.includes('oil') || desc.includes('gas') || desc.includes('mineral') || desc.includes('royalt')) {
      scenariosToQuery.add('oil_gas');
    }
    if (desc.includes('crypto') || desc.includes('bitcoin') || desc.includes('ethereum') || desc.includes('nft')) {
      scenariosToQuery.add('crypto');
    }
  }

  // Build context string for engine queries
  const totalIncome = incomeItems.reduce((s, i) => s + i.amount, 0);
  const totalDeductions = deductionResult.results.reduce((s, d) => s + d.amount, 0);
  const context = `Filing status: ${filingStatus}. Total income: $${totalIncome.toLocaleString()}. ` +
    `AGI: $${ret.adjusted_gross_income.toLocaleString()}. Deductions: $${totalDeductions.toLocaleString()} (${ret.deduction_method || 'standard'}). ` +
    `Tax year: ${ret.tax_year}.`;

  // Query engines in parallel
  const engineQueries: Array<{ scenario: string; engines: string[]; query: string }> = [];
  for (const scenario of scenariosToQuery) {
    const route = ENGINE_ROUTES[scenario];
    if (route) {
      engineQueries.push({
        scenario,
        engines: route.engines,
        query: `${route.query_prefix} for ${filingStatus} filer. ${context}`,
      });
    }
  }

  const allSuggestions: Array<{
    engine_id: string;
    category: string;
    suggestion: string;
    potential_savings: number;
    confidence: number;
    doctrine_source: string;
  }> = [];

  // Query echo-engine-runtime via service binding
  const queryPromises = engineQueries.map(async (eq) => {
    try {
      const resp = await c.env.ENGINE_RUNTIME.fetch(
        new Request('https://internal/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: eq.query,
            domain: 'tax',
            limit: 5,
          }),
        })
      );

      if (!resp.ok) return;
      const data = await resp.json() as any;
      const results = data.results || data.doctrines || [];

      for (const result of results.slice(0, 3)) {
        const suggestion = result.conclusion || result.content || result.text || '';
        if (!suggestion) continue;

        allSuggestions.push({
          engine_id: eq.engines[0],
          category: mapScenarioToCategory(eq.scenario),
          suggestion: suggestion.substring(0, 500),
          potential_savings: estimateSavings(eq.scenario, totalIncome, filingStatus),
          confidence: result.score || result.confidence || 0.7,
          doctrine_source: result.topic || result.engine_id || eq.engines[0],
        });
      }
    } catch {
      // Engine query failed — continue with other engines
    }
  });

  await Promise.all(queryPromises);

  // Also add rule-based suggestions
  addRuleBasedSuggestions(allSuggestions, incomeItems, deductionResult.results, ret, filingStatus);

  // Store suggestions in D1
  await c.env.DB.prepare('DELETE FROM optimizations WHERE return_id = ?').bind(returnId).run();
  for (const s of allSuggestions) {
    await c.env.DB.prepare(`
      INSERT INTO optimizations (id, return_id, engine_id, category, suggestion, potential_savings, confidence, doctrine_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(generateId('opt'), returnId, s.engine_id, s.category, s.suggestion, s.potential_savings, s.confidence, s.doctrine_source).run();
  }

  return c.json({
    return_id: returnId,
    optimizations: allSuggestions,
    engines_queried: [...new Set(engineQueries.flatMap(eq => eq.engines))],
    count: allSuggestions.length,
  });
});

// ─── Get Stored Optimizations ────────────────────────────────
optimizer.get('/:id/optimizations', async (c) => {
  const returnId = c.req.param('id');
  const result = await c.env.DB.prepare(
    'SELECT * FROM optimizations WHERE return_id = ? ORDER BY potential_savings DESC'
  ).bind(returnId).all();
  return c.json({ optimizations: result.results, count: result.results.length });
});

// ─── Rule-Based Suggestions ──────────────────────────────────

function addRuleBasedSuggestions(
  suggestions: Array<any>,
  income: IncomeItem[],
  deductions: Deduction[],
  ret: TaxReturn,
  filingStatus: string
): void {
  const totalIncome = income.reduce((s, i) => s + i.amount, 0);
  const businessIncome = income.filter(i => i.category === 'business').reduce((s, i) => s + i.amount, 0);
  const wageIncome = income.filter(i => i.category === 'wages').reduce((s, i) => s + i.amount, 0);
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const hasHSA = deductions.some(d => d.category === 'hsa');
  const hasIRA = deductions.some(d => d.category === 'ira');

  // Standard vs itemized check
  const standardAmounts: Record<string, number> = { single: 14600, married_joint: 29200, married_separate: 14600, head_of_household: 21900, widow: 29200 };
  const stdDed = standardAmounts[filingStatus] || 14600;
  if (ret.deduction_method === 'standard' && totalDeductions > stdDed * 0.7) {
    suggestions.push({
      engine_id: 'TX01', category: 'deduction',
      suggestion: `Your itemized deductions ($${totalDeductions.toLocaleString()}) are approaching the standard deduction ($${stdDed.toLocaleString()}). Consider bunching charitable donations or prepaying mortgage interest to exceed the standard deduction threshold.`,
      potential_savings: Math.round((totalDeductions - stdDed) * 0.22), confidence: 0.85, doctrine_source: 'rule_deduction_bunching',
    });
  }

  // HSA suggestion
  if (!hasHSA && totalIncome > 50000) {
    suggestions.push({
      engine_id: 'TX01', category: 'deduction',
      suggestion: 'Consider contributing to a Health Savings Account (HSA) if you have a high-deductible health plan. HSA contributions are tax-deductible, grow tax-free, and withdrawals for medical expenses are tax-free. 2024 limits: $4,150 single / $8,300 family.',
      potential_savings: Math.round(4150 * 0.22), confidence: 0.9, doctrine_source: 'rule_hsa',
    });
  }

  // IRA suggestion
  if (!hasIRA && wageIncome > 40000) {
    suggestions.push({
      engine_id: 'TX01', category: 'deduction',
      suggestion: 'Consider a traditional IRA contribution for a tax deduction up to $7,000 ($8,000 if age 50+). If income is too high for deductible traditional IRA, consider a Roth IRA or backdoor Roth strategy for long-term tax-free growth.',
      potential_savings: Math.round(7000 * 0.22), confidence: 0.85, doctrine_source: 'rule_ira',
    });
  }

  // Self-employment retirement plan
  if (businessIncome > 20000) {
    suggestions.push({
      engine_id: 'TX08', category: 'strategy',
      suggestion: `With $${businessIncome.toLocaleString()} in self-employment income, consider a SEP-IRA (up to 25% of net SE income, max $69,000) or Solo 401(k) (up to $23,000 employee + 25% employer). This reduces both income tax and potentially SE tax.`,
      potential_savings: Math.round(Math.min(businessIncome * 0.25, 69000) * 0.22), confidence: 0.9, doctrine_source: 'rule_sep_ira',
    });
  }

  // QBI reminder
  if (businessIncome > 0 && totalIncome < 191950) {
    suggestions.push({
      engine_id: 'TX09', category: 'deduction',
      suggestion: 'Your business income qualifies for the Section 199A Qualified Business Income (QBI) deduction of up to 20% of qualified business income. Ensure all eligible business income is properly classified to maximize this deduction.',
      potential_savings: Math.round(businessIncome * 0.20 * 0.22), confidence: 0.95, doctrine_source: 'rule_qbi',
    });
  }

  // Estimated payments reminder
  if (ret.refund_or_owed < -1000) {
    suggestions.push({
      engine_id: 'TX01', category: 'timing',
      suggestion: `You owe $${Math.abs(ret.refund_or_owed).toLocaleString()}. To avoid underpayment penalties next year, consider making quarterly estimated tax payments (Form 1040-ES). Safe harbor: pay 100% of this year's tax (110% if AGI > $150K) or 90% of next year's tax.`,
      potential_savings: 0, confidence: 0.95, doctrine_source: 'rule_estimated_payments',
    });
  }

  // Large refund = too much withholding
  if (ret.refund_or_owed > 3000) {
    suggestions.push({
      engine_id: 'TX01', category: 'timing',
      suggestion: `Your refund of $${ret.refund_or_owed.toLocaleString()} means you're overwithholding. Adjust your W-4 to increase take-home pay. That's roughly $${Math.round(ret.refund_or_owed / 12).toLocaleString()} extra per month you could invest or pay down debt.`,
      potential_savings: 0, confidence: 0.9, doctrine_source: 'rule_overwithholding',
    });
  }
}

function mapScenarioToCategory(scenario: string): string {
  switch (scenario) {
    case 'deductions': return 'deduction';
    case 'credits': return 'credit';
    case 'wages': case 'business': case 'oil_gas': case 'rental': case 'crypto':
    case 'retirement': case 'capital_gains': return 'strategy';
    default: return 'strategy';
  }
}

function estimateSavings(scenario: string, totalIncome: number, filingStatus: string): number {
  // Rough estimate based on scenario and income level
  const effectiveRate = totalIncome > 200000 ? 0.32 : totalIncome > 100000 ? 0.24 : totalIncome > 50000 ? 0.22 : 0.12;
  switch (scenario) {
    case 'oil_gas': return Math.round(totalIncome * 0.05 * effectiveRate); // IDC/depletion potential
    case 'crypto': return Math.round(totalIncome * 0.03 * effectiveRate); // tax-loss harvesting
    case 'rental': return Math.round(totalIncome * 0.02 * effectiveRate); // depreciation
    case 'capital_gains': return Math.round(totalIncome * 0.02 * effectiveRate); // timing strategies
    case 'business': return Math.round(totalIncome * 0.04 * effectiveRate); // SE deductions
    case 'retirement': return Math.round(Math.min(23000, totalIncome * 0.1) * effectiveRate); // 401k/IRA
    default: return Math.round(totalIncome * 0.01 * effectiveRate);
  }
}

export default optimizer;
