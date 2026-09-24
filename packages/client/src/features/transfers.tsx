// Transfers: hub with the league feed, search with filters and suggestions, shortlist, offers, negotiation, scouting.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bookmark, Clock, Handshake, Inbox, Lightbulb, Lock, Search as SearchIcon, SlidersHorizontal, Star, Telescope, Trash2, X } from 'lucide-react';
import type { NegotiationData, OffersData, ScoutingData, SearchData, ShortlistData, SuggestedData, TransferHubData } from '@ffm/server/routes/transfers';
import { api, qs } from '../lib/api';
import { ago, countdown, inWords, money, wage } from '../lib/format';
import { useDebouncedCallback, useNow } from '../lib/hooks';
import { Badge, Button, Card, Chip, ChipRow, EmptyState, Field, IconButton, List, Meter, Q, Screen, Section, Segmented, Select, Sheet, SkeletonList, cx, inputCls, useToast } from '../components/ui';
import { ClubCrest, PlayerRow } from '../components/domain';
import { BidComposer } from './player';
import { useMe } from '../app/session';

function WindowBanner({ w, embargo }: { w: TransferHubData['window']; embargo: boolean }) {
  const now = useNow(30_000);
  if (embargo) return <div className="rounded-xl px-3 py-2.5 mb-3 t-label bg-[color-mix(in_srgb,var(--negative)_14%,transparent)] text-negative flex items-center gap-2"><Lock size={15} /> Transfer embargo: only free agents until your balance recovers.</div>;
  if (w.open) return <div className="rounded-xl px-3 py-2.5 mb-3 t-label bg-[color-mix(in_srgb,var(--positive)_12%,transparent)] text-positive flex items-center gap-2"><Clock size={15} /> {w.kind === 'midseason' ? 'Mid-season' : 'Pre-season'} window open{w.closesAt ? ` · closes in ${inWords(new Date(w.closesAt).getTime() - now)}` : ''}</div>;
  return <div className="rounded-xl px-3 py-2.5 mb-3 t-label bg-raised text-fg2 flex items-center gap-2"><Lock size={15} /> Window closed{w.opensAt ? ` · opens in ${inWords(new Date(w.opensAt).getTime() - now)}` : ''}. Free agents can still be signed.</div>;
}

