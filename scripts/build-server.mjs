// Bundles the Node server (API + static file server + clock) for running anywhere with `npm start`.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/server', { recursive: true });
await build({
  entryPoints: ['packages/server/src/local.ts'],
  outfile: 'dist/server/local.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: ['pg-native'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
copyFileSync('data/seed/world-seed.json', 'dist/server/seed.json');
console.log('Server bundle ready: dist/server/local.mjs');
