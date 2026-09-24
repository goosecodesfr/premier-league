// Home (one aggregated call), alerts inbox, decisions, news feed, media gallery and season review.
import { db, tx } from '../db.ts';
import { ApiError, route, type Ctx } from '../http/router.ts';
import { applyDecision } from '../game/events.ts';
import { leagueStandings } from '../game/competitions.ts';
import { fmtM } from '../game/market.ts';
import type { ClubRow, FixtureRow, PlayerRow } from '../game/types.ts';
import { PLAYER_COLS } from '../game/players.ts';
import {
  FIXTURE_SELECT, clubMap, fixtureLite, idParam, int, myClub, myClubOrNull, ordinal, str, world, type ClubLite,
} from './common.ts';

export interface Alert { key: string; urgency: number; icon: string; text: string; link: string; tone: 'negative' | 'warning' | 'info' | 'positive' }

export async function clubAlerts(club: ClubRow, seasonNo: number, phase: string): Promise<Alert[]> {
  const out: Alert[] = [];
  if (club.meta?.botTakeover) out.push({ key: 'takeover', urgency: 99, icon: 'bot', text: 'Your assistant is running the club. Tap to take charge again.', link: '/club', tone: 'warning' });
  const decisions = await db.many<{ id: number; payload: { title?: string } }>(`select id, payload from decisions where club_id = $1 and status = 'open' order by created_at desc`, [club.id]);
  for (const d of decisions) out.push({ key: `decision-${d.id}`, urgency: 92, icon: 'decision', text: `Decision needed: ${d.payload.title ?? 'club matter'}`, link: '/alerts', tone: 'warning' });
  const countered = await db.many<{ id: number; name: string; counter_fee: number }>(
    `select b.id, p.name, b.counter_fee from bids b join players p on p.id = b.player_id where b.from_club = $1 and b.status = 'countered'`, [club.id]);
  for (const b of countered) out.push({ key: `counter-${b.id}`, urgency: 88, icon: 'bid', text: `Counter-offer: £${fmtM(b.counter_fee)} for ${b.name}`, link: `/transfers/negotiate/${b.id}`, tone: 'info' });
  const incoming = await db.many<{ id: number; name: string; fee: number; buyer: string }>(
    `select b.id, p.name, b.fee, c.short buyer from bids b join players p on p.id = b.player_id join clubs c on c.id = b.from_club
      where b.to_club = $1 and b.status = 'pending' order by b.fee desc`, [club.id]);
  for (const b of incoming) out.push({ key: `bid-${b.id}`, urgency: 84, icon: 'bid', text: `Bid received: £${fmtM(b.fee)} for ${b.name} (${b.buyer})`, link: '/transfers/offers', tone: 'info' });
  const squad = await db.many<PlayerRow>(`select ${PLAYER_COLS} from players where club_id = $1 and status = 'active'`, [club.id]);
  if (squad.length < 18) out.push({ key: 'squad-size', urgency: 80, icon: 'squad', text: `Only ${squad.length} players. You need at least 18 - sign some free agents.`, link: '/transfers/search?status=free', tone: 'negative' });
  const gks = squad.filter((p) => (p.positions.GK ?? 0) >= 0.8 && !(p.injury && p.injury.daysLeft > 0));
  if (gks.length === 0) out.push({ key: 'no-gk', urgency: 97, icon: 'squad', text: 'You have no fit goalkeeper. Sign one now.', link: '/transfers/search?pos=GK', tone: 'negative' });
  if (!club.finances.sponsor && (club.finances.sponsorOffers?.length ?? 0) > 0) out.push({ key: 'sponsor', urgency: 72, icon: 'sponsor', text: 'Sponsorship offers are waiting. Pick one.', link: '/club/sponsorship', tone: 'positive' });
  const injured = squad.filter((p) => p.injury && p.injury.daysLeft > 0).sort((a, b) => b.ca - a.ca);
  for (const p of injured.slice(0, 3)) {
    const days = p.injury!.daysLeft;
    out.push({ key: `inj-${p.id}`, urgency: 60 + Math.min(10, p.ca / 20), icon: 'injury', text: `${p.name} is injured - out ${days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} day${days > 1 ? 's' : ''}`}`, link: `/player/${p.id}`, tone: 'negative' });
  }
  for (const p of squad.filter((x) => x.suspended > 0).slice(0, 2)) out.push({ key: `sus-${p.id}`, urgency: 58, icon: 'card', text: `${p.name} is suspended for ${p.suspended} match${p.suspended > 1 ? 'es' : ''}`, link: `/player/${p.id}`, tone: 'warning' });
  for (const p of squad.filter((x) => x.contract_until <= seasonNo && !x.flags?.noRenewal).sort((a, b) => b.ca - a.ca).slice(0, 3)) {
    out.push({ key: `con-${p.id}`, urgency: phase === 'postseason' ? 75 : 50, icon: 'contract', text: `Contract: ${p.name} expires at the end of the season`, link: `/player/${p.id}?renew=1`, tone: 'warning' });
  }
  for (const p of squad.filter((x) => x.flags?.wantsOut).slice(0, 2)) out.push({ key: `unhappy-${p.id}`, urgency: 46, icon: 'unhappy', text: `${p.name} wants to leave`, link: `/player/${p.id}`, tone: 'warning' });
  const tired = squad.filter((p) => p.fatigue_debt >= 45 && !(p.injury && p.injury.daysLeft > 0)).sort((a, b) => b.fatigue_debt - a.fatigue_debt);
  if (tired.length) out.push({ key: 'fatigue', urgency: 44, icon: 'fatigue', text: `${tired[0].name}${tired.length > 1 ? ` and ${tired.length - 1} other${tired.length > 2 ? 's' : ''}` : ''} ${tired.length > 1 ? 'are' : 'is'} running on empty - injury risk`, link: '/squad/injuries', tone: 'warning' });
  if (!club.vision?.length && phase !== 'postseason') out.push({ key: 'vision', urgency: 35, icon: 'vision', text: 'Set your club vision: three goals for the season', link: '/club/vision', tone: 'info' });
  return out.sort((a, b) => b.urgency - a.urgency);
}

export async function homeData(ctx: Ctx) {
  const w = await world();
  const club = await myClubOrNull(ctx);
  const worldInfo = { name: w.name, season: w.season_label, seasonNo: w.season_no, phase: w.phase, window: w.transfer_window, paused: w.paused, started: !!w.state.started };
  if (!club) return { needsClub: true as const, world: worldInfo };
  const clubs = await clubMap();
  const nextRow = await db.one<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where (f.home_id = $1 or f.away_id = $1) and f.status <> 'played' order by f.kickoff_at limit 1`, [club.id]);
  let next: null | (ReturnType<typeof fixtureLite> & { opponent: ClubLite; isHome: boolean; sheet: { by: string; at: string } | null; firstLeg: [number, number] | null }) = null;
  if (nextRow) {
    const fl = fixtureLite(nextRow as never, clubs);
    const isHome = nextRow.home_id === club.id;
    const sheet = await db.one<{ submitted_by: string; submitted_at: Date }>('select submitted_by, submitted_at from team_sheets where fixture_id = $1 and club_id = $2', [nextRow.id, club.id]);
    let firstLeg: [number, number] | null = null;
    if (nextRow.leg === 2 && nextRow.tie_key) {
      const l1 = await db.one<FixtureRow>('select * from fixtures where competition_id = $1 and tie_key = $2 and leg = 1', [nextRow.competition_id, nextRow.tie_key]);
      if (l1?.status === 'played') firstLeg = [l1.home_goals ?? 0, l1.away_goals ?? 0];
    }
    next = { ...fl, opponent: isHome ? fl.away : fl.home, isHome, sheet: sheet && sheet.submitted_by === 'user' ? { by: sheet.submitted_by, at: new Date(sheet.submitted_at).toISOString() } : null, firstLeg };
  }
  const upcomingRows = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where (f.home_id = $1 or f.away_id = $1) and f.status <> 'played' order by f.kickoff_at limit 6`, [club.id]);
  const lastRow = await db.one<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where (f.home_id = $1 or f.away_id = $1) and f.status = 'played' order by f.kickoff_at desc limit 1`, [club.id]);
  const table = await leagueStandings(db, w.season_no);
  const myIdx = table.findIndex((r) => r.clubId === club.id);
  let snippet: { pos: number; club: ClubLite; p: number; gd: number; pts: number; form: string[]; me: boolean }[] = [];
  if (myIdx >= 0) {
    const from = Math.max(0, Math.min(myIdx - 2, table.length - 5));
    snippet = table.slice(from, from + 5).map((r, i) => ({ pos: from + i + 1, club: clubs.get(r.clubId)!, p: r.p, gd: r.gd, pts: r.pts, form: r.form, me: r.clubId === club.id }));
  }
  const alerts = await clubAlerts(club, w.season_no, w.phase);
  const preseasonEnd = w.phase === 'preseason' ? await db.one<{ run_at: Date }>(`select run_at from jobs where type = 'preseason_end' and status = 'pending' order by run_at limit 1`) : null;
  const unread = await db.one<{ n: number }>('select count(*)::int n from notifications where user_id = $1 and read_at is null', [ctx.user!.id]);
  const lastSeason = w.season_no > 1 ? w.season_no - 1 : null;
  return {
    needsClub: false as const,
    world: worldInfo,
    club: { ...clubs.get(club.id)!, balance: club.balance, position: myIdx >= 0 ? myIdx + 1 : null, positionLabel: myIdx >= 0 && table[myIdx].p > 0 ? ordinal(myIdx + 1) : null },
    next,
    upcoming: upcomingRows.slice(next ? 1 : 0, 6).map((f) => fixtureLite(f as never, clubs)),
    last: lastRow ? fixtureLite(lastRow as never, clubs) : null,
    table: snippet,
    alerts,
    unread: unread?.n ?? 0,
    preseasonEndsAt: preseasonEnd ? new Date(preseasonEnd.run_at).toISOString() : null,
    reviewSeason: w.phase === 'postseason' ? w.season_no : lastSeason,
  };
}
export type HomeData = Awaited<ReturnType<typeof homeData>>;
route('GET', '/api/home', 'user', homeData);

