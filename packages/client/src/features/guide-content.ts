// The in-app guide: how to play, and plain-English explanations of every football and game term.
// Roles, traits, positions and player instructions come straight from the engine so they never go stale.
// Written for non-native speakers: short sentences, common words, one idea per line.
import {
  PLAYER_INSTRUCTION_KEYS, PLAYER_INSTRUCTION_OPTIONS, POS_LABEL, PRESETS, ROLES, TRAITS, TRAIT_KEYS,
  type RoleKey, type TraitKey,
} from '@ffm/engine';

export type GuideCat = 'basics' | 'positions' | 'roles' | 'tactics' | 'player' | 'traits' | 'numbers' | 'match' | 'transfers' | 'club' | 'football';

export const CAT_LABEL: Record<GuideCat, string> = {
  basics: 'Basics', positions: 'Positions', roles: 'Roles', tactics: 'Team instructions', player: 'Player instructions',
  traits: 'Traits', numbers: 'Player numbers', match: 'Match words', transfers: 'Transfers', club: 'Club', football: 'Football talk',
};

export interface Term {
  id: string;
  term: string;
  code?: string; // the short label you see in the app (AF, DM, IW...)
  cat: GuideCat;
  def: string; // what it is
  game?: string; // what it does in this game, or when to use it
  group?: string; // sub-group (trait family, pitch area)
}

// ---------------------------------------------------------------- how to play
export interface Step { title: string; body: string; where?: string; to?: string }

export const IN_A_NUTSHELL: Step[] = [
  { title: 'You are the manager', body: 'You run one real Premier League club: pick the team, choose how it plays, buy and sell players, and keep the board happy. Your friends manage other clubs. Bots run the rest.' },
  { title: 'The league runs on a real calendar', body: 'Matches are played on fixed days and times, even if nobody is online. Before each match there is a deadline to set your team. Miss it and your assistant picks for you.' },
  { title: 'The computer plays the match', body: 'At kick-off the game simulates every attack using your players, their skills and your tactics. You can watch a replay and read why you won or lost.' },
  { title: 'A season takes a few months', body: 'League, FA Cup, League Cup and Europe. Two transfer windows. At the end: awards, promotion and relegation, then a new season with the same club.' },
];

export const FIRST_DAY: Step[] = [
  { title: 'Install the app', body: 'iPhone: open the link in Safari, tap Share, then Add to Home Screen. Android: menu, then Install app. Open it from the new icon.', where: 'Your phone' },
  { title: 'Turn on notifications', body: 'You get a message before each deadline, after each result and when someone bids for your players.', where: 'Home, or Club → Settings → Notifications', to: '/settings/notifications' },
  { title: 'Meet your squad', body: 'Look at who is fit, who is injured and who plays where. Tap a player to see his best position, his traits and his strengths.', where: 'Squad', to: '/squad' },
  { title: 'Set up your tactic', body: 'Open your tactic and press Auto-fill for a sensible team. Then open the Analysis tab and fix anything marked red.', where: 'Tactics', to: '/tactics' },
  { title: 'Plan your transfers', body: 'Star players you like to add them to your shortlist. Bid when the window is open.', where: 'Club → Transfers', to: '/transfers' },
];

export const MATCHDAY: Step[] = [
  { title: 'Open the next match', body: 'The Home screen shows the next match and a countdown to the deadline. Tap it to open the pre-match screen.', where: 'Home' },
  { title: 'Study the opponent', body: 'See their usual shape, their style, their danger man and their weak spot. Key battles show where you are stronger or weaker, player against player.', where: 'Pre-match' },
  { title: 'Adjust your team', body: 'Tap Edit team. Rest tired players (condition below about 80%). Check the Analysis tab. Add a Plan B and triggers if you want changes during the match.', where: 'Pre-match → Edit team' },
  { title: 'Test it (optional)', body: 'Run 200 simulations of the match against their likely team. You get 3 runs per match, so use them to compare ideas.', where: 'Pre-match → Simulation preview' },
  { title: 'Submit before the deadline', body: 'Tap Submit team. You can still change it until the deadline. After that the team is locked.', where: 'Pre-match' },
  { title: 'Read the result', body: 'After kick-off you get a notification. The match page has the score, ratings, a replay and an Analysis tab that explains what worked.', where: 'Match page' },
];

