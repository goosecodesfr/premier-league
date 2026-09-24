// Transfers: hub, search, suggestions, shortlist, offers, negotiation threads, live quotes, bids, scouting.
import { POS_LABEL, positionRating, type Pos } from '@ffm/engine';
import { db, tx } from '../db.ts';
import { ApiError, bad, route, type Ctx } from '../http/router.ts';
import {
  MAX_SQUAD, acceptanceLikelihood, assessNeeds, placeBid, respondAsBuyer, respondAsSeller, sellerTerms, termsLikelihood, transferBudget, windowOpen,
  type BidRow,
} from '../game/market.ts';
import { wageBudgetWeekly } from '../game/finance.ts';
import { attrsOf, loadPlayers, squadOf } from '../game/players.ts';
import type { ClubRow, PlayerRow } from '../game/types.ts';
import { clubMap, idParam, int, knowledgeOf, myClub, oneOf, optInt, playerLite, scoutAssessment, world } from './common.ts';

async function hubData(ctx: Ctx) {
  const w = await world();
  const club = await myClub(ctx);
  const clubs = await clubMap();
  const squad = await squadOf(db, club.id);
  const wageBill = squad.reduce((s, p) => s + p.wage, 0);
  const counts = await db.one<{ shortlist: number; incoming: number; outgoing: number; scouting: number }>(
    `select (select count(*)::int from shortlist where club_id = $1) shortlist,
            (select count(*)::int from bids where to_club = $1 and status = 'pending') incoming,
            (select count(*)::int from bids where from_club = $1 and status in ('pending','countered')) outgoing,
            (select count(*)::int from scouting where club_id = $1 and assigned) scouting`, [club.id]);
  const done = await db.many<{ id: number; player_id: number; player_name: string; from_club: number | null; to_club: number | null; fee: number; kind: string; created_at: Date }>(
    `select id, player_id, player_name, from_club, to_club, fee, kind, created_at from transfers where kind in ('transfer','free') order by created_at desc limit 25`);
  const live = await db.many<{ id: number; player_id: number; name: string; from_club: number; to_club: number | null; fee: number; status: string; updated_at: Date }>(
    `select b.id, b.player_id, p.name, b.from_club, b.to_club, b.fee, b.status, b.updated_at from bids b join players p on p.id = b.player_id
      where b.status in ('pending','countered','rejected') and b.to_club is not null and b.fee >= 5000000 and b.updated_at > now() - interval '3 days'
      order by b.updated_at desc limit 15`);
  const feed = [
    ...done.map((t) => ({ kind: 'done' as const, at: new Date(t.created_at).toISOString(), playerId: t.player_id, player: t.player_name, from: t.from_club ? clubs.get(t.from_club) ?? null : null, to: t.to_club ? clubs.get(t.to_club) ?? null : null, fee: Number(t.fee), status: t.kind })),
    ...live.map((b) => ({ kind: 'bid' as const, at: new Date(b.updated_at).toISOString(), playerId: b.player_id, player: b.name, from: b.to_club ? clubs.get(b.to_club) ?? null : null, to: clubs.get(b.from_club) ?? null, fee: Number(b.fee), status: b.status })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  const win = w.transfer_window;
  return {
    budget: Math.max(0, club.balance), overdraft: 20_000_000, balance: club.balance, wageBudget: wageBudgetWeekly(club), wageBill,
    window: { open: windowOpen(w), kind: win.kind ?? null, closesAt: win.closesAt ?? null, opensAt: win.opensAt ?? null },
    embargo: !!club.finances.embargo, squadSize: squad.length, maxSquad: MAX_SQUAD,
    counts: counts ?? { shortlist: 0, incoming: 0, outgoing: 0, scouting: 0 },
    feed,
  };
}
export type TransferHubData = Awaited<ReturnType<typeof hubData>>;
route('GET', '/api/transfers', 'user', hubData);

// ---------------------------------------------------------------- search
const SORTS: Record<string, string> = {
  value: 'p.value desc', ovr: 'p.ca desc', age: 'p.age asc', wage: 'p.wage asc', contract: 'p.contract_until asc, p.ca desc', cheap: 'p.value asc',
};

async function rowsOut(rows: (PlayerRow & { league: string | null })[], me: ClubRow, seasonNo: number) {
  const clubs = await clubMap();
  const known = rows.length ? await db.many<{ player_id: number; knowledge: number; assigned: boolean }>('select player_id, knowledge, assigned from scouting where club_id = $1 and player_id = any($2)', [me.id, rows.map((r) => r.id)]) : [];
  const short = rows.length ? new Set((await db.many<{ player_id: number }>('select player_id from shortlist where club_id = $1 and player_id = any($2)', [me.id, rows.map((r) => r.id)])).map((r) => r.player_id)) : new Set<number>();
  return rows.map((p) => {
    const k = known.find((x) => x.player_id === p.id);
    const base = p.league === 'PL' ? 45 : p.league === 'EUR' ? 25 : 30;
    const knowledge = Math.max(base, k?.knowledge ?? 0);
    const sa = scoutAssessment(p, knowledge, me.id);
    return { ...playerLite(p, seasonNo), club: p.club_id ? clubs.get(p.club_id) ?? null : null, potential: sa.potential, knowledge, scouting: !!k?.assigned, shortlisted: short.has(p.id) };
  });
}

export async function searchData(ctx: Ctx) {
  const w = await world();
  const me = await myClub(ctx);
  const q = ctx.query;
  const where: string[] = [`p.status in ('active','free')`, `coalesce(p.club_id, 0) <> $1`];
  const params: unknown[] = [me.id];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('$?', `$${params.length}`)); };
  const text = (q.get('q') ?? '').trim();
  if (text) add(`p.name ilike $?`, `%${text.replace(/[%_]/g, '')}%`);
  const pos = (q.get('pos') ?? '').split(',').filter((x) => x in POS_LABEL);
  if (pos.length) {
    const parts = pos.map((pp) => { params.push(pp); return `(p.positions->>$${params.length})::float >= 0.84`; });
    where.push(`(${parts.join(' or ')})`);
  }
  const ageMin = optInt(q.get('ageMin'), 'ageMin', { min: 15, max: 45 });
  const ageMax = optInt(q.get('ageMax'), 'ageMax', { min: 15, max: 45 });
  if (ageMin) add('p.age >= $?', ageMin);
  if (ageMax) add('p.age <= $?', ageMax);
  const valueMax = optInt(q.get('valueMax'), 'valueMax', { min: 0 });
  if (valueMax) add('p.value <= $?', valueMax);
  const valueMin = optInt(q.get('valueMin'), 'valueMin', { min: 0 });
  if (valueMin) add('p.value >= $?', valueMin);
  const wageMax = optInt(q.get('wageMax'), 'wageMax', { min: 0 });
  if (wageMax) add('p.wage <= $?', wageMax);
  const minOvr = optInt(q.get('minOvr'), 'minOvr', { min: 1, max: 20 });
  if (minOvr) add('p.ca >= $?', minOvr * 10);
  const foot = q.get('foot');
  if (foot && ['L', 'R', 'B'].includes(foot)) add('p.foot = $?', foot);
  const nat = q.get('nat');
  if (nat && /^[A-Z]{3}$/.test(nat)) add('p.nat = $?', nat);
  const status = q.get('status');
  if (status === 'free') where.push(`p.status = 'free'`);
  else if (status === 'listed') where.push(`(p.flags->>'listed')::boolean is true`);
  else if (status === 'expiring') add(`p.status = 'active' and p.contract_until <= $?`, w.season_no);
  const league = q.get('league');
  if (league && ['PL', 'EUR', 'CHAMP'].includes(league)) add('c.league = $?', league);
  const sort = SORTS[q.get('sort') ?? 'ovr'] ?? SORTS.ovr;
  const page = optInt(q.get('page'), 'page', { min: 0, max: 50 }) ?? 0;
  const rows = await db.many<PlayerRow & { league: string | null }>(
    `select p.*, c.league from players p left join clubs c on c.id = p.club_id where ${where.join(' and ')} order by ${sort}, p.id limit 41 offset ${page * 40}`, params);
  return { results: await rowsOut(rows.slice(0, 40), me, w.season_no), more: rows.length > 40, page };
}
export type SearchData = Awaited<ReturnType<typeof searchData>>;
route('GET', '/api/transfers/search', 'user', searchData);

