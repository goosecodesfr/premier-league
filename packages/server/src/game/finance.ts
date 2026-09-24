// Club finances: ledger, gate receipts, weekly wages and income, prize money, guard rails.
import type { Db } from '../db.ts';
import type { ClubRow, CompType, WorldRow } from './types.ts';

export type LedgerCat = 'gate' | 'tv' | 'prize' | 'sponsor' | 'sale' | 'event' | 'merit' | 'wages' | 'staff' | 'fee' | 'facility' | 'running' | 'interest' | 'compensation';
const INCOME: LedgerCat[] = ['gate', 'tv', 'prize', 'sponsor', 'sale', 'event', 'merit'];

export async function addLedger(d: Db, clubId: number, seasonNo: number, cat: LedgerCat, amount: number, description: string) {
  if (!amount) return;
  const amt = Math.round(amount);
  await d.q('insert into ledger (club_id, season_no, category, amount, description) values ($1, $2, $3, $4, $5)', [clubId, seasonNo, cat, amt, description.slice(0, 200)]);
  const bucket = amt >= 0 && INCOME.includes(cat) ? 'seasonIncome' : 'seasonExpense';
  await d.q(
    `update clubs set balance = balance + $2,
       finances = jsonb_set(finances, $3::text[], to_jsonb(coalesce((finances->$4->>$5)::bigint, 0) + $6::bigint), true)
     where id = $1`,
    [clubId, amt, `{${bucket},${cat}}`, bucket, cat, Math.abs(amt)],
  );
}

export const TV_EQUAL_SHARE = { PL: 60_000_000, EUR: 40_000_000, CHAMP: 12_000_000 } as const;

/** Attendance and gate revenue for a home match. */
export function gate(club: Pick<ClubRow, 'capacity' | 'reputation' | 'fan_mood' | 'finances'>, opts: { importance: number; oppRep: number; comp: CompType; neutral: boolean }): { attendance: number; revenue: number } {
  const t = club.finances.tickets ?? { general: 50, premium: 130 };
  const fair = 22 + club.reputation * 0.45;
  const priceF = Math.max(0.35, Math.min(1.1, 1.05 - (t.general - fair) / (fair * 1.8)));
  const moodF = 0.72 + (club.fan_mood / 100) * 0.33;
  const bigGame = Math.min(1.15, 0.92 + opts.importance * 0.06 + (opts.oppRep - 60) / 400);
  const compF = opts.comp === 'league_cup' ? 0.78 : opts.comp === 'fa_cup' ? 0.88 : 1;
  const fill = Math.max(0.3, Math.min(1, priceF * moodF * bigGame * compF));
  const attendance = Math.round(club.capacity * fill);
  const avgTicket = t.general * 0.86 + t.premium * 0.14;
  const revenue = opts.neutral ? Math.round(attendance * avgTicket * 0.35) : Math.round(attendance * avgTicket);
  return { attendance, revenue };
}

/** Ticket price readout for the finances screen. */
export function ticketPreview(club: Pick<ClubRow, 'capacity' | 'reputation' | 'fan_mood' | 'finances'>, general: number, premium: number) {
  const c = { ...club, finances: { ...club.finances, tickets: { general, premium } } };
  const g = gate(c, { importance: 1, oppRep: 70, comp: 'league', neutral: false });
  const fair = 22 + club.reputation * 0.45;
  const mood = general > fair * 1.35 ? 'angry' : general > fair * 1.15 ? 'grumbling' : general < fair * 0.8 ? 'delighted' : 'content';
  return { attendancePct: Math.round((g.attendance / club.capacity) * 100), revenuePerMatch: g.revenue, fanMood: mood, fair: Math.round(fair) };
}

// Prize money (compressed so European qualifiers don't snowball)
export const PRIZES: Partial<Record<CompType, Record<string, number>>> = {
  ucl: { participation: 12_000_000, win: 2_000_000, draw: 600_000, R16: 7_000_000, QF: 8_000_000, SF: 10_000_000, F: 12_000_000, winner: 4_000_000 },
  uel: { participation: 3_500_000, win: 600_000, draw: 200_000, R16: 1_500_000, QF: 2_000_000, SF: 3_000_000, F: 4_000_000, winner: 2_000_000 },
  fa_cup: { R32: 100_000, R16: 180_000, QF: 400_000, SF: 1_000_000, F: 1_800_000, winner: 1_500_000 },
  league_cup: { R16: 100_000, QF: 150_000, SF: 300_000, F: 500_000, winner: 500_000 },
  shield: { winner: 500_000 },
  super_cup: { winner: 3_000_000 },
};

export function meritPayment(pos: number): number {
  return Math.max(0, (21 - pos) * 2_000_000);
}

