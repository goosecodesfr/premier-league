// Builds the versioned world seed (data/seed/world-seed.json) from:
//   - tools/importer/data/fc26_players.csv   (community ratings dataset, 1..99 scale)
//   - tools/importer/data/pl_squads_2026.txt (current Premier League first-team squads)
//   - tools/importer/clubs-meta.ts           (club identities, stadiums, archetypes)
// Run: npm run seed
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Rng, attributesFromDataset, attrsToArray, hiddenToArray, deriveFamiliarity, currentAbility,
  generatePlayer, type DatasetRow, type Pos, DATASET_ABILITY_SLOPE, type NamePool, parseDatasetTraits, deriveTraits, attrsFromArray,
  type Traits,
} from '@ffm/engine';
import { NATION_BY_NAME, CODE_ALIASES, NATIONS } from '@ffm/shared';
import { parseCsv } from './csv.ts';
import { CLUBS, type ClubMeta } from './clubs-meta.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SEASON_START_YEAR = 2026;
const REF_DATE = new Date('2026-09-01T00:00:00Z');
const EUR_TO_GBP = 0.86;
const rng = new Rng('ffm-seed-2026-27-v1');
// Separate stream for additions made after v1, so existing players keep identical attributes.
const rng2 = new Rng('ffm-seed-2026-27-v2');

// ---------------------------------------------------------------- helpers
const FC_POS: Record<string, Pos> = {
  GK: 'GK', CB: 'DC', LB: 'DL', RB: 'DR', LWB: 'WBL', RWB: 'WBR', CDM: 'DM', CM: 'MC', CAM: 'AMC',
  LM: 'ML', RM: 'MR', LW: 'AML', RW: 'AMR', ST: 'ST', CF: 'ST',
};

export function norm(s: string): string {
  return s
    .replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[đĐ]/g, 'd').replace(/[łŁ]/g, 'l').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function num(v: string | undefined): number {
  if (!v) return NaN;
  // Some position columns look like "85+3"; attribute columns are plain ints.
  const m = /^-?\d+(\.\d+)?/.exec(v);
  return m ? Number(m[0]) : NaN;
}

interface Row {
  idx: number;
  raw: Record<string, string>;
  longName: string;
  shortName: string;
  club: string;
  league: string;
  overall: number;
  potential: number;
  age: number;
  nat: string;
  positions: Pos[];
  longTokens: Set<string>;
  shortNorm: string;
  shortLast: string;
  claimed: boolean;
}

function ageFromDob(dob: string, fallback: number): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return fallback + 1;
  let age = REF_DATE.getUTCFullYear() - d.getUTCFullYear();
  const m = REF_DATE.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && REF_DATE.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

function toDatasetRow(r: Row): DatasetRow {
  const x = r.raw;
  const g = (k: string) => num(x[k]);
  return {
    overall: r.overall, potential: r.potential, age: r.age,
    heightCm: g('height_cm') || 180, weightKg: g('weight_kg') || 75,
    foot: x.preferred_foot === 'Left' ? 'L' : 'R', weakFoot: g('weak_foot') || 3, skillMoves: g('skill_moves') || 2,
    intlRep: g('international_reputation') || 1, workRate: x.work_rate || 'Medium/Medium', traits: x.player_traits || '',
    positions: r.positions,
    crossing: g('attacking_crossing'), finishing: g('attacking_finishing'), headingAccuracy: g('attacking_heading_accuracy'),
    shortPassing: g('attacking_short_passing'), volleys: g('attacking_volleys'), dribbling: g('skill_dribbling'),
    curve: g('skill_curve'), fkAccuracy: g('skill_fk_accuracy'), longPassing: g('skill_long_passing'), ballControl: g('skill_ball_control'),
    acceleration: g('movement_acceleration'), sprintSpeed: g('movement_sprint_speed'), agility: g('movement_agility'),
    reactions: g('movement_reactions'), balance: g('movement_balance'), shotPower: g('power_shot_power'), jumping: g('power_jumping'),
    stamina: g('power_stamina'), strength: g('power_strength'), longShots: g('power_long_shots'), aggression: g('mentality_aggression'),
    interceptions: g('mentality_interceptions'), attPositioning: g('mentality_positioning'), vision: g('mentality_vision'),
    penalties: g('mentality_penalties'), composure: g('mentality_composure'), defAwareness: g('defending_marking_awareness'),
    standingTackle: g('defending_standing_tackle'), slidingTackle: g('defending_sliding_tackle'),
    gkDiving: g('goalkeeping_diving'), gkHandling: g('goalkeeping_handling'), gkKicking: g('goalkeeping_kicking'),
    gkPositioning: g('goalkeeping_positioning'), gkReflexes: g('goalkeeping_reflexes'), gkSpeed: g('goalkeeping_speed') || undefined,
  };
}

