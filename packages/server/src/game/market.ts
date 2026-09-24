// The transfer market: valuation stance, bids and negotiation, personal terms, free agents,
// releases, contract renewals, and the bot clubs' daily market behaviour.
import { Rng, wageDemand, contractAcceptance, playerReputation, roundMoney, positionRating, bestRoleAt } from '@ffm/engine';
import { db, type Db } from '../db.ts';
import { ApiError } from '../http/router.ts';
import { HOUR, MINUTE } from '../lib/time.ts';
import { addLedger, wageBudgetWeekly } from './finance.ts';
import { addNews } from './news.ts';
import { notifyClub } from './notify.ts';
import { attrsOf, hiddenOf, isGoalkeeper, mainPosition, loadPlayers, valueOf, lineOf } from './players.ts';
import type { ClubRow, PlayerRow, WorldRow, Archetype } from './types.ts';

export interface BidRow {
  id: number; player_id: number; from_club: number; to_club: number | null; fee: number; wage: number; years: number;
  promise: 'key' | 'rotation' | 'backup' | null; status: string; counter_fee: number | null;
  thread: { by: 'buyer' | 'seller' | 'player' | 'system'; text: string; fee?: number; at: string }[];
  created_at: Date; updated_at: Date; respond_at: Date | null; expires_at: Date;
}

export const MAX_SQUAD = 32;
export const MIN_SQUAD = 18;

export function windowOpen(world: WorldRow): boolean {
  return !!world.transfer_window?.open;
}

// ---------------------------------------------------------------- seller stance
export type Stance = 'untouchable' | 'reluctant' | 'consider' | 'selling';

export function squadRank(p: PlayerRow, squad: PlayerRow[]): number {
  return squad.filter((x) => x.ca > p.ca).length + 1;
}

/** Minimum fee a (bot) seller will accept, and its public stance. */
export function sellerTerms(p: PlayerRow, seller: ClubRow | null, squad: PlayerRow[], world: WorldRow): { min: number; stance: Stance } {
  if (!seller) return { min: 0, stance: 'selling' };
  const value = p.value || valueOf(p, world.season_no);
  const rank = squadRank(p, squad);
  let m = 1.15;
  let stance: Stance = 'consider';
  if (p.flags?.newSigning === world.season_no && !p.flags?.listed) { return { min: roundMoney(value * 2.6), stance: 'untouchable' }; }
  if (p.flags?.listed) { m = 0.85; stance = 'selling'; }
  else if (p.flags?.wantsOut) { m = 0.95; stance = 'selling'; }
  else if (rank <= 2 && p.age <= 29) { m = 1.9; stance = 'untouchable'; }
  else if (rank <= 5) { m = 1.45; stance = 'reluctant'; }
  else if (rank > 18) { m = 0.95; stance = 'selling'; }
  const yearsLeft = p.contract_until - world.season_no;
  if (yearsLeft <= 0) m *= 0.75;
  else if (yearsLeft === 1) m *= 0.9;
  const a: Archetype = seller.bot?.archetype ?? 'pragmatist';
  if (a === 'youth' && p.age >= 26) { m *= 0.88; if (stance === 'untouchable') stance = 'reluctant'; }
  if (a === 'chequebook') m *= 1.1;
  if (a === 'pragmatist') m = Math.max(m, 1.0);
  if (seller.league !== 'PL') m *= 0.92; // pool clubs sell to the rich league
  if (p.flags?.askingPrice && seller.manager_type === 'human') return { min: p.flags.askingPrice, stance };
  return { min: roundMoney(value * m), stance };
}

export function acceptanceLikelihood(fee: number, min: number): number {
  if (min <= 0) return 0.99;
  const x = (fee / min - 1) * 11;
  return Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(-x))));
}

/** Probability the player agrees personal terms with the buying club. */
export function termsLikelihood(p: PlayerRow, buyer: ClubRow, seller: ClubRow | null, wage: number, years: number, promise: BidRow['promise'], world: WorldRow): { p: number; demand: number } {
  const h = hiddenOf(p);
  const demand = wageDemand({ ca: p.ca, age: p.age, ambition: h.ambition, currentWage: seller ? p.wage : undefined }, buyer.reputation);
  const prep = playerReputation(p.ca);
  let prob = contractAcceptance(wage, demand, years, { age: p.age, loyalty: h.loyalty, clubRep: buyer.reputation, playerRep: prep, promise: promise ?? undefined });
  if (seller && buyer.reputation < seller.reputation - 12 && h.ambition >= 14) prob *= 0.6;
  if (buyer.meta?.europe === 'UCL') prob = Math.min(0.99, prob * 1.12);
  if (seller && (seller.meta?.rivals ?? []).includes(buyer.key) && h.loyalty >= 15) prob *= 0.5;
  void world;
  return { p: Math.max(0.01, Math.min(0.99, prob)), demand };
}

