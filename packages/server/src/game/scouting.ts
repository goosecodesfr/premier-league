// Scouting network: send the chief scout's team to a region to find young talent. Every day of a
// mission turns up a player; better scouts find better players and judge them more accurately.
import { Rng } from '@ffm/engine';
import type { Db } from '../db.ts';
import { ApiError } from '../http/router.ts';
import { addLedger } from './finance.ts';
import { notifyClub } from './notify.ts';
import type { ClubRow, WorldRow } from './types.ts';

export const REGIONS: Record<string, { label: string; nations: string[] }> = {
  britain: { label: 'Britain and Ireland', nations: ['ENG', 'SCO', 'WAL', 'NIR', 'IRL'] },
  iberia: { label: 'Spain and Portugal', nations: ['ESP', 'POR'] },
  france: { label: 'France and Belgium', nations: ['FRA', 'BEL', 'LUX', 'SUI'] },
  germany: { label: 'Germany and Austria', nations: ['GER', 'AUT'] },
  italy: { label: 'Italy', nations: ['ITA'] },
  lowlands: { label: 'Netherlands and Scandinavia', nations: ['NED', 'DEN', 'NOR', 'SWE', 'FIN', 'ISL'] },
  east: { label: 'Eastern Europe and the Balkans', nations: ['POL', 'CZE', 'SVK', 'HUN', 'ROU', 'BUL', 'SRB', 'CRO', 'BIH', 'SVN', 'UKR', 'RUS', 'GEO', 'ALB', 'MKD', 'MNE', 'KOS', 'GRE', 'TUR', 'KAZ', 'ARM', 'AZE', 'BLR', 'LTU', 'LVA', 'EST', 'MDA', 'CYP'] },
  south_america: { label: 'South America', nations: ['ARG', 'BRA', 'URU', 'COL', 'CHI', 'ECU', 'PAR', 'PER', 'VEN', 'BOL'] },
  north_america: { label: 'North and Central America', nations: ['USA', 'CAN', 'MEX', 'CRC', 'JAM', 'PAN', 'HON', 'SLV', 'GUA', 'HAI', 'TRI', 'CUW', 'SUR'] },
  africa: { label: 'Africa', nations: ['NGA', 'GHA', 'CIV', 'SEN', 'CMR', 'MLI', 'MAR', 'ALG', 'TUN', 'EGY', 'RSA', 'COD', 'GUI', 'BFA', 'GAB', 'ZAM', 'ZIM', 'ANG', 'CPV', 'GNB', 'TOG', 'BEN', 'KEN', 'UGA', 'GAM', 'SLE', 'LBR', 'MOZ', 'NIG', 'CGO', 'MTN', 'EQG', 'CTA', 'MAD', 'LBY', 'SUD', 'ETH', 'TAN', 'RWA', 'BDI', 'COM'] },
  asia: { label: 'Asia and Oceania', nations: ['JPN', 'KOR', 'CHN', 'AUS', 'NZL', 'KSA', 'IRN', 'IRQ', 'QAT', 'UAE', 'UZB', 'JOR', 'SYR', 'THA', 'VIE', 'IDN', 'PHI', 'IND', 'OMA', 'BHR', 'KUW', 'LIB', 'PLE', 'MAS', 'SIN'] },
  anywhere: { label: 'Worldwide', nations: [] },
};

export const MISSION_DAYS = 7;
export const MISSION_COST = 150_000;

export function missionLimit(club: ClubRow): number {
  return 1 + Math.floor((club.staff.scout?.rating ?? 8) / 8);
}

