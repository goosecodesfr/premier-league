// Season end (honours, awards, qualification, reshuffle) and rollover into the next pre-season
// (ageing, contracts, retirements, youth intake, free-agent refresh, budgets).
import { Rng, generatePlayer, rollYouthPotential, attrsToArray, hiddenToArray, randomName, wageDemand, type Pos } from '@ffm/engine';
import { insertMany, type Db } from '../db.ts';
import { DAY, HOUR } from '../lib/time.ts';
import { clubStrengths } from './calendar.ts';
import { leagueStandings } from './competitions.ts';
import { addLedger, meritPayment } from './finance.ts';
import { addNews } from './news.ts';
import { broadcast, notifyClub } from './notify.ts';
import { namePools } from './seed.ts';
import { valueOf, loadPlayers } from './players.ts';
import { seasonLabel } from './world.ts';
import { makeSponsorOffers } from './sponsors.ts';
import type { ClubRow, PlayerRow, WorldRow } from './types.ts';
import { settleVision } from './vision.ts';

export async function endSeason(d: Db, world: WorldRow, now: Date): Promise<boolean> {
  const unplayed = await d.one<{ n: number }>(`select count(*)::int n from fixtures where season_no = $1 and status <> 'played'`, [world.season_no]);
  if ((unplayed?.n ?? 0) > 0) return false;
  const table = await leagueStandings(d, world.season_no);
  const clubs = new Map((await d.many<ClubRow>('select * from clubs')).map((c) => [c.id, c]));
  const league = await d.one<{ id: number }>(`select id from competitions where season_no = $1 and type = 'league'`, [world.season_no]);
  const champion = table[0];
  if (league && champion) {
    await d.q(`update competitions set status = 'done', winner_id = $2, runner_up_id = $3 where id = $1`, [league.id, champion.clubId, table[1]?.clubId ?? null]);
    await d.q(`insert into honours (club_id, season_no, comp_type, name, place) values ($1, $2, 'league', 'Premier League', 'winner'), ($3, $2, 'league', 'Premier League', 'runner_up')`, [champion.clubId, world.season_no, table[1]?.clubId]);
  }
  // Merit payments by final position
  for (const [i, r] of table.entries()) await addLedger(d, r.clubId, world.season_no, 'merit', meritPayment(i + 1), `Final position: ${i + 1}`);

  // ---- awards
  const topScorer = await d.one<{ player_id: number; name: string; club: string; goals: number }>(
    `select pm.player_id, p.name, c.short club, sum(pm.goals)::int goals from player_match pm join players p on p.id = pm.player_id join clubs c on c.id = pm.club_id
      where pm.season_no = $1 and pm.comp_type = 'league' group by pm.player_id, p.name, c.short order by goals desc, sum(pm.minutes) asc limit 1`, [world.season_no]);
  const bestPlayer = await d.one<{ player_id: number; name: string; club: string; avg: number }>(
    `select pm.player_id, p.name, c.short club, avg(pm.rating)::float avg from player_match pm join players p on p.id = pm.player_id join clubs c on c.id = pm.club_id
      where pm.season_no = $1 and pm.comp_type = 'league' group by pm.player_id, p.name, c.short having count(*) >= 20 order by avg desc limit 1`, [world.season_no]);
  const young = await d.one<{ player_id: number; name: string; club: string; avg: number }>(
    `select pm.player_id, p.name, c.short club, avg(pm.rating)::float avg from player_match pm join players p on p.id = pm.player_id join clubs c on c.id = pm.club_id
      where pm.season_no = $1 and pm.comp_type = 'league' and p.age <= 21 group by pm.player_id, p.name, c.short having count(*) >= 12 order by avg desc limit 1`, [world.season_no]);
  const glove = await d.one<{ player_id: number; name: string; club: string; cs: number }>(
    `select pm.player_id, p.name, c.short club, count(*) filter (where pm.clean_sheet)::int cs from player_match pm join players p on p.id = pm.player_id join clubs c on c.id = pm.club_id
      where pm.season_no = $1 and pm.comp_type = 'league' and (p.positions->>'GK')::float >= 0.8 group by pm.player_id, p.name, c.short order by cs desc limit 1`, [world.season_no]);
  const overachiever = table.map((r, i) => ({ r, pos: i + 1, c: clubs.get(r.clubId)! })).map((x) => ({ ...x, delta: (x.c.meta?.expectation ?? 10) - x.pos })).sort((a, b) => b.delta - a.delta)[0];
  const cups = await d.many<{ type: string; winner_id: number | null; name: string }>(`select type, winner_id, name from competitions where season_no = $1 and type <> 'league'`, [world.season_no]);
  const summary = {
    champion: champion ? { id: champion.clubId, name: clubs.get(champion.clubId)?.name, pts: champion.pts } : null,
    table: table.map((r, i) => ({ pos: i + 1, clubId: r.clubId, short: clubs.get(r.clubId)?.short, p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, pts: r.pts })),
    awards: { topScorer, bestPlayer, young, glove, manager: overachiever ? { clubId: overachiever.c.id, club: overachiever.c.short, name: overachiever.c.manager_type === 'human' ? 'human' : overachiever.c.bot.name, pos: overachiever.pos } : null },
    cups: cups.map((c) => ({ type: c.type, name: c.name, winner: c.winner_id ? clubs.get(c.winner_id)?.short : null, winnerId: c.winner_id })),
  };
  // ---- vision verdicts (stored with the season so the review can show them after rollover)
  const visions: Record<number, { label: string; done: boolean | null | undefined; status: string }[]> = {};
  for (const c of clubs.values()) {
    if (c.manager_type !== 'human' || !c.vision?.length) continue;
    const res = await settleVision(d, world, c);
    visions[c.id] = res.map((g) => ({ label: g.label, done: g.done, status: g.status }));
  }
  await d.q('update seasons set ended_at = $2, summary = $3 where season_no = $1', [world.season_no, now, JSON.stringify({ ...summary, visions })]);

  // ---- qualification for next season
  const plTable = table.map((r) => r.clubId);
  const europe = new Map<number, 'UCL' | 'UEL'>();
  plTable.slice(0, 4).forEach((id) => europe.set(id, 'UCL'));
  const uclW = cups.find((c) => c.type === 'ucl')?.winner_id;
  const uelW = cups.find((c) => c.type === 'uel')?.winner_id;
  for (const w of [uclW, uelW]) if (w && plTable.includes(w)) europe.set(w, 'UCL');
  const uelQueue = [cups.find((c) => c.type === 'fa_cup')?.winner_id, cups.find((c) => c.type === 'league_cup')?.winner_id];
  let next = 4;
  const takeNext = () => { while (next < plTable.length && europe.has(plTable[next])) next++; return plTable[next++]; };
  europe.set(takeNext(), 'UEL');
  europe.set(takeNext(), 'UEL');
  for (const w of uelQueue) {
    if (w && plTable.includes(w) && !europe.has(w)) europe.set(w, 'UEL');
    else europe.set(takeNext(), 'UEL');
  }
  for (const [i, id] of plTable.entries()) {
    const e = europe.get(id) ?? null;
    await d.q(`update clubs set meta = meta || $2::jsonb where id = $1`, [id, JSON.stringify({ lastPos: i + 1, europe: e })]);
  }

  // ---- reputation drift
  for (const [i, r] of table.entries()) {
    const c = clubs.get(r.clubId)!;
    const delta = Math.round(((c.meta?.expectation ?? 10) - (i + 1)) * 0.25);
    if (delta) await d.q('update clubs set reputation = greatest(40, least(99, reputation + $2)) where id = $1', [c.id, delta]);
  }

  // ---- reshuffle: bottom three bot clubs make way for three "promoted" lower-league clubs
  const promotedNames: string[] = [];
  const relegatedNames: string[] = [];
  if (world.settings.reshuffle) {
    const bottom = table.slice().reverse();
    const out: ClubRow[] = [];
    for (const r of bottom) {
      const c = clubs.get(r.clubId)!;
      if (out.length >= 3) break;
      if (c.manager_type === 'human') {
        const pos = table.findIndex((x) => x.clubId === c.id) + 1;
        if (pos >= 18) {
          await addLedger(d, c.id, world.season_no, 'event', -25_000_000, 'Survival penalty: finished in the bottom three');
          await d.q(`update players set value = round(value * 0.9) where club_id = $1`, [c.id]);
          await notifyClub(d, c.id, { type: 'system', title: 'Bottom three: a hard year ahead', body: 'You stay in the league, but lose £25m and some squad value. A bot club goes down in your place.', link: '/club/finances' });
        }
        continue;
      }
      out.push(c);
    }
    const strengths = await clubStrengths(d);
    const rng = new Rng(`${world.secret}:promotion:${world.season_no}`);
    const champ = strengths.filter((s) => s.league === 'CHAMP').map((s) => ({ s, k: s.strength + rng.normal(0, 4) })).sort((a, b) => b.k - a.k).slice(0, out.length);
    for (const c of out) {
      await d.q(`update clubs set league = 'CHAMP', meta = meta || '{"europe": null}'::jsonb, reputation = greatest(40, reputation - 4) where id = $1`, [c.id]);
      relegatedNames.push(c.short);
    }
    for (const [i, x] of champ.entries()) {
      await d.q(`update clubs set league = 'PL', meta = meta || $2::jsonb, reputation = least(80, reputation + 3), balance = balance + 40000000 where id = $1`, [x.s.id, JSON.stringify({ lastPos: 18 + i, europe: null, promotedSeason: world.season_no + 1 })]);
      promotedNames.push(clubs.get(x.s.id)?.short ?? '');
    }
  }

  const champName = champion ? clubs.get(champion.clubId)?.name : 'Nobody';
  const body = [
    `${champName} are champions with ${champion?.pts ?? 0} points.`,
    topScorer ? `Golden Boot: ${topScorer.name} (${topScorer.club}), ${topScorer.goals} goals.` : '',
    bestPlayer ? `Player of the season: ${bestPlayer.name} (${bestPlayer.club}).` : '',
    relegatedNames.length ? `Going down: ${relegatedNames.join(', ')}. Coming up: ${promotedNames.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  await addNews(d, world, { type: 'trophy', clubIds: champion ? [champion.clubId] : [], headline: `${champName} are champions!`, body, importance: 3 });
  await broadcast(d, { type: 'news', title: `Season over: ${champName} are champions`, body, link: '/season/review' });
  await d.q(`update world set phase = 'postseason', transfer_window = '{"open": false}' where id = 1`);
  await d.q(`insert into jobs (run_at, type, payload, unique_key) values ($1, 'rollover', $2, $3) on conflict (unique_key) do nothing`, [new Date(now.getTime() + 12 * HOUR), JSON.stringify({ season: world.season_no }), `rollover:${world.season_no}`]);
  return true;
}

// ---------------------------------------------------------------- rollover
export async function rollover(d: Db, world: WorldRow, now: Date) {
  const newSeason = world.season_no + 1;
  const rng = new Rng(`${world.secret}:rollover:${newSeason}`);
  const clubs = await d.many<ClubRow>('select * from clubs');

  // Bots renew the players they want to keep
  const expiring = await loadPlayers(d, `status = 'active' and contract_until <= $1`, [world.season_no]);
  const byClub = new Map<number, PlayerRow[]>();
  for (const p of await loadPlayers(d, `status = 'active'`)) (byClub.get(p.club_id!) ?? byClub.set(p.club_id!, []).get(p.club_id!)!).push(p);
  for (const p of expiring) {
    const c = clubs.find((x) => x.id === p.club_id);
    if (!c || c.manager_type === 'human') continue;
    const squad = byClub.get(c.id) ?? [];
    const rank = squad.filter((x) => x.ca > p.ca).length + 1;
    const keep = rank <= 22 && p.age <= 33 && !p.flags?.wantsOut && rng.chance(rank <= 14 ? 0.95 : 0.8);
    if (keep) {
      const years = p.age >= 30 ? 1 : p.age >= 27 ? 2 : 3;
      const wage = wageDemand({ ca: p.ca, age: p.age, currentWage: p.wage }, c.reputation);
      await d.q('update players set contract_until = $2, wage = $3 where id = $1', [p.id, newSeason + years - 1, wage]);
    }
  }
  // Everyone still expiring leaves for free
  const leaving = await loadPlayers(d, `status = 'active' and contract_until <= $1`, [world.season_no]);
  for (const p of leaving) {
    await d.q(`update players set club_id = null, status = 'free', contract_until = 0, squad_number = null, flags = '{}' where id = $1`, [p.id]);
    await d.q(`insert into transfers (season_no, player_id, player_name, from_club, to_club, fee, wage, kind) values ($1,$2,$3,$4,null,0,0,'contract_end')`, [world.season_no, p.id, p.name, p.club_id]);
    const c = clubs.find((x) => x.id === p.club_id);
    if (c?.manager_type === 'human') await notifyClub(d, c.id, { type: 'contract', title: `${p.name} has left`, body: 'His contract expired.', link: '/squad' });
    for (const t of await d.many<{ id: number; lineup: number[]; bench: number[] }>('select id, lineup, bench from tactics where club_id = $1', [p.club_id])) {
      await d.q('update tactics set lineup = $2, bench = $3 where id = $1', [t.id, JSON.stringify((t.lineup ?? []).map((x) => (x === p.id ? -1 : x))), JSON.stringify((t.bench ?? []).filter((x) => x !== p.id))]);
    }
  }

  // Ageing and retirements
  await d.q(`update players set age = age + 1 where status in ('active','free','reserve')`);
  const veterans = await loadPlayers(d, `status in ('active','free','reserve') and (age >= 34 or (flags->>'retiring')::boolean is true)`);
  for (const p of veterans) {
    const gk = (p.positions.GK ?? 0) >= 0.8;
    const age = p.age - (gk ? 2 : 0);
    const pRetire = p.flags?.retiring ? 1 : age >= 39 ? 1 : age >= 37 ? 0.7 : age >= 36 ? 0.5 : age >= 35 ? 0.3 : age >= 34 ? 0.12 : 0;
    if (!rng.chance(pRetire * (p.status === 'active' ? 1 : 1.5))) continue;
    await d.q(`update players set status = 'retired', club_id = null where id = $1`, [p.id]);
    if (p.status === 'active' && p.ca >= 150) {
      await addNews(d, world, { type: 'milestone', clubIds: p.club_id ? [p.club_id] : [], headline: `${p.name} hangs up his boots`, body: `A career spanning ${p.history?.length ? p.history.length + 1 : 'many'} clubs comes to an end at ${p.age}.`, importance: 1 });
    }
  }

  // Volatile states reset for the new season
  await d.q(`update players set yellows = 0, suspended = 0, fatigue_debt = 0, condition = 100, sharpness = greatest(55, least(sharpness, 75)), form = 1 + (form - 1) * 0.4, morale = 1 + (morale - 1) * 0.5, form_history = '[]' where status = 'active'`);

  // Youth intake
  const intake: unknown[][] = [];
  const intakeReport = new Map<number, string[]>();
  const pools = namePools();
  for (const c of clubs) {
    const n = c.league === 'PL' ? rng.int(3, 5) : rng.int(1, 3);
    const quality = Math.max(0, Math.min(1, ((c.facilities.youth ?? 2) - 1) / 4 * 0.6 + (c.reputation - 50) / 50 * 0.4));
    for (let i = 0; i < n; i++) {
      const pos = rng.pick<Pos>(['GK', 'DC', 'DC', 'DL', 'DR', 'DM', 'MC', 'MC', 'AMC', 'AML', 'AMR', 'ST', 'ST']);
      const age = rng.int(16, 18);
      const target = Math.round(70 + quality * 28 + rng.normal(0, 8));
      const g = generatePlayer(rng, { pos, targetCA: target, age });
      const pa = rollYouthPotential(rng, g.ca, quality);
      const nat = rng.chance(0.78) ? c.country : rng.pick(Object.keys(pools));
      const nm = randomName(rng, pools, nat);
      const wage = 1500 + Math.round(quality * 3000);
      intake.push([c.id, 'active', `${nm.first} ${nm.last}`, nm.last, nm.first, nm.last, nat, age, g.foot, g.heightCm, JSON.stringify(g.familiarity), attrsToArray(g.attrs), hiddenToArray(g.hidden), g.ca, pa, 100, 50, 1, 1.02, 0, wage, newSeason + 2, null, 0, JSON.stringify({ youth: true }), '[]', JSON.stringify([{ season: newSeason, club: c.short, kind: 'youth' }]), newSeason]);
      if (c.manager_type === 'human') (intakeReport.get(c.id) ?? intakeReport.set(c.id, []).get(c.id)!).push(`${nm.first} ${nm.last} (${pos}, ${age})`);
      if (pa >= 175 && c.league === 'PL') {
        await addNews(d, world, { type: 'milestone', clubIds: [c.id], headline: `${c.short} academy produces a gem`, body: `Scouts are raving about ${nm.first} ${nm.last}, a ${age}-year-old ${pos === 'GK' ? 'goalkeeper' : 'prospect'}.`, importance: 2 });
      }
    }
  }
  await insertMany(d, 'players', ['club_id', 'status', 'name', 'short', 'first_name', 'last_name', 'nat', 'age', 'foot', 'height', 'positions', 'attrs', 'hidden', 'ca', 'pa', 'condition', 'sharpness', 'form', 'morale', 'fatigue_debt', 'wage', 'contract_until', 'squad_number', 'value', 'flags', 'form_history', 'history', 'joined_season'], intake);
  for (const [clubId, list] of intakeReport) await notifyClub(d, clubId, { type: 'system', title: 'Youth intake report', body: `New academy graduates: ${list.join(', ')}.`, link: '/squad/youth' });

  // Free agent refresh: promote reserve players, keep ~180 free agents
  await d.q(`update players set status = 'free' where id in (select id from players where status = 'reserve' order by random() limit 90)`);
  await d.q(`update players set status = 'retired' where id in (select id from players where status = 'free' and age >= 33 order by random() limit 40)`);

  // Pool clubs keep healthy squads
  for (const c of clubs.filter((x) => x.league !== 'PL')) {
    const n = (await d.one<{ n: number }>(`select count(*)::int n from players where club_id = $1 and status = 'active'`, [c.id]))?.n ?? 0;
    if (n < 22) {
      await d.q(`update players set club_id = $1, status = 'active', contract_until = $3, wage = greatest(wage, 5000) where id in (
        select id from players where status = 'free' order by ca desc, random() limit $2)`, [c.id, 22 - n, newSeason + 1]);
    }
  }

  // Finances: archive season, reset accumulators, sponsorship
  for (const c of clubs) {
    const f = c.finances;
    const sponsor = f.sponsor ? { ...f.sponsor, seasonsLeft: f.sponsor.seasonsLeft - 1 } : null;
    const nf = { ...f, lastSeason: { income: f.seasonIncome ?? {}, expense: f.seasonExpense ?? {} }, seasonIncome: {}, seasonExpense: {}, sponsor: sponsor && sponsor.seasonsLeft > 0 ? sponsor : null, sponsorOffers: sponsor && sponsor.seasonsLeft > 0 ? null : makeSponsorOffers(c, rng) };
    await d.q(`update clubs set finances = $2, vision = '[]', meta = meta || $3::jsonb where id = $1`, [c.id, JSON.stringify(nf), JSON.stringify({ missedDeadlines: 0 })]);
    if (c.manager_type === 'human' && nf.sponsorOffers) await notifyClub(d, c.id, { type: 'system', title: 'New sponsorship offers', body: 'Pick a shirt sponsor for the new season.', link: '/club/sponsorship' });
  }

  // Values
  const all = await loadPlayers(d, `status in ('active','free')`);
  for (let i = 0; i < all.length; i += 1000) {
    const part = all.slice(i, i + 1000);
    await d.q(`update players p set value = v.value from (select unnest($1::int[]) id, unnest($2::bigint[]) value) v where p.id = v.id`, [part.map((p) => p.id), part.map((p) => valueOf({ ...p, contract_until: p.contract_until }, newSeason))]);
  }

  // New season shell: pre-season with an open window; the calendar is built when pre-season ends.
  const pre = Math.max(2, world.settings.preseasonDays);
  const closes = new Date(now.getTime() + pre * DAY);
  await d.q(`update world set season_no = $1, season_label = $2, phase = 'preseason', transfer_window = $3, state = state || $4::jsonb where id = 1`, [
    newSeason, seasonLabel(newSeason), JSON.stringify({ open: true, kind: 'preseason', closesAt: closes.toISOString(), opensAt: null }), JSON.stringify({ started: false, weekNo: 0 }),
  ]);
  await d.q('insert into seasons (season_no, label) values ($1, $2) on conflict do nothing', [newSeason, seasonLabel(newSeason)]);
  await d.q(`insert into jobs (run_at, type, payload, unique_key) values ($1, 'preseason_end', '{}', $2) on conflict (unique_key) do nothing`, [closes, `preseason_end:${newSeason}`]);
  await d.q('update tactics set familiarity = greatest(0.4, familiarity * 0.9)');
  await addNews(d, world, { type: 'system', headline: `Pre-season ${seasonLabel(newSeason)} is under way`, body: `The transfer window is open for ${pre} days. Youth intakes have arrived and sponsors are knocking.`, importance: 3 });
  await broadcast(d, { type: 'system', title: `Pre-season ${seasonLabel(newSeason)} has started`, body: `Transfer window open for ${pre} days. The first match is soon after.`, link: '/' });
}
