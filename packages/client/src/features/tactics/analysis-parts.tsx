// Tactic analysis: how the chosen shape, roles, instructions and players add up, in the same terms the
// match engine uses. Also the per-player instruction panel for the slot sheet.
import { useState } from 'react';
import { AlertTriangle, BatteryLow, CheckCircle2, Info, XCircle } from 'lucide-react';
import {
  PLAYER_INSTRUCTION_KEYS, PLAYER_INSTRUCTION_OPTIONS, ROLES,
  type Duty, type FitTone, type PlayerInstructions, type RoleKey, type SlotAnalysis, type TacticAnalysis,
} from '@ffm/engine';
import { toneVar, type Tone } from '../../lib/format';
import { Badge, Card, List, Section, Segmented, cx } from '../../components/ui';
import { PosBadge } from '../../components/domain';

export const FIT: Record<FitTone, { tone: Tone; label: string; phrase: string; color: string }> = {
  great: { tone: 'positive', label: 'Ideal', phrase: 'ideal for the role', color: 'var(--positive)' },
  good: { tone: 'info', label: 'Good', phrase: 'a good fit', color: 'var(--info)' },
  ok: { tone: 'neutral', label: 'Fair', phrase: 'a fair fit', color: '#cfd6dc' },
  poor: { tone: 'warning', label: 'Poor', phrase: 'a poor fit', color: 'var(--warning)' },
  bad: { tone: 'negative', label: 'Misfit', phrase: 'badly suited', color: 'var(--negative)' },
};

export function FitLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 t-label text-fg3">
      {(Object.keys(FIT) as FitTone[]).map((k) => (
        <span key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: FIT[k].color }} />{FIT[k].label}</span>
      ))}
    </div>
  );
}

const meterTone = (v: number): Tone => (v >= 65 ? 'positive' : v >= 35 ? 'info' : 'warning');

