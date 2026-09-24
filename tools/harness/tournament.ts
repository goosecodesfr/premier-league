// Tactic tournament: identical squads, every tactic vs every other. No tactic should win >60% or <40% vs the field.
// Also: ability sensitivity (a 10% stronger squad should win ~60-65%).
import { simulateMatch, type Tactic, attrsFromArray, ATTR_KEYS, type MatchPlayerInput } from '@ffm/engine';
import { loadSeed, buildClubs, ARCH_TACTIC, teamInput, type HClub } from './world.ts';

const N = Number(process.argv[2] ?? 100);
const seed = loadSeed();
const clubs = buildClubs(seed);
const base = clubs.find((c) => c.club.key === (process.argv[3] ?? 'CRY'))!;
const names = Object.keys(ARCH_TACTIC);
const tactics: Record<string, Tactic> = Object.fromEntries(names.map((n) => [n, ARCH_TACTIC[n]()]));
const pts: Record<string, { w: number; d: number; l: number; gf: number; ga: number }> = Object.fromEntries(names.map((n) => [n, { w: 0, d: 0, l: 0, gf: 0, ga: 0 }]));
const matrix: Record<string, Record<string, number>> = {};
const ctx = (seedStr: string) => ({ seed: seedStr, competition: 'league', importance: 1, neutral: false, homeAdvantage: 4, derby: false, weather: 'clear' as const, knockout: false, maxSubs: 5 });

for (const a of names) {
  matrix[a] = {};
  for (const b of names) {
    if (a === b) continue;
    let wa = 0, games = 0;
    for (let i = 0; i < N; i++) {
      const home = i % 2 === 0;
      const ta = teamInput(base, tactics[a]);
      const tb = teamInput(base, tactics[b]);
      const r = simulateMatch(home ? ta : tb, home ? tb : ta, ctx(`t-${a}-${b}-${i}`));
      const ga = home ? r.score[0] : r.score[1];
      const gb = home ? r.score[1] : r.score[0];
      pts[a].gf += ga; pts[a].ga += gb;
      if (ga > gb) { pts[a].w++; wa++; } else if (ga === gb) { pts[a].d++; wa += 0.5; } else pts[a].l++;
      games++;
    }
    matrix[a][b] = wa / games;
  }
}
console.log(`Tactic tournament (${base.club.short} squad mirrored, ${N} games per pairing, draws = half)`);
console.log('tactic'.padEnd(14) + names.map((n) => n.slice(0, 7).padStart(8)).join('') + '   score   W-D-L');
for (const a of names) {
  const row = names.map((b) => (a === b ? '   -    ' : (matrix[a][b] * 100).toFixed(0).padStart(7) + ' ')).join('');
  const p = pts[a];
  const g = p.w + p.d + p.l;
  console.log(a.padEnd(14) + row + `  ${(((p.w + p.d * 0.5) / g) * 100).toFixed(1)}%  ${p.w}-${p.d}-${p.l}  gf ${(p.gf / g).toFixed(2)} ga ${(p.ga / g).toFixed(2)}`);
}

// Ability sensitivity
function scaled(c: HClub, f: number): HClub {
  const players: MatchPlayerInput[] = c.players.map((p) => {
    const a = { ...p.attrs };
    for (const k of ATTR_KEYS) a[k] = Math.min(200, a[k] * f);
    return { ...p, attrs: a };
  });
  return { club: c.club, players, sel: c.sel.map((s) => ({ ...s, attrs: players.find((p) => p.id === s.id)!.attrs })) };
}
for (const f of [1.05, 1.1, 1.2]) {
  const strong = scaled(base, f);
  let w = 0, d = 0, l = 0;
  for (let i = 0; i < N * 4; i++) {
    const home = i % 2 === 0;
    const t = tactics.pragmatist;
    const r = simulateMatch(home ? teamInput(strong, t) : teamInput(base, t), home ? teamInput(base, t) : teamInput(strong, t), ctx(`abil-${f}-${i}`));
    const gs = home ? r.score[0] : r.score[1];
    const gw = home ? r.score[1] : r.score[0];
    if (gs > gw) w++; else if (gs === gw) d++; else l++;
  }
  const n = w + d + l;
  console.log(`Ability x${f}: strong wins ${(w / n * 100).toFixed(1)}%, draws ${(d / n * 100).toFixed(1)}%, loses ${(l / n * 100).toFixed(1)}%`);
}
void attrsFromArray;
