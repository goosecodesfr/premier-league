import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseTactic, cleanPlayerInstructions, keyBattles, makeTactic, normaliseTactic, parseDatasetTraits, simulateMatch, traitPower,
  type MatchContext, type Tactic,
} from '@ffm/engine';
import { loadSeed, buildClubs, teamInput, ARCH_TACTIC } from '../../../tools/harness/world.ts';

const seed = loadSeed();
const clubs = buildClubs(seed);
const ctx = (s: string): MatchContext => ({ seed: s, competition: 'league', importance: 1, neutral: false, homeAdvantage: 4, derby: false, weather: 'clear', knockout: false, maxSubs: 5 });
const ap = (c: (typeof clubs)[number]) => c.players.map((p) => ({ id: p.id, short: p.short, attrs: p.attrs, fam: p.fam, traits: p.traits, condition: 100 }));

test('dataset PlayStyles parse into traits, elite ones count half again', () => {
  const tr = parseDatasetTraits('Finesse Shot +, Incisive Pass, First Touch');
  assert.equal(tr.finesse_shot, 2);
  assert.equal(tr.incisive_pass, 1);
  assert.equal(traitPower(tr.finesse_shot), 1.5);
  assert.equal(traitPower(tr.incisive_pass), 1);
  assert.equal(traitPower(tr.rapid), 0);
});

test('player instructions are validated and survive normalisation', () => {
  assert.deepEqual(cleanPlayerInstructions({ shooting: 'more', bogus: 'x', press: 'sideways' }), { shooting: 'more' });
  assert.equal(cleanPlayerInstructions({}), undefined);
  const t = makeTactic('T', '4-3-3');
  t.slots[9] = { ...t.slots[9], pi: { dribbling: 'more', width: 'inside' } };
  const n = normaliseTactic(t as unknown as Record<string, unknown>) as Tactic;
  assert.deepEqual(n.slots[9].pi, { dribbling: 'more', width: 'inside' });
});

test('analysis flags a player out of position and fits the natural XI well', () => {
  const c = clubs[0];
  const t = ARCH_TACTIC.purist();
  const input = teamInput(c, t);
  const good = analyseTactic(input.tactic, input.lineup, ap(c));
  assert.equal(good.slots.length, 11);
  assert.equal(good.meters.length, 9);
  for (const m of good.meters) assert.ok(m.value >= 0 && m.value <= 100, `${m.key} in range`);
  const great = good.slots.filter((s) => s.fit === 'great' || s.fit === 'good').length;
  assert.ok(great >= 7, `most of the picked XI fit (${great})`);
  // Swap a centre-back with the striker.
  const cb = input.tactic.slots.findIndex((s) => s.pos === 'DC');
  const st = input.tactic.slots.findIndex((s) => s.pos === 'ST');
  const lineup = input.lineup.slice();
  [lineup[cb], lineup[st]] = [lineup[st], lineup[cb]];
  const bad = analyseTactic(input.tactic, lineup, ap(c));
  assert.ok(bad.notes.some((n) => n.tone === 'bad' && /out of position/.test(n.text)), 'out of position note');
  assert.ok(bad.slots[st].rating < good.slots[st].rating, 'striker slot rating drops');
});

test('key battles compare both XIs and stay in range', () => {
  const a = teamInput(clubs[0], ARCH_TACTIC.purist());
  const b = teamInput(clubs[1], ARCH_TACTIC.counter());
  const battles = keyBattles({ tactic: a.tactic, lineup: a.lineup, players: ap(clubs[0]) }, { tactic: b.tactic, lineup: b.lineup, players: ap(clubs[1]) });
  assert.ok(battles.length >= 2);
  for (const x of battles) assert.ok(x.edge >= -2 && x.edge <= 2 && x.detail.length > 10);
});

test('every match reports what each side\'s decisions produced', () => {
  const t = ARCH_TACTIC.purist();
  const home = teamInput(clubs[2], t);
  const st = home.tactic.slots.findIndex((s) => s.pos === 'ST');
  home.tactic = { ...home.tactic, slots: home.tactic.slots.map((s, i) => (i === st ? { ...s, pi: { shooting: 'more' } } : s)) };
  const r = simulateMatch(home, teamInput(clubs[3], ARCH_TACTIC.counter()), ctx('dec-1'));
  assert.equal(r.decisions.length, 2);
  const d = r.decisions[0];
  assert.ok(d.flank.reduce((s, v) => s + v, 0) >= 98 && d.flank.reduce((s, v) => s + v, 0) <= 102);
  assert.ok(d.instructionUse.some((u) => u.key === 'shooting' && u.stat === 'shots'));
  assert.ok(d.ppda >= 0);
});
