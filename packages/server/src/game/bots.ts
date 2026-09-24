// Bot manager match decisions (assess opponent -> pick tactic -> select XI -> instructions -> triggers)
// and the assistant manager's pick for humans who miss a deadline.
import { Rng, selectTeam, normaliseTactic, rawRoleRating, type Tactic, type OppInstruction } from '@ffm/engine';
import type { Db } from '../db.ts';
import { botTriggers } from './archetypes.ts';
import { attrsOf, isAvailable, toSelectable } from './players.ts';
import type { ClubRow, FixtureRow, PlayerRow, TacticRow } from './types.ts';

export interface SheetDraft {
  tactic: Tactic;
  lineup: number[];
  bench: number[];
  planB: Tactic | null;
  opp: OppInstruction[];
  captainId: number | null;
  submittedBy: 'user' | 'assistant' | 'bot';
  tacticId?: number;
}

export interface OpponentScout {
  recent: Tactic[];
  strength: number;
  bestAttacker: PlayerRow | null;
}

export async function scoutOpponent(d: Db, oppId: number, beforeIso: Date | string): Promise<Tactic[]> {
  const rows = await d.many<{ tactic: Tactic }>(
    `select ts.tactic from team_sheets ts join fixtures f on f.id = ts.fixture_id
      where ts.club_id = $1 and f.status = 'played' and f.kickoff_at < $2
      order by f.kickoff_at desc limit 3`,
    [oppId, beforeIso],
  );
  return rows.map((r) => r.tactic);
}

export function teamStrength(squad: PlayerRow[], tactic: Tactic): number {
  return selectTeam(squad.map(toSelectable), tactic, { benchSize: 0 }).strength;
}

function majority<T>(arr: T[], pred: (t: T) => boolean): boolean {
  return arr.length > 0 && arr.filter(pred).length >= Math.ceil(arr.length / 2);
}

export function botSheet(opts: {
  club: ClubRow;
  squad: PlayerRow[];
  tactics: TacticRow[];
  fixture: FixtureRow;
  isHome: boolean;
  oppRecent: Tactic[];
  oppSquad: PlayerRow[];
  daysSinceLast: number;
  importance: number;
  compType: string;
  rng: Rng;
}): SheetDraft {
  const { club, squad, tactics, rng } = opts;
  const bot = club.bot;
  const acumen = bot.acumen;
  const def = tactics.find((t) => t.is_default) ?? tactics[0];
  let chosen = def;
  if (bot.archetype === 'tinkerman' && tactics.length > 1 && rng.chance(0.7)) chosen = rng.pick(tactics);
  let tactic = normaliseTactic(JSON.parse(JSON.stringify(chosen.data)));
  const ins = tactic.instructions;
  const opp = opts.oppRecent;
  const notes: string[] = [];

  // Counter the opponent with probability acumen/20, only in a familiar shape.
  if (opp.length && chosen.familiarity >= 0.6 && rng.chance(acumen / 20)) {
    if (majority(opp, (t) => t.instructions.line === 'high' || t.instructions.line === 'very_high')) {
      if (bot.archetype === 'purist') {
        // Possession sides stay true to themselves but look for the ball in behind more often.
        ins.tempo = ins.tempo === 'slow' ? 'normal' : ins.tempo;
        notes.push('quicken the tempo to find space behind a high line');
      } else {
        ins.passing = 'direct';
        ins.counter = true;
        notes.push('go direct in behind a high line');
      }
    }
    if (majority(opp, (t) => t.instructions.width === 'narrow')) {
      ins.width = 'wide';
      ins.overlap = 'overlap';
      notes.push('stretch a narrow side');
    }
    if (majority(opp, (t) => t.instructions.line === 'deep')) {
      ins.tempo = 'slow';
      ins.shootOnSight = true;
      notes.push('be patient against a deep block');
    }
    if (majority(opp, (t) => t.instructions.press === 'all_out')) {
      const back = squad.filter((p) => (p.positions.DC ?? 0) >= 0.8);
      const comp = back.length ? back.reduce((s, p) => s + attrsOf(p).composure, 0) / back.length : 120;
      if (comp >= 140) ins.playOutOfDefence = true;
      else { ins.passing = 'direct'; ins.playOutOfDefence = false; }
    }
    if (majority(opp, (t) => t.instructions.counter) && acumen >= 14) {
      ins.counterPress = true;
    }
  }

  // Relative strength: a weak side away to a strong one sits deeper and goes more direct.
  const myStrength = teamStrength(squad, tactic);
  const oppStrength = opts.oppSquad.length ? teamStrength(opts.oppSquad, tactic) : myStrength;
  const gap = myStrength - oppStrength;
  if (gap < -10 && !opts.isHome && bot.archetype !== 'purist' && bot.archetype !== 'chequebook') {
    tactic.mentality = Math.max(-2, tactic.mentality - 1);
    if (ins.line !== 'deep') ins.line = 'normal';
  }
  if (gap > 12 && opts.isHome && tactic.mentality < 2) tactic.mentality += 1;
  // Grudge: a heavy defeat last time makes a bot cautious.
  const oppId = opts.isHome ? opts.fixture.away_id : opts.fixture.home_id;
  const grudge = bot.grudges?.[String(oppId)] ?? 0;
  if (grudge >= 3) tactic.mentality = Math.max(-2, tactic.mentality - 1);

  // Selection with rotation rules and archetype bias
  const restBelow = opts.daysSinceLast <= 3 ? 80 : 70;
  const rotateCup = (opts.compType === 'league_cup' || (opts.compType === 'fa_cup' && opts.importance < 1.2)) && gap > -5;
  const sel = selectTeam(squad.map(toSelectable), tactic, {
    restBelow: rotateCup ? 92 : restBelow,
    youthBonus: bot.archetype === 'youth' ? 9 : 0,
    experienceBonus: bot.archetype === 'cynic' ? 4 : 0,
    noise: Math.max(0, (20 - acumen) * 0.45),
    rng,
    benchSize: 9,
  });
  // Imperfection: occasionally leave a star on the bench
  if (rng.chance(0.03 * (20 - acumen) / 10)) {
    const outfield = sel.lineup.map((id, i) => ({ id, i })).filter(({ i }) => tactic.slots[i].pos !== 'GK');
    const star = outfield.sort((a, b) => (squad.find((p) => p.id === b.id)?.ca ?? 0) - (squad.find((p) => p.id === a.id)?.ca ?? 0))[0];
    const repl = sel.bench.find((id) => { const p = squad.find((x) => x.id === id); return p && (p.positions[tactic.slots[star.i].pos] ?? 0) >= 0.7; });
    if (star && repl) {
      sel.bench = sel.bench.filter((b) => b !== repl).concat(star.id);
      sel.lineup[star.i] = repl;
    }
  }
  tactic.triggers = botTriggers(acumen, bot.archetype);
  tactic.setPieces = { ...tactic.setPieces, ...sel.setPieces };

  // Opposition instructions: man-mark a dominant attacker
  const opps: OppInstruction[] = [];
  if (acumen >= 12 && opts.oppSquad.length) {
    const theirBest = opts.oppSquad.filter((p) => isAvailable(p) && ['ST', 'AMC', 'AML', 'AMR'].some((pos) => (p.positions[pos as 'ST'] ?? 0) >= 0.9)).sort((a, b) => b.ca - a.ca)[0];
    const myBestDef = squad.filter((p) => (p.positions.DC ?? 0) >= 0.9).sort((a, b) => b.ca - a.ca)[0];
    if (theirBest && myBestDef && theirBest.ca > myBestDef.ca + 12 && rng.chance(acumen / 24)) opps.push({ playerId: theirBest.id, type: 'tight_mark' });
  }
  const planBRow = tactics.find((t) => t.id !== chosen.id);
  void notes;
  void rawRoleRating;
  return {
    tactic, lineup: sel.lineup, bench: sel.bench, planB: planBRow ? normaliseTactic(planBRow.data) : null, opp: opps,
    captainId: sel.captainId, submittedBy: 'bot', tacticId: chosen.id,
  };
}

