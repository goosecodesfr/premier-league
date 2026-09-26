// The Guide: how to play, tactics and transfers explained, and a searchable dictionary of every term.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ArrowRight, BookOpen, Building2, CalendarClock, Cpu, Crosshair, Dumbbell, EyeOff, Hand, House, LayoutGrid, Megaphone, Route,
  Search as SearchIcon, Shield, Shirt, Sparkles, Telescope, Trophy, Users, X, Zap, type LucideIcon,
} from 'lucide-react';
import { PRESETS } from '@ffm/engine';
import { Badge, Card, Chip, ChipRow, Screen, Section, Tabs, cx, inputCls } from '../components/ui';
import {
  CAT_LABEL, DUTIES, FIRST_DAY, FIT_LEVELS, GLOSSARY, GLOSSARY_CATS, IN_A_NUTSHELL, MATCHDAY, PRIVATE_PUBLIC, TABS, TACTIC_LAYERS,
  TEAM_INSTRUCTIONS, TIPS, TRANSFER_STEPS, searchGlossary, type GuideCat, type Step, type Term,
} from './guide-content';

type TabKey = 'play' | 'tactics' | 'transfers' | 'words';

export function Guide() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'play') as TabKey;
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <Screen title="Guide" back noPad
      header={<Tabs value={tab} onChange={(t) => set({ tab: t, q: null, cat: null })} tabs={[
        { value: 'play', label: 'How to play' }, { value: 'tactics', label: 'Tactics' }, { value: 'transfers', label: 'Transfers' }, { value: 'words', label: 'Dictionary' },
      ]} />}>
      <div className="px-4 pt-4 pb-10">
        {tab === 'play' && <HowToPlay goWords={() => set({ tab: 'words' })} />}
        {tab === 'tactics' && <TacticsGuide />}
        {tab === 'transfers' && <TransfersGuide />}
        {tab === 'words' && <Dictionary q={params.get('q') ?? ''} cat={(params.get('cat') as GuideCat | null) ?? null} set={set} />}
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------- shared bits
function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-[var(--border-subtle)]" aria-hidden />}
          <span className="relative z-[1] h-[27px] w-[27px] shrink-0 rounded-full bg-accent text-on-accent flex items-center justify-center font-cond font-bold text-[15px]">{i + 1}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="t-strong">{s.title}</div>
            <div className="t-body text-fg2 mt-0.5">{s.body}</div>
            {s.where && (s.to
              ? <Link to={s.to} className="inline-flex items-center gap-1 mt-1.5 t-label text-accent">{s.where}<ArrowRight size={13} /></Link>
              : <div className="mt-1.5 t-label text-fg3">{s.where}</div>)}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="t-body text-fg2 mb-3">{children}</p>;
}

// ---------------------------------------------------------------- how to play
const NUTSHELL_ICON: LucideIcon[] = [Shirt, CalendarClock, Cpu, Trophy];
const TAB_ICON: Record<string, LucideIcon> = { Home: House, Squad: Users, Tactics: LayoutGrid, League: Trophy, Club: Building2 };