export async function startMission(d: Db, world: WorldRow, club: ClubRow, opts: { region: string; pos: string | null; ageMax: number }, now = new Date()) {
  if (!REGIONS[opts.region]) throw new ApiError('VALIDATION_FAILED', 'Pick a region.');
  const active = await d.one<{ n: number }>(`select count(*)::int n from scout_missions where club_id = $1 and status = 'active'`, [club.id]);
  if ((active?.n ?? 0) >= missionLimit(club)) throw new ApiError('CONFLICT', `Your scouting staff can run ${missionLimit(club)} mission${missionLimit(club) > 1 ? 's' : ''} at a time. Hire a better chief scout for more.`);
  if (club.balance < MISSION_COST - 20_000_000) throw new ApiError('INSUFFICIENT_FUNDS', 'You cannot afford a scouting trip.');
  await addLedger(d, club.id, world.season_no, 'scouting', -MISSION_COST, `Scouting mission: ${REGIONS[opts.region].label}`);
  const ends = new Date(now.getTime() + MISSION_DAYS * 86400_000);
  return d.one<{ id: number }>(`insert into scout_missions (club_id, region, pos, age_max, ends_at) values ($1, $2, $3, $4, $5) returning id`, [club.id, opts.region, opts.pos, opts.ageMax, ends]);
}

/** Daily: each active mission turns up one player (sometimes two for top scouts). */
export async function progressMissions(d: Db, world: WorldRow, now: Date) {
  const missions = await d.many<{ id: number; club_id: number; region: string; pos: string | null; age_max: number; ends_at: Date; found: { id: number; name: string }[]; reports: number }>(
    `select * from scout_missions where status = 'active'`);
  for (const m of missions) {
    const club = await d.one<ClubRow>('select * from clubs where id = $1', [m.club_id]);
    if (!club) continue;
    const scout = club.staff.scout?.rating ?? 8;
    const rng = new Rng(`${world.secret}:mission:${m.id}:${now.toISOString().slice(0, 10)}`);
    const nations = REGIONS[m.region]?.nations ?? [];
    const params: unknown[] = [m.club_id, m.age_max];
    let where = `p.status in ('active','free') and coalesce(p.club_id, 0) <> $1 and p.age <= $2`;
    if (nations.length) { params.push(nations); where += ` and p.nat = any($${params.length})`; }
    if (m.pos) { params.push(m.pos); where += ` and (p.positions->>$${params.length})::float >= 0.84`; }
    params.push((m.found ?? []).map((f) => f.id));
    where += ` and p.id <> all($${params.length}) and not exists (select 1 from scouting s where s.club_id = $1 and s.player_id = p.id and s.knowledge >= 60)`;
    const cands = await d.many<{ id: number; name: string; pa: number; ca: number; age: number }>(`select p.id, p.name, p.pa, p.ca, p.age from players p where ${where} order by p.pa desc limit 120`, params);
    if (cands.length) {
      const n = scout >= 16 && rng.chance(0.4) ? 2 : 1;
      for (let k = 0; k < n && cands.length; k++) {
        // Better scouts are drawn to genuine talent; weaker ones get excited about the wrong players.
        const sharp = 0.4 + scout / 20;
        const weights = cands.map((c) => Math.exp(((c.pa - 150) / 14) * sharp) * (1 + Math.max(0, 21 - c.age) * 0.05));
        const i = rng.weighted(weights);
        const pick = cands.splice(i < 0 ? 0 : i, 1)[0];
        const knowledge = Math.min(90, 50 + scout * 2 + rng.int(0, 10));
        await d.q(`insert into scouting (club_id, player_id, knowledge, assigned) values ($1, $2, $3, false)
          on conflict (club_id, player_id) do update set knowledge = greatest(scouting.knowledge, excluded.knowledge), updated_at = now()`, [m.club_id, pick.id, knowledge]);
        m.found = [...(m.found ?? []), { id: pick.id, name: pick.name }];
        if (pick.pa >= 176 && rng.chance(0.4 + scout / 40)) {
          await notifyClub(d, m.club_id, { type: 'system', title: 'Your scouts have found a gem', body: `${pick.name} (${pick.age}) could become a top player. Full report on his profile.`, link: `/player/${pick.id}` });
        }
      }
    }
    const finished = new Date(m.ends_at) <= now;
    await d.q(`update scout_missions set found = $2, reports = reports + 1, status = $3 where id = $1`, [m.id, JSON.stringify(m.found ?? []), finished ? 'done' : 'active']);
    if (finished) {
      await notifyClub(d, m.club_id, { type: 'system', title: `Scouting mission complete: ${REGIONS[m.region]?.label ?? m.region}`, body: `${(m.found ?? []).length} players assessed. See the scouting page for the reports.`, link: '/scouting' });
    }
  }
}
