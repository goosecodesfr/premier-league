// Derived ratings: role ratings, current ability, and the form/morale/sharpness multiplier.
import type { Attributes, AttrKey } from './attributes.ts';
import { POSITIONS, type Familiarity, type Pos } from './positions.ts';
import { ROLES, roleWeights, rolesForPosition, type Duty, type RoleKey, defaultRoleForPosition } from './roles.ts';

export function rawRoleRating(a: Attributes, role: RoleKey, duty: Duty): number {
  let s = 0;
  for (const [k, w] of roleWeights(role, duty)) s += a[k] * w;
  return s;
}

/** Multiplier from volatile states, centred on 1.0: (1 + form + morale + sharpness) / 4. */
export function stateMultiplier(form: number, morale: number, sharpness: number): number {
  const s = 0.88 + 0.14 * (sharpness / 100);
  return (1 + form + morale + s) / 4;
}

/**
 * Role rating on the 0..200 scale as shown to managers: attribute composite x state multiplier
 * x positional familiarity (floored at 0.55).
 */
export function roleRating(
  a: Attributes,
  role: RoleKey,
  duty: Duty,
  opts: { pos?: Pos; familiarity?: Familiarity; form?: number; morale?: number; sharpness?: number } = {},
): number {
  const base = rawRoleRating(a, role, duty);
  const mult = stateMultiplier(opts.form ?? 1, opts.morale ?? 1, opts.sharpness ?? 90);
  let fam = 1;
  if (opts.pos && opts.familiarity) fam = Math.max(0.55, opts.familiarity[opts.pos] ?? 0);
  return base * mult * fam;
}

/** Rating of the player's best role at a given position (default duty). */
export function bestRoleAt(a: Attributes, pos: Pos): { role: RoleKey; duty: Duty; rating: number } {
  let best = { ...defaultRoleForPosition(pos), rating: -1 };
  for (const r of rolesForPosition(pos)) {
    for (const d of r.duties) {
      const v = rawRoleRating(a, r.key, d);
      if (v > best.rating) best = { role: r.key, duty: d, rating: v };
    }
  }
  return best;
}

/** Position rating = best role composite at that position x familiarity. */
export function positionRating(a: Attributes, fam: Familiarity, pos: Pos): number {
  const f = fam[pos] ?? 0;
  if (f <= 0) return 0;
  return bestRoleAt(a, pos).rating * Math.max(0.55, f);
}

/** Current ability (0..200): the best rating among the player's natural positions. */
export function currentAbility(a: Attributes, fam: Familiarity): number {
  let best = 0;
  for (const p of POSITIONS) {
    const f = fam[p] ?? 0;
    if (f < 0.84) continue;
    const r = bestRoleAt(a, p).rating;
    if (r > best) best = r;
  }
  if (best === 0) {
    for (const p of POSITIONS) best = Math.max(best, positionRating(a, fam, p));
  }
  return Math.round(best);
}

/** Top-N role suitability list for the player card. */
export function roleSuitability(a: Attributes, fam: Familiarity, n = 5) {
  const out: { role: RoleKey; duty: Duty; pos: Pos; rating: number; name: string }[] = [];
  for (const p of POSITIONS) {
    const f = fam[p] ?? 0;
    if (f < 0.5) continue;
    for (const r of rolesForPosition(p)) {
      const d = r.defaultDuty;
      const v = rawRoleRating(a, r.key, d) * Math.max(0.55, f);
      out.push({ role: r.key, duty: d, pos: p, rating: Math.round(v), name: r.name });
    }
  }
  // de-duplicate by role (keep best position)
  const byRole = new Map<string, (typeof out)[number]>();
  for (const o of out) {
    const k = o.role;
    const prev = byRole.get(k);
    if (!prev || prev.rating < o.rating) byRole.set(k, o);
  }
  return [...byRole.values()].sort((x, y) => y.rating - x.rating).slice(0, n);
}

/** Display a 0..200 rating as 1..20 with one decimal (for overall numbers). */
export function displayRating(v: number): number {
  return Math.round(v) / 10;
}

