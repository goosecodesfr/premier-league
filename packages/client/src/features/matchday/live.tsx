// Live replay: a paced replay of the stored event log. The result is already decided; the drama is not.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, BarChart3, ChevronDown, Crosshair, FastForward, Flag, HeartPulse, Pause, Play, SkipForward, Timer, X } from 'lucide-react';
import type { MatchEvent } from '@ffm/engine';
import type { EventsData, FixtureData } from '@ffm/server/routes/matches';
import { api } from '../../lib/api';
import { haptic } from '../../lib/device';
import { Button, Q, Sheet, SkeletonCards, cx } from '../../components/ui';
import { ClubCrest } from '../../components/domain';
import { CompareRow, SplitBar } from '../../components/charts';
import { useMe } from '../../app/session';

export function Ball({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="#fff" stroke="#0B0E11" strokeWidth="1.2" /><path d="M12 7.2l3.6 2.6-1.4 4.2H9.8L8.4 9.8z" fill="#0B0E11" /><path d="M12 2v5.2M21.3 9.3l-5.7.5M17.8 20l-3.6-6M6.2 20l3.6-6M2.7 9.3l5.7.5" stroke="#0B0E11" strokeWidth="1.2" /></svg>
  );
}

interface Timed { e: MatchEvent; t: number }

function buildTimeline(events: MatchEvent[]): { list: Timed[]; total: number } {
  const list: Timed[] = [];
  let base = 0;
  let startMin = 0;
  let last = 0;
  let periods = 0;
  for (const e of events) {
    if (e.t === 'ko') {
      if (periods > 0) { base = last + 20; startMin = e.m - 1; }
      periods++;
    }
    if (e.t === 'pens_start') { base = last + 20; startMin = e.m; }
    let t = base + (Math.max(0, e.m - startMin - 1) * 60 + e.s) + (e.ex ? e.ex * 60 : 0);
    if (e.st === 'pens' || e.t === 'pen_kick') t = Math.max(last + 25, t);
    t = Math.max(last, t);
    list.push({ e, t });
    last = t;
  }
  return { list, total: last + 3 };
}

function minuteLabel(e: MatchEvent): string {
  if (e.st === 'pens' || e.t === 'pen_kick' || e.t === 'pens_end') return 'Pens';
  return e.ex ? `${e.m}+${e.ex}'` : `${e.m}'`;
}

export function LiveReplay() {
  const { id } = useParams();
  const fid = Number(id);
  const fq = useQuery({ queryKey: ['fixture', fid], queryFn: () => api.get<FixtureData>(`/fixtures/${fid}`) });
  const eq = useQuery({ queryKey: ['events', fid], queryFn: () => api.get<EventsData>(`/fixtures/${fid}/events`), staleTime: Infinity, enabled: !!fq.data?.played });
  if (fq.data && !fq.data.played) {
    return <div className="app-column p-6 pt-20 text-center"><div className="t-title2 mb-2">Not kicked off yet</div><div className="t-body text-fg2">The replay appears the moment the match is played.</div></div>;
  }
  return (
    <div className="min-h-full bg-base">
      <Q q={eq} skeleton={<div className="p-4 pt-20"><SkeletonCards n={5} h={60} /></div>}>
        {(ev) => fq.data ? <Replay fid={fid} f={fq.data} ev={ev} /> : null}
      </Q>
    </div>
  );
}