export async function weeklyWagesAndIncome(d: Db, world: WorldRow) {
  const weeks = Math.max(10, world.state.seasonWeeks ?? 20);
  const clubs = await d.many<ClubRow & { wagebill: number }>(
    `select c.*, coalesce((select sum(wage) from players p where p.club_id = c.id and p.status = 'active'), 0)::bigint as wagebill from clubs c`,
  );
  for (const c of clubs) {
    const wages = (c.wagebill * 52) / weeks;
    const staff = Object.values(c.staff ?? {}).reduce((s, m) => s + (m?.wage ?? 0), 0) * 52 / weeks;
    // Pool clubs are simulated at lower fidelity: their income tracks their wage bill so they stay solvent.
    const tv = c.league === 'PL' ? (TV_EQUAL_SHARE.PL / weeks) : (wages + staff) * 1.04 + (TV_EQUAL_SHARE[c.league] ?? 0) / weeks * 0.3;
    const sponsor = c.finances.sponsor ? c.finances.sponsor.guaranteed / weeks : (c.league === 'PL' ? 8_000_000 + c.reputation * 250_000 : 4_000_000 + c.reputation * 100_000) / weeks;
    const f = c.facilities;
    const running = (c.capacity * 450 + ((f.training ?? 1) + (f.youth ?? 1) + (f.medical ?? 1)) * 1_200_000) / weeks;
    await addLedger(d, c.id, world.season_no, 'wages', -wages, 'Player wages');
    await addLedger(d, c.id, world.season_no, 'staff', -staff, 'Staff wages');
    await addLedger(d, c.id, world.season_no, 'tv', tv, 'Broadcast income');
    await addLedger(d, c.id, world.season_no, 'sponsor', sponsor, c.finances.sponsor ? `${c.finances.sponsor.name} sponsorship` : 'Commercial income');
    await addLedger(d, c.id, world.season_no, 'running', -running, 'Stadium and running costs');
  }
  // Interest on overdrafts and embargo guard rails
  const neg = await d.many<{ id: number; balance: number; finances: ClubRow['finances']; manager_type: string }>('select id, balance, finances, manager_type from clubs where balance < 0');
  for (const c of neg) {
    await addLedger(d, c.id, world.season_no, 'interest', c.balance * 0.004, 'Overdraft interest');
  }
  await d.q(`update clubs set finances = jsonb_set(finances, '{embargo}', 'true') where balance < -30000000`);
  await d.q(`update clubs set finances = jsonb_set(finances, '{embargo}', 'false') where balance >= -10000000 and (finances->>'embargo')::boolean is true`);
}

/** Rough season revenue estimate used for budgets. */
export function revenueEstimate(c: Pick<ClubRow, 'league' | 'capacity' | 'reputation' | 'finances' | 'meta'>): number {
  const tv = TV_EQUAL_SHARE[c.league] ?? 0;
  const t = c.finances.tickets ?? { general: 50, premium: 130 };
  const gateR = c.capacity * 0.9 * (t.general * 0.86 + t.premium * 0.14) * 19;
  const sponsor = c.finances.sponsor?.guaranteed ?? (c.league === 'PL' ? 8_000_000 + c.reputation * 250_000 : 4_000_000 + c.reputation * 100_000);
  const merit = c.league === 'PL' ? meritPayment(c.meta?.lastPos ?? 10) : 0;
  const europe = c.meta?.europe === 'UCL' ? 25_000_000 : c.meta?.europe === 'UEL' ? 7_000_000 : 0;
  return tv + gateR + sponsor + merit + europe;
}

export function wageBudgetWeekly(c: Parameters<typeof revenueEstimate>[0]): number {
  return Math.round((revenueEstimate(c) * 0.68) / 52 / 1000) * 1000;
}

/** Projected end-of-season balance: current balance plus remaining scheduled income and costs. */
export async function projectedBalance(d: Db, world: WorldRow, club: ClubRow): Promise<{ projected: number; weeksLeft: number; wageBill: number }> {
  const wb = await d.one<{ s: number }>(`select coalesce(sum(wage), 0)::bigint s from players where club_id = $1 and status = 'active'`, [club.id]);
  const wageBill = wb?.s ?? 0;
  const weeks = Math.max(10, world.state.seasonWeeks ?? 20);
  let weeksLeft = weeks;
  if (world.phase === 'season' && world.state.seasonStartAt) {
    const elapsed = (Date.now() - new Date(world.state.seasonStartAt).getTime()) / (7 * 86400000);
    weeksLeft = Math.max(0, Math.round(weeks - elapsed));
  }
  if (world.phase === 'postseason') weeksLeft = 0;
  const perWeekCost = (wageBill * 52) / weeks + Object.values(club.staff ?? {}).reduce((s, m) => s + (m?.wage ?? 0), 0) * 52 / weeks + (club.capacity * 450) / weeks;
  const perWeekIncome = (TV_EQUAL_SHARE[club.league] ?? 0) / weeks + (club.finances.sponsor?.guaranteed ?? (8_000_000 + club.reputation * 250_000)) / weeks;
  const t = club.finances.tickets ?? { general: 50, premium: 130 };
  const homeLeft = Math.round((weeksLeft / weeks) * 19);
  const gateLeft = homeLeft * club.capacity * 0.88 * (t.general * 0.86 + t.premium * 0.14);
  const merit = club.league === 'PL' && world.phase !== 'postseason' ? meritPayment(club.meta?.lastPos ?? 10) : 0;
  const projected = club.balance + weeksLeft * (perWeekIncome - perWeekCost) + gateLeft + merit;
  return { projected: Math.round(projected), weeksLeft, wageBill };
}
