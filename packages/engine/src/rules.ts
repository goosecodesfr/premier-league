// Pure game rules shared by server and client: valuation, wages, development, recovery,
// form and morale, contracts. No I/O.
import { ATTR_KEYS, GOALKEEPING, MENTAL, PHYSICAL, TECHNICAL, clampAttr, type Attributes, type AttrKey } from './attributes.ts';
import type { Familiarity } from './positions.ts';
import { currentAbility } from './ratings.ts';
import { clamp, type Rng } from './rng.ts';

// ---------------------------------------------------------------- money
/** Market value in GBP. Age is the dominant term. */
export function playerValue(p: { ca: number; pa: number; age: number; contractYearsLeft: number; form?: number; isGk?: boolean }): number {
  const base = 150_000_000 * Math.exp((p.ca - 190) * 0.0489);
  const age = p.age;
  let ageF: number;
  if (age <= 18) ageF = 1.5;
  else if (age <= 21) ageF = 1.75;
  else if (age <= 23) ageF = 1.55;
  else if (age <= 25) ageF = 1.3;
  else if (age <= 27) ageF = 1.05;
  else if (age <= 28) ageF = 0.9;
  else if (age <= 29) ageF = 0.75;
  else if (age <= 30) ageF = 0.6;
  else if (age <= 31) ageF = 0.45;
  else if (age <= 32) ageF = 0.34;
  else if (age <= 33) ageF = 0.25;
  else ageF = 0.15;
  const potential = age <= 24 ? 1 + Math.max(0, p.pa - p.ca) / (age <= 20 ? 70 : 110) : 1;
  const contract = p.contractYearsLeft <= 0 ? 0.35 : p.contractYearsLeft === 1 ? 0.65 : p.contractYearsLeft === 2 ? 0.88 : 1;
  const form = p.form ? 0.85 + (p.form - 0.85) * 0.5 : 1;
  const gk = p.isGk ? 0.75 : 1;
  const v = base * ageF * potential * contract * form * gk;
  return roundMoney(Math.max(50_000, v));
}

export function roundMoney(v: number): number {
  if (v >= 10_000_000) return Math.round(v / 500_000) * 500_000;
  if (v >= 1_000_000) return Math.round(v / 100_000) * 100_000;
  return Math.round(v / 10_000) * 10_000;
}

/** Weekly wage a player expects at a club of a given reputation. */
export function wageDemand(p: { ca: number; age: number; ambition?: number; currentWage?: number }, clubRep: number): number {
  const base = 1_900 * Math.pow(2, (p.ca - 100) / 13) * (0.35 + (clubRep / 100) * 0.95);
  const ambition = 1 + ((p.ambition ?? 10) - 10) * 0.015;
  const ageF = p.age >= 31 ? 0.85 : p.age <= 21 ? 0.8 : 1;
  let w = base * ambition * ageF;
  if (p.currentWage) w = Math.max(w, p.currentWage * 1.05);
  return Math.max(1000, Math.round(w / 500) * 500);
}

export const WAGE_SCALE = 1.6; // dataset wages are below real-world levels

// ---------------------------------------------------------------- development
/** Ageing curve g(age): strongly positive to 21, mildly to 26, flat to 29, negative from 30, steep from 33. */
export function ageCurve(age: number): number {
  if (age <= 18) return 1.25;
  if (age <= 21) return 1.0;
  if (age <= 23) return 0.65;
  if (age <= 26) return 0.35;
  if (age <= 29) return 0.05;
  if (age <= 30) return -0.25;
  if (age <= 32) return -0.55;
  if (age <= 34) return -0.95;
  return -1.4;
}

export interface DevInput {
  attrs: Attributes;
  fam: Familiarity;
  ca: number;
  pa: number;
  age: number;
  professionalism: number;
  minutesFactor: number; // 0..1.2 recent playing time
  trainingMult: number; // facilities x coach x intensity
  focusGroup?: 'technical' | 'mental' | 'physical' | 'goalkeeping' | null;
  isGk: boolean;
}

