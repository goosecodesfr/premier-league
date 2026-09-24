// End-to-end season simulation against a real Postgres, driven by the job runner with a simulated clock.
// Usage: DATABASE_URL=postgres://... npx tsx scripts/sim-season.ts [days]
import { db, closeDb } from '../packages/server/src/db.ts';
import { migrate, resetMigratedFlag } from '../packages/server/src/migrate.ts';
import { createWorld, getWorld } from '../packages/server/src/game/world.ts';
import { beginSeason, pickClub } from '../packages/server/src/game/season.ts';
import { tick } from '../packages/server/src/jobs/runner.ts';
import { tx } from '../packages/server/src/db.ts';
import { hashPassword } from '../packages/server/src/lib/auth.ts';
import { placeBid } from '../packages/server/src/game/market.ts';
import type { ClubRow } from '../packages/server/src/game/types.ts';

const days = Number(process.argv[2] ?? 170);
const t0 = Date.now();
await db.q('drop schema public cascade; create schema public;');
resetMigratedFlag();
await migrate();
let now = new Date('2026-09-24T08:00:00Z');
await createWorld({ name: 'Test League', timezone: 'Europe/Amsterdam', now });
console.log(`world created in ${Date.now() - t0} ms`);
// A human manager at Everton
const u = await db.one<{ id: number }>(`insert into users (username, display_name, password_hash, is_admin) values ('alice', 'Alice', $1, true) returning id`, [await hashPassword('secret123')]);
const eve = await db.one<{ id: number }>(`select id from clubs where key = 'EVE'`);
await tx(async (t) => pickClub(t, (await getWorld(t))!, u!.id, eve!.id));
// A human bid during pre-season
await tx(async (t) => {
  const w = (await getWorld(t))!;
  const club = (await t.one<ClubRow>('select * from clubs where id = $1', [eve!.id]))!;
  const target = await t.one<{ id: number; value: number; wage: number }>(`select id, value, wage from players where club_id = (select id from clubs where key = 'BRE') order by ca desc limit 1`);
  await placeBid(t, w, club, target!.id, { fee: Math.round(target!.value * 1.3), wage: Math.round(target!.wage * 1.3), years: 4, by: 'user', now });
});
// Let pre-season run for 3 days (bots trade), then start
const tickUntil = async (until: Date) => {
  let jobs = 0;
  let errors = 0;
  for (;;) {
    const next = await db.one<{ run_at: Date }>(`select run_at from jobs where status = 'pending' order by run_at limit 1`);
    const nextAt = next ? new Date(next.run_at) : null;
    // also tick every 15 minutes of sim time so bid responses get processed
    const step = new Date(now.getTime() + 15 * 60_000);
    const at = nextAt && nextAt < step ? nextAt : step;
    if (at > until) break;
    now = at;
    const r = await tick({ now, budgetMs: 600_000 });
    jobs += r.ran.length;
    for (const j of r.ran) if (j.error) { errors++; console.log('JOB ERROR', j.type, j.error); }
  }
  now = until;
  return { jobs, errors };
};
let r = await tickUntil(new Date(now.getTime() + 3 * 86400_000));
console.log(`pre-season: ${r.jobs} jobs, ${r.errors} errors, ${Date.now() - t0} ms`);
await tx(async (t) => beginSeason(t, (await getWorld(t))!, now));
console.log(`season started; fixtures: ${(await db.one<{ n: number }>('select count(*)::int n from fixtures'))!.n}`);
const end = new Date(now.getTime() + days * 86400_000);
r = await tickUntil(end);
console.log(`season sim: ${r.jobs} jobs, ${r.errors} errors, ${((Date.now() - t0) / 1000).toFixed(1)} s total`);
const w = (await getWorld())!;
console.log('world phase', w.phase, 'season', w.season_no, w.season_label);
const summary = await db.many<{ type: string; status: string; n: number }>(`select c.type, f.status, count(*)::int n from fixtures f join competitions c on c.id = f.competition_id group by 1,2 order by 1,2`);
console.table(summary);
const comps = await db.many(`select c.season_no, c.type, c.status, w.short winner, r.short runner_up from competitions c left join clubs w on w.id = c.winner_id left join clubs r on r.id = c.runner_up_id order by c.season_no, c.type`);
console.table(comps);
const failed = await db.many(`select type, last_error from jobs where status = 'failed'`);
if (failed.length) console.log('FAILED JOBS', failed);
const stats = await db.one(`select (select count(*) from transfers)::int transfers, (select count(*) from bids)::int bids, (select count(*) from news)::int news,
  (select count(*) from notifications)::int notifications, (select count(*) from player_match)::int apps,
  (select count(*) from players where injury is not null)::int injured_now, (select count(*) from decisions)::int decisions`);
console.log(stats);
const season1 = await db.one<{ summary: unknown }>('select summary from seasons where season_no = 1');
console.log(JSON.stringify(season1?.summary)?.slice(0, 1500));
const money = await db.many(`select short, league, balance/1000000 as bal_m, manager_type from clubs where league = 'PL' order by balance desc`);
console.table(money);
await closeDb();
