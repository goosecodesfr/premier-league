// Bot manager archetypes: tactical signatures, market behaviour and flavour.
import { makeTactic, DEFAULT_INSTRUCTIONS, type Tactic, type Instructions, type Trigger, randomName, Rng } from '@ffm/engine';
import type { Archetype, BotProfile, Difficulty } from './types.ts';
import { namePools } from './seed.ts';

export const ARCHETYPE_INFO: Record<Archetype, { label: string; desc: string; market: string }> = {
  purist: { label: 'The Possession Purist', desc: '4-3-3, short passing, high line, plays out from the back.', market: 'Buys technical midfielders and overpays for passers.' },
  pragmatist: { label: 'The Pragmatist', desc: 'Adapts to the opponent, usually 4-4-2 or 4-2-3-1.', market: 'Value-hunter with a balanced squad.' },
  gegenpresser: { label: 'The Gegenpresser', desc: 'All-out press, counter-press, high tempo.', market: 'Young, high-stamina, hard-working players.' },
  counter: { label: 'The Counter-puncher', desc: 'Deep line, direct, lethal on the break.', market: 'Pace up front and strong centre-backs.' },
  cynic: { label: 'The Cynic', desc: 'Deep, hard tackling and time-wasting.', market: 'Cheap experienced pros on low wages.' },
  youth: { label: 'The Youth Builder', desc: 'Plays the kids.', market: 'Almost never buys over 24 and sells at the peak.' },
  chequebook: { label: 'The Chequebook', desc: 'Picks the best-rated XI, no coherent idea.', market: 'Overspends and hoards talent.' },
  tinkerman: { label: 'The Tinkerman', desc: 'Changes formation constantly.', market: 'Erratic in the market too.' },
};

const I = (p: Partial<Instructions>): Instructions => ({ ...DEFAULT_INSTRUCTIONS, ...p });

export function archetypeTactics(a: Archetype): Tactic[] {
  switch (a) {
    case 'purist':
      return [
        makeTactic('Possession 4-3-3', '4-3-3', { mentality: 1, instructions: I({ tempo: 'slow', passing: 'short', playOutOfDefence: true, line: 'high', press: 'high', counterPress: true, workIntoBox: true, gkDistribution: 'short', regainDistribution: 'possession' }) }),
        makeTactic('Control 4-2-3-1', '4-2-3-1', { mentality: 1, instructions: I({ tempo: 'slow', passing: 'short', playOutOfDefence: true, line: 'high', press: 'high', counterPress: true }) }),
      ];
    case 'pragmatist':
      return [
        makeTactic('Balanced 4-2-3-1', '4-2-3-1'),
        makeTactic('Solid 4-4-2', '4-4-2', { instructions: I({ passing: 'mixed', line: 'normal' }) }),
        makeTactic('Counter 4-4-2', '4-4-2', { mentality: -1, instructions: I({ line: 'deep', counter: true, passing: 'direct' }) }),
      ];
    case 'gegenpresser':
      return [
        makeTactic('Gegenpress 4-2-3-1', '4-2-3-1', { mentality: 1, instructions: I({ tempo: 'high', press: 'all_out', pressTrigger: 'always', counterPress: true, line: 'high' }) }),
        makeTactic('Heavy metal 4-3-3', '4-3-3', { mentality: 1, instructions: I({ tempo: 'high', press: 'high', counterPress: true, line: 'high', passing: 'direct' }) }),
      ];
    case 'counter':
      return [
        makeTactic('Counter 5-3-2', '5-3-2', { mentality: -1, instructions: I({ line: 'deep', passing: 'direct', counter: true, press: 'low', tempo: 'high', gkDistribution: 'long' }) }),
        makeTactic('Break 4-4-2', '4-4-2', { mentality: -1, instructions: I({ line: 'deep', passing: 'direct', counter: true, press: 'normal' }) }),
      ];
    case 'cynic':
      return [
        makeTactic('Low block 4-1-4-1', '4-1-4-1', { mentality: -1, instructions: I({ line: 'deep', tackling: 'hard', timeWasting: true, press: 'low', counter: true, width: 'narrow' }) }),
        makeTactic('Bus 5-3-2', '5-3-2', { mentality: -2, instructions: I({ line: 'deep', tackling: 'hard', timeWasting: true, press: 'low', counter: true, width: 'narrow', passing: 'direct' }) }),
      ];
    case 'youth':
      return [
        makeTactic('Youth 4-3-3', '4-3-3', { instructions: I({ tempo: 'high', press: 'high' }) }),
        makeTactic('Youth 4-2-3-1', '4-2-3-1', { instructions: I({ tempo: 'high' }) }),
      ];
    case 'chequebook':
      return [makeTactic('Stars 4-3-3', '4-3-3', { mentality: 1 }), makeTactic('Stars 4-2-3-1', '4-2-3-1', { mentality: 1 })];
    case 'tinkerman':
      return [
        makeTactic('Experiment 3-4-3', '3-4-3'),
        makeTactic('Experiment 4-4-1-1', '4-4-1-1'),
        makeTactic('Experiment 3-5-2', '3-5-2', { mentality: 1 }),
        makeTactic('Experiment 4-1-4-1', '4-1-4-1', { instructions: I({ press: 'high' }) }),
      ];
  }
}

