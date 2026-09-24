// Status, first-run setup, accounts, sessions, profile and push subscriptions.
import { db, tx } from '../db.ts';
import { migrate } from '../migrate.ts';
import { ApiError, bad, route, type Ctx } from '../http/router.ts';
import {
  clearSessionCookie, createSession, destroySession, hashPassword, inviteCode, sessionCookie, validUsername, verifyPassword,
  SESSION_COOKIE,
} from '../lib/auth.ts';
import { isValidTimeZone } from '../lib/time.ts';
import { createWorld, getWorld } from '../game/world.ts';
import { pickClub } from '../game/season.ts';
import { notifyUser, DEFAULT_PREFS } from '../game/notify.ts';
import { ARCHETYPE_INFO } from '../game/archetypes.ts';
import { DEFAULT_SETTINGS, type ClubRow, type WorldSettings } from '../game/types.ts';
import { clubLite, int, str, world as requireWorld } from './common.ts';
import { maybeLazyTick } from './system.ts';

export async function rateLimit(key: string, max: number, windowMinutes: number) {
  const r = await db.one<{ n: number }>(`select count(*)::int n from rate_events where key = $1 and at > now() - ($2 || ' minutes')::interval`, [key, String(windowMinutes)]);
  if ((r?.n ?? 0) >= max) throw new ApiError('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.');
  await db.q('insert into rate_events (key) values ($1)', [key]);
  if (Math.random() < 0.02) await db.q(`delete from rate_events where at < now() - interval '1 day'`);
}

function appSecret(): string | null {
  const s = process.env.APP_SECRET?.trim();
  return s ? s : null;
}

// ---------------------------------------------------------------- status / setup
route('GET', '/api/status', 'none', async (ctx) => {
  await migrate();
  const w = await getWorld();
  const users = await db.one<{ n: number }>('select count(*)::int n from users');
  const vapid = await db.one<{ value: { publicKey: string } }>(`select value from app_settings where key = 'vapid'`);
  if (w && ctx.canDefer) ctx.after(() => maybeLazyTick(w));
  return {
    setup: !!w,
    name: w?.name ?? null,
    season: w?.season_label ?? null,
    phase: w?.phase ?? null,
    users: users?.n ?? 0,
    secretConfigured: !!appSecret(),
    vapidPublic: vapid?.value.publicKey ?? null,
    time: new Date().toISOString(),
  };
});

route('POST', '/api/setup', 'none', async (ctx) => {
  await migrate();
  const secret = appSecret();
  if (!secret) throw new ApiError('FORBIDDEN', 'Set the APP_SECRET environment variable in your hosting dashboard first, then redeploy.');
  await rateLimit(`setup:${ctx.ip}`, 10, 15);
  if (String(ctx.body.key ?? '').trim() !== secret) throw new ApiError('FORBIDDEN', 'That setup key does not match APP_SECRET.');
  if (await getWorld()) throw new ApiError('CONFLICT', 'This league is already set up.');
  const name = str(ctx.body.leagueName, 'League name', { min: 2, max: 40 });
  const timezone = str(ctx.body.timezone ?? 'Europe/London', 'Time zone');
  if (!isValidTimeZone(timezone)) throw bad('Unknown time zone.');
  const username = str(ctx.body.username, 'Username').toLowerCase();
  if (!validUsername(username)) throw bad('Usernames are 3-24 letters, numbers, dots, dashes or underscores.');
  const password = str(ctx.body.password, 'Password', { min: 6, max: 200 });
  const displayName = str(ctx.body.displayName ?? username, 'Display name', { min: 1, max: 30 });
  const settings = sanitizeSettings(ctx.body.settings ?? {});
  await createWorld({ name, timezone, settings });
  const hash = await hashPassword(password);
  const user = await db.one<{ id: number }>(
    `insert into users (username, display_name, password_hash, is_admin) values ($1, $2, $3, true)
     on conflict (username) do update set password_hash = excluded.password_hash, is_admin = true returning id`,
    [username, displayName, hash],
  );
  const code = inviteCode();
  await db.q(`insert into invites (code, created_by, max_uses, note) values ($1, $2, 25, 'Created at setup')`, [code, user!.id]);
  const host = String(ctx.req.headers['x-forwarded-host'] ?? ctx.req.headers.host ?? '');
  if (host) {
    const appUrl = `${ctx.secure ? 'https' : 'http'}://${host}`;
    await db.q(`insert into app_settings (key, value) values ('integrations', $1) on conflict (key) do update set value = app_settings.value || excluded.value`, [JSON.stringify({ appUrl })]);
  }
  const token = await createSession(user!.id);
  ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
  return { ok: true, invite: code };
});

