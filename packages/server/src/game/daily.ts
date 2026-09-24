// Daily tick: recovery, injury countdown, fatigue, training familiarity, scouting, facility builds,
// events, bot market activity, inactivity handling.
import { Rng } from '@ffm/engine';
import type { Db } from '../db.ts';
import { addNews } from './news.ts';
import { notifyClub } from './notify.ts';
import { dailyEvents } from './events.ts';
import { botMarketDay } from './market.ts';
import type { WorldRow } from './types.ts';

export async function runDaily(d: Db, world: WorldRow, now: Date) {
  // ---- recovery and conditioning (bulk SQL)
  await d.q(`
    update players p set
      condition = least(100, p.condition + (8 + (p.attrs[39] / 10.0) * 0.6)
        * (1 + (coalesce((c.staff->'fitness'->>'rating')::int, 10) - 10) * 0.015)
        * (case c.training->>'intensity' when 'high' then 0.82 when 'low' then 1.12 else 1 end)
        * (case when c.training->>'focus' = 'recovery' then 1.15 when c.training->>'focus' = 'fitness' then 0.95 else 1 end)
        * (case when p.age >= 32 then 0.9 else 1 end)),
      fatigue_debt = greatest(0, p.fatigue_debt - (3.5 + (coalesce((c.staff->'fitness'->>'rating')::int, 10)) * 0.08)),
      sharpness = greatest(35, p.sharpness - (case when c.training->>'focus' = 'fitness' then 0.6 else 1.0 end)),
      morale = p.morale + (1 - p.morale) * 0.02
    from clubs c
    where p.club_id = c.id and p.status = 'active'`);
  await d.q(`update players set condition = least(100, condition + 20), sharpness = greatest(30, sharpness - 1) where status in ('free','reserve')`);

  // ---- injuries count down; notify returns
  const back = await d.many<{ id: number; name: string; club_id: number }>(`select id, name, club_id from players where injury is not null and (injury->>'daysLeft')::int <= 1 and status = 'active'`);
  await d.q(`update players set injury = null, sharpness = least(sharpness, 55), condition = least(condition, 85) where injury is not null and (injury->>'daysLeft')::int <= 1`);
  await d.q(`update players set injury = jsonb_set(injury, '{daysLeft}', to_jsonb((injury->>'daysLeft')::int - 1)) where injury is not null`);
  for (const p of back) {
    if (p.club_id) await notifyClub(d, p.club_id, { type: 'injury', title: `${p.name} is back in training`, body: 'Sharpness is low, so ease him back in.', link: `/player/${p.id}`, push: false });
  }

  // ---- tactical familiarity: default shapes grow with training, unused ones fade
  await d.q(`
    update tactics t set familiarity = least(1, t.familiarity + (case when c.training->>'focus' = 'tactical' then 0.025 else 0.008 end))
    from clubs c where c.id = t.club_id and t.is_default`);
  await d.q(`update tactics set familiarity = greatest(0.3, familiarity - 0.004) where not is_default and updated_at < now() - interval '7 days'`);

  // ---- scouting assignments progress
  await d.q(`
    update scouting s set knowledge = least(100, s.knowledge + 6 + coalesce((c.staff->'scout'->>'rating')::int, 8) * 0.9), updated_at = now()
    from clubs c where c.id = s.club_id and s.assigned`);
  const done = await d.many<{ club_id: number; player_id: number; name: string }>(
    `select s.club_id, s.player_id, p.name from scouting s join players p on p.id = s.player_id where s.assigned and s.knowledge >= 100`);
  for (const r of done) {
    await d.q('update scouting set assigned = false where club_id = $1 and player_id = $2', [r.club_id, r.player_id]);
    await notifyClub(d, r.club_id, { type: 'system', title: `Scout report ready: ${r.name}`, body: 'Your chief scout has filed his full assessment.', link: `/player/${r.player_id}` });
  }

  // ---- facility builds
  const builds = await d.many<{ id: number; facilities: { building?: { kind: string; toLevel: number; completesAt: string; seats?: number } } }>(`select id, facilities from clubs where facilities->'building' is not null and facilities->'building' <> 'null'::jsonb`);
  for (const c of builds) {
    const b = c.facilities.building;
    if (!b || new Date(b.completesAt) > now) continue;
    if (b.kind === 'stadium') {
      await d.q(`update clubs set capacity = capacity + $2, facilities = jsonb_set(facilities, '{building}', 'null') where id = $1`, [c.id, b.seats ?? 0]);
      await notifyClub(d, c.id, { type: 'system', title: 'Stadium expansion complete', body: `${(b.seats ?? 0).toLocaleString('en-GB')} new seats are open.`, link: '/club/facilities' });
    } else {
      await d.q(`update clubs set facilities = jsonb_set(jsonb_set(facilities, $2::text[], to_jsonb($3::int)), '{building}', 'null') where id = $1`, [c.id, `{${b.kind}}`, b.toLevel]);
      await notifyClub(d, c.id, { type: 'system', title: `${b.kind === 'training' ? 'Training ground' : b.kind === 'youth' ? 'Youth academy' : 'Medical centre'} upgraded`, body: `Now tier ${b.toLevel}.`, link: '/club/facilities' });
    }
  }

  // ---- promises: broken promises of minutes make players want out
  const promises = await d.many<{ id: number; name: string; club_id: number; flags: { promiseAt?: string } }>(`select id, name, club_id, flags from players where flags ? 'promiseAt' and status = 'active'`);
  for (const p of promises) {
    const since = p.flags.promiseAt ? new Date(p.flags.promiseAt) : now;
    if (now.getTime() - since.getTime() < 21 * 86400000) continue;
    const mins = await d.one<{ m: number }>(`select coalesce(sum(minutes), 0)::int m from player_match pm join fixtures f on f.id = pm.fixture_id where pm.player_id = $1 and f.kickoff_at >= $2`, [p.id, since]);
    if ((mins?.m ?? 0) < 250) {
      await d.q(`update players set morale = greatest(0.9, morale - 0.06), flags = (flags - 'promiseAt') || '{"wantsOut": true}' where id = $1`, [p.id]);
      await notifyClub(d, p.club_id, { type: 'event', title: `${p.name} feels let down`, body: 'You promised him minutes. He now wants to leave.', link: `/player/${p.id}` });
    } else {
      await d.q(`update players set flags = flags - 'promiseAt' where id = $1`, [p.id]);
    }
  }

  // ---- inactive humans: after 7 missed deadlines the assistant takes over completely (reversible)
  const inactive = await d.many<{ id: number; short: string; user_id: number }>(`select id, short, user_id from clubs where manager_type = 'human' and coalesce((meta->>'missedDeadlines')::int, 0) >= 7 and coalesce((meta->>'botTakeover')::boolean, false) = false`);
  for (const c of inactive) {
    await d.q(`update clubs set meta = meta || '{"botTakeover": true}' where id = $1`, [c.id]);
    await notifyClub(d, c.id, { type: 'system', title: 'Your assistant has taken charge', body: 'You missed seven deadlines, so the bot will run the club until you reclaim it from the Club tab.', link: '/club' });
  }
  const nudge = await d.many<{ id: number }>(`select id from clubs where manager_type = 'human' and coalesce((meta->>'missedDeadlines')::int, 0) = 3`);
  for (const c of nudge) await notifyClub(d, c.id, { type: 'deadline', title: 'We miss you, boss', body: 'Your assistant has picked the last three teams. Pop in and set the next one?', link: '/' });

  // ---- events and the market
  await dailyEvents(d, world, now);
  const intensity = world.transfer_window?.open ? (world.transfer_window.kind === 'preseason' ? 1.3 : 1) : 0.3;
  await botMarketDay(d, world, now, intensity);

  // ---- pool clubs' form wanders (strength trajectory)
  const rng = new Rng(`${world.secret}:form:${now.toISOString().slice(0, 10)}`);
  await d.q(`update clubs set meta = jsonb_set(meta, '{form}', to_jsonb(greatest(-1, least(1, coalesce((meta->>'form')::float, 0) * 0.9 + ($1::float * (random() - 0.5)))))) where league <> 'PL'`, [0.3 + rng.next() * 0.01]);
  void addNews;
}
