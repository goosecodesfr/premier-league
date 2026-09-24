// Football-specific building blocks shared by several features.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Ban, Cross, Star } from 'lucide-react';
import { nation } from '@ffm/shared';
import { onColor } from '../lib/color';
import { COMP_COLOR, COMP_SHORT, LINE_COLOR, LINE_OF, conditionTone, initials, ratingTone, toneVar, type Tone } from '../lib/format';
import { cx } from './ui';

export interface ClubLike { id: number; key: string; name: string; short: string; colors: [string, string]; human?: boolean; managerName?: string | null }

export function ClubCrest({ club, size = 40, className }: { club: Pick<ClubLike, 'key' | 'short' | 'colors'> | null | undefined; size?: number; className?: string }) {
  if (!club) return <div className={cx('rounded-full bg-input', className)} style={{ width: size, height: size }} />;
  const [p, s] = club.colors;
  const label = club.key.length <= 3 ? club.key : club.short.slice(0, 3).toUpperCase();
  return (
    <div className={cx('shrink-0 rounded-[30%] flex items-center justify-center font-cond font-bold select-none', className)} aria-hidden
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${p} 0 62%, ${s} 62% 100%)`, color: onColor(p), fontSize: size * 0.34, letterSpacing: '0.02em', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
      {label}
    </div>
  );
}

export function PlayerAvatar({ name, colors, size = 40, injured, suspended, number }: { name: string; colors?: [string, string] | null; size?: number; injured?: boolean; suspended?: boolean; number?: number | null }) {
  const bg = colors?.[0] ?? '#2A333D';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full flex items-center justify-center font-semibold select-none" style={{ background: bg, color: onColor(bg), fontSize: size * 0.36, boxShadow: `inset 0 0 0 2px ${colors?.[1] ?? 'transparent'}33` }} aria-hidden>
        {number != null && size >= 36 ? <span className="font-cond font-bold" style={{ fontSize: size * 0.42 }}>{number}</span> : initials(name)}
      </div>
      {injured && <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-negative text-white flex items-center justify-center ring-2 ring-surface" title="Injured"><Cross size={10} strokeWidth={4} /></span>}
      {!injured && suspended && <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-sm bg-negative text-white flex items-center justify-center ring-2 ring-surface" title="Suspended"><Ban size={10} strokeWidth={3} /></span>}
    </div>
  );
}

export function PosBadge({ pos, className }: { pos: string; className?: string }) {
  const c = LINE_COLOR[LINE_OF[pos] ?? 'MID'];
  return <span className={cx('inline-flex items-center justify-center rounded px-1 h-[18px] min-w-[26px] text-[10px] font-bold tracking-wide', className)} style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}>{pos}</span>;
}

export function Flag({ code, className }: { code: string; className?: string }) {
  const n = nation(code);
  return <span className={className} title={n.name} role="img" aria-label={n.name}>{n.flag}</span>;
}

export function CompBadge({ comp, className }: { comp: string; className?: string }) {
  const c = COMP_COLOR[comp] ?? '#9AA7B4';
  return <span className={cx('inline-flex items-center rounded px-1.5 h-5 text-[10px] font-bold tracking-wider', className)} style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}>{COMP_SHORT[comp] ?? comp.toUpperCase()}</span>;
}

export function RatingPill({ rating, className, size = 'md' }: { rating: number | null | undefined; className?: string; size?: 'sm' | 'md' }) {
  const t = ratingTone(rating);
  return (
    <span className={cx('inline-flex items-center justify-center rounded-md font-bold tabular', size === 'sm' ? 'h-5 min-w-[30px] text-[11px]' : 'h-6 min-w-[34px] text-[13px]', className)}
      style={{ color: '#0B0E11', background: rating == null ? 'var(--bg-input)' : toneVar(t) }}>
      {rating == null ? '-' : rating.toFixed(1)}
    </span>
  );
}

export function FormDots({ form, size = 18 }: { form: string[]; size?: number }) {
  return (
    <div className="flex gap-1" aria-label={`Form ${form.join(' ')}`}>
      {form.map((r, i) => (
        <span key={i} className="rounded-[4px] flex items-center justify-center font-bold text-[10px]" style={{ width: size, height: size, color: '#0B0E11', background: r === 'W' ? 'var(--positive)' : r === 'L' ? 'var(--negative)' : 'var(--text-tertiary)' }}>{r}</span>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 40, height = 16, min = 5, max = 9, tone }: { values: number[]; width?: number; height?: number; min?: number; max?: number; tone?: Tone }) {
  if (!values.length) return <div style={{ width, height }} className="flex items-center"><div className="h-px w-full bg-subtle" /></div>;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 4) + 2;
    const y = height - 2 - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (height - 4);
    return [x, y] as const;
  });
  const last = values[values.length - 1];
  const color = tone ? toneVar(tone) : toneVar(ratingTone(last));
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2} fill={color} />
    </svg>
  );
}

export function ConditionMeter({ value, width = 44 }: { value: number; width?: number }) {
  const t = conditionTone(value);
  return (
    <div style={{ width }} className="flex flex-col items-end gap-0.5">
      <span className="text-[11px] font-semibold tabular" style={{ color: toneVar(t) }}>{Math.round(value)}%</span>
      <div className="h-1 w-full rounded-full bg-input overflow-hidden"><div className="h-full rounded-full" style={{ width: `${value}%`, background: toneVar(t) }} /></div>
    </div>
  );
}

export interface PlayerLiteLike {
  id: number; name: string; short: string; age: number; nat: string; pos: string[]; best: string; ovr: number; condition: number; form: number[];
  injury: { daysLeft: number; type?: string; range?: string } | null; suspended: number; number?: number | null; listed?: boolean; wantsOut?: boolean; rested?: boolean;
}

/** The most-used component in the app: a 72px player row. */
export function PlayerRow({ p, colors, right, to, onClick, onLongPress, sub, selected, compact }: { p: PlayerLiteLike; colors?: [string, string] | null; right?: ReactNode; to?: string; onClick?: () => void; onLongPress?: () => void; sub?: ReactNode; selected?: boolean; compact?: boolean }) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const lp = onLongPress ? {
    onPointerDown: () => { timer = setTimeout(() => { timer = null; onLongPress(); }, 480); },
    onPointerUp: () => { if (timer) clearTimeout(timer); },
    onPointerLeave: () => { if (timer) clearTimeout(timer); },
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onLongPress(); },
  } : {};
  const body = (
    <>
      <PlayerAvatar name={p.name} colors={colors} size={compact ? 34 : 40} injured={!!p.injury} suspended={p.suspended > 0} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="t-strong truncate">{p.name}</span>
          {p.listed && <span className="text-[10px] font-bold text-warning">TL</span>}
          {p.wantsOut && <span className="text-[10px] font-bold text-negative" title="Wants to leave">!</span>}
          {p.rested && <span className="text-[10px] font-bold text-info">REST</span>}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {p.pos.slice(0, 3).map((x) => <PosBadge key={x} pos={x} />)}
          <span className="t-label text-fg3 ml-1 truncate">{sub ?? `${p.age} yrs`}</span>
        </div>
      </div>
      {right}
    </>
  );
  const cls = cx('flex items-center gap-3 px-4 w-full text-left select-none', compact ? 'min-h-[56px] py-1.5' : 'min-h-[72px] py-2', (to || onClick) && 'active:bg-raised', selected && 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]');
  if (to) return <Link to={to} className={cls} {...lp}>{body}</Link>;
  return <button type="button" className={cls} onClick={onClick} {...lp}>{body}</button>;
}

export function FixtureScore({ score, pens, className }: { score: [number, number] | null; pens?: { home: number; away: number } | null; className?: string }) {
  if (!score) return <span className={cx('t-label text-fg3', className)}>v</span>;
  return (
    <span className={cx('font-cond font-bold tabular text-[20px] leading-none', className)}>
      {score[0]}<span className="text-fg3 mx-1">-</span>{score[1]}
      {pens && <span className="block text-[11px] font-sans font-medium text-fg3 text-center mt-0.5">({pens.home}-{pens.away} p)</span>}
    </span>
  );
}

export function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => <Star key={i} size={12} className={i < value ? 'text-warning fill-current' : 'text-fg3'} />)}
    </span>
  );
}

export function Pips({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`Tier ${value} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => <span key={i} className="h-2 w-5 rounded-full" style={{ background: i < value ? 'var(--accent)' : 'var(--bg-input)' }} />)}
    </span>
  );
}

export function resultTone(my: number, their: number): Tone {
  return my > their ? 'positive' : my < their ? 'negative' : 'warning';
}