/** Triggers a bot runs, scaled by acumen: 1 at acumen 8, 3 at 18. */
export function botTriggers(acumen: number, archetype: Archetype): Trigger[] {
  const n = acumen >= 16 ? 3 : acumen >= 12 ? 2 : 1;
  const all: Trigger[] = [
    { id: 'chase', when: { kind: 'score', state: 'losing', by: 1, minute: archetype === 'cynic' ? 70 : 60 }, actions: [{ type: 'mentality', delta: 1 }, { type: 'sub', out: 'lowest_rated', outLine: 'DEF', in: 'most_attacking' }] },
    { id: 'tired', when: { kind: 'condition', below: 62, minute: 55 }, actions: [{ type: 'sub', out: 'trigger_player', in: 'best_available' }] },
    { id: 'protect', when: { kind: 'score', state: 'winning', by: 2, minute: 72 }, actions: [{ type: 'mentality', delta: -1 }, { type: 'instruction', key: 'line', value: 'deep' }] },
  ];
  return all.slice(0, n);
}

export function acumenFor(difficulty: Difficulty, reputation: number, rng: Rng): number {
  const [lo, hi] = difficulty === 'casual' ? [8, 11] : difficulty === 'competitive' ? [14, 18] : [10, 15];
  // bigger clubs tend to hire sharper managers
  const bias = (reputation - 70) / 30;
  return Math.round(Math.max(lo, Math.min(hi, lo + (hi - lo) * (0.5 + bias * 0.35) + rng.normal(0, 1.2))));
}

const MANAGER_NATS: Record<string, string[]> = {
  ENG: ['ENG', 'ENG', 'ENG', 'SCO', 'IRL', 'WAL', 'ESP', 'POR', 'GER', 'NED', 'ITA', 'FRA', 'NOR', 'DEN', 'ARG'],
  WAL: ['WAL', 'ENG', 'SCO'], ESP: ['ESP'], GER: ['GER', 'AUT', 'SUI'], ITA: ['ITA'], FRA: ['FRA', 'BEL'], POR: ['POR', 'BRA'],
  NED: ['NED', 'BEL'], TUR: ['TUR', 'TUR', 'POR', 'NED'], SCO: ['SCO', 'ENG', 'IRL'], BEL: ['BEL', 'NED'], GRE: ['GRE', 'POR', 'ESP'],
  AUT: ['AUT', 'GER'], UKR: ['UKR', 'ITA'], CZE: ['CZE'], DEN: ['DEN', 'NOR', 'SWE'], CRO: ['CRO'], NOR: ['NOR'], SUI: ['SUI', 'GER'],
};

