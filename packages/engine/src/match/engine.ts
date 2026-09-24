// Possession-chain match engine. The ball moves between 18 zones through discrete actions,
// each resolved as a contest between the relevant players. Every action emits into a
// structured log from which commentary, stats, ratings and analysis are all derived.
import { ATTR_KEYS, MENTAL, PHYSICAL, type AttrKey } from '../attributes.ts';
import { POS_LINE, type Pos } from '../positions.ts';
import { COMPOSITES, COMPOSITE_KEYS, stateMultiplier, rawRoleRating, type CompositeKey } from '../ratings.ts';
import { Rng, clamp, logit, sigmoid } from '../rng.ts';
import { ROLES, type ActionType, type RoleKey, type Duty, dutyIndex } from '../roles.ts';
import { detectFormation } from '../formations.ts';
import type { Instructions, Tactic, TacticSlot, Trigger } from '../tactics.ts';
import { computeInteraction, type TeamMods, type TeamProfile } from './interaction.ts';
import { ZONES, attackPresence, bandOf, chanOf, defencePresence, mirror, zoneOf } from './presence.ts';
import { renderCommentary, ZONE_PHRASE } from './commentary.ts';
import type {
  ChanceOrigin, EventType, MatchContext, MatchEvent, MatchInjury, MatchPlayerInput, MatchResult,
  Modifier, PlayerMatchStat, TeamInput, TeamStats, TriggerFired, InjurySeverity,
} from './types.ts';
import { finaliseMatch } from './post.ts';

export const K = 0.055;
/** Scales attacker-vs-defender quality gaps inside per-action contests (keeps upsets alive). */
export const QS = 0.36;
const NC = COMPOSITE_KEYS.length;
const CI: Record<CompositeKey, number> = Object.fromEntries(COMPOSITE_KEYS.map((k, i) => [k, i])) as Record<CompositeKey, number>;
const PHYS = new Set<AttrKey>(PHYSICAL);