export const TABS: { tab: string; body: string; to: string }[] = [
  { tab: 'Home', body: 'Next match and deadline, alerts, news and things that need your answer.', to: '/' },
  { tab: 'Squad', body: 'Your players, fitness, injuries, contracts, training and youth academy.', to: '/squad' },
  { tab: 'Tactics', body: 'Up to five tactics: formation, roles, instructions, set pieces and in-match triggers.', to: '/tactics' },
  { tab: 'League', body: 'Tables, fixtures, cup draws, statistics and other clubs.', to: '/league' },
  { tab: 'Club', body: 'Transfers, scouting, money, facilities, staff, the board, news and settings.', to: '/club' },
];

export const TIPS: string[] = [
  'Play people in positions they know. A great player in the wrong position plays like an average one.',
  'Fix every red warning in the Analysis tab before the deadline.',
  'Ask players to do what they are good at. Crossing needs someone who wins headers. A high defensive line needs fast defenders.',
  'Rotate. Tired players are slower, make more mistakes and get injured more.',
  'Scout young players before paying a lot. Their real potential is hidden until your scouts watch them.',
];

// ---------------------------------------------------------------- tactics: the four layers
export const TACTIC_LAYERS: Step[] = [
  { title: 'Formation', body: 'Where your 11 players stand, written from defence to attack. 4-3-3 means 4 defenders, 3 midfielders and 3 forwards. Drag players on the pitch to make your own shape.' },
  { title: 'Roles and duties', body: 'The job of each player. The role says what he does (for example "Box-to-box Midfielder"). The duty says how far forward he goes: Defend, Support or Attack.' },
  { title: 'Team instructions and mentality', body: 'How the whole team plays: fast or slow, short passes or long balls, press high or sit deep. Mentality sets how much risk the team takes.' },
  { title: 'Player instructions', body: 'Small changes for one player, like "shoot more" or "stay wide". Tap a player on the pitch, then Instructions.' },
];

export const DUTIES: { code: string; name: string; body: string }[] = [
  { code: 'D', name: 'Defend', body: 'Stays behind the ball and protects. Rarely goes forward.' },
  { code: 'S', name: 'Support', body: 'Links defence and attack. Helps both.' },
  { code: 'A', name: 'Attack', body: 'Gets forward and into the box. Leaves space behind him.' },
];

export const FIT_LEVELS: { name: string; color: string; body: string }[] = [
  { name: 'Ideal', color: 'var(--positive)', body: 'Perfect for this role. Plays at his best.' },
  { name: 'Good', color: 'var(--info)', body: 'Suits the role well.' },
  { name: 'Fair', color: '#cfd6dc', body: 'Can do the job.' },
  { name: 'Poor', color: 'var(--warning)', body: 'Wrong kind of player for this role. Try another role.' },
  { name: 'Misfit', color: 'var(--negative)', body: 'Out of position or badly suited. He will struggle.' },
];

// ---------------------------------------------------------------- transfers
export const TRANSFER_STEPS: Step[] = [
  { title: 'Find him', body: 'Search with filters, try the Young talents list, or check Suggested players for your weak positions. Star players to follow them on your shortlist.', where: 'Club → Transfers → Search' },
  { title: 'Scout him', body: 'Until he is scouted, you only see a rough guess of his skill and potential. Send a scout to follow him, or send your scouts on a mission to a region.', where: 'Player page → Scout, or Club → Scouting' },
  { title: 'Agree a fee with his club', body: 'Offer a price. The club accepts, rejects or asks for more (a counter-offer). Bot clubs usually answer within two hours. A friend answers when they open the app.', where: 'Player page → Make bid' },
  { title: 'Agree terms with the player', body: 'Offer a weekly wage, a contract length and a promise about playing time. The app shows how likely he is to say yes.', where: 'Same bid screen' },
  { title: 'Done', body: 'He joins your squad right away. Transfers happen only when a window is open. Free agents (players without a club) can join any time.' },
];

