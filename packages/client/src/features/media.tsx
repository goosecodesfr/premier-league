// News feed, articles, the media gallery (shareable cards) and the season review.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Award, Newspaper, Pin, Share2, Swords, Trophy } from 'lucide-react';
import type { GalleryData, NewsData, SeasonReviewData } from '@ffm/server/routes/home';
import { api, qs } from '../lib/api';
import { COMP_COLOR, ago, money, ordinal, shortDate } from '../lib/format';
import { onColor } from '../lib/color';
import { shareOrDownload } from '../lib/device';
import { Badge, Button, Card, Chip, ChipRow, EmptyState, List, Q, Screen, Section, Select, SkeletonCards, cx, useToast } from '../components/ui';
import { ClubCrest, CompBadge } from '../components/domain';
import { useMe } from '../app/session';

// ---------------------------------------------------------------- news
const TYPES: [string, string][] = [['all', 'All'], ['mine', 'Your club'], ['transfers', 'Transfers'], ['matches', 'Matches'], ['injury', 'Injuries'], ['managers', 'Managers']];

export function News() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? 'all';
  const q = useInfiniteQuery({
    queryKey: ['news', type],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<NewsData>(`/news${qs({ before: pageParam || null, type: type === 'all' || type === 'mine' ? null : type, mine: type === 'mine' ? 1 : null })}`),
    getNextPageParam: (last) => (last.more && last.items.length ? last.items[last.items.length - 1].id : undefined),
  });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Screen title="News" back="/club" actions={<Link to="/media/gallery" className="t-label text-accent px-2">Gallery</Link>}>
      <ChipRow className="mb-3">{TYPES.map(([k, l]) => <Chip key={k} selected={type === k} onClick={() => setParams(k === 'all' ? {} : { type: k })}>{l}</Chip>)}</ChipRow>
      {q.isPending ? <SkeletonCards n={5} h={90} /> : (
        <>
          {first?.pinned && (
            <Card to={`/media/${first.pinned.id}`} className="mb-3 !border-accent relative overflow-hidden">
              <div className="flex items-center gap-2 t-caption text-accent mb-1"><Pin size={13} /> Weekly digest · {shortDate(first.pinned.at)}</div>
              <div className="t-title2">{first.pinned.headline}</div>
              <div className="t-body text-fg2 mt-1 line-clamp-4 whitespace-pre-line">{first.pinned.body}</div>
            </Card>
          )}
          {items.length === 0 ? <EmptyState icon={<Newspaper size={24} />} title="No news yet" body="Stories appear as the league plays out." /> : (
            <div className="space-y-2">
              {items.map((n) => (
                <Card key={n.id} to={`/media/${n.id}`} className={cx(n.mine && '!border-accent/60')} style={n.mine ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
                  <div className="flex items-center gap-2 t-caption text-fg3"><span className={cx(n.mine && 'text-accent')}>{n.mine ? 'Your club' : n.source}</span><span>·</span><span>{ago(n.at)}</span>{n.importance >= 3 && <Badge tone="warning" className="ml-auto">Big story</Badge>}</div>
                  <div className="t-strong mt-1">{n.headline}</div>
                  {n.body && <div className="t-label text-fg2 mt-0.5 line-clamp-2">{n.body}</div>}
                </Card>
              ))}
              {q.hasNextPage && <Button full variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button>}
            </div>
          )}
        </>
      )}
    </Screen>
  );
}

