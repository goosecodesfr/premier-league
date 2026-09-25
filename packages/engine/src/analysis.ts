// Tactic analysis: what a line-up and a set of instructions will actually do on the pitch.
// It uses the same presence model and composites as the match engine, so what the assistant
// says here is what the simulation will reward or punish.
import { displayAttr, ATTR_LABELS, type Attributes, type AttrKey } from './attributes.ts';
import { POS_LINE, type Familiarity, type Pos } from './positions.ts';
import { composite, rawRoleRating, bestRoleAt, currentAbility, familiarityFactor, type CompositeKey } from './ratings.ts';
import { ROLES, roleWeights, type RoleKey, type Duty } from './roles.ts';
import type { Tactic } from './tactics.ts';
import { TRAITS, type Traits } from './traits.ts';
import { ZONES, attackPresence, defencePresence } from './match/presence.ts';

export interface AnalysisPlayer {
  id: number;
  short: string;
  attrs: Attributes;
  fam: Familiarity;
  traits?: Traits;
  condition?: number;
}

export type FitTone = 'great' | 'good' | 'ok' | 'poor' | 'bad';

export interface SlotAnalysis {
  index: number;
  playerId: number | null;
  pos: Pos;
  role: RoleKey;
  duty: Duty;
  fam: number;
  famLabel: string;
  rating: number; // 0..200 role rating in this slot, familiarity included
  fit: FitTone;
  better: { role: RoleKey; duty: Duty; rating: number } | null; // a clearly better role at this position
  keyAttrs: { key: AttrKey; label: string; value: number; weight: number }[];
}

export interface Meter { key: string; label: string; value: number; hint: string; raw?: number }
export interface Note { tone: 'good' | 'warn' | 'bad'; text: string; slot?: number }

export interface TacticAnalysis {
  slots: SlotAnalysis[];
  presAtt: number[];
  presDef: number[];
  channels: [number, number, number]; // attacking threat share by flank (own perspective, %)
  cover: [number, number, number]; // defensive cover in own half by flank (%)
  meters: Meter[];
  notes: Note[];
  staminaRisk: { playerId: number; short: string; end: number }[];
}

export const FAM_LABELS: [number, string][] = [[0.95, 'Natural'], [0.8, 'Accomplished'], [0.6, 'Competent'], [0.4, 'Unconvincing'], [0, 'Awkward']];
export function famLabel(f: number): string {
  return FAM_LABELS.find(([t]) => f >= t)?.[1] ?? 'Awkward';
}

const famFactor = (f: number) => familiarityFactor(f);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pct = (v: number, lo: number, hi: number) => Math.round(clamp(((v - lo) / (hi - lo)) * 100, 0, 100));
const tp = (p: AnalysisPlayer | undefined, k: keyof typeof TRAITS) => (p?.traits?.[k] ? (p.traits[k]! >= 2 ? 1.5 : 1) : 0);

export function roleFit(p: AnalysisPlayer, pos: Pos, role: RoleKey, duty: Duty): { rating: number; fit: FitTone; fam: number; better: SlotAnalysis['better'] } {
  const fam = pos === 'GK' ? p.fam.GK ?? 0.05 : p.fam[pos] ?? 0.3;
  const rating = rawRoleRating(p.attrs, role, duty) * (pos === 'GK' && fam < 0.5 ? 0.55 : famFactor(fam));
  const ca = Math.max(60, currentAbility(p.attrs, p.fam));
  const ratio = rating / ca;
  const fit: FitTone = ratio >= 0.97 ? 'great' : ratio >= 0.92 ? 'good' : ratio >= 0.86 ? 'ok' : ratio >= 0.76 ? 'poor' : 'bad';
  const best = bestRoleAt(p.attrs, pos);
  const bestRating = best.rating * (pos === 'GK' && fam < 0.5 ? 0.55 : famFactor(fam));
  const better = best.role !== role && bestRating - rating >= 4 ? { role: best.role, duty: best.duty, rating: bestRating } : null;
  return { rating, fit, fam, better };
}

