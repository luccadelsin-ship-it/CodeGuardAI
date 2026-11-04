import { Engine, HavokPlugin, Scene, Vector3 } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { CombatGame, type HudState, type Marker, type RadarState, type ResultInfo } from './game/combat';
import { DIFFICULTIES, type Difficulty } from './game/drones';
import type { MechPalette } from './game/mech';
import { TouchControls, isTouchDevice } from './game/touch';
import { THEMES, createWorld, type ThemeId } from './game/world';
import { OnlineSession, defaultServerUrl, type ScoreRow } from './net/online';
import { MODE_RULES, type OnlineMode } from './shared/protocol';
import { WEAPONS, WEAPON_ORDER, isWeaponId, type WeaponId } from './shared/weapons';
import { PART_STYLES, normalizeParts, type MechPartConfig } from './shared/customization';
import { MAPS, MAP_ORDER, mapFromSearch, type MapId } from './shared/maps';
import { FAMILIES, FAMILY_ORDER, computeLoadout, type FamilyId } from './shared/parts';
import './style.css';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`UI element missing: ${id}`);
  return element as T;
};

const canvas = el<HTMLCanvasElement>('game-canvas');
const loading = el('loading');
const progressFill = el('loading-fill');
const progressLabel = el('loading-label');
const progressPercent = el('loading-percent');
const screenIds = ['menu', 'lobby', 'garage', 'online', 'settings', 'credits', 'pause', 'result'] as const;
type UiScreen = typeof screenIds[number] | 'game';
let currentScreen: UiScreen = 'menu';
let game: CombatGame;
let touch: TouchControls;
let online: OnlineSession | null = null;
let toastTimer = 0;
let hitTimer = 0;
let bannerTimer = 0;
let rotateTimer = 0;
let scoreboardHeld = false;
let garageReturn: 'menu' | 'lobby' = 'menu';
let partConfig: MechPartConfig = normalizeParts(null);
const selectedMap = mapFromSearch(location.search);

function progress(percent: number, label: string): void {
  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressLabel.textContent = label;
}

function show(screen: UiScreen): void {
  currentScreen = screen;
  for (const id of screenIds) el(id).classList.toggle('hidden', id !== screen);
  const inGame = screen === 'game' || screen === 'pause' || screen === 'result';
  el('hud').classList.toggle('hidden', !inGame);
  document.body.dataset.screen = screen;
  if (screen !== 'game') el('controls-tip').classList.remove('hidden');
  if (screen === 'game' && document.body.classList.contains('touch-mode') && innerHeight > innerWidth) {
    const hint = el('rotate-hint');
    hint.classList.remove('hidden');
    window.clearTimeout(rotateTimer);
    rotateTimer = window.setTimeout(() => hint.classList.add('hidden'), 3500);
  } else el('rotate-hint').classList.add('hidden');
}

function saveSetting(key: string, value: string): void {
  try { localStorage.setItem(`mecha-mayhem:${key}`, value); } catch { /* Storage can be unavailable in private mode. */ }
}

function loadSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(`mecha-mayhem:${key}`) ?? fallback; } catch { return fallback; }
}

function changeMap(id: MapId, lobby = false): void {
  const url = new URL(location.href);
  if (id === 'frozen') url.searchParams.delete('map'); else url.searchParams.set('map', id);
  if (lobby) url.searchParams.set('lobby', '1'); else url.searchParams.delete('lobby');
  location.href = url.href;
}

function refreshLoadout(): void {
  const label = (style: string) => PART_STYLES.find((part) => part.id === style)?.name ?? 'Striker';
  el('lobby-loadout').textContent = `${label(partConfig.head)} / ${label(partConfig.torso)} / ${label(partConfig.legs)}`;
  el<HTMLSelectElement>('lobby-weapon').value = game.currentWeapon;
  el<HTMLSelectElement>('lobby-difficulty').value = game.difficulty;
}

function openLobby(): void {
  game.setMode('garage');
  refreshLoadout();
  show('lobby');
}

function buildLobby(): void {
  const maps = el('lobby-maps');
  maps.replaceChildren();
  for (const id of MAP_ORDER) {
    const map = MAPS[id];
    const card = document.createElement('button');
    card.className = `map-card${id === selectedMap ? ' selected' : ''}`;
    card.dataset.map = id;
    card.style.setProperty('--map-color', map.color);
    card.setAttribute('aria-pressed', `${id === selectedMap}`);
    card.innerHTML = `<span class="map-card-art"><i></i><b>${id === selectedMap ? 'SELECIONADO' : 'EXPLORAR'}</b></span><strong>${map.name}</strong><small>${map.detail}</small>`;
    card.addEventListener('click', () => { if (id !== selectedMap) changeMap(id, true); });
    maps.append(card);
  }
  el('lobby-map-count').textContent = `${MAP_ORDER.length} ARENAS`;
  const weapons = el<HTMLSelectElement>('lobby-weapon');
  weapons.replaceChildren(...WEAPON_ORDER.map((id) => new Option(WEAPONS[id].name, id)));
  weapons.addEventListener('change', () => selectWeapon(weapons.value as WeaponId));
  refreshLoadout();
}

