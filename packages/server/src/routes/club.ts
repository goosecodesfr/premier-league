// Club tab: overview, finances and tickets, facilities, staff, sponsorship, vision, trophy cabinet, and
// handing the club over to (or reclaiming it from) the assistant.
import { db, tx } from '../db.ts';
import { ApiError, bad, route, type Ctx } from '../http/router.ts';
import { leagueStandings } from '../game/competitions.ts';
import { gate, projectedBalance, ticketPreview, wageBudgetWeekly } from '../game/finance.ts';
import { transferBudget } from '../game/market.ts';
import {
  FACILITY_COST, FACILITY_DAYS, FACILITY_EFFECT, STAFF_INFO, VISION_KINDS, acceptSponsor, hireStaff, sponsorSummary, staffCandidates, startUpgrade,
} from '../game/sponsors.ts';
import { leaveClub, setBotTakeover } from '../game/season.ts';
import { visionProgress, VISION_REWARD } from '../game/vision.ts';
import { STAFF_ROLES } from '../game/world.ts';
import type { ClubRow, FixtureRow, StaffRole, VisionGoal } from '../game/types.ts';
import { clubMap, int, myClub, oneOf, ordinal, world } from './common.ts';

export async function clubOverview(ctx: Ctx) {
  const w = await world();
  const club = await myClub(ctx);
  const clubs = await clubMap();
  const table = await leagueStandings(db, w.season_no);
  const idx = table.findIndex((r) => r.clubId === club.id);
  const trophies = await db.one<{ n: number }>(`select count(*)::int n from honours where club_id = $1 and place = 'winner'`, [club.id]);
  const vision = await visionProgress(db, w, club);
  const proj = await projectedBalance(db, w, club);
  const f = club.facilities;
  return {
    club: clubs.get(club.id)!, stadium: club.stadium, capacity: club.capacity, reputation: club.reputation, fanMood: club.fan_mood,
    position: idx >= 0 && table[idx].p > 0 ? ordinal(idx + 1) : null, form: idx >= 0 ? table[idx].form : [],
    expectation: club.meta?.expectation ? ordinal(club.meta.expectation) : null,
    botTakeover: !!club.meta?.botTakeover, missedDeadlines: club.meta?.missedDeadlines ?? 0,
    tiles: {
      balance: club.balance, projected: proj.projected,
      facilities: { training: f.training, youth: f.youth, medical: f.medical, building: f.building ?? null },
      staff: STAFF_ROLES.filter((r) => club.staff[r]).length,
      sponsor: club.finances.sponsor ? { name: club.finances.sponsor.name, guaranteed: club.finances.sponsor.guaranteed, seasonsLeft: club.finances.sponsor.seasonsLeft } : null,
      sponsorOffers: club.finances.sponsorOffers?.length ?? 0,
      visionSet: (club.vision ?? []).length,
      trophies: trophies?.n ?? 0,
    },
    vision,
    embargo: !!club.finances.embargo,
  };
}
export type ClubOverviewData = Awaited<ReturnType<typeof clubOverview>>;
route('GET', '/api/club', 'user', clubOverview);

