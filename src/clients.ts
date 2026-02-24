// Echo Tax Return — Client CRUD Endpoints
import { Hono } from 'hono';
import type { Env, Client, CreateClientRequest, UpdateClientRequest } from './types';
import { generateId, isCommander } from './auth';
import { encryptSSN, maskSSN, decryptSSN } from './crypto';

const clients = new Hono<{ Bindings: Env }>();

// ─── Create Client ───────────────────────────────────────────
clients.post('/', async (c) => {
  const body = await c.req.json<CreateClientRequest>();
  if (!body.first_name || !body.last_name) {
    return c.json({ error: 'first_name and last_name are required' }, 400);
  }

  const id = generateId('cli');
  const userId = c.req.header('X-User-Id') || id;
  let ssnEncrypted: string | null = null;

  if (body.ssn) {
    const cleaned = body.ssn.replace(/\D/g, '');
    if (cleaned.length !== 9) {
      return c.json({ error: 'SSN must be 9 digits' }, 400);
    }
    ssnEncrypted = await encryptSSN(cleaned, c.env.SSN_ENCRYPTION_KEY);
  }

  await c.env.DB.prepare(`
    INSERT INTO clients (id, user_id, email, first_name, last_name, ssn_encrypted, dob, phone,
      address_street, address_city, address_state, address_zip, filing_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, body.email || null, body.first_name, body.last_name, ssnEncrypted,
    body.dob || null, body.phone || null, body.address_street || null,
    body.address_city || null, body.address_state || null, body.address_zip || null,
    body.filing_status || null
  ).run();

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Client>();
  return c.json({ client: sanitizeClient(client!) }, 201);
});

// ─── Get Client by ID ────────────────────────────────────────
clients.get('/:id', async (c) => {
  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?')
    .bind(c.req.param('id')).first<Client>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const output: Record<string, unknown> = sanitizeClient(client);
  if (isCommander(c) && client.ssn_encrypted) {
    output.ssn_last4 = maskSSN(await decryptSSN(client.ssn_encrypted, c.env.SSN_ENCRYPTION_KEY));
  }
  return c.json({ client: output });
});

// ─── List Clients (Commander only for all, otherwise user's own) ──
clients.get('/', async (c) => {
  let rows: Client[];
  if (isCommander(c)) {
    const result = await c.env.DB.prepare('SELECT * FROM clients ORDER BY created_at DESC LIMIT 500').all<Client>();
    rows = result.results;
  } else {
    const userId = c.req.header('X-User-Id');
    if (!userId) return c.json({ error: 'X-User-Id header required' }, 400);
    const result = await c.env.DB.prepare('SELECT * FROM clients WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId).all<Client>();
    rows = result.results;
  }
  return c.json({ clients: rows.map(sanitizeClient), count: rows.length });
});

// ─── Update Client ───────────────────────────────────────────
clients.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Client>();
  if (!existing) return c.json({ error: 'Client not found' }, 404);

  const body = await c.req.json<UpdateClientRequest>();
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email || null); }
  if (body.first_name) { fields.push('first_name = ?'); values.push(body.first_name); }
  if (body.last_name) { fields.push('last_name = ?'); values.push(body.last_name); }
  if (body.dob !== undefined) { fields.push('dob = ?'); values.push(body.dob || null); }
  if (body.phone !== undefined) { fields.push('phone = ?'); values.push(body.phone || null); }
  if (body.address_street !== undefined) { fields.push('address_street = ?'); values.push(body.address_street || null); }
  if (body.address_city !== undefined) { fields.push('address_city = ?'); values.push(body.address_city || null); }
  if (body.address_state !== undefined) { fields.push('address_state = ?'); values.push(body.address_state || null); }
  if (body.address_zip !== undefined) { fields.push('address_zip = ?'); values.push(body.address_zip || null); }
  if (body.filing_status !== undefined) { fields.push('filing_status = ?'); values.push(body.filing_status || null); }

  if (body.ssn) {
    const cleaned = body.ssn.replace(/\D/g, '');
    if (cleaned.length !== 9) return c.json({ error: 'SSN must be 9 digits' }, 400);
    const enc = await encryptSSN(cleaned, c.env.SSN_ENCRYPTION_KEY);
    fields.push('ssn_encrypted = ?');
    values.push(enc);
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push("updated_at = datetime('now')");
  const sql = `UPDATE clients SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  const stmt = c.env.DB.prepare(sql);
  let bound = stmt;
  for (let i = 0; i < values.length; i++) {
    bound = bound.bind(values[i]);
  }
  // Workaround: use batch bind approach
  await c.env.DB.prepare(sql).bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Client>();
  return c.json({ client: sanitizeClient(updated!) });
});

// ─── Delete Client ───────────────────────────────────────────
clients.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Client>();
  if (!existing) return c.json({ error: 'Client not found' }, 404);

  // Check for active returns
  const activeReturns = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM returns WHERE client_id = ? AND status NOT IN ('filed', 'accepted', 'rejected')"
  ).bind(id).first<{ cnt: number }>();

  if (activeReturns && activeReturns.cnt > 0) {
    return c.json({ error: 'Cannot delete client with active returns' }, 409);
  }

  await c.env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
  return c.json({ deleted: true, id });
});

/** Remove encrypted SSN from client output */
function sanitizeClient(client: Client): Record<string, unknown> {
  const { ssn_encrypted, ...safe } = client;
  return { ...safe, has_ssn: !!ssn_encrypted };
}

export default clients;
