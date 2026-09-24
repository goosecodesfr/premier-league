// Design-system primitives (section 14). No domain knowledge in here.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, WifiOff, X } from 'lucide-react';
import { ApiError } from '../lib/api';
import { toneVar, type Tone } from '../lib/format';

export function cx(...c: unknown[]): string {
  return c.filter((x) => typeof x === 'string' && x).join(' ');
}

// ---------------------------------------------------------------- screen scaffold
export function Screen(props: { title?: ReactNode; subtitle?: ReactNode; back?: boolean | string; actions?: ReactNode; children: ReactNode; noPad?: boolean; header?: ReactNode; bottom?: ReactNode; tabbar?: boolean }) {
  const nav = useNavigate();
  const { tabbar = true } = props;
  return (
    <div className={cx('min-h-full', tabbar ? 'pb-tabbar' : 'pb-safe', props.bottom && 'pb-[calc(var(--tabbar-h)+96px+var(--safe-bottom))]')}>
      {(props.title || props.back || props.actions) && (
        <header className="sticky top-0 z-20 pt-safe bg-[color-mix(in_srgb,var(--bg-base)_88%,transparent)] backdrop-blur-md border-b border-subtle/60">
          <div className="h-14 px-2 flex items-center gap-1">
            {props.back ? (
              <button aria-label="Back" className="h-11 w-11 -ml-1 flex items-center justify-center rounded-full active:bg-input" onClick={() => (typeof props.back === 'string' ? nav(props.back) : window.history.length > 1 ? nav(-1) : nav('/'))}>
                <ChevronLeft size={24} />
              </button>
            ) : <div className="w-2" />}
            <div className="min-w-0 flex-1">
              <h1 className="t-title2 truncate">{props.title}</h1>
              {props.subtitle && <div className="t-label text-fg2 truncate -mt-0.5">{props.subtitle}</div>}
            </div>
            <div className="flex items-center gap-1 pr-1">{props.actions}</div>
          </div>
          {props.header}
        </header>
      )}
      <main className={cx(!props.noPad && 'px-4 pt-4')}>{props.children}</main>
      {props.bottom && (
        <div className="fixed left-0 right-0 z-30 mx-auto max-w-[480px] px-4 pb-3 pt-3 bg-[color-mix(in_srgb,var(--bg-base)_92%,transparent)] backdrop-blur-md border-t border-subtle"
          style={{ bottom: tabbar ? 'calc(var(--tabbar-h) + var(--safe-bottom))' : 'var(--safe-bottom)' }}>
          {props.bottom}
        </div>
      )}
    </div>
  );
}

export function Section(props: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mb-6', props.className)}>
      {(props.title || props.action) && (
        <div className="flex items-end justify-between mb-2 px-0.5">
          <h2 className="t-caption text-fg2">{props.title}</h2>
          {props.action}
        </div>
      )}
      {props.children}
    </section>
  );
}