export const PRIVATE_PUBLIC: { title: string; body: string }[] = [
  { title: 'In public', body: 'Everyone sees your bid on the transfer feed and in the news. As the bigger club, your interest can unsettle the player and push him towards you.' },
  { title: 'In private (default)', body: 'Only the other club knows. But there is a chance, about 30 to 40%, that the story leaks to the press. If it leaks, the player may get unsettled, his club may raise the price and others may bid too.' },
];

// ---------------------------------------------------------------- glossary
const T = (cat: GuideCat, term: string, def: string, game?: string, code?: string, group?: string): Term => ({ id: `${cat}:${code ?? term}`, term, def, game, code, cat, group });

const BASICS: Term[] = [
  T('basics', 'Deadline', 'The time your team locks before a match.', 'After it you cannot change the team for that match. If you did not submit, your assistant picks the team.'),
  T('basics', 'Assistant', 'Your assistant manager, a member of staff.', 'Picks your team if you forget, and gives advice in the Analysis tab.'),
  T('basics', 'Bot', 'A club run by the computer.', 'Bots buy, sell, change tactics and can be sacked. There are eight personalities, from careful to reckless.'),
  T('basics', 'Tactic familiarity', 'How well your squad knows a tactic, in %.', 'Grows with matches and tactical training. Big changes lower it a little. Low familiarity means more mistakes.'),
  T('basics', 'Plan B', 'A second tactic you can switch to during a match.', 'Set it on the pre-match screen. A trigger can switch to it automatically.'),
  T('basics', 'Trigger', 'An automatic change during the match: "if this happens, do that".', 'Example: if losing after 70 minutes, switch to Attacking and bring on a striker.'),
  T('basics', 'Opposition instructions', 'Special orders against one opponent.', 'Tight-mark their best player, show him onto his weaker foot, or tackle him hard.'),
  T('basics', 'Simulation preview', 'The game plays your next match 200 times to show likely results.', '3 previews per match. Real matches have their own luck.'),
  T('basics', 'Transfer window', 'The period when clubs can buy and sell players.', 'Two per season: pre-season and mid-season. Free agents can sign any time.'),
];

const POSITION_HELP: Record<string, string> = {
  GK: 'Stops shots. The only player who can use his hands.',
  DC: 'Defends the middle, in front of his goalkeeper. Usually two or three of them.',
  DL: 'Defends the left side. Can run forward to help attacks.',
  DR: 'Defends the right side. Can run forward to help attacks.',
  WBL: 'A left-back who plays higher up the pitch and attacks more.',
  WBR: 'A right-back who plays higher up the pitch and attacks more.',
  DM: 'Sits just in front of the defence to protect it and win the ball.',
  MC: 'Plays in the middle. Passes, runs, helps attack and defence.',
  ML: 'Plays on the left side of midfield.',
  MR: 'Plays on the right side of midfield.',
  AMC: 'Plays behind the strikers and creates chances. Often called a "number 10".',
  AML: 'Attacks down the left side. Dribbles, crosses or cuts inside to shoot.',
  AMR: 'Attacks down the right side. Dribbles, crosses or cuts inside to shoot.',
  ST: 'The main goalscorer. Plays closest to the opponent\'s goal.',
};
const POSITIONS: Term[] = Object.entries(POS_LABEL).map(([code, label]) => T('positions', label, POSITION_HELP[code] ?? '', undefined, code));

