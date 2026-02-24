// Echo Tax Return — Stripe Billing Integration
import { Hono } from 'hono';
import type { Env } from './types';
import { generateId, isCommander } from './auth';

const billing = new Hono<{ Bindings: Env }>();

// Pricing tiers
const PRICING = {
  basic: { amount: 15000, description: 'Basic Tax Return (W-2 only)', name: 'Basic Return' },
  standard: { amount: 25000, description: 'Standard Tax Return (W-2 + 1099s)', name: 'Standard Return' },
  complex: { amount: 40000, description: 'Complex Tax Return (Business, Rental, Investments)', name: 'Complex Return' },
  business: { amount: 60000, description: 'Business Tax Return (Schedule C/Partnership/S-Corp)', name: 'Business Return' },
  oilgas: { amount: 75000, description: 'Oil & Gas Tax Return (IDC, Depletion, Royalties)', name: 'Oil & Gas Specialist' },
} as const;

type PricingTier = keyof typeof PRICING;

// ─── Create Checkout Session ─────────────────────────────────
billing.post('/checkout', async (c) => {
  const body = await c.req.json<{
    client_id: string;
    return_id: string;
    tier: PricingTier;
    success_url?: string;
    cancel_url?: string;
  }>();

  if (!body.client_id || !body.return_id || !body.tier) {
    return c.json({ error: 'client_id, return_id, and tier are required' }, 400);
  }

  const pricing = PRICING[body.tier];
  if (!pricing) {
    return c.json({ error: 'Invalid tier', valid_tiers: Object.keys(PRICING) }, 400);
  }

  // Verify client and return exist
  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(body.client_id).first<any>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const ret = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(body.return_id).first<any>();
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  // Create Stripe checkout session via API
  const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'payment_method_types[0]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': pricing.name,
      'line_items[0][price_data][product_data][description]': pricing.description,
      'line_items[0][price_data][unit_amount]': pricing.amount.toString(),
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': body.success_url || 'https://echo-ept.com/tax-returns?payment=success&session_id={CHECKOUT_SESSION_ID}',
      'cancel_url': body.cancel_url || 'https://echo-ept.com/tax-returns?payment=cancelled',
      'client_reference_id': body.return_id,
      'customer_email': client.email || '',
      'metadata[client_id]': body.client_id,
      'metadata[return_id]': body.return_id,
      'metadata[tier]': body.tier,
      'metadata[tax_year]': ret.tax_year.toString(),
    }),
  });

  if (!stripeResp.ok) {
    const err = await stripeResp.text();
    return c.json({ error: 'Stripe error', detail: err }, 500);
  }

  const session = await stripeResp.json() as any;

  // Record payment in D1
  const paymentId = generateId('pay');
  await c.env.DB.prepare(`
    INSERT INTO payments (id, client_id, return_id, amount, stripe_session_id, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).bind(paymentId, body.client_id, body.return_id, pricing.amount / 100, session.id).run();

  return c.json({
    checkout_url: session.url,
    session_id: session.id,
    payment_id: paymentId,
    amount: pricing.amount / 100,
    tier: body.tier,
  });
});

// ─── Stripe Webhook Handler ──────────────────────────────────
billing.post('/webhook', async (c) => {
  const body = await c.req.text();
  // In production, verify Stripe signature with webhook secret
  // For now, process the event
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sessionId = session.id;
    const returnId = session.metadata?.return_id || session.client_reference_id;

    // Update payment status
    await c.env.DB.prepare(
      "UPDATE payments SET status = 'completed' WHERE stripe_session_id = ?"
    ).bind(sessionId).run();

    // Update return status if in intake/documents
    if (returnId) {
      await c.env.DB.prepare(`
        UPDATE returns SET
          status = CASE WHEN status IN ('intake', 'documents') THEN 'documents' ELSE status END,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(returnId).run();
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const sessionId = charge.payment_intent;
    await c.env.DB.prepare(
      "UPDATE payments SET status = 'refunded' WHERE stripe_session_id = ?"
    ).bind(sessionId).run();
  }

  return c.json({ received: true });
});

// ─── Get Pricing ─────────────────────────────────────────────
billing.get('/pricing', async (c) => {
  const tiers = Object.entries(PRICING).map(([key, val]) => ({
    tier: key,
    price: val.amount / 100,
    price_display: `$${(val.amount / 100).toFixed(0)}`,
    name: val.name,
    description: val.description,
  }));
  return c.json({ pricing: tiers });
});

// ─── List Payments (Commander only) ──────────────────────────
billing.get('/payments', async (c) => {
  if (!isCommander(c)) {
    return c.json({ error: 'Commander access required' }, 403);
  }

  const status = c.req.query('status');
  let sql = `SELECT p.*, c.first_name, c.last_name, r.tax_year
    FROM payments p
    JOIN clients c ON p.client_id = c.id
    LEFT JOIN returns r ON p.return_id = r.id`;
  const params: string[] = [];

  if (status) {
    sql += ' WHERE p.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY p.created_at DESC LIMIT 200';

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  const totalRevenue = result.results
    .filter((p: any) => p.status === 'completed')
    .reduce((s: number, p: any) => s + p.amount, 0);

  return c.json({
    payments: result.results,
    count: result.results.length,
    total_revenue: totalRevenue,
  });
});

// ─── Revenue Stats ───────────────────────────────────────────
billing.get('/stats', async (c) => {
  if (!isCommander(c)) return c.json({ error: 'Commander access required' }, 403);

  const [completed, pending, refunded] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt, SUM(amount) as total FROM payments WHERE status = 'completed'").first<{ cnt: number; total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt, SUM(amount) as total FROM payments WHERE status = 'pending'").first<{ cnt: number; total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt, SUM(amount) as total FROM payments WHERE status = 'refunded'").first<{ cnt: number; total: number }>(),
  ]);

  return c.json({
    revenue: {
      completed: { count: completed?.cnt || 0, total: completed?.total || 0 },
      pending: { count: pending?.cnt || 0, total: pending?.total || 0 },
      refunded: { count: refunded?.cnt || 0, total: refunded?.total || 0 },
      net: (completed?.total || 0) - (refunded?.total || 0),
    },
  });
});

export default billing;