// ---------------------------------------------------------------- suggestions
export async function suggestedData(ctx: Ctx) {
  const w = await world();
  const me = await myClub(ctx);
  const squad = await squadOf(db, me.id);
  const level = squad.map((p) => p.ca).sort((a, b) => b - a).slice(0, 13).reduce((s, v, _, arr) => s + v / arr.length, 0);
  const needs = assessNeeds(squad, level).filter((n) => n.urgency > 0).slice(0, 3);
  const budget = Math.max(0, me.balance) + 10_000_000;
  const out = [];
  for (const n of needs) {
    const rows = await db.many<PlayerRow & { league: string | null }>(
      `select p.*, c.league from players p left join clubs c on c.id = p.club_id
        where p.status in ('active','free') and coalesce(p.club_id, 0) <> $1 and (p.positions->>$2)::float >= 0.85 and p.ca >= $3 and p.value <= $4 and p.age <= 32
        order by p.ca desc limit 30`, [me.id, n.pos, Math.round(Math.max(n.bestCa + 2, level - 12)), budget]);
    const scored = rows.map((p) => ({ p, v: positionRating(attrsOf(p), p.positions, n.pos as Pos) - Math.sqrt(Number(p.value) / 1_000_000) * 1.2 + (p.status === 'free' ? 4 : 0) })).sort((a, b) => b.v - a.v).slice(0, 5).map((x) => x.p);
    const label = POS_LABEL[n.pos as Pos]?.toLowerCase() ?? n.pos;
    const reason = n.count === 0 ? `You have no fit ${label}` : n.count < 2 ? `You only have one fit ${label}` : `Your best ${label} is below the rest of your XI`;
    out.push({ pos: n.pos, reason, players: await rowsOut(scored, me, w.season_no) });
  }
  return { needs: out };
}
export type SuggestedData = Awaited<ReturnType<typeof suggestedData>>;
route('GET', '/api/transfers/suggested', 'user', suggestedData);

