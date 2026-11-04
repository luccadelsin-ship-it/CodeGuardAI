import { Engine, HavokPlugin, Scene, Vector3 } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { CombatGame, type HudState } from './game/combat';
import { createWorld } from './game/world';
import type { MechPalette } from './game/mech';
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
const screenIds = ['menu', 'garage', 'settings', 'credits', 'pause', 'result'] as const;
type UiScreen = typeof screenIds[number] | 'game';
let currentScreen: UiScreen = 'menu';
let game: CombatGame;
let toastTimer = 0;
let hitTimer = 0;

function progress(percent: number, label: string): void {
  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressLabel.textContent = label;
}

function show(screen: UiScreen): void {
  currentScreen = screen;
  for (const id of screenIds) el(id).classList.toggle('hidden', id !== screen);
  el('hud').classList.toggle('hidden', screen !== 'game');
  if (screen !== 'game') el('controls-tip').classList.remove('hidden');
}

function saveSetting(key: string, value: string): void {
  try { localStorage.setItem(`mecha-mayhem:${key}`, value); } catch { /* Storage can be unavailable in private mode. */ }
}

function loadSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(`mecha-mayhem:${key}`) ?? fallback; } catch { return fallback; }
}

function toast(message: string): void {
  const node = el('toast');
  node.textContent = message;
  node.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.add('hidden'), 2300);
}

function hit(): void {
  const node = el('hitmarker');
  node.classList.remove('hidden');
  window.clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => node.classList.add('hidden'), 120);
}

function damageFlash(): void {
  const node = el('damage-flash');
  node.style.opacity = '1';
  window.setTimeout(() => { node.style.opacity = '0'; }, 100);
}

function updateHud(state: HudState): void {
  el('health-number').textContent = `${Math.ceil(state.health)}`;
  el('energy-number').textContent = `${Math.ceil(state.energy)}`;
  el('health-fill').style.width = `${state.health}%`;
  el('energy-fill').style.width = `${state.energy}%`;
  el('heat-fill').style.width = `${state.heat}%`;
  el('heat-label').textContent = state.heat >= 100 ? 'SUPERAQUECIDA' : `CALOR ${Math.round(state.heat)}%`;
  el('score').textContent = `${state.score}`.padStart(4, '0');
  el('objective').textContent = `ELIMINE OS DRONES · ${state.kills} / 3`;
  el('dash-status').textContent = state.dashCooldown <= 0 ? 'PRONTO' : `${state.dashCooldown.toFixed(1)} S`;
  el('shield-status').textContent = state.shieldCooldown <= 0 ? 'PRONTO' : `${state.shieldCooldown.toFixed(1)} S`;
  el('dash-ability').classList.toggle('cooldown', state.dashCooldown > 0);
  el('shield-ability').classList.toggle('cooldown', state.shieldCooldown > 0);
  el('fps').textContent = `${Math.round(state.fps)} FPS`;
}

function bindUI(): void {
  const start = () => { show('game'); game.start(); };
  el('start-button').addEventListener('click', start);
  el('garage-play').addEventListener('click', start);
  el('retry-button').addEventListener('click', start);
  el('garage-button').addEventListener('click', () => { game.setMode('garage'); show('garage'); });
  el('settings-button').addEventListener('click', () => { game.setMode('settings'); show('settings'); });
  el('credits-button').addEventListener('click', () => { game.setMode('settings'); show('credits'); });
  el('credits-button-mobile').addEventListener('click', () => { game.setMode('settings'); show('credits'); });
  document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(button => button.addEventListener('click', () => { game.setMode('menu'); show('menu'); }));
  el('resume-button').addEventListener('click', () => { game.resume(); show('game'); });
  for (const id of ['pause-menu-button', 'result-menu-button']) el(id).addEventListener('click', () => { game.setMode('menu'); show('menu'); });
  document.addEventListener('keydown', event => {
    if (event.code === 'Escape' && game.mode === 'pause' && currentScreen === 'game') show('pause');
  });
  document.addEventListener('pointerlockchange', () => {
    if (game.mode === 'game') el('controls-tip').classList.toggle('hidden', document.pointerLockElement === canvas);
  });

  const savedPalette = loadSetting('palette', 'arctic') as MechPalette;
  game.setPalette(savedPalette);
  document.querySelectorAll<HTMLButtonElement>('.swatch').forEach(button => {
    const selected = button.dataset.color === savedPalette;
    button.classList.toggle('active', selected);
    button.addEventListener('click', () => {
      const palette = button.dataset.color as MechPalette;
      game.setPalette(palette);
      saveSetting('palette', palette);
      document.querySelectorAll('.swatch').forEach(swatch => swatch.classList.toggle('active', swatch === button));
    });
  });

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
  quality.value = loadSetting('quality', 'high');
  const applyQuality = () => { game.setQuality(quality.value as 'high' | 'medium' | 'low'); saveSetting('quality', quality.value); };
  quality.addEventListener('change', applyQuality);
  applyQuality();

  const sound = el<HTMLInputElement>('sound');
  sound.checked = loadSetting('sound', 'true') === 'true';
  const applySound = () => { game.setSound(sound.checked); saveSetting('sound', String(sound.checked)); };
  sound.addEventListener('change', applySound);
  applySound();
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
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false });
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
  const world = await createWorld(scene, label => progress(50, label));
  progress(82, 'Armando Striker e interface de combate');
  game = new CombatGame(scene, engine, canvas, world, loadSetting('palette', 'arctic') as MechPalette);
  if (import.meta.env.DEV) (window as unknown as { __mecha?: CombatGame }).__mecha = game;
  game.player.setShowcase(true);
  progress(89, 'Carregando Striker criado no Blender');
  await game.player.loadShowcase();
  game.onHud = updateHud;
  game.onToast = toast;
  game.onHit = hit;
  game.onDamage = damageFlash;
  game.onPause = () => show('pause');
  game.onResult = (won, score) => {
    el('result-kicker').textContent = won ? 'TREINAMENTO CONCLUÍDO' : 'UNIDADE DESTRUÍDA';
    el('result-title').textContent = won ? 'VITÓRIA' : 'DERROTA';
    el('result-detail').textContent = won ? `Os três drones foram eliminados. Pontuação: ${score}.` : `Seu Striker foi destruído. Pontuação: ${score}.`;
    show('result');
  };
  for (const mesh of game.player.root.getChildMeshes()) world.shadows.addShadowCaster(mesh);
  bindUI();
  void loadCredits();
  window.addEventListener('resize', () => engine.resize());
  engine.runRenderLoop(() => {
    game.update(engine.getDeltaTime() / 1000);
    scene.render();
  });
  progress(100, 'Sistemas operacionais');
  window.setTimeout(() => { loading.classList.add('hidden'); show('menu'); }, 450);
}

bootstrap().catch(error => {
  console.error(error);
  progressLabel.textContent = `Falha ao carregar: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
  progressPercent.textContent = 'ERRO';
});
