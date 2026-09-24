// Postgres access. Works with Supabase (pooler), Neon, or any standard Postgres URL.
import pg from 'pg';

const { Pool, types } = pg;
// Return bigint (int8) columns as JS numbers (money values stay well below 2^53).
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

let pool: pg.Pool | null = null;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Add your Postgres connection string as an environment variable.');
  return url;
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const raw = databaseUrl();
  const u = new URL(raw);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname) || process.env.DATABASE_SSL === 'disable';
  // Strip sslmode from the URL: we configure TLS explicitly so managed providers work out of the box.
  u.searchParams.delete('sslmode');
  u.searchParams.delete('supa');
  pool = new Pool({
    connectionString: u.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX || 4),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    // No statement_timeout here: startup parameters are rejected by some poolers (e.g. PgBouncer).
  });
  pool.on('error', (e) => console.error('pg pool error', e.message));
  return pool;
}

export type Q = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

export interface Db {
  q: Q;
  one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
  many<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

function wrap(q: Q): Db {
  return {
    q,
    async one<T>(text: string, params?: unknown[]) {
      const r = await q(text, params);
      return (r.rows[0] as T) ?? null;
    },
    async many<T>(text: string, params?: unknown[]) {
      const r = await q(text, params);
      return r.rows as T[];
    },
  };
}

export const db: Db = wrap((text, params) => getPool().query(text, params as unknown[]));

/** Run a function inside a transaction. */
export async function tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(wrap((text, params) => client.query(text, params as unknown[])));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Build a multi-row VALUES clause: values(rows, cols) -> { text: '($1,$2),($3,$4)', params } */
export function valuesClause(rows: unknown[][], startAt = 1): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  let i = startAt;
  const text = rows.map((r) => `(${r.map((v) => { params.push(v); return `$${i++}`; }).join(',')})`).join(',');
  return { text, params };
}

/** Insert many rows in chunks. */
export async function insertMany(d: Db, table: string, cols: string[], rows: unknown[][], suffix = '', chunk = 500): Promise<pg.QueryResult[]> {
  const out: pg.QueryResult[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const v = valuesClause(part);
    out.push(await d.q(`insert into ${table} (${cols.join(',')}) values ${v.text} ${suffix}`, v.params));
  }
  return out;
}
