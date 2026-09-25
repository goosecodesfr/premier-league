// A tiny router over Node's http primitives. Works identically under Vercel functions and the local server.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE, userFromToken, type SessionUser } from '../lib/auth.ts';
import { flushBox, newOutbox, runInOutbox } from '../game/notify.ts';

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'DEADLINE_PASSED' | 'WINDOW_CLOSED'
  | 'INSUFFICIENT_FUNDS' | 'SQUAD_INVALID' | 'CONFLICT' | 'RATE_LIMITED' | 'NOT_SETUP' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_FAILED: 400, DEADLINE_PASSED: 409, WINDOW_CLOSED: 409,
  INSUFFICIENT_FUNDS: 409, SQUAD_INVALID: 422, CONFLICT: 409, RATE_LIMITED: 429, NOT_SETUP: 412, INTERNAL: 500,
};

export class ApiError extends Error {
  code: ErrorCode;
  details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const bad = (msg: string, details?: unknown) => new ApiError('VALIDATION_FAILED', msg, details);

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  user: SessionUser | null;
  cookies: Record<string, string>;
  secure: boolean;
  ip: string;
  headers: Record<string, string[]>;
  setHeader(name: string, value: string): void;
  /** Work to run after the response is sent (keeps the function alive where supported). */
  after(fn: () => Promise<unknown>): void;
  /** True when after() work is guaranteed to finish (local server, or Vercel waitUntil). */
  canDefer: boolean;
}

export type Auth = 'none' | 'user' | 'admin';
type Handler = (ctx: Ctx) => Promise<unknown>;
interface Route { method: string; parts: string[]; handler: Handler; auth: Auth }

const routes: Route[] = [];

export function route(method: string, pattern: string, auth: Auth, handler: Handler) {
  routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, auth });
}

function match(r: Route, method: string, parts: string[]): Record<string, string> | null {
  if (r.method !== method || r.parts.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = r.parts[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return params;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<any> {
  const anyReq = req as IncomingMessage & { body?: unknown };
  if (anyReq.body !== undefined && anyReq.body !== null) {
    if (typeof anyReq.body === 'string') return anyReq.body ? JSON.parse(anyReq.body) : {};
    if (Buffer.isBuffer(anyReq.body)) return anyReq.body.length ? JSON.parse(anyReq.body.toString('utf8')) : {};
    return anyReq.body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = typeof c === 'string' ? Buffer.from(c) : (c as Buffer);
    size += b.length;
    if (size > 1_000_000) throw bad('Request body too large');
    chunks.push(b);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw bad('Invalid JSON body');
  }
}

export interface DispatchHooks {
  beforeRoute?: () => Promise<void>;
  waitUntil?: (p: Promise<unknown>) => void;
  /** Set when the host keeps running after the response (a long-lived server). */
  longLived?: boolean;
}

export async function dispatch(req: IncomingMessage, res: ServerResponse, hooks: DispatchHooks = {}): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  let path = url.pathname;
  const forced = url.searchParams.get('__path');
  if (forced) path = '/api/' + forced.replace(/^\/+/, '');
  const parts = path.split('/').filter(Boolean);
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? '';
  const secure = proto.includes('https') || host.includes('vercel.app');
  const headersOut: [string, string][] = [];
  const afterFns: (() => Promise<unknown>)[] = [];

  const send = (status: number, payload: unknown) => {
    if (res.headersSent) return;
    const body = JSON.stringify(payload);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of headersOut) res.appendHeader ? res.appendHeader(k, v) : res.setHeader(k, v);
    res.end(body);
  };

  try {
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    let found: { r: Route; params: Record<string, string> } | null = null;
    for (const r of routes) {
      const p = match(r, method, parts);
      if (p) { found = { r, params: p }; break; }
    }
    if (!found) throw new ApiError('NOT_FOUND', `No route for ${method} ${path}`);
    if (hooks.beforeRoute) await hooks.beforeRoute();
    const cookies = parseCookies(req.headers.cookie);
    const user = await userFromToken(cookies[SESSION_COOKIE]);
    if (found.r.auth !== 'none' && !user) throw new ApiError('UNAUTHENTICATED', 'Please log in.');
    if (found.r.auth === 'admin' && !user?.is_admin) throw new ApiError('FORBIDDEN', 'Admins only.');
    const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req);
    const ip = ((req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] ?? req.socket?.remoteAddress ?? '').trim();
    const ctx: Ctx = {
      req, res, method, path, params: found.params, query: url.searchParams, body, user, cookies, secure, ip,
      headers: {},
      setHeader: (n, v) => headersOut.push([n, v]),
      after: (fn) => afterFns.push(fn),
      canDefer: !!hooks.waitUntil || !!hooks.longLived,
    };
    const ob = newOutbox();
    const data = await runInOutbox(ob, () => found!.r.handler(ctx));
    if (ob.push.length || ob.channel.length) afterFns.push(() => flushBox(ob));
    send(200, { ok: true, data: data ?? null });
  } catch (e) {
    if (e instanceof ApiError) {
      send(STATUS[e.code], { ok: false, error: { code: e.code, message: e.message, details: e.details } });
    } else {
      console.error('API error', method, path, e);
      const msg = e instanceof Error ? e.message : String(e);
      const setup = setupProblem(e);
      if (setup) send(503, { ok: false, error: { code: 'INTERNAL', message: setup } });
      else send(500, { ok: false, error: { code: 'INTERNAL', message: process.env.NODE_ENV === 'production' ? 'Something went wrong on our side.' : msg } });
    }
  }
  if (afterFns.length) {
    const p = (async () => {
      for (const fn of afterFns) {
        try { await fn(); } catch (e) { console.error('after() failed', e); }
      }
    })();
    if (hooks.waitUntil) hooks.waitUntil(p);
    else await p;
  }
}

/** Hosting/database configuration problems get a plain explanation, even in production. */
export function setupProblem(e: unknown): string | null {
  const err = e as { message?: string; code?: string } | null;
  const m = String(err?.message ?? e ?? '');
  const code = String(err?.code ?? '');
  const hint = 'Check DATABASE_URL in Vercel (Settings → Environment Variables), use Supabase\'s "Transaction pooler" string (port 6543), then redeploy.';
  if (/DATABASE_URL is not set/.test(m)) return m + ' Then redeploy.';
  if (code === 'ERR_INVALID_URL' || /Invalid URL/i.test(m)) return `DATABASE_URL is not a valid connection string. If your database password contains symbols, reset it to letters and digits only. ${hint}`;
  if (code === '28P01' || /password authentication failed/i.test(m)) return `The database rejected the password in DATABASE_URL. Make sure you replaced [YOUR-PASSWORD] (including the brackets) with your real database password. ${hint}`;
  if (/Tenant or user not found/i.test(m)) return `Supabase did not recognise the user in DATABASE_URL (it should look like postgres.abcdefghijkl). Copy the string again from Connect → Transaction pooler. ${hint}`;
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET'].includes(code) || /timeout exceeded when trying to connect|Connection terminated|connect ETIMEDOUT/i.test(m)) {
    return `Cannot connect to the database (${code || m.slice(0, 80)}). If you copied the "Direct connection" string, it will not work from Vercel. ${hint}`;
  }
  return null;
}
