// Season calendar: builds every competition, draws the opening rounds, creates all fixtures that can be
// known up front, and schedules the tick jobs (reminders, deadlines, kick-offs, windows, season end).
import { Rng } from '@ffm/engine';
import { insertMany, type Db } from '../db.ts';
import { addDays, atTime, calDate, calKey, weekday, WEEKDAY_KEYS, type CalDate, HOUR, MINUTE, DAY } from '../lib/time.ts';
import { createFixtures, drawPairs, groupDraw, roundRobin, GROUP_SCHEDULE, type NewFixture } from './competitions.ts';
import { COMP_NAMES, type CompType, type CompetitionData, type WorldRow } from './types.ts';

interface Slot { date: CalDate; comp: CompType; stage: string; round: number; leg: number }

const wdIndex = (k: string) => WEEKDAY_KEYS.indexOf(k as (typeof WEEKDAY_KEYS)[number]);

export interface ClubStrength { id: number; key: string; league: string; country: string; strength: number; reputation: number; lastPos: number | null; europe: string | null }

export async function clubStrengths(d: Db): Promise<ClubStrength[]> {
  return d.many<ClubStrength>(`
    with ranked as (
      select club_id, ca, row_number() over (partition by club_id order by ca desc) rn
      from players where status = 'active' and club_id is not null
    )
    select c.id, c.key, c.league, c.country, c.reputation, (c.meta->>'lastPos')::int as "lastPos", c.meta->>'europe' as europe,
           coalesce(avg(r.ca) filter (where r.rn <= 16), 100)::float as strength
      from clubs c left join ranked r on r.club_id = c.id
     group by c.id`);
}

/** Pick weeks for n events spread across [from, to] fractions of the season, strictly increasing. */
function spread(n: number, totalWeeks: number, from: number, to: number, taken: Set<number> = new Set()): number[] {
  const out: number[] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    let w = Math.round((from + ((to - from) * i) / Math.max(1, n - 1)) * (totalWeeks - 1));
    if (w <= last) w = last + 1;
    while (taken.has(w)) w++;
    out.push(w);
    last = w;
  }
  return out;
}

