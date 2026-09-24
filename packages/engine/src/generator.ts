// Profile-based player generator. Used by the seed importer (real players from a ratings
// dataset), and at runtime for youth intakes, regens, free agents and staff/manager names.
import {
  ATTR_KEYS, GOALKEEPING, type Attributes, type AttrKey, clampAttr, type Hidden,
} from './attributes.ts';
import { deriveFamiliarity, type Familiarity, type Pos } from './positions.ts';
import { currentAbility } from './ratings.ts';
import { clamp, type Rng } from './rng.ts';

// ---------------------------------------------------------------------------
// Conversions from a 1..99 ratings dataset
// ---------------------------------------------------------------------------

/** 1..99 dataset scale -> 1..200 internal scale. */
export function fromDataset(v: number | undefined | null, fallback = 50): number {
  const x = v == null || Number.isNaN(v) ? fallback : v;
  return clampAttr((x - 20) * 2.53 + 10);
}

/** Dataset overall/potential gap -> internal potential gap. */
export const DATASET_ABILITY_SLOPE = 2.53;

export interface DatasetRow {
  overall: number; potential: number; age: number; heightCm: number; weightKg: number;
  foot: 'L' | 'R'; weakFoot: number; skillMoves: number; intlRep: number;
  workRate: string; traits: string; positions: Pos[];
  pace?: number;
  // detailed
  crossing: number; finishing: number; headingAccuracy: number; shortPassing: number; volleys: number;
  dribbling: number; curve: number; fkAccuracy: number; longPassing: number; ballControl: number;
  acceleration: number; sprintSpeed: number; agility: number; reactions: number; balance: number;
  shotPower: number; jumping: number; stamina: number; strength: number; longShots: number;
  aggression: number; interceptions: number; attPositioning: number; vision: number; penalties: number;
  composure: number; defAwareness: number; standingTackle: number; slidingTackle: number;
  gkDiving: number; gkHandling: number; gkKicking: number; gkPositioning: number; gkReflexes: number; gkSpeed?: number;
}

const WR: Record<string, number> = { High: 1, Medium: 0.5, Low: 0 };

