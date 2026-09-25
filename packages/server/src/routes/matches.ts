// Matchday: pre-match (opposition report, selection), team sheet submission, simulation preview,
// match summary, the replay event log, and the round summary.
import {
  Rng, simulateMatch, normaliseTactic, lineupWarnings, displayRating, selectTeam, OPP_INSTRUCTION_LABELS, keyBattles, MatchSim,
  type MatchContext, type OppInstruction, type Tactic, type TeamInput,
} from '@ffm/engine';
import { db, tx, type Db } from '../db.ts';
import { ApiError, bad, route, type Ctx } from '../http/router.ts';
import { botSheet, scoutOpponent, type SheetDraft } from '../game/bots.ts';
import { importanceOf, isKnockout, weatherFor } from '../game/matchday.ts';
import { attrsOf, isAvailable, squadOf, toMatchPlayer, toSelectable, isGoalkeeper, PLAYER_COLS } from '../game/players.ts';
import { computeStandings } from '../game/competitions.ts';
import { ARCHETYPE_INFO } from '../game/archetypes.ts';
import type { ClubRow, CompetitionRow, FixtureRow, PlayerRow, TacticRow, WorldRow } from '../game/types.ts';
import { COMP_NAMES } from '../game/types.ts';
import { BENCH_MAX, captainOf } from './tactics.ts';
import { FIXTURE_SELECT, clubMap, fixtureLite, idParam, int, myClub, myClubOrNull, playerLite, world, type ClubLite } from './common.ts';

const SIM_RUNS = 200;
const SIM_LIMIT = 3;

interface StoredSheet { tactic: Tactic & { tacticId?: number; captainId?: number | null }; lineup: number[]; bench: number[]; plan_b: (Tactic & { tacticId?: number }) | null; opp: OppInstruction[] | null; captain_id: number | null; submitted_by: string; submitted_at: Date }

async function loadFixture(d: Db, id: number): Promise<{ f: FixtureRow; comp: CompetitionRow }> {
  const f = await d.one<FixtureRow>('select * from fixtures where id = $1', [id]);
  if (!f) throw new ApiError('NOT_FOUND', 'Match not found.');
  const comp = (await d.one<CompetitionRow>('select * from competitions where id = $1', [f.competition_id]))!;
  return { f, comp };
}

function styleLine(t: Tactic): string {
  const i = t.instructions;
  const bits: string[] = [];
  if (i.press === 'all_out' || i.press === 'high') bits.push('presses high');
  if (i.press === 'low') bits.push('sits deep');
  if (i.passing === 'short' && i.tempo === 'slow') bits.push('keeps the ball');
  if (i.passing === 'direct') bits.push('goes direct');
  if (i.counter) bits.push('breaks quickly');
  if (i.width === 'wide') bits.push('stretches the pitch');
  if (i.line === 'high' || i.line === 'very_high') bits.push('holds a high line');
  if (i.tackling === 'hard') bits.push('tackles hard');
  return bits.length ? bits.slice(0, 3).join(', ') : 'balanced approach';
}

/** The opponent's most likely team sheet as seen by our staff. */
async function predictSheet(d: Db, f: FixtureRow, comp: CompetitionRow, opp: ClubRow, me: ClubRow, oppSquad: PlayerRow[], mySquad: PlayerRow[]): Promise<SheetDraft> {
  const isHome = f.home_id === opp.id;
  if (opp.manager_type === 'bot' || opp.meta?.botTakeover) {
    const tactics = await d.many<TacticRow>('select * from tactics where club_id = $1 order by is_default desc, id', [opp.id]);
    const oppRecent = await scoutOpponent(d, me.id, f.kickoff_at);
    return botSheet({
      club: opp, squad: oppSquad, tactics, fixture: f, isHome, oppRecent, oppSquad: mySquad, daysSinceLast: 4,
      importance: importanceOf(comp.type, f.stage, f.leg), compType: comp.type, rng: new Rng(`${f.seed}:predict:${opp.id}`),
    });
  }
  // Human opponent: their last team, adjusted for who is available now.
  const last = await d.one<StoredSheet>(`select ts.* from team_sheets ts join fixtures x on x.id = ts.fixture_id where ts.club_id = $1 and x.status = 'played' order by x.kickoff_at desc limit 1`, [opp.id]);
  const def = await d.one<TacticRow>('select * from tactics where club_id = $1 order by is_default desc, id limit 1', [opp.id]);
  const tactic = normaliseTactic(last?.tactic ?? def?.data ?? {});
  const keep = new Map<number, number>();
  (last?.lineup ?? def?.lineup ?? []).forEach((pid: number, i: number) => { if (pid > 0) keep.set(pid, i); });
  const sel = selectTeam(oppSquad.map(toSelectable), tactic, { keep, benchSize: BENCH_MAX });
  return { tactic, lineup: sel.lineup, bench: sel.bench, planB: null, opp: [], captainId: sel.captainId, submittedBy: 'user' };
}

