// Commentary templates. Each key maps to several variants chosen by a seeded RNG so a replay
// always reads identically. Placeholders: {p} actor, {b} second player, {team}, {opp}, {zone},
// {score}, {gk}, {xg}.
import type { Rng } from '../rng.ts';

const T: Record<string, string[]> = {
  ko_first: [
    "We're under way! {team} get us started.",
    'The referee blows and {team} kick off.',
    "And we're off. {team} knock it back to get things going.",
    'Kick-off. {team} start with the ball.',
  ],
  ko_second: [
    "The second half is under way.",
    '{team} get the second half started.',
    "We go again. Forty-five minutes left to settle this.",
  ],
  ko_et: ['Extra time begins. Tired legs everywhere.', "Thirty more minutes. Who's got anything left?"],
  ht: [
    "Half-time: {score}.",
    'The referee blows for half-time. {score}.',
    "That's the break. {score} at the interval.",
  ],
  ft: [
    'Full-time: {score}.',
    "It's all over! {score}.",
    'The final whistle goes. {score}.',
  ],
  et_ht: ['Half-time in extra time: {score}.'],
  aet: ["Extra time is over: {score}.", 'That is the end of extra time. {score}.'],
  pens_start: ['It goes to penalties!', "Penalties. It's all come down to this."],
  pens_score: ['{p} steps up... and scores! ({score})', '{p} sends the keeper the wrong way. ({score})', 'Cool as you like from {p}. ({score})'],
  pens_miss: ['{p} blazes it over the bar! ({score})', '{p} hits the post! ({score})', '{p} drags it wide! ({score})'],
  pens_saved: ['Saved! {gk} guesses right and keeps out {p}. ({score})', '{gk} gets down brilliantly to deny {p}! ({score})'],
  pens_win: ['{team} win it on penalties!', '{team} hold their nerve and go through on penalties!'],

  chain_patient: [
    '{team} are content to keep the ball, probing patiently.',
    '{team} knock it around, waiting for an opening.',
    'Lots of possession for {team}, but nothing incisive yet.',
    '{team} recycle it across the back and start again.',
    '{p} dictates the rhythm for {team} from deep.',
  ],
  chain_pressure: [
    '{team} are camped in the {opp} half now.',
    'Sustained pressure from {team}. {opp} are pinned back.',
    '{team} keep coming. {opp} can barely get out.',
    "It's all {team} at the moment.",
  ],
  chain_direct: [
    "{p} goes long, looking for the forwards.",
    '{team} skip midfield with a hopeful ball forward.',
    'Route one from {team}.',
  ],
  counter: [
    '{team} break at pace after winning it back!',
    'Counter-attack! {team} have numbers going forward.',
    '{p} leads the break for {team}.',
    '{opp} are caught out and {team} are away!',
  ],
  press_win: [
    '{p} hunts it down high up the pitch and wins it back.',
    'Great pressing from {team}. {p} nicks it off {b}.',
    '{team} squeeze {opp} and force the turnover.',
  ],
  through_ok: [
    '{b} slips {p} through {zone}!',
    'Lovely ball from {b} in behind, {p} is away!',
    '{p} beats the offside trap, released by {b}!',
    "What a pass from {b}! {p} is clean through.",
  ],
  through_int: [
    '{b} tries to thread it through, but it is cut out.',
    'Ambitious from {b}. The through ball is intercepted.',
    '{p} reads the through ball and steps in.',
  ],
  through_offside: [
    '{p} was too eager. The flag is up for offside.',
    'Offside! {p} timed that run a fraction early.',
    'The trap works. {p} is caught offside.',
  ],
  dribble_ok: [
    '{p} drives at {b} and skips past him {zone}.',
    'Lovely footwork from {p}, leaving {b} for dead.',
    '{p} glides past {b}.',
    '{p} beats his man and is into space {zone}.',
    'Nutmeg! {p} makes {b} look silly.',
  ],
  dribble_fail: [
    '{b} stands up well and takes the ball off {p}.',
    '{p} tries to go past {b} but runs into a wall.',
    'Good defending from {b}, who dispossesses {p}.',
  ],
  cross_claim: [
    '{p} whips it in but {gk} comes and claims it confidently.',
    '{gk} plucks the cross out of the air.',
    'The delivery from {p} is taken comfortably by {gk}.',
  ],
  cross_clear: [
    '{p} crosses from {zone}, but {b} heads it clear.',
    'The ball in from {p} is cleared by {b}.',
    '{b} gets his head to the cross before anyone else.',
  ],
  cross_miss: [
    'Poor cross from {p}, straight out of play.',
    '{p} overhits the cross and it sails harmlessly over everyone.',
    "{p}'s delivery is too close to the keeper.",
  ],
  corner: [
    'Corner to {team}.',
    '{team} win a corner {zone}.',
    'It is deflected behind. Corner.',
    '{team} will have a corner.',
  ],
  freekick: [
    'Free kick to {team} in a dangerous position.',
    '{p} is brought down. Free kick, and it is within range.',
    '{team} have a free kick around the edge of the box.',
  ],
  penalty: [
    'PENALTY! {b} brings down {p} in the box!',
    'The referee points to the spot! {p} was clipped by {b}.',
    "Penalty to {team}! {b} can't believe it, but that's a foul on {p}.",
  ],
  foul: [
    'Foul by {p} on {b}.',
    '{p} catches {b} late. Free kick.',
    '{b} goes down under the challenge from {p}.',
    'Clumsy from {p}, who clips {b}.',
  ],
  foul_tactical: [
    '{p} pulls {b} back to stop the break. Cynical.',
    'Professional foul by {p}. {b} was away.',
    '{p} takes one for the team, hauling down {b}.',
  ],
  yellow: [
    'Yellow card for {p}.',
    '{p} goes into the book.',
    'The referee reaches for his pocket: yellow for {p}.',
    'That is a booking for {p}.',
  ],
  second_yellow: [
    'Second yellow! {p} is off! {team} are down to ten.',
    "{p} already had a booking... and that's red! He has to go.",
  ],
  red: [
    'RED CARD! {p} is sent off for that challenge on {b}!',
    'Straight red for {p}! {team} are down to ten men.',
    "That's a shocking tackle from {p}, and he's off!",
  ],
  offside: ['{p} is flagged offside.', 'Offside against {p}.'],
  sub: [
    'Substitution for {team}: {b} replaces {p}.',
    '{team} make a change. {p} off, {b} on.',
    '{b} comes on for {p}.',
  ],
  sub_injury: [
    '{p} cannot continue and is replaced by {b}.',
    'Enforced change for {team}: {b} on for the injured {p}.',
  ],
  injury: [
    '{p} is down and looks in real discomfort.',
    'Worry for {team}: {p} is holding his leg.',
    'The physio is on for {p}. This looks bad.',
  ],
  trigger: ['{team}: {p}'],
  tactic: ['{team}: {p}'],
  momentum: [
    '{team} are on top now.',
    'The momentum has swung towards {team}.',
    'The crowd are right behind {team} now.',
    '{team} are enjoying their best spell of the game.',
  ],
  save_sweep: [
    '{gk} races off his line to smother it at the feet of {p}!',
    'Brave from {gk}, who comes out to deny {p}.',
  ],

  // ---- shots ----
  shot_saved: [
    '{p} tries his luck... {gk} saves.',
    'Shot from {p}! Comfortable for {gk}.',
    '{p} fires at goal but {gk} is equal to it.',
    '{p} gets a shot away, straight at {gk}.',
    'Low drive from {p}, gathered by {gk}.',
  ],
  shot_saved_big: [
    'What a save! {gk} denies {p} from close range!',
    "{p} looks certain to score... but {gk} somehow keeps it out!",
    'Superb from {gk}, flying across to stop {p}!',
    '{gk} spreads himself and blocks {p} point-blank!',
  ],
  shot_off: [
    '{p} shoots, but it drifts wide.',
    '{p} lets fly... over the bar.',
    'Wayward from {p}. That goes well wide.',
    '{p} snatches at it and it skews off target.',
    '{p} hits it high and handsome into the stand.',
  ],
  shot_off_big: [
    'Oh, he has to score! {p} misses from close range!',
    "How has {p} missed that? It was easier to score!",
    '{p} is clean through... and puts it wide! A huge chance gone.',
    'Big chance! {p} gets under it and it flies over.',
  ],
  shot_blocked: [
    '{p} shoots but it is blocked by {b}.',
    'Brave block from {b} to deny {p}.',
    "{p}'s effort cannons off a defender.",
    'Blocked! {p} could not find a way through.',
  ],
  shot_post: [
    'Off the woodwork! {p} hits the post!',
    '{p} rattles the crossbar! So close!',
    'Agonising for {p}. His shot comes back off the post.',
  ],
  shot_long_saved: [
    '{p} tries from distance. {gk} tips it over.',
    'Long-range effort from {p}, well held by {gk}.',
  ],
  shot_long_off: [
    '{p} tries his luck from 30 yards. Nowhere near.',
    'Speculative from {p}, and well wide.',
    '{p} has a go from range, but it is off target.',
  ],
  header_saved: [
    '{p} rises to head it goalwards. {gk} saves!',
    'Header from {p}! {gk} keeps it out.',
  ],
  header_off: [
    '{p} gets his head to it but cannot keep it down.',
    'Header from {p}, just over.',
    '{p} glances it wide.',
  ],
  // ---- goals ----
  goal: [
    'GOAL! {p} finds the net! {score}',
    'GOAL! {p} slots it home! {score}',
    'GOAL! {p} makes no mistake! {score}',
    'GOAL! A clinical finish from {p}! {score}',
    'GOAL! {p} picks his spot and it is in! {score}',
  ],
  goal_assist: [
    'GOAL! {b} sets it up and {p} finishes! {score}',
    'GOAL! Great work from {b}, and {p} buries it! {score}',
    'GOAL! {p} converts the chance created by {b}! {score}',
    'GOAL! {b} finds {p}, who does the rest! {score}',
  ],
  goal_header: [
    'GOAL! {p} rises highest and powers a header in! {score}',
    'GOAL! A towering header from {p}! {score}',
    'GOAL! {p} nods it home! {score}',
  ],
  goal_long: [
    'GOAL! What a strike from {p}! From 25 yards! {score}',
    'GOAL! {p} unleashes an absolute rocket into the top corner! {score}',
    'GOAL! A screamer from {p}! {score}',
  ],
  goal_1v1: [
    'GOAL! {p} goes one-on-one and slides it past {gk}! {score}',
    'GOAL! {p} rounds {gk} and walks it in! {score}',
    'GOAL! Ice cold from {p} in front of goal! {score}',
  ],
  goal_tapin: [
    'GOAL! {p} taps in from close range! {score}',
    'GOAL! {p} is in the right place at the right time! {score}',
  ],
  goal_freekick: [
    'GOAL! {p} curls the free kick into the top corner! {score}',
    'GOAL! A sublime free kick from {p}! {score}',
  ],
  goal_penalty: [
    'GOAL! {p} sends {gk} the wrong way from the spot! {score}',
    'GOAL! {p} smashes the penalty home! {score}',
  ],
  goal_counter: [
    'GOAL! A devastating counter-attack finished by {p}! {score}',
    'GOAL! {team} break and {p} finishes it off! {score}',
  ],
  penalty_saved: [
    'SAVED! {gk} dives to keep out the penalty from {p}!',
    '{p} steps up... and {gk} saves it!',
  ],
  penalty_missed: [
    '{p} misses the penalty! It flies wide!',
    '{p} hits the post from the spot!',
  ],
};

export const COMMENTARY_KEYS = Object.keys(T);

export function commentaryVariants(key: string): number {
  return T[key]?.length ?? 0;
}

export function renderCommentary(key: string, vars: Record<string, string | number | undefined>, rng: Rng): string {
  const list = T[key];
  if (!list || !list.length) return key;
  const tpl = list[Math.floor(rng.next() * list.length)];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

export const ZONE_PHRASE = (band: number, chan: number): string => {
  const side = chan === 0 ? 'down the left' : chan === 2 ? 'down the right' : 'through the middle';
  if (band >= 5) return chan === 1 ? 'in the box' : chan === 0 ? 'on the left of the box' : 'on the right of the box';
  if (band === 4) return chan === 1 ? 'on the edge of the box' : side;
  return side;
};
