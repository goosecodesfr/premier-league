// The one API client: JSON envelope in, typed data out, typed errors thrown.
export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'DEADLINE_PASSED' | 'WINDOW_CLOSED'
  | 'INSUFFICIENT_FUNDS' | 'SQUAD_INVALID' | 'CONFLICT' | 'RATE_LIMITED' | 'NOT_SETUP' | 'INTERNAL' | 'OFFLINE';

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;
  constructor(code: ErrorCode, message: string, status = 0, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export const authEvents = new EventTarget();

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('OFFLINE', 'You appear to be offline.');
  }
  let env: Envelope<T>;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError('INTERNAL', `The server replied with an error (${res.status}).`, res.status);
  }
  if (!env.ok) {
    if (env.error.code === 'UNAUTHENTICATED' && path !== '/auth/login') authEvents.dispatchEvent(new Event('logout'));
    throw new ApiError(env.error.code, env.error.message, res.status, env.error.details);
  }
  return env.data;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | boolean | null | undefined | (string | number)[]>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}