export function attributesFromDataset(r: DatasetRow, rng: Rng): { attrs: Attributes; hidden: Hidden } {
  const n = (sd: number) => rng.normal(0, sd);
  const c = (v: number) => fromDataset(v);
  const mix = (...pairs: [number, number][]) => pairs.reduce((s, [v, w]) => s + v * w, 0);
  const [wrA, wrD] = (r.workRate || 'Medium/Medium').split('/').map((s) => WR[s.trim()] ?? 0.5);
  const isGk = r.positions[0] === 'GK';
  const heightBonus = clamp((r.heightCm - 180) / 12, -1.5, 1.8);

  const a = {} as Attributes;
  a.finishing = c(r.finishing);
  a.longShots = c(mix([r.longShots, 0.8], [r.shotPower, 0.2]));
  a.passing = c(mix([r.shortPassing, 0.6], [r.longPassing, 0.4]));
  a.vision = c(r.vision);
  a.crossing = c(r.crossing);
  a.dribbling = c(r.dribbling);
  a.firstTouch = c(r.ballControl);
  a.heading = c(r.headingAccuracy);
  a.tackling = c(mix([r.standingTackle, 0.6], [r.slidingTackle, 0.4]));
  a.marking = c(r.defAwareness);
  a.setPieces = c(mix([r.fkAccuracy, 0.5], [r.curve, 0.3], [r.penalties, 0.2]));

  a.composure = c(r.composure);
  a.decisions = c(mix([r.reactions, 0.55], [r.composure, 0.2], [r.vision, 0.25]) + n(2));
  a.anticipation = c(mix([r.reactions, 0.5], [r.interceptions, 0.25], [r.attPositioning, 0.25]) + n(2));
  a.positioning = c(mix([r.interceptions, 0.5], [r.defAwareness, 0.5]));
  a.concentration = c(mix([r.reactions, 0.45], [r.defAwareness, 0.25], [r.composure, 0.3]) + n(3));
  a.workRate = clampAttr(10 * (6 + 5.5 * (wrA * 0.45 + wrD * 0.55)) + (r.stamina - 65) * 0.9 + n(9));
  a.teamwork = clampAttr(95 + (r.shortPassing - 60) * 1.3 + (wrD - 0.5) * 25 + (r.vision - 60) * 0.5 + n(10));
  a.aggression = c(r.aggression);
  a.bravery = clampAttr(80 + (r.aggression - 55) * 1.1 + (r.strength - 65) * 0.8 + (r.headingAccuracy - 50) * 0.5 + n(12));
  a.leadership = clampAttr(60 + (r.age - 20) * 5 + r.intlRep * 14 + (r.composure - 60) * 0.8 + n(18));
  a.flair = clampAttr(40 + r.skillMoves * 22 + (r.dribbling - 60) * 0.9 + (r.curve - 60) * 0.4 + n(10));
  a.offTheBall = c(r.attPositioning);

  a.pace = c(r.sprintSpeed);
  a.acceleration = c(r.acceleration);
  a.stamina = c(r.stamina);
  a.strength = c(r.strength);
  a.agility = c(r.agility);
  a.balance = c(r.balance);
  a.jumping = c(r.jumping);
  a.naturalFitness = clampAttr(fromDataset(mix([r.stamina, 0.5], [r.strength, 0.2], [r.reactions, 0.3])) + (24 - r.age) * 1.2 + n(10));

  if (isGk) {
    a.shotStopping = c(mix([r.gkDiving, 0.5], [r.gkReflexes, 0.3], [r.gkPositioning, 0.2]));
    a.reflexes = c(r.gkReflexes);
    a.handling = c(r.gkHandling);
    a.aerialReach = clampAttr(c(mix([r.gkHandling, 0.35], [r.gkPositioning, 0.35], [r.jumping, 0.3])) + heightBonus * 10);
    a.oneOnOnes = c(mix([r.gkReflexes, 0.4], [r.gkSpeed ?? r.acceleration, 0.25], [r.composure, 0.35]));
    a.commandOfArea = clampAttr(c(mix([r.gkPositioning, 0.5], [r.gkHandling, 0.3], [r.composure, 0.2])) + heightBonus * 8 + n(6));
    a.distribution = c(mix([r.gkKicking, 0.6], [r.shortPassing, 0.4]));
    a.rushingOut = c(mix([r.gkSpeed ?? r.acceleration, 0.6], [r.reactions, 0.4]) + n(3));
    a.positioning = c(r.gkPositioning);
    a.concentration = c(mix([r.reactions, 0.5], [r.gkPositioning, 0.5]) + n(2));
    a.decisions = c(mix([r.reactions, 0.6], [r.composure, 0.4]) + n(2));
  } else {
    for (const k of GOALKEEPING) a[k] = clampAttr(12 + n(5));
    a.distribution = clampAttr(a.passing * 0.35);
  }

  for (const k of ATTR_KEYS) a[k] = clampAttr(a[k]);

  const traits = (r.traits || '').toLowerCase();
  const hid: Hidden = {
    consistency: Math.round(clamp(11 + (r.overall - 70) * 0.12 + (r.age > 27 ? 1.5 : 0) + r.intlRep * 0.5 + n(2.5), 1, 20)),
    importantMatches: Math.round(clamp(10.5 + r.intlRep * 1.1 + (r.overall - 72) * 0.08 + n(3), 1, 20)),
    injuryProneness: Math.round(clamp((traits.includes('injury prone') ? 16 : 7) + Math.max(0, r.age - 30) * 0.8 + n(2.5), 1, 20)),
    adaptability: Math.round(clamp(11.5 + n(3.5), 1, 20)),
    ambition: Math.round(clamp(11 + (r.potential - 72) * 0.12 + n(3.5), 1, 20)),
    loyalty: Math.round(clamp((traits.includes('one club') ? 18 : 11) + n(3.5), 1, 20)),
    professionalism: Math.round(clamp(12 + (r.overall - 70) * 0.06 + (r.age > 30 ? 1 : 0) + n(3.5), 1, 20)),
    temperament: Math.round(clamp(12 + (r.composure - 65) * 0.1 - (r.aggression - 60) * 0.08 + n(2.5), 1, 20)),
  };
  return { attrs: a, hidden: hid };
}

