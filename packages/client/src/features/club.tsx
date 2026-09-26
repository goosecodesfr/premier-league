// Club tab: overview, finances and tickets, facilities, staff, sponsorship, vision and the trophy cabinet.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Banknote, Bot, Building2, CalendarCheck2, ChevronRight, Dumbbell, GalleryHorizontalEnd, GraduationCap, HeartPulse, Handshake, Landmark, Newspaper, Settings as SettingsIcon, Stethoscope, Target, Telescope, TrendingDown, TrendingUp, Trophy, Users, BookOpen } from 'lucide-react';
import type { ClubOverviewData, FinancesData, TrophiesData } from '@ffm/server/routes/club';
import { api } from '../lib/api';
import { dateLabel, money, shortDate, wage } from '../lib/format';
import { Badge, Button, Card, Chip, ChipRow, EmptyState, List, ListRow, Meter, Q, Screen, Section, Segmented, Select, Sheet, SkeletonCards, StatBlock, cx, useConfirm, useToast } from '../components/ui';
import { ClubCrest, FormDots, Pips, Stars } from '../components/domain';
import { StackedBar } from '../components/charts';
import { useMe } from '../app/session';

const INCOME_COLORS: Record<string, string> = { gate: '#3DD68C', tv: '#4C9AFF', prize: '#F5A524', sponsor: '#A78BFA', sale: '#22D3EE', merit: '#FB7185', event: '#94A3B8' };
const EXPENSE_COLORS: Record<string, string> = { wages: '#F0516D', staff: '#FB923C', fee: '#F5A524', facility: '#A78BFA', running: '#64717E', interest: '#EF4444', compensation: '#94A3B8', event: '#CBD5E1' };
const CAT_LABEL: Record<string, string> = {
  gate: 'Gate receipts', tv: 'Broadcasting', prize: 'Prize money', sponsor: 'Sponsorship', sale: 'Player sales', merit: 'Merit payment', event: 'Other',
  wages: 'Player wages', staff: 'Staff wages', fee: 'Transfer fees', facility: 'Facilities', running: 'Running costs', interest: 'Interest', compensation: 'Compensation',
};