function HowToPlay({ goWords }: { goWords: () => void }) {
  return (
    <>
      <Section title="The game in a minute">
        <div className="grid gap-2">
          {IN_A_NUTSHELL.map((s, i) => {
            const I = NUTSHELL_ICON[i] ?? Sparkles;
            return (
              <Card key={s.title}>
                <div className="flex gap-3">
                  <span className="h-10 w-10 shrink-0 rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent flex items-center justify-center"><I size={20} /></span>
                  <div className="min-w-0"><div className="t-strong">{s.title}</div><div className="t-body text-fg2 mt-0.5">{s.body}</div></div>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>
      <Section title="Your first day"><Card><Steps steps={FIRST_DAY} /></Card></Section>
      <Section title="Every matchday"><Card><Steps steps={MATCHDAY} /></Card></Section>
      <Section title="Where things are">
        <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle">
          {TABS.map((t) => {
            const I = TAB_ICON[t.tab] ?? House;
            return (
              <Link key={t.tab} to={t.to} className="flex items-center gap-3 px-4 py-3 active:bg-raised">
                <I size={20} className="text-fg2 shrink-0" />
                <div className="min-w-0 flex-1"><div className="t-strong">{t.tab}</div><div className="t-label text-fg2">{t.body}</div></div>
              </Link>
            );
          })}
        </div>
      </Section>
      <Section title="Five habits that win leagues">
        <Card className="bg-[color-mix(in_srgb,var(--warning)_8%,var(--bg-surface))]">
          <ul className="grid gap-2">
            {TIPS.map((t) => <li key={t} className="flex gap-2 t-body"><Sparkles size={16} className="text-warning shrink-0 mt-1" />{t}</li>)}
          </ul>
        </Card>
      </Section>
      <button type="button" onClick={goWords} className="w-full rounded-[12px] border border-subtle bg-surface p-4 flex items-center gap-3 text-left active:bg-raised">
        <BookOpen size={22} className="text-accent shrink-0" />
        <div className="flex-1"><div className="t-strong">Don't know a word?</div><div className="t-label text-fg2">The dictionary explains every football term, role, trait and number in the app.</div></div>
        <ArrowRight size={18} className="text-fg3" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------- tactics
const SPOTS: Record<string, [number, number]> = {
  ST: [50, 9], AML: [14, 24], AMC: [50, 26], AMR: [86, 24], ML: [14, 43], MC: [50, 43], MR: [86, 43],
  WBL: [12, 60], DM: [50, 60], WBR: [88, 60], DL: [14, 76], DC: [50, 78], DR: [86, 76], GK: [50, 93],
};
const DUTY_ARROW: Record<string, string> = { D: '▾', S: '▸', A: '▴' };

function PositionPitch() {
  const pos = GLOSSARY.filter((t) => t.cat === 'positions');
  const [sel, setSel] = useState('DM');
  const cur = pos.find((p) => p.code === sel);
  return (
    <Card>
      <div className="relative w-full rounded-lg overflow-hidden" style={{ aspectRatio: '100 / 112', background: 'linear-gradient(180deg, #16301f, #10261a)' }}>
        <div className="absolute inset-2 border border-white/15 rounded" />
        <div className="absolute left-2 right-2 top-1/2 h-px bg-white/15" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        <div className="absolute left-[30%] right-[30%] top-2 h-[12%] border-x border-b border-white/15" />
        <div className="absolute left-[30%] right-[30%] bottom-2 h-[12%] border-x border-t border-white/15" />
        {pos.map((p) => {
          const [x, y] = SPOTS[p.code!] ?? [50, 50];
          const on = p.code === sel;
          return (
            <button key={p.code} type="button" onClick={() => setSel(p.code!)} aria-label={p.term}
              className={cx('absolute -translate-x-1/2 -translate-y-1/2 h-9 min-w-[42px] px-1.5 rounded-lg font-cond font-bold text-[15px] transition-transform', on ? 'bg-accent text-on-accent scale-110' : 'bg-black/45 text-white')}
              style={{ left: `${x}%`, top: `${y}%` }}>{p.code}</button>
          );
        })}
        <span className="absolute left-3 top-2.5 text-[10px] font-semibold text-white/50 uppercase tracking-wider">Their goal</span>
        <span className="absolute left-3 bottom-2.5 text-[10px] font-semibold text-white/50 uppercase tracking-wider">Your goal</span>
      </div>
      {cur && <div className="mt-3"><div className="t-strong">{cur.code} · {cur.term}</div><div className="t-body text-fg2">{cur.def}</div></div>}
      <div className="t-label text-fg3 mt-2">Tap a position. L = left, R = right, C = centre. D = defender, M = midfielder, AM = attacking midfielder, WB = wing-back.</div>
    </Card>
  );
}

function TacticsGuide() {
  const roles = GLOSSARY.filter((t) => t.cat === 'roles');
  const areas = ['Goalkeeper', 'Defence', 'Midfield', 'Wide', 'Attack'];
  const [area, setArea] = useState('Midfield');
  const players = GLOSSARY.filter((t) => t.cat === 'player');
  return (
    <>
      <Lead>A tactic is built in four layers, from the big picture to the small details. Every layer changes what happens in the match.</Lead>
      <div className="grid gap-2 mb-6">
        {TACTIC_LAYERS.map((l, i) => (
          <Card key={l.title}>
            <div className="flex gap-3">
              <span className="font-cond font-bold text-[30px] leading-none text-accent w-6 shrink-0">{i + 1}</span>
              <div className="min-w-0"><div className="t-strong">{l.title}</div><div className="t-body text-fg2 mt-0.5">{l.body}</div></div>
            </div>
          </Card>
        ))}
      </div>

      <Section title="Positions"><PositionPitch /></Section>

      <Section title="Duties">
        <div className="grid grid-cols-3 gap-2">
          {DUTIES.map((d) => (
            <Card key={d.code} padded={false} className="p-3">
              <div className="flex items-center gap-1.5"><span className="h-6 min-w-6 px-1 rounded bg-black/60 text-white text-[12px] font-bold flex items-center justify-center">{DUTY_ARROW[d.code]}</span><span className="t-strong">{d.name}</span></div>
              <div className="t-label text-fg2 mt-1.5">{d.body}</div>
            </Card>
          ))}
        </div>
        <div className="t-label text-fg3 mt-2">The small arrow on each player on the tactics pitch shows his duty.</div>
      </Section>

      <Section title="Roles" action={<span className="t-label text-fg3">the letters on the pitch</span>}>
        <ChipRow className="mb-2">{areas.map((a) => <Chip key={a} selected={area === a} onClick={() => setArea(a)}>{a}</Chip>)}</ChipRow>
        <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle">
          {roles.filter((r) => r.group === area).map((r) => (
            <div key={r.id} className="px-4 py-3 flex gap-3">
              <span className="h-7 min-w-[44px] px-1.5 rounded-md bg-raised font-cond font-bold text-[15px] flex items-center justify-center shrink-0">{r.code}</span>
              <div className="min-w-0"><div className="t-strong">{r.term}</div><div className="t-body text-fg2">{r.def}</div><div className="t-label text-fg3 mt-0.5">{r.game}</div></div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Role fit colours">
        <Card>
          <div className="grid gap-2">
            {FIT_LEVELS.map((f) => (
              <div key={f.name} className="flex items-center gap-3">
                <span className="h-6 w-6 rounded-full shrink-0" style={{ boxShadow: `inset 0 0 0 3px ${f.color}` }} />
                <span className="t-strong w-16 shrink-0">{f.name}</span>
                <span className="t-label text-fg2">{f.body}</span>
              </div>
            ))}
          </div>
          <div className="t-label text-fg3 mt-3">The ring around each player on the tactics pitch uses these colours.</div>
        </Card>
      </Section>

      <Section title="Mentality">
        <Card>
          <div className="flex items-center justify-between t-label text-fg2 mb-1.5"><span>Very defensive</span><span>Balanced</span><span>Very attacking</span></div>
          <div className="h-2 rounded-full" style={{ background: 'linear-gradient(90deg, var(--info), var(--bg-input), var(--negative))' }} />
          <div className="t-body text-fg2 mt-3">How much risk the team takes. More attacking means more players go forward: more chances for you and for them.</div>
        </Card>
      </Section>

      <Section title="Quick presets">
        <div className="grid gap-2">
          {Object.values(PRESETS).map((p) => (
            <Card key={p.label}><div className="t-strong">{p.label}</div><div className="t-body text-fg2">{p.desc}</div></Card>
          ))}
        </div>
        <div className="t-label text-fg3 mt-2">Tactics → Instructions → Presets. One tap sets mentality and all team instructions. You can change anything after.</div>
      </Section>

      <Section title="Team instructions">
        <div className="grid gap-2">
          {TEAM_INSTRUCTIONS.map((i) => (
            <Card key={i.key}>
              <div className="t-strong">{i.name}</div>
              <div className="t-body text-fg2">{i.def}</div>
              <div className="mt-2 grid gap-1">
                {i.options.map(([o, e]) => <div key={o} className="t-label"><span className="font-semibold text-accent">{o}</span><span className="text-fg2"> · {e}</span></div>)}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Player instructions">
        <Lead>Tap a player on the tactics pitch, then Instructions. Only ask for things he is good at, or it will backfire.</Lead>
        <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle">
          {players.map((p) => <div key={p.id} className="px-4 py-2.5"><span className="t-strong">{p.term}</span><span className="t-body text-fg2"> · {p.def}</span></div>)}
        </div>
      </Section>

      <Section title="Set pieces and triggers">
        <Card>
          <div className="t-body"><b>Set pieces:</b> <span className="text-fg2">choose who takes corners, free kicks and penalties, where corners are aimed, and how many players go forward.</span></div>
          <div className="t-body mt-2"><b>Triggers:</b> <span className="text-fg2">automatic changes during the match. "If we are losing after 70 minutes, go more attacking and bring on a striker."</span></div>
        </Card>
      </Section>
      <Link to="/tactics" className="inline-flex items-center gap-1 t-label text-accent">Open your tactics <ArrowRight size={14} /></Link>
    </>
  );
}

// ---------------------------------------------------------------- transfers
function TransfersGuide() {
  return (
    <>
      <Lead>Buying a player takes two agreements: one with his club about the fee, and one with the player about his contract.</Lead>
      <Section title="How a transfer works"><Card><Steps steps={TRANSFER_STEPS} /></Card></Section>
      <Section title="Bid in private or in public">
        <div className="grid gap-2">
          {PRIVATE_PUBLIC.map((x, i) => (
            <Card key={x.title}>
              <div className="flex items-center gap-2 mb-1">{i === 0 ? <Megaphone size={18} className="text-fg2" /> : <EyeOff size={18} className="text-accent" />}<span className="t-strong">{x.title}</span></div>
              <div className="t-body text-fg2">{x.body}</div>
            </Card>
          ))}
        </div>
      </Section>
      <Section title="Finding young talent">
        <Card>
          <div className="t-body text-fg2">Hundreds of the best under-21s in the world are in the game. You only see a guess of their potential until your scouts watch them.</div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Link to="/transfers/search?prospects=1" className="rounded-xl bg-raised p-3 active:brightness-110"><Sparkles size={18} className="text-warning" /><div className="t-strong mt-1">Young talents</div><div className="t-label text-fg2">The list, best first</div></Link>
            <Link to="/scouting" className="rounded-xl bg-raised p-3 active:brightness-110"><Telescope size={18} className="text-accent" /><div className="t-strong mt-1">Scouting</div><div className="t-label text-fg2">Send a 7-day mission</div></Link>
          </div>
        </Card>
      </Section>
      <Section title="Words you will see">
        <TermList terms={GLOSSARY.filter((t) => t.cat === 'transfers' && ['Wage', 'Contract', 'Squad status promise', 'Counter-offer', 'Free agent', 'Transfer embargo'].includes(t.term))} />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- dictionary
const TRAIT_ICON: Record<string, LucideIcon> = { Shooting: Crosshair, Passing: Route, 'On the ball': Zap, Defending: Shield, Physical: Dumbbell, Goalkeeping: Hand };

function TermRow({ t, showCat }: { t: Term; showCat?: boolean }) {
  const I = t.cat === 'traits' ? TRAIT_ICON[t.group ?? ''] : undefined;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        {t.code && <span className="h-6 min-w-[36px] px-1.5 rounded-md bg-raised font-cond font-bold text-[14px] flex items-center justify-center">{t.code}</span>}
        {I && <I size={15} className="text-fg3" />}
        <span className="t-strong">{t.term}</span>
        {showCat && <span className="t-caption text-fg3 ml-auto">{t.group && t.cat !== 'roles' ? t.group : CAT_LABEL[t.cat]}</span>}
      </div>
      <div className="t-body text-fg2 mt-0.5">{t.def}</div>
      {t.game && <div className="t-label mt-1"><span className="text-accent font-semibold">In the game: </span><span className="text-fg2">{t.game}</span></div>}
    </div>
  );
}

function TermList({ terms, showCat }: { terms: Term[]; showCat?: boolean }) {
  return <div className="rounded-[12px] border border-subtle bg-surface divide-y divide-subtle">{terms.map((t) => <TermRow key={t.id} t={t} showCat={showCat} />)}</div>;
}

function Dictionary({ q, cat, set }: { q: string; cat: GuideCat | null; set: (p: Record<string, string | null>) => void }) {
  const [text, setText] = useState(q);
  const results = useMemo(() => searchGlossary(text, cat), [text, cat]);
  const grouped = useMemo(() => GLOSSARY_CATS.map((c) => ({ c, items: results.filter((t) => t.cat === c) })).filter((g) => g.items.length), [results]);
  return (
    <>
      <div className="relative mb-2">
        <SearchIcon size={18} className="absolute left-3 top-3.5 text-fg3" />
        <input className={cx(inputCls, 'pl-10 pr-10')} placeholder="Search: press, IW, Rapid, xG…" value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value || null }); }} aria-label="Search the dictionary" />
        {text && <button type="button" aria-label="Clear" className="absolute right-3 top-3.5 text-fg3" onClick={() => { setText(''); set({ q: null }); }}><X size={18} /></button>}
      </div>
      <ChipRow className="mb-3">
        <Chip selected={!cat} onClick={() => set({ cat: null })}>All</Chip>
        {GLOSSARY_CATS.map((c) => <Chip key={c} selected={cat === c} onClick={() => set({ cat: cat === c ? null : c })}>{CAT_LABEL[c]}</Chip>)}
      </ChipRow>
      {results.length === 0 ? (
        <Card><div className="t-body text-fg2">No match for "{text}". Try a shorter word.</div></Card>
      ) : (text || cat) && results.length <= 12 ? (
        <TermList terms={results} showCat />
      ) : (
        grouped.map((g) => (
          <Section key={g.c} title={CAT_LABEL[g.c]} action={<Badge>{g.items.length}</Badge>}>
            <TermList terms={g.items} showCat={g.c === 'traits' || g.c === 'numbers'} />
          </Section>
        ))
      )}
    </>
  );
}