// ---------------------------------------------------------------- finances
export async function financesData(ctx: Ctx) {
  const w = await world();
  const club = await myClub(ctx);
  const proj = await projectedBalance(db, w, club);
  const cat = ctx.query.get('cat');
  const ledger = await db.many<{ id: number; created_at: Date; category: string; amount: number; description: string; season_no: number }>(
    `select id, created_at, category, amount, description, season_no from ledger where club_id = $1 ${cat ? 'and category = $2' : ''} order by id desc limit 150`, cat ? [club.id, cat] : [club.id]);
  const history = await db.many<{ week: Date; balance: number }>(
    `select date_trunc('week', created_at) week, sum(amount)::bigint balance from ledger where club_id = $1 and created_at > now() - interval '26 weeks' group by 1 order by 1`, [club.id]);
  // rebuild a balance trend by walking back from today's balance
  let running = club.balance;
  const trend: { week: string; balance: number }[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    trend.unshift({ week: new Date(history[i].week).toISOString(), balance: running });
    running -= Number(history[i].balance);
  }
  const t = club.finances.tickets ?? { general: 50, premium: 130 };
  const fair = 22 + club.reputation * 0.45;
  const curve = [];
  for (let price = 10; price <= 160; price += 2) {
    const g = gate({ ...club, finances: { ...club.finances, tickets: { general: price, premium: t.premium } } }, { importance: 1, oppRep: 70, comp: 'league', neutral: false });
    curve.push({ price, attendancePct: Math.round((g.attendance / club.capacity) * 1000) / 10 });
  }
  return {
    balance: club.balance, projected: proj.projected, weeksLeft: proj.weeksLeft, wageBill: proj.wageBill,
    wageBudget: wageBudgetWeekly(club), transferBudget: transferBudget(club), embargo: !!club.finances.embargo,
    income: club.finances.seasonIncome ?? {}, expense: club.finances.seasonExpense ?? {},
    lastSeason: club.finances.lastSeason ?? null,
    ledger: ledger.map((l) => ({ id: l.id, at: new Date(l.created_at).toISOString(), category: l.category, amount: Number(l.amount), description: l.description, season: l.season_no })),
    trend,
    tickets: { general: t.general, premium: t.premium, fair: Math.round(fair), capacity: club.capacity, fanMood: club.fan_mood, curve, preview: ticketPreview(club, t.general, t.premium) },
    season: w.season_label,
  };
}
export type FinancesData = Awaited<ReturnType<typeof financesData>>;
route('GET', '/api/club/finances', 'user', financesData);

route('PUT', '/api/club/tickets', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const general = int(ctx.body.general, 'General price', { min: 10, max: 160 });
  const premium = int(ctx.body.premium, 'Premium price', { min: general, max: 600 });
  await db.q(`update clubs set finances = jsonb_set(finances, '{tickets}', $2::jsonb) where id = $1`, [club.id, JSON.stringify({ general, premium })]);
  return { tickets: { general, premium }, preview: ticketPreview(club, general, premium) };
});

// ---------------------------------------------------------------- facilities
route('GET', '/api/club/facilities', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const f = club.facilities;
  const seats = Math.max(2000, Math.round((club.capacity * 0.12) / 500) * 500);
  const avgTicket = (club.finances.tickets?.general ?? 50) * 0.86 + (club.finances.tickets?.premium ?? 130) * 0.14;
  const tracks = (['training', 'youth', 'medical'] as const).map((k) => {
    const level = f[k] ?? 1;
    const next = level < 5 ? { cost: FACILITY_COST[k][level + 1], days: FACILITY_DAYS[level + 1] } : null;
    return { kind: k, level, effect: FACILITY_EFFECT[k], next, affordable: next ? club.balance >= next.cost : false };
  });
  return {
    balance: club.balance,
    building: f.building ?? null,
    tracks: [
      ...tracks,
      { kind: 'stadium' as const, level: Math.min(5, Math.max(1, Math.round(club.capacity / 15000))), capacity: club.capacity, effect: FACILITY_EFFECT.stadium,
        next: { cost: seats * 6500, days: 60, seats, revenuePerMatch: Math.round(seats * 0.9 * avgTicket) }, affordable: club.balance >= seats * 6500 },
    ],
  };
});

route('POST', '/api/club/facilities/:kind', 'user', async (ctx) => {
  const kind = oneOf(ctx.params.kind, 'kind', ['training', 'youth', 'medical', 'stadium'] as const);
  return tx(async (t) => {
    const w = await world(t);
    const club = await myClub(ctx, t, true);
    return startUpgrade(t, w, club, kind);
  });
});

// ---------------------------------------------------------------- staff
route('GET', '/api/club/staff', 'user', async (ctx) => {
  const w = await world();
  const club = await myClub(ctx);
  return {
    roles: STAFF_ROLES.map((role) => {
      const m = club.staff[role];
      return {
        role, label: STAFF_INFO[role].label, member: m ?? null, effect: m ? STAFF_INFO[role].effect(m.rating) : null, severance: m ? m.wage * 26 : 0,
        candidates: staffCandidates(w, club, role).map((c) => ({ ...c, effect: STAFF_INFO[role].effect(c.rating) })),
      };
    }),
    balance: club.balance,
  };
});