/**
 * One weekly development roll. Returns the new attributes and CA.
 * dCA = k * (P - CA)/P * g(age) * prof/15 * t * minutes
 */
export function developWeek(d: DevInput, rng: Rng): { attrs: Attributes; ca: number; delta: number } {
  const g = ageCurve(d.age);
  let dCA: number;
  if (g >= 0) {
    const room = Math.max(0, d.pa - d.ca) / Math.max(1, d.pa);
    dCA = 2.0 * room * g * (d.professionalism / 15) * d.trainingMult * (0.45 + 0.55 * d.minutesFactor);
  } else {
    // decline: mitigated by professionalism and fitness work
    dCA = 0.3 * g * (1.25 - d.professionalism / 40) * (1.1 - (d.trainingMult - 1) * 0.5);
  }
  dCA += rng.normal(0, 0.18);
  const a = { ...d.attrs };
  if (Math.abs(dCA) < 0.02) return { attrs: a, ca: d.ca, delta: 0 };
  // Distribute across groups by age: youngsters grow physically, veterans lose pace but gain nous.
  let share: Record<'technical' | 'mental' | 'physical', number>;
  if (dCA >= 0) {
    share = d.age <= 21 ? { technical: 0.4, physical: 0.35, mental: 0.25 } : d.age <= 26 ? { technical: 0.4, mental: 0.4, physical: 0.2 } : { mental: 0.65, technical: 0.3, physical: 0.05 };
  } else {
    share = { physical: 0.75, technical: 0.3, mental: -0.05 };
  }
  if (d.focusGroup && d.focusGroup !== 'goalkeeping' && dCA > 0) {
    share = { ...share, [d.focusGroup]: share[d.focusGroup] + 0.25 };
  }
  const groups: Record<string, readonly AttrKey[]> = { technical: TECHNICAL, mental: MENTAL, physical: PHYSICAL };
  for (const [gname, keys] of Object.entries(groups)) {
    const s = share[gname as keyof typeof share] ?? 0;
    const per = (dCA * s * 3) / 1; // per-attribute delta scaled so role composites move ~dCA
    for (const key of keys) {
      if (d.isGk && gname === 'technical' && !['passing', 'firstTouch'].includes(key)) continue;
      const jitter = 0.6 + rng.next() * 0.8;
      a[key] = stochasticRound(a[key] + per * jitter, rng);
    }
  }
  if (d.isGk) {
    for (const key of GOALKEEPING) {
      const jitter = 0.6 + rng.next() * 0.8;
      a[key] = stochasticRound(a[key] + dCA * (dCA >= 0 ? 1.1 : 0.7) * jitter, rng);
    }
  }
  // Don't let natural fitness and leadership swing with weekly noise
  a.leadership = d.attrs.leadership + (d.age >= 24 && dCA > -1 ? 0.15 : 0);
  const ca = currentAbility(a, d.fam);
  // Cap by potential
  if (ca > d.pa && dCA > 0) return { attrs: d.attrs, ca: d.ca, delta: 0 };
  return { attrs: a, ca, delta: ca - d.ca };
}

function stochasticRound(v: number, rng: Rng): number {
  const f = Math.floor(v);
  return clampAttr(f + (rng.next() < v - f ? 1 : 0));
}

// ---------------------------------------------------------------- fitness
/** Condition recovery per rest day (percentage points): ~8 + natural_fitness * 0.6 (1..20 scale). */
export function dailyRecovery(naturalFitness: number, opts: { fitnessCoach?: number; intensity?: 'low' | 'normal' | 'high'; age?: number } = {}): number {
  const nf = naturalFitness / 10;
  let r = 8 + nf * 0.6;
  r *= 1 + ((opts.fitnessCoach ?? 10) - 10) * 0.015;
  if (opts.intensity === 'high') r *= 0.82;
  if (opts.intensity === 'low') r *= 1.12;
  if ((opts.age ?? 25) >= 32) r *= 0.9;
  return r;
}

