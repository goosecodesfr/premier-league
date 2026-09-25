// The always-on clock. An external scheduler (cron-job.org or GitHub Actions) calls the tick endpoint
// every few minutes; each tick runs whatever jobs are due, in order, inside a time budget.
import { randomBytes } from 'node:crypto';
import { db, tx, type Db } from '../db.ts';
import { migrate } from '../migrate.ts';
import { atTime, addDays, calDate, DAY, HOUR, MINUTE } from '../lib/time.ts';
import { getWorld } from '../game/world.ts';
import { runDaily } from '../game/daily.ts';
import { housekeeping, runWeekly } from '../game/weekly.ts';
import { lockSlot, playSlot } from '../game/matchday.ts';
import { progressCompetitions } from '../game/progression.ts';
import { processBids } from '../game/market.ts';
import { endSeason, rollover } from '../game/rollover.ts';
import { ensureWorldData } from '../game/upgrade.ts';
import { beginSeason } from '../game/season.ts';
import { broadcast, notifyClub, withOutbox } from '../game/notify.ts';
import { addNews } from '../game/news.ts';
import type { WorldRow } from '../game/types.ts';

interface Job { id: number; run_at: Date; type: string; payload: Record<string, unknown>; attempts: number; unique_key: string | null }

export interface TickReport {
  ok: boolean;
  skipped?: string;
  ran: { id: number; type: string; ms: number; error?: string }[];
  pending: number;
  nextJobAt: string | null;
}

async function acquire(holder: string, seconds: number): Promise<boolean> {
  const r = await db.one<{ holder: string }>(
    `insert into locks (name, holder, until) values ('tick', $1, now() + ($2 || ' seconds')::interval)
     on conflict (name) do update set holder = excluded.holder, until = excluded.until
       where locks.until < now() or locks.holder = excluded.holder
     returning holder`, [holder, String(seconds)]);
  return r?.holder === holder;
}

async function release(holder: string) {
  await db.q(`update locks set until = now() where name = 'tick' and holder = $1`, [holder]);
}