// ---------------------------------------------------------------------------
// Profile-based generation from scratch
// ---------------------------------------------------------------------------

export type Archetype =
  | 'gk_shot' | 'gk_sweep'
  | 'cb_stopper' | 'cb_ball' | 'cb_quick'
  | 'fb_att' | 'fb_def'
  | 'dm_destroyer' | 'dm_playmaker'
  | 'cm_b2b' | 'cm_playmaker' | 'cm_mezzala'
  | 'am_creator' | 'am_second'
  | 'w_winger' | 'w_inverted'
  | 'st_poacher' | 'st_target' | 'st_complete' | 'st_pressing';

/** Offsets in display points (x10 internally). */
const PROFILE: Record<Archetype, Partial<Record<AttrKey, number>>> = {
  gk_shot: { shotStopping: 3, reflexes: 3, handling: 1.5, aerialReach: 1, commandOfArea: 1, positioning: 1.5, concentration: 1 },
  gk_sweep: { rushingOut: 3, distribution: 3, oneOnOnes: 2, passing: 1.5, composure: 1.5, shotStopping: 1.5, reflexes: 1.5 },
  cb_stopper: { heading: 3, strength: 3, jumping: 2, tackling: 2, marking: 2, bravery: 2, aggression: 1, positioning: 2, pace: -2, dribbling: -3, flair: -3, passing: -1 },
  cb_ball: { passing: 3, composure: 2.5, vision: 2, firstTouch: 1.5, tackling: 1.5, marking: 1.5, positioning: 2, flair: -2, finishing: -3 },
  cb_quick: { pace: 3, acceleration: 2.5, anticipation: 2, tackling: 2, marking: 1, positioning: 1.5, heading: -1, finishing: -3 },
  fb_att: { pace: 2.5, acceleration: 2, crossing: 3, stamina: 2.5, dribbling: 1.5, workRate: 1.5, marking: -1, heading: -2, finishing: -2 },
  fb_def: { tackling: 2.5, marking: 2.5, positioning: 2.5, strength: 1, stamina: 1.5, crossing: -1, flair: -2, finishing: -3 },
  dm_destroyer: { tackling: 3, aggression: 2.5, workRate: 2.5, stamina: 2, anticipation: 2, positioning: 2, strength: 1.5, flair: -3, finishing: -2.5, dribbling: -1 },
  dm_playmaker: { passing: 3, vision: 3, composure: 2.5, decisions: 2.5, firstTouch: 1.5, positioning: 1, pace: -2, finishing: -1.5 },
  cm_b2b: { stamina: 3, workRate: 3, passing: 1, tackling: 1.5, offTheBall: 1.5, strength: 1, longShots: 1 },
  cm_playmaker: { passing: 3, vision: 3, firstTouch: 2, dribbling: 1, decisions: 2, composure: 1.5, tackling: -1, heading: -2 },
  cm_mezzala: { dribbling: 2.5, offTheBall: 2, acceleration: 1.5, passing: 1.5, flair: 1.5, firstTouch: 1.5, heading: -2, marking: -1.5 },
  am_creator: { vision: 3, passing: 3, flair: 2.5, firstTouch: 2.5, dribbling: 2, composure: 1, tackling: -3, strength: -2, heading: -2, marking: -3 },
  am_second: { finishing: 2.5, offTheBall: 3, anticipation: 2, dribbling: 1.5, composure: 1.5, tackling: -3, marking: -3 },
  w_winger: { pace: 3, acceleration: 3, dribbling: 2.5, crossing: 3, agility: 2, flair: 1.5, tackling: -3, heading: -2, marking: -3, strength: -1.5 },
  w_inverted: { dribbling: 3, finishing: 2, longShots: 2, flair: 2.5, agility: 2, acceleration: 2, crossing: -0.5, tackling: -3, marking: -3, heading: -2 },
  st_poacher: { finishing: 4, offTheBall: 3.5, anticipation: 2, composure: 2, acceleration: 1, passing: -2, tackling: -4, marking: -4, strength: -0.5 },
  st_target: { heading: 4, strength: 4, jumping: 3, bravery: 2, finishing: 1.5, pace: -3, agility: -2, dribbling: -2, acceleration: -2, tackling: -3, marking: -3 },
  st_complete: { finishing: 2.5, firstTouch: 2, strength: 1, passing: 1, heading: 1, composure: 1.5, offTheBall: 2, tackling: -3, marking: -3 },
  st_pressing: { workRate: 4, stamina: 3, aggression: 2, acceleration: 2, pace: 1.5, finishing: 1.5, composure: -1, tackling: -1.5, marking: -2 },
};

