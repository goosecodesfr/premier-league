// Small SVG charts. Rules: positive/negative for data, never club colours for meaning; label directly.
import { useState } from 'react';
import { cx } from './ui';

// ---------------------------------------------------------------- radar
export function Radar({ axes, series, size = 240, max = 20 }: { axes: string[]; series: { values: number[]; color: string; fill?: boolean; dashed?: boolean; label?: string }[]; size?: number; max?: number }) {
  const c = size / 2;
  const r = size / 2 - 26;
  const n = axes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rr = (Math.max(0, Math.min(max, v)) / max) * r;
    return [c + Math.cos(a) * rr, c + Math.sin(a) * rr] as const;
  };
  return (
    <svg viewBox={`-44 -6 ${size + 88} ${size + 12}`} width="100%" style={{ maxWidth: size + 88 }} role="img" aria-label="Attribute radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={axes.map((_, i) => pt(i, max * f).join(',')).join(' ')} fill="none" stroke="var(--border-subtle)" strokeWidth={1} />
      ))}
      {axes.map((_, i) => { const [x, y] = pt(i, max); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--border-subtle)" />; })}
      {series.map((s, si) => (
        <polygon key={si} points={s.values.map((v, i) => pt(i, v).join(',')).join(' ')} fill={s.fill ? s.color : 'none'} fillOpacity={s.fill ? 0.22 : 0}
          stroke={s.color} strokeWidth={s.dashed ? 1.2 : 2} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" />
      ))}
      {axes.map((a, i) => {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = c + Math.cos(ang) * (r + 18);
        const y = c + Math.sin(ang) * (r + 14);
        return <text key={a} x={x} y={y} textAnchor={Math.abs(Math.cos(ang)) < 0.3 ? 'middle' : Math.cos(ang) > 0 ? 'start' : 'end'} dominantBaseline="middle" fontSize={10.5} fill="var(--text-secondary)" fontWeight={500}>{a}</text>;
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- xG race
export interface ShotPoint { m: number; side: number; xg: number; o: string }
export function XgRace({ shots, names, height = 170, minutes = 90 }: { shots: ShotPoint[]; names: [string, string]; height?: number; minutes?: number }) {
  const W = 340;
  const H = height;
  const padL = 26, padR = 8, padT = 10, padB = 20;
  const total = [0, 0];
  const lines: [number, number][][] = [[[0, 0]], [[0, 0]]];
  const goals: { side: number; m: number; v: number }[] = [];
  const sorted = shots.slice().sort((a, b) => a.m - b.m);
  for (const s of sorted) {
    const side = s.side as 0 | 1;
    lines[side].push([s.m, total[side]]);
    total[side] += s.xg;
    lines[side].push([s.m, total[side]]);
    if (s.o === 'goal') goals.push({ side, m: s.m, v: total[side] });
  }
  const end = Math.max(minutes, ...sorted.map((s) => s.m));
  lines.forEach((l, i) => l.push([end, total[i]]));
  const maxY = Math.max(1, Math.ceil(Math.max(total[0], total[1]) * 2) / 2);
  const x = (m: number) => padL + (m / end) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / maxY) * (H - padT - padB);
  const colors = ['var(--accent)', 'var(--text-secondary)'];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Expected goals race">
      {[0, maxY / 2, maxY].map((v) => (
        <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" strokeDasharray="2 3" /><text x={padL - 4} y={y(v)} fontSize={10} fill="var(--text-tertiary)" textAnchor="end" dominantBaseline="middle">{v.toFixed(1)}</text></g>
      ))}
      {[0, 45, 90].filter((m) => m <= end).map((m) => <text key={m} x={x(m)} y={H - 5} fontSize={10} fill="var(--text-tertiary)" textAnchor="middle">{m}'</text>)}
      <line x1={x(45)} x2={x(45)} y1={padT} y2={H - padB} stroke="var(--border-subtle)" />
      {lines.map((l, i) => <polyline key={i} points={l.map(([m, v]) => `${x(m)},${y(v)}`).join(' ')} fill="none" stroke={colors[i]} strokeWidth={2.2} strokeLinejoin="round" />)}
      {goals.map((g, i) => (
        <g key={i}><circle cx={x(g.m)} cy={y(g.v)} r={5} fill="var(--bg-surface)" stroke={colors[g.side]} strokeWidth={2} /><circle cx={x(g.m)} cy={y(g.v)} r={2} fill={colors[g.side]} /></g>
      ))}
      <text x={x(end) - 2} y={y(total[0]) - 8} fontSize={11} fontWeight={700} fill={colors[0]} textAnchor="end">{names[0]} {total[0].toFixed(2)}</text>
      <text x={x(end) - 2} y={y(total[1]) + (Math.abs(y(total[1]) - y(total[0])) < 14 ? 16 : -8)} fontSize={11} fontWeight={700} fill={colors[1]} textAnchor="end">{names[1]} {total[1].toFixed(2)}</text>
    </svg>
  );
}

// ---------------------------------------------------------------- shot map (half pitch, both teams attacking up)
export interface MapShot { m: number; side: number; xg: number; o: string; z?: number; a?: number }
export function ShotMap({ shots, names, playerName, mySide = 0 }: { shots: MapShot[]; names: [string, string]; playerName: (id?: number) => string; mySide?: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 300, H = 200;
  const pos = (s: MapShot, i: number) => {
    const z = s.z ?? 16;
    const band = Math.floor(z / 3);
    const chan = z % 3;
    const jitter = ((i * 37) % 100) / 100 - 0.5;
    const jit2 = ((i * 61) % 100) / 100 - 0.5;
    const cx = 150 + (chan - 1) * 62 + jitter * 44;
    const depth = band === 5 ? 30 + (1 - Math.min(0.8, s.xg * 1.6)) * 48 + jit2 * 14 : band === 4 ? 110 + jit2 * 30 : 160 + jit2 * 20;
    return [Math.max(12, Math.min(W - 12, cx)), Math.max(10, Math.min(H - 8, depth))] as const;
  };
  const s = sel !== null ? shots[sel] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Shot map" className="rounded-lg" style={{ background: 'color-mix(in srgb, var(--positive) 5%, var(--bg-surface))' }}>
        <g fill="none" stroke="var(--border-subtle)" strokeWidth={1.5}>
          <rect x={2} y={2} width={W - 4} height={H - 4} />
          <rect x={60} y={2} width={180} height={72} />
          <rect x={112} y={2} width={76} height={26} />
          <path d={`M 110 74 A 44 44 0 0 0 190 74`} />
          <rect x={132} y={0} width={36} height={4} fill="var(--text-tertiary)" />
        </g>
        {shots.map((sh, i) => {
          const [x, y] = pos(sh, i);
          const color = sh.side === mySide ? 'var(--accent)' : 'var(--text-secondary)';
          const r = 4 + Math.sqrt(sh.xg) * 16;
          return <circle key={i} cx={x} cy={y} r={r} fill={sh.o === 'goal' ? color : 'transparent'} fillOpacity={sh.o === 'goal' ? 0.9 : 0} stroke={color} strokeWidth={sel === i ? 3 : 1.6} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: 'pointer' }} />;
        })}
      </svg>
      <div className="flex justify-between t-label text-fg2 mt-2">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent" /> {names[mySide]}</span>
        <span className="text-fg3">Filled = goal · size = xG</span>
        <span className="flex items-center gap-1.5">{names[1 - mySide]} <span className="h-2.5 w-2.5 rounded-full bg-fg2" /></span>
      </div>
      {s && <div className="mt-2 t-label rounded-lg bg-raised px-3 py-2">{s.m}' · {playerName(s.a)} · {s.o === 'goal' ? 'Goal' : s.o === 'saved' ? 'Saved' : s.o === 'blocked' ? 'Blocked' : s.o === 'post' ? 'Hit the post' : 'Off target'} · {s.xg.toFixed(2)} xG</div>}
    </div>
  );
}

// ---------------------------------------------------------------- zone grid (6 bands x 3 channels, attacking upwards)
export function ZoneGrid({ values, label, format, color = 'var(--accent)', max }: { values: number[]; label?: string; format?: (v: number, i: number) => string; color?: string; max?: number }) {
  const m = max ?? Math.max(1, ...values);
  return (
    <div role="img" aria-label={label ?? 'Pitch zones'} className="grid grid-cols-3 gap-[3px] rounded-lg overflow-hidden p-[3px] bg-subtle aspect-[3/4]">
      {[5, 4, 3, 2, 1, 0].flatMap((band) => [0, 1, 2].map((chan) => {
        const i = band * 3 + chan;
        const v = values[i] ?? 0;
        const a = Math.max(0.04, Math.min(1, v / m));
        return (
          <div key={i} className="flex items-center justify-center text-[11px] font-semibold tabular" style={{ background: `color-mix(in srgb, ${color} ${Math.round(a * 85)}%, var(--bg-surface))`, color: a > 0.55 ? '#0B0E11' : 'var(--text-secondary)' }}>
            {format ? format(v, i) : v ? Math.round(v) : ''}
          </div>
        );
      }))}
    </div>
  );
}

// ---------------------------------------------------------------- bars
export function SplitBar({ left, right, leftLabel, rightLabel }: { left: number; right: number; leftLabel?: string; rightLabel?: string }) {
  const total = left + right || 1;
  const lp = (left / total) * 100;
  return (
    <div>
      <div className="flex justify-between t-num mb-1"><span>{leftLabel ?? `${Math.round(lp)}%`}</span><span className="text-fg2">{rightLabel ?? `${Math.round(100 - lp)}%`}</span></div>
      <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]"><div style={{ width: `${lp}%`, background: 'var(--accent)' }} /><div className="flex-1 bg-fg3" /></div>
    </div>
  );
}

export function CompareRow({ label, left, right, format = (v) => String(v), lowerBetter }: { label: string; left: number; right: number; format?: (v: number) => string; lowerBetter?: boolean }) {
  const m = Math.max(left, right, 0.0001);
  const lw = (left / m) * 100;
  const rw = (right / m) * 100;
  const leftBetter = lowerBetter ? left < right : left > right;
  const rightBetter = lowerBetter ? right < left : right > left;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between t-num mb-1">
        <span className={cx(leftBetter && 'text-fg', !leftBetter && 'text-fg2')}>{format(left)}</span>
        <span className="t-label text-fg2">{label}</span>
        <span className={cx(rightBetter && 'text-fg', !rightBetter && 'text-fg2')}>{format(right)}</span>
      </div>
      <div className="flex gap-1 h-1.5">
        <div className="flex-1 flex justify-end bg-input rounded-l-full overflow-hidden"><div className="h-full rounded-l-full" style={{ width: `${lw}%`, background: 'var(--accent)' }} /></div>
        <div className="flex-1 bg-input rounded-r-full overflow-hidden"><div className="h-full rounded-r-full bg-fg2" style={{ width: `${rw}%` }} /></div>
      </div>
    </div>
  );
}

export function WdlBar({ w, d, l }: { w: number; d: number; l: number }) {
  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden text-[12px] font-bold" style={{ color: '#0B0E11' }}>
        {w > 0 && <div className="flex items-center justify-center" style={{ width: `${w}%`, background: 'var(--positive)' }}>{w >= 12 && `${Math.round(w)}%`}</div>}
        {d > 0 && <div className="flex items-center justify-center" style={{ width: `${d}%`, background: 'var(--text-tertiary)' }}>{d >= 12 && `${Math.round(d)}%`}</div>}
        {l > 0 && <div className="flex items-center justify-center" style={{ width: `${l}%`, background: 'var(--negative)' }}>{l >= 12 && `${Math.round(l)}%`}</div>}
      </div>
      <div className="flex justify-between t-label text-fg2 mt-1"><span>Win</span><span>Draw</span><span>Loss</span></div>
    </div>
  );
}

export function HBar({ label, value, max, right, color = 'var(--accent)' }: { label: string; value: number; max: number; right?: string; color?: string }) {
  return (
    <div className="py-1.5">
      <div className="flex justify-between t-label mb-1"><span className="text-fg2">{label}</span><span className="tabular">{right ?? value}</span></div>
      <div className="h-1.5 rounded-full bg-input overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%`, background: color }} /></div>
    </div>
  );
}

export function StackedBar({ parts, total, label }: { parts: { key: string; label: string; value: number; color: string }[]; total?: number; label?: string }) {
  const t = total ?? parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      {label && <div className="t-caption text-fg3 mb-1">{label}</div>}
      <div className="flex h-4 rounded-md overflow-hidden bg-input gap-[1px]">
        {parts.filter((p) => p.value > 0).map((p) => <div key={p.key} title={`${p.label}`} style={{ width: `${(p.value / (t || 1)) * 100}%`, background: p.color }} />)}
      </div>
    </div>
  );
}