export function analyseTactic(tactic: Tactic, lineup: number[], players: AnalysisPlayer[], opts: { familiarity?: number } = {}): TacticAnalysis {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ins = tactic.instructions;
  const presAtt = new Float64Array(ZONES);
  const presDef = new Float64Array(ZONES);
  const slots: SlotAnalysis[] = [];
  const on: { p: AnalysisPlayer; i: number; fam: number }[] = [];
  tactic.slots.forEach((s, i) => {
    const p = byId.get(lineup[i]);
    const weights = roleWeights(s.role, s.duty).slice().sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!p) {
      slots.push({ index: i, playerId: null, pos: s.pos, role: s.role, duty: s.duty, fam: 0, famLabel: '-', rating: 0, fit: 'bad', better: null, keyAttrs: [] });
      return;
    }
    const f = roleFit(p, s.pos, s.role, s.duty);
    slots.push({
      index: i, playerId: p.id, pos: s.pos, role: s.role, duty: s.duty, fam: f.fam, famLabel: famLabel(f.fam), rating: Math.round(f.rating), fit: f.fit, better: f.better,
      keyAttrs: weights.map(([k, w]) => ({ key: k, label: ATTR_LABELS[k], value: displayAttr(p.attrs[k]), weight: Math.round(w * 100) })),
    });
    on.push({ p, i, fam: f.fam });
    const pa = new Float64Array(ZONES);
    const pd = new Float64Array(ZONES);
    const wr = p.attrs.workRate;
    const pressAdj = s.pi?.press === 'more' ? 1.12 : s.pi?.press === 'less' ? 0.88 : 1;
    const params = { slot: s, role: s.role, duty: s.duty, mentality: tactic.mentality, ins, activity: clamp((0.78 + (wr - 100) / 400 + 0.025) * pressAdj, 0.6, 1.25), pi: s.pi, fam: s.pos === 'GK' ? 1 : f.fam };
    attackPresence(params, pa);
    defencePresence(params, pd);
    for (let z = 0; z < ZONES; z++) { presAtt[z] += pa[z]; presDef[z] += pd[z] * (s.pos === 'GK' ? 0.6 : 1); }
  });

  const comp = (x: { p: AnalysisPlayer; fam: number }, k: CompositeKey) => composite(x.p.attrs, k) * famFactor(x.fam);
  const line = (i: number) => POS_LINE[tactic.slots[i].pos];
  const outfield = on.filter((x) => tactic.slots[x.i].pos !== 'GK');
  const back = on.filter((x) => line(x.i) === 'DEF');
  const mids = on.filter((x) => line(x.i) === 'MID');
  const fwds = on.filter((x) => line(x.i) === 'ATT' || ['AMC', 'AML', 'AMR'].includes(tactic.slots[x.i].pos));
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const topN = (arr: number[], n: number) => avg(arr.sort((a, b) => b - a).slice(0, n));

  // ---- meters
  const buildUp = avg(on.filter((x) => line(x.i) !== 'ATT').map((x) => comp(x, 'pass') * ROLES[tactic.slots[x.i].role].inv))
    + (ins.passing === 'short' ? 4 : ins.passing === 'direct' ? -4 : 0) + (ins.tempo === 'slow' ? 3 : ins.tempo === 'high' ? -3 : 0)
    + on.reduce((s, x) => s + 1.5 * (tp(x.p, 'press_proven') + tp(x.p, 'tiki_taka')), 0);
  const creators = outfield.map((x) => comp(x, 'through') * (ROLES[tactic.slots[x.i].role].tend.through ?? 1) + 5 * (tp(x.p, 'incisive_pass') + tp(x.p, 'inventive')));
  const creativity = topN(creators, 2);
  const dribbling = topN(fwds.concat(mids).map((x) => comp(x, 'dribble') + 4 * (tp(x.p, 'technical') + tp(x.p, 'trickster') + tp(x.p, 'rapid'))), 3);
  const pace = topN(fwds.map((x) => comp(x, 'runner') + 5 * (tp(x.p, 'rapid') + tp(x.p, 'quick_step'))), 2);
  const box = [15, 16, 17].reduce((s, z) => s + presAtt[z], 0);
  const boxThreat = on.reduce((s, x) => {
    const pa = new Float64Array(ZONES);
    const sl = tactic.slots[x.i];
    attackPresence({ slot: sl, role: sl.role, duty: sl.duty, mentality: tactic.mentality, ins, activity: 1, pi: sl.pi, fam: x.fam }, pa);
    const inBox = pa[15] + pa[16] + pa[17];
    return s + inBox * (comp(x, 'finish') / 150);
  }, 0);
  const aerial = on.reduce((s, x) => {
    const pa = new Float64Array(ZONES);
    const sl = tactic.slots[x.i];
    attackPresence({ slot: sl, role: sl.role, duty: sl.duty, mentality: tactic.mentality, ins, activity: 1, pi: sl.pi, fam: x.fam }, pa);
    return s + (pa[15] + pa[16] + pa[17]) * Math.pow((comp(x, 'headerAtt') + 6 * tp(x.p, 'aerial_fortress') + 4 * tp(x.p, 'precision_header')) / 140, 2);
  }, 0);
  const pressInt = { low: 0.8, normal: 1, high: 1.12, all_out: 1.25 }[ins.press] * (ins.pressTrigger === 'always' ? 1.05 : 1);
  const pressing = avg(outfield.map((x) => comp(x, 'press') * ROLES[tactic.slots[x.i].role].press * (tactic.slots[x.i].pi?.press === 'more' ? 1.12 : tactic.slots[x.i].pi?.press === 'less' ? 0.88 : 1))) * pressInt;
  const solidity = avg(back.concat(mids.filter((x) => ['DM'].includes(tactic.slots[x.i].pos) || tactic.slots[x.i].duty === 'D')).map((x) => (comp(x, 'tackle') + comp(x, 'intercept') + comp(x, 'mark')) / 3 + 3 * (tp(x.p, 'intercept') + tp(x.p, 'anticipate') + tp(x.p, 'jockey'))));
  const recovery = avg(back.map((x) => comp(x, 'recovery')));
  const lineHeight = { deep: 0, normal: 1, high: 2, very_high: 3 }[ins.line];
  const setPiece = topN(outfield.map((x) => comp(x, 'setPiece') + 6 * tp(x.p, 'dead_ball')), 1);

  // ---- stamina forecast (same drain model as the engine's checkpoints)
  const pressF = { low: 0.9, normal: 1, high: 1.14, all_out: 1.28 }[ins.press];
  const tempoF = ins.tempo === 'high' ? 1.07 : ins.tempo === 'slow' ? 0.95 : 1;
  const staminaRisk = outfield.map((x) => {
    const sl = tactic.slots[x.i];
    const r = ROLES[sl.role];
    const staminaF = clamp(1.32 - x.p.attrs.stamina / 250, 0.5, 1.2);
    const personal = (sl.pi?.press === 'more' ? 1.12 : sl.pi?.press === 'less' ? 0.9 : 1) * (sl.pi?.movement === 'forward' ? 1.04 : 1) * (1 - 0.2 * tp(x.p, 'relentless'));
    const drop = 1.75 * r.workload * pressF * tempoF * staminaF * personal * 18;
    return { playerId: x.p.id, short: x.p.short, end: Math.round((x.p.condition ?? 100) - drop) };
  }).sort((a, b) => a.end - b.end);

  const meters: Meter[] = [
    { key: 'buildup', label: 'Build-up play', value: pct(buildUp, 100, 165), raw: Math.round(buildUp * 100) / 100, hint: 'Keeping the ball from the back: passing of your defenders and midfielders, plus press-resistant traits.' },
    { key: 'creativity', label: 'Creativity', value: pct(creativity, 110, 250), raw: Math.round(creativity * 100) / 100, hint: 'Your two best chance creators, weighted by how often their roles look for the killer ball.' },
    { key: 'dribbling', label: 'Beating players', value: pct(dribbling, 135, 190), raw: Math.round(dribbling * 100) / 100, hint: 'Dribbling quality of your attacking players.' },
    { key: 'pace', label: 'Pace in behind', value: pct(pace, 125, 190), raw: Math.round(pace * 100) / 100, hint: 'How dangerous your forwards are running beyond the last defender.' },
    { key: 'box', label: 'Box presence', value: pct(boxThreat, 0.5, 3.2), raw: Math.round(boxThreat * 100) / 100, hint: 'How many players get into the box, weighted by their finishing.' },
    { key: 'aerial', label: 'Aerial threat', value: pct(aerial, 0.4, 3.1), raw: Math.round(aerial * 100) / 100, hint: 'Heading ability of the players who attack crosses.' },
    { key: 'press', label: 'Pressing', value: pct(pressing, 65, 150), raw: Math.round(pressing * 100) / 100, hint: 'Work rate and pressing ability of your outfield players times your pressing intensity.' },
    { key: 'solidity', label: 'Defensive solidity', value: pct(solidity, 120, 180), raw: Math.round(solidity * 100) / 100, hint: 'Tackling, reading of the game and marking of your defenders and holding midfielders.' },
    { key: 'setpieces', label: 'Set pieces', value: pct(setPiece, 120, 185), raw: Math.round(setPiece * 100) / 100, hint: 'Your best set-piece taker.' },
  ];

  // ---- channels
  const chan = (arr: Float64Array, bands: number[]) => [0, 1, 2].map((c) => bands.reduce((s, b) => s + arr[b * 3 + c], 0)) as [number, number, number];
  const att = chan(presAtt, [3, 4, 5]);
  const cov = chan(presDef, [0, 1, 2]);
  const share = (v: [number, number, number]) => { const t = v[0] + v[1] + v[2] || 1; return v.map((x) => Math.round((x / t) * 100)) as [number, number, number]; };
  const channels = share(att);
  const cover = share(cov);

  // ---- notes
  const notes: Note[] = [];
  const name = (i: number) => byId.get(lineup[i])?.short ?? 'Nobody';
  slots.forEach((s) => {
    if (s.playerId === null) { notes.push({ tone: 'bad', text: `No one is picked at ${s.pos}.`, slot: s.index }); return; }
    if (s.pos !== 'GK' && s.fam < 0.6) notes.push({ tone: 'bad', text: `${name(s.index)} is out of position at ${s.pos} (${s.famLabel.toLowerCase()}). Expect mistakes: he plays at about ${Math.round(famFactor(s.fam) * 100)}% of his level there.`, slot: s.index });
    else if (s.pos !== 'GK' && s.fam < 0.8) notes.push({ tone: 'warn', text: `${name(s.index)} is only ${s.famLabel.toLowerCase()} at ${s.pos}.`, slot: s.index });
    if (s.pos === 'GK' && s.fam < 0.5) notes.push({ tone: 'bad', text: `${name(s.index)} is not a goalkeeper.`, slot: s.index });
    if ((s.fit === 'poor' || s.fit === 'bad') && s.better && s.fam >= 0.6) notes.push({ tone: 'warn', text: `${name(s.index)} is a poor fit as ${ROLES[s.role].name}. ${ROLES[s.better.role].name} suits him better (${(s.better.rating / 10).toFixed(1)} vs ${(s.rating / 10).toFixed(1)}).`, slot: s.index });
  });
  // Flank exposure
  for (const [side, label, posD, posA] of [[0, 'left', ['DL', 'WBL'], ['ML', 'AML']], [2, 'right', ['DR', 'WBR'], ['MR', 'AMR']]] as const) {
    const d = tactic.slots.findIndex((s) => (posD as readonly string[]).includes(s.pos));
    const a = tactic.slots.findIndex((s) => (posA as readonly string[]).includes(s.pos));
    if (d < 0) continue;
    const dForward = tactic.slots[d].duty === 'A' || tactic.slots[d].pi?.movement === 'forward' || (ins.overlap === 'overlap' && tactic.slots[d].duty !== 'D');
    const aForward = a >= 0 && (tactic.slots[a].duty === 'A' || tactic.slots[a].pi?.movement === 'forward');
    if (dForward && (aForward || a < 0) && cover[side] < 30) notes.push({ tone: 'warn', text: `Your ${label} flank is exposed: both players there go forward, so counters down that side will find space.`, slot: d });
    void side;
  }
  const slowLine = recovery < 128;
  if (lineHeight >= 2 && back.length && slowLine) notes.push({ tone: lineHeight === 3 ? 'bad' : 'warn', text: `A ${ins.line === 'very_high' ? 'very high' : 'high'} line with slow defenders (recovery ${displayAttr(recovery).toFixed(1)}): quick forwards will get in behind.` });
  if (lineHeight >= 2 && back.length && recovery >= 145) notes.push({ tone: 'good', text: `Your defenders have the pace to hold a high line (recovery ${displayAttr(recovery).toFixed(1)}).` });
  if (lineHeight === 0 && (ins.press === 'high' || ins.press === 'all_out')) notes.push({ tone: 'warn', text: 'A deep line with a high press stretches the team: expect gaps between your midfield and defence.' });
  const crossing = (ins.width === 'wide' ? 1 : 0) + tactic.slots.filter((s) => s.role === 'W' || s.role === 'WB' || s.pi?.crossing === 'more').length;
  const aerialV = meters.find((m) => m.key === 'aerial')!.value;
  if (crossing >= 2 && aerialV < 35) notes.push({ tone: 'warn', text: `You are set up to cross, but your box threat in the air is low (${aerialV}/100): most crosses will be cleared.` });
  if (crossing >= 2 && aerialV >= 65) notes.push({ tone: 'good', text: `Strong in the air (${aerialV}/100): crosses into the box are a real weapon.` });
  const boxV = meters.find((m) => m.key === 'box')!.value;
  if (boxV < 25) notes.push({ tone: 'warn', text: 'Very few players attack the box. Consider an attacking duty up front or a runner from midfield.' });
  const paceV = meters.find((m) => m.key === 'pace')!.value;
  if ((ins.counter || ins.passing === 'direct') && paceV < 35) notes.push({ tone: 'warn', text: 'Direct or counter-attacking play without quick forwards: long balls will mostly be won back by defenders.' });
  if ((ins.counter || ins.passing === 'direct') && paceV >= 70) notes.push({ tone: 'good', text: 'Pace to burn up front: direct balls and counters will trouble any high line.' });
  const playmakers = tactic.slots.filter((s) => ['DLP', 'AP', 'RPM', 'ENG', 'F9', 'WP'].includes(s.role)).length;
  if (playmakers >= 3) notes.push({ tone: 'warn', text: `${playmakers} playmaker roles will compete for the ball. Two is usually enough.` });
  if (playmakers === 0 && ins.passing === 'short') notes.push({ tone: 'warn', text: 'Short passing with no playmaker role: nobody is told to be the creative hub.' });
  const tired = staminaRisk.filter((r) => r.end < 55);
  if (tired.length >= 2) notes.push({ tone: 'warn', text: `${tired.slice(0, 3).map((r) => r.short).join(', ')} will be exhausted by the last 20 minutes at this intensity. Plan substitutions or press less.` });
  if (ins.offsideTrap && back.length && avg(back.map((x) => x.p.attrs.concentration)) < 125) notes.push({ tone: 'warn', text: 'An offside trap needs a concentrated back line; yours may be caught out.' });
  tactic.slots.forEach((s, i) => {
    const p = byId.get(lineup[i]);
    if (!p || !s.pi) return;
    if (s.pi.shooting === 'more' && Math.max(composite(p.attrs, 'finish'), composite(p.attrs, 'longShot')) < 125) notes.push({ tone: 'warn', text: `${p.short} is told to shoot more, but he is not much of a finisher.`, slot: i });
    if (s.pi.dribbling === 'more' && composite(p.attrs, 'dribble') < 125) notes.push({ tone: 'warn', text: `${p.short} is told to dribble more, but he will lose the ball a lot.`, slot: i });
    if (s.pi.passing === 'risky' && composite(p.attrs, 'through') < 125) notes.push({ tone: 'warn', text: `${p.short} is told to take risks with his passing, but his vision is limited.`, slot: i });
    if (s.pi.crossing === 'more' && composite(p.attrs, 'cross') < 120 && !tp(p, 'whipped_pass')) notes.push({ tone: 'warn', text: `${p.short} is told to cross more, but his delivery is poor.`, slot: i });
  });
  // Trait combinations the engine rewards
  const withTrait = (k: keyof typeof TRAITS) => on.filter((x) => tp(x.p, k) > 0);
  const whipped = withTrait('whipped_pass').filter((x) => ['DL', 'DR', 'WBL', 'WBR', 'ML', 'MR', 'AML', 'AMR'].includes(tactic.slots[x.i].pos));
  const headers = withTrait('aerial_fortress').concat(withTrait('precision_header')).filter((x) => line(x.i) === 'ATT' || tactic.slots[x.i].pos === 'AMC');
  if (whipped.length && headers.length) notes.push({ tone: 'good', text: `${whipped[0].p.short}'s Whipped Pass and ${headers[0].p.short} in the air: a proper crossing partnership.` });
  const incisive = withTrait('incisive_pass');
  const rapid = withTrait('rapid').concat(withTrait('quick_step')).filter((x) => line(x.i) === 'ATT' || ['AML', 'AMR'].includes(tactic.slots[x.i].pos));
  if (incisive.length && rapid.length && incisive[0].p.id !== rapid[0].p.id) notes.push({ tone: 'good', text: `${incisive[0].p.short}'s Incisive Pass to ${rapid[0].p.short}'s pace: through balls will be a weapon.` });
  if (opts.familiarity !== undefined && opts.familiarity < 0.7) notes.push({ tone: 'warn', text: `The squad does not know this tactic well yet (${Math.round(opts.familiarity * 100)}% familiar), so expect some confusion. It improves with matches and training.` });

  const order = { bad: 0, warn: 1, good: 2 };
  notes.sort((a, b) => order[a.tone] - order[b.tone]);
  return { slots, presAtt: Array.from(presAtt), presDef: Array.from(presDef), channels, cover, meters, notes, staminaRisk: staminaRisk.slice(0, 5) };
}