export function newManager(rng: Rng, country: string, archetype: Archetype, acumen: number, season: number): BotProfile {
  const nat = rng.pick(MANAGER_NATS[country] ?? [country, 'ENG']);
  const nm = randomName(rng, namePools(), nat);
  return {
    name: `${nm.first} ${nm.last}`, nat, age: rng.int(38, 66), archetype, acumen, hiredSeason: season, pressure: 20,
    grudges: {}, traits: { spend: rng.range(0.8, 1.2), youth: rng.range(0.8, 1.2), loyalty: rng.range(0.7, 1.3) },
  };
}

export const ARCHETYPES: Archetype[] = ['purist', 'pragmatist', 'gegenpresser', 'counter', 'cynic', 'youth', 'chequebook', 'tinkerman'];

// ---- flavour quotes, per archetype and result ----
const QUOTES: Record<Archetype, { win: string[]; draw: string[]; loss: string[] }> = {
  purist: {
    win: ['We controlled the ball and the ball controlled the game.', 'The process is working. I am proud of how we kept possession.', 'That is how football should be played.'],
    draw: ['We had the ball but not the goals. The process continues.', 'Seventy per cent possession and a point. We keep believing.'],
    loss: ['I will never stop playing from the back. Never.', 'The result hurts, but we stayed true to our idea.'],
  },
  pragmatist: {
    win: ['A professional job. Three points, move on.', 'We did what the game needed.'],
    draw: ['A fair result. We adapt and go again.', 'A point on the road is never a bad thing.'],
    loss: ['We were not good enough today. Simple as that.', 'We will analyse it and adjust.'],
  },
  gegenpresser: {
    win: ['Heavy metal football! They could not breathe!', 'We hunted them for ninety minutes. Fantastic.'],
    draw: ['The intensity was there. The final pass was not.', 'We pressed, we ran, we will keep running.'],
    loss: ['We lost the second balls and that is on me.', 'The legs were heavy. We need to recover.'],
  },
  counter: {
    win: ['Let them have the ball. We have the goals.', 'We waited and we struck. Perfect.'],
    draw: ['Solid. Organised. A clean game plan.', 'We gave them nothing easy.'],
    loss: ['One mistake and the plan falls apart.', 'We sat too deep and paid for it.'],
  },
  cynic: {
    win: ['Nobody remembers how. They remember the points.', 'Ugly? Ask me if I care.'],
    draw: ['The referee had a shocker, but we take the point.', 'We defended like men. That is football.'],
    loss: ['I have never seen a referee like that. Never.', 'The pitch was a disgrace and so was the officiating.'],
  },
  youth: {
    win: ['Look at the average age of that team! The future is bright.', 'The kids were fearless today.'],
    draw: ['The young lads will learn from this.', 'Mistakes are part of growing. I am proud of them.'],
    loss: ['We are building something. Days like this are part of it.', 'Experience is expensive. We paid for some today.'],
  },
  chequebook: {
    win: ['This is why we sign the best players in the world.', 'Quality wins games. We have quality.'],
    draw: ['We need more signings. I will speak to the board.', 'With this squad we should win every game.'],
    loss: ['Individual errors. We will bring in reinforcements.', 'Unacceptable with the players we have.'],
  },
  tinkerman: {
    win: ['The new system worked perfectly. I might change it again anyway.', 'Everybody said three at the back would fail. Ha!'],
    draw: ['Next week, a new shape. I have ideas.', 'Interesting game. I learned a lot about 4-4-1-1.'],
    loss: ['The formation was right, the execution was wrong.', 'Maybe a back five next time. Or a back two.'],
  },
};

export function botQuote(a: Archetype, result: 'win' | 'draw' | 'loss', rng: Rng): string {
  return rng.pick(QUOTES[a][result]);
}
