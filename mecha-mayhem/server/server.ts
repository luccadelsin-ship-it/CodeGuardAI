/** Attaches the Mecha Mayhem online service to any Node HTTP server at /online. */
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ArenaLayout } from '../src/shared/arena.ts';
import { PROTOCOL_VERSION, type ClientMessage, type OnlineMode, type ServerMessage } from '../src/shared/protocol.ts';
import { Room } from './room.ts';

const TICK = 1 / 30;

export interface GameServer {
  rooms: Map<string, Room>;
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  close(): void;
}

function roomCode(rooms: Map<string, Room>): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(code)) return code;
  }
}

function cleanName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const clean = text.normalize('NFKC').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().toUpperCase().slice(0, 16);
  return clean || 'PILOTO';
}

export function createGameServer(layoutPath: string, path = '/online'): GameServer {
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8')) as ArenaLayout;
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

  const timer = setInterval(() => {
    for (const [code, room] of rooms) {
      if (room.empty) { rooms.delete(code); continue; }
      room.tick(TICK);
    }
  }, TICK * 1000);
  timer.unref?.();

  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let playerId = -1;
    let budget = 240;
    let last = Date.now();
    const send = (message: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message)); };
    const conn = { send, close: () => ws.close() };

    ws.on('message', (data) => {
      // Simple flood protection: ~240 messages per second burst.
      const t = Date.now();
      budget = Math.min(240, budget + (t - last) * 0.24);
      last = t;
      if (--budget < 0) { ws.close(1008, 'flood'); return; }
      let message: ClientMessage;
      try { message = JSON.parse(String(data)) as ClientMessage; } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (!room) {
        if (message.t !== 'hello') return;
        if (message.v !== PROTOCOL_VERSION) { send({ t: 'error', message: 'Versão do jogo diferente da do servidor. Recarregue a página.' }); ws.close(); return; }
        const mode: OnlineMode = message.mode === 'duel' ? 'duel' : 'ffa';
        if (message.room) {
          const found = rooms.get(String(message.room).toUpperCase());
          if (!found) { send({ t: 'error', message: 'Sala não encontrada.' }); return; }
          if (found.full) { send({ t: 'error', message: 'Sala cheia.' }); return; }
          room = found;
        } else if (message.create) {
          const code = roomCode(rooms);
          room = new Room(code, mode, true, layout);
          rooms.set(code, room);
        } else {
          room = [...rooms.values()].find((r) => !r.isPrivate && r.mode === mode && !r.full && r.phase !== 'ended')
            ?? [...rooms.values()].find((r) => !r.isPrivate && r.mode === mode && !r.full) ?? null;
          if (!room) {
            const code = roomCode(rooms);
            room = new Room(code, mode, false, layout);
            rooms.set(code, room);
          }
        }
        playerId = room.join(conn, cleanName(message.name), message.palette, message.weapon).id;
        return;
      }
      room.handle(playerId, message);
    });
    ws.on('close', () => { room?.leave(playerId); room = null; });
    ws.on('error', () => ws.close());
  });

  return {
    rooms,
    handleUpgrade(request, socket, head) {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== path) return false;
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
      return true;
    },
    close() { clearInterval(timer); wss.close(); },
  };
}

/** Convenience: wire the game server into an http.Server's upgrade event. */
export function attachGameServer(server: Server, layoutPath: string): GameServer {
  const game = createGameServer(layoutPath);
  server.on('upgrade', (request, socket, head) => { game.handleUpgrade(request, socket, head); });
  return game;
}