type CatalogPart = { id: string; category: string; image: string; imageStatus: string; modelStatus: string };
let catalogParts: CatalogPart[] = [];
let activeSlot: 'head' | 'torso' | 'legs' = 'head';
const slotCategory = { head: 'heads', torso: 'torsos', legs: 'legs' } as const;

function partImage(slot: 'head' | 'torso' | 'legs', family: FamilyId): string | null {
  const entry = catalogParts.find((p) => p.id === `${slotCategory[slot]}-${family}`);
  return entry && entry.imageStatus === 'ready' ? entry.image : null;
}

function renderPartGrid(): void {
  const grid = el('part-grid');
  grid.replaceChildren();
  for (const id of FAMILY_ORDER) {
    const fam = FAMILIES[id];
    const button = document.createElement('button');
    button.className = `part-card${partConfig[activeSlot] === id ? ' active' : ''}`;
    button.dataset.family = id;
    button.style.setProperty('--fam', fam.accent);
    const img = partImage(activeSlot, id);
    button.innerHTML = `${img ? `<img src="${img}" alt="" loading="lazy" />` : '<span class="part-missing">REF. PENDENTE</span>'}<strong>${fam.name}</strong>`;
    button.title = fam.detail;
    button.addEventListener('click', () => {
      partConfig = normalizeParts({ ...partConfig, [activeSlot]: id });
      game.setChassis(partConfig);
      saveSetting('parts', JSON.stringify(partConfig));
      renderParts();
      refreshLoadout();
    });
    grid.append(button);
  }
}

function renderChassisStats(): void {
  const lo = computeLoadout(partConfig, game.currentWeapon);
  const slot = FAMILIES[partConfig[activeSlot]];
  const part = slot[activeSlot];
  const img = partImage(activeSlot, partConfig[activeSlot]);
  el('part-preview').innerHTML = `${img ? `<img src="${img}" alt="Referência ${slot.name}" />` : '<span class="part-missing big">IMAGEM DE REFERÊNCIA PENDENTE</span>'}<div><span class="eyebrow">${activeSlot === 'head' ? 'CABEÇA' : activeSlot === 'torso' ? 'TRONCO + BRAÇOS' : 'PERNAS'}</span><strong>${slot.name}</strong><small>${slot.detail}</small><dl><dt>PESO</dt><dd>${part.weight} kg</dd><dt>SUSTENTA</dt><dd>${part.support} kg</dd><dt>INTEGRIDADE</dt><dd>${part.durability}</dd><dt>BLINDAGEM</dt><dd>${part.armor}%</dd>${'energy' in part ? `<dt>ENERGIA</dt><dd>${part.energy}</dd>` : ''}${'speed' in part ? `<dt>VELOCIDADE</dt><dd>${part.speed} m/s</dd>` : ''}</dl></div>`;
  const pct = (v: number) => Math.round(v * 100);
  const bar = (label: string, load: number, cap: number) => {
    const ratio = load / cap;
    return `<div class="load-row${ratio > 1.35 ? ' over' : ratio > 1 ? ' warn' : ''}"><span>${label}</span><div class="load-bar"><i style="width:${Math.min(100, ratio / 1.35 * 100)}%"></i><em></em></div><b>${load} / ${cap} kg · ${pct(ratio)}%</b></div>`;
  };
  const status = lo.rejected ? `<p class="load-status over">EXCEDE O LIMITE (${pct(lo.load)}% &gt; 135%): troque por pernas/tronco mais fortes ou uma arma mais leve.</p>`
    : lo.overloaded ? `<p class="load-status warn">SOBRECARGA ${pct(lo.load)}%: velocidade −${Math.round((1 - Math.max(0.55, 1 - (lo.load - 1) * 1.15)) * 100)}%, pulo −${Math.round((1 - lo.jumpMul) * 100)}%, energia +${Math.round((lo.load - 1) * 150)}% mais cara.</p>`
    : `<p class="load-status ok">CARGA OK (${pct(lo.load)}%) · sem penalidades.</p>`;
  el('chassis-stats').innerHTML = `<div class="stat-grid"><div><span>PESO TOTAL</span><b>${lo.weight} kg</b></div><div><span>INTEGRIDADE</span><b>${lo.durability}</b></div><div><span>BLINDAGEM</span><b>${lo.armor}%</b></div><div><span>ENERGIA</span><b>${lo.energyCapacity}</b></div><div><span>VELOCIDADE</span><b>${lo.speed} m/s</b></div><div><span>DANO RECEBIDO</span><b>${Math.round(lo.damageMul * 100)}%</b></div></div>${bar('PERNAS', lo.legsLoad, lo.legsCapacity)}${bar('TRONCO', lo.torsoLoad, lo.torsoCapacity)}${status}`;
  for (const id of ['garage-play', 'lobby-launch'] as const) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) { button.disabled = lo.rejected; button.title = lo.rejected ? 'Chassi acima do limite de carga' : ''; }
  }
  for (const s of ['head', 'torso', 'legs'] as const) el(`tab-${s}`).textContent = FAMILIES[partConfig[s]].name;
}

