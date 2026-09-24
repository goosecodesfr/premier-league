// Player helpers: conversions between DB rows and engine inputs, availability, valuation.
import {
  attrsFromArray, hiddenFromArray, playerValue, type MatchPlayerInput, type SelectablePlayer, type Attributes, type Hidden,
  currentAbility,
} from '@ffm/engine';
import type { Db } from '../db.ts';
import type { PlayerRow } from './types.ts';

export const PLAYER_COLS = `id, club_id, status, name, short, first_name, last_name, nat, age, foot, height, positions, attrs, hidden, ca, pa,
  condition, sharpness, form, morale, fatigue_debt, injury, suspended, yellows, wage, contract_until, squad_number, value, flags,
  form_history, history, joined_season`;

export function isAvailable(p: PlayerRow): boolean {
  return p.status === 'active' && !(p.injury && p.injury.daysLeft > 0) && p.suspended <= 0;
}

const attrCache = new WeakMap<PlayerRow, Attributes>();
export function attrsOf(p: PlayerRow): Attributes {
  let a = attrCache.get(p);
  if (!a) { a = attrsFromArray(p.attrs); attrCache.set(p, a); }
  return a;
}
export function hiddenOf(p: PlayerRow): Hidden {
  return hiddenFromArray(p.hidden);
}

export function toMatchPlayer(p: PlayerRow): MatchPlayerInput {
  return {
    id: p.id, name: p.name, short: p.short, attrs: attrsOf(p), hidden: hiddenOf(p), fam: p.positions, foot: p.foot,
    age: p.age, condition: p.condition, sharpness: p.sharpness, form: p.form, morale: p.morale, fatigueDebt: p.fatigue_debt,
  };
}

export function toSelectable(p: PlayerRow): SelectablePlayer {
  return {
    id: p.id, attrs: attrsOf(p), fam: p.positions, condition: p.condition, sharpness: p.sharpness, form: p.form,
    morale: p.morale, age: p.age, available: isAvailable(p), ca: p.ca,
  };
}

export function valueOf(p: Pick<PlayerRow, 'ca' | 'pa' | 'age' | 'contract_until' | 'form' | 'positions'>, seasonNo: number): number {
  return playerValue({
    ca: p.ca, pa: p.pa, age: p.age, contractYearsLeft: p.contract_until - seasonNo + 1, form: p.form, isGk: (p.positions.GK ?? 0) >= 0.8,
  });
}

export function recomputeCa(p: PlayerRow): number {
  return currentAbility(attrsOf(p), p.positions);
}

export async function loadPlayers(d: Db, where: string, params: unknown[] = []): Promise<PlayerRow[]> {
  return d.many<PlayerRow>(`select ${PLAYER_COLS} from players where ${where}`, params);
}

export async function squadOf(d: Db, clubId: number): Promise<PlayerRow[]> {
  return loadPlayers(d, "club_id = $1 and status = 'active' order by id", [clubId]);
}

export function isGoalkeeper(p: Pick<PlayerRow, 'positions'>): boolean {
  return (p.positions.GK ?? 0) >= 0.8;
}

export function mainPosition(p: Pick<PlayerRow, 'positions'>): string {
  let best = 'MC';
  let bv = -1;
  for (const [k, v] of Object.entries(p.positions)) if ((v ?? 0) > bv) { bv = v ?? 0; best = k; }
  return best;
}

export function lineOf(pos: string): 'GK' | 'DEF' | 'MID' | 'ATT' {
  if (pos === 'GK') return 'GK';
  if (['DC', 'DL', 'DR', 'WBL', 'WBR'].includes(pos)) return 'DEF';
  if (['ST', 'AML', 'AMR'].includes(pos)) return 'ATT';
  return 'MID';
}
