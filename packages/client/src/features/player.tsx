// Player profile, comparison, bid composer and contract renewal.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, BadgePoundSterling, FileSignature, Hash, MoreHorizontal, Search as SearchIcon, Star, Tag, Telescope, UserMinus, X } from 'lucide-react';
import { ATTR_GROUPS, ATTR_LABELS, type AttrKey } from '@ffm/engine';
import type { CompareData, PlayerData } from '@ffm/server/routes/squad';
import type { QuoteData, SearchData } from '@ffm/server/routes/transfers';
import { api, qs } from '../lib/api';
import {
  COMP_SHORT, conditionTone, contractTone, money, moraleTone, rating1, ratingTone, toneVar, wage, ago,
} from '../lib/format';
import { useDebouncedCallback } from '../lib/hooks';
import { Badge, Button, Card, Chip, ChipRow, IconButton, List, ListRow, Meter, Q, Screen, Section, Segmented, Sheet, SkeletonCards, StatBlock, cx, inputCls, useConfirm, useToast } from '../components/ui';
import { ClubCrest, Flag, PlayerAvatar, PlayerRow, PosBadge, RatingPill } from '../components/domain';
import { Radar, RatingLine } from '../components/charts';
import { useMe } from '../app/session';

const GROUP_LABEL: Record<string, string> = { technical: 'Technical', goalkeeping: 'Goalkeeping', mental: 'Mental', physical: 'Physical' };

export function likelihoodLabel(p: number): { text: string; tone: 'positive' | 'warning' | 'negative' } {
  if (p >= 0.85) return { text: 'Very likely', tone: 'positive' };
  if (p >= 0.65) return { text: 'Likely', tone: 'positive' };
  if (p >= 0.45) return { text: 'Could go either way', tone: 'warning' };
  if (p >= 0.2) return { text: 'Unlikely', tone: 'negative' };
  return { text: 'Very unlikely', tone: 'negative' };
}

function interp(points: { x: number; p: number }[], x: number): number {
  if (!points.length) return 0;
  if (x <= points[0].x) return points[0].p;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].x) {
      const a = points[i - 1], b = points[i];
      return a.p + ((x - a.x) / (b.x - a.x || 1)) * (b.p - a.p);
    }
  }
  return points[points.length - 1].p;
}