const AREA_OF: Record<string, string> = { GK: 'Goalkeeper', DC: 'Defence', DL: 'Defence', DR: 'Defence', WBL: 'Defence', WBR: 'Defence', DM: 'Midfield', MC: 'Midfield', ML: 'Wide', MR: 'Wide', AML: 'Wide', AMR: 'Wide', AMC: 'Attack', ST: 'Attack' };
const DUTY_NAME: Record<string, string> = { D: 'Defend', S: 'Support', A: 'Attack' };
const ROLE_TERMS: Term[] = (Object.keys(ROLES) as RoleKey[]).map((k) => {
  const r = ROLES[k] as unknown as { name: string; desc: string; duties: string[]; positions?: string[] };
  const pos = r.positions ?? [];
  return T('roles', r.name, r.desc, `Plays at ${pos.join(', ')}. Duties: ${r.duties.map((d) => DUTY_NAME[d]).join(', ')}.`, k, AREA_OF[pos[0]] ?? 'Other');
});

/** Team instructions, in plain words. Keys match the engine's instruction names. */
export const TEAM_INSTRUCTIONS: { key: string; name: string; def: string; options: [string, string][] }[] = [
  { key: 'tempo', name: 'Tempo', def: 'How fast your team moves the ball forward.', options: [['Slow', 'Patient. Keeps the ball and waits for a gap.'], ['High', 'Quick attacks. More chances, but more lost balls and more tired legs.']] },
  { key: 'passing', name: 'Passing directness', def: 'Short passes or long balls.', options: [['Short', 'Keeps the ball on the ground. Needs good passers.'], ['Direct', 'Long balls forward. Skips midfield. Works with fast or tall forwards.']] },
  { key: 'width', name: 'Width', def: 'How much of the pitch you use when attacking.', options: [['Narrow', 'Attacks through the middle.'], ['Wide', 'Stretches the defence using the wings. Good for crossing.']] },
  { key: 'playOutOfDefence', name: 'Play out of defence', def: 'Goalkeeper and defenders pass it short from the back instead of kicking it long.', options: [['On', 'Keeps the ball. Risky against a hard press or with clumsy defenders.']] },
  { key: 'focus', name: 'Focus play', def: 'Send more attacks down one side or the middle.', options: [['Left / Centre / Right', 'Aim at their weakest defender, or at your best winger.']] },
  { key: 'overlap', name: 'Full-back runs', def: 'How your full-backs join attacks.', options: [['Overlap', 'The full-back runs past the winger on the outside.'], ['Underlap', 'The full-back runs inside the winger.']] },
  { key: 'workIntoBox', name: 'Work ball into box', def: 'Keep passing until there is a clear chance near goal.', options: [['On', 'Fewer long shots, better chances, more patience.']] },
  { key: 'shootOnSight', name: 'Shoot on sight', def: 'Shoot whenever there is a chance, even from far away.', options: [['On', 'Good with strong shooters (Power Shot, Finesse Shot).']] },
  { key: 'line', name: 'Defensive line', def: 'How far up the pitch your defenders stand.', options: [['Deep', 'Protects the box. Invites pressure.'], ['High', 'Squeezes the space and wins the ball higher. Fast forwards can run in behind, so you need fast defenders.']] },
  { key: 'press', name: 'Pressing intensity', def: 'How hard players chase the opponent with the ball.', options: [['Low', 'Keeps shape and saves energy.'], ['All-out', 'Wins the ball back often and high up. Tires players and leaves gaps.']] },
  { key: 'pressTrigger', name: 'Press trigger', def: 'When your team starts to press.', options: [['On loss', 'Only right after losing the ball.'], ['In their half', 'When the ball is in their half.'], ['Always', 'Everywhere on the pitch.']] },
  { key: 'offsideTrap', name: 'Offside trap', def: 'Defenders step forward together so attackers are caught offside.', options: [['On', 'Needs a focused back line. If one defender is late, the attacker is through on goal.']] },
  { key: 'tackling', name: 'Tackling', def: 'How hard your players go into challenges.', options: [['Careful', 'Fewer fouls and cards. Loses a few more duels.'], ['Hard', 'Wins more duels. More fouls and cards.']] },
  { key: 'marking', name: 'Marking', def: 'How your players defend against opponents.', options: [['Zonal', 'Each player guards an area.'], ['Man', 'Each player follows one opponent. Players who move around a lot can pull your markers out of place.']] },
  { key: 'counter', name: 'Counter-attack', def: 'After winning the ball, attack fast before the opponent is organised.', options: [['On', 'Best with fast forwards.']] },
  { key: 'counterPress', name: 'Counter-press', def: 'After losing the ball, the nearest players try to win it back at once. Also called "gegenpress".', options: [['On', 'Stops their counter-attacks early. Costs energy.']] },
  { key: 'regainDistribution', name: 'On regaining the ball', def: 'What to do right after winning the ball.', options: [['Quick', 'Go forward immediately.'], ['Keep it', 'Keep possession first and calm the game.']] },
  { key: 'gkDistribution', name: 'Goalkeeper distribution', def: 'How your goalkeeper restarts play.', options: [['Short', 'Rolls or passes to a defender.'], ['Long', 'Kicks it far up the pitch.']] },
  { key: 'timeWasting', name: 'Time wasting', def: 'Take your time on throw-ins, goal kicks and substitutions.', options: [['On', 'Useful to protect a lead near the end.']] },
];
const TACTIC_TERMS: Term[] = [
  T('tactics', 'Mentality', 'How much risk the whole team takes, from Very defensive to Very attacking.', 'More attacking: more players go forward, more chances for both sides. More defensive: fewer chances, fewer goals against.'),
  ...TEAM_INSTRUCTIONS.map((i) => T('tactics', i.name, i.def, i.options.map(([o, e]) => `${o}: ${e}`).join(' '))),
  ...Object.values(PRESETS).map((p) => T('tactics', `Preset: ${p.label}`, p.desc, 'One tap sets mentality and team instructions together. Change anything after.')),
  T('tactics', 'Set pieces', 'Corners, free kicks, penalties and throw-ins.', 'Choose the takers, where corners go (near post, far post, short, edge of the box), how many players go into the box and how many stay back.'),
];

