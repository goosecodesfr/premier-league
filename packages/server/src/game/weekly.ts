// Weekly tick: wages and income, player development, the Monday digest, bot manager reviews and sackings,
// contract warnings and squad morale.
import { Rng, developWeek, attrsFromArray, attrsToArray, hiddenFromArray, type Archetype as _A } from '@ffm/engine';
import { db, type Db } from '../db.ts';
import { acumenFor, newManager, ARCHETYPES, ARCHETYPE_INFO, archetypeTactics, botQuote } from './archetypes.ts';
import { leagueStandings } from './competitions.ts';
import { weeklyWagesAndIncome } from './finance.ts';
import { addNews } from './news.ts';
import { broadcast, notifyClub } from './notify.ts';
import { valueOf } from './players.ts';
import type { Archetype, ClubRow, PlayerRow, WorldRow } from './types.ts';
import { fmtM } from './market.ts';

export async function runWeekly(d: Db, world: WorldRow, now: Date) {
  if (world.phase === 'season') await weeklyWagesAndIncome(d, world);
  await developPlayers(d, world, now);
  if (world.phase === 'season') {
    await botReviews(d, world, now);
    await contractWarnings(d, world);
  }
  await digest(d, world, now);
  await d.q(`update world set state = jsonb_set(state, '{weekNo}', to_jsonb(coalesce((state->>'weekNo')::int, 0) + 1)) where id = 1`);
}

// ---------------------------------------------------------------- development
async function developPlayers(d: Db, world: WorldRow, now: Date) {
  const rng = new Rng(`${world.secret}:dev:${now.toISOString().slice(0, 10)}`);
  const clubs = new Map((await d.many<ClubRow>('select * from clubs')).map((c) => [c.id, c]));
  // minutes over the last 4 weeks drive growth
  const mins = new Map((await d.many<{ player_id: number; m: number }>(
    `select pm.player_id, sum(pm.minutes)::int m from player_match pm join fixtures f on f.id = pm.fixture_id where f.kickoff_at > $1::timestamptz - interval '28 days' group by pm.player_id`, [now])).map((r) => [r.player_id, r.m]));
  const players = await d.many<PlayerRow>(`select id, club_id, age, positions, attrs, hidden, ca, pa, flags from players where status = 'active'`);
  const ids: number[] = [];
  const attrsOut: string[] = [];
  const cas: number[] = [];
  for (const p of players) {
    const c = p.club_id ? clubs.get(p.club_id) : undefined;
    const h = hiddenFromArray(p.hidden);
    const coach = c?.staff.coach?.rating ?? 10;
    const tier = c?.facilities.training ?? 2;
    const inten = c?.training.intensity === 'high' ? 1.15 : c?.training.intensity === 'low' ? 0.88 : 1;
    const youthTier = p.age <= 20 ? 1 + ((c?.facilities.youth ?? 2) - 3) * 0.05 : 1;
    const trainingMult = (0.85 + tier * 0.05) * (1 + (coach - 10) * 0.02) * inten * youthTier;
    const m = mins.get(p.id) ?? 0;
    const minutesFactor = Math.min(1.2, m / 360 + (p.age <= 19 ? 0.35 : 0.1));
    const focus = c?.training.individual?.find((x) => x.playerId === p.id)?.group ?? null;
    const isGk = (p.positions.GK ?? 0) >= 0.8;
    const res = developWeek({ attrs: attrsFromArray(p.attrs), fam: p.positions, ca: p.ca, pa: p.pa, age: p.age, professionalism: h.professionalism, minutesFactor, trainingMult, focusGroup: focus, isGk }, rng);
    if (res.delta === 0 && res.ca === p.ca) continue;
    ids.push(p.id);
    attrsOut.push(`{${attrsToArray(res.attrs).join(',')}}`);
    cas.push(res.ca);
  }
  for (let i = 0; i < ids.length; i += 500) {
    await d.q(
      `update players p set attrs = v.attrs::smallint[], ca = v.ca from (select unnest($1::int[]) id, unnest($2::text[]) attrs, unnest($3::int[]) ca) v where p.id = v.id`,
      [ids.slice(i, i + 500), attrsOut.slice(i, i + 500), cas.slice(i, i + 500)],
    );
  }
  // refresh market values weekly
  const vals = await d.many<PlayerRow>(`select id, ca, pa, age, contract_until, form, positions from players where status in ('active','free')`);
  const vIds: number[] = [];
  const vVals: number[] = [];
  for (const p of vals) { vIds.push(p.id); vVals.push(valueOf(p, world.season_no)); }
  for (let i = 0; i < vIds.length; i += 1000) {
    await d.q(`update players p set value = v.value from (select unnest($1::int[]) id, unnest($2::bigint[]) value) v where p.id = v.id`, [vIds.slice(i, i + 1000), vVals.slice(i, i + 1000)]);
  }
}

