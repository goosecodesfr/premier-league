// Season start wrapper and human club management (picking, handing back).
import { Rng } from '@ffm/engine';
import type { Db } from '../db.ts';
import { ApiError } from '../http/router.ts';
import { clubStrengths, startSeason } from './calendar.ts';
import { addNews } from './news.ts';
import { broadcast } from './notify.ts';
import { makeSponsorOffers } from './sponsors.ts';
import type { ClubRow, WorldRow } from './types.ts';

export async function beginSeason(d: Db, world: WorldRow, now: Date) {
  // Expectations (for bot pressure and the manager-of-the-season award) from squad strength and reputation
  const strengths = (await clubStrengths(d)).filter((s) => s.league === 'PL');
  const ranked = strengths.map((s) => ({ s, k: s.strength + s.reputation * 0.25 })).sort((a, b) => b.k - a.k);
  for (const [i, x] of ranked.entries()) {
    await d.q(`update clubs set meta = jsonb_set(meta, '{expectation}', to_jsonb($2::int)) where id = $1`, [x.s.id, i + 1]);
  }
  const { firstKickoff } = await startSeason(d, world, now);
  await addNews(d, world, {
    type: 'system', importance: 3, headline: `The ${world.season_label} season is set`,
    body: `The first round kicks off ${firstKickoff.toUTCString().slice(0, 22)} UTC. Lineups lock ${world.settings.deadlineMinutes} minutes before kick-off.`,
  });
  await broadcast(d, { type: 'system', title: `${world.season_label} fixtures are out`, body: 'Check your first opponent and set your team.', link: '/league/fixtures' });
}

export async function pickClub(d: Db, world: WorldRow, userId: number, clubId: number) {
  const existing = await d.one<{ id: number }>('select id from clubs where user_id = $1', [userId]);
  if (existing) throw new ApiError('CONFLICT', 'You already manage a club.');
  const club = await d.one<ClubRow>('select * from clubs where id = $1 for update', [clubId]);
  if (!club || club.league !== 'PL') throw new ApiError('NOT_FOUND', 'Pick a Premier League club.');
  if (club.manager_type === 'human') throw new ApiError('CONFLICT', 'Someone already manages that club.');
  if (world.settings.clubPick === 'no_elite' && club.reputation >= 88) throw new ApiError('FORBIDDEN', 'This league has agreed that the elite clubs are bot-only.');
  const rng = new Rng(`${world.secret}:pick:${userId}:${clubId}`);
  const offers = club.finances.sponsor ? null : makeSponsorOffers(club, rng);
  await d.q(
    `update clubs set manager_type = 'human', user_id = $2, finances = finances || $3::jsonb,
       meta = meta || '{"missedDeadlines": 0, "botTakeover": false}'::jsonb where id = $1`,
    [clubId, userId, JSON.stringify({ sponsorOffers: offers })],
  );
  const user = await d.one<{ display_name: string }>('select display_name from users where id = $1', [userId]);
  await addNews(d, world, { type: 'manager', clubIds: [clubId], importance: 3, headline: `${user?.display_name ?? 'A new manager'} takes charge of ${club.short}`, body: `${club.bot.name} steps aside as ${club.name} welcome a new manager.` });
  await broadcast(d, { type: 'system', title: `${user?.display_name} is the new ${club.short} manager`, body: 'A new rival has entered the league.', link: `/club/${clubId}` });
  return club;
}

/** A human hands the club back to the bots (leaving the league or taking a break). */
export async function leaveClub(d: Db, userId: number) {
  const club = await d.one<ClubRow>('select * from clubs where user_id = $1', [userId]);
  if (!club) return;
  await d.q(`update clubs set manager_type = 'bot', user_id = null where id = $1`, [club.id]);
}

export async function setBotTakeover(d: Db, clubId: number, on: boolean) {
  await d.q(`update clubs set meta = meta || $2::jsonb where id = $1`, [clubId, JSON.stringify({ botTakeover: on, missedDeadlines: 0 })]);
}
