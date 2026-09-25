// Shared helpers for route handlers: lookups, validation and the compact shapes the client renders.
import {
  Rng, attrsFromArray, displayAttr, displayRating, naturalPositions, bestPosition, moraleLabel, injuryRangeText, type Pos,
} from '@ffm/engine';
import { db, type Db } from '../db.ts';
import { ApiError, type Ctx } from '../http/router.ts';
import { getWorld } from '../game/world.ts';
import { hiddenOf, isAvailable } from '../game/players.ts';
import { stageLabel } from '../game/competitions.ts';
import type { ClubRow, CompType, FixtureRow, PlayerRow, WorldRow } from '../game/types.ts';
import { COMP_NAMES } from '../game/types.ts';

export async function world(d: Db = db): Promise<WorldRow> {
  const w = await getWorld(d);
  if (!w) throw new ApiError('NOT_SETUP', 'The league has not been set up yet.');
  return w;
}

export async function myClub(ctx: Ctx, d: Db = db, lock = false): Promise<ClubRow> {
  const c = await d.one<ClubRow>(`select * from clubs where user_id = $1${lock ? ' for update' : ''}`, [ctx.user!.id]);
  if (!c) throw new ApiError('FORBIDDEN', 'Pick a club first.');
  return c;
}

export async function myClubOrNull(ctx: Ctx): Promise<ClubRow | null> {
  if (!ctx.user) return null;
  return db.one<ClubRow>('select * from clubs where user_id = $1', [ctx.user.id]);
}

export function int(v: unknown, name: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ApiError('VALIDATION_FAILED', `${name} must be a number`);
  const r = Math.round(n);
  if (opts.min !== undefined && r < opts.min) throw new ApiError('VALIDATION_FAILED', `${name} must be at least ${opts.min}`);
  if (opts.max !== undefined && r > opts.max) throw new ApiError('VALIDATION_FAILED', `${name} must be at most ${opts.max}`);
  return r;
}

export function optInt(v: unknown, name: string, opts: { min?: number; max?: number } = {}): number | null {
  if (v === undefined || v === null || v === '') return null;
  return int(v, name, opts);
}

export function str(v: unknown, name: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof v !== 'string') throw new ApiError('VALIDATION_FAILED', `${name} is required`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw new ApiError('VALIDATION_FAILED', `${name} must be at least ${opts.min} characters`);
  if (opts.max !== undefined && s.length > opts.max) throw new ApiError('VALIDATION_FAILED', `${name} must be at most ${opts.max} characters`);
  return s;
}

export function oneOf<T extends string>(v: unknown, name: string, options: readonly T[]): T {
  if (typeof v !== 'string' || !options.includes(v as T)) throw new ApiError('VALIDATION_FAILED', `${name} must be one of ${options.join(', ')}`);
  return v as T;
}

export function idParam(ctx: Ctx, name = 'id'): number {
  return int(ctx.params[name], name, { min: 1 });
}

// ---------------------------------------------------------------- clubs
export interface ClubLite {
  id: number; key: string; name: string; short: string; colors: [string, string]; league: string; human: boolean; managerName: string | null;
}

export function clubLite(c: Pick<ClubRow, 'id' | 'key' | 'name' | 'short' | 'colors' | 'league' | 'manager_type'> & { user_name?: string | null; bot?: ClubRow['bot'] }): ClubLite {
  return {
    id: c.id, key: c.key, name: c.name, short: c.short, colors: c.colors, league: c.league, human: c.manager_type === 'human',
    managerName: c.manager_type === 'human' ? c.user_name ?? null : c.bot?.name ?? null,
  };
}

/** All clubs as lite objects keyed by id (cheap: 92 rows). */
export async function clubMap(d: Db = db): Promise<Map<number, ClubLite>> {
  const rows = await d.many<ClubRow & { user_name: string | null }>(
    `select c.id, c.key, c.name, c.short, c.colors, c.league, c.manager_type, c.bot, u.display_name user_name
       from clubs c left join users u on u.id = c.user_id`);
  return new Map(rows.map((r) => [r.id, clubLite(r)]));
}

// ---------------------------------------------------------------- players
export interface PlayerLite {
  id: number; name: string; short: string; age: number; nat: string; foot: string; pos: Pos[]; best: Pos; ovr: number;
  condition: number; sharpness: number; form: number[]; morale: string; injury: { type: string; daysLeft: number; severity: string; range: string } | null;
  suspended: number; value: number; wage: number; contractUntil: number; yearsLeft: number; number: number | null; clubId: number | null;
  status: string; available: boolean; listed: boolean; wantsOut: boolean; newSigning: boolean; rested: boolean; fatigue: number;
}

export function playerLite(p: PlayerRow, seasonNo: number): PlayerLite {
  const nat = naturalPositions(p.positions);
  return {
    id: p.id, name: p.name, short: p.short, age: p.age, nat: p.nat, foot: p.foot,
    pos: nat.length ? nat : [bestPosition(p.positions)], best: bestPosition(p.positions), ovr: displayRating(p.ca),
    condition: Math.round(p.condition), sharpness: Math.round(p.sharpness), form: (p.form_history ?? []).slice(-6), morale: moraleLabel(p.morale),
    injury: p.injury && p.injury.daysLeft > 0 ? { type: p.injury.type, daysLeft: p.injury.daysLeft, severity: p.injury.severity, range: injuryRangeText(p.injury.daysLeft) } : null,
    suspended: p.suspended, value: Number(p.value), wage: p.wage, contractUntil: p.contract_until, yearsLeft: p.contract_until - seasonNo,
    number: p.squad_number, clubId: p.club_id, status: p.status, available: isAvailable(p),
    listed: !!p.flags?.listed, wantsOut: !!p.flags?.wantsOut, newSigning: p.flags?.newSigning === seasonNo, rested: !!p.flags?.rested,
    fatigue: Math.round(p.fatigue_debt),
  };
}

