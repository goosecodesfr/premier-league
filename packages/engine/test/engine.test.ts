import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, makeTactic, type MatchContext } from '@ffm/engine';
import { loadSeed, buildClubs, teamInput, ARCH_TACTIC } from '../../../tools/harness/world.ts';

const seed = loadSeed();
const clubs = buildClubs(seed);
const ctx = (s: string, extra: Partial<MatchContext> = {}): MatchContext => ({ seed: s, competition: 'league', importance: 1, neutral: false, homeAdvantage: 4, derby: false, weather: 'clear', knockout: false, maxSubs: 5, ...extra });

test('same inputs and seed produce byte-identical output', () => {
  const [a, b] = [clubs[0], clubs[1]];
  const r1 = simulateMatch(teamInput(a, ARCH_TACTIC.purist()), teamInput(b, ARCH_TACTIC.counter()), ctx('det-1'));
  const r2 = simulateMatch(teamInput(a, ARCH_TACTIC.purist()), teamInput(b, ARCH_TACTIC.counter()), ctx('det-1'));
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  const r3 = simulateMatch(teamInput(a, ARCH_TACTIC.purist()), teamInput(b, ARCH_TACTIC.counter()), ctx('det-2'));
  assert.notEqual(JSON.stringify(r1.events), JSON.stringify(r3.events));
});

test('knockout ties always produce a winner', () => {
  for (let i = 0; i < 60; i++) {
    const r = simulateMatch(teamInput(clubs[2], ARCH_TACTIC.cynic()), teamInput(clubs[3], ARCH_TACTIC.cynic()), ctx(`ko-${i}`, { knockout: true, neutral: true }));
    assert.ok(r.winner === 0 || r.winner === 1, 'winner decided');
    if (r.score[0] === r.score[1]) assert.ok(r.penalties, 'level after ET goes to penalties');
  }
});

test('second legs use aggregate', () => {
  const r = simulateMatch(teamInput(clubs[4], ARCH_TACTIC.pragmatist()), teamInput(clubs[5], ARCH_TACTIC.pragmatist()), ctx('leg2', { knockout: true, firstLeg: { home: 0, away: 5 } }));
  // Home side trails 0-5 from the first leg: extremely unlikely to overturn, and never goes to ET unless level.
  const aggH = r.score[0];
  const aggA = r.score[1] + 5;
  if (aggH !== aggA) assert.equal(r.extraTime, false);
});

test('triggers fire and plan B switches shape', () => {
  const t = makeTactic('Main', '4-3-3');
  t.triggers = [{ id: 'x', when: { kind: 'score', state: 'drawing', by: 0, minute: 30 }, actions: [{ type: 'plan_b' }, { type: 'mentality', delta: 1 }] }];
  const home = teamInput(clubs[6], t);
  home.planB = makeTactic('B', '4-4-2');
  let fired = 0;
  for (let i = 0; i < 20; i++) {
    const r = simulateMatch(home, teamInput(clubs[7], ARCH_TACTIC.cynic()), ctx(`trig-${i}`));
    fired += r.triggersFired.filter((f) => f.side === 0).length;
  }
  assert.ok(fired > 0);
});

test('invariants: minutes, condition, player counts', () => {
  for (let i = 0; i < 40; i++) {
    const r = simulateMatch(teamInput(clubs[i % 20], ARCH_TACTIC.gegenpresser()), teamInput(clubs[(i + 7) % 20], ARCH_TACTIC.youth()), ctx(`inv-${i}`));
    for (const p of r.players) {
      assert.ok(p.minutes >= 0 && p.minutes <= 120, `minutes ${p.minutes}`);
      assert.ok(p.conditionEnd >= 0 && p.conditionEnd <= 100);
      assert.ok(p.rating >= 3 && p.rating <= 10);
    }
    for (const side of [0, 1]) {
      const starters = r.players.filter((p) => p.side === side && p.started).length;
      assert.equal(starters, 11);
      const subs = r.players.filter((p) => p.side === side && !p.started).length;
      assert.ok(subs <= 5);
    }
    const goals = r.events.filter((e) => e.t === 'goal');
    assert.equal(goals.filter((g) => g.side === 0).length, r.score[0]);
    assert.equal(goals.filter((g) => g.side === 1).length, r.score[1]);
  }
});
