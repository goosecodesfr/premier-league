import { simulateMatch, makeTactic } from '@ffm/engine';
import { loadSeed, buildClubs, teamInput } from './world.ts';
const seed = loadSeed();
const clubs = buildClubs(seed);
const N = Number(process.argv[2] ?? 200);
for (const [mh, ma] of [[0, 0], [1, 1], [2, 2], [-1, -1], [1, -1]]) {
  let goals = 0, shots = 0, xg = 0;
  for (let i = 0; i < N; i++) {
    const h = clubs[i % 20], a = clubs[(i * 7 + 3) % 20];
    if (h === a) continue;
    const th = makeTactic('x', '4-2-3-1', { mentality: mh });
    const ta = makeTactic('y', '4-3-3', { mentality: ma });
    const r = simulateMatch(teamInput(h, th), teamInput(a, ta), { seed: `m${mh}${ma}-${i}`, competition: 'league', importance: 1, neutral: false, homeAdvantage: 4, derby: false, weather: 'clear', knockout: false, maxSubs: 5 });
    goals += r.score[0] + r.score[1]; shots += r.stats[0].shots + r.stats[1].shots; xg += r.stats[0].xg + r.stats[1].xg;
  }
  console.log(`mentality ${mh}/${ma}: goals ${(goals / N).toFixed(2)} shots ${(shots / N).toFixed(1)} xg ${(xg / N).toFixed(2)}`);
}
