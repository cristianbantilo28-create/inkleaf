// End-to-end smoke test in headless Chromium against a local static server.
import pw from '/opt/npm-tools/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { netlifyHeaders, FAKE_BADGE } from './headers.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const headersFor = netlifyHeaders(root);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  // served as Netlify serves it: with the headers from netlify.toml and, on the app page, the injected badge script
  let body = fs.readFileSync(f); if (p === '/index.html') body = Buffer.from(body.toString().replace('</body>', FAKE_BADGE + '\n</body>'));
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', ...headersFor(p) }); res.end(body);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const target = process.argv[2] === 'artifact' ? `http://localhost:${port}/tools/artifact-host.html` : `http://localhost:${port}/index.html`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 }, hasTouch: false });
const page = await ctx.newPage(); page.setDefaultTimeout(8000); console.log('target', target);
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message)); page.on('crash', () => console.log('!! page crashed')); page.on('close', () => console.log('!! page closed'));
// Block Google Fonts so the test is deterministic/offline
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

const LOG = '/tmp/e2e.log'; fs.writeFileSync(LOG, ''); const olog = console.log; console.log = (...a) => { const s = a.join(' '); fs.appendFileSync(LOG, s + '\n'); olog(s); };
const step = async (name, fn) => { try { await fn(); console.log('ok   ', name); } catch (e) { console.log('FAIL ', name, '-', e.message.split('\n').slice(0, 6).join(' | ')); process.exitCode = 1; try { await page.screenshot({ path: root + '/tools/fail-' + name.replace(/\W+/g, '_').slice(0, 30) + '.png' }); } catch (e2) {} } };

await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }); console.log('loaded');
await page.waitForTimeout(600);

await step('first-run lock screen shows', async () => { await page.waitForSelector('#view-lock:not([hidden])', { timeout: 5000 }); });
if (!/artifact/.test(target)) await step('content-security-policy: injected badge script is refused, own scripts run', async () => {
  const r = await page.evaluate(() => ({ badge: !!window.__netlifyBadge || !!document.getElementById('netlify-badge'), theme: document.documentElement.getAttribute('data-theme'), app: !!(window.IL && IL.app) }));
  if (r.badge) throw new Error('the injected badge script ran');
  if (r.theme !== 'light' || !r.app) throw new Error('own scripts blocked: ' + JSON.stringify(r));
  const refused = errors.filter(e => /Refused to execute inline script|Executing inline script violates/.test(e)); if (refused.length !== 1) throw new Error('expected exactly one refused inline script, saw ' + refused.length);
  errors.splice(errors.indexOf(refused[0]), 1);   // the expected refusal is not a problem to report
});
await step('set a PIN 1234 and confirm', async () => {
  await page.click('#lock-setup-start');
  for (const k of '1234') await page.click(`#pin-pad [data-k="${k}"]`);
  await page.click('#pin-pad [data-k="ok"]');
  await page.waitForTimeout(300);
  for (const k of '1234') await page.click(`#pin-pad [data-k="${k}"]`);
  await page.waitForTimeout(800);
  // bio offer may or may not appear (headless: no platform authenticator)
  if (await page.isVisible('#lock-bio-setup')) await page.click('#lock-bio-skip');
  await page.waitForSelector('#view-home:not([hidden])', { timeout: 5000 });
});
await step('home shows the sample notebook cover', async () => { await page.waitForSelector('.nb-card .cover', { timeout: 3000 }); const n = await page.$$eval('.nb-card .cover', e => e.length); if (n < 1) throw new Error('no covers'); });
await step('reload → unlock with PIN', async () => {
  await page.reload(); await page.waitForSelector('#view-lock:not([hidden])', { timeout: 5000 });
  for (const k of '1234') await page.click(`#pin-pad [data-k="${k}"]`);
  await page.waitForSelector('#view-home:not([hidden])', { timeout: 5000 });
});
await step('wrong PIN is rejected', async () => {
  await page.evaluate(() => { IL.app.lockScreen.unlock().then(() => IL.app.showView('home')); });
  for (const k of '9999') await page.click(`#pin-pad [data-k="${k}"]`);
  await page.waitForTimeout(400);
  const err = await page.textContent('#lock-error'); if (!/Wrong/i.test(err)) throw new Error('no error shown: ' + err);
  for (const k of '1234') await page.click(`#pin-pad [data-k="${k}"]`);
  await page.waitForSelector('#view-home:not([hidden])', { timeout: 5000 });
});
await step('open the sample notebook', async () => { await page.click('.nb-card .cover'); await page.waitForSelector('#view-notebook:not([hidden])', { timeout: 5000 }); await page.waitForSelector('.page .row', { timeout: 3000 }); });
await step('rows show the sample text', async () => { const t = await page.textContent('.page .row'); if (!/Welcome/.test(t)) throw new Error('row text: ' + t); });

