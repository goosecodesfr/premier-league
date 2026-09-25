// World data upgrades: bring a league created from an older seed up to date without touching
// its results, squads or finances. Runs once per data version at the start of a clock tick.
import { Rng, attrsFromArray, deriveTraits, type Traits } from '@ffm/engine';
import { insertMany, tx, type Db } from '../db.ts';
import { acumenFor, newManager } from './archetypes.ts';
import { addNews } from './news.ts';
import { broadcast } from './notify.ts';
import { loadSeed, type SeedClub } from './seed.ts';
import type { Archetype, WorldRow } from './types.ts';
import { SEED_DATA_VERSION, SEED_PLAYER_COLS, defaultTraining, initialFacilities, initialFinances, makeStaffMember, seedPlayerRow, STAFF_ROLES } from './world.ts';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function ensureWorldData(d: Db): Promise<{ upgraded: boolean; notes: string[] }> {
  const w = await d.one<WorldRow>('select * from world where id = 1');
  if (!w) return { upgraded: false, notes: [] };
  const have = Number((w.state as Record<string, unknown>).dataVersion ?? 1);
  if (have >= SEED_DATA_VERSION) return { upgraded: false, notes: [] };
  const notes: string[] = [];
  await tx(async (t) => {
    // Serialise with any concurrent upgrade attempt.
    await t.q('select pg_advisory_xact_lock(482907332)');
    const fresh = await t.one<WorldRow>('select * from world where id = 1');
    const v = Number((fresh!.state as Record<string, unknown>).dataVersion ?? 1);
    if (v >= 2) return;
    notes.push(...(await upgradeToV2(t, fresh!)));
    await t.q(`update world set state = jsonb_set(state, '{dataVersion}', to_jsonb(2)) where id = 1`);
  });
  return { upgraded: notes.length > 0, notes };
}

