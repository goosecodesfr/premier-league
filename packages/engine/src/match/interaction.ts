// The tactical interaction layer: explicit instruction pairings and style mismatch.
// Zone contention (mechanism 1) is applied live from presence maps; this module handles
// mechanisms 2 and 3 and records a human-readable cause for every modifier.
import { styleVector, type Tactic } from '../tactics.ts';
import type { Modifier } from './types.ts';

export interface TeamMods {
  throughWeight: number; // multiplier on through-ball selection
  throughXg: number; // multiplier on xG of chances from through balls
  longShotWeight: number;
  boxXgMult: number; // multiplier on xG of in-box open-play chances CONCEDED... applied to attacker
  crossWeight: number;
  crossBonus: number; // composite points on cross accuracy
  pressBreak: number; // chance a completed build-up pass vs an all-out press becomes a break
  oppCentralDefMult: number; // scales the OPPONENT's central defensive presence
  offsideRisk: number; // added offside probability on this side's through balls
  trapBeatBonus: number; // xG bonus when the trap is beaten
  counterMult: number; // multiplier on this side's counter-attack chances
  possessionBias: number; // composite bonus on retention (short passes)
  transitionConcede: number; // multiplier on opponent counter chances
}

export const neutralMods = (): TeamMods => ({
  throughWeight: 1, throughXg: 1, longShotWeight: 1, boxXgMult: 1, crossWeight: 1, crossBonus: 0,
  pressBreak: 0, oppCentralDefMult: 1, offsideRisk: 0, trapBeatBonus: 1, counterMult: 1, possessionBias: 0, transitionConcede: 1,
});

export interface TeamProfile {
  tactic: Tactic;
  name: string;
  forwardPace: number; // best pace/acceleration composite among forwards (0..200)
  defenderComposure: number; // average composure of back line
  lineRecovery: number; // average recovery composite (pace/accel/anticipation) of back line
  centralMids: number; // number of central (non-wide) midfield slots
  roamers: number; // false nines / roaming playmakers / liberos
  lateRunners: number; // box-to-box, mezzala, shadow striker, attack-duty CMs
  overlappers: number; // attack/support duty FB/WB
  crossers: number; // wingers / wing-backs
}

const isHighLine = (t: Tactic) => t.instructions.line === 'high' || t.instructions.line === 'very_high';

export function computeInteraction(p: [TeamProfile, TeamProfile]): { mods: [TeamMods, TeamMods]; modifiers: Modifier[] } {
  const mods: [TeamMods, TeamMods] = [neutralMods(), neutralMods()];
  const out: Modifier[] = [];
  for (const side of [0, 1] as const) {
    const me = p[side];
    const opp = p[1 - side];
    const mi = me.tactic.instructions;
    const oi = opp.tactic.instructions;
    const m = mods[side];

    // High defensive line vs direct passing + pacy forward
    if (isHighLine(opp.tactic) && mi.passing === 'direct' && me.forwardPace >= 150) {
      const edge = Math.max(0, me.forwardPace - opp.lineRecovery) / 40;
      m.throughWeight *= 1.1;
      m.throughXg *= 1.1 + Math.min(0.1, edge * 0.08);
      out.push({ side, key: 'high_line_vs_pace', value: 6, cause: `${opp.name}'s high line invited balls in behind for ${me.name}'s quick forwards.` });
    }
    // Deep line vs patient possession + shoot on sight
    if (oi.line === 'deep' && (mi.tempo === 'slow' || mi.passing === 'short') && mi.shootOnSight) {
      m.longShotWeight *= 1.6;
      m.possessionBias += 3;
      out.push({ side, key: 'deep_vs_patient', value: 4, cause: `${me.name} kept the ball against ${opp.name}'s deep block and tested them from distance.` });
    }
    // All-out press vs play out of defence with composed defenders
    if (oi.press === 'all_out' && mi.playOutOfDefence && me.defenderComposure >= 135) {
      m.pressBreak += 0.14 + Math.min(0.1, (me.defenderComposure - 135) / 300);
      out.push({ side, key: 'press_break', value: 5, cause: `${me.name}'s composed defenders played through ${opp.name}'s all-out press.` });
    }
    // Narrow shape vs wide overlaps + crossing
    if (oi.width === 'narrow' && (me.overlappers >= 2 || mi.overlap === 'overlap') && me.crossers >= 2) {
      m.crossWeight *= 1.5;
      m.crossBonus += 5;
      out.push({ side, key: 'narrow_vs_width', value: 5, cause: `${opp.name} were narrow and ${me.name} attacked the space out wide.` });
    }
    // Wide shape vs central overloads
    if (oi.width === 'wide' && me.centralMids >= 3) {
      m.oppCentralDefMult *= 0.85;
      out.push({ side, key: 'wide_vs_central', value: 4, cause: `${opp.name} stretched wide and ${me.name} overloaded the middle.` });
    }
    // Man marking vs roaming / false-nine roles
    if (oi.marking === 'man' && me.roamers >= 1) {
      m.oppCentralDefMult *= 0.88;
      m.throughWeight *= 1.15;
      out.push({ side, key: 'man_vs_roamers', value: 4, cause: `${opp.name}'s man-marking was dragged around by ${me.name}'s roaming players.` });
    }
    // Offside trap vs late runs from midfield
    if (oi.offsideTrap && me.lateRunners >= 2) {
      m.trapBeatBonus *= 1.35;
      m.offsideRisk -= 0.06;
      out.push({ side, key: 'trap_vs_late_runs', value: 4, cause: `Late runs from ${me.name}'s midfield made ${opp.name}'s offside trap a gamble.` });
    }
    // Counter-attack vs counter-press + slow tempo
    if (mi.counter && oi.counterPress && oi.tempo === 'slow') {
      m.counterMult *= 0.6;
      out.push({ side: (1 - side) as 0 | 1, key: 'counter_smothered', value: 4, cause: `${opp.name}'s counter-press and patience starved ${me.name} of breaks.` });
    }
    if (oi.offsideTrap) m.offsideRisk += 0.08;
  }

  // Style mismatch: tempo, directness, width, aggression
  const s0 = styleVector(p[0].tactic);
  const s1 = styleVector(p[1].tactic);
  const tempoGap = s0.tempo - s1.tempo;
  if (Math.abs(tempoGap) >= 1) {
    const patient = tempoGap < 0 ? 0 : 1;
    const frantic = (1 - patient) as 0 | 1;
    mods[patient].possessionBias += 2.5;
    mods[patient].transitionConcede *= 1.2;
    mods[frantic].counterMult *= 1.15;
    out.push({ side: patient as 0 | 1, key: 'style_tempo', value: 2, cause: `${p[patient].name} slowed the game down and saw more of the ball, at the cost of more transitions.` });
  }
  const aggrGap = s0.aggression - s1.aggression;
  if (Math.abs(aggrGap) >= 1) {
    const hunter = aggrGap > 0 ? 0 : 1;
    mods[hunter].possessionBias -= 1;
    out.push({ side: hunter as 0 | 1, key: 'style_aggression', value: 2, cause: `${p[hunter].name}'s intensity set the tone without the ball.` });
  }
  return { mods, modifiers: out };
}
