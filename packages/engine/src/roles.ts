// Roles and duties: the tactical vocabulary. Each role rewrites both the player's
// role-rating weights and his behaviour inside the match engine.
import type { AttrKey } from './attributes.ts';
import type { Pos } from './positions.ts';

export type Duty = 'D' | 'S' | 'A';
export const DUTY_LABEL: Record<Duty, string> = { D: 'Defend', S: 'Support', A: 'Attack' };

export type ActionType = 'short' | 'long' | 'through' | 'dribble' | 'cross' | 'shoot' | 'hold';

export type RoleKey =
  | 'GK' | 'SK'
  | 'CD' | 'BPD' | 'NCB' | 'LIB'
  | 'FB' | 'WB' | 'IFB'
  | 'A' | 'DLP' | 'BWM' | 'HB'
  | 'CM' | 'BBM' | 'MEZ' | 'RPM'
  | 'AM' | 'AP' | 'SS' | 'ENG'
  | 'W' | 'IW' | 'WP' | 'WTM'
  | 'AF' | 'TM' | 'P' | 'F9' | 'CF' | 'PF';

export interface RoleDef {
  key: RoleKey;
  name: string;
  positions: Pos[];
  duties: Duty[];
  defaultDuty: Duty;
  desc: string;
  weights: Partial<Record<AttrKey, number>>;
  /** Forward shift in possession (bands) for D/S/A duty. */
  adv: [number, number, number];
  /** Extra retreat out of possession (bands). */
  drop: number;
  /** Longitudinal mobility (spread multiplier). */
  roam: number;
  /** Lateral drift toward centre in possession (negative = hugs the line). */
  inside: number;
  /** Involvement weight in possession. */
  inv: number;
  /** Involvement in defensive duels. */
  dinv: number;
  /** Pressing contribution. */
  press: number;
  /** Fatigue multiplier. */
  workload: number;
  /** Action tendency multipliers. */
  tend: Partial<Record<ActionType, number>>;
}

const R = (d: RoleDef) => d;