function renderParts(): void { renderPartGrid(); renderChassisStats(); }

function bindPartCustomization(): void {
  try { partConfig = normalizeParts(JSON.parse(loadSetting('parts', '{}'))); } catch { partConfig = normalizeParts(null); }
  document.querySelectorAll<HTMLButtonElement>('.part-tab').forEach((tab) => tab.addEventListener('click', () => {
    activeSlot = tab.dataset.slot as typeof activeSlot;
    document.querySelectorAll('.part-tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderParts();
  }));
  game.setChassis(partConfig);
  renderParts();
  void fetch('/assets/modular/catalog.json').then((r) => r.json()).then((c: { parts: CatalogPart[] }) => { catalogParts = c.parts; renderParts(); }).catch(() => { /* images are optional */ });
}

function toast(message: string): void {
  const node = el('toast');
  node.textContent = message;
  node.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.add('hidden'), 2300);
}

function banner(title: string, subtitle: string): void {
  const node = el('banner');
  el('banner-title').textContent = title;
  el('banner-sub').textContent = subtitle;
  node.classList.remove('hidden', 'show');
  void node.offsetWidth;
  node.classList.add('show');
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => node.classList.add('hidden'), 2900);
}

function feed(text: string): void {
  const list = el('feed');
  const item = document.createElement('div');
  item.textContent = text;
  list.prepend(item);
  while (list.children.length > 5) list.lastElementChild?.remove();
  window.setTimeout(() => item.classList.add('fade'), 4200);
  window.setTimeout(() => item.remove(), 5000);
}

function hit(critical: boolean, kill: boolean): void {
  const node = el('hitmarker');
  node.classList.remove('hidden');
  node.classList.toggle('crit', critical);
  node.classList.toggle('kill', kill);
  window.clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => node.classList.add('hidden'), kill ? 260 : 120);
}

function damage(angle: number, amount: number): void {
  const flash = el('damage-flash');
  flash.style.opacity = `${Math.min(1, 0.35 + amount / 25)}`;
  window.setTimeout(() => { flash.style.opacity = '0'; }, 110);
  const arc = document.createElement('div');
  arc.className = 'damage-arc';
  arc.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  el('damage-dirs').append(arc);
  window.setTimeout(() => arc.remove(), 900);
}

function floatText(x: number, y: number, text: string, kind: string): void {
  const node = document.createElement('div');
  node.className = `float ${kind}`;
  node.textContent = text;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  el('floats').append(node);
  window.setTimeout(() => node.remove(), 900);
}

