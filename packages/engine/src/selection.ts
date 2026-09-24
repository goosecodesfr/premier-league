// Squad selection: best XI for a tactic, bench, and set-piece takers. Used by bots, by the
// assistant manager when a human misses a deadline, and by the "auto-fill" button.
import type { Attributes } from './attributes.ts';
import { POS_LINE, type Familiarity, type Pos } from './positions.ts';
import { composite, rawRoleRating, stateMultiplier } from './ratings.ts';
import type { Rng } from './rng.ts';
import type { Tactic } from './tactics.ts';

export interface SelectablePlayer {
  id: number;
  attrs: Attributes;
  fam: Familiarity;
  condition: number;
  sharpness: number;
  form: number;
  morale: number;
  age: number;
  available: boolean; // not injured / suspended
  ca?: number;
}

export interface SelectionOpts {
  /** Bench anyone below this condition when possible (rotation rule). */
  restBelow?: number;
  /** Extra weight for under-21s (Youth Builder), or for experience (Cynic). */
  youthBonus?: number;
  experienceBonus?: number;
  /** Random noise (imperfection), 0 = perfect. */
  noise?: number;
  rng?: Rng;
  benchSize?: number;
  /** Players to keep in the XI if available (e.g. a human's saved lineup). */
  keep?: Map<number, number>; // playerId -> slot index
  /** Stars rested for low-importance games. */
  importance?: number;
}

export function slotScore(p: SelectablePlayer, pos: Pos, role: Parameters<typeof rawRoleRating>[1], duty: Parameters<typeof rawRoleRating>[2], o: SelectionOpts = {}): number {
  const fam = p.fam[pos] ?? 0;
  if (pos === 'GK' && fam < 0.5) return -1;
  if (pos !== 'GK' && (p.fam.GK ?? 0) >= 0.8 && fam < 0.3) return -1;
  const famF = Math.max(0.55, fam);
  const cond = p.condition;
  const condF = cond >= 90 ? 1 : cond >= 75 ? 0.97 - (90 - cond) * 0.004 : 0.9 - (75 - cond) * 0.012;
  let v = rawRoleRating(p.attrs, role, duty) * famF * condF * stateMultiplier(p.form, p.morale, p.sharpness);
  if (o.youthBonus && p.age <= 21) v += o.youthBonus;
  if (o.experienceBonus && p.age >= 28) v += o.experienceBonus;
  if (o.noise && o.rng) v += o.rng.normal(0, o.noise);
  return v;
}

export interface Selection {
  lineup: number[]; // by slot index
  bench: number[];
  captainId: number | null;
  setPieces: { cornerTaker: number | null; freeKickTaker: number | null; penaltyTaker: number | null };
  strength: number; // average slot score of the XI
}

