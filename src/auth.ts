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

/** Rate limiting middleware using KV */
export function rateLimit(maxRequests: number = 60, windowSeconds: number = 60) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const key = `rl:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

    try {
      const current = await c.env.CACHE.get(key);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= maxRequests) {
        return c.json({
          error: 'Rate limited',
          message: `Maximum ${maxRequests} requests per ${windowSeconds}s exceeded`,
          retry_after: windowSeconds,
        }, 429);
      }

      await c.env.CACHE.put(key, String(count + 1), { expirationTtl: windowSeconds * 2 });
    } catch {
      // If KV fails, allow request through
    }

    await next();
  };
}

/** Input sanitization — strip HTML/script tags from string fields */
export function sanitize(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[<>'"]/g, '')
    .trim()
    .slice(0, 1000);
}

/** Validate SSN format (XXX-XX-XXXX or XXXXXXXXX) */
export function isValidSSN(ssn: string): boolean {
  const cleaned = ssn.replace(/[-\s]/g, '');
  return /^\d{9}$/.test(cleaned) && cleaned !== '000000000' && !cleaned.startsWith('9');
}

/** Validate email format */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Request logging middleware */
export function requestLogger() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`[${c.req.method}] ${c.req.path} → ${c.res.status} (${duration}ms)`);
  };
}
