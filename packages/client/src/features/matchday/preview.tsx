// Pre-match: opposition report, your selection, tactic and plan B, opposition instructions, simulation preview.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, CloudRain, Dice5, Lock, Pencil, ShieldAlert, Target, Users } from 'lucide-react';
import type { OppInstructionType } from '@ffm/engine';
import type { PreviewData } from '@ffm/server/routes/matches';
import { api, ApiError } from '../../lib/api';
import { countdown, kickoff, rating1 } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { haptic } from '../../lib/device';
import { Badge, Button, Card, List, Q, Screen, Section, Select, Sheet, SkeletonCards, cx, useToast } from '../../components/ui';
import { ClubCrest, CompBadge, FixtureScore, PlayerRow } from '../../components/domain';
import { Histogram, WdlBar } from '../../components/charts';
import { MiniPitch } from '../../components/pitch';
import { useMe } from '../../app/session';

interface SimResult { runs: number; win: number; draw: number; loss: number; avgFor: number; avgAgainst: number; likely: string; histogram: { score: string; pct: number }[]; used: number; max: number }
const WEATHER: Record<string, string> = { clear: 'Clear skies', cloudy: 'Overcast', rain: 'Rain', heavy_rain: 'Heavy rain', wind: 'Windy', snow: 'Snow', hot: 'Hot' };

export function Preview() {
  const { id } = useParams();
  const fid = Number(id);
  const [tacticId, setTacticId] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['preview', fid, tacticId], queryFn: () => api.get<PreviewData>(`/fixtures/${fid}/preview${tacticId ? `?tactic=${tacticId}` : ''}`), placeholderData: (prev) => prev });
  return (
    <Screen title="Pre-match" back="/" noPad>
      <div className="px-4 pt-4"><Q q={q} skeleton={<SkeletonCards n={4} h={140} />}>{(d) => <PreviewBody d={d} fid={fid} tacticId={tacticId ?? d.mine.tacticId} setTacticId={setTacticId} />}</Q></div>
    </Screen>
  );
}

