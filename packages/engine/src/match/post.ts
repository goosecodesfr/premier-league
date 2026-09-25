// Post-match derivation: player ratings, tactical findings, key moments, man of the match and verdict.
// Everything here is derived from the simulation state and event log; nothing is re-simulated.
import { POS_LINE, type Pos } from '../positions.ts';
import type { MatchSim } from './engine.ts';
import { TRAITS, type TraitKey } from '../traits.ts';
import type { DecisionReport, Finding, KeyMoment, MatchResult, PlayerMatchStat, TeamStats } from './types.ts';

const LEAGUE_MID_THIRD_COMPLETION = 0.8;

/** Rating components: "activity" (work done, per line) and "decisive" (goals, assists, errors, cards). */
export function ratingParts(s: PlayerMatchStat, won: boolean | null, cleanSheet: boolean): { line: string; activity: number; decisive: number } {
  const line = POS_LINE[(s.pos || 'MC') as Pos] ?? 'MID';
  const att = line === 'ATT';
  let a = 0;
  a += Math.max(0, s.keyPasses - s.assists) * 0.15;
  a += s.xa * 0.4;
  a += s.shotsOnTarget * 0.08;
  a += s.dribblesCompleted * 0.1 - (s.dribbles - s.dribblesCompleted) * 0.03;
  a += s.tacklesWon * (line === 'DEF' ? 0.13 : 0.1);
  a += s.interceptions * 0.1;
  a += s.clearances * 0.04;
  a += s.aerialsWon * 0.05;
  if (s.passes >= 8) a += ((s.passesCompleted / s.passes) - 0.8) * 2 * Math.min(1, s.passes / 30);
  if (line === 'GK') {
    a += s.saves * 0.3;
    a -= s.conceded * 0.35;
  } else if (line === 'DEF') a -= s.conceded * 0.22;
  else if (line === 'MID') a -= s.conceded * 0.08;
  if (cleanSheet && s.minutes >= 60) a += line === 'GK' ? 0.6 : line === 'DEF' ? 0.5 : 0.1;
  a -= s.offsides * 0.05;
  a -= s.fouls * 0.05;
  if (won === true) a += 0.25;
  if (won === false) a -= 0.25;
  if (att && s.shots === 0 && s.minutes >= 60) a -= 0.3;
  let d = 0;
  d += s.goals * (att ? 0.95 : 1.1);
  d += s.assists * 0.7;
  d -= s.bigChancesMissed * 0.25;
  d -= s.errors * 0.6;
  d -= s.ownGoals * 0.8;
  d -= s.yellow * 0.2;
  if (s.red) d -= 1.2;
  d -= s.penaltiesMissed * 0.4;
  return { line, activity: a, decisive: d };
}

// Per-line centring and spread of the activity component, calibrated so every line averages ~6.7
// with a realistic spread (sd ~0.75) instead of defenders being marked down for doing their job.
const LINE_CAL: Record<string, { base: number; mean: number; k: number }> = {
  GK: { base: 6.77, mean: 0.68, k: 0.7 },
  DEF: { base: 6.78, mean: 0.39, k: 0.9 },
  MID: { base: 6.68, mean: 0.57, k: 1.0 },
  ATT: { base: 6.52, mean: 0.53, k: 1.0 },
};

export function playerRating(s: PlayerMatchStat, won: boolean | null, cleanSheet: boolean, teamConceded: number): number {
  const { line, activity, decisive } = ratingParts(s, won, cleanSheet);
  const cal = LINE_CAL[line] ?? LINE_CAL.MID;
  let r = cal.base + (activity - cal.mean) * cal.k + decisive;
  void teamConceded;
  // Short cameos regress to 6.0
  if (s.minutes < 25) r = 6 + (r - 6) * (0.4 + s.minutes / 50);
  return Math.round(Math.max(3, Math.min(10, r)) * 10) / 10;
}

