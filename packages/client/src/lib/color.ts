// Club accent handling: contrast-checked against the surface colour, with a readable text colour on top.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function lum([r, g, b]: [number, number, number]): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const la = lum(hexToRgb(a));
  const lb = lum(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const m = (c: number) => Math.round(c + (255 - c) * amt).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}
const SURFACE = '#151A20';

/** Pick an accent that reads on the dark surface: primary, else secondary, else a lightened primary. */
export function pickAccent(colors: [string, string] | null | undefined): { accent: string; contrast: string } {
  const [p, s] = colors ?? ['#4C9AFF', '#FFFFFF'];
  let accent = p;
  if (contrast(p, SURFACE) < 3) {
    if (s && contrast(s, SURFACE) >= 3) accent = s;
    else { let a = p; for (let i = 1; i <= 10 && contrast(a, SURFACE) < 3; i++) a = lighten(p, i * 0.1); accent = a; }
  }
  const on = contrast(accent, '#0B0E11') >= contrast(accent, '#FFFFFF') ? '#0B0E11' : '#FFFFFF';
  return { accent, contrast: on };
}

export function applyAccent(colors: [string, string] | null | undefined) {
  const { accent, contrast: on } = pickAccent(colors);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-contrast', on);
}

/** Readable text colour on an arbitrary club colour (for crests). */
export function onColor(bg: string): string {
  return contrast(bg, '#0B0E11') >= contrast(bg, '#FFFFFF') ? '#0B0E11' : '#FFFFFF';
}