const PLAYER_TERMS: Term[] = PLAYER_INSTRUCTION_KEYS.flatMap((k) => {
  const g = PLAYER_INSTRUCTION_OPTIONS[k];
  return g.options.map((o) => T('player', o.label, o.effect, `Player instructions → ${g.label}.`));
});

export const TRAIT_GROUP_LABEL: Record<string, string> = { shooting: 'Shooting', passing: 'Passing', ball: 'On the ball', defending: 'Defending', physical: 'Physical', goalkeeping: 'Goalkeeping' };
const TRAIT_TERMS: Term[] = (TRAIT_KEYS as TraitKey[]).map((k) => {
  const t = TRAITS[k];
  return T('traits', t.name, t.desc, t.effect, undefined, TRAIT_GROUP_LABEL[t.group] ?? t.group);
});

const NUMBERS: Term[] = [
  T('numbers', 'Overall', 'How good the player is right now, from 1 to 20.', 'About 14 is a Premier League regular. 17+ is world class.'),
  T('numbers', 'Potential', 'How good he could become, shown as a range like 16-18.', 'Young players grow with playing time, training and good facilities. Scouting makes the range narrower.'),
  T('numbers', 'Attributes', 'His individual skills, each from 1 to 20: passing, pace, tackling and so on.'),
  T('numbers', 'Condition', 'Energy, in %. 100% is fully rested.', 'Drops during a match and recovers between matches. Below about 80% he is slower and more likely to get injured.'),
  T('numbers', 'Sharpness', 'Match fitness. It rises by playing and falls when he sits on the bench.', 'A rusty player makes more mistakes.'),
  T('numbers', 'Morale', 'How happy he is.', 'Winning, playing time and kept promises raise it. Happy players play better.'),
  T('numbers', 'Form', 'His last few match ratings, shown as a small line.'),
  T('numbers', 'Match rating', 'A score from 1 to 10 for one match. 6 is average, 7+ is good, 8+ is excellent.'),
  T('numbers', 'Position familiarity', 'How well he knows a position.', 'Natural, Accomplished, Competent, Unconvincing, Awkward. Out of position he plays at up to a fifth below his level and makes more mistakes.'),
  T('numbers', 'Role fit', 'How well he suits the role you gave him. Shown as the ring colour on the pitch.', 'Ideal, Good, Fair, Poor, Misfit.'),
  T('numbers', 'Knowledge', 'How much your scouts know about a player, in %.', 'Higher knowledge means you see his real skills and potential.'),
  T('numbers', 'Per 90', 'A statistic per 90 minutes played, so players with different playing time can be compared.'),
];

