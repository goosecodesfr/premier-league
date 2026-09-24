// Squad list, training, treatment room and youth academy.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Dumbbell, GraduationCap, HeartPulse, LayoutGrid, List as ListIcon, SlidersHorizontal, Users } from 'lucide-react';
import type { SquadData } from '@ffm/server/routes/squad';
import { api } from '../lib/api';
import { LINE_OF, dateLabel, money, rating1, toneVar, sharpnessTone, conditionTone, wage } from '../lib/format';
import { Badge, Button, Card, Chip, ChipRow, EmptyState, IconButton, List, ListRow, Meter, Q, Screen, Section, Segmented, Select, Sheet, SkeletonList, useToast } from '../components/ui';
import { ConditionMeter, PlayerAvatar, PlayerRow, PosBadge, Sparkline, type PlayerLiteLike } from '../components/domain';
import { useMe } from '../app/session';

type SP = SquadData['players'][number];
type SortKey = 'rating' | 'condition' | 'form' | 'age' | 'value' | 'wage' | 'mins' | 'contract' | 'number';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rating', label: 'Role rating' }, { key: 'condition', label: 'Condition' }, { key: 'form', label: 'Form' }, { key: 'age', label: 'Age' },
  { key: 'value', label: 'Value' }, { key: 'wage', label: 'Wage' }, { key: 'mins', label: 'Minutes played' }, { key: 'contract', label: 'Contract remaining' }, { key: 'number', label: 'Squad number' },
];
const avgForm = (p: SP) => (p.form.length ? p.form.reduce((s, x) => s + x, 0) / p.form.length : 0);

export function useQuickActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [p, setP] = useState<(PlayerLiteLike & { listed?: boolean; rested?: boolean }) | null>(null);
  const rest = useMutation({ mutationFn: (x: { id: number; on: boolean }) => api.post(`/players/${x.id}/rest`, { on: x.on }), onSuccess: (_d, x) => { qc.invalidateQueries(); toast(x.on ? 'He will be rested' : 'Back in contention', 'success'); } });
  const list = useMutation({ mutationFn: (x: { id: number; on: boolean }) => api.post(`/players/${x.id}/list`, { listed: x.on }), onSuccess: (_d, x) => { qc.invalidateQueries(); toast(x.on ? 'Transfer-listed' : 'Removed from the list', 'success'); } });
  const sheet = (
    <Sheet open={!!p} onClose={() => setP(null)} title={p?.name}>
      {p && (
        <List>
          <ListRow title="View profile" onClick={() => { setP(null); nav(`/player/${p.id}`); }} />
          <ListRow title={p.rested ? 'Stop resting him' : 'Rest for the next match'} subtitle="Auto-fill and your assistant will leave him out" onClick={() => { rest.mutate({ id: p.id, on: !p.rested }); setP(null); }} />
          <ListRow title={p.listed ? 'Take off the transfer list' : 'Transfer-list'} subtitle={p.listed ? undefined : 'Bots will see he is available'} onClick={() => { list.mutate({ id: p.id, on: !p.listed }); setP(null); }} />
          <ListRow title="Compare with…" onClick={() => { setP(null); nav(`/player/${p.id}/compare`); }} />
        </List>
      )}
    </Sheet>
  );
  return { open: setP, sheet };
}

