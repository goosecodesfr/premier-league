// Player attribute model. Stored internally on a 1..200 scale (display = value / 10, shown in halves).

export const TECHNICAL = [
  'finishing', 'longShots', 'passing', 'vision', 'crossing', 'dribbling',
  'firstTouch', 'heading', 'tackling', 'marking', 'setPieces',
] as const;

export const GOALKEEPING = [
  'shotStopping', 'reflexes', 'handling', 'aerialReach', 'oneOnOnes',
  'commandOfArea', 'distribution', 'rushingOut',
] as const;

export const MENTAL = [
  'composure', 'decisions', 'anticipation', 'positioning', 'concentration', 'workRate',
  'teamwork', 'aggression', 'bravery', 'leadership', 'flair', 'offTheBall',
] as const;

export const PHYSICAL = [
  'pace', 'acceleration', 'stamina', 'strength', 'agility', 'balance', 'jumping', 'naturalFitness',
] as const;

export type TechnicalKey = (typeof TECHNICAL)[number];
export type GoalkeepingKey = (typeof GOALKEEPING)[number];
export type MentalKey = (typeof MENTAL)[number];
export type PhysicalKey = (typeof PHYSICAL)[number];
export type AttrKey = TechnicalKey | GoalkeepingKey | MentalKey | PhysicalKey;

/** Fixed order used for compact array storage. Never reorder — append only. */
export const ATTR_KEYS: readonly AttrKey[] = [...TECHNICAL, ...GOALKEEPING, ...MENTAL, ...PHYSICAL];
export const ATTR_INDEX: Record<AttrKey, number> = Object.fromEntries(
  ATTR_KEYS.map((k, i) => [k, i]),
) as Record<AttrKey, number>;

export type Attributes = Record<AttrKey, number>;

export const ATTR_LABELS: Record<AttrKey, string> = {
  finishing: 'Finishing', longShots: 'Long shots', passing: 'Passing', vision: 'Vision',
  crossing: 'Crossing', dribbling: 'Dribbling', firstTouch: 'First touch', heading: 'Heading',
  tackling: 'Tackling', marking: 'Marking', setPieces: 'Set pieces',
  shotStopping: 'Shot stopping', reflexes: 'Reflexes', handling: 'Handling', aerialReach: 'Aerial reach',
  oneOnOnes: 'One-on-ones', commandOfArea: 'Command of area', distribution: 'Distribution', rushingOut: 'Rushing out',
  composure: 'Composure', decisions: 'Decisions', anticipation: 'Anticipation', positioning: 'Positioning',
  concentration: 'Concentration', workRate: 'Work rate', teamwork: 'Teamwork', aggression: 'Aggression',
  bravery: 'Bravery', leadership: 'Leadership', flair: 'Flair', offTheBall: 'Off the ball',
  pace: 'Pace', acceleration: 'Acceleration', stamina: 'Stamina', strength: 'Strength', agility: 'Agility',
  balance: 'Balance', jumping: 'Jumping', naturalFitness: 'Natural fitness',
};

export const ATTR_GROUPS = {
  technical: TECHNICAL as readonly AttrKey[],
  goalkeeping: GOALKEEPING as readonly AttrKey[],
  mental: MENTAL as readonly AttrKey[],
  physical: PHYSICAL as readonly AttrKey[],
};

export type AttrGroup = keyof typeof ATTR_GROUPS;

export function groupOf(k: AttrKey): AttrGroup {
  if ((TECHNICAL as readonly string[]).includes(k)) return 'technical';
  if ((GOALKEEPING as readonly string[]).includes(k)) return 'goalkeeping';
  if ((MENTAL as readonly string[]).includes(k)) return 'mental';
  return 'physical';
}

export function attrsFromArray(arr: readonly number[]): Attributes {
  const out = {} as Attributes;
  for (let i = 0; i < ATTR_KEYS.length; i++) out[ATTR_KEYS[i]] = arr[i] ?? 50;
  return out;
}

export function attrsToArray(a: Attributes): number[] {
  return ATTR_KEYS.map((k) => Math.round(a[k]));
}

export function clampAttr(v: number): number {
  return Math.max(1, Math.min(200, Math.round(v)));
}

/** 0..200 internal -> display value rounded to halves (e.g. 155 -> 15.5). */
export function displayAttr(v: number): number {
  return Math.max(1, Math.round(v / 5) / 2);
}

// ---- Radar axes (six grouped axes shown on the player card) ----
export const RADAR_AXES: { key: string; label: string; attrs: AttrKey[] }[] = [
  { key: 'technical', label: 'Technical', attrs: ['passing', 'firstTouch', 'dribbling', 'vision', 'crossing'] },
  { key: 'mental', label: 'Mental', attrs: ['decisions', 'composure', 'anticipation', 'concentration', 'teamwork', 'workRate'] },
  { key: 'physical', label: 'Physical', attrs: ['pace', 'acceleration', 'stamina', 'strength', 'agility', 'jumping'] },
  { key: 'attacking', label: 'Attacking', attrs: ['finishing', 'offTheBall', 'longShots', 'dribbling', 'flair'] },
  { key: 'defending', label: 'Defending', attrs: ['tackling', 'marking', 'positioning', 'heading', 'bravery'] },
  { key: 'setPieces', label: 'Set pieces', attrs: ['setPieces', 'crossing', 'longShots', 'heading'] },
];

export const GK_RADAR_AXES: { key: string; label: string; attrs: AttrKey[] }[] = [
  { key: 'shotStopping', label: 'Shot stopping', attrs: ['shotStopping', 'reflexes', 'oneOnOnes'] },
  { key: 'aerial', label: 'Aerial', attrs: ['aerialReach', 'commandOfArea', 'handling', 'jumping'] },
  { key: 'distribution', label: 'Distribution', attrs: ['distribution', 'passing', 'vision', 'composure'] },
  { key: 'mental', label: 'Mental', attrs: ['decisions', 'concentration', 'anticipation', 'positioning'] },
  { key: 'physical', label: 'Physical', attrs: ['agility', 'acceleration', 'strength', 'jumping'] },
  { key: 'sweeping', label: 'Sweeping', attrs: ['rushingOut', 'pace', 'acceleration', 'oneOnOnes'] },
];

export function radarValues(a: Attributes, isGk: boolean): { key: string; label: string; value: number }[] {
  const axes = isGk ? GK_RADAR_AXES : RADAR_AXES;
  return axes.map((ax) => ({
    key: ax.key,
    label: ax.label,
    value: ax.attrs.reduce((s, k) => s + a[k], 0) / ax.attrs.length,
  }));
}

// ---- Hidden traits (1..20). Never exposed to clients as numbers. ----
export const HIDDEN_KEYS = [
  'consistency', 'importantMatches', 'injuryProneness', 'adaptability',
  'ambition', 'loyalty', 'professionalism', 'temperament',
] as const;
export type HiddenKey = (typeof HIDDEN_KEYS)[number];
export type Hidden = Record<HiddenKey, number>;

export function hiddenFromArray(arr: readonly number[]): Hidden {
  const out = {} as Hidden;
  HIDDEN_KEYS.forEach((k, i) => (out[k] = arr[i] ?? 10));
  return out;
}
export function hiddenToArray(h: Hidden): number[] {
  return HIDDEN_KEYS.map((k) => Math.round(h[k]));
}