// ---------------------------------------------------------------- inbox
export async function inboxData(ctx: Ctx) {
  const before = ctx.query.get('before') ? int(ctx.query.get('before'), 'before') : null;
  const rows = await db.many<{ id: number; type: string; title: string; body: string; link: string | null; created_at: Date; read_at: Date | null }>(
    `select id, type, title, body, link, created_at, read_at from notifications where user_id = $1 ${before ? 'and id < $2' : ''} order by id desc limit 50`,
    before ? [ctx.user!.id, before] : [ctx.user!.id]);
  const club = await myClubOrNull(ctx);
  const decisions = club ? await db.many<{ id: number; type: string; payload: Record<string, unknown>; options: { key: string; label: string; effect: string }[]; status: string; created_at: Date; expires_at: Date | null; resolved_option: string | null }>(
    `select * from decisions where club_id = $1 and (status = 'open' or created_at > now() - interval '14 days') order by status = 'open' desc, created_at desc limit 20`, [club.id]) : [];
  const w = await world();
  const alerts = club ? await clubAlerts(club, w.season_no, w.phase) : [];
  return {
    alerts,
    decisions: decisions.map((d) => ({
      id: d.id, type: d.type, title: String(d.payload.title ?? ''), body: String(d.payload.body ?? ''), options: d.options, status: d.status,
      createdAt: new Date(d.created_at).toISOString(), expiresAt: d.expires_at ? new Date(d.expires_at).toISOString() : null, chosen: d.resolved_option,
    })),
    notifications: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, at: new Date(r.created_at).toISOString(), read: !!r.read_at })),
  };
}
export type InboxData = Awaited<ReturnType<typeof inboxData>>;
route('GET', '/api/inbox', 'user', inboxData);

