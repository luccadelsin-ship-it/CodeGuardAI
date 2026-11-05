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
      // Live update: the browser hot-reloads client code; changes to the authoritative
      // server or shared rules restart the dev server so the online game picks them up too.
      let restarting = false;
      server.watcher.add(['server/**/*.ts', 'src/shared/**/*.ts']);
      server.watcher.on('change', (file) => {
        const norm = file.replace(/\\/g, '/');
        if (restarting || !(/\/server\/[^/]+\.ts$/.test(norm) || /\/src\/shared\//.test(norm))) return;
        restarting = true;
        server.config.logger.info(`[mecha] ${norm.split('/').slice(-2).join('/')} mudou · reiniciando servidor online`, { timestamp: true });
        void server.restart().finally(() => { restarting = false; });
      });
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