function Heat({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(0.001, ...values);
  // Bands 0..5 run from our goal to theirs; draw their goal at the top.
  const rows = [5, 4, 3, 2, 1, 0];
  return (
    <div className="relative w-full rounded-lg overflow-hidden" style={{ aspectRatio: '100 / 120', background: 'linear-gradient(180deg, #16301f, #10261a)' }} aria-label={label} role="img">
      <div className="absolute inset-0 grid grid-cols-3" style={{ gridTemplateRows: 'repeat(6, 1fr)' }}>
        {rows.flatMap((b) => [0, 1, 2].map((c) => {
          const v = values[b * 3 + c] / max;
          return <div key={`${b}${c}`} className="border border-white/5 flex items-center justify-center" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(v * 78)}%, transparent)` }}>
            <span className="text-[10px] font-bold text-white/70 tabular">{Math.round(v * 100)}</span>
          </div>;
        }))}
      </div>
      <div className="absolute left-[30%] right-[30%] top-0 h-[10%] border-x border-b border-white/25" />
      <div className="absolute left-[30%] right-[30%] bottom-0 h-[10%] border-x border-t border-white/25" />
      <div className="absolute left-0 right-0 top-1/2 h-px bg-white/25" />
    </div>
  );
}

function Split({ label, values, names }: { label: string; values: [number, number, number]; names: [string, string, string] }) {
  const colors = ['var(--info)', 'var(--accent)', 'var(--warning)'];
  return (
    <div className="mb-3">
      <div className="t-caption text-fg3 mb-1">{label}</div>
      <div className="flex h-6 rounded-md overflow-hidden">
        {values.map((v, i) => (
          <div key={i} className="flex items-center justify-center text-[11px] font-bold text-[#0B0E11]" style={{ width: `${Math.max(v, 8)}%`, background: colors[i] }}>{v}%</div>
        ))}
      </div>
      <div className="flex justify-between t-label text-fg3 mt-0.5"><span>{names[0]}</span><span>{names[1]}</span><span>{names[2]}</span></div>
    </div>
  );
}

export function AnalysisTab({ a, ratings, names, onSlot, onRole }: {
  a: TacticAnalysis; ratings: number[]; names: Map<number, string>;
  onSlot: (slot: number) => void; onRole: (slot: number, role: RoleKey, duty: Duty) => void;
}) {
  const [hint, setHint] = useState<string | null>(null);
  const [heat, setHeat] = useState<'att' | 'def'>('att');
  const icon = { good: <CheckCircle2 size={17} className="text-positive shrink-0 mt-0.5" />, warn: <AlertTriangle size={17} className="text-warning shrink-0 mt-0.5" />, bad: <XCircle size={17} className="text-negative shrink-0 mt-0.5" /> };
  return (
    <div className="pb-6">
      <div className="t-label text-fg2 mb-3">This is what the match engine sees: your players in their roles, with your instructions. Every number here feeds straight into how chances are made and stopped.</div>

      <Section title="Assistant's view">
        {a.notes.length === 0 ? <Card><div className="t-body text-fg2">Nothing stands out. The pieces fit together.</div></Card> : (
          <List>
            {a.notes.map((n, i) => (
              <button key={i} type="button" disabled={n.slot === undefined} onClick={() => n.slot !== undefined && onSlot(n.slot)} className="w-full flex gap-2.5 px-4 py-3 text-left active:bg-raised disabled:active:bg-transparent">
                {icon[n.tone]}<span className="t-body">{n.text}</span>
              </button>
            ))}
          </List>
        )}
      </Section>

      <Section title="Team profile" action={<span className="t-label text-fg3">Tap a bar for what it measures</span>}>
        <Card>
          {a.meters.map((m) => (
            <button key={m.key} type="button" onClick={() => setHint(hint === m.key ? null : m.key)} className="w-full text-left py-1.5">
              <div className="flex items-center justify-between t-label"><span className="text-fg">{m.label}</span><span className="tabular font-bold" style={{ color: toneVar(meterTone(m.value)) }}>{m.value}</span></div>
              <div className="h-1.5 rounded-full bg-input mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(3, m.value)}%`, background: toneVar(meterTone(m.value)) }} /></div>
              {hint === m.key && <div className="t-label text-fg3 mt-1 anim-fade">{m.hint}</div>}
            </button>
          ))}
        </Card>
      </Section>

      <Section title="Where you play" action={<Segmented size="sm" value={heat} onChange={setHeat} options={[{ value: 'att', label: 'With ball' }, { value: 'def', label: 'Without' }]} />}>
        <Card>
          <div className="grid grid-cols-[1fr_1.1fr] gap-4 items-start">
            <Heat values={heat === 'att' ? a.presAtt : a.presDef} label={heat === 'att' ? 'Attacking presence' : 'Defensive presence'} />
            <div>
              <Split label="Attacks go down" values={a.channels} names={['Left', 'Centre', 'Right']} />
              <Split label="Cover in your half" values={a.cover} names={['Left', 'Centre', 'Right']} />
              <div className="t-label text-fg3">{heat === 'att' ? 'How many of your players get into each area when you have the ball. Their goal is at the top.' : 'Where your players are when the opponent has the ball. Thin areas are where they will attack.'}</div>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Player fit">
        <List>
          {a.slots.map((s) => <FitRow key={s.index} s={s} rating={ratings[s.index] ?? 0} name={s.playerId ? names.get(s.playerId) ?? '?' : 'Empty'} onSlot={onSlot} onRole={onRole} />)}
        </List>
        <div className="mt-2"><FitLegend /></div>
      </Section>

      {a.staminaRisk.length > 0 && (
        <Section title="Energy at full time" action={<span className="t-label text-fg3">if nobody is subbed</span>}>
          <List>
            {a.staminaRisk.map((r) => (
              <div key={r.playerId} className="flex items-center gap-3 px-4 h-11">
                <BatteryLow size={16} className={r.end < 55 ? 'text-negative' : r.end < 65 ? 'text-warning' : 'text-fg3'} />
                <span className="t-body flex-1 truncate">{r.short}</span>
                <span className="t-num" style={{ color: toneVar(r.end < 55 ? 'negative' : r.end < 65 ? 'warning' : 'positive') }}>{Math.max(0, r.end)}%</span>
              </div>
            ))}
          </List>
          <div className="t-label text-fg3 mt-2 flex gap-1.5"><Info size={14} className="shrink-0 mt-0.5" />Tired players lose pace, make more errors and get injured more. Pressing, tempo and demanding roles drain energy faster.</div>
        </Section>
      )}
    </div>
  );
}

