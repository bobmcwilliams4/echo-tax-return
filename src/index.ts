// Echo Tax Return — Main Hono Application
// Income Tax Return Preparation Service API
// Commander: Bobby Don McWilliams II | PTIN: In Progress
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, TaxReturn } from './types';
import { requireAuth, isCommander, generateId } from './auth';
import { calculateTaxReturn, generateForm1040 } from './calculator';
import clients from './clients';
import returns from './returns';
import documents from './documents';
import optimizer from './optimizer';
import billing from './billing';

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ────────────────────────────────────────────────────
app.use('*', cors({
  origin: [
    'https://echo-ept.com',
    'https://echo-op.com',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Echo-API-Key', 'X-User-Id', 'X-Commander-Email'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));

// ─── Health Check (no auth) ──────────────────────────────────
app.get('/health', async (c) => {
  const dbCheck = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM clients').first<{ cnt: number }>().catch(() => null);
  return c.json({
    status: 'healthy',
    service: 'echo-tax-return',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: dbCheck ? 'connected' : 'error',
    clients: dbCheck?.cnt || 0,
  });
});

// ─── Public pricing endpoint ─────────────────────────────────
app.get('/pricing', async (c) => {
  return c.json({
    service: 'Echo Tax Return Preparation',
    preparer: 'Bobby Don McWilliams II',
    pricing: [
      { tier: 'basic', price: 150, name: 'Basic Return', description: 'W-2 only, single/joint filing', includes: ['Federal 1040', 'Standard deduction', 'W-2 income', 'Child Tax Credit', 'E-file'] },
      { tier: 'standard', price: 250, name: 'Standard Return', description: 'W-2 + 1099 income sources', includes: ['Everything in Basic', '1099-INT/DIV/NEC', 'Schedule 1 adjustments', 'Itemized deductions (Schedule A)', 'Student loan interest', 'IRA/HSA deductions'] },
      { tier: 'complex', price: 400, name: 'Complex Return', description: 'Investments, rental, multiple income streams', includes: ['Everything in Standard', 'Capital gains (Schedule D)', 'Rental income (Schedule E)', 'EITC calculation', 'Tax-loss harvesting analysis', 'TX engine optimization'] },
      { tier: 'business', price: 600, name: 'Business Return', description: 'Self-employment, Schedule C, partnerships', includes: ['Everything in Complex', 'Schedule C (business)', 'Schedule SE (self-employment)', 'QBI deduction (Section 199A)', 'Estimated payment planning', 'Retirement planning (SEP-IRA/Solo 401k)'] },
      { tier: 'oilgas', price: 750, name: 'Oil & Gas Specialist', description: 'IDC, depletion, royalties, mineral rights', includes: ['Everything in Business', 'Intangible Drilling Costs (IDC)', 'Percentage/cost depletion', 'Royalty income optimization', 'Working interest analysis', 'Dedicated TX12 engine analysis'] },
    ],
    tax_engines: 'Powered by 14 AI Tax Intelligence Engines (TX01-TX14)',
    year: 2024,
  });
});

// ─── Auth required for all other routes ──────────────────────
app.use('/clients/*', requireAuth());
app.use('/returns/*', requireAuth());
app.use('/documents/*', requireAuth());
app.use('/billing/*', requireAuth());
app.use('/stats', requireAuth());

// ─── Mount Route Modules ─────────────────────────────────────
app.route('/clients', clients);
app.route('/returns', returns);
app.route('/documents', documents);
app.route('/billing', billing);

// ─── Tax Calculation Endpoints ───────────────────────────────
app.post('/returns/:id/calculate', requireAuth(), async (c) => {
  const returnId = c.req.param('id');
  try {
    const calculation = await calculateTaxReturn(c.env, returnId);

    // Cache the calculation
    await c.env.CACHE.put(
      `calc:${returnId}`,
      JSON.stringify(calculation),
      { expirationTtl: 3600 } // 1 hour
    );

    return c.json({ calculation });
  } catch (err) {
    return c.json({ error: 'Calculation failed', detail: String(err) }, 500);
  }
});

// ─── Cached Calculation Retrieval ────────────────────────────
app.get('/returns/:id/calculation', requireAuth(), async (c) => {
  const returnId = c.req.param('id');

  // Try cache first
  const cached = await c.env.CACHE.get(`calc:${returnId}`);
  if (cached) {
    return c.json({ calculation: JSON.parse(cached), cached: true });
  }

  // Calculate fresh
  try {
    const calculation = await calculateTaxReturn(c.env, returnId);
    await c.env.CACHE.put(`calc:${returnId}`, JSON.stringify(calculation), { expirationTtl: 3600 });
    return c.json({ calculation, cached: false });
  } catch (err) {
    return c.json({ error: 'Calculation failed', detail: String(err) }, 500);
  }
});

// ─── Form 1040 Generation ────────────────────────────────────
app.get('/returns/:id/forms', requireAuth(), async (c) => {
  const returnId = c.req.param('id');
  try {
    const form = await generateForm1040(c.env, returnId);
    return c.json({ form_1040: form });
  } catch (err) {
    return c.json({ error: 'Form generation failed', detail: String(err) }, 500);
  }
});

// ─── Optimization (mount optimizer routes) ───────────────────
app.route('/returns', optimizer);

// ─── Mark Return for Review ──────────────────────────────────
app.post('/returns/:id/review', requireAuth(), async (c) => {
  const returnId = c.req.param('id');
  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first<TaxReturn>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  if (ret.total_tax === 0 && ret.total_income === 0) {
    return c.json({ error: 'Return has not been calculated yet. Run /calculate first.' }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE returns SET status = 'review', updated_at = datetime('now') WHERE id = ?"
  ).bind(returnId).run();

  // Store to Shared Brain for Commander notification
  try {
    await c.env.SHARED_BRAIN.fetch(
      new Request('https://internal/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: 'echo-tax-return',
          role: 'system',
          content: `TAX RETURN READY FOR REVIEW: Return ${returnId}, Tax Year ${ret.tax_year}, ` +
            `Income: $${ret.total_income.toLocaleString()}, Refund/Owed: $${ret.refund_or_owed.toLocaleString()}`,
          importance: 8,
          tags: ['tax_return', 'review_needed'],
        }),
      })
    );
  } catch {
    // Non-critical — continue even if brain notification fails
  }

  return c.json({ return_id: returnId, status: 'review', message: 'Return marked for preparer review' });
});

// ─── Dashboard Stats ─────────────────────────────────────────
app.get('/stats', async (c) => {
  if (!isCommander(c)) return c.json({ error: 'Commander access required' }, 403);

  const [clientCount, returnsByStatus, revenueStats, recentReturns] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM clients').first<{ cnt: number }>(),
    c.env.DB.prepare(`
      SELECT status, COUNT(*) as cnt, SUM(total_income) as total_income, SUM(refund_or_owed) as total_refund
      FROM returns GROUP BY status
    `).all(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt, SUM(amount) as total FROM payments WHERE status = 'completed'").first<{ cnt: number; total: number }>(),
    c.env.DB.prepare(`
      SELECT r.id, r.tax_year, r.status, r.total_income, r.refund_or_owed, r.updated_at,
             c.first_name, c.last_name
      FROM returns r JOIN clients c ON r.client_id = c.id
      ORDER BY r.updated_at DESC LIMIT 10
    `).all(),
  ]);

  return c.json({
    dashboard: {
      clients: clientCount?.cnt || 0,
      returns_by_status: returnsByStatus.results,
      revenue: {
        payments_completed: revenueStats?.cnt || 0,
        total_collected: revenueStats?.total || 0,
      },
      recent_returns: recentReturns.results,
    },
  });
});

// ─── 404 Handler ─────────────────────────────────────────────
app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    message: `Route ${c.req.method} ${c.req.path} not found`,
    service: 'echo-tax-return',
    docs: '/health for status, /pricing for service info',
  }, 404);
});

// ─── Error Handler ───────────────────────────────────────────
app.onError((err, c) => {
  console.error(`[echo-tax-return] Error: ${err.message}`, err.stack);
  return c.json({
    error: 'Internal Server Error',
    message: err.message,
    service: 'echo-tax-return',
  }, 500);
});

export default app;
