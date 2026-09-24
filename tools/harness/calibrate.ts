// Calibration run: simulate full double round-robin seasons and compare against the design targets.
import { simulateMatch, type MatchResult } from '@ffm/engine';
import { loadSeed, buildClubs, ARCH_TACTIC, teamInput } from './world.ts';

const seasons = Number(process.argv[2] ?? 1);
const seed = loadSeed();
const clubs = buildClubs(seed);
const acc = {
  matches: 0, goals: 0, shots: 0, sot: 0, possMin: 100, possMax: 0, possAbs: 0, passesC: 0, passes: 0, fouls: 0, yellows: 0, reds: 0,
  homeW: 0, draws: 0, cleanSheets: 0, corners: 0, offsides: 0, xg: 0, injuries: 0, ms: 0, events: 0, bigChances: 0, crosses: 0, crossesC: 0,
  dribbles: 0, tackles: 0, pens: 0, counters: 0, subs: 0, blocked: 0, saves: 0,
};
const table = new Map<string, { p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }>();
for (const c of clubs) table.set(c.club.key, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
let last: MatchResult | null = null;
for (let s = 0; s < seasons; s++) {
  for (const h of clubs) for (const a of clubs) {
    if (h === a) continue;
    const ht = ARCH_TACTIC[h.club.archetype]();
    const at = ARCH_TACTIC[a.club.archetype]();
    const t0 = performance.now();
    const r = simulateMatch(teamInput(h, ht), teamInput(a, at), {
      seed: `cal-${s}-${h.club.key}-${a.club.key}`, competition: 'league', importance: 1, neutral: false,
      homeAdvantage: 4, derby: false, weather: 'clear', knockout: false, maxSubs: 5,
    });
    acc.ms += performance.now() - t0;
    last = r;
    acc.matches++;
    acc.events += r.events.length;
    const [sh, sa] = r.score;
    acc.goals += sh + sa;
    for (const st of r.stats) {
      acc.shots += st.shots; acc.sot += st.shotsOnTarget; acc.passesC += st.passesCompleted; acc.passes += st.passes;
      acc.fouls += st.fouls; acc.yellows += st.yellows; acc.reds += st.reds; acc.corners += st.corners; acc.offsides += st.offsides;
      acc.xg += st.xg; acc.bigChances += st.bigChances; acc.crosses += st.crosses; acc.crossesC += st.crossesCompleted; acc.dribbles += st.dribbles;
      acc.tackles += st.tackles; acc.pens += st.chanceOrigins.penalty; acc.counters += st.counters; acc.blocked += st.shotsBlocked; acc.saves += st.saves;
    }
    acc.subs += r.events.filter((e) => e.t === 'sub').length;
    acc.possMin = Math.min(acc.possMin, r.stats[0].possession);
    acc.possMax = Math.max(acc.possMax, r.stats[0].possession);
    acc.possAbs += Math.abs(r.stats[0].possession - 50);
    if (sh > sa) acc.homeW++; else if (sh === sa) acc.draws++;
    if (sa === 0) acc.cleanSheets++;
    if (sh === 0) acc.cleanSheets++;
    acc.injuries += r.injuries.length;
    const th = table.get(h.club.key)!, ta = table.get(a.club.key)!;
    th.p++; ta.p++; th.gf += sh; th.ga += sa; ta.gf += sa; ta.ga += sh;
    if (sh > sa) { th.w++; ta.l++; th.pts += 3; } else if (sh < sa) { ta.w++; th.l++; ta.pts += 3; } else { th.d++; ta.d++; th.pts++; ta.pts++; }
  }
}
const n = acc.matches;
const f = (v: number, d = 2) => v.toFixed(d);
const line = (label: string, val: string, target: string) => console.log(`${label.padEnd(28)} ${val.padStart(8)}   target ${target}`);
console.log(`\n${n} matches, ${f(acc.ms / n, 1)} ms/match, ${f(acc.events / n, 0)} events/match`);
line('Goals per match', f(acc.goals / n), '2.5-2.9');
line('Shots per team', f(acc.shots / n / 2, 1), '11-15');
line('On target % of shots', f((acc.sot / acc.shots) * 100, 1), '33-40');
line('xG per team', f(acc.xg / n / 2), '~1.35');
line('Possession extremes (home)', `${acc.possMin}-${acc.possMax}`, '35/65 extremes');
line('Avg |poss-50|', f(acc.possAbs / n, 1), 'usually 45/55');
line('Passes completed per team', f(acc.passesC / n / 2, 0), '300-550');
line('Pass accuracy %', f((acc.passesC / acc.passes) * 100, 1), '~80-85');
line('Fouls per team', f(acc.fouls / n / 2, 1), '9-14');
line('Yellows per match', f(acc.yellows / n), '3.2-4.0');
line('Reds per match', f(acc.reds / n, 3), '0.05-0.10');
line('Home win %', f((acc.homeW / n) * 100, 1), '44-47');
line('Draw %', f((acc.draws / n) * 100, 1), '24-27');
line('Clean sheets % team-matches', f((acc.cleanSheets / (2 * n)) * 100, 1), '~26');
line('Corners per team', f(acc.corners / n / 2, 1), '~5');
line('Offsides per team', f(acc.offsides / n / 2, 1), '~2');
line('Big chances per team', f(acc.bigChances / n / 2, 1), '~2');
line('Crosses per team (acc%)', `${f(acc.crosses / n / 2, 1)} (${f((acc.crossesC / Math.max(1, acc.crosses)) * 100, 0)}%)`, '~17 (25%)');
line('Dribbles per team', f(acc.dribbles / n / 2, 1), '~15');
line('Tackles per team', f(acc.tackles / n / 2, 1), '~16');
line('Penalties per match', f(acc.pens / n, 2), '~0.28');
line('Blocked shots % ', f((acc.blocked / acc.shots) * 100, 1), '~25');
line('Counters per team', f(acc.counters / n / 2, 1), '-');
line('Subs per match', f(acc.subs / n, 1), '~8');
line('Injuries per match', f(acc.injuries / n, 2), '~0.35 (12-18/club/season incl. training)');
const rows = [...table.entries()].sort((a, b) => b[1].pts - a[1].pts || (b[1].gf - b[1].ga) - (a[1].gf - a[1].ga));
console.log('\nTable:');
rows.forEach(([k, r], i) => console.log(`${String(i + 1).padStart(2)} ${k} P${r.p} W${r.w} D${r.d} L${r.l} ${r.gf}-${r.ga} ${r.pts}`));
if (process.argv.includes('--sample') && last) {
  console.log('\nSample events:');
  for (const e of last.events.slice(0, 80)) console.log(`${e.m}${e.ex ? '+' + e.ex : ''}' ${e.txt}`);
  console.log(last.verdict);
}
