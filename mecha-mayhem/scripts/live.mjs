/**
 * "Sempre no ar": runs the dev server (game + online server, live reload) and
 * restarts it automatically if it ever stops. Usage: npm run live
 * Logs go to artifacts/live.log. Stop with Ctrl+C.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });
const log = createWriteStream('artifacts/live.log', { flags: 'a' });
const port = process.env.PORT ?? '5173';
let stopping = false;
let restarts = 0;
let child = null;

function run() {
  const started = Date.now();
  const stamp = () => new Date().toISOString();
  log.write(`\n[${stamp()}] iniciando vite na porta ${port}\n`);
  child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { process.stdout.write(d); log.write(d); });
  child.stderr.on('data', (d) => { process.stderr.write(d); log.write(d); });
  child.on('exit', (code) => {
    if (stopping) return;
    // Back off if it crashes immediately, so a broken edit does not spin the CPU.
    const quick = Date.now() - started < 5000;
    restarts = quick ? restarts + 1 : 0;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(restarts, 5));
    log.write(`[${stamp()}] vite saiu (código ${code}); reiniciando em ${wait / 1000}s\n`);
    console.log(`[live] servidor caiu; reiniciando em ${wait / 1000}s`);
    setTimeout(run, wait);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(); process.exit(0); });
run();
