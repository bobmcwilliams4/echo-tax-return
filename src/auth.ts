// Echo Tax Return — Authentication & Authorization
import { Context, Next } from 'hono';
import type { Env } from './types';

/** Validate API key from X-Echo-API-Key header or Authorization bearer */
export function requireAuth() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const apiKey = c.req.header('X-Echo-API-Key') || extractBearer(c.req.header('Authorization'));
    if (!apiKey || apiKey !== c.env.ECHO_API_KEY) {
      return c.json({ error: 'Unauthorized', message: 'Valid API key required' }, 401);
    }
    await next();
  };
}

/** Check if request is from Commander (has elevated privileges) */
export function isCommander(c: Context<{ Bindings: Env }>): boolean {
  const email = c.req.header('X-Commander-Email');
  return email === c.env.COMMANDER_EMAIL;
}

/** Commander-only middleware */
export function requireCommander() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!isCommander(c)) {
      return c.json({ error: 'Forbidden', message: 'Commander access required' }, 403);
    }
    await next();
  };
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

/** Generate a unique ID with prefix */
export function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${ts}${rand}`;
}