// Draw the word "hi" with the mouse on row 14 (empty) of page 1
async function drawGlyph(strokes, ox, oy, scale) {
  for (const s of strokes) {
    const pts = s.map(([x, y]) => [ox + x * scale, oy + y * scale]);
    await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 3 });
    await page.mouse.up();
  }
}
await step('write "hi" with the pen tool and convert it', async () => {
  const pageBox = await page.$eval('.page', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
  const s = pageBox.w / 800; const L = 34; const row = 14; const base = pageBox.y + (76 + (row + 1) * L) * s; // baseline in px
  const xh = 0.42 * L * s, tall = 0.72 * L * s; let x = pageBox.x + 120 * s;
  // h: stem + arch ; i: stem + dot
  const h = [[[0, -tall], [0, 0], [0, -xh * 0.7], [xh * 0.3, -xh], [xh * 0.7, -xh], [xh, -xh * 0.6], [xh, 0]]];
  await drawGlyph(h, x, base, 1); x += xh * 1.5;
  const i = [[[0, -xh], [0, 0]], [[0, -xh * 1.7], [0.5, -xh * 1.7 + 0.5]]];
  await drawGlyph(i, x, base, 1);
  const strokes = await page.evaluate(() => IL.app.editor.page.strokes.length); if (strokes < 3) throw new Error('strokes not recorded: ' + strokes);
  await page.click('#convert-btn'); await page.waitForTimeout(600);
  const text = await page.evaluate(() => IL.app.editor.page.rows[IL.app.editor.caret.row]);
  console.log('      caret row text:', JSON.stringify(text));
  if (!/\S+$/.test(text) || !(await page.evaluate(() => IL.app.editor.page.rows.join(' ').length)) ) throw new Error('row stayed empty');
  const left = await page.evaluate(() => IL.app.editor.page.strokes.length); if (left !== 0) throw new Error('ink not removed');
});
await step('undo restores the ink, redo re-applies', async () => {
  await page.click('#undo-btn'); await page.waitForTimeout(100);
  if ((await page.evaluate(() => IL.app.editor.page.strokes.length)) < 3) throw new Error('undo failed');
  await page.click('#redo-btn'); await page.waitForTimeout(100);
  if ((await page.evaluate(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('redo failed');
});
await step('typing in a row reflows to the next row when too long', async () => {
  await page.click('#tool-type');
  const rowEl = (await page.$$('.page .row'))[20];
  await rowEl.click(); await page.keyboard.type('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey');
  await page.waitForTimeout(200);
  const [r20, r21] = await page.evaluate(() => [IL.app.editor.page.rows[20], IL.app.editor.page.rows[21]]);
  console.log('      row20:', JSON.stringify(r20), '\n      row21:', JSON.stringify(r21));
  if (!r21) throw new Error('no overflow to next row');
});
await step('search finds words across pages and highlights', async () => {
  await page.click('#nb-search-btn'); await page.fill('#search-input', 'milk'); await page.waitForTimeout(400);
  const count = await page.textContent('#search-count'); console.log('      search count:', count);
  if (!/1 \/ /.test(count)) throw new Error('unexpected count ' + count);
  const pageIdx = await page.evaluate(() => IL.app.editor.pageIndex); if (pageIdx !== 1) throw new Error('did not jump to page 2, at ' + pageIdx);
  const marks = await page.$$eval('.page .row mark', m => m.length); if (!marks) throw new Error('no highlights');
  await page.fill('#search-input', 'the'); await page.waitForTimeout(400);
  const c2 = await page.textContent('#search-count'); console.log('      search "the":', c2);
  await page.click('#search-next'); await page.waitForTimeout(300); const c3 = await page.textContent('#search-count'); if (c3 === c2) throw new Error('next did not advance');
  await page.click('#search-close');
});
await step('insert a video link chip', async () => {
  await page.evaluate(() => IL.app.editor.addVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  await page.waitForTimeout(200);
  const chips = await page.$$eval('.pm-video a.vchip', a => a.map(x => x.href)); if (!chips.length) throw new Error('no chip'); console.log('      chip href:', chips[0]);
  const tool = await page.evaluate(() => IL.app.editor.tool); if (tool !== 'select') throw new Error('tool not select: ' + tool);
  if (await page.isHidden('#media-actions')) throw new Error('media actions hidden');
});
await step('insert a photo on the page', async () => {
  // make a tiny PNG in-page and feed it through the photo flow
  await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#4CA6F0'; x.fillRect(0, 0, 300, 200); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await IL.app.editor.addPhotos([new File([blob], 'test.png', { type: 'image/png' })]); });
  await page.waitForTimeout(400);
  const imgs = await page.$$eval('.pm-image img', i => i.map(x => x.getAttribute('src'))); if (!imgs.length || !imgs[0]) throw new Error('image not rendered');
});
await step('settings sheet opens; change font', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])');
  await page.click('#font-grid .font-opt[data-font="Lora"]'); await page.waitForTimeout(100);
  const fam = await page.evaluate(() => getComputedStyle(document.querySelector('.page .row')).fontFamily); if (!/Lora/.test(fam)) throw new Error('font not applied: ' + fam);
  await page.click('#paper-row .chip[data-paper="grid"]');
  await page.click('#sheet-settings .sheet-close');
});
await step('pages sheet lists pages; add a page', async () => {
  await page.click('#nb-pages-btn'); await page.waitForSelector('#sheet-pages:not([hidden])');
  const n = await page.$$eval('.page-thumb', t => t.length); if (n < 2) throw new Error('thumbs: ' + n);
  await page.click('#sheet-pages .sheet-close'); await page.click('#page-add'); await page.waitForTimeout(300);
  const ind = await page.textContent('#page-indicator'); if (!/Page 3 of 3/.test(ind)) throw new Error(ind);
});
await step('cover editor: theme, sticker, title', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await page.click('#nb-cover-btn');
  await page.waitForSelector('#view-cover:not([hidden])');
  await page.click('#theme-grid .swatch[data-theme="forest"]');
  await page.click('.tab[data-panel="stickers"]'); await page.click('#sticker-cats .chip[data-cat="sea"]'); await page.click('#sticker-grid .sticker-btn');
  await page.waitForTimeout(100);
  const n = await page.$$eval('#cover-canvas .cel-sticker', e => e.length); if (n < 1) throw new Error('sticker not added');
  if (await page.isHidden('#el-actions')) throw new Error('element actions not shown');
  await page.click('.tab[data-panel="title"]'); await page.fill('#title-input', 'My Travel Journal'); await page.waitForTimeout(100);
  const t = await page.textContent('#cover-canvas .cel-text'); if (t !== 'My Travel Journal') throw new Error('title: ' + t);
  // drag the sticker
  const st = await page.$('#cover-canvas .cel-sticker'); const b = await st.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  const b2 = await (await page.$('#cover-canvas .cel-sticker')).boundingBox(); if (Math.abs(b2.x - b.x - 40) > 6) throw new Error('drag moved by ' + (b2.x - b.x));
  await page.click('#cover-done'); await page.waitForSelector('#view-notebook:not([hidden])');
  const title = await page.textContent('#nb-title'); if (title !== 'My Travel Journal') throw new Error('title not synced: ' + title);
});
await step('data survives reload', async () => {
  await page.click('#nb-back'); await page.waitForSelector('#view-home:not([hidden])');
  await page.reload(); await page.waitForSelector('#view-lock:not([hidden])'); for (const k of '1234') await page.click(`#pin-pad [data-k="${k}"]`); await page.waitForSelector('#view-home:not([hidden])');
  const names = await page.$$eval('.nb-name', e => e.map(x => x.textContent)); if (!names.includes('My Travel Journal')) throw new Error(names.join(','));
  await page.click('.nb-card .cover'); await page.waitForSelector('.page .row');
  const pages = await page.evaluate(() => IL.app.editor.pages.length); if (pages !== 3) throw new Error('pages ' + pages);
  const media = await page.evaluate(() => IL.app.editor.pages.reduce((n, p) => n + p.media.length, 0)); if (media !== 2) throw new Error('media ' + media);
});
await step('phone-width layout has no horizontal overflow', async () => {
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1); if (over) throw new Error('horizontal overflow at 390px');
  await page.screenshot({ path: root + '/tools/shot-phone.png' });
  await page.setViewportSize({ width: 1100, height: 800 });
});
await page.screenshot({ path: root + '/tools/shot-desktop.png' });
await step('export produces a backup JSON', async () => {
  await page.evaluate(() => IL.app.exportNotebook(IL.app.current)); await page.waitForTimeout(800);
  const st = await page.textContent('#export-status'); console.log('      export:', st); if (!/ready/.test(st)) throw new Error(st);
});

console.log('\nconsole errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close(); server.close();
