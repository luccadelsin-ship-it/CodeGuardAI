/**
 * Online play inside the claude.ai Artifact, where WebSockets to a game server are blocked.
 *
 * The artifact's `room` capability relays small messages between everyone who has the page open.
 * One player HOSTS: their browser runs the same authoritative `Room` as the Node server (movement,
 * hits, damage, bots), and every other player is a client that sends inputs and receives snapshots.
 * Budget per page is about 40 messages a second of at most 4 KiB, so traffic is batched at 15 Hz:
 * clients send one packet of queued messages, the host sends one packet with the shared snapshot and
 * each client's own part (ack + predicted state), split into several emits only when it would not fit.
 *
 * Topics: `c` client -> host, `s` host -> clients, inside a named room `mm-<code>`. The lobby presence
 * advertises open rooms (`mm` field) so quick play can find one.
 */
import { Room } from '../../server/room.ts';
import { PROTOCOL_VERSION, type ClientMessage, type OnlineMode, type ServerMessage } from '../shared/protocol';
import type { ArenaLayout } from '../shared/arena';
import type { MapId } from '../shared/maps';
import type { SocketLike } from './online';

type Json = unknown;
interface Sender { peer: string; sameTab: boolean; isMe: boolean }
interface Message extends Sender { topic: string; data?: Json }
interface Peer extends Sender { presence: Readonly<Record<string, Json>> }
interface Channel {
  emit(topic: string, data?: Json): Promise<void>;
  on(topic: string, handler: (msg: Message) => void, onError?: (e: { code: string }) => void): () => void;
  presence(patch: Record<string, Json | null>): Promise<void>;
  peers(): readonly Peer[];
  onPeers(handler: (change: { peers: readonly Peer[]; joined: readonly Peer[]; left: readonly Peer[] }) => void): () => void;
}
interface NamedRoom extends Channel { leave(): Promise<void> }
interface RoomApi extends Channel { join(name: string): Promise<NamedRoom>; connected(): boolean }

/** What a host advertises in the lobby presence. */
export interface HostedRoom { code: string; mode: OnlineMode; map: MapId; humans: number; max: number; open: boolean; peer: string }

const FLUSH_SECONDS = 1 / 15;
const MAX_PACKET = 3600; // bytes of JSON per emit (limit is 4 KiB)
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let apiPromise: Promise<RoomApi | null> | null = null;
/** The claude.ai room namespace, or null outside a viewer that grants it. */
export function roomApi(): Promise<RoomApi | null> {
  apiPromise ??= (async () => {
    const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
    if (!claude?.use) return null;
    try { return (await claude.use('room')) as RoomApi | null; } catch { return null; }
  })();
  return apiPromise;
}

export function newRoomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return code;
}

