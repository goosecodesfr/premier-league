import { useEffect, useRef, useState } from 'react';

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const call = (...args: A) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => f.current(...args), ms);
  };
  const flush = (...args: A) => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
    f.current(...args);
  };
  return { call, flush, pending: () => t.current !== null };
}

export function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  const set = (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* private mode */ } };
  return [v, set];
}
