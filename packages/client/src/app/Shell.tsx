// Five-tab layout. Each tab remembers where you were; tapping the active tab returns to its root.
import { useEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { Building2, House, LayoutGrid, Trophy, Users, WifiOff } from 'lucide-react';
import { useOnline } from '../lib/hooks';
import { cx } from '../components/ui';
import { useMe } from './session';

type TabKey = 'home' | 'squad' | 'tactics' | 'league' | 'club';
const TABS: { key: TabKey; label: string; root: string; icon: typeof House }[] = [
  { key: 'home', label: 'Home', root: '/', icon: House },
  { key: 'squad', label: 'Squad', root: '/squad', icon: Users },
  { key: 'tactics', label: 'Tactics', root: '/tactics', icon: LayoutGrid },
  { key: 'league', label: 'League', root: '/league', icon: Trophy },
  { key: 'club', label: 'Club', root: '/club', icon: Building2 },
];

const lastPath: Partial<Record<TabKey, string>> = {};
let lastTab: TabKey = 'home';

export function tabOf(path: string): TabKey | null {
  if (path === '/' || path.startsWith('/alerts') || path.startsWith('/fixture') || path.startsWith('/season')) return 'home';
  if (path.startsWith('/squad')) return 'squad';
  if (path.startsWith('/tactics')) return 'tactics';
  if (path.startsWith('/league') || path.startsWith('/competition') || path.startsWith('/h2h') || path.startsWith('/round') || /^\/club\/\d+/.test(path)) return 'league';
  if (path.startsWith('/club') || path.startsWith('/transfers') || path.startsWith('/scouting') || path.startsWith('/media') || path.startsWith('/settings')) return 'club';
  return null; // e.g. /player/:id belongs to whichever tab you came from
}

export function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const online = useOnline();
  const me = useMe();
  const current = tabOf(loc.pathname) ?? lastTab;
  useEffect(() => {
    lastTab = current;
    lastPath[current] = loc.pathname + loc.search;
  }, [current, loc.pathname, loc.search]);
  const full = /\/fixture\/\d+\/live/.test(loc.pathname);
  const alerts = me.unread + me.decisions;
  return (
    <div className="app-column">
      {!online && (
        <div className="sticky top-0 z-40 pt-safe bg-warning text-[#0B0E11] t-label flex items-center justify-center gap-2 h-8"><WifiOff size={14} /> Offline - showing saved data</div>
      )}
      <ScrollRestoration getKey={(l) => l.pathname + l.search} />
      <Outlet />
      {!full && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-[480px] border-t border-subtle bg-[color-mix(in_srgb,var(--bg-surface)_94%,transparent)] backdrop-blur-md pb-safe" aria-label="Main">
          <div className="grid grid-cols-5 h-[60px]">
            {TABS.map((t) => {
              const active = t.key === current;
              const Icon = t.icon;
              return (
                <button key={t.key} type="button" aria-current={active ? 'page' : undefined}
                  className={cx('relative flex flex-col items-center justify-center gap-0.5 select-none', active ? 'text-accent' : 'text-fg3')}
                  onClick={() => {
                    if (active) {
                      if (loc.pathname !== t.root) nav(t.root);
                      else window.scrollTo({ top: 0, behavior: 'smooth' });
                    } else nav(lastPath[t.key] ?? t.root);
                  }}>
                  <Icon size={24} strokeWidth={active ? 2.2 : 1.75} />
                  <span className="text-[11px] font-medium">{t.label}</span>
                  {t.key === 'home' && alerts > 0 && <span className="absolute top-2 left-[calc(50%+6px)] min-w-4 h-4 px-1 rounded-full bg-negative text-[10px] font-bold text-white flex items-center justify-center">{alerts > 9 ? '9+' : alerts}</span>}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