const markerNodes = new Map<string, HTMLElement>();
function updateMarkers(markers: Marker[]): void {
  const root = el('markers');
  const seen = new Set<string>();
  for (const m of markers) {
    seen.add(m.id);
    let node = markerNodes.get(m.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'marker';
      node.innerHTML = '<span class="marker-name"></span><div class="marker-bar"><div></div></div>';
      root.append(node);
      markerNodes.set(m.id, node);
    }
    const visible = m.onScreen && m.distance < (m.boss ? 120 : 55);
    node.style.display = visible ? 'block' : 'none';
    if (!visible) continue;
    node.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, -100%)`;
    node.classList.toggle('boss', m.boss);
    node.classList.toggle('alert', m.alert);
    (node.firstElementChild as HTMLElement).textContent = m.alert ? `⚠ ${m.name}` : m.name;
    ((node.lastElementChild as HTMLElement).firstElementChild as HTMLElement).style.width = `${Math.max(0, m.health) * 100}%`;
  }
  for (const [id, node] of markerNodes) if (!seen.has(id)) { node.remove(); markerNodes.delete(id); }
}

function drawRadar(radar: RadarState): void {
  const c = el<HTMLCanvasElement>('radar');
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const size = c.width, half = size / 2, range = 42;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, half - 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(3,17,29,0.78)';
  ctx.fill();
  ctx.clip();
  ctx.translate(half, half);
  ctx.rotate(radar.yaw);
  const scale = (half - 6) / range;
  const toMap = (x: number, z: number) => [(x - radar.x) * scale, -(z - radar.z) * scale] as const;
  // Arena silhouette: centre ring, stations and bridges.
  ctx.strokeStyle = 'rgba(120,200,230,0.35)';
  ctx.fillStyle = 'rgba(120,200,230,0.08)';
  ctx.lineWidth = 1;
  const circle = (x: number, z: number, r: number) => { const [px, py] = toMap(x, z); ctx.beginPath(); ctx.arc(px, py, r * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  circle(0, 0, 9.7);
  for (const [x, z] of [[27, 0], [-27, 0], [0, 27], [0, -27]]) circle(x, z, 7.3);
  for (const [x, z, w, d] of [[17, 0, 15.5, 5.3], [-17, 0, 15.5, 5.3], [0, 17, 5.3, 15.5], [0, -17, 5.3, 15.5]]) {
    const [px, py] = toMap(x, z);
    ctx.fillRect(px - (w / 2) * scale, py - (d / 2) * scale, w * scale, d * scale);
  }
  for (const contact of radar.contacts) {
    const [px, py] = toMap(contact.x, contact.z);
    ctx.fillStyle = contact.kind === 'pickup' ? '#5dffa8' : contact.kind === 'boss' ? '#ff3a2a' : contact.kind === 'flyer' ? '#ffb347' : contact.kind === 'player' ? '#ff6bd5' : '#ff5a3c';
    ctx.beginPath();
    ctx.arc(px, py, contact.kind === 'boss' ? 5 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(97,232,255,0.6)';
  ctx.beginPath(); ctx.arc(half, half, half - 2, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#61e8ff';
  ctx.beginPath(); ctx.moveTo(half, half - 7); ctx.lineTo(half - 5, half + 5); ctx.lineTo(half + 5, half + 5); ctx.closePath(); ctx.fill();
}

function weaponLabel(id: WeaponId): string {
  const def = WEAPONS[id];
  return `${def.name} <i>${def.mark}</i>`;
}

let lastWeapon: WeaponId | null = null;
function updateHud(state: HudState): void {
  el('health-number').textContent = `${Math.ceil(state.health)}`;
  el('energy-number').textContent = `${Math.ceil(state.energy)}`;
  el('health-fill').style.width = `${state.health}%`;
  el('health-fill').parentElement!.classList.toggle('low', state.health < 30);
  el('energy-fill').style.width = `${state.energy}%`;
  const def = WEAPONS[state.weapon];
  if (def.kind === 'charge') {
    el('heat-fill').style.width = `${state.charge * 100}%`;
    el('heat-label').textContent = state.charge > 0 ? `CARGA ${Math.round(state.charge * 100)}%` : 'SEGURE PARA CARREGAR';
  } else {
    el('heat-fill').style.width = `${state.heat}%`;
    el('heat-label').textContent = state.overheated ? 'SUPERAQUECIDA' : `CALOR ${Math.round(state.heat)}%`;
  }
  el('heat-fill').parentElement!.classList.toggle('overheat', state.overheated);
  el('heat-fill').parentElement!.classList.toggle('charge', def.kind === 'charge');
  el('score').textContent = `${state.score}`.padStart(4, '0');
  const combo = el('combo');
  combo.classList.toggle('hidden', state.combo <= 1);
  combo.textContent = `COMBO ×${state.combo}`;
  el('objective').textContent = state.objective;
  el('hud-mission').textContent = state.session === 'online' ? `ONLINE · ${online?.room ?? ''} · ${online?.ping ?? 0} MS${online && !['ffa', 'duel'].includes(online.mode) ? ` · 🔵 ${Math.floor(online.teamScores[0])} × ${Math.floor(online.teamScores[1])} 🟠${online.mode === 'core' ? ` · CORE ${online.coreOwner?.toUpperCase() ?? 'NEUTRO'}` : ''}` : ''}` : `MISSÃO 01 / ${DIFFICULTIES[game.difficulty].label}`;
  for (const [key, cd] of [['dash', state.dashCooldown], ['shield', state.shieldCooldown], ['impact', state.impactCooldown]] as const) {
    el(`${key}-status`).textContent = cd <= 0 ? 'PRONTO' : `${cd.toFixed(1)} S`;
    el(`${key}-ability`).classList.toggle('cooldown', cd > 0);
  }
  el('shield-ability').classList.toggle('active', state.shield);
  el('fps').textContent = `${Math.round(state.fps)} FPS`;
  const pips = el('wave-pips');
  if (state.session === 'training') {
    if (pips.childElementCount !== state.waveCount) pips.innerHTML = Array.from({ length: state.waveCount }, () => '<i></i>').join('');
    [...pips.children].forEach((pip, i) => { pip.classList.toggle('done', i < state.wave - 1 || (i < state.wave && state.enemiesLeft === 0)); pip.classList.toggle('current', i === state.wave - 1 && state.enemiesLeft > 0); });
  } else pips.innerHTML = '';
  const crosshair = el('crosshair');
  crosshair.dataset.weapon = state.weapon;
  crosshair.style.setProperty('--charge', `${state.charge}`);
  if (state.weapon !== lastWeapon) {
    lastWeapon = state.weapon;
    el('weapon-name').innerHTML = weaponLabel(state.weapon);
    document.querySelectorAll('#weapon-slots button').forEach((slot) => slot.classList.toggle('active', (slot as HTMLElement).dataset.weapon === state.weapon));
  }
}

function renderScoreboard(rows: ScoreRow[]): void {
  const board = el('scoreboard');
  board.innerHTML = `<div class="sb-head"><span>PILOTO</span><span>A</span><span>M</span><span>PTS</span><span>MS</span></div>` +
    rows.map((r) => `<div class="sb-row${r.me ? ' me' : ''}" data-team="${r.team ?? 'none'}"><span>${r.team === 'blue' ? '🔵 ' : r.team === 'orange' ? '🟠 ' : ''}${escapeHtml(r.name)}</span><span>${r.kills}</span><span>${r.deaths}</span><span>${r.score}</span><span>${r.ping}</span></div>`).join('');
  board.classList.toggle('hidden', !(scoreboardHeld || (online && online.phase !== 'playing')));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function bestKey(difficulty: Difficulty): string { return `best-${difficulty}`; }

function showResult(result: ResultInfo): void {
  el('result-kicker').textContent = result.kicker;
  el('result-title').textContent = result.title;
  el('result-detail').textContent = result.detail;
  el('result-score').textContent = `${result.score}`;
  const isOnline = game.session === 'online';
  if (!isOnline) {
    const best = Number(loadSetting(bestKey(result.difficulty), '0'));
    if (result.score > best) { saveSetting(bestKey(result.difficulty), `${result.score}`); el('result-best').textContent = 'NOVO RECORDE!'; }
    else el('result-best').textContent = `RECORDE ${best}`;
    refreshBest();
  } else el('result-best').textContent = 'PRÓXIMA PARTIDA COMEÇA AUTOMATICAMENTE';
  el('result-stats').innerHTML = result.stats.map(([k, v]) => `<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('');
  el('retry-button').querySelector('small')!.textContent = isOnline ? 'MESMA SALA' : 'REINICIAR SIMULAÇÃO';
  el('retry-button').querySelector('strong')!.textContent = isOnline ? 'CONTINUAR' : 'JOGAR DE NOVO';
  show('result');
}

