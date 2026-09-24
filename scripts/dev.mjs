// Local development: API server with auto-reload on :3000 and the Vite dev server on :5173 (proxying /api).
import { spawn } from 'node:child_process';
const env = { ...process.env, PORT: process.env.PORT || '3000' };
const procs = [
  spawn('npx', ['tsx', 'watch', 'packages/server/src/local.ts'], { stdio: 'inherit', env }),
  spawn('npm', ['run', 'dev', '-w', '@ffm/client'], { stdio: 'inherit', env }),
];
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
