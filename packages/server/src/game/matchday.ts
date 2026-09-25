// Matchday: deadline lock (assistant + bot team sheets), simulation, persistence and post-match processing.
import {
  Rng, simulateMatch, normaliseTactic, formFromRatings, fatigueFromMatch, sharpnessAfterMatch, hashHex,
  type MatchContext, type MatchResult, type TeamInput, type Weather,
} from '@ffm/engine';
import { db, tx, insertMany, type Db } from '../db.ts';
import { DAY } from '../lib/time.ts';
import { assistantSheet, botSheet, repairSheet, scoutOpponent, type SheetDraft } from './bots.ts';
import { addLedger, gate } from './finance.ts';
import { notifyClub, postToChannel } from './notify.ts';
import { isAvailable, squadOf, toMatchPlayer, PLAYER_COLS } from './players.ts';
import { addNews, matchNews } from './news.ts';
import type { ClubRow, CompetitionRow, CompType, FixtureRow, PlayerRow, TacticRow, WorldRow } from './types.ts';
import { COMP_SHORT } from './types.ts';
import { stageLabel } from './competitions.ts';

export function importanceOf(comp: CompType, stage: string, leg: number): number {
  if (stage === 'F') return comp === 'shield' || comp === 'super_cup' ? 1.2 : 1.6;
  if (stage === 'SF') return 1.35;
  if (stage === 'QF') return 1.2;
  if (comp === 'ucl' && stage === 'R16') return 1.25;
  if (comp === 'league_cup' && stage === 'R1') return 0.9;
  void leg;
  return 1;
}

export function isKnockout(comp: CompType, stage: string): boolean {
  if (comp === 'league') return false;
  if (stage.startsWith('GS')) return false;
  return true;
}

async function lastMatchDays(d: Db, clubId: number, before: Date): Promise<number> {
  const r = await d.one<{ k: Date }>(`select kickoff_at k from fixtures where (home_id = $1 or away_id = $1) and status = 'played' and kickoff_at < $2 order by kickoff_at desc limit 1`, [clubId, before]);
  if (!r) return 7;
  return (before.getTime() - new Date(r.k).getTime()) / DAY;
}

async function clubTactics(d: Db, clubId: number): Promise<TacticRow[]> {
  return d.many<TacticRow>('select * from tactics where club_id = $1 order by is_default desc, id', [clubId]);
}

// ---------------------------------------------------------------- lock
export async function lockSlot(world: WorldRow, kickoffIso: string): Promise<number> {
  const fixtures = await db.many<FixtureRow>(`select * from fixtures where kickoff_at = $1 and status = 'scheduled'`, [kickoffIso]);
  for (const f of fixtures) await lockFixture(world, f);
  return fixtures.length;
}