/** Human display name from dataset short/long names: "K. Mbappé" + "Kylian Mbappé Lottin" -> "Kylian Mbappé". */
function displayName(shortName: string, longName: string): { name: string; short: string; first: string; last: string } {
  const m = /^([A-ZÀ-ÝŁØĐŠŽČĆ][a-zà-ÿ]?)\.\s+(.+)$/u.exec(shortName);
  if (m) {
    const initial = m[1];
    const surname = m[2];
    const toks = longName.split(/\s+/);
    const first = toks.find((t) => t.startsWith(initial)) ?? toks[0];
    return { name: `${first} ${surname}`, short: surname, first, last: surname };
  }
  // Mononym or already a full short name
  const toks = shortName.split(/\s+/);
  return { name: shortName, short: toks.length > 1 ? toks[toks.length - 1] : shortName, first: toks[0], last: toks[toks.length - 1] };
}

// ---------------------------------------------------------------- load dataset
const csvText = readFileSync(join(here, 'data', 'fc26_players.csv'), 'utf8');
const csv = parseCsv(csvText);
const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]+/g;
const cleanName = (s: string) => s.replace(NON_LATIN, ' ').replace(/\s+/g, ' ').trim();
for (const x of csv) { x.long_name = cleanName(x.long_name); x.short_name = cleanName(x.short_name); }
const rows: Row[] = csv.map((x, idx) => {
  const positions = (x.player_positions || '').split(',').map((s) => FC_POS[s.trim()]).filter(Boolean) as Pos[];
  const natName = x.nationality_name;
  const nat = NATION_BY_NAME[natName]?.code ?? natName.slice(0, 3).toUpperCase();
  const overall = num(x.overall);
  return {
    idx, raw: x, longName: x.long_name, shortName: x.short_name, club: x.club_name, league: x.league_name,
    overall, potential: Math.max(overall, num(x.potential) || overall),
    age: ageFromDob(x.dob, num(x.age)), nat, positions: positions.length ? [...new Set(positions)] : ['MC'],
    longTokens: new Set(norm(x.long_name).split(' ')), shortNorm: norm(x.short_name),
    shortLast: norm(x.short_name).split(' ').pop() ?? '', claimed: false,
  };
});
console.log(`dataset rows: ${rows.length}`);

const rowsByNat = new Map<string, Row[]>();
for (const r of rows) (rowsByNat.get(r.nat) ?? rowsByNat.set(r.nat, []).get(r.nat)!).push(r);
const byToken = new Map<string, Row[]>();
for (const r of rows) {
  for (const t of new Set([...r.longTokens, r.shortLast, ...r.shortNorm.split(' ')])) {
    if (t.length < 2) continue;
    let arr = byToken.get(t);
    if (!arr) byToken.set(t, (arr = []));
    arr.push(r);
  }
}

// ---------------------------------------------------------------- output types
interface SeedPlayer {
  sid: number; club: string | null; name: string; short: string; first: string; last: string;
  nat: string; age: number; foot: 'L' | 'R' | 'B'; h: number; pos: Record<string, number>;
  a: number[]; hd: number[]; ca: number; pa: number; wage: number; cy: number; no: number | null; fc?: number;
  /** Signature traits. */
  tr?: Traits;
  /** Rest-of-world prospect (added in seed v2). */
  wk?: 1;
}
const players: SeedPlayer[] = [];
let sid = 1;

function wageModel(ca: number, rep: number): number {
  // weekly GBP; calibrated so a 170 CA player at an elite club earns ~£180k
  const w = 1200 * Math.pow(2, (ca - 100) / 13) * (0.35 + (rep / 100) * 0.95);
  return Math.round(w / 500) * 500;
}

