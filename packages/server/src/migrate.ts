// Forward-only schema migrations, applied automatically on first request / tick.
import { tx, type Db } from './db.ts';

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
create table if not exists app_settings (key text primary key, value jsonb not null);

create table if not exists users (
  id serial primary key,
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  prefs jsonb not null default '{}'
);

create table if not exists sessions (
  token_hash text primary key,
  user_id int not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists invites (
  code text primary key,
  created_by int references users(id) on delete set null,
  created_at timestamptz not null default now(),
  max_uses int not null default 1,
  uses int not null default 0,
  expires_at timestamptz,
  note text
);

create table if not exists push_subs (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  endpoint text unique not null,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists world (
  id int primary key default 1,
  name text not null,
  timezone text not null,
  season_no int not null default 1,
  season_label text not null,
  phase text not null,
  settings jsonb not null,
  secret text not null,
  paused boolean not null default false,
  transfer_window jsonb not null default '{}',
  state jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists clubs (
  id serial primary key,
  key text unique not null,
  name text not null,
  short text not null,
  league text not null,
  country text not null,
  colors jsonb not null,
  stadium text not null,
  capacity int not null,
  reputation int not null,
  manager_type text not null default 'bot',
  user_id int unique references users(id) on delete set null,
  bot jsonb not null default '{}',
  balance bigint not null default 0,
  finances jsonb not null default '{}',
  facilities jsonb not null default '{}',
  staff jsonb not null default '{}',
  training jsonb not null default '{}',
  vision jsonb not null default '[]',
  fan_mood int not null default 60,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists players (
  id serial primary key,
  club_id int references clubs(id) on delete set null,
  status text not null default 'active',
  name text not null,
  short text not null,
  first_name text,
  last_name text,
  nat text not null,
  age int not null,
  foot text not null,
  height int,
  positions jsonb not null,
  attrs smallint[] not null,
  hidden smallint[] not null,
  ca int not null,
  pa int not null,
  condition real not null default 100,
  sharpness real not null default 85,
  form real not null default 1,
  morale real not null default 1,
  fatigue_debt real not null default 0,
  injury jsonb,
  suspended int not null default 0,
  yellows int not null default 0,
  wage int not null,
  contract_until int not null,
  squad_number int,
  value bigint not null default 0,
  flags jsonb not null default '{}',
  form_history jsonb not null default '[]',
  history jsonb not null default '[]',
  joined_season int,
  created_at timestamptz not null default now()
);
create index if not exists players_club_idx on players(club_id);
create index if not exists players_status_idx on players(status);

create table if not exists tactics (
  id serial primary key,
  club_id int not null references clubs(id) on delete cascade,
  name text not null,
  data jsonb not null,
  lineup jsonb not null default '[]',
  bench jsonb not null default '[]',
  familiarity real not null default 0.6,
  is_default boolean not null default false,
  record jsonb not null default '{"p":0,"w":0,"d":0,"l":0}',
  updated_at timestamptz not null default now()
);
create index if not exists tactics_club_idx on tactics(club_id);

create table if not exists competitions (
  id serial primary key,
  season_no int not null,
  type text not null,
  name text not null,
  status text not null default 'active',
  data jsonb not null default '{}',
  winner_id int references clubs(id) on delete set null,
  runner_up_id int references clubs(id) on delete set null
);
create index if not exists competitions_season_idx on competitions(season_no, type);

create table if not exists fixtures (
  id serial primary key,
  season_no int not null,
  competition_id int not null references competitions(id) on delete cascade,
  round int not null,
  stage text not null,
  leg int not null default 1,
  tie_key text,
  grp text,
  home_id int not null references clubs(id),
  away_id int not null references clubs(id),
  kickoff_at timestamptz not null,
  deadline_at timestamptz not null,
  status text not null default 'scheduled',
  home_goals int,
  away_goals int,
  extra_time boolean not null default false,
  pens jsonb,
  winner_id int,
  seed text not null,
  neutral boolean not null default false,
  summary jsonb,
  attendance int,
  weather text,
  played_at timestamptz
);
create index if not exists fixtures_kickoff_idx on fixtures(kickoff_at);
create index if not exists fixtures_home_idx on fixtures(home_id);
create index if not exists fixtures_away_idx on fixtures(away_id);
create index if not exists fixtures_comp_idx on fixtures(competition_id, round);
create index if not exists fixtures_status_idx on fixtures(status, kickoff_at);

create table if not exists match_logs (
  fixture_id int primary key references fixtures(id) on delete cascade,
  events jsonb not null
);

create table if not exists team_sheets (
  fixture_id int not null references fixtures(id) on delete cascade,
  club_id int not null references clubs(id) on delete cascade,
  tactic jsonb not null,
  lineup jsonb not null,
  bench jsonb not null,
  plan_b jsonb,
  opp jsonb,
  captain_id int,
  submitted_by text not null,
  submitted_at timestamptz not null default now(),
  primary key (fixture_id, club_id)
);

create table if not exists player_match (
  fixture_id int not null references fixtures(id) on delete cascade,
  player_id int not null references players(id) on delete cascade,
  club_id int not null,
  season_no int not null,
  comp_type text not null,
  started boolean not null,
  minutes int not null,
  rating real not null,
  goals int not null default 0,
  assists int not null default 0,
  shots int not null default 0,
  xg real not null default 0,
  yellow int not null default 0,
  red boolean not null default false,
  clean_sheet boolean not null default false,
  stats jsonb not null default '{}',
  primary key (fixture_id, player_id)
);
create index if not exists pm_player_idx on player_match(player_id);
create index if not exists pm_season_idx on player_match(season_no, comp_type);

create table if not exists honours (
  id serial primary key,
  club_id int references clubs(id) on delete cascade,
  season_no int not null,
  comp_type text not null,
  name text not null,
  place text not null
);

create table if not exists transfers (
  id serial primary key,
  season_no int not null,
  player_id int references players(id) on delete set null,
  player_name text not null,
  from_club int references clubs(id) on delete set null,
  to_club int references clubs(id) on delete set null,
  fee bigint not null default 0,
  wage int not null default 0,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists transfers_created_idx on transfers(created_at desc);

create table if not exists bids (
  id serial primary key,
  player_id int not null references players(id) on delete cascade,
  from_club int not null references clubs(id) on delete cascade,
  to_club int references clubs(id) on delete cascade,
  fee bigint not null default 0,
  wage int not null,
  years int not null,
  promise text,
  status text not null,
  counter_fee bigint,
  thread jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  respond_at timestamptz,
  expires_at timestamptz not null
);
create index if not exists bids_status_idx on bids(status);
create index if not exists bids_player_idx on bids(player_id);

create table if not exists shortlist (
  club_id int not null references clubs(id) on delete cascade,
  player_id int not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, player_id)
);

create table if not exists scouting (
  club_id int not null references clubs(id) on delete cascade,
  player_id int not null references players(id) on delete cascade,
  knowledge int not null default 0,
  assigned boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (club_id, player_id)
);

create table if not exists news (
  id serial primary key,
  created_at timestamptz not null default now(),
  season_no int,
  type text not null,
  club_ids int[] not null default '{}',
  headline text not null,
  body text not null default '',
  payload jsonb not null default '{}',
  importance int not null default 1
);
create index if not exists news_created_idx on news(created_at desc);

create table if not exists notifications (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  club_id int,
  type text not null,
  title text not null,
  body text not null default '',
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

create table if not exists decisions (
  id serial primary key,
  club_id int not null references clubs(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  options jsonb not null default '[]',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  resolved_option text
);

create table if not exists jobs (
  id serial primary key,
  run_at timestamptz not null,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text,
  unique_key text unique,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists jobs_due_idx on jobs(status, run_at);

create table if not exists ledger (
  id serial primary key,
  club_id int not null references clubs(id) on delete cascade,
  season_no int not null,
  created_at timestamptz not null default now(),
  category text not null,
  amount bigint not null,
  description text not null default ''
);
create index if not exists ledger_club_idx on ledger(club_id, season_no);

create table if not exists seasons (
  season_no int primary key,
  label text not null,
  started_at timestamptz,
  ended_at timestamptz,
  summary jsonb not null default '{}'
);

create table if not exists locks (
  name text primary key,
  holder text,
  until timestamptz
);
`,
  },
  {
    version: 2,
    sql: `
create table if not exists preview_runs (
  club_id int not null references clubs(id) on delete cascade,
  fixture_id int not null references fixtures(id) on delete cascade,
  runs int not null default 0,
  primary key (club_id, fixture_id)
);
create table if not exists rate_events (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_idx on rate_events(key, at);
create index if not exists player_match_club_idx on player_match(club_id, season_no);
create index if not exists decisions_club_idx on decisions(club_id, status);
create index if not exists bids_from_idx on bids(from_club, status);
create index if not exists bids_to_idx on bids(to_club, status);
`,
  },
  {
    // Players and clubs are rewritten every day; leave room on each page for in-place (HOT)
    // updates and vacuum more eagerly so the tables stay small on a free-tier database.
    version: 3,
    sql: `
alter table players set (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.05);
alter table clubs set (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.05);
alter table jobs set (autovacuum_vacuum_scale_factor = 0.05);
`,
  },
  {
    // Signature traits, seed identity (for world data upgrades), private bids with media leaks,
    // and scouting network missions.
    version: 4,
    sql: `
alter table players add column if not exists traits jsonb not null default '{}';
alter table players add column if not exists seed_id int;
create index if not exists players_seed_idx on players(seed_id);
alter table bids add column if not exists private boolean not null default false;
alter table bids add column if not exists leak_at timestamptz;
alter table bids add column if not exists leaked boolean not null default false;
create index if not exists bids_leak_idx on bids(leak_at) where leak_at is not null;
create table if not exists scout_missions (
  id serial primary key,
  club_id int not null references clubs(id) on delete cascade,
  region text not null,
  pos text,
  age_max int not null default 21,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active',
  found jsonb not null default '[]',
  reports int not null default 0
);
create index if not exists scout_missions_club_idx on scout_missions(club_id, status);
`,
  },
];

let migrated = false;
let inflight: Promise<void> | null = null;

/** Advisory lock key so concurrent serverless instances never migrate at the same time. */
const MIGRATION_LOCK = 482_907_331;

/**
 * Bring the schema up to date. Safe to call on every request: after the first
 * success it is a no-op, concurrent callers in one process share a single run,
 * and separate processes serialise on a Postgres advisory lock.
 */
export function migrate(d?: Db): Promise<void> {
  if (migrated) return Promise.resolve();
  if (!inflight) {
    inflight = runMigrations(d)
      .then(() => { migrated = true; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

async function runMigrations(d?: Db): Promise<void> {
  const body = async (t: Db) => {
    await t.q('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await t.q('create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())');
    const done = new Set((await t.many<{ version: number }>('select version from schema_migrations')).map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await t.q(m.sql);
      await t.q('insert into schema_migrations(version) values ($1) on conflict do nothing', [m.version]);
    }
  };
  if (d) await body(d);
  else await tx(body);
}

export function resetMigratedFlag() {
  migrated = false;
}