export async function lockFixture(world: WorldRow, f: FixtureRow) {
  await tx(async (t) => {
    const comp = await t.one<CompetitionRow>('select * from competitions where id = $1', [f.competition_id]);
    const importance = importanceOf(comp!.type, f.stage, f.leg);
    const clubs = await t.many<ClubRow>('select * from clubs where id = any($1)', [[f.home_id, f.away_id]]);
    const squads = new Map<number, PlayerRow[]>();
    for (const c of clubs) squads.set(c.id, await squadOf(t, c.id));
    for (const club of clubs) {
      const isHome = club.id === f.home_id;
      const oppId = isHome ? f.away_id : f.home_id;
      const squad = squads.get(club.id)!;
      const existing = await t.one<{ tactic: SheetDraft['tactic']; lineup: number[]; bench: number[]; plan_b: SheetDraft['planB']; opp: SheetDraft['opp']; captain_id: number | null; submitted_by: string }>(
        'select * from team_sheets where fixture_id = $1 and club_id = $2', [f.id, club.id]);
      const tactics = await clubTactics(t, club.id);
      const daysSince = await lastMatchDays(t, club.id, new Date(f.kickoff_at));
      const rng = new Rng(`${f.seed}:sheet:${club.id}`);
      let sheet: SheetDraft;
      const humanActive = club.manager_type === 'human' && !club.meta?.botTakeover;
      if (existing && existing.submitted_by === 'user') {
        const repaired = repairSheet({ tactic: normaliseTactic(existing.tactic), lineup: existing.lineup, bench: existing.bench, planB: existing.plan_b, opp: existing.opp ?? [], captainId: existing.captain_id, submittedBy: 'user' }, squad);
        sheet = repaired.sheet;
        if (repaired.changed) {
          await notifyClub(t, club.id, { type: 'deadline', title: 'Team sheet adjusted', body: `${repaired.changed} unavailable player${repaired.changed > 1 ? 's were' : ' was'} replaced by your assistant.`, link: `/fixture/${f.id}/preview` });
        }
      } else if (humanActive) {
        const def = tactics.find((x) => x.is_default) ?? tactics[0];
        const planB = tactics.find((x) => x.id !== def.id) ?? null;
        sheet = assistantSheet({ squad, tactic: def, planB, assistantRating: club.staff.assistant?.rating ?? 8, daysSinceLast: daysSince, rng });
        const missed = (club.meta?.missedDeadlines ?? 0) + 1;
        await t.q(`update clubs set meta = jsonb_set(meta, '{missedDeadlines}', to_jsonb($2::int)) where id = $1`, [club.id, missed]);
      } else {
        const oppRecent = await scoutOpponent(t, oppId, f.kickoff_at);
        sheet = botSheet({ club, squad, tactics, fixture: f, isHome, oppRecent, oppSquad: squads.get(oppId) ?? [], daysSinceLast: daysSince, importance, compType: comp!.type, rng });
      }
      await t.q(
        `insert into team_sheets (fixture_id, club_id, tactic, lineup, bench, plan_b, opp, captain_id, submitted_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (fixture_id, club_id) do update set tactic = excluded.tactic, lineup = excluded.lineup, bench = excluded.bench,
           plan_b = excluded.plan_b, opp = excluded.opp, captain_id = excluded.captain_id, submitted_by = excluded.submitted_by`,
        [f.id, club.id, JSON.stringify(sheet.tactic), JSON.stringify(sheet.lineup), JSON.stringify(sheet.bench), sheet.planB ? JSON.stringify(sheet.planB) : null, JSON.stringify(sheet.opp), sheet.captainId, sheet.submittedBy],
      );
      if (existing?.submitted_by === 'user') {
        await t.q(`update clubs set meta = jsonb_set(meta, '{missedDeadlines}', '0') where id = $1`, [club.id]);
      }
    }
    await t.q(`update fixtures set status = 'locked' where id = $1 and status = 'scheduled'`, [f.id]);
  });
}

// ---------------------------------------------------------------- play
export function weatherFor(seed: string, kickoff: Date): Weather {
  const r = new Rng(`${seed}:weather`);
  const month = kickoff.getUTCMonth() + 1;
  const winter = month === 12 || month <= 2;
  const x = r.next();
  if (winter) return x < 0.35 ? 'rain' : x < 0.45 ? 'heavy_rain' : x < 0.52 ? 'snow' : x < 0.62 ? 'wind' : x < 0.8 ? 'cloudy' : 'clear';
  if (month >= 6 && month <= 8) return x < 0.2 ? 'hot' : x < 0.35 ? 'rain' : x < 0.5 ? 'cloudy' : 'clear';
  return x < 0.3 ? 'rain' : x < 0.36 ? 'heavy_rain' : x < 0.46 ? 'wind' : x < 0.7 ? 'cloudy' : 'clear';
}

export async function playSlot(world: WorldRow, kickoffIso: string): Promise<{ played: number; compIds: Set<number> }> {
  const pending = await db.many<FixtureRow>(`select * from fixtures where kickoff_at = $1 and status <> 'played' order by id`, [kickoffIso]);
  const compIds = new Set<number>();
  const results: string[] = [];
  for (const f of pending) {
    if (f.status === 'scheduled') await lockFixture(world, f);
    const line = await playFixture(world, f.id);
    if (line) results.push(line);
    compIds.add(f.competition_id);
  }
  if (results.length) postToChannel(`**Full time**\n${results.join('\n')}`);
  return { played: pending.length, compIds };
}

interface Sheet { fixture_id: number; club_id: number; tactic: SheetDraft['tactic']; lineup: number[]; bench: number[]; plan_b: SheetDraft['planB']; opp: SheetDraft['opp']; captain_id: number | null; submitted_by: string }

