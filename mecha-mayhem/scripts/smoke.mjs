/**
 * End-to-end smoke test. Starts its own Vite dev server (with the online
 * server plugin) unless SMOKE_URL is set, then drives desktop, mobile/touch and
 * a two-player online match in headless Chromium/Edge. Screenshots go to
 * artifacts/smoke/. Exit code is non-zero when any check fails.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { Room } from '../server/room.ts';
import { createArena, rayMech } from '../src/shared/arena.ts';
import { createMechState, applyPartDamage, damageTaken, restoreParts, stepMech, stepTrigger, switchWeapon } from '../src/shared/sim.ts';
import { computeLoadout } from '../src/shared/parts.ts';
import { validateParts } from '../src/shared/customization.ts';
import { MAP_COVER } from '../src/shared/arena.ts';
import { BOT_FILL } from '../src/shared/protocol.ts';
import { meleeInArc } from '../src/shared/weapons.ts';

const out = 'artifacts/smoke';
await mkdir(out, { recursive: true });
const candidates = [process.env.MECHA_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/opt/pw-browsers/chromium'].filter(Boolean);
const executablePath = candidates.find((path) => existsSync(path));

let viteServer = null;
let base = process.env.SMOKE_URL;
if (!base) {
  const { createServer } = await import('vite');
  viteServer = await createServer({ server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'warn' });
  await viteServer.listen();
  base = viteServer.resolvedUrls.local[0];
}
base = base.replace(/\/$/, '');

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

const errors = [];
const checks = [];
const report = {};
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const frozenLayout = JSON.parse(readFileSync('public/assets/models/frozen_outpost.layout.json', 'utf8'));
const refineryLayout = JSON.parse(readFileSync('public/assets/models/refinery.layout.json', 'utf8'));
const arena = createArena(frozenLayout);
check('espada: arco rejeita alvo atrás e aceita alvo próximo', meleeInArc(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, 4, 0.9) && !meleeInArc(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -3 }, 4, 0.9));
const swordState = createMechState(0, arena.deckY, 0, 0, 'sword');
const swordFire = stepTrigger(swordState, true, 1 / 30);
check('espada: golpe gasta energia e abre defesa', swordFire?.weapon === 'sword' && swordState.energy < 100 && swordState.parryTime > 0);
check('espada: defesa bloqueia projétil durante golpe', damageTaken(swordState, 40, true) === 0);
const legState = createMechState(0, arena.deckY, 0, 0);
const detachedLeg = applyPartDamage(legState, 'leftLeg', 70);
const intactState = createMechState(0, arena.deckY, 0, 0);
const move = { mx: 0, mz: 1, yaw: 0, pitch: 0, sprint: false, jump: false, dash: false, shield: false };
for (let i = 0; i < 30; i++) { stepMech(legState, move, 1 / 30, arena); stepMech(intactState, move, 1 / 30, arena); }
check('dano localizado: perna quebrada reduz deslocamento', detachedLeg && legState.z < intactState.z - 0.5);
const armState = createMechState(0, arena.deckY, 0, 0);
applyPartDamage(armState, 'rightArm', 60);
check('dano localizado: braço da arma quebrado impede tiro', stepTrigger(armState, true, 1 / 30) === null);
check('dano localizado: raio distingue cabeça e perna', rayMech({ x: 0, y: 3.2, z: -5 }, { x: 0, y: 0, z: 1 }, 10, { x: 0, y: 0, z: 0 })?.zone === 'head' && rayMech({ x: 0.5, y: 0.6, z: -5 }, { x: 0, y: 0, z: 1 }, 10, { x: 0, y: 0, z: 0 })?.zone === 'rightLeg');
const noop = { send() {}, close() {} };
const meleeRoom = new Room('MELE', 'duel', true, frozenLayout);
const striker = meleeRoom.join(noop, 'S', 'arctic', 'sword');
const target = meleeRoom.join(noop, 'T', 'ember', 'mg');
meleeRoom.phase = 'playing';
striker.state.x = 0; striker.state.z = 0; striker.state.y = arena.deckY; striker.state.yaw = 0; striker.state.fireCd = 0;
target.state.x = 0; target.state.z = 3; target.state.y = arena.deckY; target.state.invulnerable = 0;
const swing = { t: 'fire', weapon: 'sword', o: [999, 999, 999], d: [0, 0, -1], charge: 1, seed: 0, rt: 0 };
const settle = async () => { await new Promise((r) => setTimeout(r, 220)); meleeRoom.tick(1 / 30); };
meleeRoom.fire(striker, swing);
check('online: dano da espada só no instante do contato (sincronizado com a animação)', target.state.health === 100);
await settle();
const firstHit = target.state.health;
meleeRoom.fire(striker, swing);
await settle();
check('online: espada valida alcance, energia e cadência no servidor', firstHit < 100 && firstHit === target.state.health && striker.state.energy < 100);
striker.state.fireCd = 0; target.state.z = 12;
meleeRoom.fire(striker, swing);
await settle();
check('online: espada não atinge alvo fora do alcance', target.state.health === firstHit);
const solo = new Room('TEST', 'ffa', false, frozenLayout);
solo.join(noop, 'HUMANO', 'arctic', 'mg');
for (let i = 0; i < 82; i++) solo.tick(1 / 30);
check('online: sala pública solo recebe bots do servidor', solo.players.size === BOT_FILL.ffa && [...solo.players.values()].some((p) => p.bot));
solo.join(noop, 'HUMANO 2', 'ember', 'mg');
check('online: humano substitui um bot (vaga não fica presa)', solo.players.size === BOT_FILL.ffa && solo.humans === 2);
// Team 5v5 with bots: balanced teams, bots keep moving (no permanent stuck).
const big = new Room('BIG5', 'team5', false, frozenLayout);
big.join(noop, 'HUMANO', 'arctic', 'mg');
for (let i = 0; i < 90; i++) big.tick(1 / 30);
const blueCount = [...big.players.values()].filter((p) => p.team === 'blue').length;
check('times 5v5: bots completam equipes equilibradas', big.players.size === 10 && blueCount === 5);
big.phase = 'playing'; big.timer = 300;
const startPos = new Map([...big.players.values()].filter((p) => p.bot).map((p) => [p.id, { x: p.state.x, z: p.state.z }]));
for (let i = 0; i < 300; i++) big.tick(1 / 30);
const moved = [...big.players.values()].filter((p) => p.bot && startPos.has(p.id) && Math.hypot(p.state.x - startPos.get(p.id).x, p.state.z - startPos.get(p.id).z) > 3).length;
const stuck = big.botStatus().reduce((m, b) => Math.max(m, b.stuck), 0);
check('bots: navegam pelo mapa sem travar', moved >= 6 && stuck <= 6, `${moved}/9 se moveram · máx. travamentos ${stuck}`);
const teams = new Room('TEAM', 'team2', true, frozenLayout);
const first = teams.join(noop, 'A', 'arctic', 'mg');
const second = teams.join(noop, 'B', 'ember', 'mg');
const third = teams.join(noop, 'C', 'arctic', 'mg');
const friendlyHp = third.state.health;
teams.damage(third, first, 50, false, { x: 0, y: 1, z: 0 }, 'mg');
check('times: equilíbrio e sem fogo amigo', first.team === third.team && first.team !== second.team && third.state.health === friendlyHp);
const core = new Room('CORE', 'core', true, frozenLayout);
const capturer = core.join(noop, 'A', 'arctic', 'mg');
core.join(noop, 'B', 'ember', 'mg');
core.phase = 'playing'; core.timer = 100;
capturer.state.x = 0; capturer.state.z = 0;
for (let i = 0; i < 100; i++) { capturer.state.x = 0; capturer.state.z = 0; core.tick(1 / 30); }
check('Core Control: servidor atribui pontos ao time no centro', core.coreOwner === capturer.team && core.teamScores[capturer.team === 'blue' ? 0 : 1] > 0);
const hover = new Room('HOVR', 'core', true, frozenLayout);
const hoverer = hover.join(noop, 'A', 'arctic', 'mg');
hover.join(noop, 'B', 'ember', 'mg');
hover.phase = 'playing'; hover.timer = 100;
for (let i = 0; i < 100; i++) { hoverer.state.x = 0; hoverer.state.z = 0; hoverer.state.y = arena.deckY + 4; hoverer.state.grounded = false; hover.tick(1 / 30); }
check('Core Control: jato acima do núcleo não pontua', hover.coreOwner === null && hover.teamScores[0] === 0 && hover.teamScores[1] === 0);
// Team result: every member of the winning team wins.
teams.phase = 'playing';
teams.teamScores = [5, 2];
check('resultado: equipe vencedora inteira recebe vitória; empate reconhecido', teams.outcome().winnerTeam === 'blue' && (teams.teamScores = [3, 3], teams.outcome().winnerTeam === 'draw'));
// Laser with a destroyed right arm cannot even charge.
const laserArm = createMechState(0, arena.deckY, 0, 0, 'laser');
applyPartDamage(laserArm, 'rightArm', 999);
stepTrigger(laserArm, true, 0.5);
check('correção: laser não carrega nem dispara com braço destruído', laserArm.charge === 0 && stepTrigger(laserArm, false, 1 / 30) === null);
restoreParts(laserArm);
check('correção: reparo restaura membros e arma', laserArm.parts.rightArm > 0 && stepTrigger(laserArm, true, 0.3) === null && laserArm.charge > 0);
// Modular chassis: stats from the catalog drive the shared simulation; server rejects overloads.
const light = computeLoadout({ head: 'scout', torso: 'scout', legs: 'scout' }, 'mg');
const heavy = computeLoadout({ head: 'titan', torso: 'titan', legs: 'titan' }, 'mg');
const over = computeLoadout({ head: 'titan', torso: 'titan', legs: 'scout' }, 'hammer');
check('peças: leve é mais rápido, pesado recebe menos dano', light.speedMul > 1 && heavy.speedMul < 1 && heavy.damageMul < light.damageMul, `leve ${light.speed} m/s · pesado ${heavy.speed} m/s`);
check('peças: sobrecarga acima de 135% é rejeitada pelo servidor', over.rejected && validateParts({ head: 'titan', torso: 'titan', legs: 'scout' }, 'hammer').legs === 'striker');
const runner = createMechState(0, arena.deckY, 0, 0, 'mg', { head: 'scout', torso: 'scout', legs: 'scout' });
const tank = createMechState(0, arena.deckY, 0, 0, 'mg', { head: 'titan', torso: 'titan', legs: 'titan' });
for (let i = 0; i < 60; i++) { stepMech(runner, { mx: 0, mz: 1, yaw: 0, pitch: 0, sprint: false, jump: false, dash: false, shield: false }, 1 / 30, arena); stepMech(tank, { mx: 0, mz: 1, yaw: 0, pitch: 0, sprint: false, jump: false, dash: false, shield: false }, 1 / 30, arena); }
check('peças: atributos aplicados na simulação compartilhada', runner.z > tank.z + 1 && damageTaken(tank, 10) < damageTaken(runner, 10));
const swap = createMechState(0, arena.deckY, 0, 0, 'mg');
switchWeapon(swap, 'hammer');
check('peças: peso da arma entra na carga', swap.loadout.legsLoad > createMechState(0, arena.deckY, 0, 0, 'mg').loadout.legsLoad);
const padArena = createArena(refineryLayout, { mapId: 'refinery' });
const pad = padArena.jumpPads[0];
const jumper = createMechState(pad.x, padArena.deckY, pad.z, 0);
for (let i = 0; i < 12; i++) stepMech(jumper, { mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, jump: false, dash: false, shield: false }, 1 / 30, padArena);
check('mapas: plataforma de salto lança o mecha (regra compartilhada)', jumper.y > padArena.deckY + 2 && padArena.jumpPads.length === 4, `altura ${(jumper.y - padArena.deckY).toFixed(1)} m`);
check('mapas: pontes dos mapas procedurais têm cobertura', padArena.builtCover.filter((c) => c.kind === 'block').length === refineryLayout.bridges.length);
check('mapas: cada arena tem coberturas centrais próprias', new Set(Object.values(MAP_COVER).map((c) => JSON.stringify(c))).size === 4);
const refinery = createArena(refineryLayout);
check('segundo mapa: layout de refinaria tem pontes e coberturas', refinery.layout.visualAsset === 'procedural:refinery' && refinery.layout.bridges.length === 4 && refinery.staticCover.length > 8);
function watch(page, label) {
  page.on('pageerror', (error) => errors.push(`${label} PAGE: ${error.message} @ ${(error.stack ?? '').split('\n').slice(1, 4).join(' | ')}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${label} CONSOLE: ${message.text()}`); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${label} HTTP ${response.status()}: ${response.url()}`); });
}
const game = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => game(page, () => window.__mecha.debugState());

try {
  // ------------------------------------------------------------------ desktop
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watch(page, 'desktop');
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${out}/loading.png` });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
  await game(page, () => window.__mecha.setQuality('low'));
  await page.screenshot({ path: `${out}/menu.png` });
  await page.locator('#settings-button').click();
  await page.locator('#quality').selectOption('minimal');
  check('qualidade Mínima (sem placa de vídeo) disponível e salva', await page.evaluate(() => localStorage.getItem('mecha-mayhem:quality')) === 'minimal');
  await page.locator('#quality').selectOption('auto');
  await page.locator('#settings [data-back]').click();
  await game(page, () => window.__mecha.setQuality('low'));
  check('treino: dificuldade inicial Recruta', await game(page, () => window.__mecha.difficulty) === 'recruit');
  await page.locator('#lobby-button').click();
  await page.locator('#lobby').waitFor({ state: 'visible' });
  check('lobby: quatro arenas e preparação da missão', await page.locator('#lobby-maps .map-card').count() === 4 && await page.locator('#lobby-launch').isVisible());
  await page.screenshot({ path: `${out}/lobby.png` });
  await page.locator('#lobby-customize').click();
  await page.locator('.part-tab[data-slot="head"]').click();
  await page.locator('.part-card[data-family="scout"]').click();
  await page.locator('.part-tab[data-slot="torso"]').click();
  await page.locator('.part-card[data-family="titan"]').click();
  await page.locator('.part-tab[data-slot="legs"]').click();
  await page.locator('.part-card[data-family="titan"]').click();
  const statsText = await page.locator('#chassis-stats').textContent();
  check('oficina: peso, sustentação, integridade, blindagem, energia e velocidade visíveis fora das imagens', ['PESO TOTAL', 'INTEGRIDADE', 'BLINDAGEM', 'ENERGIA', 'VELOCIDADE', 'PERNAS', 'TRONCO'].every((k) => statsText.includes(k)));
  // Titan head + Titan torso + MG on Scout legs = 140% of capacity (limit 135%).
  await page.locator('.part-card[data-family="scout"]').click();
  await page.locator('.part-tab[data-slot="head"]').click();
  await page.locator('.part-card[data-family="titan"]').click();
  check('oficina: sobrecarga acima do limite bloqueia a partida', await page.locator('#garage-play').isDisabled() && (await page.locator('#chassis-stats').textContent()).includes('EXCEDE'));
  await page.screenshot({ path: `${out}/customization-overload.png` });
  await page.locator('.part-card[data-family="scout"]').click();
  await page.locator('.part-tab[data-slot="legs"]').click();
  await page.locator('.part-card[data-family="titan"]').click();
  const customized = await page.evaluate(() => ({ parts: window.__mecha.player.root.metadata.parts, saved: JSON.parse(localStorage.getItem('mecha-mayhem:parts')) }));
  check('oficina: peças aplicadas e salvas', customized.parts.head === 'scout' && customized.parts.torso === 'titan' && customized.parts.legs === 'titan' && customized.saved.torso === 'titan');
  await page.screenshot({ path: `${out}/customization.png` });
  await page.locator('#garage [data-back]').click();
  check('oficina: volta para o lobby', await page.locator('#lobby').isVisible());
  await page.locator('#lobby [data-back]').click();
  await page.locator('#theme-next').click();
  check('menu: troca de clima', (await page.locator('#theme-name').textContent()) === 'ALVORADA GLACIAL');
  await page.locator('#theme-prev').click();
  await page.locator('[data-difficulty="veteran"]').click();

  await page.locator('#garage-button').click();
  await page.locator('#garage').waitFor({ state: 'visible' });
  await page.locator('[data-color="ember"]').click();
  await page.locator('.weapon-card[data-weapon="shotgun"]').click();
  check('garagem: escolha de arma salva', await page.evaluate(() => localStorage.getItem('mecha-mayhem:weapon')) === 'shotgun');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/garage.png` });
  await page.locator('.weapon-card[data-weapon="mg"]').click();
  await page.locator('#garage [data-back]').click();
  await page.locator('#settings-button').click();
  await page.locator('#sensitivity').fill('1.4');
  await page.locator('#settings [data-back]').click();
  await page.locator('#credits-button').click();
  await page.locator('#credits-list a').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: `${out}/credits.png` });
  await page.locator('#credits [data-back]').click();

  await page.locator('#start-button').click();
  await page.locator('#hud').waitFor({ state: 'visible' });
  await game(page, () => window.__mecha.setQuality('low'));
  const start = await state(page);
  await page.keyboard.down('KeyW');
  await game(page, () => window.__mecha.debugStep(0.8));
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyE');
  await page.keyboard.down('Space');
  await game(page, () => window.__mecha.debugStep(0.6));
  await page.keyboard.up('Space');
  const moved = await state(page);
  check('treino: movimento, dash, escudo e jato', Math.hypot(moved.player[0] - start.player[0], moved.player[2] - start.player[2]) > 3 && moved.energy < 100, `pos ${moved.player.join(', ')} · energia ${Math.round(moved.energy)}`);
  await game(page, () => window.__mecha.debugStep(3));
  const wave1 = await state(page);
  check('treino: onda 1 gerou inimigos com IA', wave1.enemies.length >= 2, wave1.enemies.map((e) => `${e.type}:${e.state}`).join(' '));
  await page.screenshot({ path: `${out}/game.png` });

  // Each weapon: switch by keyboard, fire with auto-aim, measure damage.
  await game(page, () => { window.__mecha.debugAutoAim = true; });
  report.weapons = {};
  for (const [key, weapon, hold] of [['Digit1', 'mg', 1.6], ['Digit2', 'shotgun', 1.8], ['Digit3', 'laser', 1.2], ['Digit4', 'missile', 2.4]]) {
    await page.keyboard.press(key);
    const label = await page.locator('#weapon-name').textContent();
    const before = await state(page);
    await game(page, (close) => { const g = window.__mecha; g.state.health = 100; if (close) g.debugApproach(7); g.debugStep(0.35); }, weapon === 'shotgun' || weapon === 'missile');
    await page.keyboard.down('KeyJ');
    await game(page, (seconds) => window.__mecha.debugStep(seconds), hold);
    await page.keyboard.up('KeyJ');
    await game(page, (seconds) => window.__mecha.debugStep(seconds), weapon === 'missile' ? 1.2 : 0.1);
    if (weapon === 'laser' || weapon === 'shotgun') await page.screenshot({ path: `${out}/weapon-${weapon}.png` });
    const after = await state(page);
    report.weapons[weapon] = { label, scoreGained: after.score - before.score, heat: Math.round(after.heat), energy: Math.round(after.energy) };
    check(`arma ${weapon}: troca pelo teclado e causa dano`, after.weapon === weapon && after.score > before.score && label.length > 3, `${label} · +${after.score - before.score} pts`);
    if (!after.enemies.length) await game(page, () => window.__mecha.debugStep(8));
  }
  for (const [key, weapon] of [['KeyK', 'sword'], ['KeyL', 'hammer']]) {
    await game(page, () => { const g = window.__mecha; g.debugAutoAim = false; g.state.health = 100; g.state.energy = 100; g.spawnEnemy('sentinel'); g.debugStep(2); g.debugApproach(2.4); });
    const before = await state(page);
    await page.keyboard.press(key);
    await game(page, () => window.__mecha.debugStep(1.3));
    const after = await state(page);
    check(`arma ${weapon}: ataque direto pelo teclado`, after.weapon === weapon && after.score > before.score, `+${after.score - before.score} pts`);
  }
  await game(page, () => { window.__mecha.debugAutoAim = false; });
  const afterWeapons = await state(page);
  check('combate: abates registrados', afterWeapons.kills >= 1, `abates ${afterWeapons.kills}`);

  // Pause.
  await page.keyboard.press('Escape');
  await page.locator('#pause').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${out}/pause.png` });
  await page.locator('#resume-button').click();

  // Wave progression to the boss and victory.
  let maxWave = 0;
  for (let i = 0; i < 6; i++) {
    await game(page, () => { const g = window.__mecha; g.state.health = 100; g.debugSkipWave(); g.debugStep(8); });
    const s = await state(page);
    maxWave = Math.max(maxWave, s.wave + 1);
    if (s.enemies.some((e) => e.type === 'boss')) {
      await game(page, () => window.__mecha.debugStep(2));
      await page.screenshot({ path: `${out}/boss.png` });
      report.boss = (await state(page)).enemies.filter((e) => e.type === 'boss');
    }
    if (s.finished) break;
  }
  await game(page, () => { const g = window.__mecha; g.state.health = 100; g.debugSkipWave(); g.debugStep(3); });
  await page.locator('#result').waitFor({ state: 'visible', timeout: 20000 });
  const resultTitle = await page.locator('#result-title').textContent();
  check('ritmo: 5 ondas até a vitória e tela de resultado', maxWave >= 5 && resultTitle === 'VITÓRIA', `onda máx ${maxWave} · ${resultTitle}`);
  report.boss && check('chefe Colosso aparece na onda final', report.boss.length === 1);
  await page.screenshot({ path: `${out}/result.png` });
  await page.locator('#retry-button').click();
  await page.locator('#hud').waitFor({ state: 'visible' });
  const restarted = await state(page);
  check('reinício após resultado', restarted.mode === 'game' && restarted.score === 0 && !restarted.finished);
  await page.keyboard.press('Escape');
  await page.locator('#pause-menu-button').click();
  await page.locator('#menu').waitFor({ state: 'visible' });

  // Progression: the finished match paid XP and credits; pass tiers can be claimed and items bought.
  const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('mecha-mayhem:profile') ?? '{}'));
  check('progressão: partida concluída dá XP, créditos e nível do passe', prof.xp > 0 && prof.credits > 200 && prof.passXp > 0, `XP ${prof.xp} · ${prof.credits} CR`);
  await page.locator('#progress-button').click();
  await page.locator('#progress').waitFor({ state: 'visible' });
  const readyTiers = await page.locator('.pass-tier.ready').count();
  if (readyTiers) await page.locator('.pass-tier.ready').first().click();
  await page.screenshot({ path: `${out}/progress-pass.png` });
  await page.locator('[data-ptab="shop"]').click();
  await page.locator('.shop-item[data-item="trail-magma"]').click();
  const afterBuy = await page.evaluate(() => JSON.parse(localStorage.getItem('mecha-mayhem:profile')));
  check('loja: compra com créditos do jogo e equipa o efeito', afterBuy.owned.includes('trail-magma') && afterBuy.equipped.trail === 'trail-magma' && (await game(page, () => window.__mecha.cosmetics.trail[0])) === 1);
  await page.screenshot({ path: `${out}/progress-shop.png` });
  await page.locator('#progress [data-back]').click();

  // ------------------------------------------------------------------- mobile
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const mobile = await mobileContext.newPage();
  watch(mobile, 'mobile');
  await mobile.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await mobile.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
  await game(mobile, () => window.__mecha.setQuality('low'));
  await mobile.screenshot({ path: `${out}/mobile-menu.png` });
  const menuFits = await mobile.evaluate(() => [...document.querySelectorAll('#menu button')].filter((b) => b.offsetParent).every((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }));
  check('celular: menu cabe em 390×844', menuFits);
  await mobile.locator('#lobby-button').tap();
  const lobbyFits = await mobile.evaluate(() => { const panel = document.querySelector('.lobby-panel'); const r = panel.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && panel.scrollWidth <= panel.clientWidth + 1; });
  check('celular: lobby cabe em 390×844 e permite rolagem', lobbyFits && await mobile.locator('#lobby-maps .map-card').count() === 4);
  await mobile.screenshot({ path: `${out}/mobile-lobby.png` });
  await mobile.locator('#lobby [data-back]').tap();
  await mobile.locator('#garage-button').tap();
  await mobile.locator('#garage').waitFor({ state: 'visible' });
  await mobile.waitForTimeout(1500);
  await mobile.screenshot({ path: `${out}/mobile-garage.png` });
  const garage = await mobile.evaluate(() => {
    const panel = document.querySelector('.garage-panel').getBoundingClientRect();
    const title = document.querySelector('.garage-panel h2').getBoundingClientRect();
    const play = document.querySelector('#garage-play strong').getBoundingClientRect();
    return { panelTop: panel.top, titleHeight: title.height, playHeight: play.height, scroll: document.querySelector('.garage-panel').scrollHeight - document.querySelector('.garage-panel').clientHeight };
  });
  check('celular: garagem deixa o robô visível (painel na metade de baixo)', garage.panelTop > 844 * 0.38, `painel começa em ${Math.round(garage.panelTop)}px`);
  check('celular: título e botão da garagem em uma linha', garage.titleHeight < 48 && garage.playHeight < 34, `título ${Math.round(garage.titleHeight)}px · botão ${Math.round(garage.playHeight)}px`);
  await mobile.locator('.weapon-card[data-weapon="laser"]').tap();
  await mobile.locator('#garage-play').scrollIntoViewIfNeeded();
  await mobile.locator('#garage-play').tap();
  await mobile.locator('#hud').waitFor({ state: 'visible' });
  await game(mobile, () => window.__mecha.debugStep(2));
  check('celular: controles de toque visíveis', await mobile.locator('#touch-controls').isVisible());
  const overlaps = await mobile.evaluate(() => {
    const rect = (el) => el.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('#touch-controls .touch-btn')].map((b) => ({ name: b.className, r: rect(b) }));
    const hud = ['.hud-top-left', '.hud-top-right', '.hud-bottom-left', '.hud-bottom-right .weapon', '#radar'].map((s) => ({ name: s, r: rect(document.querySelector(s)) }));
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom && a.width > 0 && b.width > 0;
    const found = [];
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) if (hit(buttons[i].r, buttons[j].r)) found.push(`${buttons[i].name} × ${buttons[j].name}`);
      for (const h of hud) if (hit(buttons[i].r, h.r)) found.push(`${buttons[i].name} × ${h.name}`);
    }
    for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) if (hit(hud[i].r, hud[j].r)) found.push(`${hud[i].name} × ${hud[j].name}`);
    const offscreen = buttons.filter((b) => b.r.right > innerWidth || b.r.bottom > innerHeight || b.r.left < 0).map((b) => b.name);
    return { found, offscreen };
  });
  check('celular: botões e HUD sem sobreposição em 390×844', overlaps.found.length === 0 && overlaps.offscreen.length === 0, [...overlaps.found, ...overlaps.offscreen].join('; '));

  // Touch: drag the joystick, then dash, swap weapon and hold fire.
  const touchStart = await state(mobile);
  const pointer = (selector, type, x, y, id) => mobile.evaluate(({ selector, type, x, y, id }) => {
    const target = document.querySelector(selector);
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1 }));
  }, { selector, type, x, y, id });
  await pointer('.touch-move', 'pointerdown', 90, 640, 1);
  await pointer('.touch-move', 'pointermove', 90, 580, 1);
  await game(mobile, () => window.__mecha.debugStep(1));
  await pointer('.touch-move', 'pointerup', 90, 580, 1);
  const touchMoved = await state(mobile);
  check('toque: joystick move o Striker', Math.hypot(touchMoved.player[0] - touchStart.player[0], touchMoved.player[2] - touchStart.player[2]) > 2, `pos ${touchMoved.player.join(', ')}`);
  await pointer('.touch-look', 'pointerdown', 300, 400, 2);
  await pointer('.touch-look', 'pointermove', 360, 400, 2);
  await game(mobile, () => window.__mecha.debugStep(0.1));
  await pointer('.touch-look', 'pointerup', 360, 400, 2);
  const weaponBefore = touchMoved.weapon;
  await mobile.locator('.touch-swap').tap();
  await game(mobile, () => window.__mecha.debugStep(0.1));
  const swapped = await state(mobile);
  check('toque: botão ARMA troca a arma', swapped.weapon !== weaponBefore, `${weaponBefore} → ${swapped.weapon}`);
  await mobile.locator('.touch-dash').tap();
  await game(mobile, () => window.__mecha.debugStep(0.1));
  const dashed = await mobile.evaluate(() => window.__mecha.state.dashCd);
  check('toque: botão DASH aciona o dash', dashed > 0, `recarga ${dashed.toFixed(2)} s`);
  await game(mobile, () => { window.__mecha.setWeapon('mg'); window.__mecha.debugAutoAim = true; window.__mecha.debugStep(3); });
  const fireBefore = await state(mobile);
  await pointer('.touch-fire', 'pointerdown', 330, 790, 3);
  await game(mobile, () => window.__mecha.debugStep(1.5));
  await pointer('.touch-fire', 'pointerup', 330, 790, 3);
  const fireAfter = await state(mobile);
  check('toque: botão FOGO dispara', fireAfter.score > fireBefore.score || fireAfter.heat > 10, `+${fireAfter.score - fireBefore.score} pts · calor ${Math.round(fireAfter.heat)}%`);
  await mobile.screenshot({ path: `${out}/mobile-game.png` });
  await mobile.setViewportSize({ width: 844, height: 390 });
  await game(mobile, () => window.__mecha.debugStep(0.2));
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: `${out}/mobile-landscape.png` });

  // ------------------------------------------------------------------- online
  await context.close();
  await mobileContext.close();
  const openOnline = async (name) => {
    const p = await browser.newPage({ viewport: { width: 560, height: 360 } });
    watch(p, `online-${name}`);
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await p.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
    await game(p, () => window.__mecha.setQuality('low'));
    await p.locator('#online-button').click();
    await p.locator('#pilot-name').fill(name);
    return p;
  };
  const alpha = await openOnline('ALFA');
  const bravo = await openOnline('BRAVO');
  await alpha.locator('#create-room').click();
  await alpha.locator('#hud').waitFor({ state: 'visible', timeout: 20000 });
  const code = await game(alpha, () => window.__online().room);
  await bravo.locator('#room-code').fill(code);
  await bravo.locator('#join-room').click();
  await bravo.locator('#hud').waitFor({ state: 'visible', timeout: 20000 });
  await alpha.waitForTimeout(6000);
  const seen = await game(alpha, () => ({ phase: window.__online().phase, targets: window.__online().targets().map((t) => t.name) }));
  check('online: sala privada, dois pilotos se enxergam', seen.targets.includes('BRAVO'), `sala ${code} · fase ${seen.phase}`);
  // Both pilots walk from their stations towards the centre ring, then ALFA opens fire.
  await Promise.all([alpha.keyboard.down('KeyW'), bravo.keyboard.down('KeyW')]);
  await alpha.waitForTimeout(7000);
  await Promise.all([alpha.keyboard.up('KeyW'), bravo.keyboard.up('KeyW')]);
  await game(alpha, () => { window.__mecha.debugAutoAim = true; });
  await alpha.keyboard.down('KeyJ');
  let bravoHp = 100;
  for (let i = 0; i < 12 && bravoHp >= 100; i++) {
    await alpha.waitForTimeout(1500);
    bravoHp = await game(bravo, () => window.__mecha.state.health);
  }
  await alpha.keyboard.up('KeyJ');
  const positions = { alfa: (await state(alpha)).player, bravo: (await state(bravo)).player };
  const killedOrHurt = bravoHp < 100 || (await game(alpha, () => window.__mecha.debugState().score)) > 0;
  check('online: dano validado pelo servidor chega ao oponente', killedOrHurt, `vida de BRAVO ${Math.round(bravoHp)} · ALFA ${positions.alfa.join(',')} · BRAVO ${positions.bravo.join(',')}`);
  await alpha.screenshot({ path: `${out}/online-alfa.png` });
  await bravo.screenshot({ path: `${out}/online-bravo.png` });
  await alpha.close(); await bravo.close();
  const refineryPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(refineryPage, 'refinery');
  await refineryPage.goto(`${base}/?map=refinery&debug`, { waitUntil: 'domcontentloaded' });
  await refineryPage.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
  const refineryScene = await game(refineryPage, () => ({ selected: document.querySelector('#map-choice').value, deck: window.__mecha.world.arena.layout.visualAsset, meshes: window.__mecha.scene.meshes.filter((mesh) => mesh.name.startsWith('refinery-')).length }));
  check('refinaria: mapa 3D procedural carrega', refineryScene.selected === 'refinery' && refineryScene.deck === 'procedural:refinery' && refineryScene.meshes > 10, `${refineryScene.meshes} peças`);
  await refineryPage.screenshot({ path: `${out}/refinery.png` });
  for (const id of ['neon', 'canyon']) {
    await refineryPage.goto(`${base}/?map=${id}&lobby=1&debug`, { waitUntil: 'domcontentloaded' });
    await refineryPage.locator('#lobby').waitFor({ state: 'visible', timeout: 120000 });
    const map = await game(refineryPage, (id) => ({ asset: window.__mecha.world.arena.layout.visualAsset, pieces: window.__mecha.scene.meshes.filter((mesh) => mesh.name.startsWith(`${id}-`)).length }), id);
    check(`mapa ${id}: cenário e lobby carregam`, map.asset === `procedural:${id}` && map.pieces > 20 && await refineryPage.locator(`.map-card[data-map="${id}"]`).getAttribute('aria-pressed') === 'true', `${map.pieces} peças`);
    await refineryPage.screenshot({ path: `${out}/map-${id}.png` });
    await refineryPage.locator('#lobby-launch').click();
    await refineryPage.keyboard.down('KeyW');
    await game(refineryPage, () => window.__mecha.debugStep(1));
    await refineryPage.keyboard.up('KeyW');
    const walkable = await game(refineryPage, () => { const g = window.__mecha; return g.world.arena.onDeck(g.state.x, g.state.z, 0.8) && g.state.health > 0; });
    check(`mapa ${id}: missão inicia com jogador em plataforma`, walkable);
  }
} catch (error) {
  errors.push(`SMOKE: ${error instanceof Error ? error.stack : error}`);
}

const filtered = errors.filter((e) => !/WebGL|GPU stall|GL Driver/i.test(e));
check('sem erros de console/página', filtered.length === 0, filtered.slice(0, 5).join(' | '));
console.log(JSON.stringify({ report, failed: checks.filter((c) => !c.ok).map((c) => c.name), errors: filtered }, null, 2));
await browser.close();
await viteServer?.close();
if (checks.some((c) => !c.ok)) process.exitCode = 1;
process.exit();