export const ROLES: Record<RoleKey, RoleDef> = {
  GK: R({
    key: 'GK', name: 'Goalkeeper', positions: ['GK'], duties: ['D'], defaultDuty: 'D',
    desc: 'Stays on his line, saves shots and distributes safely.',
    weights: { shotStopping: 3, reflexes: 3, handling: 2, aerialReach: 1.5, oneOnOnes: 1.5, commandOfArea: 1.5, positioning: 1.5, concentration: 1, decisions: 1, distribution: 0.5, agility: 1 },
    adv: [0, 0, 0], drop: 0, roam: 0.4, inside: 0, inv: 0.35, dinv: 0.2, press: 0, workload: 0.3,
    tend: { short: 1, long: 1.2, through: 0, dribble: 0, cross: 0, shoot: 0, hold: 0 },
  }),
  SK: R({
    key: 'SK', name: 'Sweeper Keeper', positions: ['GK'], duties: ['D', 'S', 'A'], defaultDuty: 'S',
    desc: 'Sweeps behind a high line and starts attacks with his feet.',
    weights: { shotStopping: 2.5, reflexes: 2.5, handling: 1.5, oneOnOnes: 2, rushingOut: 2, distribution: 1.5, passing: 1, composure: 1, commandOfArea: 1, positioning: 1, acceleration: 0.5, decisions: 1 },
    adv: [0.1, 0.25, 0.4], drop: 0, roam: 0.5, inside: 0, inv: 0.55, dinv: 0.3, press: 0, workload: 0.35,
    tend: { short: 1.4, long: 0.8, through: 0.2, dribble: 0, cross: 0, shoot: 0, hold: 0 },
  }),
  CD: R({
    key: 'CD', name: 'Central Defender', positions: ['DC'], duties: ['D', 'S'], defaultDuty: 'D',
    desc: 'Wins the ball, holds his position and keeps it simple.',
    weights: { tackling: 3, marking: 3, positioning: 3, heading: 2, strength: 1.5, jumping: 1.5, anticipation: 1.5, concentration: 1.5, decisions: 1, bravery: 1, pace: 1, composure: 0.5 },
    adv: [0, 0.15, 0.3], drop: 0, roam: 0.6, inside: 0, inv: 0.8, dinv: 1.2, press: 0.4, workload: 0.85,
    tend: { short: 1, long: 1, through: 0.2, dribble: 0.2, cross: 0, shoot: 0.1, hold: 0 },
  }),
  BPD: R({
    key: 'BPD', name: 'Ball-playing Defender', positions: ['DC'], duties: ['D', 'S'], defaultDuty: 'D',
    desc: 'Defends first, then breaks lines with passes into midfield.',
    weights: { tackling: 2.5, marking: 2.5, positioning: 2.5, heading: 1.5, passing: 2, vision: 1, composure: 2, firstTouch: 1, anticipation: 1.5, concentration: 1, decisions: 1.5, strength: 1, pace: 1 },
    adv: [0, 0.2, 0.35], drop: 0, roam: 0.65, inside: 0, inv: 1.05, dinv: 1.1, press: 0.4, workload: 0.85,
    tend: { short: 1.1, long: 1.5, through: 0.5, dribble: 0.3, cross: 0, shoot: 0.1, hold: 0 },
  }),
  NCB: R({
    key: 'NCB', name: 'No-nonsense Defender', positions: ['DC'], duties: ['D'], defaultDuty: 'D',
    desc: 'Heads it, kicks it, blocks it. Never takes a risk on the ball.',
    weights: { tackling: 3, marking: 3, heading: 3, strength: 2.5, jumping: 2, bravery: 2, aggression: 1, positioning: 2.5, concentration: 1 },
    adv: [0, 0, 0], drop: 0.1, roam: 0.5, inside: 0, inv: 0.55, dinv: 1.35, press: 0.3, workload: 0.8,
    tend: { short: 0.8, long: 1.8, through: 0, dribble: 0.05, cross: 0, shoot: 0.05, hold: 0 },
  }),
  LIB: R({
    key: 'LIB', name: 'Libero', positions: ['DC'], duties: ['S', 'A'], defaultDuty: 'S',
    desc: 'Steps out of the back line to carry the ball into midfield.',
    weights: { passing: 2, vision: 1.5, composure: 2, decisions: 2, anticipation: 2, dribbling: 1, firstTouch: 1.5, tackling: 2, marking: 2, positioning: 2, pace: 1 },
    adv: [0.5, 0.8, 1.2], drop: 0, roam: 1.2, inside: 0, inv: 1.2, dinv: 1.0, press: 0.5, workload: 1.0,
    tend: { short: 1.2, long: 1.2, through: 0.8, dribble: 0.9, cross: 0, shoot: 0.3, hold: 0 },
  }),
  FB: R({
    key: 'FB', name: 'Full-back', positions: ['DL', 'DR', 'WBL', 'WBR'], duties: ['D', 'S', 'A'], defaultDuty: 'S',
    desc: 'Balances defending the flank with support on the overlap.',
    weights: { tackling: 2, marking: 2, positioning: 2, pace: 2, stamina: 2, workRate: 1.5, crossing: 1.5, passing: 1, acceleration: 1.5, concentration: 1, teamwork: 1, decisions: 1 },
    adv: [0.3, 0.9, 1.5], drop: 0, roam: 1.0, inside: -0.1, inv: 0.95, dinv: 1.0, press: 0.8, workload: 1.1,
    tend: { short: 1.1, long: 0.9, through: 0.3, dribble: 0.6, cross: 1.2, shoot: 0.15, hold: 0 },
  }),
  WB: R({
    key: 'WB', name: 'Wing-back', positions: ['DL', 'DR', 'WBL', 'WBR'], duties: ['D', 'S', 'A'], defaultDuty: 'S',
    desc: 'Provides all the width, bombing forward to deliver crosses.',
    weights: { crossing: 2.5, dribbling: 1.5, pace: 2.5, stamina: 2.5, workRate: 2, acceleration: 2, tackling: 1.5, marking: 1, positioning: 1, offTheBall: 1, teamwork: 1, passing: 1 },
    adv: [0.8, 1.4, 2.0], drop: 0, roam: 1.3, inside: -0.25, inv: 1.1, dinv: 0.85, press: 0.9, workload: 1.3,
    tend: { short: 1, long: 0.7, through: 0.3, dribble: 1.0, cross: 1.8, shoot: 0.2, hold: 0 },
  }),
  IFB: R({
    key: 'IFB', name: 'Inverted Full-back', positions: ['DL', 'DR'], duties: ['D'], defaultDuty: 'D',
    desc: 'Tucks inside into midfield when his side has the ball.',
    weights: { passing: 2, composure: 1.5, decisions: 1.5, positioning: 2, tackling: 2, marking: 1.5, firstTouch: 1.5, vision: 1, teamwork: 1, pace: 1, anticipation: 1 },
    adv: [0.9, 0.9, 0.9], drop: 0, roam: 0.9, inside: 0.7, inv: 1.1, dinv: 1.0, press: 0.7, workload: 1.0,
    tend: { short: 1.4, long: 0.8, through: 0.5, dribble: 0.4, cross: 0.3, shoot: 0.2, hold: 0 },
  }),
  A: R({
    key: 'A', name: 'Anchor', positions: ['DM'], duties: ['D'], defaultDuty: 'D',
    desc: 'Sits in front of the defence and screens it.',
    weights: { positioning: 3, anticipation: 2.5, tackling: 2.5, marking: 2, concentration: 2, decisions: 1.5, strength: 1, teamwork: 1, composure: 1, passing: 1 },
    adv: [0, 0, 0], drop: 0.2, roam: 0.6, inside: 0, inv: 0.95, dinv: 1.3, press: 0.6, workload: 0.9,
    tend: { short: 1.4, long: 0.7, through: 0.3, dribble: 0.2, cross: 0, shoot: 0.2, hold: 0 },
  }),
  DLP: R({
    key: 'DLP', name: 'Deep-lying Playmaker', positions: ['DM', 'MC'], duties: ['D', 'S'], defaultDuty: 'S',
    desc: 'Dictates the tempo from deep with his range of passing.',
    weights: { passing: 3, vision: 3, composure: 2, decisions: 2, firstTouch: 2, teamwork: 1, positioning: 1, anticipation: 1, tackling: 0.5 },
    adv: [0.1, 0.35, 0.5], drop: 0.1, roam: 0.8, inside: 0, inv: 1.5, dinv: 0.8, press: 0.5, workload: 0.9,
    tend: { short: 1.2, long: 1.6, through: 1.6, dribble: 0.4, cross: 0.2, shoot: 0.3, hold: 0 },
  }),
  BWM: R({
    key: 'BWM', name: 'Ball-winning Midfielder', positions: ['DM', 'MC'], duties: ['D', 'S'], defaultDuty: 'D',
    desc: 'Harries opponents all over the pitch to win the ball back.',
    weights: { tackling: 3, aggression: 2, workRate: 2.5, stamina: 2, anticipation: 2, teamwork: 1.5, bravery: 1.5, strength: 1.5, positioning: 1, pace: 1 },
    adv: [0.1, 0.4, 0.6], drop: 0, roam: 1.3, inside: 0, inv: 0.85, dinv: 1.6, press: 1.4, workload: 1.2,
    tend: { short: 1.4, long: 0.6, through: 0.3, dribble: 0.4, cross: 0.1, shoot: 0.3, hold: 0 },
  }),
  HB: R({
    key: 'HB', name: 'Half-back', positions: ['DM'], duties: ['D'], defaultDuty: 'D',
    desc: 'Drops between the centre-backs to form a back three in possession.',
    weights: { positioning: 3, tackling: 2, marking: 2, anticipation: 2, passing: 2, composure: 2, decisions: 1.5, concentration: 1.5, heading: 1, strength: 1 },
    adv: [-0.5, -0.5, -0.5], drop: 0.4, roam: 0.6, inside: 0, inv: 1.1, dinv: 1.3, press: 0.4, workload: 0.9,
    tend: { short: 1.3, long: 1.2, through: 0.4, dribble: 0.2, cross: 0, shoot: 0.1, hold: 0 },
  }),
  CM: R({
    key: 'CM', name: 'Central Midfielder', positions: ['MC'], duties: ['D', 'S', 'A'], defaultDuty: 'S',
    desc: 'A balanced midfielder who links defence and attack.',
    weights: { passing: 2.5, decisions: 2, teamwork: 2, firstTouch: 1.5, vision: 1.5, tackling: 1.5, workRate: 1.5, stamina: 1.5, positioning: 1, composure: 1, anticipation: 1 },
    adv: [0.2, 0.6, 1.1], drop: 0, roam: 1.0, inside: 0, inv: 1.15, dinv: 1.0, press: 0.9, workload: 1.05,
    tend: { short: 1.3, long: 0.9, through: 0.8, dribble: 0.6, cross: 0.2, shoot: 0.6, hold: 0 },
  }),
  BBM: R({
    key: 'BBM', name: 'Box-to-box Midfielder', positions: ['MC'], duties: ['S'], defaultDuty: 'S',
    desc: 'Covers every blade of grass, arriving late in the box and tracking back.',
    weights: { stamina: 3, workRate: 2.5, passing: 2, tackling: 1.5, offTheBall: 1.5, teamwork: 1.5, dribbling: 1, finishing: 1, longShots: 1, decisions: 1.5, pace: 1, strength: 1 },
    adv: [0.7, 0.9, 1.1], drop: 0, roam: 1.7, inside: 0, inv: 1.15, dinv: 1.2, press: 1.2, workload: 1.3,
    tend: { short: 1.1, long: 0.8, through: 0.6, dribble: 0.9, cross: 0.2, shoot: 1.1, hold: 0 },
  }),
  MEZ: R({
    key: 'MEZ', name: 'Mezzala', positions: ['MC'], duties: ['S', 'A'], defaultDuty: 'S',
    desc: 'Drifts into the half-space to carry the ball and create.',
    weights: { dribbling: 2.5, passing: 2, vision: 1.5, offTheBall: 2, decisions: 1.5, firstTouch: 2, acceleration: 1.5, balance: 1, finishing: 1, flair: 1, workRate: 1 },
    adv: [0.7, 1.0, 1.4], drop: 0, roam: 1.3, inside: -0.35, inv: 1.2, dinv: 0.8, press: 0.9, workload: 1.1,
    tend: { short: 1.0, long: 0.6, through: 1.1, dribble: 1.4, cross: 0.6, shoot: 0.9, hold: 0 },
  }),
  RPM: R({
    key: 'RPM', name: 'Roaming Playmaker', positions: ['MC', 'DM'], duties: ['S'], defaultDuty: 'S',
    desc: 'Roams wherever the ball is to orchestrate play.',
    weights: { passing: 3, vision: 3, firstTouch: 2, dribbling: 1.5, decisions: 2, composure: 1.5, offTheBall: 1.5, stamina: 1.5, flair: 1, agility: 1 },
    adv: [0.6, 0.8, 1.0], drop: 0, roam: 1.6, inside: 0, inv: 1.55, dinv: 0.8, press: 0.8, workload: 1.15,
    tend: { short: 1.3, long: 0.9, through: 1.6, dribble: 0.9, cross: 0.3, shoot: 0.6, hold: 0 },
  }),
  AM: R({
    key: 'AM', name: 'Attacking Midfielder', positions: ['AMC'], duties: ['S', 'A'], defaultDuty: 'S',
    desc: 'Operates between the lines, creating and shooting.',
    weights: { passing: 2, vision: 2, firstTouch: 2, dribbling: 2, offTheBall: 2, finishing: 1.5, longShots: 1.5, decisions: 1.5, composure: 1.5, flair: 1.5, agility: 1 },
    adv: [0.3, 0.5, 0.9], drop: 0, roam: 1.1, inside: 0, inv: 1.25, dinv: 0.7, press: 0.9, workload: 1.0,
    tend: { short: 1.1, long: 0.5, through: 1.3, dribble: 1.1, cross: 0.2, shoot: 1.2, hold: 0.2 },
  }),
  AP: R({
    key: 'AP', name: 'Advanced Playmaker', positions: ['AMC', 'AML', 'AMR', 'MC'], duties: ['S', 'A'], defaultDuty: 'S',
    desc: 'The creative hub in the final third, looking for the killer pass.',
    weights: { passing: 3, vision: 3, firstTouch: 2.5, dribbling: 2, decisions: 2, composure: 2, flair: 2, agility: 1, offTheBall: 1 },
    adv: [0.3, 0.4, 0.7], drop: 0, roam: 1.1, inside: 0.3, inv: 1.5, dinv: 0.6, press: 0.7, workload: 0.95,
    tend: { short: 1.2, long: 0.6, through: 2.0, dribble: 1.0, cross: 0.4, shoot: 0.8, hold: 0.1 },
  }),
  SS: R({
    key: 'SS', name: 'Shadow Striker', positions: ['AMC'], duties: ['A'], defaultDuty: 'A',
    desc: 'Bursts beyond the striker into the box.',
    weights: { finishing: 3, offTheBall: 3, anticipation: 2, composure: 2, dribbling: 1.5, firstTouch: 1.5, acceleration: 1.5, pace: 1, decisions: 1 },
    adv: [1.1, 1.1, 1.1], drop: 0, roam: 1.1, inside: 0, inv: 1.0, dinv: 0.6, press: 1.0, workload: 1.05,
    tend: { short: 0.9, long: 0.3, through: 0.6, dribble: 1.1, cross: 0.1, shoot: 1.8, hold: 0.1 },
  }),
  ENG: R({
    key: 'ENG', name: 'Enganche', positions: ['AMC'], duties: ['S'], defaultDuty: 'S',
    desc: 'A classic number ten who stands still and lets the game come to him.',
    weights: { passing: 3, vision: 3, firstTouch: 3, composure: 2, decisions: 2, flair: 2, dribbling: 1.5, balance: 1 },
    adv: [0.2, 0.2, 0.2], drop: -0.3, roam: 0.6, inside: 0, inv: 1.6, dinv: 0.35, press: 0.3, workload: 0.8,
    tend: { short: 1.3, long: 0.6, through: 2.2, dribble: 0.8, cross: 0.2, shoot: 0.8, hold: 0.3 },
  }),
  W: R({
    key: 'W', name: 'Winger', positions: ['ML', 'MR', 'AML', 'AMR'], duties: ['S', 'A'], defaultDuty: 'A',
    desc: 'Hugs the touchline, beats the full-back and crosses.',
    weights: { crossing: 3, dribbling: 3, pace: 2.5, acceleration: 2.5, agility: 1.5, flair: 1.5, offTheBall: 1, firstTouch: 1.5, stamina: 1, workRate: 1 },
    adv: [0.5, 0.7, 1.1], drop: 0, roam: 1.0, inside: -0.35, inv: 1.2, dinv: 0.75, press: 0.9, workload: 1.15,
    tend: { short: 0.8, long: 0.3, through: 0.4, dribble: 1.6, cross: 2.0, shoot: 0.5, hold: 0 },
  }),
  IW: R({
    key: 'IW', name: 'Inverted Winger', positions: ['ML', 'MR', 'AML', 'AMR'], duties: ['S', 'A'], defaultDuty: 'A',
    desc: 'Cuts inside onto his stronger foot to shoot or combine.',
    weights: { dribbling: 3, finishing: 2, longShots: 1.5, pace: 2, acceleration: 2.5, agility: 2, flair: 2, offTheBall: 2, firstTouch: 2, composure: 1, passing: 1, vision: 1 },
    adv: [0.5, 0.7, 1.1], drop: 0, roam: 1.0, inside: 0.55, inv: 1.25, dinv: 0.7, press: 0.9, workload: 1.1,
    tend: { short: 1.0, long: 0.3, through: 0.8, dribble: 1.7, cross: 0.5, shoot: 1.5, hold: 0 },
  }),
  WP: R({
    key: 'WP', name: 'Wide Playmaker', positions: ['ML', 'MR', 'AML', 'AMR'], duties: ['S', 'A'], defaultDuty: 'S',
    desc: 'Drifts in from the flank to become an extra creator.',
    weights: { passing: 3, vision: 3, dribbling: 2, firstTouch: 2.5, decisions: 2, flair: 1.5, crossing: 1.5, composure: 1.5, agility: 1 },
    adv: [0.3, 0.5, 0.8], drop: 0, roam: 1.0, inside: 0.45, inv: 1.35, dinv: 0.65, press: 0.7, workload: 1.0,
    tend: { short: 1.3, long: 0.6, through: 1.7, dribble: 1.0, cross: 1.0, shoot: 0.6, hold: 0 },
  }),
  WTM: R({
    key: 'WTM', name: 'Wide Target Man', positions: ['ML', 'MR', 'AML', 'AMR'], duties: ['S', 'A'], defaultDuty: 'S',
    desc: 'A big body on the flank to aim long balls at.',
    weights: { heading: 3, strength: 3, jumping: 2.5, bravery: 1.5, firstTouch: 1.5, crossing: 1, offTheBall: 1.5, balance: 1, teamwork: 1, workRate: 1 },
    adv: [0.4, 0.6, 0.9], drop: 0, roam: 0.9, inside: 0.1, inv: 1.0, dinv: 0.8, press: 0.8, workload: 1.0,
    tend: { short: 0.8, long: 0.4, through: 0.3, dribble: 0.5, cross: 1.0, shoot: 0.7, hold: 2.0 },
  }),
  AF: R({
    key: 'AF', name: 'Advanced Forward', positions: ['ST'], duties: ['A'], defaultDuty: 'A',
    desc: 'Plays on the shoulder of the last defender, stretching the line.',
    weights: { finishing: 3, offTheBall: 3, pace: 2.5, acceleration: 2.5, composure: 2, dribbling: 1.5, firstTouch: 1.5, anticipation: 1.5 },
    adv: [0.4, 0.4, 0.4], drop: -0.2, roam: 0.9, inside: 0, inv: 1.05, dinv: 0.6, press: 1.0, workload: 1.05,
    tend: { short: 0.7, long: 0.2, through: 0.4, dribble: 1.4, cross: 0.2, shoot: 2.0, hold: 0.4 },
  }),
  TM: R({
    key: 'TM', name: 'Target Man', positions: ['ST'], duties: ['S', 'A'], defaultDuty: 'A',
    desc: 'Wins everything in the air and holds the ball up for runners.',
    weights: { heading: 3, strength: 3, jumping: 2.5, bravery: 1.5, balance: 1.5, firstTouch: 1.5, finishing: 1.5, teamwork: 1, aggression: 1, offTheBall: 1 },
    adv: [0.1, 0.1, 0.25], drop: -0.2, roam: 0.7, inside: 0, inv: 1.15, dinv: 0.7, press: 0.7, workload: 0.95,
    tend: { short: 0.9, long: 0.4, through: 0.4, dribble: 0.5, cross: 0.2, shoot: 1.4, hold: 2.8 },
  }),
  P: R({
    key: 'P', name: 'Poacher', positions: ['ST'], duties: ['A'], defaultDuty: 'A',
    desc: 'Lives in the box and gets on the end of chances.',
    weights: { finishing: 3.5, offTheBall: 3, anticipation: 2.5, composure: 2.5, acceleration: 1.5, heading: 1, firstTouch: 1, balance: 1 },
    adv: [0.5, 0.5, 0.5], drop: -0.3, roam: 0.7, inside: 0, inv: 0.75, dinv: 0.45, press: 0.5, workload: 0.9,
    tend: { short: 0.6, long: 0.1, through: 0.2, dribble: 0.8, cross: 0.1, shoot: 2.6, hold: 0.3 },
  }),
  F9: R({
    key: 'F9', name: 'False Nine', positions: ['ST'], duties: ['S'], defaultDuty: 'S',
    desc: 'Drops deep into midfield, dragging a centre-back out of position.',
    weights: { passing: 2.5, vision: 2.5, firstTouch: 2.5, dribbling: 2, decisions: 2, composure: 2, offTheBall: 1.5, finishing: 1.5, flair: 1, agility: 1, teamwork: 1 },
    adv: [-0.7, -0.7, -0.7], drop: 0, roam: 1.3, inside: 0, inv: 1.35, dinv: 0.7, press: 0.9, workload: 1.0,
    tend: { short: 1.3, long: 0.5, through: 1.8, dribble: 1.2, cross: 0.2, shoot: 0.9, hold: 0.6 },
  }),
  CF: R({
    key: 'CF', name: 'Complete Forward', positions: ['ST'], duties: ['S', 'A'], defaultDuty: 'A',
    desc: 'Does a bit of everything: holds up, creates and scores.',
    weights: { finishing: 2.5, firstTouch: 2, dribbling: 1.5, passing: 1.5, heading: 1.5, strength: 1.5, offTheBall: 2, composure: 2, decisions: 1.5, pace: 1.5, vision: 1, acceleration: 1, workRate: 1 },
    adv: [0, 0.1, 0.3], drop: -0.1, roam: 1.0, inside: 0, inv: 1.2, dinv: 0.7, press: 0.9, workload: 1.05,
    tend: { short: 1.0, long: 0.3, through: 1.0, dribble: 1.1, cross: 0.3, shoot: 1.8, hold: 1.3 },
  }),
  PF: R({
    key: 'PF', name: 'Pressing Forward', positions: ['ST'], duties: ['D', 'S', 'A'], defaultDuty: 'A',
    desc: 'Leads the press from the front, hunting centre-backs.',
    weights: { workRate: 3, stamina: 2.5, aggression: 2, acceleration: 2, pace: 1.5, teamwork: 1.5, finishing: 1.5, offTheBall: 1.5, anticipation: 1.5, bravery: 1, strength: 1 },
    adv: [0, 0.15, 0.35], drop: -0.1, roam: 1.1, inside: 0, inv: 0.95, dinv: 1.0, press: 1.6, workload: 1.25,
    tend: { short: 0.9, long: 0.3, through: 0.5, dribble: 1.1, cross: 0.2, shoot: 1.7, hold: 0.7 },
  }),
};

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export function rolesForPosition(pos: Pos): RoleDef[] {
  return ROLE_KEYS.map((k) => ROLES[k]).filter((r) => r.positions.includes(pos));
}

