// Zone presence: where each player spends his time with and without the ball.
// Pitch = 6 bands (own box .. their box) x 3 channels (left, centre, right), from the team's own perspective.
import { ROLES, dutyIndex, type Duty, type RoleKey } from '../roles.ts';
import type { Instructions, PlayerInstructions, TacticSlot } from '../tactics.ts';

export const ZONES = 18;
export const zoneOf = (band: number, chan: number) => band * 3 + chan;
export const bandOf = (z: number) => (z / 3) | 0;
export const chanOf = (z: number) => z % 3;
/** Zone seen from the opponent's perspective. */
export const mirror = (z: number) => (5 - bandOf(z)) * 3 + (2 - chanOf(z));

export const BAND_NAMES = ['own box', 'own third', 'own half', 'their half', 'final third', 'their box'];
export const CHAN_NAMES = ['left', 'centre', 'right'];

export interface PresenceParams {
  slot: TacticSlot;
  role: RoleKey;
  duty: Duty;
  mentality: number;
  ins: Instructions;
  activity: number; // work-rate / condition driven multiplier for defensive presence
  pi?: PlayerInstructions;
  /** Positional familiarity 0..1: players out of position drift around more. */
  fam?: number;
}

/** Extra spread for a player who does not know the position. */
function discipline(fam: number | undefined): number {
  const f = fam ?? 1;
  return f >= 0.8 ? 1 : 1 + (0.8 - f) * 0.7;
}

function gauss(d: number, s: number) {
  return Math.exp(-(d * d) / (2 * s * s));
}

function fill(out: Float64Array, band: number, chan: number, sb: number, sc: number, scale: number) {
  let total = 0;
  const tmp = new Float64Array(ZONES);
  for (let b = 0; b < 6; b++) {
    const gb = gauss(b + 0.5 - band, sb);
    for (let c = 0; c < 3; c++) {
      const v = gb * gauss(c - chan, sc);
      tmp[b * 3 + c] = v;
      total += v;
    }
  }
  if (total <= 0) return;
  for (let i = 0; i < ZONES; i++) out[i] += (tmp[i] / total) * scale;
}

/** Attacking (in-possession) presence distribution for one player. */
export function attackPresence(p: PresenceParams, out: Float64Array) {
  const r = ROLES[p.role];
  if (p.role === 'GK' || p.role === 'SK') {
    fill(out, 0.45 + r.adv[dutyIndex(p.duty)], 1, 0.35, 0.35, 0.35);
    return;
  }
  let band = (p.slot.y / 100) * 6 + r.adv[dutyIndex(p.duty)] + p.mentality * 0.22;
  const isBack = p.slot.y < 32;
  if (isBack) {
    band += { deep: -0.25, normal: 0, high: 0.25, very_high: 0.45 }[p.ins.line];
    if ((p.role === 'FB' || p.role === 'WB') && p.ins.overlap === 'overlap') band += 0.35;
  }
  if (p.ins.tempo === 'high') band += 0.1;
  if (p.pi?.movement === 'forward') band += 0.45;
  if (p.pi?.movement === 'hold') band -= 0.35;
  band = Math.max(0.35, Math.min(5.7, band));
  let chan = p.slot.x / 50; // 0..2
  const widthScale = p.ins.width === 'wide' ? 1.18 : p.ins.width === 'narrow' ? 0.8 : 1;
  chan = 1 + (chan - 1) * widthScale;
  chan = chan + (1 - chan) * r.inside; // inside > 0 drifts to centre, < 0 hugs line
  if ((p.role === 'FB' || p.role === 'WB') && p.ins.overlap === 'underlap') chan = chan + (1 - chan) * 0.35;
  if (p.pi?.width === 'inside') chan = chan + (1 - chan) * 0.45;
  if (p.pi?.width === 'wide' && Math.abs(chan - 1) > 0.15) chan = 1 + (chan - 1) * 1.3;
  chan = Math.max(-0.1, Math.min(2.1, chan));
  const sb = Math.max(0.4, 0.8 * r.roam) * discipline(p.fam);
  const sc = Math.abs(chan - 1) > 0.6 ? 0.42 : 0.55;
  fill(out, band, chan, sb, sc, 1);
}

/** Defensive (out-of-possession) presence distribution for one player, in own perspective. */
export function defencePresence(p: PresenceParams, out: Float64Array) {
  const r = ROLES[p.role];
  if (p.role === 'GK' || p.role === 'SK') {
    fill(out, 0.4, 1, 0.3, 0.35, 0.3);
    return;
  }
  const lineShift = { deep: -0.55, normal: 0, high: 0.45, very_high: 0.75 }[p.ins.line];
  let band = (p.slot.y / 100) * 6 - 0.55 - r.drop + p.mentality * 0.12;
  // Defenders and midfielders follow the line; forwards follow the press.
  if (p.slot.y < 62) band += lineShift * (p.slot.y < 32 ? 1 : 0.8);
  else band += { low: -0.6, normal: 0, high: 0.25, all_out: 0.45 }[p.ins.press] + lineShift * 0.4;
  if (p.pi?.press === 'more') band += p.slot.y < 32 ? 0.1 : 0.3;
  if (p.pi?.press === 'less') band -= 0.25;
  if (p.pi?.movement === 'forward') band += 0.15;
  if (p.pi?.movement === 'hold') band -= 0.1;
  band = Math.max(0.3, Math.min(5.2, band));
  let chan = p.slot.x / 50;
  const compact = p.ins.width === 'narrow' ? 0.62 : p.ins.width === 'wide' ? 0.85 : 0.74;
  chan = 1 + (chan - 1) * compact;
  const sb = Math.max(0.4, 0.75 * r.roam) * discipline(p.fam);
  fill(out, band, chan, sb, 0.55 * discipline(p.fam), p.activity);
}
