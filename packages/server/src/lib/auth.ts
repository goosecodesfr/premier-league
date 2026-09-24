// Username + password auth with scrypt hashing and httpOnly session cookies.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from '../db.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, salt, expected.length, { ...PARAMS, N: Number(n) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[b[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const SESSION_COOKIE = 'ffm_session';
export const SESSION_DAYS = 90;

export async function createSession(userId: number): Promise<string> {
  const token = randomToken();
  await db.q('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || \' days\')::interval)', [sha256(token), userId, String(SESSION_DAYS)]);
  return token;
}

export async function destroySession(token: string) {
  await db.q('delete from sessions where token_hash = $1', [sha256(token)]);
}

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  prefs: Record<string, unknown>;
}

export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await db.one<SessionUser & { expires_at: Date }>(
    `select u.id, u.username, u.display_name, u.is_admin, u.prefs, s.expires_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  if (!row) return null;
  // touch (at most once per hour to avoid write amplification)
  void db.q("update users set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '1 hour')", [row.id]).catch(() => {});
  return { id: row.id, username: row.username, display_name: row.display_name, is_admin: row.is_admin, prefs: row.prefs ?? {} };
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function validUsername(u: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,24}$/.test(u);
}