// ---------------------------------------------------------------- buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'; size?: 'sm' | 'md' | 'lg'; full?: boolean; loading?: boolean; icon?: ReactNode };
export function Button({ variant = 'primary', size = 'md', full, loading, icon, className, children, disabled, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold select-none transition-[transform,opacity] active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100';
  const sizes = { sm: 'h-9 px-3 text-[13px]', md: 'h-11 px-4 text-[15px]', lg: 'h-13 px-5 text-[16px] min-h-[52px]' };
  const variants = {
    primary: 'bg-accent text-on-accent',
    secondary: 'bg-raised text-fg border border-subtle',
    ghost: 'bg-transparent text-fg',
    destructive: 'bg-negative text-[#0B0E11]',
  };
  return (
    <button {...rest} disabled={disabled || loading} className={cx(base, sizes[size], variants[variant], full && 'w-full', className)}>
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: boolean }) {
  return (
    <button aria-label={label} title={label} {...rest} className={cx('relative h-11 w-11 flex items-center justify-center rounded-full active:bg-input text-fg', className)}>
      {children}
      {badge && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-negative ring-2 ring-base" />}
    </button>
  );
}

// ---------------------------------------------------------------- cards and rows
export function Card(props: { children: ReactNode; className?: string; to?: string; onClick?: () => void; raised?: boolean; style?: React.CSSProperties; padded?: boolean }) {
  const cls = cx('block rounded-[12px] border border-subtle', props.raised ? 'bg-raised' : 'bg-surface', props.padded !== false && 'p-4', (props.to || props.onClick) && 'active:brightness-110 transition', props.className);
  if (props.to) return <Link to={props.to} className={cls} style={props.style}>{props.children}</Link>;
  if (props.onClick) return <button type="button" onClick={props.onClick} className={cx(cls, 'w-full text-left')} style={props.style}>{props.children}</button>;
  return <div className={cls} style={props.style}>{props.children}</div>;
}

export function ListRow(props: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; to?: string; onClick?: () => void; chevron?: boolean; className?: string; tall?: boolean }) {
  const inner = (
    <>
      {props.icon && <div className="shrink-0 flex items-center justify-center">{props.icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="t-strong truncate">{props.title}</div>
        {props.subtitle && <div className="t-label text-fg2 truncate">{props.subtitle}</div>}
      </div>
      {props.right && <div className="shrink-0 text-right">{props.right}</div>}
      {(props.chevron ?? !!(props.to || props.onClick)) && <ChevronRight size={18} className="shrink-0 text-fg3" />}
    </>
  );
  const cls = cx('flex items-center gap-3 px-4 w-full text-left', props.tall ? 'min-h-[72px] py-2' : 'min-h-[56px] py-2', (props.to || props.onClick) && 'active:bg-raised', props.className);
  if (props.to) return <Link to={props.to} className={cls}>{inner}</Link>;
  if (props.onClick) return <button type="button" onClick={props.onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-[12px] border border-subtle bg-surface divide-y divide-subtle overflow-hidden', className)}>{children}</div>;
}

// ---------------------------------------------------------------- small data display
export function Meter({ value, tone, max = 100, className, height = 4 }: { value: number; tone?: Tone; max?: number; className?: string; height?: number }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cx('rounded-full bg-input overflow-hidden', className)} style={{ height }} role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${w}%`, background: tone ? toneVar(tone) : 'var(--accent)' }} />
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className, solid }: { children: ReactNode; tone?: Tone | 'accent'; className?: string; solid?: boolean }) {
  const color = tone === 'accent' ? 'var(--accent)' : toneVar(tone);
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 h-5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap', className)}
      style={solid ? { background: color, color: '#0B0E11' } : { color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {children}
    </span>
  );
}

export function Chip({ children, selected, onClick, className }: { children: ReactNode; selected?: boolean; onClick?: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cx('shrink-0 h-8 px-3 rounded-full t-label border whitespace-nowrap transition-colors', selected ? 'bg-accent text-on-accent border-transparent' : 'bg-surface text-fg2 border-subtle', className)}>
      {children}
    </button>
  );
}

export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 py-1', className)}>{children}</div>;
}

export function Segmented<T extends string>({ options, value, onChange, className, size = 'md' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="tablist" className={cx('flex p-1 rounded-xl bg-surface border border-subtle', className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} type="button" onClick={() => onChange(o.value)}
          className={cx('flex-1 rounded-lg t-label transition-colors whitespace-nowrap px-2', size === 'sm' ? 'h-7' : 'h-9', o.value === value ? 'bg-raised text-fg shadow-sm' : 'text-fg2')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto no-scrollbar px-2', className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} type="button" onClick={() => { if (t.value !== value) window.scrollTo({ top: 0 }); onChange(t.value); }}
          className={cx('relative h-11 px-3 t-label whitespace-nowrap', t.value === value ? 'text-fg' : 'text-fg2')}>
          {t.label}
          {!!t.count && <span className="ml-1 text-[11px] text-accent">{t.count}</span>}
          {t.value === value && <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function StatBlock({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="t-caption text-fg3 truncate">{label}</div>
      <div className="t-num text-[17px] mt-0.5 truncate" style={tone ? { color: toneVar(tone) } : undefined}>{value}</div>
      {sub && <div className="t-label text-fg3 truncate">{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      {icon && <div className="h-14 w-14 rounded-2xl bg-surface border border-subtle flex items-center justify-center text-fg2 mb-4">{icon}</div>}
      <div className="t-strong">{title}</div>
      {body && <div className="t-label text-fg2 mt-1 max-w-[280px]">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx('skeleton', className)} style={style} aria-hidden />;
}

export function SkeletonList({ rows = 6, tall }: { rows?: number; tall?: boolean }) {
  return (
    <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle overflow-hidden" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cx('flex items-center gap-3 px-4', tall ? 'h-[72px]' : 'h-14')}>
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-1/4" /></div>
          <Skeleton className="h-6 w-10" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ n = 3, h = 120 }: { n?: number; h?: number }) {
  return <div className="space-y-3">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="rounded-[12px]" style={{ height: h }} />)}</div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.code === 'OFFLINE';
  return (
    <EmptyState
      icon={offline ? <WifiOff size={24} /> : <AlertTriangle size={24} />}
      title={offline ? 'You are offline' : e?.code === 'NOT_FOUND' ? 'Not found' : 'Something went wrong'}
      body={offline ? 'Reconnect and try again. Screens you opened before still work from the cache.' : e?.message ?? String((error as Error)?.message ?? error)}
      action={onRetry && <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={onRetry}>Try again</Button>}
    />
  );
}

/** Loading / error / loaded in one place. */
export function Q<T>({ q, skeleton, children }: { q: UseQueryResult<T>; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  if (q.isPending) return <>{skeleton ?? <SkeletonList />}</>;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{children(q.data as T)}</>;
}

// ---------------------------------------------------------------- inputs
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 rounded-full transition-colors shrink-0 disabled:opacity-40', checked ? 'bg-accent' : 'bg-input border border-subtle')}>
      <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-fg transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} style={checked ? { background: 'var(--accent-contrast)' } : undefined} />
    </button>
  );
}

export function Stepper({ value, onChange, min, max, label }: { value: number; onChange: (v: number) => void; min: number; max: number; label?: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <button type="button" aria-label="Decrease" className="h-9 w-9 rounded-lg bg-input text-lg disabled:opacity-40" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="t-num w-6 text-center">{value}</span>
      <button type="button" aria-label="Increase" className="h-9 w-9 rounded-lg bg-input text-lg disabled:opacity-40" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block mb-4">
      <div className="t-label text-fg2 mb-1.5">{label}</div>
      {children}
      {hint && <div className="t-label text-fg3 mt-1">{hint}</div>}
    </label>
  );
}

export const inputCls = 'w-full h-12 px-3.5 rounded-[8px] bg-input border border-subtle text-fg placeholder:text-fg3 outline-none focus:border-accent';

export function Select<T extends string | number>({ value, onChange, options, className, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; ariaLabel?: string }) {
  return (
    <select aria-label={ariaLabel} className={cx(inputCls, 'appearance-none pr-8 bg-[length:16px] bg-no-repeat bg-[right_10px_center]', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239AA7B4' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      value={String(value)} onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}>
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------- bottom sheet
export function Sheet({ open, onClose, title, children, full, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; full?: boolean; footer?: ReactNode }) {
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  useEffect(() => { if (!open) setDy(0); }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center items-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 anim-fade" onClick={onClose} />
      <div className={cx('relative w-full max-w-[480px] bg-surface rounded-t-[20px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] anim-sheet flex flex-col border-t border-subtle', full ? 'h-[92vh]' : 'max-h-[88vh]')}
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: start.current === null ? 'transform 200ms' : undefined }}>
        <div className="pt-2 pb-1 touch-none cursor-grab"
          onPointerDown={(e) => { start.current = e.clientY; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (start.current !== null) setDy(Math.max(0, e.clientY - start.current)); }}
          onPointerUp={() => { if (dy > 90) onClose(); start.current = null; setDy(0); }}
          onPointerCancel={() => { start.current = null; setDy(0); }}>
          <div className="mx-auto h-1.5 w-10 rounded-full bg-subtle" />
        </div>
        {title && (
          <div className="flex items-center gap-2 px-4 pb-2">
            <div className="t-title2 flex-1 min-w-0 truncate">{title}</div>
            <IconButton label="Close" onClick={onClose} className="-mr-2"><X size={20} /></IconButton>
          </div>
        )}
        <div className="overflow-y-auto overscroll-contain px-4 pb-4 flex-1">{children}</div>
        {footer && <div className="px-4 pt-3 border-t border-subtle" style={{ paddingBottom: 'calc(12px + var(--safe-bottom))' }}>{footer}</div>}
        {!footer && <div style={{ height: 'var(--safe-bottom)' }} />}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- toasts and confirm
interface ToastMsg { id: number; text: string; tone: 'info' | 'success' | 'error' }
const ToastCtx = createContext<(text: string, tone?: ToastMsg['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);
  const show = useCallback((text: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {createPortal(
        <div className="fixed left-0 right-0 z-[60] mx-auto max-w-[480px] px-4 pointer-events-none flex flex-col gap-2" style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 12px)' }} aria-live="polite">
          {list.map((t) => (
            <div key={t.id} className="anim-toast pointer-events-auto rounded-xl px-4 py-3 t-label shadow-lg border border-subtle bg-raised flex items-center gap-2">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.tone === 'success' ? 'var(--positive)' : t.tone === 'error' ? 'var(--negative)' : 'var(--info)' }} />
              <span className="flex-1">{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

interface ConfirmOpts { title: string; body?: ReactNode; confirm?: string; destructive?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Sheet open={!!state} onClose={() => done(false)} title={state?.title}
        footer={<div className="flex gap-2"><Button variant="secondary" full onClick={() => done(false)}>Cancel</Button><Button variant={state?.destructive ? 'destructive' : 'primary'} full onClick={() => done(true)}>{state?.confirm ?? 'Confirm'}</Button></div>}>
        {state?.body && <div className="t-body text-fg2 pb-2">{state.body}</div>}
      </Sheet>
    </ConfirmCtx.Provider>
  );
}