export const ARCHETYPES_BY_POS: Record<Pos, Archetype[]> = {
  GK: ['gk_shot', 'gk_shot', 'gk_sweep'],
  DC: ['cb_stopper', 'cb_ball', 'cb_quick'],
  DL: ['fb_att', 'fb_def', 'fb_att'], DR: ['fb_att', 'fb_def', 'fb_att'],
  WBL: ['fb_att'], WBR: ['fb_att'],
  DM: ['dm_destroyer', 'dm_playmaker'],
  MC: ['cm_b2b', 'cm_playmaker', 'cm_mezzala'],
  ML: ['w_winger', 'cm_b2b'], MR: ['w_winger', 'cm_b2b'],
  AML: ['w_winger', 'w_inverted'], AMR: ['w_winger', 'w_inverted'],
  AMC: ['am_creator', 'am_second'],
  ST: ['st_poacher', 'st_target', 'st_complete', 'st_pressing'],
};

const SECONDARY: Partial<Record<Pos, Pos[]>> = {
  DL: ['WBL'], DR: ['WBR'], WBL: ['DL'], WBR: ['DR'], DM: ['MC'], MC: ['DM'], AMC: ['MC'],
  AML: ['ML'], AMR: ['MR'], ML: ['AML'], MR: ['AMR'], ST: [], DC: [], GK: [],
};

export interface GenerateOpts {
  pos: Pos;
  targetCA: number; // 0..200
  age: number;
  archetype?: Archetype;
  pa?: number;
  foot?: 'L' | 'R' | 'B';
  extraPositions?: Pos[];
}

export interface GeneratedPlayer {
  attrs: Attributes;
  hidden: Hidden;
  familiarity: Familiarity;
  foot: 'L' | 'R' | 'B';
  heightCm: number;
  ca: number;
  pa: number;
  archetype: Archetype;
}

