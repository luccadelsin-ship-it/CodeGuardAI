/**
 * End-to-end smoke test. Starts its own Vite dev server (with the online
 * server plugin) unless SMOKE_URL is set, then drives desktop, mobile/touch and
 * a two-player online match in headless Chromium/Edge. Screenshots go to
 * artifacts/smoke/. Exit code is non-zero when any check fails.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
function watch(page, label) {
  page.on('pageerror', (error) => errors.push(`${label} PAGE: ${error.message}`));
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
    await game(page, (close) => { const g = window.__mecha; g.state.health = 100; if (close) g.debugApproach(7); g.debugStep(0.35); }, weapon === 'shotgun');
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
