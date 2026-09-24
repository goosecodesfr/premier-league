// League tab: table, fixtures and results, leaderboards, competitions, rival club profiles, head-to-head.
import { normaliseTactic } from '@ffm/engine';
import { db } from '../db.ts';
import { ApiError, route, type Ctx } from '../http/router.ts';
import { computeStandings, stageLabel } from '../game/competitions.ts';
import { squadOf } from '../game/players.ts';
import { ARCHETYPE_INFO } from '../game/archetypes.ts';
import type { ClubRow, CompetitionRow, CompType, FixtureRow } from '../game/types.ts';
import { COMP_NAMES } from '../game/types.ts';
import { FIXTURE_SELECT, clubMap, fixtureLite, idParam, int, myClubOrNull, playerLite, world, type FixtureLite } from './common.ts';

async function seasonParam(ctx: Ctx): Promise<number> {
  const w = await world();
  return ctx.query.get('season') ? int(ctx.query.get('season'), 'season', { min: 1, max: w.season_no }) : w.season_no;
}

// ---------------------------------------------------------------- table
export async function tableData(ctx: Ctx) {
  const season = await seasonParam(ctx);
  const comp = await db.one<CompetitionRow>(`select * from competitions where season_no = $1 and type = 'league'`, [season]);
  const clubs = await clubMap();
  const me = await myClubOrNull(ctx);
  const seasons = await db.many<{ season_no: number; label: string }>('select season_no, label from seasons order by season_no desc');
  if (!comp) {
    // Pre-season before the fixtures exist: list the league clubs alphabetically.
    const pl = [...clubs.values()].filter((c) => c.league === 'PL').sort((a, b) => a.name.localeCompare(b.name));
    return { season, seasons: seasons.map((s) => ({ no: s.season_no, label: s.label })), started: false, rows: pl.map((c, i) => ({ pos: i + 1, club: c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] as string[], zone: null as string | null, me: c.id === me?.id, next: null as string | null })) };
  }
  const fx = await db.many<FixtureRow>('select * from fixtures where competition_id = $1', [comp.id]);
  const rows = computeStandings(fx, comp.data.entrants ?? []);
  const nextOpp = new Map<number, string>();
  for (const f of fx.filter((x) => x.status !== 'played').sort((a, b) => +new Date(a.kickoff_at) - +new Date(b.kickoff_at))) {
    if (!nextOpp.has(f.home_id)) nextOpp.set(f.home_id, `${clubs.get(f.away_id)?.short} (H)`);
    if (!nextOpp.has(f.away_id)) nextOpp.set(f.away_id, `${clubs.get(f.home_id)?.short} (A)`);
  }
  return {
    season, seasons: seasons.map((s) => ({ no: s.season_no, label: s.label })), started: true,
    rows: rows.map((r, i) => ({
      pos: i + 1, club: clubs.get(r.clubId)!, p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts, form: r.form as string[],
      zone: i < 4 ? 'ucl' : i < 6 ? 'uel' : i >= rows.length - 3 ? 'rel' : null, me: r.clubId === me?.id, next: nextOpp.get(r.clubId) ?? null,
    })),
  };
}
export type TableData = Awaited<ReturnType<typeof tableData>>;
route('GET', '/api/league/table', 'user', tableData);

// ---------------------------------------------------------------- fixtures
export async function fixturesData(ctx: Ctx) {
  const season = await seasonParam(ctx);
  const clubs = await clubMap();
  const me = await myClubOrNull(ctx);
  const clubFilter = ctx.query.get('club') ? int(ctx.query.get('club'), 'club') : ctx.query.get('mine') === '1' ? me?.id ?? null : null;
  if (clubFilter) {
    const rows = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where f.season_no = $1 and (f.home_id = $2 or f.away_id = $2) order by f.kickoff_at`, [season, clubFilter]);
    return { season, mode: 'club' as const, clubId: clubFilter, fixtures: rows.map((f) => fixtureLite(f as never, clubs)), rounds: [] as { round: number; kickoff: string; played: number; total: number }[], round: null as number | null };
  }
  const comp = await db.one<CompetitionRow>(`select * from competitions where season_no = $1 and type = 'league'`, [season]);
  if (!comp) return { season, mode: 'round' as const, clubId: null, fixtures: [] as FixtureLite[], rounds: [], round: null };
  const meta = await db.many<{ round: number; kickoff: Date; played: number; total: number }>(
    `select round, min(kickoff_at) kickoff, count(*) filter (where status = 'played')::int played, count(*)::int total from fixtures where competition_id = $1 group by round order by round`, [comp.id]);
  const current = meta.find((m) => m.played < m.total)?.round ?? meta[meta.length - 1]?.round ?? 1;
  const round = ctx.query.get('round') ? int(ctx.query.get('round'), 'round', { min: 1, max: 38 }) : current;
  const rows = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where f.competition_id = $1 and f.round = $2 order by f.kickoff_at, f.id`, [comp.id, round]);
  return {
    season, mode: 'round' as const, clubId: null, round,
    rounds: meta.map((m) => ({ round: m.round, kickoff: new Date(m.kickoff).toISOString(), played: m.played, total: m.total })),
    fixtures: rows.map((f) => fixtureLite(f as never, clubs)),
  };
}
export type FixturesData = Awaited<ReturnType<typeof fixturesData>>;
route('GET', '/api/league/fixtures', 'user', fixturesData);