// ---- win probability (Poisson / Skellam) ----
function poissonPmf(k: number, l: number): number {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

/** P(home win) given current goal difference (home - away) and remaining expected goals. */
export function winProb(diff: number, lh: number, la: number): { w: number; d: number; l: number } {
  let w = 0, d = 0, l = 0;
  for (let i = 0; i <= 8; i++) {
    const pi = poissonPmf(i, lh);
    for (let j = 0; j <= 8; j++) {
      const p = pi * poissonPmf(j, la);
      const fd = diff + i - j;
      if (fd > 0) w += p; else if (fd === 0) d += p; else l += p;
    }
  }
  return { w, d, l };
}

function points(p: { w: number; d: number }) {
  return p.w + p.d * 0.5;
}

export function finaliseMatch(sim: MatchSim): MatchResult {
  const [h, a] = sim.teams;
  const score = sim.score;
  const total = sim.extraTime ? 120 : 90;
  let winner: 0 | 1 | null = null;
  if (score[0] !== score[1] && !sim.ctx.knockout) winner = score[0] > score[1] ? 0 : 1;
  if (sim.ctx.knockout) {
    const fl = sim.ctx.firstLeg;
    const ah = score[0] + (fl?.home ?? 0);
    const aa = score[1] + (fl?.away ?? 0);
    if (ah !== aa) winner = ah > aa ? 0 : 1;
    else if (sim.penalties) winner = sim.penalties.home > sim.penalties.away ? 0 : 1;
  } else if (score[0] !== score[1]) winner = score[0] > score[1] ? 0 : 1;

  // ---- ratings ----
  const players: PlayerMatchStat[] = [];
  for (const t of sim.teams) {
    const conceded = score[1 - t.side];
    const won = score[t.side] > score[1 - t.side] ? true : score[t.side] < score[1 - t.side] ? false : null;
    for (const ps of t.players) {
      if (!ps.used) continue;
      const s = ps.st;
      s.rating = playerRating(s, won, conceded === 0, conceded);
      players.push(s);
    }
  }

  // ---- key moments (win-probability swing) ----
  const rate = (st: TeamStats) => Math.max(0.6, Math.min(2.4, st.xg * (90 / total) * 0.6 + 1.35 * 0.4));
  const lh = rate(h.stats);
  const la = rate(a.stats);
  const moments: KeyMoment[] = [];
  let run: [number, number] = [0, 0];
  for (const e of sim.events) {
    const minute = Math.min(total, e.m + (e.ex ?? 0));
    const left = Math.max(0, (total - minute) / 90);
    if (e.t === 'goal' && e.sc && e.side >= 0) {
      const before = points(winProb(run[0] - run[1], lh * left, la * left));
      run = [e.sc[0], e.sc[1]];
      const after = points(winProb(run[0] - run[1], lh * left, la * left));
      const swingHome = after - before;
      moments.push({ minute: e.m, side: e.side as 0 | 1, txt: e.txt, swing: Math.round((e.side === 0 ? swingHome : -swingHome) * 100), type: 'goal' });
    } else if (e.t === 'red' && e.side >= 0) {
      moments.push({ minute: e.m, side: (1 - e.side) as 0 | 1, txt: e.txt, swing: Math.round(10 * left + 3), type: 'red' });
    } else if ((e.t === 'shot') && e.big && e.side >= 0 && e.xg) {
      const cur = points(winProb(run[0] - run[1], lh * left, la * left));
      const alt = points(winProb(run[0] - run[1] + (e.side === 0 ? 1 : -1), lh * left, la * left));
      const sw = Math.abs(alt - cur) * e.xg;
      moments.push({ minute: e.m, side: e.side as 0 | 1, txt: e.txt, swing: -Math.round(sw * 100), type: 'miss' });
    }
  }
  const keyMoments = moments.sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing)).slice(0, 3).sort((x, y) => x.minute - y.minute);

  // ---- man of the match ----
  const winnerSide = score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1;
  const sorted = players.slice().sort((x, y) => y.rating - x.rating || (winnerSide !== null ? (y.side === winnerSide ? 1 : 0) - (x.side === winnerSide ? 1 : 0) : 0));
  const top = sorted[0];
  const motm = top ? { playerId: top.playerId, side: top.side, rating: top.rating, reason: motmReason(top) } : null;

  // ---- findings ----
  const findings = buildFindings(sim, winner);
  const decisions: MatchResult['decisions'] = [decisionReport(sim, 0), decisionReport(sim, 1)];

  // ---- verdict & summary ----
  const verdict = buildVerdict(sim, motm);
  const summaryWord: [string, string] = [summaryFor(sim, 0), summaryFor(sim, 1)];

  return {
    score: [score[0], score[1]],
    htScore: sim.htScore,
    extraTime: sim.extraTime,
    penalties: sim.penalties,
    winner,
    events: sim.events,
    stats: [h.stats, a.stats].map((s) => ({ ...s, xg: Math.round(s.xg * 100) / 100 })) as [TeamStats, TeamStats],
    players,
    injuries: sim.injuries,
    modifiers: sim.modifiers,
    findings,
    triggersFired: sim.triggersFired,
    momentum: sim.momentumTrace,
    keyMoments,
    motm,
    verdict,
    summaryWord,
    minutesPlayed: total,
    decisions,
  };
}