// ---- Engine composites ----
export type CompositeKey =
  | 'pass' | 'longPass' | 'through' | 'dribble' | 'cross' | 'finish' | 'longShot' | 'headerAtt'
  | 'hold' | 'tackle' | 'press' | 'intercept' | 'aerialDef' | 'mark' | 'runner' | 'lineDef'
  | 'gkSave' | 'gkClaim' | 'gkDist' | 'gkSweep' | 'setPiece' | 'penalty' | 'composureC' | 'recovery';

export const COMPOSITES: Record<CompositeKey, Partial<Record<AttrKey, number>>> = {
  pass: { passing: 0.45, decisions: 0.15, composure: 0.15, firstTouch: 0.1, vision: 0.15 },
  longPass: { passing: 0.45, vision: 0.3, decisions: 0.1, composure: 0.15 },
  through: { vision: 0.4, passing: 0.35, decisions: 0.15, composure: 0.1 },
  dribble: { dribbling: 0.35, agility: 0.15, balance: 0.1, flair: 0.1, acceleration: 0.15, firstTouch: 0.15 },
  cross: { crossing: 0.65, vision: 0.15, decisions: 0.1, composure: 0.1 },
  finish: { finishing: 0.5, composure: 0.25, firstTouch: 0.1, decisions: 0.1, balance: 0.05 },
  longShot: { longShots: 0.6, composure: 0.15, finishing: 0.15, decisions: 0.1 },
  headerAtt: { heading: 0.4, jumping: 0.25, strength: 0.1, bravery: 0.1, offTheBall: 0.15 },
  hold: { strength: 0.35, balance: 0.2, firstTouch: 0.25, bravery: 0.1, teamwork: 0.1 },
  tackle: { tackling: 0.4, anticipation: 0.15, positioning: 0.15, strength: 0.1, pace: 0.1, concentration: 0.1 },
  press: { workRate: 0.3, stamina: 0.15, aggression: 0.15, acceleration: 0.15, anticipation: 0.15, teamwork: 0.1 },
  intercept: { anticipation: 0.35, positioning: 0.35, concentration: 0.15, decisions: 0.15 },
  aerialDef: { heading: 0.35, jumping: 0.25, strength: 0.15, positioning: 0.15, bravery: 0.1 },
  mark: { marking: 0.4, positioning: 0.2, concentration: 0.2, strength: 0.1, pace: 0.1 },
  runner: { offTheBall: 0.35, pace: 0.25, acceleration: 0.25, anticipation: 0.15 },
  lineDef: { positioning: 0.25, anticipation: 0.2, concentration: 0.2, pace: 0.2, acceleration: 0.15 },
  gkSave: { shotStopping: 0.4, reflexes: 0.3, oneOnOnes: 0.1, positioning: 0.1, agility: 0.1 },
  gkClaim: { commandOfArea: 0.35, aerialReach: 0.35, handling: 0.2, bravery: 0.1 },
  gkDist: { distribution: 0.6, passing: 0.2, composure: 0.2 },
  gkSweep: { rushingOut: 0.4, oneOnOnes: 0.3, acceleration: 0.15, decisions: 0.15 },
  setPiece: { setPieces: 0.6, crossing: 0.2, vision: 0.1, composure: 0.1 },
  penalty: { setPieces: 0.3, finishing: 0.3, composure: 0.4 },
  composureC: { composure: 0.6, decisions: 0.4 },
  recovery: { pace: 0.4, acceleration: 0.3, anticipation: 0.3 },
};

export const COMPOSITE_KEYS = Object.keys(COMPOSITES) as CompositeKey[];

export function composite(a: Attributes, key: CompositeKey): number {
  let s = 0;
  for (const [k, w] of Object.entries(COMPOSITES[key]) as [AttrKey, number][]) s += a[k] * w;
  return s;
}

export const ROLE_LINE = (role: RoleKey) => {
  const p = ROLES[role].positions[0];
  return p === 'GK' ? 'GK' : ['DC', 'DL', 'DR', 'WBL', 'WBR'].includes(p) ? 'DEF' : p === 'ST' ? 'ATT' : 'MID';
};