const roomName = (code: string) => `mm-${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Rooms other players are hosting right now (from their lobby presence). */
export function listHostedRooms(api: RoomApi): HostedRoom[] {
  const rooms: HostedRoom[] = [];
  for (const p of api.peers()) {
    const mm = p.presence?.mm as Partial<HostedRoom> | undefined;
    if (p.sameTab || !mm || typeof mm.code !== 'string' || typeof mm.mode !== 'string' || typeof mm.map !== 'string') continue;
    rooms.push({ code: mm.code.slice(0, 8), mode: mm.mode as OnlineMode, map: mm.map as MapId, humans: Number(mm.humans) || 0, max: Number(mm.max) || 0, open: mm.open === true, peer: p.peer });
  }
  return rooms;
}

/** Minimal event target with the WebSocket-shaped surface OnlineSession uses. */
class Events {
  private listeners = new Map<string, Array<(event: { data: unknown }) => void>>();
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  protected dispatch(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

interface RemotePeer { id: number; out: ServerMessage[]; budget: number; last: number }

/** Snapshot shared by everyone (players, missiles, scores) without the per-player fields. */
type SnapBase = Omit<Extract<ServerMessage, { t: 'snap' }>, 'ack' | 'me'>;

/**
 * The hosting player's side: runs the authoritative Room in this page, serves remote players through
 * the named room, and gives the host's own OnlineSession an in-memory socket.
 */
export class ArtifactHost {
  readonly room: Room;
  private remotes = new Map<string, RemotePeer>();
  private ticker: (() => void) | null = null;
  private lastTick = performance.now();
  private flushClock = 0;
  private seq = 0;
  private stopped = false;
  private unsubscribe: Array<() => void> = [];
  private advertiseTimer = 0;
  local: LocalSocket | null = null;

  private constructor(private readonly api: RoomApi, private readonly named: NamedRoom, readonly code: string, readonly mode: OnlineMode, readonly map: MapId, readonly isPrivate: boolean, layout: ArenaLayout) {
    this.room = new Room(code, mode, isPrivate, layout, map);
  }

  static async create(mode: OnlineMode, map: MapId, isPrivate: boolean, layout: ArenaLayout): Promise<ArtifactHost> {
    const api = await roomApi();
    if (!api) throw new Error('O online deste artefato precisa do claude.ai (abra o link do artefato com sua conta).');
    const code = newRoomCode();
    const named = await api.join(roomName(code));
    const host = new ArtifactHost(api, named, code, mode, map, isPrivate, layout);
    await named.presence({ role: 'host', code, mode, map });
    host.unsubscribe.push(named.on('c', (msg) => host.onClient(msg)));
    host.unsubscribe.push(named.onPeers((change) => { for (const p of change.left) host.dropPeer(p.peer); }));
    host.ticker = startTicker(() => host.tick());
    host.advertise();
    return host;
  }

  /** Socket for the host's own OnlineSession: talks to the Room directly, no network. */
  socket(): LocalSocket {
    this.local = new LocalSocket(this);
    return this.local;
  }

  private advertise(): void {
    const mm: Omit<HostedRoom, 'peer'> = { code: this.code, mode: this.mode, map: this.map, humans: this.room.humans, max: this.room.rules.maxPlayers, open: !this.isPrivate };
    void this.api.presence({ mm }).catch(() => { /* lobby listing is best effort */ });
  }

  /** Fixed 30 Hz simulation driven by wall-clock time, so a late or throttled timer catches up. */
  private tick(): void {
    if (this.stopped) return;
    const t = performance.now();
    let steps = Math.min(15, Math.floor((t - this.lastTick) / (1000 / 30)));
    if (steps <= 0) return;
    this.lastTick += steps * (1000 / 30);
    if (t - this.lastTick > 500) this.lastTick = t; // after a long stall, skip ahead instead of fast-forwarding
    while (steps-- > 0) {
      this.room.tick(1 / 30);
      this.flushClock += 1 / 30;
      this.advertiseTimer += 1 / 30;
    }
    if (this.flushClock >= FLUSH_SECONDS - 1e-6) { this.flushClock = 0; this.flush(); }
    if (this.advertiseTimer > 2) { this.advertiseTimer = 0; this.advertise(); }
  }

  private onClient(msg: Message): void {
    if (msg.sameTab || this.stopped) return;
    const data = msg.data as { to?: string; m?: ClientMessage[] } | undefined;
    if (!data || !Array.isArray(data.m)) return;
    const me = this.named.peers().find((p) => p.sameTab)?.peer;
    if (data.to !== me) return;
    let remote = this.remotes.get(msg.peer);
    const t = performance.now() / 1000;
    for (const message of data.m.slice(0, 40)) {
      if (!message || typeof message !== 'object') continue;
      if (!remote) {
        if (message.t !== 'hello') continue;
        const reply = (m: ServerMessage) => void this.named.emit('s', { q: ++this.seq, to: { [msg.peer]: { m: [m] } } });
        if (message.v !== PROTOCOL_VERSION) { reply({ t: 'error', message: 'Versão do jogo diferente da do anfitrião. Recarreguem a página.' }); return; }
        if (message.map !== this.map) { reply({ t: 'error', message: `MAPA:${this.map}` }); return; }
        if (this.room.full) { reply({ t: 'error', message: 'Sala cheia.' }); return; }
        const created: RemotePeer = { id: -1, out: [], budget: 120, last: t };
        const conn = { send: (m: ServerMessage) => { created.out.push(m); }, close: () => this.dropPeer(msg.peer) };
        created.id = this.room.join(conn, cleanName(message.name), message.palette, message.weapon, message.parts).id;
        this.remotes.set(msg.peer, created);
        remote = created;
        this.advertise();
        continue;
      }
      // Same flood budget as the Node server (about 240 messages a second sustained).
      remote.budget = Math.min(240, remote.budget + (t - remote.last) * 240);
      remote.last = t;
      if (--remote.budget < 0) continue;
      this.room.handle(remote.id, message);
    }
  }

  private dropPeer(peer: string): void {
    const remote = this.remotes.get(peer);
    if (!remote) return;
    this.remotes.delete(peer);
    this.room.leave(remote.id);
    this.advertise();
  }

  /** One packet for every client: shared messages once, the latest snapshot base once, then per-peer parts. */
  private flush(): void {
    if (!this.remotes.size) return;
    const peers = [...this.remotes.entries()];
    let base: SnapBase | null = null;
    const own = new Map<string, { m: ServerMessage[]; s?: { a: number; me: unknown } }>();
    const counts = new Map<string, number>();
    for (const [peer, r] of peers) {
      const out = r.out.splice(0);
      const entry: { m: ServerMessage[]; s?: { a: number; me: unknown } } = { m: [] };
      for (const m of out) {
        if (m.t === 'snap') {
          const { ack, me, ...rest } = m;
          base = rest;
          entry.s = { a: ack, me };
          continue;
        }
        entry.m.push(m);
        const key = JSON.stringify(m);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      own.set(peer, entry);
    }
    // Messages every client got (kills, hits, phase...) travel once.
    const shared = [...counts.entries()].filter(([, n]) => n === peers.length).map(([k]) => k);
    const sharedSet = new Set(shared);
    for (const entry of own.values()) entry.m = entry.m.filter((m) => !sharedSet.has(JSON.stringify(m)));
    const q = ++this.seq;
    const head: Record<string, unknown> = { q };
    if (base) head.snap = base;
    if (shared.length) head.all = shared.map((k) => JSON.parse(k) as ServerMessage);
    let packet: Record<string, unknown> = { ...head, to: {} };
    const send = () => { if (Object.keys(packet.to as object).length || packet.snap || packet.all) void this.named.emit('s', packet).catch(() => { /* dropped */ }); };
    for (const [peer, entry] of own) {
      if (!entry.m.length && !entry.s) continue;
      const next = { ...(packet.to as object), [peer]: entry };
      if (bytes({ ...packet, to: next }) > MAX_PACKET && Object.keys(packet.to as object).length) {
        send();
        packet = { q, to: { [peer]: entry } };
      } else {
        packet.to = next;
      }
    }
    send();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.ticker?.();
    for (const off of this.unsubscribe) off();
    void this.named.emit('s', { q: ++this.seq, end: true }).catch(() => {});
    void this.named.leave().catch(() => {});
    void this.api.presence({ mm: null }).catch(() => {});
  }
}

/** In-memory socket between the host's OnlineSession and the Room in the same page. */
class LocalSocket extends Events implements SocketLike {
  readyState = 0;
  private id = -1;
  constructor(private readonly host: ArtifactHost) {
    super();
    window.setTimeout(() => { this.readyState = 1; this.dispatch('open'); }, 0);
  }
  send(data: string): void {
    let message: ClientMessage;
    try { message = JSON.parse(data) as ClientMessage; } catch { return; }
    if (this.id < 0) {
      if (message.t !== 'hello') return;
      const conn = { send: (m: ServerMessage) => this.dispatch('message', JSON.stringify(m)), close: () => this.close() };
      this.id = this.host.room.join(conn, cleanName(message.name), message.palette, message.weapon, message.parts).id;
      return;
    }
    this.host.room.handle(this.id, message);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.host.stop();
    window.setTimeout(() => this.dispatch('close'), 0); // like a WebSocket: close arrives after the call
  }
}

/** A client's socket: queues messages, sends one packet to the host every 1/15 s. */
class RemoteSocket extends Events implements SocketLike {
  readyState = 0;
  private outbox: ClientMessage[] = [];
  private timer = 0;
  private bases = new Map<number, SnapBase>();
  private off: Array<() => void> = [];
  private myPeer = '';

  constructor(private readonly named: NamedRoom, private readonly hostPeer: string) {
    super();
    this.myPeer = named.peers().find((p) => p.sameTab)?.peer ?? '';
    this.off.push(named.on('s', (msg) => this.onHost(msg)));
    this.off.push(named.onPeers((change) => { if (change.left.some((p) => p.peer === hostPeer)) this.end(); }));
    this.timer = window.setInterval(() => this.flush(), FLUSH_SECONDS * 1000);
    window.setTimeout(() => { this.readyState = 1; this.dispatch('open'); }, 0);
  }

  send(data: string): void {
    let message: ClientMessage;
    try { message = JSON.parse(data) as ClientMessage; } catch { return; }
    // Merge consecutive input batches; the host deduplicates frames by sequence anyway.
    const last = this.outbox[this.outbox.length - 1];
    if (message.t === 'input' && last?.t === 'input') { last.frames.push(...message.frames); return; }
    this.outbox.push(message);
    if (message.t === 'hello') this.flush();
  }

  private flush(): void {
    if (this.readyState !== 1 || !this.outbox.length) return;
    let batch: ClientMessage[] = [];
    const emit = () => { if (batch.length) void this.named.emit('c', { to: this.hostPeer, m: batch }).catch(() => {}); batch = []; };
    for (const message of this.outbox.splice(0)) {
      if (bytes([...batch, message]) > MAX_PACKET) emit();
      batch.push(message);
    }
    emit();
  }

  private onHost(msg: Message): void {
    if (msg.peer !== this.hostPeer) return;
    const data = msg.data as { q?: number; end?: boolean; snap?: SnapBase; all?: ServerMessage[]; to?: Record<string, { m?: ServerMessage[]; s?: { a: number; me: unknown } }> } | undefined;
    if (!data) return;
    if (data.end) { this.end(); return; }
    const q = Number(data.q) || 0;
    if (data.snap) {
      this.bases.set(q, data.snap);
      for (const key of this.bases.keys()) if (key < q - 30) this.bases.delete(key);
    }
    for (const m of data.all ?? []) this.dispatch('message', JSON.stringify(m));
    const mine = data.to?.[this.myPeer];
    if (!mine) return;
    for (const m of mine.m ?? []) this.dispatch('message', JSON.stringify(m));
    const base = this.bases.get(q);
    if (mine.s && base) this.dispatch('message', JSON.stringify({ ...base, ack: mine.s.a, me: mine.s.me }));
  }

  private end(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    window.clearInterval(this.timer);
    for (const off of this.off) off();
    void this.named.leave().catch(() => {});
    window.setTimeout(() => this.dispatch('close'), 0); // like a WebSocket: close arrives after the call
  }

  close(): void { this.end(); }
}

/** Join a hosted room by code. Resolves a socket once the host is found in the room. */
export async function joinHostedRoom(code: string): Promise<SocketLike> {
  const api = await roomApi();
  if (!api) throw new Error('O online deste artefato precisa do claude.ai (abra o link do artefato com sua conta).');
  const named = await api.join(roomName(code));
  const started = performance.now();
  let host: Peer | undefined;
  while (!(host = named.peers().find((p) => !p.sameTab && p.presence?.role === 'host')) && performance.now() - started < 6000) {
    await new Promise((r) => window.setTimeout(r, 200));
  }
  if (!host) { void named.leave().catch(() => {}); throw new Error('Sala não encontrada. Confira o código e se o anfitrião está com o jogo aberto.'); }
  return new RemoteSocket(named, host.peer);
}

function cleanName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  return text.normalize('NFKC').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().toUpperCase().slice(0, 16) || 'PILOTO';
}

/**
 * 30 Hz callback that keeps running while the tab is in the background: browsers throttle timers in
 * hidden tabs to about once a second, but not a worker's timer posting messages to the page.
 */
function startTicker(fn: () => void): () => void {
  try {
    const source = 'setInterval(() => postMessage(0), 1000 / 30);';
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = () => fn();
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = window.setInterval(fn, 1000 / 30);
    return () => window.clearInterval(id);
  }
}