/** The assistant manager's pick: the human's default shape and saved XI, rotating tired or unavailable players. */
export function assistantSheet(opts: { squad: PlayerRow[]; tactic: TacticRow; planB: TacticRow | null; assistantRating: number; daysSinceLast: number; rng: Rng }): SheetDraft {
  const { squad, tactic } = opts;
  const t = normaliseTactic(tactic.data);
  const keep = new Map<number, number>();
  (tactic.lineup ?? []).forEach((pid, slot) => { if (pid && pid > 0) keep.set(pid, slot); });
  const rating = opts.assistantRating;
  const restBelow = opts.daysSinceLast <= 3 ? 64 + rating * 0.6 : 58 + rating * 0.4;
  const sel = selectTeam(squad.map(toSelectable), t, {
    keep, restBelow, benchSize: 9, noise: Math.max(0, (20 - rating) * 0.3), rng: opts.rng,
  });
  if (!t.setPieces.cornerTaker) t.setPieces.cornerTaker = sel.setPieces.cornerTaker;
  if (!t.setPieces.freeKickTaker) t.setPieces.freeKickTaker = sel.setPieces.freeKickTaker;
  if (!t.setPieces.penaltyTaker) t.setPieces.penaltyTaker = sel.setPieces.penaltyTaker;
  return {
    tactic: t, lineup: sel.lineup, bench: sel.bench, planB: opts.planB ? normaliseTactic(opts.planB.data) : null, opp: [],
    captainId: sel.captainId, submittedBy: 'assistant', tacticId: tactic.id,
  };
}

/** Validate a submitted sheet against the current squad; repairs unavailable picks with the assistant's choice. */
export function repairSheet(sheet: SheetDraft, squad: PlayerRow[]): { sheet: SheetDraft; changed: number } {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const lineup = sheet.lineup.slice();
  let changed = 0;
  const used = new Set(lineup.filter((id) => byId.get(id) && isAvailable(byId.get(id)!)));
  for (let i = 0; i < lineup.length; i++) {
    const p = byId.get(lineup[i]);
    if (p && isAvailable(p)) continue;
    const slot = sheet.tactic.slots[i];
    const cand = squad.filter((x) => isAvailable(x) && !used.has(x.id))
      .map((x) => ({ x, v: rawRoleRating(attrsOf(x), slot.role, slot.duty) * Math.max(0.5, x.positions[slot.pos] ?? 0) * (0.6 + x.condition / 250) }))
      .filter((c) => slot.pos === 'GK' ? (c.x.positions.GK ?? 0) >= 0.5 : (c.x.positions.GK ?? 0) < 0.8)
      .sort((a, b) => b.v - a.v)[0];
    if (cand) { lineup[i] = cand.x.id; used.add(cand.x.id); changed++; }
  }
  const bench = sheet.bench.filter((id) => { const p = byId.get(id); return p && isAvailable(p) && !lineup.includes(id); });
  return { sheet: { ...sheet, lineup, bench }, changed };
}