const ATTR_HELP: [string, string][] = [
  ['Finishing', 'Scoring from chances inside the box.'], ['Long shots', 'Scoring from outside the box.'], ['Passing', 'Accuracy of passes.'],
  ['Vision', 'Seeing the pass others do not see.'], ['Crossing', 'Delivering the ball from the wing into the box.'], ['Dribbling', 'Running past opponents with the ball.'],
  ['First touch', 'Controlling the ball when it arrives.'], ['Heading', 'Winning and directing headers.'], ['Tackling', 'Winning the ball cleanly from an opponent.'],
  ['Marking', 'Staying close to an opponent to stop him.'], ['Set pieces', 'Quality of corners, free kicks and penalties.'], ['Composure', 'Staying calm under pressure and in front of goal.'],
  ['Decisions', 'Choosing the right option.'], ['Anticipation', 'Reading what will happen next.'], ['Positioning', 'Standing in the right place when defending.'],
  ['Concentration', 'Staying focused for the full match. Low concentration means late mistakes.'], ['Work rate', 'How much he runs for the team.'], ['Teamwork', 'Following the plan and helping teammates.'],
  ['Aggression', 'How hard he goes into duels. Also more fouls.'], ['Bravery', 'Willingness to block shots and head the ball in crowds.'], ['Leadership', 'Lifts the players around him. Good captains have it.'],
  ['Flair', 'Tries creative, unexpected things.'], ['Off the ball', 'Smart runs into space without the ball.'], ['Pace', 'Top speed.'],
  ['Acceleration', 'How fast he reaches top speed.'], ['Stamina', 'How long he can keep running. High stamina tires later.'], ['Strength', 'Physical power in duels.'],
  ['Agility', 'Changing direction quickly.'], ['Balance', 'Staying on his feet when pushed.'], ['Jumping', 'How high he jumps for headers.'],
  ['Natural fitness', 'How quickly he recovers and how well he stays fit as he gets older.'],
  ['Shot stopping', 'Goalkeeper: stopping shots.'], ['Reflexes', 'Goalkeeper: reacting to close shots.'], ['Handling', 'Goalkeeper: catching the ball cleanly without dropping it.'],
  ['Aerial reach', 'Goalkeeper: reaching high balls.'], ['One-on-ones', 'Goalkeeper: stopping an attacker who is through alone.'], ['Command of area', 'Goalkeeper: coming out to claim crosses.'],
  ['Distribution', 'Goalkeeper: throws and kicks to start attacks.'], ['Rushing out', 'Goalkeeper: running out to clear balls played behind the defence.'],
];
const ATTR_TERMS: Term[] = ATTR_HELP.map(([n, d]) => T('numbers', n, d, undefined, undefined, 'Attributes'));