route('POST', '/api/club/staff/:role', 'user', async (ctx) => {
  const role = oneOf(ctx.params.role, 'role', STAFF_ROLES as unknown as readonly StaffRole[]);
  const candidateId = int(ctx.body.candidateId, 'candidateId', { min: 0, max: 10 });
  return tx(async (t) => {
    const w = await world(t);
    const club = await myClub(ctx, t, true);
    const hired = await hireStaff(t, w, club, role, candidateId);
    return { hired };
  });
});

// ---------------------------------------------------------------- sponsorship
route('GET', '/api/club/sponsorship', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const s = club.finances.sponsor;
  return {
    current: s ? { ...s, summary: sponsorSummary(s) } : null,
    offers: (club.finances.sponsorOffers ?? []).map((o, i) => ({ ...o, index: i, summary: sponsorSummary(o) })),
  };
});

route('POST', '/api/club/sponsorship', 'user', async (ctx) => {
  const index = int(ctx.body.index, 'index', { min: 0, max: 5 });
  return tx(async (t) => {
    const club = await myClub(ctx, t, true);
    return { sponsor: await acceptSponsor(t, club, index) };
  });
});

// ---------------------------------------------------------------- vision
route('GET', '/api/club/vision', 'user', async (ctx) => {
  const w = await world();
  const club = await myClub(ctx);
  const clubs = await clubMap();
  const editable = w.phase === 'preseason' || !(club.vision ?? []).length || ((await db.one<{ n: number }>(`select count(*)::int n from fixtures where season_no = $1 and status = 'played' and (home_id = $2 or away_id = $2)`, [w.season_no, club.id]))?.n ?? 0) < 3;
  return {
    goals: await visionProgress(db, w, club),
    kinds: VISION_KINDS,
    rivals: [...clubs.values()].filter((c) => c.league === 'PL' && c.id !== club.id).sort((a, b) => Number(b.human) - Number(a.human) || a.name.localeCompare(b.name)),
    editable,
    reward: VISION_REWARD,
  };
});