/** Our current selection for the fixture: the submitted sheet, or the default tactic's saved team. */
async function mySelection(d: Db, f: FixtureRow, club: ClubRow, overrideTacticId?: number | null): Promise<{ tacticId: number | null; tactic: Tactic; lineup: number[]; bench: number[]; planBId: number | null; planB: Tactic | null; opp: OppInstruction[]; captainId: number | null; submitted: { by: string; at: string } | null; familiarity: number }> {
  const tactics = await d.many<TacticRow>('select * from tactics where club_id = $1 order by is_default desc, id', [club.id]);
  const sheet = await d.one<StoredSheet>('select * from team_sheets where fixture_id = $1 and club_id = $2', [f.id, club.id]);
  const override = overrideTacticId ? tactics.find((t) => t.id === overrideTacticId) : null;
  if (override) {
    return {
      tacticId: override.id, tactic: normaliseTactic(override.data), lineup: override.lineup ?? [], bench: override.bench ?? [],
      planBId: sheet?.plan_b?.tacticId ?? null, planB: null, opp: sheet?.opp ?? [], captainId: captainOf(override),
      submitted: sheet && sheet.submitted_by === 'user' ? { by: 'user', at: new Date(sheet.submitted_at).toISOString() } : null,
      familiarity: override.familiarity,
    };
  }
  if (sheet && sheet.submitted_by === 'user') {
    const tid = sheet.tactic.tacticId ?? null;
    const row = tactics.find((t) => t.id === tid);
    return {
      tacticId: tid, tactic: normaliseTactic(sheet.tactic), lineup: sheet.lineup, bench: sheet.bench, planBId: sheet.plan_b?.tacticId ?? null,
      planB: sheet.plan_b ? normaliseTactic(sheet.plan_b) : null, opp: sheet.opp ?? [], captainId: sheet.captain_id,
      submitted: { by: 'user', at: new Date(sheet.submitted_at).toISOString() }, familiarity: row?.familiarity ?? 0.6,
    };
  }
  const def = tactics[0];
  const planB = tactics.find((t) => t.id !== def?.id) ?? null;
  return {
    tacticId: def?.id ?? null, tactic: normaliseTactic(def?.data ?? {}), lineup: def?.lineup ?? [], bench: def?.bench ?? [], planBId: null, planB: null,
    opp: [], captainId: def ? captainOf(def) : null, submitted: sheet ? { by: sheet.submitted_by, at: new Date(sheet.submitted_at).toISOString() } : null,
    familiarity: def?.familiarity ?? 0.6,
  };
  void planB;
}

function xiView(tactic: Tactic, lineup: number[], squad: PlayerRow[], seasonNo: number) {
  const byId = new Map(squad.map((p) => [p.id, p]));
  return tactic.slots.map((s, i) => {
    const p = byId.get(lineup[i]);
    return { slot: i, pos: s.pos, x: s.x, y: s.y, role: s.role, duty: s.duty, player: p ? { ...playerLite(p, seasonNo), number: p.squad_number } : null };
  });
}