export function Article() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['article', Number(id)], queryFn: () => api.get<{ id: number; at: string; source: string; headline: string; body: string; clubs: { id: number; key: string; short: string; colors: [string, string]; name: string }[]; link: string | null }>(`/news/${id}`) });
  return (
    <Screen title="News" back="/media">
      <Q q={q}>
        {(d) => (
          <article>
            <div className="t-caption text-fg3">{d.source} · {ago(d.at)}</div>
            <h1 className="t-title1 mt-1">{d.headline}</h1>
            <div className="t-body text-fg2 mt-3 whitespace-pre-line leading-relaxed">{d.body}</div>
            {d.clubs.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-5">
                {d.clubs.map((c) => <Link key={c.id} to={`/club/${c.id}`} className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full bg-surface border border-subtle"><ClubCrest club={c} size={26} /><span className="t-label">{c.short}</span></Link>)}
              </div>
            )}
          </article>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- gallery
async function matchCardImage(c: GalleryData['matchCards'][number]): Promise<Blob | null> {
  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0B0E11'; g.fillRect(0, 0, W, H);
  g.fillStyle = COMP_COLOR[c.comp] ?? '#8B5CF6'; g.fillRect(0, 0, W, 24);
  g.textAlign = 'center';
  g.fillStyle = '#9AA7B4'; g.font = '600 38px Inter, sans-serif'; g.fillText(`${c.compName} · ${c.stageLabel}`.toUpperCase(), W / 2, 120);
  const crest = (x: number, club: typeof c.home) => { g.fillStyle = club.colors[0]; g.beginPath(); g.roundRect(x - 110, 200, 220, 220, 60); g.fill(); g.fillStyle = onColor(club.colors[0]); g.font = '700 86px "Barlow Condensed", sans-serif'; g.fillText(club.key, x, 340); g.fillStyle = '#F2F5F7'; g.font = '600 46px Inter, sans-serif'; g.fillText(club.short, x, 480); };
  crest(240, c.home); crest(840, c.away);
  g.fillStyle = '#F2F5F7'; g.font = '700 210px "Barlow Condensed", sans-serif'; g.fillText(`${c.score?.[0]}-${c.score?.[1]}`, W / 2, 380);
  g.font = '500 36px Inter, sans-serif'; g.fillStyle = '#9AA7B4';
  c.scorers[0].slice(0, 6).forEach((s, i) => g.fillText(s, 240, 570 + i * 50));
  c.scorers[1].slice(0, 6).forEach((s, i) => g.fillText(s, 840, 570 + i * 50));
  g.fillStyle = '#64717E'; g.font = '500 32px Inter, sans-serif'; g.fillText(shortDate(c.kickoff), W / 2, 1020);
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}

export function Gallery() {
  const me = useMe();
  const toast = useToast();
  const [season, setSeason] = useState<number | null>(null);
  const [kind, setKind] = useState<'all' | 'matches' | 'milestones' | 'seasons' | 'rivals'>('all');
  const q = useQuery({ queryKey: ['gallery', season], queryFn: () => api.get<GalleryData>(`/gallery${qs({ season })}`) });
  const share = async (c: GalleryData['matchCards'][number]) => { const b = await matchCardImage(c); if (b) { const r = await shareOrDownload(b, `${c.home.key}-${c.away.key}.png`); if (r === 'downloaded') toast('Image saved', 'success'); } };
  return (
    <Screen title="Media gallery" back="/media" actions={q.data && q.data.seasons.length > 1 ? <Select className="!h-9 !w-[120px] text-[13px]" ariaLabel="Season" value={season ?? 0} onChange={(v) => setSeason(Number(v) || null)} options={[{ value: 0, label: 'All seasons' }, ...q.data.seasons.map((s) => ({ value: s.no, label: s.label }))]} /> : undefined}>
      <ChipRow className="mb-3">{([['all', 'All'], ['matches', 'Matches'], ['milestones', 'Milestones'], ['seasons', 'Seasons'], ['rivals', 'Rivals']] as const).map(([k, l]) => <Chip key={k} selected={kind === k} onClick={() => setKind(k)}>{l}</Chip>)}</ChipRow>
      <Q q={q} skeleton={<SkeletonCards n={4} h={150} />}>
        {(d) => (
          <>
            {(kind === 'all' || kind === 'seasons') && d.posters.length > 0 && (
              <Section title="Season posters">
                <div className="grid grid-cols-2 gap-2">
                  {d.posters.map((p) => (
                    <Link key={p.season} to={`/season/review?season=${p.season}`} className="rounded-[12px] p-4 border border-subtle relative overflow-hidden aspect-[3/4] flex flex-col justify-between" style={{ background: `linear-gradient(160deg, color-mix(in srgb, var(--accent) 40%, #0B0E11), #0B0E11 75%)` }}>
                      <div className="t-caption text-fg2">{p.label}</div>
                      <div><div className="font-cond font-bold text-[48px] leading-none">{p.pos ? ordinal(p.pos) : '-'}</div><div className="t-label text-fg2">{p.pts ?? 0} pts · {p.record}</div></div>
                      <div className="t-label">{p.trophies.length ? p.trophies.map((t) => `🏆 ${t}`).join('\n') : p.topScorer ? `${p.topScorer.name}, ${p.topScorer.goals} goals` : ''}</div>
                    </Link>
                  ))}
                </div>
              </Section>
            )}
            {(kind === 'all' || kind === 'rivals') && d.h2h.length > 0 && (
              <Section title="Against your friends">
                <div className="grid grid-cols-2 gap-2">
                  {d.h2h.map((h) => (
                    <Link key={h.opponent.id} to={`/h2h/${d.club.id}/${h.opponent.id}`} className="rounded-[12px] border border-subtle bg-surface p-3">
                      <div className="flex items-center gap-2"><ClubCrest club={d.club} size={26} /><Swords size={14} className="text-fg3" /><ClubCrest club={h.opponent} size={26} /></div>
                      <div className="t-strong mt-2 truncate">vs {h.opponent.managerName ?? h.opponent.short}</div>
                      <div className="font-cond font-bold text-[26px] tabular">{h.w}-{h.d}-{h.l}</div>
                      <div className="t-label text-fg3">{h.p} games · {h.gf}-{h.ga} goals</div>
                    </Link>
                  ))}
                </div>
              </Section>
            )}
            {(kind === 'all' || kind === 'milestones') && d.milestones.length > 0 && (
              <Section title="Milestones">
                <div className="grid grid-cols-2 gap-2">
                  {d.milestones.map((m, i) => {
                    const icon = m.kind === 'trophy' ? <Trophy size={22} className="text-warning" /> : m.kind === 'thrashing' ? <Award size={22} className="text-positive" /> : m.kind === 'humbling' ? <Award size={22} className="text-negative" /> : <Newspaper size={22} className="text-info" />;
                    const inner = <><div>{icon}</div><div className="t-strong mt-2 leading-snug">{m.title}</div><div className="t-label text-fg3 mt-0.5">{m.sub} · S{m.season}</div></>;
                    return 'fixtureId' in m && m.fixtureId ? <Link key={i} to={`/fixture/${m.fixtureId}`} className="rounded-[12px] border border-subtle bg-surface p-3">{inner}</Link> : <div key={i} className="rounded-[12px] border border-subtle bg-surface p-3">{inner}</div>;
                  })}
                </div>
              </Section>
            )}
            {(kind === 'all' || kind === 'matches') && (
              <Section title="Match cards">
                {d.matchCards.length === 0 ? <EmptyState icon={<Trophy size={24} />} title="No matches yet" body="Every result becomes a card here." /> : (
                  <div className="grid grid-cols-2 gap-2">
                    {d.matchCards.map((c) => {
                      const mine = c.home.id === me.club?.id ? 0 : 1;
                      const res = c.score ? (c.score[mine] > c.score[1 - mine] ? 'W' : c.score[mine] < c.score[1 - mine] ? 'L' : 'D') : '-';
                      return (
                        <div key={c.id} className="rounded-[12px] border border-subtle bg-surface overflow-hidden">
                          <div className="h-1.5" style={{ background: COMP_COLOR[c.comp] }} />
                          <Link to={`/fixture/${c.id}`} className="block p-3">
                            <div className="flex items-center justify-between"><CompBadge comp={c.comp} /><span className={cx('text-[11px] font-bold', res === 'W' ? 'text-positive' : res === 'L' ? 'text-negative' : 'text-fg3')}>{res}</span></div>
                            <div className="flex items-center justify-between mt-2"><ClubCrest club={c.home} size={28} /><span className="font-cond font-bold text-[26px] tabular">{c.score?.[0]}-{c.score?.[1]}</span><ClubCrest club={c.away} size={28} /></div>
                            <div className="t-label text-fg3 mt-1 truncate">{[...c.scorers[0], ...c.scorers[1]].join(', ') || 'No goals'}</div>
                            <div className="text-[11px] text-fg3">{shortDate(c.kickoff)}</div>
                          </Link>
                          <button className="w-full h-9 border-t border-subtle t-label text-fg2 flex items-center justify-center gap-1.5 active:bg-raised" onClick={() => share(c)}><Share2 size={13} /> Share</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            )}
          </>
        )}
      </Q>
    </Screen>
  );
}

// ---------------------------------------------------------------- season review
export function SeasonReview() {
  const [params] = useSearchParams();
  const season = params.get('season');
  const q = useQuery({ queryKey: ['review', season], queryFn: () => api.get<SeasonReviewData>(`/season/review${qs({ season })}`) });
  return (
    <Screen title="Season review" back>
      <Q q={q} skeleton={<SkeletonCards n={4} h={130} />}>
        {(d) => {
          const aw = d.awards as Record<string, { name?: string; club?: string; goals?: number; avg?: number; cs?: number; player_id?: number; pos?: number } | null>;
          return (
            <>
              <div className="t-caption text-fg3">{d.label}</div>
              {d.mine && (
                <Card className="mt-2 mb-4 relative overflow-hidden">
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, var(--accent) 25%, transparent), transparent 60%)' }} />
                  <div className="relative">
                    <div className="flex items-center gap-3"><ClubCrest club={d.mine.club} size={48} /><div><div className="t-title2">{d.mine.club.name}</div><div className="t-label text-fg2">{d.mine.row ? `${ordinal(d.mine.row.pos)} · ${d.mine.row.pts} points · ${d.mine.row.w}W ${d.mine.row.d}D ${d.mine.row.l}L` : 'Not in the league this season'}</div></div></div>
                    {d.mine.trophies.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{d.mine.trophies.map((t) => <Badge key={t} tone="warning">🏆 {t}</Badge>)}</div>}
                    {d.mine.best && <div className="t-body mt-3">Player of your season: <Link to={`/player/${d.mine.best.id}`} className="font-semibold">{d.mine.best.name}</Link> ({d.mine.best.rating.toFixed(2)} average)</div>}
                    {d.mine.scorers[0] && d.mine.scorers[0].goals > 0 && <div className="t-body">Top scorer: {d.mine.scorers[0].name}, {d.mine.scorers[0].goals} goals</div>}
                    {d.mine.money && <div className="t-label text-fg2 mt-2">Spent {money(Number(d.mine.money.fees))} on fees, raised {money(Number(d.mine.money.sales))} from sales.</div>}
                  </div>
                </Card>
              )}
              {d.mine && d.mine.vision.length > 0 && (
                <Section title="Your vision, judged">
                  <List>{d.mine.vision.map((g, i) => <div key={i} className="flex items-center gap-3 px-4 min-h-12 py-2"><span className={cx('text-lg', g.done ? 'text-positive' : 'text-negative')}>{g.done ? '✓' : '✗'}</span><span className="flex-1 t-body">{g.label}</span><span className="t-label text-fg3">{g.status}</span></div>)}</List>
                </Section>
              )}
              <Section title="Awards">
                <List>
                  {aw.topScorer && <div className="px-4 py-3"><div className="t-caption text-fg3">Golden Boot</div><div className="t-strong">{aw.topScorer.name} ({aw.topScorer.club}) · {aw.topScorer.goals} goals</div></div>}
                  {aw.bestPlayer && <div className="px-4 py-3"><div className="t-caption text-fg3">Player of the season</div><div className="t-strong">{aw.bestPlayer.name} ({aw.bestPlayer.club}) · {aw.bestPlayer.avg?.toFixed(2)}</div></div>}
                  {aw.young && <div className="px-4 py-3"><div className="t-caption text-fg3">Young player of the season</div><div className="t-strong">{aw.young.name} ({aw.young.club})</div></div>}
                  {aw.glove && <div className="px-4 py-3"><div className="t-caption text-fg3">Golden Glove</div><div className="t-strong">{aw.glove.name} ({aw.glove.club}) · {aw.glove.cs} clean sheets</div></div>}
                  {aw.manager && <div className="px-4 py-3"><div className="t-caption text-fg3">Manager of the season</div><div className="t-strong">{aw.manager.name === 'human' ? `${aw.manager.club}'s manager` : aw.manager.name} ({aw.manager.club}) · finished {ordinal(aw.manager.pos ?? 0)}</div></div>}
                </List>
              </Section>
              <Section title="Trophies">
                <List>{d.cups.map((c) => <div key={c.type} className="flex items-center gap-3 px-4 h-12"><CompBadge comp={c.type} /><span className="flex-1 t-body">{c.name}</span><span className="t-strong">{c.winner?.short ?? '-'}</span></div>)}</List>
              </Section>
              <Section title="Final table">
                <div className="rounded-[12px] border border-subtle bg-surface overflow-hidden">
                  {d.table.map((r) => (
                    <div key={r.clubId} className={cx('flex items-center gap-2 px-3 h-10 border-b border-subtle last:border-0', r.clubId === d.mine?.club.id && 'bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]')}>
                      <span className="w-5 t-num text-fg2">{r.pos}</span><ClubCrest club={r.club ?? null} size={20} /><span className="flex-1 truncate t-body">{r.club?.short}</span>
                      <span className="w-14 text-right t-label text-fg2 tabular">{r.gf}-{r.ga}</span><span className="w-8 text-right t-num">{r.pts}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          );
        }}
      </Q>
    </Screen>
  );
}