route('POST', '/api/notifications/read', 'user', async (ctx) => {
  if (ctx.body.all) await db.q('update notifications set read_at = now() where user_id = $1 and read_at is null', [ctx.user!.id]);
  else if (Array.isArray(ctx.body.ids)) {
    const ids = ctx.body.ids.map((x: unknown) => int(x, 'id')).slice(0, 200);
    await db.q('update notifications set read_at = now() where user_id = $1 and id = any($2) and read_at is null', [ctx.user!.id, ids]);
  }
  return { ok: true };
});

route('POST', '/api/decisions/:id', 'user', async (ctx) => {
  const id = idParam(ctx);
  const option = str(ctx.body.option, 'option', { max: 40 });
  const res = await tx(async (t) => {
    const club = await myClub(ctx, t);
    const d = await t.one<{ options: { key: string }[]; status: string }>('select options, status from decisions where id = $1 and club_id = $2 for update', [id, club.id]);
    if (!d) throw new ApiError('NOT_FOUND', 'Decision not found.');
    if (d.status !== 'open') throw new ApiError('CONFLICT', 'This has already been decided.');
    if (!d.options.some((o) => o.key === option)) throw new ApiError('VALIDATION_FAILED', 'Unknown option.');
    return applyDecision(t, (await world(t)), id, club.id, option);
  });
  return res;
});

