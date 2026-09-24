// Saved tactics: list, editor data, save with familiarity cost, duplicate/delete/default, auto-fill.
import {
  FORMATIONS, FORMATION_KEYS, POSITIONS, ROLES, INSTRUCTION_OPTIONS, detectFormation, lineupWarnings, makeTactic, normaliseTactic,
  rolesForPosition, defaultRoleForPosition, selectTeam, displayRating,
  type Instructions, type Pos, type Tactic, type TacticSlot, type Trigger, type FormationKey,
} from '@ffm/engine';
import { db, tx, type Db } from '../db.ts';
import { ApiError, bad, route, type Ctx } from '../http/router.ts';
import { squadOf, toSelectable } from '../game/players.ts';
import type { PlayerRow, TacticRow } from '../game/types.ts';
import { idParam, int, myClub, playerLite, str, world } from './common.ts';

export const MAX_TACTICS = 5;
export const BENCH_MAX = 9;

type StoredTactic = Tactic & { captainId?: number | null };

export function captainOf(t: TacticRow): number | null {
  return ((t.data as StoredTactic).captainId ?? null) as number | null;
}

/** Validate and clean a tactic coming from the client. */
export function cleanTactic(input: unknown, squadIds: Set<number>): Tactic {
  if (!input || typeof input !== 'object') throw bad('Tactic is missing.');
  const raw = input as Partial<Tactic>;
  if (!Array.isArray(raw.slots) || raw.slots.length !== 11) throw bad('A tactic needs exactly 11 positions.');
  const slots: TacticSlot[] = raw.slots.map((s, i) => {
    const pos = (POSITIONS as readonly string[]).includes(s?.pos) ? (s.pos as Pos) : null;
    if (!pos) throw bad(`Position ${i + 1} is invalid.`);
    if (i === 0 && pos !== 'GK') throw bad('The first position must be the goalkeeper.');
    if (i > 0 && pos === 'GK') throw bad('Only one goalkeeper position is allowed.');
    const roles = rolesForPosition(pos);
    let role = roles.find((r) => r.key === s.role)?.key;
    let duty = s.duty;
    if (!role) ({ role, duty } = defaultRoleForPosition(pos));
    if (!ROLES[role].duties.includes(duty)) duty = ROLES[role].defaultDuty;
    const x = Math.max(4, Math.min(96, Number(s.x) || 50));
    const y = Math.max(3, Math.min(92, Number(s.y) || 50));
    return { pos, x: Math.round(x), y: Math.round(y), role, duty };
  });
  const t = normaliseTactic({ ...raw, slots, formation: detectFormation(slots) });
  // instruction values must be legal
  const ins = { ...t.instructions } as Record<string, unknown>;
  for (const [k, opts] of Object.entries(INSTRUCTION_OPTIONS)) {
    if (!(opts as readonly unknown[]).includes(ins[k])) ins[k] = (makeTactic('x', '4-3-3').instructions as unknown as Record<string, unknown>)[k];
  }
  t.instructions = ins as unknown as Instructions;
  // set pieces
  const sp = t.setPieces;
  for (const k of ['cornerTaker', 'freeKickTaker', 'penaltyTaker', 'longThrowTaker'] as const) {
    if (sp[k] !== null && sp[k] !== undefined && !squadIds.has(Number(sp[k]))) sp[k] = null;
  }
  if (!['near', 'far', 'short', 'edge'].includes(sp.cornerDelivery)) sp.cornerDelivery = 'far';
  sp.inBox = Math.max(3, Math.min(7, Math.round(sp.inBox)));
  sp.stayBack = Math.max(1, Math.min(4, Math.round(sp.stayBack)));
  sp.longThrows = !!sp.longThrows;
  t.triggers = cleanTriggers(t.triggers, squadIds);
  t.name = (t.name || 'Tactic').trim().slice(0, 30) || 'Tactic';
  return t;
}

