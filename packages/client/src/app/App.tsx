import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { ConfirmProvider, SkeletonCards, ToastProvider, EmptyState, Button } from '../components/ui';
import { RequireSession } from './session';
import { Shell } from './Shell';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 3600_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

function page<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M) {
  const C = lazy(async () => ({ default: (await loader())[name] as ComponentType }));
  return <C />;
}

const auth = () => import('../features/auth');
const onboarding = () => import('../features/onboarding');
const home = () => import('../features/home');
const squad = () => import('../features/squad');
const player = () => import('../features/player');
const tacticsList = () => import('../features/tactics/list');
const tacticsEditor = () => import('../features/tactics/editor');
const preview = () => import('../features/matchday/preview');
const live = () => import('../features/matchday/live');
const summary = () => import('../features/matchday/summary');
const league = () => import('../features/league');
const club = () => import('../features/club');
const transfers = () => import('../features/transfers');
const media = () => import('../features/media');
const settings = () => import('../features/settings');
const guide = () => import('../features/guide');

function Loading() {
  return <div className="px-4 pt-20"><SkeletonCards n={4} /></div>;
}

function Frame({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function NotFound() {
  return <EmptyState title="Nothing here" body="That page does not exist (any more)." action={<Button onClick={() => (window.location.href = '/')}>Go home</Button>} />;
}

const router = createBrowserRouter([
  { path: '/setup', element: <Frame>{page(auth, 'SetupPage')}</Frame> },
  { path: '/login', element: <Frame>{page(auth, 'LoginPage')}</Frame> },
  { path: '/register', element: <Frame>{page(auth, 'RegisterPage')}</Frame> },
  {
    element: <RequireSession><Frame><Outlet /></Frame></RequireSession>,
    children: [
      { path: '/onboarding/club', element: page(onboarding, 'ClubPick') },
      { path: '/onboarding/tour', element: page(onboarding, 'Tour') },
      {
        element: <Shell />,
        children: [
          { path: '/', element: <Frame>{page(home, 'Home')}</Frame> },
          { path: '/alerts', element: <Frame>{page(home, 'Alerts')}</Frame> },
          { path: '/fixture/:id/preview', element: <Frame>{page(preview, 'Preview')}</Frame> },
          { path: '/fixture/:id/live', element: <Frame>{page(live, 'LiveReplay')}</Frame> },
          { path: '/fixture/:id', element: <Frame>{page(summary, 'MatchSummary')}</Frame> },
          { path: '/season/review', element: <Frame>{page(media, 'SeasonReview')}</Frame> },
          { path: '/squad', element: <Frame>{page(squad, 'Squad')}</Frame> },
          { path: '/squad/training', element: <Frame>{page(squad, 'Training')}</Frame> },
          { path: '/squad/injuries', element: <Frame>{page(squad, 'Injuries')}</Frame> },
          { path: '/squad/youth', element: <Frame>{page(squad, 'Youth')}</Frame> },
          { path: '/player/:id', element: <Frame>{page(player, 'PlayerProfile')}</Frame> },
          { path: '/player/:id/compare', element: <Frame>{page(player, 'Compare')}</Frame> },
          { path: '/tactics', element: <Frame>{page(tacticsList, 'TacticList')}</Frame> },
          { path: '/tactics/:id', element: <Frame>{page(tacticsEditor, 'TacticEditor')}</Frame> },
          { path: '/league', element: <Frame>{page(league, 'LeagueTable')}</Frame> },
          { path: '/league/fixtures', element: <Frame>{page(league, 'Fixtures')}</Frame> },
          { path: '/league/stats', element: <Frame>{page(league, 'Stats')}</Frame> },
          { path: '/competitions', element: <Frame>{page(league, 'Competitions')}</Frame> },
          { path: '/competition/:id', element: <Frame>{page(league, 'Competition')}</Frame> },
          { path: '/club/:id', element: <Frame>{page(league, 'ClubProfile')}</Frame> },
          { path: '/h2h/:a/:b', element: <Frame>{page(league, 'HeadToHead')}</Frame> },
          { path: '/round/:n', element: <Frame>{page(league, 'Round')}</Frame> },
          { path: '/club', element: <Frame>{page(club, 'ClubOverview')}</Frame> },
          { path: '/club/finances', element: <Frame>{page(club, 'Finances')}</Frame> },
          { path: '/club/facilities', element: <Frame>{page(club, 'Facilities')}</Frame> },
          { path: '/club/staff', element: <Frame>{page(club, 'Staff')}</Frame> },
          { path: '/club/sponsorship', element: <Frame>{page(club, 'Sponsorship')}</Frame> },
          { path: '/club/vision', element: <Frame>{page(club, 'Vision')}</Frame> },
          { path: '/club/trophies', element: <Frame>{page(club, 'Trophies')}</Frame> },
          { path: '/transfers', element: <Frame>{page(transfers, 'TransferHub')}</Frame> },
          { path: '/transfers/search', element: <Frame>{page(transfers, 'Search')}</Frame> },
          { path: '/transfers/shortlist', element: <Frame>{page(transfers, 'Shortlist')}</Frame> },
          { path: '/transfers/offers', element: <Frame>{page(transfers, 'Offers')}</Frame> },
          { path: '/transfers/negotiate/:id', element: <Frame>{page(transfers, 'Negotiate')}</Frame> },
          { path: '/scouting', element: <Frame>{page(transfers, 'Scouting')}</Frame> },
          { path: '/media', element: <Frame>{page(media, 'News')}</Frame> },
          { path: '/media/gallery', element: <Frame>{page(media, 'Gallery')}</Frame> },
          { path: '/media/:id', element: <Frame>{page(media, 'Article')}</Frame> },
          { path: '/settings', element: <Frame>{page(settings, 'Settings')}</Frame> },
          { path: '/settings/notifications', element: <Frame>{page(settings, 'NotificationSettings')}</Frame> },
          { path: '/settings/admin', element: <Frame>{page(settings, 'Admin')}</Frame> },
          { path: '/guide', element: <Frame>{page(guide, 'Guide')}</Frame> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export { qc as queryClient };
