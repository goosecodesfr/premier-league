// Produces Vercel's Build Output API layout (.vercel/output): the PWA as static files and the whole API
// as one Node.js function. Run by Vercel as the build command (see vercel.json).
import { execSync } from 'node:child_process';
import { build } from 'esbuild';
import { cpSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const OUT = '.vercel/output';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/static`, { recursive: true });

// 1. The app
execSync('npm run build -w @ffm/client', { stdio: 'inherit' });
cpSync('packages/client/dist', `${OUT}/static`, { recursive: true });

// 2. The API function
const fn = `${OUT}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['packages/server/src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['pg-native'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
copyFileSync('data/seed/world-seed.json', `${fn}/seed.json`);
const region = process.env.FUNCTION_REGION || 'fra1';
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  supportsResponseStreaming: false,
  maxDuration: 300,
  regions: [region],
}, null, 2));

// 3. Routing: /api/* -> the function, static files, then the SPA fallback
writeFileSync(`${OUT}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api/(.*)$', dest: '/api?__path=$1' },
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(sw\\.js|workbox-[^/]*\\.js|manifest\\.webmanifest|index\\.html|push-handler\\.js)$', headers: { 'cache-control': 'no-cache' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));
console.log(`Vercel output ready (function region ${region}).`);