function refreshBest(): void {
  el('best-score').textContent = loadSetting(bestKey(game.difficulty), '0');
}

function applyTouchMode(): void {
  const setting = loadSetting('touch', 'auto');
  const on = setting === 'on' || (setting === 'auto' && (isTouchDevice() || document.body.dataset.touched === '1'));
  document.body.classList.toggle('touch-mode', on);
  touch.setVisible(on && currentScreen === 'game');
}

function buildWeaponUi(): void {
  const cards = el('weapon-cards');
  cards.innerHTML = '';
  const slots = el('weapon-slots');
  slots.innerHTML = '';
  for (const id of WEAPON_ORDER) {
    const def = WEAPONS[id];
    const card = document.createElement('button');
    card.className = 'weapon-card';
    card.dataset.weapon = id;
    card.innerHTML = `<span class="slot">${def.slot}</span><strong>${def.name}</strong><small>${def.mark}</small>`;
    card.addEventListener('click', () => selectWeapon(id));
    cards.append(card);
    const slot = document.createElement('button');
    slot.dataset.weapon = id;
    slot.textContent = `${def.slot}`;
    slot.title = def.name;
    slot.addEventListener('click', () => { game.setWeapon(id); });
    slots.append(slot);
  }
}

function selectWeapon(id: WeaponId): void {
  game.setWeapon(id);
  saveSetting('weapon', id);
  el<HTMLSelectElement>('lobby-weapon').value = id;
  document.querySelectorAll('.weapon-card').forEach((card) => card.classList.toggle('active', (card as HTMLElement).dataset.weapon === id));
  if (document.getElementById('chassis-stats')) renderChassisStats();
  const def = WEAPONS[id];
  const bar = (label: string, value: number) => `<div class="stat"><span>${label}</span><div><i style="width:${value}%"></i></div></div>`;
  el('weapon-detail').innerHTML = `<p>${def.description}</p>${bar('DANO', def.stats.damage)}${bar('CADÊNCIA', def.stats.rate)}${bar('ALCANCE', def.stats.range)}${bar('CONTROLE', def.stats.control)}`;
}

