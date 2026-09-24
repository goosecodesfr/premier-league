import { simulateMatch, makeTactic, type TeamInput } from '@ffm/engine';
import { loadSeed, buildClubs, teamInput } from './world.ts';
const seed = loadSeed();
const clubs = buildClubs(seed);
const N = Number(process.argv[2] ?? 200);
type Mod = (t: TeamInput) => TeamInput;
const variants: [string, Mod][] = [
  ['baseline', (t) => t],
  ['cond 75', (t) => ({ ...t, players: t.players.map((p) => ({ ...p, condition: 75 })) })],
  ['cond 65', (t) => ({ ...t, players: t.players.map((p) => ({ ...p, condition: 65 })) })],
  ['sharp 60', (t) => ({ ...t, players: t.players.map((p) => ({ ...p, sharpness: 60 })) })],
  ['fam 0.5', (t) => ({ ...t, familiarity: 0.5 })],
  ['triggers', (t) => ({ ...t, tactic: { ...t.tactic, triggers: [
    { id: 'chase', when: { kind: 'score', state: 'losing', by: 1, minute: 60 }, actions: [{ type: 'mentality', delta: 1 }, { type: 'sub', out: 'lowest_rated', outLine: 'DEF', in: 'most_attacking' }] },
    { id: 'protect', when: { kind: 'score', state: 'winning', by: 2, minute: 72 }, actions: [{ type: 'mentality', delta: -1 }, { type: 'instruction', key: 'line', value: 'deep' }] },
  ] } })],
];
for (const [name, mod] of variants) {
  let goals = 0, shots = 0;
  for (let i = 0; i < N; i++) {
    const h = clubs[i % 20], a = clubs[(i * 7 + 3) % 20];
    const r = simulateMatch(mod(teamInput(h, makeTactic('x', '4-2-3-1', { mentality: 1 }))), mod(teamInput(a, makeTactic('y', '4-3-3', { mentality: 1 }))), { seed: `c-${name}-${i}`, competition: 'league', importance: 1, neutral: false, homeAdvantage: 5, derby: false, weather: 'clear', knockout: false, maxSubs: 5 });
    goals += r.score[0] + r.score[1]; shots += r.stats[0].shots + r.stats[1].shots;
  }
  console.log(`${name.padEnd(10)} goals ${(goals / N).toFixed(2)} shots ${(shots / N).toFixed(1)}`);
}
