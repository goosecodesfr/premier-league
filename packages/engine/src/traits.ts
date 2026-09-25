// Signature traits ("PlayStyles"): what a player is known for, taken from real player data where
// available and derived from attributes for generated players. Each trait changes behaviour and
// outcomes inside the match engine; level 2 is the elite ("+") version.
import type { Attributes } from './attributes.ts';
import type { Familiarity } from './positions.ts';
import type { Rng } from './rng.ts';

export type TraitKey =
  | 'finesse_shot' | 'power_shot' | 'low_driven_shot' | 'chip_shot' | 'acrobatic' | 'gamechanger' | 'precision_header' | 'dead_ball'
  | 'incisive_pass' | 'pinged_pass' | 'long_ball_pass' | 'tiki_taka' | 'whipped_pass' | 'inventive'
  | 'technical' | 'trickster' | 'rapid' | 'quick_step' | 'first_touch' | 'press_proven'
  | 'intercept' | 'anticipate' | 'jockey' | 'slide_tackle' | 'block' | 'bruiser' | 'aerial_fortress' | 'enforcer'
  | 'relentless' | 'long_throw'
  | 'far_reach' | 'footwork' | 'cross_claimer' | 'rush_out' | 'far_throw' | 'deflector';

export type TraitGroup = 'shooting' | 'passing' | 'ball' | 'defending' | 'physical' | 'goalkeeping';

export interface TraitDef {
  key: TraitKey;
  name: string;
  group: TraitGroup;
  /** What the player does. */
  desc: string;
  /** What changes in the match engine, in plain words. */
  effect: string;
  gk?: boolean;
}

const T = (d: TraitDef) => d;