let themeIndex = 0;
function applyTheme(index: number): void {
  themeIndex = (index + THEMES.length) % THEMES.length;
  const theme = THEMES[themeIndex];
  game.world.setTheme(theme.id);
  el('theme-name').textContent = theme.label;
  el('theme-detail').textContent = theme.detail;
  el('theme-index').textContent = `${String(themeIndex + 1).padStart(2, '0')} / ${String(THEMES.length).padStart(2, '0')}`;
  el('intel-map').dataset.theme = theme.id;
  saveSetting('theme', theme.id);
}

async function joinOnline(mode: OnlineMode, room?: string, create?: boolean): Promise<void> {
  const status = el('online-status');
  const name = (el<HTMLInputElement>('pilot-name').value.trim() || 'PILOTO').toUpperCase().slice(0, 16);
  saveSetting('pilot', name);
  const url = el<HTMLInputElement>('server-url').value.trim() || defaultServerUrl();
  saveSetting('server', url === defaultServerUrl() ? '' : url);
  status.textContent = 'CONECTANDO AO SERVIDOR…';
  status.classList.remove('error');
  document.querySelectorAll<HTMLButtonElement>('#online button').forEach((b) => { b.disabled = true; });
  try {
    online?.leave();
    game.sfx.unlock();
    const session = await OnlineSession.connect(game, game.camera.getScene(), {
      url, name, palette: loadSetting('palette', 'arctic') as MechPalette, weapon: game.currentWeapon, parts: partConfig, mode, room, create,
    }, {
      onFeed: feed,
      onBanner: banner,
      onScoreboard: renderScoreboard,
      onStatus: toast,
      onClosed: (reason) => { if (game.session === 'online') { game.leaveSession(); game.setMode('menu'); show('menu'); toast(reason); } online = null; },
    });
    online = session;
    status.textContent = '';
    el('online-ping').textContent = `SALA ${session.room}`;
    const spawn = game.world.arena.spawnPoints[0];
    game.startOnline(session, new Vector3(spawn.x, spawn.y, spawn.z), spawn.yaw);
    if (session.team) game.setPalette(session.team === 'blue' ? 'arctic' : 'ember');
    show('game');
    banner(session.isPrivate ? `SALA ${session.room}` : 'CONECTADO', session.isPrivate ? 'COMPARTILHE O CÓDIGO COM SEU OPONENTE' : `PARTIDA PÚBLICA · ${MODE_RULES[mode].label}`);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Falha ao conectar.';
    status.classList.add('error');
  } finally {
    document.querySelectorAll<HTMLButtonElement>('#online button').forEach((b) => { b.disabled = false; });
  }
}