// Pre-split composite weights into physical / mental / technical parts (fatigue hits them differently).
const MENT = new Set<AttrKey>(MENTAL);
const COMP_SPLIT: { phys: [AttrKey, number][]; ment: [AttrKey, number][]; tech: [AttrKey, number][] }[] = COMPOSITE_KEYS.map((k) => {
  const e = Object.entries(COMPOSITES[k]) as [AttrKey, number][];
  return { phys: e.filter(([a]) => PHYS.has(a)), ment: e.filter(([a]) => MENT.has(a)), tech: e.filter(([a]) => !PHYS.has(a) && !MENT.has(a)) };
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PS {
  p: MatchPlayerInput;
  side: 0 | 1;
  slot: number; // index into team.slots when on pitch
  onPitch: boolean;
  used: boolean; // has played at all
  started: boolean;
  onAt: number;
  offAt: number | null;
  role: RoleKey;
  duty: Duty;
  pos: Pos;
  cond: number;
  yellow: number;
  red: boolean;
  injured: boolean;
  perf: number;
  famFactor: number;
  famRaw: number;
  basePhys: Float64Array; // per composite physical part
  baseMent: Float64Array; // per composite mental part
  baseTech: Float64Array; // per composite technical part
  comp: Float64Array; // effective composites
  presAtt: Float64Array;
  presDef: Float64Array;
  inv: number;
  dinv: number;
  marked: number; // opposition instruction penalty
  weakFoot: number;
  hardTackled: number;
  st: PlayerMatchStat;
  isGk: boolean;
}

interface TS {
  side: 0 | 1;
  input: TeamInput;
  tactic: Tactic;
  ins: Instructions;
  mentality: number;
  slots: TacticSlot[];
  players: PS[]; // all (XI + bench)
  onPitch: PS[];
  bench: PS[];
  gk: PS | null;
  subsUsed: number;
  presAtt: Float64Array;
  presDef: Float64Array;
  mods: TeamMods;
  momentum: number;
  goals: number;
  stats: TeamStats;
  fired: Set<string>;
  planBUsed: boolean;
  formationKey: string;
  oppChanged: boolean;
  recentShots: number;
  recentBig: number;
  recentGoals: number;
  possessionTime: number;
  finalThirdTime: number;
  famTeam: number;
  pressureChains: number;
  lastSubMinute: number;
}

interface Chain {
  side: 0 | 1;
  zone: number;
  passes: number;
  transition: number; // actions left in which the defence is disorganised
  counter: boolean;
  beatMan: number; // bonus from beating a man
  support: number; // bonus from hold-up play
  lastPasser: PS | null;
  lastPassType: 'pass' | 'through' | 'cross' | 'cutback' | 'dribble' | 'set_piece' | null;
  origin: ChanceOrigin;
  pressWindow: number; // actions left in which an 'on loss' press applies
  actions: number;
}

const emptyStats = (): TeamStats => ({
  possession: 50, shots: 0, shotsOnTarget: 0, shotsBlocked: 0, xg: 0, bigChances: 0, bigChancesMissed: 0,
  passes: 0, passesCompleted: 0, passesByThird: [[0, 0], [0, 0], [0, 0]], crosses: 0, crossesCompleted: 0,
  dribbles: 0, dribblesCompleted: 0, tackles: 0, tacklesWon: 0, interceptions: 0, duelsWon: 0, duels: 0,
  aerialsWon: 0, aerials: 0, corners: 0, fouls: 0, offsides: 0, yellows: 0, reds: 0, saves: 0, clearances: 0,
  attacksByChannel: [0, 0, 0],
  chanceOrigins: { open: 0, cross: 0, through: 0, dribble: 0, set_piece: 0, long_shot: 0, counter: 0, penalty: 0 },
  zonePasses: Array.from({ length: ZONES }, () => [0, 0] as [number, number]),
  zoneTouches: new Array(ZONES).fill(0), throughBalls: 0, throughBallsCompleted: 0, counters: 0, pressWins: 0, longBalls: 0,
});

const emptyPlayerStat = (p: MatchPlayerInput, side: 0 | 1, pos: string, role: string, started: boolean, onAt: number): PlayerMatchStat => ({
  playerId: p.id, side, name: p.name, short: p.short, pos, role, started, minutes: 0, onAt, offAt: null, rating: 6,
  goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0, xa: 0, keyPasses: 0, passes: 0, passesCompleted: 0,
  dribbles: 0, dribblesCompleted: 0, crosses: 0, crossesCompleted: 0, tackles: 0, tacklesWon: 0, interceptions: 0,
  clearances: 0, aerialsWon: 0, fouls: 0, fouled: 0, offsides: 0, saves: 0, conceded: 0, errors: 0, bigChancesMissed: 0,
  yellow: 0, red: false, conditionEnd: p.condition, injured: false, touches: 0, zoneTouches: new Array(ZONES).fill(0),
  penaltiesScored: 0, penaltiesMissed: 0, ownGoals: 0,
});

// Base action weights by band (attacking perspective): short, long, through, dribble, cross, shoot, hold
const ACTIONS: ActionType[] = ['short', 'long', 'through', 'dribble', 'cross', 'shoot', 'hold'];
const BASE_W: number[][] = [
  [1.0, 0.3, 0.005, 0.012, 0, 0, 0],
  [1.0, 0.2, 0.025, 0.03, 0, 0, 0.01],
  [1.0, 0.12, 0.05, 0.05, 0.015, 0.003, 0.04],
  [1.0, 0.09, 0.08, 0.065, 0.05, 0.009, 0.05],
  [0.95, 0.03, 0.09, 0.085, 0.21, 0.041, 0.04],
  [0.65, 0.0, 0.04, 0.09, 0.19, 0.295, 0.03],
];

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export class MatchSim {
  rng: Rng;
  crng: Rng;
  ctx: MatchContext;
  teams: [TS, TS];
  events: MatchEvent[] = [];
  score: [number, number] = [0, 0];
  /** A player who gave the ball away cheaply in his own third; credited with an error if it leads to a shot. */
  pendingError: { ps: PS; side: 0 | 1; until: number } | null = null;
  htScore: [number, number] = [0, 0];
  period = 1;
  t = 0; // seconds into current period
  periodLen = 2700;
  offsetMin = 0;
  periodMinutes = 45;
  stoppage = 0;
  nextCheckpoint = 300;
  totalSeconds = 0;
  injuries: MatchInjury[] = [];
  modifiers: Modifier[] = [];
  triggersFired: TriggerFired[] = [];
  momentumTrace: number[] = [];
  extraTime = false;
  penalties: MatchResult['penalties'] = null;
  consecutiveFinalThird: [number, number] = [0, 0];
  weather: MatchContext['weather'];
  halfEvents = { goals: 0, subs: 0, injuries: 0, cards: 0 };

  constructor(home: TeamInput, away: TeamInput, ctx: MatchContext) {
    this.ctx = ctx;
    this.rng = new Rng(ctx.seed);
    this.crng = this.rng.fork('commentary');
    this.weather = ctx.weather;
    this.teams = [this.buildTeam(home, 0), this.buildTeam(away, 1)];
    // Opposition instructions target players on the other side.
    for (const t of this.teams) {
      const other = this.teams[1 - t.side];
      for (const o of (t.input.opp ?? []).slice(0, 3)) {
        const target = other.players.find((p) => p.p.id === o.playerId);
        if (!target) continue;
        if (o.type === 'tight_mark') target.marked = 6;
        if (o.type === 'weaker_foot' && target.p.foot !== 'B') target.weakFoot = 5;
        if (o.type === 'hard_tackle') target.hardTackled = 4;
      }
    }
    for (const t of this.teams) this.recomputeTeam(t);
    const inter = computeInteraction([this.profile(this.teams[0]), this.profile(this.teams[1])]);
    this.teams[0].mods = inter.mods[0];
    this.teams[1].mods = inter.mods[1];
    this.modifiers = inter.modifiers;
  }

  // ---------------------------------------------------------------- setup
  buildTeam(inp: TeamInput, side: 0 | 1): TS {
    const tactic: Tactic = JSON.parse(JSON.stringify(inp.tactic));
    const byId = new Map(inp.players.map((p) => [p.id, p]));
    const players: PS[] = [];
    const mk = (p: MatchPlayerInput, slot: number): PS => {
      const s = slot >= 0 ? tactic.slots[slot] : null;
      const basePhys = new Float64Array(NC);
      const baseMent = new Float64Array(NC);
      const baseTech = new Float64Array(NC);
      for (let i = 0; i < NC; i++) {
        let ph = 0;
        let me = 0;
        let te = 0;
        for (const [a, w] of COMP_SPLIT[i].phys) ph += p.attrs[a] * w;
        for (const [a, w] of COMP_SPLIT[i].ment) me += p.attrs[a] * w;
        for (const [a, w] of COMP_SPLIT[i].tech) te += p.attrs[a] * w;
        basePhys[i] = ph;
        baseMent[i] = me;
        baseTech[i] = te;
      }
      const sd = 0.015 + (20 - p.hidden.consistency) * 0.0035;
      let perf = clamp(this.rng.normal(1, sd), 0.86, 1.1);
      perf += (p.hidden.importantMatches - 10) * 0.004 * (this.ctx.importance - 1);
      const ps: PS = {
        p, side, slot, onPitch: slot >= 0, used: slot >= 0, started: slot >= 0, onAt: 0, offAt: null,
        role: s?.role ?? 'CM', duty: s?.duty ?? 'S', pos: s?.pos ?? 'MC', cond: p.condition, yellow: 0, red: false,
        injured: false, perf, famFactor: 1, famRaw: 1, basePhys, baseMent, baseTech, comp: new Float64Array(NC),
        presAtt: new Float64Array(ZONES), presDef: new Float64Array(ZONES), inv: 1, dinv: 1, marked: 0, weakFoot: 0, hardTackled: 0,
        st: emptyPlayerStat(p, side, s?.pos ?? '', s?.role ?? '', slot >= 0, 0), isGk: s?.pos === 'GK',
      };
      return ps;
    };
    inp.lineup.forEach((id, slot) => {
      const p = byId.get(id);
      if (p) players.push(mk(p, slot));
    });
    for (const id of inp.bench) {
      const p = byId.get(id);
      if (p && !inp.lineup.includes(id)) players.push(mk(p, -1));
    }
    const t: TS = {
      side, input: inp, tactic, ins: { ...tactic.instructions }, mentality: tactic.mentality, slots: tactic.slots.map((s) => ({ ...s })),
      players, onPitch: players.filter((p) => p.onPitch), bench: players.filter((p) => !p.onPitch),
      gk: null, subsUsed: 0, presAtt: new Float64Array(ZONES), presDef: new Float64Array(ZONES), mods: null as unknown as TeamMods,
      momentum: 0, goals: 0, stats: emptyStats(), fired: new Set(), planBUsed: false, formationKey: tactic.formation, oppChanged: false,
      recentShots: 0, recentBig: 0, recentGoals: 0, possessionTime: 0, finalThirdTime: 0,
      famTeam: clamp(inp.familiarity, 0, 1), pressureChains: 0, lastSubMinute: -10,
    };
    return t;
  }

  /** Recompute composites and presence after any change (condition, subs, tactics, cards). */
  recomputeTeam(t: TS) {
    t.onPitch = t.players.filter((p) => p.onPitch);
    t.gk = t.onPitch.find((p) => p.slot >= 0 && t.slots[p.slot].pos === 'GK') ?? null;
    t.presAtt.fill(0);
    t.presDef.fill(0);
    const opp = this.teams ? this.teams[t.side === 0 ? 1 : 0] : undefined;
    for (const ps of t.onPitch) {
      const s = t.slots[ps.slot];
      ps.role = s.role;
      ps.duty = s.duty;
      ps.pos = s.pos;
      ps.isGk = s.pos === 'GK';
      ps.famRaw = ps.p.fam[s.pos] ?? (ps.isGk ? 0.05 : 0.3);
      ps.famFactor = 0.78 + 0.22 * Math.max(0.3, ps.famRaw);
      if (ps.isGk && (ps.p.fam.GK ?? 0) < 0.5) ps.famFactor = 0.55;
      this.recomputeComposites(ps);
      ps.presAtt.fill(0);
      ps.presDef.fill(0);
      const activity = clamp(0.78 + (ps.p.attrs.workRate - 100) / 400 + (Math.min(ps.cond, 85) - 70) / 600, 0.65, 1.12);
      const params = { slot: s, role: s.role, duty: s.duty, mentality: t.mentality, ins: t.ins, activity };
      attackPresence(params, ps.presAtt);
      defencePresence(params, ps.presDef);
      const r = ROLES[s.role];
      ps.inv = r.inv * (0.75 + ps.comp[CI.pass] / 600) * (ps.marked ? 0.85 : 1);
      ps.dinv = r.dinv;
      for (let z = 0; z < ZONES; z++) {
        t.presAtt[z] += ps.presAtt[z];
        t.presDef[z] += ps.presDef[z] * (ps.isGk ? 0.6 : 1);
      }
    }
    // Opposition man-marking pulls the shape a little.
    if (opp && t.input.opp?.some((o) => o.type === 'tight_mark')) {
      const n = t.input.opp.filter((o) => o.type === 'tight_mark').length;
      for (let z = 0; z < ZONES; z++) t.presDef[z] *= 1 - 0.025 * n;
    }
  }

  recomputeComposites(ps: PS) {
    const c = ps.cond;
    const physMult = c < 70 ? 0.7 + 0.3 * (c / 70) : 1;
    const mentMult = c < 70 ? 0.85 + 0.15 * (c / 70) : 1;
    const techMult = c < 70 ? 0.86 + 0.14 * (c / 70) : 1;
    const sm = stateMultiplier(ps.p.form, ps.p.morale, ps.p.sharpness);
    const f = sm * ps.famFactor * ps.perf;
    const w = this.weather;
    for (let i = 0; i < NC; i++) {
      let v = (ps.basePhys[i] * physMult + ps.baseMent[i] * mentMult + ps.baseTech[i] * techMult) * f;
      const key = COMPOSITE_KEYS[i];
      if (w === 'rain' && (key === 'pass' || key === 'dribble')) v -= 2;
      if (w === 'heavy_rain' && (key === 'pass' || key === 'dribble' || key === 'gkSave')) v -= 4;
      if (w === 'wind' && (key === 'longPass' || key === 'cross' || key === 'longShot')) v -= 4;
      if (w === 'snow' && (key === 'pass' || key === 'dribble' || key === 'runner')) v -= 3;
      ps.comp[i] = v - ps.marked;
    }
  }

  profile(t: TS): TeamProfile {
    const onP = t.onPitch;
    const fwd = onP.filter((p) => ['ST', 'AML', 'AMR', 'AMC'].includes(t.slots[p.slot].pos));
    const back = onP.filter((p) => POS_LINE[t.slots[p.slot].pos] === 'DEF');
    const avg = (arr: PS[], k: CompositeKey) => (arr.length ? arr.reduce((s, p) => s + p.comp[CI[k]], 0) / arr.length : 120);
    return {
      tactic: t.tactic,
      name: t.input.short,
      forwardPace: fwd.reduce((m, p) => Math.max(m, p.comp[CI.runner]), 0),
      defenderComposure: back.length ? back.reduce((s, p) => s + p.p.attrs.composure, 0) / back.length : 120,
      lineRecovery: avg(back, 'recovery'),
      centralMids: t.slots.filter((s) => ['DM', 'MC', 'AMC'].includes(s.pos)).length,
      roamers: t.slots.filter((s) => ['F9', 'RPM', 'LIB'].includes(s.role)).length,
      lateRunners: t.slots.filter((s) => ['BBM', 'SS', 'MEZ'].includes(s.role) || (s.role === 'CM' && s.duty === 'A')).length,
      overlappers: t.slots.filter((s) => (s.role === 'FB' || s.role === 'WB') && s.duty !== 'D').length,
      crossers: t.slots.filter((s) => s.role === 'W' || s.role === 'WB' || s.role === 'WTM').length,
    };
  }

  // ---------------------------------------------------------------- helpers
  minute(): { m: number; ex?: number; s: number } {
    const mm = Math.floor(this.t / 60) + 1;
    const s = Math.floor(this.t % 60);
    if (mm > this.periodMinutes) return { m: this.offsetMin + this.periodMinutes, ex: mm - this.periodMinutes, s };
    return { m: this.offsetMin + mm, s };
  }

  absMinute(): number {
    return this.offsetMin + Math.min(this.periodMinutes, Math.floor(this.t / 60) + 1);
  }

  emit(t: EventType, side: 0 | 1 | -1, key: string, vars: Record<string, string | number | undefined>, extra: Partial<MatchEvent> = {}): MatchEvent {
    const mm = this.minute();
    const team = side === 0 || side === 1 ? this.teams[side].input.short : '';
    const opp = side === 0 ? this.teams[1].input.short : side === 1 ? this.teams[0].input.short : '';
    const ev: MatchEvent = {
      i: this.events.length, m: mm.m, s: mm.s, t, side: side as 0 | 1 | -1,
      txt: renderCommentary(key, { team, opp, score: this.scoreText(), ...vars }, this.crng), k: key, ...extra,
    };
    if (mm.ex) ev.ex = mm.ex;
    this.events.push(ev);
    return ev;
  }

  scoreText(): string {
    return `${this.teams[0].input.short} ${this.score[0]}-${this.score[1]} ${this.teams[1].input.short}`;
  }

  gkName(side: 0 | 1): string {
    return this.teams[side].gk?.p.short ?? 'the keeper';
  }

  c(ps: PS, k: CompositeKey): number {
    return ps.comp[CI[k]];
  }

  /** Composite points added to the attacking side's contests from context. */
  contextBonus(att: TS): number {
    let b = att.momentum * 2.5;
    if (!this.ctx.neutral) b += att.side === 0 ? this.ctx.homeAdvantage * 0.3 : -this.ctx.homeAdvantage * 0.3;
    if (att.famTeam < 0.8) b -= (0.8 - att.famTeam) * 12;
    const opp = this.teams[1 - att.side];
    if (opp.famTeam < 0.8) b += (0.8 - opp.famTeam) * 6;
    // numerical advantage
    b += (att.onPitch.length - opp.onPitch.length) * 5;
    return b;
  }

  pickWeighted(list: PS[], w: (p: PS) => number): PS | null {
    if (!list.length) return null;
    const ws = list.map(w);
    const i = this.rng.weighted(ws);
    return i < 0 ? list[Math.floor(this.rng.next() * list.length)] : list[i];
  }

  pickAttacker(t: TS, zone: number, exclude?: PS | null, allowGk = false): PS | null {
    const list = t.onPitch.filter((p) => p !== exclude && (allowGk || !p.isGk));
    return this.pickWeighted(list, (p) => (p.presAtt[zone] + 0.004) * p.inv);
  }

  pickDefender(t: TS, zoneDefPersp: number, key: CompositeKey = 'tackle'): PS | null {
    const list = t.onPitch.filter((p) => !p.isGk);
    return this.pickWeighted(list, (p) => (p.presDef[zoneDefPersp] + 0.004) * p.dinv * (0.7 + p.comp[CI[key]] / 500));
  }

  zoneRatio(att: TS, zone: number): number {
    const def = this.teams[1 - att.side];
    const dz = mirror(zone);
    let dp = def.presDef[dz];
    if (chanOf(zone) === 1 && bandOf(zone) >= 3) dp *= att.mods.oppCentralDefMult;
    return (att.presAtt[zone] + 0.3) / (dp + 0.3);
  }

  zoneBonus(att: TS, zone: number, chain: Chain): number {
    let r = this.zoneRatio(att, zone);
    if (chain.transition > 0) r *= 1.45;
    return clamp(7 * Math.log(r), -9, 9);
  }

  pressFactor(def: TS, attZone: number, chain: Chain): number {
    const b = bandOf(attZone); // attacking perspective: low band = deep in attacker's half
    const trig = def.ins.pressTrigger;
    const inRegion = trig === 'always' || (trig === 'their_half' && b <= 2) || chain.pressWindow > 0;
    const inten = { low: 0.82, normal: 1, high: 1.1, all_out: 1.2 }[def.ins.press];
    const tired = def.onPitch.reduce((s, p) => s + p.cond, 0) / Math.max(1, def.onPitch.length);
    const fatigue = tired < 70 ? (tired / 70) : 1;
    const spread = trig === 'always' ? 0.7 : 1;
    return inRegion ? 1 + (inten - 1) * fatigue * spread : 0.92;
  }

  touch(ps: PS, zone: number) {
    ps.st.touches++;
    ps.st.zoneTouches[zone]++;
    this.teams[ps.side].stats.zoneTouches[zone]++;
  }

  // ---------------------------------------------------------------- main loop
  run(): MatchResult {
    this.playPeriod(1, 0, 45);
    this.htScore = [...this.score] as [number, number];
    this.emit('ht', -1, 'ht', {});
    this.playPeriod(2, 45, 45);
    const needWinner = this.needsWinner();
    if (needWinner) {
      this.extraTime = true;
      this.emit('et', -1, 'ko_et', {});
      this.playPeriod(3, 90, 15);
      this.emit('et_ht', -1, 'et_ht', {});
      this.playPeriod(4, 105, 15);
      this.emit('aet', -1, 'aet', {});
      if (this.needsWinner()) this.shootout();
    }
    this.snapshot();
    this.emit('ft', -1, 'ft', {});
    for (const t of this.teams) {
      for (const ps of t.players) {
        if (!ps.used) continue;
        const end = ps.offAt ?? (this.extraTime ? 120 : 90);
        ps.st.minutes = Math.max(0, Math.min(this.extraTime ? 120 : 90, end) - ps.onAt);
        ps.st.conditionEnd = Math.round(ps.cond);
      }
    }
    const total = this.teams[0].possessionTime + this.teams[1].possessionTime || 1;
    this.teams[0].stats.possession = Math.round((this.teams[0].possessionTime / total) * 100);
    this.teams[1].stats.possession = 100 - this.teams[0].stats.possession;
    return finaliseMatch(this);
  }

  needsWinner(): boolean {
    if (!this.ctx.knockout) return false;
    const fl = this.ctx.firstLeg;
    const h = this.score[0] + (fl ? fl.home : 0);
    const a = this.score[1] + (fl ? fl.away : 0);
    return h === a;
  }

  playPeriod(period: number, offset: number, minutes: number) {
    this.period = period;
    this.offsetMin = offset;
    this.periodMinutes = minutes;
    this.periodLen = minutes * 60;
    this.t = 0;
    this.nextCheckpoint = 300;
    this.halfEvents = { goals: 0, subs: 0, injuries: 0, cards: 0 };
    this.stoppage = -1; // decided when regulation time is reached
    const kickoffSide: 0 | 1 = period === 1 || period === 3 ? (this.rng.chance(0.5) ? 0 : 1) : (this.lastKickoff === 0 ? 1 : 0);
    this.lastKickoff = kickoffSide;
    this.emit('ko', kickoffSide, period === 1 ? 'ko_first' : period === 2 ? 'ko_second' : 'ko_et', {});
    let side = kickoffSide;
    let zone = zoneOf(2, 1);
    let origin: ChanceOrigin = 'open';
    let actor: PS | null = null;
    while (true) {
      if (this.stoppage < 0 && this.t >= this.periodLen) {
        const base = period === 1 ? 1 : period === 2 ? 3 : 0;
        const extra = this.halfEvents.goals * 0.35 + this.halfEvents.subs * 0.25 + this.halfEvents.injuries * 0.8 + this.halfEvents.cards * 0.15;
        this.stoppage = Math.min(period === 2 ? 9 : period === 1 ? 4 : 2, Math.round(base + extra + this.rng.next() * 2)) * 60;
      }
      if (this.stoppage >= 0 && this.t >= this.periodLen + this.stoppage) break;
      const res = this.runChain(side, zone, origin, actor);
      side = res.side;
      zone = res.zone;
      origin = res.origin;
      actor = res.actor;
    }
  }

  lastKickoff: 0 | 1 = 0;

  advance(sec: number) {
    this.t += sec;
    this.totalSeconds += sec;
    while (this.t >= this.nextCheckpoint && this.nextCheckpoint <= this.periodLen + 600) {
      this.checkpoint();
      this.nextCheckpoint += 300;
    }
  }

  // ---------------------------------------------------------------- chains
  runChain(side: 0 | 1, zone: number, origin: ChanceOrigin, firstActor: PS | null): { side: 0 | 1; zone: number; origin: ChanceOrigin; actor: PS | null } {
    const att = this.teams[side];
    const def = this.teams[1 - side];
    const chain: Chain = {
      side, zone, passes: 0, transition: origin === 'counter' ? 2 : 0, counter: origin === 'counter', beatMan: 0, support: 0,
      lastPasser: null, lastPassType: null, origin, pressWindow: def.ins.pressTrigger === 'on_loss' || def.ins.counterPress ? 2 : 0, actions: 0,
    };
    if (this.pendingError && (this.pendingError.side === side ? true : this.t > this.pendingError.until)) {
      // the side that erred has the ball back, or the chance has passed
      if (this.pendingError.side === side || this.t > this.pendingError.until) this.pendingError = null;
    }
    let actor = firstActor && firstActor.onPitch ? firstActor : this.pickAttacker(att, zone, null, bandOf(zone) === 0);
    if (!actor) return { side: (1 - side) as 0 | 1, zone: mirror(zone), origin: 'open', actor: null };
    att.stats.attacksByChannel[chanOf(zone)] += 0;
    let reachedFinal = false;
    const chainStart = this.t;

    while (true) {
      if (this.stoppage >= 0 && this.t >= this.periodLen + this.stoppage) {
        att.possessionTime += this.t - chainStart;
        return { side, zone: zoneOf(2, 1), origin: 'open', actor: null };
      }
      chain.actions++;
      chain.zone = zone;
      if (bandOf(zone) >= 4 && !reachedFinal) {
        reachedFinal = true;
        att.stats.attacksByChannel[chanOf(zone)]++;
      }
      this.touch(actor, zone);
      const action = this.chooseAction(att, actor, zone, chain);
      const out = this.resolve(att, def, actor, zone, action, chain);
      if (chain.transition > 0) chain.transition--;
      if (chain.pressWindow > 0) chain.pressWindow--;
      if (out.kind === 'continue') {
        zone = out.zone;
        actor = out.actor;
        continue;
      }
      // chain over
      att.possessionTime += this.t - chainStart;
      if (bandOf(zone) >= 4) att.finalThirdTime += this.t - chainStart;
      if (reachedFinal) {
        this.consecutiveFinalThird[side]++;
        this.consecutiveFinalThird[1 - side] = 0;
        if (this.consecutiveFinalThird[side] === 4 && this.crng.chance(0.5)) {
          this.emit('chain', side, 'chain_pressure', { p: actor.p.short });
        }
      }
      if (chain.passes >= 10 && this.crng.chance(0.12)) this.emit('chain', side, 'chain_patient', { p: (chain.lastPasser ?? actor).p.short });
      return { side: out.nextSide, zone: out.zone, origin: out.origin ?? 'open', actor: out.actor };
    }
  }

  chooseAction(t: TS, a: PS, zone: number, chain: Chain): ActionType {
    const b = bandOf(zone);
    const ch = chanOf(zone);
    const wide = ch !== 1;
    const role = ROLES[a.role];
    const ins = t.ins;
    const famW = Math.min(1, t.famTeam / 0.6);
    const w = BASE_W[b].slice();
    if (a.isGk) {
      const long = ins.gkDistribution === 'long' ? 1.6 : ins.gkDistribution === 'short' ? 0.35 : 0.9;
      return this.rng.chance((0.28 * long) / (0.28 * long + 0.72)) ? 'long' : 'short';
    }
    for (let i = 0; i < ACTIONS.length; i++) {
      const tend = role.tend[ACTIONS[i]] ?? 1;
      w[i] *= 1 + (tend - 1) * famW;
    }
    // Cross only from wide areas; shooting from the box centre is favoured.
    if (!wide) w[4] *= 0.12;
    else if (b >= 4) w[4] *= 1.3;
    if (b === 5 && wide) w[5] *= 0.45;
    // Duty
    const d = dutyIndex(a.duty);
    if (d === 2) { w[5] *= 1.25; w[3] *= 1.15; w[2] *= 1.1; }
    if (d === 0) { w[5] *= 0.6; w[3] *= 0.7; w[2] *= 0.8; w[0] *= 1.1; }
    // Player quality shapes preferences
    const q = (k: CompositeKey) => Math.pow(Math.max(60, a.comp[CI[k]]) / 140, 1.5);
    w[3] *= q('dribble');
    w[2] *= q('through');
    w[4] *= q('cross');
    w[5] *= b === 5 ? q('finish') : q('longShot') * 1.1;
    w[6] *= q('hold');
    // Instructions
    if (ins.passing === 'short') { w[0] *= 1.25; w[1] *= 0.55; w[2] *= 0.9; }
    if (ins.passing === 'direct') { w[1] *= 1.6; w[2] *= 1.1; w[0] *= 0.85; }
    if (ins.tempo === 'high') { w[0] *= 0.86; w[2] *= 1.2; w[3] *= 1.1; w[5] *= 1.1; }
    if (ins.tempo === 'slow') { w[0] *= 1.25; w[2] *= 0.85; if (b < 5) w[5] *= 0.9; }
    if (b <= 1) {
      if (ins.playOutOfDefence) { w[0] *= 1.35; w[1] *= 0.5; } else w[1] *= 1.2;
    }
    if (ins.workIntoBox) { if (b === 4) w[5] *= 0.45; if (b === 5) w[0] *= 1.2; }
    if (ins.shootOnSight) { if (b === 4) w[5] *= 2; if (b === 5) w[5] *= 1.15; }
    if (ins.width === 'wide') w[4] *= 1.2;
    if (ins.width === 'narrow') w[4] *= 0.8;
    w[2] *= t.mods.throughWeight;
    w[4] *= t.mods.crossWeight;
    if (b === 4) w[5] *= t.mods.longShotWeight;
    if (chain.counter && chain.actions <= 4) { w[2] *= 1.6; w[1] *= 1.3; w[3] *= 1.25; w[0] *= 0.7; }
    // Long spells of possession push the team to try something.
    if (chain.passes > 7) { w[2] *= 1.25; w[3] *= 1.1; w[5] *= 1.1; }
    // Pressure: when heavily outnumbered, go long or keep it simple.
    const ratio = this.zoneRatio(t, zone);
    if (ratio < 0.7 && b <= 2) w[1] *= 1.5;
    // Time wasting when protecting a lead late on
    const lead = this.score[t.side] - this.score[1 - t.side];
    if (ins.timeWasting && lead > 0 && this.absMinute() >= 70) { w[0] *= 1.4; w[5] *= 0.8; w[2] *= 0.7; }
    // Chasing the game late
    if (lead < 0 && this.absMinute() >= 75) { w[5] *= 1.3; w[4] *= 1.2; w[2] *= 1.2; w[1] *= 1.2; }
    // Inverted winger cutting in on the strong foot
    if (a.role === 'IW' && ((ch === 0 && a.p.foot === 'R') || (ch === 2 && a.p.foot === 'L')) && b >= 4) { w[5] *= 1.3; w[3] *= 1.2; }
    const i = this.rng.weighted(w);
    return ACTIONS[i < 0 ? 0 : i];
  }

  // ---------------------------------------------------------------- resolution
  resolve(att: TS, def: TS, a: PS, zone: number, action: ActionType, chain: Chain): Outcome {
    switch (action) {
      case 'short': return this.doPass(att, def, a, zone, chain, false);
      case 'long': return this.doPass(att, def, a, zone, chain, true);
      case 'through': return this.doThrough(att, def, a, zone, chain);
      case 'dribble': return this.doDribble(att, def, a, zone, chain);
      case 'cross': return this.doCross(att, def, a, zone, chain, false);
      case 'shoot': return this.doShot(att, def, a, zone, chain, {});
      case 'hold': return this.doHold(att, def, a, zone, chain);
    }
  }

  turnover(def: TS, zoneAttPersp: number, winner: PS | null, chain: Chain, why: 'int' | 'tackle' | 'loose'): Outcome {
    const att = this.teams[1 - def.side];
    const z = mirror(zoneAttPersp);
    // Counter-press: the side that lost it tries to win it straight back.
    if (att.ins.counterPress && why !== 'loose') {
      const presser = this.pickDefender(att, zoneAttPersp, 'press');
      const inten = { low: 0.6, normal: 0.85, high: 1, all_out: 1.15 }[att.ins.press];
      if (presser && winner) {
        const p = 0.13 * inten * sigmoid(K * QS * (presser.comp[CI.press] - winner.comp[CI.composureC]));
        presser.cond -= 0.15;
        if (this.rng.chance(p)) {
          att.stats.pressWins++;
          presser.st.tacklesWon++;
          presser.st.tackles++;
          att.stats.tackles++;
          att.stats.tacklesWon++;
          if (bandOf(zoneAttPersp) >= 3 && this.crng.chance(0.25)) this.emit('press_win', att.side, 'press_win', { p: presser.p.short, b: winner.p.short });
          this.advance(2);
          return { kind: 'continue', zone: zoneAttPersp, actor: presser };
        }
      }
    }
    // Counter-attack chance for the side that has just won it.
    let origin: ChanceOrigin = 'open';
    if (def.ins.counter || this.rng.chance(0.15)) {
      const committed = bandOf(zoneAttPersp) >= 3 ? 1 : 0.35;
      const attackersForward = att.mentality >= 1 ? 1.3 : att.mentality <= -1 ? 0.7 : 1;
      let pc = 0.19 * committed * attackersForward * def.mods.counterMult * att.mods.transitionConcede;
      if (!def.ins.counter) pc *= 0.4;
      if (this.rng.chance(pc)) {
        origin = 'counter';
        def.stats.counters++;
        if (winner && this.crng.chance(0.45)) this.emit('counter', def.side, 'counter', { p: winner.p.short });
      }
    }
    this.advance(1.5);
    return { kind: 'end', nextSide: def.side, zone: z, actor: winner, origin };
  }

  deadBall(nextSide: 0 | 1, zone: number, secs: number, origin: ChanceOrigin = 'open'): Outcome {
    this.advance(secs);
    return { kind: 'end', nextSide, zone, actor: null, origin };
  }

  pickDest(att: TS, zone: number, long: boolean): number {
    const b = bandOf(zone);
    const c = chanOf(zone);
    const def = this.teams[1 - att.side];
    const cands: number[] = [];
    const ws: number[] = [];
    const push = (bb: number, cc: number, w: number) => {
      if (bb < 0 || bb > 5 || cc < 0 || cc > 2 || w <= 0) return;
      const z = zoneOf(bb, cc);
      const space = 1 / Math.pow(def.presDef[mirror(z)] + 0.35, 0.55);
      let ww = w * Math.pow(att.presAtt[z] + 0.02, 0.85) * space;
      if (att.ins.focus === 'left' && cc === 0) ww *= 1.35;
      if (att.ins.focus === 'right' && cc === 2) ww *= 1.35;
      if (att.ins.focus === 'centre' && cc === 1) ww *= 1.3;
      if (att.ins.width === 'wide' && cc !== 1) ww *= 1.12;
      cands.push(z);
      ws.push(ww);
    };
    const m = att.mentality;
    if (!long) {
      const bandFwd = [1.25, 1.25, 1.15, 1.0, 0.8, 0.5][b];
      const bandBack = [0.3, 0.4, 0.45, 0.6, 0.85, 1.0][b];
      let fwd = (bandFwd + 0.1 * m) * (att.ins.tempo === 'high' ? 1.18 : att.ins.tempo === 'slow' ? 0.92 : 1);
      if (att.ins.workIntoBox && b === 4) fwd *= 1.35;
      const back = Math.max(0.2, bandBack - 0.06 * m) * (att.ins.tempo === 'slow' ? 1.15 : 1);
      push(b, c, 0.7);
      push(b, c - 1, 1.0);
      push(b, c + 1, 1.0);
      push(b + 1, c, fwd);
      push(b + 1, c - 1, fwd * 0.7);
      push(b + 1, c + 1, fwd * 0.7);
      if (b > 0) { push(b - 1, c, back); push(b - 1, c - 1, back * 0.5); push(b - 1, c + 1, back * 0.5); }
    } else {
      push(b + 2, 0, 0.9); push(b + 2, 1, 1.1); push(b + 2, 2, 0.9);
      push(b + 3, 0, 0.5); push(b + 3, 1, 0.8); push(b + 3, 2, 0.5);
      push(b, 2 - c, c === 1 ? 0 : 0.8); // switch of play
      push(b + 1, 2 - c, c === 1 ? 0 : 0.6);
    }
    if (!cands.length) return zone;
    const i = this.rng.weighted(ws);
    return cands[i < 0 ? 0 : i];
  }

  doPass(att: TS, def: TS, a: PS, zone: number, chain: Chain, long: boolean): Outcome {
    let dest = this.pickDest(att, zone, long);
    const receiver = this.pickAttacker(att, dest, a) ?? a;
    const b0 = bandOf(zone);
    const b1 = bandOf(dest);
    const third = b0 <= 1 ? 0 : b0 <= 3 ? 1 : 2;
    att.stats.passes++;
    att.stats.passesByThird[third][0]++;
    att.stats.zonePasses[zone][0]++;
    a.st.passes++;
    if (long) att.stats.longBalls++;
    const defZone = mirror(dest);
    const deeper = bandOf(defZone) > 0 ? defZone - 3 : defZone;
    const defender = this.pickWeighted(def.onPitch.filter((p) => !p.isGk), (p) => (p.presDef[defZone] + 0.7 * p.presDef[deeper] + 0.004) * p.dinv * (0.7 + p.comp[CI.intercept] / 500));
    const pf = this.pressFactor(def, zone, chain);
    let A = long ? a.comp[CI.longPass] : a.comp[CI.pass];
    A += (receiver.p.attrs.firstTouch - 120) * 0.08;
    if (a.isGk) A = a.comp[CI.gkDist];
    let D = defender ? defender.comp[CI.intercept] * 0.6 + defender.comp[CI.press] * 0.4 : 110;
    D += (pf - 1) * 30;
    let base = long ? 2 : b1 > b0 ? 20 : b1 === b0 ? 31 : 38;
    if (b1 === 4) base -= 4;
    if (b1 === 5) base -= 10;
    if (long && ROLES[receiver.role].tend.hold && (ROLES[receiver.role].tend.hold ?? 0) > 1.5) base += 4;
    base += att.mods.possessionBias;
    if (!long && att.ins.passing === 'short') base += 3;
    if (!long && att.ins.tempo === 'slow') base += 2;
    if (a.famRaw < 0.7) base -= (0.7 - a.famRaw) * 20;
    const C = this.zoneBonus(att, dest, chain) + this.contextBonus(att) + chain.support;
    chain.support = 0;
    const p = sigmoid(K * (0.27 * (A - D) + C + base));
    const tempoSec = att.ins.tempo === 'high' ? 2.6 : att.ins.tempo === 'slow' ? 3.5 : 3.0;
    this.advance(long ? 4.5 + this.rng.next() * 1.5 : tempoSec + this.rng.next() * 1.4);
    if (this.rng.chance(p)) {
      att.stats.passesCompleted++;
      att.stats.passesByThird[third][1]++;
      att.stats.zonePasses[zone][1]++;
      a.st.passesCompleted++;
      chain.passes++;
      chain.lastPasser = a;
      chain.lastPassType = b1 >= 5 && b0 >= 4 && chanOf(zone) !== 1 && chanOf(dest) === 1 ? 'cutback' : 'pass';
      // Receiver clattered as he takes it: the most common source of fouls.
      if (defender && b1 >= 1 && b1 <= 4 && receiver !== a) {
        const agg = (defender.p.attrs.aggression / 130) * (def.ins.tackling === 'hard' ? 1.3 : def.ins.tackling === 'careful' ? 0.72 : 1) * (defender.yellow ? 0.5 : 1);
        if (this.rng.chance(0.024 * pf * agg * (this.ctx.derby ? 1.12 : 1))) return this.foul(att, def, defender, receiver, dest, chain, chain.counter && b1 >= 3);
      }
      if (long && b1 >= 4 && this.rng.chance(0.1 + (def.ins.offsideTrap ? 0.06 : 0))) {
        att.stats.offsides++;
        receiver.st.offsides++;
        if (this.crng.chance(0.5)) this.emit('offside', att.side, 'offside', { p: receiver.p.short });
        return this.deadBall(def.side, mirror(dest), 16 + this.rng.next() * 8);
      }
      if (long && this.crng.chance(0.08) && b1 >= 3) this.emit('chain', att.side, 'chain_direct', { p: a.p.short });
      // Press-break: completed pass out of the back against an all-out press opens a break.
      if (b0 <= 1 && def.ins.press === 'all_out' && att.mods.pressBreak > 0 && this.rng.chance(att.mods.pressBreak)) {
        chain.transition = 2;
        chain.counter = true;
        dest = zoneOf(Math.min(5, b1 + 1), chanOf(dest));
      } else if (b0 <= 2 && b1 >= 3 && b1 > b0 && (def.ins.press === 'all_out' || def.ins.press === 'high')) {
        // Beating a high press leaves space behind it.
        const exposed = (def.ins.press === 'all_out' ? 0.2 : 0.11) * (def.ins.pressTrigger === 'always' ? 1.2 : 1);
        if (this.rng.chance(exposed)) chain.transition = Math.max(chain.transition, 1);
      }
      return { kind: 'continue', zone: dest, actor: receiver };
    }
    // failed: some misplaced passes go out of play
    if (this.rng.chance(long ? 0.35 : 0.14)) {
      return this.deadBall(def.side, defZone, 14 + this.rng.next() * 10);
    }
    // Only a share of regains are true interceptions; the rest are loose balls picked up.
    if (defender && this.rng.chance(long ? 0.22 : 0.3)) {
      defender.st.interceptions++;
      def.stats.interceptions++;
    }
    if (b0 <= 1 && !long && this.rng.chance(0.2)) this.pendingError = { ps: a, side: att.side, until: this.t + 20 };
    return this.turnover(def, dest, defender, chain, 'int');
  }

  doThrough(att: TS, def: TS, a: PS, zone: number, chain: Chain): Outcome {
    const b = bandOf(zone);
    const destBand = Math.min(5, b + (b >= 4 ? 1 : 2));
    const destChan = this.rng.weighted([0.25, 0.5, 0.25]);
    const dest = zoneOf(destBand, destChan < 0 ? 1 : destChan);
    const runners = att.onPitch.filter((p) => p !== a && !p.isGk);
    const runner = this.pickWeighted(runners, (p) => (p.presAtt[dest] + p.presAtt[zoneOf(Math.max(0, destBand - 1), chanOf(dest))] + 0.01) * Math.pow(p.comp[CI.runner] / 140, 2)) ?? a;
    att.stats.throughBalls++;
    att.stats.passes++;
    a.st.passes++;
    const third = b <= 1 ? 0 : b <= 3 ? 1 : 2;
    att.stats.passesByThird[third][0]++;
    att.stats.zonePasses[zone][0]++;
    const defZone = mirror(dest);
    const defender = this.pickDefender(def, defZone, 'intercept');
    const lineHigh = def.ins.line === 'high' || def.ins.line === 'very_high';
    const back = def.onPitch.filter((p) => POS_LINE[p.pos] === 'DEF');
    const lineDef = back.length ? back.reduce((s, p) => s + p.comp[CI.lineDef], 0) / back.length : 120;
    const A = a.comp[CI.through] * 0.6 + runner.comp[CI.runner] * 0.4;
    const D = lineDef * 0.55 + (defender ? defender.comp[CI.intercept] : 110) * 0.45;
    let base = -12 + (lineHigh ? 3 : def.ins.line === 'deep' ? -6 : 0);
    const recovery = back.length ? Math.max(...back.map((p) => p.comp[CI.recovery])) : 120;
    if (lineHigh) base += clamp((runner.comp[CI.runner] - recovery) * 0.15, -4, 8);
    const C = this.zoneBonus(att, dest, chain) * 0.5 + this.contextBonus(att);
    const p = sigmoid(K * (QS * (A - D) + C + base));
    this.advance(3.5 + this.rng.next() * 1.5);
    if (this.rng.chance(p)) {
      // Offside?
      const trap = def.ins.offsideTrap;
      let pOff = 0.2 + (trap ? 0.12 : 0) + (lineHigh ? 0.06 : 0) + att.mods.offsideRisk * 0;
      pOff += def.mods.offsideRisk * 0; // symmetric hook
      pOff -= (runner.p.attrs.anticipation + runner.p.attrs.offTheBall - 260) / 800;
      if (this.rng.chance(clamp(pOff, 0.03, 0.4))) {
        att.stats.offsides++;
        runner.st.offsides++;
        if (this.crng.chance(0.7)) this.emit('offside', att.side, 'through_offside', { p: runner.p.short, b: a.p.short });
        return this.deadBall(def.side, mirror(dest), 18 + this.rng.next() * 8);
      }
      att.stats.throughBallsCompleted++;
      att.stats.passesCompleted++;
      att.stats.passesByThird[third][1]++;
      att.stats.zonePasses[zone][1]++;
      a.st.passesCompleted++;
      chain.passes++;
      chain.lastPasser = a;
      chain.lastPassType = 'through';
      const trapBeaten = trap || lineHigh;
      const clean = 0.36 + (lineHigh ? 0.08 : 0) + clamp((runner.comp[CI.runner] - recovery) / 300, -0.1, 0.15);
      if (destBand >= 5 && this.rng.chance(clean)) {
        // Clean through on goal: keeper may sweep
        const gk = def.gk;
        if (gk) {
          const sweep = def.gk?.role === 'SK' ? 1.3 : 1;
          const pSweep = 0.16 * sweep * sigmoid(K * (gk.comp[CI.gkSweep] - runner.comp[CI.runner]));
          if (this.rng.chance(pSweep)) {
            gk.st.saves++;
            def.stats.saves++;
            if (this.crng.chance(0.6)) this.emit('save', def.side, 'save_sweep', { p: runner.p.short, gk: gk.p.short });
            this.advance(2);
            return { kind: 'end', nextSide: def.side, zone: zoneOf(0, 1), actor: gk, origin: 'open' };
          }
        }
        if (this.crng.chance(0.55)) this.emit('through', att.side, 'through_ok', { p: runner.p.short, b: a.p.short, zone: ZONE_PHRASE(destBand, chanOf(dest)) }, { a: runner.p.id, b: a.p.id, z: dest });
        return this.doShot(att, def, runner, dest, chain, { oneOnOne: true, trapBeaten });
      }
      return { kind: 'continue', zone: dest, actor: runner };
    }
    if (defender && this.rng.chance(0.45)) {
      defender.st.interceptions++;
      def.stats.interceptions++;
    }
    if (this.crng.chance(0.12)) this.emit('through', att.side, 'through_int', { p: defender?.p.short ?? 'a defender', b: a.p.short });
    return this.turnover(def, dest, defender, chain, 'int');
  }

  doDribble(att: TS, def: TS, a: PS, zone: number, chain: Chain): Outcome {
    const b = bandOf(zone);
    const c = chanOf(zone);
    const defZone = mirror(zone);
    const defender = this.pickDefender(def, defZone, 'tackle');
    att.stats.dribbles++;
    a.st.dribbles++;
    att.stats.duels++;
    def.stats.duels++;
    let A = a.comp[CI.dribble] - a.hardTackled;
    const D = defender ? defender.comp[CI.tackle] : 100;
    const C = this.zoneBonus(att, zone, chain) * 0.6 + this.contextBonus(att) + chain.beatMan * 0.3;
    const p = sigmoid(K * (QS * (A - D) + C - 2));
    this.advance(3 + this.rng.next() * 1.5);
    if (defender) { defender.st.tackles++; def.stats.tackles++; }
    const aggression = defender ? (defender.p.attrs.aggression / 130) * (def.ins.tackling === 'hard' ? 1.3 : def.ins.tackling === 'careful' ? 0.72 : 1) * (defender.yellow ? 0.5 : 1) * (this.ctx.derby ? 1.1 : 1) : 1;
    if (this.rng.chance(p)) {
      a.st.dribblesCompleted++;
      att.stats.dribblesCompleted++;
      att.stats.duelsWon++;
      // tactical foul to stop a break?
      if (defender && this.rng.chance((0.07 + (chain.counter ? 0.14 : 0) + (b >= 3 ? 0.03 : 0)) * aggression)) {
        return this.foul(att, def, defender, a, zone, chain, chain.counter || b >= 4);
      }
      let nb = Math.min(5, b + 1);
      let nc = c;
      if (a.role === 'IW' || a.role === 'WP' || (a.role === 'MEZ' && b >= 4)) nc = 1;
      if (a.role === 'W' && b >= 3) nb = Math.min(5, b + 1);
      const dest = zoneOf(nb, nc);
      chain.beatMan = 8;
      chain.lastPassType = 'dribble';
      chain.lastPasser = a;
      if (b >= 3 && this.crng.chance(0.3)) this.emit('dribble', att.side, 'dribble_ok', { p: a.p.short, b: defender?.p.short ?? 'his man', zone: ZONE_PHRASE(nb, nc) }, { a: a.p.id, b: defender?.p.id, z: dest });
      return { kind: 'continue', zone: dest, actor: a };
    }
    // failed dribble
    if (defender) {
      def.stats.duelsWon++;
      if (this.rng.chance(0.2 * aggression * (b === 5 ? 0.35 : 1))) return this.foul(att, def, defender, a, zone, chain, false);
      defender.st.tacklesWon++;
      def.stats.tacklesWon++;
      if (b >= 4 && this.crng.chance(0.18)) this.emit('dribble', att.side, 'dribble_fail', { p: a.p.short, b: defender.p.short }, { a: a.p.id, b: defender.p.id });
    }
    return this.turnover(def, zone, defender, chain, 'tackle');
  }

  doHold(att: TS, def: TS, a: PS, zone: number, chain: Chain): Outcome {
    const defZone = mirror(zone);
    const defender = this.pickDefender(def, defZone, 'tackle');
    att.stats.duels++;
    def.stats.duels++;
    const A = a.comp[CI.hold];
    const D = defender ? defender.comp[CI.tackle] * 0.5 + defender.p.attrs.strength * 0.5 : 100;
    const p = sigmoid(K * (QS * (A - D) + this.contextBonus(att) + 6));
    this.advance(4 + this.rng.next() * 3);
    if (this.rng.chance(p)) {
      att.stats.duelsWon++;
      chain.support = 6;
      return { kind: 'continue', zone, actor: this.pickAttacker(att, zone, a) ?? a };
    }
    if (defender && this.rng.chance(0.24)) return this.foul(att, def, defender, a, zone, chain, false);
    if (defender) { def.stats.duelsWon++; defender.st.tacklesWon++; defender.st.tackles++; def.stats.tackles++; def.stats.tacklesWon++; }
    return this.turnover(def, zone, defender, chain, 'tackle');
  }

  doCross(att: TS, def: TS, a: PS, zone: number, chain: Chain, fromSetPiece: boolean, taker?: PS): Outcome {
    const c = chanOf(zone);
    const crosser = taker ?? a;
    att.stats.crosses++;
    crosser.st.crosses++;
    this.advance(3.5 + this.rng.next());
    const boxZone = zoneOf(5, 1);
    const dBox = mirror(boxZone);
    const acc = fromSetPiece ? crosser.comp[CI.setPiece] + 6 : crosser.comp[CI.cross] - crosser.weakFoot;
    const pAcc = sigmoid(K * (QS * (acc - 150) + att.mods.crossBonus + (att.ins.width === 'wide' ? 2 : 0))) * (fromSetPiece ? 0.78 : 0.46);
    if (!this.rng.chance(pAcc)) {
      const clearer = this.pickDefender(def, dBox, 'aerialDef');
      if (clearer) { clearer.st.clearances++; def.stats.clearances++; }
      if (this.crng.chance(0.1)) this.emit('cross', att.side, 'cross_miss', { p: crosser.p.short, zone: ZONE_PHRASE(bandOf(zone), c) });
      if (this.rng.chance(0.22)) return this.corner(att, def, c);
      if (this.rng.chance(0.3)) return this.deadBall(def.side, zoneOf(0, 2 - c), 14 + this.rng.next() * 8);
      return this.turnover(def, boxZone, clearer, chain, 'loose');
    }
    att.stats.crossesCompleted++;
    crosser.st.crossesCompleted++;
    const gk = def.gk;
    if (gk && this.rng.chance(0.2 * sigmoid(K * (gk.comp[CI.gkClaim] - 135)) * 1.6)) {
      if (this.crng.chance(0.3)) this.emit('cross', att.side, 'cross_claim', { p: crosser.p.short, gk: gk.p.short });
      this.advance(4);
      return { kind: 'end', nextSide: def.side, zone: zoneOf(0, 1), actor: gk, origin: 'open' };
    }
    const targets = att.onPitch.filter((p) => p !== crosser && !p.isGk);
    const target = this.pickWeighted(targets, (p) => (p.presAtt[boxZone] + p.presAtt[zoneOf(5, 0)] * 0.5 + p.presAtt[zoneOf(5, 2)] * 0.5 + 0.02) * Math.pow(p.comp[CI.headerAtt] / 130, 2.5)) ?? a;
    const defender = this.pickDefender(def, dBox, 'aerialDef');
    att.stats.aerials++;
    def.stats.aerials++;
    const inBoxBonus = fromSetPiece ? (att.tactic.setPieces.inBox - 5) * 2 : 0;
    const A = target.comp[CI.headerAtt];
    const D = defender ? defender.comp[CI.aerialDef] : 110;
    const pWin = sigmoid(K * (QS * (A - D) + this.zoneBonus(att, boxZone, chain) * 0.5 + inBoxBonus - 2)) * 0.75;
    if (this.rng.chance(pWin)) {
      att.stats.aerialsWon++;
      target.st.aerialsWon++;
      chain.lastPasser = crosser;
      chain.lastPassType = fromSetPiece ? 'set_piece' : 'cross';
      return this.doShot(att, def, target, boxZone, chain, { header: true, setPiece: fromSetPiece });
    }
    if (defender) {
      def.stats.aerialsWon++;
      defender.st.aerialsWon++;
      defender.st.clearances++;
      def.stats.clearances++;
      // rare own goal
      if (this.rng.chance(0.0045)) return this.ownGoal(att, def, defender);
    }
    if (this.crng.chance(0.12)) this.emit('cross', att.side, 'cross_clear', { p: crosser.p.short, b: defender?.p.short ?? 'a defender', zone: ZONE_PHRASE(bandOf(zone), c) });
    const r = this.rng.next();
    if (r < 0.24) return this.corner(att, def, c);
    if (r < 0.5) {
      // second ball won by attackers around the box
      const z2 = zoneOf(4, 1);
      return { kind: 'continue', zone: z2, actor: this.pickAttacker(att, z2, null) ?? a };
    }
    return this.turnover(def, zoneOf(4, 1), defender, chain, 'loose');
  }

  corner(att: TS, def: TS, chan: number): Outcome {
    att.stats.corners++;
    if (this.crng.chance(0.35)) this.emit('corner', att.side, 'corner', { zone: chan === 0 ? 'on the left' : 'on the right' });
    this.advance(28 + this.rng.next() * 16);
    const sp = att.tactic.setPieces;
    const taker = (sp.cornerTaker && att.onPitch.find((p) => p.p.id === sp.cornerTaker)) || this.bestBy(att, 'setPiece');
    const chain: Chain = {
      side: att.side, zone: zoneOf(5, chan === 0 ? 0 : 2), passes: 0, transition: 0, counter: false, beatMan: 0, support: 0,
      lastPasser: taker, lastPassType: 'set_piece', origin: 'set_piece', pressWindow: 0, actions: 0,
    };
    if (sp.cornerDelivery === 'short') {
      return { kind: 'continue', zone: zoneOf(4, chan === 0 ? 0 : 2), actor: taker ?? this.pickAttacker(att, zoneOf(4, 0)) ?? att.onPitch[0] };
    }
    if (sp.cornerDelivery === 'edge' && this.rng.chance(0.6)) {
      const shooter = this.bestBy(att, 'longShot', [taker]);
      if (shooter) return this.doShot(att, def, shooter, zoneOf(4, 1), chain, { setPiece: true });
    }
    // Counter-risk when many committed and few stay back is handled via the defending side's counter chance.
    return this.doCross(att, def, taker ?? att.onPitch[0], zoneOf(5, chan === 0 ? 0 : 2), chain, true, taker ?? undefined);
  }

  bestBy(t: TS, k: CompositeKey, exclude: (PS | null | undefined)[] = []): PS | null {
    let best: PS | null = null;
    for (const p of t.onPitch) {
      if (p.isGk || exclude.includes(p)) continue;
      if (!best || p.comp[CI[k]] > best.comp[CI[k]]) best = p;
    }
    return best;
  }

  foul(att: TS, def: TS, offender: PS, victim: PS, zone: number, chain: Chain, tactical: boolean): Outcome {
    def.stats.fouls++;
    offender.st.fouls++;
    victim.st.fouled++;
    const b = bandOf(zone);
    const c = chanOf(zone);
    const temper = (20 - offender.p.hidden.temperament) * 0.006;
    let pYellow = 0.095 + temper + (tactical ? 0.32 : 0) + (def.ins.tackling === 'hard' ? 0.04 : 0) + (this.ctx.derby ? 0.03 : 0) + (this.ctx.importance - 1) * 0.05;
    if (b >= 4) pYellow += 0.03;
    const pRed = 0.0012 + (tactical && b >= 4 && chain.counter ? 0.015 : 0) + (def.ins.tackling === 'hard' ? 0.001 : 0);
    const key = tactical ? 'foul_tactical' : 'foul';
    if (b === 5 && this.rng.chance(tactical ? 0.45 : 0.28)) {
      // penalty
      this.halfEvents.cards += 0;
      this.emit('penalty', att.side, 'penalty', { p: victim.p.short, b: offender.p.short }, { a: victim.p.id, b: offender.p.id, big: true });
      this.card(def, offender, pYellow * 0.8, pRed * 2, victim);
      this.injuryOnFoul(victim);
      this.advance(60 + this.rng.next() * 30);
      return this.penalty(att, def);
    }
    if (this.crng.chance(tactical ? 0.8 : b >= 4 ? 0.5 : 0.18)) this.emit('foul', def.side, key, { p: offender.p.short, b: victim.p.short }, { a: offender.p.id, b: victim.p.id, z: mirror(zone) });
    this.card(def, offender, pYellow, pRed, victim);
    this.injuryOnFoul(victim);
    if (!victim.onPitch) {
      // victim was forced off; restart without him
    }
    this.advance(18 + this.rng.next() * 18);
    // Free kick
    if (b === 4 && c === 1 && this.rng.chance(0.55)) {
      att.stats.chanceOrigins.set_piece += 0;
      if (this.crng.chance(0.6)) this.emit('freekick', att.side, 'freekick', { p: victim.p.short });
      const sp = att.tactic.setPieces;
      const taker = (sp.freeKickTaker && att.onPitch.find((p) => p.p.id === sp.freeKickTaker)) || this.bestBy(att, 'setPiece');
      const fkChain: Chain = { ...chain, lastPasser: null, lastPassType: 'set_piece', origin: 'set_piece', transition: 0, counter: false };
      if (taker) return this.doShot(att, def, taker, zone, fkChain, { freeKick: true });
    }
    if (b >= 4 && c !== 1 && this.rng.chance(0.55)) {
      const sp = att.tactic.setPieces;
      const taker = (sp.freeKickTaker && att.onPitch.find((p) => p.p.id === sp.freeKickTaker)) || this.bestBy(att, 'setPiece');
      const fkChain: Chain = { ...chain, lastPassType: 'set_piece', origin: 'set_piece', transition: 0, counter: false };
      if (taker) return this.doCross(att, def, taker, zone, fkChain, true, taker);
    }
    return { kind: 'end', nextSide: att.side, zone, actor: victim.onPitch ? victim : null, origin: 'open' };
  }

  card(def: TS, offender: PS, pYellow: number, pRed: number, victim: PS) {
    if (!offender.onPitch) return;
    if (offender.yellow) pYellow *= 0.55; // already booked: referees are a touch lenient, players more careful
    if (this.rng.chance(pRed)) {
      offender.red = true;
      offender.st.red = true;
      def.stats.reds++;
      this.halfEvents.cards++;
      this.emit('red', def.side, 'red', { p: offender.p.short, b: victim.p.short }, { a: offender.p.id, big: true });
      this.sendOff(def, offender);
      return;
    }
    if (this.rng.chance(pYellow)) {
      offender.yellow++;
      offender.st.yellow++;
      def.stats.yellows++;
      this.halfEvents.cards++;
      if (offender.yellow >= 2) {
        offender.red = true;
        offender.st.red = true;
        def.stats.reds++;
        this.emit('red', def.side, 'second_yellow', { p: offender.p.short }, { a: offender.p.id, big: true, o: 'second_yellow' });
        this.sendOff(def, offender);
      } else {
        this.emit('yellow', def.side, 'yellow', { p: offender.p.short }, { a: offender.p.id });
      }
    }
  }

  sendOff(t: TS, ps: PS) {
    ps.onPitch = false;
    ps.offAt = this.absMinute();
    const wasGk = ps.isGk;
    this.recomputeTeam(t);
    if (wasGk) {
      const benchGk = t.bench.find((p) => !p.used && (p.p.fam.GK ?? 0) >= 0.8);
      if (benchGk && t.subsUsed < this.ctx.maxSubs) {
        const out = t.onPitch.filter((p) => POS_LINE[t.slots[p.slot].pos] === 'ATT').sort((a, b) => a.comp[CI.finish] - b.comp[CI.finish])[0] ?? t.onPitch.filter((p) => !p.isGk)[0];
        if (out) {
          const gkSlot = ps.slot;
          this.makeSub(t, out, benchGk, 'sub', gkSlot);
        }
      } else {
        // outfielder goes in goal
        const stand = t.onPitch.filter((p) => !p.isGk).sort((a, b) => (b.p.attrs.handling + b.p.attrs.reflexes) - (a.p.attrs.handling + a.p.attrs.reflexes))[0];
        if (stand) {
          const oldSlot = stand.slot;
          stand.slot = ps.slot;
          void oldSlot;
          this.recomputeTeam(t);
        }
      }
    }
    this.runTriggers(t, 'red');
  }

  injuryOnFoul(victim: PS) {
    if (!victim.onPitch) return;
    if (this.rng.chance(0.008)) this.injure(this.teams[victim.side], victim, true);
  }

  penalty(att: TS, def: TS): Outcome {
    const sp = att.tactic.setPieces;
    const taker = (sp.penaltyTaker && att.onPitch.find((p) => p.p.id === sp.penaltyTaker)) || this.bestBy(att, 'penalty')!;
    const gk = def.gk;
    const xg = 0.76;
    att.stats.shots++;
    att.stats.xg += xg;
    att.stats.bigChances++;
    att.stats.chanceOrigins.penalty++;
    taker.st.shots++;
    taker.st.xg += xg;
    const p = clamp(sigmoid(logit(0.77) + (taker.comp[CI.penalty] - 150) * 0.012 - ((gk?.comp[CI.gkSave] ?? 100) - 150) * 0.006), 0.55, 0.92);
    this.advance(10);
    if (this.rng.chance(p)) {
      att.stats.shotsOnTarget++;
      taker.st.shotsOnTarget++;
      taker.st.penaltiesScored++;
      return this.goal(att, def, taker, null, xg, 'goal_penalty', zoneOf(5, 1), 'penalty');
    }
    taker.st.penaltiesMissed++;
    taker.st.bigChancesMissed++;
    att.stats.bigChancesMissed++;
    if (gk && this.rng.chance(0.7)) {
      att.stats.shotsOnTarget++;
      taker.st.shotsOnTarget++;
      gk.st.saves++;
      def.stats.saves++;
      this.emit('shot', att.side, 'penalty_saved', { p: taker.p.short, gk: gk.p.short }, { a: taker.p.id, xg, o: 'saved', big: true, or: 'penalty', z: zoneOf(5, 1) });
      if (this.rng.chance(0.3)) return this.corner(att, def, 0);
      return { kind: 'end', nextSide: def.side, zone: zoneOf(0, 1), actor: gk, origin: 'open' };
    }
    this.emit('shot', att.side, 'penalty_missed', { p: taker.p.short }, { a: taker.p.id, xg, o: 'off', big: true, or: 'penalty', z: zoneOf(5, 1) });
    return this.deadBall(def.side, zoneOf(0, 1), 25);
  }

  doShot(att: TS, def: TS, a: PS, zone: number, chain: Chain, f: { oneOnOne?: boolean; header?: boolean; setPiece?: boolean; freeKick?: boolean; trapBeaten?: boolean }): Outcome {
    if (this.pendingError && this.pendingError.side === def.side && this.t <= this.pendingError.until) {
      this.pendingError.ps.st.errors++;
      this.pendingError = null;
    }
    const b = bandOf(zone);
    const c = chanOf(zone);
    const inBox = b === 5;
    const longShot = !inBox && !f.header;
    // --- xG ---
    let base: number;
    if (f.freeKick) base = 0.058;
    else if (f.header) base = f.setPiece ? 0.066 : 0.078;
    else if (f.oneOnOne) base = 0.3;
    else if (inBox) base = c === 1 ? 0.08 : 0.037;
    else if (b === 4) base = c === 1 ? 0.032 : 0.02;
    else base = 0.011;
    let lg = logit(base) - 0.08;
    const skill = f.header ? a.comp[CI.headerAtt] : longShot ? a.comp[CI.longShot] : a.comp[CI.finish];
    lg += (skill - 145) * 0.004;
    if (!f.oneOnOne && !f.freeKick) {
      const pressure = def.presDef[mirror(zone)];
      lg -= clamp((pressure - 1.1) * 0.22, -0.3, 0.45);
    }
    if (chain.lastPassType === 'cutback') lg += 0.55;
    if (chain.lastPassType === 'dribble' && chain.beatMan > 0) lg += 0.3;
    if (chain.counter) lg += 0.2;
    if (f.oneOnOne) {
      lg += Math.log(att.mods.throughXg);
      if (f.trapBeaten) lg += Math.log(att.mods.trapBeatBonus);
    }
    if (inBox && !f.header && !f.oneOnOne) {
      lg += Math.log(att.mods.boxXgMult);
      if (att.ins.workIntoBox) lg += 0.12;
      if (def.ins.line === 'deep') lg -= 0.12;
    }
    if (c !== 1 && a.weakFoot) lg -= 0.2;
    // Six-yard box / tap-in chance
    let tapIn = false;
    if (inBox && c === 1 && !f.header && !f.oneOnOne && chain.lastPassType === 'cutback' && this.rng.chance(0.3)) {
      lg = logit(0.31);
      tapIn = true;
    }
    const xg = clamp(sigmoid(lg), 0.005, 0.8);
    const big = xg >= 0.3;
    att.stats.shots++;
    att.stats.xg += xg;
    a.st.shots++;
    a.st.xg += xg;
    att.recentShots++;
    if (big) { att.stats.bigChances++; att.recentBig++; }
    const assister = chain.lastPasser && chain.lastPasser !== a ? chain.lastPasser : null;
    if (assister) {
      assister.st.keyPasses++;
      assister.st.xa += xg;
    }
    const origin: ChanceOrigin = f.freeKick || f.setPiece ? 'set_piece' : chain.counter ? 'counter' : f.header || chain.lastPassType === 'cross' ? 'cross' : chain.lastPassType === 'through' ? 'through' : chain.lastPassType === 'dribble' ? 'dribble' : longShot ? 'long_shot' : 'open';
    att.stats.chanceOrigins[origin]++;
    this.advance(2 + this.rng.next() * 2);
    // --- outcome ---
    const gk = def.gk;
    const gkSave = gk ? gk.comp[CI.gkSave] : 40;
    // Keeper quality relative to a league-average keeper (composite ~145): elite ~ -10%, poor ~ +10%.
    const gkFactor = clamp(1 - (gkSave - 145) / 400, 0.82, 1.2);
    let pBlock = f.oneOnOne || f.freeKick ? 0.03 : f.header ? 0.07 : longShot ? 0.36 : 0.24 + clamp((def.presDef[mirror(zone)] - 1) * 0.06, -0.05, 0.1);
    const pGoal = clamp((xg * gkFactor) / (1 - pBlock), 0, 0.93);
    let pOn = clamp(0.33 + 1.05 * xg + (skill - 145) / 700, 0.24, 0.93);
    if (longShot) pOn *= 0.82;
    pOn = Math.max(pOn, pGoal + 0.04);
    const r = this.rng.next();
    if (r < pBlock) {
      att.stats.shotsBlocked++;
      const blocker = this.pickDefender(def, mirror(zone), 'tackle');
      if (blocker) blocker.st.clearances++;
      this.emit('shot', att.side, 'shot_blocked', { p: a.p.short, b: blocker?.p.short ?? 'a defender' }, { a: a.p.id, xg, o: 'blocked', z: zone, or: origin });
      if (this.rng.chance(0.35)) return this.corner(att, def, this.rng.chance(0.5) ? 0 : 2);
      if (this.rng.chance(0.3)) {
        const z2 = zoneOf(4, 1);
        return { kind: 'continue', zone: z2, actor: this.pickAttacker(att, z2) ?? a };
      }
      return this.turnover(def, zone, blocker, chain, 'loose');
    }
    const r2 = this.rng.next();
    if (r2 < pGoal) {
      if (assister) {
        assister.st.assists++;
      }
      att.stats.shotsOnTarget++;
      a.st.shotsOnTarget++;
      const key = f.freeKick ? 'goal_freekick' : f.header ? 'goal_header' : f.oneOnOne ? 'goal_1v1' : tapIn ? 'goal_tapin' : longShot ? 'goal_long' : chain.counter ? 'goal_counter' : assister ? 'goal_assist' : 'goal';
      return this.goal(att, def, a, assister, xg, key, zone, origin);
    }
    if (r2 < pOn) {
      att.stats.shotsOnTarget++;
      a.st.shotsOnTarget++;
      if (gk) { gk.st.saves++; def.stats.saves++; }
      if (big) { att.stats.bigChancesMissed++; a.st.bigChancesMissed++; }
      const key = big ? 'shot_saved_big' : f.header ? 'header_saved' : longShot ? 'shot_long_saved' : 'shot_saved';
      this.emit('shot', att.side, key, { p: a.p.short, gk: this.gkName(def.side) }, { a: a.p.id, b: assister?.p.id, xg: round3(xg), o: 'saved', big, z: zone, or: origin });
      const rr = this.rng.next();
      if (rr < 0.28) return this.corner(att, def, c === 1 ? (this.rng.chance(0.5) ? 0 : 2) : c);
      if (rr < 0.36) {
        // rebound
        const z2 = zoneOf(5, 1);
        const reb = this.pickAttacker(att, z2, null);
        if (reb) {
          const rc: Chain = { ...chain, lastPasser: null, lastPassType: null, beatMan: 0 };
          return this.doShot(att, def, reb, z2, rc, {});
        }
      }
      return { kind: 'end', nextSide: def.side, zone: zoneOf(0, 1), actor: gk, origin: 'open' };
    }
    // off target
    if (big) { att.stats.bigChancesMissed++; a.st.bigChancesMissed++; }
    const post = this.rng.chance(0.07);
    const key = post ? 'shot_post' : big ? 'shot_off_big' : f.header ? 'header_off' : longShot ? 'shot_long_off' : 'shot_off';
    this.emit('shot', att.side, key, { p: a.p.short }, { a: a.p.id, b: assister?.p.id, xg: round3(xg), o: post ? 'post' : 'off', big, z: zone, or: origin });
    return this.deadBall(def.side, zoneOf(0, 1), 22 + this.rng.next() * 12);
  }

  goal(att: TS, def: TS, scorer: PS, assister: PS | null, xg: number, key: string, zone: number, origin: ChanceOrigin): Outcome {
    this.score[att.side]++;
    att.goals++;
    att.recentGoals++;
    scorer.st.goals++;
    this.halfEvents.goals++;
    for (const p of def.onPitch) p.st.conceded++;
    this.emit('goal', att.side, key, { p: scorer.p.short, b: assister?.p.short, gk: this.gkName(def.side) }, {
      a: scorer.p.id, b: assister?.p.id, xg: round3(xg), o: origin, big: true, sc: [this.score[0], this.score[1]], z: zone,
    });
    // Momentum swing
    att.momentum = clamp(att.momentum + 0.35, -1, 1);
    def.momentum = clamp(def.momentum - 0.25, -1, 1);
    this.advance(55 + this.rng.next() * 25);
    // morale-ish: scorer's confidence
    scorer.perf = Math.min(1.12, scorer.perf + 0.01);
    return { kind: 'end', nextSide: def.side, zone: zoneOf(2, 1), actor: null, origin: 'open' };
  }

  ownGoal(att: TS, def: TS, defender: PS): Outcome {
    this.score[att.side]++;
    att.goals++;
    defender.st.ownGoals++;
    defender.st.errors++;
    this.halfEvents.goals++;
    for (const p of def.onPitch) p.st.conceded++;
    this.emit('goal', att.side, 'goal', { p: `${defender.p.short} (own goal)` }, { a: defender.p.id, o: 'own_goal', big: true, sc: [this.score[0], this.score[1]] });
    this.advance(60);
    return { kind: 'end', nextSide: def.side, zone: zoneOf(2, 1), actor: null, origin: 'open' };
  }

  // ---------------------------------------------------------------- checkpoints
  checkpoint() {
    const minute = this.absMinute();
    for (const t of this.teams) {
      const pressF = { low: 0.9, normal: 1, high: 1.14, all_out: 1.28 }[t.ins.press];
      const tempoF = t.ins.tempo === 'high' ? 1.07 : t.ins.tempo === 'slow' ? 0.95 : 1;
      const hot = this.weather === 'hot' ? 1.15 : 1;
      for (const ps of t.onPitch) {
        const r = ROLES[ps.role];
        const staminaF = clamp(1.32 - ps.p.attrs.stamina / 250, 0.5, 1.2);
        const debt = 1 + ps.p.fatigueDebt / 250;
        const drop = 1.75 * r.workload * (ps.isGk ? 1 : pressF) * tempoF * staminaF * hot * debt;
        ps.cond = Math.max(15, ps.cond - drop * (this.period >= 3 ? 1.1 : 1));
        // injury roll
        const prone = Math.pow(ps.p.hidden.injuryProneness / 8, 0.7);
        const oppHard = this.teams[1 - t.side].ins.tackling === 'hard' ? 1.25 : 1;
        const pInj = 0.0006 * prone * (1 + ps.p.fatigueDebt / 100) * (ps.cond < 60 ? 1.6 : 1) * oppHard * (this.weather === 'snow' || this.weather === 'heavy_rain' ? 1.15 : 1);
        if (this.rng.chance(pInj)) this.injure(t, ps, false);
      }
      this.recomputeTeam(t);
    }
    // momentum
    for (const t of this.teams) {
      const o = this.teams[1 - t.side];
      const ft = t.finalThirdTime;
      const drive = t.recentShots * 0.05 + t.recentBig * 0.12 + t.recentGoals * 0.3 - o.recentShots * 0.03 + (t.side === 0 && !this.ctx.neutral ? 0.03 : 0);
      t.momentum = clamp(t.momentum * 0.5 + drive, -1, 1);
      void ft;
      t.recentShots = 0;
      t.recentBig = 0;
      t.recentGoals = 0;
    }
    const mom = this.teams[0].momentum - this.teams[1].momentum;
    this.momentumTrace.push(Math.round(clamp(mom, -1, 1) * 100) / 100);
    this.snapshot();
    if (Math.abs(mom) > 0.45 && this.crng.chance(0.25)) {
      this.emit('momentum', mom > 0 ? 0 : 1, 'momentum', {});
    }
    // triggers and automatic decisions
    for (const t of this.teams) {
      this.runTriggers(t, 'checkpoint');
      this.autoDecisions(t, minute);
    }
  }

  /** Silent stats snapshot used by the live replay's stats drawer. */
  snapshot() {
    const tot = this.teams[0].possessionTime + this.teams[1].possessionTime || 1;
    const pos = Math.round((this.teams[0].possessionTime / tot) * 100);
    const d: number[] = [pos];
    for (const t of this.teams) {
      const st = t.stats;
      d.push(st.shots, st.shotsOnTarget, Math.round(st.xg * 100) / 100, st.corners, st.fouls, st.yellows, st.reds, st.passesCompleted, st.passes);
    }
    const mm = this.minute();
    this.events.push({ i: this.events.length, m: mm.m, s: mm.s, ...(mm.ex ? { ex: mm.ex } : {}), t: 'snap', side: -1, txt: '', d });
  }

  injure(t: TS, ps: PS, onFoul: boolean) {
    if (ps.injured) return;
    const r = this.rng.next();
    const severity: InjurySeverity = r < 0.45 ? 'knock' : r < 0.77 ? 'minor' : r < 0.94 ? 'moderate' : 'serious';
    const days = severity === 'knock' ? this.rng.int(1, 4) : severity === 'minor' ? this.rng.int(7, 21) : severity === 'moderate' ? this.rng.int(21, 56) : this.rng.int(60, 180);
    const types: Record<InjurySeverity, string[]> = {
      knock: ['dead leg', 'bruised ankle', 'knock to the knee', 'bruised ribs'],
      minor: ['hamstring strain', 'calf strain', 'twisted ankle', 'groin strain', 'thigh strain'],
      moderate: ['torn hamstring', 'ankle ligament damage', 'broken toe', 'knee ligament strain'],
      serious: ['ACL rupture', 'broken leg', 'achilles tear', 'broken metatarsal'],
    };
    const type = this.rng.pick(types[severity]);
    this.halfEvents.injuries++;
    // A knock may be played through
    if (severity === 'knock' && this.rng.chance(0.55)) {
      ps.cond = Math.max(20, ps.cond - 12);
      this.injuries.push({ playerId: ps.p.id, side: t.side, minute: this.absMinute(), severity, days, type });
      return;
    }
    ps.injured = true;
    ps.st.injured = true;
    this.injuries.push({ playerId: ps.p.id, side: t.side, minute: this.absMinute(), severity, days, type });
    this.emit('injury', t.side, 'injury', { p: ps.p.short }, { a: ps.p.id, o: severity });
    void onFoul;
    // Replace if possible
    const sub = t.subsUsed < this.ctx.maxSubs ? this.bestBenchFor(t, ps.slot) : null;
    if (sub) this.makeSub(t, ps, sub, 'sub_injury');
    else {
      ps.onPitch = false;
      ps.offAt = this.absMinute();
      this.recomputeTeam(t);
    }
  }

  bestBenchFor(t: TS, slot: number, pref: 'best_available' | 'most_attacking' | 'most_defensive' = 'best_available'): PS | null {
    const s = t.slots[slot];
    let best: PS | null = null;
    let bv = -1;
    for (const b of t.bench) {
      if (b.used || b.onPitch || b.injured) continue;
      const fam = b.p.fam[s.pos] ?? 0;
      if (s.pos === 'GK' && fam < 0.5) continue;
      if (s.pos !== 'GK' && (b.p.fam.GK ?? 0) >= 0.8 && fam < 0.3) continue;
      let v = rawRoleRating(b.p.attrs, s.role, s.duty) * Math.max(0.55, fam) * (0.6 + b.cond / 250);
      if (pref === 'most_attacking') v += (POS_LINE[Object.entries(b.p.fam).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))[0]?.[0] as Pos] === 'ATT' ? 25 : 0);
      if (pref === 'most_defensive') v += (POS_LINE[Object.entries(b.p.fam).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))[0]?.[0] as Pos] === 'DEF' ? 25 : 0);
      if (v > bv) { bv = v; best = b; }
    }
    return best;
  }

  makeSub(t: TS, out: PS, inn: PS, key: 'sub' | 'sub_injury', forceSlot?: number) {
    const slot = forceSlot ?? out.slot;
    out.onPitch = false;
    out.offAt = this.absMinute();
    inn.onPitch = true;
    inn.used = true;
    inn.onAt = this.absMinute();
    inn.slot = slot;
    inn.st.onAt = inn.onAt;
    inn.st.pos = t.slots[slot].pos;
    inn.st.role = t.slots[slot].role;
    out.st.offAt = out.offAt;
    t.subsUsed++;
    t.lastSubMinute = this.absMinute();
    this.halfEvents.subs++;
    this.recomputeTeam(t);
    this.emit('sub', t.side, key, { p: out.p.short, b: inn.p.short }, { a: out.p.id, b: inn.p.id });
    this.advance(20);
  }

  // ---------------------------------------------------------------- triggers & automatic decisions
  runTriggers(t: TS, when: 'checkpoint' | 'red') {
    const minute = this.absMinute();
    const lead = this.score[t.side] - this.score[1 - t.side];
    for (const trig of t.tactic.triggers) {
      if (t.fired.has(trig.id)) continue;
      const w = trig.when;
      if (minute < w.minute) continue;
      let ok = false;
      let subject: PS | null = null;
      switch (w.kind) {
        case 'score':
          ok = w.state === 'losing' ? lead <= -Math.max(1, w.by) : w.state === 'winning' ? lead >= Math.max(1, w.by) : lead === 0;
          break;
        case 'condition':
          subject = t.onPitch.filter((p) => !p.isGk && p.cond < w.below).sort((a, b) => a.cond - b.cond)[0] ?? null;
          ok = !!subject;
          break;
        case 'yellow':
          subject = t.onPitch.find((p) => p.yellow === 1) ?? null;
          ok = !!subject;
          break;
        case 'red':
          ok = t.players.some((p) => p.red);
          break;
        case 'opp_change':
          ok = t.oppChanged;
          break;
      }
      if (when === 'red' && w.kind !== 'red') continue;
      if (!ok) continue;
      t.fired.add(trig.id);
      const descs: string[] = [];
      for (const act of trig.actions) {
        const d = this.applyAction(t, act, subject);
        if (d) descs.push(d);
      }
      if (descs.length) {
        const desc = descs.join('; ');
        this.triggersFired.push({ side: t.side, minute, desc });
        this.emit('trigger', t.side, 'trigger', { p: desc });
      }
    }
  }

  applyAction(t: TS, act: Trigger['actions'][number], subject: PS | null): string | null {
    switch (act.type) {
      case 'mentality': {
        const before = t.mentality;
        t.mentality = clamp(t.mentality + act.delta, -2, 2);
        if (t.mentality === before) return null;
        this.recomputeTeam(t);
        return `mentality ${act.delta > 0 ? 'up' : 'down'} to ${['very defensive', 'defensive', 'balanced', 'attacking', 'very attacking'][t.mentality + 2]}`;
      }
      case 'instruction': {
        (t.ins as unknown as Record<string, unknown>)[act.key] = act.value;
        this.recomputeTeam(t);
        return `${String(act.key)} set to ${String(act.value)}`;
      }
      case 'plan_b': {
        const pb = t.input.planB;
        if (!pb || t.planBUsed) return null;
        t.planBUsed = true;
        this.switchTactic(t, pb);
        return `switched to plan B (${pb.name})`;
      }
      case 'sub': {
        if (t.subsUsed >= this.ctx.maxSubs) return null;
        let out: PS | null = null;
        if (typeof act.out === 'number') out = t.onPitch.find((p) => p.p.id === act.out) ?? null;
        else {
          const line = act.outLine && act.outLine !== 'ANY' ? act.outLine : null;
          const cands = t.onPitch.filter((p) => !p.isGk && (!line || POS_LINE[p.pos] === line));
          if (act.out === 'trigger_player' || act.out === 'on_yellow') out = subject ?? null;
          if (!out && (act.out === 'most_tired' || act.out === 'trigger_player')) out = cands.sort((a, b) => a.cond - b.cond)[0] ?? null;
          if (!out && act.out === 'lowest_rated') out = cands.sort((a, b) => this.liveRating(a) - this.liveRating(b))[0] ?? null;
          if (!out && act.out === 'on_yellow') out = cands.find((p) => p.yellow === 1) ?? null;
        }
        if (!out || !out.onPitch) return null;
        let inn: PS | null = null;
        if (typeof act.in === 'number') inn = t.bench.find((p) => p.p.id === act.in && !p.used && !p.injured) ?? null;
        else inn = this.bestBenchFor(t, out.slot, act.in);
        if (!inn) return null;
        this.makeSub(t, out, inn, 'sub');
        return `${inn.p.short} on for ${out.p.short}`;
      }
    }
  }

  switchTactic(t: TS, tac: Tactic) {
    // Keep the same players, map them to the new slots by best fit.
    const players = t.onPitch.slice();
    const gk = players.find((p) => p.isGk);
    const outfield = players.filter((p) => p !== gk);
    const newSlots = tac.slots.map((s) => ({ ...s }));
    const assigned = new Map<PS, number>();
    if (gk) assigned.set(gk, 0);
    const free = new Set(newSlots.map((_, i) => i).filter((i) => newSlots[i].pos !== 'GK'));
    // Greedy: most constrained player first
    const sorted = outfield.slice().sort((a, b) => Object.keys(a.p.fam).length - Object.keys(b.p.fam).length);
    for (const p of sorted) {
      let best = -1;
      let bv = -1;
      for (const i of free) {
        const v = (p.p.fam[newSlots[i].pos] ?? 0.2) * rawRoleRating(p.p.attrs, newSlots[i].role, newSlots[i].duty);
        if (v > bv) { bv = v; best = i; }
      }
      if (best >= 0) { assigned.set(p, best); free.delete(best); }
    }
    t.slots = newSlots;
    t.tactic = { ...tac, slots: newSlots };
    t.ins = { ...tac.instructions };
    t.mentality = tac.mentality;
    for (const [p, i] of assigned) p.slot = i;
    this.recomputeTeam(t);
    const newKey = detectFormation(newSlots);
    if (newKey !== t.formationKey) {
      t.formationKey = newKey;
      this.teams[1 - t.side].oppChanged = true;
      this.runTriggers(this.teams[1 - t.side], 'checkpoint');
    }
  }

  liveRating(p: PS): number {
    const s = p.st;
    return 6 + s.goals + s.assists * 0.6 + s.keyPasses * 0.15 + s.tacklesWon * 0.08 + s.interceptions * 0.06 - s.errors * 0.5 + (s.passesCompleted - (s.passes - s.passesCompleted) * 2) * 0.01;
  }

  autoDecisions(t: TS, minute: number) {
    if (!t.input.autoSubs) return;
    const acumen = t.input.acumen;
    const smart = acumen / 20;
    const lead = this.score[t.side] - this.score[1 - t.side];
    const subsLeft = this.ctx.maxSubs - t.subsUsed;
    // Planned substitution curve: ~1 by 62', 2-3 by 72', 3-4 by 82', up to 5 when chasing late.
    const planned = minute < 56 ? 0 : minute < 63 ? 1 : minute < 70 ? 2 : minute < 78 ? 3 : minute < 86 ? 4 : 5;
    const want = lead === 0 || lead < 0 ? planned : Math.min(planned, 4);
    const reserve = minute >= 82 ? 0 : 1;
    for (let k = 0; k < 2; k++) {
    if (t.subsUsed < want && this.ctx.maxSubs - t.subsUsed > reserve && (k === 1 || minute - t.lastSubMinute >= 3) && this.rng.chance(k === 0 ? 0.6 + smart * 0.35 : 0.45)) {
      const cands = t.onPitch.filter((p) => !p.isGk);
      const threshold = 72 + (acumen - 10) * 0.5;
      let target = cands.filter((p) => p.cond < threshold).sort((a, b) => a.cond - b.cond)[0];
      const booked = cands.find((p) => p.yellow === 1 && p.p.attrs.aggression > 130 && minute >= 60);
      if (!target && booked && this.rng.chance(smart)) target = booked;
      if (!target && minute >= 70) target = cands.sort((a, b) => this.liveRating(a) - this.liveRating(b))[0];
      if (target) {
        let pref: 'best_available' | 'most_attacking' | 'most_defensive' = 'best_available';
        if (lead < 0 && minute >= 65) pref = 'most_attacking';
        if (lead > 0 && minute >= 75) pref = 'most_defensive';
        const inn = this.bestBenchFor(t, target.slot, pref);
        if (inn) this.makeSub(t, target, inn, 'sub');
      }
    }
    }
    void subsLeft;
    // Bots adjust mentality late on (humans rely on their triggers).
    if (t.input.isBot && this.rng.chance(smart)) {
      if (lead < 0 && minute >= 70 && t.mentality < 2 && !t.fired.has('auto_chase')) {
        t.fired.add('auto_chase');
        t.mentality = Math.min(2, t.mentality + 1);
        this.recomputeTeam(t);
        this.emit('tactic', t.side, 'tactic', { p: 'pushing more men forward' });
      } else if (lead === 1 && minute >= 78 && t.mentality > -2 && !t.fired.has('auto_protect')) {
        t.fired.add('auto_protect');
        t.mentality = Math.max(-2, t.mentality - 1);
        if (t.input.tactic.instructions.timeWasting || acumen >= 14) t.ins.timeWasting = true;
        this.recomputeTeam(t);
        this.emit('tactic', t.side, 'tactic', { p: 'dropping deeper to protect the lead' });
      }
    }
  }

  // ---------------------------------------------------------------- penalties
  shootout() {
    this.emit('pens_start', -1, 'pens_start', {});
    const kicks: { side: 0 | 1; playerId: number; scored: boolean }[] = [];
    const tally: [number, number] = [0, 0];
    const order = this.teams.map((t) => t.onPitch.slice().sort((a, b) => b.comp[CI.penalty] - a.comp[CI.penalty]));
    const first: 0 | 1 = this.rng.chance(0.5) ? 0 : 1;
    let round = 0;
    const taken: [number, number] = [0, 0];
    while (true) {
      for (const s of [first, (1 - first) as 0 | 1]) {
        const t = this.teams[s];
        const gk = this.teams[1 - s].gk;
        const list = order[s];
        const taker = list[taken[s] % list.length];
        taken[s]++;
        const pressure = (taker.p.attrs.composure - 140) * 0.01 + (round >= 4 ? -0.1 : 0);
        const p = clamp(sigmoid(logit(0.76) + (taker.comp[CI.penalty] - 150) * 0.011 + pressure - ((gk?.comp[CI.gkSave] ?? 100) - 150) * 0.006), 0.45, 0.93);
        const scored = this.rng.chance(p);
        if (scored) tally[s]++;
        kicks.push({ side: s, playerId: taker.p.id, scored });
        const saved = !scored && this.rng.chance(0.65);
        const key = scored ? 'pens_score' : saved ? 'pens_saved' : 'pens_miss';
        this.emit('pen_kick', s, key, { p: taker.p.short, gk: gk?.p.short ?? 'the keeper', score: `${tally[0]}-${tally[1]}` }, { a: taker.p.id, o: scored ? 'scored' : saved ? 'saved' : 'missed', st: 'pens' });
        void t;
        // early finish in the first five
        if (round < 5) {
          const remA = 5 - taken[0];
          const remB = 5 - taken[1];
          if (tally[0] > tally[1] + remB || tally[1] > tally[0] + remA) {
            this.penalties = { home: tally[0], away: tally[1], kicks };
            this.emit('pens_end', tally[0] > tally[1] ? 0 : 1, 'pens_win', {});
            return;
          }
        }
      }
      round++;
      if (round >= 5 && taken[0] === taken[1] && tally[0] !== tally[1]) break;
      if (round > 20) { tally[0]++; break; }
    }
    this.penalties = { home: tally[0], away: tally[1], kicks };
    this.emit('pens_end', tally[0] > tally[1] ? 0 : 1, 'pens_win', {});
  }
}

type Outcome =
  | { kind: 'continue'; zone: number; actor: PS }
  | { kind: 'end'; nextSide: 0 | 1; zone: number; actor: PS | null; origin?: ChanceOrigin };

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export type { PS as SimPlayer, TS as SimTeam };

export function simulateMatch(home: TeamInput, away: TeamInput, ctx: MatchContext): MatchResult {
  const sim = new MatchSim(home, away, ctx);
  return sim.run();
}
