// Aggregate stats for one tactic matchup: npx tsx tools/harness/matchup.ts purist counter 100 [CLUB]
import { simulateMatch } from '@ffm/engine';
import { loadSeed, buildClubs, ARCH_TACTIC, teamInput } from './world.ts';
const [a, b, nStr, clubKey] = process.argv.slice(2);
const N = Number(nStr ?? 100);
const seed = loadSeed();
const club = buildClubs(seed).find((c) => c.club.key === (clubKey ?? 'CRY'))!;
const keys = ['shots', 'shotsOnTarget', 'xg', 'passes', 'passesCompleted', 'possession', 'crosses', 'dribbles', 'throughBalls', 'throughBallsCompleted', 'counters', 'pressWins', 'offsides', 'corners', 'fouls', 'bigChances', 'longBalls'] as const;
const acc = [Object.fromEntries(keys.map((k) => [k, 0])), Object.fromEntries(keys.map((k) => [k, 0]))] as Record<string, number>[];
let wa = 0, d = 0, ga = 0, gb = 0;
const zt = [new Array(18).fill(0), new Array(18).fill(0)];
const orig = [{} as Record<string, number>, {} as Record<string, number>];
for (let i = 0; i < N; i++) {
  const r = simulateMatch(teamInput(club, ARCH_TACTIC[a]()), teamInput(club, ARCH_TACTIC[b]()), { seed: `m-${i}`, competition: 'league', importance: 1, neutral: true, homeAdvantage: 0, derby: false, weather: 'clear', knockout: false, maxSubs: 5 });
  for (const s of [0, 1]) {
    for (const k of keys) acc[s][k] += r.stats[s][k] as number;
    r.stats[s].zoneTouches.forEach((v, z) => (zt[s][z] += v));
    for (const [k, v] of Object.entries(r.stats[s].chanceOrigins)) orig[s][k] = (orig[s][k] ?? 0) + v;
  }
  ga += r.score[0]; gb += r.score[1];
  if (r.score[0] > r.score[1]) wa++; else if (r.score[0] === r.score[1]) d++;
}
console.log(`${a} vs ${b} (neutral, ${N}): ${a} W ${(wa / N * 100).toFixed(0)}% D ${(d / N * 100).toFixed(0)}%  goals ${(ga / N).toFixed(2)}-${(gb / N).toFixed(2)}`);
for (const k of keys) console.log(k.padEnd(24), (acc[0][k] / N).toFixed(2).padStart(8), (acc[1][k] / N).toFixed(2).padStart(8));
console.log('origins', JSON.stringify(Object.fromEntries(Object.entries(orig[0]).map(([k, v]) => [k, +(v / N).toFixed(2)]))), JSON.stringify(Object.fromEntries(Object.entries(orig[1]).map(([k, v]) => [k, +(v / N).toFixed(2)]))));
for (const s of [0, 1]) {
  const tot = zt[s].reduce((x: number, y: number) => x + y, 0);
  const rows = [5, 4, 3, 2, 1, 0].map((band) => [0, 1, 2].map((c) => ((zt[s][band * 3 + c] / tot) * 100).toFixed(1).padStart(5)).join(' '));
  console.log(`touches ${s === 0 ? a : b} (their box at top):\n  ` + rows.join('\n  '));
}
