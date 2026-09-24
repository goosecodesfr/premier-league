// Squad list, player cards, comparison, player actions, contracts, training, treatment room and youth.
import {
  attrsFromArray, roleRating, roleSuitability, radarValues, displayRating, bestPosition, normaliseTactic, ATTR_KEYS,
  type Pos, type Tactic,
} from '@ffm/engine';
import { db, tx, type Db } from '../db.ts';
import { ApiError, bad, route, type Ctx } from '../http/router.ts';
import { PLAYER_COLS, attrsOf, isGoalkeeper, loadPlayers, squadOf } from '../game/players.ts';
import {
  offerRenewal, releasePlayer, renewalLikelihood, sellerTerms, windowOpen, fmtM, MIN_SQUAD, squadSize,
} from '../game/market.ts';
import type { ClubRow, PlayerRow, TacticRow, TrainingSettings, WorldRow } from '../game/types.ts';
import {
  clubMap, displayAttrs, idParam, int, knowledgeOf, myClub, myClubOrNull, oneOf, playerLite, scoutAssessment, world,
} from './common.ts';

// ---------------------------------------------------------------- helpers
/** Rating of a player in the tactic: his lineup slot if picked, otherwise the slot that suits him best. */
export function tacticRating(p: PlayerRow, tactic: Tactic, lineup: number[]): { rating: number; slot: number; pos: Pos } {
  const a = attrsOf(p);
  const opts = { familiarity: p.positions, form: p.form, morale: p.morale, sharpness: p.sharpness };
  const inXI = lineup.indexOf(p.id);
  if (inXI >= 0 && tactic.slots[inXI]) {
    const s = tactic.slots[inXI];
    return { rating: displayRating(roleRating(a, s.role, s.duty, { ...opts, pos: s.pos })), slot: inXI, pos: s.pos };
  }
  let best = { rating: 0, slot: -1, pos: bestPosition(p.positions) };
  tactic.slots.forEach((s, i) => {
    if (s.pos === 'GK' && (p.positions.GK ?? 0) < 0.5) return;
    if (s.pos !== 'GK' && isGoalkeeper(p)) return;
    const v = roleRating(a, s.role, s.duty, { ...opts, pos: s.pos });
    if (v > best.rating) best = { rating: v, slot: i, pos: s.pos };
  });
  return { ...best, rating: displayRating(best.rating) };
}

async function seasonStats(d: Db, playerIds: number[], seasonNo: number) {
  if (!playerIds.length) return new Map<number, { apps: number; starts: number; mins: number; goals: number; assists: number; avg: number | null; yellows: number; reds: number }>();
  const rows = await d.many<{ player_id: number; apps: number; starts: number; mins: number; goals: number; assists: number; avg: number | null; yellows: number; reds: number }>(
    `select player_id, count(*)::int apps, count(*) filter (where started)::int starts, sum(minutes)::int mins, sum(goals)::int goals, sum(assists)::int assists,
       avg(rating)::float avg, sum(yellow)::int yellows, count(*) filter (where red)::int reds
       from player_match where player_id = any($1) and season_no = $2 group by player_id`, [playerIds, seasonNo]);
  return new Map(rows.map((r) => [r.player_id, r]));
}

async function defaultTactic(d: Db, clubId: number, tacticId?: number | null): Promise<TacticRow | null> {
  if (tacticId) {
    const t = await d.one<TacticRow>('select * from tactics where id = $1 and club_id = $2', [tacticId, clubId]);
    if (t) return t;
  }
  return d.one<TacticRow>('select * from tactics where club_id = $1 order by is_default desc, id limit 1', [clubId]);
}