// ---------------------------------------------------------------- pre-match
export async function previewData(ctx: Ctx) {
  const w = await world();
  const club = await myClub(ctx);
  const { f, comp } = await loadFixture(db, idParam(ctx));
  if (f.home_id !== club.id && f.away_id !== club.id) throw new ApiError('FORBIDDEN', 'That is not your match.');
  const clubs = await clubMap();
  const oppId = f.home_id === club.id ? f.away_id : f.home_id;
  const opp = (await db.one<ClubRow>('select * from clubs where id = $1', [oppId]))!;
  const [mySquad, oppSquad] = await Promise.all([squadOf(db, club.id), squadOf(db, opp.id)]);
  const lite = fixtureLite({ ...f, comp_type: comp.type, comp_name: comp.name } as never, clubs);
  const home = f.home_id === club.id ? club : opp;
  let firstLeg: [number, number] | null = null;
  if (f.leg === 2 && f.tie_key) {
    const l1 = await db.one<FixtureRow>('select * from fixtures where competition_id = $1 and tie_key = $2 and leg = 1', [f.competition_id, f.tie_key]);
    if (l1?.status === 'played') firstLeg = [l1.home_goals ?? 0, l1.away_goals ?? 0];
  }
  // ---- opposition report
  const predicted = await predictSheet(db, f, comp, opp, club, oppSquad, mySquad);
  const recentFx = await db.many<FixtureRow>(`select * from fixtures where (home_id = $1 or away_id = $1) and status = 'played' order by kickoff_at desc limit 5`, [opp.id]);
  const form = recentFx.map((x) => {
    const h = x.home_id === opp.id;
    const gf = (h ? x.home_goals : x.away_goals) ?? 0;
    const ga = (h ? x.away_goals : x.home_goals) ?? 0;
    return { fixtureId: x.id, res: gf > ga ? 'W' : gf < ga ? 'L' : 'D', score: `${gf}-${ga}`, opp: clubs.get(h ? x.away_id : x.home_id)?.short ?? '', home: h };
  });
  const recentIds = recentFx.map((x) => x.id);
  const perf = recentIds.length ? await db.many<{ player_id: number; g: number; a: number; r: number; n: number }>(
    `select player_id, sum(goals)::int g, sum(assists)::int a, avg(rating)::float r, count(*)::int n from player_match where fixture_id = any($1) and club_id = $2 group by player_id`, [recentIds, opp.id]) : [];
  let danger: null | { player: ReturnType<typeof playerLite>; reason: string } = null;
  const avail = oppSquad.filter(isAvailable);
  const inSquad = (id: number) => avail.find((p) => p.id === id);
  const scorer = perf.filter((x) => inSquad(x.player_id)).sort((a, b) => (b.g * 2 + b.a) - (a.g * 2 + a.a))[0];
  if (scorer && scorer.g + scorer.a >= 3) danger = { player: playerLite(inSquad(scorer.player_id)!, w.season_no), reason: `${scorer.g} goal${scorer.g === 1 ? '' : 's'} and ${scorer.a} assist${scorer.a === 1 ? '' : 's'} in his last ${scorer.n}` };
  else {
    const rated = perf.filter((x) => inSquad(x.player_id) && x.n >= 2).sort((a, b) => b.r - a.r)[0];
    if (rated && rated.r >= 7.1) danger = { player: playerLite(inSquad(rated.player_id)!, w.season_no), reason: `Averaging ${rated.r.toFixed(1)} over his last ${rated.n}` };
    else {
      const best = avail.slice().sort((a, b) => b.ca - a.ca)[0];
      if (best) danger = { player: playerLite(best, w.season_no), reason: 'Their best player on paper' };
    }
  }
  let weakness: string | null = null;
  const sums = recentIds.slice(0, 3).length ? await db.many<{ home_id: number; shots: { side: number; o: string; or?: string }[] | null }>(`select home_id, summary->'shots' shots from fixtures where id = any($1)`, [recentIds.slice(0, 3)]) : [];
  const conceded: Record<string, number> = {};
  let total = 0;
  for (const s of sums) {
    const oppSide = s.home_id === opp.id ? 1 : 0;
    for (const sh of s.shots ?? []) if (sh.side === oppSide && sh.o === 'goal') { total++; conceded[sh.or ?? 'open'] = (conceded[sh.or ?? 'open'] ?? 0) + 1; }
  }
  const worst = Object.entries(conceded).sort((a, b) => b[1] - a[1])[0];
  const originText: Record<string, string> = { cross: 'from crosses', set_piece: 'from set pieces', counter: 'on the counter', through: 'from balls in behind', long_shot: 'from distance', dribble: 'to runners with the ball', penalty: 'from penalties', open: 'in open play' };
  if (worst && worst[1] >= 2) weakness = `Conceded ${worst[1]} of their last ${total} ${originText[worst[0]] ?? ''}`.trim();
  else if (total === 0 && sums.length) weakness = 'Tight at the back lately: no goals conceded in their last few';
  const assistant = club.staff.assistant?.rating ?? 8;
  const scout = club.staff.scout?.rating ?? 8;
  const accuracy = (assistant + scout) / 2;
  const confidence = accuracy >= 15 ? 'high' : accuracy >= 11 ? 'good' : accuracy >= 7 ? 'fair' : 'low';
  const lastSheets = await scoutOpponent(db, opp.id, f.kickoff_at);
  const shapeCount = new Map<string, number>();
  for (const t of lastSheets) shapeCount.set(t.formation, (shapeCount.get(t.formation) ?? 0) + 1);
  const usual = [...shapeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? predicted.tactic.formation;

  // ---- our selection (optionally previewing another saved tactic)
  const sel = await mySelection(db, f, club, ctx.query.get('tactic') ? int(ctx.query.get('tactic'), 'tactic') : null);
  const tactics = await db.many<TacticRow>('select * from tactics where club_id = $1 order by is_default desc, id', [club.id]);
  const selectable = mySquad.map(toSelectable);
  const warnings = lineupWarnings(selectable, sel.tactic, sel.lineup, sel.familiarity, sel.captainId);
  const xiPlayers = sel.lineup.map((id) => mySquad.find((p) => p.id === id)).filter((p): p is PlayerRow => !!p);
  const s0 = selectTeam(selectable, sel.tactic, { keep: new Map(sel.lineup.map((id, i) => [id, i])), benchSize: 0 });
  const runs = await db.one<{ runs: number }>('select runs from preview_runs where club_id = $1 and fixture_id = $2', [club.id, f.id]);
  // ---- head-to-head
  const h2h = await db.many<FixtureRow & { comp_type: string; comp_name: string }>(`${FIXTURE_SELECT} where f.status = 'played' and ((f.home_id = $1 and f.away_id = $2) or (f.home_id = $2 and f.away_id = $1)) order by f.kickoff_at desc limit 5`, [club.id, opp.id]);
  const deadlinePassed = Date.now() >= new Date(f.deadline_at).getTime() || f.status !== 'scheduled';
  // ---- key battles and the tactical match-up, from the same model the match engine uses
  const toAP = (p: PlayerRow) => ({ id: p.id, short: p.short, attrs: attrsOf(p), fam: p.positions, traits: p.traits ?? {}, condition: p.condition });
  let battles: ReturnType<typeof keyBattles> = [];
  let matchup: { good: boolean; text: string }[] = [];
  try {
    battles = keyBattles({ tactic: sel.tactic, lineup: sel.lineup, players: mySquad.map(toAP) }, { tactic: predicted.tactic, lineup: predicted.lineup, players: oppSquad.map(toAP) });
    const mine = buildInput(club, mySquad, { ...sel, planB: null, opp: [] }, sel.familiarity, false);
    const theirs = buildInput(opp, oppSquad, predicted, 0.8, opp.manager_type === 'bot');
    const homeIsMe = f.home_id === club.id;
    const sim = new MatchSim(homeIsMe ? mine : theirs, homeIsMe ? theirs : mine, {
      seed: `matchup:${f.id}`, competition: 'league', importance: 1, neutral: f.neutral, homeAdvantage: 4, derby: false, weather: 'clear', knockout: false, maxSubs: 5,
    });
    const mySide = homeIsMe ? 0 : 1;
    matchup = sim.modifiers.map((m) => {
      const ben = m.side === mySide ? 'Your' : 'Their';
      const other = m.side === mySide ? 'their' : 'your';
      const t: Record<string, string> = {
        high_line_vs_pace: `${other === 'their' ? 'Their' : 'Your'} high line invites balls in behind for ${ben.toLowerCase()} quick forwards.`,
        deep_vs_patient: `${ben} patient passing should pick holes in ${other} deep block and create chances from distance.`,
        press_break: `${ben} composed defenders can play through ${other} all-out press.`,
        narrow_vs_width: `${other === 'their' ? 'They' : 'You'} play narrow, leaving space out wide for ${ben.toLowerCase()} wide players.`,
        wide_vs_central: `${other === 'their' ? 'They' : 'You'} stretch wide, so ${ben.toLowerCase()} team can overload the middle.`,
        man_vs_roamers: `${ben} roaming players will drag ${other} man-markers out of position.`,
        trap_vs_late_runs: `Late runs from ${ben.toLowerCase()} midfield make ${other} offside trap a gamble.`,
        counter_smothered: `${ben} counter-press and patience should starve ${other} counter-attacks.`,
        style_tempo: `${ben} slower tempo means more of the ball, at the cost of more transitions.`,
        style_aggression: `${ben} intensity without the ball should set the tone.`,
      };
      return { good: m.side === mySide, text: t[m.key] ?? m.cause };
    });
  } catch (e) {
    console.error('matchup analysis failed', e);
  }
  return {
    battles, matchup,
    fixture: { ...lite, venue: f.neutral ? 'Neutral venue' : home.stadium, firstLeg, isHome: f.home_id === club.id, weather: weatherFor(f.seed, new Date(f.kickoff_at)) },
    deadlinePassed,
    opponent: {
      club: clubs.get(opp.id)!,
      manager: opp.manager_type === 'bot' || opp.meta?.botTakeover ? { name: opp.bot.name, style: ARCHETYPE_INFO[opp.bot.archetype]?.label ?? '', human: false } : { name: clubs.get(opp.id)?.managerName ?? 'A friend', style: 'Human manager', human: true },
      confidence,
      usualShape: usual,
      predictedShape: predicted.tactic.formation,
      style: styleLine(predicted.tactic),
      xi: xiView(predicted.tactic, predicted.lineup, oppSquad, w.season_no),
      form,
      danger,
      weakness,
    },
    mine: {
      tacticId: sel.tacticId, planBId: sel.planBId, captainId: sel.captainId, opp: sel.opp, submitted: sel.submitted,
      formation: sel.tactic.formation, mentality: sel.tactic.mentality,
      xi: xiView(sel.tactic, sel.lineup, mySquad, w.season_no),
      bench: sel.bench.map((id) => mySquad.find((p) => p.id === id)).filter((p): p is PlayerRow => !!p).map((p) => playerLite(p, w.season_no)),
      strength: displayRating(s0.strength),
      avgCondition: xiPlayers.length ? Math.round(xiPlayers.reduce((s, p) => s + p.condition, 0) / xiPlayers.length) : 0,
      warnings,
      tactics: tactics.map((t) => ({ id: t.id, name: t.name, formation: normaliseTactic(t.data).formation, familiarity: t.familiarity, isDefault: t.is_default })),
    },
    oppInstructionTypes: OPP_INSTRUCTION_LABELS,
    sims: { used: runs?.runs ?? 0, max: SIM_LIMIT },
    h2h: h2h.map((x) => fixtureLite(x as never, clubs)),
  };
}
export type PreviewData = Awaited<ReturnType<typeof previewData>>;
route('GET', '/api/fixtures/:id/preview', 'user', previewData);

// ---------------------------------------------------------------- submit
route('PUT', '/api/fixtures/:id/sheet', 'user', async (ctx) => {
  const id = idParam(ctx);
  return tx(async (t) => {
    const w = await world(t);
    const club = await myClub(ctx, t);
    const f = await t.one<FixtureRow>('select * from fixtures where id = $1 for update', [id]);
    if (!f) throw new ApiError('NOT_FOUND', 'Match not found.');
    if (f.home_id !== club.id && f.away_id !== club.id) throw new ApiError('FORBIDDEN', 'That is not your match.');
    if (f.status !== 'scheduled' || Date.now() >= new Date(f.deadline_at).getTime()) throw new ApiError('DEADLINE_PASSED', 'Too late - team sheets for this match are locked.');
    const tacticId = int(ctx.body.tacticId, 'tacticId');
    const tacRow = await t.one<TacticRow>('select * from tactics where id = $1 and club_id = $2', [tacticId, club.id]);
    if (!tacRow) throw new ApiError('NOT_FOUND', 'Tactic not found.');
    const squad = await squadOf(t, club.id);
    const byId = new Map(squad.map((p) => [p.id, p]));
    const tactic = normaliseTactic(tacRow.data);
    const lineup: number[] = Array.isArray(ctx.body.lineup) ? ctx.body.lineup.map(Number) : (tacRow.lineup ?? []);
    const bench: number[] = (Array.isArray(ctx.body.bench) ? ctx.body.bench.map(Number) : (tacRow.bench ?? [])).filter((x: number) => x > 0);
    const problems: string[] = [];
    if (lineup.length !== 11 || lineup.some((x) => !(x > 0))) problems.push('Pick eleven players.');
    const all = [...lineup, ...bench].filter((x) => x > 0);
    if (new Set(all).size !== all.length) problems.push('A player appears twice.');
    for (const pid of all) {
      const p = byId.get(pid);
      if (!p) { problems.push('A selected player is no longer at the club.'); continue; }
      if (!isAvailable(p)) problems.push(`${p.name} is ${p.suspended > 0 ? 'suspended' : 'injured'}.`);
    }
    const gkIdx = tactic.slots.findIndex((s) => s.pos === 'GK');
    const gk = byId.get(lineup[gkIdx]);
    if (!gk || (gk.positions.GK ?? 0) < 0.5) problems.push('Put a goalkeeper in goal.');
    if (lineup.some((pid, i) => i !== gkIdx && byId.get(pid) && isGoalkeeper(byId.get(pid)!))) problems.push('Only one goalkeeper can start.');
    if (bench.length > BENCH_MAX) problems.push(`The bench holds ${BENCH_MAX} players at most.`);
    if (problems.length) throw new ApiError('SQUAD_INVALID', problems[0], { problems });
    let planB: (Tactic & { tacticId: number }) | null = null;
    if (ctx.body.planBId) {
      const pb = await t.one<TacticRow>('select * from tactics where id = $1 and club_id = $2', [int(ctx.body.planBId, 'planBId'), club.id]);
      if (pb && pb.id !== tacRow.id) planB = { ...normaliseTactic(pb.data), tacticId: pb.id };
    }
    const oppRaw: OppInstruction[] = Array.isArray(ctx.body.opp) ? ctx.body.opp : [];
    const oppClubId = f.home_id === club.id ? f.away_id : f.home_id;
    const oppPlayers = new Set((await t.many<{ id: number }>(`select id from players where club_id = $1 and status = 'active'`, [oppClubId])).map((r) => r.id));
    const opp = oppRaw.filter((o) => oppPlayers.has(Number(o.playerId)) && ['tight_mark', 'weaker_foot', 'hard_tackle'].includes(o.type)).slice(0, 3).map((o) => ({ playerId: Number(o.playerId), type: o.type }));
    let captainId = ctx.body.captainId ? Number(ctx.body.captainId) : captainOf(tacRow);
    if (!captainId || !lineup.includes(captainId)) {
      captainId = lineup.map((pid) => byId.get(pid)!).sort((a, b) => attrsOf(b).leadership + b.age * 2 - (attrsOf(a).leadership + a.age * 2))[0]?.id ?? null;
    }
    await t.q(
      `insert into team_sheets (fixture_id, club_id, tactic, lineup, bench, plan_b, opp, captain_id, submitted_by, submitted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'user', now())
       on conflict (fixture_id, club_id) do update set tactic = excluded.tactic, lineup = excluded.lineup, bench = excluded.bench, plan_b = excluded.plan_b,
         opp = excluded.opp, captain_id = excluded.captain_id, submitted_by = 'user', submitted_at = now()`,
      [f.id, club.id, JSON.stringify({ ...tactic, tacticId: tacRow.id, captainId }), JSON.stringify(lineup), JSON.stringify(bench), planB ? JSON.stringify(planB) : null, JSON.stringify(opp), captainId],
    );
    // The latest team becomes the tactic's saved XI too, so next week starts from it.
    await t.q('update tactics set lineup = $2, bench = $3 where id = $1', [tacRow.id, JSON.stringify(lineup), JSON.stringify(bench)]);
    await t.q(`update clubs set meta = meta || '{"missedDeadlines": 0}'::jsonb where id = $1`, [club.id]);
    return { ok: true, submittedAt: new Date().toISOString(), deadline: new Date(f.deadline_at).toISOString(), lineup, bench, captainId, opp, planBId: planB?.tacticId ?? null, seasonNo: w.season_no };
  });
});

// ---------------------------------------------------------------- simulation preview
function buildInput(club: ClubRow, squad: PlayerRow[], s: { tactic: Tactic; lineup: number[]; bench: number[]; planB: Tactic | null; opp: OppInstruction[]; captainId: number | null }, familiarity: number, isBot: boolean): TeamInput {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const lineup = s.lineup.filter((id) => byId.has(id));
  const bench = s.bench.filter((id) => byId.has(id) && !lineup.includes(id));
  // top up a short XI from the bench so the engine always has 11
  while (lineup.length < 11 && bench.length) lineup.push(bench.shift()!);
  return {
    clubId: club.id, name: club.name, short: club.short, code: club.key,
    players: [...lineup, ...bench].map((id) => toMatchPlayer(byId.get(id)!)), lineup, bench,
    tactic: s.tactic, planB: s.planB, familiarity, captainId: s.captainId, opp: s.opp,
    acumen: isBot ? club.bot.acumen : (club.staff.assistant?.rating ?? 10), isBot, autoSubs: true,
  };
}

route('POST', '/api/fixtures/:id/simulate', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const { f, comp } = await loadFixture(db, idParam(ctx));
  if (f.home_id !== club.id && f.away_id !== club.id) throw new ApiError('FORBIDDEN', 'That is not your match.');
  if (f.status !== 'scheduled') throw new ApiError('DEADLINE_PASSED', 'This match is locked.');
  const used = await db.one<{ runs: number }>(
    `insert into preview_runs (club_id, fixture_id, runs) values ($1, $2, 1)
     on conflict (club_id, fixture_id) do update set runs = preview_runs.runs + 1 where preview_runs.runs < $3 returning runs`, [club.id, f.id, SIM_LIMIT]);
  if (!used) throw new ApiError('RATE_LIMITED', `You have used all ${SIM_LIMIT} previews for this match. Trust your judgement!`);
  const oppId = f.home_id === club.id ? f.away_id : f.home_id;
  const opp = (await db.one<ClubRow>('select * from clubs where id = $1', [oppId]))!;
  const [mySquad, oppSquad] = await Promise.all([squadOf(db, club.id), squadOf(db, opp.id)]);
  const sel = await mySelection(db, f, club);
  if (ctx.body.tacticId) {
    const alt = await db.one<TacticRow>('select * from tactics where id = $1 and club_id = $2', [int(ctx.body.tacticId, 'tacticId'), club.id]);
    if (alt) { sel.tactic = normaliseTactic(alt.data); sel.lineup = alt.lineup; sel.bench = alt.bench; sel.familiarity = alt.familiarity; }
  }
  const predicted = await predictSheet(db, f, comp, opp, club, oppSquad, mySquad);
  const oppFam = (await db.one<{ familiarity: number }>('select familiarity from tactics where club_id = $1 and name = $2', [opp.id, predicted.tactic.name]))?.familiarity ?? 0.75;
  const mine = buildInput(club, mySquad, { ...sel }, sel.familiarity, false);
  const theirs = buildInput(opp, oppSquad, predicted, oppFam, opp.manager_type === 'bot');
  const homeIsMe = f.home_id === club.id;
  const home = homeIsMe ? club : opp;
  const knockout = isKnockout(comp.type, f.stage) && !(f.leg === 1 && (comp.data.rounds ?? []).find((r) => r.stage === f.stage)?.legs === 2);
  const ctxBase: Omit<MatchContext, 'seed'> = {
    competition: comp.type, stage: f.stage, importance: importanceOf(comp.type, f.stage, f.leg), neutral: f.neutral,
    homeAdvantage: f.neutral ? 0 : Math.max(2.5, Math.min(6, 3 + home.capacity / 30000 + (home.fan_mood - 50) / 40)), derby: false,
    weather: weatherFor(f.seed, new Date(f.kickoff_at)), knockout: false, firstLeg: null, maxSubs: 5,
  };
  let w = 0, dr = 0, l = 0, gf = 0, ga = 0;
  const scores = new Map<string, number>();
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i < SIM_RUNS; i++) {
    const r = simulateMatch(homeIsMe ? mine : theirs, homeIsMe ? theirs : mine, { ...ctxBase, seed: `preview:${f.id}:${club.id}:${used.runs}:${i}` });
    const my = r.score[homeIsMe ? 0 : 1];
    const th = r.score[homeIsMe ? 1 : 0];
    if (my > th) w++; else if (my === th) dr++; else l++;
    gf += my; ga += th;
    const k = `${my}-${th}`;
    scores.set(k, (scores.get(k) ?? 0) + 1);
    n++;
    if (Date.now() - t0 > 20_000) break;
  }
  void knockout;
  const hist = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([score, c]) => ({ score, pct: Math.round((c / n) * 1000) / 10 }));
  return {
    runs: n, win: Math.round((w / n) * 1000) / 10, draw: Math.round((dr / n) * 1000) / 10, loss: Math.round((l / n) * 1000) / 10,
    avgFor: Math.round((gf / n) * 100) / 100, avgAgainst: Math.round((ga / n) * 100) / 100,
    likely: hist[0]?.score ?? '0-0', histogram: hist, used: used.runs, max: SIM_LIMIT,
  };
});

