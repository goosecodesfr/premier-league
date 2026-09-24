// Read-only pitch: tactics previews, predicted XIs, match line-ups. Own goal at the bottom.
import type { ReactNode } from 'react';
import { conditionTone, toneVar } from '../lib/format';
import { onColor } from '../lib/color';
import { cx } from './ui';

export interface PitchSlot {
  key: string | number;
  x: number; // 0..100 left -> right
  y: number; // 0..100 own goal -> their goal
  label: string; // surname
  number?: number | null;
  condition?: number | null;
  badge?: ReactNode;
  ring?: string | null; // highlight ring colour
  dim?: boolean;
  sub?: string | null;
}

export function PitchLines() {
  return (
    <g fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={0.6}>
      <rect x={2} y={2} width={96} height={136} rx={1.5} />
      <line x1={2} y1={70} x2={98} y2={70} />
      <circle cx={50} cy={70} r={10} />
      <rect x={24} y={2} width={52} height={18} />
      <rect x={38} y={2} width={24} height={7} />
      <rect x={24} y={120} width={52} height={18} />
      <rect x={38} y={131} width={24} height={7} />
      <path d="M 40 20 A 10 10 0 0 0 60 20" />
      <path d="M 40 120 A 10 10 0 0 1 60 120" />
    </g>
  );
}

export function MiniPitch({ slots, colors, onTap, className, compact, flip }: { slots: PitchSlot[]; colors?: [string, string] | null; onTap?: (key: PitchSlot['key']) => void; className?: string; compact?: boolean; flip?: boolean }) {
  const bg = colors?.[0] ?? '#2A333D';
  const fg = onColor(bg);
  const toY = (y: number) => (flip ? 4 + (y / 100) * 128 : 136 - (y / 100) * 128);
  return (
    <div className={cx('relative w-full rounded-xl overflow-hidden', className)} style={{ aspectRatio: compact ? '100 / 118' : '100 / 140', background: 'linear-gradient(180deg, #14231b 0%, #10201a 100%)' }}>
      <svg viewBox={compact ? '0 11 100 118' : '0 0 100 140'} className="absolute inset-0 w-full h-full" preserveAspectRatio="none" aria-hidden><PitchLines /></svg>
      {slots.map((s) => {
        const top = compact ? ((toY(s.y) - 11) / 118) * 100 : (toY(s.y) / 140) * 100;
        const cond = s.condition ?? null;
        const content = (
          <>
            <span className="relative flex items-center justify-center rounded-full font-cond font-bold shadow-md"
              style={{ width: compact ? 28 : 32, height: compact ? 28 : 32, background: bg, color: fg, fontSize: compact ? 13 : 15, boxShadow: s.ring ? `0 0 0 2.5px ${s.ring}` : cond !== null ? `0 0 0 2px ${toneVar(conditionTone(cond))}` : '0 0 0 1.5px rgba(255,255,255,0.25)', opacity: s.dim ? 0.45 : 1 }}>
              {s.number ?? ''}
              {s.badge && <span className="absolute -top-1.5 -right-2">{s.badge}</span>}
            </span>
            <span className="mt-0.5 max-w-[64px] truncate text-[10px] font-semibold leading-tight px-1 rounded bg-black/45 text-white">{s.label}</span>
            {s.sub && <span className="text-[9px] leading-tight text-white/70">{s.sub}</span>}
          </>
        );
        const style = { left: `${s.x}%`, top: `${top}%` } as const;
        return onTap ? (
          <button key={s.key} type="button" onClick={() => onTap(s.key)} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={style}>{content}</button>
        ) : (
          <div key={s.key} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={style}>{content}</div>
        );
      })}
    </div>
  );
}