// ---------------------------------------------------------------- key battles
export interface BattleSide { id: number; short: string; pos: Pos; role: RoleKey }
export interface Battle {
  key: string;
  title: string;
  mine: BattleSide[];
  theirs: BattleSide[];
  edge: number; // -2 (they win it) .. +2 (you win it)
  detail: string;
}

interface BattleTeam { tactic: Tactic; lineup: number[]; players: AnalysisPlayer[] }

export function keyBattles(me: BattleTeam, them: BattleTeam): Battle[] {
  const pick = (t: BattleTeam, pred: (pos: Pos, x: number) => boolean) => {
    const byId = new Map(t.players.map((p) => [p.id, p]));
    return t.tactic.slots.map((s, i) => ({ s, p: byId.get(t.lineup[i]) })).filter((x): x is { s: typeof x.s; p: AnalysisPlayer } => !!x.p && pred(x.s.pos, x.s.x));
  };
  const side = (x: { s: { pos: Pos; role: RoleKey }; p: AnalysisPlayer }): BattleSide => ({ id: x.p.id, short: x.p.short, pos: x.s.pos, role: x.s.role });
  // Same scaling the engine applies: a player out of position brings less of every quality.
  const c = (x: { s: { pos: Pos }; p: AnalysisPlayer }, k: CompositeKey) => composite(x.p.attrs, k) * (x.s.pos === 'GK' ? 1 : famFactor(x.p.fam[x.s.pos] ?? 0.3));
  const d = (v: number) => displayAttr(v).toFixed(1);
  const edgeOf = (gap: number) => (gap >= 14 ? 2 : gap >= 5 ? 1 : gap <= -14 ? -2 : gap <= -5 ? -1 : 0);
  const out: Battle[] = [];
  // Flanks: my left attackers vs their right defenders, and vice versa (their right is x > 60 from their view)
  for (const [label, myWide, theirWide] of [
    ['Left flank', (pos: Pos, x: number) => ['AML', 'ML', 'WBL'].includes(pos) || (pos === 'ST' && x < 40), (pos: Pos) => ['DR', 'WBR'].includes(pos)],
    ['Right flank', (pos: Pos, x: number) => ['AMR', 'MR', 'WBR'].includes(pos) || (pos === 'ST' && x > 60), (pos: Pos) => ['DL', 'WBL'].includes(pos)],
  ] as const) {
    const a = pick(me, myWide).sort((x, y) => c(y, 'dribble') - c(x, 'dribble'))[0];
    const b = pick(them, theirWide)[0];
    if (!a || !b) continue;
    const att = c(a, 'dribble') * 0.6 + c(a, 'runner') * 0.4 + 5 * (tp(a.p, 'technical') + tp(a.p, 'trickster') + tp(a.p, 'rapid'));
    const def = c(b, 'tackle') * 0.6 + c(b, 'recovery') * 0.4 + 5 * (tp(b.p, 'jockey') + tp(b.p, 'anticipate'));
    out.push({ key: label, title: `${label}: ${a.p.short} vs ${b.p.short}`, mine: [side(a)], theirs: [side(b)], edge: edgeOf(att - def),
      detail: `Dribbling ${d(c(a, 'dribble'))} and pace ${d(c(a, 'runner'))} against tackling ${d(c(b, 'tackle'))} and recovery ${d(c(b, 'recovery'))}.` });
  }
  // Striker(s) vs their centre-backs
  const sts = pick(me, (pos) => pos === 'ST');
  const cbs = pick(them, (pos) => pos === 'DC');
  if (sts.length && cbs.length) {
    const runner = Math.max(...sts.map((x) => c(x, 'runner') + 5 * (tp(x.p, 'rapid') + tp(x.p, 'quick_step'))));
    const rec = Math.max(...cbs.map((x) => c(x, 'recovery')));
    const air = Math.max(...sts.map((x) => c(x, 'headerAtt') + 6 * tp(x.p, 'aerial_fortress')));
    const airD = Math.max(...cbs.map((x) => c(x, 'aerialDef') + 6 * tp(x.p, 'aerial_fortress')));
    const gap = Math.max(runner - rec, air - airD);
    out.push({ key: 'Up front', title: `Up front: ${sts.map((x) => x.p.short).join(' & ')} vs ${cbs.map((x) => x.p.short).join(' & ')}`, mine: sts.map(side), theirs: cbs.map(side), edge: edgeOf(gap),
      detail: `In behind: pace ${d(runner)} vs recovery ${d(rec)}. In the air: ${d(air)} vs ${d(airD)}.` });
  }
  // Midfield numbers and quality
  const central = (pos: Pos) => ['DM', 'MC', 'AMC'].includes(pos);
  const mm = pick(me, central);
  const tm = pick(them, central);
  if (mm.length && tm.length) {
    const q = (arr: typeof mm) => arr.reduce((s, x) => s + (c(x, 'pass') + c(x, 'press')) / 2, 0) / arr.length;
    const gap = q(mm) - q(tm) + (mm.length - tm.length) * 8;
    out.push({ key: 'Midfield', title: `Midfield: ${mm.length} v ${tm.length}`, mine: mm.map(side), theirs: tm.map(side), edge: edgeOf(gap),
      detail: `${mm.length === tm.length ? 'Even numbers' : mm.length > tm.length ? 'You have the extra man' : 'They have the extra man'} in the middle. Passing and pressing ${d(q(mm))} vs ${d(q(tm))}.` });
  }
  // Their danger man vs whoever will face him
  const danger = pick(them, (pos) => POS_LINE[pos] === 'ATT' || ['AMC', 'AML', 'AMR'].includes(pos))
    .sort((x, y) => (c(y, 'finish') + c(y, 'dribble')) - (c(x, 'finish') + c(x, 'dribble')))[0];
  if (danger) {
    const dx = 100 - danger.s.x; // their left is my right
    const facing = pick(me, (pos, x) => POS_LINE[pos] === 'DEF' && Math.abs(x - dx) < 30 && pos !== 'GK')
      .sort((a, b) => Math.abs(a.s.x - dx) - Math.abs(b.s.x - dx))[0];
    if (facing) {
      const att = (c(danger, 'finish') + c(danger, 'dribble')) / 2 + 4 * Object.keys(danger.p.traits ?? {}).length;
      const def = (c(facing, 'tackle') + c(facing, 'mark')) / 2 + 4 * (tp(facing.p, 'jockey') + tp(facing.p, 'intercept') + tp(facing.p, 'anticipate'));
      const tr = Object.keys(danger.p.traits ?? {}).slice(0, 2).map((k) => TRAITS[k as keyof typeof TRAITS]?.name).filter(Boolean);
      out.push({ key: 'Danger man', title: `Their danger man: ${danger.p.short} vs ${facing.p.short}`, mine: [side(facing)], theirs: [side(danger)], edge: edgeOf(def - att),
        detail: `Finishing ${d(c(danger, 'finish'))}, dribbling ${d(c(danger, 'dribble'))}${tr.length ? `, known for ${tr.join(' and ')}` : ''}. Your man: tackling ${d(c(facing, 'tackle'))}, marking ${d(c(facing, 'mark'))}.` });
    }
  }
  // Say so when someone in a battle is playing out of position: the numbers above already include it.
  const famOf = (t: BattleTeam, b: BattleSide) => t.players.find((p) => p.id === b.id)?.fam[b.pos] ?? 0.3;
  for (const b of out) {
    const lost = [...b.mine.filter((x) => x.pos !== 'GK' && famOf(me, x) < 0.6).map((x) => `${x.short} (yours)`), ...b.theirs.filter((x) => x.pos !== 'GK' && famOf(them, x) < 0.6).map((x) => x.short)];
    if (lost.length) b.detail += ` Out of position, and it shows in these numbers: ${lost.join(', ')}.`;
  }
  return out;
}

export function roleName(r: RoleKey): string {
  return ROLES[r].name;
}