export async function startSeason(d: Db, world: WorldRow, now: Date): Promise<{ firstKickoff: Date; lastKickoff: Date }> {
  const s = world.settings;
  const tz = world.timezone;
  const seasonNo = world.season_no;
  const rng = new Rng(`${world.secret}:season:${seasonNo}`);
  const leagueWds = s.leagueDays.map(wdIndex).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday-first order
  const europeWd = wdIndex(s.europeDay);
  const cupWd = wdIndex(s.cupDay);

  // First match day: the first league weekday at least 2 days away.
  const today = calDate(now, tz);
  let first = addDays(today, 2);
  for (let i = 0; i < 8 && !leagueWds.includes(weekday(first)); i++) first = addDays(first, 1);
  // Week 0 starts on the Monday on/before the first match day.
  const monday0 = addDays(first, -((weekday(first) + 6) % 7));
  const dayOf = (week: number, wd: number) => addDays(monday0, week * 7 + ((wd + 6) % 7));

  const slots: Slot[] = [];
  // ---- league
  let round = 0;
  let week = 0;
  while (round < 38) {
    for (const wd of leagueWds) {
      const dt = dayOf(week, wd);
      if (calKey(dt) < calKey(first)) continue;
      if (round < 38) slots.push({ date: dt, comp: 'league', stage: `R${round + 1}`, round: round + 1, leg: 1 });
      round++;
    }
    week++;
  }
  const W = week; // weeks containing league rounds
  const finalsWeek = W; // an extra week for finals

  // ---- cups and Europe
  const cupWeeksTaken = new Set<number>();
  if (s.cups) {
    const lc = spread(4, W, 0.08, 0.72, cupWeeksTaken);
    lc.forEach((w) => cupWeeksTaken.add(w));
    ['R1', 'R16', 'QF', 'SF'].forEach((st, i) => slots.push({ date: dayOf(lc[i], cupWd), comp: 'league_cup', stage: st, round: i + 1, leg: 1 }));
    const lcFinal = Math.min(W - 1, Math.max(lc[3] + 2, Math.round(W * 0.85)));
    cupWeeksTaken.add(lcFinal);
    slots.push({ date: dayOf(lcFinal, cupWd), comp: 'league_cup', stage: 'F', round: 5, leg: 1 });
    const fa = spread(4, W, 0.18, 0.92, cupWeeksTaken);
    ['R32', 'R16', 'QF', 'SF'].forEach((st, i) => slots.push({ date: dayOf(fa[i], cupWd), comp: 'fa_cup', stage: st, round: i + 1, leg: 1 }));
    slots.push({ date: dayOf(finalsWeek, 2), comp: 'fa_cup', stage: 'F', round: 5, leg: 1 }); // Tuesday of finals week
  }
  if (s.europe) {
    const ew = spread(12, W, 0.06, 0.97);
    const stages: [string, number, number][] = [
      ['GS1', 1, 1], ['GS2', 2, 1], ['GS3', 3, 1], ['GS4', 4, 1], ['GS5', 5, 1], ['GS6', 6, 1],
      ['R16', 7, 1], ['R16', 7, 2], ['QF', 8, 1], ['QF', 8, 2], ['SF', 9, 1], ['SF', 9, 2],
    ];
    for (const comp of ['ucl', 'uel'] as CompType[]) {
      stages.forEach(([st, r, leg], i) => slots.push({ date: dayOf(ew[i], europeWd), comp, stage: st, round: r, leg }));
    }
    slots.push({ date: dayOf(finalsWeek, europeWd), comp: 'uel', stage: 'F', round: 10, leg: 1 });
    slots.push({ date: dayOf(finalsWeek, 6), comp: 'ucl', stage: 'F', round: 10, leg: 1 }); // Saturday of finals week
  }

  // ---- entrants
  const strengths = await clubStrengths(d);
  const pl = strengths.filter((c) => c.league === 'PL');
  const pool = strengths.filter((c) => c.league === 'EUR');
  const champ = strengths.filter((c) => c.league === 'CHAMP');
  const plIds = pl.map((c) => c.id);
  const kickoff = (c: CalDate) => atTime(c, s.kickoffTime, tz);

  const comps = new Map<CompType, number>();
  const createComp = async (type: CompType, data: CompetitionData) => {
    const r = await d.one<{ id: number }>('insert into competitions (season_no, type, name, data) values ($1, $2, $3, $4) returning id', [seasonNo, type, COMP_NAMES[type], JSON.stringify(data)]);
    comps.set(type, r!.id);
    return r!.id;
  };
  const roundsFor = (type: CompType) => {
    const byStage = new Map<string, { stage: string; dates: string[]; legs: number; neutral?: boolean }>();
    for (const sl of slots.filter((x) => x.comp === type).sort((a, b) => calKey(a.date).localeCompare(calKey(b.date)))) {
      const e = byStage.get(sl.stage) ?? { stage: sl.stage, dates: [], legs: 0 };
      e.dates.push(kickoff(sl.date).toISOString());
      e.legs++;
      byStage.set(sl.stage, e);
    }
    return [...byStage.values()];
  };

  const fixtures: NewFixture[] = [];

  // League
  const leagueId = await createComp('league', { entrants: plIds, rounds: roundsFor('league') });
  const rr = roundRobin(plIds, rng);
  const leagueSlots = slots.filter((x) => x.comp === 'league').sort((a, b) => a.round - b.round);
  rr.forEach((pairs, i) => {
    const sl = leagueSlots[i];
    for (const [h, a] of pairs) fixtures.push({ compId: leagueId, round: i + 1, stage: `R${i + 1}`, home: h, away: a, kickoff: kickoff(sl.date) });
  });

  if (s.cups) {
    // FA Cup: PL + 12 strongest lower-league clubs (with a little noise)
    const lower = champ.map((c) => ({ c, k: c.strength + rng.normal(0, 3) })).sort((a, b) => b.k - a.k).slice(0, 12).map((x) => x.c.id);
    const faEntrants = [...plIds, ...lower];
    const faRounds = roundsFor('fa_cup').map((r) => ({ ...r, neutral: r.stage === 'SF' || r.stage === 'F' }));
    const faId = await createComp('fa_cup', { entrants: faEntrants, rounds: faRounds, currentRound: 0 });
    const faDate = new Date(faRounds[0].dates[0]);
    drawPairs(faEntrants, rng).forEach(([h, a], i) => fixtures.push({ compId: faId, round: 1, stage: 'R32', tieKey: `fa1-${i}`, home: h, away: a, kickoff: faDate }));
    // League Cup: European entrants and last season's top sides get byes
    const seeded = pl.slice().sort((a, b) => (a.europe ? 0 : 1) - (b.europe ? 0 : 1) || (a.lastPos ?? 21) - (b.lastPos ?? 21));
    const byes = seeded.slice(0, 12).map((c) => c.id);
    const r1 = seeded.slice(12).map((c) => c.id);
    const lcRounds = roundsFor('league_cup').map((r) => ({ ...r, neutral: r.stage === 'F' }));
    const lcId = await createComp('league_cup', { entrants: plIds, rounds: lcRounds, byes, currentRound: 0 });
    const lcDate = new Date(lcRounds[0].dates[0]);
    drawPairs(r1, rng).forEach(([h, a], i) => fixtures.push({ compId: lcId, round: 1, stage: 'R1', tieKey: `lc1-${i}`, home: h, away: a, kickoff: lcDate }));
  }

  if (s.europe) {
    const plUcl = pl.filter((c) => c.europe === 'UCL');
    const plUel = pl.filter((c) => c.europe === 'UEL');
    const rankedPool = pool.map((c) => ({ c, k: c.strength + rng.normal(0, 2.5) })).sort((a, b) => b.k - a.k).map((x) => x.c);
    const uclPool = rankedPool.slice(0, 32 - plUcl.length);
    const uelPool = rankedPool.slice(32 - plUcl.length, 32 - plUcl.length + (32 - plUel.length));
    for (const [type, entrants] of [['ucl', [...plUcl, ...uclPool]], ['uel', [...plUel, ...uelPool]]] as [CompType, typeof pl][]) {
      if (entrants.length < 32) continue;
      const ranked = entrants.slice().sort((a, b) => b.strength - a.strength).map((c) => ({ id: c.id, country: c.country }));
      const groups = groupDraw(ranked, rng);
      const rounds = roundsFor(type).map((r) => ({ ...r, neutral: r.stage === 'F' }));
      const id = await createComp(type, { entrants: entrants.map((c) => c.id), rounds, groups, currentRound: 0 });
      for (const [letter, ids] of Object.entries(groups)) {
        GROUP_SCHEDULE.forEach((pairs, md) => {
          const date = new Date(rounds[md].dates[0]);
          for (const [hi, ai] of pairs) fixtures.push({ compId: id, round: md + 1, stage: `GS${md + 1}`, grp: letter, home: ids[hi], away: ids[ai], kickoff: date });
        });
      }
    }
  }

  // Community Shield: last season's champion vs FA Cup winner (or runner-up)
  const shieldDate = addDays(first, -2);
  const shieldKick = kickoff(shieldDate);
  if (shieldKick.getTime() > now.getTime() + 2 * HOUR) {
    const champion = pl.find((c) => c.lastPos === 1);
    const prev = await d.one<{ winner_id: number | null }>(`select winner_id from competitions where season_no = $1 and type = 'fa_cup'`, [seasonNo - 1]);
    let other = prev?.winner_id && prev.winner_id !== champion?.id && plIds.includes(prev.winner_id) ? prev.winner_id : null;
    if (!other && seasonNo === 1) other = pl.find((c) => c.key === 'MCI')?.id ?? null; // 2025-26 FA Cup winners
    if (!other || other === champion?.id) other = pl.find((c) => c.lastPos === 2)?.id ?? null;
    if (champion && other) {
      const id = await createComp('shield', { entrants: [champion.id, other], rounds: [{ stage: 'F', dates: [shieldKick.toISOString()], legs: 1, neutral: true }] });
      fixtures.push({ compId: id, round: 1, stage: 'F', home: champion.id, away: other, kickoff: shieldKick, neutral: true });
      slots.push({ date: shieldDate, comp: 'shield', stage: 'F', round: 1, leg: 1 });
    }
    // UEFA Super Cup from season 2 when an English club is involved
    const uclPrev = await d.one<{ winner_id: number | null }>(`select winner_id from competitions where season_no = $1 and type = 'ucl'`, [seasonNo - 1]);
    const uelPrev = await d.one<{ winner_id: number | null }>(`select winner_id from competitions where season_no = $1 and type = 'uel'`, [seasonNo - 1]);
    if (uclPrev?.winner_id && uelPrev?.winner_id && (plIds.includes(uclPrev.winner_id) || plIds.includes(uelPrev.winner_id))) {
      const scDate = addDays(first, -3);
      const scKick = kickoff(scDate);
      if (scKick.getTime() > now.getTime() + 2 * HOUR) {
        const id = await createComp('super_cup', { entrants: [uclPrev.winner_id, uelPrev.winner_id], rounds: [{ stage: 'F', dates: [scKick.toISOString()], legs: 1, neutral: true }] });
        fixtures.push({ compId: id, round: 1, stage: 'F', home: uclPrev.winner_id, away: uelPrev.winner_id, kickoff: scKick, neutral: true });
        slots.push({ date: scDate, comp: 'super_cup', stage: 'F', round: 1, leg: 1 });
      }
    }
  }

  await createFixtures(d, world, fixtures);

  // ---- jobs for every match slot
  const kickoffs = [...new Set(slots.map((sl) => kickoff(sl.date).toISOString()))].sort();
  const jobRows: unknown[][] = [];
  for (const iso of kickoffs) {
    const k = new Date(iso);
    const rem = new Date(k.getTime() - s.reminderHours * HOUR);
    const lock = new Date(k.getTime() - s.deadlineMinutes * MINUTE);
    if (rem > now) jobRows.push([rem, 'reminder', JSON.stringify({ kickoff: iso }), `reminder:${iso}`]);
    jobRows.push([lock > now ? lock : now, 'lock', JSON.stringify({ kickoff: iso }), `lock:${iso}`]);
    jobRows.push([k, 'match', JSON.stringify({ kickoff: iso }), `match:${iso}`]);
  }
  const firstKick = new Date(kickoffs.find((k) => new Date(k) >= kickoff(first)) ?? kickoffs[0]);
  const lastKick = new Date(kickoffs[kickoffs.length - 1]);
  // Transfer windows: pre-season window closes at the first league deadline; mid-season window after round 19.
  jobRows.push([new Date(firstKick.getTime() - s.deadlineMinutes * MINUTE), 'window_close', JSON.stringify({ kind: 'preseason' }), `window_close:${seasonNo}:pre`]);
  const r19 = leagueSlots[Math.min(18, leagueSlots.length - 1)];
  const midOpen = atTime(addDays(r19.date, 1), s.dailyTime, tz);
  jobRows.push([midOpen, 'window_open', JSON.stringify({ kind: 'midseason' }), `window_open:${seasonNo}:mid`]);
  jobRows.push([new Date(midOpen.getTime() + s.midWindowDays * DAY), 'window_close', JSON.stringify({ kind: 'midseason' }), `window_close:${seasonNo}:mid`]);
  jobRows.push([new Date(lastKick.getTime() + 12 * HOUR), 'season_end', JSON.stringify({ season: seasonNo }), `season_end:${seasonNo}`]);
  await insertMany(d, 'jobs', ['run_at', 'type', 'payload', 'unique_key'], jobRows, 'on conflict (unique_key) do nothing');

  const weeks = W + 1;
  await d.q(
    `update world set phase = 'season', transfer_window = $1,
       state = state || $2::jsonb where id = 1`,
    [
      JSON.stringify({ open: true, kind: 'preseason', closesAt: new Date(firstKick.getTime() - s.deadlineMinutes * MINUTE).toISOString(), opensAt: midOpen.toISOString() }),
      JSON.stringify({ seasonStartAt: firstKick.toISOString(), seasonWeeks: weeks, lastSlotAt: lastKick.toISOString(), started: true, weekNo: 0 }),
    ],
  );
  await d.q('update seasons set started_at = $2 where season_no = $1', [seasonNo, firstKick]);
  return { firstKickoff: firstKick, lastKickoff: lastKick };
}