function fromRow(r: Row, clubKey: string | null, meta: ClubMeta | null, opts: { number?: number | null; name?: string; movedIn?: boolean } = {}): SeedPlayer {
  const dr = toDatasetRow(r);
  const { attrs, hidden } = attributesFromDataset(dr, rng);
  const foot = dr.foot;
  const fam = deriveFamiliarity(r.positions, foot);
  const ca = currentAbility(attrs, fam);
  const gap = Math.max(0, r.potential - r.overall) * DATASET_ABILITY_SLOPE;
  const pa = Math.min(200, Math.round(ca + (r.age <= 30 ? gap : gap * 0.3) + rng.range(0, 4)));
  const dn = displayName(r.shortName, r.longName);
  const name = opts.name ?? dn.name;
  const nameToks = name.split(/\s+/);
  const short = opts.name ? (/^[A-Z]\./.test(r.shortName) ? dn.short : nameToks.length === 1 ? name : dn.short) : dn.short;
  const rawWage = num(r.raw.wage_eur) * EUR_TO_GBP;
  let wage = Number.isFinite(rawWage) && rawWage > 0 ? Math.round(rawWage / 500) * 500 : wageModel(ca, meta?.reputation ?? 60);
  if (opts.movedIn && meta) wage = Math.max(wage, wageModel(ca, meta.reputation));
  let contractYear = num(r.raw.club_contract_valid_until_year);
  if (!Number.isFinite(contractYear) || opts.movedIn) contractYear = SEASON_START_YEAR + rng.int(3, 5);
  const cy = Math.max(1, Math.min(6, contractYear - SEASON_START_YEAR));
  const jersey = num(r.raw.club_jersey_number);
  return {
    sid: sid++, club: clubKey, name, short, first: dn.first, last: dn.last, nat: r.nat, age: r.age, foot,
    h: num(r.raw.height_cm) || 180, pos: fam as Record<string, number>, a: attrsToArray(attrs), hd: hiddenToArray(hidden),
    ca, pa, wage: Math.max(1000, wage), cy, no: opts.number ?? (Number.isFinite(jersey) ? jersey : null), fc: r.overall,
    tr: datasetTraits(r, attrs, fam, ca),
  };
}

/** Real PlayStyles from the dataset (most squad players have none, as in the source data). */
function datasetTraits(r: Row, _attrs: unknown, _fam: unknown, _ca: number): Traits {
  return parseDatasetTraits(r.raw.player_traits);
}

// ---------------------------------------------------------------- PL squads
interface SquadEntry { no: number | null; pos: string; nat: string; name: string; age?: number; ovr?: number }
const squadText = readFileSync(join(here, 'data', 'pl_squads_2026.txt'), 'utf8');
const squads = new Map<string, SquadEntry[]>();
{
  let current: string | null = null;
  for (const line of squadText.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (t.startsWith('==')) { current = t.slice(2).trim(); squads.set(current, []); continue; }
    const [no, pos, nat, name, age, ovr] = t.split('|').map((s) => s.trim());
    squads.get(current!)!.push({ no: Number(no) || null, pos, nat: CODE_ALIASES[nat] ?? nat, name, age: age ? Number(age) : undefined, ovr: ovr ? Number(ovr) : undefined });
  }
}

const NICK: Record<string, string[]> = {
  kostas: ['konstantinos'], paddy: ['patrick'], jack: ['john'], bobby: ['robert'], billy: ['william'], harry: ['henry', 'harrison'],
  alex: ['alexander', 'alejandro', 'alexandre'], andy: ['andrew'], tino: ['valentino'], nico: ['nicolas', 'nicholas'],
};
function firstNameOk(first: string, r: Row): boolean {
  if (r.longTokens.has(first)) return true;
  for (const t of r.longTokens) {
    if (first.length >= 3 && t.startsWith(first.slice(0, 3))) return true;
    if (first.length >= 4 && t.includes(first)) return true;
  }
  return (NICK[first] ?? []).some((n) => r.longTokens.has(n));
}