// ---------------------------------------------------------------- overview
export function ClubOverview() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['myclub'], queryFn: () => api.get<ClubOverviewData>('/club') });
  const takeover = useMutation({ mutationFn: (on: boolean) => api.post('/club/takeover', { on }), onSuccess: () => { qc.invalidateQueries(); toast('You are back in charge', 'success'); } });
  return (
    <Screen title="Club" actions={<Link to="/settings" aria-label="Settings" className="h-11 w-11 flex items-center justify-center"><SettingsIcon size={22} /></Link>}>
      <Q q={q} skeleton={<SkeletonCards n={4} h={110} />}>
        {(d) => {
          const tiles = [
            { to: '/club/finances', icon: Banknote, label: 'Finances', value: money(d.tiles.balance), sub: `Projected ${money(d.tiles.projected)}` },
            { to: '/club/facilities', icon: Building2, label: 'Facilities', value: `Training tier ${d.tiles.facilities.training}`, sub: d.tiles.facilities.building ? 'Building in progress' : `Youth ${d.tiles.facilities.youth} · Medical ${d.tiles.facilities.medical}` },
            { to: '/club/staff', icon: Users, label: 'Staff', value: `${d.tiles.staff} staff`, sub: 'Coaching, fitness, scouting' },
            { to: '/club/sponsorship', icon: Handshake, label: 'Sponsorship', value: d.tiles.sponsor ? money(d.tiles.sponsor.guaranteed) : d.tiles.sponsorOffers ? `${d.tiles.sponsorOffers} offers` : 'None', sub: d.tiles.sponsor ? `${d.tiles.sponsor.name}, ${d.tiles.sponsor.seasonsLeft} season${d.tiles.sponsor.seasonsLeft > 1 ? 's' : ''} left` : 'Pick a shirt sponsor' },
            { to: '/club/vision', icon: Target, label: 'Vision', value: `${d.tiles.visionSet}/3 goals`, sub: d.tiles.visionSet ? 'Board is watching' : 'Set your goals' },
            { to: '/club/trophies', icon: Trophy, label: 'Trophies', value: `${d.tiles.trophies}`, sub: 'Cabinet and records' },
          ];
          return (
            <>
              {d.botTakeover && (
                <Card className="mb-4 !border-warning">
                  <div className="flex items-center gap-3"><Bot size={22} className="text-warning" /><div className="flex-1"><div className="t-strong">Your assistant is in charge</div><div className="t-label text-fg2">After several missed deadlines the bot has been running the club.</div></div></div>
                  <Button className="mt-3" full loading={takeover.isPending} onClick={() => takeover.mutate(false)}>Take charge again</Button>
                </Card>
              )}
              <Card className="mb-4 relative overflow-hidden">
                <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%)` }} />
                <div className="relative flex items-center gap-4">
                  <ClubCrest club={me.club} size={60} />
                  <div className="min-w-0 flex-1">
                    <div className="t-title2 truncate">{d.club.name}</div>
                    <div className="t-label text-fg2">{d.stadium} · {d.capacity.toLocaleString()}</div>
                    <div className="flex items-center gap-2 mt-1">{d.position && <Badge tone="accent">{d.position}</Badge>}<FormDots form={d.form} size={16} /></div>
                  </div>
                </div>
                <div className="relative grid grid-cols-3 gap-2 mt-4">
                  <StatBlock label="Reputation" value={d.reputation} />
                  <StatBlock label="Fans" value={d.fanMood >= 75 ? 'Buzzing' : d.fanMood >= 55 ? 'Happy' : d.fanMood >= 35 ? 'Restless' : 'Angry'} tone={d.fanMood >= 55 ? 'positive' : d.fanMood >= 35 ? 'warning' : 'negative'} />
                  <StatBlock label="Expected" value={d.expectation ?? '-'} />
                </div>
              </Card>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {tiles.map((t) => (
                  <Link key={t.to} to={t.to} className="rounded-[12px] border border-subtle bg-surface p-3 active:bg-raised">
                    <div className="flex items-center gap-2 text-fg2"><t.icon size={16} /><span className="t-caption">{t.label}</span></div>
                    <div className="t-strong mt-2 truncate">{t.value}</div>
                    <div className="t-label text-fg3 truncate">{t.sub}</div>
                  </Link>
                ))}
              </div>
              {d.vision.length > 0 && (
                <Section title="Season progress" action={<Link to="/club/vision" className="t-label text-accent">Vision</Link>}>
                  <Card>
                    <div className="space-y-3">
                      {d.vision.map((g, i) => (
                        <div key={i}>
                          <div className="flex justify-between t-label"><span className="text-fg">{g.label}</span><span className={cx(g.state === 'done' ? 'text-positive' : g.state === 'failed' ? 'text-negative' : g.state === 'at_risk' ? 'text-warning' : 'text-fg2')}>{g.status}</span></div>
                          <Meter className="mt-1.5" value={g.progress * 100} tone={g.state === 'done' || g.state === 'on_track' ? 'positive' : g.state === 'failed' ? 'negative' : 'warning'} />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Section>
              )}
              <Section title="More">
                <List>
                  <ListRow icon={<ArrowRightLeft size={18} />} title="Transfers" to="/transfers" />
                  <ListRow icon={<Telescope size={18} />} title="Scouting" to="/scouting" />
                  <ListRow icon={<Newspaper size={18} />} title="News" to="/media" />
                  <ListRow icon={<GalleryHorizontalEnd size={18} />} title="Media gallery" to="/media/gallery" />
                  <ListRow icon={<CalendarCheck2 size={18} />} title="Season review" to="/season/review" />
                  <ListRow icon={<BookOpen size={18} />} title="Guide" subtitle="How to play, and every term explained" to="/guide" />
                  <ListRow icon={<SettingsIcon size={18} />} title="Settings" to="/settings" />
                </List>
              </Section>
              {d.embargo && <Card className="!border-negative mb-4"><div className="t-strong text-negative">Transfer embargo</div><div className="t-label text-fg2">Your balance fell below -£30m. You can only sign free agents until it climbs back above -£10m. Sell players or cut wages.</div></Card>}
            </>
          );
        }}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- finances
function interpAttendance(curve: { price: number; attendancePct: number }[], price: number): number {
  for (let i = 1; i < curve.length; i++) if (price <= curve[i].price) {
    const a = curve[i - 1], b = curve[i];
    return a.attendancePct + ((price - a.price) / (b.price - a.price)) * (b.attendancePct - a.attendancePct);
  }
  return curve[curve.length - 1]?.attendancePct ?? 0;
}

function TicketPricing({ t }: { t: FinancesData['tickets'] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [general, setGeneral] = useState(t.general);
  const [premium, setPremium] = useState(t.premium);
  useEffect(() => { setGeneral(t.general); setPremium(t.premium); }, [t.general, t.premium]);
  const att = interpAttendance(t.curve, general);
  const revenue = Math.round((att / 100) * t.capacity * (general * 0.86 + premium * 0.14));
  const mood = general > t.fair * 1.35 ? { l: 'Angry', tone: 'negative' as const } : general > t.fair * 1.15 ? { l: 'Grumbling', tone: 'warning' as const } : general < t.fair * 0.8 ? { l: 'Delighted', tone: 'positive' as const } : { l: 'Content', tone: 'positive' as const };
  const save = useMutation({ mutationFn: () => api.put('/club/tickets', { general, premium: Math.max(premium, general) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['finances'] }); toast('Ticket prices updated', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  const changed = general !== t.general || premium !== t.premium;
  return (
    <Card>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatBlock label="Attendance" value={`${Math.round(att)}%`} tone={att >= 95 ? 'positive' : att >= 80 ? 'warning' : 'negative'} />
        <StatBlock label="Per match" value={money(revenue)} />
        <StatBlock label="Fans" value={mood.l} tone={mood.tone} />
      </div>
      <div className="flex justify-between t-label mb-1"><span className="text-fg2">General admission</span><span className="t-num">£{general}</span></div>
      <input type="range" min={10} max={160} step={1} value={general} onChange={(e) => setGeneral(Number(e.target.value))} className="w-full" aria-label="General ticket price" />
      <div className="t-label text-fg3 mb-3">Fans think about £{t.fair} is fair.</div>
      <div className="flex justify-between t-label mb-1"><span className="text-fg2">Premium seats</span><span className="t-num">£{premium}</span></div>
      <input type="range" min={general} max={600} step={5} value={Math.max(premium, general)} onChange={(e) => setPremium(Number(e.target.value))} className="w-full" aria-label="Premium ticket price" />
      <Button className="mt-3" full disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Save prices</Button>
    </Card>
  );
}

export function Finances() {
  const [cat, setCat] = useState<string | null>(null);
  const [period, setPeriod] = useState<'now' | 'last'>('now');
  const q = useQuery({ queryKey: ['finances', cat], queryFn: () => api.get<FinancesData>(`/club/finances${cat ? `?cat=${cat}` : ''}`), placeholderData: (p) => p });
  return (
    <Screen title="Finances" back>
      <Q q={q} skeleton={<SkeletonCards n={4} h={120} />}>
        {(d) => {
          const inc = period === 'now' ? d.income : d.lastSeason?.income ?? {};
          const exp = period === 'now' ? d.expense : d.lastSeason?.expense ?? {};
          const incTotal = Object.values(inc).reduce((s, v) => s + v, 0);
          const expTotal = Object.values(exp).reduce((s, v) => s + v, 0);
          const scale = Math.max(incTotal, expTotal, 1);
          const trendUp = d.projected >= d.balance;
          const months = new Map<string, typeof d.ledger>();
          for (const l of d.ledger) { const k = new Date(l.at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); months.set(k, [...(months.get(k) ?? []), l]); }
          const spark = d.trend.map((x) => x.balance);
          const sMin = Math.min(...spark, 0), sMax = Math.max(...spark, 1);
          return (
            <>
              <Card className="mb-4">
                <div className="t-caption text-fg3">Projected end-of-season balance</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className={cx('t-display', d.projected < 0 && 'text-negative')}>{money(d.projected)}</div>
                  {trendUp ? <TrendingUp className="text-positive" /> : <TrendingDown className="text-negative" />}
                </div>
                {spark.length > 1 && (
                  <svg viewBox="0 0 100 24" className="w-full h-10 mt-1" preserveAspectRatio="none" aria-hidden>
                    <polyline fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" points={spark.map((v, i) => `${(i / (spark.length - 1)) * 100},${22 - ((v - sMin) / (sMax - sMin || 1)) * 20}`).join(' ')} />
                  </svg>
                )}
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <StatBlock label="Balance now" value={money(d.balance)} tone={d.balance < 0 ? 'negative' : undefined} />
                  <StatBlock label="Wage bill" value={wage(d.wageBill)} sub={`Budget ${wage(d.wageBudget)}`} tone={d.wageBill > d.wageBudget ? 'warning' : undefined} />
                  <StatBlock label="Weeks left" value={d.weeksLeft} />
                </div>
                {d.embargo && <div className="t-label text-negative mt-3">Transfer embargo in force.</div>}
              </Card>
              <Section title="Income and spending" action={d.lastSeason ? <Segmented size="sm" className="w-[170px]" value={period} onChange={setPeriod} options={[{ value: 'now', label: 'This season' }, { value: 'last', label: 'Last' }]} /> : null}>
                <Card>
                  <div className="flex justify-between t-label mb-1"><span className="text-fg2">Income</span><span className="t-num text-positive">{money(incTotal)}</span></div>
                  <StackedBar total={scale} parts={Object.entries(inc).map(([k, v]) => ({ key: k, label: CAT_LABEL[k] ?? k, value: v, color: INCOME_COLORS[k] ?? '#94A3B8' }))} />
                  <div className="flex justify-between t-label mb-1 mt-3"><span className="text-fg2">Spending</span><span className="t-num text-negative">{money(expTotal)}</span></div>
                  <StackedBar total={scale} parts={Object.entries(exp).map(([k, v]) => ({ key: k, label: CAT_LABEL[k] ?? k, value: v, color: EXPENSE_COLORS[k] ?? '#94A3B8' }))} />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
                    {Object.entries(inc).filter(([, v]) => v > 0).map(([k, v]) => <div key={k} className="flex items-center gap-1.5 t-label"><span className="h-2 w-2 rounded-sm" style={{ background: INCOME_COLORS[k] ?? '#94A3B8' }} /><span className="text-fg2 flex-1 truncate">{CAT_LABEL[k] ?? k}</span><span className="tabular">{money(v)}</span></div>)}
                    {Object.entries(exp).filter(([, v]) => v > 0).map(([k, v]) => <div key={k} className="flex items-center gap-1.5 t-label"><span className="h-2 w-2 rounded-sm" style={{ background: EXPENSE_COLORS[k] ?? '#94A3B8' }} /><span className="text-fg2 flex-1 truncate">{CAT_LABEL[k] ?? k}</span><span className="tabular">-{money(v)}</span></div>)}
                  </div>
                </Card>
              </Section>
              <Section title="Ticket prices"><TicketPricing t={d.tickets} /></Section>
              <Section title="Transactions">
                <ChipRow className="mb-2">
                  <Chip selected={!cat} onClick={() => setCat(null)}>All</Chip>
                  {['gate', 'tv', 'sponsor', 'prize', 'sale', 'fee', 'wages', 'facility'].map((k) => <Chip key={k} selected={cat === k} onClick={() => setCat(k)}>{CAT_LABEL[k]}</Chip>)}
                </ChipRow>
                {d.ledger.length === 0 ? <Card><div className="t-label text-fg3">Nothing yet.</div></Card> : [...months.entries()].map(([m, rows]) => (
                  <div key={m} className="mb-3">
                    <div className="t-caption text-fg3 mb-1">{m}</div>
                    <List>
                      {rows.map((l) => (
                        <div key={l.id} className="flex items-center gap-3 px-4 min-h-12 py-2">
                          <span className="t-label text-fg3 w-12 shrink-0">{shortDate(l.at)}</span>
                          <span className="flex-1 t-body truncate">{l.description}</span>
                          <span className={cx('t-num', l.amount >= 0 ? 'text-positive' : 'text-fg')}>{money(l.amount, { sign: true })}</span>
                        </div>
                      ))}
                    </List>
                  </div>
                ))}
              </Section>
            </>
          );
        }}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- facilities
interface FacilitiesData {
  balance: number; building: { kind: string; toLevel: number; completesAt: string; seats?: number } | null;
  tracks: { kind: 'training' | 'youth' | 'medical' | 'stadium'; level: number; effect: string; capacity?: number; next: { cost: number; days: number; seats?: number; revenuePerMatch?: number } | null; affordable: boolean }[];
}
const FAC: Record<string, { label: string; icon: typeof Dumbbell }> = { training: { label: 'Training ground', icon: Dumbbell }, youth: { label: 'Youth academy', icon: GraduationCap }, medical: { label: 'Medical centre', icon: Stethoscope }, stadium: { label: 'Stadium', icon: Landmark } };

export function Facilities() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['facilities'], queryFn: () => api.get<FacilitiesData>('/club/facilities') });
  const up = useMutation({ mutationFn: (k: string) => api.post(`/club/facilities/${k}`), onSuccess: () => { qc.invalidateQueries(); toast('Work has started', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  return (
    <Screen title="Facilities" back>
      <Q q={q} skeleton={<SkeletonCards n={4} h={130} />}>
        {(d) => (
          <div className="space-y-3">
            {d.building && (
              <Card className="!border-accent">
                <div className="t-caption text-fg3">Under construction</div>
                <div className="t-strong">{FAC[d.building.kind]?.label}{d.building.kind === 'stadium' ? ` · +${d.building.seats?.toLocaleString()} seats` : ` · tier ${d.building.toLevel}`}</div>
                <div className="t-label text-fg2">Ready {dateLabel(d.building.completesAt)}</div>
              </Card>
            )}
            {d.tracks.map((t) => {
              const F = FAC[t.kind];
              const busy = !!d.building;
              const reason = busy ? 'One project at a time' : !t.next ? 'Top tier reached' : !t.affordable ? `Needs ${money(t.next.cost)}` : null;
              return (
                <Card key={t.kind}>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-raised flex items-center justify-center"><F.icon size={20} /></div>
                    <div className="flex-1"><div className="t-strong">{F.label}</div>{t.kind === 'stadium' ? <div className="t-label text-fg2">{t.capacity?.toLocaleString()} seats</div> : <Pips value={t.level} />}</div>
                  </div>
                  <div className="t-body text-fg2 mt-2">{t.effect}</div>
                  {t.next && (
                    <div className="t-label text-fg3 mt-1">
                      Next: {money(t.next.cost)} · {t.next.days} days{t.next.seats ? ` · +${t.next.seats.toLocaleString()} seats (about ${money(t.next.revenuePerMatch ?? 0)} more per home game)` : ''}
                    </div>
                  )}
                  <Button className="mt-3" full variant="secondary" disabled={!!reason} loading={up.isPending && up.variables === t.kind}
                    onClick={async () => { if (t.next && await confirm({ title: `Upgrade the ${F.label.toLowerCase()}?`, body: `Costs ${money(t.next.cost)} now and takes ${t.next.days} days.`, confirm: 'Build it' })) up.mutate(t.kind); }}>
                    {reason ?? 'Upgrade'}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- staff
interface StaffData { balance: number; roles: { role: string; label: string; member: { name: string; rating: number; wage: number; nat: string } | null; effect: string | null; severance: number; candidates: { id: number; name: string; nat: string; rating: number; wage: number; note: string; effect: string }[] }[] }
const STAFF_ICON: Record<string, typeof Users> = { assistant: Users, coach: Dumbbell, fitness: HeartPulse, physio: Stethoscope, scout: Telescope };

export function Staff() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api.get<StaffData>('/club/staff') });
  const [role, setRole] = useState<StaffData['roles'][number] | null>(null);
  const hire = useMutation({ mutationFn: (x: { role: string; id: number }) => api.post(`/club/staff/${x.role}`, { candidateId: x.id }), onSuccess: () => { qc.invalidateQueries(); setRole(null); toast('New staff member appointed', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  return (
    <Screen title="Staff" back>
      <Q q={q} skeleton={<SkeletonCards n={5} h={80} />}>
        {(d) => (
          <div className="space-y-2">
            {d.roles.map((r) => {
              const Icon = STAFF_ICON[r.role] ?? Users;
              return (
                <Card key={r.role} onClick={() => setRole(r)}>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-raised flex items-center justify-center"><Icon size={20} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="t-caption text-fg3">{r.label}</div>
                      <div className="t-strong truncate">{r.member?.name ?? 'Vacant'}</div>
                      {r.member && <div className="flex items-center gap-2"><Stars value={Math.round(r.member.rating / 4)} /><span className="t-label text-fg3">{r.member.rating}/20 · {wage(r.member.wage)}</span></div>}
                    </div>
                    <ChevronRight size={18} className="text-fg3" />
                  </div>
                  {r.effect && <div className="t-label text-fg2 mt-2">{r.effect}</div>}
                </Card>
              );
            })}
          </div>
        )}
      </Q>
      <Sheet open={!!role} onClose={() => setRole(null)} full title={role ? `${role.label} candidates` : ''}>
        {role && (
          <>
            {role.member && <div className="t-label text-fg2 mb-3">Replacing {role.member.name} costs {money(role.severance)} in severance.</div>}
            <List>
              {role.candidates.map((c) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-2"><span className="t-strong flex-1">{c.name}</span><Stars value={Math.round(c.rating / 4)} /><span className="t-label text-fg3">{c.rating}/20</span></div>
                  <div className="t-label text-fg2">{c.note} {wage(c.wage)}</div>
                  <div className="t-label text-accent mt-0.5">{c.effect}</div>
                  <Button className="mt-2" size="sm" variant="secondary" loading={hire.isPending && hire.variables?.id === c.id} onClick={async () => {
                    if (await confirm({ title: `Appoint ${c.name}?`, body: role.member ? `${role.member.name} leaves with ${money(role.severance)} severance.` : undefined, confirm: 'Appoint' })) hire.mutate({ role: role.role, id: c.id });
                  }}>Appoint</Button>
                </div>
              ))}
            </List>
            <div className="t-label text-fg3 mt-3">New candidates appear each transfer window.</div>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

// ---------------------------------------------------------------- sponsorship
interface SponsorData { current: { name: string; guaranteed: number; seasonsLeft: number; summary: string } | null; offers: { index: number; name: string; guaranteed: number; seasonsLeft: number; summary: string; bonus: { kind: string; amount: number } | null }[] }
export function Sponsorship() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['sponsorship'], queryFn: () => api.get<SponsorData>('/club/sponsorship') });
  const accept = useMutation({ mutationFn: (i: number) => api.post('/club/sponsorship', { index: i }), onSuccess: () => { qc.invalidateQueries(); toast('Deal signed', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  return (
    <Screen title="Sponsorship" back>
      <Q q={q}>
        {(d) => (
          <>
            {d.current ? (
              <Card className="mb-4">
                <div className="t-caption text-fg3">Current shirt sponsor</div>
                <div className="t-title2 mt-1">{d.current.name}</div>
                <div className="t-body text-fg2 mt-1">{d.current.summary}</div>
                <div className="t-label text-fg3 mt-2">{d.current.seasonsLeft} season{d.current.seasonsLeft > 1 ? 's' : ''} left</div>
              </Card>
            ) : d.offers.length === 0 ? <EmptyState icon={<Handshake size={24} />} title="No offers right now" body="New offers arrive at the start of each season." /> : (
              <>
                <div className="t-body text-fg2 mb-3">Pick one. The choice locks for the length of the deal.</div>
                <div className="space-y-3">
                  {d.offers.map((o) => (
                    <Card key={o.index}>
                      <div className="flex items-center justify-between"><span className="t-title2">{o.name}</span><Badge tone={o.bonus ? 'warning' : 'positive'}>{o.bonus ? 'Performance' : 'Guaranteed'}</Badge></div>
                      <div className="t-display-sm mt-2">{money(o.guaranteed)}<span className="t-label text-fg3 ml-1 font-sans">a season</span></div>
                      <div className="t-body text-fg2 mt-1">{o.summary}</div>
                      <div className="t-label text-fg3 mt-1">{o.seasonsLeft} season{o.seasonsLeft > 1 ? 's' : ''}</div>
                      <Button className="mt-3" full loading={accept.isPending && accept.variables === o.index} onClick={async () => { if (await confirm({ title: `Sign with ${o.name}?`, body: o.summary, confirm: 'Sign deal' })) accept.mutate(o.index); }}>Accept</Button>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- vision
interface VisionData {
  goals: { kind: string; label: string; target?: number; clubId?: number; progress: number; status: string; state: string }[];
  kinds: { kind: string; label: string; needs?: 'club' | 'number' }[];
  rivals: { id: number; short: string; name: string; human: boolean }[];
  editable: boolean; reward: number;
}
export function Vision() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['vision'], queryFn: () => api.get<VisionData>('/club/vision') });
  const [draft, setDraft] = useState<{ kind: string; clubId?: number; target?: number }[] | null>(null);
  useEffect(() => { if (q.data && !draft) setDraft(q.data.goals.length ? q.data.goals.map((g) => ({ kind: g.kind, clubId: g.clubId, target: g.target })) : [{ kind: 'top_half' }, { kind: 'beat_rival', clubId: q.data.rivals.find((r) => r.human)?.id ?? q.data.rivals[0]?.id }, { kind: 'win_cup' }]); }, [q.data, draft]);
  const save = useMutation({ mutationFn: () => api.put('/club/vision', { goals: draft }), onSuccess: () => { qc.invalidateQueries(); toast('The board has noted your goals', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  return (
    <Screen title="Club vision" back>
      <Q q={q}>
        {(d) => (
          <>
            <div className="t-body text-fg2 mb-4">Three goals for the season. Each one met earns a {money(d.reward)} board bonus and lifts the fans; each one missed costs you some goodwill.</div>
            {d.editable && draft ? (
              <>
                {draft.map((g, i) => {
                  const kind = d.kinds.find((k) => k.kind === g.kind);
                  return (
                    <Card key={i} className="mb-3">
                      <div className="t-caption text-fg3 mb-1.5">Goal {i + 1}</div>
                      <Select ariaLabel={`Goal ${i + 1}`} value={g.kind} onChange={(v) => setDraft(draft.map((x, j) => (j === i ? { kind: v, clubId: v === 'beat_rival' ? d.rivals[0]?.id : undefined, target: v === 'youth_minutes' ? 1500 : undefined } : x)))} options={d.kinds.map((k) => ({ value: k.kind, label: k.label }))} />
                      {kind?.needs === 'club' && <Select className="mt-2" ariaLabel="Rival" value={g.clubId ?? 0} onChange={(v) => setDraft(draft.map((x, j) => (j === i ? { ...x, clubId: Number(v) } : x)))} options={d.rivals.map((r) => ({ value: r.id, label: `${r.name}${r.human ? ' (friend)' : ''}` }))} />}
                      {kind?.needs === 'number' && <Select className="mt-2" ariaLabel="Minutes" value={g.target ?? 1500} onChange={(v) => setDraft(draft.map((x, j) => (j === i ? { ...x, target: Number(v) } : x)))} options={[750, 1000, 1500, 2000, 3000].map((m) => ({ value: m, label: `${m.toLocaleString()} minutes` }))} />}
                    </Card>
                  );
                })}
                <Button full size="lg" loading={save.isPending} onClick={() => save.mutate()}>Present to the board</Button>
                <div className="t-label text-fg3 mt-2 text-center">Goals lock a few games into the season.</div>
              </>
            ) : (
              <div className="space-y-3">
                {d.goals.map((g, i) => (
                  <Card key={i}>
                    <div className="flex items-center justify-between"><span className="t-strong">{g.label}</span><Badge tone={g.state === 'done' ? 'positive' : g.state === 'failed' ? 'negative' : g.state === 'at_risk' ? 'warning' : 'info'}>{g.state.replace('_', ' ')}</Badge></div>
                    <Meter className="mt-3" value={g.progress * 100} tone={g.state === 'failed' ? 'negative' : g.state === 'at_risk' ? 'warning' : 'positive'} />
                    <div className="t-label text-fg2 mt-1.5">{g.status}</div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- trophies
export function Trophies() {
  const q = useQuery({ queryKey: ['trophies'], queryFn: () => api.get<TrophiesData>('/club/trophies') });
  return (
    <Screen title="Trophy cabinet" back>
      <Q q={q}>
        {(d) => (
          <>
            <div className="rounded-[14px] border border-subtle p-4 mb-5" style={{ background: 'linear-gradient(180deg, #1c232b, #12171c)' }}>
              {d.trophies.length === 0 ? <EmptyState icon={<Trophy size={24} />} title="The cabinet is empty" body="For now. Every trophy you win lands on this shelf." /> : (
                <div className="grid grid-cols-3 gap-3">
                  {d.trophies.map((t, i) => (
                    <div key={i} className="flex flex-col items-center text-center">
                      <Trophy size={40} className="text-warning drop-shadow-[0_4px_12px_rgba(245,165,36,0.35)]" />
                      <div className="t-label mt-1.5 leading-tight">{t.name}</div>
                      <div className="text-[11px] text-fg3">{t.label}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="h-2 rounded-full bg-[#2a2016] mt-4" />
            </div>
            {d.runnersUp.length > 0 && <Section title="Runners-up"><List>{d.runnersUp.map((t, i) => <div key={i} className="flex items-center px-4 h-12"><span className="flex-1 t-body">{t.name}</span><span className="t-label text-fg3">{t.label}</span></div>)}</List></Section>}
            <Section title="Records">
              <List>
                <ListRow title="Biggest win" subtitle={d.records.biggestWin ? `${d.records.biggestWin.score} v ${d.records.biggestWin.opp}` : 'None yet'} to={d.records.biggestWin ? `/fixture/${d.records.biggestWin.fixtureId}` : undefined} />
                <ListRow title="Longest unbeaten run" subtitle={d.records.unbeatenRun ? `${d.records.unbeatenRun.games} matches` : 'None yet'} />
                <ListRow title="Top scorer" subtitle={d.records.topScorer ? `${d.records.topScorer.name}, ${d.records.topScorer.goals} goals` : 'None yet'} to={d.records.topScorer ? `/player/${d.records.topScorer.id}` : undefined} />
                <ListRow title="Most appearances" subtitle={d.records.mostApps ? `${d.records.mostApps.name}, ${d.records.mostApps.apps}` : 'None yet'} to={d.records.mostApps ? `/player/${d.records.mostApps.id}` : undefined} />
                <ListRow title="Record signing" subtitle={d.records.recordSigning ? `${d.records.recordSigning.name}, ${money(d.records.recordSigning.fee)}${d.records.recordSigning.from ? ` from ${d.records.recordSigning.from}` : ''}` : 'None yet'} to={d.records.recordSigning ? `/player/${d.records.recordSigning.id}` : undefined} />
                <ListRow title="Record sale" subtitle={d.records.recordSale ? `${d.records.recordSale.name}, ${money(d.records.recordSale.fee)}${d.records.recordSale.to ? ` to ${d.records.recordSale.to}` : ''}` : 'None yet'} to={d.records.recordSale ? `/player/${d.records.recordSale.id}` : undefined} />
              </List>
            </Section>
          </>
        )}
      </Q>
    </Screen>
  );
}

void useMemo;
