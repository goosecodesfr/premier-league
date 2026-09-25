// Session: who am I, which club, what state is the league in. Drives guards and the club accent.
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import type { MeData } from '@ffm/server/routes/auth';
import { api, ApiError, authEvents } from '../lib/api';
import { applyAccent } from '../lib/color';
import { setHaptics } from '../lib/device';

export interface StatusData { setup: boolean; name: string | null; season: string | null; phase: string | null; users: number; secretConfigured: boolean; vapidPublic: string | null; time: string }

const MeCtx = createContext<MeData | null>(null);
export function useMe(): MeData {
  const me = useContext(MeCtx);
  if (!me) throw new Error('useMe outside session');
  return me;
}
export function useMaybeMe(): MeData | null {
  return useContext(MeCtx);
}

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: () => api.get<StatusData>('/status'), staleTime: 60_000 });
}

export function useMeQuery() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeData>('/me'),
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ApiError && (e.code === 'UNAUTHENTICATED' || e.code === 'FORBIDDEN')) && n < 2,
  });
}

function Splash() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4">
      <img src="/favicon.svg" alt="" width={64} height={64} className="opacity-90" />
      <div className="t-label text-fg3">Loading your club…</div>
    </div>
  );
}

/** Wraps every signed-in route. */
export function RequireSession({ children }: { children: ReactNode }) {
  const status = useStatus();
  const me = useMeQuery();
  const loc = useLocation();
  const qc = useQueryClient();
  useEffect(() => {
    const onLogout = () => { qc.setQueryData(['me'], null); qc.invalidateQueries({ queryKey: ['me'] }); };
    authEvents.addEventListener('logout', onLogout);
    return () => authEvents.removeEventListener('logout', onLogout);
  }, [qc]);
  const data = me.data;
  useEffect(() => {
    if (data?.club) applyAccent(data.club.colors);
    setHaptics(data?.user.prefs?.haptics !== false);
    document.documentElement.classList.toggle('reduce-motion', data?.user.prefs?.reducedMotion === true);
  }, [data]);
  if (status.data && !status.data.setup) return <Navigate to="/setup" replace />;
  if (me.isPending) return <Splash />;
  if (me.error instanceof ApiError && me.error.code === 'UNAUTHENTICATED') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!data) {
    if (me.error) return (
      <div className="p-6 pt-16 text-center t-body text-fg2 max-w-md mx-auto">
        <div className="t-title2 text-fg mb-2">Could not reach the game server</div>
        <div className="mb-4 break-words">{me.error.message}</div>
        <button className="text-accent underline" onClick={() => { void status.refetch(); void me.refetch(); }}>Retry</button>
        <div className="t-label text-fg3 mt-6">Setting up? Open <a className="underline" href="/api/status">/api/status</a> to see the raw answer from the server.</div>
      </div>
    );
    return <Navigate to="/login" replace />;
  }
  if (!data.world) return <Navigate to="/setup" replace />;
  if (!data.club && !loc.pathname.startsWith('/onboarding') && !loc.pathname.startsWith('/settings')) return <Navigate to="/onboarding/club" replace />;
  return <MeCtx.Provider value={data}>{children}</MeCtx.Provider>;
}
