// Generated news feed: match reports, upsets, milestones, manager talk, transfers, injuries, digest.
import { Rng, type MatchResult } from '@ffm/engine';
import type { Db } from '../db.ts';
import { botQuote } from './archetypes.ts';
import type { ClubRow, CompetitionRow, FixtureRow, WorldRow } from './types.ts';
import { stageLabel } from './competitions.ts';

export interface NewsInput {
  type: 'match' | 'transfer' | 'rumour' | 'injury' | 'manager' | 'milestone' | 'table' | 'digest' | 'event' | 'system' | 'trophy' | 'sacking';
  clubIds?: number[];
  headline: string;
  body?: string;
  importance?: number;
  payload?: Record<string, unknown>;
}

export async function addNews(d: Db, world: Pick<WorldRow, 'season_no'>, n: NewsInput) {
  await d.q('insert into news (season_no, type, club_ids, headline, body, importance, payload) values ($1,$2,$3,$4,$5,$6,$7)', [
    world.season_no, n.type, n.clubIds ?? [], n.headline.slice(0, 200), (n.body ?? '').slice(0, 1500), n.importance ?? 1, JSON.stringify(n.payload ?? {}),
  ]);
}

const pick = <T,>(rng: Rng, arr: T[]) => arr[Math.floor(rng.next() * arr.length)];

export async function matchNews(d: Db, world: WorldRow, f: FixtureRow, comp: CompetitionRow, home: ClubRow, away: ClubRow, res: MatchResult) {
  const rng = new Rng(`${f.seed}:news`);
  const [hg, ag] = res.score;
  const humans = [home, away].filter((c) => c.manager_type === 'human');
  const winner = hg > ag ? home : ag > hg ? away : null;
  const loser = winner ? (winner === home ? away : home) : null;
  const score = `${Math.max(hg, ag)}-${Math.min(hg, ag)}`;
  const where = f.neutral ? 'at a neutral venue' : `at ${home.stadium}`;
  const stage = stageLabel(comp.type, f.stage, f.grp);
  const payload = { fixtureId: f.id };

  // Hat-tricks
  for (const p of res.players.filter((x) => x.goals >= 3)) {
    const club = p.side === 0 ? home : away;
    const opp = p.side === 0 ? away : home;
    await addNews(d, world, { type: 'milestone', clubIds: [club.id, opp.id], headline: pick(rng, [`${p.name} hat-trick sinks ${opp.short}`, `Treble for ${p.short} as ${club.short} beat ${opp.short}`, `${p.short} takes the match ball home`]), body: `${p.name} scored ${p.goals} ${stage.toLowerCase().includes('matchweek') ? 'in the league' : `in the ${comp.name}`} ${where}.`, importance: 2, payload });
  }

  // Finals
  if (f.stage === 'F' && res.winner !== null) {
    const w = res.winner === 0 ? home : away;
    const l = res.winner === 0 ? away : home;
    const pens = res.penalties ? ` on penalties (${Math.max(res.penalties.home, res.penalties.away)}-${Math.min(res.penalties.home, res.penalties.away)})` : res.extraTime ? ' after extra time' : '';
    await addNews(d, world, { type: 'trophy', clubIds: [w.id, l.id], headline: `${w.short} win the ${comp.name}!`, body: `${w.name} beat ${l.name} ${hg}-${ag}${pens}. ${res.verdict}`, importance: 3, payload });
    return;
  }

  // Human involvement: always a report
  if (humans.length) {
    const hvh = humans.length === 2;
    let headline: string;
    if (!winner) headline = pick(rng, [`${home.short} and ${away.short} share the spoils`, `Honours even ${where}`, `${home.short} ${hg}-${ag} ${away.short}: all square`]);
    else if (Math.abs(hg - ag) >= 3) headline = pick(rng, [`${winner.short} thrash ${loser!.short} ${score}`, `${loser!.short} humbled ${score} by ${winner.short}`, `Rout: ${winner.short} hit ${Math.max(hg, ag)} past ${loser!.short}`]);
    else headline = pick(rng, [`${winner.short} beat ${loser!.short} ${score}`, `${winner.short} edge ${loser!.short}`, `Three points for ${winner.short} against ${loser!.short}`]);
    if (hvh) headline = `Friends at war: ${headline}`;
    await addNews(d, world, { type: 'match', clubIds: [home.id, away.id], headline, body: res.verdict, importance: hvh ? 3 : 2, payload });
    // Bot manager talk
    const bot = [home, away].find((c) => c.manager_type === 'bot');
    if (bot && rng.chance(0.55)) {
      const r: 'win' | 'draw' | 'loss' = !winner ? 'draw' : winner.id === bot.id ? 'win' : 'loss';
      await addNews(d, world, { type: 'manager', clubIds: [bot.id], headline: `${bot.bot.name}: "${botQuote(bot.bot.archetype, r, rng)}"`, body: `The ${bot.short} manager after the ${home.short} ${hg}-${ag} ${away.short} ${comp.type === 'league' ? 'league game' : comp.name + ' tie'}.`, importance: 1, payload });
    }
    return;
  }

  // Upsets and thrashings among bots
  if (winner && loser && winner.reputation + 14 <= loser.reputation && comp.type !== 'ucl' && comp.type !== 'uel') {
    await addNews(d, world, { type: 'match', clubIds: [home.id, away.id], headline: pick(rng, [`Shock ${where}: ${winner.short} stun ${loser.short}`, `Giant-killing! ${winner.short} beat ${loser.short}`, `${loser.short} red-faced after ${winner.short} upset`]), body: res.verdict, importance: 2, payload });
  } else if (Math.abs(hg - ag) >= 4 && (home.league === 'PL' || away.league === 'PL')) {
    await addNews(d, world, { type: 'match', clubIds: [home.id, away.id], headline: `${winner!.short} run riot against ${loser!.short}`, body: res.verdict, importance: 1, payload });
  } else if (hg + ag >= 7) {
    await addNews(d, world, { type: 'match', clubIds: [home.id, away.id], headline: `${hg + ag}-goal thriller: ${home.short} ${hg}-${ag} ${away.short}`, body: res.verdict, importance: 1, payload });
  }
}