const PI_STAT: Record<string, [string, (s: PlayerMatchStat) => number]> = {
  shooting: ['shots', (s) => s.shots],
  dribbling: ['dribbles', (s) => s.dribbles],
  passing: ['key passes', (s) => s.keyPasses],
  crossing: ['crosses', (s) => s.crosses],
  movement: ['touches in the final third', (s) => s.zoneTouches.slice(12).reduce((a, b) => a + b, 0)],
  width: ['touches in central areas', (s) => s.zoneTouches.filter((_, z) => z % 3 === 1).reduce((a, b) => a + b, 0)],
  press: ['pressures', (s) => s.pressures],
  tackling: ['fouls', (s) => s.fouls],
};

function decisionReport(sim: MatchSim, side: 0 | 1): DecisionReport {
  const t = sim.teams[side];
  const o = sim.teams[1 - side];
  const st = t.stats;
  const ch = st.attacksByChannel;
  const chTot = ch[0] + ch[1] + ch[2] || 1;
  const outOfPosition = t.players
    .filter((ps) => ps.used && !ps.isGk && ps.st.fam < 0.75 && ps.st.minutes >= 20)
    .map((ps) => ({ playerId: ps.p.id, pos: ps.st.pos, fam: ps.st.fam, duelsLost: ps.duelsLost, rating: ps.st.rating, passes: ps.st.passes, passesCompleted: ps.st.passesCompleted }));
  const instructionUse: DecisionReport['instructionUse'] = [];
  t.input.tactic.slots.forEach((slot, i) => {
    if (!slot.pi) return;
    const starter = t.players.find((ps) => ps.started && t.input.lineup[i] === ps.p.id);
    if (!starter) return;
    for (const [k, v] of Object.entries(slot.pi)) {
      const m = PI_STAT[k];
      if (!m || !v) continue;
      instructionUse.push({ playerId: starter.p.id, key: k, value: String(v), count: m[1](starter.st), stat: m[0] });
    }
  });
  return {
    pressWinsHigh: t.dec.highWins,
    ppda: Math.round((t.dec.oppPassesOwn60 / Math.max(1, t.dec.defActionsHigh)) * 10) / 10,
    throughConceded: t.dec.throughFaced,
    throughCompleted: t.dec.throughFacedDone,
    offsidesWon: o.stats.offsides,
    flank: [Math.round((ch[0] / chTot) * 100), Math.round((ch[1] / chTot) * 100), Math.round((ch[2] / chTot) * 100)],
    counters: st.counters,
    countersShots: st.chanceOrigins.counter,
    crossesShots: st.chanceOrigins.cross,
    longShots: st.chanceOrigins.long_shot,
    setPieceXg: Math.round(t.dec.spXg * 100) / 100,
    outOfPosition,
    instructionUse,
  };
}

function motmReason(s: PlayerMatchStat): string {
  const bits: string[] = [];
  if (s.goals) bits.push(`${s.goals} goal${s.goals > 1 ? 's' : ''}`);
  if (s.assists) bits.push(`${s.assists} assist${s.assists > 1 ? 's' : ''}`);
  if (s.saves >= 3) bits.push(`${s.saves} saves`);
  const def = s.tacklesWon + s.interceptions;
  if (def >= 5) bits.push(`${def} tackles and interceptions`);
  if (s.keyPasses >= 3 && !s.assists) bits.push(`${s.keyPasses} chances created`);
  if (s.dribblesCompleted >= 4) bits.push(`${s.dribblesCompleted} dribbles completed`);
  if (!bits.length && s.passes >= 30) bits.push(`${Math.round((s.passesCompleted / s.passes) * 100)}% passing from ${s.passes} passes`);
  if (!bits.length) bits.push('a tireless all-round display');
  return bits.slice(0, 2).join(' and ');
}