// ---------------------------------------------------------------- squad
export async function squadData(ctx: Ctx) {
  const w = await world();
  const club = await myClub(ctx);
  const squad = await squadOf(db, club.id);
  const t = await defaultTactic(db, club.id, ctx.query.get('tactic') ? int(ctx.query.get('tactic'), 'tactic') : null);
  const tactic = t ? normaliseTactic(t.data) : null;
  const lineup = (t?.lineup ?? []) as number[];
  const stats = await seasonStats(db, squad.map((p) => p.id), w.season_no);
  const players = squad.map((p) => {
    const tr = tactic ? tacticRating(p, tactic, lineup) : { rating: displayRating(p.ca), slot: -1, pos: bestPosition(p.positions) };
    const s = stats.get(p.id);
    return {
      ...playerLite(p, w.season_no),
      rating: tr.rating, ratingPos: tr.pos, inXI: lineup.includes(p.id), onBench: (t?.bench ?? []).includes(p.id),
      apps: s?.apps ?? 0, mins: s?.mins ?? 0, goals: s?.goals ?? 0, assists: s?.assists ?? 0, avgRating: s?.avg ? Math.round(s.avg * 100) / 100 : null,
      youth: p.age <= 21,
    };
  });
  const wageBill = squad.reduce((s, p) => s + p.wage, 0);
  return {
    tactic: t ? { id: t.id, name: t.name, formation: tactic!.formation } : null,
    players,
    wageBill,
    counts: { total: squad.length, injured: squad.filter((p) => p.injury && p.injury.daysLeft > 0).length, youth: squad.filter((p) => p.age <= 21).length },
    minSquad: MIN_SQUAD,
  };
}
export type SquadData = Awaited<ReturnType<typeof squadData>>;
route('GET', '/api/squad', 'user', squadData);

// ---------------------------------------------------------------- player card
const posAvgCache = new Map<string, { at: number; values: number[] }>();
async function positionAverage(pos: Pos, isGk: boolean): Promise<{ key: string; value: number }[]> {
  const key = `${pos}:${isGk}`;
  const hit = posAvgCache.get(key);
  let sums: number[];
  if (hit && Date.now() - hit.at < 30 * 60_000) sums = hit.values;
  else {
    const rows = await db.many<{ attrs: number[] }>(
      `select p.attrs from players p join clubs c on c.id = p.club_id where c.league = 'PL' and p.status = 'active' and (p.positions->>$1)::float >= 0.84 limit 200`, [pos]);
    sums = new Array(ATTR_KEYS.length).fill(0);
    for (const r of rows) r.attrs.forEach((v, i) => (sums[i] += v / rows.length));
    posAvgCache.set(key, { at: Date.now(), values: sums });
  }
  return radarValues(attrsFromArray(sums), isGk).map((r) => ({ key: r.key, value: Math.round(r.value) / 10 }));
}

