// Player understanding: signature traits, where he plays best, his role ratings,
// strengths and weaknesses, and per-90 numbers.
import { useState } from 'react';
import { Link } from 'react-router';
import { Crosshair, Dumbbell, Hand, Route, Shield, Sparkles, Star, Zap, type LucideIcon } from 'lucide-react';
import type { PlayerData } from '@ffm/server/routes/squad';
import { toneVar, type Tone } from '../lib/format';
import { Badge, Card, List, Section, cx } from '../components/ui';
import { PosBadge } from '../components/domain';

type Trait = PlayerData['traits'][number];

const GROUP_ICON: Record<string, LucideIcon> = { shooting: Crosshair, passing: Route, ball: Zap, defending: Shield, physical: Dumbbell, goalkeeping: Hand };

export function TraitChips({ traits, compact }: { traits: Trait[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!traits.length) return compact ? null : <div className="t-label text-fg3">No signature traits. He does the basics without a trademark move.</div>;
  const sel = traits.find((t) => t.key === open);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {traits.map((t) => (
          <button key={t.key} type="button" onClick={() => setOpen(open === t.key ? null : t.key)}
            className={cx('inline-flex items-center gap-1 h-7 px-2.5 rounded-full border t-label transition-colors',
              open === t.key ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]' : 'border-subtle bg-raised',
              t.level >= 2 && 'text-warning')}>
            {(() => { const I = GROUP_ICON[t.group] ?? Sparkles; return <I size={13} className="text-fg3" aria-hidden />; })()}{t.name.replace(/\+$/, '')}{t.level >= 2 && <Star size={11} className="fill-current" aria-label="elite" />}
          </button>
        ))}
      </div>
      {sel && (
        <div className="mt-2 rounded-lg bg-raised px-3 py-2 anim-fade">
          <div className="t-strong">{sel.name.replace(/\+$/, '')}{sel.level >= 2 ? ' (elite)' : ''}</div>
          <div className="t-label text-fg2">{sel.desc}</div>
          <div className="t-label mt-1"><span className="text-fg3">In matches: </span>{sel.effect}{sel.level >= 2 ? ' The elite version is half as strong again.' : ''}</div>
          <Link to="/guide?tab=words&cat=traits" className="t-label text-accent mt-1 inline-block">All traits explained</Link>
        </div>
      )}
    </div>
  );
}

const SPOTS: Record<string, [number, number]> = {
  ST: [50, 9], AML: [15, 25], AMC: [50, 25], AMR: [85, 25], ML: [15, 43], MC: [50, 43], MR: [85, 43],
  WBL: [12, 60], DM: [50, 60], WBR: [88, 60], DL: [15, 76], DC: [50, 76], DR: [85, 76], GK: [50, 92],
};

function famTone(f: number): Tone {
  return f >= 0.95 ? 'positive' : f >= 0.8 ? 'info' : f >= 0.6 ? 'warning' : 'neutral';
}

export function PositionMap({ positions }: { positions: PlayerData['positions'] }) {
  const best = positions.slice().sort((a, b) => b.rating - a.rating)[0];
  const [sel, setSel] = useState<string>(best?.pos ?? 'MC');
  const cur = positions.find((p) => p.pos === sel) ?? best;
  if (positions.length === 1) {
    const p = positions[0];
    return <Card><div className="flex items-center justify-between"><div><div className="t-strong">Goalkeeper</div><div className="t-label text-fg2">Best as {p.roleName}</div></div><div className="font-cond font-bold text-[26px]">{p.rating.toFixed(1)}</div></div></Card>;
  }
  return (
    <Card>
      <div className="relative w-full rounded-lg overflow-hidden" style={{ aspectRatio: '100 / 112', background: 'linear-gradient(180deg, #16301f, #10261a)' }}>
        <div className="absolute inset-2 border border-white/15 rounded" />
        <div className="absolute left-2 right-2 top-1/2 h-px bg-white/15" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        {positions.map((p) => {
          const [x, y] = SPOTS[p.pos] ?? [50, 50];
          const tone = famTone(p.fam);
          const on = p.pos === sel;
          return (
            <button key={p.pos} type="button" onClick={() => setSel(p.pos)} aria-label={`${p.pos}: ${p.famLabel}, ${p.rating.toFixed(1)}`}
              className={cx('absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded-lg px-1.5 py-0.5 min-w-[46px] transition-transform', on && 'scale-110')}
              style={{ left: `${x}%`, top: `${y}%`, background: tone === 'neutral' ? 'rgba(255,255,255,0.06)' : `color-mix(in srgb, ${toneVar(tone)} ${on ? 45 : 26}%, rgba(0,0,0,0.3))`, outline: on ? '2px solid var(--text-primary)' : 'none' }}>
              <span className="text-[10px] font-bold text-white/80 leading-none mt-0.5">{p.pos}</span>
              <span className={cx('font-cond font-bold text-[16px] leading-tight tabular', tone === 'neutral' ? 'text-white/45' : 'text-white')}>{p.rating.toFixed(1)}</span>
            </button>
          );
        })}
      </div>
      {cur && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="t-strong flex items-center gap-2"><PosBadge pos={cur.pos} /> {cur.famLabel}</div>
            <div className="t-label text-fg2">Best here as {cur.roleName} ({cur.duty === 'D' ? 'Defend' : cur.duty === 'S' ? 'Support' : 'Attack'})</div>
          </div>
          <div className="text-right"><div className="font-cond font-bold text-[24px] leading-none">{cur.rating.toFixed(1)}</div><div className="t-caption text-fg3">rating there</div></div>
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 t-label text-fg3">
        {(['positive', 'info', 'warning', 'neutral'] as Tone[]).map((t, i) => (
          <span key={t} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: t === 'neutral' ? 'rgba(255,255,255,0.15)' : toneVar(t) }} />{['Natural', 'Accomplished', 'Competent', 'Unfamiliar'][i]}</span>
        ))}
      </div>
      <div className="t-label text-fg3 mt-2">Playing a man out of position costs up to a fifth of his ability, and he will not fully understand what the role asks of him.</div>
    </Card>
  );
}