function bindUI(): void {
  const startTraining = () => {
    if (computeLoadout(partConfig, game.currentWeapon).rejected) { toast('CHASSI ACIMA DO LIMITE DE CARGA · AJUSTE NA OFICINA'); game.setMode('garage'); show('garage'); renderParts(); return; }
    game.leaveSession(); online = null; show('game'); game.start();
  };
  const toMenu = () => { game.leaveSession(); online = null; game.setMode('menu'); show('menu'); };
  el('start-button').addEventListener('click', startTraining);
  el('lobby-button').addEventListener('click', openLobby);
  el('lobby-launch').addEventListener('click', startTraining);
  el('lobby-customize').addEventListener('click', () => { garageReturn = 'lobby'; game.setMode('garage'); show('garage'); });
  el('lobby-online').addEventListener('click', () => { game.setMode('settings'); show('online'); });
  el('garage-play').addEventListener('click', startTraining);
  el('retry-button').addEventListener('click', () => {
    if (game.session === 'online' && online) { game.resume(); game.mode = 'game'; show('game'); touch.setVisible(document.body.classList.contains('touch-mode')); return; }
    startTraining();
  });
  el('restart-button').addEventListener('click', startTraining);
  el('garage-button').addEventListener('click', () => { garageReturn = 'menu'; game.setMode('garage'); show('garage'); });
  el('online-button').addEventListener('click', () => { game.setMode('settings'); show('online'); });
  el('settings-button').addEventListener('click', () => { game.setMode('settings'); show('settings'); });
  el('credits-button').addEventListener('click', () => { game.setMode('settings'); show('credits'); });
  el('credits-button-mobile').addEventListener('click', () => { game.setMode('settings'); show('credits'); });
  document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach((button) => button.addEventListener('click', () => {
    if (currentScreen === 'garage' && garageReturn === 'lobby') { openLobby(); return; }
    game.setMode('menu'); show('menu');
  }));
  el('resume-button').addEventListener('click', () => { game.resume(); show('game'); });
  for (const id of ['pause-menu-button', 'result-menu-button']) el(id).addEventListener('click', toMenu);
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => game.sfx.ui()));

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && game.mode === 'pause' && currentScreen === 'game') show('pause');
    if (event.code === 'Tab' && currentScreen === 'game' && game.session === 'online') { event.preventDefault(); scoreboardHeld = true; el('scoreboard').classList.remove('hidden'); }
  });
  document.addEventListener('keyup', (event) => { if (event.code === 'Tab') { scoreboardHeld = false; if (online?.phase === 'playing') el('scoreboard').classList.add('hidden'); } });
  document.addEventListener('pointerlockchange', () => {
    if (game.mode === 'game') el('controls-tip').classList.toggle('hidden', document.pointerLockElement === canvas);
  });
  window.addEventListener('touchstart', () => {
    if (document.body.dataset.touched !== '1') { document.body.dataset.touched = '1'; applyTouchMode(); }
  }, { passive: true });

  // Garage: palette and weapon.
  const savedPalette = loadSetting('palette', 'arctic') as MechPalette;
  game.setPalette(savedPalette);
  document.querySelectorAll<HTMLButtonElement>('.swatch').forEach((button) => {
    button.classList.toggle('active', button.dataset.color === savedPalette);
    button.addEventListener('click', () => {
      const palette = button.dataset.color as MechPalette;
      game.setPalette(palette);
      saveSetting('palette', palette);
      document.querySelectorAll('.swatch').forEach((swatch) => swatch.classList.toggle('active', swatch === button));
    });
  });
  buildWeaponUi();
  bindPartCustomization();
  const savedWeapon = loadSetting('weapon', 'mg');
  selectWeapon(isWeaponId(savedWeapon) ? savedWeapon : 'mg');
  game.onWeapon = (id) => {
    document.querySelectorAll('#weapon-slots button').forEach((slot) => slot.classList.toggle('active', (slot as HTMLElement).dataset.weapon === id));
    el('weapon-name').innerHTML = weaponLabel(id);
    if (currentScreen === 'game') saveSetting('weapon', id);
  };

  // Menu: theme and difficulty.
  const savedTheme = loadSetting('theme', 'day') as ThemeId;
  applyTheme(Math.max(0, THEMES.findIndex((t) => t.id === savedTheme)));
  el('theme-prev').addEventListener('click', () => applyTheme(themeIndex - 1));
  el('theme-next').addEventListener('click', () => applyTheme(themeIndex + 1));
  const savedDifficulty = loadSetting('difficulty', 'recruit') as Difficulty;
  const setDifficulty = (d: Difficulty) => {
    game.setDifficulty(d);
    saveSetting('difficulty', d);
    document.querySelectorAll<HTMLElement>('[data-difficulty]').forEach((chip) => chip.classList.toggle('active', chip.dataset.difficulty === d));
    el<HTMLSelectElement>('lobby-difficulty').value = d;
    refreshBest();
  };
  setDifficulty(savedDifficulty in DIFFICULTIES ? savedDifficulty : 'recruit');
  el<HTMLSelectElement>('lobby-difficulty').addEventListener('change', (event) => setDifficulty((event.target as HTMLSelectElement).value as Difficulty));
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((chip) => chip.addEventListener('click', () => setDifficulty(chip.dataset.difficulty as Difficulty)));
  buildLobby();

  // Online lobby.
  el<HTMLInputElement>('pilot-name').value = loadSetting('pilot', '');
  el<HTMLInputElement>('server-url').value = loadSetting('server', '') || defaultServerUrl();
  el('quick-ffa').addEventListener('click', () => void joinOnline('ffa'));
  el('quick-duel').addEventListener('click', () => void joinOnline('duel'));
  el('quick-team2').addEventListener('click', () => void joinOnline('team2'));
  el('quick-team5').addEventListener('click', () => void joinOnline('team5'));
  el('quick-core').addEventListener('click', () => void joinOnline('core'));
  el('create-room').addEventListener('click', () => void joinOnline('ffa', undefined, true));
  el('join-room').addEventListener('click', () => {
    const code = el<HTMLInputElement>('room-code').value.trim().toUpperCase();
    if (code.length < 4) { el('online-status').textContent = 'DIGITE O CÓDIGO DA SALA.'; return; }
    void joinOnline('ffa', code);
  });

  // Settings.
  const sensitivity = el<HTMLInputElement>('sensitivity');
  sensitivity.value = loadSetting('sensitivity', '1');
  const applySensitivity = () => {
    const value = Number(sensitivity.value);
    game.setSensitivity(value);
    el('sensitivity-value').textContent = `${value.toFixed(1)}×`;
    saveSetting('sensitivity', sensitivity.value);
  };
  sensitivity.addEventListener('input', applySensitivity);
  applySensitivity();
  const quality = el<HTMLSelectElement>('quality');
  quality.value = loadSetting('quality', isTouchDevice() ? 'medium' : 'high');
  const applyQuality = () => { game.setQuality(quality.value as 'high' | 'medium' | 'low'); saveSetting('quality', quality.value); };
  quality.addEventListener('change', applyQuality);
  applyQuality();
  const sound = el<HTMLInputElement>('sound');
  sound.checked = loadSetting('sound', 'true') === 'true';
  const applySound = () => { game.setSound(sound.checked); saveSetting('sound', String(sound.checked)); };
  sound.addEventListener('change', applySound);
  applySound();
  const touchSetting = el<HTMLSelectElement>('touch-setting');
  touchSetting.value = loadSetting('touch', 'auto');
  touchSetting.addEventListener('change', () => { saveSetting('touch', touchSetting.value); applyTouchMode(); });
  applyTouchMode();
}

