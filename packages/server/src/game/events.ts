// Unexpected events: training injuries, illness, off-field incidents, unhappy players, windfalls,
// bills, fan protests, retirements, takeovers. Humans get a decision card for the ones that need a call.
import { Rng } from '@ffm/engine';
import type { Db } from '../db.ts';
import { DAY } from '../lib/time.ts';
import { addLedger } from './finance.ts';
import { addNews } from './news.ts';
import { notifyClub } from './notify.ts';
import { hiddenOf, loadPlayers } from './players.ts';
import type { ClubRow, PlayerRow, WorldRow } from './types.ts';
import { fmtM } from './market.ts';

export interface DecisionOption { key: string; label: string; effect: string }

type EventKind =
  | 'training_injury' | 'illness' | 'off_field' | 'unhappy_minutes' | 'wonderkid' | 'sponsor_bonus' | 'maintenance'
  | 'fan_protest' | 'retirement' | 'takeover' | 'hot_streak' | 'contract_rebel' | 'tv_bonus';

const WEIGHTS: [EventKind, number][] = [
  ['training_injury', 3], ['illness', 1.4], ['off_field', 1.1], ['unhappy_minutes', 1.8], ['wonderkid', 0.35],
  ['sponsor_bonus', 1], ['maintenance', 0.8], ['fan_protest', 0.6], ['retirement', 0.5], ['takeover', 0.07],
  ['hot_streak', 0.8], ['contract_rebel', 0.45], ['tv_bonus', 0.5],
];

export async function dailyEvents(d: Db, world: WorldRow, now: Date) {
  const rng = new Rng(`${world.secret}:events:${now.toISOString().slice(0, 10)}`);
  const freq = { low: 0.02, normal: 0.035, high: 0.06 }[world.settings.eventsFrequency ?? 'normal'];
  const clubs = await d.many<ClubRow>(`select * from clubs where league = 'PL'`);
  for (const c of clubs) {
    const human = c.manager_type === 'human';
    if (!rng.chance(freq * (human ? 1.15 : 1))) continue;
    const kind = WEIGHTS[rng.weighted(WEIGHTS.map((w) => w[1]))][0];
    const squad = await loadPlayers(d, `club_id = $1 and status = 'active'`, [c.id]);
    if (squad.length < 12) continue;
    await runEvent(d, world, c, squad, kind, rng, now).catch((e) => console.error('event failed', kind, e));
  }
  // Pool clubs occasionally get takeovers or injuries too (lower fidelity)
  if (rng.chance(0.08)) {
    const pool = await d.one<ClubRow>(`select * from clubs where league in ('EUR','CHAMP') order by random() limit 1`);
    if (pool) {
      const squad = await loadPlayers(d, `club_id = $1 and status = 'active'`, [pool.id]);
      if (squad.length > 12) await runEvent(d, world, pool, squad, 'training_injury', rng, now).catch(() => {});
    }
  }
  await expireDecisions(d, world, now);
}

async function decide(d: Db, club: ClubRow, type: string, payload: Record<string, unknown>, options: DecisionOption[], now: Date, title: string, body: string) {
  await d.q('insert into decisions (club_id, type, payload, options, expires_at) values ($1, $2, $3, $4, $5)', [club.id, type, JSON.stringify({ ...payload, title, body }), JSON.stringify(options), new Date(now.getTime() + 3 * DAY)]);
  await notifyClub(d, club.id, { type: 'event', title, body, link: '/alerts' });
}