async function upgradeToV2(t: Db, world: WorldRow): Promise<string[]> {
  const seed = loadSeed();
  const v2 = seed.upgrades?.v2;
  if (!v2) return [];
  const notes: string[] = [];
  const rng = new Rng(`${world.secret}:upgrade:v2`);

  // 1) Link existing players to their seed entries (by name and nationality, in creation order).
  const rows = await t.many<{ id: number; name: string; nat: string; seed_id: number | null }>('select id, name, nat, seed_id from players order by id');
  const bySeedKey = new Map<string, number[]>();
  for (const p of seed.players) {
    if (p.sid >= v2.firstSid) continue;
    const k = `${norm(p.name)}|${p.nat}`;
    (bySeedKey.get(k) ?? bySeedKey.set(k, []).get(k)!).push(p.sid);
  }
  const linkIds: number[] = [];
  const linkSids: number[] = [];
  const taken = new Set(rows.filter((r) => r.seed_id != null).map((r) => r.seed_id!));
  for (const r of rows) {
    if (r.seed_id != null) continue;
    const list = bySeedKey.get(`${norm(r.name)}|${r.nat}`);
    const sid = list?.find((s) => !taken.has(s));
    if (sid == null) continue;
    taken.add(sid);
    linkIds.push(r.id);
    linkSids.push(sid);
  }
  for (let i = 0; i < linkIds.length; i += 1000) {
    await t.q(`update players p set seed_id = v.sid from (select unnest($1::int[]) id, unnest($2::int[]) sid) v where p.id = v.id`, [linkIds.slice(i, i + 1000), linkSids.slice(i, i + 1000)]);
  }
  notes.push(`linked ${linkIds.length} players to the seed`);

  // 2) Signature traits: real PlayStyles for seed players, derived ones for everyone else.
  const bySid = new Map(seed.players.map((p) => [p.sid, p]));
  const all = await t.many<{ id: number; seed_id: number | null; attrs: number[]; positions: Record<string, number>; ca: number; traits: Traits }>(
    `select id, seed_id, attrs, positions, ca, traits from players where status <> 'retired'`);
  const tIds: number[] = [];
  const tVals: string[] = [];
  for (const p of all) {
    if (p.traits && Object.keys(p.traits).length) continue;
    const sp = p.seed_id != null ? bySid.get(p.seed_id) : undefined;
    const tr = sp ? sp.tr ?? {} : deriveTraits(attrsFromArray(p.attrs), p.positions, p.ca, new Rng(`${world.secret}:traits:${p.id}`));
    if (!Object.keys(tr).length) continue;
    tIds.push(p.id);
    tVals.push(JSON.stringify(tr));
  }
  for (let i = 0; i < tIds.length; i += 1000) {
    await t.q(`update players p set traits = v.tr::jsonb from (select unnest($1::int[]) id, unnest($2::text[]) tr) v where p.id = v.id`, [tIds.slice(i, i + 1000), tVals.slice(i, i + 1000)]);
  }
  notes.push(`traits for ${tIds.length} players`);

  // 3) Researched breakout talents: lift ability and potential (never lower anything).
  let lifted = 0;
  for (const sid of v2.patched) {
    const sp = bySid.get(sid);
    if (!sp) continue;
    const r = await t.q(`update players set attrs = case when ca < $2 then $3::smallint[] else attrs end, ca = greatest(ca, $2), pa = greatest(pa, $4)
      where seed_id = $1 and status <> 'retired'`, [sid, sp.ca, sp.a, sp.pa]);
    lifted += r.rowCount ?? 0;
  }
  notes.push(`lifted ${lifted} breakout talents`);

  // 4) Rest-of-world clubs.
  const existing = new Map((await t.many<{ id: number; key: string }>('select id, key from clubs')).map((c) => [c.key, c.id]));
  const newClubs = seed.clubs.filter((c) => c.league === 'WORLD' && !existing.has(c.key));
  if (newClubs.length) {
    await insertMany(t, 'clubs', ['key', 'name', 'short', 'league', 'country', 'colors', 'stadium', 'capacity', 'reputation', 'bot', 'balance', 'finances', 'facilities', 'staff', 'training', 'vision', 'fan_mood', 'meta'],
      newClubs.map((c) => worldClubRow(c, world, rng)));
    for (const c of await t.many<{ id: number; key: string }>('select id, key from clubs where key = any($1)', [newClubs.map((c) => c.key)])) existing.set(c.key, c.id);
  }
  notes.push(`${newClubs.length} rest-of-world clubs`);

  // 5) The young talents themselves.
  const present = new Set((await t.many<{ seed_id: number }>('select seed_id from players where seed_id >= $1', [v2.firstSid])).map((r) => r.seed_id));
  const sizes = new Map((await t.many<{ club_id: number; n: number }>(`select club_id, count(*)::int n from players where status = 'active' and club_id is not null group by club_id`)).map((r) => [r.club_id, r.n]));
  const leagues = new Map((await t.many<{ id: number; league: string }>('select id, league from clubs')).map((c) => [c.id, c.league]));
  const add: unknown[][] = [];
  for (const p of seed.players) {
    if (p.sid < v2.firstSid || present.has(p.sid)) continue;
    let clubId = p.club ? existing.get(p.club) ?? null : null;
    if (clubId && leagues.get(clubId) !== 'WORLD' && (sizes.get(clubId) ?? 0) >= 32) continue; // no room in a real squad
    if (!clubId) continue;
    sizes.set(clubId, (sizes.get(clubId) ?? 0) + 1);
    const row = seedPlayerRow({ ...p, age: p.age + (world.season_no - 1) }, clubId, 'active', rng, world.season_no);
    add.push(row);
    clubId = null;
  }
  if (add.length) await insertMany(t, 'players', SEED_PLAYER_COLS, add, '', 300);
  notes.push(`${add.length} young talents added`);

  if (add.length) {
    await addNews(t, world, {
      type: 'system', importance: 3,
      headline: `Scouts unearth the next generation: ${add.length} young talents join the world`,
      body: 'Wonderkids from around the world, from Club Tijuana to River Plate, are now on the radar. Search the transfer market for "Young talents" or send your scouts on a mission.',
    });
    await broadcast(t, { type: 'system', title: 'New: young talents, traits and private bids', body: `${add.length} wonderkids added, every player now has signature traits, and you can bid in private.`, link: '/transfers/search?prospects=1' });
  }
  return notes;
}

function worldClubRow(c: SeedClub, world: WorldRow, rng: Rng): unknown[] {
  const archetype = 'youth' as Archetype;
  const bot = newManager(rng, c.country, archetype, acumenFor(world.settings.difficulty, c.reputation, rng), world.season_no);
  const { balance, finances } = initialFinances(c.reputation, archetype, c.league);
  const staff: Record<string, unknown> = {};
  for (const role of STAFF_ROLES) staff[role] = makeStaffMember(rng, c.country, 6 + (c.reputation - 55) / 3.5 + rng.normal(0, 2));
  return [
    c.key, c.name, c.short, c.league, c.country, JSON.stringify(c.colors), c.stadium, c.capacity, c.reputation,
    JSON.stringify(bot), balance, JSON.stringify(finances), JSON.stringify(initialFacilities(c.reputation)), JSON.stringify(staff),
    JSON.stringify(defaultTraining()), '[]', 60,
    JSON.stringify({ rivals: [], lastPos: null, europe: null, form: 0, expectation: null }),
  ];
}