// ---------------------------------------------------------------- news
const SOURCES: Record<string, string> = {
  match: 'Match Report', transfer: 'Transfer Desk', rumour: 'Transfer Gossip', injury: 'Physio Room', manager: 'The Dugout',
  sacking: 'The Dugout', table: 'Table Talk', milestone: 'Stat Zone', digest: 'Weekly Digest', trophy: 'Silverware', system: 'League Office', event: 'Club Statement', youth: 'Academy Watch',
};

export async function newsData(ctx: Ctx) {
  const before = ctx.query.get('before') ? int(ctx.query.get('before'), 'before') : null;
  const type = ctx.query.get('type');
  const mineOnly = ctx.query.get('mine') === '1';
  const club = await myClubOrNull(ctx);
  const params: unknown[] = [];
  const where: string[] = [];
  if (before) { params.push(before); where.push(`id < $${params.length}`); }
  if (type) {
    const types = type === 'transfers' ? ['transfer', 'rumour'] : type === 'matches' ? ['match', 'table', 'milestone'] : type === 'managers' ? ['manager', 'sacking'] : [type];
    params.push(types); where.push(`type = any($${params.length})`);
  }
  if (mineOnly && club) { params.push(club.id); where.push(`$${params.length} = any(club_ids)`); }
  const rows = await db.many<{ id: number; created_at: Date; type: string; club_ids: number[]; headline: string; body: string; importance: number; payload: Record<string, unknown> }>(
    `select id, created_at, type, club_ids, headline, body, importance, payload from news ${where.length ? `where ${where.join(' and ')}` : ''} order by id desc limit 30`, params);
  const pinned = !before && !type && !mineOnly ? await db.one<{ id: number; created_at: Date; headline: string; body: string }>(`select id, created_at, headline, body from news where type = 'digest' and created_at > now() - interval '8 days' order by id desc limit 1`) : null;
  const map = (r: (typeof rows)[number]) => ({
    id: r.id, at: new Date(r.created_at).toISOString(), type: r.type, source: SOURCES[r.type] ?? 'League Wire', headline: r.headline, body: r.body,
    importance: r.importance, mine: !!club && (r.club_ids ?? []).includes(club.id), clubIds: r.club_ids ?? [], link: typeof r.payload?.link === 'string' ? r.payload.link : null,
  });
  return {
    pinned: pinned ? { id: pinned.id, at: new Date(pinned.created_at).toISOString(), headline: pinned.headline, body: pinned.body } : null,
    items: rows.filter((r) => r.id !== pinned?.id).map(map),
    more: rows.length === 30,
  };
}
export type NewsData = Awaited<ReturnType<typeof newsData>>;
route('GET', '/api/news', 'user', newsData);

route('GET', '/api/news/:id', 'user', async (ctx) => {
  const id = idParam(ctx);
  const r = await db.one<{ id: number; created_at: Date; type: string; club_ids: number[]; headline: string; body: string; payload: Record<string, unknown> }>('select * from news where id = $1', [id]);
  if (!r) throw new ApiError('NOT_FOUND', 'Story not found.');
  const clubs = await clubMap();
  return { id: r.id, at: new Date(r.created_at).toISOString(), type: r.type, source: SOURCES[r.type] ?? 'League Wire', headline: r.headline, body: r.body, clubs: (r.club_ids ?? []).map((c) => clubs.get(c)).filter(Boolean), link: typeof r.payload?.link === 'string' ? r.payload.link : null };
});

