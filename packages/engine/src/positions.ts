// Positions and familiarity.

export const POSITIONS = [
  'GK', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST',
] as const;
export type Pos = (typeof POSITIONS)[number];

export type Line = 'GK' | 'DEF' | 'MID' | 'ATT';

export const POS_LINE: Record<Pos, Line> = {
  GK: 'GK', DL: 'DEF', DC: 'DEF', DR: 'DEF', WBL: 'DEF', WBR: 'DEF',
  DM: 'MID', ML: 'MID', MC: 'MID', MR: 'MID', AML: 'ATT', AMC: 'MID', AMR: 'ATT', ST: 'ATT',
};

export const POS_LABEL: Record<Pos, string> = {
  GK: 'Goalkeeper', DL: 'Left back', DC: 'Centre-back', DR: 'Right back', WBL: 'Left wing-back',
  WBR: 'Right wing-back', DM: 'Defensive midfielder', ML: 'Left midfielder', MC: 'Central midfielder',
  MR: 'Right midfielder', AML: 'Left winger', AMC: 'Attacking midfielder', AMR: 'Right winger', ST: 'Striker',
};

/** Short badge label used in UI. */
export const POS_SHORT: Record<Pos, string> = {
  GK: 'GK', DL: 'LB', DC: 'CB', DR: 'RB', WBL: 'LWB', WBR: 'RWB', DM: 'DM', ML: 'LM', MC: 'CM',
  MR: 'RM', AML: 'LW', AMC: 'AM', AMR: 'RW', ST: 'ST',
};

export type Familiarity = Partial<Record<Pos, number>>;

/** Symmetric-ish adjacency: how familiar a natural player of A is at B. */
const ADJ: [Pos, Pos, number][] = [
  ['DC', 'DM', 0.5], ['DM', 'DC', 0.55],
  ['DL', 'WBL', 0.85], ['WBL', 'DL', 0.8], ['DR', 'WBR', 0.85], ['WBR', 'DR', 0.8],
  ['DL', 'DC', 0.45], ['DR', 'DC', 0.45], ['DC', 'DL', 0.4], ['DC', 'DR', 0.4],
  ['WBL', 'ML', 0.75], ['ML', 'WBL', 0.6], ['WBR', 'MR', 0.75], ['MR', 'WBR', 0.6],
  ['DL', 'ML', 0.5], ['DR', 'MR', 0.5],
  ['ML', 'AML', 0.85], ['AML', 'ML', 0.8], ['MR', 'AMR', 0.85], ['AMR', 'MR', 0.8],
  ['MC', 'DM', 0.8], ['DM', 'MC', 0.8], ['MC', 'AMC', 0.75], ['AMC', 'MC', 0.7],
  ['AMC', 'ST', 0.6], ['ST', 'AMC', 0.55], ['AML', 'ST', 0.5], ['AMR', 'ST', 0.5],
  ['ST', 'AML', 0.45], ['ST', 'AMR', 0.45], ['AML', 'AMC', 0.6], ['AMR', 'AMC', 0.6],
  ['AMC', 'AML', 0.55], ['AMC', 'AMR', 0.55], ['ML', 'MC', 0.55], ['MR', 'MC', 0.55], ['MC', 'ML', 0.5], ['MC', 'MR', 0.5],
];

const MIRROR: Partial<Record<Pos, Pos>> = {
  DL: 'DR', DR: 'DL', WBL: 'WBR', WBR: 'WBL', ML: 'MR', MR: 'ML', AML: 'AMR', AMR: 'AML',
};

/**
 * Build a familiarity map from an ordered list of listed positions (first = natural).
 * Adds adjacent positions and the mirrored flank at a discount (bigger discount for one-footed players).
 */
export function deriveFamiliarity(listed: Pos[], foot: 'L' | 'R' | 'B' = 'R'): Familiarity {
  const fam: Familiarity = {};
  const set = (p: Pos, v: number) => {
    if ((fam[p] ?? 0) < v) fam[p] = Math.round(v * 100) / 100;
  };
  listed.forEach((p, i) => set(p, i === 0 ? 1 : Math.max(0.85, 0.97 - i * 0.03)));
  for (const p of listed) {
    const base = fam[p] ?? 0;
    for (const [a, b, v] of ADJ) if (a === p) set(b, base * v);
    const m = MIRROR[p];
    if (m) set(m, base * (foot === 'B' ? 0.85 : 0.65));
  }
  // second pass for mirrored adjacencies (e.g. natural AMR gets some AML/ML familiarity)
  for (const p of Object.keys(fam) as Pos[]) {
    const m = MIRROR[p];
    if (m) set(m, (fam[p] ?? 0) * (foot === 'B' ? 0.85 : 0.6));
  }
  return fam;
}

export function naturalPositions(fam: Familiarity, threshold = 0.84): Pos[] {
  return (Object.entries(fam) as [Pos, number][])
    .filter(([, v]) => v >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
}

export function bestPosition(fam: Familiarity): Pos {
  let best: Pos = 'MC';
  let bv = -1;
  for (const [p, v] of Object.entries(fam) as [Pos, number][]) if (v > bv) { bv = v; best = p; }
  return best;
}

/** Map an editor coordinate (x 0..100 left->right, y 0..100 own goal->their goal) to a position code. */
export function posFromXY(x: number, y: number): Pos {
  if (y < 12) return 'GK';
  const side = x < 30 ? 'L' : x > 70 ? 'R' : 'C';
  if (y < 30) return side === 'L' ? 'DL' : side === 'R' ? 'DR' : 'DC';
  if (y < 42) {
    if (side === 'L') return 'WBL';
    if (side === 'R') return 'WBR';
    return 'DM';
  }
  if (y < 60) return side === 'L' ? 'ML' : side === 'R' ? 'MR' : 'MC';
  if (y < 76) return side === 'L' ? 'AML' : side === 'R' ? 'AMR' : 'AMC';
  return side === 'C' ? 'ST' : side === 'L' ? 'AML' : 'AMR';
}

/** Lines ordered from defence to attack, for grouping in UI. */
export const LINE_ORDER: Line[] = ['GK', 'DEF', 'MID', 'ATT'];
