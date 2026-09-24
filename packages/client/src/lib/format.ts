// One formatting module: money, dates, ratings, thresholds. No ad-hoc toFixed in components.
export function money(v: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  const a = Math.abs(v);
  let s: string;
  if (a >= 1_000_000_000) s = `£${(a / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}bn`;
  else if (a >= 1_000_000) s = `£${(a / 1_000_000).toFixed(a >= 100_000_000 ? 0 : 1).replace(/\.0$/, '')}m`;
  else if (a >= 1000) s = `£${Math.round(a / 1000)}k`;
  else s = `£${Math.round(a)}`;
  if (v < 0) return `-${s}`;
  return opts.sign ? `+${s}` : s;
}
export const wage = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${money(v)}/wk`);

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const dtf = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o);
const F_DAY = dtf({ weekday: 'short', day: 'numeric', month: 'short' });
const F_TIME = dtf({ hour: '2-digit', minute: '2-digit' });
const F_DATE = dtf({ day: 'numeric', month: 'short', year: 'numeric' });
const F_SHORT = dtf({ day: 'numeric', month: 'short' });

export const kickoff = (iso: string) => `${F_DAY.format(new Date(iso))}, ${F_TIME.format(new Date(iso))}`;
export const dayLabel = (iso: string) => F_DAY.format(new Date(iso));
export const timeLabel = (iso: string) => F_TIME.format(new Date(iso));
export const dateLabel = (iso: string) => F_DATE.format(new Date(iso));
export const shortDate = (iso: string) => F_SHORT.format(new Date(iso));

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return shortDate(iso);
}

export function countdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function inWords(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}

export type Tone = 'positive' | 'warning' | 'negative' | 'info' | 'neutral';
export const conditionTone = (c: number): Tone => (c >= 85 ? 'positive' : c >= 70 ? 'warning' : 'negative');
export const sharpnessTone = (c: number): Tone => (c >= 80 ? 'positive' : c >= 55 ? 'warning' : 'negative');
export const ratingTone = (r: number | null | undefined): Tone => (r === null || r === undefined ? 'neutral' : r >= 7 ? 'positive' : r >= 6 ? 'warning' : 'negative');
export const moraleTone = (m: string): Tone => (m === 'good' || m === 'very good' ? 'positive' : m === 'okay' ? 'warning' : 'negative');
export const contractTone = (yearsLeft: number): Tone => (yearsLeft >= 2 ? 'positive' : yearsLeft === 1 ? 'warning' : 'negative');
export const toneVar = (t: Tone) => (t === 'neutral' ? 'var(--text-secondary)' : `var(--${t})`);
export const toneText = (t: Tone) => ({ positive: 'text-positive', warning: 'text-warning', negative: 'text-negative', info: 'text-info', neutral: 'text-fg2' })[t];

export const rating1 = (r: number | null | undefined) => (r === null || r === undefined ? '-' : r.toFixed(1));
export const ovr = (v: number) => v.toFixed(1);
export const pct = (v: number, digits = 0) => `${v.toFixed(digits)}%`;

export function contractLabel(yearsLeft: number, seasonLabel?: string): string {
  if (yearsLeft <= 0) return 'Expires this season';
  if (yearsLeft === 1) return 'Expires next season';
  return `${yearsLeft + 1} seasons left${seasonLabel ? '' : ''}`;
}

export const POS_ORDER = ['GK', 'DR', 'DC', 'DL', 'WBR', 'WBL', 'DM', 'MR', 'MC', 'ML', 'AMR', 'AMC', 'AML', 'ST'];
export const LINE_OF: Record<string, 'GK' | 'DEF' | 'MID' | 'ATT'> = {
  GK: 'GK', DC: 'DEF', DL: 'DEF', DR: 'DEF', WBL: 'DEF', WBR: 'DEF', DM: 'MID', MC: 'MID', ML: 'MID', MR: 'MID', AMC: 'MID', AML: 'ATT', AMR: 'ATT', ST: 'ATT',
};
export const LINE_COLOR: Record<string, string> = { GK: '#F5A524', DEF: '#4C9AFF', MID: '#3DD68C', ATT: '#F0516D' };

export const COMP_COLOR: Record<string, string> = {
  league: '#8B5CF6', fa_cup: '#F0516D', league_cup: '#3DD68C', ucl: '#4C9AFF', uel: '#F5A524', shield: '#9AA7B4', super_cup: '#22D3EE',
};
export const COMP_SHORT: Record<string, string> = { league: 'PL', fa_cup: 'FA', league_cup: 'LC', ucl: 'UCL', uel: 'UEL', shield: 'CS', super_cup: 'USC' };

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
