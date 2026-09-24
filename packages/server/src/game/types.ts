// Server-side domain types (rows as stored in Postgres).
import type { Familiarity, Tactic } from '@ffm/engine';
import type { WeekdayKey } from '../lib/time.ts';

export type Phase = 'preseason' | 'season' | 'postseason';
export type Difficulty = 'casual' | 'standard' | 'competitive';

export interface WorldSettings {
  kickoffTime: string; // HH:MM local
  leagueDays: WeekdayKey[];
  europeDay: WeekdayKey;
  cupDay: WeekdayKey;
  digestDay: WeekdayKey;
  digestTime: string;
  dailyTime: string;
  deadlineMinutes: number;
  reminderHours: number;
  preseasonDays: number;
  midWindowDays: number;
  difficulty: Difficulty;
  europe: boolean;
  cups: boolean;
  reshuffle: boolean;
  clubPick: 'free' | 'no_elite';
  maxSubs: number;
  eventsFrequency: 'low' | 'normal' | 'high';
}

export const DEFAULT_SETTINGS: WorldSettings = {
  kickoffTime: '20:00',
  leagueDays: ['tue', 'sat'],
  europeDay: 'thu',
  cupDay: 'sun',
  digestDay: 'mon',
  digestTime: '09:00',
  dailyTime: '06:00',
  deadlineMinutes: 15,
  reminderHours: 3,
  preseasonDays: 7,
  midWindowDays: 7,
  difficulty: 'standard',
  europe: true,
  cups: true,
  reshuffle: true,
  clubPick: 'free',
  maxSubs: 5,
  eventsFrequency: 'normal',
};

export interface TransferWindow {
  open: boolean;
  kind?: 'preseason' | 'midseason';
  closesAt?: string | null;
  opensAt?: string | null;
}

export interface WorldState {
  lastTickAt?: string;
  seasonStartAt?: string;
  seasonWeeks?: number;
  lastSlotAt?: string;
  vapidPublic?: string;
  started?: boolean;
  weekNo?: number;
}

export interface WorldRow {
  id: number;
  name: string;
  timezone: string;
  season_no: number;
  season_label: string;
  phase: Phase;
  settings: WorldSettings;
  secret: string;
  paused: boolean;
  transfer_window: TransferWindow;
  state: WorldState;
  created_at: Date;
}

export type Archetype = 'purist' | 'pragmatist' | 'gegenpresser' | 'counter' | 'cynic' | 'youth' | 'chequebook' | 'tinkerman';

export interface BotProfile {
  name: string;
  nat: string;
  age: number;
  archetype: Archetype;
  acumen: number; // 8..18
  hiredSeason: number;
  pressure?: number; // 0..100 board pressure
  grudges?: Record<string, number>; // clubId -> heaviest defeat margin
  traits?: { spend: number; youth: number; loyalty: number };
}

export interface StaffMember { name: string; rating: number; wage: number; nat: string }
export type StaffRole = 'assistant' | 'coach' | 'fitness' | 'physio' | 'scout';
export type Staff = Partial<Record<StaffRole, StaffMember>>;

export interface Facilities {
  training: number;
  youth: number;
  medical: number;
  building?: { kind: 'training' | 'youth' | 'medical' | 'stadium'; toLevel: number; completesAt: string; seats?: number } | null;
}

export interface SponsorDeal {
  name: string;
  guaranteed: number;
  bonus?: { kind: 'ucl' | 'trophy' | 'top4' | 'title'; amount: number } | null;
  seasonsLeft: number;
}

export interface ClubFinances {
  tickets: { general: number; premium: number };
  sponsor?: SponsorDeal | null;
  sponsorOffers?: SponsorDeal[] | null;
  embargo?: boolean;
  seasonIncome?: Record<string, number>;
  seasonExpense?: Record<string, number>;
  lastSeason?: { income: Record<string, number>; expense: Record<string, number> } | null;
  wageBudget?: number;
  overdraftWeeks?: number;
}

export interface TrainingSettings {
  focus: 'balanced' | 'attacking' | 'defensive' | 'fitness' | 'tactical' | 'set_pieces' | 'recovery';
  intensity: 'low' | 'normal' | 'high';
  individual: { playerId: number; group: 'technical' | 'mental' | 'physical' | 'goalkeeping' }[];
}

export interface VisionGoal {
  kind: 'win_league' | 'top4' | 'top_half' | 'survive' | 'euro_final' | 'win_cup' | 'youth_minutes' | 'transfer_profit' | 'wage_cap' | 'beat_rival';
  target?: number;
  clubId?: number;
  label: string;
  progress?: number;
  done?: boolean | null;
}