function Replay({ fid, f, ev }: { fid: number; f: FixtureData; ev: EventsData }) {
  const nav = useNavigate();
  const me = useMe();
  const { list, total } = useMemo(() => buildTimeline(ev.events as MatchEvent[]), [ev.events]);
  const storeKey = `ffm-replay-${fid}`;
  const saved = useMemo(() => { try { return Number(localStorage.getItem(storeKey) ?? 0); } catch { return 0; } }, [storeKey]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(saved === 0);
  const [speed, setSpeed] = useState(1);
  const [asked, setAsked] = useState(saved > 0 && saved < total);
  const [stats, setStats] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const mySide = f.mySide;
  const home = f.fixture.home;
  const away = f.fixture.away;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      setPos((p) => {
        const n = Math.min(total, p + dt * 60 * speed);
        if (n >= total) setPlaying(false);
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total]);

  useEffect(() => {
    const id = setInterval(() => { try { localStorage.setItem(storeKey, String(Math.floor(pos))); } catch { /* ignore */ } }, 2000);
    return () => clearInterval(id);
  }, [pos, storeKey]);

  const visible = list.filter((x) => x.t <= pos && x.e.t !== 'snap');
  useEffect(() => {
    if (visible.length > lastCount.current) {
      const fresh = visible.slice(lastCount.current);
      for (const x of fresh) {
        if (x.e.t === 'goal' && pos - x.t < 3) haptic(mySide === null ? 'medium' : x.e.side === mySide ? 'goal' : 'concede');
        if (x.e.t === 'red' && pos - x.t < 3) haptic('heavy');
      }
      lastCount.current = visible.length;
      requestAnimationFrame(() => feedRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    } else if (visible.length < lastCount.current) lastCount.current = visible.length;
  }, [visible.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastScore = [...visible].reverse().find((x) => x.e.sc)?.e.sc ?? [0, 0];
  const lastEvent = visible[visible.length - 1]?.e;
  const snap = [...list].reverse().find((x) => x.t <= pos && x.e.t === 'snap')?.e.d ?? null;
  const reds = [0, 1].map((s) => visible.filter((x) => x.e.t === 'red' && x.e.side === s).length);
  const done = pos >= total;
  const goals = list.filter((x) => x.e.t === 'goal');
  const name = (pid?: number) => (pid ? ev.players[pid]?.s ?? '' : '');

  return (
    <div className="app-column min-h-full flex flex-col">
      {/* banner */}
      <div className="sticky top-0 z-30 pt-safe bg-surface border-b border-subtle">
        <div className="flex items-center h-12 px-2">
          <button aria-label="Close replay" className="h-10 w-10 flex items-center justify-center" onClick={() => nav(`/fixture/${fid}`)}><X size={22} /></button>
          <div className="flex-1 text-center t-label text-fg2">{f.fixture.compName} · {f.fixture.stageLabel}</div>
          <button aria-label="Live stats" className="h-10 w-10 flex items-center justify-center" onClick={() => setStats(true)}><BarChart3 size={20} /></button>
        </div>
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0"><ClubCrest club={home} size={34} /><span className="t-strong truncate">{home.short}</span>{reds[0] > 0 && <span className="h-4 w-3 rounded-sm bg-negative" title="Red card" />}</div>
          <div className="text-center px-2">
            <div className="t-display leading-none tabular">{lastScore[0]}<span className="text-fg3 mx-1.5">-</span>{lastScore[1]}</div>
            <div className="t-label text-accent tabular mt-1">{done ? 'FT' : lastEvent ? minuteLabel(lastEvent) : "0'"}</div>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">{reds[1] > 0 && <span className="h-4 w-3 rounded-sm bg-negative" title="Red card" />}<span className="t-strong truncate">{away.short}</span><ClubCrest club={away} size={34} /></div>
        </div>
      </div>

      {/* feed */}
      <div ref={feedRef} className="flex-1 px-4 pt-3 pb-40 space-y-2">
        {asked && (
          <div className="rounded-xl bg-raised p-4 text-center">
            <div className="t-strong mb-3">Pick up where you left off?</div>
            <div className="flex gap-2"><Button full variant="secondary" onClick={() => { setAsked(false); setPos(0); setPlaying(true); }}>From the start</Button><Button full onClick={() => { setAsked(false); setPos(saved); setPlaying(true); }}>Resume</Button></div>
          </div>
        )}
        {visible.map((x) => <EventRow key={x.e.i} e={x.e} mySide={mySide} name={name} home={home.short} away={away.short} />)}
        {done && (
          <div className="rounded-xl border border-subtle bg-surface p-4 text-center anim-pop">
            <div className="t-caption text-fg3">Full time</div>
            <div className="t-display my-1">{f.fixture.score?.[0]} - {f.fixture.score?.[1]}</div>
            {f.fixture.pens && <div className="t-label text-fg2 mb-2">{f.fixture.pens.home}-{f.fixture.pens.away} on penalties</div>}
            <Button full onClick={() => { try { localStorage.removeItem(storeKey); } catch { /* ignore */ } nav(`/fixture/${fid}`); }}>Match summary</Button>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-[480px] bg-surface border-t border-subtle px-4 pt-3" style={{ paddingBottom: 'calc(12px + var(--safe-bottom))' }}>
        <div className="relative h-6 mb-2">
          <input type="range" min={0} max={total} step={1} value={pos} onChange={(e) => { setPos(Number(e.target.value)); }} className="absolute inset-x-0 top-2 w-full" aria-label="Match position" />
          {goals.map((g) => <span key={g.e.i} className="absolute top-0 h-2 w-2 rounded-full pointer-events-none" style={{ left: `calc(${(g.t / total) * 100}% - 4px)`, background: mySide === null ? 'var(--info)' : g.e.side === mySide ? 'var(--positive)' : 'var(--negative)' }} />)}
        </div>
        <div className="flex items-center gap-2">
          <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (done) setPos(0); setPlaying(!playing); }} className="h-12 w-12 rounded-full bg-accent text-on-accent flex items-center justify-center shrink-0">{playing ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}</button>
          <div className="flex bg-input rounded-xl p-1 flex-1">
            {[1, 2, 4].map((s) => <button key={s} onClick={() => setSpeed(s)} className={cx('flex-1 h-9 rounded-lg t-label', speed === s ? 'bg-raised text-fg' : 'text-fg2')}>{s}×</button>)}
          </div>
          <button aria-label="Skip to end" onClick={() => { setPos(total); setPlaying(false); }} className="h-12 px-3 rounded-xl bg-input t-label flex items-center gap-1.5 shrink-0"><SkipForward size={18} /> End</button>
        </div>
      </div>

      <Sheet open={stats} onClose={() => setStats(false)} title="Live stats">
        {snap ? (
          <div>
            <div className="flex justify-between t-strong mb-2"><span>{home.short}</span><span>{away.short}</span></div>
            <SplitBar left={snap[0]} right={100 - snap[0]} />
            {([['Shots', 1], ['On target', 2], ['xG', 3], ['Corners', 4], ['Fouls', 5], ['Yellow cards', 6]] as [string, number][]).map(([label, k]) => (
              <CompareRow key={label} label={label} left={snap[k]} right={snap[k + 9]} format={(v) => (label === 'xG' ? v.toFixed(2) : String(Math.round(v)))} />
            ))}
            <CompareRow label="Pass accuracy" left={snap[9] ? (snap[8] / snap[9]) * 100 : 0} right={snap[18] ? (snap[17] / snap[18]) * 100 : 0} format={(v) => `${Math.round(v)}%`} />
          </div>
        ) : <div className="t-body text-fg2 py-4">Stats appear once the match is under way.</div>}
      </Sheet>
      {void me}
    </div>
  );
}

function EventRow({ e, mySide, name, home, away }: { e: MatchEvent; mySide: number | null; name: (id?: number) => string; home: string; away: string }) {
  const m = minuteLabel(e);
  if (e.t === 'goal') {
    const mine = mySide === null ? null : e.side === mySide;
    const tone = mine === null ? 'info' : mine ? 'positive' : 'negative';
    const og = e.o === 'own_goal';
    return (
      <div className="rounded-xl p-3.5 anim-pop" style={{ background: `color-mix(in srgb, var(--${tone}) 18%, var(--bg-surface))`, boxShadow: `inset 3px 0 0 var(--${tone})` }}>
        <div className="flex items-center gap-2"><Ball size={20} /><span className="t-title2">GOAL! {e.side === 0 ? home : away}</span><span className="ml-auto t-strong tabular">{e.sc ? `${e.sc[0]}-${e.sc[1]}` : ''}</span></div>
        <div className="t-strong mt-1">{name(e.a)}{og ? ' (own goal)' : ''} <span className="t-label text-fg2">{m}</span></div>
        {e.b && !og && <div className="t-label text-fg2">Assist: {name(e.b)}</div>}
        <div className="t-body text-fg2 mt-1">{e.txt}</div>
        {e.xg !== undefined && <div className="t-label text-fg3 mt-1">Chance quality {e.xg.toFixed(2)} xG</div>}
      </div>
    );
  }
  if (e.t === 'yellow' || e.t === 'red') {
    return (
      <div className="flex gap-3 items-start rounded-xl bg-surface p-3">
        <span className={cx('mt-0.5 h-5 w-3.5 rounded-sm shrink-0', e.t === 'yellow' ? 'bg-warning' : 'bg-negative')} />
        <div className="flex-1"><div className="t-strong">{name(e.a)} <span className="t-label text-fg3">{m}</span></div><div className="t-body text-fg2">{e.txt}</div></div>
      </div>
    );
  }
  if (e.t === 'sub') {
    return (
      <div className="flex gap-3 items-start rounded-xl bg-surface p-3">
        <ArrowLeftRight size={18} className="text-info mt-0.5 shrink-0" />
        <div className="flex-1"><div className="t-label text-fg3">{m} · Substitution, {e.side === 0 ? home : away}</div><div className="t-body"><span className="text-positive">▲ {name(e.b)}</span>  <span className="text-negative ml-2">▼ {name(e.a)}</span></div></div>
      </div>
    );
  }
  if (e.t === 'injury') {
    return <div className="flex gap-3 items-start rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--warning) 14%, var(--bg-surface))' }}><HeartPulse size={18} className="text-warning mt-0.5 shrink-0" /><div><div className="t-label text-fg3">{m}</div><div className="t-body">{e.txt}</div></div></div>;
  }
  if (e.t === 'ko' || e.t === 'ht' || e.t === 'ft' || e.t === 'et' || e.t === 'aet' || e.t === 'pens_start' || e.t === 'pens_end' || e.t === 'et_ht') {
    return <div className="flex items-center gap-3 py-2"><div className="h-px flex-1 bg-subtle" /><span className="t-caption text-fg2 flex items-center gap-1.5"><Timer size={13} /> {e.txt}</span><div className="h-px flex-1 bg-subtle" /></div>;
  }
  const bigMiss = e.t === 'shot' && e.big && e.xg !== undefined && e.o !== 'goal';
  const Icon = e.t === 'shot' || e.t === 'save' ? Crosshair : e.t === 'offside' || e.t === 'corner' ? Flag : e.t === 'trigger' || e.t === 'tactic' ? FastForward : e.t === 'pen_kick' ? Crosshair : null;
  return (
    <div className="flex gap-3 items-start py-1">
      <span className="t-label text-fg3 w-10 shrink-0 tabular pt-0.5">{m}</span>
      {Icon ? <Icon size={15} className={cx('mt-1 shrink-0', e.t === 'trigger' || e.t === 'tactic' ? 'text-accent' : 'text-fg3')} /> : <span className="w-[15px] shrink-0" />}
      <div className={cx('flex-1 t-body', e.t === 'chain' || e.t === 'momentum' ? 'text-fg2' : 'text-fg')}>
        {e.txt}
        {bigMiss && <span className="ml-2 inline-flex items-center rounded px-1.5 h-5 text-[11px] font-bold bg-[color-mix(in_srgb,var(--info)_18%,transparent)] text-info">{e.xg!.toFixed(2)} xG</span>}
      </div>
    </div>
  );
}

void ChevronDown;