// ---------------------------------------------------------------- shortlist
export async function shortlistData(ctx: Ctx) {
  const w = await world();
  const me = await myClub(ctx);
  const rows = await db.many<PlayerRow & { league: string | null }>(
    `select p.*, c.league from shortlist s join players p on p.id = s.player_id left join clubs c on c.id = p.club_id where s.club_id = $1 order by s.created_at desc`, [me.id]);
  const bids = rows.length ? await db.many<{ player_id: number; status: string; id: number }>(`select distinct on (player_id) player_id, status, id from bids where from_club = $1 and player_id = any($2) order by player_id, updated_at desc`, [me.id, rows.map((r) => r.id)]) : [];
  const out = await rowsOut(rows, me, w.season_no);
  return {
    players: out.map((p) => {
      const b = bids.find((x) => x.player_id === p.id);
      const status = p.clubId === me.id ? 'Signed' : b ? ({ pending: 'Bid pending', countered: 'Counter-offer', rejected: 'Bid rejected', player_refused: 'Turned you down', accepted: 'Agreed', completed: 'Signed', expired: 'Bid expired', withdrawn: 'Withdrawn' } as Record<string, string>)[b.status] ?? b.status : p.scouting ? 'Scouting in progress' : 'Interested';
      return { ...p, status, bidId: b?.id ?? null };
    }),
  };
}
export type ShortlistData = Awaited<ReturnType<typeof shortlistData>>;
route('GET', '/api/transfers/shortlist', 'user', shortlistData);

// ---------------------------------------------------------------- offers
function bidOut(b: BidRow & { name: string }, clubs: Map<number, ReturnType<Awaited<ReturnType<typeof clubMap>>['get']>>) {
  return {
    id: b.id, playerId: b.player_id, player: b.name, from: clubs.get(b.from_club) ?? null, to: b.to_club ? clubs.get(b.to_club) ?? null : null,
    fee: Number(b.fee), counterFee: b.counter_fee ? Number(b.counter_fee) : null, wage: b.wage, years: b.years, promise: b.promise, status: b.status,
    updatedAt: new Date(b.updated_at).toISOString(), expiresAt: new Date(b.expires_at).toISOString(), last: b.thread?.[b.thread.length - 1]?.text ?? null,
  };
}