// ---------------------------------------------------------------- summary and replay
export async function fixtureData(ctx: Ctx) {
  const id = idParam(ctx);
  const clubs = await clubMap();
  const f = await db.one<FixtureRow & { comp_type: string; comp_name: string; full: Record<string, unknown> | null }>(
    `select f.*, c.type comp_type, c.name comp_name, f.summary full from fixtures f join competitions c on c.id = f.competition_id where f.id = $1`, [id]);
  if (!f) throw new ApiError('NOT_FOUND', 'Match not found.');
  const me = await myClubOrNull(ctx);
  const mySide = me ? (f.home_id === me.id ? 0 : f.away_id === me.id ? 1 : null) : null;
  const home = await db.one<{ stadium: string }>('select stadium from clubs where id = $1', [f.home_id]);
  let firstLeg: [number, number] | null = null;
  if (f.leg === 2 && f.tie_key) {
    const l1 = await db.one<FixtureRow>('select * from fixtures where competition_id = $1 and tie_key = $2 and leg = 1', [f.competition_id, f.tie_key]);
    if (l1?.status === 'played') firstLeg = [l1.home_goals ?? 0, l1.away_goals ?? 0];
  }
  const lite = fixtureLite({ ...f, summary: f.full } as never, clubs);
  return {
    fixture: { ...lite, venue: f.neutral ? 'Neutral venue' : home?.stadium ?? '', attendance: f.attendance, weather: f.weather, firstLeg, seasonNo: f.season_no },
    played: f.status === 'played',
    mySide,
    summary: f.status === 'played' ? f.full : null,
  };
}
export type FixtureData = Awaited<ReturnType<typeof fixtureData>>;
route('GET', '/api/fixtures/:id', 'user', fixtureData);