export const TRAITS: Record<TraitKey, TraitDef> = {
  finesse_shot: T({ key: 'finesse_shot', name: 'Finesse Shot', group: 'shooting', desc: 'Curls the ball into the corner.', effect: 'Shoots more from the edge of the box and scores far more often from there and from wide angles.' }),
  power_shot: T({ key: 'power_shot', name: 'Power Shot', group: 'shooting', desc: 'Hits the ball with ferocious power.', effect: 'Long shots are more dangerous and harder to save; tries them more often.' }),
  low_driven_shot: T({ key: 'low_driven_shot', name: 'Low Driven Shot', group: 'shooting', desc: 'Drills low, hard shots across the keeper.', effect: 'Better conversion of chances inside the box.' }),
  chip_shot: T({ key: 'chip_shot', name: 'Chip Shot', group: 'shooting', desc: 'Dinks it over the keeper when through.', effect: 'Scores more one-on-ones.' }),
  acrobatic: T({ key: 'acrobatic', name: 'Acrobatic', group: 'shooting', desc: 'Volleys and scissor kicks.', effect: 'Finishes crosses and loose balls in the box better.' }),
  gamechanger: T({ key: 'gamechanger', name: 'Gamechanger', group: 'shooting', desc: 'Produces moments of magic when it matters.', effect: 'Shoots and dribbles better in the last 20 minutes and when his side is behind.' }),
  precision_header: T({ key: 'precision_header', name: 'Precision Header', group: 'shooting', desc: 'Places headers with accuracy.', effect: 'Headed chances are converted more often.' }),
  dead_ball: T({ key: 'dead_ball', name: 'Dead Ball', group: 'shooting', desc: 'A set-piece specialist.', effect: 'Better corners, free-kick deliveries, direct free kicks and penalties.' }),
  incisive_pass: T({ key: 'incisive_pass', name: 'Incisive Pass', group: 'passing', desc: 'Threads balls between defenders.', effect: 'Tries more through balls and completes more of them.' }),
  pinged_pass: T({ key: 'pinged_pass', name: 'Pinged Pass', group: 'passing', desc: 'Fizzes quick, driven passes.', effect: 'Moves the ball forward faster; long passes arrive before defenders can react.' }),
  long_ball_pass: T({ key: 'long_ball_pass', name: 'Long Ball Pass', group: 'passing', desc: 'Accurate over long distances and switches of play.', effect: 'Long passes and switches are completed far more often.' }),
  tiki_taka: T({ key: 'tiki_taka', name: 'Tiki Taka', group: 'passing', desc: 'Quick one-touch combinations.', effect: 'Keeps the ball under pressure; short passes rarely go astray.' }),
  whipped_pass: T({ key: 'whipped_pass', name: 'Whipped Pass', group: 'passing', desc: 'Whips dangerous balls into the box.', effect: 'Crosses find a teammate more often and lead to better headed chances.' }),
  inventive: T({ key: 'inventive', name: 'Inventive', group: 'passing', desc: 'Tries the unexpected.', effect: 'Creates more chances from nothing, with slightly more risk.' }),
  technical: T({ key: 'technical', name: 'Technical', group: 'ball', desc: 'Superb close control.', effect: 'Wins more dribbles and carries the ball more.' }),
  trickster: T({ key: 'trickster', name: 'Trickster', group: 'ball', desc: 'Flicks and tricks to beat his man.', effect: 'Beats defenders more often and wins more fouls.' }),
  rapid: T({ key: 'rapid', name: 'Rapid', group: 'ball', desc: 'Blistering pace with the ball.', effect: 'Much more dangerous in space, on the counter and running in behind.' }),
  quick_step: T({ key: 'quick_step', name: 'Quick Step', group: 'ball', desc: 'Explosive first few yards.', effect: 'Gets away from markers: better dribbles and runs in behind.' }),
  first_touch: T({ key: 'first_touch', name: 'First Touch', group: 'ball', desc: 'Kills any ball dead.', effect: 'Passes to him are completed more often; holds the ball up better.' }),
  press_proven: T({ key: 'press_proven', name: 'Press Proven', group: 'ball', desc: 'Calm when pressed.', effect: 'Opposition pressing barely affects him; loses the ball less.' }),
  intercept: T({ key: 'intercept', name: 'Intercept', group: 'defending', desc: 'Reads passes and steps in.', effect: 'Intercepts far more passes and through balls.' }),
  anticipate: T({ key: 'anticipate', name: 'Anticipate', group: 'defending', desc: 'Always a step ahead.', effect: 'Better tackles and interceptions with fewer fouls.' }),
  jockey: T({ key: 'jockey', name: 'Jockey', group: 'defending', desc: 'Stays on his feet and shepherds attackers.', effect: 'Stops dribblers more often and commits fewer fouls.' }),
  slide_tackle: T({ key: 'slide_tackle', name: 'Slide Tackle', group: 'defending', desc: 'Goes to ground to win it.', effect: 'Wins more tackles, but gives away more fouls and cards.' }),
  block: T({ key: 'block', name: 'Block', group: 'defending', desc: 'Throws himself in front of shots.', effect: 'Blocks more shots when he is in the area.' }),
  bruiser: T({ key: 'bruiser', name: 'Bruiser', group: 'defending', desc: 'Physically dominant in duels.', effect: 'Wins more physical duels and aerial battles.' }),
  aerial_fortress: T({ key: 'aerial_fortress', name: 'Aerial Fortress', group: 'defending', desc: 'Dominant in the air.', effect: 'Wins far more headers at both ends.' }),
  enforcer: T({ key: 'enforcer', name: 'Enforcer', group: 'physical', desc: 'Uses his body to shield and barge.', effect: 'Holds off defenders and wins shoulder-to-shoulder duels.' }),
  relentless: T({ key: 'relentless', name: 'Relentless', group: 'physical', desc: 'Never stops running.', effect: 'Tires much more slowly, even when pressing.' }),
  long_throw: T({ key: 'long_throw', name: 'Long Throw', group: 'physical', desc: 'Launches throw-ins into the box.', effect: 'Throw-ins near the box become crosses.' }),
  far_reach: T({ key: 'far_reach', name: 'Far Reach', group: 'goalkeeping', gk: true, desc: 'Gets to shots in the corners.', effect: 'Saves more shots from distance.' }),
  footwork: T({ key: 'footwork', name: 'Footwork', group: 'goalkeeping', gk: true, desc: 'Quick feet for close-range saves.', effect: 'Saves more shots from inside the box.' }),
  cross_claimer: T({ key: 'cross_claimer', name: 'Cross Claimer', group: 'goalkeeping', gk: true, desc: 'Commands his area.', effect: 'Claims many more crosses.' }),
  rush_out: T({ key: 'rush_out', name: 'Rush Out', group: 'goalkeeping', gk: true, desc: 'Races off his line.', effect: 'Sweeps up through balls and wins more one-on-ones.' }),
  far_throw: T({ key: 'far_throw', name: 'Far Throw', group: 'goalkeeping', gk: true, desc: 'Launches counters with his throws.', effect: 'His side counter-attacks more often after he gathers the ball.' }),
  deflector: T({ key: 'deflector', name: 'Deflector', group: 'goalkeeping', gk: true, desc: 'Parries safely away from danger.', effect: 'Concedes far fewer rebounds.' }),
};

export const TRAIT_KEYS = Object.keys(TRAITS) as TraitKey[];
export type Traits = Partial<Record<TraitKey, number>>; // 1 = normal, 2 = elite (+)

const DATASET_NAMES: Record<string, TraitKey> = Object.fromEntries(
  TRAIT_KEYS.map((k) => [TRAITS[k].name.toLowerCase(), k]),
);