async function runEvent(d: Db, world: WorldRow, c: ClubRow, squad: PlayerRow[], kind: EventKind, rng: Rng, now: Date) {
  const human = c.manager_type === 'human';
  const pickBy = (arr: PlayerRow[], w: (p: PlayerRow) => number) => arr.length ? arr[Math.max(0, rng.weighted(arr.map(w)))] : undefined;
  switch (kind) {
    case 'training_injury': {
      const p = pickBy(squad.filter((x) => !x.injury), (x) => hiddenOf(x).injuryProneness + x.fatigue_debt / 10 + (c.training.intensity === 'high' ? 4 : 0));
      if (!p) return;
      const minor = rng.chance(0.6);
      const days = minor ? rng.int(2, 6) : rng.int(8, 24);
      const type = rng.pick(minor ? ['tight hamstring', 'bruised foot', 'twisted knee in training'] : ['hamstring strain', 'calf strain', 'ankle sprain in training']);
      await d.q('update players set injury = $2 where id = $1', [p.id, JSON.stringify({ type, severity: minor ? 'knock' : 'minor', daysLeft: days, daysTotal: days, since: now.toISOString() })]);
      if (human) await notifyClub(d, c.id, { type: 'injury', title: `Training injury: ${p.name}`, body: `${cap(type)}, out for about ${days} days.`, link: `/player/${p.id}` });
      if (p.ca >= 160) await addNews(d, world, { type: 'injury', clubIds: [c.id], headline: `${c.short} sweat on ${p.short} after training knock`, body: `${p.name} picked up a ${type} and is expected to miss around ${days} days.` });
      return;
    }
    case 'illness': {
      const n = rng.int(2, 4);
      const victims = rng.shuffle(squad.slice()).slice(0, n);
      for (const v of victims) await d.q('update players set condition = greatest(40, condition - $2), sharpness = greatest(30, sharpness - 10) where id = $1', [v.id, rng.int(15, 28)]);
      if (human) await notifyClub(d, c.id, { type: 'event', title: 'Sickness bug in the squad', body: `${victims.map((v) => v.short).join(', ')} are feeling rough. Check their condition before the next match.`, link: '/squad' });
      await addNews(d, world, { type: 'event', clubIds: [c.id], headline: `Illness sweeps through ${c.short} squad`, body: `${n} first-team players were sent home from training.` });
      return;
    }
    case 'off_field': {
      const p = pickBy(squad.filter((x) => hiddenOf(x).professionalism <= 11), (x) => 21 - hiddenOf(x).professionalism);
      if (!p) return;
      const what = rng.pick(['arrived late to training three days running', 'was spotted at a nightclub at 3am before a match day', 'got into a shouting match with a coach', 'posted something ill-advised on social media']);
      if (human) {
        await decide(d, c, 'off_field', { playerId: p.id, what }, [
          { key: 'fine', label: 'Fine him two weeks\' wages', effect: 'He will be annoyed but the squad respects it.' },
          { key: 'drop', label: 'Drop him for the next match', effect: 'A strong message; he misses one game.' },
          { key: 'forgive', label: 'Have a quiet word', effect: 'Keeps him happy, but others notice.' },
        ], now, `${p.name} in trouble`, `${p.short} ${what}. How do you respond?`);
      } else {
        await d.q('update players set morale = greatest(0.9, morale - 0.03) where id = $1', [p.id]);
        await addNews(d, world, { type: 'event', clubIds: [c.id], headline: `${c.short} fine ${p.name}`, body: `The ${c.short} player ${what}.` });
      }
      return;
    }
    case 'unhappy_minutes': {
      const recent = await d.many<{ player_id: number; mins: number }>(
        `select player_id, sum(minutes)::int mins from player_match where club_id = $1 and fixture_id in (select id from fixtures where (home_id = $1 or away_id = $1) and status = 'played' order by kickoff_at desc limit 6) group by player_id`, [c.id]);
      const mins = new Map(recent.map((r) => [r.player_id, r.mins]));
      const p = pickBy(squad.filter((x) => hiddenOf(x).ambition >= 12 && x.age >= 20 && x.age <= 31 && (mins.get(x.id) ?? 0) < 120 && !x.injury && !x.flags?.wantsOut), (x) => x.ca);
      if (!p) return;
      if (human) {
        await decide(d, c, 'unhappy', { playerId: p.id }, [
          { key: 'promise', label: 'Promise him more minutes', effect: 'Happy for now. Break the promise and he will want out.' },
          { key: 'list', label: 'Put him on the transfer list', effect: 'He can find a club where he plays.' },
          { key: 'ignore', label: 'Tell him to fight for his place', effect: 'Risky: his morale drops and he may ask to leave.' },
        ], now, `${p.name} wants to play`, `${p.short} has barely played recently and has asked to see you.`);
      } else if (rng.chance(0.5)) {
        await d.q(`update players set flags = flags || '{"listed": true}' where id = $1`, [p.id]);
      }
      return;
    }
    case 'wonderkid': {
      const p = pickBy(squad.filter((x) => x.age <= 20), (x) => x.pa - x.ca + 5);
      if (!p) return;
      await d.q('update players set pa = least(200, pa + $2) where id = $1', [p.id, rng.int(12, 28)]);
      await addNews(d, world, { type: 'event', clubIds: [c.id], importance: 2, headline: `${p.name} is the talk of the ${c.short} training ground`, body: `Staff say the ${p.age}-year-old has taken a big step forward this week.` });
      if (human) await notifyClub(d, c.id, { type: 'event', title: `Academy buzz: ${p.name}`, body: 'Your coaches think he could be special. Give him minutes.', link: `/player/${p.id}` });
      return;
    }
    case 'sponsor_bonus': {
      const amt = rng.int(10, 40) * 100_000;
      await addLedger(d, c.id, world.season_no, 'event', amt, rng.pick(['Shirt sales surge', 'New regional partner', 'Stadium naming bonus', 'Pre-season tour fee']));
      if (human) await notifyClub(d, c.id, { type: 'event', title: `Commercial windfall: £${fmtM(amt)}`, body: 'The commercial team has landed an unexpected deal.', link: '/club/finances' });
      return;
    }
    case 'maintenance': {
      const amt = rng.int(5, 20) * 100_000;
      const what = rng.pick(['floodlight repairs', 'relaying the pitch', 'roof repairs on the main stand', 'a new drainage system']);
      await addLedger(d, c.id, world.season_no, 'event', -amt, cap(what));
      if (human) await notifyClub(d, c.id, { type: 'event', title: `Unexpected bill: £${fmtM(amt)}`, body: `The stadium needs ${what}.`, link: '/club/finances' });
      return;
    }
    case 'fan_protest': {
      const fair = 22 + c.reputation * 0.45;
      if (c.finances.tickets.general < fair * 1.1 && c.fan_mood > 40) return;
      await d.q('update clubs set fan_mood = greatest(5, fan_mood - 10) where id = $1', [c.id]);
      await addNews(d, world, { type: 'event', clubIds: [c.id], importance: 2, headline: `${c.short} fans stage protest`, body: c.finances.tickets.general >= fair * 1.1 ? 'Supporters are angry about ticket prices.' : 'Supporters are unhappy with the direction of the club.' });
      if (human) await notifyClub(d, c.id, { type: 'event', title: 'Fans are protesting', body: 'Fan mood has dropped. Ticket prices and results both matter.', link: '/club/finances' });
      return;
    }
    case 'retirement': {
      const p = pickBy(squad.filter((x) => x.age >= 34 && !x.flags?.retiring), (x) => x.age);
      if (!p) return;
      await d.q(`update players set flags = flags || '{"retiring": true}' where id = $1`, [p.id]);
      await addNews(d, world, { type: 'milestone', clubIds: [c.id], importance: 2, headline: `${p.name} to retire at the end of the season`, body: `The ${p.age}-year-old ${c.short} veteran has announced this will be his last season.` });
      if (human) await notifyClub(d, c.id, { type: 'event', title: `${p.name} will retire in the summer`, body: 'Plan for his replacement.', link: `/player/${p.id}` });
      return;
    }
    case 'takeover': {
      if (human || c.reputation >= 88) return;
      const amt = rng.int(6, 16) * 10_000_000;
      await addLedger(d, c.id, world.season_no, 'event', amt, 'New owners\' investment');
      await d.q(`update clubs set bot = jsonb_set(bot, '{archetype}', '"chequebook"'), reputation = least(95, reputation + 3) where id = $1`, [c.id]);
      await addNews(d, world, { type: 'event', clubIds: [c.id], importance: 3, headline: `Takeover at ${c.short}: new owners pledge £${fmtM(amt)}`, body: `${c.name} have been sold to a consortium promising to challenge at the top. Expect them to be busy in the market.` });
      return;
    }
    case 'hot_streak': {
      const p = pickBy(squad.filter((x) => x.form >= 1.07), (x) => x.form);
      if (!p) return;
      await d.q('update players set morale = least(1.1, morale + 0.03) where id = $1', [p.id]);
      await addNews(d, world, { type: 'milestone', clubIds: [c.id], headline: `${p.name} is in the form of his life`, body: `The ${c.short} man has been one of the standout performers in recent weeks.` });
      return;
    }
    case 'contract_rebel': {
      const p = pickBy(squad.filter((x) => x.contract_until <= world.season_no && hiddenOf(x).ambition >= 13 && x.age <= 30), (x) => x.ca);
      if (!p) return;
      if (human) {
        await decide(d, c, 'contract_rebel', { playerId: p.id }, [
          { key: 'talk', label: 'Open contract talks now', effect: 'He will listen to a strong offer.' },
          { key: 'list', label: 'Put him on the transfer list', effect: 'Cash in before he walks for free.' },
          { key: 'ignore', label: 'Stand firm', effect: 'He may refuse to negotiate and leave for nothing.' },
        ], now, `${p.name} stalling on a new deal`, `${p.short}'s contract runs out this season and his agent is fielding calls.`);
      } else {
        await d.q(`update players set flags = flags || '{"wantsOut": true}' where id = $1`, [p.id]);
      }
      return;
    }
    case 'tv_bonus': {
      const amt = rng.int(5, 15) * 100_000;
      await addLedger(d, c.id, world.season_no, 'event', amt, 'Extra televised match fee');
      if (human) await notifyClub(d, c.id, { type: 'event', title: `TV money: £${fmtM(amt)}`, body: 'One of your matches was picked for live broadcast.', link: '/club/finances' });
      return;
    }
  }
}