export async function playFixture(world: WorldRow, fixtureId: number): Promise<string | null> {
  return tx(async (t) => {
    const f = await t.one<FixtureRow>('select * from fixtures where id = $1 for update', [fixtureId]);
    if (!f || f.status === 'played') return null;
    const comp = (await t.one<CompetitionRow>('select * from competitions where id = $1', [f.competition_id]))!;
    const clubs = await t.many<ClubRow>('select * from clubs where id = any($1)', [[f.home_id, f.away_id]]);
    const home = clubs.find((c) => c.id === f.home_id)!;
    const away = clubs.find((c) => c.id === f.away_id)!;
    const sheets = await t.many<Sheet>('select * from team_sheets where fixture_id = $1', [f.id]);
    const hs = sheets.find((s) => s.club_id === home.id);
    const as = sheets.find((s) => s.club_id === away.id);
    if (!hs || !as) throw new Error(`Fixture ${f.id} missing team sheets`);
    const ids = [...hs.lineup, ...hs.bench, ...as.lineup, ...as.bench].filter((x) => x > 0);
    const players = await t.many<PlayerRow>(`select ${PLAYER_COLS} from players where id = any($1)`, [ids]);
    const byId = new Map(players.map((p) => [p.id, p]));
    const tacticFam = async (clubId: number, name: string) => {
      const r = await t.one<{ familiarity: number }>('select familiarity from tactics where club_id = $1 and name = $2 limit 1', [clubId, name]);
      return r?.familiarity ?? 0.7;
    };
    const mkInput = async (club: ClubRow, s: Sheet): Promise<TeamInput> => ({
      clubId: club.id, name: club.name, short: club.short, code: club.key,
      players: [...s.lineup, ...s.bench].map((id) => byId.get(id)).filter((p): p is PlayerRow => !!p && p.club_id === club.id).map(toMatchPlayer),
      lineup: s.lineup.map((id) => (byId.get(id)?.club_id === club.id ? id : -1)),
      bench: s.bench.filter((id) => byId.get(id)?.club_id === club.id),
      tactic: normaliseTactic(s.tactic), planB: s.plan_b ? normaliseTactic(s.plan_b) : null,
      familiarity: await tacticFam(club.id, s.tactic.name), captainId: s.captain_id, opp: s.opp ?? [],
      acumen: club.manager_type === 'bot' || club.meta?.botTakeover ? club.bot.acumen : (club.staff.assistant?.rating ?? 10),
      isBot: club.manager_type === 'bot' || !!club.meta?.botTakeover, autoSubs: true,
    });
    const hIn = await mkInput(home, hs);
    const aIn = await mkInput(away, as);
    // Fill any empty slot from the bench so the engine always has 11 (e.g. a player sold after lock)
    for (const inp of [hIn, aIn]) {
      for (let i = 0; i < inp.lineup.length; i++) {
        if (inp.lineup[i] > 0) continue;
        const b = inp.bench.shift();
        if (b) inp.lineup[i] = b;
      }
      inp.lineup = inp.lineup.filter((x) => x > 0);
    }
    const importance = importanceOf(comp.type, f.stage, f.leg);
    const derby = (home.meta?.rivals ?? []).includes(away.key) || (away.meta?.rivals ?? []).includes(home.key);
    const knockout = isKnockout(comp.type, f.stage);
    let firstLeg: MatchContext['firstLeg'] = null;
    if (knockout && f.leg === 2 && f.tie_key) {
      const l1 = await t.one<FixtureRow>(`select * from fixtures where competition_id = $1 and tie_key = $2 and leg = 1`, [f.competition_id, f.tie_key]);
      if (l1 && l1.status === 'played') {
        // first leg was played with venues swapped: this match's home side was the away side then
        firstLeg = { home: l1.away_goals ?? 0, away: l1.home_goals ?? 0 };
      }
    }
    const twoLegFirst = knockout && f.leg === 1 && (comp.data.rounds ?? []).find((r) => r.stage === f.stage)?.legs === 2;
    const homeAdv = f.neutral ? 0 : Math.max(2.5, Math.min(6, 3 + home.capacity / 30000 + (home.fan_mood - 50) / 40 + (derby ? 0.5 : 0)));
    const weather = weatherFor(f.seed, new Date(f.kickoff_at));
    const ctx: MatchContext = {
      seed: f.seed, competition: comp.type, stage: f.stage, importance: derby ? Math.max(importance, 1.2) : importance,
      neutral: f.neutral, homeAdvantage: homeAdv, derby, weather, knockout: knockout && !twoLegFirst, firstLeg, maxSubs: world.settings.maxSubs,
    };
    const res = simulateMatch(hIn, aIn, ctx);
    await persistResult(t, world, f, comp, home, away, hs, as, res, { weather, derby, importance, decides: ctx.knockout });
    const pens = res.penalties ? ` (${res.penalties.home}-${res.penalties.away} pens)` : res.extraTime ? ' (aet)' : '';
    return `${COMP_SHORT[comp.type]} ${home.short} ${res.score[0]}-${res.score[1]} ${away.short}${pens}`;
  });
}

