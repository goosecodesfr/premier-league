// Run the league clock once from the command line: DATABASE_URL=... npm run tick
import { closeDb } from '../packages/server/src/db.ts';
import { tick } from '../packages/server/src/jobs/runner.ts';
const r = await tick({ budgetMs: 120_000 });
console.log(JSON.stringify(r, null, 2));
await closeDb();
