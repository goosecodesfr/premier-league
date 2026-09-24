// Match engine input/output contracts. The engine is pure: no I/O, no clock, no randomness beyond the seed.
import type { Attributes, Hidden } from '../attributes.ts';
import type { Familiarity } from '../positions.ts';
import type { OppInstruction, Tactic } from '../tactics.ts';

export interface MatchPlayerInput {
  id: number;
  name: string;
  short: string;
  attrs: Attributes;
  hidden: Hidden;
  fam: Familiarity;
  foot: 'L' | 'R' | 'B';
  age: number;
  condition: number; // 0..100
  sharpness: number; // 0..100
  form: number; // 0.85..1.15
  morale: number; // 0.90..1.10
  fatigueDebt: number; // 0..100
}

export interface TeamInput {
  clubId: number;
  name: string;
  short: string;
  code: string;
  players: MatchPlayerInput[];
  lineup: number[]; // 11 player ids, index = tactic slot index
  bench: number[];
  tactic: Tactic;
  planB?: Tactic | null;
  familiarity: number; // tactic familiarity 0..1
  captainId?: number | null;
  opp?: OppInstruction[];
  /** Bot tactical acumen 8..18, or assistant-manager rating for humans. Drives automatic in-game decisions. */
  acumen: number;
  isBot: boolean;
  /** Let the assistant make sensible substitutions (injuries always handled). */
  autoSubs: boolean;
}

export type Weather = 'clear' | 'cloudy' | 'rain' | 'heavy_rain' | 'wind' | 'snow' | 'hot';

export interface MatchContext {
  seed: string;
  competition: string;
  stage?: string;
  importance: number; // 1 = normal, 1.3 = big game, 1.6 = final
  neutral: boolean;
  homeAdvantage: number; // composite points (0..6)
  derby: boolean;
  weather: Weather;
  knockout: boolean; // needs a winner (extra time + penalties when level)
  firstLeg?: { home: number; away: number } | null; // first-leg goals for THIS match's home and away sides
  maxSubs: number;
}

export type EventType =
  | 'ko' | 'ht' | 'ft' | 'et' | 'et_ht' | 'aet' | 'pens_start' | 'pen_kick' | 'pens_end'
  | 'chain' | 'through' | 'dribble' | 'cross' | 'shot' | 'goal' | 'corner' | 'freekick' | 'penalty'
  | 'foul' | 'yellow' | 'red' | 'offside' | 'sub' | 'injury' | 'trigger' | 'tactic' | 'momentum' | 'save' | 'counter' | 'press_win'
  | 'snap';

export interface MatchEvent {
  i: number; // sequence
  m: number; // display minute (e.g. 67 means 67')
  ex?: number; // stoppage-time minutes (45+ex)
  s: number; // second within the minute
  t: EventType;
  side: 0 | 1 | -1; // 0 home, 1 away, -1 neutral
  a?: number; // actor player id
  b?: number; // secondary player id (assister, sub coming on, fouled player)
  z?: number; // zone index 0..17 from the acting side's perspective
  xg?: number;
  o?: string; // outcome (goal/saved/off/blocked/post, won/lost, etc.); for goals, the chance origin
  or?: ChanceOrigin; // chance origin for shots
  big?: boolean; // big chance / key event
  sc?: [number, number]; // score after the event
  txt: string; // rendered commentary
  k?: string; // commentary key
  st?: 'et' | 'pens'; // phase marker
  /** 'snap' events: [homePossession, then per side: shots, onTarget, xg, corners, fouls, yellows, reds, passesCompleted, passes] */
  d?: number[];
}

export interface TeamStats {
  possession: number; // 0..100
  shots: number;
  shotsOnTarget: number;
  shotsBlocked: number;
  xg: number;
  bigChances: number;
  bigChancesMissed: number;
  passes: number;
  passesCompleted: number;
  passesByThird: [number, number][]; // [attempted, completed] for own, middle, final third
  crosses: number;
  crossesCompleted: number;
  dribbles: number;
  dribblesCompleted: number;
  tackles: number;
  tacklesWon: number;
  interceptions: number;
  duelsWon: number;
  duels: number;
  aerialsWon: number;
  aerials: number;
  corners: number;
  fouls: number;
  offsides: number;
  yellows: number;
  reds: number;
  saves: number;
  clearances: number;
  attacksByChannel: [number, number, number]; // left, centre, right (own perspective)
  chanceOrigins: Record<ChanceOrigin, number>;
  zonePasses: [number, number][]; // per zone (18): attempted, completed
  zoneTouches: number[]; // per zone (18)
  throughBalls: number;
  throughBallsCompleted: number;
  counters: number;
  pressWins: number;
  longBalls: number;
}

export type ChanceOrigin = 'open' | 'cross' | 'through' | 'dribble' | 'set_piece' | 'long_shot' | 'counter' | 'penalty';

export interface PlayerMatchStat {
  playerId: number;
  side: 0 | 1;
  name: string;
  short: string;
  pos: string; // position code played (at start or when coming on)
  role: string;
  started: boolean;
  minutes: number;
  onAt: number;
  offAt: number | null;
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  xa: number;
  keyPasses: number;
  passes: number;
  passesCompleted: number;
  dribbles: number;
  dribblesCompleted: number;
  crosses: number;
  crossesCompleted: number;
  tackles: number;
  tacklesWon: number;
  interceptions: number;
  clearances: number;
  aerialsWon: number;
  fouls: number;
  fouled: number;
  offsides: number;
  saves: number;
  conceded: number;
  errors: number;
  bigChancesMissed: number;
  yellow: number;
  red: boolean;
  conditionEnd: number;
  injured: boolean;
  touches: number;
  zoneTouches: number[];
  penaltiesScored: number;
  penaltiesMissed: number;
  ownGoals: number;
}

export type InjurySeverity = 'knock' | 'minor' | 'moderate' | 'serious';

export interface MatchInjury {
  playerId: number;
  side: 0 | 1;
  minute: number;
  severity: InjurySeverity;
  days: number;
  type: string;
}

export interface Finding {
  side: 0 | 1;
  headline: string;
  detail: string;
  metric?: string;
  weight: number;
  kind: 'zone' | 'pairing' | 'style' | 'stat' | 'trigger' | 'fatigue' | 'player';
}

export interface Modifier {
  side: 0 | 1; // who benefits
  key: string;
  cause: string;
  value: number;
}

export interface KeyMoment {
  minute: number;
  side: 0 | 1;
  txt: string;
  swing: number; // win-probability swing for `side`
  type: string;
}

export interface TriggerFired {
  side: 0 | 1;
  minute: number;
  desc: string;
}

export interface MatchResult {
  score: [number, number];
  htScore: [number, number];
  extraTime: boolean;
  penalties: { home: number; away: number; kicks: { side: 0 | 1; playerId: number; scored: boolean }[] } | null;
  winner: 0 | 1 | null;
  events: MatchEvent[];
  stats: [TeamStats, TeamStats];
  players: PlayerMatchStat[];
  injuries: MatchInjury[];
  modifiers: Modifier[];
  findings: Finding[];
  triggersFired: TriggerFired[];
  momentum: number[]; // home momentum per checkpoint (-1..1)
  keyMoments: KeyMoment[];
  motm: { playerId: number; side: 0 | 1; rating: number; reason: string } | null;
  verdict: string;
  summaryWord: [string, string]; // three-word-ish summary per side
  minutesPlayed: number;
}
