// Home: what do I need to do right now. And the alerts inbox with decision cards.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Ban, Bell, BellRing, Bot, Check, ChevronRight, CircleDollarSign, Clock, FileSignature, Frown, HeartPulse, Loader2, Megaphone, RefreshCw, Shirt, Target, Trophy, Users, X, Zap, BookOpen } from 'lucide-react';
import type { HomeData, InboxData } from '@ffm/server/routes/home';
import { api } from '../lib/api';
import { countdown, dayLabel, inWords, kickoff, ago, timeLabel } from '../lib/format';
import { useNow, useLocalState } from '../lib/hooks';
import { currentPushState, enablePush, isIOS, isStandalone, pushSupported, haptic } from '../lib/device';
import { Badge, Button, Card, IconButton, List, Q, Screen, Section, Skeleton, SkeletonCards, cx, useToast } from '../components/ui';
import { ClubCrest, CompBadge, FixtureScore, FormDots } from '../components/domain';
import { useMe } from '../app/session';

type Home = Extract<HomeData, { needsClub: false }>;

const ALERT_ICON: Record<string, typeof Bell> = {
  bot: Bot, decision: Megaphone, bid: CircleDollarSign, squad: Users, sponsor: Trophy, injury: HeartPulse, card: Ban, contract: FileSignature,
  unhappy: Frown, fatigue: Zap, vision: Target,
};

