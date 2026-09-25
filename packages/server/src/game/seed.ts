// Loads the versioned world seed (real clubs and squads) produced by tools/importer.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NamePool, Traits } from '@ffm/engine';

export interface SeedClub {
  key: string; name: string; short: string; league: 'PL' | 'EUR' | 'CHAMP' | 'WORLD'; country: string; colors: [string, string];
  stadium: string; capacity: number; reputation: number; archetype: string; rivals: string[]; lastPos: number | null; europe: 'UCL' | 'UEL' | null;
}
export interface SeedPlayer {
  sid: number; club: string | null; name: string; short: string; first: string; last: string; nat: string; age: number;
  foot: 'L' | 'R' | 'B'; h: number; pos: Record<string, number>; a: number[]; hd: number[]; ca: number; pa: number; wage: number; cy: number; no: number | null; fc?: number;
  tr?: Traits;
  wk?: 1;
}
export interface Seed {
  version: string;
  upgrades?: { v2?: { firstSid: number; patched: number[] } };
  season: string;
  source: string;
  clubs: SeedClub[];
  players: SeedPlayer[];
  namePools: Record<string, NamePool>;
  nations: Record<string, [string, string]>;
}

let cached: Seed | null = null;

export function loadSeed(): Seed {
  if (cached) return cached;
  const here = (() => { try { return dirname(fileURLToPath(import.meta.url)); } catch { return process.cwd(); } })();
  const candidates = [
    process.env.SEED_PATH,
    join(here, 'seed.json'),
    join(here, '..', 'seed.json'),
    join(process.cwd(), 'data', 'seed', 'world-seed.json'),
    join(here, '..', '..', '..', '..', 'data', 'seed', 'world-seed.json'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) {
      cached = JSON.parse(readFileSync(p, 'utf8')) as Seed;
      return cached;
    }
  }
  throw new Error(`World seed not found (looked in ${candidates.join(', ')})`);
}

let pools: Record<string, NamePool> | null = null;
export function namePools(): Record<string, NamePool> {
  if (!pools) pools = loadSeed().namePools;
  return pools;
}