export async function eventsData(ctx: Ctx) {
  const id = idParam(ctx);
  const f = await db.one<FixtureRow>('select id, status, home_id, away_id, summary from fixtures where id = $1', [id]);
  if (!f) throw new ApiError('NOT_FOUND', 'Match not found.');
  if (f.status !== 'played') throw new ApiError('FORBIDDEN', 'This match has not been played yet.');
  const log = await db.one<{ events: unknown[] }>('select events from match_logs where fixture_id = $1', [id]);
  if (!log) throw new ApiError('NOT_FOUND', 'The full replay of this match has been archived. The report and stats are still there.');
  const lineups = ((f.summary as { lineups?: { id: number; s: string; st: boolean; pos: string }[][] } | null)?.lineups ?? []);
  const players: Record<number, { s: string; side: 0 | 1; st: boolean; pos: string; no: number | null }> = {};
  const ids = lineups.flat().map((p) => p.id);
  const numbers = ids.length ? await db.many<{ id: number; squad_number: number | null }>('select id, squad_number from players where id = any($1)', [ids]) : [];
  lineups.forEach((side, si) => side.forEach((p) => { players[p.id] = { s: p.s, side: si as 0 | 1, st: p.st, pos: p.pos, no: numbers.find((n) => n.id === p.id)?.squad_number ?? null }; }));
  return { events: log?.events ?? [], players };
}
export type EventsData = Awaited<ReturnType<typeof eventsData>>;
route('GET', '/api/fixtures/:id/events', 'user', eventsData);