// ---------------------------------------------------------------- hub
export function TransferHub() {
  const q = useQuery({ queryKey: ['transfers'], queryFn: () => api.get<TransferHubData>('/transfers'), refetchInterval: 60_000 });
  return (
    <Screen title="Transfers" back="/club">
      <Q q={q} skeleton={<SkeletonList rows={6} />}>
        {(d) => (
          <>
            <WindowBanner w={d.window} embargo={d.embargo} />
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Card padded={false} className="p-3"><div className="t-caption text-fg3">Budget</div><div className="t-num text-[17px] mt-0.5">{money(d.budget)}</div><div className="text-[11px] text-fg3">+{money(d.overdraft)} overdraft</div></Card>
              <Card padded={false} className="p-3"><div className="t-caption text-fg3">Wage room</div><div className={cx('t-num text-[17px] mt-0.5', d.wageBudget - d.wageBill < 0 && 'text-negative')}>{money(d.wageBudget - d.wageBill)}</div><div className="text-[11px] text-fg3">per week</div></Card>
              <Card padded={false} className="p-3"><div className="t-caption text-fg3">Squad</div><div className="t-num text-[17px] mt-0.5">{d.squadSize}/{d.maxSquad}</div><div className="text-[11px] text-fg3">players</div></Card>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-6">
              {[
                { to: '/transfers/search', icon: SearchIcon, label: 'Search', n: null },
                { to: '/transfers/shortlist', icon: Star, label: 'Shortlist', n: d.counts.shortlist },
                { to: '/transfers/offers', icon: Inbox, label: 'Offers', n: d.counts.incoming + d.counts.outgoing, hot: d.counts.incoming > 0 },
                { to: '/scouting', icon: Telescope, label: 'Scouting', n: d.counts.scouting },
              ].map((x) => (
                <Link key={x.to} to={x.to} className="rounded-[12px] border border-subtle bg-surface p-4 active:bg-raised relative">
                  <x.icon size={22} className="text-accent" />
                  <div className="t-strong mt-2">{x.label}</div>
                  {x.n !== null && <span className={cx('absolute top-3 right-3 min-w-6 h-6 px-1.5 rounded-full text-[12px] font-bold flex items-center justify-center', 'hot' in x && x.hot ? 'bg-negative text-white' : 'bg-raised text-fg2')}>{x.n}</span>}
                </Link>
              ))}
            </div>
            <Section title="Around the league">
              {d.feed.length === 0 ? <Card><div className="t-label text-fg3">Quiet so far. The bots will get busy.</div></Card> : (
                <List>
                  {d.feed.map((x, i) => (
                    <Link key={i} to={`/player/${x.playerId}`} className="flex items-center gap-3 px-4 min-h-14 py-2 active:bg-raised">
                      <ClubCrest club={x.to} size={28} />
                      <div className="flex-1 min-w-0">
                        <div className="t-body truncate"><b>{x.to?.short}</b> {x.kind === 'done' ? (x.status === 'free' ? 'sign' : 'sign') : x.status === 'rejected' ? 'had a bid rejected for' : x.status === 'countered' ? 'are haggling over' : 'bid for'} {x.player}</div>
                        <div className="t-label text-fg3 truncate">{x.from ? `from ${x.from.short} · ` : x.status === 'free' ? 'free agent · ' : ''}{ago(x.at)}</div>
                      </div>
                      <span className={cx('t-num', x.kind === 'bid' && 'text-fg2')}>{x.fee ? money(x.fee) : 'Free'}</span>
                    </Link>
                  ))}
                </List>
              )}
            </Section>
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- search
type SearchResult = SearchData['results'][number];
const POS_CHIPS = ['GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'AMC', 'AML', 'AMR', 'ST'];

function ResultRow({ p, onBid }: { p: SearchResult; onBid: (id: number) => void }) {
  return (
    <PlayerRow p={p} colors={p.club?.colors} to={`/player/${p.id}`} sub={<>{p.age} · {p.club?.short ?? 'Free agent'}{p.listed ? ' · listed' : ''}</>}
      right={<div className="flex items-center gap-2">
        <div className="text-right"><div className="t-num">{p.status === 'free' ? 'Free' : money(p.value)}</div><div className="text-[11px] text-fg3 tabular">{p.ovr.toFixed(1)} · pot. {p.potential.lo}-{p.potential.hi}</div></div>
        <button type="button" aria-label={`Offer for ${p.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBid(p.id); }} className="h-9 w-9 rounded-full bg-raised flex items-center justify-center"><Handshake size={16} /></button>
      </div>} />
  );
}

export function Search() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [filterOpen, setFilterOpen] = useState(false);
  const [bidFor, setBidFor] = useState<number | null>(null);
  const deb = useDebouncedCallback((v: string) => { const p = new URLSearchParams(params); if (v) p.set('q', v); else p.delete('q'); p.delete('page'); setParams(p, { replace: true }); }, 350);
  const filters = Object.fromEntries(params.entries());
  const active = ['q', 'pos', 'ageMin', 'ageMax', 'valueMax', 'wageMax', 'status', 'minOvr', 'foot', 'league'].some((k) => params.get(k));
  const page = Number(params.get('page') ?? 0);
  const q = useQuery({ queryKey: ['search', params.toString()], queryFn: () => api.get<SearchData>(`/transfers/search?${params.toString()}`), enabled: active, placeholderData: (p) => p });
  const sug = useQuery({ queryKey: ['suggested'], queryFn: () => api.get<SuggestedData>('/transfers/suggested'), enabled: !active, staleTime: 300_000 });
  const setF = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); p.delete('page'); setParams(p, { replace: true }); };
  const posSel = (params.get('pos') ?? '').split(',').filter(Boolean);
  const saved = me.user.prefs.savedSearches ?? [];
  const saveSearch = useMutation({
    mutationFn: (name: string) => api.put('/me', { prefs: { savedSearches: [...saved.filter((s) => s.name !== name), { name, query: params.toString() }].slice(-8) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); toast('Search saved', 'success'); },
  });
  const removeSaved = useMutation({ mutationFn: (name: string) => api.put('/me', { prefs: { savedSearches: saved.filter((s) => s.name !== name) } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  const chips: [string, string][] = [];
  if (posSel.length) chips.push(['pos', posSel.join(', ')]);
  if (params.get('ageMin') || params.get('ageMax')) chips.push(['age', `Age ${params.get('ageMin') ?? 15}-${params.get('ageMax') ?? 40}`]);
  if (params.get('valueMax')) chips.push(['valueMax', `≤ ${money(Number(params.get('valueMax')))}`]);
  if (params.get('wageMax')) chips.push(['wageMax', `Wage ≤ ${money(Number(params.get('wageMax')))}`]);
  if (params.get('status')) chips.push(['status', { free: 'Free agents', listed: 'Transfer-listed', expiring: 'Contract expiring' }[params.get('status')!] ?? '']);
  if (params.get('minOvr')) chips.push(['minOvr', `Overall ${params.get('minOvr')}+`]);
  if (params.get('league')) chips.push(['league', { PL: 'Premier League', EUR: 'Europe', CHAMP: 'Championship' }[params.get('league')!] ?? '']);
  if (params.get('foot')) chips.push(['foot', `${params.get('foot') === 'L' ? 'Left' : params.get('foot') === 'R' ? 'Right' : 'Two'}-footed`]);
  return (
    <Screen title="Player search" back="/transfers" actions={<IconButton label="Filters" badge={chips.length > 0} onClick={() => setFilterOpen(true)}><SlidersHorizontal size={20} /></IconButton>}>
      <div className="relative mb-2"><SearchIcon size={18} className="absolute left-3 top-3.5 text-fg3" /><input className={cx(inputCls, 'pl-10 pr-10')} placeholder="Search by name" value={text} onChange={(e) => { setText(e.target.value); deb.call(e.target.value.trim()); }} />{text && <button aria-label="Clear" className="absolute right-3 top-3.5 text-fg3" onClick={() => { setText(''); deb.flush(''); }}><X size={18} /></button>}</div>
      <ChipRow className="mb-3">
        {chips.map(([k, l]) => <Chip key={k} selected onClick={() => { if (k === 'age') { const p = new URLSearchParams(params); p.delete('ageMin'); p.delete('ageMax'); setParams(p, { replace: true }); } else setF(k, null); }}>{l} ✕</Chip>)}
        {!chips.length && ['free', 'listed', 'expiring'].map((s) => <Chip key={s} onClick={() => setF('status', s)}>{{ free: 'Free agents', listed: 'Transfer-listed', expiring: 'Contracts expiring' }[s]}</Chip>)}
        {!chips.length && ['ST', 'AMR', 'MC', 'DC', 'GK'].map((p) => <Chip key={p} onClick={() => setF('pos', p)}>{p}</Chip>)}
      </ChipRow>
      {!active ? (
        <>
          {saved.length > 0 && (
            <Section title="Saved searches">
              <List>{saved.map((s) => <div key={s.name} className="flex items-center px-4 h-12"><button className="flex-1 text-left t-body" onClick={() => setParams(new URLSearchParams(s.query))}>{s.name}</button><button aria-label="Delete" className="text-fg3" onClick={() => removeSaved.mutate(s.name)}><Trash2 size={16} /></button></div>)}</List>
            </Section>
          )}
          <Q q={sug} skeleton={<SkeletonList rows={5} tall />}>
            {(d) => d.needs.length === 0 ? <EmptyState icon={<Lightbulb size={24} />} title="Your squad looks balanced" body="Search above or use the filters." /> : (
              <>
                {d.needs.map((n) => (
                  <Section key={n.pos} title={`Suggested · ${n.pos}`}>
                    <button type="button" onClick={() => setF('pos', n.pos)} className="w-full text-left rounded-xl bg-[color-mix(in_srgb,var(--info)_12%,transparent)] text-info px-3 py-2 t-label mb-2 flex items-center gap-2"><Lightbulb size={15} /> {n.reason}<ArrowRight size={14} className="ml-auto" /></button>
                    {n.players.length === 0 ? <Card><div className="t-label text-fg3">Nobody affordable fits right now.</div></Card> : <List>{n.players.map((p) => <ResultRow key={p.id} p={p} onBid={setBidFor} />)}</List>}
                  </Section>
                ))}
              </>
            )}
          </Q>
        </>
      ) : (
        <Q q={q} skeleton={<SkeletonList rows={8} tall />}>
          {(d) => (
            <>
              <div className="flex items-center justify-between mb-2">
                <Select className="!h-9 !w-[170px] text-[13px]" ariaLabel="Sort" value={params.get('sort') ?? 'ovr'} onChange={(v) => setF('sort', v)} options={[{ value: 'ovr', label: 'Best first' }, { value: 'value', label: 'Most valuable' }, { value: 'cheap', label: 'Cheapest' }, { value: 'age', label: 'Youngest' }, { value: 'wage', label: 'Lowest wage' }, { value: 'contract', label: 'Contract ending' }]} />
                <button className="t-label text-accent flex items-center gap-1" onClick={() => { const name = window.prompt('Name this search'); if (name) saveSearch.mutate(name.slice(0, 30)); }}><Bookmark size={14} /> Save search</button>
              </div>
              {d.results.length === 0 ? <EmptyState icon={<SearchIcon size={24} />} title="No players match" body="Loosen a filter or two." /> : (
                <>
                  <List>{d.results.map((p) => <ResultRow key={p.id} p={p} onBid={setBidFor} />)}</List>
                  <div className="flex justify-between mt-3">
                    <Button variant="ghost" disabled={page === 0} onClick={() => setF('page', String(page - 1))}>Previous</Button>
                    <Button variant="ghost" disabled={!d.more} onClick={() => setF('page', String(page + 1))}>Next</Button>
                  </div>
                </>
              )}
            </>
          )}
        </Q>
      )}
      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} values={filters} apply={(v) => { const p = new URLSearchParams(); if (params.get('q')) p.set('q', params.get('q')!); for (const [k, val] of Object.entries(v)) if (val) p.set(k, val); setParams(p, { replace: true }); setFilterOpen(false); }} />
      <BidComposer playerId={bidFor} open={bidFor !== null} onClose={() => setBidFor(null)} />
    </Screen>
  );
}

function FilterSheet({ open, onClose, values, apply }: { open: boolean; onClose: () => void; values: Record<string, string>; apply: (v: Record<string, string>) => void }) {
  const [v, setV] = useState<Record<string, string>>(values);
  useEffect(() => { if (open) setV(values); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (v.pos ?? '').split(',').filter(Boolean);
  const set = (k: string, val: string) => setV({ ...v, [k]: val });
  return (
    <Sheet open={open} onClose={onClose} full title="Filters" footer={<div className="flex gap-2"><Button variant="secondary" full onClick={() => setV({})}>Clear</Button><Button full onClick={() => apply(v)}>Show players</Button></div>}>
      <Field label="Position">
        <div className="flex flex-wrap gap-2">{POS_CHIPS.map((p) => <Chip key={p} selected={pos.includes(p)} onClick={() => set('pos', (pos.includes(p) ? pos.filter((x) => x !== p) : [...pos, p]).join(','))}>{p}</Chip>)}</div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min age"><input className={inputCls} inputMode="numeric" value={v.ageMin ?? ''} onChange={(e) => set('ageMin', e.target.value.replace(/\D/g, ''))} placeholder="15" /></Field>
        <Field label="Max age"><input className={inputCls} inputMode="numeric" value={v.ageMax ?? ''} onChange={(e) => set('ageMax', e.target.value.replace(/\D/g, ''))} placeholder="40" /></Field>
      </div>
      <Field label="Maximum value"><Select value={v.valueMax ?? ''} onChange={(x) => set('valueMax', x)} options={[{ value: '', label: 'Any' }, ...[5, 10, 20, 30, 50, 75, 100].map((m) => ({ value: String(m * 1_000_000), label: `£${m}m` }))]} /></Field>
      <Field label="Maximum wage"><Select value={v.wageMax ?? ''} onChange={(x) => set('wageMax', x)} options={[{ value: '', label: 'Any' }, ...[20, 40, 60, 80, 120, 180, 250].map((k) => ({ value: String(k * 1000), label: `£${k}k/wk` }))]} /></Field>
      <Field label="Minimum overall"><Select value={v.minOvr ?? ''} onChange={(x) => set('minOvr', x)} options={[{ value: '', label: 'Any' }, ...[10, 12, 13, 14, 15, 16, 17].map((n) => ({ value: String(n), label: `${n}+` }))]} /></Field>
      <Field label="Availability"><Segmented size="sm" value={v.status ?? ''} onChange={(x) => set('status', x)} options={[{ value: '', label: 'All' }, { value: 'free', label: 'Free' }, { value: 'listed', label: 'Listed' }, { value: 'expiring', label: 'Expiring' }]} /></Field>
      <Field label="League"><Segmented size="sm" value={v.league ?? ''} onChange={(x) => set('league', x)} options={[{ value: '', label: 'All' }, { value: 'PL', label: 'PL' }, { value: 'EUR', label: 'Europe' }, { value: 'CHAMP', label: 'Champ.' }]} /></Field>
      <Field label="Preferred foot"><Segmented size="sm" value={v.foot ?? ''} onChange={(x) => set('foot', x)} options={[{ value: '', label: 'Any' }, { value: 'L', label: 'Left' }, { value: 'R', label: 'Right' }, { value: 'B', label: 'Both' }]} /></Field>
    </Sheet>
  );
}

// ---------------------------------------------------------------- shortlist
export function Shortlist() {
  const nav = useNavigate();
  const [bidFor, setBidFor] = useState<number | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const q = useQuery({ queryKey: ['shortlist'], queryFn: () => api.get<ShortlistData>('/transfers/shortlist') });
  return (
    <Screen title="Shortlist" back="/transfers" actions={sel.length >= 2 ? <Button size="sm" onClick={() => nav(`/player/${sel[0]}/compare?with=${sel.slice(1).join(',')}`)}>Compare {sel.length}</Button> : undefined}>
      <Q q={q} skeleton={<SkeletonList rows={6} tall />}>
        {(d) => d.players.length === 0 ? <EmptyState icon={<Star size={24} />} title="Nobody shortlisted" body="Star players from their profile or search results to follow them here." action={<Link to="/transfers/search"><Button>Find players</Button></Link>} /> : (
          <>
            <div className="t-label text-fg3 mb-2">Tap the circle to select players to compare.</div>
            <List>
              {d.players.map((p) => (
                <div key={p.id} className="flex items-center">
                  <button aria-label={`Select ${p.name}`} onClick={() => setSel(sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id].slice(-3))} className="pl-3">
                    <span className={cx('h-5 w-5 rounded-full border-2 flex items-center justify-center', sel.includes(p.id) ? 'border-accent bg-accent' : 'border-subtle')}>{sel.includes(p.id) && <span className="h-2 w-2 rounded-full bg-[var(--accent-contrast)]" />}</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <PlayerRow p={p} colors={p.club?.colors} to={p.bidId && ['Bid pending', 'Counter-offer', 'Bid rejected', 'Turned you down'].includes(p.status) ? `/transfers/negotiate/${p.bidId}` : `/player/${p.id}`}
                      sub={<>{p.club?.short ?? 'Free agent'} · <span className={cx(p.status === 'Counter-offer' && 'text-warning', p.status === 'Bid rejected' && 'text-negative')}>{p.status}</span></>}
                      right={<div className="flex items-center gap-2"><div className="text-right"><div className="t-num">{p.status === 'Signed' ? '' : money(p.value)}</div><div className="text-[11px] text-fg3">{p.ovr.toFixed(1)}</div></div>{p.clubId !== undefined && p.status !== 'Signed' && <button aria-label="Make an offer" onClick={(e) => { e.preventDefault(); setBidFor(p.id); }} className="h-9 w-9 rounded-full bg-raised flex items-center justify-center"><Handshake size={16} /></button>}</div>} />
                  </div>
                </div>
              ))}
            </List>
          </>
        )}
      </Q>
      <BidComposer playerId={bidFor} open={bidFor !== null} onClose={() => setBidFor(null)} />
    </Screen>
  );
}

// ---------------------------------------------------------------- offers
export function Offers() {
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const q = useQuery({ queryKey: ['offers'], queryFn: () => api.get<OffersData>('/transfers/offers'), refetchInterval: 60_000 });
  const statusTone = (s: string) => (s === 'completed' || s === 'accepted' ? 'positive' : s === 'countered' || s === 'pending' ? 'warning' : 'negative');
  return (
    <Screen title="Offers" back="/transfers">
      <Q q={q} skeleton={<SkeletonList rows={5} />}>
        {(d) => (
          <>
            <Segmented className="mb-3" value={tab} onChange={setTab} options={[{ value: 'in', label: `For your players (${d.incoming.filter((b) => b.status === 'pending').length})` }, { value: 'out', label: `Your bids (${d.outgoing.filter((b) => ['pending', 'countered'].includes(b.status)).length})` }]} />
            {tab === 'in' ? (d.incoming.length === 0 ? <EmptyState icon={<Inbox size={24} />} title="No offers yet" body="When a club bids for one of your players it lands here." /> : (
              <div className="space-y-2">
                {d.incoming.map((b) => (
                  <Card key={b.id} to={`/transfers/negotiate/${b.id}`}>
                    <div className="flex items-center gap-3">
                      <ClubCrest club={b.from} size={36} />
                      <div className="flex-1 min-w-0"><div className="t-strong truncate">{b.from?.short} want {b.player}</div><div className="t-label text-fg2">{money(b.fee)}{b.value ? ` · valued ${money(b.value)}` : ''}</div></div>
                      <Badge tone={statusTone(b.status)}>{b.status}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-2 t-label">
                      {b.reaction && <span className={cx(b.reaction === 'Keen to go' ? 'text-warning' : 'text-fg2')}>Player: {b.reaction}</span>}
                      <span className="text-fg3">· {b.cover} other{b.cover === 1 ? '' : 's'} in his position</span>
                    </div>
                    {b.warning && <div className="t-label text-warning mt-1">{b.warning}</div>}
                  </Card>
                ))}
              </div>
            )) : (d.outgoing.length === 0 ? <EmptyState icon={<Handshake size={24} />} title="No bids" body="Make an offer from any player's profile." action={<Link to="/transfers/search"><Button>Find players</Button></Link>} /> : (
              <List>
                {d.outgoing.map((b) => (
                  <Link key={b.id} to={`/transfers/negotiate/${b.id}`} className="flex items-center gap-3 px-4 min-h-16 py-2 active:bg-raised">
                    <ClubCrest club={b.to} size={30} />
                    <div className="flex-1 min-w-0"><div className="t-strong truncate">{b.player}</div><div className="t-label text-fg2 truncate">{b.to?.short ?? 'Free agent'} · {money(b.counterFee ?? b.fee)}{b.counterFee ? ' asked' : ''}</div><div className="t-label text-fg3 truncate">{b.last}</div></div>
                    <Badge tone={statusTone(b.status)}>{b.status.replace('_', ' ')}</Badge>
                  </Link>
                ))}
              </List>
            ))}
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- negotiation
export function Negotiate() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow(1000);
  const q = useQuery({ queryKey: ['negotiation', Number(id)], queryFn: () => api.get<NegotiationData>(`/transfers/negotiate/${id}`), refetchInterval: 30_000 });
  const [amount, setAmount] = useState('');
  const act = useMutation({
    mutationFn: (b: { action: string; fee?: number }) => api.post<{ status: string; reason?: string }>(`/transfers/bids/${id}`, b),
    onSuccess: (r) => { qc.invalidateQueries(); setAmount(''); toast(r.status === 'completed' ? 'Deal done!' : r.status === 'player_refused' ? (r.reason ?? 'The player said no') : `Status: ${r.status.replace('_', ' ')}`, r.status === 'completed' ? 'success' : 'info'); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <Screen title="Negotiation" back="/transfers/offers">
      <Q q={q} skeleton={<SkeletonList rows={4} />}>
        {(d) => {
          const b = d.bid;
          const open = ['pending', 'countered'].includes(b.status);
          const left = new Date(b.expiresAt).getTime() - now;
          const fee = Number(amount) * 1_000_000;
          return (
            <>
              <Card className="mb-4">
                <div className="flex items-center gap-3">
                  <ClubCrest club={d.role === 'buyer' ? b.to : b.from} size={40} />
                  <div className="flex-1 min-w-0"><Link to={`/player/${b.playerId}`} className="t-strong">{b.player}</Link><div className="t-label text-fg2">{d.role === 'buyer' ? `From ${b.to?.short ?? 'free agency'}` : `${b.from?.short} want him`}</div></div>
                  <Badge tone={b.status === 'completed' ? 'positive' : open ? 'warning' : 'negative'}>{b.status.replace('_', ' ')}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div><div className="t-caption text-fg3">Offer</div><div className="t-num">{money(b.fee)}</div></div>
                  <div><div className="t-caption text-fg3">Wage</div><div className="t-num">{wage(b.wage)}</div></div>
                  <div><div className="t-caption text-fg3">{open ? 'Expires' : 'Length'}</div><div className="t-num">{open ? countdown(left) : `${b.years} yrs`}</div></div>
                </div>
              </Card>
              <Section title="Thread">
                <div className="space-y-2">
                  {d.thread.map((m, i) => {
                    const mine = (m.by === 'buyer' && d.role === 'buyer') || (m.by === 'seller' && d.role === 'seller');
                    return (
                      <div key={i} className={cx('flex', mine ? 'justify-end' : 'justify-start', m.by === 'system' && 'justify-center')}>
                        <div className={cx('max-w-[82%] rounded-2xl px-3.5 py-2.5', m.by === 'system' ? 'bg-transparent text-fg3 t-label' : mine ? 'bg-accent text-on-accent rounded-br-md' : 'bg-raised rounded-bl-md')}>
                          {m.by !== 'system' && <div className={cx('text-[11px] font-semibold mb-0.5', mine ? 'opacity-70' : 'text-fg3')}>{m.by === 'player' ? 'Player' : m.by === 'buyer' ? (d.role === 'buyer' ? 'You' : b.from?.short) : d.role === 'seller' ? 'You' : b.to?.short}</div>}
                          <div className="t-body">{m.text}</div>
                          <div className={cx('text-[10px] mt-0.5', mine ? 'opacity-60' : 'text-fg3')}>{ago(m.at)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {open && d.role === 'buyer' && b.status === 'pending' && <div className="text-center t-label text-fg3 py-2">Waiting for their reply…</div>}
                </div>
              </Section>
              {(d.can.accept || d.can.counter || d.can.raise || d.can.withdraw || d.can.reject) && (
                <Card>
                  {d.can.accept && <Button full className="mb-2" loading={act.isPending && act.variables?.action === 'accept'} onClick={() => act.mutate({ action: 'accept' })}>{d.role === 'buyer' ? `Accept ${money(b.counterFee ?? b.fee)}` : `Accept ${money(b.fee)}`}</Button>}
                  {(d.can.counter || d.can.raise) && (
                    <div className="flex gap-2 mb-2">
                      <input className={cx(inputCls, '!h-11')} inputMode="decimal" placeholder={d.role === 'buyer' ? 'New fee (£m)' : 'Your price (£m)'} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
                      <Button variant="secondary" disabled={!fee} loading={act.isPending && (act.variables?.action === 'raise' || act.variables?.action === 'counter')} onClick={() => act.mutate({ action: d.role === 'buyer' ? 'raise' : 'counter', fee })}>{d.role === 'buyer' ? 'Raise' : 'Counter'}</Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {d.can.reject && <Button variant="secondary" full onClick={() => act.mutate({ action: 'reject' })}>Reject</Button>}
                    {d.can.withdraw && <Button variant="ghost" full onClick={() => act.mutate({ action: 'withdraw' })}>Walk away</Button>}
                  </div>
                  {!d.windowOpen && b.to && <div className="t-label text-warning mt-2">The window is closed; this can only be rejected or withdrawn.</div>}
                </Card>
              )}
            </>
          );
        }}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- scouting
export function Scouting() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['scouting'], queryFn: () => api.get<ScoutingData>('/transfers/scouting') });
  const cancel = useMutation({ mutationFn: (pid: number) => api.post(`/players/${pid}/scout`, { on: false }), onSuccess: () => qc.invalidateQueries({ queryKey: ['scouting'] }) });
  return (
    <Screen title="Scouting" back="/transfers">
      <Q q={q} skeleton={<SkeletonList rows={5} tall />}>
        {(d) => (
          <>
            <Card className="mb-4"><div className="t-body">{d.scout ? <>Chief scout <b>{d.scout.name}</b> ({d.scout.rating}/20)</> : 'No chief scout'}</div><div className="t-label text-fg2 mt-1">Your scouts can follow {d.limit} players at once. Send one from any player's profile.</div></Card>
            <Section title={`On assignment · ${d.active.length}/${d.limit}`}>
              {d.active.length === 0 ? <Card><div className="t-label text-fg3">No active assignments.</div></Card> : (
                <List>
                  {d.active.map((p) => (
                    <div key={p.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ClubCrest club={p.club} size={28} />
                        <Link to={`/player/${p.id}`} className="flex-1 min-w-0"><div className="t-strong truncate">{p.name}</div><div className="t-label text-fg3">{p.club?.short ?? 'Free agent'} · report in about {p.daysLeft} day{p.daysLeft > 1 ? 's' : ''}</div></Link>
                        <button className="t-label text-fg3" onClick={() => cancel.mutate(p.id)}>Cancel</button>
                      </div>
                      <Meter className="mt-2" value={p.knowledge} />
                    </div>
                  ))}
                </List>
              )}
            </Section>
            <Section title="Reports">
              {d.reports.length === 0 ? <Card><div className="t-label text-fg3">Finished reports land here and in your shortlist.</div></Card> : (
                <div className="space-y-2">
                  {d.reports.map((p) => (
                    <Card key={p.id} to={`/player/${p.id}`}>
                      <div className="flex items-center gap-3">
                        <ClubCrest club={p.club} size={30} />
                        <div className="flex-1 min-w-0"><div className="t-strong truncate">{p.name}</div><div className="t-label text-fg2">{p.age} · {p.pos.join('/')} · {p.club?.short ?? 'Free agent'}</div></div>
                        <Badge tone={p.report.verdict === 'Sign him' ? 'positive' : p.report.verdict === 'Worth a look' ? 'info' : 'neutral'}>{p.report.verdict}</Badge>
                      </div>
                      <div className="t-label text-fg2 mt-2 capitalize">Potential {p.report.potential.label} ({p.report.potential.lo}-{p.report.potential.hi}) · {p.report.confidence}</div>
                      {p.report.traits.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{p.report.traits.map((t) => <Badge key={t} tone="info">{t}</Badge>)}</div>}
                    </Card>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </Q>
    </Screen>
  );
}

void qs; void useMemo;