/** How much a club knows about a player (0..100). Own players are fully known. */
export async function knowledgeOf(clubId: number | null, p: Pick<PlayerRow, 'id' | 'club_id'>, league?: string | null): Promise<number> {
  if (clubId && p.club_id === clubId) return 100;
  let base = league === 'PL' ? 45 : league === 'EUR' ? 25 : league === 'WORLD' ? 15 : 30;
  if (clubId) {
    const s = await db.one<{ knowledge: number }>('select knowledge from scouting where club_id = $1 and player_id = $2', [clubId, p.id]);
    if (s) base = Math.max(base, s.knowledge);
  }
  return base;
}

/** Scout assessment: potential as a range and hidden traits as prose, with accuracy from knowledge. */
export function scoutAssessment(p: PlayerRow, knowledge: number, clubId: number | null) {
  const h = hiddenOf(p);
  const width = Math.round(((100 - knowledge) / 100) * 30);
  const rng = new Rng(`scout:${p.id}:${clubId ?? 0}:${Math.floor(knowledge / 10)}`);
  const centre = p.pa + (rng.next() - 0.5) * width * 0.7;
  const lo = Math.max(p.ca, Math.round(centre - width / 2));
  const hi = Math.min(200, Math.max(lo, Math.round(centre + width / 2)));
  const est = (lo + hi) / 2;
  const potLabel = est - p.ca < 5 ? 'at his peak' : est >= 175 ? 'world class' : est >= 160 ? 'excellent' : est >= 145 ? 'strong' : est >= 125 ? 'decent' : 'limited';
  const traits: string[] = [];
  if (knowledge >= 50) {
    if (h.consistency >= 15) traits.push('Very consistent'); else if (h.consistency <= 6) traits.push('Inconsistent');
    if (h.importantMatches >= 15) traits.push('Big-game player'); else if (h.importantMatches <= 6) traits.push('Can go missing in big games');
    if (h.injuryProneness <= 5) traits.push('Rarely injured'); else if (h.injuryProneness >= 14) traits.push('Injury-prone');
    if (h.professionalism >= 16) traits.push('Model professional'); else if (h.professionalism <= 6) traits.push('Casual attitude');
    if (h.temperament <= 6) traits.push('Hot-headed'); else if (h.temperament >= 16) traits.push('Cool head');
    if (knowledge >= 75) {
      if (h.ambition >= 16) traits.push('Highly ambitious');
      if (h.loyalty >= 16) traits.push('Very loyal');
      if (h.adaptability >= 16) traits.push('Settles quickly');
      if (h.adaptability <= 5) traits.push('Slow to settle');
    }
  }
  const confidence = knowledge >= 90 ? 'certain' : knowledge >= 65 ? 'confident' : knowledge >= 40 ? 'fair' : 'a rough guess';
  const verdict = est >= p.ca + 15 && p.age <= 23 ? 'Sign him' : est >= p.ca + 5 || p.ca >= 150 ? 'Worth a look' : 'Not for us';
  return {
    potential: { label: potLabel, lo: displayAttr(lo), hi: displayAttr(hi) },
    traits,
    confidence,
    knowledge,
    verdict,
  };
}

export function displayAttrs(arr: number[]): Record<string, number> {
  const a = attrsFromArray(arr);
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, displayAttr(v)]));
}

// ---------------------------------------------------------------- fixtures
export interface FixtureLite {
  id: number; compId: number; comp: CompType; compName: string; stage: string; stageLabel: string; leg: number; round: number;
  home: ClubLite; away: ClubLite; kickoff: string; deadline: string; status: string; score: [number, number] | null;
  pens: { home: number; away: number } | null; et: boolean; winnerId: number | null; neutral: boolean; word?: [string, string] | null;
}

export function fixtureLite(f: FixtureRow & { comp_type?: CompType; comp_name?: string }, clubs: Map<number, ClubLite>): FixtureLite {
  const type = (f.comp_type ?? 'league') as CompType;
  const summary = f.summary as { word?: [string, string] } | null;
  return {
    id: f.id, compId: f.competition_id, comp: type, compName: f.comp_name ?? COMP_NAMES[type], stage: f.stage,
    stageLabel: stageLabel(type, f.stage, f.grp), leg: f.leg, round: f.round,
    home: clubs.get(f.home_id)!, away: clubs.get(f.away_id)!, kickoff: new Date(f.kickoff_at).toISOString(), deadline: new Date(f.deadline_at).toISOString(),
    status: f.status, score: f.status === 'played' ? [f.home_goals ?? 0, f.away_goals ?? 0] : null, pens: f.pens, et: f.extra_time,
    winnerId: f.winner_id, neutral: f.neutral, word: summary?.word ?? null,
  };
}

export const FIXTURE_SELECT = `select f.id, f.season_no, f.competition_id, f.round, f.stage, f.leg, f.tie_key, f.grp, f.home_id, f.away_id, f.kickoff_at,
  f.deadline_at, f.status, f.home_goals, f.away_goals, f.extra_time, f.pens, f.winner_id, f.seed, f.neutral, f.attendance, f.weather, f.played_at,
  jsonb_build_object('word', f.summary->'word') summary, c.type comp_type, c.name comp_name
  from fixtures f join competitions c on c.id = f.competition_id`;

export function money(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `£${(a / 1_000_000).toFixed(a >= 100_000_000 ? 0 : 1).replace(/\.0$/, '')}m` : a >= 1000 ? `£${Math.round(a / 1000)}k` : `£${a}`;
  return v < 0 ? `-${s}` : s;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