// ---------------------------------------------------------------- gallery
export async function galleryData(ctx: Ctx) {
  const w = await world();
  const club = await myClub(ctx);
  const season = ctx.query.get('season') ? int(ctx.query.get('season'), 'season', { min: 1 }) : null;
  const clubs = await clubMap();
  const fx = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(
    `${FIXTURE_SELECT} where (f.home_id = $1 or f.away_id = $1) and f.status = 'played' ${season ? 'and f.season_no = $2' : ''} order by f.kickoff_at desc limit 80`,
    season ? [club.id, season] : [club.id]);
  const goals = fx.length ? await db.many<{ fixture_id: number; club_id: number; short: string; goals: number }>(
    `select pm.fixture_id, pm.club_id, p.short, pm.goals from player_match pm join players p on p.id = pm.player_id where pm.fixture_id = any($1) and pm.goals > 0`, [fx.map((f) => f.id)]) : [];
  const matchCards = fx.map((f) => {
    const scorers = [f.home_id, f.away_id].map((cid) => goals.filter((g) => g.fixture_id === f.id && g.club_id === cid).map((g) => `${g.short}${g.goals > 1 ? ` ${g.goals}` : ''}`));
    return { ...fixtureLite(f as never, clubs), scorers, season: f.season_no };
  });
  const honours = await db.many<{ season_no: number; name: string; place: string; comp_type: string }>('select season_no, name, place, comp_type from honours where club_id = $1 order by season_no desc', [club.id]);
  const deals = await db.many<{ season_no: number; player_name: string; fee: number; to_club: number; from_club: number | null }>(
    `select season_no, player_name, fee, to_club, from_club from transfers where (to_club = $1 or from_club = $1) and fee > 0 order by fee desc limit 6`, [club.id]);
  const thrashings = fx.filter((f) => Math.abs((f.home_goals ?? 0) - (f.away_goals ?? 0)) >= 4).slice(0, 10);
  const milestones = [
    ...honours.filter((h) => h.place === 'winner').map((h) => ({ kind: 'trophy', season: h.season_no, title: `${h.name} winners`, sub: `Season ${h.season_no}` })),
    ...deals.filter((d) => d.to_club === club.id).slice(0, 3).map((d) => ({ kind: 'signing', season: d.season_no, title: `Signed ${d.player_name}`, sub: `£${fmtM(d.fee)}${d.from_club ? ` from ${clubs.get(d.from_club)?.short ?? ''}` : ''}` })),
    ...deals.filter((d) => d.from_club === club.id).slice(0, 3).map((d) => ({ kind: 'sale', season: d.season_no, title: `Sold ${d.player_name}`, sub: `£${fmtM(d.fee)} to ${clubs.get(d.to_club)?.short ?? ''}` })),
    ...thrashings.map((f) => {
      const won = (f.home_id === club.id ? (f.home_goals ?? 0) - (f.away_goals ?? 0) : (f.away_goals ?? 0) - (f.home_goals ?? 0)) > 0;
      const opp = clubs.get(f.home_id === club.id ? f.away_id : f.home_id)!;
      return { kind: won ? 'thrashing' : 'humbling', season: f.season_no, title: `${won ? 'Thrashed' : 'Thrashed by'} ${opp.short} ${Math.max(f.home_goals ?? 0, f.away_goals ?? 0)}-${Math.min(f.home_goals ?? 0, f.away_goals ?? 0)}`, sub: f.comp_name, fixtureId: f.id, human: opp.human };
    }),
  ];
  const seasons = await db.many<{ season_no: number; label: string; summary: { table?: { pos: number; clubId: number; pts: number; w: number; d: number; l: number }[]; cups?: { name: string; winnerId: number | null }[] } }>('select season_no, label, summary from seasons where ended_at is not null order by season_no desc');
  const posters = [];
  for (const s of seasons) {
    const row = s.summary.table?.find((r) => r.clubId === club.id);
    const top = await db.one<{ name: string; goals: number }>(`select p.name, sum(pm.goals)::int goals from player_match pm join players p on p.id = pm.player_id where pm.club_id = $1 and pm.season_no = $2 group by p.name order by goals desc limit 1`, [club.id, s.season_no]);
    posters.push({ season: s.season_no, label: s.label, pos: row?.pos ?? null, pts: row?.pts ?? null, record: row ? `${row.w}-${row.d}-${row.l}` : null, topScorer: top && top.goals > 0 ? top : null, trophies: (s.summary.cups ?? []).filter((c) => c.winnerId === club.id).map((c) => c.name).concat(row?.pos === 1 ? ['Premier League'] : []) });
  }
  const humans = [...clubs.values()].filter((c) => c.human && c.id !== club.id);
  const h2h = [];
  for (const o of humans) {
    const r = await db.one<{ p: number; w: number; d: number; l: number; gf: number; ga: number }>(
      `select count(*)::int p,
         count(*) filter (where (home_id = $1 and home_goals > away_goals) or (away_id = $1 and away_goals > home_goals))::int w,
         count(*) filter (where home_goals = away_goals)::int d,
         count(*) filter (where (home_id = $1 and home_goals < away_goals) or (away_id = $1 and away_goals < home_goals))::int l,
         coalesce(sum(case when home_id = $1 then home_goals else away_goals end), 0)::int gf,
         coalesce(sum(case when home_id = $1 then away_goals else home_goals end), 0)::int ga
       from fixtures where status = 'played' and ((home_id = $1 and away_id = $2) or (home_id = $2 and away_id = $1))`, [club.id, o.id]);
    h2h.push({ opponent: o, ...(r ?? { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }) });
  }
  const seasonList = await db.many<{ season_no: number; label: string }>('select season_no, label from seasons order by season_no desc');
  return { club: clubs.get(club.id)!, currentSeason: w.season_no, seasons: seasonList.map((s) => ({ no: s.season_no, label: s.label })), matchCards, milestones, posters, h2h };
}
export type GalleryData = Awaited<ReturnType<typeof galleryData>>;
route('GET', '/api/gallery', 'user', galleryData);

