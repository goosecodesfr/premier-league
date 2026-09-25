// The tactic object: shape, roles, mentality, instructions, set pieces and in-match triggers.
import { FORMATIONS, type FormationKey, type SlotTemplate, detectFormation } from './formations.ts';
import type { Pos } from './positions.ts';
import type { Duty, RoleKey } from './roles.ts';

export interface TacticSlot {
  pos: Pos;
  x: number;
  y: number;
  role: RoleKey;
  duty: Duty;
  /** Individual instructions for whoever plays in this position. */
  pi?: PlayerInstructions;
}

// ---- Individual player instructions ----
export interface PlayerInstructions {
  shooting?: 'less' | 'more';
  dribbling?: 'less' | 'more';
  passing?: 'safe' | 'risky';
  crossing?: 'less' | 'more';
  movement?: 'hold' | 'forward';
  width?: 'inside' | 'wide';
  press?: 'less' | 'more';
  tackling?: 'careful' | 'hard';
}

export type PlayerInstructionKey = keyof PlayerInstructions;

export const PLAYER_INSTRUCTION_OPTIONS: { [K in PlayerInstructionKey]-?: { label: string; options: { value: NonNullable<PlayerInstructions[K]>; label: string; effect: string }[]; gk?: boolean } } = {
  shooting: { label: 'Shooting', options: [
    { value: 'less', label: 'Shoot less', effect: 'Only shoots from good positions; looks for a pass instead.' },
    { value: 'more', label: 'Shoot more', effect: 'Shoots whenever he can, including from distance.' },
  ] },
  dribbling: { label: 'Dribbling', options: [
    { value: 'less', label: 'Dribble less', effect: 'Moves the ball on quickly; fewer turnovers, less penetration.' },
    { value: 'more', label: 'Dribble more', effect: 'Takes his man on; more chances created and more balls lost.' },
  ] },
  passing: { label: 'Passing', options: [
    { value: 'safe', label: 'Keep it simple', effect: 'Safe, short passes; keeps possession.' },
    { value: 'risky', label: 'Take more risks', effect: 'Looks for killer balls in behind; more chances, more turnovers.' },
  ] },
  crossing: { label: 'Crossing', options: [
    { value: 'less', label: 'Cross less', effect: 'Works the ball inside instead of crossing.' },
    { value: 'more', label: 'Cross more', effect: 'Gets the ball into the box at every opportunity.' },
  ] },
  movement: { label: 'Movement', options: [
    { value: 'hold', label: 'Hold position', effect: 'Stays in his zone; better cover, less support in attack.' },
    { value: 'forward', label: 'Push forward', effect: 'Pushes up to join attacks; leaves space behind him.' },
  ] },
  width: { label: 'Width', options: [
    { value: 'inside', label: 'Cut inside', effect: 'Drifts into the middle, towards goal.' },
    { value: 'wide', label: 'Stay wide', effect: 'Hugs the touchline to stretch the defence.' },
  ] },
  press: { label: 'Pressing', options: [
    { value: 'less', label: 'Press less', effect: 'Holds shape and saves energy.' },
    { value: 'more', label: 'Press more', effect: 'Closes down aggressively; wins it higher up, tires faster.' },
  ] },
  tackling: { label: 'Tackling', options: [
    { value: 'careful', label: 'Stay on feet', effect: 'Fewer fouls and cards; loses a few more duels.' },
    { value: 'hard', label: 'Get stuck in', effect: 'Wins more duels; more fouls and cards.' },
  ] },
};

export const PLAYER_INSTRUCTION_KEYS = Object.keys(PLAYER_INSTRUCTION_OPTIONS) as PlayerInstructionKey[];

export function cleanPlayerInstructions(pi: unknown): PlayerInstructions | undefined {
  if (!pi || typeof pi !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const k of PLAYER_INSTRUCTION_KEYS) {
    const v = (pi as Record<string, unknown>)[k];
    if (typeof v === 'string' && PLAYER_INSTRUCTION_OPTIONS[k].options.some((o) => o.value === v)) out[k] = v;
  }
  return Object.keys(out).length ? (out as PlayerInstructions) : undefined;
}