/** Fatigue debt accumulated from a match (0..100 scale), decays daily. */
export function fatigueFromMatch(minutes: number, conditionEnd: number, daysSinceLast: number): number {
  const load = (minutes / 90) * (conditionEnd < 70 ? 14 : 9);
  const congestion = daysSinceLast <= 2 ? 1.6 : daysSinceLast <= 3 ? 1.2 : 1;
  return load * congestion;
}

export function sharpnessAfterMatch(sharpness: number, minutes: number): number {
  return clamp(sharpness + minutes * 0.22, 0, 100);
}

/** Form multiplier (0.85..1.15) from recent ratings, most recent weighted highest. */
export function formFromRatings(ratings: number[]): number {
  const last = ratings.slice(-6);
  if (!last.length) return 1;
  let wsum = 0;
  let s = 0;
  last.forEach((r, i) => {
    const w = 1 + i * 0.35;
    s += r * w;
    wsum += w;
  });
  const avg = s / wsum;
  return clamp(1 + (avg - 6.75) * 0.085, 0.85, 1.15);
}

export function moraleLabel(m: number): 'very poor' | 'poor' | 'okay' | 'good' | 'very good' {
  if (m < 0.93) return 'very poor';
  if (m < 0.97) return 'poor';
  if (m < 1.02) return 'okay';
  if (m < 1.06) return 'good';
  return 'very good';
}

// ---------------------------------------------------------------- injuries
import type { InjurySeverity } from './match/types.ts';

export interface InjuryState {
  type: string;
  severity: InjurySeverity;
  daysLeft: number;
  daysTotal: number;
  since: string; // ISO date
}

export function injuryRangeText(daysLeft: number): string {
  if (daysLeft <= 1) return 'a day or two';
  if (daysLeft <= 4) return `${Math.max(1, daysLeft - 1)}-${daysLeft + 1} days`;
  const w = daysLeft / 7;
  if (w < 2) return '1-2 weeks';
  if (w < 8) return `${Math.floor(w)}-${Math.ceil(w) + 1} weeks`;
  const m = w / 4.3;
  return `${Math.floor(m)}-${Math.ceil(m) + 1} months`;
}

/** Training-ground injury probability per player per day. */
export function trainingInjuryChance(injuryProneness: number, fatigueDebt: number, intensity: 'low' | 'normal' | 'high', medicalTier: number): number {
  const base = 0.0012;
  const prone = Math.pow(injuryProneness / 8, 0.8);
  const inten = intensity === 'high' ? 1.6 : intensity === 'low' ? 0.6 : 1;
  const debt = 1 + fatigueDebt / 60;
  const med = 1 - (medicalTier - 1) * 0.06;
  return base * prone * inten * debt * med;
}

// ---------------------------------------------------------------- contracts
export function contractYearsLeft(contractUntil: number, seasonNo: number): number {
  return contractUntil - seasonNo;
}

/** Probability a player accepts a contract offer. */
export function contractAcceptance(offerWage: number, demand: number, years: number, opts: { age: number; loyalty?: number; clubRep?: number; playerRep?: number; promise?: 'key' | 'rotation' | 'backup' }): number {
  const ratio = offerWage / Math.max(1, demand);
  let x = (ratio - 0.95) * 9;
  if (opts.age >= 30 && years >= 3) x += 0.6;
  if (opts.age <= 24 && years >= 5) x -= 0.3;
  x += ((opts.loyalty ?? 10) - 10) * 0.05;
  if (opts.promise === 'key') x += 0.5;
  if (opts.promise === 'backup') x -= 0.8;
  if (opts.clubRep !== undefined && opts.playerRep !== undefined) x += (opts.clubRep - opts.playerRep) * 0.03;
  return clamp(1 / (1 + Math.exp(-x)), 0.01, 0.99);
}

/** How reputable a player is (1..100) from ability. */
export function playerReputation(ca: number): number {
  return clamp(Math.round((ca - 90) * 0.95), 1, 100);
}

// ---------------------------------------------------------------- attribute helpers
export function scaleAttrs(a: Attributes, f: number): Attributes {
  const out = { ...a };
  for (const k of ATTR_KEYS) out[k] = clampAttr(a[k] * f);
  return out;
}
