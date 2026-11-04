/**
 * Production server: serves the built game from dist/ and hosts the online
 * mode on the same port.  Usage: npm run build && npm start  (PORT=8080)
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGameServer } from './server.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 8080);
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8',
};

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ não encontrado. Rode "npm run build" antes de "npm start".');
  process.exit(1);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) { response.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.includes(`${join('dist', 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(file).pipe(response);
});

attachGameServer(server, join(dist, 'assets', 'models', 'frozen_outpost.layout.json'));
server.listen(port, () => console.log(`Mecha Mayhem em http://localhost:${port}/  (online em ws://localhost:${port}/online)`));