// ---------------------------------------------------------------- leaderboards
export async function statsData(ctx: Ctx) {
  const season = await seasonParam(ctx);
  const comp = (ctx.query.get('comp') ?? 'league') as CompType | 'all';
  const clubs = await clubMap();
  const compWhere = comp === 'all' ? '' : 'and pm.comp_type = $2';
  const params: unknown[] = comp === 'all' ? [season] : [season, comp];
  const base = `from player_match pm join players p on p.id = pm.player_id where pm.season_no = $1 ${compWhere}`;
  const q = (select: string, having: string, order: string) => db.many<{ id: number; name: string; club_id: number; v: number; apps: number }>(
    `select p.id, p.name, (array_agg(pm.club_id order by pm.fixture_id desc))[1] club_id, ${select} v, count(*)::int apps ${base} group by p.id, p.name ${having} order by ${order} limit 10`, params);
  const [goals, assists, rating, cleanSheets, xg, yellows, involvement] = await Promise.all([
    q('sum(pm.goals)::int', 'having sum(pm.goals) > 0', 'v desc, apps asc'),
    q('sum(pm.assists)::int', 'having sum(pm.assists) > 0', 'v desc, apps asc'),
    q('round(avg(pm.rating)::numeric, 2)::float', 'having count(*) >= greatest(3, (select count(distinct fixture_id) from player_match x where x.season_no = $1) / 60)', 'v desc'),
    q(`count(*) filter (where pm.clean_sheet)::int`, `having bool_or((p.positions->>'GK')::float >= 0.8) and count(*) filter (where pm.clean_sheet) > 0`, 'v desc, apps asc'),
    q('round(sum(pm.xg)::numeric, 1)::float', 'having sum(pm.xg) > 0', 'v desc'),
    q('sum(pm.yellow)::int', 'having sum(pm.yellow) > 0', 'v desc'),
    q('(sum(pm.goals) + sum(pm.assists))::int', 'having sum(pm.goals) + sum(pm.assists) > 0', 'v desc, apps asc'),
  ]);
  const map = (rows: typeof goals) => rows.map((r) => ({ id: r.id, name: r.name, club: clubs.get(r.club_id) ?? null, value: r.v, apps: r.apps }));
  return {
    season, comp,
    boards: [
      { key: 'goals', label: 'Goals', rows: map(goals) },
      { key: 'assists', label: 'Assists', rows: map(assists) },
      { key: 'involvement', label: 'Goals + assists', rows: map(involvement) },
      { key: 'rating', label: 'Average rating', rows: map(rating) },
      { key: 'cleanSheets', label: 'Clean sheets', rows: map(cleanSheets) },
      { key: 'xg', label: 'Expected goals', rows: map(xg) },
      { key: 'yellows', label: 'Yellow cards', rows: map(yellows) },
    ],
  };
}
export type StatsData = Awaited<ReturnType<typeof statsData>>;
route('GET', '/api/league/stats', 'user', statsData);

