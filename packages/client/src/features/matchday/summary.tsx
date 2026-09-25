// Match summary: report, stats, tactical analysis, heatmaps, and a shareable image card.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Award, ChevronRight, CirclePlay, Lightbulb, Share2, Zap } from 'lucide-react';
import type { FixtureData } from '@ffm/server/routes/matches';
import { PLAYER_INSTRUCTION_OPTIONS, TRAITS, famLabel, type DecisionReport, type PlayerInstructionKey, type TraitKey } from '@ffm/engine';
import { api } from '../../lib/api';
import { kickoff, rating1, ratingTone, toneVar } from '../../lib/format';
import { shareOrDownload } from '../../lib/device';
import { onColor } from '../../lib/color';
import { Badge, Button, Card, EmptyState, IconButton, List, Q, Screen, Section, Segmented, SkeletonCards, Tabs, cx, useToast } from '../../components/ui';
import { ClubCrest, CompBadge, PosBadge, RatingPill } from '../../components/domain';
import { CompareRow, HBar, ShotMap, SplitBar, XgRace, ZoneGrid } from '../../components/charts';
import { Ball } from './live';

interface LP { id: number; n: string; s: string; pos: string; r: string; st: boolean; on: number; off: number | null; rt: number; g: number; a: number; y: number; rd: boolean; inj: boolean; min: number; xg: number; og?: number; pen?: number; zt?: number[] }
interface TS {
  possession: number; shots: number; shotsOnTarget: number; bigChances: number; xg: number; passes: number; passesCompleted: number; tackles: number; tacklesWon: number;
  duels: number; duelsWon: number; corners: number; fouls: number; offsides: number; yellows: number; reds: number; saves: number; interceptions: number; crosses: number; crossesCompleted: number;
  dribbles: number; dribblesCompleted: number; chanceOrigins: Record<string, number>; zonePasses: [number, number][]; zoneTouches: number[]; counters: number; pressWins: number; attacksByChannel: [number, number, number];
}
interface Summary {
  stats: [TS, TS]; ht: [number, number]; et: boolean; pens: { home: number; away: number } | null;
  goals: { m: number; ex?: number; side: number; a?: number; b?: number; o?: string }[];
  cards: { m: number; ex?: number; side: number; a?: number; t: string }[];
  motm: { playerId: number; side: number; rating: number; reason: string } | null;
  keyMoments: { minute: number; side: number; txt: string; swing: number; type: string }[];
  verdict: string; findings: { side: number; headline: string; detail: string; metric?: string; kind: string }[];
  triggers: { side: number; minute: number; desc: string }[]; modifiers: { side: number; key: string; cause: string; value: number }[];
  word: [string, string]; lineups: [LP[], LP[]]; formations: [string, string]; tactics: { name: string; mentality: number; by: string }[];
  shots: { m: number; ex?: number; side: number; xg: number; o: string; or?: string; z?: number; a?: number }[]; weather: string; derby: boolean;
  decisions?: [DecisionReport, DecisionReport]; traitGoals?: { m: number; side: number; a: number; tr: string }[];
}

const ORIGIN: Record<string, string> = { open: 'Open play', cross: 'Crosses', through: 'Through balls', dribble: 'Dribbles', set_piece: 'Set pieces', long_shot: 'Long shots', counter: 'Counters', penalty: 'Penalties' };

export function MatchSummary() {
  const { id } = useParams();
  const fid = Number(id);
  const q = useQuery({ queryKey: ['fixture', fid], queryFn: () => api.get<FixtureData>(`/fixtures/${fid}`), staleTime: (query) => (query.state.data?.played ? Infinity : 30_000) });
  return (
    <Q q={q} skeleton={<div className="px-4 pt-20"><SkeletonCards n={4} h={120} /></div>}>
      {(d) => d.played && d.summary ? <SummaryBody d={d} s={d.summary as unknown as Summary} /> : <NotPlayed d={d} />}
    </Q>
  );
}