/** Apply a manager's decision (or the default when it expires). */
export async function applyDecision(d: Db, world: WorldRow, decisionId: number, clubId: number, option: string) {
  const row = await d.one<{ id: number; club_id: number; type: string; payload: Record<string, unknown>; status: string }>('select * from decisions where id = $1 and club_id = $2', [decisionId, clubId]);
  if (!row || row.status !== 'open') return { ok: false };
  const pid = Number(row.payload.playerId);
  const [p] = pid ? await loadPlayers(d, 'id = $1', [pid]) : [];
  switch (`${row.type}:${option}`) {
    case 'off_field:fine':
      if (p) { await d.q('update players set morale = greatest(0.9, morale - 0.04) where id = $1', [p.id]); await addLedger(d, clubId, world.season_no, 'event', p.wage * 2, `Fine: ${p.name}`); }
      break;
    case 'off_field:drop':
      if (p) await d.q('update players set suspended = suspended + 1, morale = greatest(0.9, morale - 0.02) where id = $1', [p.id]);
      break;
    case 'off_field:forgive':
      await d.q(`update players set morale = greatest(0.9, morale - 0.01) where club_id = $1 and status = 'active' and id <> $2`, [clubId, pid]);
      break;
    case 'unhappy:promise':
      if (p) await d.q(`update players set morale = least(1.1, morale + 0.03), flags = flags || $2::jsonb where id = $1`, [p.id, JSON.stringify({ promise: 'rotation', promiseAt: new Date().toISOString() })]);
      break;
    case 'unhappy:list':
      if (p) await d.q(`update players set flags = flags || '{"listed": true}' where id = $1`, [p.id]);
      break;
    case 'unhappy:ignore':
      if (p) await d.q(`update players set morale = greatest(0.9, morale - 0.05), flags = flags || $2::jsonb where id = $1`, [p.id, JSON.stringify(Math.random() < 0.35 ? { wantsOut: true } : {})]);
      break;
    case 'contract_rebel:talk':
      if (p) await d.q(`update players set flags = flags - 'noRenewal' where id = $1`, [p.id]);
      break;
    case 'contract_rebel:list':
      if (p) await d.q(`update players set flags = flags || '{"listed": true}' where id = $1`, [p.id]);
      break;
    case 'contract_rebel:ignore':
      if (p) await d.q(`update players set flags = flags || '{"noRenewal": true, "wantsOut": true}' where id = $1`, [p.id]);
      break;
  }
  await d.q(`update decisions set status = 'resolved', resolved_option = $2 where id = $1`, [decisionId, option]);
  return { ok: true };
}

async function expireDecisions(d: Db, world: WorldRow, now: Date) {
  const rows = await d.many<{ id: number; club_id: number; type: string; options: DecisionOption[] }>(`select id, club_id, type, options from decisions where status = 'open' and expires_at <= $1`, [now]);
  for (const r of rows) {
    const def = r.type === 'off_field' ? 'forgive' : r.type === 'unhappy' ? 'ignore' : 'ignore';
    await applyDecision(d, world, r.id, r.club_id, def);
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