export async function playerData(ctx: Ctx) {
  const w = await world();
  const id = idParam(ctx);
  const [p] = await loadPlayers(db, 'id = $1', [id]);
  if (!p) throw new ApiError('NOT_FOUND', 'Player not found.');
  const me = await myClubOrNull(ctx);
  const clubs = await clubMap();
  const club = p.club_id ? clubs.get(p.club_id) ?? null : null;
  const mine = !!me && p.club_id === me.id;
  const a = attrsOf(p);
  const gk = isGoalkeeper(p);
  const best = bestPosition(p.positions);
  const knowledge = mine ? Math.min(92, 78 + Math.round(((me!.staff.coach?.rating ?? 10) + (me!.staff.scout?.rating ?? 10)) / 3)) : await knowledgeOf(me?.id ?? null, p, club?.league);
  // stats by competition this season, and career by season
  const byComp = await db.many<{ comp_type: string; apps: number; starts: number; mins: number; goals: number; assists: number; avg: number; xg: number; yellows: number; reds: number; cs: number }>(
    `select comp_type, count(*)::int apps, count(*) filter (where started)::int starts, sum(minutes)::int mins, sum(goals)::int goals, sum(assists)::int assists,
       avg(rating)::float avg, sum(xg)::float xg, sum(yellow)::int yellows, count(*) filter (where red)::int reds, count(*) filter (where clean_sheet)::int cs
       from player_match where player_id = $1 and season_no = $2 group by comp_type`, [p.id, w.season_no]);
  const career = await db.many<{ season_no: number; club_id: number; apps: number; goals: number; assists: number; avg: number }>(
    `select season_no, club_id, count(*)::int apps, sum(goals)::int goals, sum(assists)::int assists, avg(rating)::float avg
       from player_match where player_id = $1 group by season_no, club_id order by season_no desc`, [p.id]);
  const recent = await db.many<{ fixture_id: number; rating: number; goals: number; assists: number; minutes: number; home_id: number; away_id: number; home_goals: number; away_goals: number; kickoff_at: Date; club_id: number }>(
    `select pm.fixture_id, pm.rating, pm.goals, pm.assists, pm.minutes, f.home_id, f.away_id, f.home_goals, f.away_goals, f.kickoff_at, pm.club_id
       from player_match pm join fixtures f on f.id = pm.fixture_id where pm.player_id = $1 order by f.kickoff_at desc limit 10`, [p.id]);
  let market: null | { stance: string; askingPrice: number | null; listed: boolean; myBid: { id: number; status: string; fee: number } | null } = null;
  let shortlisted = false;
  let scouting: { knowledge: number; assigned: boolean } | null = null;
  if (me && !mine) {
    const sellerClub = p.club_id ? await db.one<ClubRow>('select * from clubs where id = $1', [p.club_id]) : null;
    const sellerSquad = sellerClub ? await squadOf(db, sellerClub.id) : [];
    const terms = sellerTerms(p, sellerClub, sellerSquad, w);
    const stanceText: Record<string, string> = { untouchable: 'Not for sale', reluctant: 'Reluctant to sell', consider: 'Would consider offers', selling: p.status === 'free' ? 'Free agent' : 'Actively selling' };
    const bid = await db.one<{ id: number; status: string; fee: number }>(`select id, status, fee from bids where player_id = $1 and from_club = $2 order by updated_at desc limit 1`, [p.id, me.id]);
    market = { stance: stanceText[terms.stance], askingPrice: p.flags?.askingPrice ?? null, listed: !!p.flags?.listed, myBid: bid };
    shortlisted = !!(await db.one('select 1 from shortlist where club_id = $1 and player_id = $2', [me.id, p.id]));
    scouting = await db.one<{ knowledge: number; assigned: boolean }>('select knowledge, assigned from scouting where club_id = $1 and player_id = $2', [me.id, p.id]);
  }
  let renewal: null | { demand: number; likelihood: number } = null;
  if (mine && p.contract_until - w.season_no <= 1) {
    const r = renewalLikelihood(p, me!, p.wage, 3);
    renewal = { demand: r.demand, likelihood: r.p };
  }
  const years = Math.max(0, p.contract_until - w.season_no + 1);
  const releaseCost = Math.round(p.wage * 52 * years * 0.5);
  const offers = mine ? await db.many<{ id: number; fee: number; buyer: string; status: string }>(`select b.id, b.fee, c.short buyer, b.status from bids b join clubs c on c.id = b.from_club where b.player_id = $1 and b.to_club = $2 and b.status in ('pending','countered')`, [p.id, me!.id]) : [];
  return {
    player: { ...playerLite(p, w.season_no), firstName: p.first_name, lastName: p.last_name, height: p.height, club, familiarity: p.positions, joined: p.joined_season },
    mine,
    attrs: displayAttrs(p.attrs),
    rawAttrs: mine ? p.attrs : null,
    radar: radarValues(a, gk).map((r) => ({ key: r.key, label: r.label, value: Math.round(r.value) / 10 })),
    radarAvg: await positionAverage(best, gk),
    roles: roleSuitability(a, p.positions, 5).map((r) => ({ ...r, rating: r.rating / 10 })),
    stats: byComp.map((s) => ({ ...s, avg: s.avg ? Math.round(s.avg * 100) / 100 : null, xg: Math.round(s.xg * 10) / 10 })),
    career: career.map((c) => ({ season: c.season_no, club: clubs.get(c.club_id) ?? null, apps: c.apps, goals: c.goals, assists: c.assists, avg: Math.round(c.avg * 100) / 100 })),
    form: recent.reverse().map((r) => {
      const home = r.home_id === r.club_id;
      const gf = home ? r.home_goals : r.away_goals;
      const ga = home ? r.away_goals : r.home_goals;
      return { fixtureId: r.fixture_id, rating: r.rating, goals: r.goals, assists: r.assists, minutes: r.minutes, result: gf > ga ? 'W' : gf < ga ? 'L' : 'D', opp: clubs.get(home ? r.away_id : r.home_id)?.short ?? '', at: new Date(r.kickoff_at).toISOString() };
    }),
    history: p.history ?? [],
    scout: scoutAssessment(p, knowledge, me?.id ?? null),
    market,
    shortlisted,
    scouting,
    renewal,
    offers,
    actions: {
      windowOpen: windowOpen(w),
      canBid: !!me && !mine && p.status !== 'retired' && (p.status === 'free' || windowOpen(w)),
      releaseCost,
      seasonLabel: w.season_label,
    },
  };
}
export type PlayerData = Awaited<ReturnType<typeof playerData>>;
route('GET', '/api/players/:id', 'user', playerData);