function cleanTriggers(list: Trigger[], squadIds: Set<number>): Trigger[] {
  const out: Trigger[] = [];
  for (const tr of (list ?? []).slice(0, 3)) {
    const w = tr?.when as Trigger['when'];
    if (!w || typeof w !== 'object') continue;
    const minute = Math.max(1, Math.min(89, Math.round(Number((w as { minute: number }).minute) || 60)));
    let when: Trigger['when'] | null = null;
    switch (w.kind) {
      case 'score': when = { kind: 'score', state: ['losing', 'drawing', 'winning'].includes(w.state) ? w.state : 'losing', by: Math.max(0, Math.min(3, Math.round(w.by ?? 1))), minute }; break;
      case 'condition': when = { kind: 'condition', below: Math.max(30, Math.min(90, Math.round(w.below ?? 60))), minute }; break;
      case 'yellow': case 'red': case 'opp_change': when = { kind: w.kind, minute }; break;
    }
    if (!when) continue;
    const actions: Trigger['actions'] = [];
    for (const a of (tr.actions ?? []).slice(0, 3)) {
      if (a?.type === 'mentality') actions.push({ type: 'mentality', delta: Math.max(-2, Math.min(2, Math.round(a.delta))) || 1 });
      else if (a?.type === 'plan_b') actions.push({ type: 'plan_b' });
      else if (a?.type === 'instruction' && a.key in INSTRUCTION_OPTIONS && (INSTRUCTION_OPTIONS[a.key] as readonly unknown[]).includes(a.value)) actions.push({ type: 'instruction', key: a.key, value: a.value });
      else if (a?.type === 'sub') {
        const outOk = typeof a.out === 'number' ? squadIds.has(a.out) : ['most_tired', 'lowest_rated', 'on_yellow', 'trigger_player'].includes(a.out as string);
        const inOk = typeof a.in === 'number' ? squadIds.has(a.in) : ['best_available', 'most_attacking', 'most_defensive'].includes(a.in as string);
        if (outOk && inOk) actions.push({ type: 'sub', out: a.out, in: a.in, outLine: ['DEF', 'MID', 'ATT', 'ANY'].includes(a.outLine as string) ? a.outLine : 'ANY' });
      }
    }
    if (!actions.length) continue;
    out.push({ id: String(tr.id ?? `t${out.length + 1}`).slice(0, 12), when, actions });
  }
  return out;
}