function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function buildFindings(sim: MatchSim, winner: 0 | 1 | null): Finding[] {
  const out: Finding[] = [];
  for (const t of sim.teams) {
    const side = t.side;
    const o = sim.teams[1 - side];
    const st = t.stats;
    const os = o.stats;
    const name = t.input.short;
    const oname = o.input.short;
    // Middle-third control
    const [mAtt, mComp] = st.passesByThird[1];
    const [omAtt, omComp] = os.passesByThird[1];
    const mRate = mAtt ? mComp / mAtt : 1;
    const omRate = omAtt ? omComp / omAtt : 1;
    const centralPres = t.presAtt[7] + t.presAtt[10];
    const oppCentralDef = o.presDef[7] + o.presDef[10];
    if (mAtt > 60 && mRate < LEAGUE_MID_THIRD_COMPLETION - 0.06 && oppCentralDef > centralPres * 0.9) {
      const flank = st.attacksByChannel[0] + st.attacksByChannel[2];
      const all = flank + st.attacksByChannel[1];
      out.push({
        side, kind: 'zone', weight: (LEAGUE_MID_THIRD_COMPLETION - mRate) * 100 + 4,
        headline: `${oname}'s ${o.formationKey} outnumbered ${name} in central midfield.`,
        detail: `${name} completed ${pct(mComp, mAtt)}% of passes in the middle third, against a league average of ${Math.round(LEAGUE_MID_THIRD_COMPLETION * 100)}%. ${flank} of their ${all} attacks went down the flanks.`,
        metric: `${pct(mComp, mAtt)}%`,
      });
    }
    if (mAtt > 60 && mRate > LEAGUE_MID_THIRD_COMPLETION + 0.06 && omRate < mRate) {
      out.push({
        side, kind: 'zone', weight: (mRate - LEAGUE_MID_THIRD_COMPLETION) * 80 + 3,
        headline: `${name} controlled the middle of the park.`,
        detail: `${pct(mComp, mAtt)}% of their passes in the middle third found a teammate, against ${pct(omComp, omAtt)}% for ${oname}.`,
        metric: `${pct(mComp, mAtt)}%`,
      });
    }
    // Offsides / high line
    const ohigh = t.ins.line === 'high' || t.ins.line === 'very_high';
    if (ohigh && os.offsides >= 3) {
      out.push({
        side, kind: 'pairing', weight: 3 + os.offsides,
        headline: `${name}'s high line worked.`,
        detail: `${oname}'s forwards were caught offside ${os.offsides} times and had ${os.zoneTouches[15] + os.zoneTouches[16] + os.zoneTouches[17]} touches in the box.`,
        metric: `${os.offsides} offsides`,
      });
    }
    const behind = os.chanceOrigins.through;
    if (ohigh && behind >= 2 && os.shots > 0) {
      out.push({
        side, kind: 'pairing', weight: 4 + behind * 1.5,
        headline: `${name}'s high line was beaten by balls over the top.`,
        detail: `${behind} of ${oname}'s ${os.shots} chances started behind the defensive line.`,
        metric: `${behind}/${os.shots}`,
      });
    }
    // Finishing
    const gd = t.goals - st.xg;
    if (gd >= 1.2) out.push({ side, kind: 'stat', weight: 3 + gd, headline: `Clinical finishing from ${name}.`, detail: `${t.goals} goals from ${st.xg.toFixed(1)} expected goals.`, metric: `${st.xg.toFixed(1)} xG` });
    if (gd <= -1.3) out.push({ side, kind: 'stat', weight: 3 - gd, headline: `${name} wasted their chances.`, detail: `${t.goals} goal${t.goals === 1 ? '' : 's'} from ${st.xg.toFixed(1)} expected goals, including ${st.bigChancesMissed} big chance${st.bigChancesMissed === 1 ? '' : 's'} missed.`, metric: `${st.xg.toFixed(1)} xG` });
    // Possession without penetration
    if (st.possession >= 60 && st.xg < 1 && os.xg >= st.xg) {
      out.push({ side, kind: 'style', weight: 4, headline: `Plenty of the ball, little end product.`, detail: `${name} had ${st.possession}% possession but managed only ${st.xg.toFixed(1)} xG against a deep ${oname} side.`, metric: `${st.possession}%` });
    }
    // Crossing
    if (st.crosses >= 18) {
      out.push({ side, kind: 'stat', weight: 2 + st.crosses / 10, headline: `${name} went to the flanks.`, detail: `${st.crosses} crosses, ${st.crossesCompleted} found a teammate, producing ${st.chanceOrigins.cross} shots.`, metric: `${st.crosses} crosses` });
    }
    // Counters
    if (st.counters >= 4 && st.chanceOrigins.counter >= 2) {
      out.push({ side, kind: 'style', weight: 3 + st.chanceOrigins.counter, headline: `${name} hurt ${oname} on the break.`, detail: `${st.counters} counter-attacks produced ${st.chanceOrigins.counter} shots.`, metric: `${st.counters} breaks` });
    }
    if (st.pressWins >= 6) {
      out.push({ side, kind: 'style', weight: 2 + st.pressWins / 3, headline: `${name}'s counter-press kept ${oname} penned in.`, detail: `They won the ball straight back ${st.pressWins} times after losing it.`, metric: `${st.pressWins} regains` });
    }
    // Set pieces
    const spGoals = sim.events.filter((e) => e.t === 'goal' && e.side === side && (e.o === 'set_piece' || e.k === 'goal_freekick')).length;
    if (spGoals >= 1) out.push({ side, kind: 'stat', weight: 3 + spGoals * 2, headline: `Set pieces made the difference for ${name}.`, detail: `${spGoals} goal${spGoals > 1 ? 's' : ''} from dead-ball situations.`, metric: `${spGoals}` });
    // Keeper
    const gk = t.players.find((p) => p.st.saves >= 5);
    if (gk) out.push({ side, kind: 'player', weight: 2 + gk.st.saves / 2, headline: `${gk.p.short} kept ${name} in it.`, detail: `${gk.st.saves} saves, several from close range.`, metric: `${gk.st.saves} saves` });
    // Fatigue
    const spent = t.players.filter((p) => p.used && p.onPitch && p.cond < 50).length;
    if (spent >= 3) out.push({ side, kind: 'fatigue', weight: 2 + spent, headline: `${name} ran out of legs.`, detail: `${spent} players finished below 50% condition${t.ins.press === 'all_out' || t.ins.press === 'high' ? ' after an intense pressing game' : ''}.`, metric: `${spent} players` });
    // Signature traits that decided moments
    for (const ps of t.players) {
      for (const [k, n] of Object.entries(ps.st.traitMoments)) {
        if (!n) continue;
        const def = TRAITS[k as TraitKey];
        if (!def) continue;
        out.push({ side, kind: 'player', weight: 3 + n * 2.2, headline: `${ps.p.short}'s ${def.name} made the difference.`, detail: `${def.effect} It decided ${n} moment${n > 1 ? 's' : ''} in this match.`, metric: `${n}` });
      }
    }
    // Players out of position
    for (const ps of t.players) {
      if (!ps.used || ps.isGk || ps.st.fam >= 0.6 || ps.st.minutes < 30) continue;
      out.push({ side, kind: 'player', weight: 2.5 + ps.duelsLost * 0.4 + (6.5 - Math.min(6.5, ps.st.rating)) * 2, headline: `${ps.p.short} looked lost at ${ps.st.pos}.`, detail: `It is not a position he knows (${Math.round(ps.st.fam * 100)}% familiar). ${ps.duelsLost > 0 ? `He was beaten ${ps.duelsLost} time${ps.duelsLost === 1 ? '' : 's'}` : ps.st.passes > 0 ? `He completed ${ps.st.passesCompleted} of ${ps.st.passes} passes` : 'He barely got into the game'} and rated ${ps.st.rating.toFixed(1)}.`, metric: `${Math.round(ps.st.fam * 100)}%` });
    }
    // High press
    if (t.dec.highWins >= 9) {
      out.push({ side, kind: 'style', weight: 2 + t.dec.highWins / 4, headline: `${name}'s press won the ball high up the pitch.`, detail: `${t.dec.highWins} regains in ${oname}'s half, allowing only ${(t.dec.oppPassesOwn60 / Math.max(1, t.dec.defActionsHigh)).toFixed(1)} passes per defensive action.`, metric: `${t.dec.highWins}` });
    }
    // Triggers
    for (const tr of sim.triggersFired.filter((x) => x.side === side)) {
      const after = sim.events.filter((e) => e.t === 'goal' && e.side === side && e.m >= tr.minute).length;
      out.push({ side, kind: 'trigger', weight: after ? 3 + after : 1.5, headline: `Your ${tr.minute}' trigger fired: ${tr.desc}.`, detail: after ? `${name} scored ${after} after the change.` : `It did not change the scoreline.`, metric: `${tr.minute}'` });
    }
  }
  // Interaction-layer modifiers, supported by the numbers
  for (const m of sim.modifiers) {
    const t = sim.teams[m.side];
    const st = t.stats;
    let evidence = 1;
    if (m.key === 'high_line_vs_pace') evidence = 1 + st.chanceOrigins.through;
    if (m.key === 'narrow_vs_width') evidence = 1 + st.chanceOrigins.cross / 2;
    if (m.key === 'press_break') evidence = 1 + st.counters / 3;
    if (m.key === 'deep_vs_patient') evidence = 1 + st.chanceOrigins.long_shot / 3;
    out.push({ side: m.side, kind: m.key.startsWith('style') ? 'style' : 'pairing', weight: m.value * 0.6 * evidence, headline: m.cause, detail: '', metric: undefined });
  }
  void winner;
  return out.sort((x, y) => y.weight - x.weight).slice(0, 12);
}

