// Echo Tax Return — Main Hono Application
// Income Tax Return Preparation Service API
// Commander: Bobby Don McWilliams II | PTIN: In Progress
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, TaxReturn } from './types';
import { requireAuth, isCommander, generateId, rateLimit, requestLogger, auditMiddleware } from './auth';
import { calculateTaxReturn, generateForm1040 } from './calculator';
import clients from './clients';
import returns from './returns';
import documents from './documents';
import optimizer from './optimizer';
import billing from './billing';
import efile from './efile';
import features from './features';
import advanced from './advanced';

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ────────────────────────────────────────────────────
app.use('*', cors({
  origin: [
    'https://echo-ept.com',
    'https://echo-op.com',
    'https://echo-lgt.com',
    'https://www.echo-lgt.com',
    'https://echo-lgtcom.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Echo-API-Key', 'X-User-Id', 'X-Commander-Email'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));

// ─── Security: Rate Limiting + Request Logging ──────────────
app.use('*', requestLogger());
app.use('/clients/*', rateLimit(100, 60));
app.use('/returns/*', rateLimit(100, 60));
app.use('/documents/*', rateLimit(30, 60));
app.use('/billing/*', rateLimit(10, 60));

// ─── Security Headers ───────────────────────────────────────
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('X-XSS-Protection', '1; mode=block');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// ─── Health Check (no auth) ──────────────────────────────────
app.get('/health', async (c) => {
  const dbCheck = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM clients').first<{ cnt: number }>().catch(() => null);
  return c.json({
    status: 'healthy',
    service: 'echo-tax-return',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
    features: ['multi-year', 'what-if', 'audit-risk', 'amendments', 'penalty-calc', 'notes', 'engagement-letter', 'export', 'income-projector', 'tax-calendar', 'tax-tips', 'withholding-estimator', 'batch-calculate', 'return-diff', 'document-checklist', 'bracket-analysis', 'return-locking', 'client-portal', 'deduction-maximizer', 'client-summary', 'return-timeline', 'tax-knowledge-search', 'return-snapshot', 'return-validation', 'preparer-dashboard', 'audit-logging', 'se-tax-calculator', 'safe-harbor-analysis', 'print-package', 'income-analysis', 'key-numbers-reference', 'communications-log'],
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

// ─── API Documentation (no auth) ────────────────────────────
app.get('/docs', (c) => {
  return c.json({
    service: 'echo-tax-return',
    version: '3.1.0',
    preparer: 'Bobby Don McWilliams II',
    base_url: 'https://echo-tax-return.bmcii1976.workers.dev',
    auth: { header: 'X-Echo-API-Key', alt: 'Authorization: Bearer <key>' },
    endpoints: {
      public: [
        { method: 'GET', path: '/health', description: 'Service health check' },
        { method: 'GET', path: '/pricing', description: 'Service pricing tiers' },
        { method: 'GET', path: '/docs', description: 'API documentation' },
      ],
      clients: [
        { method: 'POST', path: '/clients', description: 'Create client profile' },
        { method: 'GET', path: '/clients/:id', description: 'Get client details' },
        { method: 'PUT', path: '/clients/:id', description: 'Update client profile' },
        { method: 'GET', path: '/clients', description: 'List all clients (Commander)' },
      ],
      returns: [
        { method: 'POST', path: '/returns', description: 'Create tax return' },
        { method: 'GET', path: '/returns/:id', description: 'Get return details' },
        { method: 'GET', path: '/returns', description: 'List returns (filter by client/year/status)' },
        { method: 'POST', path: '/returns/:id/calculate', description: 'Calculate tax return' },
        { method: 'GET', path: '/returns/:id/calculation', description: 'Get cached calculation' },
        { method: 'GET', path: '/returns/:id/forms', description: 'Generate Form 1040 + schedules' },
        { method: 'POST', path: '/returns/:id/review', description: 'Mark return for review' },
        { method: 'POST', path: '/returns/:id/optimize', description: 'Get TX engine optimization suggestions' },
      ],
      income: [
        { method: 'POST', path: '/returns/:id/income', description: 'Add income item' },
        { method: 'DELETE', path: '/returns/:id/income/:itemId', description: 'Remove income item' },
      ],
      deductions: [
        { method: 'POST', path: '/returns/:id/deductions', description: 'Add deduction' },
        { method: 'DELETE', path: '/returns/:id/deductions/:dedId', description: 'Remove deduction' },
      ],
      dependents: [
        { method: 'POST', path: '/returns/:id/dependents', description: 'Add dependent' },
        { method: 'DELETE', path: '/returns/:id/dependents/:depId', description: 'Remove dependent' },
      ],
      filing: [
        { method: 'GET', path: '/returns/:id/filing-package', description: 'Get filing package' },
        { method: 'POST', path: '/returns/:id/file', description: 'File return (efile/paper)' },
        { method: 'POST', path: '/returns/batch-file', description: 'Batch file all returns for client' },
        { method: 'GET', path: '/returns/:id/printable', description: 'Get printable return' },
      ],
      documents: [
        { method: 'POST', path: '/documents/upload', description: 'Upload W-2/1099/receipt' },
        { method: 'GET', path: '/documents/:returnId', description: 'List documents for return' },
        { method: 'POST', path: '/documents/:id/parse', description: 'Parse document with OCR' },
      ],
      tools: [
        { method: 'POST', path: '/returns/:id/what-if', description: 'What-if tax scenario' },
        { method: 'GET', path: '/returns/compare?client_id=X', description: 'Multi-year comparison' },
        { method: 'GET', path: '/returns/:id/audit-risk', description: 'Audit risk assessment' },
        { method: 'POST', path: '/returns/:id/withholding-estimate', description: 'W-4 withholding estimator' },
        { method: 'GET', path: '/returns/:id/summary', description: 'Comprehensive return summary' },
        { method: 'GET', path: '/returns/supported-years', description: 'Supported tax years' },
        { method: 'POST', path: '/returns/:id/estimated-payments', description: 'Add estimated payment' },
        { method: 'GET', path: '/returns/:id/estimated-payments', description: 'List estimated payments' },
        { method: 'POST', path: '/returns/:id/amendments', description: 'Create amendment (1040-X)' },
        { method: 'GET', path: '/returns/:id/amendments', description: 'List amendments' },
        { method: 'GET', path: '/returns/tax-calendar?year=N', description: 'IRS tax deadline calendar' },
        { method: 'GET', path: '/returns/:id/tips', description: 'Personalized tax tips' },
        { method: 'GET', path: '/returns/:id/penalty-estimate', description: 'Underpayment penalty estimate (Form 2210)' },
        { method: 'POST', path: '/returns/:id/notes', description: 'Add preparer note/memo' },
        { method: 'GET', path: '/returns/:id/notes', description: 'List notes for return' },
        { method: 'DELETE', path: '/returns/:id/notes/:noteId', description: 'Delete a note' },
        { method: 'GET', path: '/returns/:id/engagement-letter', description: 'Generate engagement letter' },
        { method: 'GET', path: '/returns/:id/export?format=json|csv', description: 'Export return data' },
        { method: 'POST', path: '/returns/:id/project', description: 'Income/tax projector (multi-year forward)' },
        { method: 'POST', path: '/returns/:id/duplicate', description: 'Duplicate return to new tax year' },
        { method: 'GET', path: '/returns/activity/:clientId', description: 'Client activity log' },
        { method: 'GET', path: '/returns/tax-reference/:topic', description: 'Tax law quick reference' },
        { method: 'GET', path: '/returns/:id/health', description: 'Return completeness health check' },
      ],
      advanced: [
        { method: 'POST', path: '/returns/batch-calculate', description: 'Batch calculate all returns for client' },
        { method: 'GET', path: '/returns/diff?return_a=X&return_b=Y', description: 'Side-by-side return comparison' },
        { method: 'GET', path: '/returns/:id/document-checklist', description: 'Required documents checklist' },
        { method: 'GET', path: '/returns/:id/bracket-analysis', description: 'Marginal rate & bracket breakdown' },
        { method: 'POST', path: '/returns/:id/lock', description: 'Lock/unlock return for editing' },
        { method: 'GET', path: '/returns/:id/lock-status', description: 'Check return lock status' },
        { method: 'POST', path: '/returns/portal-token', description: 'Generate client portal access token' },
        { method: 'GET', path: '/returns/portal/:token', description: 'Client portal read-only view' },
        { method: 'GET', path: '/returns/:id/deduction-opportunities', description: 'Find unclaimed deduction opportunities' },
        { method: 'GET', path: '/returns/client-summary/:clientId', description: 'Comprehensive client dashboard summary' },
        { method: 'GET', path: '/returns/:id/timeline', description: 'Return activity timeline' },
        { method: 'GET', path: '/returns/tax-knowledge/search?q=X', description: 'Tax knowledge reference search' },
        { method: 'POST', path: '/returns/:id/snapshot', description: 'Create point-in-time return snapshot' },
        { method: 'GET', path: '/returns/:id/validate', description: 'Pre-filing validation check' },
        { method: 'GET', path: '/returns/preparer/dashboard', description: 'Preparer dashboard (Commander only)' },
      ],
      billing: [
        { method: 'POST', path: '/billing/checkout', description: 'Create Stripe checkout session' },
        { method: 'POST', path: '/billing/webhook', description: 'Stripe webhook handler' },
      ],
      audit: [
        { method: 'GET', path: '/returns/audit-log', description: 'List audit entries with pagination (Commander only)' },
        { method: 'GET', path: '/returns/audit-log/export', description: 'Export audit log as JSON (Commander only)' },
        { method: 'GET', path: '/returns/audit-log/stats', description: 'Audit statistics — counts by action, severity, top users (Commander only)' },
      ],
      professional: [
        { method: 'GET', path: '/returns/key-numbers/:year', description: 'Tax reference data — brackets, deductions, limits, EITC, mileage' },
        { method: 'POST', path: '/returns/communications', description: 'Log client communication (email, call, meeting)' },
        { method: 'GET', path: '/returns/communications/:clientId', description: 'List communications for client' },
        { method: 'GET', path: '/returns/:id/se-tax', description: 'Self-employment tax calculator (Schedule SE, quarterly estimates, retirement)' },
        { method: 'GET', path: '/returns/:id/safe-harbor', description: 'IRS safe harbor analysis (90%/100%/110% thresholds, penalty risk)' },
        { method: 'GET', path: '/returns/:id/print-package', description: 'Comprehensive print-ready return summary' },
        { method: 'GET', path: '/returns/:id/income-analysis', description: 'Income source diversification & concentration risk' },
      ],
      admin: [
        { method: 'GET', path: '/stats', description: 'Dashboard stats (Commander only)' },
      ],
    },
    supported_years: [2019, 2020, 2021, 2022, 2023, 2024],
    tax_engines: 'TX01-TX14 (14 AI Tax Intelligence Engines)',
  });
});

// ─── Auth required for all other routes ──────────────────────
app.use('/clients/*', requireAuth());
app.use('/returns/*', requireAuth());
app.use('/documents/*', requireAuth());
app.use('/billing/*', requireAuth());
app.use('/stats', requireAuth());

// ─── Audit Logging (after auth, logs authenticated requests) ─
app.use('*', auditMiddleware());

// ─── Mount Route Modules ─────────────────────────────────────
// IMPORTANT: features and efile mount BEFORE returns so static
// paths like /supported-years, /compare, /tax-calendar, /batch-calculate
// don't get swallowed by returns' /:id catch-all route.
app.route('/clients', clients);
app.route('/returns', features);
app.route('/returns', efile);
app.route('/returns', advanced);
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