export function generatePlayer(rng: Rng, o: GenerateOpts): GeneratedPlayer {
  const archetype = o.archetype ?? rng.pick(ARCHETYPES_BY_POS[o.pos]);
  const prof = PROFILE[archetype];
  const isGk = o.pos === 'GK';
  const foot: 'L' | 'R' | 'B' = o.foot ?? (['DL', 'WBL', 'ML'].includes(o.pos) ? (rng.chance(0.75) ? 'L' : 'R')
    : ['DR', 'WBR', 'MR'].includes(o.pos) ? (rng.chance(0.85) ? 'R' : 'L')
    : o.pos === 'AML' ? (rng.chance(0.5) ? 'R' : 'L') : o.pos === 'AMR' ? (rng.chance(0.5) ? 'L' : 'R')
    : rng.chance(0.06) ? 'B' : rng.chance(0.22) ? 'L' : 'R');
  const heightCm = Math.round(clamp(
    (isGk ? 190 : archetype === 'st_target' || archetype === 'cb_stopper' ? 189 : archetype.startsWith('w_') || archetype === 'am_creator' ? 175 : 181) + rng.normal(0, 5),
    162, 204,
  ));
  const hb = (heightCm - 181) / 8;

  const base = o.targetCA;
  const a = {} as Attributes;
  for (const k of ATTR_KEYS) {
    let v = base + (prof[k] ?? 0) * 10 + rng.normal(0, 10);
    if ((GOALKEEPING as readonly string[]).includes(k)) v = isGk ? v : 12 + rng.normal(0, 5);
    else if (isGk && !['composure', 'decisions', 'anticipation', 'positioning', 'concentration', 'bravery', 'leadership', 'agility', 'jumping', 'strength', 'passing', 'teamwork', 'workRate', 'naturalFitness', 'stamina', 'acceleration', 'balance', 'vision', 'firstTouch', 'aggression'].includes(k)) {
      v = base * 0.35 + rng.normal(0, 10);
    }
    a[k] = v;
  }
  a.heading += hb * 10; a.jumping += hb * 8; a.strength += hb * 8; a.agility -= hb * 6; a.acceleration -= hb * 5;
  if (isGk) { a.aerialReach += hb * 8; a.commandOfArea += hb * 5; }

  // Age shaping: youngsters are raw physically and mentally; veterans lose pace, gain nous.
  const age = o.age;
  const phys: AttrKey[] = ['pace', 'acceleration', 'agility', 'stamina', 'naturalFitness'];
  const ment: AttrKey[] = ['decisions', 'composure', 'anticipation', 'concentration', 'positioning', 'leadership'];
  if (age <= 20) { for (const k of ment) a[k] -= (21 - age) * 5; a.strength -= (21 - age) * 5; a.leadership -= 20; }
  if (age >= 30) { for (const k of phys) a[k] -= (age - 29) * 6; for (const k of ment) a[k] += Math.min(15, (age - 29) * 3); }
  a.leadership += (age - 24) * 4;

  for (const k of ATTR_KEYS) a[k] = clampAttr(a[k]);

  const listed: Pos[] = [o.pos, ...(o.extraPositions ?? []), ...((SECONDARY[o.pos] ?? []).filter(() => rng.chance(0.5)))];
  const familiarity = deriveFamiliarity([...new Set(listed)], foot);

  // Normalise so current ability hits the target.
  const adjustable = ATTR_KEYS.filter((k) => (isGk ? true : !(GOALKEEPING as readonly string[]).includes(k)));
  for (let iter = 0; iter < 4; iter++) {
    const ca = currentAbility(a, familiarity);
    const diff = o.targetCA - ca;
    if (Math.abs(diff) < 1.5) break;
    for (const k of adjustable) a[k] = clampAttr(a[k] + diff);
  }
  const ca = currentAbility(a, familiarity);

  const hidden: Hidden = {
    consistency: Math.round(clamp(10 + (age - 22) * 0.3 + rng.normal(0, 3), 1, 20)),
    importantMatches: Math.round(clamp(rng.normal(10.5, 3.5), 1, 20)),
    injuryProneness: Math.round(clamp(rng.normal(8, 3.5), 1, 20)),
    adaptability: Math.round(clamp(rng.normal(11.5, 3.5), 1, 20)),
    ambition: Math.round(clamp(rng.normal(11.5, 3.5), 1, 20)),
    loyalty: Math.round(clamp(rng.normal(11, 3.5), 1, 20)),
    professionalism: Math.round(clamp(rng.normal(11.5, 3.5), 1, 20)),
    temperament: Math.round(clamp(rng.normal(12, 3), 1, 20)),
  };
  const pa = Math.round(clamp(o.pa ?? ca, ca, 200));
  return { attrs: a, hidden, familiarity, foot, heightCm, ca, pa, archetype };
}

/** Random potential for a youth prospect; occasionally a gem. */
export function rollYouthPotential(rng: Rng, ca: number, quality: number): number {
  // quality 0..1 from academy tier + reputation
  const gem = rng.chance(0.012 + quality * 0.018);
  const mean = ca + 25 + quality * 30 + (gem ? 45 : 0);
  return Math.round(clamp(rng.normal(mean, gem ? 10 : 16), ca + 5, gem ? 195 : 178));
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export interface NamePool { first: string[]; last: string[] }

export function randomName(rng: Rng, pools: Record<string, NamePool>, nat: string): { first: string; last: string } {
  const pool = pools[nat] && pools[nat].last.length >= 4 ? pools[nat] : pools['ENG'] ?? Object.values(pools)[0];
  return { first: rng.pick(pool.first), last: rng.pick(pool.last) };
}
