// Competition progression: group tables, knockout draws, finals, honours and prize money.
import { Rng } from '@ffm/engine';
import type { Db } from '../db.ts';
import { MINUTE, HOUR } from '../lib/time.ts';
import { computeStandings, createFixtures, drawPairs, type NewFixture } from './competitions.ts';
import { addLedger, PRIZES } from './finance.ts';
import { addNews } from './news.ts';
import { broadcast } from './notify.ts';
import type { CompetitionRow, FixtureRow, WorldRow } from './types.ts';

const KO_ORDER = ['R1', 'R32', 'R16', 'QF', 'SF', 'F'];

export async function progressCompetitions(d: Db, world: WorldRow, compIds: Iterable<number>) {
  for (const id of compIds) {
    const comp = await d.one<CompetitionRow>('select * from competitions where id = $1', [id]);
    if (!comp || comp.status === 'done' || comp.type === 'league') continue;
    await progressOne(d, world, comp);
  }
}

async function ensureJobs(d: Db, world: WorldRow, kickoffs: Date[]) {
  for (const k of kickoffs) {
    const iso = k.toISOString();
    await d.q(`insert into jobs (run_at, type, payload, unique_key) values ($1, 'lock', $2, $3) on conflict (unique_key) do nothing`, [new Date(k.getTime() - world.settings.deadlineMinutes * MINUTE), JSON.stringify({ kickoff: iso }), `lock:${iso}`]);
    await d.q(`insert into jobs (run_at, type, payload, unique_key) values ($1, 'match', $2, $3) on conflict (unique_key) do nothing`, [k, JSON.stringify({ kickoff: iso }), `match:${iso}`]);
    await d.q(`insert into jobs (run_at, type, payload, unique_key) values ($1, 'reminder', $2, $3) on conflict (unique_key) do nothing`, [new Date(k.getTime() - world.settings.reminderHours * HOUR), JSON.stringify({ kickoff: iso }), `reminder:${iso}`]);
  }
}

function plannedDates(comp: CompetitionRow, stage: string): Date[] {
  const r = (comp.data.rounds ?? []).find((x) => x.stage === stage);
  return (r?.dates ?? []).map((s) => new Date(s));
}