export function sanitizeSettings(input: Record<string, unknown>): Partial<WorldSettings> {
  const out: Partial<WorldSettings> = {};
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const time = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined);
  if (time(input.kickoffTime)) out.kickoffTime = time(input.kickoffTime);
  if (Array.isArray(input.leagueDays)) {
    const ld = [...new Set(input.leagueDays.filter((d): d is (typeof days)[number] => days.includes(d as (typeof days)[number])))];
    if (ld.length >= 1 && ld.length <= 4) out.leagueDays = ld;
  }
  for (const k of ['europeDay', 'cupDay', 'digestDay'] as const) {
    if (days.includes(input[k] as (typeof days)[number])) out[k] = input[k] as (typeof days)[number];
  }
  if (time(input.digestTime)) out.digestTime = time(input.digestTime);
  if (time(input.dailyTime)) out.dailyTime = time(input.dailyTime);
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);
  if (num(input.deadlineMinutes, 0, 180) !== undefined) out.deadlineMinutes = num(input.deadlineMinutes, 0, 180);
  if (num(input.reminderHours, 1, 24) !== undefined) out.reminderHours = num(input.reminderHours, 1, 24);
  if (num(input.preseasonDays, 1, 21) !== undefined) out.preseasonDays = num(input.preseasonDays, 1, 21);
  if (num(input.midWindowDays, 2, 14) !== undefined) out.midWindowDays = num(input.midWindowDays, 2, 14);
  if (num(input.maxSubs, 3, 5) !== undefined) out.maxSubs = num(input.maxSubs, 3, 5);
  if (['casual', 'standard', 'competitive'].includes(input.difficulty as string)) out.difficulty = input.difficulty as WorldSettings['difficulty'];
  if (['low', 'normal', 'high'].includes(input.eventsFrequency as string)) out.eventsFrequency = input.eventsFrequency as WorldSettings['eventsFrequency'];
  if (['free', 'no_elite'].includes(input.clubPick as string)) out.clubPick = input.clubPick as WorldSettings['clubPick'];
  for (const k of ['europe', 'cups', 'reshuffle'] as const) if (typeof input[k] === 'boolean') out[k] = input[k] as boolean;
  void DEFAULT_SETTINGS;
  return out;
}

// ---------------------------------------------------------------- accounts
route('POST', '/api/auth/register', 'none', async (ctx) => {
  await requireWorld();
  await rateLimit(`register:${ctx.ip}`, 10, 30);
  const username = str(ctx.body.username, 'Username').toLowerCase();
  if (!validUsername(username)) throw bad('Usernames are 3-24 letters, numbers, dots, dashes or underscores.');
  const password = str(ctx.body.password, 'Password', { min: 6, max: 200 });
  const displayName = str(ctx.body.displayName || username, 'Display name', { min: 1, max: 30 });
  const code = str(ctx.body.invite, 'Invite code').toUpperCase().replace(/\s+/g, '');
  const hash = await hashPassword(password);
  const userId = await tx(async (t) => {
    const inv = await t.one<{ code: string; uses: number; max_uses: number; expires_at: Date | null }>('select * from invites where code = $1 for update', [code.includes('-') ? code : `${code.slice(0, 4)}-${code.slice(4)}`]);
    if (!inv) throw new ApiError('FORBIDDEN', 'That invite code is not valid. Ask your league admin for a new one.');
    if (inv.uses >= inv.max_uses) throw new ApiError('FORBIDDEN', 'That invite code has been used up. Ask your league admin for a new one.');
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) throw new ApiError('FORBIDDEN', 'That invite code has expired.');
    const exists = await t.one('select 1 from users where username = $1', [username]);
    if (exists) throw new ApiError('CONFLICT', 'That username is taken.');
    const u = await t.one<{ id: number }>('insert into users (username, display_name, password_hash) values ($1, $2, $3) returning id', [username, displayName, hash]);
    await t.q('update invites set uses = uses + 1 where code = $1', [inv.code]);
    return u!.id;
  });
  const token = await createSession(userId);
  ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
  return { ok: true };
});

route('POST', '/api/auth/login', 'none', async (ctx) => {
  const username = str(ctx.body.username, 'Username').toLowerCase();
  const password = str(ctx.body.password, 'Password');
  await rateLimit(`login:${ctx.ip}:${username}`, 10, 15);
  const u = await db.one<{ id: number; password_hash: string }>('select id, password_hash from users where username = $1', [username]);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new ApiError('UNAUTHENTICATED', 'Wrong username or password.');
  const token = await createSession(u.id);
  ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
  return { ok: true };
});

route('POST', '/api/auth/logout', 'none', async (ctx) => {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token) await destroySession(token);
  ctx.setHeader('Set-Cookie', clearSessionCookie(ctx.secure));
  return { ok: true };
});

