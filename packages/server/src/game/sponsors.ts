// Sponsorship offers, club vision goals, facilities and staff: the president's levers.
import { Rng, randomName } from '@ffm/engine';
import type { Db } from '../db.ts';
import { ApiError } from '../http/router.ts';
import { DAY } from '../lib/time.ts';
import { addLedger } from './finance.ts';
import { namePools } from './seed.ts';
import { staffWage } from './world.ts';
import type { ClubRow, SponsorDeal, StaffRole, VisionGoal, WorldRow, Facilities } from './types.ts';

const BRANDS = ['Northwind Air', 'Kestrel Bank', 'Voltara Energy', 'Bluepeak Telecom', 'Orbital Bet', 'Halcyon Motors', 'Crestline Insurance', 'Meridian Cloud', 'Sable Coffee', 'Nimbus Travel', 'Arcadia Games', 'Tidewater Logistics', 'Solstice Mobile', 'Granite Build', 'Lumen Pay'];

export function makeSponsorOffers(c: Pick<ClubRow, 'reputation' | 'league' | 'meta'>, rng: Rng): SponsorDeal[] {
  const base = (c.league === 'PL' ? 6_000_000 : 3_000_000) + Math.max(0, c.reputation - 50) * 900_000;
  const r = (v: number) => Math.round(v / 500_000) * 500_000;
  const brands = rng.shuffle(BRANDS.slice());
  return [
    { name: brands[0], guaranteed: r(base), bonus: null, seasonsLeft: 2 },
    { name: brands[1], guaranteed: r(base * 0.62), bonus: { kind: c.reputation >= 80 ? 'ucl' : 'top4', amount: r(base * 0.6) }, seasonsLeft: 2 },
    { name: brands[2], guaranteed: r(base * 0.3), bonus: { kind: 'trophy', amount: r(base * 0.28) }, seasonsLeft: 1 },
  ];
}

export function sponsorSummary(s: SponsorDeal): string {
  if (!s.bonus) return `£${m(s.guaranteed)} a season, guaranteed.`;
  if (s.bonus.kind === 'trophy') return `£${m(s.guaranteed)} plus £${m(s.bonus.amount)} for every trophy.`;
  const what = s.bonus.kind === 'ucl' ? 'you qualify for the Champions League' : s.bonus.kind === 'top4' ? 'you finish in the top four' : 'you win the league';
  return `Worth £${m(s.guaranteed + s.bonus.amount)} if ${what}, £${m(s.guaranteed)} if you do not.`;
}

