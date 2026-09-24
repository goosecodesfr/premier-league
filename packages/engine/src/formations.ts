// Formation templates. Coordinates: x 0..100 (left -> right touchline), y 0..100 (own goal -> their goal).
import type { Pos } from './positions.ts';
import type { Duty, RoleKey } from './roles.ts';

export const FORMATION_KEYS = ['4-4-2', '4-3-3', '3-5-2', '4-2-3-1', '5-3-2', '4-1-4-1', '3-4-3', '4-4-1-1'] as const;
export type FormationKey = (typeof FORMATION_KEYS)[number] | 'Custom';

export interface SlotTemplate {
  pos: Pos;
  x: number;
  y: number;
  role: RoleKey;
  duty: Duty;
}

const S = (pos: Pos, x: number, y: number, role: RoleKey, duty: Duty): SlotTemplate => ({ pos, x, y, role, duty });
const GK = S('GK', 50, 5, 'GK', 'D');
const BACK4 = [S('DL', 12, 26, 'FB', 'S'), S('DC', 37, 21, 'CD', 'D'), S('DC', 63, 21, 'CD', 'D'), S('DR', 88, 26, 'FB', 'S')];

export const FORMATIONS: Record<Exclude<FormationKey, 'Custom'>, SlotTemplate[]> = {
  '4-4-2': [
    GK, ...BACK4,
    S('ML', 12, 52, 'W', 'S'), S('MC', 38, 48, 'CM', 'D'), S('MC', 62, 48, 'BBM', 'S'), S('MR', 88, 52, 'W', 'S'),
    S('ST', 38, 81, 'TM', 'S'), S('ST', 62, 81, 'AF', 'A'),
  ],
  '4-3-3': [
    GK, ...BACK4,
    S('DM', 50, 38, 'A', 'D'), S('MC', 32, 52, 'CM', 'S'), S('MC', 68, 52, 'MEZ', 'A'),
    S('AML', 15, 72, 'IW', 'A'), S('ST', 50, 84, 'CF', 'A'), S('AMR', 85, 72, 'W', 'A'),
  ],
  '3-5-2': [
    GK, S('DC', 28, 22, 'CD', 'D'), S('DC', 50, 19, 'CD', 'D'), S('DC', 72, 22, 'CD', 'D'),
    S('WBL', 8, 44, 'WB', 'S'), S('DM', 50, 38, 'DLP', 'S'), S('MC', 35, 52, 'BBM', 'S'), S('MC', 65, 52, 'CM', 'A'), S('WBR', 92, 44, 'WB', 'S'),
    S('ST', 38, 81, 'CF', 'S'), S('ST', 62, 81, 'P', 'A'),
  ],
  '4-2-3-1': [
    GK, ...BACK4,
    S('DM', 38, 38, 'DLP', 'D'), S('DM', 62, 38, 'BWM', 'D'),
    S('AML', 15, 68, 'IW', 'A'), S('AMC', 50, 64, 'AM', 'S'), S('AMR', 85, 68, 'W', 'A'),
    S('ST', 50, 84, 'AF', 'A'),
  ],
  '5-3-2': [
    GK, S('WBL', 8, 34, 'WB', 'S'), S('DC', 30, 21, 'CD', 'D'), S('DC', 50, 19, 'NCB', 'D'), S('DC', 70, 21, 'CD', 'D'), S('WBR', 92, 34, 'WB', 'S'),
    S('MC', 30, 48, 'CM', 'S'), S('MC', 50, 44, 'BWM', 'D'), S('MC', 70, 48, 'CM', 'A'),
    S('ST', 38, 80, 'TM', 'S'), S('ST', 62, 80, 'AF', 'A'),
  ],
  '4-1-4-1': [
    GK, ...BACK4,
    S('DM', 50, 36, 'A', 'D'),
    S('ML', 12, 55, 'W', 'S'), S('MC', 37, 52, 'CM', 'S'), S('MC', 63, 52, 'BBM', 'S'), S('MR', 88, 55, 'W', 'S'),
    S('ST', 50, 83, 'CF', 'A'),
  ],
  '3-4-3': [
    GK, S('DC', 28, 22, 'CD', 'D'), S('DC', 50, 19, 'CD', 'D'), S('DC', 72, 22, 'BPD', 'D'),
    S('WBL', 8, 46, 'WB', 'A'), S('MC', 38, 46, 'CM', 'D'), S('MC', 62, 46, 'CM', 'S'), S('WBR', 92, 46, 'WB', 'A'),
    S('AML', 20, 74, 'IW', 'A'), S('ST', 50, 84, 'CF', 'A'), S('AMR', 80, 74, 'IW', 'A'),
  ],
  '4-4-1-1': [
    GK, ...BACK4,
    S('ML', 12, 50, 'W', 'S'), S('MC', 38, 46, 'CM', 'D'), S('MC', 62, 46, 'CM', 'S'), S('MR', 88, 50, 'W', 'S'),
    S('AMC', 50, 66, 'SS', 'A'), S('ST', 50, 84, 'TM', 'A'),
  ],
};

export function formationSlots(key: FormationKey): SlotTemplate[] {
  if (key === 'Custom') return FORMATIONS['4-4-2'].map((s) => ({ ...s }));
  return FORMATIONS[key].map((s) => ({ ...s }));
}

/** Detect the named formation closest to a set of slots (by position multiset). */
export function detectFormation(slots: { pos: Pos }[]): FormationKey {
  const sig = (arr: { pos: Pos }[]) => arr.map((s) => s.pos).sort().join(',');
  const target = sig(slots);
  for (const k of FORMATION_KEYS) if (sig(FORMATIONS[k]) === target) return k;
  return 'Custom';
}