export interface SavedSearch { name: string; query: string }
export interface UserPrefs {
  notify: Record<keyof typeof DEFAULT_PREFS, boolean>;
  reducedMotion?: boolean;
  haptics?: boolean;
  savedSearches?: SavedSearch[];
  tourDone?: boolean;
  seenSeason?: number;
}

function userPrefs(raw: Record<string, unknown> | null | undefined): UserPrefs {
  const p = raw ?? {};
  return {
    notify: { ...DEFAULT_PREFS, ...((p.notify as Record<string, boolean>) ?? {}) },
    reducedMotion: typeof p.reducedMotion === 'boolean' ? p.reducedMotion : undefined,
    haptics: typeof p.haptics === 'boolean' ? p.haptics : undefined,
    savedSearches: Array.isArray(p.savedSearches) ? (p.savedSearches as SavedSearch[]) : [],
    tourDone: p.tourDone === true,
    seenSeason: typeof p.seenSeason === 'number' ? p.seenSeason : undefined,
  };
}

export async function meData(ctx: Ctx) {
  const u = ctx.user!;
  const w = await getWorld();
  const club = await db.one<ClubRow>('select * from clubs where user_id = $1', [u.id]);
  const unread = await db.one<{ n: number }>('select count(*)::int n from notifications where user_id = $1 and read_at is null', [u.id]);
  const decisions = club ? await db.one<{ n: number }>(`select count(*)::int n from decisions where club_id = $1 and status = 'open'`, [club.id]) : null;
  const vapid = await db.one<{ value: { publicKey: string } }>(`select value from app_settings where key = 'vapid'`);
  if (w && ctx.canDefer) ctx.after(() => maybeLazyTick(w));
  return {
    user: { id: u.id, username: u.username, displayName: u.display_name, isAdmin: u.is_admin, prefs: userPrefs(u.prefs) },
    club: club ? { ...clubLite(club), botTakeover: !!club.meta?.botTakeover } : null,
    world: w ? {
      name: w.name, seasonNo: w.season_no, season: w.season_label, phase: w.phase, paused: w.paused, timezone: w.timezone,
      window: w.transfer_window, started: !!w.state.started, lastTickAt: w.state.lastTickAt ?? null,
      settings: { kickoffTime: w.settings.kickoffTime, leagueDays: w.settings.leagueDays, deadlineMinutes: w.settings.deadlineMinutes, maxSubs: w.settings.maxSubs, difficulty: w.settings.difficulty },
    } : null,
    unread: unread?.n ?? 0,
    decisions: decisions?.n ?? 0,
    vapidPublic: vapid?.value.publicKey ?? null,
  };
}
export type MeData = Awaited<ReturnType<typeof meData>>;

route('GET', '/api/me', 'user', meData);

route('PUT', '/api/me', 'user', async (ctx) => {
  const u = ctx.user!;
  if (ctx.body.displayName !== undefined) {
    const dn = str(ctx.body.displayName, 'Display name', { min: 1, max: 30 });
    await db.q('update users set display_name = $2 where id = $1', [u.id, dn]);
  }
  if (ctx.body.prefs && typeof ctx.body.prefs === 'object') {
    const allowed: Record<string, unknown> = {};
    const p = ctx.body.prefs as Record<string, unknown>;
    if (p.notify && typeof p.notify === 'object') {
      const n: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(p.notify as Record<string, unknown>)) if (k in DEFAULT_PREFS && typeof v === 'boolean') n[k] = v;
      allowed.notify = { ...((u.prefs?.notify as object) ?? {}), ...n };
    }
    if (typeof p.reducedMotion === 'boolean') allowed.reducedMotion = p.reducedMotion;
    if (typeof p.haptics === 'boolean') allowed.haptics = p.haptics;
    if (Array.isArray(p.savedSearches)) allowed.savedSearches = p.savedSearches.slice(0, 10);
    if (typeof p.tourDone === 'boolean') allowed.tourDone = p.tourDone;
    if (typeof p.seenSeason === 'number') allowed.seenSeason = p.seenSeason;
    await db.q(`update users set prefs = prefs || $2::jsonb where id = $1`, [u.id, JSON.stringify(allowed)]);
  }
  return { ok: true };
});