function buildVerdict(sim: MatchSim, motm: MatchResult['motm']): string {
  const [h, a] = sim.teams;
  const [sh, sa] = sim.score;
  const hn = h.input.short;
  const an = a.input.short;
  const xgh = h.stats.xg;
  const xga = a.stats.xg;
  const parts: string[] = [];
  if (sh === sa) {
    parts.push(sh === 0 ? `${hn} and ${an} could not be separated in a goalless draw.` : `${hn} and ${an} shared the points in a ${sh}-${sa} draw.`);
  } else {
    const [w, l] = sh > sa ? [hn, an] : [an, hn];
    const margin = Math.abs(sh - sa);
    parts.push(margin >= 3 ? `${w} were far too good for ${l}.` : margin === 2 ? `${w} saw off ${l} with something to spare.` : `${w} edged past ${l}.`);
  }
  const xgDiff = xgh - xga;
  if (Math.abs(xgDiff) >= 0.8) {
    const dom = xgDiff > 0 ? hn : an;
    const domWon = (xgDiff > 0 && sh > sa) || (xgDiff < 0 && sa > sh);
    parts.push(domWon ? `${dom} created the better chances (${xgh.toFixed(1)} xG to ${xga.toFixed(1)}) and deserved it.` : `${dom} created the better chances (${xgh.toFixed(1)} xG to ${xga.toFixed(1)}) but that is not what counts.`);
  } else {
    parts.push(`There was little between the sides on chances (${xgh.toFixed(1)} xG to ${xga.toFixed(1)}).`);
  }
  if (sim.penalties) parts.push(`It was settled on penalties, ${sim.penalties.home}-${sim.penalties.away}.`);
  if (motm) {
    const p = [...h.players, ...a.players].find((x) => x.p.id === motm.playerId);
    if (p) parts.push(`${p.p.name} was the standout, with ${motm.reason}.`);
  }
  return parts.join(' ');
}

