// Decision-effects harness: how much does each managerial decision move the numbers?
// Runs a mid-table side against a like-for-like opponent many times per variant and reports
// the change against the baseline. Usage: npx tsx tools/harness/decisions.ts [runs]
import { simulateMatch, type MatchResult, type TeamInput, type Tactic } from '@ffm/engine';
import { loadSeed, buildClubs, teamInput, formationTactic, type HClub } from './world.ts';

const RUNS = Number(process.argv[2] ?? 300);
const seed = loadSeed();
const clubs = buildClubs(seed);
const pick = (key: string) => clubs.find((c) => c.club.key === key)!;
const A = pick(process.env.TEAM ?? 'BRE');
const B = pick(process.env.OPP ?? 'FUL');

interface Agg { n: number; pts: number; gf: number; ga: number; xgf: number; xga: number; poss: number; shots: number; extra: Record<string, number> }
const blank = (): Agg => ({ n: 0, pts: 0, gf: 0, ga: 0, xgf: 0, xga: 0, poss: 0, shots: 0, extra: {} });

type Variant = { name: string; team: (base: TeamInput) => TeamInput; opp?: (base: TeamInput) => TeamInput; metrics?: (r: MatchResult, side: 0 | 1, inp: TeamInput) => Record<string, number> };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const withIns = (patch: Partial<Tactic['instructions']>, mentality?: number) => (t: TeamInput): TeamInput => {
  const n = clone(t);
  n.tactic.instructions = { ...n.tactic.instructions, ...patch };
  if (mentality !== undefined) n.tactic.mentality = mentality;
  return n;
};
const statOf = (r: MatchResult, id: number) => r.players.find((p) => p.playerId === id);

function run(v: Variant, baseA: TeamInput, baseB: TeamInput): Agg {
  const agg = blank();
  for (let i = 0; i < RUNS; i++) {
    const home = i % 2 === 0;
    const a = v.team(clone(baseA));
    const b = v.opp ? v.opp(clone(baseB)) : clone(baseB);
    const r = simulateMatch(home ? a : b, home ? b : a, {
      seed: `dec-${i}`, competition: 'league', importance: 1, neutral: false, homeAdvantage: 4, derby: false, weather: 'clear', knockout: false, maxSubs: 5,
    });
    const s = home ? 0 : 1;
    const gf = r.score[s], ga = r.score[1 - s];
    agg.n++; agg.gf += gf; agg.ga += ga; agg.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
    agg.xgf += r.stats[s].xg; agg.xga += r.stats[1 - s].xg; agg.poss += r.stats[s].possession; agg.shots += r.stats[s].shots;
    const d = r.decisions[s];
    const m: Record<string, number> = {
      ppda: d.ppda, highWins: d.pressWinsHigh, thrConc: d.throughCompleted, crosses: r.stats[s].crosses, leftPct: d.flank[0], centrePct: d.flank[1],
      counters: d.counters, fatigue: r.players.filter((p) => p.side === s && p.started).reduce((x, p) => x + p.conditionEnd, 0) / 11,
      fouls: r.stats[s].fouls, yellows: r.stats[s].yellows, oppThrough: r.stats[1 - s].throughBallsCompleted,
      ...(v.metrics ? v.metrics(r, s as 0 | 1, a) : {}),
    };
    for (const [k, val] of Object.entries(m)) agg.extra[k] = (agg.extra[k] ?? 0) + val;
  }
  return agg;
}

const baseTac = formationTactic('4-2-3-1');
const baseA = teamInput(A, clone(baseTac), false);
const baseB = teamInput(B, clone(baseTac), true);
const idAt = (t: TeamInput, pos: string) => t.lineup[t.tactic.slots.findIndex((s) => s.pos === pos)];
const slotOf = (t: TeamInput, pos: string) => t.tactic.slots.findIndex((s) => s.pos === pos);

