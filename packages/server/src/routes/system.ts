// The clock endpoint (called by cron-job.org / GitHub Actions), the lazy fallback tick, and admin tools.
import { timingSafeEqual } from 'node:crypto';
import { db, tx } from '../db.ts';
import { migrate } from '../migrate.ts';
import { ApiError, bad, route, type Ctx } from '../http/router.ts';
import { hashPassword, inviteCode, randomToken } from '../lib/auth.ts';
import { tick } from '../jobs/runner.ts';
import { createWorld, getWorld } from '../game/world.ts';
import { beginSeason, leaveClub } from '../game/season.ts';
import { getIntegrations, notifyUser, postToChannel } from '../game/notify.ts';
import type { WorldRow } from '../game/types.ts';
import { int, str } from './common.ts';
import { sanitizeSettings } from './auth.ts';

function secretMatches(given: string | null | undefined): boolean {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

let lazyInFlight = false;
/** If the external clock has not ticked for a while, the next visitor's request nudges it (after responding). */
export async function maybeLazyTick(w: WorldRow) {
  if (lazyInFlight || w.paused) return;
  const last = w.state.lastTickAt ? new Date(w.state.lastTickAt).getTime() : 0;
  if (Date.now() - last < 10 * 60_000) return;
  lazyInFlight = true;
  try {
    await tick({ budgetMs: 60_000 });
  } catch (e) {
    console.error('lazy tick failed', e);
  } finally {
    lazyInFlight = false;
  }
}

// ---------------------------------------------------------------- cron
const cronHandler = async (ctx: Ctx) => {
  const auth = String(ctx.req.headers.authorization ?? '');
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : ctx.query.get('key');
  if (!secretMatches(key)) throw new ApiError('FORBIDDEN', 'Bad or missing key.');
  await migrate();
  if (ctx.query.get('wait') === '1' || !ctx.canDefer) {
    // Synchronous mode (or a host that cannot keep working after responding): stay under ~25s.
    return tick({ budgetMs: ctx.query.get('wait') === '1' ? 50_000 : 22_000 });
  }
  // Answer immediately (cron services time out after ~30s); the work continues in the background.
  ctx.after(async () => {
    const r = await tick({ budgetMs: 240_000 });
    console.log('tick', JSON.stringify({ ran: r.ran.length, skipped: r.skipped, pending: r.pending, errors: r.ran.filter((x) => x.error).length }));
  });
  const w = await getWorld();
  return { accepted: true, lastTickAt: w?.state.lastTickAt ?? null, time: new Date().toISOString() };
};
route('GET', '/api/cron/tick', 'none', cronHandler);
route('POST', '/api/cron/tick', 'none', cronHandler);

// ---------------------------------------------------------------- admin
export async function adminData() {
  const w = await getWorld();
  const users = await db.many<{ id: number; username: string; display_name: string; is_admin: boolean; last_seen_at: Date | null; created_at: Date; club: string | null; club_id: number | null; devices: number }>(
    `select u.id, u.username, u.display_name, u.is_admin, u.last_seen_at, u.created_at, c.short club, c.id club_id,
       (select count(*)::int from push_subs s where s.user_id = u.id) devices
       from users u left join clubs c on c.user_id = u.id order by u.id`);
  const invites = await db.many<{ code: string; max_uses: number; uses: number; expires_at: Date | null; note: string | null; created_at: Date }>('select code, max_uses, uses, expires_at, note, created_at from invites order by created_at desc limit 30');
  const jobs = await db.one<{ pending: number; due: number; failed: number; next: Date | null }>(
    `select count(*) filter (where status = 'pending')::int pending, count(*) filter (where status = 'pending' and run_at <= now())::int due,
       count(*) filter (where status = 'failed')::int failed, min(run_at) filter (where status = 'pending') next from jobs`);
  const failed = await db.many<{ id: number; type: string; run_at: Date; last_error: string | null; attempts: number }>(`select id, type, run_at, last_error, attempts from jobs where status = 'failed' order by run_at desc limit 5`);
  const upcoming = await db.many<{ type: string; run_at: Date; payload: Record<string, unknown> }>(`select type, run_at, payload from jobs where status = 'pending' order by run_at limit 8`);
  const integ = await getIntegrations();
  const size = await db.one<{ bytes: number }>('select pg_database_size(current_database())::bigint bytes').catch(() => null);
  return {
    world: w ? { name: w.name, timezone: w.timezone, season: w.season_label, seasonNo: w.season_no, phase: w.phase, paused: w.paused, settings: w.settings, window: w.transfer_window, lastTickAt: w.state.lastTickAt ?? null, started: !!w.state.started } : null,
    users: users.map((u) => ({ ...u, last_seen_at: u.last_seen_at ? new Date(u.last_seen_at).toISOString() : null })),
    invites,
    jobs: { ...jobs, next: jobs?.next ? new Date(jobs.next).toISOString() : null, failed, upcoming },
    integrations: {
      appUrl: integ.appUrl ?? null,
      discord: !!integ.discordWebhook,
      telegram: !!(integ.telegramBotToken && integ.telegramChatId),
      telegramChatId: integ.telegramChatId ?? null,
    },
    dbSizeMb: size ? Math.round((size.bytes / 1024 / 1024) * 10) / 10 : null,
    secretConfigured: !!process.env.APP_SECRET,
  };
}
export type AdminData = Awaited<ReturnType<typeof adminData>>;
route('GET', '/api/admin', 'admin', adminData);

route('POST', '/api/admin/invites', 'admin', async (ctx) => {
  const maxUses = int(ctx.body.maxUses ?? 1, 'maxUses', { min: 1, max: 100 });
  const days = ctx.body.expiresDays ? int(ctx.body.expiresDays, 'expiresDays', { min: 1, max: 365 }) : null;
  const note = typeof ctx.body.note === 'string' ? ctx.body.note.slice(0, 60) : null;
  const code = inviteCode();
  await db.q(`insert into invites (code, created_by, max_uses, expires_at, note) values ($1, $2, $3, $4, $5)`, [code, ctx.user!.id, maxUses, days ? new Date(Date.now() + days * 86400000) : null, note]);
  return { code };
});

route('DELETE', '/api/admin/invites/:code', 'admin', async (ctx) => {
  await db.q('delete from invites where code = $1', [ctx.params.code]);
  return { ok: true };
});

route('POST', '/api/admin/users/:id/reset-password', 'admin', async (ctx) => {
  const id = int(ctx.params.id, 'id');
  const temp = randomToken(6).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'changeme1';
  const r = await db.q('update users set password_hash = $2 where id = $1', [id, await hashPassword(temp)]);
  if (!r.rowCount) throw new ApiError('NOT_FOUND', 'User not found.');
  await db.q('delete from sessions where user_id = $1', [id]);
  return { password: temp };
});

route('POST', '/api/admin/users/:id/admin', 'admin', async (ctx) => {
  const id = int(ctx.params.id, 'id');
  const on = !!ctx.body.isAdmin;
  if (!on && id === ctx.user!.id) throw bad('You cannot remove your own admin rights.');
  await db.q('update users set is_admin = $2 where id = $1', [id, on]);
  return { ok: true };
});

route('POST', '/api/admin/users/:id/release', 'admin', async (ctx) => {
  const id = int(ctx.params.id, 'id');
  await tx(async (t) => leaveClub(t, id));
  return { ok: true };
});

route('DELETE', '/api/admin/users/:id', 'admin', async (ctx) => {
  const id = int(ctx.params.id, 'id');
  if (id === ctx.user!.id) throw bad('You cannot delete yourself.');
  await tx(async (t) => {
    await leaveClub(t, id);
    await t.q('delete from users where id = $1', [id]);
  });
  return { ok: true };
});

route('PUT', '/api/admin/settings', 'admin', async (ctx) => {
  const w = await getWorld();
  if (!w) throw new ApiError('NOT_SETUP', 'No league yet.');
  const patch = sanitizeSettings(ctx.body.settings ?? {});
  // Schedule-shaping settings only apply from the next season; say so rather than silently ignoring.
  const next = { ...w.settings, ...patch };
  await db.q('update world set settings = $1 where id = 1', [JSON.stringify(next)]);
  if (typeof ctx.body.name === 'string' && ctx.body.name.trim()) await db.q('update world set name = $1 where id = 1', [str(ctx.body.name, 'League name', { min: 2, max: 40 })]);
  const scheduleKeys = ['kickoffTime', 'leagueDays', 'europeDay', 'cupDay', 'europe', 'cups', 'deadlineMinutes', 'reminderHours'];
  const deferred = w.state.started && Object.keys(patch).some((k) => scheduleKeys.includes(k));
  return { ok: true, note: deferred ? 'Fixture times and competition changes take effect when the next season is scheduled.' : null };
});

route('PUT', '/api/admin/integrations', 'admin', async (ctx) => {
  const cur = await getIntegrations();
  const b = ctx.body as Record<string, unknown>;
  const next = { ...cur };
  const setStr = (k: 'discordWebhook' | 'telegramBotToken' | 'telegramChatId' | 'appUrl', v: unknown) => {
    if (v === undefined) return;
    if (v === null || v === '') { delete next[k]; return; }
    if (typeof v !== 'string' || v.length > 300) throw bad(`${k} is invalid`);
    next[k] = v.trim();
  };
  setStr('discordWebhook', b.discordWebhook);
  setStr('telegramBotToken', b.telegramBotToken);
  setStr('telegramChatId', b.telegramChatId);
  setStr('appUrl', b.appUrl);
  if (next.discordWebhook && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(next.discordWebhook)) throw bad('That does not look like a Discord webhook URL.');
  await db.q(`insert into app_settings (key, value) values ('integrations', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(next)]);
  return { ok: true };
});

route('POST', '/api/admin/integrations/test', 'admin', async (ctx) => {
  const w = await getWorld();
  postToChannel(`**${w?.name ?? 'Fantasy Football Manager'}** is connected. Results, big transfers and the weekly digest will appear here.`);
  await notifyUser(db, ctx.user!.id, { type: 'system', title: 'Test message sent', body: 'Check your group chat.', link: '/settings/admin' });
  return { ok: true };
});

route('POST', '/api/admin/pause', 'admin', async (ctx) => {
  await db.q('update world set paused = $1 where id = 1', [!!ctx.body.paused]);
  return { paused: !!ctx.body.paused };
});

route('POST', '/api/admin/start-season', 'admin', async () => {
  const w = await getWorld();
  if (!w) throw new ApiError('NOT_SETUP', 'No league yet.');
  if (w.phase !== 'preseason' || w.state.started) throw new ApiError('CONFLICT', 'The season has already started.');
  await tx(async (t) => {
    const cur = (await getWorld(t))!;
    if (cur.state.started) throw new ApiError('CONFLICT', 'The season has already started.');
    await beginSeason(t, cur, new Date());
    await t.q(`update jobs set status = 'done' where type = 'preseason_end' and status = 'pending'`);
  });
  const after = await getWorld();
  return { ok: true, seasonStartAt: after?.state.seasonStartAt ?? null };
});

route('POST', '/api/admin/tick', 'admin', async () => {
  return tick({ budgetMs: 50_000 });
});

route('POST', '/api/admin/jobs/retry', 'admin', async () => {
  const r = await db.q(`update jobs set status = 'pending', attempts = 0, run_at = now() where status = 'failed'`);
  return { retried: r.rowCount ?? 0 };
});

route('POST', '/api/admin/reset-world', 'admin', async (ctx) => {
  if (ctx.body.confirm !== 'RESET') throw bad('Type RESET to confirm.');
  const w = await getWorld();
  if (!w) throw new ApiError('NOT_SETUP', 'No league yet.');
  await tx(async (t) => {
    await t.q(`truncate table preview_runs, match_logs, team_sheets, player_match, honours, transfers, bids, shortlist, scouting, news,
      notifications, decisions, jobs, ledger, seasons, locks, tactics, fixtures, competitions, players, clubs, world restart identity cascade`);
  });
  await createWorld({ name: w.name, timezone: w.timezone, settings: w.settings });
  return { ok: true };
});
