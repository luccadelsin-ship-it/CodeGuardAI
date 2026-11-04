import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server/server.ts';

const layout = fileURLToPath(new URL('./public/assets/models/frozen_outpost.layout.json', import.meta.url));

/** Runs the authoritative online server inside `vite dev` and `vite preview` at /online. */
function mechaOnline(): Plugin {
  const attach = (httpServer: import('node:http').Server | null | undefined) => {
    if (!httpServer) return null;
    const game = createGameServer(layout);
    httpServer.on('upgrade', (request, socket, head) => { game.handleUpgrade(request, socket, head); });
    httpServer.on('close', () => game.close());
    return game;
  };
  return {
    name: 'mecha-mayhem-online',
    configureServer(server) {
      const game = attach(server.httpServer as import('node:http').Server | null);
      // Dev-only read-only room status for the smoke test (bots, teams, core).
      server.middlewares.use('/__mm/rooms', (_req, res) => {
        const rooms = game ? [...game.rooms.values()].map((r) => ({ code: r.code, mode: r.mode, phase: r.phase, humans: r.humans, players: r.players.size, bots: r.botStatus(), outcome: r.outcome() })) : [];
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(rooms));
      });
    },
    configurePreviewServer(server) { attach(server.httpServer as import('node:http').Server | null); },
  };
}

export default defineConfig({
  plugins: [mechaOnline()],
  build: { chunkSizeWarningLimit: 8000 },
});