const wingerId = idAt(baseA, 'AML');
const strikerId = idAt(baseA, 'ST');
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
const variants: Variant[] = [
  { name: 'Baseline', team: (t) => t },
  { name: 'Very attacking (+2)', team: withIns({}, 2) },
  { name: 'Very defensive (-2)', team: withIns({}, -2) },
  { name: 'All-out press, always', team: withIns({ press: 'all_out', pressTrigger: 'always', counterPress: true }) },
  { name: 'Low press', team: withIns({ press: 'low', pressTrigger: 'on_loss' }) },
  { name: 'Very high line + trap', team: withIns({ line: 'very_high', offsideTrap: true }) },
  { name: 'Deep line', team: withIns({ line: 'deep' }) },
  { name: 'Wide + overlap', team: withIns({ width: 'wide', overlap: 'overlap' }) },
  { name: 'Narrow', team: withIns({ width: 'narrow' }) },
  { name: 'Short, slow, patient', team: withIns({ passing: 'short', tempo: 'slow', playOutOfDefence: true, regainDistribution: 'possession' }) },
  { name: 'Direct, high tempo, counter', team: withIns({ passing: 'direct', tempo: 'high', counter: true }) },
  { name: 'Focus play left', team: withIns({ focus: 'left' }) },
  { name: 'Direct only', team: withIns({ passing: 'direct' }) },
  { name: 'High tempo only', team: withIns({ tempo: 'high' }) },
  { name: 'Counter only', team: withIns({ counter: true }) },
  { name: 'Short only', team: withIns({ passing: 'short' }) },
  { name: 'Slow only', team: withIns({ tempo: 'slow' }) },
  { name: 'Keep ball on regain only', team: withIns({ regainDistribution: 'possession' }) },
  {
    name: 'Striker and CB swapped', team: (t) => {
      const n = clone(t); const si = slotOf(n, 'ST'); const ci = slotOf(n, 'DC');
      [n.lineup[si], n.lineup[ci]] = [n.lineup[ci], n.lineup[si]]; return n;
    },
  },
  {
    name: 'Winger at right-back', team: (t) => {
      const n = clone(t); const wi = slotOf(n, 'AML'); const ri = slotOf(n, 'DR');
      [n.lineup[wi], n.lineup[ri]] = [n.lineup[ri], n.lineup[wi]]; return n;
    },
  },
  {
    name: 'No traits (whole XI)', team: (t) => {
      const n = clone(t); n.players = n.players.map((p) => ({ ...p, traits: {} })); return n;
    },
  },
  {
    name: 'Left winger: Inverted Winger (A)', team: (t) => { const n = clone(t); const i = slotOf(n, 'AML'); n.tactic.slots[i] = { ...n.tactic.slots[i], role: 'IW', duty: 'A' }; return n; },
    metrics: (r) => ({ wShots: statOf(r, wingerId)?.shots ?? 0, wCrosses: statOf(r, wingerId)?.crosses ?? 0 }),
  },
  {
    name: 'Left winger: Winger (S) cross more', team: (t) => { const n = clone(t); const i = slotOf(n, 'AML'); n.tactic.slots[i] = { ...n.tactic.slots[i], role: 'W', duty: 'S', pi: { crossing: 'more', width: 'wide' } }; return n; },
    metrics: (r) => ({ wShots: statOf(r, wingerId)?.shots ?? 0, wCrosses: statOf(r, wingerId)?.crosses ?? 0 }),
  },
  {
    name: 'Left winger: dribble more, cut inside', team: (t) => { const n = clone(t); const i = slotOf(n, 'AML'); n.tactic.slots[i] = { ...n.tactic.slots[i], pi: { dribbling: 'more', width: 'inside' } }; return n; },
    metrics: (r) => ({ wShots: statOf(r, wingerId)?.shots ?? 0, wDribbles: statOf(r, wingerId)?.dribbles ?? 0 }),
  },
  {
    name: 'Striker: shoot more', team: (t) => { const n = clone(t); const i = slotOf(n, 'ST'); n.tactic.slots[i] = { ...n.tactic.slots[i], pi: { shooting: 'more' } }; return n; },
    metrics: (r) => ({ stShots: statOf(r, strikerId)?.shots ?? 0, stGoals: statOf(r, strikerId)?.goals ?? 0 }),
  },
  {
    name: 'Both FBs get forward, whole team press more', team: (t) => {
      const n = clone(t);
      n.tactic.slots = n.tactic.slots.map((s) => s.pos === 'DL' || s.pos === 'DR' ? { ...s, pi: { movement: 'forward' } } : s.pos !== 'GK' ? { ...s, pi: { ...(s.pi ?? {}), press: 'more' } } : s);
      return n;
    },
  },
];

const fmt = (v: number, d = 2) => (v >= 0 ? ' ' : '') + v.toFixed(d);
console.log(`${A.club.short} vs ${B.club.short}, ${RUNS} runs per variant`);
let base: Agg | null = null;
for (const v of variants) {
  if (ONLY && base && !ONLY.test(v.name)) continue;
  const g = run(v, baseA, baseB);
  if (!base) base = g;
  const n = g.n;
  const d = (x: number, y: number) => fmt(x / n - y / base!.n);
  const ex = Object.entries(g.extra).map(([k, val]) => `${k} ${(val / n).toFixed(1)}`).join(' ');
  console.log(`${v.name.padEnd(40)} ppg ${(g.pts / n).toFixed(2)} (${d(g.pts, base.pts)})  gf ${(g.gf / n).toFixed(2)} ga ${(g.ga / n).toFixed(2)}  xg ${(g.xgf / n).toFixed(2)}-${(g.xga / n).toFixed(2)}  poss ${(g.poss / n).toFixed(0)}  sh ${(g.shots / n).toFixed(1)}\n    ${ex}`);
}