export async function offersData(ctx: Ctx) {
  const w = await world();
  const me = await myClub(ctx);
  const clubs = await clubMap();
  const incoming = await db.many<BidRow & { name: string }>(`select b.*, p.name from bids b join players p on p.id = b.player_id where b.to_club = $1 and (b.status in ('pending','countered') or b.updated_at > now() - interval '5 days') order by b.status in ('pending','countered') desc, b.updated_at desc limit 30`, [me.id]);
  const outgoing = await db.many<BidRow & { name: string }>(`select b.*, p.name from bids b join players p on p.id = b.player_id where b.from_club = $1 and (b.status in ('pending','countered','accepted') or b.updated_at > now() - interval '7 days') order by b.status in ('pending','countered') desc, b.updated_at desc limit 30`, [me.id]);
  const squad = await squadOf(db, me.id);
  return {
    windowOpen: windowOpen(w),
    incoming: incoming.map((b) => {
      const p = squad.find((x) => x.id === b.player_id);
      const buyer = clubs.get(b.from_club);
      const reaction = !p ? null : p.flags?.wantsOut ? 'Keen to go' : (buyer && p.flags?.listed) ? 'Open to a move' : 'Happy to stay';
      const sameLine = p ? squad.filter((x) => x.id !== p.id && Object.entries(p.positions).some(([k, v]) => (v ?? 0) >= 0.85 && (x.positions[k as Pos] ?? 0) >= 0.85)).length : 0;
      return { ...bidOut(b, clubs), reaction, value: p ? Number(p.value) : null, cover: sameLine, warning: p?.flags?.wantsOut ? 'He wants this move. Turning it down will upset him.' : null };
    }),
    outgoing: outgoing.map((b) => bidOut(b, clubs)),
  };
}
export type OffersData = Awaited<ReturnType<typeof offersData>>;
route('GET', '/api/transfers/offers', 'user', offersData);

export async function negotiationData(ctx: Ctx) {
  const w = await world();
  const me = await myClub(ctx);
  const b = await db.one<BidRow & { name: string }>('select b.*, p.name from bids b join players p on p.id = b.player_id where b.id = $1', [idParam(ctx)]);
  if (!b || (b.from_club !== me.id && b.to_club !== me.id)) throw new ApiError('NOT_FOUND', 'Negotiation not found.');
  const clubs = await clubMap();
  const [p] = await loadPlayers(db, 'id = $1', [b.player_id]);
  const role = b.from_club === me.id ? 'buyer' : 'seller';
  const open = ['pending', 'countered'].includes(b.status);
  return {
    bid: bidOut(b, clubs), role,
    player: p ? playerLite(p, w.season_no) : null,
    thread: b.thread ?? [],
    can: {
      accept: open && ((role === 'buyer' && b.status === 'countered') || (role === 'seller' && b.status === 'pending')),
      counter: open && role === 'seller' && b.status === 'pending',
      raise: role === 'buyer' && ['countered', 'pending', 'rejected'].includes(b.status),
      withdraw: role === 'buyer' && open,
      reject: role === 'seller' && b.status === 'pending',
    },
    windowOpen: windowOpen(w),
  };
}
export type NegotiationData = Awaited<ReturnType<typeof negotiationData>>;
route('GET', '/api/transfers/negotiate/:id', 'user', negotiationData);

// ---------------------------------------------------------------- quotes and bids
export async function quoteData(ctx: Ctx) {
  const w = await world();
  const me = await myClub(ctx);
  const [p] = await loadPlayers(db, 'id = $1', [int(ctx.query.get('playerId'), 'playerId')]);
  if (!p) throw new ApiError('NOT_FOUND', 'Player not found.');
  const seller = p.club_id ? await db.one<ClubRow>('select * from clubs where id = $1', [p.club_id]) : null;
  const sellerSquad = seller ? await squadOf(db, seller.id) : [];
  const isFree = !seller || p.status === 'free';
  const terms = sellerTerms(p, seller, sellerSquad, w);
  const sellerHuman = seller?.manager_type === 'human' && !seller.meta?.botTakeover;
  const value = Number(p.value);
  const feeCurve = isFree || sellerHuman ? [] : Array.from({ length: 31 }, (_, i) => {
    const fee = Math.round((value * (0.5 + i * 0.05)) / 100_000) * 100_000;
    return { fee, p: Math.round(acceptanceLikelihood(fee, terms.min) * 100) / 100 };
  });
  const base = termsLikelihood(p, me, seller, p.wage, 3, null, w);
  const promises = [null, 'key', 'rotation', 'backup'] as const;
  const termsCurves = [];
  for (const promise of promises) for (let years = 1; years <= 5; years++) {
    termsCurves.push({
      promise, years,
      points: Array.from({ length: 21 }, (_, i) => {
        const wage = Math.round((base.demand * (0.6 + i * 0.05)) / 500) * 500;
        return { wage, p: Math.round(termsLikelihood(p, me, seller, wage, years, promise, w).p * 100) / 100 };
      }),
    });
  }
  const wageBill = (await db.one<{ s: number }>(`select coalesce(sum(wage), 0)::bigint s from players where club_id = $1 and status = 'active'`, [me.id]))?.s ?? 0;
  const stanceText: Record<string, string> = { untouchable: 'Not for sale', reluctant: 'Reluctant to sell', consider: 'Would consider offers', selling: isFree ? 'Free agent' : 'Actively selling' };
  return {
    player: playerLite(p, w.season_no), club: seller ? { id: seller.id, short: seller.short, name: seller.name, human: sellerHuman } : null,
    isFree, value, stance: stanceText[terms.stance], askingPrice: p.flags?.askingPrice ?? null, sellerHuman,
    feeCurve, demand: base.demand, termsCurves,
    balance: me.balance, overdraft: 20_000_000, wageBill: Number(wageBill), wageBudget: wageBudgetWeekly(me),
    windowOpen: windowOpen(w), embargo: !!me.finances.embargo,
  };
}
export type QuoteData = Awaited<ReturnType<typeof quoteData>>;
route('GET', '/api/transfers/quote', 'user', quoteData);

