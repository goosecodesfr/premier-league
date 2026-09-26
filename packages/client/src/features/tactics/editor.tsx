// The formation editor: pitch with drag-and-drop (and tap fallbacks), bench strip, roles, and the other tabs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, Crown, Move, Plus, RotateCcw, Search, Wand2, X } from 'lucide-react';
import {
  FORMATIONS, FORMATION_KEYS, ROLES, analyseTactic, attrsFromArray, detectFormation, displayAttr, displayRating, lineupWarnings, posFromXY, roleRating, rolesForPosition,
  defaultRoleForPosition, normaliseTactic, type Attributes, type Duty, type FormationKey, type Pos, type SlotAnalysis, type Tactic, type TacticSlot,
} from '@ffm/engine';
import type { TacticEditorData } from '@ffm/server/routes/tactics';
import { api, ApiError } from '../../lib/api';
import { conditionTone, toneVar, timeLabel, LINE_OF } from '../../lib/format';
import { haptic } from '../../lib/device';
import { useDebouncedCallback } from '../../lib/hooks';
import { Badge, Button, Chip, ChipRow, IconButton, List, Q, Screen, Segmented, Sheet, SkeletonCards, Tabs, cx, inputCls, useToast } from '../../components/ui';
import { PlayerAvatar, PosBadge, Sparkline } from '../../components/domain';
import { PitchLines } from '../../components/pitch';
import { ShapeGlyph } from './list';
import { InstructionsTab, SetPiecesTab, TriggersTab, type EditorPlayer } from './parts';
import { AnalysisTab, FIT, FitLegend, PlayerInstructionsPanel } from './analysis-parts';
import { useMe } from '../../app/session';

type SquadP = TacticEditorData['squad'][number];
interface State { data: Tactic; lineup: number[]; bench: number[]; captainId: number | null }
type From = { kind: 'slot' | 'bench'; index: number };
type SheetTab = 'player' | 'role' | 'instr';

const BENCH_MAX = 9;
/** Formation y (3..90, own goal -> their goal) to a top offset on the pitch, and back. */
const yToTop = (y: number) => 5 + (1 - (Math.max(3, Math.min(90, y)) - 3) / 87) * 88;
const topToY = (top: number) => 3 + (1 - (top - 5) / 88) * 87;
const DUTY_ARROW: Record<Duty, string> = { D: '▾', S: '▸', A: '▴' };

function useRater(squad: SquadP[]) {
  const attrs = useMemo(() => new Map(squad.map((p) => [p.id, attrsFromArray(p.attrs)])), [squad]);
  const rate = useCallback((p: SquadP | undefined, s: Pick<TacticSlot, 'pos' | 'role' | 'duty'>): number => {
    if (!p) return 0;
    if (s.pos === 'GK' && (p.fam.GK ?? 0) < 0.5) return 0;
    if (s.pos !== 'GK' && (p.fam.GK ?? 0) >= 0.8) return 0;
    return displayRating(roleRating(attrs.get(p.id) as Attributes, s.role, s.duty, { pos: s.pos, familiarity: p.fam, form: p.formValue, morale: p.moraleValue, sharpness: p.sharpness }));
  }, [attrs]);
  return { rate, attrs };
}

/** Assign the current XI to a new set of slots, scarcest positions first. */
function reassign(slots: TacticSlot[], ids: number[], squad: Map<number, SquadP>, rate: (p: SquadP | undefined, s: TacticSlot) => number): number[] {
  const out = new Array(slots.length).fill(-1);
  const pool = ids.filter((id) => id > 0);
  const order = slots.map((s, i) => ({ i, n: pool.filter((id) => (squad.get(id)?.fam[s.pos] ?? 0) >= 0.8).length })).sort((a, b) => (slots[a.i].pos === 'GK' ? -1 : slots[b.i].pos === 'GK' ? 1 : a.n - b.n));
  for (const { i } of order) {
    let best = -1;
    let bv = -1;
    for (const id of pool) {
      if (out.includes(id)) continue;
      const v = rate(squad.get(id), slots[i]);
      if (v > bv) { bv = v; best = id; }
    }
    if (best > 0) out[i] = best;
  }
  return out;
}

export function TacticEditor() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'shape') as 'shape' | 'analysis' | 'instructions' | 'setpieces' | 'triggers';
  const fixtureId = params.get('fixture');
  const q = useQuery({ queryKey: ['tactic', Number(id)], queryFn: () => api.get<TacticEditorData>(`/tactics/${id}`), staleTime: 0 });
  return (
    <Q q={q} skeleton={<div className="px-4 pt-20"><SkeletonCards n={2} h={300} /></div>}>
      {(d) => <Editor key={d.tactic.id} d={d} tab={tab} setTab={(t) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); }} fixtureId={fixtureId} />}
    </Q>
  );
}

