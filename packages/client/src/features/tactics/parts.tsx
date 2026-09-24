// Tactic editor tabs: instructions, set pieces and triggers.
import { useState, type ReactNode } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import {
  INSTRUCTION_GROUPS, INSTRUCTION_LABELS, INSTRUCTION_OPTIONS, MENTALITY_LABELS, OPTION_LABELS, PRESETS, countNonDefault, DEFAULT_INSTRUCTIONS,
  type Instructions, type SetPieces, type Tactic, type Trigger, type TriggerAction, type TriggerCondition,
} from '@ffm/engine';
import { Badge, Card, Chip, ChipRow, Segmented, Stepper, Toggle, cx } from '../../components/ui';

export interface EditorPlayer { id: number; name: string; short: string; number: number | null; attrsDisplay: Record<string, number> }

// ---------------------------------------------------------------- instructions
function optionLabel(v: unknown): string {
  return OPTION_LABELS[String(v)] ?? String(v);
}

export function InstructionsTab({ t, onChange }: { t: Tactic; onChange: (t: Tactic) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ possession: true, defence: true, transition: true });
  const set = <K extends keyof Instructions>(k: K, v: Instructions[K]) => onChange({ ...t, instructions: { ...t.instructions, [k]: v } });
  return (
    <div className="pb-4">
      <div className="t-caption text-fg3 mb-2">Presets</div>
      <ChipRow className="mb-5">
        {Object.entries(PRESETS).map(([k, p]) => (
          <Chip key={k} onClick={() => onChange({ ...t, mentality: p.mentality, instructions: { ...t.instructions, ...p.instructions } })}>{p.label}</Chip>
        ))}
        <Chip onClick={() => onChange({ ...t, mentality: 0, instructions: { ...DEFAULT_INSTRUCTIONS } })}>Reset</Chip>
      </ChipRow>
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-2"><span className="t-strong">Mentality</span><span className="t-label text-accent">{MENTALITY_LABELS[String(t.mentality)]}</span></div>
        <input type="range" min={-2} max={2} step={1} value={t.mentality} onChange={(e) => onChange({ ...t, mentality: Number(e.target.value) })} className="w-full" aria-label="Mentality" />
        <div className="flex justify-between t-label text-fg3"><span>Very defensive</span><span>Very attacking</span></div>
      </Card>
      {INSTRUCTION_GROUPS.map((g) => {
        const n = countNonDefault(t.instructions, g.items);
        return (
          <div key={g.key} className="mb-3 rounded-[12px] border border-subtle bg-surface overflow-hidden">
            <button type="button" onClick={() => setOpen({ ...open, [g.key]: !open[g.key] })} className="w-full h-12 px-4 flex items-center gap-2">
              <span className="t-strong flex-1 text-left">{g.label}</span>
              {n > 0 && <Badge tone="accent">{n} changed</Badge>}
              <ChevronDown size={18} className={cx('text-fg3 transition-transform', open[g.key] && 'rotate-180')} />
            </button>
            {open[g.key] && (
              <div className="divide-y divide-subtle border-t border-subtle">
                {g.items.map((k) => {
                  const opts = INSTRUCTION_OPTIONS[k] as readonly unknown[];
                  const val = t.instructions[k];
                  const changed = val !== DEFAULT_INSTRUCTIONS[k];
                  if (typeof val === 'boolean') {
                    return (
                      <label key={k} className="flex items-center justify-between px-4 min-h-14 gap-3">
                        <span className={cx('t-body', changed && 'text-accent')}>{INSTRUCTION_LABELS[k]}</span>
                        <Toggle checked={val} onChange={(v) => set(k, v as never)} label={INSTRUCTION_LABELS[k]} />
                      </label>
                    );
                  }
                  return (
                    <div key={k} className="px-4 py-2.5">
                      <div className={cx('t-label mb-1.5', changed ? 'text-accent' : 'text-fg2')}>{INSTRUCTION_LABELS[k]}</div>
                      <Segmented size="sm" value={String(val)} onChange={(v) => set(k, v as never)} options={opts.map((o) => ({ value: String(o), label: optionLabel(o) }))} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="t-label text-fg3 px-1">Every change costs a little familiarity. Tactics grow familiar with matches and tactical training.</div>
    </div>
  );
}

// ---------------------------------------------------------------- set pieces
function TakerSelect({ label, attr, value, players, onChange }: { label: string; attr: (p: EditorPlayer) => number; value: number | null | undefined; players: EditorPlayer[]; onChange: (id: number | null) => void }) {
  const sorted = players.slice().sort((a, b) => attr(b) - attr(a));
  return (
    <div className="flex items-center gap-3 px-4 min-h-14 py-2">
      <span className="t-body flex-1">{label}</span>
      <select aria-label={label} className="h-9 max-w-[190px] rounded-lg bg-input border border-subtle px-2 t-label" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Auto (best available)</option>
        {sorted.map((p) => <option key={p.id} value={p.id}>{p.short} · {attr(p).toFixed(1)}</option>)}
      </select>
    </div>
  );
}

export function SetPiecesTab({ t, players, onChange }: { t: Tactic; players: EditorPlayer[]; onChange: (t: Tactic) => void }) {
  const sp = t.setPieces;
  const set = (patch: Partial<SetPieces>) => onChange({ ...t, setPieces: { ...sp, ...patch } });
  const a = (k: string) => (p: EditorPlayer) => p.attrsDisplay[k] ?? 0;
  const mix = (...ks: string[]) => (p: EditorPlayer) => ks.reduce((s, k) => s + (p.attrsDisplay[k] ?? 0), 0) / ks.length;
  const target = { near: [62, 16], far: [38, 16], short: [88, 4], edge: [50, 34] }[sp.cornerDelivery] ?? [38, 16];
  return (
    <div className="pb-4">
      <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle mb-4">
        <TakerSelect label="Corners" attr={mix('setPieces', 'crossing')} value={sp.cornerTaker} players={players} onChange={(id) => set({ cornerTaker: id })} />
        <TakerSelect label="Free kicks" attr={mix('setPieces', 'longShots')} value={sp.freeKickTaker} players={players} onChange={(id) => set({ freeKickTaker: id })} />
        <TakerSelect label="Penalties" attr={mix('finishing', 'composure')} value={sp.penaltyTaker} players={players} onChange={(id) => set({ penaltyTaker: id })} />
      </div>
      <Card className="mb-4">
        <div className="t-strong mb-2">Corner routine</div>
        <Segmented size="sm" value={sp.cornerDelivery} onChange={(v) => set({ cornerDelivery: v })} options={[{ value: 'near', label: 'Near post' }, { value: 'far', label: 'Far post' }, { value: 'short', label: 'Short' }, { value: 'edge', label: 'Edge' }]} />
        <div className="flex gap-4 mt-4 items-center">
          <svg viewBox="0 0 100 60" className="w-[46%] rounded-lg shrink-0" style={{ background: '#12201a' }} aria-label="Corner routine diagram">
            <g fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={0.8}><rect x={1} y={1} width={98} height={58} /><rect x={22} y={1} width={56} height={24} /><rect x={38} y={1} width={24} height={9} /><path d="M 40 25 A 10 10 0 0 0 60 25" /></g>
            <circle cx={98} cy={2} r={2.5} fill="var(--warning)" />
            <path d={`M 98 2 Q ${(98 + target[0]) / 2} ${sp.cornerDelivery === 'short' ? 2 : 30} ${target[0]} ${target[1]}`} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 2" />
            {Array.from({ length: sp.inBox }).map((_, i) => <circle key={i} cx={30 + (i * 40) / Math.max(1, sp.inBox - 1)} cy={12 + ((i * 7) % 11)} r={2.4} fill="var(--accent)" />)}
            {Array.from({ length: sp.stayBack }).map((_, i) => <circle key={`b${i}`} cx={35 + i * 12} cy={54} r={2.4} fill="var(--text-secondary)" />)}
            <circle cx={target[0]} cy={target[1]} r={4} fill="none" stroke="var(--accent)" strokeWidth={1} />
          </svg>
          <div className="flex-1 space-y-3">
            <div><div className="t-label text-fg2 mb-1">Players in the box</div><Stepper value={sp.inBox} min={3} max={7} onChange={(v) => set({ inBox: v })} label="Players in the box" /></div>
            <div><div className="t-label text-fg2 mb-1">Staying back</div><Stepper value={sp.stayBack} min={1} max={4} onChange={(v) => set({ stayBack: v })} label="Players staying back" /></div>
          </div>
        </div>
        <div className="t-label text-fg3 mt-3">More bodies in the box means more headers, but a counter-attack hurts more.</div>
      </Card>
      <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle">
        <label className="flex items-center justify-between px-4 min-h-14"><span className="t-body">Long throws</span><Toggle checked={sp.longThrows} onChange={(v) => set({ longThrows: v })} /></label>
        {sp.longThrows && <TakerSelect label="Long throw taker" attr={a('strength')} value={sp.longThrowTaker} players={players} onChange={(id) => set({ longThrowTaker: id })} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- triggers
const inlineSel = 'inline-block align-baseline h-8 rounded-lg bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent font-semibold px-2 mx-0.5 my-0.5 border-0 outline-none';

function Sel<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select aria-label={label} className={inlineSel} value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }}>
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

const MINUTES = Array.from({ length: 16 }, (_, i) => 10 + i * 5).map((m) => ({ value: m, label: `${m}'` }));
type WhenKind = 'losing' | 'drawing' | 'winning' | 'condition' | 'yellow' | 'red' | 'opp_change';

function whenKind(w: TriggerCondition): WhenKind {
  return w.kind === 'score' ? w.state : w.kind;
}

function makeWhen(k: WhenKind, minute: number, prev?: TriggerCondition): TriggerCondition {
  if (k === 'losing' || k === 'drawing' || k === 'winning') return { kind: 'score', state: k, by: k === 'drawing' ? 0 : prev && prev.kind === 'score' && prev.by > 0 ? prev.by : 1, minute };
  if (k === 'condition') return { kind: 'condition', below: 60, minute };
  return { kind: k, minute };
}

function ActionEditor({ a, onChange, onRemove, xi, bench }: { a: TriggerAction; onChange: (a: TriggerAction) => void; onRemove?: () => void; xi: EditorPlayer[]; bench: EditorPlayer[] }) {
  const type = a.type;
  let body: ReactNode = null;
  if (a.type === 'sub') {
    body = (
      <>
        bring on <Sel label="Player coming on" value={String(a.in)} onChange={(v) => onChange({ ...a, in: isNaN(Number(v)) ? (v as 'best_available') : Number(v) })}
          options={[{ value: 'best_available', label: 'the best sub' }, { value: 'most_attacking', label: 'the most attacking sub' }, { value: 'most_defensive', label: 'the most defensive sub' }, ...bench.map((p) => ({ value: String(p.id), label: p.short }))]} />
        for <Sel label="Player going off" value={String(a.out)} onChange={(v) => onChange({ ...a, out: isNaN(Number(v)) ? (v as 'lowest_rated') : Number(v) })}
          options={[{ value: 'lowest_rated', label: 'the lowest-rated' }, { value: 'most_tired', label: 'the most tired' }, { value: 'on_yellow', label: 'a man on a yellow' }, ...xi.map((p) => ({ value: String(p.id), label: p.short }))]} />
        {typeof a.out !== 'number' && <Sel label="Line" value={a.outLine ?? 'ANY'} onChange={(v) => onChange({ ...a, outLine: v })} options={[{ value: 'ANY', label: 'player' }, { value: 'DEF', label: 'defender' }, { value: 'MID', label: 'midfielder' }, { value: 'ATT', label: 'forward' }]} />}
      </>
    );
  } else if (a.type === 'mentality') {
    body = <>change mentality by <Sel label="Mentality change" value={a.delta} onChange={(v) => onChange({ ...a, delta: v })} options={[{ value: 2, label: '+2' }, { value: 1, label: '+1' }, { value: -1, label: '-1' }, { value: -2, label: '-2' }]} /></>;
  } else if (a.type === 'instruction') {
    const opts = INSTRUCTION_OPTIONS[a.key] as readonly unknown[];
    body = (
      <>
        set <Sel label="Instruction" value={a.key} onChange={(k) => onChange({ type: 'instruction', key: k, value: (INSTRUCTION_OPTIONS[k] as readonly (string | boolean)[])[1] ?? (INSTRUCTION_OPTIONS[k] as readonly (string | boolean)[])[0] })} options={(Object.keys(INSTRUCTION_OPTIONS) as (keyof Instructions)[]).map((k) => ({ value: k, label: INSTRUCTION_LABELS[k].toLowerCase() }))} />
        to <Sel label="Value" value={String(a.value)} onChange={(v) => onChange({ ...a, value: v === 'true' ? true : v === 'false' ? false : v })} options={opts.map((o) => ({ value: String(o), label: optionLabel(o).toLowerCase() }))} />
      </>
    );
  } else {
    body = <>switch to the plan B tactic</>;
  }
  return (
    <div className="flex items-start gap-2 mt-1">
      <div className="flex-1 t-body leading-9">
        <Sel label="Action" value={type} onChange={(v) => onChange(v === 'sub' ? { type: 'sub', out: 'lowest_rated', outLine: 'ANY', in: 'best_available' } : v === 'mentality' ? { type: 'mentality', delta: 1 } : v === 'instruction' ? { type: 'instruction', key: 'line', value: 'deep' } : { type: 'plan_b' })}
          options={[{ value: 'sub', label: 'substitute' }, { value: 'mentality', label: 'mentality' }, { value: 'instruction', label: 'instruction' }, { value: 'plan_b', label: 'plan B' }]} />
        {body}
      </div>
      {onRemove && <button type="button" aria-label="Remove action" onClick={onRemove} className="h-9 w-9 flex items-center justify-center text-fg3"><Trash2 size={16} /></button>}
    </div>
  );
}

export function TriggersTab({ t, xi, bench, onChange }: { t: Tactic; xi: EditorPlayer[]; bench: EditorPlayer[]; onChange: (t: Tactic) => void }) {
  const set = (i: number, tr: Trigger) => onChange({ ...t, triggers: t.triggers.map((x, j) => (j === i ? tr : x)) });
  const add = () => onChange({ ...t, triggers: [...t.triggers, { id: `t${Date.now() % 100000}`, when: { kind: 'score', state: 'losing', by: 1, minute: 60 }, actions: [{ type: 'mentality', delta: 1 }] }] });
  return (
    <div className="pb-4 space-y-3">
      <div className="t-label text-fg2">Triggers are in-game reactions your assistant carries out automatically: they fire once when the condition is met.</div>
      {t.triggers.map((tr, i) => {
        const k = whenKind(tr.when);
        return (
          <Card key={tr.id}>
            <div className="flex items-center justify-between mb-1"><span className="t-caption text-fg3">Trigger {i + 1}</span><button type="button" aria-label="Delete trigger" className="text-fg3" onClick={() => onChange({ ...t, triggers: t.triggers.filter((_, j) => j !== i) })}><Trash2 size={16} /></button></div>
            <div className="t-body leading-9">
              <b>If</b> we are{' '}
              <Sel label="Condition" value={k} onChange={(v) => set(i, { ...tr, when: makeWhen(v, tr.when.minute, tr.when) })}
                options={[{ value: 'losing', label: 'losing' }, { value: 'drawing', label: 'drawing' }, { value: 'winning', label: 'winning' }, { value: 'condition', label: 'tiring' }, { value: 'yellow', label: 'on a yellow' }, { value: 'red', label: 'down to ten' }, { value: 'opp_change', label: 'facing a new shape' }]} />
              {tr.when.kind === 'score' && tr.when.state !== 'drawing' && <>by <Sel label="Goal margin" value={tr.when.by} onChange={(v) => set(i, { ...tr, when: { ...(tr.when as Extract<TriggerCondition, { kind: 'score' }>), by: v } })} options={[1, 2, 3].map((n) => ({ value: n, label: `${n}+` }))} /></>}
              {tr.when.kind === 'condition' && <>(someone below <Sel label="Condition threshold" value={tr.when.below} onChange={(v) => set(i, { ...tr, when: { ...(tr.when as Extract<TriggerCondition, { kind: 'condition' }>), below: v } })} options={[50, 55, 60, 65, 70, 75].map((n) => ({ value: n, label: `${n}%` }))} />)</>}
              {' '}<b>after</b> <Sel label="Minute" value={tr.when.minute} onChange={(v) => set(i, { ...tr, when: { ...tr.when, minute: v } as TriggerCondition })} options={MINUTES} />
              <b> then</b>
            </div>
            {tr.actions.map((a, j) => (
              <ActionEditor key={j} a={a} xi={xi} bench={bench} onChange={(na) => set(i, { ...tr, actions: tr.actions.map((x, jj) => (jj === j ? na : x)) })}
                onRemove={tr.actions.length > 1 ? () => set(i, { ...tr, actions: tr.actions.filter((_, jj) => jj !== j) }) : undefined} />
            ))}
            {tr.actions.length < 2 && <button type="button" className="t-label text-accent mt-2 flex items-center gap-1" onClick={() => set(i, { ...tr, actions: [...tr.actions, { type: 'sub', out: 'lowest_rated', outLine: 'ANY', in: 'best_available' }] })}><Plus size={14} /> and…</button>}
          </Card>
        );
      })}
      {t.triggers.length < 3 && (
        <button type="button" onClick={add} className="w-full h-16 rounded-[12px] border-2 border-dashed border-subtle text-fg2 t-strong flex items-center justify-center gap-2 active:bg-surface"><Plus size={18} /> Add trigger</button>
      )}
    </div>
  );
}