export function RoleTable({ rows }: { rows: PlayerData['roleTable'] }) {
  const [all, setAll] = useState(false);
  const top = rows[0]?.rating ?? 1;
  const list = all ? rows : rows.slice(0, 6);
  return (
    <>
      <List>
        {list.map((r) => (
          <div key={r.role} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <PosBadge pos={r.pos} />
              <span className="flex-1 t-body truncate">{r.name} <span className="text-fg3">({r.duty === 'D' ? 'Defend' : r.duty === 'S' ? 'Support' : 'Attack'})</span></span>
              <span className="font-cond font-bold text-[19px] tabular" style={{ color: r.rating >= top - 0.3 ? 'var(--positive)' : undefined }}>{r.rating.toFixed(1)}</span>
            </div>
            <div className="h-1 rounded-full bg-input mt-1.5 overflow-hidden"><div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(4, Math.min(100, ((r.rating - top + 4) / 4) * 100))}%` }} /></div>
            <div className="t-label text-fg3 mt-1">{r.desc}</div>
          </div>
        ))}
      </List>
      {rows.length > 6 && <button type="button" className="t-label text-accent mt-2" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length} roles`}</button>}
    </>
  );
}

export function ProfileCard({ profile }: { profile: PlayerData['profile'] }) {
  return (
    <Card>
      <div className="flex items-center gap-2"><Sparkles size={16} className="text-accent" /><span className="t-strong">Natural fit: {profile.bestRoleName}</span><PosBadge pos={profile.bestPos} /></div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <div className="t-caption text-fg3 mb-1">Strengths</div>
          {profile.strengths.length ? profile.strengths.map((s) => <div key={s.key} className="flex justify-between t-label"><span className={s.key4role ? 'text-fg' : 'text-fg2'}>{s.label}</span><span className="text-positive tabular">{s.value}</span></div>) : <div className="t-label text-fg3">No standout attribute</div>}
        </div>
        <div>
          <div className="t-caption text-fg3 mb-1">Weaknesses</div>
          {profile.weaknesses.length ? profile.weaknesses.map((s) => <div key={s.key} className="flex justify-between t-label"><span>{s.label}</span><span className="text-negative tabular">{s.value}</span></div>) : <div className="t-label text-fg3">Nothing glaring for his role</div>}
        </div>
      </div>
      <div className="t-caption text-fg3 mt-3 mb-1">What his best role relies on</div>
      <div className="flex flex-wrap gap-1.5">{profile.keyAttrs.map((k) => <Badge key={k.key} tone={k.value >= 15 ? 'positive' : k.value >= 11 ? 'info' : 'warning'}>{k.label} {k.value}</Badge>)}</div>
    </Card>
  );
}

export function Per90({ per90 }: { per90: PlayerData['per90'] }) {
  if (!per90) return null;
  return (
    <Section title="Per 90 minutes" action={<span className="t-label text-fg3">{per90.minutes.toLocaleString()} min this season</span>}>
      <Card>
        <div className="grid grid-cols-3 gap-y-3 gap-x-2">
          {per90.rows.map((r) => (
            <div key={r.key} className="min-w-0">
              <div className="t-caption text-fg3 truncate" title={r.label}>{r.label}</div>
              <div className="t-num text-[17px]">{r.value}{'unit' in r && r.unit ? r.unit : ''}</div>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}