function matchPlayer(e: SquadEntry, meta: ClubMeta): { row: Row; score: number } | null {
  const toks = norm(e.name).split(' ').filter(Boolean);
  const cands = new Set<Row>();
  for (const t of toks) for (const r of byToken.get(t) ?? []) cands.add(r);
  let best: { row: Row; score: number } | null = null;
  for (const r of cands) {
    let s = 0;
    const allIn = toks.every((t) => r.longTokens.has(t));
    if (allIn) s += 50;
    if (r.shortNorm === toks.join(' ')) s += 45;
    const last = toks[toks.length - 1];
    if (r.shortLast === last && toks.length > 1 && r.shortNorm.startsWith(toks[0][0])) s += 30;
    if (!allIn && toks.length > 1 && r.longTokens.has(last) && r.longTokens.has(toks[0])) s += 20;
    if (s === 0) continue;
    if (r.nat === e.nat) s += 25; else s -= 20;
    if (r.club === meta.dataset) s += 20;
    if (toks.length > 1 && !firstNameOk(toks[0], r)) s -= 12;
    s += r.overall / 20;
    if (!best || s > best.score) best = { row: r, score: s };
  }
  if (best && best.score >= 55) return best;
  // Fuzzy fallback: transliteration differences (Yarmolyuk / Yarmoliuk) within the same nationality.
  const last = toks[toks.length - 1];
  let fz: { row: Row; score: number } | null = null;
  for (const r of rowsByNat.get(e.nat) ?? []) {
    if (r.claimed) continue;
    const d = lev(r.shortLast, last);
    if (last.length < 5 || d > (last.length < 8 ? 1 : 2)) continue;
    if (toks.length < 2 || !firstNameOk(toks[0], r)) continue;
    const sc = 55 + (r.club === meta.dataset ? 20 : 0) + r.overall / 20 - lev(r.shortLast, last) * 3;
    if (!fz || sc > fz.score) fz = { row: r, score: sc };
  }
  return fz;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const plMetas = CLUBS.filter((c) => c.league === 'PL');
const unmatched: string[] = [];
const genPos = (p: string): Pos => {
  const P = p.toUpperCase();
  if (P === 'GK') return 'GK';
  if (['DF', 'CB'].includes(P)) return rng.pick<Pos>(['DC', 'DC', 'DL', 'DR']);
  if (['LB'].includes(P)) return 'DL';
  if (['RB'].includes(P)) return 'DR';
  if (['MF', 'CM'].includes(P)) return rng.pick<Pos>(['MC', 'MC', 'DM', 'AMC']);
  if (['DM', 'CDM'].includes(P)) return 'DM';
  if (['AM'].includes(P)) return 'AMC';
  if (['LW'].includes(P)) return 'AML';
  if (['RW', 'W'].includes(P)) return 'AMR';
  return rng.pick<Pos>(['ST', 'ST', 'AML', 'AMR']);
};

// First pass: collect matches for all PL clubs, resolve conflicts by score.
const claims = new Map<number, { club: ClubMeta; entry: SquadEntry; score: number }>();
for (const meta of plMetas) {
  const list = squads.get(meta.name);
  if (!list) throw new Error(`No squad for ${meta.name}`);
  for (const e of list) {
    const m = matchPlayer(e, meta);
    if (!m) continue;
    const prev = claims.get(m.row.idx);
    if (!prev || prev.score < m.score) claims.set(m.row.idx, { club: meta, entry: e, score: m.score });
  }
}
const claimedByEntry = new Map<SquadEntry, Row>();
for (const [idx, c] of claims) claimedByEntry.set(c.entry, rows[idx]);

for (const meta of plMetas) {
  const list = squads.get(meta.name)!;
  const clubPlayers: SeedPlayer[] = [];
  for (const e of list) {
    const row = claimedByEntry.get(e);
    if (row && !row.claimed) {
      row.claimed = true;
      clubPlayers.push(fromRow(row, meta.key, meta, { number: e.no, name: e.name, movedIn: row.club !== meta.dataset }));
    } else {
      unmatched.push(`${meta.key}: ${e.name} (${e.pos}, ${e.nat})`);
      clubPlayers.push({ ...genPlaceholder(e, meta) });
    }
  }
  players.push(...clubPlayers);
}

function genPlaceholder(e: SquadEntry, meta: ClubMeta): SeedPlayer {
  const pos = genPos(e.pos);
  const age = e.age ?? rng.int(18, 21);
  const clubLevel = 100 + (meta.reputation - 60) * 1.2;
  const target = e.ovr ? Math.round((e.ovr - 20) * 2.53 + 10) : Math.round(clubLevel + rng.normal(0, 8));
  const g = generatePlayer(rng, { pos, targetCA: target, age });
  g.pa = age <= 23 ? Math.min(190, g.ca + rng.int(12, 40) + (age <= 17 ? 20 : 0)) : g.ca + (age <= 27 ? rng.int(0, 8) : 0);
  const toks = e.name.split(/\s+/);
  return {
    sid: sid++, club: meta.key, name: e.name, short: toks.length > 1 ? toks.slice(1).join(' ') : e.name, first: toks[0], last: toks[toks.length - 1],
    nat: e.nat, age, foot: g.foot, h: g.heightCm, pos: g.familiarity as Record<string, number>, a: attrsToArray(g.attrs),
    hd: hiddenToArray(g.hidden), ca: g.ca, pa: g.pa, wage: wageModel(g.ca, meta.reputation), cy: rng.int(2, 4), no: e.no,
    tr: deriveTraits(attrsFromArray(attrsToArray(g.attrs)), g.familiarity, g.ca, rng2),
  };
}

// ---------------------------------------------------------------- pool clubs
for (const meta of CLUBS.filter((c) => c.league !== 'PL')) {
  const clubRows = rows.filter((r) => r.club === meta.dataset && !r.claimed).sort((a, b) => b.overall - a.overall);
  if (clubRows.length < 18) console.warn(`WARN ${meta.name}: only ${clubRows.length} dataset players`);
  const gks = clubRows.filter((r) => r.positions[0] === 'GK');
  const outs = clubRows.filter((r) => r.positions[0] !== 'GK');
  const pick = [...gks.slice(0, 3), ...outs.slice(0, 23)];
  for (const r of pick) {
    r.claimed = true;
    players.push(fromRow(r, meta.key, meta));
  }
}

// ---------------------------------------------------------------- free agents + reserve pool
const ourDatasets = new Set(CLUBS.map((c) => c.dataset));
const faCands = rows.filter((r) => !r.claimed && !ourDatasets.has(r.club) && r.overall >= 60 && r.overall <= 79 && r.age >= 18 && r.age <= 34);
rng.shuffle(faCands);
// keep position balance: GK 10%, DEF 35%, MID 33%, ATT 22%
const quota = { GK: 0.1, DEF: 0.35, MID: 0.33, ATT: 0.22 } as const;
const lineOf = (p: Pos) => (p === 'GK' ? 'GK' : ['DC', 'DL', 'DR', 'WBL', 'WBR'].includes(p) ? 'DEF' : ['ST', 'AML', 'AMR'].includes(p) ? 'ATT' : 'MID');
const TOTAL_POOL = 650;
const picked: Row[] = [];
const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
for (const r of faCands) {
  const l = lineOf(r.positions[0]) as keyof typeof counts;
  if (counts[l] >= quota[l] * TOTAL_POOL) continue;
  counts[l]++;
  picked.push(r);
  if (picked.length >= TOTAL_POOL) break;
}
picked.forEach((r, i) => {
  r.claimed = true;
  const p = fromRow(r, i < 150 ? null : 'RES', null);
  p.no = null;
  p.cy = 0;
  // free agents ask for a modest wage
  p.wage = Math.round(Math.min(p.wage, wageModel(p.ca, 55)) / 500) * 500;
  players.push(p);
});

// ---------------------------------------------------------------- v2: young talents and rest-of-world clubs
// Appended after every v1 player so existing worlds can be upgraded in place (see server/src/game/upgrade.ts).
interface WorldClubOut {
  key: string; name: string; short: string; league: 'WORLD'; country: string; colors: [string, string]; stadium: string; capacity: number;
  reputation: number; archetype: string; rivals: string[]; lastPos: null; europe: null;
}
const V2_FIRST_SID = sid;
const worldClubs = new Map<string, WorldClubOut>(); // dataset club name -> club
const usedKeys = new Set(CLUBS.map((c) => c.key));
const clubByDataset = new Map(CLUBS.map((c) => [c.dataset, c]));
const clubByName = new Map(CLUBS.flatMap((c) => [[norm(c.name), c], [norm(c.short), c], [norm(c.dataset), c]] as [string, ClubMeta][]));
const squadCount = new Map<string, number>();
for (const p of players) if (p.club && p.club !== 'RES') squadCount.set(p.club, (squadCount.get(p.club) ?? 0) + 1);
const PALETTE: [string, string][] = [['#1D3C8F', '#FFFFFF'], ['#B01E23', '#FFFFFF'], ['#111111', '#F2C200'], ['#0B7A3E', '#FFFFFF'], ['#5B2A86', '#FFFFFF'], ['#E35205', '#111111'], ['#0E6BA8', '#F4D35E'], ['#7A0019', '#F1C400'], ['#FFFFFF', '#1D3C8F'], ['#00843D', '#FDB913']];
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

function worldClubFor(datasetClub: string, rowsForClub: Row[], natHint?: string): WorldClubOut {
  const hit = worldClubs.get(datasetClub);
  if (hit) return hit;
  const words = datasetClub.replace(/[^A-Za-zÀ-ÿ ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['FC', 'CF', 'AC', 'SC', 'Club', 'Clube', 'Atlético', 'Real', 'Sporting', 'the'].includes(w));
  const base = norm(words.join(' ') || datasetClub).replace(/ /g, '').toUpperCase();
  let key = (base.slice(0, 3) || 'WLD').padEnd(3, 'X');
  for (let i = 1; usedKeys.has(key); i++) key = (base.slice(0, 2) + String(i)).slice(0, 4);
  usedKeys.add(key);
  const natCount = new Map<string, number>();
  const clubRows = rows.filter((r) => r.club === datasetClub);
  for (const r of clubRows) natCount.set(r.nat, (natCount.get(r.nat) ?? 0) + 1);
  const country = [...natCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? natHint ?? rowsForClub[0]?.nat ?? 'ENG';
  const top = clubRows.map((r) => r.overall).sort((a, b) => b - a).slice(0, 16);
  const avg = top.length >= 8 ? top.reduce((x, y) => x + y, 0) / top.length : 69;
  const reputation = Math.round(Math.max(40, Math.min(82, 30 + (avg - 60) * 2.2)));
  const short = datasetClub.replace(/^(FC|AC|SC|CF|AS|SL|SK|RC|RSC|KRC|SV|VfB|VfL|TSG|1\. FC|FK|NK|CA|CD|Club Atlético|Club) /, '').replace(/ (FC|CF|SC|AC)$/, '');
  let shortName = short.length > 18 ? short.split(' ')[0] : short;
  if (CLUBS.some((m) => norm(m.short) === norm(shortName) || norm(m.name) === norm(shortName))) shortName = datasetClub;
  const c: WorldClubOut = {
    key, name: datasetClub, short: shortName, league: 'WORLD', country, colors: PALETTE[hash(datasetClub) % PALETTE.length],
    stadium: `${short} Stadium`, capacity: 20000, reputation, archetype: 'youth', rivals: [], lastPos: null, europe: null,
  };
  worldClubs.set(datasetClub, c);
  return c;
}

/** Scale outfield (or keeper) attributes so the player reaches at least the target current ability. */
function liftToCa(p: SeedPlayer, target: number) {
  if (p.ca >= target) return;
  for (let it = 0; it < 6 && p.ca < target; it++) {
    const f = Math.min(1.25, target / Math.max(40, p.ca) + 0.004);
    p.a = p.a.map((v, i) => Math.max(1, Math.min(200, Math.round(v * (isKeeperIdx(i, p) ? f : f)))));
    p.ca = currentAbility(attrsFromArray(p.a), p.pos as never);
  }
}
const isKeeperIdx = (_i: number, _p: SeedPlayer) => true;

const TIER: Record<string, { pa: number; ca: number }> = { A: { pa: 186, ca: 150 }, B: { pa: 178, ca: 140 }, C: { pa: 170, ca: 128 }, D: { pa: 162, ca: 112 } };
const researchText = readFileSync(join(here, 'data', 'prospects_2026.txt'), 'utf8');
const research = researchText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
  const [name, club, nat, pos, age, tier] = l.split('|').map((x) => x.trim());
  return { name, club, nat: CODE_ALIASES[nat] ?? nat, pos: pos as Pos, age: Number(age), tier };
});
const patched: number[] = [];
const v2Added: SeedPlayer[] = [];
let generated = 0;

/** Where a new young talent lives: his real club if it is in the world (and has room), otherwise a rest-of-world club. */
function placeFor(datasetClub: string | null, researchClub: string | null, rowsForClub: Row[], opts: { nat?: string; elite?: boolean } = {}): string | null {
  const cands = [researchClub ? clubByName.get(norm(researchClub)) ?? clubByDataset.get(researchClub) : undefined, datasetClub ? clubByDataset.get(datasetClub) : undefined]
    .filter((m): m is ClubMeta => !!m);
  for (const m of cands) {
    const cap = (m.league === 'PL' ? 31 : 30) + (opts.elite ? 1 : 0);
    if ((squadCount.get(m.key) ?? 0) < cap) {
      squadCount.set(m.key, (squadCount.get(m.key) ?? 0) + 1);
      return m.key;
    }
  }
  // His club is in the world but its squad is full: leave him out rather than invent a duplicate club.
  if (cands.length) return null;
  const home = researchClub ?? datasetClub ?? null;
  if (!home) return null;
  return worldClubFor(home, rowsForClub, opts.nat).key;
}

function applyTier(p: SeedPlayer, tier: string, age: number) {
  const t = TIER[tier];
  if (!t) return false;
  const caFloor = t.ca - Math.max(0, 18 - age) * 6;
  const before = `${p.ca}/${p.pa}`;
  liftToCa(p, caFloor);
  p.pa = Math.max(p.pa, t.pa + rng2.int(0, 5), p.ca + 8);
  return before !== `${p.ca}/${p.pa}`;
}

// 1) The research list: make sure each player exists with at least his tier's ability.
for (const r of research) {
  const toks = norm(r.name).split(' ').filter(Boolean);
  const existing = players.find((p) => { const n = norm(p.name); return toks.every((t) => n.split(' ').includes(t)) && (p.nat === r.nat || toks.length >= 2); });
  if (existing) {
    if (applyTier(existing, r.tier, existing.age)) patched.push(existing.sid);
    continue;
  }
  const row = rows.filter((x) => !x.claimed && toks.every((t) => x.longTokens.has(t) || x.shortNorm.split(' ').includes(t)) && (x.nat === r.nat || toks.length >= 2))
    .sort((a, b) => b.potential - a.potential)[0];
  if (row) {
    const key = placeFor(row.club, r.club, [row], { nat: r.nat, elite: r.tier === 'A' || r.tier === 'B' });
    if (!key) continue;
    row.claimed = true;
    const meta = CLUBS.find((c) => c.key === key) ?? null;
    const p = fromRow(row, key, meta, { name: r.name });
    p.wk = 1;
    applyTier(p, r.tier, p.age);
    v2Added.push(p);
    continue;
  }
  // Not in the ratings data: generate him at his real club.
  const t = TIER[r.tier] ?? TIER.D;
  const g = generatePlayer(rng2, { pos: r.pos, targetCA: t.ca - Math.max(0, 18 - r.age) * 6 - 4, age: r.age });
  const key = placeFor(null, r.club, [], { nat: r.nat, elite: r.tier === 'A' || r.tier === 'B' });
  if (!key) continue;
  const nameToks = r.name.split(/\s+/);
  const p: SeedPlayer = {
    sid: 0, club: key, name: r.name, short: nameToks.length > 1 ? nameToks.slice(1).join(' ') : r.name, first: nameToks[0], last: nameToks[nameToks.length - 1],
    nat: r.nat, age: r.age, foot: g.foot, h: g.heightCm, pos: g.familiarity as Record<string, number>, a: attrsToArray(g.attrs), hd: hiddenToArray(g.hidden),
    ca: g.ca, pa: 0, wage: wageModel(g.ca, 60), cy: rng2.int(3, 5), no: null, tr: deriveTraits(attrsFromArray(attrsToArray(g.attrs)), g.familiarity, g.ca + 20, rng2), wk: 1,
  };
  applyTier(p, r.tier, r.age);
  v2Added.push(p);
  generated++;
}

// 2) Every other top young talent in the ratings data that the world does not have yet.
const prospectRows = rows
  .filter((r) => !r.claimed && r.age <= 21 && r.overall >= 58 && (r.potential >= 80 || (r.age <= 19 && r.potential >= 78)))
  .sort((a, b) => b.potential - a.potential || b.overall - a.overall)
  .slice(0, 380);
for (const r of prospectRows) {
  const key = placeFor(r.club, null, [r], { nat: r.nat });
  if (!key) continue;
  r.claimed = true;
  const meta = CLUBS.find((c) => c.key === key) ?? null;
  const p = fromRow(r, key, meta);
  p.wk = 1;
  // A year on from the ratings snapshot: youngsters have grown a little.
  const growth = r.age <= 18 ? 6 : r.age <= 20 ? 4 : 2;
  liftToCa(p, Math.min(p.pa - 4, p.ca + growth));
  v2Added.push(p);
}
for (const p of v2Added) { p.sid = sid++; players.push(p); }
console.log(`v2: ${v2Added.length} young talents added (${generated} generated), ${patched.length} existing players lifted, ${worldClubs.size} rest-of-world clubs`);

// ---------------------------------------------------------------- name pools
const pools: Record<string, NamePool> = {};
{
  const tmp: Record<string, { first: Map<string, number>; last: Map<string, number> }> = {};
  for (const r of rows) {
    const dn = displayName(r.shortName, r.longName);
    if (!dn.first || !dn.last || dn.first === dn.last) continue;
    if (dn.first.length < 2 || dn.last.length < 2 || /\d/.test(dn.name)) continue;
    const t = (tmp[r.nat] ??= { first: new Map(), last: new Map() });
    t.first.set(dn.first, (t.first.get(dn.first) ?? 0) + 1);
    t.last.set(dn.last, (t.last.get(dn.last) ?? 0) + 1);
  }
  for (const [nat, t] of Object.entries(tmp)) {
    if (t.last.size < 12) continue;
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
    pools[nat] = { first: top(t.first, 70), last: top(t.last, 110) };
  }
}

// ---------------------------------------------------------------- write
const clubsOut = [...CLUBS.map((c) => ({
  key: c.key, name: c.name, short: c.short, league: c.league, country: c.country, colors: c.colors,
  stadium: c.stadium, capacity: c.capacity, reputation: c.reputation, archetype: c.archetype,
  rivals: c.rivals ?? [], lastPos: c.lastPos ?? null, europe: c.europe ?? null,
})), ...worldClubs.values()];

const seed = {
  version: '2026-27.2',
  /** World data upgrades for leagues created from an earlier seed. */
  upgrades: { v2: { firstSid: V2_FIRST_SID, patched } },
  generatedAt: new Date().toISOString(),
  season: '2026-27',
  source: 'Ratings and PlayStyles: community FC 26 dataset (update 4). Squads: Wikipedia club pages, September 2026. Young talents: Goal NXGN 2026, Striver, Passion4FM and FM Scout wonderkid lists.',
  clubs: clubsOut,
  players,
  namePools: pools,
  nations: Object.fromEntries(Object.values(NATIONS).map((n) => [n.code, [n.name, n.flag]])),
};

const outDir = join(root, 'data', 'seed');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'world-seed.json'), JSON.stringify(seed));

