// World creation from the seed, and world-level accessors.
import webpush from 'web-push';
import { Rng, WAGE_SCALE, randomName, selectTeam, attrsFromArray, type Tactic } from '@ffm/engine';
import { db, insertMany, tx, type Db } from '../db.ts';
import { randomToken } from '../lib/auth.ts';
import { atTime, calDate, addDays, nextWeekday, WEEKDAY_KEYS } from '../lib/time.ts';
import { ARCHETYPES, acumenFor, archetypeTactics, newManager } from './archetypes.ts';
import { loadSeed, namePools, type SeedPlayer } from './seed.ts';
import { valueOf, toSelectable } from './players.ts';
import {
  DEFAULT_SETTINGS, type Archetype, type ClubFinances, type Facilities, type PlayerRow, type Staff, type StaffRole,
  type TrainingSettings, type WorldRow, type WorldSettings,
} from './types.ts';

export async function getWorld(d: Db = db): Promise<WorldRow | null> {
  return d.one<WorldRow>('select * from world where id = 1');
}

export async function requireWorld(d: Db = db): Promise<WorldRow> {
  const w = await getWorld(d);
  if (!w) throw new Error('World not created yet');
  return w;
}

export function seasonLabel(seasonNo: number): string {
  const y = 2025 + seasonNo;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function staffWage(rating: number): number {
  return Math.round((2000 + Math.pow(rating, 2.2) * 110) / 500) * 500;
}

export function makeStaffMember(rng: Rng, country: string, rating: number): Staff[StaffRole] {
  const nat = rng.chance(0.7) ? country : rng.pick(['ENG', 'ESP', 'GER', 'NED', 'POR', 'ITA', 'FRA', 'SCO', 'IRL', 'BEL', 'DEN']);
  const nm = randomName(rng, namePools(), nat);
  const r = Math.max(3, Math.min(20, Math.round(rating)));
  return { name: `${nm.first} ${nm.last}`, rating: r, wage: staffWage(r), nat };
}

export const STAFF_ROLES: StaffRole[] = ['assistant', 'coach', 'fitness', 'physio', 'scout'];

export function initialFinances(rep: number, archetype: string, league: string): { balance: number; finances: ClubFinances } {
  const base = league === 'PL' ? Math.max(15, (rep - 50) * 3.2) : league === 'EUR' ? Math.max(10, (rep - 55) * 2.8) : Math.max(5, (rep - 50) * 1.5);
  const mult = archetype === 'chequebook' ? 1.5 : archetype === 'cynic' ? 0.8 : 1;
  const balance = Math.round(base * mult) * 1_000_000;
  return {
    balance,
    finances: {
      tickets: { general: Math.round(22 + rep * 0.45), premium: Math.round((22 + rep * 0.45) * 2.6) },
      sponsor: null,
      sponsorOffers: null,
      seasonIncome: {},
      seasonExpense: {},
      lastSeason: null,
      embargo: false,
    },
  };
}

export function initialFacilities(rep: number): Facilities {
  const tier = (bonus: number) => Math.max(1, Math.min(5, Math.round((rep - 45 + bonus) / 11)));
  return { training: tier(0), youth: tier(-2), medical: tier(1), building: null };
}

export function defaultTraining(): TrainingSettings {
  return { focus: 'balanced', intensity: 'normal', individual: [] };
}

export interface CreateWorldOpts {
  name: string;
  timezone: string;
  settings?: Partial<WorldSettings>;
  now?: Date;
}

export async function createWorld(opts: CreateWorldOpts): Promise<void> {
  const seed = loadSeed();
  const settings: WorldSettings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };
  const rng = new Rng(`world-${Date.now()}-${Math.random()}`);
  const now = opts.now ?? new Date();
  const secret = randomToken(24);

  await tx(async (t) => {
    const exists = await t.one('select 1 from world where id = 1');
    if (exists) throw new Error('A world already exists');
    // Keep existing push keys across a league reset so installed apps keep receiving notifications.
    const existing = await t.one<{ value: { publicKey: string; privateKey: string } }>(`select value from app_settings where key = 'vapid'`);
    const vapid = existing?.value ?? webpush.generateVAPIDKeys();
    await t.q(
      `insert into app_settings(key, value) values ('vapid', $1) on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ publicKey: vapid.publicKey, privateKey: vapid.privateKey })],
    );
    await t.q(
      `insert into world (id, name, timezone, season_no, season_label, phase, settings, secret, transfer_window, state)
       values (1, $1, $2, 1, $3, 'preseason', $4, $5, $6, $7)`,
      [opts.name, opts.timezone, seedSeasonLabel(seed.season), JSON.stringify(settings), secret,
        JSON.stringify({ open: true, kind: 'preseason', closesAt: null, opensAt: null }),
        JSON.stringify({ vapidPublic: vapid.publicKey, started: false, dataVersion: seed.upgrades?.v2 ? SEED_DATA_VERSION : 1 })],
    );
    await t.q(`insert into seasons (season_no, label) values (1, $1)`, [seedSeasonLabel(seed.season)]);

    // ---- clubs
    const clubRows: unknown[][] = [];
    for (const c of seed.clubs) {
      const archetype = (ARCHETYPES.includes(c.archetype as Archetype) ? c.archetype : 'pragmatist') as Archetype;
      const acumen = acumenFor(settings.difficulty, c.reputation, rng);
      const bot = newManager(rng, c.country, archetype, acumen, 1);
      const { balance, finances } = initialFinances(c.reputation, archetype, c.league);
      const staff: Staff = {};
      for (const role of STAFF_ROLES) staff[role] = makeStaffMember(rng, c.country, 6 + (c.reputation - 55) / 3.5 + rng.normal(0, 2));
      clubRows.push([
        c.key, c.name, c.short, c.league, c.country, JSON.stringify(c.colors), c.stadium, c.capacity, c.reputation,
        JSON.stringify(bot), balance, JSON.stringify(finances), JSON.stringify(initialFacilities(c.reputation)), JSON.stringify(staff),
        JSON.stringify(defaultTraining()), '[]', 60,
        JSON.stringify({ rivals: c.rivals, lastPos: c.lastPos, europe: c.europe, form: 0, expectation: c.lastPos ?? null }),
      ]);
    }
    await insertMany(t, 'clubs', ['key', 'name', 'short', 'league', 'country', 'colors', 'stadium', 'capacity', 'reputation', 'bot', 'balance', 'finances', 'facilities', 'staff', 'training', 'vision', 'fan_mood', 'meta'], clubRows);
    const clubIds = new Map((await t.many<{ id: number; key: string }>('select id, key from clubs')).map((r) => [r.key, r.id]));

    // ---- players
    const pRows: unknown[][] = [];
    for (const p of seed.players) {
      const clubId = p.club && p.club !== 'RES' ? clubIds.get(p.club) ?? null : null;
      const status = p.club === 'RES' ? 'reserve' : clubId ? 'active' : 'free';
      pRows.push(seedPlayerRow(p, clubId, status, rng));
    }
    await insertMany(t, 'players', SEED_PLAYER_COLS, pRows, '', 400);

    // ---- tactics with a default XI for every club that plays matches
    const playing = new Set(seed.clubs.filter((c) => c.league !== 'WORLD').map((c) => c.key));
    await createDefaultTactics(t, [...clubIds.entries()].filter(([k]) => playing.has(k)).map(([, id]) => id));

    // ---- recurring jobs
    await scheduleRecurring(t, settings, opts.timezone, now);

    await t.q(`insert into news (season_no, type, headline, body, importance) values (1, 'system', $1, $2, 3)`, [
      `Welcome to ${opts.name}`,
      'The pre-season transfer window is open. Pick a club, sign players and get your tactics ready. The season starts when the league admin says go.',
    ]);
  });
}

export const SEED_PLAYER_COLS = ['club_id', 'status', 'name', 'short', 'first_name', 'last_name', 'nat', 'age', 'foot', 'height', 'positions', 'attrs', 'hidden', 'ca', 'pa', 'condition', 'sharpness', 'form', 'morale', 'fatigue_debt', 'wage', 'contract_until', 'squad_number', 'value', 'flags', 'form_history', 'history', 'joined_season', 'traits', 'seed_id'];
/** Bumped whenever the seed gains data that existing leagues should receive (see upgrade.ts). */
export const SEED_DATA_VERSION = 2;

/** One players-table row from a seed player (column order = SEED_PLAYER_COLS). */
export function seedPlayerRow(p: SeedPlayer, clubId: number | null, status: string, rng: Rng, seasonNo = 1): unknown[] {
  const wage = Math.round((p.wage * (clubId ? WAGE_SCALE : 1.2)) / 500) * 500;
  const contract = clubId ? Math.max(1, p.cy) + seasonNo - 1 : 0;
  const value = valueOf({ ca: p.ca, pa: p.pa, age: p.age, contract_until: contract || seasonNo + 1, form: 1, positions: p.pos }, seasonNo);
  const flags = p.wk ? { prospect: true } : {};
  return [
    clubId, status, p.name, p.short, p.first, p.last, p.nat, p.age, p.foot, p.h, JSON.stringify(p.pos), p.a, p.hd, p.ca, p.pa,
    100, clubId ? 80 + rng.int(0, 15) : 60, 1, 1, 0, wage, contract, p.no, value, JSON.stringify(flags), '[]', '[]', clubId ? seasonNo : null,
    JSON.stringify(p.tr ?? {}), p.sid,
  ];
}

function seedSeasonLabel(s: string): string {
  return s || '2026-27';
}

export async function createDefaultTactics(t: Db, clubIds: number[]) {
  const clubs = await t.many<{ id: number; bot: { archetype: Archetype } }>('select id, bot from clubs where id = any($1)', [clubIds]);
  const players = await t.many<PlayerRow>(`select id, club_id, status, positions, attrs, condition, sharpness, form, morale, age, ca, injury, suspended from players where club_id = any($1) and status = 'active'`, [clubIds]);
  const byClub = new Map<number, PlayerRow[]>();
  for (const p of players) (byClub.get(p.club_id!) ?? byClub.set(p.club_id!, []).get(p.club_id!)!).push(p);
  const rows: unknown[][] = [];
  for (const c of clubs) {
    const tactics = archetypeTactics(c.bot.archetype).slice(0, 3);
    const squad = byClub.get(c.id) ?? [];
    const sel = squad.map((p) => toSelectable({ ...p, attrs: p.attrs } as PlayerRow));
    tactics.forEach((tac: Tactic, i) => {
      const s = selectTeam(sel, tac, { benchSize: 9 });
      tac.setPieces = { ...tac.setPieces, ...s.setPieces };
      rows.push([c.id, tac.name, JSON.stringify(tac), JSON.stringify(s.lineup), JSON.stringify(s.bench), i === 0 ? 0.85 : 0.6, i === 0]);
    });
  }
  await insertMany(t, 'tactics', ['club_id', 'name', 'data', 'lineup', 'bench', 'familiarity', 'is_default'], rows);
  void attrsFromArray;
}

/** Daily and weekly jobs self-reschedule; this seeds the first occurrences. */
export async function scheduleRecurring(t: Db, s: WorldSettings, tz: string, now: Date) {
  const today = calDate(now, tz);
  let daily = atTime(today, s.dailyTime, tz);
  if (daily <= now) daily = atTime(addDays(today, 1), s.dailyTime, tz);
  const wd = WEEKDAY_KEYS.indexOf(s.digestDay);
  let weeklyDay = nextWeekday(today, wd);
  let weekly = atTime(weeklyDay, s.digestTime, tz);
  if (weekly <= now) { weeklyDay = nextWeekday(addDays(today, 1), wd); weekly = atTime(weeklyDay, s.digestTime, tz); }
  await t.q(`insert into jobs (run_at, type, unique_key) values ($1, 'daily', $2) on conflict (unique_key) do nothing`, [daily, `daily:${daily.toISOString()}`]);
  await t.q(`insert into jobs (run_at, type, unique_key) values ($1, 'weekly', $2) on conflict (unique_key) do nothing`, [weekly, `weekly:${weekly.toISOString()}`]);
}

export async function clubOfUser(userId: number, d: Db = db): Promise<{ id: number } | null> {
  return d.one<{ id: number }>('select id from clubs where user_id = $1', [userId]);
}