function PreviewBody({ d, fid, tacticId, setTacticId }: { d: PreviewData; fid: number; tacticId: number | null; setTacticId: (id: number) => void }) {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow(1000);
  const [planBId, setPlanBId] = useState<number | null>(d.mine.planBId);
  const [opp, setOpp] = useState(d.mine.opp);
  const [oppOpen, setOppOpen] = useState(false);
  const [oppPick, setOppPick] = useState<number | null>(null);
  const [h2hOpen, setH2hOpen] = useState(false);
  const [sim, setSim] = useState<SimResult | null>(null);
  useEffect(() => { setOpp(d.mine.opp); setPlanBId(d.mine.planBId); }, [d.mine.opp, d.mine.planBId]);
  const f = d.fixture;
  const toDeadline = new Date(f.deadline).getTime() - now;
  const locked = d.deadlinePassed || toDeadline <= 0;
  const submit = useMutation({
    mutationFn: () => api.put<{ submittedAt: string }>(`/fixtures/${fid}/sheet`, { tacticId, planBId, opp, captainId: d.mine.captainId }),
    onSuccess: () => { haptic('medium'); toast('Team submitted. You can change it until the deadline.', 'success'); qc.invalidateQueries(); },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.code === 'SQUAD_INVALID') toast(`Fix your team: ${e.message}`, 'error');
      else if (e instanceof ApiError && e.code === 'DEADLINE_PASSED') { toast('Too late: the deadline has passed.', 'error'); qc.invalidateQueries(); }
      else toast(e.message, 'error');
    },
  });
  const simulate = useMutation({
    mutationFn: () => api.post<SimResult>(`/fixtures/${fid}/simulate`, { tacticId }),
    onSuccess: (r) => { setSim(r); qc.invalidateQueries({ queryKey: ['preview', fid] }); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const mySide = f.isHome ? 0 : 1;
  const oppClub = d.opponent.club;
  const pitch = (xi: PreviewData['mine']['xi']) => xi.map((s) => ({
    key: s.slot, x: s.x, y: s.y, label: s.player?.short ?? s.pos, number: s.player?.number ?? null, condition: s.player?.condition ?? null,
    badge: s.player && (!s.player.available) ? <span className="h-3.5 w-3.5 rounded-full bg-negative block" /> : null, dim: !s.player,
  }));
  const oppMarks = new Map(opp.map((o) => [o.playerId, o.type]));
  const submittedOk = !!d.mine.submitted && d.mine.submitted.by === 'user';
  const dirty = submittedOk && (tacticId !== d.mine.tacticId || planBId !== d.mine.planBId || JSON.stringify(opp) !== JSON.stringify(d.mine.opp));
  return (
    <div className="pb-[calc(var(--tabbar-h)+100px)]">
      {/* fixture header */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-3"><CompBadge comp={f.comp} /><span className="t-label text-fg2 truncate">{f.stageLabel}</span><span className="ml-auto t-label text-fg3 flex items-center gap-1"><CloudRain size={13} /> {WEATHER[f.weather] ?? f.weather}</span></div>
        <div className="flex items-center justify-between gap-2">
          <Link to={`/club/${f.home.id}`} className="flex flex-col items-center flex-1 min-w-0"><ClubCrest club={f.home} size={52} /><span className="t-strong mt-1.5 truncate max-w-full">{f.home.short}</span></Link>
          <div className="text-center shrink-0">
            {locked ? <div className="t-label text-fg2 flex items-center gap-1"><Lock size={13} /> Locked</div> : <><div className="t-caption text-fg3">Deadline</div><div className="font-cond font-bold text-[26px] tabular leading-tight">{countdown(toDeadline)}</div></>}
            <div className="t-label text-fg3">{kickoff(f.kickoff)}</div>
          </div>
          <Link to={`/club/${f.away.id}`} className="flex flex-col items-center flex-1 min-w-0"><ClubCrest club={f.away} size={52} /><span className="t-strong mt-1.5 truncate max-w-full">{f.away.short}</span></Link>
        </div>
        <div className="t-label text-fg3 text-center mt-2">{f.venue}{f.firstLeg ? ` · First leg ${f.firstLeg[0]}-${f.firstLeg[1]}` : ''}</div>
        {f.status === 'played' && <Button className="mt-3" full variant="secondary" onClick={() => nav(`/fixture/${fid}`)}>See the result</Button>}
      </Card>

      {/* opposition report */}
      <Section title="Opposition report" action={<Badge tone={d.opponent.confidence === 'high' || d.opponent.confidence === 'good' ? 'positive' : 'warning'}>{d.opponent.confidence} confidence</Badge>}>
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <ClubCrest club={oppClub} size={36} />
            <div className="min-w-0 flex-1"><div className="t-strong truncate">{oppClub.name}</div><div className="t-label text-fg2 truncate">{d.opponent.manager.name} · {d.opponent.manager.style}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><div className="t-caption text-fg3">Usual shape</div><div className="t-strong">{d.opponent.usualShape}</div></div>
            <div><div className="t-caption text-fg3">Style</div><div className="t-body first-letter:uppercase">{d.opponent.style}</div></div>
          </div>
          <div className="t-caption text-fg3 mb-1">Recent form</div>
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {d.opponent.form.length === 0 ? <span className="t-label text-fg3">No games yet</span> : d.opponent.form.map((x) => (
              <Link key={x.fixtureId} to={`/fixture/${x.fixtureId}`} className="rounded-md px-1.5 py-1 text-center min-w-[44px]" style={{ background: `color-mix(in srgb, var(--${x.res === 'W' ? 'positive' : x.res === 'L' ? 'negative' : 'text-tertiary'}) 18%, transparent)` }}>
                <div className="text-[11px] font-bold">{x.res} {x.score}</div><div className="text-[10px] text-fg2 truncate">{x.home ? 'v' : '@'} {x.opp}</div>
              </Link>
            ))}
          </div>
          {d.opponent.danger && (
            <div className="rounded-xl bg-raised p-3 mb-2 flex items-center gap-3">
              <Target size={18} className="text-negative shrink-0" />
              <div className="min-w-0"><div className="t-caption text-fg3">Danger man</div><Link to={`/player/${d.opponent.danger.player.id}`} className="t-strong">{d.opponent.danger.player.name}</Link><div className="t-label text-fg2">{d.opponent.danger.reason}</div></div>
            </div>
          )}
          {d.opponent.weakness && (
            <div className="rounded-xl bg-raised p-3 flex items-center gap-3"><ShieldAlert size={18} className="text-positive shrink-0" /><div><div className="t-caption text-fg3">Likely weakness</div><div className="t-body">{d.opponent.weakness}</div></div></div>
          )}
          <div className="t-caption text-fg3 mt-4 mb-2">Predicted XI · {d.opponent.predictedShape}</div>
          <MiniPitch slots={pitch(d.opponent.xi)} colors={oppClub.colors} compact />
        </Card>
      </Section>

      {/* our selection */}
      <Section title="Your selection" action={tacticId && !locked ? <Link to={`/tactics/${tacticId}?fixture=${fid}`} className="t-label text-accent flex items-center gap-1"><Pencil size={13} /> Edit team</Link> : null}>
        <Card>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div><div className="t-caption text-fg3">Shape</div><div className="t-strong">{d.mine.formation}</div></div>
            <div><div className="t-caption text-fg3">Strength</div><div className="t-strong tabular">{rating1(d.mine.strength)}</div></div>
            <div><div className="t-caption text-fg3">Condition</div><div className="t-strong tabular">{d.mine.avgCondition}%</div></div>
          </div>
          <MiniPitch slots={pitch(d.mine.xi)} colors={me.club?.colors} compact />
          {d.mine.warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">{d.mine.warnings.map((w) => <div key={w} className="t-label text-warning flex items-center gap-2"><AlertTriangle size={14} className="shrink-0" /> {w}</div>)}</div>
          )}
          {d.mine.bench.length > 0 && <div className="t-label text-fg3 mt-3">Bench: {d.mine.bench.map((b) => b.short).join(', ')}</div>}
        </Card>
      </Section>

      <Section title="Tactic and plan B">
        <Card>
          <div className="t-label text-fg2 mb-1.5">Start with</div>
          <Select ariaLabel="Starting tactic" value={tacticId ?? 0} onChange={(v) => setTacticId(Number(v))} options={d.mine.tactics.map((t) => ({ value: t.id, label: `${t.name} (${t.formation}) · ${Math.round(t.familiarity * 100)}%` }))} />
          <div className="t-label text-fg2 mb-1.5 mt-3">Plan B (used by "switch to plan B" triggers)</div>
          <Select ariaLabel="Plan B" value={planBId ?? 0} onChange={(v) => setPlanBId(Number(v) || null)} options={[{ value: 0, label: 'None' }, ...d.mine.tactics.filter((t) => t.id !== tacticId).map((t) => ({ value: t.id, label: `${t.name} (${t.formation})` }))]} />
        </Card>
      </Section>

      <Section title="Opposition instructions">
        <Card onClick={locked ? undefined : () => setOppOpen(true)}>
          <div className="flex items-center gap-3">
            <Users size={20} className="text-fg2" />
            <div className="flex-1"><div className="t-strong">{opp.length ? `${opp.length} instruction${opp.length > 1 ? 's' : ''} set` : 'None set'}</div><div className="t-label text-fg2">{opp.length ? opp.map((o) => `${d.opponent.xi.find((x) => x.player?.id === o.playerId)?.player?.short ?? 'player'}: ${d.oppInstructionTypes[o.type].label.toLowerCase()}`).join(' · ') : 'Tight-mark their danger man or show him onto his weaker foot.'}</div></div>
            {!locked && <ChevronDown size={18} className="-rotate-90 text-fg3" />}
          </div>
        </Card>
      </Section>

      <Section title="Simulation preview" action={<span className="t-label text-fg3">{d.sims.max - d.sims.used} of {d.sims.max} left</span>}>
        <Card>
          {sim ? (
            <div>
              <WdlBar w={sim.win} d={sim.draw} l={sim.loss} />
              <div className="flex items-end justify-between mt-4">
                <div><div className="t-caption text-fg3">Most likely</div><div className="font-cond font-bold text-[30px]">{sim.likely}</div></div>
                <div className="text-right"><div className="t-caption text-fg3">Average score</div><div className="t-num">{sim.avgFor.toFixed(1)} - {sim.avgAgainst.toFixed(1)}</div></div>
              </div>
              <div className="mt-3"><Histogram items={sim.histogram.map((h) => ({ label: h.score, pct: h.pct }))} /></div>
              <div className="t-label text-fg3 mt-2">{sim.runs} simulations against their predicted XI. Real matches have their own luck.</div>
            </div>
          ) : (
            <div className="t-body text-fg2 mb-3">Play this match {200} times with your current selection against their likely team to see how it tends to go.</div>
          )}
          <Button className="mt-3" full variant="secondary" icon={<Dice5 size={18} />} loading={simulate.isPending} disabled={locked || d.sims.used >= d.sims.max} onClick={() => simulate.mutate()}>
            {simulate.isPending ? 'Simulating…' : d.sims.used >= d.sims.max ? 'No previews left for this match' : sim ? 'Run again' : 'Run 200 simulations'}
          </Button>
        </Card>
      </Section>

      {d.h2h.length > 0 && (
        <Section title="Head-to-head">
          <Card padded={false}>
            <button type="button" className="w-full h-12 px-4 flex items-center justify-between t-strong" onClick={() => setH2hOpen(!h2hOpen)}>Last {d.h2h.length} meetings <ChevronDown size={18} className={cx('text-fg3 transition-transform', h2hOpen && 'rotate-180')} /></button>
            {h2hOpen && (
              <div className="divide-y divide-subtle border-t border-subtle">
                {d.h2h.map((m) => (
                  <Link key={m.id} to={`/fixture/${m.id}`} className="flex items-center gap-2 px-4 h-12 active:bg-raised">
                    <CompBadge comp={m.comp} />
                    <span className="flex-1 text-right truncate t-body">{m.home.short}</span>
                    <FixtureScore score={m.score} pens={m.pens} className="text-[17px] w-14 text-center" />
                    <span className="flex-1 truncate t-body">{m.away.short}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Link to={`/h2h/${me.club?.id}/${oppClub.id}`} className="t-label text-accent mt-2 inline-block">Full head-to-head</Link>
        </Section>
      )}

      {/* sticky submit */}
      <div className="fixed left-0 right-0 z-30 mx-auto max-w-[480px] px-4 py-3 bg-[color-mix(in_srgb,var(--bg-base)_92%,transparent)] backdrop-blur-md border-t border-subtle" style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom))' }}>
        {locked ? (
          <Button full variant="secondary" icon={<Lock size={16} />} onClick={() => nav(f.status === 'played' ? `/fixture/${fid}` : '/')}>{f.status === 'played' ? 'See the result' : 'Team sheets are locked'}</Button>
        ) : submittedOk && !dirty ? (
          <Button full variant="secondary" icon={<Check size={18} />} loading={submit.isPending} onClick={() => submit.mutate()}>Team submitted · resubmit</Button>
        ) : (
          <Button full size="lg" loading={submit.isPending} onClick={() => submit.mutate()}>Submit team{toDeadline < 3600_000 ? ` · ${countdown(toDeadline)}` : ''}</Button>
        )}
      </div>

      <Sheet open={oppOpen} onClose={() => setOppOpen(false)} full title="Opposition instructions">
        <div className="t-label text-fg2 mb-3">Tap up to three of their players. Each instruction has a cost.</div>
        <MiniPitch compact colors={oppClub.colors} onTap={(k) => { const s = d.opponent.xi.find((x) => x.slot === k); if (s?.player) setOppPick(s.player.id); }}
          slots={d.opponent.xi.map((s) => ({ key: s.slot, x: s.x, y: s.y, label: s.player?.short ?? s.pos, number: s.player?.number ?? null, ring: s.player && oppMarks.has(s.player.id) ? 'var(--accent)' : null, badge: s.player && oppMarks.has(s.player.id) ? <span className="h-4 px-1 rounded bg-accent text-[9px] font-bold text-on-accent">{oppMarks.get(s.player.id) === 'tight_mark' ? 'TM' : oppMarks.get(s.player.id) === 'weaker_foot' ? 'WF' : 'HT'}</span> : null }))} />
        {opp.length > 0 && (
          <List className="mt-4">
            {opp.map((o) => {
              const pl = d.opponent.xi.find((x) => x.player?.id === o.playerId)?.player;
              return <div key={o.playerId} className="flex items-center gap-3 px-4 h-14"><span className="flex-1 t-body">{pl?.name ?? 'Player'}</span><Badge tone="accent">{d.oppInstructionTypes[o.type].label}</Badge><button className="t-label text-fg3" onClick={() => setOpp(opp.filter((x) => x.playerId !== o.playerId))}>Remove</button></div>;
            })}
          </List>
        )}
        <Button className="mt-4" full onClick={() => setOppOpen(false)}>Done</Button>
        <div className="t-label text-fg3 mt-2 text-center">Submit your team to lock these in.</div>
      </Sheet>
      <Sheet open={oppPick !== null} onClose={() => setOppPick(null)} title={d.opponent.xi.find((x) => x.player?.id === oppPick)?.player?.name}>
        <List>
          {(Object.keys(d.oppInstructionTypes) as OppInstructionType[]).map((t) => (
            <button key={t} type="button" className="w-full text-left px-4 py-3 active:bg-raised" onClick={() => {
              const next = [...opp.filter((x) => x.playerId !== oppPick), { playerId: oppPick!, type: t }];
              if (next.length > 3) { toast('Three instructions at most', 'error'); return; }
              setOpp(next); setOppPick(null); haptic('light');
            }}>
              <div className="t-strong">{d.oppInstructionTypes[t].label}</div><div className="t-label text-fg2">{d.oppInstructionTypes[t].cost}</div>
            </button>
          ))}
          <button type="button" className="w-full text-left px-4 py-3 t-body text-fg2" onClick={() => { setOpp(opp.filter((x) => x.playerId !== oppPick)); setOppPick(null); }}>No instruction</button>
        </List>
      </Sheet>
    </div>
  );
}

void PlayerRow;