export async function compareData(ctx: Ctx) {
  const w = await world();
  const ids = (ctx.query.get('ids') ?? '').split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0).slice(0, 3);
  if (ids.length < 2) throw bad('Pick two or three players to compare.');
  const players = await loadPlayers(db, 'id = any($1)', [ids]);
  const clubs = await clubMap();
  const stats = await seasonStats(db, ids, w.season_no);
  return {
    players: ids.map((id) => players.find((p) => p.id === id)).filter((p): p is PlayerRow => !!p).map((p) => ({
      ...playerLite(p, w.season_no),
      club: p.club_id ? clubs.get(p.club_id) ?? null : null,
      attrs: displayAttrs(p.attrs),
      radar: radarValues(attrsOf(p), isGoalkeeper(p)).map((r) => ({ key: r.key, label: r.label, value: Math.round(r.value) / 10 })),
      season: stats.get(p.id) ?? null,
    })),
  };
}
export type CompareData = Awaited<ReturnType<typeof compareData>>;
route('GET', '/api/players-compare', 'user', compareData);

// ---------------------------------------------------------------- player actions
async function ownPlayer(d: Db, ctx: Ctx, lock = false): Promise<{ club: ClubRow; p: PlayerRow; w: WorldRow }> {
  const w = await world(d);
  const club = await myClub(ctx, d);
  const [p] = await loadPlayers(d, `id = $1 and club_id = $2 and status = 'active'${lock ? ' for update' : ''}`, [idParam(ctx), club.id]);
  if (!p) throw new ApiError('NOT_FOUND', 'That player is not in your squad.');
  return { club, p, w };
}

route('POST', '/api/players/:id/shortlist', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const id = idParam(ctx);
  if (ctx.body.on === false) await db.q('delete from shortlist where club_id = $1 and player_id = $2', [club.id, id]);
  else await db.q('insert into shortlist (club_id, player_id) values ($1, $2) on conflict do nothing', [club.id, id]);
  return { on: ctx.body.on !== false };
});

route('POST', '/api/players/:id/scout', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const id = idParam(ctx);
  const [p] = await loadPlayers(db, 'id = $1', [id]);
  if (!p) throw new ApiError('NOT_FOUND', 'Player not found.');
  if (p.club_id === club.id) throw bad('He is already your player.');
  if (ctx.body.on === false) {
    await db.q('update scouting set assigned = false where club_id = $1 and player_id = $2', [club.id, id]);
    return { assigned: false };
  }
  const limit = 2 + Math.floor((club.staff.scout?.rating ?? 8) / 5);
  const cur = await db.one<{ n: number }>('select count(*)::int n from scouting where club_id = $1 and assigned', [club.id]);
  if ((cur?.n ?? 0) >= limit) throw new ApiError('CONFLICT', `Your scouts can only follow ${limit} players at once. Finish or cancel an assignment first.`);
  const clubRow = p.club_id ? await db.one<{ league: string }>('select league from clubs where id = $1', [p.club_id]) : null;
  const base = await knowledgeOf(club.id, p, clubRow?.league);
  await db.q(`insert into scouting (club_id, player_id, knowledge, assigned) values ($1, $2, $3, true)
    on conflict (club_id, player_id) do update set assigned = true`, [club.id, id, base]);
  await db.q('insert into shortlist (club_id, player_id) values ($1, $2) on conflict do nothing', [club.id, id]);
  return { assigned: true, limit };
});