export interface Instructions {
  // In possession
  tempo: 'slow' | 'normal' | 'high';
  passing: 'short' | 'mixed' | 'direct';
  width: 'narrow' | 'normal' | 'wide';
  playOutOfDefence: boolean;
  focus: 'none' | 'left' | 'centre' | 'right';
  overlap: 'none' | 'overlap' | 'underlap';
  workIntoBox: boolean;
  shootOnSight: boolean;
  // Out of possession
  line: 'deep' | 'normal' | 'high' | 'very_high';
  press: 'low' | 'normal' | 'high' | 'all_out';
  pressTrigger: 'on_loss' | 'their_half' | 'always';
  offsideTrap: boolean;
  tackling: 'careful' | 'normal' | 'hard';
  marking: 'zonal' | 'man';
  // Transition
  counter: boolean;
  counterPress: boolean;
  regainDistribution: 'quick' | 'slow' | 'possession';
  gkDistribution: 'short' | 'mixed' | 'long';
  timeWasting: boolean;
}

export const DEFAULT_INSTRUCTIONS: Instructions = {
  tempo: 'normal', passing: 'mixed', width: 'normal', playOutOfDefence: false, focus: 'none',
  overlap: 'none', workIntoBox: false, shootOnSight: false,
  line: 'normal', press: 'normal', pressTrigger: 'their_half', offsideTrap: false, tackling: 'normal', marking: 'zonal',
  counter: false, counterPress: false, regainDistribution: 'quick', gkDistribution: 'mixed', timeWasting: false,
};

export const INSTRUCTION_OPTIONS: { [K in keyof Instructions]: readonly Instructions[K][] } = {
  tempo: ['slow', 'normal', 'high'],
  passing: ['short', 'mixed', 'direct'],
  width: ['narrow', 'normal', 'wide'],
  playOutOfDefence: [false, true],
  focus: ['none', 'left', 'centre', 'right'],
  overlap: ['none', 'overlap', 'underlap'],
  workIntoBox: [false, true],
  shootOnSight: [false, true],
  line: ['deep', 'normal', 'high', 'very_high'],
  press: ['low', 'normal', 'high', 'all_out'],
  pressTrigger: ['on_loss', 'their_half', 'always'],
  offsideTrap: [false, true],
  tackling: ['careful', 'normal', 'hard'],
  marking: ['zonal', 'man'],
  counter: [false, true],
  counterPress: [false, true],
  regainDistribution: ['quick', 'slow', 'possession'],
  gkDistribution: ['short', 'mixed', 'long'],
  timeWasting: [false, true],
};

export interface SetPieces {
  cornerDelivery: 'near' | 'far' | 'short' | 'edge';
  cornerTaker?: number | null;
  freeKickTaker?: number | null;
  penaltyTaker?: number | null;
  longThrowTaker?: number | null;
  inBox: number; // 3..7
  stayBack: number; // 1..4
  longThrows: boolean;
}

export const DEFAULT_SET_PIECES: SetPieces = {
  cornerDelivery: 'far', inBox: 5, stayBack: 2, longThrows: false,
  cornerTaker: null, freeKickTaker: null, penaltyTaker: null, longThrowTaker: null,
};

export type TriggerCondition =
  | { kind: 'score'; state: 'losing' | 'drawing' | 'winning'; by: number; minute: number }
  | { kind: 'condition'; below: number; minute: number }
  | { kind: 'yellow'; minute: number }
  | { kind: 'red'; minute: number }
  | { kind: 'opp_change'; minute: number };

export type SubRule = 'most_tired' | 'lowest_rated' | 'on_yellow' | 'trigger_player';
export type BenchRule = 'best_available' | 'most_attacking' | 'most_defensive';