const MATCH_TERMS: Term[] = [
  T('match', 'xG (expected goals)', 'How many goals a team "should" have scored from its chances. A penalty is about 0.8 xG. A long shot is about 0.03.', 'If you keep losing while your xG is higher, you are unlucky, not bad.'),
  T('match', 'Big chance', 'A chance a player would usually score.'),
  T('match', 'Clean sheet', 'A match where your team concedes no goals.'),
  T('match', 'Won the ball high up', 'Ball won back in the opponent\'s half. Shows how well your press works.'),
  T('match', 'Passes allowed per defensive action', 'How many passes the opponent could make in their own half before your team tried to win the ball. Lower means a harder press. Also called PPDA.'),
  T('match', 'Through balls let in behind', 'Passes that got past your defence into space. Many of these means your defensive line is too high or too slow.'),
  T('match', 'Key battle', 'A duel between one of your players and one of theirs, like your winger against their full-back.'),
  T('match', 'Man of the match', 'The best player on the pitch.'),
  T('match', 'Suspension', 'A ban after a red card or too many yellow cards. The player misses the next match or matches.'),
  T('match', 'Aggregate', 'The total score over two matches (a home and an away game) in cup rounds.'),
  T('match', 'Extra time', 'Two extra halves of 15 minutes when a cup match is level.'),
  T('match', 'Penalty shoot-out', 'If still level after extra time, each team takes penalties to decide the winner.'),
  T('match', 'Derby', 'A match between local rivals. More intense, more cards.'),
];

const TRANSFER_TERMS: Term[] = [
  T('transfers', 'Fee', 'The money you pay the selling club.'),
  T('transfers', 'Wage', 'What you pay the player every week.', 'Your total wages must fit your wage budget.'),
  T('transfers', 'Contract', 'How many seasons he is tied to your club.', 'When a contract runs out he can leave for free. Renew important players early.'),
  T('transfers', 'Squad status promise', 'What you promise him about playing time: Key player, Rotation or Backup.', 'A bigger promise helps him say yes. Break it and he gets unhappy.'),
  T('transfers', 'Counter-offer', 'The selling club says no to your price but names a higher one.'),
  T('transfers', 'Transfer-listed', 'A player his club wants to sell. Usually cheaper.'),
  T('transfers', 'Asking price', 'The price a club has set for a player they want to sell.'),
  T('transfers', 'Free agent', 'A player without a club. He costs no fee, only wages, and can sign any time.'),
  T('transfers', 'Shortlist', 'Your list of players to watch. Tap the star on a player to add him.'),
  T('transfers', 'Scouting mission', 'Your scouts travel to a region for 7 days to find young players, for £150k.', 'Choose region, position and maximum age. You get a report every day.'),
  T('transfers', 'Young talents', 'The best players aged 21 or under around the world. Also called wonderkids.', 'Transfers → Search → Young talents.'),
  T('transfers', 'Private bid', 'An offer only the other club knows about.', 'About a 30-40% chance it leaks to the press. A leak can raise the price and bring rival bids.'),
  T('transfers', 'Leak', 'When the press reports secret transfer talks.', 'The player may get unsettled, the price goes up and other clubs may bid.'),
  T('transfers', 'Unsettled', 'A player who is thinking about leaving. He may ask to be sold.'),
  T('transfers', 'Transfer embargo', 'A ban on buying players because your club is too deep in debt. You can only sign free agents until the balance recovers.'),
];

const CLUB_TERMS: Term[] = [
  T('club', 'Balance', 'The money your club has. You can go up to £20m below zero (overdraft).'),
  T('club', 'Wage budget', 'The most you can spend on weekly wages.'),
  T('club', 'Club vision', 'Three goals you choose for the season, like "finish in the top 6" or "give minutes to young players".', 'Each goal you reach pays a board bonus and makes the fans happier. Missed goals upset them. Club → Vision.'),
  T('club', 'Facilities', 'Training ground, youth academy and medical centre.', 'Better training: players improve faster. Better youth academy: better young players each season. Better medical: faster injury recovery.'),
  T('club', 'Staff', 'Assistant, coach, fitness coach, physio and chief scout.', 'Better staff give better advice, faster development, fewer injuries and more accurate scouting.'),
  T('club', 'Training focus', 'What the team practises between matches: attacking, defending, tactics, fitness, set pieces or recovery.', 'Tactical focus makes your default tactic familiar three times faster.'),
  T('club', 'Youth intake', 'New teenage players from your academy, once per season.'),
  T('club', 'Sponsorship', 'Money from companies. Offers arrive during the season. Accept or wait for a better one.'),
  T('club', 'Relegation', 'In real football, the bottom three clubs drop to a lower league.', 'Here, clubs managed by friends never go down. Finish in the bottom three and you lose £25m and some squad value instead, and a bot club drops in your place.'),
];