route('POST', '/api/players/:id/list', 'user', async (ctx) => {
  const { p } = await ownPlayer(db, ctx);
  const listed = ctx.body.listed !== false;
  const asking = listed && ctx.body.askingPrice ? int(ctx.body.askingPrice, 'askingPrice', { min: 0, max: 500_000_000 }) : null;
  const flags = { ...(p.flags ?? {}), listed, askingPrice: asking ?? undefined };
  if (!listed) delete flags.askingPrice;
  await db.q('update players set flags = $2 where id = $1', [p.id, JSON.stringify(flags)]);
  return { listed };
});

route('POST', '/api/players/:id/rest', 'user', async (ctx) => {
  const { p } = await ownPlayer(db, ctx);
  const on = ctx.body.on !== false;
  await db.q(`update players set flags = ${on ? `flags || '{"rested": true}'` : `flags - 'rested'`} where id = $1`, [p.id]);
  return { rested: on };
});

route('POST', '/api/players/:id/number', 'user', async (ctx) => {
  const { p, club } = await ownPlayer(db, ctx);
  const n = int(ctx.body.number, 'Squad number', { min: 1, max: 99 });
  const taken = await db.one<{ name: string }>(`select name from players where club_id = $1 and status = 'active' and squad_number = $2 and id <> $3`, [club.id, n, p.id]);
  if (taken) throw new ApiError('CONFLICT', `${taken.name} already wears ${n}.`);
  await db.q('update players set squad_number = $2 where id = $1', [p.id, n]);
  return { number: n };
});

route('POST', '/api/players/:id/release', 'user', async (ctx) => {
  return tx(async (t) => {
    const { p, club, w } = await ownPlayer(t, ctx, true);
    if ((await squadSize(t, club.id)) <= 16) throw new ApiError('SQUAD_INVALID', 'You cannot go below 16 players.');
    const r = await releasePlayer(t, w, club, p.id);
    return { ...r, name: p.name };
  });
});

route('GET', '/api/players/:id/renewal', 'user', async (ctx) => {
  const { p, club, w } = await ownPlayer(db, ctx);
  const base = renewalLikelihood(p, club, p.wage, 3);
  const curve = [1, 2, 3, 4, 5].map((years) => ({
    years,
    points: Array.from({ length: 25 }, (_, i) => {
      const f = 0.6 + i * 0.05;
      const wage = Math.round((base.demand * f) / 500) * 500;
      return { wage, p: Math.round(renewalLikelihood(p, club, wage, years).p * 100) / 100 };
    }),
  }));
  return {
    player: playerLite(p, w.season_no), demand: base.demand, currentWage: p.wage, curve, refused: !!p.flags?.noRenewal,
    note: p.flags?.wantsOut ? 'He wants to leave, so he will take some persuading.' : null,
  };
});

route('POST', '/api/players/:id/renew', 'user', async (ctx) => {
  const wage = int(ctx.body.wage, 'wage', { min: 500, max: 2_000_000 });
  const years = int(ctx.body.years, 'years', { min: 1, max: 5 });
  return tx(async (t) => {
    const { p, club, w } = await ownPlayer(t, ctx, true);
    const r = await offerRenewal(t, w, club, p.id, wage, years);
    return { ...r, message: r.accepted ? `${p.short} signs a new ${years}-year deal.` : `${p.short} turned it down. He is looking for around £${fmtM(r.demand)} a week.` };
  });
});

// ---------------------------------------------------------------- training
route('GET', '/api/club/training', 'user', async (ctx) => {
  const w = await world();
  const club = await myClub(ctx);
  const squad = await squadOf(db, club.id);
  return {
    training: club.training,
    coach: club.staff.coach ?? null,
    fitness: club.staff.fitness ?? null,
    facilities: club.facilities.training,
    players: squad.map((p) => ({ ...playerLite(p, w.season_no), group: club.training.individual?.find((x) => x.playerId === p.id)?.group ?? null })),
  };
});

