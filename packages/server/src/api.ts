// Route registry. Import order matters where paths overlap (e.g. /api/clubs/available before /api/clubs/:id).
import './routes/auth.ts';
import './routes/system.ts';
import './routes/home.ts';
import './routes/squad.ts';
import './routes/tactics.ts';
import './routes/matches.ts';
import './routes/league.ts';
import './routes/club.ts';
import './routes/transfers.ts';

export { dispatch } from './http/router.ts';
export { migrate } from './migrate.ts';
export type { MeData } from './routes/auth.ts';