export type TriggerAction =
  | { type: 'sub'; out: number | SubRule; outLine?: 'DEF' | 'MID' | 'ATT' | 'ANY'; in: number | BenchRule }
  | { type: 'mentality'; delta: number }
  | { type: 'instruction'; key: keyof Instructions; value: string | boolean }
  | { type: 'plan_b' };

export interface Trigger {
  id: string;
  when: TriggerCondition;
  actions: TriggerAction[];
}

export interface Tactic {
  name: string;
  formation: FormationKey;
  slots: TacticSlot[]; // 11 entries, slot 0 is the goalkeeper
  mentality: number; // -2..+2
  instructions: Instructions;
  setPieces: SetPieces;
  triggers: Trigger[];
}

export const MENTALITY_LABELS: Record<string, string> = {
  '-2': 'Very defensive', '-1': 'Defensive', '0': 'Balanced', '1': 'Attacking', '2': 'Very attacking',
};

export function slotsFromTemplate(tpl: SlotTemplate[]): TacticSlot[] {
  return tpl.map((s) => ({ pos: s.pos, x: s.x, y: s.y, role: s.role, duty: s.duty }));
}

export function makeTactic(name: string, formation: Exclude<FormationKey, 'Custom'>, patch: Partial<Tactic> = {}): Tactic {
  return {
    name,
    formation,
    slots: slotsFromTemplate(FORMATIONS[formation]),
    mentality: 0,
    instructions: { ...DEFAULT_INSTRUCTIONS },
    setPieces: { ...DEFAULT_SET_PIECES },
    triggers: [],
    ...patch,
  };
}

// ---- Presets: a coherent bundle in one tap ----
export const PRESETS: Record<string, { label: string; desc: string; mentality: number; instructions: Partial<Instructions> }> = {
  control: {
    label: 'Control', desc: 'Keep the ball, press high, suffocate them.', mentality: 1,
    instructions: { tempo: 'slow', passing: 'short', width: 'normal', playOutOfDefence: true, workIntoBox: true, shootOnSight: false, line: 'high', press: 'high', pressTrigger: 'their_half', counterPress: true, counter: false, regainDistribution: 'possession', gkDistribution: 'short', tackling: 'normal', timeWasting: false, offsideTrap: true },
  },
  counter: {
    label: 'Counter', desc: 'Sit off, win it back, go direct at pace.', mentality: -1,
    instructions: { tempo: 'high', passing: 'direct', width: 'wide', playOutOfDefence: false, workIntoBox: false, shootOnSight: true, line: 'deep', press: 'low', pressTrigger: 'on_loss', counterPress: false, counter: true, regainDistribution: 'quick', gkDistribution: 'long', offsideTrap: false, timeWasting: false },
  },
  bus: {
    label: 'Park the bus', desc: 'Protect the box and hit them on the break.', mentality: -2,
    instructions: { tempo: 'slow', passing: 'direct', width: 'narrow', playOutOfDefence: false, workIntoBox: false, shootOnSight: true, line: 'deep', press: 'low', pressTrigger: 'on_loss', counterPress: false, counter: true, tackling: 'hard', regainDistribution: 'quick', gkDistribution: 'long', offsideTrap: false, timeWasting: true },
  },
};

// ---- Style vector: tempo, directness, width, aggression (each -1..1) ----
export interface StyleVector { tempo: number; directness: number; width: number; aggression: number }

export function styleVector(t: Tactic): StyleVector {
  const i = t.instructions;
  const tempo = i.tempo === 'slow' ? -1 : i.tempo === 'high' ? 1 : 0;
  const directness = i.passing === 'short' ? -1 : i.passing === 'direct' ? 1 : 0;
  const width = i.width === 'narrow' ? -1 : i.width === 'wide' ? 1 : 0;
  const pressV = { low: -1, normal: 0, high: 0.6, all_out: 1 }[i.press];
  const tackV = i.tackling === 'hard' ? 0.5 : i.tackling === 'careful' ? -0.5 : 0;
  return { tempo: tempo * 0.8 + t.mentality * 0.1, directness, width, aggression: Math.max(-1, Math.min(1, pressV * 0.7 + tackV)) };
}