route('PUT', '/api/club/training', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const focus = oneOf(ctx.body.focus ?? club.training.focus, 'focus', ['balanced', 'attacking', 'defensive', 'fitness', 'tactical', 'set_pieces', 'recovery'] as const);
  const intensity = oneOf(ctx.body.intensity ?? club.training.intensity, 'intensity', ['low', 'normal', 'high'] as const);
  let individual = club.training.individual ?? [];
  if (Array.isArray(ctx.body.individual)) {
    const ids = new Set((await db.many<{ id: number }>(`select id from players where club_id = $1 and status = 'active'`, [club.id])).map((r) => r.id));
    individual = ctx.body.individual
      .filter((x: { playerId: number; group: string }) => ids.has(Number(x.playerId)) && ['technical', 'mental', 'physical', 'goalkeeping'].includes(x.group))
      .slice(0, 40)
      .map((x: { playerId: number; group: TrainingSettings['individual'][number]['group'] }) => ({ playerId: Number(x.playerId), group: x.group }));
  }
  const training: TrainingSettings = { focus, intensity, individual };
  await db.q('update clubs set training = $2 where id = $1', [club.id, JSON.stringify(training)]);
  return { training };
});

// ---------------------------------------------------------------- treatment room and youth
route('GET', '/api/squad/injuries', 'user', async (ctx) => {
  const w = await world();
  const club = await myClub(ctx);
  const squad = await squadOf(db, club.id);
  const physio = club.staff.physio;
  const injured = squad.filter((p) => p.injury && p.injury.daysLeft > 0).sort((a, b) => b.injury!.daysLeft - a.injury!.daysLeft).map((p) => {
    const inj = p.injury!;
    const done = 1 - inj.daysLeft / Math.max(1, inj.daysTotal);
    const note = inj.daysLeft <= 3 ? 'Nearly there. Sharpness will be low for a couple of games.' : done > 0.6 ? 'Recovery on track.' : inj.severity === 'serious' ? 'Long road back. Do not rush it.' : 'Resting and rehab.';
    return { ...playerLite(p, w.season_no), injuryDetail: { ...inj, returnAt: new Date(Date.now() + inj.daysLeft * 86400000).toISOString(), progress: Math.round(done * 100) }, note };
  });
  const atRisk = squad.filter((p) => !(p.injury && p.injury.daysLeft > 0) && (p.fatigue_debt >= 30 || p.condition < 70)).sort((a, b) => b.fatigue_debt - a.fatigue_debt).map((p) => ({
    ...playerLite(p, w.season_no),
    risk: p.fatigue_debt >= 55 ? 'high' : p.fatigue_debt >= 40 ? 'elevated' : 'watch',
    advice: p.fatigue_debt >= 45 ? 'Rest him for a match.' : 'Rotate when you can.',
  }));
  return { physio, medical: club.facilities.medical, injured, atRisk, suspended: squad.filter((p) => p.suspended > 0).map((p) => playerLite(p, w.season_no)) };
});

route('GET', '/api/squad/youth', 'user', async (ctx) => {
  const w = await world();
  const club = await myClub(ctx);
  const squad = await squadOf(db, club.id);
  const youth = squad.filter((p) => p.age <= 21).sort((a, b) => b.pa - a.pa);
  const mins = youth.length ? await db.many<{ player_id: number; m: number }>(`select player_id, sum(minutes)::int m from player_match where player_id = any($1) and season_no = $2 group by player_id`, [youth.map((p) => p.id), w.season_no]) : [];
  const knowledge = Math.min(92, 78 + Math.round(((club.staff.coach?.rating ?? 10) + (club.staff.scout?.rating ?? 10)) / 3));
  return {
    academyTier: club.facilities.youth,
    nextIntake: 'Arrives with the new season',
    players: youth.map((p) => ({ ...playerLite(p, w.season_no), minutes: mins.find((m) => m.player_id === p.id)?.m ?? 0, scout: scoutAssessment(p, knowledge, club.id) })),
  };
});

void sellerTerms;