// ---------------------------------------------------------------- bot reviews
async function botReviews(d: Db, world: WorldRow, now: Date) {
  const table = await leagueStandings(d, world.season_no);
  if (!table.length || table[0].p < 6) return;
  const clubs = await d.many<ClubRow>(`select * from clubs where league = 'PL' and manager_type = 'bot'`);
  const rng = new Rng(`${world.secret}:reviews:${now.toISOString().slice(0, 10)}`);
  for (const c of clubs) {
    const pos = table.findIndex((r) => r.clubId === c.id) + 1;
    const exp = c.meta?.expectation ?? 10;
    const row = table[pos - 1];
    const recent = row?.form ?? [];
    const losses = recent.filter((f) => f === 'L').length;
    let pressure = c.bot.pressure ?? 20;
    pressure += (pos - exp) * 2.2 + (losses >= 4 ? 12 : losses >= 3 ? 6 : 0) - (recent.filter((f) => f === 'W').length >= 3 ? 8 : 0);
    pressure = Math.max(0, Math.min(100, pressure * 0.85));
    if (pressure >= 70 && pos >= exp + 5 && table[0].p >= 10 && rng.chance(0.45)) {
      await sackManager(d, world, c, pos, rng);
      continue;
    }
    await d.q(`update clubs set bot = jsonb_set(bot, '{pressure}', to_jsonb($2::float)) where id = $1`, [c.id, pressure]);
    if (pressure >= 55 && rng.chance(0.3)) {
      await addNews(d, world, { type: 'manager', clubIds: [c.id], headline: `Pressure mounts on ${c.short} boss ${c.bot.name}`, body: `${c.short} sit ${ordinal(pos)} and the natives are restless.`, importance: 1 });
    }
  }
}

async function sackManager(d: Db, world: WorldRow, c: ClubRow, pos: number, rng: Rng) {
  const options = ARCHETYPES.filter((a) => a !== c.bot.archetype);
  const archetype = rng.pick(options) as Archetype;
  const acumen = acumenFor(world.settings.difficulty, c.reputation, rng);
  const mgr = newManager(rng, c.country, archetype, acumen, world.season_no);
  await d.q('update clubs set bot = $2 where id = $1', [c.id, JSON.stringify(mgr)]);
  // New manager brings his ideas: new default tactics
  await d.q('delete from tactics where club_id = $1', [c.id]);
  const tacs = archetypeTactics(archetype).slice(0, 3);
  for (const [i, t] of tacs.entries()) {
    await d.q('insert into tactics (club_id, name, data, lineup, bench, familiarity, is_default) values ($1,$2,$3,$4,$5,$6,$7)', [c.id, t.name, JSON.stringify(t), '[]', '[]', i === 0 ? 0.55 : 0.4, i === 0]);
  }
  await addNews(d, world, {
    type: 'sacking', clubIds: [c.id], importance: 3,
    headline: `${c.short} sack ${c.bot.name}`,
    body: `With ${c.short} ${ordinal(pos)}, the board has acted. ${mgr.name} (${mgr.nat}) takes over and is known as ${ARCHETYPE_INFO[archetype].label.toLowerCase()}: ${ARCHETYPE_INFO[archetype].desc.toLowerCase()}`,
  });
  await broadcast(d, { type: 'news', title: `${c.short} sack their manager`, body: `${mgr.name} is the new ${c.short} boss.`, link: `/club/${c.id}`, channel: true });
}

// ---------------------------------------------------------------- contracts
async function contractWarnings(d: Db, world: WorldRow) {
  const rows = await d.many<{ id: number; name: string; club_id: number; flags: Record<string, unknown> }>(
    `select p.id, p.name, p.club_id, p.flags from players p join clubs c on c.id = p.club_id
      where c.manager_type = 'human' and p.status = 'active' and p.contract_until <= $1 and not (p.flags ? 'renewalAsked')`, [world.season_no]);
  for (const r of rows) {
    await d.q(`update players set flags = flags || '{"renewalAsked": true}' where id = $1`, [r.id]);
    await notifyClub(d, r.club_id, { type: 'contract', title: `Contract: ${r.name}`, body: 'His deal expires at the end of the season. Offer a renewal or he leaves for free.', link: `/player/${r.id}` });
  }
}