route('PUT', '/api/club/vision', 'user', async (ctx) => {
  const w = await world();
  const club = await myClub(ctx);
  const played = (await db.one<{ n: number }>(`select count(*)::int n from fixtures where season_no = $1 and status = 'played' and (home_id = $2 or away_id = $2)`, [w.season_no, club.id]))?.n ?? 0;
  if (w.phase !== 'preseason' && (club.vision ?? []).length && played >= 3) throw new ApiError('CONFLICT', 'The board has noted your goals. They are locked for this season.');
  if (!Array.isArray(ctx.body.goals)) throw bad('goals must be a list');
  const goals: VisionGoal[] = [];
  const seen = new Set<string>();
  for (const g of ctx.body.goals.slice(0, 3)) {
    const k = VISION_KINDS.find((x) => x.kind === g?.kind);
    if (!k) continue;
    const key = `${k.kind}:${g.clubId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const goal: VisionGoal = { kind: k.kind, label: k.label };
    if (k.needs === 'club') {
      const rival = await db.one<ClubRow>(`select * from clubs where id = $1 and league = 'PL'`, [Number(g.clubId)]);
      if (!rival || rival.id === club.id) throw bad('Pick a rival club.');
      goal.clubId = rival.id;
      goal.label = `Beat ${rival.short} home and away`;
    }
    if (k.needs === 'number') {
      goal.target = Math.max(500, Math.min(4000, Math.round(Number(g.target) || 1500)));
      goal.label = `Give ${goal.target.toLocaleString('en-GB')} minutes to under-21s`;
    }
    goals.push(goal);
  }
  await db.q('update clubs set vision = $2 where id = $1', [club.id, JSON.stringify(goals)]);
  return { goals };
});

// ---------------------------------------------------------------- trophies and records
export async function trophiesData(ctx: Ctx) {
  const club = await myClub(ctx);
  const clubs = await clubMap();
  const honours = await db.many<{ season_no: number; name: string; place: string; comp_type: string; label: string | null }>(
    `select h.season_no, h.name, h.place, h.comp_type, s.label from honours h left join seasons s on s.season_no = h.season_no where h.club_id = $1 order by h.season_no desc, h.id`, [club.id]);
  const fx = await db.many<FixtureRow>(`select id, home_id, away_id, home_goals, away_goals, winner_id, kickoff_at, season_no, competition_id from fixtures where status = 'played' and (home_id = $1 or away_id = $1) order by kickoff_at`, [club.id]);
  let biggest: { fixtureId: number; score: string; opp: string; season: number } | null = null;
  let margin = 0;
  let run = 0, bestRun = 0, bestRunEnd: Date | null = null;
  for (const f of fx) {
    const my = f.home_id === club.id ? f.home_goals! : f.away_goals!;
    const th = f.home_id === club.id ? f.away_goals! : f.home_goals!;
    if (my - th > margin) { margin = my - th; biggest = { fixtureId: f.id, score: `${my}-${th}`, opp: clubs.get(f.home_id === club.id ? f.away_id : f.home_id)?.short ?? '', season: f.season_no }; }
    const lost = my < th && !(f.winner_id === club.id);
    if (lost) run = 0; else { run++; if (run > bestRun) { bestRun = run; bestRunEnd = new Date(f.kickoff_at); } }
  }
  const scorer = await db.one<{ id: number; name: string; goals: number }>(`select p.id, p.name, sum(pm.goals)::int goals from player_match pm join players p on p.id = pm.player_id where pm.club_id = $1 group by p.id, p.name order by goals desc limit 1`, [club.id]);
  const apps = await db.one<{ id: number; name: string; apps: number }>(`select p.id, p.name, count(*)::int apps from player_match pm join players p on p.id = pm.player_id where pm.club_id = $1 group by p.id, p.name order by apps desc limit 1`, [club.id]);
  const signing = await db.one<{ player_id: number; player_name: string; fee: number; from_club: number | null }>(`select player_id, player_name, fee, from_club from transfers where to_club = $1 and fee > 0 order by fee desc limit 1`, [club.id]);
  const sale = await db.one<{ player_id: number; player_name: string; fee: number; to_club: number | null }>(`select player_id, player_name, fee, to_club from transfers where from_club = $1 and fee > 0 order by fee desc limit 1`, [club.id]);
  return {
    club: clubs.get(club.id)!,
    trophies: honours.filter((h) => h.place === 'winner').map((h) => ({ season: h.season_no, label: h.label ?? `Season ${h.season_no}`, name: h.name, type: h.comp_type })),
    runnersUp: honours.filter((h) => h.place === 'runner_up').map((h) => ({ season: h.season_no, label: h.label ?? `Season ${h.season_no}`, name: h.name, type: h.comp_type })),
    records: {
      biggestWin: margin > 0 ? biggest : null,
      unbeatenRun: bestRun >= 2 ? { games: bestRun, endedAt: bestRunEnd?.toISOString() ?? null } : null,
      topScorer: scorer && scorer.goals > 0 ? scorer : null,
      mostApps: apps && apps.apps > 0 ? apps : null,
      recordSigning: signing ? { id: signing.player_id, name: signing.player_name, fee: Number(signing.fee), from: signing.from_club ? clubs.get(signing.from_club)?.short ?? null : null } : null,
      recordSale: sale ? { id: sale.player_id, name: sale.player_name, fee: Number(sale.fee), to: sale.to_club ? clubs.get(sale.to_club)?.short ?? null : null } : null,
    },
  };
}
export type TrophiesData = Awaited<ReturnType<typeof trophiesData>>;
route('GET', '/api/club/trophies', 'user', trophiesData);

// ---------------------------------------------------------------- assistant takeover
route('POST', '/api/club/takeover', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const on = !!ctx.body.on;
  await setBotTakeover(db, club.id, on);
  return { botTakeover: on };
});

route('POST', '/api/club/leave', 'user', async (ctx) => {
  if (ctx.body.confirm !== true) throw bad('Please confirm.');
  await tx(async (t) => leaveClub(t, ctx.user!.id));
  return { ok: true };
});
