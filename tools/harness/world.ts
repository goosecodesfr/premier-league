// Shared helpers for harness runs: load the seed and turn clubs into engine inputs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  attrsFromArray, hiddenFromArray, makeTactic, selectTeam, type MatchPlayerInput, type TeamInput, type Tactic,
  type SelectablePlayer, type FormationKey,
} from '@ffm/engine';

export interface SeedClub { key: string; name: string; short: string; league: string; reputation: number; archetype: string; capacity: number }
export interface SeedPlayer { sid: number; club: string | null; name: string; short: string; age: number; foot: 'L' | 'R' | 'B'; pos: Record<string, number>; a: number[]; hd: number[]; ca: number; pa: number }

export function loadSeed() {
  const seed = JSON.parse(readFileSync(join(process.cwd(), 'data', 'seed', 'world-seed.json'), 'utf8'));
  return seed as { clubs: SeedClub[]; players: SeedPlayer[] };
}

export interface HClub { club: SeedClub; players: MatchPlayerInput[]; sel: SelectablePlayer[] }

export function buildClubs(seed: ReturnType<typeof loadSeed>, league = 'PL'): HClub[] {
  return seed.clubs.filter((c) => c.league === league).map((club) => {
    const ps = seed.players.filter((p) => p.club === club.key);
    const players: MatchPlayerInput[] = ps.map((p) => ({
      id: p.sid, name: p.name, short: p.short, attrs: attrsFromArray(p.a), hidden: hiddenFromArray(p.hd), fam: p.pos,
      foot: p.foot, age: p.age, condition: 100, sharpness: 90, form: 1, morale: 1, fatigueDebt: 0,
    }));
    const sel: SelectablePlayer[] = players.map((p) => ({ id: p.id, attrs: p.attrs, fam: p.fam, condition: p.condition, sharpness: p.sharpness, form: p.form, morale: p.morale, age: p.age, available: true, ca: ps.find((x) => x.sid === p.id)!.ca }));
    return { club, players, sel };
  });
}

export const ARCH_TACTIC: Record<string, () => Tactic> = {
  purist: () => makeTactic('Possession', '4-3-3', { mentality: 1, instructions: { ...makeTactic('x', '4-3-3').instructions, tempo: 'slow', passing: 'short', playOutOfDefence: true, line: 'high', press: 'high', counterPress: true, workIntoBox: true } }),
  pragmatist: () => makeTactic('Balanced', '4-2-3-1'),
  gegenpresser: () => makeTactic('Gegenpress', '4-2-3-1', { mentality: 1, instructions: { ...makeTactic('x', '4-3-3').instructions, tempo: 'high', press: 'all_out', pressTrigger: 'always', counterPress: true, line: 'high' } }),
  counter: () => makeTactic('Counter', '5-3-2', { mentality: -1, instructions: { ...makeTactic('x', '4-3-3').instructions, line: 'deep', passing: 'direct', counter: true, press: 'low', tempo: 'high' } }),
  cynic: () => makeTactic('Low block', '4-1-4-1', { mentality: -1, instructions: { ...makeTactic('x', '4-3-3').instructions, line: 'deep', tackling: 'hard', timeWasting: true, press: 'low', counter: true } }),
  youth: () => makeTactic('Youth', '4-3-3', { instructions: { ...makeTactic('x', '4-3-3').instructions, tempo: 'high', press: 'high' } }),
  chequebook: () => makeTactic('Stars', '4-3-3', { mentality: 1 }),
  tinkerman: () => makeTactic('Tinker', '3-4-3'),
};

export function teamInput(c: HClub, tactic: Tactic, isBot = true): TeamInput {
  const s = selectTeam(c.sel, tactic, { benchSize: 9 });
  return {
    clubId: c.players[0]?.id ?? 0, name: c.club.name, short: c.club.short, code: c.club.key, players: c.players,
    lineup: s.lineup, bench: s.bench, tactic: { ...tactic, setPieces: { ...tactic.setPieces, ...s.setPieces } },
    familiarity: 0.85, captainId: s.captainId, acumen: 13, isBot, autoSubs: true,
  };
}

export function formationTactic(f: Exclude<FormationKey, 'Custom'>): Tactic {
  return makeTactic(f, f);
}