/** Parse a dataset PlayStyles string such as "Finesse Shot +, Low Driven Shot, Technical". */
export function parseDatasetTraits(s: string | undefined | null): Traits {
  const out: Traits = {};
  for (const raw of (s ?? '').split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const plus = t.endsWith('+');
    const key = DATASET_NAMES[t.replace(/\+$/, '').trim().toLowerCase()];
    if (key) out[key] = Math.max(out[key] ?? 0, plus ? 2 : 1);
  }
  return out;
}

/** Engine multiplier for a trait level: 0 (absent), 1 (normal), 1.5 (elite). */
export function traitPower(level: number | undefined): number {
  return !level ? 0 : level >= 2 ? 1.5 : 1;
}

/**
 * Traits for generated players, from their standout attributes. Better players have more traits;
 * average squad players have at most one.
 */
export function deriveTraits(a: Attributes, fam: Familiarity, ca: number, rng: Rng): Traits {
  const isGk = (fam.GK ?? 0) >= 0.8;
  const cands: [TraitKey, number][] = [];
  const add = (k: TraitKey, score: number) => { if (score > 0) cands.push([k, score]); };
  if (isGk) {
    add('far_reach', a.shotStopping + a.agility - 300);
    add('footwork', a.reflexes + a.agility - 300);
    add('cross_claimer', a.commandOfArea + a.aerialReach - 300);
    add('rush_out', a.rushingOut + a.oneOnOnes - 300);
    add('far_throw', a.distribution + a.decisions - 300);
    add('deflector', a.handling + a.reflexes - 300);
  } else {
    add('finesse_shot', a.finishing + a.longShots + a.flair - 450);
    add('power_shot', a.longShots + a.strength - 300);
    add('low_driven_shot', a.finishing + a.composure - 310);
    add('chip_shot', a.finishing + a.flair + a.composure - 470);
    add('acrobatic', a.agility + a.flair + a.finishing - 470);
    add('gamechanger', a.flair + a.composure + a.finishing - 480);
    add('precision_header', a.heading + a.jumping - 300);
    add('dead_ball', a.setPieces * 2 - 300);
    add('incisive_pass', a.vision + a.passing - 305);
    add('pinged_pass', a.passing + a.decisions - 305);
    add('long_ball_pass', a.passing + a.vision - 300);
    add('tiki_taka', a.passing + a.firstTouch + a.teamwork - 460);
    add('whipped_pass', a.crossing * 2 - 300);
    add('inventive', a.flair + a.vision - 305);
    add('technical', a.dribbling + a.firstTouch - 305);
    add('trickster', a.dribbling + a.flair + a.agility - 470);
    add('rapid', a.pace + a.acceleration - 310);
    add('quick_step', a.acceleration * 2 - 310);
    add('first_touch', a.firstTouch * 2 - 310);
    add('press_proven', a.composure + a.firstTouch + a.balance - 460);
    add('intercept', a.anticipation + a.positioning - 300);
    add('anticipate', a.anticipation + a.decisions - 300);
    add('jockey', a.tackling + a.positioning + a.concentration - 460);
    add('slide_tackle', a.tackling + a.aggression - 300);
    add('block', a.bravery + a.positioning - 300);
    add('bruiser', a.strength + a.aggression - 300);
    add('aerial_fortress', a.heading + a.jumping + a.strength - 460);
    add('enforcer', a.strength + a.balance - 300);
    add('relentless', a.stamina + a.workRate - 310);
    add('long_throw', a.strength - 160);
  }
  const max = ca >= 165 ? 4 : ca >= 150 ? 3 : ca >= 135 ? 2 : ca >= 115 ? 1 : 0;
  const out: Traits = {};
  cands.sort((x, y) => y[1] - x[1]);
  let n = 0;
  for (const [k, score] of cands) {
    if (n >= max) break;
    if (!rng.chance(Math.min(0.85, 0.2 + score / 60))) continue;
    out[k] = score > 45 && ca >= 160 && rng.chance(0.25) ? 2 : 1;
    n++;
  }
  return out;
}

export function traitList(t: Traits | null | undefined): { key: TraitKey; level: number; name: string; desc: string; effect: string; group: TraitGroup }[] {
  return (Object.entries(t ?? {}) as [TraitKey, number][])
    .filter(([k, v]) => TRAITS[k] && v > 0)
    .sort((a, b) => b[1] - a[1] || TRAITS[a[0]].name.localeCompare(TRAITS[b[0]].name))
    .map(([k, v]) => ({ key: k, level: v, name: TRAITS[k].name + (v >= 2 ? '+' : ''), desc: TRAITS[k].desc, effect: TRAITS[k].effect, group: TRAITS[k].group }));
}