async function progressOne(d: Db, world: WorldRow, comp: CompetitionRow) {
  const fx = await d.many<FixtureRow>('select * from fixtures where competition_id = $1 order by round, id', [comp.id]);
  if (!fx.length) return;
  const rng = new Rng(`${world.secret}:${comp.id}:${fx.length}`);
  const stages = [...new Set(fx.map((f) => f.stage))];
  const hasGroups = stages.some((s) => s.startsWith('GS'));
  const koStages = stages.filter((s) => !s.startsWith('GS'));
  const latestKo = koStages.sort((a, b) => KO_ORDER.indexOf(a) - KO_ORDER.indexOf(b)).pop();

  // Group stage finished and knockouts not yet drawn
  if (hasGroups && !latestKo) {
    const gsFx = fx.filter((f) => f.stage.startsWith('GS'));
    if (gsFx.some((f) => f.status !== 'played')) return;
    const groups = comp.data.groups ?? {};
    const winners: { id: number; grp: string }[] = [];
    const runners: { id: number; grp: string }[] = [];
    for (const [g, ids] of Object.entries(groups)) {
      const table = computeStandings(gsFx.filter((f) => f.grp === g), ids);
      winners.push({ id: table[0].clubId, grp: g });
      runners.push({ id: table[1].clubId, grp: g });
    }
    // Winners vs runners-up from a different group; winner at home in the second leg.
    let pairs: [number, number][] = [];
    for (let attempt = 0; attempt < 200; attempt++) {
      const r = rng.shuffle(runners.slice());
      if (winners.every((w, i) => w.grp !== r[i].grp) || attempt === 199) { pairs = winners.map((w, i) => [r[i].id, w.id]); break; }
    }
    await createKoRound(d, world, comp, 'R16', pairs, 2);
    await payStage(d, world, comp, 'R16', pairs.flat());
    const names = await clubNames(d, pairs.flat());
    await addNews(d, world, { type: 'table', clubIds: pairs.flat(), headline: `${comp.name} last-16 draw made`, body: pairs.map(([a, b]) => `${names[a]} v ${names[b]}`).join(' · '), importance: 2 });
    return;
  }
  if (!latestKo) return;
  const cur = fx.filter((f) => f.stage === latestKo);
  if (cur.some((f) => f.status !== 'played')) return;
  // Decided ties: single-leg fixtures, or second legs
  const deciding = cur.filter((f) => f.leg === 2 || !cur.some((x) => x.tie_key && x.tie_key === f.tie_key && x.leg === 2));
  const winners = deciding.map((f) => f.winner_id).filter((x): x is number => !!x);
  if (latestKo === 'F') {
    const final = deciding[0];
    if (!final?.winner_id) return;
    const loser = final.winner_id === final.home_id ? final.away_id : final.home_id;
    await d.q(`update competitions set status = 'done', winner_id = $2, runner_up_id = $3 where id = $1`, [comp.id, final.winner_id, loser]);
    await d.q(`insert into honours (club_id, season_no, comp_type, name, place) values ($1, $2, $3, $4, 'winner'), ($5, $2, $3, $4, 'runner_up')`, [final.winner_id, world.season_no, comp.type, comp.name, loser]);
    const prize = PRIZES[comp.type]?.winner ?? 0;
    if (prize) await addLedger(d, final.winner_id, world.season_no, 'prize', prize, `${comp.name} winners`);
    const names = await clubNames(d, [final.winner_id, loser]);
    await broadcast(d, { type: 'news', title: `${names[final.winner_id]} win the ${comp.name}`, body: `They beat ${names[loser]} in the final.`, link: `/fixture/${final.id}` });
    return;
  }
  // Byes join the second round of the League Cup
  let entrants = winners;
  if (comp.type === 'league_cup' && latestKo === 'R1') entrants = [...winners, ...(comp.data.byes ?? [])];
  const next = KO_ORDER[KO_ORDER.indexOf(latestKo) + (comp.type === 'league_cup' && latestKo === 'R1' ? 2 : 1)] ?? 'F';
  const nextStage = comp.type === 'league_cup' && latestKo === 'R1' ? 'R16' : next;
  if (fx.some((f) => f.stage === nextStage)) return;
  const legs = (comp.data.rounds ?? []).find((r) => r.stage === nextStage)?.legs ?? 1;
  const pairs = drawPairs(entrants, rng);
  await createKoRound(d, world, comp, nextStage, pairs, legs);
  await payStage(d, world, comp, nextStage, entrants);
  const names = await clubNames(d, entrants);
  const label = nextStage === 'F' ? 'final' : nextStage === 'SF' ? 'semi-final' : nextStage === 'QF' ? 'quarter-final' : 'next round';
  await addNews(d, world, { type: 'table', clubIds: entrants, headline: `${comp.name} ${label} draw`, body: pairs.map(([a, b]) => `${names[a]} v ${names[b]}`).join(' · '), importance: nextStage === 'F' || nextStage === 'SF' ? 2 : 1 });
}

async function createKoRound(d: Db, world: WorldRow, comp: CompetitionRow, stage: string, pairs: [number, number][], legs: number) {
  const dates = plannedDates(comp, stage);
  const fallback = new Date(Date.now() + 3 * 86400000);
  const round = (comp.data.rounds ?? []).findIndex((r) => r.stage === stage) + 1;
  const neutral = !!(comp.data.rounds ?? []).find((r) => r.stage === stage)?.neutral;
  const list: NewFixture[] = [];
  pairs.forEach(([a, b], i) => {
    const key = `${comp.type}-${stage}-${i}`;
    if (legs === 2) {
      list.push({ compId: comp.id, round, stage, leg: 1, tieKey: key, home: a, away: b, kickoff: dates[0] ?? fallback });
      list.push({ compId: comp.id, round, stage, leg: 2, tieKey: key, home: b, away: a, kickoff: dates[1] ?? new Date((dates[0] ?? fallback).getTime() + 7 * 86400000) });
    } else {
      list.push({ compId: comp.id, round, stage, leg: 1, tieKey: key, home: a, away: b, kickoff: dates[0] ?? fallback, neutral });
    }
  });
  await createFixtures(d, world, list);
  await ensureJobs(d, world, [...new Set(list.map((l) => l.kickoff.toISOString()))].map((s) => new Date(s)));
}

async function payStage(d: Db, world: WorldRow, comp: CompetitionRow, stage: string, clubIds: number[]) {
  const amt = PRIZES[comp.type]?.[stage] ?? 0;
  if (!amt) return;
  for (const id of clubIds) await addLedger(d, id, world.season_no, 'prize', amt, `${comp.name}: reached the ${stage === 'F' ? 'final' : stage}`);
}

async function clubNames(d: Db, ids: number[]): Promise<Record<number, string>> {
  const rows = await d.many<{ id: number; short: string }>('select id, short from clubs where id = any($1)', [ids]);
  return Object.fromEntries(rows.map((r) => [r.id, r.short]));
}
