import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const candidates = [process.env.MECHA_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/opt/pw-browsers/chromium'].filter(Boolean);
const executablePath = candidates.find(path => existsSync(path));

const out = 'artifacts/smoke';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath,
  
  args: ['--enable-webgl', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(`PAGE: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()} @ ${message.location().url}`); });
page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: `${out}/loading.png`, fullPage: true });
await page.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
await page.screenshot({ path: `${out}/menu.png`, fullPage: true });
await page.locator('#garage-button').click();
await page.locator('#garage').waitFor({ state: 'visible' });
await page.locator('[data-color="ember"]').click();
await page.screenshot({ path: `${out}/garage.png`, fullPage: true });
await page.locator('#garage [data-back]').click();
await page.locator('#settings-button').click();
await page.locator('#settings').waitFor({ state: 'visible' });
await page.locator('#sensitivity').fill('1.4');
await page.locator('#settings [data-back]').click();
await page.locator('#credits-button').click();
await page.locator('#credits-list a').first().waitFor({ state: 'visible' });
await page.screenshot({ path: `${out}/credits.png`, fullPage: true });
await page.locator('#credits [data-back]').click();
await page.locator('#start-button').click();
await page.locator('#hud').waitFor({ state: 'visible' });
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyQ');
await page.keyboard.press('KeyE');
await page.waitForTimeout(1200);
const aim = await page.evaluate(() => window.__mecha?.debugAim());
const crosshair = await page.evaluate(() => {
  const node = document.querySelector('#crosshair');
  const part = node.querySelector('span');
  return { box: node.getBoundingClientRect().toJSON(), display: getComputedStyle(node).display, partBox: part.getBoundingClientRect().toJSON(), partBackground: getComputedStyle(part).backgroundColor };
});
await page.screenshot({ path: `${out}/game.png`, fullPage: true });
await page.mouse.down();
await page.waitForTimeout(7000);
await page.mouse.up();
const score = Number(await page.locator('#score').textContent());
const objective = await page.locator('#objective').textContent();
await page.screenshot({ path: `${out}/combat.png`, fullPage: true });
await page.keyboard.press('Escape');
await page.locator('#pause').waitFor({ state: 'visible' });
await page.screenshot({ path: `${out}/pause.png`, fullPage: true });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
mobile.on('pageerror', error => errors.push(`MOBILE PAGE: ${error.message}`));
await mobile.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await mobile.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
await mobile.screenshot({ path: `${out}/mobile-menu.png`, fullPage: true });
await mobile.locator('#garage-button').click();
await mobile.locator('#garage').waitFor({ state: 'visible' });
await mobile.screenshot({ path: `${out}/mobile-garage.png`, fullPage: true });
console.log(JSON.stringify({ menu: true, garage: true, settings: true, credits: true, gameplay: true, pause: true, mobile: true, aim, crosshair, score, objective, errors }, null, 2));
await browser.close();
if (errors.length || score <= 0 || !objective?.includes('1 / 3')) process.exitCode = 1;