// ---------------------------------------------------------------- competitions
export async function competitionsData(ctx: Ctx) {
  const season = await seasonParam(ctx);
  const me = await myClubOrNull(ctx);
  const clubs = await clubMap();
  const comps = await db.many<CompetitionRow>('select * from competitions where season_no = $1 order by id', [season]);
  const out = [];
  for (const c of comps) {
    let status: string | null = null;
    if (me) {
      const entered = (c.data.entrants ?? []).includes(me.id);
      if (!entered) status = null;
      else if (c.type === 'league') status = 'In the league';
      else {
        const last = await db.one<FixtureRow>(`select * from fixtures where competition_id = $1 and (home_id = $2 or away_id = $2) order by kickoff_at desc limit 1`, [c.id, me.id]);
        const upcoming = await db.one<FixtureRow>(`select * from fixtures where competition_id = $1 and (home_id = $2 or away_id = $2) and status <> 'played' order by kickoff_at limit 1`, [c.id, me.id]);
        if (c.winner_id === me.id) status = 'Winners';
        else if (upcoming) status = `Next: ${stageLabel(c.type, upcoming.stage, upcoming.grp)}`;
        else if (last && last.winner_id && last.winner_id !== me.id) status = `Out: ${stageLabel(c.type, last.stage, last.grp)}`;
        else if (c.status === 'done') status = c.runner_up_id === me.id ? 'Runners-up' : 'Eliminated';
        else status = 'Through - awaiting the draw';
      }
    }
    const next = await db.one<{ stage: string; grp: string | null; kickoff_at: Date }>(`select stage, grp, kickoff_at from fixtures where competition_id = $1 and status <> 'played' order by kickoff_at limit 1`, [c.id]);
    out.push({
      id: c.id, type: c.type, name: c.name, status: c.status, winner: c.winner_id ? clubs.get(c.winner_id) ?? null : null,
      mine: status, current: next ? stageLabel(c.type, next.stage, next.grp) : c.status === 'done' ? 'Finished' : null,
      nextAt: next ? new Date(next.kickoff_at).toISOString() : null,
    });
  }
  return { season, competitions: out };
}
export type CompetitionsData = Awaited<ReturnType<typeof competitionsData>>;
route('GET', '/api/competitions', 'user', competitionsData);

