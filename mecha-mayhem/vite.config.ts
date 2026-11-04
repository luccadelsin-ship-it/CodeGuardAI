import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server/server.ts';

const layout = fileURLToPath(new URL('./public/assets/models/frozen_outpost.layout.json', import.meta.url));

/** Runs the authoritative online server inside `vite dev` and `vite preview` at /online. */
function mechaOnline(): Plugin {
  const attach = (httpServer: import('node:http').Server | null | undefined) => {
    if (!httpServer) return;
    const game = createGameServer(layout);
    httpServer.on('upgrade', (request, socket, head) => { game.handleUpgrade(request, socket, head); });
    httpServer.on('close', () => game.close());
  };
  return {
    name: 'mecha-mayhem-online',
    configureServer(server) { attach(server.httpServer as import('node:http').Server | null); },
    configurePreviewServer(server) { attach(server.httpServer as import('node:http').Server | null); },
  };
}

export default defineConfig({
  plugins: [mechaOnline()],
  build: { chunkSizeWarningLimit: 8000 },
});