const FOOTBALL_TALK: Term[] = [
  T('football', 'Gegenpress', 'German for "counter-press". Win the ball back straight after losing it, by pressing hard as a group.', 'Counter-press On, pressing High or All-out.'),
  T('football', 'Tiki-taka', 'A style of short, quick passes to keep the ball for a long time.', 'Short passing, slow tempo, play out of defence.'),
  T('football', 'Park the bus', 'Defend with almost everyone near your own goal. Used to protect a lead or against a much stronger team.', 'The "Park the bus" preset.'),
  T('football', 'Low block', 'The whole team defends deep and close together. Hard to break through, but you rarely attack.'),
  T('football', 'High line', 'Defenders stand far from their own goal to keep the team compact. Risky against fast forwards.'),
  T('football', 'Pressing', 'Chasing and closing down the opponent with the ball to win it back.'),
  T('football', 'Transition', 'The moment the ball changes team. Fast teams score a lot in these moments.'),
  T('football', 'Counter-attack', 'A fast attack right after winning the ball, before the other team can organise.'),
  T('football', 'Overlap', 'A full-back running past his winger on the outside to receive the ball.'),
  T('football', 'Half-space', 'The area between the wing and the middle. Creative players like to receive the ball there.'),
  T('football', 'Between the lines', 'The space between the opponent\'s midfield and defence. Hard to mark.'),
  T('football', 'Number 10', 'A creative attacking midfielder who plays behind the striker.'),
  T('football', 'Box-to-box', 'A midfielder who runs from one penalty box to the other, attacking and defending.'),
  T('football', 'Target man', 'A tall, strong striker who wins headers and holds the ball for teammates.'),
  T('football', 'Inverted winger', 'A winger who plays on the side of his weaker foot, so he can cut inside and shoot with his stronger foot.'),
  T('football', 'Through ball', 'A pass into space behind the defence for a running teammate.'),
  T('football', 'Cross', 'A pass from the side of the pitch into the penalty box.'),
  T('football', 'Switch of play', 'A long pass from one side of the pitch to the other.'),
  T('football', 'Offside', 'An attacker cannot receive a pass if he is behind the last defender when the pass is played.'),
  T('football', 'Set piece', 'A restart after the ball stops: corner, free kick, penalty or throw-in.'),
  T('football', 'Wonderkid', 'A very talented young player expected to become a star.'),
  T('football', 'Squad rotation', 'Changing players between matches so everyone stays fresh.'),
];

export const GLOSSARY: Term[] = [
  ...BASICS, ...FOOTBALL_TALK, ...POSITIONS, ...ROLE_TERMS, ...TACTIC_TERMS, ...PLAYER_TERMS, ...TRAIT_TERMS, ...NUMBERS, ...ATTR_TERMS,
  ...MATCH_TERMS, ...TRANSFER_TERMS, ...CLUB_TERMS,
];

export const GLOSSARY_CATS: GuideCat[] = ['football', 'basics', 'positions', 'roles', 'tactics', 'player', 'traits', 'numbers', 'match', 'transfers', 'club'];

export function searchGlossary(q: string, cat: GuideCat | null): Term[] {
  const s = q.trim().toLowerCase();
  return GLOSSARY.filter((t) => (!cat || t.cat === cat) && (!s || t.term.toLowerCase().includes(s) || (t.code ?? '').toLowerCase() === s || t.def.toLowerCase().includes(s) || (t.game ?? '').toLowerCase().includes(s)));
}