route('PUT', '/api/me/password', 'user', async (ctx) => {
  const current = str(ctx.body.current, 'Current password');
  const next = str(ctx.body.next, 'New password', { min: 6, max: 200 });
  const u = await db.one<{ password_hash: string }>('select password_hash from users where id = $1', [ctx.user!.id]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw new ApiError('FORBIDDEN', 'Your current password is wrong.');
  await db.q('update users set password_hash = $2 where id = $1', [ctx.user!.id, await hashPassword(next)]);
  await db.q('delete from sessions where user_id = $1 and token_hash <> encode(sha256(convert_to($2, \'UTF8\')), \'hex\')', [ctx.user!.id, ctx.cookies[SESSION_COOKIE] ?? '']);
  return { ok: true };
});

// ---------------------------------------------------------------- push
route('POST', '/api/push/subscribe', 'user', async (ctx) => {
  const sub = ctx.body.subscription ?? ctx.body;
  const endpoint = str(sub.endpoint, 'endpoint', { max: 1000 });
  if (!/^https:\/\//.test(endpoint)) throw bad('Invalid push endpoint.');
  const keys = sub.keys ?? {};
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw bad('Invalid push keys.');
  await db.q(
    `insert into push_subs (user_id, endpoint, keys) values ($1, $2, $3)
     on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys`,
    [ctx.user!.id, endpoint, JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth })],
  );
  return { ok: true };
});

route('POST', '/api/push/unsubscribe', 'user', async (ctx) => {
  const endpoint = str(ctx.body.endpoint, 'endpoint', { max: 1000 });
  await db.q('delete from push_subs where endpoint = $1 and user_id = $2', [endpoint, ctx.user!.id]);
  return { ok: true };
});

route('POST', '/api/push/test', 'user', async (ctx) => {
  await notifyUser(db, ctx.user!.id, { type: 'system', title: 'Notifications are working', body: 'You will hear about deadlines, results and bids here.', link: '/settings' });
  const n = await db.one<{ n: number }>('select count(*)::int n from push_subs where user_id = $1', [ctx.user!.id]);
  return { devices: n?.n ?? 0 };
});

// ---------------------------------------------------------------- club selection
export async function availableClubs(ctx: Ctx) {
  const w = await requireWorld();
  const rows = await db.many<ClubRow & { user_name: string | null; strength: number }>(
    `select c.*, u.display_name user_name,
       coalesce((select avg(ca) from (select ca from players p where p.club_id = c.id and p.status = 'active' order by ca desc limit 11) t), 0)::float strength
       from clubs c left join users u on u.id = c.user_id where c.league = 'PL' order by c.reputation desc`);
  const stars = await db.many<{ club_id: number; id: number; name: string; ca: number; positions: Record<string, number> }>(
    `select * from (select p.club_id, p.id, p.name, p.ca, p.positions, row_number() over (partition by p.club_id order by p.ca desc) rn
       from players p join clubs c on c.id = p.club_id where c.league = 'PL' and p.status = 'active') t where rn <= 3`);
  const mine = await db.one<{ id: number }>('select id from clubs where user_id = $1', [ctx.user!.id]);
  const ranked = rows.slice().sort((a, b) => b.strength - a.strength);
  return {
    mine: mine?.id ?? null,
    rule: w.settings.clubPick,
    clubs: rows.map((c) => {
      const rank = ranked.findIndex((r) => r.id === c.id) + 1;
      const outlook = rank <= 4 ? 'Title contender' : rank <= 7 ? 'Chasing Europe' : rank <= 14 ? 'Mid-table' : 'Relegation fight';
      const locked = c.manager_type === 'human' ? `Managed by ${c.user_name ?? 'a friend'}` : w.settings.clubPick === 'no_elite' && c.reputation >= 88 ? 'Bot-only in this league' : null;
      return {
        ...clubLite(c), stadium: c.stadium, capacity: c.capacity, reputation: c.reputation, balance: c.balance,
        strength: Math.round(c.strength) / 10, rank, outlook, locked,
        bot: c.manager_type === 'bot' ? { name: c.bot.name, style: ARCHETYPE_INFO[c.bot.archetype]?.label ?? c.bot.archetype } : null,
        stars: stars.filter((s) => s.club_id === c.id).sort((a, b) => b.ca - a.ca).map((s) => ({ id: s.id, name: s.name, ovr: s.ca / 10 })),
      };
    }),
  };
}
export type AvailableClubsData = Awaited<ReturnType<typeof availableClubs>>;
route('GET', '/api/clubs/available', 'user', availableClubs);

route('POST', '/api/clubs/pick', 'user', async (ctx) => {
  const clubId = int(ctx.body.clubId, 'clubId', { min: 1 });
  await tx(async (t) => pickClub(t, (await getWorld(t))!, ctx.user!.id, clubId));
  const club = (await db.one<ClubRow & { user_name: string | null }>('select c.*, u.display_name user_name from clubs c left join users u on u.id = c.user_id where c.id = $1', [clubId]))!;
  return { club: clubLite(club) };
});