// ---------------------------------------------------------------- bids
async function loadClub(d: Db, id: number | null): Promise<ClubRow | null> {
  if (!id) return null;
  return d.one<ClubRow>('select * from clubs where id = $1', [id]);
}

export async function squadSize(d: Db, clubId: number): Promise<number> {
  const r = await d.one<{ n: number }>(`select count(*)::int n from players where club_id = $1 and status = 'active'`, [clubId]);
  return r?.n ?? 0;
}

export async function placeBid(d: Db, world: WorldRow, buyer: ClubRow, playerId: number, opts: { fee: number; wage: number; years: number; promise?: BidRow['promise']; by: 'user' | 'bot'; now?: Date }): Promise<BidRow> {
  const now = opts.now ?? new Date();
  const [p] = await loadPlayers(d, 'id = $1', [playerId]);
  if (!p || (p.status !== 'active' && p.status !== 'free')) throw new ApiError('NOT_FOUND', 'That player is not available.');
  if (p.club_id === buyer.id) throw new ApiError('VALIDATION_FAILED', 'He already plays for you.');
  const isFree = p.status === 'free' || !p.club_id;
  if (!isFree && !windowOpen(world)) throw new ApiError('WINDOW_CLOSED', 'The transfer window is closed. Free agents can still be signed.');
  if (!isFree && buyer.finances.embargo) throw new ApiError('INSUFFICIENT_FUNDS', 'You are under a transfer embargo. Only free agents can be signed until your balance recovers.');
  const fee = isFree ? 0 : Math.max(0, Math.round(opts.fee));
  if (fee > Math.max(0, buyer.balance) + 20_000_000) throw new ApiError('INSUFFICIENT_FUNDS', 'You cannot afford that fee.');
  if ((await squadSize(d, buyer.id)) >= MAX_SQUAD) throw new ApiError('SQUAD_INVALID', `Squad limit is ${MAX_SQUAD} players. Sell or release someone first.`);
  const years = Math.max(1, Math.min(5, Math.round(opts.years)));
  const wage = Math.max(500, Math.round(opts.wage / 100) * 100);
  const dup = await d.one<{ id: number }>(`select id from bids where player_id = $1 and from_club = $2 and status in ('pending','countered')`, [playerId, buyer.id]);
  if (dup) throw new ApiError('CONFLICT', 'You already have an open bid for this player.');
  const seller = await loadClub(d, p.club_id);
  const sellerHuman = seller?.manager_type === 'human' && !seller.meta?.botTakeover;
  const rng = new Rng(`${world.secret}:bid:${playerId}:${buyer.id}:${now.getTime()}`);
  const respondAt = sellerHuman ? null : new Date(now.getTime() + (isFree ? 20 : rng.int(15, 150)) * MINUTE);
  const expires = new Date(now.getTime() + 48 * HOUR);
  const text = isFree ? `Contract offer: £${fmtK(wage)}/wk for ${years} years.` : `Bid of £${fmtM(fee)}, wages £${fmtK(wage)}/wk over ${years} years.`;
  const bid = await d.one<BidRow>(
    `insert into bids (player_id, from_club, to_club, fee, wage, years, promise, status, thread, respond_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) returning *`,
    [playerId, buyer.id, p.club_id, fee, wage, years, opts.promise ?? null, JSON.stringify([{ by: 'buyer', text, fee, at: now.toISOString() }]), respondAt, expires],
  );
  if (sellerHuman && seller) {
    await notifyClub(d, seller.id, { type: 'bid', title: `Bid received: £${fmtM(fee)} for ${p.name}`, body: `${buyer.short} want ${p.short}. Respond within 48 hours.`, link: '/transfers/offers' });
  }
  return bid!;
}

export async function processBids(d: Db, world: WorldRow, now: Date) {
  // Expire stale bids
  const stale = await d.many<BidRow>(`select * from bids where status in ('pending','countered') and expires_at <= $1`, [now]);
  for (const b of stale) {
    await d.q(`update bids set status = 'expired', updated_at = $2 where id = $1`, [b.id, now]);
    const [p] = await loadPlayers(d, 'id = $1', [b.player_id]);
    if (p) await notifyClub(d, b.from_club, { type: 'bid', title: `Bid for ${p.name} expired`, body: 'No agreement was reached in time.', link: '/transfers/offers' });
  }
  const due = await d.many<BidRow>(`select * from bids where status in ('pending','countered') and respond_at is not null and respond_at <= $1 order by respond_at limit 60`, [now]);
  for (const b of due) {
    try {
      await resolveAutomated(d, world, b, now);
    } catch (e) {
      console.error('bid resolution failed', b.id, e);
      await d.q(`update bids set status = 'rejected', updated_at = $2 where id = $1`, [b.id, now]);
    }
  }
}