// ---------------------------------------------------------------- season review
export async function seasonReviewData(ctx: Ctx) {
  const w = await world();
  const season = ctx.query.get('season') ? int(ctx.query.get('season'), 'season', { min: 1 }) : (w.phase === 'postseason' ? w.season_no : Math.max(1, w.season_no - 1));
  const s = await db.one<{ season_no: number; label: string; summary: Record<string, unknown>; ended_at: Date | null }>('select * from seasons where season_no = $1', [season]);
  if (!s || !s.ended_at) throw new ApiError('NOT_FOUND', 'That season has not finished yet.');
  const club = await myClubOrNull(ctx);
  const clubs = await clubMap();
  const summary = s.summary as { table?: { pos: number; clubId: number; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }[]; awards?: Record<string, unknown>; cups?: { name: string; type: string; winnerId: number | null }[] };
  let mine = null;
  if (club) {
    const row = summary.table?.find((r) => r.clubId === club.id) ?? null;
    const scorers = await db.many<{ id: number; name: string; goals: number; apps: number; rating: number }>(
      `select p.id, p.name, sum(pm.goals)::int goals, count(*)::int apps, avg(pm.rating)::float rating from player_match pm join players p on p.id = pm.player_id
        where pm.club_id = $1 and pm.season_no = $2 group by p.id, p.name order by goals desc, rating desc limit 5`, [club.id, season]);
    const best = await db.one<{ id: number; name: string; rating: number; apps: number }>(
      `select p.id, p.name, avg(pm.rating)::float rating, count(*)::int apps from player_match pm join players p on p.id = pm.player_id
        where pm.club_id = $1 and pm.season_no = $2 group by p.id, p.name having count(*) >= 10 order by rating desc limit 1`, [club.id, season]);
    const money = await db.one<{ income: number; spend: number; sales: number; fees: number }>(
      `select coalesce(sum(amount) filter (where amount > 0), 0)::bigint income, coalesce(-sum(amount) filter (where amount < 0), 0)::bigint spend,
         coalesce(sum(amount) filter (where category = 'sale'), 0)::bigint sales, coalesce(-sum(amount) filter (where category = 'fee'), 0)::bigint fees
         from ledger where club_id = $1 and season_no = $2`, [club.id, season]);
    const trophies = (summary.cups ?? []).filter((c) => c.winnerId === club.id).map((c) => c.name).concat(row?.pos === 1 ? ['Premier League'] : []);
    const visions = (s.summary as { visions?: Record<string, { label: string; done: boolean | null; status: string }[]> }).visions ?? {};
    mine = { club: clubs.get(club.id)!, row, scorers, best, money, trophies, vision: visions[String(club.id)] ?? [] };
  }
  return {
    season: s.season_no, label: s.label,
    table: (summary.table ?? []).map((r) => ({ ...r, club: clubs.get(r.clubId) })),
    awards: summary.awards ?? {},
    cups: (summary.cups ?? []).map((c) => ({ ...c, winner: c.winnerId ? clubs.get(c.winnerId) : null })),
    mine,
  };
}
export type SeasonReviewData = Awaited<ReturnType<typeof seasonReviewData>>;
route('GET', '/api/season/review', 'user', seasonReviewData);