// ---------------------------------------------------------------- round summary (league)
export async function roundData(ctx: Ctx) {
  const w = await world();
  const season = ctx.query.get('season') ? int(ctx.query.get('season'), 'season') : w.season_no;
  const round = int(ctx.params.round, 'round', { min: 1, max: 38 });
  const comp = await db.one<CompetitionRow>(`select * from competitions where season_no = $1 and type = 'league'`, [season]);
  if (!comp) throw new ApiError('NOT_FOUND', 'No league for that season.');
  const clubs = await clubMap();
  const all = await db.many<FixtureRow>('select * from fixtures where competition_id = $1', [comp.id]);
  const inRound = all.filter((f) => f.round === round);
  const played = inRound.filter((f) => f.status === 'played');
  const entrants = comp.data.entrants ?? [];
  const after = computeStandings(all.filter((f) => f.round <= round), entrants);
  const before = computeStandings(all.filter((f) => f.round < round), entrants);
  const table = after.map((r, i) => ({ pos: i + 1, club: clubs.get(r.clubId)!, p: r.p, gd: r.gd, pts: r.pts, move: (before.findIndex((b) => b.clubId === r.clubId) + 1) - (i + 1) }));
  const top = played.length ? await db.one<{ player_id: number; rating: number; goals: number; assists: number; name: string; club_id: number }>(
    `select pm.player_id, pm.rating, pm.goals, pm.assists, p.name, pm.club_id from player_match pm join players p on p.id = pm.player_id
      where pm.fixture_id = any($1) and pm.minutes >= 45 order by pm.rating desc, pm.goals desc limit 1`, [played.map((f) => f.id)]) : null;
  const reps = new Map((await db.many<{ id: number; reputation: number }>('select id, reputation from clubs')).map((r) => [r.id, r.reputation]));
  const upset = played.map((f) => {
    const hw = (f.home_goals ?? 0) > (f.away_goals ?? 0);
    const aw = (f.away_goals ?? 0) > (f.home_goals ?? 0);
    const gap = hw ? (reps.get(f.away_id) ?? 0) - (reps.get(f.home_id) ?? 0) : aw ? (reps.get(f.home_id) ?? 0) - (reps.get(f.away_id) ?? 0) - 4 : 0;
    return { f, gap };
  }).sort((a, b) => b.gap - a.gap)[0];
  const rounds = [...new Set(all.map((f) => f.round))].sort((a, b) => a - b);
  return {
    season, round, rounds: rounds.length,
    kickoff: inRound[0] ? new Date(inRound[0].kickoff_at).toISOString() : null,
    results: inRound.map((f) => fixtureLite({ ...f, comp_type: 'league', comp_name: COMP_NAMES.league } as never, clubs)),
    table,
    star: top ? { id: top.player_id, name: top.name, rating: top.rating, goals: top.goals, assists: top.assists, club: clubs.get(top.club_id)! } : null,
    upset: upset && upset.gap >= 10 ? fixtureLite({ ...upset.f, comp_type: 'league', comp_name: COMP_NAMES.league } as never, clubs) : null,
  };
}
export type RoundData = Awaited<ReturnType<typeof roundData>>;
route('GET', '/api/rounds/:round', 'user', roundData);

void PLAYER_COLS;
void (null as unknown as WorldRow);
void (null as unknown as ClubLite);
void bad;