/** Bot seller decisions, free-agent decisions, and bot buyers answering counter-offers. */
async function resolveAutomated(d: Db, world: WorldRow, b: BidRow, now: Date) {
  const [p] = await loadPlayers(d, 'id = $1', [b.player_id]);
  const buyer = await loadClub(d, b.from_club);
  if (!p || !buyer || (p.club_id !== b.to_club)) {
    await d.q(`update bids set status = 'withdrawn', updated_at = $2 where id = $1`, [b.id, now]);
    return;
  }
  const seller = await loadClub(d, p.club_id);
  const rng = new Rng(`${world.secret}:resolve:${b.id}:${b.updated_at}`);
  const thread = b.thread ?? [];
  if (b.status === 'countered') {
    // Only reached for bot buyers (human buyers answer themselves).
    const counter = b.counter_fee ?? b.fee;
    const budget = transferBudget(buyer);
    const maxPay = (p.value || valueOf(p, world.season_no)) * buyerMaxFactor(buyer.bot.archetype);
    if (counter <= budget && counter <= maxPay && rng.chance(0.75)) {
      thread.push({ by: 'buyer', text: `We accept £${fmtM(counter)}.`, fee: counter, at: now.toISOString() });
      await d.q(`update bids set fee = $2, status = 'accepted', thread = $3, updated_at = $4 where id = $1`, [b.id, counter, JSON.stringify(thread), now]);
      await completeTransfer(d, world, b.id, now);
    } else {
      thread.push({ by: 'buyer', text: 'Too rich for us. We walk away.', at: now.toISOString() });
      await d.q(`update bids set status = 'withdrawn', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
      if (seller?.manager_type === 'human') await notifyClub(d, seller.id, { type: 'bid', title: `${buyer.short} walked away`, body: `No deal for ${p.name}.`, link: '/transfers/offers' });
    }
    return;
  }
  if (!seller) {
    // Free agent: decides on personal terms only
    await d.q(`update bids set status = 'accepted', updated_at = $2 where id = $1`, [b.id, now]);
    await completeTransfer(d, world, b.id, now);
    return;
  }
  const squad = await loadPlayers(d, `club_id = $1 and status = 'active'`, [seller.id]);
  const { min } = sellerTerms(p, seller, squad, world);
  const threshold = min * (0.96 + rng.next() * 0.08);
  if (squad.length <= MIN_SQUAD + 1 && !p.flags?.listed) {
    thread.push({ by: 'seller', text: 'We cannot let anyone else leave right now.', at: now.toISOString() });
    await d.q(`update bids set status = 'rejected', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
  } else if (b.fee >= threshold) {
    thread.push({ by: 'seller', text: 'Offer accepted. You may discuss terms with the player.', at: now.toISOString() });
    await d.q(`update bids set status = 'accepted', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
    await completeTransfer(d, world, b.id, now);
    return;
  } else if (b.fee >= min * 0.72) {
    const counter = roundMoney(min * (1 + rng.next() * 0.06));
    const reason = counter > (p.value || 0) * 1.4 ? 'He is a key player for us.' : 'That undervalues him.';
    thread.push({ by: 'seller', text: `${reason} We would take £${fmtM(counter)}.`, fee: counter, at: now.toISOString() });
    const buyerHuman = buyer.manager_type === 'human' && !buyer.meta?.botTakeover;
    await d.q(`update bids set status = 'countered', counter_fee = $2, thread = $3, updated_at = $4, respond_at = $5, expires_at = $6 where id = $1`, [
      b.id, counter, JSON.stringify(thread), now, buyerHuman ? null : new Date(now.getTime() + rng.int(20, 180) * MINUTE), new Date(now.getTime() + 48 * HOUR),
    ]);
    if (buyerHuman) await notifyClub(d, buyer.id, { type: 'bid', title: `${seller.short} countered: £${fmtM(counter)} for ${p.name}`, body: 'Accept, raise or walk away within 48 hours.', link: `/transfers/negotiate/${b.id}` });
  } else {
    thread.push({ by: 'seller', text: 'Not interested at that price.', at: now.toISOString() });
    await d.q(`update bids set status = 'rejected', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
    if (buyer.manager_type === 'human') await notifyClub(d, buyer.id, { type: 'bid', title: `Bid rejected: ${p.name}`, body: `${seller.short} turned down £${fmtM(b.fee)}.`, link: `/transfers/negotiate/${b.id}` });
  }
  await publicBidNews(d, world, b, p, buyer, seller, rng);
}

async function publicBidNews(d: Db, world: WorldRow, b: BidRow, p: PlayerRow, buyer: ClubRow, seller: ClubRow, rng: Rng) {
  if (b.fee < 15_000_000 || !rng.chance(0.5)) return;
  const status = (await d.one<{ status: string }>('select status from bids where id = $1', [b.id]))?.status;
  const verb = status === 'rejected' ? 'have a' : status === 'countered' ? 'see a' : 'make a';
  await addNews(d, world, { type: 'rumour', clubIds: [buyer.id, seller.id], headline: `${buyer.short} ${verb} £${fmtM(b.fee)} bid for ${p.name}${status === 'rejected' ? ' rejected' : status === 'countered' ? ' countered' : ''}`, body: `${seller.short} ${status === 'rejected' ? 'turned it down' : status === 'countered' ? 'want more' : 'are considering it'}.`, importance: 1 });
}

export async function respondAsSeller(d: Db, world: WorldRow, seller: ClubRow, bidId: number, action: 'accept' | 'reject' | 'counter', counterFee: number | undefined, now = new Date()) {
  const b = await d.one<BidRow>('select * from bids where id = $1', [bidId]);
  if (!b || b.to_club !== seller.id) throw new ApiError('NOT_FOUND', 'Bid not found.');
  if (b.status !== 'pending') throw new ApiError('CONFLICT', 'This bid is no longer open.');
  if (action !== 'reject' && !windowOpen(world)) throw new ApiError('WINDOW_CLOSED', 'The transfer window is closed.');
  const thread = b.thread ?? [];
  const buyer = await loadClub(d, b.from_club);
  const [p] = await loadPlayers(d, 'id = $1', [b.player_id]);
  if (action === 'accept') {
    thread.push({ by: 'seller', text: 'Offer accepted.', at: now.toISOString() });
    await d.q(`update bids set status = 'accepted', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
    return completeTransfer(d, world, b.id, now);
  }
  if (action === 'reject') {
    thread.push({ by: 'seller', text: 'Offer rejected.', at: now.toISOString() });
    await d.q(`update bids set status = 'rejected', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
    // Rejecting a good offer for an unsettled player has consequences
    if (p && (p.flags?.wantsOut || hiddenOf(p).ambition >= 15) && buyer && buyer.reputation > seller.reputation) {
      await d.q('update players set morale = greatest(0.9, morale - 0.04) where id = $1', [p.id]);
    }
    if (buyer?.manager_type === 'human') await notifyClub(d, buyer.id, { type: 'bid', title: `Bid rejected: ${p?.name}`, body: `${seller.short} said no.`, link: `/transfers/negotiate/${b.id}` });
    return { status: 'rejected' };
  }
  const fee = Math.round(counterFee ?? 0);
  if (fee <= b.fee) throw new ApiError('VALIDATION_FAILED', 'A counter-offer must be higher than their bid.');
  thread.push({ by: 'seller', text: `We would accept £${fmtM(fee)}.`, fee, at: now.toISOString() });
  const buyerHuman = buyer?.manager_type === 'human' && !buyer.meta?.botTakeover;
  await d.q(`update bids set status = 'countered', counter_fee = $2, thread = $3, updated_at = $4, respond_at = $5, expires_at = $6 where id = $1`, [
    b.id, fee, JSON.stringify(thread), now, buyerHuman ? null : new Date(now.getTime() + 45 * MINUTE), new Date(now.getTime() + 48 * HOUR),
  ]);
  if (buyerHuman && buyer) await notifyClub(d, buyer.id, { type: 'bid', title: `${seller.short} countered: £${fmtM(fee)} for ${p?.name}`, body: 'Accept, raise or walk away.', link: `/transfers/negotiate/${b.id}` });
  return { status: 'countered' };
}

export async function respondAsBuyer(d: Db, world: WorldRow, buyer: ClubRow, bidId: number, action: 'accept' | 'withdraw' | 'raise', fee: number | undefined, now = new Date()) {
  const b = await d.one<BidRow>('select * from bids where id = $1', [bidId]);
  if (!b || b.from_club !== buyer.id) throw new ApiError('NOT_FOUND', 'Bid not found.');
  if (!['countered', 'pending', 'rejected'].includes(b.status)) throw new ApiError('CONFLICT', 'This negotiation is closed.');
  const thread = b.thread ?? [];
  if (action === 'withdraw') {
    thread.push({ by: 'buyer', text: 'We withdraw our interest.', at: now.toISOString() });
    await d.q(`update bids set status = 'withdrawn', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
    return { status: 'withdrawn' };
  }
  if (!windowOpen(world) && b.to_club) throw new ApiError('WINDOW_CLOSED', 'The transfer window is closed.');
  if (action === 'accept') {
    if (b.status !== 'countered' || !b.counter_fee) throw new ApiError('CONFLICT', 'There is no counter-offer to accept.');
    if (b.counter_fee > Math.max(0, buyer.balance) + 20_000_000) throw new ApiError('INSUFFICIENT_FUNDS', 'You cannot afford that fee.');
    thread.push({ by: 'buyer', text: `We accept £${fmtM(b.counter_fee)}.`, fee: b.counter_fee, at: now.toISOString() });
    await d.q(`update bids set fee = counter_fee, status = 'accepted', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
    return completeTransfer(d, world, b.id, now);
  }
  const newFee = Math.round(fee ?? 0);
  if (newFee <= b.fee) throw new ApiError('VALIDATION_FAILED', 'Raise the fee to make a new offer.');
  if (newFee > Math.max(0, buyer.balance) + 20_000_000) throw new ApiError('INSUFFICIENT_FUNDS', 'You cannot afford that fee.');
  const seller = await loadClub(d, b.to_club);
  const sellerHuman = seller?.manager_type === 'human' && !seller.meta?.botTakeover;
  thread.push({ by: 'buyer', text: `Improved offer: £${fmtM(newFee)}.`, fee: newFee, at: now.toISOString() });
  await d.q(`update bids set fee = $2, status = 'pending', counter_fee = null, thread = $3, updated_at = $4, respond_at = $5, expires_at = $6 where id = $1`, [
    b.id, newFee, JSON.stringify(thread), now, sellerHuman ? null : new Date(now.getTime() + 30 * MINUTE), new Date(now.getTime() + 48 * HOUR),
  ]);
  if (sellerHuman && seller) await notifyClub(d, seller.id, { type: 'bid', title: `Improved bid: £${fmtM(newFee)}`, body: `${buyer.short} raised their offer.`, link: '/transfers/offers' });
  return { status: 'pending' };
}

/** Personal terms, then the move itself. */
export async function completeTransfer(d: Db, world: WorldRow, bidId: number, now = new Date()): Promise<{ status: string; reason?: string }> {
  const b = await d.one<BidRow>('select * from bids where id = $1', [bidId]);
  if (!b || b.status !== 'accepted') return { status: b?.status ?? 'missing' };
  const [p] = await loadPlayers(d, 'id = $1', [b.player_id]);
  const buyer = await loadClub(d, b.from_club);
  if (!p || !buyer) return { status: 'missing' };
  const seller = await loadClub(d, p.club_id);
  const rng = new Rng(`${world.secret}:terms:${b.id}`);
  const terms = termsLikelihood(p, buyer, seller, b.wage, b.years, b.promise, world);
  const thread = b.thread ?? [];
  if (!rng.chance(terms.p)) {
    const text = b.wage < terms.demand * 0.95 ? `The player wants around £${fmtK(terms.demand)}/wk.` : 'The player does not want to join.';
    thread.push({ by: 'player', text, at: now.toISOString() });
    await d.q(`update bids set status = 'player_refused', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
    await notifyClub(d, buyer.id, { type: 'bid', title: `${p.name} turned you down`, body: text, link: `/transfers/negotiate/${b.id}` });
    return { status: 'player_refused', reason: text };
  }
  if ((await squadSize(d, buyer.id)) >= MAX_SQUAD) {
    await d.q(`update bids set status = 'rejected', updated_at = $2 where id = $1`, [b.id, now]);
    return { status: 'rejected', reason: 'Squad full' };
  }
  // Money
  if (b.fee > 0) {
    await addLedger(d, buyer.id, world.season_no, 'fee', -b.fee, `Signed ${p.name}${seller ? ` from ${seller.short}` : ''}`);
    if (seller) await addLedger(d, seller.id, world.season_no, 'sale', b.fee, `Sold ${p.name} to ${buyer.short}`);
  }
  const number = await freeSquadNumber(d, buyer.id, p.squad_number);
  const history = [...(p.history ?? []), { season: world.season_no, club: buyer.short, fee: b.fee, kind: b.fee ? 'transfer' : 'free' }];
  const flags = { ...(p.flags ?? {}), listed: false, askingPrice: undefined, wantsOut: false, unhappy: false, promise: b.promise, newSigning: world.season_no };
  await d.q(
    `update players set club_id = $2, status = 'active', wage = $3, contract_until = $4, squad_number = $5, flags = $6, history = $7,
       joined_season = $8, sharpness = least(sharpness, 70), morale = greatest(morale, 1.02) where id = $1`,
    [p.id, buyer.id, b.wage, world.season_no + b.years - 1 + (world.phase === 'postseason' ? 1 : 0), number, JSON.stringify(flags), JSON.stringify(history), world.season_no],
  );
  thread.push({ by: 'system', text: 'Transfer complete.', at: now.toISOString() });
  await d.q(`update bids set status = 'completed', thread = $2, updated_at = $3 where id = $1`, [b.id, JSON.stringify(thread), now]);
  await d.q(`update bids set status = 'withdrawn', updated_at = $2 where player_id = $1 and id <> $3 and status in ('pending','countered')`, [p.id, now, b.id]);
  await d.q(`delete from shortlist where club_id = $1 and player_id = $2`, [buyer.id, p.id]);
  await d.q(`insert into transfers (season_no, player_id, player_name, from_club, to_club, fee, wage, kind) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    world.season_no, p.id, p.name, seller?.id ?? null, buyer.id, b.fee, b.wage, b.fee ? 'transfer' : 'free',
  ]);
  // remove from both clubs' saved XIs
  if (seller) await scrubFromTactics(d, seller.id, p.id);
  const big = b.fee >= 30_000_000;
  await addNews(d, world, {
    type: 'transfer', clubIds: [buyer.id, ...(seller ? [seller.id] : [])], importance: big ? 2 : 1,
    headline: b.fee ? `${buyer.short} sign ${p.name} for £${fmtM(b.fee)}` : `${buyer.short} snap up free agent ${p.name}`,
    body: seller ? `${p.name} (${p.age}) joins from ${seller.short} on a ${b.years}-year deal.` : `${p.name} (${p.age}) signs a ${b.years}-year deal.`,
  });
  await notifyClub(d, buyer.id, { type: 'transfer', title: `Done deal: ${p.name} signs`, body: b.fee ? `£${fmtM(b.fee)} from ${seller?.short}.` : 'Free transfer.', link: `/player/${p.id}` });
  if (seller) await notifyClub(d, seller.id, { type: 'transfer', title: `${p.name} has left`, body: `Sold to ${buyer.short} for £${fmtM(b.fee)}.`, link: '/transfers' });
  return { status: 'completed' };
}

async function scrubFromTactics(d: Db, clubId: number, playerId: number) {
  const rows = await d.many<{ id: number; lineup: number[]; bench: number[] }>('select id, lineup, bench from tactics where club_id = $1', [clubId]);
  for (const r of rows) {
    if (!(r.lineup ?? []).includes(playerId) && !(r.bench ?? []).includes(playerId)) continue;
    await d.q('update tactics set lineup = $2, bench = $3 where id = $1', [r.id, JSON.stringify((r.lineup ?? []).map((x) => (x === playerId ? -1 : x))), JSON.stringify((r.bench ?? []).filter((x) => x !== playerId))]);
  }
}

async function freeSquadNumber(d: Db, clubId: number, preferred: number | null): Promise<number> {
  const taken = new Set((await d.many<{ n: number }>(`select squad_number n from players where club_id = $1 and status = 'active' and squad_number is not null`, [clubId])).map((r) => r.n));
  if (preferred && preferred < 100 && !taken.has(preferred)) return preferred;
  for (let n = 2; n < 99; n++) if (!taken.has(n) && n !== 1) return n;
  return 99;
}

export async function releasePlayer(d: Db, world: WorldRow, club: ClubRow, playerId: number) {
  const [p] = await loadPlayers(d, 'id = $1 and club_id = $2', [playerId, club.id]);
  if (!p) throw new ApiError('NOT_FOUND', 'Player not found.');
  const years = Math.max(0, p.contract_until - world.season_no + 1);
  const comp = Math.round(p.wage * 52 * years * 0.5);
  if (comp) await addLedger(d, club.id, world.season_no, 'compensation', -comp, `Released ${p.name}`);
  await d.q(`update players set club_id = null, status = 'free', contract_until = 0, squad_number = null, flags = '{}' where id = $1`, [p.id]);
  await d.q(`insert into transfers (season_no, player_id, player_name, from_club, to_club, fee, wage, kind) values ($1,$2,$3,$4,null,0,0,'release')`, [world.season_no, p.id, p.name, club.id]);
  await scrubFromTactics(d, club.id, p.id);
  return { compensation: comp };
}

export async function offerRenewal(d: Db, world: WorldRow, club: ClubRow, playerId: number, wage: number, years: number, now = new Date()) {
  const [p] = await loadPlayers(d, 'id = $1 and club_id = $2', [playerId, club.id]);
  if (!p) throw new ApiError('NOT_FOUND', 'Player not found.');
  if (p.flags?.noRenewal) throw new ApiError('CONFLICT', `${p.short} does not want to talk about a new contract right now.`);
  const h = hiddenOf(p);
  const demand = wageDemand({ ca: p.ca, age: p.age, ambition: h.ambition, currentWage: p.wage }, club.reputation);
  const prob = contractAcceptance(wage, demand, years, { age: p.age, loyalty: h.loyalty, clubRep: club.reputation, playerRep: playerReputation(p.ca) }) * (p.flags?.wantsOut ? 0.4 : 1);
  const rng = new Rng(`${world.secret}:renew:${p.id}:${now.getTime()}`);
  if (rng.chance(prob)) {
    const until = world.season_no + Math.max(1, Math.min(5, years)) - 1 + (world.phase === 'postseason' ? 1 : 0);
    await d.q(`update players set wage = $2, contract_until = $3, flags = flags - 'renewalAsked' - 'refusals' where id = $1`, [p.id, Math.round(wage), until]);
    await addNews(d, world, { type: 'transfer', clubIds: [club.id], headline: `${p.name} signs a new deal at ${club.short}`, body: `${years} years, reportedly around £${fmtK(wage)} a week.`, importance: 1 });
    return { accepted: true, demand };
  }
  // A second rejection in quick succession makes him stall talks
  const refusals = Number((p.flags as Record<string, unknown>)?.refusals ?? 0) + 1;
  await d.q(`update players set flags = flags || $2::jsonb where id = $1`, [p.id, JSON.stringify({ refusals, ...(refusals >= 3 ? { noRenewal: true } : {}) })]);
  return { accepted: false, demand };
}

export function renewalLikelihood(p: PlayerRow, club: ClubRow, wage: number, years: number): { p: number; demand: number } {
  const h = hiddenOf(p);
  const demand = wageDemand({ ca: p.ca, age: p.age, ambition: h.ambition, currentWage: p.wage }, club.reputation);
  return { p: contractAcceptance(wage, demand, years, { age: p.age, loyalty: h.loyalty, clubRep: club.reputation, playerRep: playerReputation(p.ca) }) * (p.flags?.wantsOut ? 0.4 : 1), demand };
}

// ---------------------------------------------------------------- bot market
export function transferBudget(c: ClubRow): number {
  const spend = { chequebook: 0.85, gegenpresser: 0.6, purist: 0.65, pragmatist: 0.5, counter: 0.5, cynic: 0.35, youth: 0.45, tinkerman: 0.6 }[c.bot?.archetype ?? 'pragmatist'];
  return Math.max(0, Math.round((c.balance - 5_000_000) * spend * (c.bot?.traits?.spend ?? 1)));
}

function buyerMaxFactor(a: Archetype): number {
  return { chequebook: 1.6, purist: 1.35, gegenpresser: 1.3, pragmatist: 1.12, counter: 1.2, cynic: 1.05, youth: 1.25, tinkerman: 1.4 }[a];
}

function bidFactor(a: Archetype, rng: Rng): number {
  const r = rng.next();
  switch (a) {
    case 'chequebook': return 1.1 + r * 0.25;
    case 'pragmatist': return 0.85 + r * 0.15;
    case 'cynic': return 0.8 + r * 0.15;
    case 'youth': return 0.92 + r * 0.15;
    default: return 0.92 + r * 0.2;
  }
}

const NEED_POSITIONS = ['GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'AMC', 'AML', 'AMR', 'ST'] as const;

interface Need { pos: string; urgency: number; bestCa: number; count: number }

export function assessNeeds(squad: PlayerRow[], clubLevel: number): Need[] {
  const out: Need[] = [];
  for (const pos of NEED_POSITIONS) {
    const fits = squad.filter((p) => (p.positions[pos] ?? 0) >= 0.85).map((p) => ({ p, r: positionRating(attrsOf(p), p.positions, pos) })).sort((a, b) => b.r - a.r);
    const healthy = fits.filter((f) => !(f.p.injury && f.p.injury.daysLeft > 14));
    const want = pos === 'DC' ? 4 : pos === 'GK' ? 2 : pos === 'MC' ? 4 : pos === 'ST' ? 3 : 2;
    const bestCa = healthy[0]?.r ?? 0;
    let urgency = 0;
    if (healthy.length < want) urgency += (want - healthy.length) * 18;
    if (bestCa < clubLevel - 6) urgency += (clubLevel - bestCa) * 1.2;
    const second = healthy[want - 1]?.r ?? healthy[healthy.length - 1]?.r ?? 0;
    if (second < clubLevel - 20) urgency += 6;
    out.push({ pos, urgency, bestCa, count: healthy.length });
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

export async function botMarketDay(d: Db, world: WorldRow, now: Date, intensity = 1) {
  const rng = new Rng(`${world.secret}:market:${now.toISOString().slice(0, 13)}`);
  const clubs = await d.many<ClubRow>(`select * from clubs where manager_type = 'bot' or (meta->>'botTakeover')::boolean is true`);
  const open = windowOpen(world);
  let bids = 0;
  for (const c of rng.shuffle(clubs)) {
    const squad = await loadPlayers(d, `club_id = $1 and status = 'active'`, [c.id]);
    if (!squad.length) continue;
    const level = squad.map((p) => p.ca).sort((a, b) => b - a).slice(0, 13).reduce((s, v, _, arr) => s + v / arr.length, 0);
    const isPool = c.league !== 'PL';
    // Housekeeping: trim bloated squads, fill thin ones with free agents.
    if (squad.length > 30) {
      const surplus = squad.filter((p) => !isGoalkeeper(p) || squad.filter(isGoalkeeper).length > 3).sort((a, b) => a.ca - b.ca)[0];
      if (surplus && surplus.ca < level - 15) {
        if (open) await d.q(`update players set flags = flags || '{"listed": true}' where id = $1`, [surplus.id]);
        else if (squad.length > 32) await releasePlayer(d, world, c, surplus.id);
      }
    }
    const needs = assessNeeds(squad, level);
    const top = needs[0];
    if (squad.length < 21 || (top && top.count < 2)) {
      const need = top?.count < 2 ? top.pos : needs.find((n) => n.count < 3)?.pos ?? 'MC';
      await signFreeAgentFor(d, world, c, need, level, rng, now);
    }
    if (!open || c.finances.embargo) continue;
    // List surplus / ageing players (Youth Builders sell at the peak)
    if (rng.chance(0.08 * intensity)) {
      const cand = squad.filter((p) => !p.flags?.listed && (c.bot.archetype === 'youth' ? p.age >= 27 : p.age >= 31) && squadRank(p, squad) > 11).sort((a, b) => b.age - a.age)[0];
      if (cand) await d.q(`update players set flags = flags || '{"listed": true}' where id = $1`, [cand.id]);
    }
    // Buying
    const pending = await d.one<{ n: number }>(`select count(*)::int n from bids where from_club = $1 and status in ('pending','countered')`, [c.id]);
    const pBuy = (isPool ? 0.05 : 0.2) * intensity * (c.bot.archetype === 'chequebook' ? 1.6 : c.bot.archetype === 'cynic' ? 0.6 : 1);
    if ((pending?.n ?? 0) >= 2 || !rng.chance(pBuy) || !top || top.urgency < 4) continue;
    const budget = transferBudget(c);
    if (budget < 1_000_000) continue;
    const target = await findTarget(d, world, c, top, level, budget, rng);
    if (!target) continue;
    const fee = roundMoney(Math.min(budget, (target.value || valueOf(target, world.season_no)) * bidFactor(c.bot.archetype, rng)));
    const demand = wageDemand({ ca: target.ca, age: target.age, ambition: hiddenOf(target).ambition, currentWage: target.wage }, c.reputation);
    const wb = wageBudgetWeekly(c);
    const bill = squad.reduce((s, p) => s + p.wage, 0);
    if (bill + demand > wb * 1.15 && c.bot.archetype !== 'chequebook') continue;
    const years = target.age >= 30 ? 2 : target.age >= 27 ? 3 : 4;
    try {
      await placeBid(d, world, c, target.id, { fee, wage: Math.round(demand * (1 + rng.next() * 0.12)), years, by: 'bot', now });
      bids++;
    } catch {
      // validation failures are normal market noise
    }
  }
  return bids;
}

async function findTarget(d: Db, world: WorldRow, c: ClubRow, need: Need, level: number, budget: number, rng: Rng): Promise<PlayerRow | null> {
  const a = c.bot.archetype;
  const [minAge, maxAge] = a === 'youth' ? [17, 24] : a === 'cynic' ? [26, 33] : a === 'gegenpresser' ? [18, 28] : [18, 31];
  const minCa = Math.max(need.bestCa + 3, level - 8);
  const cands = await loadPlayers(d,
    `status in ('active','free') and coalesce(club_id, 0) <> $1 and (positions->>$2)::float >= 0.85 and ca >= $3 and age between $4 and $5
       and value <= $6 and id not in (select player_id from bids where from_club = $1 and status in ('pending','countered','rejected','player_refused') and updated_at > now() - interval '10 days')
     order by ca desc limit 40`,
    [c.id, need.pos, Math.round(minCa), minAge, maxAge, Math.round(budget * 0.9)]);
  if (!cands.length) return null;
  let best: PlayerRow | null = null;
  let bv = -Infinity;
  for (const p of cands) {
    const gain = positionRating(attrsOf(p), p.positions, need.pos as 'MC') - need.bestCa;
    const price = (p.value || 1_000_000) / 1_000_000;
    let score = gain * 2 + (need.urgency / 10) - Math.sqrt(price) * 0.9;
    const at = attrsOf(p);
    if (a === 'purist') score += (at.passing + at.vision - 260) / 20;
    if (a === 'gegenpresser') score += (at.stamina + at.workRate - 260) / 20;
    if (a === 'counter') score += lineOf(mainPosition(p)) === 'ATT' ? (at.pace - 130) / 15 : (at.strength - 130) / 20;
    if (a === 'chequebook') score += p.ca / 20;
    if (a === 'youth') score += (24 - p.age) * 1.5;
    if (p.status === 'free') score += 4;
    score += rng.normal(0, 3);
    if (score > bv) { bv = score; best = p; }
  }
  void bestRoleAt;
  return best;
}

async function signFreeAgentFor(d: Db, world: WorldRow, c: ClubRow, pos: string, level: number, rng: Rng, now: Date) {
  const fa = await loadPlayers(d, `status = 'free' and (positions->>$1)::float >= 0.85 and ca >= $2 order by ca desc limit 8`, [pos, Math.round(level - 35)]);
  const p = fa.sort((a, b) => b.ca - a.ca + rng.normal(0, 4))[0];
  if (!p) return;
  const demand = wageDemand({ ca: p.ca, age: p.age, ambition: hiddenOf(p).ambition }, c.reputation);
  try {
    await placeBid(d, world, c, p.id, { fee: 0, wage: demand, years: p.age >= 30 ? 1 : 2, by: 'bot', now });
  } catch {
    // ignore
  }
}

export function fmtM(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 100_000_000 ? 0 : 1).replace(/\.0$/, '')}m`;
  return `${Math.round(v / 1000)}k`;
}
export function fmtK(v: number): string {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;
}

void db;
