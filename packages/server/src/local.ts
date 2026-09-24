// Local server: serves the API and the built app, and runs the clock every minute.
// Usage: DATABASE_URL=... APP_SECRET=... npm start   (after `npm run build`)
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { dispatch, migrate } from './api.ts';
import { tick } from './jobs/runner.ts';

const PORT = Number(process.env.PORT || 3000);
const STATIC = process.env.STATIC_DIR || join(process.cwd(), 'packages', 'client', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    await dispatch(req, res, { beforeRoute: () => migrate(), longLived: true });
    return;
  }
  let file = normalize(join(STATIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC)) { res.statusCode = 403; res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html');
  if (!existsSync(file)) { res.statusCode = 404; res.end('Build the client first: npm run build'); return; }
  const ext = extname(file);
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', file.includes(`${join('assets', '')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`Fantasy Football Manager on http://localhost:${PORT}`));

if (process.env.LOCAL_TICK !== '0') {
  const run = () => tick({ budgetMs: 50_000 }).then((r) => { if (r.ran.length) console.log(`tick: ${r.ran.map((j) => j.type).join(', ')}`); }).catch((e) => console.error('tick failed', e));
  setInterval(run, 60_000);
  setTimeout(run, 5_000);
}