export interface ClubMetaInfo {
  rivals?: string[];
  lastPos?: number | null;
  europe?: 'UCL' | 'UEL' | null;
  form?: number; // pool club form -1..1
  expectation?: number; // expected league position
  missedDeadlines?: number;
  botTakeover?: boolean; // human inactive -> bot temporarily
  promotedSeason?: number;
}

export interface ClubRow {
  id: number;
  key: string;
  name: string;
  short: string;
  league: 'PL' | 'EUR' | 'CHAMP';
  country: string;
  colors: [string, string];
  stadium: string;
  capacity: number;
  reputation: number;
  manager_type: 'human' | 'bot';
  user_id: number | null;
  bot: BotProfile;
  balance: number;
  finances: ClubFinances;
  facilities: Facilities;
  staff: Staff;
  training: TrainingSettings;
  vision: VisionGoal[];
  fan_mood: number;
  meta: ClubMetaInfo;
}

export interface InjuryInfo {
  type: string;
  severity: 'knock' | 'minor' | 'moderate' | 'serious';
  daysLeft: number;
  daysTotal: number;
  since: string;
}

export interface PlayerFlags {
  listed?: boolean;
  askingPrice?: number;
  unhappy?: boolean;
  wantsOut?: boolean;
  promise?: 'key' | 'rotation' | 'backup' | null;
  retiring?: boolean;
  youth?: boolean;
  rested?: boolean;
  renewalAsked?: boolean;
  noRenewal?: boolean;
  newSigning?: number; // season signed
}

export interface PlayerRow {
  id: number;
  club_id: number | null;
  status: 'active' | 'free' | 'reserve' | 'retired';
  name: string;
  short: string;
  first_name: string | null;
  last_name: string | null;
  nat: string;
  age: number;
  foot: 'L' | 'R' | 'B';
  height: number | null;
  positions: Familiarity;
  attrs: number[];
  hidden: number[];
  ca: number;
  pa: number;
  condition: number;
  sharpness: number;
  form: number;
  morale: number;
  fatigue_debt: number;
  injury: InjuryInfo | null;
  suspended: number;
  yellows: number;
  wage: number;
  contract_until: number;
  squad_number: number | null;
  value: number;
  flags: PlayerFlags;
  form_history: number[];
  history: { season: number; club: string; apps?: number; goals?: number; fee?: number; kind?: string }[];
  joined_season: number | null;
}

export interface TacticRow {
  id: number;
  club_id: number;
  name: string;
  data: Tactic;
  lineup: number[];
  bench: number[];
  familiarity: number;
  is_default: boolean;
  record: { p: number; w: number; d: number; l: number };
}

export type CompType = 'league' | 'fa_cup' | 'league_cup' | 'ucl' | 'uel' | 'shield' | 'super_cup';

export interface CompetitionRow {
  id: number;
  season_no: number;
  type: CompType;
  name: string;
  status: 'active' | 'done';
  data: CompetitionData;
  winner_id: number | null;
  runner_up_id: number | null;
}

export interface CompetitionData {
  entrants?: number[];
  rounds?: { stage: string; dates: string[]; legs: number; neutral?: boolean; drawn?: boolean }[];
  groups?: Record<string, number[]>;
  byes?: number[];
  currentRound?: number;
}

export interface FixtureRow {
  id: number;
  season_no: number;
  competition_id: number;
  round: number;
  stage: string;
  leg: number;
  tie_key: string | null;
  grp: string | null;
  home_id: number;
  away_id: number;
  kickoff_at: Date;
  deadline_at: Date;
  status: 'scheduled' | 'locked' | 'played';
  home_goals: number | null;
  away_goals: number | null;
  extra_time: boolean;
  pens: { home: number; away: number } | null;
  winner_id: number | null;
  seed: string;
  neutral: boolean;
  summary: Record<string, unknown> | null;
  attendance: number | null;
  weather: string | null;
  played_at: Date | null;
}

export const COMP_NAMES: Record<CompType, string> = {
  league: 'Premier League', fa_cup: 'FA Cup', league_cup: 'League Cup', ucl: 'Champions League',
  uel: 'Europa League', shield: 'Community Shield', super_cup: 'Super Cup',
};

export const COMP_SHORT: Record<CompType, string> = {
  league: 'PL', fa_cup: 'FAC', league_cup: 'LC', ucl: 'UCL', uel: 'UEL', shield: 'CS', super_cup: 'USC',
};