function summaryFor(sim: MatchSim, side: 0 | 1): string {
  const me = sim.score[side];
  const them = sim.score[1 - side];
  const xg = sim.teams[side].stats.xg;
  const oxg = sim.teams[1 - side].stats.xg;
  const goals = sim.events.filter((e) => e.t === 'goal');
  const last = goals[goals.length - 1];
  const lateWinner = last && last.m >= 85 && last.side === side && me === them + 1;
  const lateLoss = last && last.m >= 85 && last.side !== side && them === me + 1;
  let trailed = false;
  for (const g of goals) if (g.sc && g.sc[side] < g.sc[1 - side]) trailed = true;
  if (sim.penalties) return (sim.penalties.home > sim.penalties.away) === (side === 0) ? 'Nerves of steel' : 'Penalty heartbreak';
  if (me > them) {
    if (trailed) return 'Comeback';
    if (lateWinner) return 'Late drama';
    if (me - them >= 3) return oxg > xg ? 'Ruthless' : 'Comfortable';
    if (xg + 0.6 < oxg) return 'Smash and grab';
    if (me + them >= 5) return 'Thriller';
    return me - them === 1 ? 'Hard-fought' : 'Convincing';
  }
  if (me < them) {
    if (lateLoss) return 'Late heartbreak';
    if (them - me >= 3) return 'Battered';
    if (xg > oxg + 0.8) return 'Robbed';
    return 'Beaten';
  }
  if (me === 0) return xg > oxg + 0.7 ? 'Frustrating' : 'Stalemate';
  if (me >= 3) return 'Thriller';
  return xg + 0.6 < oxg ? 'Hard-earned point' : xg > oxg + 0.6 ? 'Two points dropped' : 'Honours even';
}