/** Match ratings over the last N games with the result colour-coded under each point. */
export function RatingLine({ points, height = 120 }: { points: { rating: number; result: string; opp: string }[]; height?: number }) {
  const W = 320, H = height, padL = 22, padR = 8, padT = 10, padB = 28;
  if (!points.length) return <div className="t-label text-fg3 py-6 text-center">No matches yet</div>;
  const min = 5, max = 9.5;
  const x = (i: number) => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i / (points.length - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - (Math.max(min, Math.min(max, v)) - min) / (max - min)) * (H - padT - padB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Recent match ratings">
      {[6, 7, 8, 9].map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" strokeDasharray="2 3" /><text x={padL - 5} y={y(v)} fontSize={10} fill="var(--text-tertiary)" textAnchor="end" dominantBaseline="middle">{v}</text></g>)}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.rating)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.rating)} r={3.5} fill="var(--accent)" />
          <rect x={x(i) - 7} y={H - 22} width={14} height={14} rx={3} fill={p.result === 'W' ? 'var(--positive)' : p.result === 'L' ? 'var(--negative)' : 'var(--text-tertiary)'} />
          <text x={x(i)} y={H - 15} fontSize={9} fontWeight={700} textAnchor="middle" dominantBaseline="middle" fill="#0B0E11">{p.result}</text>
        </g>
      ))}
    </svg>
  );
}

export function Histogram({ items }: { items: { label: string; pct: number }[] }) {
  const m = Math.max(1, ...items.map((i) => i.pct));
  return (
    <div className="flex items-end gap-1.5 h-28">
      {items.map((i) => (
        <div key={i.label} className="flex-1 flex flex-col items-center justify-end h-full">
          <div className="text-[10px] text-fg2 tabular mb-1">{Math.round(i.pct)}%</div>
          <div className="w-full rounded-t-md bg-accent" style={{ height: `${(i.pct / m) * 72}%`, opacity: 0.45 + 0.55 * (i.pct / m) }} />
          <div className="t-label mt-1 tabular">{i.label}</div>
        </div>
      ))}
    </div>
  );
}