// ---------------------------------------------------------------- digest
async function digest(d: Db, world: WorldRow, now: Date) {
  const since = new Date(now.getTime() - 7 * 86400000);
  const results = await d.many<{ id: number; home: string; away: string; hg: number; ag: number; comp: string; hid: number; aid: number; hrep: number; arep: number }>(
    `select f.id, h.short home, a.short away, f.home_goals hg, f.away_goals ag, c.type comp, h.id hid, a.id aid, h.reputation hrep, a.reputation arep
       from fixtures f join clubs h on h.id = f.home_id join clubs a on a.id = f.away_id join competitions c on c.id = f.competition_id
      where f.status = 'played' and f.kickoff_at >= $1 and (h.league = 'PL' or a.league = 'PL') order by f.kickoff_at`, [since]);
  const transfers = await d.many<{ player_name: string; fee: number; to_short: string | null; from_short: string | null }>(
    `select t.player_name, t.fee, tc.short to_short, fc.short from_short from transfers t left join clubs tc on tc.id = t.to_club left join clubs fc on fc.id = t.from_club
      where t.created_at >= $1 and t.kind in ('transfer','free') order by t.fee desc limit 5`, [since]);
  if (!results.length && !transfers.length) return;
  const table = await leagueStandings(d, world.season_no);
  const names = new Map((await d.many<{ id: number; short: string; manager_type: string; bot: { name: string; archetype: Archetype } }>('select id, short, manager_type, bot from clubs')).map((c) => [c.id, c]));
  const lines: string[] = [];
  // Headline story: biggest upset or biggest win
  let headline = 'The week in review';
  const upset = results.filter((r) => r.comp === 'league').map((r) => ({ r, gap: r.hg > r.ag ? r.arep - r.hrep : r.ag > r.hg ? r.hrep - r.arep : 0 })).sort((a, b) => b.gap - a.gap)[0];
  if (upset && upset.gap >= 12) {
    const w = upset.r.hg > upset.r.ag ? upset.r.home : upset.r.away;
    const l = upset.r.hg > upset.r.ag ? upset.r.away : upset.r.home;
    headline = `Upset of the week: ${w} stun ${l}`;
  } else if (results.length) {
    const big = results.slice().sort((a, b) => Math.abs(b.hg - b.ag) - Math.abs(a.hg - a.ag))[0];
    headline = `${big.hg > big.ag ? big.home : big.away} lead the way after a ${Math.max(big.hg, big.ag)}-${Math.min(big.hg, big.ag)} win`;
  }
  if (results.length) lines.push('Results: ' + results.filter((r) => r.comp === 'league').slice(-10).map((r) => `${r.home} ${r.hg}-${r.ag} ${r.away}`).join(', '));
  if (table.length && table[0].p > 0) lines.push('Top four: ' + table.slice(0, 4).map((r, i) => `${i + 1}. ${names.get(r.clubId)?.short} ${r.pts}`).join(' · '));
  if (transfers.length) lines.push('Deals: ' + transfers.map((t) => `${t.player_name} to ${t.to_short}${t.fee ? ` (£${fmtM(t.fee)})` : ' (free)'}`).join(', '));
  const rng = new Rng(`${world.secret}:digest:${now.toISOString().slice(0, 10)}`);
  const bots = [...names.values()].filter((c) => c.manager_type === 'bot');
  if (bots.length && results.length) {
    const b = rng.pick(bots);
    lines.push(`${b.bot.name} (${b.short}): "${botQuote(b.bot.archetype, rng.pick(['win', 'draw', 'loss'] as const), rng)}"`);
  }
  await addNews(d, world, { type: 'digest', headline, body: lines.join('\n'), importance: 3, payload: { week: (world.state.weekNo ?? 0) + 1 } });
  await broadcast(d, { type: 'digest', title: `Weekly digest: ${headline}`, body: lines.slice(0, 2).join(' '), link: '/media', channelText: `**Weekly digest: ${headline}**\n${lines.join('\n')}` });
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

void db;
void ({} as _A);

/**
 * Keep the database small enough for a free tier: drop finished jobs, expired sessions,
 * old notifications and the ball-by-ball logs of matches from earlier seasons
 * (reports, stats and ratings are kept forever).
 */
export async function housekeeping(d: Db, world: WorldRow, now: Date) {
  await d.q(`delete from jobs where status = 'done' and done_at < $1::timestamptz - interval '45 days'`, [now]);
  await d.q(`delete from sessions where expires_at < $1`, [now]);
  await d.q(`delete from notifications where created_at < $1::timestamptz - interval '90 days'`, [now]);
  await d.q(`delete from rate_events where at < $1::timestamptz - interval '1 day'`, [now]);
  await d.q(`delete from match_logs where fixture_id in (select id from fixtures where season_no < $1)`, [world.season_no - 1]);
}