async function loadCredits(): Promise<void> {
  type Credit = { title: string; author: string; url: string };
  try {
    const response = await fetch('/assets/sketchfab/manifest.json');
    const credits = await response.json() as Credit[];
    const list = el('credits-list');
    for (const credit of credits) {
      const link = document.createElement('a');
      link.href = credit.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const title = document.createElement('span');
      title.textContent = credit.title;
      const author = document.createElement('small');
      author.textContent = `${credit.author} · SKETCHFAB ↗`;
      link.append(title, author);
      list.append(link);
    }
  } catch (error) { console.warn('Could not load credits', error); }
}

async function bootstrap(): Promise<void> {
  progress(5, 'Preparando renderizador WebGL');
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, adaptToDeviceRatio: false });
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  progress(20, 'Inicializando física Havok');
  try {
    const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
    scene.enablePhysics(new Vector3(0, -19, 0), new HavokPlugin(true, havok));
  } catch (error) {
    console.error('Havok initialization failed; arena movement remains available through collision guards.', error);
  }
  progress(38, 'Preparando arena 3D');
  const mapId = selectedMap;
  const world = await createWorld(scene, (label) => progress(55, label), mapId);
  el('hud-map').textContent = MAPS[mapId].name;
  const mapChoice = el<HTMLSelectElement>('map-choice');
  mapChoice.replaceChildren(...MAP_ORDER.map((id) => new Option(MAPS[id].name, id)));
  mapChoice.value = mapId;
  mapChoice.addEventListener('change', () => changeMap(mapChoice.value as MapId));
  progress(82, 'Armando Striker e interface de combate');
  game = new CombatGame(scene, engine, canvas, world, loadSetting('palette', 'arctic') as MechPalette);
  touch = new TouchControls(el('app'));
  game.touch = touch;
  touch.onAction = (action) => { if (action === 'pause') { game.pause(); } };
  const debug = import.meta.env.DEV || location.search.includes('debug');
  if (debug) (window as unknown as { __mecha?: CombatGame; __online?: () => OnlineSession | null }).__mecha = game;
  if (debug) (window as unknown as { __online?: () => OnlineSession | null }).__online = () => online;
  game.player.setShowcase(true);
  progress(89, 'Carregando Striker criado no Blender');
  await game.player.loadShowcase();
  game.onHud = updateHud;
  game.onToast = toast;
  game.onHit = hit;
  game.onDamage = damage;
  game.onBanner = banner;
  game.onFeed = feed;
  game.onFloat = floatText;
  game.onMarkers = updateMarkers;
  game.onRadar = drawRadar;
  game.onPause = () => {
    el('pause-note').textContent = game.session === 'online' ? 'A partida online continua enquanto você está no menu.' : '';
    el('restart-button').classList.toggle('hidden', game.session === 'online');
    show('pause');
  };
  game.onResult = showResult;
  for (const mesh of game.player.root.getChildMeshes()) world.shadows.addShadowCaster(mesh);
  bindUI();
  void loadCredits();
  window.addEventListener('resize', () => engine.resize());
  engine.runRenderLoop(() => {
    game.update(engine.getDeltaTime() / 1000);
    scene.render();
  });
  progress(100, 'Sistemas operacionais');
  window.setTimeout(() => {
    loading.classList.add('hidden');
    if (new URLSearchParams(location.search).get('lobby') === '1') openLobby(); else show('menu');
  }, 450);
}

bootstrap().catch((error) => {
  console.error(error);
  progressLabel.textContent = `Falha ao carregar: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
  progressPercent.textContent = 'ERRO';
});
