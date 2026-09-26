// Club selection and the three-card tour.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarClock, LayoutGrid, Lock, Share, Smartphone, Sparkles } from 'lucide-react';
import type { AvailableClubsData } from '@ffm/server/routes/auth';
import { api } from '../lib/api';
import { enablePush, isIOS, isStandalone, pushSupported } from '../lib/device';
import { money, ordinal } from '../lib/format';
import { Button, Chip, ChipRow, Q, Sheet, SkeletonCards, useToast } from '../components/ui';
import { ClubCrest } from '../components/domain';
import { useMe } from '../app/session';

type Club = AvailableClubsData['clubs'][number];

export function ClubPick() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['clubs-available'], queryFn: () => api.get<AvailableClubsData>('/clubs/available') });
  const [filter, setFilter] = useState<'all' | 'top' | 'mid' | 'under'>('all');
  const [sel, setSel] = useState<Club | null>(null);
  const pick = useMutation({
    mutationFn: (id: number) => api.post('/clubs/pick', { clubId: id }),
    onSuccess: async () => { await qc.invalidateQueries(); nav('/onboarding/tour', { replace: true }); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  if (me.club) {
    return (
      <div className="app-column p-6 pt-16 text-center">
        <div className="t-title1 mb-2">You manage {me.club.name}</div>
        <Button onClick={() => nav('/')}>Go to your club</Button>
      </div>
    );
  }
  return (
    <div className="app-column pt-safe pb-safe">
      <div className="px-4 pt-8 pb-3">
        <div className="t-caption text-fg3">{me.world?.name}</div>
        <h1 className="t-title1">Pick your club</h1>
        <p className="t-body text-fg2 mt-1">Every club is real, with its 2026-27 squad. Bigger clubs have more money and higher expectations. Bots run the rest.</p>
      </div>
      <div className="px-4">
        <ChipRow className="mb-3">
          {([['all', 'All clubs'], ['top', 'Title contenders'], ['mid', 'Mid-table'], ['under', 'Underdogs']] as const).map(([k, l]) => <Chip key={k} selected={filter === k} onClick={() => setFilter(k)}>{l}</Chip>)}
        </ChipRow>
        <Q q={q} skeleton={<SkeletonCards n={6} h={92} />}>
          {(d) => (
            <div className="space-y-2 pb-10">
              {d.clubs.filter((c) => filter === 'all' || (filter === 'top' ? c.rank <= 7 : filter === 'mid' ? c.rank > 7 && c.rank <= 14 : c.rank > 14)).map((c) => (
                <button key={c.id} type="button" disabled={!!c.locked} onClick={() => setSel(c)}
                  className="w-full text-left rounded-xl border border-subtle bg-surface p-3 flex items-center gap-3 active:bg-raised disabled:opacity-50">
                  <ClubCrest club={c} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="t-strong truncate">{c.name}</div>
                    <div className="t-label text-fg2 truncate">{c.locked ?? c.outlook} · {c.stadium}</div>
                    <div className="t-label text-fg3 truncate mt-0.5">{c.stars.map((s) => s.name.split(' ').slice(-1)[0]).join(', ')}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {c.locked ? <Lock size={18} className="text-fg3 ml-auto" /> : <div className="font-cond text-[22px] font-bold leading-none tabular">{c.strength.toFixed(1)}</div>}
                    <div className="t-label text-fg3 mt-1">{money(c.balance)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Q>
      </div>
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.name}
        footer={<Button full size="lg" loading={pick.isPending} onClick={() => sel && pick.mutate(sel.id)}>Take charge of {sel?.short}</Button>}>
        {sel && (
          <div>
            <div className="flex items-center gap-4 mb-4">
              <ClubCrest club={sel} size={64} />
              <div>
                <div className="t-strong">{sel.outlook}</div>
                <div className="t-label text-fg2">{sel.stadium} · {sel.capacity.toLocaleString()} seats</div>
                <div className="t-label text-fg2">Squad strength ranks {ordinal(sel.rank)} in the league</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl bg-raised p-3"><div className="t-caption text-fg3">Balance</div><div className="t-num mt-1">{money(sel.balance)}</div></div>
              <div className="rounded-xl bg-raised p-3"><div className="t-caption text-fg3">Strength</div><div className="t-num mt-1">{sel.strength.toFixed(1)}</div></div>
              <div className="rounded-xl bg-raised p-3"><div className="t-caption text-fg3">Reputation</div><div className="t-num mt-1">{sel.reputation}</div></div>
            </div>
            <div className="t-caption text-fg3 mb-1">Key players</div>
            <div className="t-body mb-4">{sel.stars.map((s) => `${s.name} (${s.ovr.toFixed(1)})`).join(' · ')}</div>
            {sel.bot && <div className="t-label text-fg2">{sel.bot.name}, known as {sel.bot.style.toLowerCase()}, steps aside for you.</div>}
          </div>
        )}
      </Sheet>
    </div>
  );
}

const CARDS = [
  { icon: CalendarClock, title: 'Matches happen without you', body: 'Games kick off on schedule whether anyone is online or not. Set your team before the deadline - if you forget, your assistant picks it. Results, injuries and bids arrive as notifications.' },
  { icon: LayoutGrid, title: 'Tactics decide games', body: 'Formation, roles, instructions and in-game triggers all matter. Before a match you can scout the opponent and run 200 simulations to test your plan. After it, the analysis tells you why you won or lost.' },
  { icon: Sparkles, title: 'The world never stops', body: 'Bot managers buy, sell, get sacked and hold grudges. Players get injured, sulk, and grow. The transfer window is open now: strengthen your squad before the first kick-off. New to football words? Tap the book icon on Home for the guide.' },
];

export function Tour() {
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const [i, setI] = useState(0);
  const card = CARDS[i];
  const Icon = card.icon;
  const done = async () => { await api.put('/me', { prefs: { tourDone: true } }).catch(() => {}); nav('/', { replace: true }); };
  return (
    <div className="app-column pt-safe pb-safe flex flex-col min-h-full">
      <div className="flex-1 px-6 pt-16">
        <div className="h-16 w-16 rounded-2xl bg-surface border border-subtle flex items-center justify-center text-accent mb-6"><Icon size={30} /></div>
        <h1 className="t-title1 mb-3">{card.title}</h1>
        <p className="t-body text-fg2">{card.body}</p>
        {i === 2 && (
          <div className="mt-8 space-y-3">
            {pushSupported() && me.vapidPublic && (
              <Button variant="secondary" full icon={<Bell size={18} />} onClick={async () => {
                const r = await enablePush(me.vapidPublic!).catch(() => 'unsupported' as const);
                toast(r === 'on' ? 'Notifications on' : r === 'denied' ? 'Notifications are blocked in your browser settings' : 'This browser cannot do notifications', r === 'on' ? 'success' : 'error');
              }}>Turn on notifications</Button>
            )}
            {!isStandalone() && (
              <div className="rounded-xl border border-subtle bg-surface p-4 t-label text-fg2 flex gap-3">
                <Smartphone size={20} className="shrink-0 text-fg" />
                <div>{isIOS() ? <>On iPhone, tap <Share size={13} className="inline -mt-0.5" /> Share, then <b className="text-fg">Add to Home Screen</b>. Notifications only work once the app is on your home screen.</> : <>Install the app: open your browser menu and choose <b className="text-fg">Install app</b> or <b className="text-fg">Add to Home screen</b>.</>}</div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="px-6 pb-8">
        <div className="flex justify-center gap-2 mb-5">{CARDS.map((_, k) => <span key={k} className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 24 : 8, background: k === i ? 'var(--accent)' : 'var(--bg-input)' }} />)}</div>
        <div className="flex gap-2">
          {i < 2 && <Button variant="ghost" full onClick={done}>Skip</Button>}
          <Button full size="lg" onClick={() => (i < 2 ? setI(i + 1) : done())}>{i < 2 ? 'Next' : "Let's go"}</Button>
        </div>
      </div>
    </div>
  );
}