export async function competitionData(ctx: Ctx) {
  const id = idParam(ctx);
  const c = await db.one<CompetitionRow>('select * from competitions where id = $1', [id]);
  if (!c) throw new ApiError('NOT_FOUND', 'Competition not found.');
  const clubs = await clubMap();
  const fx = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where f.competition_id = $1 order by f.kickoff_at, f.id`, [id]);
  const groups = Object.entries(c.data.groups ?? {}).map(([letter, ids]) => ({
    letter,
    rows: computeStandings(fx.filter((f) => f.grp === letter), ids).map((r, i) => ({ pos: i + 1, club: clubs.get(r.clubId)!, p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts, qualifies: i < 2 })),
    fixtures: fx.filter((f) => f.grp === letter).map((f) => fixtureLite(f as never, clubs)),
  }));
  const koStages = ['R1', 'R32', 'R16', 'QF', 'SF', 'F'];
  const rounds = koStages.map((stage) => {
    const sfx = fx.filter((f) => f.stage === stage);
    if (!sfx.length) {
      const planned = (c.data.rounds ?? []).find((r) => r.stage === stage);
      return planned ? { stage, label: stageLabel(c.type, stage), date: planned.dates[0] ?? null, ties: [] as { key: string; home: ReturnType<typeof clubs.get>; away: ReturnType<typeof clubs.get>; legs: FixtureLite[]; agg: [number, number] | null; winnerId: number | null }[] } : null;
    }
    const byTie = new Map<string, typeof sfx>();
    for (const f of sfx) byTie.set(f.tie_key ?? String(f.id), [...(byTie.get(f.tie_key ?? String(f.id)) ?? []), f]);
    const ties = [...byTie.entries()].map(([key, legs]) => {
      const l1 = legs.find((l) => l.leg === 1) ?? legs[0];
      const l2 = legs.find((l) => l.leg === 2);
      let agg: [number, number] | null = null;
      if (l2 && l1.status === 'played') agg = [(l1.home_goals ?? 0) + (l2.status === 'played' ? l2.away_goals ?? 0 : 0), (l1.away_goals ?? 0) + (l2.status === 'played' ? l2.home_goals ?? 0 : 0)];
      const decider = l2 ?? l1;
      return { key, home: clubs.get(l1.home_id), away: clubs.get(l1.away_id), legs: legs.map((l) => fixtureLite(l as never, clubs)), agg, winnerId: decider.status === 'played' ? decider.winner_id : null };
    });
    return { stage, label: stageLabel(c.type, stage), date: sfx[0] ? new Date(sfx[0].kickoff_at).toISOString() : null, ties };
  }).filter((r): r is NonNullable<typeof r> => !!r && !(c.type === 'league'));
  return {
    id: c.id, type: c.type, name: c.name, season: c.season_no, status: c.status,
    winner: c.winner_id ? clubs.get(c.winner_id) ?? null : null, runnerUp: c.runner_up_id ? clubs.get(c.runner_up_id) ?? null : null,
    groups, rounds, entrants: (c.data.entrants ?? []).length,
  };
}
export type CompetitionData = Awaited<ReturnType<typeof competitionData>>;
route('GET', '/api/competitions/:id', 'user', competitionData);

// ---------------------------------------------------------------- club profile
export async function clubProfileData(ctx: Ctx) {
  const w = await world();
  const id = idParam(ctx);
  const c = await db.one<ClubRow & { user_name: string | null }>('select c.*, u.display_name user_name from clubs c left join users u on u.id = c.user_id where c.id = $1', [id]);
  if (!c) throw new ApiError('NOT_FOUND', 'Club not found.');
  const clubs = await clubMap();
  const me = await myClubOrNull(ctx);
  const squad = await squadOf(db, c.id);
  const recent = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where (f.home_id = $1 or f.away_id = $1) and f.status = 'played' order by f.kickoff_at desc limit 6`, [c.id]);
  const upcoming = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where (f.home_id = $1 or f.away_id = $1) and f.status <> 'played' order by f.kickoff_at limit 3`, [c.id]);
  const honours = await db.many<{ season_no: number; name: string; place: string }>('select season_no, name, place from honours where club_id = $1 order by season_no desc', [c.id]);
  const sheets = await db.many<{ tactic: Record<string, unknown> }>(`select ts.tactic from team_sheets ts join fixtures f on f.id = ts.fixture_id where ts.club_id = $1 and f.status = 'played' order by f.kickoff_at desc limit 5`, [c.id]);
  const shapes = new Map<string, number>();
  for (const s of sheets) { const k = normaliseTactic(s.tactic).formation; shapes.set(k, (shapes.get(k) ?? 0) + 1); }
  let pos: number | null = null;
  const comp = await db.one<CompetitionRow>(`select * from competitions where season_no = $1 and type = 'league'`, [w.season_no]);
  if (comp && c.league === 'PL') {
    const fx = await db.many<FixtureRow>('select home_id, away_id, home_goals, away_goals, status, kickoff_at from fixtures where competition_id = $1', [comp.id]);
    pos = computeStandings(fx, comp.data.entrants ?? []).findIndex((r) => r.clubId === c.id) + 1 || null;
  }
  const human = c.manager_type === 'human';
  return {
    club: clubs.get(c.id)!, stadium: c.stadium, capacity: c.capacity, reputation: c.reputation, country: c.country, position: pos,
    manager: human ? { name: c.user_name ?? 'Human manager', human: true, style: null as string | null, desc: null as string | null, since: null as number | null } : { name: c.bot.name, human: false, style: ARCHETYPE_INFO[c.bot.archetype]?.label ?? '', desc: ARCHETYPE_INFO[c.bot.archetype]?.desc ?? '', since: c.bot.hiredSeason },
    usualShape: [...shapes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    squad: squad.sort((a, b) => b.ca - a.ca).map((p) => playerLite(p, w.season_no)),
    recent: recent.map((f) => fixtureLite(f as never, clubs)),
    upcoming: upcoming.map((f) => fixtureLite(f as never, clubs)),
    honours,
    isMine: me?.id === c.id,
    rivals: c.meta?.rivals ?? [],
  };
}
export type ClubProfileData = Awaited<ReturnType<typeof clubProfileData>>;
route('GET', '/api/clubs/:id', 'user', clubProfileData);

// ---------------------------------------------------------------- head-to-head
export async function h2hData(ctx: Ctx) {
  const a = int(ctx.params.a, 'a');
  const b = int(ctx.params.b, 'b');
  const clubs = await clubMap();
  if (!clubs.get(a) || !clubs.get(b)) throw new ApiError('NOT_FOUND', 'Club not found.');
  const rows = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where f.status = 'played' and ((f.home_id = $1 and f.away_id = $2) or (f.home_id = $2 and f.away_id = $1)) order by f.kickoff_at desc`, [a, b]);
  let aw = 0, d = 0, bw = 0, ag = 0, bg = 0;
  let biggestA: FixtureLite | null = null, biggestB: FixtureLite | null = null;
  let bestA = 0, bestB = 0;
  for (const f of rows) {
    const aGoals = f.home_id === a ? f.home_goals ?? 0 : f.away_goals ?? 0;
    const bGoals = f.home_id === a ? f.away_goals ?? 0 : f.home_goals ?? 0;
    ag += aGoals; bg += bGoals;
    const winner = f.winner_id ?? (aGoals > bGoals ? a : bGoals > aGoals ? b : null);
    if (winner === a) aw++; else if (winner === b) bw++; else d++;
    if (aGoals - bGoals > bestA) { bestA = aGoals - bGoals; biggestA = fixtureLite(f as never, clubs); }
    if (bGoals - aGoals > bestB) { bestB = bGoals - aGoals; biggestB = fixtureLite(f as never, clubs); }
  }
  return { a: clubs.get(a)!, b: clubs.get(b)!, played: rows.length, aWins: aw, draws: d, bWins: bw, aGoals: ag, bGoals: bg, biggestA, biggestB, meetings: rows.map((f) => fixtureLite(f as never, clubs)) };
}
export type H2hData = Awaited<ReturnType<typeof h2hData>>;
route('GET', '/api/h2h/:a/:b', 'user', h2hData);

void COMP_NAMES;