route('POST', '/api/transfers/bid', 'user', async (ctx) => {
  const playerId = int(ctx.body.playerId, 'playerId', { min: 1 });
  const fee = int(ctx.body.fee ?? 0, 'fee', { min: 0, max: 1_000_000_000 });
  const wage = int(ctx.body.wage, 'wage', { min: 500, max: 3_000_000 });
  const years = int(ctx.body.years ?? 3, 'years', { min: 1, max: 5 });
  const promise = ctx.body.promise ? oneOf(ctx.body.promise, 'promise', ['key', 'rotation', 'backup'] as const) : null;
  const bid = await tx(async (t) => {
    const w = await world(t);
    const me = await myClub(ctx, t, true);
    return placeBid(t, w, me, playerId, { fee, wage, years, promise, by: 'user' });
  });
  await db.q('insert into shortlist (club_id, player_id) values ($1, $2) on conflict do nothing', [bid.from_club, playerId]);
  return { bidId: bid.id, status: bid.status, respondAt: bid.respond_at ? new Date(bid.respond_at).toISOString() : null };
});

route('POST', '/api/transfers/bids/:id', 'user', async (ctx) => {
  const id = idParam(ctx);
  const action = String(ctx.body.action ?? '');
  const fee = ctx.body.fee !== undefined ? int(ctx.body.fee, 'fee', { min: 0 }) : undefined;
  return tx(async (t) => {
    const w = await world(t);
    const me = await myClub(ctx, t, true);
    const b = await t.one<BidRow>('select * from bids where id = $1 for update', [id]);
    if (!b) throw new ApiError('NOT_FOUND', 'Bid not found.');
    if (b.to_club === me.id) {
      const a = oneOf(action, 'action', ['accept', 'reject', 'counter'] as const);
      return respondAsSeller(t, w, me, id, a, fee);
    }
    if (b.from_club === me.id) {
      const a = oneOf(action, 'action', ['accept', 'withdraw', 'raise'] as const);
      return respondAsBuyer(t, w, me, id, a, fee);
    }
    throw new ApiError('NOT_FOUND', 'Bid not found.');
  });
});

// ---------------------------------------------------------------- scouting
export async function scoutingData(ctx: Ctx) {
  const w = await world();
  const me = await myClub(ctx);
  const rows = await db.many<PlayerRow & { knowledge: number; assigned: boolean; league: string | null; updated: Date }>(
    `select p.*, s.knowledge, s.assigned, c.league, s.updated_at updated from scouting s join players p on p.id = s.player_id left join clubs c on c.id = p.club_id
      where s.club_id = $1 and (s.assigned or s.knowledge >= 80) order by s.assigned desc, s.updated_at desc limit 40`, [me.id]);
  const clubs = await clubMap();
  const limit = 2 + Math.floor((me.staff.scout?.rating ?? 8) / 5);
  return {
    scout: me.staff.scout ?? null, limit,
    active: rows.filter((r) => r.assigned).map((r) => ({ ...playerLite(r, w.season_no), club: r.club_id ? clubs.get(r.club_id) ?? null : null, knowledge: r.knowledge, daysLeft: Math.max(1, Math.ceil((100 - r.knowledge) / (6 + (me.staff.scout?.rating ?? 8) * 0.9))) })),
    reports: rows.filter((r) => !r.assigned).map((r) => ({ ...playerLite(r, w.season_no), club: r.club_id ? clubs.get(r.club_id) ?? null : null, report: scoutAssessment(r, r.knowledge, me.id), recommendedRole: null as string | null })),
  };
}
export type ScoutingData = Awaited<ReturnType<typeof scoutingData>>;
route('GET', '/api/transfers/scouting', 'user', scoutingData);

void knowledgeOf;
void bad;