// ---------------------------------------------------------------- report
console.log(`players: ${players.length} (club ${players.filter((p) => p.club && p.club !== 'RES').length}, free ${players.filter((p) => p.club === null).length}, reserve ${players.filter((p) => p.club === 'RES').length})`);
console.log(`name pools: ${Object.keys(pools).length} nations`);
console.log(`unmatched PL entries (${unmatched.length}):\n  ${unmatched.join('\n  ')}`);
const byClub = new Map<string, SeedPlayer[]>();
for (const p of players) if (p.club && p.club !== 'RES') (byClub.get(p.club) ?? byClub.set(p.club, []).get(p.club)!).push(p);
const lines: string[] = [];
for (const c of CLUBS) {
  const ps = (byClub.get(c.key) ?? []).slice().sort((a, b) => b.ca - a.ca);
  const top = ps.slice(0, 16);
  const avg = top.reduce((s, p) => s + p.ca, 0) / Math.max(1, top.length);
  const wageBill = ps.reduce((s, p) => s + p.wage, 0) * 52;
  lines.push(`${c.key.padEnd(4)} ${c.league.padEnd(5)} n=${String(ps.length).padStart(2)} top16CA=${avg.toFixed(1)} best=${ps[0]?.name} (${ps[0]?.ca}) wages=£${(wageBill / 1e6).toFixed(0)}m`);
}
console.log(lines.join('\n'));

if (process.env.SEED_DEBUG) {
  for (const [idx, c] of claims) {
    const r = rows[idx];
    if (c.score < 75) console.log(`low-score ${c.score.toFixed(0)}: ${c.club.key} "${c.entry.name}" -> "${r.shortName}" / ${r.longName} (${r.club}, ${r.nat}, ${r.overall})`);
  }
}
