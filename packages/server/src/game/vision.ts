// Club vision: three goals a human manager sets for the season, live progress, and end-of-season verdicts.
import type { Db } from '../db.ts';
import { computeStandings, leagueStandings } from './competitions.ts';
import { addLedger } from './finance.ts';
import type { ClubRow, CompetitionRow, FixtureRow, VisionGoal, WorldRow } from './types.ts';

export const VISION_REWARD = 3_000_000;

export interface VisionProgress extends VisionGoal {
  progress: number; // 0..1
  status: string;
  state: 'on_track' | 'at_risk' | 'done' | 'failed';
}

function ord(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export async function visionProgress(d: Db, world: WorldRow, club: ClubRow, final = false): Promise<VisionProgress[]> {
  const goals = club.vision ?? [];
  if (!goals.length) return [];
  const table = await leagueStandings(d, world.season_no);
  const idx = table.findIndex((r) => r.clubId === club.id);
  const pos = idx >= 0 ? idx + 1 : null;
  const played = idx >= 0 ? table[idx].p : 0;
  const comps = await d.many<CompetitionRow>('select * from competitions where season_no = $1', [world.season_no]);
  const out: VisionProgress[] = [];
  for (const g of goals) {
    let progress = 0;
    let status = '';
    let met: boolean | null = null;
    const posGoal = (target: number) => {
      if (!pos || played === 0) { status = 'Season not started'; progress = 0; return; }
      met = pos <= target;
      progress = met ? 1 : Math.max(0, 1 - (pos - target) / 10);
      status = `Currently ${ord(pos)}`;
    };
    switch (g.kind) {
      case 'win_league': posGoal(1); break;
      case 'top4': posGoal(4); break;
      case 'top_half': posGoal(10); break;
      case 'survive': posGoal(17); break;
      case 'win_cup': {
        const cups = comps.filter((c) => c.type === 'fa_cup' || c.type === 'league_cup');
        const won = cups.filter((c) => c.winner_id === club.id);
        const alive = [];
        for (const c of cups) {
          if (c.status === 'done' || !(c.data.entrants ?? []).includes(club.id)) continue;
          const lost = await d.one<{ id: number }>(`select id from fixtures where competition_id = $1 and (home_id = $2 or away_id = $2) and winner_id is not null and winner_id <> $2 limit 1`, [c.id, club.id]);
          if (!lost) alive.push(c.name);
        }
        met = won.length > 0;
        progress = met ? 1 : alive.length ? 0.5 : 0;
        status = met ? `Won the ${won[0].name}` : alive.length ? `Still in the ${alive.join(' and ')}` : 'Out of both cups';
        if (!met && !alive.length) met = false; else if (!met) met = null;
        break;
      }
      case 'euro_final': {
        const eu = comps.filter((c) => (c.type === 'ucl' || c.type === 'uel') && (c.data.entrants ?? []).includes(club.id));
        if (!eu.length) { status = 'Not in Europe this season'; met = false; break; }
        const final = await d.one<{ id: number }>(`select f.id from fixtures f where f.competition_id = any($1) and f.stage = 'F' and (f.home_id = $2 or f.away_id = $2)`, [eu.map((c) => c.id), club.id]);
        const lost = await d.one<{ stage: string }>(`select stage from fixtures where competition_id = any($1) and (home_id = $2 or away_id = $2) and winner_id is not null and winner_id <> $2 limit 1`, [eu.map((c) => c.id), club.id]);
        met = final ? true : lost ? false : null;
        progress = final ? 1 : lost ? 0.3 : 0.5;
        status = final ? 'Reached the final' : lost ? `Knocked out (${lost.stage})` : `Still in the ${eu[0].name}`;
        break;
      }
      case 'youth_minutes': {
        const target = g.target ?? 1500;
        const r = await d.one<{ m: number }>(`select coalesce(sum(pm.minutes), 0)::int m from player_match pm join players p on p.id = pm.player_id where pm.club_id = $1 and pm.season_no = $2 and p.age <= 21`, [club.id, world.season_no]);
        const m = r?.m ?? 0;
        progress = Math.min(1, m / target);
        met = m >= target ? true : null;
        status = `${m.toLocaleString('en-GB')} of ${target.toLocaleString('en-GB')} minutes`;
        break;
      }
      case 'transfer_profit': {
        const r = await d.one<{ net: number }>(`select coalesce(sum(amount), 0)::bigint net from ledger where club_id = $1 and season_no = $2 and category in ('sale', 'fee')`, [club.id, world.season_no]);
        const net = Number(r?.net ?? 0);
        met = net > 0 ? true : null;
        progress = net > 0 ? 1 : Math.max(0, 1 + net / 50_000_000);
        status = `Net ${net >= 0 ? '+' : '-'}£${(Math.abs(net) / 1_000_000).toFixed(1)}m`;
        break;
      }
      case 'wage_cap': {
        const r = await d.one<{ s: number }>(`select coalesce(sum(wage), 0)::bigint s from players where club_id = $1 and status = 'active'`, [club.id]);
        const target = g.target ?? 3_000_000;
        met = (r?.s ?? 0) <= target;
        progress = met ? 1 : Math.max(0, target / (r?.s ?? 1));
        status = `Wage bill £${Math.round((r?.s ?? 0) / 1000)}k a week`;
        break;
      }
      case 'beat_rival': {
        if (!g.clubId) { status = 'Pick a rival'; break; }
        const league = comps.find((c) => c.type === 'league');
        const fx = league ? await d.many<FixtureRow>(`select * from fixtures where competition_id = $1 and ((home_id = $2 and away_id = $3) or (home_id = $3 and away_id = $2))`, [league.id, club.id, g.clubId]) : [];
        const results = fx.filter((f) => f.status === 'played').map((f) => {
          const my = f.home_id === club.id ? f.home_goals! : f.away_goals!;
          const th = f.home_id === club.id ? f.away_goals! : f.home_goals!;
          return my > th ? 'W' : my < th ? 'L' : 'D';
        });
        const wins = results.filter((r) => r === 'W').length;
        met = wins >= 2 ? true : results.some((r) => r !== 'W') ? false : null;
        progress = wins / 2;
        status = results.length ? `Won ${wins} of ${results.length} so far` : 'Both games to come';
        break;
      }
    }
    if (final && met === null) met = false;
    const state: VisionProgress['state'] = met === true && (final || !['win_league', 'top4', 'top_half', 'survive'].includes(g.kind)) ? 'done' : met === false && (final || !['win_league', 'top4', 'top_half', 'survive'].includes(g.kind)) ? 'failed' : met === true || progress >= 0.6 ? 'on_track' : 'at_risk';
    out.push({ ...g, done: final ? !!met : g.done ?? null, progress: Math.round(progress * 100) / 100, status, state });
  }
  return out;
}

/** End-of-season verdicts with rewards: money and fan mood for goals met. */
export async function settleVision(d: Db, world: WorldRow, club: ClubRow): Promise<VisionProgress[]> {
  const res = await visionProgress(d, world, club, true);
  let mood = 0;
  for (const g of res) {
    if (g.done) {
      await addLedger(d, club.id, world.season_no, 'event', VISION_REWARD, `Board bonus: ${g.label}`);
      mood += 5;
    } else mood -= 3;
  }
  if (mood) await d.q('update clubs set fan_mood = greatest(5, least(100, fan_mood + $2)) where id = $1', [club.id, mood]);
  await d.q('update clubs set vision = $2 where id = $1', [club.id, JSON.stringify(res.map((g) => ({ kind: g.kind, label: g.label, target: g.target, clubId: g.clubId, done: g.done, progress: g.progress })))]);
  return res;
}

void computeStandings;