export function AlertRow({ a }: { a: Home['alerts'][number] }) {
  const Icon = ALERT_ICON[a.icon] ?? AlertTriangle;
  return (
    <Link to={a.link} className="flex items-center gap-3 px-4 min-h-14 py-2 active:bg-raised">
      <span className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, var(--${a.tone}) 16%, transparent)`, color: `var(--${a.tone})` }}><Icon size={17} /></span>
      <span className="t-body flex-1 min-w-0 line-clamp-2">{a.text}</span>
      <ChevronRight size={18} className="text-fg3 shrink-0" />
    </Link>
  );
}

function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const down = (e: TouchEvent) => { start.current = window.scrollY <= 0 ? e.touches[0].clientY : null; };
    const move = (e: TouchEvent) => { if (start.current !== null) setPull(Math.max(0, Math.min(110, (e.touches[0].clientY - start.current) * 0.55))); };
    const up = async () => {
      if (start.current !== null && pull > 64 && !busy) { setBusy(true); haptic('light'); try { await onRefresh(); } finally { setBusy(false); } }
      start.current = null;
      setPull(0);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => { window.removeEventListener('touchstart', down); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up); };
  }, [pull, busy, onRefresh]);
  const shown = busy ? 48 : pull;
  return shown > 4 ? (
    <div className="flex justify-center overflow-hidden transition-[height]" style={{ height: shown }}>
      <div className="mt-2 h-8 w-8 rounded-full bg-raised flex items-center justify-center">{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} style={{ transform: `rotate(${pull * 3}deg)` }} />}</div>
    </div>
  ) : null;
}

function DeadlineCard({ h }: { h: Home }) {
  const now = useNow(1000);
  const nav = useNavigate();
  const n = h.next!;
  const toDeadline = new Date(n.deadline).getTime() - now;
  const locked = toDeadline <= 0;
  const urgent = !n.sheet && toDeadline > 0 && toDeadline < 2 * 3600_000;
  return (
    <div className={cx('rounded-[14px] border p-4 mb-3 bg-surface relative overflow-hidden', urgent ? 'border-warning pulse-warning' : 'border-subtle')} style={{ minHeight: 180 }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, ${n.opponent.colors[0]} 22%, transparent), transparent 60%)` }} />
      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <CompBadge comp={n.comp} />
          <span className="t-label text-fg2 truncate">{n.stageLabel}{n.firstLeg ? ` · 1st leg ${n.firstLeg[0]}-${n.firstLeg[1]}` : ''}</span>
          <span className="ml-auto t-label text-fg2">{n.isHome ? 'Home' : 'Away'}</span>
        </div>
        <Link to={`/club/${n.opponent.id}`} className="flex items-center gap-3">
          <ClubCrest club={n.opponent} size={44} />
          <div className="min-w-0">
            <div className="t-title2 truncate">{n.opponent.name}</div>
            <div className="t-label text-fg2">{kickoff(n.kickoff)}{n.opponent.human ? ` · ${n.opponent.managerName}` : ''}</div>
          </div>
        </Link>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="t-caption text-fg3">{locked ? 'Team sheets locked' : 'Deadline in'}</div>
            <div className="t-display leading-none mt-1">{locked ? timeLabel(n.kickoff) : countdown(toDeadline)}</div>
          </div>
          {n.sheet && !locked && <Badge tone="positive"><Check size={12} /> Team set</Badge>}
        </div>
        <div className="mt-4">
          {locked ? (
            <Button full variant="secondary" onClick={() => nav(`/fixture/${n.id}`)}>{n.status === 'played' ? 'See the result' : 'Match in progress - see preview'}</Button>
          ) : n.sheet ? (
            <div className="flex gap-2"><Button full variant="secondary" icon={<Check size={18} />} onClick={() => nav(`/fixture/${n.id}/preview`)}>Team set</Button><Button variant="ghost" onClick={() => nav(`/fixture/${n.id}/preview`)}>Edit</Button></div>
          ) : (
            <Button full size="lg" icon={<Shirt size={18} />} onClick={() => nav(`/fixture/${n.id}/preview`)}>Set your team</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PreseasonCard({ h }: { h: Home }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api.post('/admin/start-season'),
    onSuccess: () => { qc.invalidateQueries(); toast('Fixtures are out!', 'success'); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <Card className="mb-3" style={{ minHeight: 150 }}>
      <div className="t-caption text-fg3">Pre-season {h.world.season}</div>
      <div className="t-title2 mt-1">The transfer window is open</div>
      <p className="t-body text-fg2 mt-1">
        {h.preseasonEndsAt ? <>The season starts automatically on <b className="text-fg">{dayLabel(h.preseasonEndsAt)}</b>. </> : <>The season starts when the league admin says go. </>}
        Sign players, set your tactics and pick a sponsor.
      </p>
      <div className="flex gap-2 mt-4">
        <Link to="/transfers" className="flex-1"><Button full variant="secondary">Transfers</Button></Link>
        {me.user.isAdmin && !h.world.started && <Button className="flex-1" loading={start.isPending} onClick={() => start.mutate()}>Start the season</Button>}
      </div>
    </Card>
  );
}

function PushNudge() {
  const me = useMe();
  const toast = useToast();
  const [state, setState] = useState<string>('unknown');
  const [dismissed, setDismissed] = useLocalState('ffm-push-nudge', false);
  useEffect(() => { currentPushState().then(setState).catch(() => setState('unsupported')); }, []);
  if (dismissed || state !== 'off' || !me.vapidPublic) {
    if (!dismissed && !isStandalone() && isIOS() && state === 'unsupported') {
      return (
        <div className="mb-3 rounded-xl border border-subtle bg-surface p-3 flex gap-3 items-start">
          <BellRing size={18} className="text-accent mt-0.5 shrink-0" />
          <div className="t-label text-fg2 flex-1">To get deadline and result alerts on iPhone, add this app to your Home Screen (Share → Add to Home Screen) and open it from there.</div>
          <button aria-label="Dismiss" onClick={() => setDismissed(true)} className="text-fg3"><X size={16} /></button>
        </div>
      );
    }
    return null;
  }
  return (
    <div className="mb-3 rounded-xl border border-subtle bg-surface p-3 flex gap-3 items-center">
      <BellRing size={18} className="text-accent shrink-0" />
      <div className="t-label text-fg2 flex-1">Get a nudge before deadlines and when results are in.</div>
      <Button size="sm" onClick={async () => {
        const r = await enablePush(me.vapidPublic!).catch(() => 'unsupported');
        setState(r === 'on' ? 'on' : state);
        toast(r === 'on' ? 'Notifications on' : 'Could not enable notifications', r === 'on' ? 'success' : 'error');
      }}>Enable</Button>
      <button aria-label="Dismiss" onClick={() => setDismissed(true)} className="text-fg3"><X size={16} /></button>
    </div>
  );
}

export function Home() {
  const q = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/home'), refetchInterval: 60_000 });
  const nav = useNavigate();
  const indicator = usePullToRefresh(() => q.refetch());
  const me = useMe();
  if (q.data?.needsClub) { nav('/onboarding/club'); return null; }
  const h = q.data as Home | undefined;
  return (
    <div className="pb-tabbar min-h-full">
      <header className="pt-safe sticky top-0 z-20" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 12%, var(--bg-base)) 0%, var(--bg-base) 100%)' }}>
        <div className="h-14 px-4 flex items-center gap-3">
          <ClubCrest club={me.club} size={32} />
          <div className="min-w-0 flex-1">
            <div className="t-strong truncate">{me.club?.name}</div>
            <div className="t-label text-fg2 -mt-0.5 truncate">{h?.club.positionLabel ? `${h.club.positionLabel} · ` : ''}{me.world?.season}</div>
          </div>
          <IconButton label="Guide" onClick={() => nav('/guide')}><BookOpen size={22} /></IconButton>
          <IconButton label="Alerts" badge={me.unread + me.decisions > 0} onClick={() => nav('/alerts')}><Bell size={22} /></IconButton>
        </div>
      </header>
      {indicator}
      <div className="px-4 pt-2">
        <Q q={q} skeleton={<><Skeleton className="h-[180px] rounded-[14px] mb-3" /><SkeletonCards n={3} h={70} /></>}>
          {(raw) => {
            const d = raw as Home;
            return (
              <>
                {me.club?.botTakeover && null}
                {d.next ? <DeadlineCard h={d} /> : d.world.phase === 'postseason' ? (
                  <Card className="mb-3" to="/season/review"><div className="t-caption text-fg3">Season {d.world.season} is over</div><div className="t-title2 mt-1">See how it went</div><div className="t-label text-fg2 mt-1">Awards, your verdict and the final table. Pre-season starts soon.</div></Card>
                ) : <PreseasonCard h={d} />}
                <PushNudge />
                {d.alerts.length > 0 && (
                  <List className="mb-3">
                    {d.alerts.slice(0, 4).map((a) => <AlertRow key={a.key} a={a} />)}
                    {d.alerts.length > 4 && <Link to="/alerts" className="flex items-center justify-center h-12 t-label text-accent">See all {d.alerts.length} alerts</Link>}
                  </List>
                )}
                {d.last && d.last.score && (
                  <Card to={`/fixture/${d.last.id}`} className="mb-3">
                    {(() => {
                      const l = d.last!;
                      const mine = l.home.id === d.club.id ? 0 : 1;
                      const my = l.score![mine];
                      const th = l.score![1 - mine];
                      const tone = my > th ? 'positive' : my < th ? 'negative' : 'warning';
                      return (
                        <div>
                          <div className="flex items-center gap-2 mb-2"><CompBadge comp={l.comp} /><span className="t-label text-fg2">Last result</span><Badge tone={tone} className="ml-auto">{my > th ? 'Won' : my < th ? 'Lost' : 'Drew'}</Badge></div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 flex items-center gap-2 min-w-0 justify-end"><span className="t-strong truncate">{l.home.short}</span><ClubCrest club={l.home} size={30} /></div>
                            <FixtureScore score={l.score} pens={l.pens} className="text-[30px]" />
                            <div className="flex-1 flex items-center gap-2 min-w-0"><ClubCrest club={l.away} size={30} /><span className="t-strong truncate">{l.away.short}</span></div>
                          </div>
                          {l.word && <div className="text-center t-label text-fg2 mt-2">{l.word[mine]}</div>}
                        </div>
                      );
                    })()}
                  </Card>
                )}
                {d.table.length > 0 && (
                  <Section title="League" action={<Link to="/league" className="t-label text-accent">Full table</Link>}>
                    <List>
                      {d.table.map((r) => (
                        <Link key={r.club.id} to={`/club/${r.club.id}`} className={cx('flex items-center gap-3 px-4 h-12 active:bg-raised', r.me && 'bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]')} style={r.me ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
                          <span className="w-5 t-num text-fg2">{r.pos}</span>
                          <ClubCrest club={r.club} size={24} />
                          <span className={cx('flex-1 truncate', r.me ? 't-strong' : 't-body')}>{r.club.short}</span>
                          <FormDots form={r.form.slice(-3)} size={14} />
                          <span className="w-8 text-right t-label text-fg2 tabular">{r.gd > 0 ? `+${r.gd}` : r.gd}</span>
                          <span className="w-7 text-right t-num">{r.pts}</span>
                        </Link>
                      ))}
                    </List>
                  </Section>
                )}
                {d.upcoming.length > 0 && (
                  <Section title="Coming up" action={<Link to="/league/fixtures?mine=1" className="t-label text-accent">All fixtures</Link>}>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
                      {d.upcoming.map((f) => {
                        const opp = f.home.id === d.club.id ? f.away : f.home;
                        return (
                          <Link key={f.id} to={`/fixture/${f.id}/preview`} className="shrink-0 w-[100px] rounded-xl border border-subtle bg-surface overflow-hidden active:bg-raised">
                            <div className="h-1" style={{ background: `var(--accent)` }} />
                            <div className="p-2.5 flex flex-col items-center text-center">
                              <ClubCrest club={opp} size={36} />
                              <div className="t-label mt-1.5 truncate w-full">{opp.short}</div>
                              <div className="text-[11px] text-fg3">{f.home.id === d.club.id ? 'H' : 'A'} · {dayLabel(f.kickoff)}</div>
                              <CompBadge comp={f.comp} className="mt-1" />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </Section>
                )}
                <div className="t-label text-fg3 text-center pb-4">{me.world?.lastTickAt ? <>League clock last ran {ago(me.world.lastTickAt)}</> : 'The league clock has not run yet'}</div>
              </>
            );
          }}
        </Q>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- alerts inbox
export function Alerts() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<InboxData>('/inbox') });
  const read = useMutation({ mutationFn: () => api.post('/notifications/read', { all: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  const decide = useMutation({
    mutationFn: ({ id, option }: { id: number; option: string }) => api.post(`/decisions/${id}`, { option }),
    onSuccess: () => { qc.invalidateQueries(); toast('Decision made', 'success'); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  useEffect(() => {
    const t = setTimeout(() => read.mutate(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Screen title="Alerts" back>
      <Q q={q} skeleton={<SkeletonCards n={5} h={64} />}>
        {(d) => (
          <>
            {d.decisions.filter((x) => x.status === 'open').length > 0 && (
              <Section title="Needs your decision">
                <div className="space-y-3">
                  {d.decisions.filter((x) => x.status === 'open').map((x) => (
                    <Card key={x.id}>
                      <div className="t-strong">{x.title}</div>
                      <div className="t-body text-fg2 mt-1">{x.body}</div>
                      {x.expiresAt && <div className="t-label text-fg3 mt-1 flex items-center gap-1"><Clock size={12} /> Decide within {inWords(new Date(x.expiresAt).getTime() - Date.now())} or the default applies</div>}
                      <div className="mt-3 space-y-2">
                        {x.options.map((o) => (
                          <button key={o.key} disabled={decide.isPending} onClick={() => decide.mutate({ id: x.id, option: o.key })} className="w-full text-left rounded-xl border border-subtle bg-raised px-3 py-2.5 active:brightness-110">
                            <div className="t-strong flex items-center gap-2">{o.label}<ArrowRight size={14} className="ml-auto text-fg3" /></div>
                            <div className="t-label text-fg2">{o.effect}</div>
                          </button>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </Section>
            )}
            {d.alerts.length > 0 && (
              <Section title="Things to look at"><List>{d.alerts.map((a) => <AlertRow key={a.key} a={a} />)}</List></Section>
            )}
            <Section title="Inbox">
              {d.notifications.length === 0 ? <div className="t-label text-fg3 text-center py-8">Nothing yet. Results, bids and news land here.</div> : (
                <List>
                  {d.notifications.map((n) => {
                    const inner: ReactNode = (
                      <div className="flex gap-3 px-4 py-3">
                        <span className={cx('mt-1.5 h-2 w-2 rounded-full shrink-0', n.read ? 'bg-transparent' : 'bg-accent')} />
                        <div className="min-w-0 flex-1">
                          <div className={cx('t-body', !n.read && 'font-semibold')}>{n.title}</div>
                          {n.body && <div className="t-label text-fg2 mt-0.5">{n.body}</div>}
                          <div className="text-[11px] text-fg3 mt-1">{ago(n.at)}</div>
                        </div>
                      </div>
                    );
                    return n.link ? <Link key={n.id} to={n.link} className="block active:bg-raised">{inner}</Link> : <div key={n.id}>{inner}</div>;
                  })}
                </List>
              )}
            </Section>
            {d.decisions.filter((x) => x.status !== 'open').length > 0 && (
              <Section title="Recent decisions">
                <List>{d.decisions.filter((x) => x.status !== 'open').map((x) => <div key={x.id} className="px-4 py-3"><div className="t-body">{x.title}</div><div className="t-label text-fg3">You chose: {x.options.find((o) => o.key === x.chosen)?.label ?? x.chosen ?? 'default'}</div></div>)}</List>
              </Section>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}