function AttrBar({ label, value, best }: { label: string; value: number; best?: boolean }) {
  const tone = value >= 15 ? 'positive' : value >= 10 ? 'info' : value >= 6 ? 'warning' : 'negative';
  return (
    <div className="flex items-center gap-2 h-7">
      <span className={cx('flex-1 t-label truncate', best ? 'text-fg' : 'text-fg2')}>{label}</span>
      <div className="w-16 h-1.5 rounded-full bg-input overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(value / 20) * 100}%`, background: toneVar(tone) }} /></div>
      <span className={cx('w-8 text-right t-num', best && 'text-accent')}>{value % 1 ? value.toFixed(1) : value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- bid composer
export function BidComposer({ playerId, open, onClose }: { playerId: number | null; open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['quote', playerId], queryFn: () => api.get<QuoteData>(`/transfers/quote?playerId=${playerId}`), enabled: open && !!playerId });
  return (
    <Sheet open={open} onClose={onClose} full title={q.data ? (q.data.isFree ? `Offer ${q.data.player.short} a contract` : `Bid for ${q.data.player.short}`) : 'Make an offer'}>
      <Q q={q} skeleton={<SkeletonCards n={3} h={90} />}>{(d) => <BidForm d={d} onDone={onClose} />}</Q>
    </Sheet>
  );
}

function BidForm({ d, onDone }: { d: QuoteData; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [feeMult, setFeeMult] = useState(d.askingPrice ? Math.min(2, Math.max(0.5, d.askingPrice / Math.max(1, d.value))) : 1.1);
  const [wageMult, setWageMult] = useState(1.05);
  const [years, setYears] = useState(d.player.age >= 31 ? 2 : d.player.age >= 28 ? 3 : 4);
  const [promise, setPromise] = useState<'none' | 'key' | 'rotation' | 'backup'>('none');
  const fee = d.isFree ? 0 : Math.round((d.value * feeMult) / 100_000) * 100_000;
  const wg = Math.round((d.demand * wageMult) / 500) * 500;
  const feeP = d.isFree ? 1 : d.sellerHuman ? null : interp(d.feeCurve.map((c) => ({ x: c.fee, p: c.p })), fee);
  const curve = d.termsCurves.find((c) => c.years === years && (c.promise ?? 'none') === promise) ?? d.termsCurves[0];
  const termsP = interp(curve.points.map((c) => ({ x: c.wage, p: c.p })), wg);
  const afterBalance = d.balance - fee;
  const overBudget = afterBalance < -d.overdraft;
  const wageAfter = d.wageBill + wg;
  const overWages = wageAfter > d.wageBudget;
  const bid = useMutation({
    mutationFn: () => api.post<{ bidId: number; respondAt: string | null }>('/transfers/bid', { playerId: d.player.id, fee, wage: wg, years, promise: promise === 'none' ? null : promise }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast(d.isFree ? 'Offer sent. His agent will reply soon.' : d.sellerHuman ? 'Bid sent to their manager.' : 'Bid sent. Expect a reply within a couple of hours.', 'success');
      onDone();
      nav(`/transfers/negotiate/${r.bidId}`);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const blocked = (!d.isFree && (!d.windowOpen || d.embargo)) || overBudget;
  return (
    <div className="pb-2">
      <div className="flex items-center gap-3 mb-4">
        <PlayerAvatar name={d.player.name} colors={null} size={44} />
        <div className="min-w-0 flex-1">
          <div className="t-strong truncate">{d.player.name}</div>
          <div className="t-label text-fg2">{d.club ? d.club.name : 'Free agent'} · Value {money(d.value)}</div>
        </div>
        <Badge tone={d.stance === 'Not for sale' ? 'negative' : d.stance === 'Reluctant to sell' ? 'warning' : 'positive'}>{d.stance}</Badge>
      </div>
      {!d.isFree && !d.windowOpen && <div className="rounded-lg bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning t-label px-3 py-2 mb-4">The transfer window is closed. Only free agents can be signed right now.</div>}
      {!d.isFree && d.embargo && <div className="rounded-lg bg-[color-mix(in_srgb,var(--negative)_14%,transparent)] text-negative t-label px-3 py-2 mb-4">You are under a transfer embargo until your balance recovers.</div>}
      {!d.isFree && (
        <Section title="Transfer fee">
          <div className="flex items-end justify-between mb-2">
            <div className="t-display-sm">{money(fee)}</div>
            <div className="text-right">
              {feeP === null ? <div className="t-label text-fg2">Their manager decides</div> : (
                <><div className="t-caption text-fg3">Club accepts</div><div className="t-strong" style={{ color: toneVar(likelihoodLabel(feeP).tone) }}>{Math.round(feeP * 100)}% · {likelihoodLabel(feeP).text}</div></>
              )}
            </div>
          </div>
          <input type="range" min={0.5} max={2} step={0.01} value={feeMult} onChange={(e) => setFeeMult(Number(e.target.value))} className="w-full" aria-label="Fee" />
          <div className="flex justify-between t-label text-fg3"><span>50%</span><span>Value</span><span>200%</span></div>
          <input className={cx(inputCls, 'mt-2 !h-10')} inputMode="numeric" value={Math.round(fee / 100_000) / 10} onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setFeeMult(Math.max(0.5, Math.min(2, (v * 1_000_000) / d.value))); }} aria-label="Fee in millions" />
          <div className="t-label text-fg3 mt-1">Fee in £ millions{d.askingPrice ? ` · asking price ${money(d.askingPrice)}` : ''}</div>
        </Section>
      )}
      <Section title="Personal terms">
        <div className="flex items-end justify-between mb-2">
          <div className="t-display-sm">{wage(wg)}</div>
          <div className="text-right"><div className="t-caption text-fg3">Player agrees</div><div className="t-strong" style={{ color: toneVar(likelihoodLabel(termsP).tone) }}>{Math.round(termsP * 100)}% · {likelihoodLabel(termsP).text}</div></div>
        </div>
        <div className="relative">
          <input type="range" min={0.6} max={1.6} step={0.01} value={wageMult} onChange={(e) => setWageMult(Number(e.target.value))} className="w-full" aria-label="Wage" />
          <div className="absolute top-[-4px] h-3 w-0.5 bg-warning pointer-events-none" style={{ left: `calc(${((1 - 0.6) / 1) * 100}% )` }} title="His expectation" />
        </div>
        <div className="t-label text-fg3">He expects about {wage(d.demand)}</div>
        <div className="mt-4 t-caption text-fg3 mb-1.5">Contract length</div>
        <Segmented value={String(years)} onChange={(v) => setYears(Number(v))} options={[1, 2, 3, 4, 5].map((y) => ({ value: String(y), label: `${y} yr` }))} />
        <div className="mt-4 t-caption text-fg3 mb-1.5">Squad status promise</div>
        <Segmented value={promise} onChange={setPromise} options={[{ value: 'none', label: 'None' }, { value: 'key', label: 'Key player' }, { value: 'rotation', label: 'Rotation' }, { value: 'backup', label: 'Backup' }]} />
        {promise !== 'none' && <div className="t-label text-fg3 mt-1.5">Break a promise of minutes and he will want to leave.</div>}
      </Section>
      <Section title="Affordability">
        <Card className={cx(overBudget || overWages ? '!border-negative' : '')}>
          <div className="grid grid-cols-2 gap-3">
            <StatBlock label="Balance after" value={money(afterBalance)} tone={afterBalance < 0 ? (overBudget ? 'negative' : 'warning') : undefined} sub={afterBalance < 0 && !overBudget ? 'Into your overdraft' : undefined} />
            <StatBlock label="Wage bill after" value={wage(wageAfter)} tone={overWages ? 'negative' : undefined} sub={`Budget ${wage(d.wageBudget)}`} />
          </div>
          {overBudget && <div className="t-label text-negative mt-2">You cannot afford this fee.</div>}
        </Card>
      </Section>
      <Button full size="lg" loading={bid.isPending} disabled={blocked} onClick={() => bid.mutate()}>{d.isFree ? 'Offer contract' : `Bid ${money(fee)}`}</Button>
    </div>
  );
}

// ---------------------------------------------------------------- contract renewal
interface RenewalData { player: { name: string; short: string; age: number }; demand: number; currentWage: number; curve: { years: number; points: { wage: number; p: number }[] }[]; refused: boolean; note: string | null }
export function RenewalSheet({ playerId, open, onClose }: { playerId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['renewal', playerId], queryFn: () => api.get<RenewalData>(`/players/${playerId}/renewal`), enabled: open });
  const [mult, setMult] = useState(1.05);
  const [years, setYears] = useState(3);
  const renew = useMutation({
    mutationFn: (b: { wage: number; years: number }) => api.post<{ accepted: boolean; message: string }>(`/players/${playerId}/renew`, b),
    onSuccess: (r) => { qc.invalidateQueries(); toast(r.message, r.accepted ? 'success' : 'error'); if (r.accepted) onClose(); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <Sheet open={open} onClose={onClose} title="New contract">
      <Q q={q}>
        {(d) => {
          const wg = Math.round((d.demand * mult) / 500) * 500;
          const c = d.curve.find((x) => x.years === years) ?? d.curve[0];
          const p = interp(c.points.map((x) => ({ x: x.wage, p: x.p })), wg);
          const l = likelihoodLabel(p);
          return (
            <div>
              {d.refused && <div className="rounded-lg bg-[color-mix(in_srgb,var(--negative)_14%,transparent)] text-negative t-label px-3 py-2 mb-4">{d.player.short} has stopped talking about a new deal.</div>}
              {d.note && <div className="t-label text-warning mb-3">{d.note}</div>}
              <div className="flex items-end justify-between mb-2">
                <div><div className="t-caption text-fg3">Offer</div><div className="t-display-sm">{wage(wg)}</div></div>
                <div className="text-right"><div className="t-caption text-fg3">He accepts</div><div className="t-strong" style={{ color: toneVar(l.tone) }}>{Math.round(p * 100)}% · {l.text}</div></div>
              </div>
              <input type="range" min={0.6} max={1.8} step={0.01} value={mult} onChange={(e) => setMult(Number(e.target.value))} className="w-full" aria-label="Wage offer" />
              <div className="t-label text-fg3 mb-4">Currently on {wage(d.currentWage)} · wants about {wage(d.demand)}</div>
              <Segmented value={String(years)} onChange={(v) => setYears(Number(v))} options={[1, 2, 3, 4, 5].map((y) => ({ value: String(y), label: `${y} yr` }))} />
              <Button className="mt-5" full size="lg" loading={renew.isPending} disabled={d.refused} onClick={() => renew.mutate({ wage: wg, years })}>Offer {years}-year deal</Button>
              <div className="t-label text-fg3 mt-2 text-center">Two refusals in a row and he may stop negotiating.</div>
            </div>
          );
        }}
      </Q>
    </Sheet>
  );
}

// ---------------------------------------------------------------- profile
export function PlayerProfile() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['player', Number(id)], queryFn: () => api.get<PlayerData>(`/players/${id}`) });
  const [expanded, setExpanded] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [comp, setComp] = useState<string>('all');
  const renewOpen = params.get('renew') === '1';
  const setRenew = (on: boolean) => { const p = new URLSearchParams(params); if (on) p.set('renew', '1'); else p.delete('renew'); setParams(p, { replace: true }); };
  const inv = () => qc.invalidateQueries();
  const shortlist = useMutation({ mutationFn: (on: boolean) => api.post(`/players/${id}/shortlist`, { on }), onSuccess: (_d, on) => { inv(); toast(on ? 'Added to shortlist' : 'Removed from shortlist', 'success'); } });
  const scout = useMutation({ mutationFn: () => api.post(`/players/${id}/scout`, {}), onSuccess: () => { inv(); toast('Your scouts are on it', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  const list = useMutation({ mutationFn: (listed: boolean) => api.post(`/players/${id}/list`, { listed }), onSuccess: (_d, l) => { inv(); toast(l ? 'Transfer-listed' : 'Taken off the list', 'success'); } });
  const release = useMutation({ mutationFn: () => api.post<{ compensation: number; name: string }>(`/players/${id}/release`, {}), onSuccess: (r) => { inv(); toast(`${r.name} released (${money(r.compensation)} paid up)`, 'success'); nav('/squad'); }, onError: (e: Error) => toast(e.message, 'error') });
  const number = useMutation({ mutationFn: (n: number) => api.post(`/players/${id}/number`, { number: n }), onSuccess: () => { inv(); toast('Squad number changed', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  const rest = useMutation({ mutationFn: (on: boolean) => api.post(`/players/${id}/rest`, { on }), onSuccess: (_d, on) => { inv(); toast(on ? 'He will sit out the next match' : 'Available for selection', 'success'); } });
  return (
    <Screen title={q.data?.player.name ?? 'Player'} back actions={q.data?.mine ? <IconButton label="More" onClick={() => setMore(true)}><MoreHorizontal size={22} /></IconButton> : undefined}>
      <Q q={q} skeleton={<SkeletonCards n={4} h={140} />}>
        {(d) => {
          const p = d.player;
          const clubColors = p.club?.colors ?? null;
          const formAvg = p.form.length ? p.form.reduce((s, x) => s + x, 0) / p.form.length : null;
          const stat = comp === 'all' ? d.stats.reduce((a, s) => ({ apps: a.apps + s.apps, starts: a.starts + s.starts, mins: a.mins + s.mins, goals: a.goals + s.goals, assists: a.assists + s.assists, xg: a.xg + s.xg, yellows: a.yellows + s.yellows, reds: a.reds + s.reds, cs: a.cs + s.cs, avgSum: a.avgSum + (s.avg ?? 0) * s.apps }), { apps: 0, starts: 0, mins: 0, goals: 0, assists: 0, xg: 0, yellows: 0, reds: 0, cs: 0, avgSum: 0 }) : null;
          const cs = comp === 'all' ? null : d.stats.find((s) => s.comp_type === comp);
          const s = cs ? { ...cs, avg: cs.avg } : stat ? { ...stat, avg: stat.apps ? stat.avgSum / stat.apps : null } : null;
          const isGk = p.pos.includes('GK');
          const groups = Object.entries(ATTR_GROUPS).filter(([g]) => (g === 'goalkeeping') === isGk || g === 'mental' || g === 'physical');
          return (
            <>
              {/* hero */}
              <div className="rounded-[14px] border border-subtle p-4 mb-3 relative overflow-hidden" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${clubColors?.[0] ?? '#2A333D'} 30%, var(--bg-surface)) 0%, var(--bg-surface) 70%)` }}>
                <div className="flex items-center gap-4">
                  <PlayerAvatar name={p.name} colors={clubColors} size={72} number={p.number} injured={!!p.injury} suspended={p.suspended > 0} />
                  <div className="min-w-0 flex-1">
                    <div className="t-title2 leading-tight">{p.name}</div>
                    <div className="t-label text-fg2 mt-1 flex items-center gap-1.5 flex-wrap"><Flag code={p.nat} /> {p.age} yrs · {p.foot === 'L' ? 'Left' : p.foot === 'B' ? 'Both feet' : 'Right'} foot{p.height ? ` · ${p.height} cm` : ''}</div>
                    <div className="flex gap-1 mt-1.5 flex-wrap">{p.pos.map((x) => <PosBadge key={x} pos={x} />)}</div>
                  </div>
                </div>
                {p.club ? <Link to={d.mine ? '/squad' : `/club/${p.club.id}`} className="mt-3 flex items-center gap-2 t-label text-fg2"><ClubCrest club={p.club} size={20} /> {p.club.name}{p.listed ? <Badge tone="warning">Transfer-listed</Badge> : null}{p.wantsOut ? <Badge tone="negative">Wants to leave</Badge> : null}</Link> : <div className="mt-3"><Badge tone="info">Free agent</Badge></div>}
                {p.injury && <div className="mt-2 t-label text-negative capitalize">{p.injury.type} · back in {p.injury.range}</div>}
                {p.suspended > 0 && <div className="mt-2 t-label text-negative">Suspended for {p.suspended} match{p.suspended > 1 ? 'es' : ''}</div>}
                <div className="grid grid-cols-4 gap-2 mt-4">
                  <StatBlock label="Overall" value={p.ovr.toFixed(1)} />
                  <StatBlock label="Condition" value={`${p.condition}%`} tone={conditionTone(p.condition)} />
                  <StatBlock label="Form" value={rating1(formAvg)} tone={ratingTone(formAvg)} />
                  <StatBlock label="Morale" value={<span className="capitalize">{p.morale}</span>} tone={moraleTone(p.morale)} />
                </div>
              </div>
              {/* action bar */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <Button variant="secondary" size="sm" icon={<ArrowLeftRight size={16} />} onClick={() => nav(`/player/${p.id}/compare`)}>Compare</Button>
                {d.mine ? (
                  <Button variant="secondary" size="sm" icon={<Tag size={16} />} onClick={() => list.mutate(!p.listed)}>{p.listed ? 'Unlist' : 'List'}</Button>
                ) : (
                  <Button variant="secondary" size="sm" icon={<Star size={16} className={d.shortlisted ? 'fill-current text-warning' : ''} />} onClick={() => shortlist.mutate(!d.shortlisted)}>{d.shortlisted ? 'Shortlisted' : 'Shortlist'}</Button>
                )}
                {d.mine ? (
                  <Button size="sm" icon={<FileSignature size={16} />} onClick={() => setRenew(true)}>Contract</Button>
                ) : (
                  <Button size="sm" icon={<BadgePoundSterling size={16} />} disabled={!d.actions.canBid} onClick={() => setBidOpen(true)}>{p.status === 'free' ? 'Offer deal' : 'Make bid'}</Button>
                )}
              </div>
              {d.market?.myBid && ['pending', 'countered'].includes(d.market.myBid.status) && (
                <Card to={`/transfers/negotiate/${d.market.myBid.id}`} className="mb-4"><div className="t-strong">Your bid: {money(d.market.myBid.fee)}</div><div className="t-label text-fg2 capitalize">{d.market.myBid.status === 'countered' ? 'They have countered - respond now' : 'Waiting for a reply'}</div></Card>
              )}
              {d.offers.length > 0 && (
                <Section title="Offers for him"><List>{d.offers.map((o) => <ListRow key={o.id} title={`${o.buyer} bid ${money(o.fee)}`} subtitle={o.status} to="/transfers/offers" />)}</List></Section>
              )}
              {/* radar */}
              <Section title="Attributes" action={<button className="t-label text-accent" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show radar' : 'All attributes'}</button>}>
                <Card>
                  {!expanded ? (
                    <button type="button" className="w-full flex flex-col items-center" onClick={() => setExpanded(true)} aria-label="Show all attributes">
                      <Radar axes={d.radar.map((r) => r.label)} series={[{ values: d.radarAvg.map((r) => r.value), color: 'var(--text-tertiary)', dashed: true }, { values: d.radar.map((r) => r.value), color: 'var(--accent)', fill: true }]} />
                      <div className="t-label text-fg3 flex items-center gap-3"><span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-accent" /> {p.short}</span><span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t border-dashed border-fg3" /> League average {p.best}</span></div>
                    </button>
                  ) : (
                    <div className="space-y-4">
                      {groups.map(([g, keys]) => (
                        <div key={g}>
                          <div className="t-caption text-fg3 mb-1">{GROUP_LABEL[g]}</div>
                          {(keys as readonly AttrKey[]).map((k) => <AttrBar key={k} label={ATTR_LABELS[k]} value={d.attrs[k] ?? 0} />)}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </Section>
              <Section title="Best roles">
                <List>
                  {d.roles.map((r) => (
                    <div key={r.role} className="flex items-center gap-3 px-4 h-12">
                      <PosBadge pos={r.pos} />
                      <span className="flex-1 t-body">{r.name} <span className="text-fg3">({r.duty === 'D' ? 'Defend' : r.duty === 'S' ? 'Support' : 'Attack'})</span></span>
                      <span className="font-cond font-bold text-[20px] tabular">{r.rating.toFixed(1)}</span>
                    </div>
                  ))}
                </List>
              </Section>
              <Section title="This season">
                <ChipRow className="mb-2">
                  <Chip selected={comp === 'all'} onClick={() => setComp('all')}>All</Chip>
                  {d.stats.map((x) => <Chip key={x.comp_type} selected={comp === x.comp_type} onClick={() => setComp(x.comp_type)}>{COMP_SHORT[x.comp_type] ?? x.comp_type}</Chip>)}
                </ChipRow>
                <Card>
                  {s && s.apps > 0 ? (
                    <div className="grid grid-cols-4 gap-y-4 gap-x-2">
                      <StatBlock label="Apps" value={`${s.apps}`} sub={`${s.starts} starts`} />
                      <StatBlock label="Minutes" value={s.mins.toLocaleString()} />
                      <StatBlock label={isGk ? 'Clean sh.' : 'Goals'} value={isGk ? s.cs : s.goals} />
                      <StatBlock label="Assists" value={s.assists} />
                      <StatBlock label="Avg rating" value={rating1(s.avg)} tone={ratingTone(s.avg)} />
                      <StatBlock label="xG" value={s.xg.toFixed(1)} />
                      <StatBlock label="Yellows" value={s.yellows} />
                      <StatBlock label="Reds" value={s.reds} />
                    </div>
                  ) : <div className="t-body text-fg2">No appearances yet.</div>}
                </Card>
              </Section>
              <Section title="Form">
                <Card><RatingLine points={d.form.map((f) => ({ rating: f.rating, result: f.result, opp: f.opp }))} /></Card>
              </Section>
              <Section title="Scout assessment">
                <Card>
                  <div className="flex items-center justify-between">
                    <div><div className="t-caption text-fg3">Potential</div><div className="t-strong capitalize">{d.scout.potential.label} <span className="text-fg2 font-normal">(estimated {d.scout.potential.lo}-{d.scout.potential.hi})</span></div></div>
                    {!d.mine && <Badge tone={d.scout.verdict === 'Sign him' ? 'positive' : d.scout.verdict === 'Worth a look' ? 'info' : 'neutral'}>{d.scout.verdict}</Badge>}
                  </div>
                  <div className="relative h-2 rounded-full bg-input mt-3">
                    <div className="absolute h-2 rounded-full bg-accent/60" style={{ left: `${(d.scout.potential.lo / 20) * 100}%`, width: `${Math.max(2, ((d.scout.potential.hi - d.scout.potential.lo) / 20) * 100)}%` }} />
                    <div className="absolute -top-1 h-4 w-0.5 bg-fg" style={{ left: `${(p.ovr / 20) * 100}%` }} title="Current" />
                  </div>
                  {d.scout.traits.length > 0 ? <div className="flex flex-wrap gap-1.5 mt-3">{d.scout.traits.map((t) => <Badge key={t} tone="info">{t}</Badge>)}</div> : <div className="t-label text-fg3 mt-3">Scout him to learn about his character.</div>}
                  <div className="t-label text-fg3 mt-3">Confidence: {d.scout.confidence}{d.scouting?.assigned ? ' · scouting in progress' : ''}</div>
                  {!d.mine && !d.scouting?.assigned && d.scout.knowledge < 90 && <Button className="mt-3" variant="secondary" size="sm" icon={<Telescope size={16} />} loading={scout.isPending} onClick={() => scout.mutate()}>Send a scout</Button>}
                </Card>
              </Section>
              <Section title="Contract and value">
                <Card>
                  <div className="grid grid-cols-3 gap-2">
                    <StatBlock label="Wage" value={p.clubId ? wage(p.wage) : '-'} />
                    <StatBlock label="Value" value={money(p.value)} />
                    <StatBlock label="Expires" value={p.clubId ? (p.yearsLeft <= 0 ? 'This season' : `+${p.yearsLeft} season${p.yearsLeft > 1 ? 's' : ''}`) : '-'} tone={p.clubId ? contractTone(p.yearsLeft) : undefined} />
                  </div>
                  {p.clubId && <Meter className="mt-3" value={Math.min(5, p.yearsLeft + 1)} max={5} tone={contractTone(p.yearsLeft)} />}
                  {d.renewal && <div className="t-label text-fg2 mt-3">He is looking for about {wage(d.renewal.demand)} to stay.</div>}
                </Card>
              </Section>
              {(d.career.length > 0 || d.history.length > 0) && (
                <Section title="Career">
                  <List>
                    {d.career.map((c, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 h-12">
                        <span className="t-label text-fg3 w-12">S{c.season}</span>
                        <ClubCrest club={c.club} size={22} />
                        <span className="flex-1 t-body truncate">{c.club?.short}</span>
                        <span className="t-label text-fg2 tabular">{c.apps} apps · {c.goals}g {c.assists}a</span>
                        <RatingPill rating={c.avg} size="sm" />
                      </div>
                    ))}
                    {d.history.filter((h) => h.kind && h.kind !== 'youth').map((h, i) => (
                      <div key={`h${i}`} className="flex items-center gap-3 px-4 h-11 t-label text-fg2"><span className="w-12 text-fg3">S{h.season}</span><span className="flex-1">Joined {h.club}</span><span>{h.fee ? money(h.fee) : h.kind === 'free' ? 'Free' : ''}</span></div>
                    ))}
                  </List>
                </Section>
              )}
              <BidComposer playerId={p.id} open={bidOpen} onClose={() => setBidOpen(false)} />
              {d.mine && <RenewalSheet playerId={p.id} open={renewOpen} onClose={() => setRenew(false)} />}
              <Sheet open={more} onClose={() => setMore(false)} title={p.name}>
                <List>
                  <ListRow icon={<Hash size={18} />} title="Change squad number" onClick={() => { setMore(false); const n = window.prompt('New squad number (1-99)', String(p.number ?? '')); if (n) number.mutate(Number(n)); }} />
                  <ListRow title={p.rested ? 'Stop resting him' : 'Rest for the next match'} onClick={() => { setMore(false); rest.mutate(!p.rested); }} />
                  <ListRow icon={<UserMinus size={18} className="text-negative" />} title={<span className="text-negative">Release</span>} subtitle={`Costs ${money(d.actions.releaseCost)} in compensation`} onClick={async () => {
                    setMore(false);
                    if (await confirm({ title: `Release ${p.short}?`, body: `You pay ${money(d.actions.releaseCost)} (half his remaining contract) and he becomes a free agent. This cannot be undone.`, confirm: 'Release', destructive: true })) release.mutate();
                  }} />
                </List>
              </Sheet>
            </>
          );
        }}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- compare
export function Compare() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const others = (params.get('with') ?? '').split(',').filter(Boolean).map(Number).filter((x) => x !== Number(id)).slice(0, 2);
  const ids = [Number(id), ...others];
  const q = useQuery({ queryKey: ['compare', ids.join(',')], queryFn: () => api.get<CompareData>(`/players-compare?ids=${ids.join(',')}`), enabled: ids.length >= 2 });
  const [pick, setPick] = useState(ids.length < 2);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const deb = useDebouncedCallback((v: string) => setDebounced(v), 300);
  const search = useQuery({ queryKey: ['compare-search', debounced], queryFn: () => api.get<SearchData>(`/transfers/search${qs({ q: debounced, sort: 'ovr' })}`), enabled: pick && debounced.length >= 2 });
  const squad = useQuery({ queryKey: ['squad'], queryFn: () => api.get<{ players: { id: number; name: string; short: string; age: number; pos: string[]; best: string; ovr: number; condition: number; form: number[]; injury: null; suspended: number; nat: string }[] }>('/squad'), enabled: pick });
  const add = (pid: number) => { const p = new URLSearchParams(params); p.set('with', [...others, pid].join(',')); setParams(p, { replace: true }); setPick(false); };
  const colors = ['var(--accent)', 'var(--info)', 'var(--warning)'];
  const me = useMe();
  return (
    <Screen title="Compare" back actions={others.length < 2 ? <Button size="sm" variant="secondary" onClick={() => setPick(true)}>Add player</Button> : undefined}>
      {ids.length < 2 ? <div className="t-body text-fg2">Pick a player to compare with.</div> : (
        <Q q={q} skeleton={<SkeletonCards n={3} />}>
          {(d) => {
            const keys = Object.keys(d.players[0].attrs) as AttrKey[];
            const isGk = d.players.every((p) => p.pos.includes('GK'));
            return (
              <>
                <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: `repeat(${d.players.length}, minmax(0,1fr))` }}>
                  {d.players.map((p, i) => (
                    <Link key={p.id} to={`/player/${p.id}`} className="rounded-xl border bg-surface p-2.5 text-center relative" style={{ borderColor: colors[i] }}>
                      {i > 0 && <button aria-label="Remove" className="absolute top-1 right-1 text-fg3" onClick={(e) => { e.preventDefault(); const p2 = new URLSearchParams(params); p2.set('with', others.filter((x) => x !== p.id).join(',')); setParams(p2, { replace: true }); }}><X size={14} /></button>}
                      <div className="t-strong truncate">{p.short}</div>
                      <div className="t-label text-fg2 truncate">{p.club?.short ?? 'Free agent'} · {p.age}</div>
                      <div className="font-cond font-bold text-[24px]" style={{ color: colors[i] }}>{p.ovr.toFixed(1)}</div>
                    </Link>
                  ))}
                </div>
                <Card className="mb-4 flex justify-center">
                  <Radar axes={d.players[0].radar.map((r) => r.label)} series={d.players.map((p, i) => ({ values: p.radar.map((r) => r.value), color: colors[i], fill: i === 0 }))} />
                </Card>
                <Section title="Attributes">
                  <List>
                    {keys.filter((k) => isGk ? true : !(ATTR_GROUPS.goalkeeping as readonly string[]).includes(k)).map((k) => {
                      const vals = d.players.map((p) => p.attrs[k] ?? 0);
                      const best = Math.max(...vals);
                      return (
                        <div key={k} className="flex items-center px-4 h-10">
                          <span className="flex-1 t-label text-fg2">{ATTR_LABELS[k]}</span>
                          {vals.map((v, i) => <span key={i} className={cx('w-12 text-right t-num', v === best && vals.filter((x) => x === best).length < vals.length ? 'text-fg' : 'text-fg3')} style={v === best ? { color: colors[i] } : undefined}>{v % 1 ? v.toFixed(1) : v}</span>)}
                        </div>
                      );
                    })}
                  </List>
                </Section>
                <Section title="Money">
                  <List>
                    <div className="flex items-center px-4 h-11"><span className="flex-1 t-label text-fg2">Value</span>{d.players.map((p) => <span key={p.id} className="w-20 text-right t-num">{money(p.value)}</span>)}</div>
                    <div className="flex items-center px-4 h-11"><span className="flex-1 t-label text-fg2">Wage</span>{d.players.map((p) => <span key={p.id} className="w-20 text-right t-num">{money(p.wage)}</span>)}</div>
                    <div className="flex items-center px-4 h-11"><span className="flex-1 t-label text-fg2">Season apps</span>{d.players.map((p) => <span key={p.id} className="w-20 text-right t-num">{p.season?.apps ?? 0}</span>)}</div>
                    <div className="flex items-center px-4 h-11"><span className="flex-1 t-label text-fg2">Goals + assists</span>{d.players.map((p) => <span key={p.id} className="w-20 text-right t-num">{(p.season?.goals ?? 0) + (p.season?.assists ?? 0)}</span>)}</div>
                  </List>
                </Section>
              </>
            );
          }}
        </Q>
      )}
      <Sheet open={pick} onClose={() => setPick(false)} full title="Compare with">
        <div className="relative mb-3"><SearchIcon size={18} className="absolute left-3 top-3.5 text-fg3" /><input autoFocus className={cx(inputCls, 'pl-10')} placeholder="Search any player" value={term} onChange={(e) => { setTerm(e.target.value); deb.call(e.target.value); }} /></div>
        {debounced.length >= 2 ? (
          <List>{(search.data?.results ?? []).map((p) => <PlayerRow key={p.id} p={p} colors={p.club?.colors} compact onClick={() => add(p.id)} sub={`${p.club?.short ?? 'Free agent'} · ${p.age}`} right={<span className="font-cond font-bold text-[18px]">{p.ovr.toFixed(1)}</span>} />)}</List>
        ) : (
          <>
            <div className="t-caption text-fg3 mb-2">Your squad</div>
            <List>{(squad.data?.players ?? []).filter((p) => p.id !== Number(id)).map((p) => <PlayerRow key={p.id} p={{ ...p, injury: p.injury }} colors={me.club?.colors} compact onClick={() => add(p.id)} right={<span className="font-cond font-bold text-[18px]">{p.ovr.toFixed(1)}</span>} />)}</List>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

void ago; void useMemo;
