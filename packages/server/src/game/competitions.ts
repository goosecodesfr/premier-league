// Competition structures: fixture creation, draws, standings and progression.
import { Rng, hashHex } from '@ffm/engine';
import { insertMany, type Db } from '../db.ts';
import { MINUTE } from '../lib/time.ts';
import type { CompetitionRow, CompType, FixtureRow, WorldRow } from './types.ts';

export interface NewFixture {
  compId: number;
  round: number;
  stage: string;
  leg?: number;
  tieKey?: string | null;
  grp?: string | null;
  home: number;
  away: number;
  kickoff: Date;
  neutral?: boolean;
}

export async function createFixtures(d: Db, world: WorldRow, list: NewFixture[]): Promise<void> {
  if (!list.length) return;
  const rows = list.map((f) => [
    world.season_no, f.compId, f.round, f.stage, f.leg ?? 1, f.tieKey ?? null, f.grp ?? null, f.home, f.away,
    f.kickoff, new Date(f.kickoff.getTime() - world.settings.deadlineMinutes * MINUTE),
    hashHex(`${world.secret}:${world.season_no}:${f.compId}:${f.round}:${f.leg ?? 1}:${f.home}:${f.away}`), !!f.neutral,
  ]);
  await insertMany(d, 'fixtures', ['season_no', 'competition_id', 'round', 'stage', 'leg', 'tie_key', 'grp', 'home_id', 'away_id', 'kickoff_at', 'deadline_at', 'seed', 'neutral'], rows);
}

/** Double round-robin via the circle method. Returns rounds of [home, away] pairs. */
export function roundRobin(teams: number[], rng: Rng): [number, number][][] {
  const t = rng.shuffle(teams.slice());
  if (t.length % 2) t.push(-1);
  const n = t.length;
  const rounds: [number, number][][] = [];
  const arr = t.slice();
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a < 0 || b < 0) continue;
      // alternate venues so every club gets a fair home/away rhythm
      const flip = i === 0 ? r % 2 === 1 : (r + i) % 2 === 1;
      pairs.push(flip ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()!);
  }
  const second = rounds.map((rd) => rd.map(([h, a]) => [a, h] as [number, number]));
  return [...rounds, ...second];
}

// ---------------------------------------------------------------- standings
export interface StandingRow {
  clubId: number;
  p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number;
  form: ('W' | 'D' | 'L')[];
}

export function computeStandings(fixtures: Pick<FixtureRow, 'home_id' | 'away_id' | 'home_goals' | 'away_goals' | 'status' | 'kickoff_at'>[], clubIds: number[]): StandingRow[] {
  const map = new Map<number, StandingRow>();
  for (const id of clubIds) map.set(id, { clubId: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] });
  const played = fixtures.filter((f) => f.status === 'played' && f.home_goals !== null).sort((a, b) => +new Date(a.kickoff_at) - +new Date(b.kickoff_at));
  for (const f of played) {
    const h = map.get(f.home_id);
    const a = map.get(f.away_id);
    if (!h || !a) continue;
    const hg = f.home_goals!;
    const ag = f.away_goals!;
    h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L'); }
    else if (hg < ag) { a.w++; h.l++; a.pts += 3; a.form.push('W'); h.form.push('L'); }
    else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
  }
  const rows = [...map.values()];
  for (const r of rows) { r.gd = r.gf - r.ga; r.form = r.form.slice(-5); }
  rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.clubId - y.clubId);
  return rows;
}

export async function leagueStandings(d: Db, seasonNo: number): Promise<StandingRow[]> {
  const comp = await d.one<CompetitionRow>(`select * from competitions where season_no = $1 and type = 'league'`, [seasonNo]);
  if (!comp) return [];
  const fx = await d.many<FixtureRow>('select home_id, away_id, home_goals, away_goals, status, kickoff_at from fixtures where competition_id = $1', [comp.id]);
  return computeStandings(fx, comp.data.entrants ?? []);
}

// ---------------------------------------------------------------- knockout helpers
/** Winner of a single fixture (knockout) or of a two-legged tie (pass the second leg). */
export function fixtureWinner(f: FixtureRow): number | null {
  return f.winner_id ?? null;
}

const STAGE_ORDER = ['R1', 'R32', 'R16', 'QF', 'SF', 'F'];
export function nextStageName(stage: string): string {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : 'F';
}

export function stageLabel(type: CompType, stage: string, grp?: string | null): string {
  const map: Record<string, string> = {
    R1: 'First round', R32: 'Third round', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', F: 'Final',
  };
  if (stage.startsWith('GS')) return `Group ${grp ?? ''} · Matchday ${stage.slice(2)}`;
  if (stage.startsWith('R') && /^R\d+$/.test(stage) && type === 'league') return `Matchweek ${stage.slice(1)}`;
  if (type === 'fa_cup' && stage === 'R32') return 'Third round';
  if (type === 'fa_cup' && stage === 'R16') return 'Fourth round';
  return map[stage] ?? stage;
}

/** Random or seeded pairing for a knockout round. */
export function drawPairs(teams: number[], rng: Rng, avoid?: (a: number, b: number) => boolean): [number, number][] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const t = rng.shuffle(teams.slice());
    const pairs: [number, number][] = [];
    let ok = true;
    for (let i = 0; i + 1 < t.length; i += 2) {
      if (avoid && avoid(t[i], t[i + 1]) && attempt < 45) { ok = false; break; }
      pairs.push([t[i], t[i + 1]]);
    }
    if (ok) return pairs;
  }
  const t = rng.shuffle(teams.slice());
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < t.length; i += 2) pairs.push([t[i], t[i + 1]]);
  return pairs;
}

/** European group draw: 4 pots by strength, avoid same-country clubs in a group where possible. */
export function groupDraw(ranked: { id: number; country: string }[], rng: Rng): Record<string, number[]> {
  const groups: Record<string, { id: number; country: string }[]> = {};
  const letters = 'ABCDEFGH'.split('');
  for (const l of letters) groups[l] = [];
  const pots = [0, 1, 2, 3].map((i) => rng.shuffle(ranked.slice(i * 8, i * 8 + 8)));
  for (const pot of pots) {
    for (const team of pot) {
      const open = letters.filter((l) => groups[l].length < pots.indexOf(pot) + 1);
      const preferred = open.filter((l) => !groups[l].some((x) => x.country === team.country));
      const pickFrom = preferred.length ? preferred : open;
      const l = pickFrom[Math.floor(rng.next() * pickFrom.length)];
      groups[l].push(team);
    }
  }
  return Object.fromEntries(letters.map((l) => [l, groups[l].map((x) => x.id)]));
}

export const GROUP_SCHEDULE: [number, number][][] = [
  [[0, 1], [2, 3]],
  [[3, 0], [1, 2]],
  [[0, 2], [3, 1]],
  [[1, 0], [3, 2]],
  [[0, 3], [2, 1]],
  [[2, 0], [1, 3]],
];
