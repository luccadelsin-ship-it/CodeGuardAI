/**
 * Map editor: a top-down canvas over one of the four base arenas. Pieces are real
 * collision/cover in the shared arena code, so a created map plays exactly like
 * the built-in ones (cover, standable tops, line of sight, jump pads, AI navigation).
 */
import { EDITOR_PIECES, createArena, sanitizeCustomMap, type Arena, type ArenaLayout, type CustomMap } from '../shared/arena';
import { MAPS, MAP_ORDER, type MapId } from '../shared/maps';

const STORE = 'mecha-mayhem:custom-maps';
const RANGE = 42;

export function loadCustomMaps(): CustomMap[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? '[]') as unknown[];
    return list.map(sanitizeCustomMap).filter((m): m is CustomMap => !!m);
  } catch { return []; }
}

function saveCustomMaps(list: CustomMap[]): void {
  try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 12))); } catch { /* storage full or private */ }
}

export function findCustomMap(id: string | null): CustomMap | null {
  return id ? loadCustomMaps().find((m) => m.id === id) ?? null : null;
}

/** Shareable text code for a map (base64 JSON). */
export function exportCode(map: CustomMap): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(map))));
}

export function importCode(code: string): CustomMap | null {
  try { return sanitizeCustomMap({ ...JSON.parse(decodeURIComponent(escape(atob(code.trim())))), id: `map-${Date.now()}` }); } catch { return null; }
}

export interface EditorCallbacks { toast(text: string): void; play(map: CustomMap): void }

export class MapEditor {
  private map: CustomMap = { id: `map-${Date.now()}`, name: 'MEU MAPA', base: 'frozen', cover: [], pads: [] };
  private layout: ArenaLayout | null = null;
  private arena: Arena | null = null;
  private tool = 'barricade';
  private rotated = false;
  private hover: { x: number; z: number } | null = null;
  private readonly canvas: HTMLCanvasElement;

