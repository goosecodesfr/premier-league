// Vercel serverless entry: every /api/* request lands here (see scripts/vercel-build.mjs).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatch, migrate } from './api.ts';

interface VercelRequestContext { waitUntil?: (p: Promise<unknown>) => void }

/** Vercel exposes the per-request context (with waitUntil) on a well-known global symbol. */
function requestContext(): VercelRequestContext {
  const holder = (globalThis as Record<symbol, { get?: () => VercelRequestContext } | undefined>)[Symbol.for('@vercel/request-context')];
  return holder?.get?.() ?? {};
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const ctx = requestContext();
  const waitUntil = typeof ctx.waitUntil === 'function' ? (p: Promise<unknown>) => ctx.waitUntil!(p) : undefined;
  await dispatch(req, res, { beforeRoute: () => migrate(), waitUntil });
}
