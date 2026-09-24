// Timezone-aware calendar helpers (no dependencies; relies on Intl with full ICU, standard in Node).

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; ss: number; wd: number }

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export function localParts(date: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    hh: Number(parts.hour) % 24, mm: Number(parts.minute), ss: Number(parts.second), wd: WD[parts.weekday] ?? 0,
  };
}

function offsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Wall-clock time in a zone -> UTC instant. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetMinutes(new Date(guess), tz);
  let t = guess - off1 * 60000;
  const off2 = offsetMinutes(new Date(t), tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}

/** A plain calendar date (no time) used by the fixture planner. */
export interface CalDate { y: number; m: number; d: number }

export function calDate(date: Date, tz: string): CalDate {
  const p = localParts(date, tz);
  return { y: p.y, m: p.m, d: p.d };
}

export function addDays(c: CalDate, n: number): CalDate {
  const t = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function weekday(c: CalDate): number {
  return new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
}

export function calKey(c: CalDate): string {
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

export function atTime(c: CalDate, hhmm: string, tz: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  return zonedToUtc(c.y, c.m, c.d, hh || 0, mm || 0, tz);
}

export function nextWeekday(from: CalDate, wd: number, minDays = 0): CalDate {
  let c = addDays(from, minDays);
  for (let i = 0; i < 8; i++) {
    if (weekday(c) === wd) return c;
    c = addDays(c, 1);
  }
  return c;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