function FitRow({ s, rating, name, onSlot, onRole }: { s: SlotAnalysis; rating: number; name: string; onSlot: (i: number) => void; onRole: (slot: number, role: RoleKey, duty: Duty) => void }) {
  const f = FIT[s.fit];
  return (
    <div className="px-4 py-2.5">
      <button type="button" onClick={() => onSlot(s.index)} className="w-full flex items-center gap-2 text-left">
        <PosBadge pos={s.pos} />
        <div className="flex-1 min-w-0">
          <div className="t-body truncate">{name}</div>
          <div className="t-label text-fg3 truncate">{ROLES[s.role].name} ({s.duty === 'D' ? 'Defend' : s.duty === 'S' ? 'Support' : 'Attack'}){s.playerId ? ` · ${s.famLabel}` : ''}</div>
        </div>
        {s.playerId && <Badge tone={f.tone}>{f.label}</Badge>}
        {s.playerId && <span className="font-cond font-bold text-[19px] w-10 text-right tabular">{rating.toFixed(1)}</span>}
      </button>
      {s.better && (
        <button type="button" onClick={() => onRole(s.index, s.better!.role, s.better!.duty)} className="mt-1.5 ml-9 t-label text-accent">
          Try him as {ROLES[s.better.role].name} ({s.better.duty}): {(s.better.rating / 10).toFixed(1)}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- per-player instructions
export function PlayerInstructionsPanel({ pi, gk, onChange, slot }: { pi: PlayerInstructions | undefined; gk: boolean; onChange: (pi: PlayerInstructions | undefined) => void; slot?: SlotAnalysis }) {
  if (gk) return <div className="t-body text-fg2 pb-4">Goalkeepers follow the team's distribution instructions.</div>;
  const cur = pi ?? {};
  const set = (k: keyof PlayerInstructions, v: string) => {
    const next: Record<string, string> = { ...(cur as Record<string, string>) };
    if (v === '') delete next[k]; else next[k] = v;
    onChange(Object.keys(next).length ? (next as PlayerInstructions) : undefined);
  };
  const n = Object.keys(cur).length;
  return (
    <div className="pb-4">
      <div className="t-label text-fg2 mb-3">Fine-tune what this player does on top of his role. Each instruction changes his decisions in the match engine; asking him to do something he is bad at will backfire.</div>
      {slot?.keyAttrs.length ? (
        <div className="mb-3">
          <div className="t-caption text-fg3 mb-1">His role relies on</div>
          <div className="flex flex-wrap gap-1.5">{slot.keyAttrs.map((k) => <Badge key={k.key} tone={k.value >= 15 ? 'positive' : k.value >= 11 ? 'info' : 'warning'}>{k.label} {k.value}</Badge>)}</div>
        </div>
      ) : null}
      <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle">
        {PLAYER_INSTRUCTION_KEYS.map((k) => {
          const opt = PLAYER_INSTRUCTION_OPTIONS[k];
          const v = (cur as Record<string, string>)[k] ?? '';
          const chosen = opt.options.find((o) => o.value === v);
          return (
            <div key={k} className="px-4 py-2.5">
              <div className={cx('t-label mb-1.5', v ? 'text-accent' : 'text-fg2')}>{opt.label}</div>
              <Segmented size="sm" value={v} onChange={(x) => set(k, x)} options={[{ value: '', label: 'Default' }, ...opt.options.map((o) => ({ value: o.value as string, label: o.label }))]} />
              {chosen && <div className="t-label text-fg3 mt-1">{chosen.effect}</div>}
            </div>
          );
        })}
      </div>
      <div className="t-label text-fg3 mt-2">{n ? `${n} instruction${n > 1 ? 's' : ''} set. ` : ''}Changes cost a sliver of familiarity.</div>
    </div>
  );
}