  constructor(private readonly root: HTMLElement, private readonly cb: EditorCallbacks) {
    root.innerHTML = `
      <div class="editor-tools">
        <label class="field"><span>NOME</span><input id="ed-name" maxlength="24" /></label>
        <label class="field"><span>ARENA BASE</span><select id="ed-base">${MAP_ORDER.map((id) => `<option value="${id}">${MAPS[id].label}</option>`).join('')}</select></label>
        <div class="ed-palette" id="ed-palette">${Object.entries(EDITOR_PIECES).map(([id, p]) => `<button class="chip" data-tool="${id}">${p.label}</button>`).join('')}<button class="chip" data-tool="erase">APAGAR</button></div>
        <div class="ed-row"><button class="chip" id="ed-rotate">GIRAR (R)</button><button class="chip" id="ed-clear">LIMPAR</button><button class="chip" id="ed-new">NOVO</button></div>
        <div class="ed-row"><button class="chip" id="ed-save">SALVAR</button><button class="primary-action compact" id="ed-play"><span class="action-icon">▶</span><span><small>TREINO NESTE MAPA</small><strong>JOGAR</strong></span><span class="action-arrow">↗</span></button></div>
        <label class="field"><span>CÓDIGO PARA COMPARTILHAR</span><input id="ed-code" spellcheck="false" placeholder="Cole um código e toque em IMPORTAR" /></label>
        <div class="ed-row"><button class="chip" id="ed-export">GERAR CÓDIGO</button><button class="chip" id="ed-import">IMPORTAR</button></div>
        <div class="ed-saved" id="ed-saved"></div>
        <p class="ed-help">Toque/clique para colocar. Peças só entram sobre o piso e fora do ponto de início. Até 60 peças e 8 plataformas de salto. Mapas criados valem no treino.</p>
      </div>
      <div class="editor-canvas-wrap"><canvas id="ed-canvas" width="720" height="720" aria-label="Planta do mapa"></canvas><div class="ed-count" id="ed-count"></div></div>`;
    this.canvas = root.querySelector('#ed-canvas') as HTMLCanvasElement;
    const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
    $<HTMLInputElement>('ed-name').addEventListener('input', (e) => { this.map.name = (e.target as HTMLInputElement).value.toUpperCase() || 'MEU MAPA'; });
    $<HTMLSelectElement>('ed-base').addEventListener('change', (e) => { this.map.base = (e.target as HTMLSelectElement).value as MapId; this.map.cover = []; this.map.pads = []; void this.loadBase(); });
    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => { this.tool = b.dataset.tool!; this.syncTools(); }));
    $('ed-rotate').addEventListener('click', () => { this.rotated = !this.rotated; this.draw(); });
    $('ed-clear').addEventListener('click', () => { this.map.cover = []; this.map.pads = []; this.draw(); });
    $('ed-new').addEventListener('click', () => { this.open({ id: `map-${Date.now()}`, name: 'MEU MAPA', base: this.map.base, cover: [], pads: [] }); });
    $('ed-save').addEventListener('click', () => { this.save(); this.cb.toast(`MAPA "${this.map.name}" SALVO`); });
    $('ed-play').addEventListener('click', () => { this.save(); this.cb.play(this.map); });
    $('ed-export').addEventListener('click', () => { $<HTMLInputElement>('ed-code').value = exportCode(this.map); this.cb.toast('CÓDIGO GERADO · COPIE E ENVIE'); });
    $('ed-import').addEventListener('click', () => {
      const map = importCode($<HTMLInputElement>('ed-code').value);
      if (!map) { this.cb.toast('CÓDIGO INVÁLIDO'); return; }
      this.open(map); this.save(); this.cb.toast(`MAPA "${map.name}" IMPORTADO`);
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyR' && root.offsetParent) { this.rotated = !this.rotated; this.draw(); } });
    const toWorld = (ev: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width * 2 - 1) * RANGE;
      const z = -((ev.clientY - r.top) / r.height * 2 - 1) * RANGE;
      return { x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2 };
    };
    this.canvas.addEventListener('pointermove', (ev) => { this.hover = toWorld(ev); this.draw(); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    this.canvas.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.apply(toWorld(ev)); });
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.syncTools();
  }

  open(map?: CustomMap): void {
    if (map) this.map = structuredClone(map);
    (this.root.querySelector('#ed-name') as HTMLInputElement).value = this.map.name;
    (this.root.querySelector('#ed-base') as HTMLSelectElement).value = this.map.base;
    void this.loadBase();
    this.renderSaved();
  }

  private async loadBase(): Promise<void> {
    const res = await fetch(`/assets/models/${MAPS[this.map.base].layoutFile}`);
    this.layout = await res.json() as ArenaLayout;
    this.rebuildArena();
    this.draw();
  }

  private rebuildArena(): void {
    if (this.layout) this.arena = createArena(this.layout, { mapId: this.map.base, custom: this.map });
  }

  private piece(at: { x: number; z: number }) {
    const p = EDITOR_PIECES[this.tool];
    const wx = this.rotated ? p.widthZ : p.widthX, wz = this.rotated ? p.widthX : p.widthZ;
    return { x: at.x, z: at.z, widthX: wx, widthZ: wz, height: p.height, kind: p.kind };
  }

  /** A placement is valid on the deck, away from the training start, and not overlapping other pieces. */
  private valid(at: { x: number; z: number }): boolean {
    if (!this.arena || this.tool === 'erase') return false;
    const p = this.piece(at);
    if (!this.arena.onDeck(p.x, p.z, 0)) return false;
    if (Math.hypot(p.x, p.z) < (p.widthX + p.widthZ) / 4 + 1.6) return false;
    const overlap = (a: { x: number; z: number; widthX: number; widthZ: number }) => Math.abs(a.x - p.x) * 2 < a.widthX + p.widthX && Math.abs(a.z - p.z) * 2 < a.widthZ + p.widthZ;
    if (p.kind === 'pad') return this.map.pads.length < 8 && !this.map.pads.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2.4) && !this.arena.staticCover.some(overlap);
    return this.map.cover.length < 60 && !this.arena.staticCover.some(overlap) && !this.map.pads.some((q) => overlap({ x: q.x, z: q.z, widthX: 2.2, widthZ: 2.2 }));
  }

  private apply(at: { x: number; z: number }): void {
    if (this.tool === 'erase') {
      const hit = this.map.cover.findIndex((c) => Math.abs(c.x - at.x) * 2 <= c.widthX + 0.6 && Math.abs(c.z - at.z) * 2 <= c.widthZ + 0.6);
      if (hit >= 0) this.map.cover.splice(hit, 1);
      else { const pad = this.map.pads.findIndex((q) => Math.hypot(q.x - at.x, q.z - at.z) < 1.6); if (pad >= 0) this.map.pads.splice(pad, 1); }
    } else if (this.valid(at)) {
      const p = this.piece(at);
      if (p.kind === 'pad') this.map.pads.push({ x: p.x, z: p.z });
      else this.map.cover.push({ x: p.x, z: p.z, widthX: p.widthX, widthZ: p.widthZ, height: p.height, kind: p.kind });
    } else { this.cb.toast('LOCAL INVÁLIDO · USE O PISO, LONGE DO INÍCIO E DE OUTRAS PEÇAS'); return; }
    this.rebuildArena();
    this.draw();
  }

  private save(): void {
    const list = loadCustomMaps().filter((m) => m.id !== this.map.id);
    list.unshift(structuredClone(this.map));
    saveCustomMaps(list);
    this.renderSaved();
  }

  private renderSaved(): void {
    const box = this.root.querySelector('#ed-saved') as HTMLElement;
    const list = loadCustomMaps();
    box.innerHTML = list.length ? `<span class="eyebrow">MAPAS SALVOS</span>${list.map((m) => `<div class="ed-saved-row"><button class="chip" data-open="${m.id}">${m.name} · ${MAPS[m.base].label}</button><button class="chip" data-del="${m.id}">✕</button></div>`).join('')}` : '';
    box.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => { const m = findCustomMap(b.dataset.open!); if (m) this.open(m); }));
    box.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', () => { saveCustomMaps(loadCustomMaps().filter((m) => m.id !== b.dataset.del)); this.renderSaved(); }));
  }

  private syncTools(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === this.tool));
    this.draw();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.layout || !this.arena) return;
    const W = this.canvas.width, s = W / (RANGE * 2);
    const px = (x: number) => (x + RANGE) * s, pz = (z: number) => (RANGE - z) * s;
    ctx.fillStyle = '#061320'; ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(97,232,255,0.07)'; ctx.lineWidth = 1;
    for (let g = -40; g <= 40; g += 4) { ctx.beginPath(); ctx.moveTo(px(g), 0); ctx.lineTo(px(g), W); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, pz(g)); ctx.lineTo(W, pz(g)); ctx.stroke(); }
    ctx.fillStyle = '#1d3a4c';
    const L = this.layout;
    const circle = (x: number, z: number, r: number) => { ctx.beginPath(); ctx.arc(px(x), pz(z), r * s, 0, Math.PI * 2); ctx.fill(); };
    circle(L.centralArena.x, L.centralArena.z, L.centralArena.radius);
    for (const st of L.stations) circle(st.x, st.z, st.radius);
    for (const b of L.bridges) ctx.fillRect(px(b.x - b.widthX / 2), pz(b.z + b.widthZ / 2), b.widthX * s, b.widthZ * s);
    const box = (c: { x: number; z: number; widthX: number; widthZ: number }, fill: string) => { ctx.fillStyle = fill; ctx.fillRect(px(c.x - c.widthX / 2), pz(c.z + c.widthZ / 2), c.widthX * s, c.widthZ * s); };
    for (const c of this.arena.staticCover) if (!this.map.cover.some((m) => m.x === c.x && m.z === c.z && m.kind === c.kind)) box(c, '#4b5d69');
    const colors: Record<string, string> = { barricade: '#61e8ff', block: '#9fc3d6', wall: '#fa74ff', pillar: '#ffb347', pipe: '#ff7937', ore: '#d99a5b', dais: '#5dffa8' };
    for (const c of this.map.cover) box(c, colors[c.kind ?? 'block'] ?? '#fff');
    ctx.fillStyle = '#ffe14a';
    for (const p of this.map.pads) { ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), 1.1 * s, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#ffffff'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(px(0), pz(0), 1.6 * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.font = '700 12px Rajdhani, sans-serif'; ctx.fillText('INÍCIO', px(0) - 18, pz(0) + 4);
    if (this.hover && this.tool !== 'erase') {
      const p = this.piece(this.hover);
      ctx.globalAlpha = 0.6;
      if (p.kind === 'pad') { ctx.fillStyle = this.valid(this.hover) ? '#ffe14a' : '#ff3a2a'; ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), 1.1 * s, 0, Math.PI * 2); ctx.fill(); }
      else box(p, this.valid(this.hover) ? '#ffffff' : '#ff3a2a');
      ctx.globalAlpha = 1;
    }
    (this.root.querySelector('#ed-count') as HTMLElement).textContent = `${this.map.cover.length}/60 PEÇAS · ${this.map.pads.length}/8 SALTOS · ${MAPS[this.map.base].label}`;
  }
}