function cleanIds(v: unknown, squadIds: Set<number>, max: number, allowEmpty: boolean): number[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const x of v.slice(0, max)) {
    const n = Number(x);
    if (allowEmpty && (n === -1 || x === null)) { out.push(-1); continue; }
    if (!Number.isInteger(n) || !squadIds.has(n) || seen.has(n)) { if (allowEmpty) out.push(-1); continue; }
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Familiarity cost of editing a tactic: shape changes hurt most, tweaks a little. */
export function familiarityAfterEdit(prev: Tactic, next: Tactic, fam: number): number {
  let moved = 0;
  next.slots.forEach((s, i) => { if (!prev.slots[i] || prev.slots[i].pos !== s.pos) moved++; });
  let f = fam;
  if (moved >= 3) f = Math.min(f, 0.5);
  else f -= moved * 0.05;
  const roleChanges = next.slots.filter((s, i) => prev.slots[i] && (prev.slots[i].role !== s.role || prev.slots[i].duty !== s.duty)).length;
  f -= roleChanges * 0.012;
  const insChanges = (Object.keys(next.instructions) as (keyof Instructions)[]).filter((k) => next.instructions[k] !== prev.instructions[k]).length;
  f -= insChanges * 0.008;
  if (prev.mentality !== next.mentality) f -= 0.01;
  return Math.max(0.3, Math.min(1, Math.round(f * 1000) / 1000));
}

function tacticOut(t: TacticRow) {
  const data = normaliseTactic(t.data);
  return {
    id: t.id, name: t.name, isDefault: t.is_default, familiarity: Math.round(t.familiarity * 100) / 100, record: t.record,
    formation: data.formation, mentality: data.mentality, data, lineup: (t.lineup ?? []) as number[], bench: (t.bench ?? []) as number[], captainId: captainOf(t),
  };
}
export type TacticOut = ReturnType<typeof tacticOut>;

async function clubTacticsList(d: Db, clubId: number) {
  return d.many<TacticRow>('select * from tactics where club_id = $1 order by is_default desc, id', [clubId]);
}

// ---------------------------------------------------------------- routes
route('GET', '/api/tactics', 'user', async (ctx) => {
  const club = await myClub(ctx);
  const rows = await clubTacticsList(db, club.id);
  return { tactics: rows.map(tacticOut), max: MAX_TACTICS };
});

export async function tacticEditorData(ctx: Ctx) {
  const w = await world();
  const club = await myClub(ctx);
  const t = await db.one<TacticRow>('select * from tactics where id = $1 and club_id = $2', [idParam(ctx), club.id]);
  if (!t) throw new ApiError('NOT_FOUND', 'Tactic not found.');
  const squad = await squadOf(db, club.id);
  const out = tacticOut(t);
  const sel = squad.map(toSelectable);
  return {
    tactic: out,
    warnings: lineupWarnings(sel, out.data, out.lineup, t.familiarity, out.captainId),
    squad: squad.map((p) => ({ ...playerLite(p, w.season_no), attrs: p.attrs, fam: p.positions, formValue: p.form, moraleValue: p.morale })),
    others: (await clubTacticsList(db, club.id)).filter((x) => x.id !== t.id).map((x) => ({ id: x.id, name: x.name })),
    benchMax: BENCH_MAX,
    formations: FORMATION_KEYS,
  };
}
export type TacticEditorData = Awaited<ReturnType<typeof tacticEditorData>>;
route('GET', '/api/tactics/:id', 'user', tacticEditorData);

route('PUT', '/api/tactics/:id', 'user', async (ctx) => {
  return tx(async (t) => {
    const club = await myClub(ctx, t);
    const row = await t.one<TacticRow>('select * from tactics where id = $1 and club_id = $2 for update', [idParam(ctx), club.id]);
    if (!row) throw new ApiError('NOT_FOUND', 'Tactic not found.');
    const squad = await squadOf(t, club.id);
    const ids = new Set(squad.map((p) => p.id));
    const prev = normaliseTactic(row.data);
    const next = ctx.body.data ? cleanTactic({ ...ctx.body.data, name: ctx.body.name ?? ctx.body.data.name ?? row.name }, ids) : { ...prev, name: typeof ctx.body.name === 'string' ? ctx.body.name.trim().slice(0, 30) || prev.name : prev.name };
    const lineup = ctx.body.lineup !== undefined ? cleanIds(ctx.body.lineup, ids, 11, true) : (row.lineup ?? []);
    while (lineup.length < 11) lineup.push(-1);
    const bench = ctx.body.bench !== undefined ? cleanIds(ctx.body.bench, ids, BENCH_MAX, false).filter((x) => !lineup.includes(x)) : (row.bench ?? []).filter((x: number) => !lineup.includes(x));
    let captainId = ctx.body.captainId !== undefined ? (ctx.body.captainId === null ? null : int(ctx.body.captainId, 'captainId')) : captainOf(row);
    if (captainId && !ids.has(captainId)) captainId = null;
    const fam = ctx.body.data ? familiarityAfterEdit(prev, next, row.familiarity) : row.familiarity;
    const dup = await t.one('select 1 from tactics where club_id = $1 and name = $2 and id <> $3', [club.id, next.name, row.id]);
    if (dup) throw new ApiError('CONFLICT', 'You already have a tactic with that name.');
    await t.q('update tactics set name = $2, data = $3, lineup = $4, bench = $5, familiarity = $6, updated_at = now() where id = $1', [
      row.id, next.name, JSON.stringify({ ...next, captainId }), JSON.stringify(lineup), JSON.stringify(bench), fam,
    ]);
    const saved = (await t.one<TacticRow>('select * from tactics where id = $1', [row.id]))!;
    // A submitted team sheet that uses this tactic follows the edits until its deadline.
    const byId = new Map(squad.map((p) => [p.id, p]));
    const xiValid = lineup.length === 11 && lineup.every((id) => byId.has(id)) && new Set(lineup).size === 11;
    if (xiValid) {
      await t.q(
        `update team_sheets ts set tactic = $3, lineup = $4, bench = $5, captain_id = coalesce($6, ts.captain_id), submitted_at = now()
           from fixtures f where f.id = ts.fixture_id and ts.club_id = $1 and ts.submitted_by = 'user' and f.status = 'scheduled'
             and f.deadline_at > now() and (ts.tactic->>'tacticId')::int = $2`,
        [club.id, row.id, JSON.stringify({ ...next, tacticId: row.id, captainId }), JSON.stringify(lineup), JSON.stringify(bench), captainId],
      );
    }
    const out = tacticOut(saved);
    return { tactic: out, warnings: lineupWarnings(squad.map(toSelectable), out.data, out.lineup, saved.familiarity, out.captainId), savedAt: new Date().toISOString() };
  });
});

route('POST', '/api/tactics', 'user', async (ctx) => {
  return tx(async (t) => {
    const club = await myClub(ctx, t, true);
    const rows = await clubTacticsList(t, club.id);
    if (rows.length >= MAX_TACTICS) throw new ApiError('CONFLICT', `You can keep up to ${MAX_TACTICS} tactics. Delete one first.`);
    let data: Tactic;
    let lineup: number[] = [];
    let bench: number[] = [];
    let fam = 0.45;
    const baseName = typeof ctx.body.name === 'string' && ctx.body.name.trim() ? ctx.body.name.trim().slice(0, 30) : null;
    if (ctx.body.from) {
      const src = rows.find((r) => r.id === Number(ctx.body.from));
      if (!src) throw new ApiError('NOT_FOUND', 'Tactic to copy not found.');
      data = normaliseTactic(src.data);
      lineup = src.lineup ?? [];
      bench = src.bench ?? [];
      fam = src.familiarity;
      data.name = baseName ?? `${src.name} (copy)`.slice(0, 30);
    } else {
      const formation = (FORMATION_KEYS as readonly string[]).includes(ctx.body.formation) ? (ctx.body.formation as Exclude<FormationKey, 'Custom'>) : '4-3-3';
      data = makeTactic(baseName ?? `My ${formation}`, formation);
      const squad = await squadOf(t, club.id);
      const s = selectTeam(squad.map(toSelectable), data, { benchSize: 9 });
      lineup = s.lineup;
      bench = s.bench;
      data.setPieces = { ...data.setPieces, ...s.setPieces };
      (data as StoredTactic).captainId = s.captainId;
    }
    let name = data.name;
    for (let i = 2; rows.some((r) => r.name === name); i++) name = `${data.name.slice(0, 26)} ${i}`;
    data.name = name;
    const r = await t.one<TacticRow>('insert into tactics (club_id, name, data, lineup, bench, familiarity, is_default) values ($1,$2,$3,$4,$5,$6,false) returning *', [
      club.id, name, JSON.stringify(data), JSON.stringify(lineup), JSON.stringify(bench), fam,
    ]);
    return { tactic: tacticOut(r!) };
  });
});

route('DELETE', '/api/tactics/:id', 'user', async (ctx) => {
  return tx(async (t) => {
    const club = await myClub(ctx, t, true);
    const row = await t.one<TacticRow>('select * from tactics where id = $1 and club_id = $2', [idParam(ctx), club.id]);
    if (!row) throw new ApiError('NOT_FOUND', 'Tactic not found.');
    if (row.is_default) throw new ApiError('CONFLICT', 'Make another tactic the default before deleting this one.');
    await t.q('delete from tactics where id = $1', [row.id]);
    return { ok: true };
  });
});

route('POST', '/api/tactics/:id/default', 'user', async (ctx) => {
  return tx(async (t) => {
    const club = await myClub(ctx, t, true);
    const row = await t.one<TacticRow>('select id from tactics where id = $1 and club_id = $2', [idParam(ctx), club.id]);
    if (!row) throw new ApiError('NOT_FOUND', 'Tactic not found.');
    await t.q('update tactics set is_default = (id = $2) where club_id = $1', [club.id, row.id]);
    return { ok: true };
  });
});

route('POST', '/api/tactics/:id/autofill', 'user', async (ctx) => {
  return tx(async (t) => {
    const club = await myClub(ctx, t);
    const row = await t.one<TacticRow>('select * from tactics where id = $1 and club_id = $2 for update', [idParam(ctx), club.id]);
    if (!row) throw new ApiError('NOT_FOUND', 'Tactic not found.');
    const squad = await squadOf(t, club.id);
    const data = ctx.body.data ? cleanTactic(ctx.body.data, new Set(squad.map((p) => p.id))) : normaliseTactic(row.data);
    const sel = squad.filter((p) => !p.flags?.rested).map(toSelectable);
    const s = selectTeam(sel, data, { benchSize: BENCH_MAX, restBelow: ctx.body.rotate ? 72 : 0 });
    data.setPieces = { ...data.setPieces, cornerTaker: data.setPieces.cornerTaker ?? s.setPieces.cornerTaker, freeKickTaker: data.setPieces.freeKickTaker ?? s.setPieces.freeKickTaker, penaltyTaker: data.setPieces.penaltyTaker ?? s.setPieces.penaltyTaker };
    await t.q('update tactics set lineup = $2, bench = $3, data = $4, updated_at = now() where id = $1', [row.id, JSON.stringify(s.lineup), JSON.stringify(s.bench), JSON.stringify({ ...data, captainId: s.captainId })]);
    return { lineup: s.lineup, bench: s.bench, captainId: s.captainId, setPieces: data.setPieces, strength: displayRating(s.strength) };
  });
});

void FORMATIONS;
void (null as unknown as PlayerRow);