async function persistResult(
  t: Db, world: WorldRow, f: FixtureRow, comp: CompetitionRow, home: ClubRow, away: ClubRow, hs: Sheet, as: Sheet, res: MatchResult,
  meta: { weather: Weather; derby: boolean; importance: number; decides: boolean },
) {
  const [hg, ag] = res.score;
  // winner for knockouts (single leg or aggregate on the second leg)
  let winnerId: number | null = null;
  if (meta.decides && res.winner !== null) winnerId = res.winner === 0 ? home.id : away.id;
  const g = !f.neutral || comp.type !== 'league'
    ? gate(home, { importance: meta.importance, oppRep: away.reputation, comp: comp.type, neutral: f.neutral })
    : { attendance: 0, revenue: 0 };
  // compact summary for the result screens
  const lineupInfo = (s: Sheet, side: 0 | 1) => res.players.filter((p) => p.side === side).map((p) => ({ id: p.playerId, n: p.name, s: p.short, pos: p.pos, r: p.role, st: p.started, on: p.onAt, off: p.offAt, rt: p.rating, g: p.goals, a: p.assists, y: p.yellow, rd: p.red, inj: p.injured, min: p.minutes, xg: +p.xg.toFixed(2), og: p.ownGoals, pen: p.penaltiesScored, zt: p.zoneTouches,
    fam: p.fam, pr: p.pressures, pg: p.progressive, sh: p.shots, kp: p.keyPasses, dr: p.dribbles, drc: p.dribblesCompleted, cr: p.crosses, tk: p.tacklesWon, int: p.interceptions, tm: p.traitMoments }));
  const shots = res.events.filter((e) => (e.t === 'shot' || e.t === 'goal') && e.side >= 0 && e.xg !== undefined).map((e) => ({ m: e.m, ex: e.ex, side: e.side, xg: e.xg, o: e.t === 'goal' ? 'goal' : e.o, or: e.t === 'goal' ? e.o : e.or, z: e.z, a: e.a }));
  const summary = {
    stats: res.stats.map((s) => ({ ...s, zonePasses: s.zonePasses, zoneTouches: s.zoneTouches })),
    ht: res.htScore, et: res.extraTime, pens: res.penalties ? { home: res.penalties.home, away: res.penalties.away, kicks: res.penalties.kicks } : null,
    goals: res.events.filter((e) => e.t === 'goal').map((e) => ({ m: e.m, ex: e.ex, side: e.side, a: e.a, b: e.b, o: e.o })),
    cards: res.events.filter((e) => e.t === 'yellow' || e.t === 'red').map((e) => ({ m: e.m, ex: e.ex, side: e.side, a: e.a, t: e.t })),
    motm: res.motm, keyMoments: res.keyMoments, verdict: res.verdict, findings: res.findings, triggers: res.triggersFired,
    modifiers: res.modifiers, momentum: res.momentum, word: res.summaryWord, injuries: res.injuries,
    lineups: [lineupInfo(hs, 0), lineupInfo(as, 1)], formations: [hs.tactic.formation, as.tactic.formation],
    tactics: [{ name: hs.tactic.name, mentality: hs.tactic.mentality, by: hs.submitted_by }, { name: as.tactic.name, mentality: as.tactic.mentality, by: as.submitted_by }],
    shots, weather: meta.weather, derby: meta.derby, decisions: res.decisions,
    traitGoals: res.events.filter((e) => e.t === 'goal' && e.tr).map((e) => ({ m: e.m, side: e.side, a: e.a, tr: e.tr })),
  };
  await t.q(
    `update fixtures set status = 'played', home_goals = $2, away_goals = $3, extra_time = $4, pens = $5, winner_id = $6,
       summary = $7, attendance = $8, weather = $9, played_at = now() where id = $1`,
    [f.id, hg, ag, res.extraTime, res.penalties ? JSON.stringify({ home: res.penalties.home, away: res.penalties.away }) : null, winnerId, JSON.stringify(summary), g.attendance || null, meta.weather],
  );
  await t.q('insert into match_logs (fixture_id, events) values ($1, $2) on conflict (fixture_id) do update set events = excluded.events', [f.id, JSON.stringify(res.events)]);

  // ---- player_match rows
  const cleanSheet = [ag === 0, hg === 0];
  const pmRows = res.players.map((p) => [
    f.id, p.playerId, p.side === 0 ? home.id : away.id, world.season_no, comp.type, p.started, p.minutes, p.rating, p.goals, p.assists, p.shots,
    Math.round(p.xg * 100) / 100, p.yellow, p.red, cleanSheet[p.side] && p.minutes >= 60,
    JSON.stringify({ kp: p.keyPasses, pa: p.passes, pc: p.passesCompleted, tk: p.tacklesWon, int: p.interceptions, sv: p.saves, dr: p.dribblesCompleted, cr: p.crossesCompleted, xa: +p.xa.toFixed(2), og: p.ownGoals, pr: p.pressures, pg: p.progressive, pos: p.pos, fam: p.fam, tm: Object.keys(p.traitMoments).length ? p.traitMoments : undefined }),
  ]);
  if (pmRows.length) await insertMany(t, 'player_match', ['fixture_id', 'player_id', 'club_id', 'season_no', 'comp_type', 'started', 'minutes', 'rating', 'goals', 'assists', 'shots', 'xg', 'yellow', 'red', 'clean_sheet', 'stats'], pmRows, 'on conflict do nothing');

  // ---- player states
  const kick = new Date(f.kickoff_at);
  for (const [club, sheet, side] of [[home, hs, 0], [away, as, 1]] as [ClubRow, Sheet, 0 | 1][]) {
    const lastDays = await lastMatchDays(t, club.id, kick);
    const won = side === 0 ? hg > ag : ag > hg;
    const lost = side === 0 ? hg < ag : ag < hg;
    const played = new Map(res.players.filter((p) => p.side === side).map((p) => [p.playerId, p]));
    const squad = await t.many<PlayerRow>(`select ${PLAYER_COLS} from players where club_id = $1 and status = 'active'`, [club.id]);
    for (const p of squad) {
      const st = played.get(p.id);
      if (st) {
        const hist = [...(p.form_history ?? []), st.rating].slice(-10);
        let morale = p.morale + (won ? 0.015 : lost ? -0.015 : 0.002) + (st.rating - 6.6) * 0.008;
        morale = Math.max(0.9, Math.min(1.1, morale));
        let yellows = p.yellows + st.yellow;
        let suspended = p.suspended;
        if (st.red) suspended += st.yellow >= 2 ? 1 : 3;
        else if (st.yellow) {
          if (yellows === 5) suspended += 1;
          if (yellows === 10) suspended += 2;
          if (yellows === 15) suspended += 3;
        }
        const fatigue = Math.min(100, p.fatigue_debt + fatigueFromMatch(st.minutes, st.conditionEnd, lastDays));
        await t.q(
          `update players set condition = $2, sharpness = $3, fatigue_debt = $4, form_history = $5, form = $6, morale = $7, yellows = $8, suspended = $9 where id = $1`,
          [p.id, Math.max(10, st.conditionEnd), sharpnessAfterMatch(p.sharpness, st.minutes), fatigue, JSON.stringify(hist), formFromRatings(hist), morale, yellows, suspended],
        );
      } else if (p.suspended > 0) {
        await t.q('update players set suspended = suspended - 1 where id = $1', [p.id]);
      }
    }
    await t.q(`update players set flags = flags - 'rested' where club_id = $1 and flags ? 'rested'`, [club.id]);
    // injuries
    for (const inj of res.injuries.filter((i) => i.side === side)) {
      const physio = club.staff.physio?.rating ?? 10;
      const med = club.facilities.medical ?? 2;
      const days = Math.max(1, Math.round(inj.days * (1 - (physio - 10) * 0.02) * (1 - (med - 1) * 0.05)));
      await t.q(`update players set injury = $2 where id = $1`, [inj.playerId, JSON.stringify({ type: inj.type, severity: inj.severity, daysLeft: days, daysTotal: days, since: kick.toISOString() })]);
      const pl = squad.find((x) => x.id === inj.playerId);
      if (pl && inj.severity !== 'knock') {
        await notifyClub(t, club.id, { type: 'injury', title: `${pl.name} is injured`, body: `${cap(inj.type)}. Out for about ${days >= 14 ? Math.round(days / 7) + ' weeks' : days + ' days'}.`, link: `/player/${pl.id}` });
        if (inj.severity === 'serious' || pl.ca >= 160) {
          await addNews(t, world, { type: 'injury', clubIds: [club.id], headline: `${pl.name} faces ${days >= 60 ? 'months' : 'weeks'} out`, body: `${club.short} will be without ${pl.short} after he suffered a ${inj.type}.`, importance: 2 });
        }
      }
    }
    // tactic familiarity + record
    const result = won ? 'w' : lost ? 'l' : 'd';
    await t.q(
      `update tactics set familiarity = least(1, familiarity + 0.035),
         record = jsonb_set(jsonb_set(record, '{p}', to_jsonb(coalesce((record->>'p')::int,0) + 1)), $3::text[], to_jsonb(coalesce((record->>$4)::int,0) + 1))
       where club_id = $1 and name = $2`,
      [club.id, sheet.tactic.name, `{${result}}`, result],
    );
    // fan mood
    const moodDelta = won ? 2 : lost ? -2 : 0;
    await t.q('update clubs set fan_mood = greatest(5, least(100, fan_mood + $2)) where id = $1', [club.id, moodDelta * (comp.type === 'league' ? 1 : 0.5)]);
    // grudges for bots
    const margin = side === 0 ? ag - hg : hg - ag;
    const oppId = side === 0 ? away.id : home.id;
    if (club.manager_type === 'bot') {
      await t.q(`update clubs set bot = jsonb_set(bot, $2::text[], to_jsonb($3::int)) where id = $1`, [club.id, `{grudges,${oppId}}`, Math.max(0, margin)]);
    }
  }

  // ---- money
  if (g.revenue > 0) {
    if (f.neutral) {
      await addLedger(t, home.id, world.season_no, 'gate', g.revenue, `Gate share vs ${away.short}`);
      await addLedger(t, away.id, world.season_no, 'gate', g.revenue, `Gate share vs ${home.short}`);
    } else {
      await addLedger(t, home.id, world.season_no, 'gate', g.revenue, `Gate receipts vs ${away.short} (${g.attendance.toLocaleString('en-GB')})`);
    }
  }
  if (comp.type === 'ucl' || comp.type === 'uel') {
    const prize = comp.type === 'ucl' ? { win: 2_000_000, draw: 600_000 } : { win: 600_000, draw: 200_000 };
    if (f.stage.startsWith('GS')) {
      if (hg > ag) await addLedger(t, home.id, world.season_no, 'prize', prize.win, `${comp.name} win bonus`);
      else if (ag > hg) await addLedger(t, away.id, world.season_no, 'prize', prize.win, `${comp.name} win bonus`);
      else { await addLedger(t, home.id, world.season_no, 'prize', prize.draw, `${comp.name} draw bonus`); await addLedger(t, away.id, world.season_no, 'prize', prize.draw, `${comp.name} draw bonus`); }
    }
  }

  // ---- news + notifications
  await matchNews(t, world, f, comp, home, away, res);
  for (const [club, other, side] of [[home, away, 0], [away, home, 1]] as [ClubRow, ClubRow, 0 | 1][]) {
    if (club.manager_type !== 'human') continue;
    const my = res.score[side];
    const th = res.score[1 - side];
    const word = res.summaryWord[side];
    const pens = res.penalties ? ` (pens ${side === 0 ? res.penalties.home : res.penalties.away}-${side === 0 ? res.penalties.away : res.penalties.home})` : '';
    await notifyClub(t, club.id, {
      type: 'result',
      title: `${my > th ? 'Won' : my < th ? 'Lost' : 'Drew'} ${my}-${th}${pens} vs ${other.short}`,
      body: `${word}. ${stageLabel(comp.type, f.stage, f.grp)} · ${comp.name}`,
      link: `/fixture/${f.id}`,
    });
  }
  void hashHex;
  void isAvailable;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