function NotPlayed({ d }: { d: FixtureData }) {
  const nav = useNavigate();
  const f = d.fixture;
  return (
    <Screen title={`${f.home.short} v ${f.away.short}`} back>
      <Card className="text-center">
        <CompBadge comp={f.comp} />
        <div className="flex items-center justify-center gap-6 my-4"><ClubCrest club={f.home} size={56} /><span className="t-title2 text-fg3">v</span><ClubCrest club={f.away} size={56} /></div>
        <div className="t-strong">{kickoff(f.kickoff)}</div>
        <div className="t-label text-fg2">{f.stageLabel} · {f.venue}</div>
        {d.mySide !== null && <Button className="mt-4" full onClick={() => nav(`/fixture/${f.id}/preview`)}>Pre-match</Button>}
      </Card>
    </Screen>
  );
}

function drawShareCard(d: FixtureData, s: Summary, name: (id?: number) => string): Promise<Blob | null> {
  const f = d.fixture;
  const W = 1080, H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#151A20'); grad.addColorStop(1, '#0B0E11');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = f.home.colors[0]; g.fillRect(0, 0, W / 2, 14);
  g.fillStyle = f.away.colors[0]; g.fillRect(W / 2, 0, W / 2, 14);
  g.textAlign = 'center';
  g.fillStyle = '#9AA7B4'; g.font = '600 36px Inter, sans-serif';
  g.fillText(`${f.compName.toUpperCase()} · ${f.stageLabel}`, W / 2, 110);
  const crest = (x: number, club: typeof f.home) => {
    g.fillStyle = club.colors[0]; g.beginPath(); g.roundRect(x - 90, 170, 180, 180, 48); g.fill();
    g.fillStyle = onColor(club.colors[0]); g.font = '700 70px "Barlow Condensed", sans-serif'; g.fillText(club.key, x, 285);
    g.fillStyle = '#F2F5F7'; g.font = '600 44px Inter, sans-serif'; g.fillText(club.short, x, 410);
  };
  crest(250, f.home); crest(830, f.away);
  g.fillStyle = '#F2F5F7'; g.font = '700 190px "Barlow Condensed", sans-serif';
  g.fillText(`${f.score?.[0]}-${f.score?.[1]}`, W / 2, 330);
  if (f.pens) { g.font = '500 38px Inter, sans-serif'; g.fillStyle = '#9AA7B4'; g.fillText(`${f.pens.home}-${f.pens.away} on penalties`, W / 2, 390); }
  g.font = '500 34px Inter, sans-serif';
  [0, 1].forEach((side) => {
    const list = s.goals.filter((x) => x.side === side).map((x) => `${name(x.a)} ${x.ex ? `${x.m}+${x.ex}` : x.m}'${x.o === 'own_goal' ? ' (og)' : x.o === 'penalty' ? ' (p)' : ''}`);
    g.fillStyle = '#9AA7B4';
    list.slice(0, 5).forEach((t, i) => g.fillText(t, side === 0 ? 250 : 830, 490 + i * 48));
  });
  g.fillStyle = '#1E252D'; g.beginPath(); g.roundRect(90, 780, 900, 170, 28); g.fill();
  g.font = '600 32px Inter, sans-serif'; g.fillStyle = '#64717E';
  g.fillText('EXPECTED GOALS', W / 2, 838);
  g.fillStyle = '#4C9AFF'; g.font = '700 72px "Barlow Condensed", sans-serif';
  g.fillText(`${s.stats[0].xg.toFixed(2)}  -  ${s.stats[1].xg.toFixed(2)}`, W / 2, 915);
  g.fillStyle = '#64717E'; g.font = '500 30px Inter, sans-serif';
  g.fillText(`${s.word[0]} · ${d.fixture.venue}`, W / 2, 1020);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

function SummaryBody({ d, s }: { d: FixtureData; s: Summary }) {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<'report' | 'stats' | 'analysis' | 'heatmap'>('report');
  const f = d.fixture;
  const mySide = d.mySide ?? 0;
  const players = useMemo(() => new Map([...s.lineups[0], ...s.lineups[1]].map((p) => [p.id, p])), [s.lineups]);
  const name = (pid?: number) => (pid ? players.get(pid)?.s ?? '' : '');
  const my = f.score![mySide];
  const th = f.score![1 - mySide];
  const tone = d.mySide === null ? 'info' : my > th || (f.winnerId && f.winnerId === (mySide === 0 ? f.home.id : f.away.id)) ? 'positive' : my < th || (f.winnerId && f.winnerId !== (mySide === 0 ? f.home.id : f.away.id)) ? 'negative' : 'warning';
  const share = async () => {
    const blob = await drawShareCard(d, s, name);
    if (!blob) return;
    const r = await shareOrDownload(blob, `${f.home.key}-${f.away.key}.png`, `${f.home.short} ${f.score?.[0]}-${f.score?.[1]} ${f.away.short}`);
    if (r === 'downloaded') toast('Image saved', 'success');
  };
  return (
    <Screen noPad title={`${f.home.short} ${f.score?.[0]}-${f.score?.[1]} ${f.away.short}`} subtitle={`${f.compName} · ${f.stageLabel}`} back
      actions={<IconButton label="Share" onClick={share}><Share2 size={20} /></IconButton>}
      header={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'report', label: 'Report' }, { value: 'stats', label: 'Stats' }, { value: 'analysis', label: 'Analysis' }, { value: 'heatmap', label: 'Heatmap' }]} />}>
      <div className="px-4 pt-4">
        {tab === 'report' && (
          <>
            <Card className="mb-4 relative overflow-hidden" padded={false}>
              <div className="h-1.5" style={{ background: toneVar(tone) }} />
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/club/${f.home.id}`} className="flex flex-col items-center flex-1 min-w-0"><ClubCrest club={f.home} size={52} /><span className="t-strong mt-1.5 truncate max-w-full">{f.home.short}</span></Link>
                  <div className="text-center">
                    <div className="t-display tabular">{f.score?.[0]}<span className="text-fg3 mx-2">-</span>{f.score?.[1]}</div>
                    {f.pens && <div className="t-label text-fg2">{f.pens.home}-{f.pens.away} pens</div>}
                    {f.et && !f.pens && <div className="t-label text-fg2">After extra time</div>}
                    <div className="t-label text-fg3">HT {s.ht[0]}-{s.ht[1]}</div>
                  </div>
                  <Link to={`/club/${f.away.id}`} className="flex flex-col items-center flex-1 min-w-0"><ClubCrest club={f.away} size={52} /><span className="t-strong mt-1.5 truncate max-w-full">{f.away.short}</span></Link>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  {[0, 1].map((side) => (
                    <div key={side} className={cx('space-y-1', side === 1 && 'text-right')}>
                      {s.goals.filter((g) => g.side === side).map((g, i) => (
                        <div key={i} className={cx('t-label flex items-center gap-1.5', side === 1 && 'justify-end')}><Ball size={12} /> {name(g.a)} {g.ex ? `${g.m}+${g.ex}` : g.m}'{g.o === 'own_goal' ? ' (og)' : g.o === 'penalty' ? ' (p)' : ''}</div>
                      ))}
                      {s.cards.filter((c) => c.side === side && c.t === 'red').map((c, i) => <div key={`r${i}`} className={cx('t-label flex items-center gap-1.5', side === 1 && 'justify-end')}><span className="h-3 w-2 rounded-[2px] bg-negative" /> {name(c.a)} {c.m}'</div>)}
                    </div>
                  ))}
                </div>
                <div className="t-label text-fg3 text-center mt-3">{f.venue}{f.attendance ? ` · ${f.attendance.toLocaleString()}` : ''}{f.firstLeg ? ` · 1st leg ${f.firstLeg[0]}-${f.firstLeg[1]}` : ''}</div>
                <Button className="mt-3" full variant="secondary" icon={<CirclePlay size={18} />} onClick={() => nav(`/fixture/${f.id}/live`)}>Watch the replay</Button>
              </div>
            </Card>
            {s.keyMoments.length > 0 && (
              <Section title="Key moments">
                <List>
                  {s.keyMoments.slice(0, 3).map((k, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3">
                      <span className="t-num w-10 text-fg2">{k.minute}'</span>
                      <div className="flex-1 t-body">{k.txt}</div>
                      {(() => { const benefit = k.swing >= 0 ? k.side : 1 - k.side; return <Badge tone={d.mySide === null ? 'info' : benefit === mySide ? 'positive' : 'negative'}>{benefit === 0 ? f.home.key : f.away.key} +{Math.abs(k.swing)}%</Badge>; })()}
                    </div>
                  ))}
                </List>
                <div className="t-label text-fg3 mt-1.5">Swing in win probability for the team that benefited.</div>
              </Section>
            )}
            {s.motm && (
              <Section title="Player of the match">
                <Card to={`/player/${s.motm.playerId}`} className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-warning/20 text-warning flex items-center justify-center"><Award size={24} /></div>
                  <div className="flex-1 min-w-0"><div className="t-strong truncate">{players.get(s.motm.playerId)?.n}</div><div className="t-label text-fg2">{s.motm.reason}</div></div>
                  <RatingPill rating={s.motm.rating} />
                </Card>
              </Section>
            )}
            <Section title="Ratings">
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((side) => (
                  <div key={side} className="rounded-[12px] border border-subtle bg-surface overflow-hidden">
                    <div className="px-3 h-9 flex items-center t-caption text-fg3 border-b border-subtle">{side === 0 ? f.home.short : f.away.short} · {s.formations[side]}</div>
                    {s.lineups[side].filter((p) => p.st).map((p) => <RatingLine key={p.id} p={p} />)}
                    {s.lineups[side].some((p) => !p.st && p.min > 0) && <div className="px-3 pt-2 pb-1 t-caption text-fg3">Subs</div>}
                    {s.lineups[side].filter((p) => !p.st && p.min > 0).map((p) => <RatingLine key={p.id} p={p} sub />)}
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Verdict"><Card><div className="t-body">{s.verdict}</div><div className="t-label text-fg3 mt-2">{s.tactics.map((t, i) => `${i === 0 ? f.home.short : f.away.short}: ${t.name}${t.by === 'assistant' ? ' (picked by the assistant)' : ''}`).join(' · ')}</div></Card></Section>
          </>
        )}
        {tab === 'stats' && (
          <>
            <Section title="Expected goals"><Card><XgRace shots={s.shots} names={[f.home.short, f.away.short]} /></Card></Section>
            <Section title="Match stats">
              <Card>
                <div className="flex justify-between t-strong mb-1"><span>{f.home.short}</span><span>{f.away.short}</span></div>
                <div className="t-caption text-fg3 text-center mb-1">Possession</div>
                <SplitBar left={s.stats[0].possession} right={s.stats[1].possession} />
                <div className="mt-2">
                  <CompareRow label="Shots" left={s.stats[0].shots} right={s.stats[1].shots} />
                  <CompareRow label="On target" left={s.stats[0].shotsOnTarget} right={s.stats[1].shotsOnTarget} />
                  <CompareRow label="Big chances" left={s.stats[0].bigChances} right={s.stats[1].bigChances} />
                  <CompareRow label="xG" left={s.stats[0].xg} right={s.stats[1].xg} format={(v) => v.toFixed(2)} />
                  <CompareRow label="Passes" left={s.stats[0].passes} right={s.stats[1].passes} />
                  <CompareRow label="Pass accuracy" left={pct(s.stats[0].passesCompleted, s.stats[0].passes)} right={pct(s.stats[1].passesCompleted, s.stats[1].passes)} format={(v) => `${Math.round(v)}%`} />
                  <CompareRow label="Tackles won" left={s.stats[0].tacklesWon} right={s.stats[1].tacklesWon} />
                  <CompareRow label="Duels won" left={s.stats[0].duelsWon} right={s.stats[1].duelsWon} />
                  <CompareRow label="Corners" left={s.stats[0].corners} right={s.stats[1].corners} />
                  <CompareRow label="Fouls" left={s.stats[0].fouls} right={s.stats[1].fouls} lowerBetter />
                  <CompareRow label="Offsides" left={s.stats[0].offsides} right={s.stats[1].offsides} lowerBetter />
                  <CompareRow label="Yellow cards" left={s.stats[0].yellows} right={s.stats[1].yellows} lowerBetter />
                  <CompareRow label="Red cards" left={s.stats[0].reds} right={s.stats[1].reds} lowerBetter />
                  <CompareRow label="Saves" left={s.stats[0].saves} right={s.stats[1].saves} />
                </div>
              </Card>
            </Section>
            <Section title="Shot map"><Card><ShotMap shots={s.shots} names={[f.home.short, f.away.short]} playerName={name} mySide={d.mySide ?? 0} /></Card></Section>
          </>
        )}
        {tab === 'analysis' && <Analysis s={s} names={[f.home.short, f.away.short]} mySide={mySide} />}
        {tab === 'heatmap' && <Heatmaps s={s} names={[f.home.short, f.away.short]} mySide={mySide} />}
      </div>
    </Screen>
  );
}

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

function RatingLine({ p, sub }: { p: LP; sub?: boolean }) {
  return (
    <Link to={`/player/${p.id}`} className="flex items-center gap-1.5 px-3 h-9 active:bg-raised">
      <PosBadge pos={p.pos} />
      <span className="flex-1 truncate t-label">{p.s}</span>
      {p.g > 0 && <span className="flex items-center">{Array.from({ length: Math.min(3, p.g) }).map((_, i) => <Ball key={i} size={10} />)}</span>}
      {p.y > 0 && <span className="h-3 w-2 rounded-[2px] bg-warning" />}
      {p.rd && <span className="h-3 w-2 rounded-[2px] bg-negative" />}
      {sub && <span className="text-[10px] text-positive tabular" title={`Came on in the ${p.on}th minute`}>↑{p.on}'</span>}
      {!sub && p.off != null && <span className="text-[10px] text-negative tabular" title={`Went off in the ${p.off}th minute`}>↓{p.off}'</span>}
      <span className="text-[12px] font-bold tabular w-7 text-right" style={{ color: toneVar(ratingTone(p.rt)) }}>{rating1(p.rt)}</span>
    </Link>
  );
}

function Analysis({ s, names, mySide }: { s: Summary; names: [string, string]; mySide: number }) {
  const [side, setSide] = useState<number>(mySide);
  const origins = Object.keys(ORIGIN);
  const maxO = Math.max(1, ...origins.map((k) => Math.max(s.stats[0].chanceOrigins[k] ?? 0, s.stats[1].chanceOrigins[k] ?? 0)));
  const zp = s.stats[side].zonePasses;
  return (
    <>
      <Section title="Why it went this way">
        {s.findings.length === 0 ? <Card><div className="t-body text-fg2">An even contest with no single tactical story.</div></Card> : (
          <div className="space-y-2">
            {s.findings.slice(0, 4).map((x, i) => (
              <Card key={i}>
                <div className="flex items-start gap-3">
                  <Lightbulb size={18} className="shrink-0 mt-0.5" style={{ color: x.side === mySide ? 'var(--positive)' : 'var(--negative)' }} />
                  <div className="flex-1"><div className="t-strong">{x.headline}</div><div className="t-body text-fg2 mt-0.5">{x.detail}</div>{x.metric && <div className="t-label text-accent mt-1">{x.metric}</div>}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
      {s.decisions && <Decisions s={s} dec={s.decisions} names={names} mySide={mySide} />}
      {s.modifiers.length > 0 && (
        <Section title="Tactical match-ups">
          <List>{s.modifiers.slice(0, 6).map((m, i) => <div key={i} className="flex items-start gap-3 px-4 py-3"><Zap size={16} className="mt-1 shrink-0" style={{ color: m.side === mySide ? 'var(--positive)' : 'var(--negative)' }} /><div className="flex-1 t-body">{m.cause}</div><span className="t-label text-fg3">{names[m.side]}</span></div>)}</List>
        </Section>
      )}
      <Section title="Where chances came from">
        <Card>
          <div className="flex gap-3 t-label mb-2"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" /> {names[0]}</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-fg2" /> {names[1]}</span></div>
          {origins.filter((k) => (s.stats[0].chanceOrigins[k] ?? 0) + (s.stats[1].chanceOrigins[k] ?? 0) > 0).map((k) => (
            <div key={k} className="mb-1">
              <HBar label={ORIGIN[k]} value={s.stats[0].chanceOrigins[k] ?? 0} max={maxO} />
              <div className="-mt-1"><HBar label="" value={s.stats[1].chanceOrigins[k] ?? 0} max={maxO} color="var(--text-secondary)" /></div>
            </div>
          ))}
        </Card>
      </Section>
      <Section title="Pass completion by zone">
        <Segmented className="mb-2" value={String(side)} onChange={(v) => setSide(Number(v))} options={[{ value: '0', label: names[0] }, { value: '1', label: names[1] }]} />
        <Card>
          <div className="max-w-[240px] mx-auto"><ZoneGrid values={zp.map(([a, c]) => (a ? (c / a) * 100 : 0))} max={100} format={(v, i) => (zp[i][0] ? `${Math.round(v)}%` : '')} color="var(--positive)" label="Pass completion by zone" /></div>
          <div className="t-label text-fg3 text-center mt-2">Attacking upwards. Darker = more passes completed.</div>
        </Card>
      </Section>
      {s.triggers.length > 0 && (
        <Section title="Triggers that fired">
          <List>{s.triggers.map((t, i) => <div key={i} className="flex gap-3 px-4 py-3"><span className="t-num w-10 text-fg2">{t.minute}'</span><span className="flex-1 t-body">{t.desc}</span><span className="t-label text-fg3">{names[t.side]}</span></div>)}</List>
        </Section>
      )}
    </>
  );
}

function Heatmaps({ s, names, mySide }: { s: Summary; names: [string, string]; mySide: number }) {
  const [side, setSide] = useState(mySide);
  const [player, setPlayer] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const pl = player ? s.lineups[side].find((p) => p.id === player) : null;
  const values = pl?.zt ?? s.stats[side].zoneTouches;
  return (
    <>
      <Segmented className="mb-3" value={String(side)} onChange={(v) => { setSide(Number(v)); setPlayer(null); }} options={[{ value: '0', label: names[0] }, { value: '1', label: names[1] }]} />
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 mb-3">
        <button className={cx('shrink-0 h-8 px-3 rounded-full t-label border', player === null ? 'bg-accent text-on-accent border-transparent' : 'bg-surface border-subtle text-fg2')} onClick={() => setPlayer(null)}>Team</button>
        {s.lineups[side].filter((p) => p.min > 0).map((p) => (
          <button key={p.id} className={cx('shrink-0 h-8 px-3 rounded-full t-label border', player === p.id ? 'bg-accent text-on-accent border-transparent' : 'bg-surface border-subtle text-fg2')} onClick={() => setPlayer(p.id)}>{p.s}</button>
        ))}
      </div>
      {!pl && <label className="flex items-center gap-2 t-label text-fg2 mb-3"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with {names[1 - side]}</label>}
      <div className={cx('grid gap-3', compare && !pl ? 'grid-cols-2' : 'grid-cols-1')}>
        <Card><div className="t-caption text-fg3 mb-2">{pl ? pl.n : names[side]}</div><div className={cx(!compare && 'max-w-[260px] mx-auto')}><ZoneGrid values={values} label="Touches by zone" /></div></Card>
        {compare && !pl && <Card><div className="t-caption text-fg3 mb-2">{names[1 - side]}</div><ZoneGrid values={s.stats[1 - side].zoneTouches} color="var(--text-secondary)" label="Opponent touches by zone" /></Card>}
      </div>
      <div className="t-label text-fg3 mt-2 text-center">Each side attacks upwards. Numbers are touches in each zone.</div>
    </>
  );
}

void ChevronRight; void EmptyState;

// ---------------------------------------------------------------- your decisions, measured
function Decisions({ s, dec, names, mySide }: { s: Summary; dec: [DecisionReport, DecisionReport]; names: [string, string]; mySide: number }) {
  const [side, setSide] = useState<number>(mySide);
  const nameOf = (sd: number, id: number) => s.lineups[sd].find((p) => p.id === id)?.s ?? 'Player';
  const d = dec[side];
  const tg = (s.traitGoals ?? []).filter((g) => TRAITS[g.tr as TraitKey]);
  return (
    <>
      <Section title="Decisions, measured">
        <Card>
          <div className="t-label text-fg2 mb-2">What each side's tactical choices actually produced.</div>
          <div className="flex justify-between t-strong mb-1"><span>{names[0]}</span><span>{names[1]}</span></div>
          <CompareRow label="Won the ball high up" left={dec[0].pressWinsHigh} right={dec[1].pressWinsHigh} />
          <CompareRow label="Passes allowed per defensive action" left={dec[0].ppda} right={dec[1].ppda} format={(v) => v.toFixed(1)} lowerBetter />
          <CompareRow label="Through balls let in behind" left={dec[0].throughCompleted} right={dec[1].throughCompleted} lowerBetter />
          <CompareRow label="Caught opponents offside" left={dec[0].offsidesWon} right={dec[1].offsidesWon} />
          <CompareRow label="Counter-attacks" left={dec[0].counters} right={dec[1].counters} />
          <CompareRow label="Shots from counters" left={dec[0].countersShots} right={dec[1].countersShots} />
          <CompareRow label="Shots from crosses" left={dec[0].crossesShots} right={dec[1].crossesShots} />
          <CompareRow label="Long-range shots" left={dec[0].longShots} right={dec[1].longShots} />
          <CompareRow label="Set-piece xG" left={dec[0].setPieceXg} right={dec[1].setPieceXg} format={(v) => v.toFixed(2)} />
          <div className="t-caption text-fg3 mt-3 mb-1">Attacks by flank (left / centre / right)</div>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-2 mb-1">
              <span className="t-label w-20 truncate">{names[i]}</span>
              <div className="flex h-4 flex-1 rounded overflow-hidden">
                {dec[i].flank.map((v, j) => <div key={j} className="flex items-center justify-center text-[10px] font-bold text-[#0B0E11]" style={{ width: `${Math.max(v, 6)}%`, background: ['var(--info)', 'var(--accent)', 'var(--warning)'][j] }}>{v}</div>)}
              </div>
            </div>
          ))}
          <div className="t-label text-fg3 mt-2">A lower "passes allowed" number means a more intense press. Through balls in behind punish a high line without pace.</div>
        </Card>
      </Section>
      <Section title="Players and instructions" action={<Segmented size="sm" value={String(side)} onChange={(v) => setSide(Number(v))} options={[{ value: '0', label: names[0] }, { value: '1', label: names[1] }]} />}>
        <List>
          {d.outOfPosition.map((o) => (
            <Link key={`o${o.playerId}`} to={`/player/${o.playerId}`} className="flex items-center gap-3 px-4 py-2.5 active:bg-raised">
              <PosBadge pos={o.pos} />
              <div className="flex-1 min-w-0"><div className="t-body truncate">{nameOf(side, o.playerId)} played out of position</div><div className="t-label text-fg3">{famLabel(o.fam)} there{o.duelsLost > 0 ? ` · beaten ${o.duelsLost} time${o.duelsLost === 1 ? '' : 's'}` : o.passes ? ` · ${o.passesCompleted ?? 0}/${o.passes} passes` : ''}</div></div>
              <span className="text-[12px] font-bold tabular" style={{ color: toneVar(ratingTone(o.rating)) }}>{rating1(o.rating)}</span>
            </Link>
          ))}
          {d.instructionUse.map((u, i) => {
            const opt = PLAYER_INSTRUCTION_OPTIONS[u.key as PlayerInstructionKey]?.options.find((x) => x.value === u.value);
            return (
              <div key={`i${i}`} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0"><div className="t-body truncate">{nameOf(side, u.playerId)}: {opt?.label.toLowerCase() ?? u.value}</div><div className="t-label text-fg3">{u.count} {u.stat}</div></div>
              </div>
            );
          })}
          {d.outOfPosition.length === 0 && d.instructionUse.length === 0 && <div className="px-4 py-3 t-body text-fg2">Everyone played in a familiar position and no individual instructions were set.</div>}
        </List>
      </Section>
      {tg.length > 0 && (
        <Section title="Goals from signature moves">
          <List>
            {tg.map((g, i) => (
              <div key={i} className="flex items-center gap-3 px-4 h-12">
                <span className="t-num w-10 text-fg2">{g.m}'</span>
                <span className="flex-1 t-body truncate">{nameOf(g.side, g.a)}</span>
                <Badge tone={g.side === mySide ? 'positive' : 'neutral'}>{TRAITS[g.tr as TraitKey].name}</Badge>
              </div>
            ))}
          </List>
        </Section>
      )}
    </>
  );
}