export function selectTeam(players: SelectablePlayer[], tactic: Tactic, o: SelectionOpts = {}): Selection {
  const avail = players.filter((p) => p.available);
  const restBelow = o.restBelow ?? 0;
  const slots = tactic.slots;
  const lineup: (number | null)[] = new Array(slots.length).fill(null);
  const used = new Set<number>();

  // Honour kept players first
  if (o.keep) {
    for (const [pid, si] of o.keep) {
      const p = avail.find((x) => x.id === pid);
      if (!p || si < 0 || si >= slots.length || lineup[si] !== null) continue;
      if (p.condition < restBelow) continue;
      if (slotScore(p, slots[si].pos, slots[si].role, slots[si].duty) < 0) continue;
      lineup[si] = p.id;
      used.add(p.id);
    }
  }

  // Candidate count per slot to order by constraint
  const order = slots.map((s, i) => ({ i, n: avail.filter((p) => (p.fam[s.pos] ?? 0) >= 0.8).length }))
    .sort((a, b) => (slots[a.i].pos === 'GK' ? -1 : slots[b.i].pos === 'GK' ? 1 : a.n - b.n));

  for (const pass of [0, 1]) {
    for (const { i } of order) {
      if (lineup[i] !== null) continue;
      const s = slots[i];
      let best: SelectablePlayer | null = null;
      let bv = -Infinity;
      for (const p of avail) {
        if (used.has(p.id)) continue;
        if (pass === 0 && p.condition < restBelow) continue;
        const v = slotScore(p, s.pos, s.role, s.duty, o);
        if (v < 0) continue;
        if (v > bv) { bv = v; best = p; }
      }
      if (best) { lineup[i] = best.id; used.add(best.id); }
    }
  }
  // Last resort: anyone
  for (let i = 0; i < lineup.length; i++) {
    if (lineup[i] !== null) continue;
    const p = avail.find((x) => !used.has(x.id)) ?? players.find((x) => !used.has(x.id));
    if (p) { lineup[i] = p.id; used.add(p.id); }
  }

  // Bench: one keeper, then best remaining covering each line
  const benchSize = o.benchSize ?? 9;
  const bench: number[] = [];
  const rest = avail.filter((p) => !used.has(p.id));
  const bestAt = (pos: Pos) => rest.filter((p) => !bench.includes(p.id)).map((p) => ({ p, v: (p.fam[pos] ?? 0) >= 0.75 ? rawRoleRating(p.attrs, pos === 'GK' ? 'GK' : pos === 'DC' ? 'CD' : pos === 'ST' ? 'CF' : 'CM', 'S') * (0.8 + p.condition / 500) : -1 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)[0]?.p;
  const gk = bestAt('GK');
  if (gk) bench.push(gk.id);
  for (const pos of ['DC', 'MC', 'ST', 'DL', 'AMR', 'DM', 'AML', 'DR'] as Pos[]) {
    if (bench.length >= benchSize) break;
    const p = bestAt(pos);
    if (p) bench.push(p.id);
  }
  for (const p of rest.sort((a, b) => (b.ca ?? 0) - (a.ca ?? 0))) {
    if (bench.length >= benchSize) break;
    if (!bench.includes(p.id) && (p.fam.GK ?? 0) < 0.8) bench.push(p.id);
  }

  const xi = lineup.filter((x): x is number => x !== null);
  const xiPlayers = xi.map((id) => players.find((p) => p.id === id)!).filter(Boolean);
  const captain = xiPlayers.slice().sort((a, b) => (b.attrs.leadership + b.age * 2) - (a.attrs.leadership + a.age * 2))[0];
  const outfield = xiPlayers.filter((p) => (p.fam.GK ?? 0) < 0.8);
  const by = (k: Parameters<typeof composite>[1]) => outfield.slice().sort((a, b) => composite(b.attrs, k) - composite(a.attrs, k))[0]?.id ?? null;
  const strength = xi.length ? xi.reduce((s, id, idx) => {
    const p = players.find((x) => x.id === id)!;
    const sl = slots[idx];
    return s + Math.max(0, rawRoleRating(p.attrs, sl.role, sl.duty) * Math.max(0.55, p.fam[sl.pos] ?? 0));
  }, 0) / xi.length : 0;
  return {
    lineup: lineup.map((x) => x ?? -1),
    bench,
    captainId: captain?.id ?? null,
    setPieces: { cornerTaker: by('setPiece'), freeKickTaker: by('setPiece'), penaltyTaker: by('penalty') },
    strength,
  };
}

/** Warnings shown in the formation editor summary bar. */
export function lineupWarnings(players: SelectablePlayer[], tactic: Tactic, lineup: number[], familiarity: number, captainId?: number | null): string[] {
  const w: string[] = [];
  const byId = new Map(players.map((p) => [p.id, p]));
  const filled = lineup.filter((id) => id >= 0 && byId.has(id));
  if (filled.length < 11) w.push(`Only ${filled.length} players selected`);
  const gkIdx = tactic.slots.findIndex((s) => s.pos === 'GK');
  if (gkIdx < 0 || !byId.has(lineup[gkIdx])) w.push('No goalkeeper selected');
  const unavailable = filled.filter((id) => !byId.get(id)!.available).length;
  if (unavailable) w.push(`${unavailable} unavailable player${unavailable > 1 ? 's' : ''} selected`);
  const tired = filled.filter((id) => byId.get(id)!.condition < 70).length;
  if (tired) w.push(`${tired} player${tired > 1 ? 's' : ''} under 70% condition`);
  let outOfPos = 0;
  tactic.slots.forEach((s, i) => {
    const p = byId.get(lineup[i]);
    if (p && (p.fam[s.pos] ?? 0) < 0.6) outOfPos++;
  });
  if (outOfPos) w.push(`${outOfPos} player${outOfPos > 1 ? 's' : ''} out of position`);
  const lines = new Set(tactic.slots.map((s) => s.pos));
  if ((lines.has('DL') || lines.has('WBL')) && !tactic.slots.some((s, i) => (s.pos === 'DL' || s.pos === 'WBL') && (byId.get(lineup[i])?.fam[s.pos] ?? 0) >= 0.8)) w.push('No recognised left-back');
  if ((lines.has('DR') || lines.has('WBR')) && !tactic.slots.some((s, i) => (s.pos === 'DR' || s.pos === 'WBR') && (byId.get(lineup[i])?.fam[s.pos] ?? 0) >= 0.8)) w.push('No recognised right-back');
  if (familiarity < 0.6) w.push(`Familiarity only ${Math.round(familiarity * 100)}% in this shape`);
  if (captainId && !filled.includes(captainId)) w.push('Captain not in the XI');
  void POS_LINE;
  return w;
}