export function defaultRoleForPosition(pos: Pos): { role: RoleKey; duty: Duty } {
  switch (pos) {
    case 'GK': return { role: 'GK', duty: 'D' };
    case 'DC': return { role: 'CD', duty: 'D' };
    case 'DL': case 'DR': return { role: 'FB', duty: 'S' };
    case 'WBL': case 'WBR': return { role: 'WB', duty: 'S' };
    case 'DM': return { role: 'A', duty: 'D' };
    case 'MC': return { role: 'CM', duty: 'S' };
    case 'ML': case 'MR': return { role: 'W', duty: 'S' };
    case 'AML': case 'AMR': return { role: 'W', duty: 'A' };
    case 'AMC': return { role: 'AM', duty: 'S' };
    case 'ST': return { role: 'CF', duty: 'A' };
  }
}

/** Duty-specific weight tweaks layered on the role weights. */
export const DUTY_WEIGHT_BONUS: Record<Duty, Partial<Record<AttrKey, number>>> = {
  D: { positioning: 1, tackling: 0.5, teamwork: 0.5, concentration: 0.5 },
  S: { teamwork: 0.5, decisions: 0.5 },
  A: { offTheBall: 1, finishing: 0.5, dribbling: 0.5 },
};

const normCache = new Map<string, [AttrKey, number][]>();

/** Normalised (sum = 1) weight vector for a role + duty. */
export function roleWeights(role: RoleKey, duty: Duty): [AttrKey, number][] {
  const key = role + duty;
  const hit = normCache.get(key);
  if (hit) return hit;
  const def = ROLES[role];
  const w: Partial<Record<AttrKey, number>> = { ...def.weights };
  // Keepers don't get outfield duty tweaks
  if (role !== 'GK' && role !== 'SK') {
    for (const [k, v] of Object.entries(DUTY_WEIGHT_BONUS[duty]) as [AttrKey, number][]) {
      if (w[k] !== undefined) w[k] = (w[k] ?? 0) + v * 0.5;
      else w[k] = v * 0.35;
    }
  }
  const total = Object.values(w).reduce((s, v) => s + (v ?? 0), 0);
  const arr = (Object.entries(w) as [AttrKey, number][]).map(([k, v]) => [k, v / total] as [AttrKey, number]);
  normCache.set(key, arr);
  return arr;
}

export function dutyIndex(d: Duty): 0 | 1 | 2 {
  return d === 'D' ? 0 : d === 'S' ? 1 : 2;
}