export function countNonDefault(i: Instructions, keys: (keyof Instructions)[]): number {
  return keys.filter((k) => i[k] !== DEFAULT_INSTRUCTIONS[k]).length;
}

export const INSTRUCTION_GROUPS: { key: string; label: string; items: (keyof Instructions)[] }[] = [
  { key: 'possession', label: 'In possession', items: ['tempo', 'passing', 'width', 'playOutOfDefence', 'focus', 'overlap', 'workIntoBox', 'shootOnSight'] },
  { key: 'defence', label: 'Out of possession', items: ['line', 'press', 'pressTrigger', 'offsideTrap', 'tackling', 'marking'] },
  { key: 'transition', label: 'In transition', items: ['counter', 'counterPress', 'regainDistribution', 'gkDistribution', 'timeWasting'] },
];

export const INSTRUCTION_LABELS: Record<keyof Instructions, string> = {
  tempo: 'Tempo', passing: 'Passing directness', width: 'Width', playOutOfDefence: 'Play out of defence',
  focus: 'Focus play', overlap: 'Full-back runs', workIntoBox: 'Work ball into box', shootOnSight: 'Shoot on sight',
  line: 'Defensive line', press: 'Pressing intensity', pressTrigger: 'Press trigger', offsideTrap: 'Offside trap',
  tackling: 'Tackling', marking: 'Marking', counter: 'Counter-attack', counterPress: 'Counter-press',
  regainDistribution: 'On regaining the ball', gkDistribution: 'Goalkeeper distribution', timeWasting: 'Time wasting',
};

export const OPTION_LABELS: Record<string, string> = {
  slow: 'Slow', normal: 'Normal', high: 'High', short: 'Short', mixed: 'Mixed', direct: 'Direct',
  narrow: 'Narrow', wide: 'Wide', none: 'None', left: 'Left', centre: 'Centre', right: 'Right',
  overlap: 'Overlap', underlap: 'Underlap', deep: 'Deep', very_high: 'Very high', low: 'Low', all_out: 'All-out',
  on_loss: 'On loss', their_half: 'In their half', always: 'Always', careful: 'Careful', hard: 'Hard',
  zonal: 'Zonal', man: 'Man', quick: 'Quick', possession: 'Keep it', true: 'On', false: 'Off',
  near: 'Near post', far: 'Far post', edge: 'Edge of box',
};

export function normaliseTactic(t: Partial<Tactic> & { slots?: TacticSlot[] }): Tactic {
  const base = makeTactic(t.name ?? 'Tactic', '4-3-3');
  const slots = (t.slots && t.slots.length === 11 ? t.slots : base.slots).map((s) => {
    const pi = cleanPlayerInstructions(s.pi);
    const { pi: _drop, ...rest } = s;
    void _drop;
    return pi ? { ...rest, pi } : rest;
  });
  return {
    name: (t.name ?? 'Tactic').slice(0, 30),
    formation: t.formation ?? detectFormation(slots),
    slots,
    mentality: Math.max(-2, Math.min(2, Math.round(t.mentality ?? 0))),
    instructions: { ...DEFAULT_INSTRUCTIONS, ...(t.instructions ?? {}) },
    setPieces: { ...DEFAULT_SET_PIECES, ...(t.setPieces ?? {}) },
    triggers: (t.triggers ?? []).slice(0, 3),
  };
}

// ---- Opposition instructions ----
export type OppInstructionType = 'tight_mark' | 'weaker_foot' | 'hard_tackle';
export interface OppInstruction { playerId: number; type: OppInstructionType }
export const OPP_INSTRUCTION_LABELS: Record<OppInstructionType, { label: string; cost: string }> = {
  tight_mark: { label: 'Tight marking', cost: 'Pulls your shape towards him, leaving space elsewhere.' },
  weaker_foot: { label: 'Show onto weaker foot', cost: 'Only bites on one-footed players.' },
  hard_tackle: { label: 'Tackle harder', cost: 'More fouls and cards for your side.' },
};
