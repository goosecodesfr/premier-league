// League tab: table, fixtures, leaderboards, competitions, club profiles, head-to-head and round summaries.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Minus, Swords, Trophy, Users } from 'lucide-react';
import type { CompetitionData, CompetitionsData, ClubProfileData, FixturesData, H2hData, StatsData, TableData } from '@ffm/server/routes/league';
import type { RoundData } from '@ffm/server/routes/matches';
import type { FixtureLite } from '@ffm/server/routes/common';
import { api, qs } from '../lib/api';
import { COMP_COLOR, dayLabel, kickoff, shortDate, timeLabel } from '../lib/format';
import { Badge, Card, Chip, ChipRow, EmptyState, List, Q, Screen, Section, Segmented, Select, SkeletonList, cx } from '../components/ui';
import { ClubCrest, CompBadge, FixtureScore, FormDots, PlayerRow, RatingPill } from '../components/domain';
import { useMe } from '../app/session';

function LeagueNav({ active }: { active: string }) {
  const items = [['table', 'Table', '/league'], ['fixtures', 'Fixtures', '/league/fixtures'], ['stats', 'Stats', '/league/stats'], ['competitions', 'Cups & Europe', '/competitions']];
  return (
    <ChipRow className="mb-3">
      {items.map(([k, l, to]) => <Link key={k} to={to}><Chip selected={active === k}>{l}</Chip></Link>)}
    </ChipRow>
  );
}