export function Squad() {
  const me = useMe();
  const q = useQuery({ queryKey: ['squad'], queryFn: () => api.get<SquadData>('/squad') });
  const [seg, setSeg] = useState<'all' | 'xi' | 'injured' | 'youth'>('all');
  const [sort, setSort] = useState<SortKey>('rating');
  const [lines, setLines] = useState<string[]>([]);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const qa = useQuickActions();
  const rows = useMemo(() => {
    let r = (q.data?.players ?? []).slice();
    if (seg === 'xi') r = r.filter((p) => p.inXI);
    if (seg === 'injured') r = r.filter((p) => p.injury || p.suspended > 0);
    if (seg === 'youth') r = r.filter((p) => p.youth);
    if (lines.length) r = r.filter((p) => lines.includes(LINE_OF[p.best] ?? 'MID'));
    if (expiring) r = r.filter((p) => p.yearsLeft <= 0);
    const k: Record<SortKey, (p: SP) => number> = {
      rating: (p) => -p.rating, condition: (p) => p.condition, form: (p) => -avgForm(p), age: (p) => p.age, value: (p) => -p.value, wage: (p) => -p.wage,
      mins: (p) => -p.mins, contract: (p) => p.contractUntil, number: (p) => p.number ?? 99,
    };
    return r.sort((a, b) => k[sort](a) - k[sort](b));
  }, [q.data, seg, sort, lines, expiring]);
  return (
    <Screen title="Squad" subtitle={q.data ? `${q.data.counts.total} players · ${wage(q.data.wageBill)}` : undefined}
      actions={<>
        <IconButton label="Filter" onClick={() => setFilterOpen(true)} badge={lines.length > 0 || expiring}><SlidersHorizontal size={20} /></IconButton>
        <IconButton label="Sort" onClick={() => setSortOpen(true)}><ArrowUpDown size={20} /></IconButton>
        <IconButton label={view === 'list' ? 'Position grid' : 'List view'} onClick={() => setView(view === 'list' ? 'grid' : 'list')}>{view === 'list' ? <LayoutGrid size={20} /> : <ListIcon size={20} />}</IconButton>
      </>}>
      <Segmented className="mb-3" value={seg} onChange={setSeg} options={[{ value: 'all', label: 'All' }, { value: 'xi', label: 'Selected XI' }, { value: 'injured', label: `Injured${q.data?.counts.injured ? ` (${q.data.counts.injured})` : ''}` }, { value: 'youth', label: 'Youth' }]} />
      <ChipRow className="mb-3">
        <Link to="/squad/training"><Chip><span className="inline-flex items-center gap-1.5"><Dumbbell size={14} /> Training</span></Chip></Link>
        <Link to="/squad/injuries"><Chip><span className="inline-flex items-center gap-1.5"><HeartPulse size={14} /> Treatment room</span></Chip></Link>
        <Link to="/squad/youth"><Chip><span className="inline-flex items-center gap-1.5"><GraduationCap size={14} /> Youth</span></Chip></Link>
        <Link to="/transfers"><Chip><span className="inline-flex items-center gap-1.5"><Users size={14} /> Transfers</span></Chip></Link>
      </ChipRow>
      <Q q={q} skeleton={<SkeletonList rows={10} tall />}>
        {(d) => rows.length === 0 ? <EmptyState icon={<Users size={24} />} title="Nobody here" body="Try a different filter." /> : view === 'list' ? (
          <List>
            {rows.map((p) => (
              <PlayerRow key={p.id} p={p} colors={me.club?.colors} to={`/player/${p.id}`} onLongPress={() => qa.open(p)}
                sub={<>{p.age} · {p.inXI ? <span className="text-accent">XI</span> : p.onBench ? 'Bench' : `#${p.number ?? '-'}`}</>}
                right={<div className="flex items-center gap-3">
                  <ConditionMeter value={p.condition} />
                  <Sparkline values={p.form} />
                  <div className="w-10 text-right font-cond font-bold text-[22px] leading-none tabular">{p.rating.toFixed(1)}</div>
                </div>} />
            ))}
          </List>
        ) : (
          <div className="space-y-4">
            {(['GK', 'DEF', 'MID', 'ATT'] as const).map((line) => {
              const ps = rows.filter((p) => (LINE_OF[p.best] ?? 'MID') === line);
              return (
                <Section key={line} title={`${{ GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', ATT: 'Forwards' }[line]} · ${ps.length}`}>
                  <div className="grid grid-cols-3 gap-2">
                    {ps.map((p) => (
                      <Link key={p.id} to={`/player/${p.id}`} className="rounded-xl border border-subtle bg-surface p-2.5 flex flex-col items-center text-center active:bg-raised">
                        <PlayerAvatar name={p.name} colors={me.club?.colors} size={36} injured={!!p.injury} suspended={p.suspended > 0} />
                        <div className="t-label mt-1.5 truncate w-full">{p.short}</div>
                        <div className="flex items-center gap-1 mt-0.5"><PosBadge pos={p.best} /><span className="font-cond font-bold text-[16px] tabular">{p.rating.toFixed(1)}</span></div>
                        <Meter value={p.condition} tone={conditionTone(p.condition)} className="w-full mt-1.5" />
                      </Link>
                    ))}
                  </div>
                </Section>
              );
            })}
          </div>
        )}
      </Q>
      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        <List>{SORTS.map((s) => <ListRow key={s.key} title={s.label} chevron={false} right={sort === s.key ? <Badge tone="accent">On</Badge> : null} onClick={() => { setSort(s.key); setSortOpen(false); }} />)}</List>
      </Sheet>
      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter" footer={<Button full onClick={() => setFilterOpen(false)}>Show {rows.length} players</Button>}>
        <div className="t-caption text-fg3 mb-2">Position</div>
        <div className="flex flex-wrap gap-2 mb-5">{(['GK', 'DEF', 'MID', 'ATT'] as const).map((l) => <Chip key={l} selected={lines.includes(l)} onClick={() => setLines(lines.includes(l) ? lines.filter((x) => x !== l) : [...lines, l])}>{{ GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', ATT: 'Forwards' }[l]}</Chip>)}</div>
        <div className="t-caption text-fg3 mb-2">Contract</div>
        <Chip selected={expiring} onClick={() => setExpiring(!expiring)}>Expiring this season</Chip>
        <div className="mt-5"><Button variant="ghost" onClick={() => { setLines([]); setExpiring(false); }}>Clear filters</Button></div>
      </Sheet>
      {qa.sheet}
    </Screen>
  );
}

// ---------------------------------------------------------------- training
interface TrainingData {
  training: { focus: string; intensity: 'low' | 'normal' | 'high'; individual: { playerId: number; group: string }[] };
  coach: { name: string; rating: number } | null; fitness: { name: string; rating: number } | null; facilities: number;
  players: (PlayerLiteLike & { group: string | null })[];
}
const FOCUS: { key: string; label: string; desc: string }[] = [
  { key: 'balanced', label: 'Balanced', desc: 'All-round work. The safe default.' },
  { key: 'attacking', label: 'Attacking', desc: 'Finishing, movement and creativity grow a little faster.' },
  { key: 'defensive', label: 'Defensive', desc: 'Tackling, marking and positioning grow a little faster.' },
  { key: 'tactical', label: 'Tactical', desc: 'Your default tactic becomes familiar three times faster.' },
  { key: 'fitness', label: 'Fitness', desc: 'Sharpness holds up better between games; slightly slower recovery.' },
  { key: 'set_pieces', label: 'Set pieces', desc: 'Corners and free kicks get more dangerous.' },
  { key: 'recovery', label: 'Recovery', desc: 'Faster condition recovery in a congested run of games.' },
];

export function Training() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['training'], queryFn: () => api.get<TrainingData>('/club/training') });
  const save = useMutation({
    mutationFn: (b: Partial<TrainingData['training']>) => api.put('/club/training', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['training'] }); toast('Training updated', 'success'); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <Screen title="Training" back>
      <Q q={q}>
        {(d) => (
          <>
            <Section title="Team focus">
              <List>
                {FOCUS.map((f) => (
                  <button key={f.key} type="button" onClick={() => save.mutate({ focus: f.key })} className="w-full text-left flex items-center gap-3 px-4 py-3 active:bg-raised">
                    <span className="h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: d.training.focus === f.key ? 'var(--accent)' : 'var(--border-subtle)' }}>{d.training.focus === f.key && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}</span>
                    <span className="flex-1"><span className="t-strong block">{f.label}</span><span className="t-label text-fg2">{f.desc}</span></span>
                  </button>
                ))}
              </List>
            </Section>
            <Section title="Intensity">
              <Segmented value={d.training.intensity} onChange={(v) => save.mutate({ intensity: v })} options={[{ value: 'low', label: 'Light' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Hard' }]} />
              <div className="t-label text-fg2 mt-2">{d.training.intensity === 'high' ? 'Faster development, slower recovery and more training injuries.' : d.training.intensity === 'low' ? 'Fresher legs and fewer knocks, slower development.' : 'A sensible balance.'}</div>
            </Section>
            <Section title="Staff">
              <Card><div className="t-body">{d.coach ? <>Head of coaching <b>{d.coach.name}</b> ({d.coach.rating}/20)</> : 'No head coach'}</div><div className="t-label text-fg2 mt-1">Training ground tier {d.facilities}. Better staff and facilities mean faster growth.</div></Card>
            </Section>
            <Section title="Individual focus">
              <List>
                {d.players.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2">
                    <PlayerAvatar name={p.name} colors={me.club?.colors} size={32} />
                    <div className="flex-1 min-w-0"><div className="t-body truncate">{p.name}</div><div className="t-label text-fg3">{p.age} · {p.pos.join('/')}</div></div>
                    <Select className="!h-9 !w-[128px] text-[13px]" value={p.group ?? ''} ariaLabel={`Focus for ${p.name}`}
                      onChange={(g) => save.mutate({ individual: [...d.training.individual.filter((x) => x.playerId !== p.id), ...(g ? [{ playerId: p.id, group: g }] : [])] })}
                      options={[{ value: '', label: 'Team plan' }, { value: 'technical', label: 'Technical' }, { value: 'mental', label: 'Mental' }, { value: 'physical', label: 'Physical' }, ...((p.pos.includes('GK') ? [{ value: 'goalkeeping', label: 'Goalkeeping' }] : []))]} />
                  </div>
                ))}
              </List>
            </Section>
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- treatment room
interface InjuriesData {
  physio: { name: string; rating: number } | null; medical: number;
  injured: (PlayerLiteLike & { injuryDetail: { type: string; severity: string; daysLeft: number; daysTotal: number; returnAt: string; progress: number }; note: string })[];
  atRisk: (PlayerLiteLike & { risk: string; advice: string; fatigue: number })[];
  suspended: PlayerLiteLike[];
}
export function Injuries() {
  const me = useMe();
  const q = useQuery({ queryKey: ['injuries'], queryFn: () => api.get<InjuriesData>('/squad/injuries') });
  return (
    <Screen title="Treatment room" back>
      <Q q={q}>
        {(d) => (
          <>
            <Card className="mb-5"><div className="t-body">{d.physio ? <>Head physio <b>{d.physio.name}</b> ({d.physio.rating}/20)</> : 'No physio'} · Medical centre tier {d.medical}</div><div className="t-label text-fg2 mt-1">A better physio and medical centre shorten every lay-off.</div></Card>
            <Section title={`Injured · ${d.injured.length}`}>
              {d.injured.length === 0 ? <Card><div className="t-body text-fg2">Nobody injured. Long may it last.</div></Card> : (
                <List>
                  {d.injured.map((p) => (
                    <Link key={p.id} to={`/player/${p.id}`} className="block px-4 py-3 active:bg-raised">
                      <div className="flex items-center gap-3">
                        <PlayerAvatar name={p.name} colors={me.club?.colors} size={36} injured />
                        <div className="flex-1 min-w-0"><div className="t-strong truncate">{p.name}</div><div className="t-label text-fg2 capitalize">{p.injuryDetail.type} · {p.injuryDetail.severity}</div></div>
                        <div className="text-right"><div className="t-num">{p.injuryDetail.daysLeft}d</div><div className="t-label text-fg3">back {dateLabel(p.injuryDetail.returnAt)}</div></div>
                      </div>
                      <Meter value={p.injuryDetail.progress} tone="positive" className="mt-2" />
                      <div className="t-label text-fg3 mt-1">{p.note}</div>
                    </Link>
                  ))}
                </List>
              )}
            </Section>
            <Section title="Running on empty">
              {d.atRisk.length === 0 ? <Card><div className="t-body text-fg2">Everyone is fresh.</div></Card> : (
                <List>
                  {d.atRisk.map((p) => (
                    <PlayerRow key={p.id} p={p} colors={me.club?.colors} to={`/player/${p.id}`} compact sub={p.advice}
                      right={<div className="text-right"><Badge tone={p.risk === 'high' ? 'negative' : p.risk === 'elevated' ? 'warning' : 'neutral'}>{p.risk}</Badge><div className="t-label text-fg3 mt-1">{p.condition}% · load {p.fatigue}</div></div>} />
                  ))}
                </List>
              )}
            </Section>
            {d.suspended.length > 0 && (
              <Section title="Suspended"><List>{d.suspended.map((p) => <PlayerRow key={p.id} p={p} colors={me.club?.colors} to={`/player/${p.id}`} compact sub={`Banned for ${p.suspended} match${p.suspended > 1 ? 'es' : ''}`} />)}</List></Section>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- youth
interface YouthData { academyTier: number; nextIntake: string; players: (PlayerLiteLike & { minutes: number; scout: { potential: { label: string; lo: number; hi: number }; traits: string[]; confidence: string } })[] }
export function Youth() {
  const me = useMe();
  const q = useQuery({ queryKey: ['youth'], queryFn: () => api.get<YouthData>('/squad/youth') });
  return (
    <Screen title="Youth academy" back>
      <Q q={q}>
        {(d) => (
          <>
            <Card className="mb-5"><div className="t-body">Academy tier {d.academyTier} · New intake: {d.nextIntake.toLowerCase()}</div><div className="t-label text-fg2 mt-1">Minutes make young players grow. Upgrade the academy for better intakes.</div></Card>
            {d.players.length === 0 ? <EmptyState icon={<GraduationCap size={24} />} title="No under-21s" body="Your academy intake arrives at the start of each season." /> : (
              <List>
                {d.players.map((p) => (
                  <PlayerRow key={p.id} p={p} colors={me.club?.colors} to={`/player/${p.id}`} sub={`${p.age} · ${p.minutes} mins this season`}
                    right={<div className="text-right"><div className="t-label text-accent capitalize">{p.scout.potential.label}</div><div className="t-label text-fg3 tabular">{p.scout.potential.lo}-{p.scout.potential.hi}</div></div>} />
                ))}
              </List>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}

void money; void rating1; void toneVar; void sharpnessTone; void SkeletonList;