function Editor({ d, tab, setTab, fixtureId }: { d: TacticEditorData; tab: string; setTab: (t: string) => void; fixtureId: string | null }) {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [st, setSt] = useState<State>(() => ({ data: d.tactic.data, lineup: [...d.tactic.lineup, ...new Array(11).fill(-1)].slice(0, 11), bench: d.tactic.bench.slice(0, BENCH_MAX), captainId: d.tactic.captainId }));
  const [meta, setMeta] = useState({ familiarity: d.tactic.familiarity, savedAt: null as string | null, saving: false, dirty: false });
  const [shapeMode, setShapeMode] = useState(false);
  const [sheet, setSheet] = useState<{ from: From; tab: SheetTab } | null>(null);
  const [ring, setRing] = useState<'fit' | 'cond'>('fit');
  const [formationOpen, setFormationOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const [benchPick, setBenchPick] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.tactic.name);
  const squad = useMemo(() => new Map(d.squad.map((p) => [p.id, p])), [d.squad]);
  const { rate, attrs } = useRater(d.squad);
  const colors = me.club?.colors ?? null;

  const save = useMutation({
    mutationFn: (s: State & { name?: string }) => api.put<{ tactic: { familiarity: number; name: string }; warnings: string[]; savedAt: string }>(`/tactics/${d.tactic.id}`, { data: { ...s.data, name: s.name ?? s.data.name }, lineup: s.lineup, bench: s.bench, captainId: s.captainId, name: s.name }),
    onMutate: () => setMeta((m) => ({ ...m, saving: true })),
    onSuccess: (r) => {
      setMeta({ familiarity: r.tactic.familiarity, savedAt: r.savedAt, saving: false, dirty: false });
      qc.invalidateQueries({ queryKey: ['tactics'] });
      qc.invalidateQueries({ queryKey: ['squad'] });
      qc.invalidateQueries({ queryKey: ['preview'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e: Error) => { setMeta((m) => ({ ...m, saving: false })); toast(e instanceof ApiError ? e.message : 'Could not save', 'error'); },
  });
  const deb = useDebouncedCallback((s: State) => save.mutate(s), 900);
  const latest = useRef(st);
  latest.current = st;
  useEffect(() => () => { if (deb.pending()) deb.flush(latest.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (fn: (s: State) => State) => {
    setSt((s) => {
      const n = fn(s);
      const withFormation = { ...n, data: { ...n.data, formation: detectFormation(n.data.slots) as FormationKey } };
      deb.call(withFormation);
      return withFormation;
    });
    setMeta((m) => ({ ...m, dirty: true }));
  };

  // ---- derived
  const selectable = useMemo(() => d.squad.map((p) => ({ id: p.id, attrs: attrs.get(p.id) as Attributes, fam: p.fam, condition: p.condition, sharpness: p.sharpness, form: p.formValue, morale: p.moraleValue, age: p.age, available: p.available })), [d.squad, attrs]);
  const warnings = useMemo(() => lineupWarnings(selectable, st.data, st.lineup, meta.familiarity, st.captainId), [selectable, st, meta.familiarity]);
  const xiRatings = st.lineup.map((pid, i) => rate(squad.get(pid), st.data.slots[i]));
  const filled = xiRatings.filter((r, i) => st.lineup[i] > 0 && r > 0);
  const strength = filled.length ? filled.reduce((s, r) => s + r, 0) / filled.length : 0;
  const xiPlayers = st.lineup.map((pid) => squad.get(pid)).filter((p): p is SquadP => !!p);
  const avgCond = xiPlayers.length ? Math.round(xiPlayers.reduce((s, p) => s + p.condition, 0) / xiPlayers.length) : 0;
  const analysisPlayers = useMemo(() => d.squad.map((p) => ({ id: p.id, short: p.short, attrs: attrs.get(p.id) as Attributes, fam: p.fam, traits: p.traits, condition: p.condition })), [d.squad, attrs]);
  const analysis = useMemo(() => analyseTactic(st.data, st.lineup, analysisPlayers, { familiarity: meta.familiarity }), [st.data, st.lineup, analysisPlayers, meta.familiarity]);
  const shortNames = useMemo(() => new Map(d.squad.map((p) => [p.id, p.name])), [d.squad]);

  // ---- actions
  const swap = (a: From, b: From) => update((s) => {
    const lineup = s.lineup.slice();
    const bench = s.bench.slice();
    const get = (f: From) => (f.kind === 'slot' ? lineup[f.index] : bench[f.index] ?? -1);
    const put = (f: From, v: number) => { if (f.kind === 'slot') lineup[f.index] = v; else if (v > 0) bench[f.index] = v; else bench.splice(f.index, 1); };
    const va = get(a), vb = get(b);
    put(a, vb);
    put(b, va);
    return { ...s, lineup, bench: bench.filter((x) => x > 0) };
  });
  const toBench = (i: number) => update((s) => {
    const pid = s.lineup[i];
    if (pid <= 0 || s.bench.length >= BENCH_MAX) return s;
    const lineup = s.lineup.slice();
    lineup[i] = -1;
    return { ...s, lineup, bench: [...s.bench, pid] };
  });
  const assign = (slot: number, pid: number) => update((s) => {
    const lineup = s.lineup.slice();
    let bench = s.bench.slice();
    const inXI = lineup.indexOf(pid);
    const onBench = bench.indexOf(pid);
    const cur = lineup[slot];
    if (inXI >= 0) { lineup[inXI] = cur; lineup[slot] = pid; }
    else if (onBench >= 0) { if (cur > 0) bench[onBench] = cur; else bench.splice(onBench, 1); lineup[slot] = pid; }
    else lineup[slot] = pid;
    bench = bench.filter((x) => x > 0 && !lineup.includes(x));
    return { ...s, lineup, bench };
  });
  const setSlot = (i: number, patch: Partial<TacticSlot>) => update((s) => ({ ...s, data: { ...s.data, slots: s.data.slots.map((x, j) => (j === i ? { ...x, ...patch } : x)) } }));
  const autofill = useMutation({
    mutationFn: () => api.post<{ lineup: number[]; bench: number[]; captainId: number | null; setPieces: Tactic['setPieces'] }>(`/tactics/${d.tactic.id}/autofill`, { data: st.data }),
    onSuccess: (r) => { haptic('medium'); setSt((s) => ({ ...s, lineup: r.lineup, bench: r.bench, captainId: r.captainId, data: { ...s.data, setPieces: r.setPieces } })); toast('Best XI picked', 'success'); qc.invalidateQueries({ queryKey: ['squad'] }); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const applyFormation = (f: Exclude<FormationKey, 'Custom'>) => update((s) => {
    const slots = FORMATIONS[f].map((x) => ({ ...x }));
    return { ...s, data: { ...s.data, slots, formation: f }, lineup: reassign(slots, s.lineup, squad, rate) };
  });

  // ---- drag and drop
  const pitchRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: From; sx: number; sy: number; active: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; from: From } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const onPointerDown = (e: React.PointerEvent, from: From) => {
    if (e.button !== 0) return;
    const timer = setTimeout(() => {
      if (drag.current && !drag.current.active) { drag.current = null; haptic('light'); if (from.kind === 'slot') setSheet({ from, tab: 'role' }); }
    }, 480);
    drag.current = { from, sx: e.clientX, sy: e.clientY, active: false, timer };
    const move = (ev: PointerEvent) => {
      const dd = drag.current;
      if (!dd) return;
      if (!dd.active && Math.hypot(ev.clientX - dd.sx, ev.clientY - dd.sy) > 8) {
        dd.active = true;
        if (dd.timer) clearTimeout(dd.timer);
        haptic('light');
      }
      if (dd.active) {
        ev.preventDefault();
        setGhost({ x: ev.clientX, y: ev.clientY, from: dd.from });
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop]');
        setHover(el?.getAttribute('data-drop') ?? null);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const dd = drag.current;
      drag.current = null;
      setGhost(null);
      setHover(null);
      if (!dd) return;
      if (dd.timer) clearTimeout(dd.timer);
      if (!dd.active) {
        if (dd.from.kind === 'slot') setSheet({ from: dd.from, tab: 'player' });
        else setSheet({ from: dd.from, tab: 'player' });
        return;
      }
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop]')?.getAttribute('data-drop') ?? null;
      if (shapeMode && dd.from.kind === 'slot' && dd.from.index > 0 && pitchRef.current) {
        const r = pitchRef.current.getBoundingClientRect();
        const x = Math.round(Math.max(6, Math.min(94, ((ev.clientX - r.left) / r.width) * 100)) / 4) * 4;
        const y = Math.round(Math.max(14, Math.min(90, topToY(((ev.clientY - r.top) / r.height) * 100))) / 4) * 4;
        if (ev.clientX < r.left - 10 || ev.clientX > r.right + 10 || ev.clientY < r.top - 10 || ev.clientY > r.bottom + 10) { haptic('error'); return; }
        const pos = posFromXY(x, y) as Pos;
        const cur = st.data.slots[dd.from.index];
        const validRole = rolesForPosition(pos).some((ro) => ro.key === cur.role);
        const dr = defaultRoleForPosition(pos);
        setSlot(dd.from.index, { x, y, pos: pos === 'GK' ? cur.pos : pos, ...(validRole ? {} : { role: dr.role, duty: dr.duty }) });
        haptic('medium');
        return;
      }
      if (!target) { haptic('error'); return; }
      const [kind, idx] = target.split(':');
      if (kind === 'slot') { swap(dd.from, { kind: 'slot', index: Number(idx) }); haptic('medium'); }
      else if (kind === 'bench') { swap(dd.from, { kind: 'bench', index: Number(idx) }); haptic('medium'); }
      else if (kind === 'bench-add' && dd.from.kind === 'slot') { toBench(dd.from.index); haptic('medium'); }
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (drag.current?.timer) clearTimeout(drag.current.timer);
      drag.current = null;
      setGhost(null);
      setHover(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const editorPlayers = (ids: number[]): EditorPlayer[] => ids.map((pid) => squad.get(pid)).filter((p): p is SquadP => !!p).map((p) => ({ id: p.id, name: p.name, short: p.short, number: p.number, attrsDisplay: Object.fromEntries(Object.entries(attrs.get(p.id) as Attributes).map(([k, v]) => [k, displayAttr(v)])) }));
  const savedLabel = meta.saving ? 'Saving…' : meta.dirty ? 'Unsaved changes' : meta.savedAt ? `Saved ${timeLabel(meta.savedAt)}` : `Familiarity ${Math.round(meta.familiarity * 100)}%`;
  const ghostPlayer = ghost ? squad.get(ghost.from.kind === 'slot' ? st.lineup[ghost.from.index] : st.bench[ghost.from.index]) : undefined;

  return (
    <Screen noPad title={<button type="button" onClick={() => setRenaming(true)} className="truncate max-w-full text-left">{st.data.name}</button>} subtitle={savedLabel} back={fixtureId ? `/fixture/${fixtureId}/preview` : '/tactics'}
      actions={fixtureId ? <Link to={`/fixture/${fixtureId}/preview`}><Button size="sm" variant="secondary" icon={<ArrowLeft size={14} />}>Match</Button></Link> : undefined}
      header={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'shape', label: 'Shape' }, { value: 'analysis', label: 'Analysis', count: analysis.notes.filter((n) => n.tone !== 'good').length }, { value: 'instructions', label: 'Instructions' }, { value: 'setpieces', label: 'Set pieces' }, { value: 'triggers', label: 'Triggers', count: st.data.triggers.length }]} />}>
      {tab === 'shape' && (
        <div className="px-4 pt-3 pb-[76px]">
          <div className="flex items-center gap-2 mb-2">
            <button type="button" onClick={() => setFormationOpen(true)} className="h-9 px-3 rounded-lg bg-surface border border-subtle t-strong flex items-center gap-1.5">{st.data.formation}<ChevronDown size={16} className="text-fg3" /></button>
            <Button size="sm" variant={shapeMode ? 'primary' : 'secondary'} icon={<Move size={14} />} onClick={() => setShapeMode(!shapeMode)}>{shapeMode ? 'Done' : 'Edit shape'}</Button>
            {st.data.formation === 'Custom' || shapeMode ? null : <span className="t-label text-fg3 ml-auto">Familiarity {Math.round(meta.familiarity * 100)}%</span>}
            {shapeMode && st.data.formation !== 'Custom' && <IconButton label="Reset to template" onClick={() => applyFormation(st.data.formation as Exclude<FormationKey, 'Custom'>)}><RotateCcw size={18} /></IconButton>}
          </div>
          {shapeMode && <div className="t-label text-fg2 mb-2">Drag a player to move his position. The shape snaps to the grid and the formation name updates as you go.</div>}
          {/* pitch */}
          <div ref={pitchRef} className="relative w-full rounded-xl overflow-hidden select-none mx-auto" style={{ aspectRatio: '100 / 138', background: 'linear-gradient(180deg, #16271e 0%, #112019 100%)' }}>
            <svg viewBox="0 0 100 140" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden><PitchLines /></svg>
            {shapeMode && <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '12.5% 10%' }} />}
            {st.data.slots.map((s, i) => {
              const p = squad.get(st.lineup[i]);
              const r = xiRatings[i];
              const dropKey = `slot:${i}`;
              const dragging = ghost?.from.kind === 'slot' && ghost.from.index === i;
              const fit = analysis.slots[i]?.fit ?? 'ok';
              const ringColor = ring === 'fit' ? FIT[fit].color : toneVar(conditionTone(p?.condition ?? 100));
              return (
                <div key={i} data-drop={dropKey} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${Math.max(9, Math.min(91, s.x))}%`, top: `${yToTop(s.y)}%`, zIndex: 2 }}>
                  <button type="button" aria-label={p ? `${p.name}, ${s.pos}, rating ${r.toFixed(1)}` : `Empty ${s.pos} slot`}
                    onPointerDown={(e) => onPointerDown(e, { kind: 'slot', index: i })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet({ from: { kind: 'slot', index: i }, tab: 'player' }); } }}
                    className={cx('relative rounded-full flex items-center justify-center font-cond font-bold touch-none transition-transform', dragging && 'opacity-40', hover === dropKey && !dragging && 'scale-110')}
                    style={{
                      width: 42, height: 42, fontSize: 18,
                      background: p ? colors?.[0] ?? '#2A333D' : 'rgba(255,255,255,0.04)',
                      color: p ? (colors ? undefined : '#fff') : 'rgba(255,255,255,0.5)',
                      border: p ? 'none' : '2px dashed rgba(255,255,255,0.35)',
                      boxShadow: p ? `0 0 0 3px ${ringColor}${hover === dropKey ? ', 0 0 0 7px color-mix(in srgb, var(--accent) 40%, transparent)' : ''}` : hover === dropKey ? '0 0 0 4px color-mix(in srgb, var(--accent) 40%, transparent)' : undefined,
                    }}>
                    {p ? <span style={{ color: onDark(colors?.[0]) }}>{p.number ?? '·'}</span> : <Plus size={18} />}
                    <span className="absolute -bottom-1 -right-1 h-4 min-w-4 px-0.5 rounded bg-black/70 text-[10px] leading-4 text-white font-sans font-bold">{DUTY_ARROW[s.duty]}</span>
                    {p && st.captainId === p.id && <span className="absolute -top-1 -left-1 h-4 w-4 rounded-full bg-warning text-[#0B0E11] text-[9px] font-bold flex items-center justify-center font-sans">C</span>}
                    {p && !p.available && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-negative text-white flex items-center justify-center"><X size={10} strokeWidth={4} /></span>}
                  </button>
                  <span className="mt-0.5 max-w-[84px] truncate px-1 rounded bg-black/55 text-[10px] font-semibold text-white leading-[14px]">
                    {p ? p.short.slice(0, 9) : s.pos}
                    {p && <span className="ml-1 font-bold tabular" style={{ color: ring === 'fit' ? FIT[fit].color : r >= 14 ? 'var(--positive)' : r >= 11 ? '#cfd6dc' : 'var(--warning)' }}>{r.toFixed(1)}</span>}
                  </span>
                  <span className="text-[9px] leading-3 font-semibold text-white/60">{s.role}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Segmented size="sm" className="shrink-0" value={ring} onChange={setRing} options={[{ value: 'fit', label: 'Role fit' }, { value: 'cond', label: 'Fitness' }]} />
            {ring === 'fit' ? <FitLegend /> : <span className="t-label text-fg3">Ring colour shows match fitness.</span>}
          </div>
          {/* bench */}
          <div className="flex items-center justify-between mt-3 mb-1.5">
            <span className="t-caption text-fg3">Bench · {st.bench.length}/{BENCH_MAX}</span>
            <Button size="sm" variant="secondary" icon={<Wand2 size={14} />} loading={autofill.isPending} onClick={() => autofill.mutate()}>Auto-fill</Button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1" data-drop="bench-add">
            {st.bench.map((pid, i) => {
              const p = squad.get(pid);
              if (!p) return null;
              const key = `bench:${i}`;
              return (
                <div key={pid} data-drop={key} className="shrink-0 flex flex-col items-center w-[58px]">
                  <button type="button" aria-label={`${p.name}, substitute`} onPointerDown={(e) => onPointerDown(e, { kind: 'bench', index: i })}
                    className={cx('relative rounded-full flex items-center justify-center font-cond font-bold touch-none', hover === key && 'scale-110')}
                    style={{ width: 40, height: 40, fontSize: 16, background: colors?.[0] ?? '#2A333D', color: onDark(colors?.[0]), boxShadow: `0 0 0 2.5px ${toneVar(conditionTone(p.condition))}` }}>
                    {p.number ?? '·'}
                    {!p.available && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-negative text-white flex items-center justify-center"><X size={10} strokeWidth={4} /></span>}
                  </button>
                  <span className="t-label text-[11px] mt-0.5 truncate w-full text-center">{p.short}</span>
                  <PosBadge pos={p.best} className="mt-0.5" />
                </div>
              );
            })}
            {st.bench.length < BENCH_MAX && (
              <button type="button" onClick={() => setBenchPick(true)} data-drop="bench-add" className={cx('shrink-0 h-10 w-10 rounded-full border-2 border-dashed flex items-center justify-center text-fg3', hover === 'bench-add' ? 'border-accent text-accent' : 'border-subtle')} aria-label="Add a substitute"><Plus size={18} /></button>
            )}
          </div>
          <div className="t-label text-fg3 mt-2">Tap a player to change him, hold for his role, or drag to swap. Drop onto the bench strip to take him out.</div>
        </div>
      )}
      {tab === 'analysis' && <div className="px-4 pt-4"><AnalysisTab a={analysis} ratings={xiRatings} names={shortNames} onSlot={(i) => { setTab('shape'); setSheet({ from: { kind: 'slot', index: i }, tab: 'role' }); }} onRole={(i, role, duty) => setSlot(i, { role, duty })} /></div>}
      {tab === 'instructions' && <div className="px-4 pt-4"><InstructionsTab t={st.data} onChange={(t) => update((s) => ({ ...s, data: t }))} /></div>}
      {tab === 'setpieces' && <div className="px-4 pt-4"><SetPiecesTab t={st.data} players={editorPlayers(st.lineup)} onChange={(t) => update((s) => ({ ...s, data: t }))} /></div>}
      {tab === 'triggers' && <div className="px-4 pt-4"><TriggersTab t={st.data} xi={editorPlayers(st.lineup)} bench={editorPlayers(st.bench)} onChange={(t) => update((s) => ({ ...s, data: t }))} /></div>}

      {/* summary bar */}
      {tab === 'shape' && (
        <button type="button" onClick={() => setWarnOpen(true)} className="fixed left-0 right-0 z-30 mx-auto max-w-[480px] h-[52px] px-4 flex items-center gap-4 bg-raised border-t border-subtle" style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom))' }}>
          <span className="flex items-baseline gap-1.5"><span className="t-caption text-fg3">XI</span><span className="font-cond font-bold text-[22px] tabular">{strength.toFixed(1)}</span></span>
          <span className="flex items-baseline gap-1.5"><span className="t-caption text-fg3">Cond</span><span className="t-num" style={{ color: toneVar(conditionTone(avgCond)) }}>{avgCond}%</span></span>
          <span className="ml-auto flex items-center gap-1.5 t-label">{warnings.length ? <><AlertTriangle size={16} className="text-warning" /> {warnings.length} warning{warnings.length > 1 ? 's' : ''}</> : <><Check size={16} className="text-positive" /> Ready</>}<ChevronUp size={16} className="text-fg3" /></span>
        </button>
      )}
      {ghost && ghostPlayer && (
        <div className="fixed z-[70] pointer-events-none -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center font-cond font-bold shadow-2xl"
          style={{ left: ghost.x, top: ghost.y, width: 50, height: 50, fontSize: 19, background: colors?.[0] ?? '#2A333D', color: onDark(colors?.[0]), transform: 'translate(-50%,-50%) scale(1.15)', boxShadow: '0 12px 30px rgba(0,0,0,0.5), 0 0 0 3px var(--accent)' }}>
          {ghostPlayer.number ?? ghostPlayer.short.slice(0, 2)}
        </div>
      )}

      <SlotSheet key={sheet ? `${sheet.from.kind}${sheet.from.index}` : 'none'} open={!!sheet} tab={sheet?.tab ?? 'player'} from={sheet?.from ?? null} onClose={() => setSheet(null)} st={st} squad={d.squad} rate={rate}
        onAssign={(slot, pid) => { assign(slot, pid); setSheet(null); haptic('medium'); }}
        onRole={(slot, role, duty) => setSlot(slot, { role, duty })}
        onInstr={(slot, pi) => setSlot(slot, { pi })}
        analysis={sheet?.from.kind === 'slot' ? analysis.slots[sheet.from.index] : undefined}
        onCaptain={(pid) => update((s) => ({ ...s, captainId: pid }))}
        onRemove={(slot) => { toBench(slot); setSheet(null); }}
        onBenchSwap={(b, slot) => { swap({ kind: 'bench', index: b }, { kind: 'slot', index: slot }); setSheet(null); }}
        onBenchRemove={(b) => { update((s) => ({ ...s, bench: s.bench.filter((_, i) => i !== b) })); setSheet(null); }}
        colors={colors} />
      <Sheet open={benchPick} onClose={() => setBenchPick(false)} full title="Add a substitute">
        <List>
          {d.squad.filter((p) => !st.lineup.includes(p.id) && !st.bench.includes(p.id)).sort((a, b) => b.ovr - a.ovr).map((p) => (
            <button key={p.id} type="button" onClick={() => { update((s) => ({ ...s, bench: [...s.bench, p.id].slice(0, BENCH_MAX) })); setBenchPick(false); }} className="w-full flex items-center gap-3 px-4 min-h-14 py-2 text-left active:bg-raised">
              <PlayerAvatar name={p.name} colors={colors} size={34} injured={!!p.injury} suspended={p.suspended > 0} />
              <div className="flex-1 min-w-0"><div className="t-body truncate">{p.name}</div><div className="flex gap-1 mt-0.5">{p.pos.map((x) => <PosBadge key={x} pos={x} />)}</div></div>
              <span className="t-label tabular" style={{ color: toneVar(conditionTone(p.condition)) }}>{p.condition}%</span>
              <span className="font-cond font-bold text-[18px] w-10 text-right">{p.ovr.toFixed(1)}</span>
            </button>
          ))}
        </List>
      </Sheet>
      <Sheet open={formationOpen} onClose={() => setFormationOpen(false)} title="Formation">
        <div className="t-label text-fg2 mb-3">Changing shape keeps your players and re-fits them to the new positions. A new shape starts less familiar.</div>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {FORMATION_KEYS.map((f) => (
            <button key={f} type="button" onClick={() => { applyFormation(f); setFormationOpen(false); }} className={cx('rounded-xl border p-2 flex flex-col items-center gap-1.5 active:brightness-110', st.data.formation === f ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg-raised))]' : 'border-subtle bg-raised')}>
              <ShapeGlyph slots={FORMATIONS[f]} size={60} />
              <span className="t-strong">{f}</span>
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={warnOpen} onClose={() => setWarnOpen(false)} title="Selection check">
        {warnings.length === 0 ? <div className="t-body text-fg2 pb-4">No problems. This XI is good to go.</div> : (
          <List>{warnings.map((w) => <div key={w} className="flex items-center gap-3 px-4 min-h-12 py-2"><AlertTriangle size={16} className="text-warning shrink-0" /><span className="t-body">{w}</span></div>)}</List>
        )}
        <div className="grid grid-cols-2 gap-3 mt-4 pb-2">
          <div className="rounded-xl bg-raised p-3"><div className="t-caption text-fg3">XI strength</div><div className="font-cond text-[26px] font-bold">{strength.toFixed(1)}</div></div>
          <div className="rounded-xl bg-raised p-3"><div className="t-caption text-fg3">Familiarity</div><div className="font-cond text-[26px] font-bold">{Math.round(meta.familiarity * 100)}%</div></div>
        </div>
      </Sheet>
      <Sheet open={renaming} onClose={() => setRenaming(false)} title="Rename tactic" footer={<Button full onClick={() => { const n = name.trim().slice(0, 30); if (n) { update((s) => ({ ...s, data: { ...s.data, name: n } })); } setRenaming(false); }}>Save</Button>}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoFocus />
      </Sheet>
    </Screen>
  );
}

function onDark(bg?: string | null): string {
  if (!bg) return '#fff';
  const h = bg.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0B0E11' : '#FFFFFF';
}

// ---------------------------------------------------------------- slot sheet: player picker + role picker
function SlotSheet(props: {
  open: boolean; tab: SheetTab; from: From | null; onClose: () => void; st: State; squad: SquadP[]; colors: [string, string] | null;
  analysis?: SlotAnalysis; onInstr: (slot: number, pi: TacticSlot['pi']) => void;
  rate: (p: SquadP | undefined, s: Pick<TacticSlot, 'pos' | 'role' | 'duty'>) => number;
  onAssign: (slot: number, pid: number) => void; onRole: (slot: number, role: TacticSlot['role'], duty: Duty) => void; onCaptain: (pid: number) => void;
  onRemove: (slot: number) => void; onBenchSwap: (bench: number, slot: number) => void; onBenchRemove: (bench: number) => void;
}) {
  const { from, st, squad, rate } = props;
  const [tab, setTab] = useState<SheetTab>(props.tab);
  const [term, setTerm] = useState('');
  const [line, setLine] = useState<string>('fit');
  if (!props.open || !from) return null;
  const byId = new Map(squad.map((p) => [p.id, p]));
  if (from.kind === 'bench') {
    const p = byId.get(st.bench[from.index]);
    return (
      <Sheet open onClose={props.onClose} title={p ? `${p.name} (sub)` : 'Substitute'}>
        <div className="t-caption text-fg3 mb-2">Swap into the XI</div>
        <List>
          {st.data.slots.map((s, i) => {
            const cur = byId.get(st.lineup[i]);
            const mine = rate(p, s);
            const theirs = rate(cur, s);
            return (
              <button key={i} type="button" onClick={() => props.onBenchSwap(from.index, i)} className="w-full flex items-center gap-3 px-4 h-12 text-left active:bg-raised">
                <PosBadge pos={s.pos} /><span className="flex-1 t-body truncate">{cur?.name ?? 'Empty'}</span>
                <span className="t-num">{mine.toFixed(1)}</span>
                {cur && <span className={cx('t-label w-10 text-right tabular', mine - theirs >= 0 ? 'text-positive' : 'text-negative')}>{mine - theirs >= 0 ? '+' : ''}{(mine - theirs).toFixed(1)}</span>}
              </button>
            );
          })}
        </List>
        <Button className="mt-4" variant="secondary" full onClick={() => props.onBenchRemove(from.index)}>Remove from bench</Button>
      </Sheet>
    );
  }
  const slotIdx = from.index;
  const slot = st.data.slots[slotIdx];
  const current = byId.get(st.lineup[slotIdx]);
  const curRating = rate(current, slot);
  const list = squad
    .filter((p) => !term || p.name.toLowerCase().includes(term.toLowerCase()))
    .filter((p) => line === 'all' || (line === 'fit' ? (p.fam[slot.pos] ?? 0) >= 0.6 || p.id === current?.id : (LINE_OF[p.best] ?? 'MID') === line))
    .map((p) => ({ p, r: rate(p, slot) }))
    .filter((x) => x.r > 0 || slot.pos !== 'GK')
    .sort((a, b) => b.r - a.r);
  const roles = rolesForPosition(slot.pos);
  return (
    <Sheet open onClose={props.onClose} full title={<span className="flex items-center gap-2"><PosBadge pos={slot.pos} /> {ROLES[slot.role].name}</span>}>
      <Segmented className="mb-3" value={tab} onChange={setTab} options={[{ value: 'player', label: 'Player' }, { value: 'role', label: 'Role' }, { value: 'instr', label: `Instructions${slot.pi ? ` (${Object.keys(slot.pi).length})` : ''}` }]} />
      {current && props.analysis && props.analysis.playerId === current.id && (
        <div className="flex items-center gap-2 mb-3 rounded-lg bg-raised px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: FIT[props.analysis.fit].color }} />
          <span className="t-label flex-1 min-w-0 truncate"><span className="text-fg">{current.short}</span><span className="text-fg2"> is {FIT[props.analysis.fit].phrase}, {props.analysis.famLabel.toLowerCase()} at {slot.pos}</span></span>
          <span className="t-num">{curRating.toFixed(1)}</span>
        </div>
      )}
      {tab === 'instr' ? (
        <PlayerInstructionsPanel pi={slot.pi} gk={slot.pos === 'GK'} slot={props.analysis} onChange={(pi) => props.onInstr(slotIdx, pi)} />
      ) : tab === 'player' ? (
        <>
          <div className="relative mb-2"><Search size={16} className="absolute left-3 top-3 text-fg3" /><input className={cx(inputCls, '!h-10 pl-9')} placeholder="Search your squad" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
          <ChipRow className="mb-2">
            {[['fit', 'Suited'], ['all', 'All'], ['GK', 'GK'], ['DEF', 'DEF'], ['MID', 'MID'], ['ATT', 'ATT']].map(([k, l]) => <Chip key={k} selected={line === k} onClick={() => setLine(k)}>{l}</Chip>)}
          </ChipRow>
          {current && (
            <div className="flex gap-2 mb-3">
              <Button size="sm" variant="secondary" icon={<Crown size={14} />} disabled={props.st.captainId === current.id} onClick={() => props.onCaptain(current.id)}>{props.st.captainId === current.id ? 'Captain' : 'Make captain'}</Button>
              <Button size="sm" variant="ghost" onClick={() => props.onRemove(slotIdx)}>Move to bench</Button>
            </div>
          )}
          <List>
            {list.map(({ p, r }) => {
              const delta = current ? r - curRating : null;
              const inXI = st.lineup.indexOf(p.id);
              const onBench = st.bench.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => props.onAssign(slotIdx, p.id)} className={cx('w-full flex items-center gap-3 px-4 min-h-[64px] py-2 text-left active:bg-raised', p.id === current?.id && 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]')}>
                  <PlayerAvatar name={p.name} colors={props.colors} size={36} injured={!!p.injury} suspended={p.suspended > 0} />
                  <div className="flex-1 min-w-0">
                    <div className="t-body truncate font-semibold">{p.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap overflow-hidden">
                      {p.pos.slice(0, inXI >= 0 || onBench ? 1 : 2).map((x) => <PosBadge key={x} pos={x} />)}
                      {inXI >= 0 && <Badge tone="info">{st.data.slots[inXI].pos}</Badge>}
                      {onBench && <Badge>Bench</Badge>}
                      {p.rested && <Badge tone="info">Rest</Badge>}
                      <span className="text-[11px] tabular" style={{ color: toneVar(conditionTone(p.condition)) }}>{p.condition}%</span>
                      <span className="text-[11px] text-fg3 tabular" title="Match sharpness">Sh {p.sharpness}</span>
                    </div>
                  </div>
                  <div className="hidden min-[420px]:block"><Sparkline values={p.form} /></div>
                  <div className="text-right w-12">
                    <div className="font-cond font-bold text-[20px] leading-none tabular">{r.toFixed(1)}</div>
                    {delta !== null && p.id !== current?.id && <div className={cx('text-[11px] font-bold tabular', delta >= 0 ? 'text-positive' : 'text-negative')}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}</div>}
                  </div>
                </button>
              );
            })}
          </List>
        </>
      ) : (
        <>
          <List className="mb-4">
            {roles.map((ro) => {
              const duty = ro.duties.includes(slot.duty) ? slot.duty : ro.defaultDuty;
              const fit = rate(current, { pos: slot.pos, role: ro.key, duty });
              const sel = ro.key === slot.role;
              return (
                <button key={ro.key} type="button" onClick={() => props.onRole(slotIdx, ro.key, duty)} className={cx('w-full text-left px-4 py-3 active:bg-raised', sel && 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]')}>
                  <div className="flex items-center gap-2"><span className={cx('t-strong flex-1', sel && 'text-accent')}>{ro.name}</span>{current && <span className="t-num">{fit.toFixed(1)}</span>}</div>
                  <div className="t-label text-fg2 mt-0.5">{ro.desc}</div>
                  {current && <div className="h-1 rounded-full bg-input mt-2 overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (fit / 20) * 100)}%` }} /></div>}
                </button>
              );
            })}
          </List>
          <Link to="/guide?tab=tactics" className="t-label text-accent inline-block mb-3">Roles and duties explained</Link>
          <div className="t-caption text-fg3 mb-2">Duty</div>
          <Segmented value={slot.duty} onChange={(v) => props.onRole(slotIdx, slot.role, v as Duty)}
            options={ROLES[slot.role].duties.map((dt) => ({ value: dt, label: dt === 'D' ? 'Defend' : dt === 'S' ? 'Support' : 'Attack' }))} />
          {current && props.analysis?.keyAttrs.length ? (
            <div className="mt-4">
              <div className="t-caption text-fg3 mb-1">{ROLES[slot.role].name} relies most on</div>
              <div className="flex flex-wrap gap-1.5">{props.analysis.keyAttrs.map((k) => <Badge key={k.key} tone={k.value >= 15 ? 'positive' : k.value >= 11 ? 'info' : 'warning'}>{k.label} {k.value}</Badge>)}</div>
              {props.analysis.better && <button type="button" className="t-label text-accent mt-2" onClick={() => props.onRole(slotIdx, props.analysis!.better!.role, props.analysis!.better!.duty)}>He would do better as {ROLES[props.analysis.better.role].name}: {(props.analysis.better.rating / 10).toFixed(1)}</button>}
            </div>
          ) : null}
          <div className="h-4" />
        </>
      )}
    </Sheet>
  );
}

void normaliseTactic; void useNavigate;