// ---------------------------------------------------------------- table
export function LeagueTable() {
  const [params, setParams] = useSearchParams();
  const season = params.get('season');
  const [full, setFull] = useState(false);
  const q = useQuery({ queryKey: ['table', season], queryFn: () => api.get<TableData>(`/league/table${qs({ season })}`), staleTime: 60_000 });
  const zoneColor: Record<string, string> = { ucl: 'var(--info)', uel: 'var(--warning)', rel: 'var(--negative)' };
  return (
    <Screen title="Premier League" subtitle={q.data?.seasons.find((s) => s.no === q.data?.season)?.label}
      actions={q.data && q.data.seasons.length > 1 ? <Select className="!h-9 !w-[110px] text-[13px]" ariaLabel="Season" value={q.data.season} onChange={(v) => setParams({ season: String(v) })} options={q.data.seasons.map((s) => ({ value: s.no, label: s.label }))} /> : undefined}>
      <LeagueNav active="table" />
      <Q q={q} skeleton={<SkeletonList rows={12} />}>
        {(d) => (
          <>
            <div className="flex justify-end mb-2"><Segmented size="sm" className="w-[160px]" value={full ? 'full' : 'short'} onChange={(v) => setFull(v === 'full')} options={[{ value: 'short', label: 'Short' }, { value: 'full', label: 'Full' }]} /></div>
            <div className="rounded-[12px] border border-subtle bg-surface overflow-hidden">
              <div className="flex items-center gap-2 px-3 h-9 t-caption text-fg3 border-b border-subtle">
                <span className="w-6">#</span><span className="flex-1">Club</span>
                {full ? <>{['P', 'W', 'D', 'L', 'GF', 'GA'].map((h) => <span key={h} className="w-6 text-right">{h}</span>)}</> : <><span className="w-7 text-right">P</span><span className="w-[54px] text-center">Form</span></>}
                <span className="w-8 text-right">GD</span><span className="w-8 text-right">Pts</span>
              </div>
              {d.rows.map((r) => (
                <Link key={r.club.id} to={`/club/${r.club.id}`} className={cx('flex items-center gap-2 px-3 h-12 border-b border-subtle last:border-b-0 active:bg-raised', r.me && 'bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]')}
                  style={{ boxShadow: r.zone ? `inset 3px 0 0 ${zoneColor[r.zone]}` : r.me ? 'inset 3px 0 0 var(--accent)' : undefined }}>
                  <span className="w-6 t-num text-fg2">{r.pos}</span>
                  <ClubCrest club={r.club} size={24} />
                  <span className={cx('flex-1 truncate', r.me ? 't-strong' : 't-body')}>{r.club.short}{r.club.human && <span className="ml-1 text-[10px] text-accent font-bold align-top">●</span>}</span>
                  {full ? <>{[r.p, r.w, r.d, r.l, r.gf, r.ga].map((v, i) => <span key={i} className="w-6 text-right t-label tabular text-fg2">{v}</span>)}</> : <><span className="w-7 text-right t-label tabular text-fg2">{r.p}</span><span className="w-[54px] flex justify-center"><FormDots form={r.form.slice(-3)} size={14} /></span></>}
                  <span className="w-8 text-right t-label tabular text-fg2">{r.gd > 0 ? `+${r.gd}` : r.gd}</span>
                  <span className="w-8 text-right t-num">{r.pts}</span>
                </Link>
              ))}
            </div>
            <div className="flex gap-4 t-label text-fg3 mt-3 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-info" /> Champions League</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-warning" /> Europa League</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-negative" /> Bottom three</span>
              <span className="flex items-center gap-1.5"><span className="text-accent">●</span> Human manager</span>
            </div>
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- fixtures
export function FixtureRowLink({ f, highlight }: { f: FixtureLite; highlight?: number | null }) {
  const played = f.status === 'played';
  const mine = highlight && (f.home.id === highlight || f.away.id === highlight);
  return (
    <Link to={played ? `/fixture/${f.id}` : mine ? `/fixture/${f.id}/preview` : `/fixture/${f.id}`} className={cx('flex items-center gap-2 px-3 h-14 active:bg-raised', mine && 'bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]')}>
      <span className="flex-1 flex items-center justify-end gap-2 min-w-0"><span className={cx('truncate', f.winnerId === f.home.id ? 't-strong' : 't-body')}>{f.home.short}</span><ClubCrest club={f.home} size={24} /></span>
      <span className="w-16 text-center">{played ? <FixtureScore score={f.score} pens={f.pens} className="text-[18px]" /> : <span className="t-label text-fg2 tabular">{timeLabel(f.kickoff)}</span>}</span>
      <span className="flex-1 flex items-center gap-2 min-w-0"><ClubCrest club={f.away} size={24} /><span className={cx('truncate', f.winnerId === f.away.id ? 't-strong' : 't-body')}>{f.away.short}</span></span>
    </Link>
  );
}

export function Fixtures() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const mine = params.get('mine') === '1';
  const round = params.get('round');
  const q = useQuery({ queryKey: ['fixtures', mine, round], queryFn: () => api.get<FixturesData>(`/league/fixtures${qs({ mine: mine ? 1 : null, round })}`) });
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => { stripRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [q.data?.round]);
  const groups = useMemo(() => {
    const m = new Map<string, FixtureLite[]>();
    for (const f of q.data?.fixtures ?? []) { const k = dayLabel(f.kickoff); m.set(k, [...(m.get(k) ?? []), f]); }
    return [...m.entries()];
  }, [q.data]);
  return (
    <Screen title="Fixtures and results">
      <LeagueNav active="fixtures" />
      <Segmented className="mb-3" value={mine ? 'mine' : 'league'} onChange={(v) => setParams(v === 'mine' ? { mine: '1' } : {})} options={[{ value: 'league', label: 'Premier League' }, { value: 'mine', label: `${me.club?.short ?? 'My'} (all comps)` }]} />
      <Q q={q} skeleton={<SkeletonList rows={10} />}>
        {(d) => (
          <>
            {d.mode === 'round' && d.rounds.length > 0 && (
              <>
                <div ref={stripRef} className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 mb-3">
                  {d.rounds.map((r) => (
                    <button key={r.round} data-current={r.round === d.round} onClick={() => setParams({ round: String(r.round) })}
                      className={cx('shrink-0 w-11 h-12 rounded-lg flex flex-col items-center justify-center border', r.round === d.round ? 'bg-accent text-on-accent border-transparent' : r.played === r.total ? 'bg-surface border-subtle text-fg2' : 'bg-surface border-subtle')}>
                      <span className="text-[10px] opacity-80">MW</span><span className="t-strong leading-none">{r.round}</span>
                    </button>
                  ))}
                </div>
                {d.round && d.fixtures.some((f) => f.status === 'played') && <Link to={`/round/${d.round}`} className="flex items-center justify-between rounded-xl bg-surface border border-subtle px-4 h-12 mb-3 active:bg-raised"><span className="t-strong">Matchweek {d.round} round-up</span><ChevronRight size={18} className="text-fg3" /></Link>}
              </>
            )}
            {d.fixtures.length === 0 ? <EmptyState icon={<CalendarDays size={24} />} title="No fixtures yet" body="Fixtures appear when the season starts." /> : (
              <div className="space-y-4">
                {groups.map(([day, list]) => (
                  <div key={day}>
                    <div className="t-caption text-fg3 mb-1.5">{day}</div>
                    <List>
                      {list.map((f) => (
                        <div key={f.id}>
                          {d.mode === 'club' && <div className="flex items-center gap-2 px-3 pt-2"><CompBadge comp={f.comp} /><span className="t-label text-fg3">{f.stageLabel}</span></div>}
                          <FixtureRowLink f={f} highlight={me.club?.id} />
                        </div>
                      ))}
                    </List>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- stats
export function Stats() {
  const [comp, setComp] = useState('league');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['stats', comp], queryFn: () => api.get<StatsData>(`/league/stats${qs({ comp })}`), staleTime: 120_000 });
  return (
    <Screen title="Leaderboards">
      <LeagueNav active="stats" />
      <ChipRow className="mb-3">
        {[['league', 'Premier League'], ['all', 'All comps'], ['ucl', 'Champions League'], ['uel', 'Europa League'], ['fa_cup', 'FA Cup'], ['league_cup', 'League Cup']].map(([k, l]) => <Chip key={k} selected={comp === k} onClick={() => setComp(k)}>{l}</Chip>)}
      </ChipRow>
      <Q q={q} skeleton={<SkeletonList rows={8} />}>
        {(d) => d.boards.every((b) => !b.rows.length) ? <EmptyState icon={<Trophy size={24} />} title="No stats yet" body="Leaderboards fill up once matches are played." /> : (
          <div>
            {d.boards.filter((b) => b.rows.length).map((b) => (
              <Section key={b.key} title={b.label} action={b.rows.length > 5 ? <button className="t-label text-accent" onClick={() => setOpen(open === b.key ? null : b.key)}>{open === b.key ? 'Less' : 'Top 10'}</button> : null}>
                <List>
                  {b.rows.slice(0, open === b.key ? 10 : 5).map((r, i) => (
                    <Link key={r.id} to={`/player/${r.id}`} className="flex items-center gap-3 px-4 h-12 active:bg-raised">
                      <span className="w-5 t-num text-fg3">{i + 1}</span>
                      <ClubCrest club={r.club} size={24} />
                      <span className="flex-1 min-w-0"><span className="t-body truncate block">{r.name}</span></span>
                      <span className="t-label text-fg3 tabular">{r.apps} apps</span>
                      <span className="w-10 text-right font-cond font-bold text-[19px] tabular">{b.key === 'rating' ? Number(r.value).toFixed(2) : r.value}</span>
                    </Link>
                  ))}
                </List>
              </Section>
            ))}
          </div>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- competitions
export function Competitions() {
  const q = useQuery({ queryKey: ['competitions'], queryFn: () => api.get<CompetitionsData>('/competitions') });
  return (
    <Screen title="Cups and Europe">
      <LeagueNav active="competitions" />
      <Q q={q} skeleton={<SkeletonList rows={6} />}>
        {(d) => d.competitions.length === 0 ? <EmptyState icon={<Trophy size={24} />} title="Competitions start with the season" /> : (
          <div className="space-y-2">
            {d.competitions.map((c) => (
              <Card key={c.id} to={c.type === 'league' ? '/league' : `/competition/${c.id}`} className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${COMP_COLOR[c.type]} 18%, transparent)`, color: COMP_COLOR[c.type] }}><Trophy size={20} /></div>
                <div className="flex-1 min-w-0">
                  <div className="t-strong">{c.name}</div>
                  <div className="t-label text-fg2 truncate">{c.status === 'done' ? `Won by ${c.winner?.short ?? '?'}` : c.current ?? ''}{c.nextAt ? ` · ${shortDate(c.nextAt)}` : ''}</div>
                </div>
                {c.mine && <Badge tone={c.mine.startsWith('Out') || c.mine === 'Eliminated' ? 'negative' : c.mine === 'Winners' ? 'positive' : 'info'}>{c.mine}</Badge>}
              </Card>
            ))}
          </div>
        )}
      </Q>
    </Screen>
  );
}

export function Competition() {
  const { id } = useParams();
  const me = useMe();
  const q = useQuery({ queryKey: ['competition', Number(id)], queryFn: () => api.get<CompetitionData>(`/competitions/${id}`) });
  const [view, setView] = useState<'groups' | 'knockout'>('groups');
  return (
    <Screen title={q.data?.name ?? 'Competition'} back subtitle={q.data?.winner ? `Winners: ${q.data.winner.name}` : undefined}>
      <Q q={q} skeleton={<SkeletonList rows={8} />}>
        {(d) => {
          const hasGroups = d.groups.length > 0;
          const v = hasGroups ? view : 'knockout';
          return (
            <>
              {hasGroups && <Segmented className="mb-4" value={view} onChange={setView} options={[{ value: 'groups', label: 'Groups' }, { value: 'knockout', label: 'Knockouts' }]} />}
              {v === 'groups' ? (
                <div className="space-y-4">
                  {d.groups.map((g) => (
                    <Section key={g.letter} title={`Group ${g.letter}`}>
                      <div className="rounded-[12px] border border-subtle bg-surface overflow-hidden">
                        {g.rows.map((r) => (
                          <Link key={r.club.id} to={`/club/${r.club.id}`} className={cx('flex items-center gap-2 px-3 h-11 border-b border-subtle last:border-0', r.club.id === me.club?.id && 'bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]')} style={r.qualifies ? { boxShadow: 'inset 3px 0 0 var(--positive)' } : undefined}>
                            <span className="w-4 t-num text-fg2">{r.pos}</span><ClubCrest club={r.club} size={22} /><span className="flex-1 truncate t-body">{r.club.short}</span>
                            <span className="w-6 text-right t-label text-fg2 tabular">{r.p}</span><span className="w-8 text-right t-label text-fg2 tabular">{r.gd > 0 ? `+${r.gd}` : r.gd}</span><span className="w-7 text-right t-num">{r.pts}</span>
                          </Link>
                        ))}
                      </div>
                    </Section>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {d.rounds.length === 0 && <EmptyState icon={<Swords size={24} />} title="The draw has not been made yet" />}
                  {d.rounds.map((r) => (
                    <Section key={r.stage} title={`${r.label}${r.date ? ` · ${shortDate(r.date)}` : ''}`}>
                      {r.ties.length === 0 ? <Card><div className="t-label text-fg3">Draw to come</div></Card> : (
                        <List>
                          {r.ties.map((t) => (
                            <div key={t.key} className="px-3 py-2">
                              {t.legs.map((l) => <FixtureRowLink key={l.id} f={l} highlight={me.club?.id} />)}
                              {t.agg && <div className="t-label text-fg3 text-center pb-1">Aggregate {t.agg[0]}-{t.agg[1]}{t.winnerId ? ` · ${t.winnerId === t.home?.id ? t.home?.short : t.away?.short} go through` : ''}</div>}
                            </div>
                          ))}
                        </List>
                      )}
                    </Section>
                  ))}
                </div>
              )}
            </>
          );
        }}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- club profile
export function ClubProfile() {
  const { id } = useParams();
  const me = useMe();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['club', Number(id)], queryFn: () => api.get<ClubProfileData>(`/clubs/${id}`) });
  const [tab, setTab] = useState<'overview' | 'squad'>('overview');
  return (
    <Screen title={q.data?.club.name ?? 'Club'} back>
      <Q q={q} skeleton={<SkeletonList rows={8} />}>
        {(d) => (
          <>
            <Card className="mb-4 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${d.club.colors[0]} 30%, transparent), transparent 65%)` }} />
              <div className="relative flex items-center gap-4">
                <ClubCrest club={d.club} size={64} />
                <div className="min-w-0 flex-1">
                  <div className="t-title2">{d.club.name}</div>
                  <div className="t-label text-fg2">{d.stadium} · {d.capacity.toLocaleString()}</div>
                  <div className="t-label text-fg2">{d.position ? `${d.position}${['th', 'st', 'nd', 'rd'][d.position % 10 > 3 || Math.floor(d.position / 10) === 1 ? 0 : d.position % 10]} in the league` : d.club.league === 'PL' ? 'Premier League' : d.club.league === 'EUR' ? 'European club' : 'Championship'}</div>
                </div>
              </div>
              <div className="relative mt-3 rounded-xl bg-raised p-3">
                <div className="t-caption text-fg3">Manager</div>
                <div className="t-strong">{d.manager.name}{d.manager.human && <Badge tone="accent" className="ml-2">Human</Badge>}</div>
                {d.manager.style && <div className="t-label text-fg2">{d.manager.style}{d.manager.desc ? ` - ${d.manager.desc}` : ''}</div>}
                {d.usualShape && <div className="t-label text-fg3 mt-1">Usually plays {d.usualShape}</div>}
              </div>
              {!d.isMine && me.club && <button onClick={() => nav(`/h2h/${me.club!.id}/${d.club.id}`)} className="relative mt-3 w-full h-11 rounded-xl border border-subtle t-strong flex items-center justify-center gap-2"><Swords size={16} /> Head-to-head with {me.club.short}</button>}
            </Card>
            <Segmented className="mb-4" value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'squad', label: `Squad (${d.squad.length})` }]} />
            {tab === 'overview' ? (
              <>
                {d.upcoming.length > 0 && <Section title="Next up"><List>{d.upcoming.map((f) => <div key={f.id}><div className="flex items-center gap-2 px-3 pt-2"><CompBadge comp={f.comp} /><span className="t-label text-fg3">{kickoff(f.kickoff)}</span></div><FixtureRowLink f={f} highlight={me.club?.id} /></div>)}</List></Section>}
                {d.recent.length > 0 && <Section title="Recent results"><List>{d.recent.map((f) => <div key={f.id}><div className="flex items-center gap-2 px-3 pt-2"><CompBadge comp={f.comp} /><span className="t-label text-fg3">{shortDate(f.kickoff)}</span></div><FixtureRowLink f={f} highlight={me.club?.id} /></div>)}</List></Section>}
                <Section title="Honours">
                  {d.honours.filter((h) => h.place === 'winner').length === 0 ? <Card><div className="t-label text-fg3">No trophies in this league yet.</div></Card> : (
                    <List>{d.honours.filter((h) => h.place === 'winner').map((h, i) => <div key={i} className="flex items-center gap-3 px-4 h-12"><Trophy size={16} className="text-warning" /><span className="flex-1 t-body">{h.name}</span><span className="t-label text-fg3">Season {h.season_no}</span></div>)}</List>
                  )}
                </Section>
              </>
            ) : (
              <List>
                {d.squad.map((p) => <PlayerRow key={p.id} p={p} colors={d.club.colors} to={`/player/${p.id}`} right={<span className="font-cond font-bold text-[20px] tabular">{p.ovr.toFixed(1)}</span>} />)}
              </List>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- head-to-head
export function HeadToHead() {
  const { a, b } = useParams();
  const me = useMe();
  const q = useQuery({ queryKey: ['h2h', a, b], queryFn: () => api.get<H2hData>(`/h2h/${a}/${b}`) });
  return (
    <Screen title="Head-to-head" back>
      <Q q={q}>
        {(d) => (
          <>
            <Card className="mb-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col items-center flex-1"><ClubCrest club={d.a} size={52} /><span className="t-strong mt-1">{d.a.short}</span></div>
                <div className="text-center"><div className="t-caption text-fg3">{d.played} meetings</div><div className="t-display-sm tabular">{d.aWins} - {d.draws} - {d.bWins}</div><div className="t-label text-fg3">W - D - W</div></div>
                <div className="flex flex-col items-center flex-1"><ClubCrest club={d.b} size={52} /><span className="t-strong mt-1">{d.b.short}</span></div>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden mt-4 gap-[2px]">
                <div style={{ width: `${(d.aWins / Math.max(1, d.played)) * 100}%`, background: 'var(--accent)' }} />
                <div style={{ width: `${(d.draws / Math.max(1, d.played)) * 100}%`, background: 'var(--text-tertiary)' }} />
                <div className="flex-1 bg-fg2" />
              </div>
              <div className="flex justify-between t-label text-fg2 mt-2"><span>{d.aGoals} goals</span><span>{d.bGoals} goals</span></div>
            </Card>
            {(d.biggestA || d.biggestB) && (
              <Section title="Biggest wins">
                <List>
                  {d.biggestA && <FixtureRowLink f={d.biggestA} highlight={me.club?.id} />}
                  {d.biggestB && <FixtureRowLink f={d.biggestB} highlight={me.club?.id} />}
                </List>
              </Section>
            )}
            <Section title="All meetings">
              {d.meetings.length === 0 ? <EmptyState icon={<Swords size={24} />} title="They have never met" body="Their first meeting will be recorded here." /> : (
                <List>{d.meetings.map((f) => <div key={f.id}><div className="flex items-center gap-2 px-3 pt-2"><CompBadge comp={f.comp} /><span className="t-label text-fg3">{shortDate(f.kickoff)} · {f.stageLabel}</span></div><FixtureRowLink f={f} highlight={me.club?.id} /></div>)}</List>
              )}
            </Section>
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- round summary
export function Round() {
  const { n } = useParams();
  const me = useMe();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['round', Number(n)], queryFn: () => api.get<RoundData>(`/rounds/${n}`) });
  return (
    <Screen title={`Matchweek ${n}`} back actions={q.data ? <div className="flex gap-1">
      <button className="h-9 px-2 t-label text-accent disabled:text-fg3" disabled={Number(n) <= 1} onClick={() => nav(`/round/${Number(n) - 1}`, { replace: true })}>Prev</button>
      <button className="h-9 px-2 t-label text-accent disabled:text-fg3" disabled={Number(n) >= q.data.rounds} onClick={() => nav(`/round/${Number(n) + 1}`, { replace: true })}>Next</button>
    </div> : undefined}>
      <Q q={q}>
        {(d) => (
          <>
            {d.star && (
              <Card to={`/player/${d.star.id}`} className="mb-3 flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning flex items-center justify-center"><Users size={20} /></div>
                <div className="flex-1 min-w-0"><div className="t-caption text-fg3">Player of the round</div><div className="t-strong truncate">{d.star.name}</div><div className="t-label text-fg2">{d.star.club.short}{d.star.goals ? ` · ${d.star.goals} goal${d.star.goals > 1 ? 's' : ''}` : ''}{d.star.assists ? ` · ${d.star.assists} assist${d.star.assists > 1 ? 's' : ''}` : ''}</div></div>
                <RatingPill rating={d.star.rating} />
              </Card>
            )}
            {d.upset && <Card to={`/fixture/${d.upset.id}`} className="mb-3"><div className="t-caption text-fg3">Upset of the round</div><div className="t-strong">{d.upset.home.short} {d.upset.score?.[0]}-{d.upset.score?.[1]} {d.upset.away.short}</div></Card>}
            <Section title="Results"><List>{d.results.map((f) => <FixtureRowLink key={f.id} f={f} highlight={me.club?.id} />)}</List></Section>
            <Section title="Table after the round">
              <div className="rounded-[12px] border border-subtle bg-surface overflow-hidden">
                {d.table.map((r) => (
                  <Link key={r.club.id} to={`/club/${r.club.id}`} className={cx('flex items-center gap-2 px-3 h-11 border-b border-subtle last:border-0', r.club.id === me.club?.id && 'bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]')}>
                    <span className="w-5 t-num text-fg2">{r.pos}</span>
                    <span className="w-5">{r.move > 0 ? <ArrowUp size={14} className="text-positive" /> : r.move < 0 ? <ArrowDown size={14} className="text-negative" /> : <Minus size={12} className="text-fg3" />}</span>
                    <ClubCrest club={r.club} size={22} /><span className="flex-1 truncate t-body">{r.club.short}</span>
                    <span className="w-8 text-right t-label text-fg2 tabular">{r.gd > 0 ? `+${r.gd}` : r.gd}</span><span className="w-7 text-right t-num">{r.pts}</span>
                  </Link>
                ))}
              </div>
            </Section>
          </>
        )}
      </Q>
    </Screen>
  );
}