export async function tick(opts: { now?: Date; budgetMs?: number; maxJobs?: number } = {}): Promise<TickReport> {
  await migrate();
  const started = Date.now();
  const budget = opts.budgetMs ?? 25_000;
  const report: TickReport = { ok: true, ran: [], pending: 0, nextJobAt: null };
  const world0 = await getWorld();
  if (!world0) return { ...report, skipped: 'no world yet' };
  const holder = randomBytes(8).toString('hex');
  if (!(await acquire(holder, Math.ceil(budget / 1000) + 240))) return { ...report, skipped: 'another tick is running' };
  try {
    const now = () => opts.now ?? new Date();
    // New game data (traits, young talents...) for leagues created before an update.
    try {
      const up = await ensureWorldData(db);
      if (up.upgraded) console.log('world data upgraded:', up.notes.join('; '));
    } catch (e) {
      console.error('world data upgrade failed', e);
    }
    if (world0.paused) {
      report.skipped = 'paused';
    } else {
      // Automated bid responses first (cheap)
      await withOutbox(() => tx(async (t) => { await processBids(t, (await getWorld(t))!, now()); })).catch((e) => { console.error('processBids', e); });
      let n = 0;
      while (Date.now() - started < budget && n < (opts.maxJobs ?? 200)) {
        const job = await db.one<Job>(`select * from jobs where status = 'pending' and run_at <= $1 order by run_at, id limit 1`, [now()]);
        if (!job) break;
        n++;
        const t0 = Date.now();
        try {
          await withOutbox(() => runJob(job, now()));
          await db.q(`update jobs set status = 'done', done_at = now(), attempts = attempts + 1 where id = $1`, [job.id]);
          report.ran.push({ id: job.id, type: job.type, ms: Date.now() - t0 });
        } catch (e) {
          const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}`.slice(0, 2000) : String(e);
          console.error(`job ${job.id} ${job.type} failed`, e);
          const attempts = job.attempts + 1;
          await db.q(`update jobs set attempts = $2, last_error = $3, status = $4, run_at = $5 where id = $1`, [
            job.id, attempts, msg, attempts >= 3 ? 'failed' : 'pending', new Date(now().getTime() + 5 * MINUTE),
          ]);
          report.ran.push({ id: job.id, type: job.type, ms: Date.now() - t0, error: msg.split('\n')[0] });
        }
      }
    }
    const pend = await db.one<{ n: number; next: Date | null }>(`select count(*) filter (where run_at <= $1)::int n, min(run_at) filter (where status = 'pending') next from jobs where status = 'pending'`, [now()]);
    report.pending = pend?.n ?? 0;
    report.nextJobAt = pend?.next ? new Date(pend.next).toISOString() : null;
    await db.q(`update world set state = jsonb_set(state, '{lastTickAt}', to_jsonb($1::text)) where id = 1`, [new Date().toISOString()]);
  } finally {
    await release(holder);
  }
  return report;
}

async function scheduleNext(d: Db, world: WorldRow, type: 'daily' | 'weekly', runAt: Date) {
  const tz = world.timezone;
  const s = world.settings;
  const base = calDate(runAt, tz);
  const next = type === 'daily' ? atTime(addDays(base, 1), s.dailyTime, tz) : atTime(addDays(base, 7), s.digestTime, tz);
  await d.q(`insert into jobs (run_at, type, unique_key) values ($1, $2, $3) on conflict (unique_key) do nothing`, [next, type, `${type}:${next.toISOString()}`]);
}

export async function runJob(job: Job, now: Date) {
  const world = await getWorld();
  if (!world) return;
  const kickoff = typeof job.payload?.kickoff === 'string' ? job.payload.kickoff : null;
  switch (job.type) {
    case 'daily':
      await tx(async (t) => {
        await runDaily(t, world, now);
        await scheduleNext(t, world, 'daily', new Date(job.run_at));
      });
      return;
    case 'weekly':
      await tx(async (t) => {
        await runWeekly(t, world, now);
        await housekeeping(t, world, now);
        await scheduleNext(t, world, 'weekly', new Date(job.run_at));
      });
      return;
    case 'reminder': {
      if (!kickoff) return;
      await tx(async (t) => {
        const rows = await t.many<{ id: number; club_id: number; opp: string; comp: string }>(
          `select f.id, c.id club_id, o.short opp, comp.name comp from fixtures f
             join clubs c on (c.id = f.home_id or c.id = f.away_id)
             join clubs o on (o.id = case when c.id = f.home_id then f.away_id else f.home_id end)
             join competitions comp on comp.id = f.competition_id
            where f.kickoff_at = $1 and f.status = 'scheduled' and c.manager_type = 'human'
              and not exists (select 1 from team_sheets ts where ts.fixture_id = f.id and ts.club_id = c.id and ts.submitted_by = 'user')`, [kickoff]);
        for (const r of rows) {
          await notifyClub(t, r.club_id, { type: 'deadline', title: `Set your team vs ${r.opp}`, body: `${r.comp}. Lineups lock in ${world.settings.reminderHours} hours${world.settings.deadlineMinutes ? ` (${world.settings.deadlineMinutes} minutes before kick-off)` : ''}.`, link: `/fixture/${r.id}/preview` });
        }
      });
      return;
    }
    case 'lock':
      if (kickoff) await lockSlot(world, kickoff);
      return;
    case 'match': {
      if (!kickoff) return;
      const { compIds } = await playSlot(world, kickoff);
      await tx(async (t) => {
        const w = (await getWorld(t))!;
        await progressCompetitions(t, w, compIds);
      });
      return;
    }
    case 'window_open':
      await tx(async (t) => {
        const kind = String(job.payload?.kind ?? 'midseason');
        const closes = new Date(now.getTime() + world.settings.midWindowDays * DAY);
        await t.q(`update world set transfer_window = $1 where id = 1`, [JSON.stringify({ open: true, kind, closesAt: closes.toISOString(), opensAt: null })]);
        await t.q(`update players set status = 'free' where id in (select id from players where status = 'reserve' order by random() limit 40)`);
        await addNews(t, world, { type: 'system', headline: 'The mid-season transfer window is open', body: `Clubs have ${world.settings.midWindowDays} days to do business. Yellow card counts have been reset.`, importance: 2 });
        await t.q(`update players set yellows = 0 where status = 'active'`);
        await broadcast(t, { type: 'transfer', title: 'Transfer window open', body: `${world.settings.midWindowDays} days to strengthen your squad.`, link: '/transfers' });
      });
      return;
    case 'window_close':
      await tx(async (t) => {
        const nextOpen = (await t.one<{ run_at: Date }>(`select run_at from jobs where type = 'window_open' and status = 'pending' order by run_at limit 1`))?.run_at ?? null;
        await t.q(`update world set transfer_window = $1 where id = 1`, [JSON.stringify({ open: false, kind: null, closesAt: null, opensAt: nextOpen ? new Date(nextOpen).toISOString() : null })]);
        await t.q(`update bids set status = 'expired', updated_at = now() where status in ('pending','countered') and to_club is not null`);
        await addNews(t, world, { type: 'system', headline: 'The transfer window has closed', body: 'Free agents can still be signed at any time.', importance: 2 });
        await broadcast(t, { type: 'transfer', title: 'Transfer window closed', body: 'Only free agents can be signed until the next window.', link: '/transfers', channel: false });
      });
      return;
    case 'season_end': {
      const done = await tx(async (t) => endSeason(t, world, now));
      if (!done) await db.q(`insert into jobs (run_at, type, payload, unique_key) values ($1, 'season_end', $2, $3) on conflict (unique_key) do nothing`, [new Date(now.getTime() + HOUR), JSON.stringify(job.payload), `season_end:${world.season_no}:${now.getTime()}`]);
      return;
    }
    case 'rollover':
      if (world.phase !== 'postseason') return;
      await tx(async (t) => rollover(t, world, now));
      return;
    case 'preseason_end':
      if (world.phase !== 'preseason' || world.state.started) return;
      await tx(async (t) => beginSeason(t, (await getWorld(t))!, now));
      return;
    default:
      console.warn('unknown job type', job.type);
  }
}

/** Run everything due up to `until` in simulated time (used by tests and the admin fast-forward). */
export async function fastForward(until: Date, step = 15 * MINUTE): Promise<number> {
  let ran = 0;
  for (;;) {
    const next = await db.one<{ run_at: Date }>(`select run_at from jobs where status = 'pending' order by run_at limit 1`);
    if (!next || new Date(next.run_at) > until) break;
    const at = new Date(Math.max(new Date(next.run_at).getTime(), 0));
    const r = await tick({ now: at, budgetMs: 600_000 });
    ran += r.ran.length;
    if (!r.ran.length) break;
    void step;
  }
  return ran;
}