function m(v: number) {
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}m` : `${Math.round(v / 1000)}k`;
}

export async function acceptSponsor(d: Db, club: ClubRow, index: number) {
  const offers = club.finances.sponsorOffers ?? [];
  const pick = offers[index];
  if (!pick) throw new ApiError('NOT_FOUND', 'Offer not found.');
  if (club.finances.sponsor && club.finances.sponsor.seasonsLeft > 0) throw new ApiError('CONFLICT', 'You already have a sponsor locked in.');
  await d.q(`update clubs set finances = finances || $2::jsonb where id = $1`, [club.id, JSON.stringify({ sponsor: pick, sponsorOffers: null })]);
  return pick;
}

// ---- vision
export const VISION_KINDS: { kind: VisionGoal['kind']; label: string; needs?: 'club' | 'number' }[] = [
  { kind: 'beat_rival', label: 'Beat a rival home and away', needs: 'club' },
  { kind: 'win_league', label: 'Win the league' },
  { kind: 'top4', label: 'Finish in the top four' },
  { kind: 'top_half', label: 'Finish in the top half' },
  { kind: 'survive', label: 'Stay out of the bottom three' },
  { kind: 'win_cup', label: 'Win a domestic cup' },
  { kind: 'euro_final', label: 'Reach a European final' },
  { kind: 'youth_minutes', label: 'Give 1,500 minutes to under-21s', needs: 'number' },
  { kind: 'transfer_profit', label: 'Turn a transfer profit' },
];

// ---- facilities
export const FACILITY_COST: Record<'training' | 'youth' | 'medical', number[]> = {
  training: [0, 0, 8_000_000, 15_000_000, 28_000_000, 45_000_000],
  youth: [0, 0, 6_000_000, 12_000_000, 22_000_000, 38_000_000],
  medical: [0, 0, 5_000_000, 10_000_000, 18_000_000, 30_000_000],
};
export const FACILITY_DAYS = [0, 0, 14, 21, 35, 49];
export const FACILITY_EFFECT: Record<'training' | 'youth' | 'medical' | 'stadium', string> = {
  training: 'Faster player development for the whole squad.',
  youth: 'Better youth intakes each summer.',
  medical: 'Fewer training injuries and quicker recoveries.',
  stadium: 'More seats, more gate receipts.',
};

export async function startUpgrade(d: Db, world: WorldRow, club: ClubRow, kind: 'training' | 'youth' | 'medical' | 'stadium', now = new Date()) {
  const f: Facilities = club.facilities;
  if (f.building) throw new ApiError('CONFLICT', 'Something is already being built.');
  if (kind === 'stadium') {
    const seats = Math.max(2000, Math.round(club.capacity * 0.12 / 500) * 500);
    const cost = seats * 6_500;
    if (club.balance < cost) throw new ApiError('INSUFFICIENT_FUNDS', `You need £${m(cost)} for the expansion.`);
    await addLedger(d, club.id, world.season_no, 'facility', -cost, `Stadium expansion (+${seats} seats)`);
    const completesAt = new Date(now.getTime() + 60 * DAY).toISOString();
    await d.q(`update clubs set facilities = jsonb_set(facilities, '{building}', $2::jsonb) where id = $1`, [club.id, JSON.stringify({ kind, toLevel: 0, completesAt, seats })]);
    return { cost, completesAt, seats };
  }
  const level = f[kind] ?? 1;
  if (level >= 5) throw new ApiError('CONFLICT', 'Already at the top tier.');
  const cost = FACILITY_COST[kind][level + 1];
  if (club.balance < cost) throw new ApiError('INSUFFICIENT_FUNDS', `You need £${m(cost)} for this upgrade.`);
  await addLedger(d, club.id, world.season_no, 'facility', -cost, `${kind} facility upgrade to tier ${level + 1}`);
  const completesAt = new Date(now.getTime() + FACILITY_DAYS[level + 1] * DAY).toISOString();
  await d.q(`update clubs set facilities = jsonb_set(facilities, '{building}', $2::jsonb) where id = $1`, [club.id, JSON.stringify({ kind, toLevel: level + 1, completesAt })]);
  return { cost, completesAt };
}

// ---- staff
export const STAFF_INFO: Record<StaffRole, { label: string; effect: (r: number) => string }> = {
  assistant: { label: 'Assistant manager', effect: (r) => `Picks your team when you miss a deadline; opposition reports ${Math.round(40 + r * 3)}% accurate.` },
  coach: { label: 'Head of coaching', effect: (r) => `Training gains ${r >= 10 ? '+' : ''}${(r - 10) * 2}%.` },
  fitness: { label: 'Fitness coach', effect: (r) => `Condition recovery ${r >= 10 ? '+' : ''}${Math.round((r - 10) * 1.5)}%.` },
  physio: { label: 'Head physio', effect: (r) => `Injury duration ${r >= 10 ? '-' : '+'}${Math.abs((r - 10) * 2)}%.` },
  scout: { label: 'Chief scout', effect: (r) => `Scouting speed ${r >= 10 ? '+' : ''}${Math.round((r - 8) * 9)}%; potential ranges narrow faster.` },
};

export function staffCandidates(world: WorldRow, club: ClubRow, role: StaffRole) {
  const rng = new Rng(`${world.secret}:staff:${club.id}:${role}:${world.season_no}:${world.transfer_window?.kind ?? ''}`);
  const out = [];
  for (let i = 0; i < 5; i++) {
    const rating = Math.max(4, Math.min(20, Math.round(8 + rng.normal(0, 3.5) + (club.reputation - 70) / 8)));
    const nat = rng.chance(0.6) ? club.country : rng.pick(['ENG', 'ESP', 'GER', 'NED', 'POR', 'ITA', 'FRA', 'SCO', 'IRL', 'BEL', 'DEN', 'BRA', 'ARG']);
    const nm = randomName(rng, namePools(), nat);
    const spec = rng.pick(['a meticulous planner', 'a great communicator', 'well connected', 'a former player', 'data-driven', 'demanding but fair']);
    out.push({ id: i, name: `${nm.first} ${nm.last}`, nat, rating, wage: staffWage(rating), note: `Known as ${spec}.` });
  }
  return out;
}

export async function hireStaff(d: Db, world: WorldRow, club: ClubRow, role: StaffRole, candidateId: number) {
  const cand = staffCandidates(world, club, role).find((c) => c.id === candidateId);
  if (!cand) throw new ApiError('NOT_FOUND', 'Candidate not found.');
  const current = club.staff[role];
  if (current) {
    const severance = current.wage * 26;
    await addLedger(d, club.id, world.season_no, 'compensation', -severance, `Severance: ${current.name}`);
  }
  await d.q(`update clubs set staff = jsonb_set(staff, $2::text[], $3::jsonb) where id = $1`, [club.id, `{${role}}`, JSON.stringify({ name: cand.name, rating: cand.rating, wage: cand.wage, nat: cand.nat })]);
  return cand;
}
