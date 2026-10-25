// Interaction test: pen + finger input via the DevTools protocol, pinch zoom, picture handling, and a sweep over every control.
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { netlifyHeaders, FAKE_BADGE } from './headers.mjs';
import os from 'node:os';
const { chromium } = pw;

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
const url = `http://localhost:${server.address().port}/index.html`;

const LOG = '/tmp/e2e-input.log'; fs.writeFileSync(LOG, '');
const log = (...a) => { const s = a.join(' '); fs.appendFileSync(LOG, s + '\n'); process.stdout.write(s + '\n'); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 }, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(8000);
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/ERR_FAILED|fonts\.|GL Driver Message|Refused to execute inline script|Executing inline script violates/.test(t)) errors.push(`[${m.type()}] ${t}`); } });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const cdp = await ctx.newCDPSession(page);
let fails = 0;
const step = async (name, fn) => { try { await fn(); log('ok   ', name); } catch (e) { fails++; log('FAIL ', name, '-', e.message.split('\n').slice(0, 4).join(' | ')); try { await page.screenshot({ path: `/tmp/fail-${name.replace(/\W+/g, '_').slice(0, 40)}.png` }); } catch (e2) {} } };
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const sleep = ms => page.waitForTimeout(ms);
const waitFor = async (fn, arg, ms = 14000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await sleep(60); } return false; };
const settled = () => waitFor(() => !IL.app.editor.flipBusy && !IL.app.editor.flip, null, 14000);

/* ---- input helpers ---- */
async function pen(points, pressure = 0.6) {
  const [x0, y0] = points[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: pressure });
  for (const [x, y] of points.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: pressure });
  const [xe, ye] = points[points.length - 1];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xe, y: ye, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
}
async function finger(points, id = 0) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1], id }] });
  for (const [x, y] of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function pinch(cx, cy, d0, d1, steps = 8) {
  const pts = d => [{ x: cx - d / 2, y: cy, id: 0 }, { x: cx + d / 2, y: cy, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts(d0)[0]] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pts(d1)[1]] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function mouseDrag(x0, y0, x1, y1, steps = 6) { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.mouse.up(); }
const SHAPES = {
  h: [[[20, 0], [20, 100], [20, 74], [22, 60], [32, 52], [44, 52], [56, 58], [64, 68], [68, 76], [68, 100]]],
  e: [[[18, 70], [80, 70], [78, 56], [66, 44], [50, 40], [34, 44], [22, 56], [18, 70], [22, 84], [34, 96], [50, 100], [64, 96]]],
  l: [[[50, 0], [50, 100]]],
  o: [[[50, 40], [70, 46], [78, 70], [70, 94], [50, 100], [30, 94], [22, 70], [30, 46], [50, 40]]],
};
function densify(poly, step) { const out = [poly[0]]; for (let i = 1; i < poly.length; i++) { const [x0, y0] = poly[i - 1], [x1, y1] = poly[i]; const d = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.ceil(d / step)); for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]); } return out; }
async function pageGeom(slot = 0) { return ev(slot => { const r = document.querySelectorAll('.page:not(.page-ghost)')[slot].getBoundingClientRect(); return { x: r.left, y: r.top, s: IL.app.editor.s, L: IL.app.editor.L }; }, slot); }
async function writeWord(word, row, input = 'pen', slot = 0) {
  const g = await pageGeom(slot); const base = g.y + (76 + (row + 1) * g.L) * g.s; let x = g.x + 110 * g.s;
  for (const ch of word) {
    if (ch === ' ') { x += 0.6 * g.L * g.s; continue; }
    const tall = 'hl'.includes(ch); const h = (tall ? 0.72 : 0.42) * g.L * g.s; const w = (ch === 'l' ? 0.3 : 0.9) * h;
    for (const s of SHAPES[ch]) { const pts = densify(s, 8).map(([px, py]) => [x + px / 100 * w, base - (100 - py) / 100 * h]); if (input === 'pen') await pen(pts); else await finger(pts); }
    x += w + 0.1 * g.L * g.s;
  }
}

/* ---- flow ---- */
await page.goto(url, { waitUntil: 'domcontentloaded' });
await step('first run → skip lock → open sample', async () => { await page.waitForSelector('#view-lock:not([hidden])'); await page.click('#lock-setup-skip'); await page.waitForSelector('#view-home:not([hidden])'); await page.click('.nb-card .cover'); await page.waitForSelector('.page .row'); await sleep(200); });

await step('LIVE: recognizer worker boots; neural engine loads with SIMD kernels', async () => {
  await ev(() => IL.hwrClient.boot()); const w = await ev(() => IL.hwrClient.inWorker); log('      in worker:', w); if (!w) throw new Error('worker not running');
  await waitFor(() => IL.hwrClient.neural.ready, null, 15000); const nn = await ev(() => IL.hwrClient.neural); log('      neural:', JSON.stringify(nn)); if (!nn.ready) throw new Error('neural engine did not load');
  // the neural engine reads a word drawn with the pen (a rough cursive "me") and answers quickly
  const g0 = await pageGeom(); const y = g0.y + (76 + 5.5 * g0.L) * g0.s; const x = g0.x + 120 * g0.s; const u = g0.L * 0.45 * g0.s;
  const pts = []; for (let i = 0; i <= 80; i++) { const t = i / 80; pts.push([x + t * 5 * u, y - Math.abs(Math.sin(t * Math.PI * 4)) * u * 0.9]); }
  const t0 = Date.now(); const words = await ev(async (pts) => { const strokes = [{ pts: pts.map(p => [p[0], p[1], 0.5, 0]), at: Date.now() }]; const r = await IL.hwrClient.recognizeRowWords(strokes, pts[0][1] - 30, 34); return r; }, pts);
  log('      neural read of a wavy scribble:', JSON.stringify(words.map(w => w.text)), 'in', Date.now() - t0, 'ms'); if (!words.length) throw new Error('neural engine returned nothing');
  // the rest of the suite drives the UI with the classic engine, whose built-in letter shapes the test letters are drawn from
  await ev(() => { IL.app.settings.engine = 'inkleaf'; IL.app.settings.engineChosen = true; IL.hwrClient.setMode('classic'); IL.app.editor.applyEngine(); });
});
await step('FLOW: on a new page the very first line gets populated; preview within 0.3 s; pen detected', async () => {
  await ev(() => { IL.app.settings.live = true; IL.app.settings.autoDelay = 1.2; });
  await page.click('#page-add'); await sleep(400);
  if ((await ev(() => IL.app.editor.caret.row)) !== 0) throw new Error('caret should start on line 1');
  await writeWord('hello', 14, 'pen'); await sleep(300);   // written far down the page, lands on line 1
  const pv = await ev(() => [...document.querySelectorAll('.pv')].map(p => p.textContent)); log('      preview:', JSON.stringify(pv)); if (!pv.length) throw new Error('no preview');
  const st = await ev(() => IL.app.settings); if (!st.penSeen || st.fingerDraws) throw new Error('pen detection did not switch finger mode');
  await sleep(1600);
  const r0 = await ev(() => IL.app.editor.page.rows[0]); log('      line 1 =', JSON.stringify(r0)); if (r0 !== 'hello') throw new Error('first line not populated: ' + JSON.stringify(r0));
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('ink left');
});
await step('FLOW: next word commits the previous one; words keep flowing on the same line', async () => {
  const g = await pageGeom(); const base = g.y + (76 + 20 * g.L) * g.s; const h = 0.42 * g.L * g.s; let x = g.x + 300 * g.s;
  for (const ch of 'lo') { const hh = ch === 'l' ? 0.72 * g.L * g.s : h, w = ch === 'l' ? 0.3 * hh : 0.9 * hh; for (const sk of SHAPES[ch]) await pen(densify(sk, 8).map(([px, py]) => [x + px / 100 * w, base - (100 - py) / 100 * hh])); x += w + 0.1 * g.L * g.s; }
  x += 0.6 * g.L * g.s;
  for (const ch of 'he') { const hh = ch === 'h' ? 0.72 * g.L * g.s : h, w = 0.9 * hh; for (const sk of SHAPES[ch]) await pen(densify(sk, 8).map(([px, py]) => [x + px / 100 * w, base - (100 - py) / 100 * hh])); x += w + 0.1 * g.L * g.s; }
  await sleep(700);
  let t = await ev(() => IL.app.editor.page.rows[0]); log('      after 2nd word started:', JSON.stringify(t)); if (t !== 'hello lo') throw new Error('first word of the line not committed: ' + JSON.stringify(t));
  await sleep(1500);
  t = await ev(() => IL.app.editor.page.rows[0]); log('      after pause:', JSON.stringify(t)); if (!/^hello lo \S+$/.test(t)) throw new Error('last word not committed: ' + JSON.stringify(t));
  if ((await ev(() => document.querySelectorAll('.pv').length)) !== 0) throw new Error('preview not cleared');
});
await step('ENTER button: hidden while the pen is down, moves to the next line', async () => {
  if (await page.isHidden('#enter-btn')) throw new Error('enter button not visible');
  const g = await pageGeom(); const x = g.x + 200 * g.s, y = g.y + 700 * g.s;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 20, y: y + 5, button: 'left', buttons: 1, pointerType: 'pen', force: 0.5 });
  const during = await ev(() => document.getElementById('page-area').classList.contains('is-writing')); 
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 20, y: y + 5, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  const justAfter = await ev(() => document.getElementById('page-area').classList.contains('is-writing')); await sleep(450);
  const after = await ev(() => document.getElementById('page-area').classList.contains('is-writing'));
  log('      is-writing during/just after/0.4 s later:', during, justAfter, after); if (!during || after) throw new Error('enter button visibility while writing');
  // a finger whose lift never reaches the page (slid off it) must not keep the button hidden
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 100, y, id: 7 }] });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: y + 60, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 10, y: y + 62, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(450);
  if (await ev(() => document.getElementById('page-area').classList.contains('is-writing'))) throw new Error('enter button stayed hidden after a stray touch');
  log('      input state after stray touch:', JSON.stringify(await ev(() => { const ed = IL.app.editor; return { touches: ed.touches.size, pan: !!ed.pan, pinch: !!ed.pinch, live: !!ed.live, strokes: ed.page.strokes.length }; })));
  for (let i = 0; i < 3 && (await ev(() => IL.app.editor.page.strokes.length)) > 0; i++) { await page.click('#undo-btn'); await sleep(100); }
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0 || (await ev(() => IL.app.editor.touches.size)) !== 0) throw new Error('left-over state after the Enter test');
  await page.click('#undo-btn'); await sleep(100);
  await page.click('#enter-btn'); await sleep(300);
  if ((await ev(() => IL.app.editor.caret.row)) !== 1) throw new Error('caret did not move to line 2: ' + (await ev(() => IL.app.editor.caret.row)));
  await page.click('#enter-btn'); await sleep(200); if ((await ev(() => IL.app.editor.caret.row)) !== 2) throw new Error('second enter');
});
await step('WRITE ANYWHERE: big letters in the middle of the page land on the caret line', async () => {
  const g = await pageGeom(); const base = g.y + (76 + 26 * g.L) * g.s; const big = 2.2; // letters spanning ~2 rows
  const h = 0.42 * g.L * g.s * big; let x = g.x + 250 * g.s;
  for (const ch of 'hello') { const hh = 'hl'.includes(ch) ? 0.72 * g.L * g.s * big : h, w = ch === 'l' ? 0.3 * hh : 0.9 * hh; for (const sk of SHAPES[ch]) await pen(densify(sk, 6).map(([px, py]) => [x + px / 100 * w, base - (100 - py) / 100 * hh])); x += w + 0.1 * g.L * g.s * big; }
  await sleep(2000);
  const t = await ev(() => IL.app.editor.page.rows[2]); log('      line 3 =', JSON.stringify(t)); if (t !== 'hello') throw new Error('big writing not placed on the caret line: ' + JSON.stringify(t));
});
await step('GESTURES: X over a word deletes it; scribble deletes; strike-through deletes; undo restores', async () => {
  // line 1 currently reads "hello lo <word>"; line 3 reads "hello"
  const g = await pageGeom(); const words = await ev(() => IL.app.editor.rowWords(2)); const w = words[0]; // "hello" on line 3
  const yTop = g.y + (76 + 2 * g.L + 0.15 * g.L) * g.s, yBot = g.y + (76 + 2 * g.L + 0.8 * g.L) * g.s, x0 = g.x + w.x0 * g.s, x1 = g.x + w.x1 * g.s;
  await pen([[x0, yTop], [(x0 + x1) / 2, (yTop + yBot) / 2], [x1, yBot]]); await sleep(120);
  await pen([[x1, yTop], [(x0 + x1) / 2, (yTop + yBot) / 2], [x0, yBot]]); await sleep(300);
  let t = await ev(() => IL.app.editor.page.rows[2]); log('      after X:', JSON.stringify(t)); if (t !== '') throw new Error('X did not delete: ' + JSON.stringify(t));
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('gesture ink left');
  await page.click('#undo-btn'); await sleep(200); t = await ev(() => IL.app.editor.page.rows[2]); if (t !== 'hello') throw new Error('undo did not restore: ' + JSON.stringify(t));
  // scribble over it
  const yMid = (yTop + yBot) / 2; const zig = []; for (let i = 0; i <= 12; i++) zig.push([x0 + (x1 - x0) * i / 12, yMid + (i % 2 ? -1 : 1) * 0.25 * g.L * g.s]);
  await pen(zig); await sleep(300); t = await ev(() => IL.app.editor.page.rows[2]); log('      after scribble:', JSON.stringify(t)); if (t !== '') throw new Error('scribble did not delete');
  await page.click('#undo-btn'); await sleep(200);
  // strike-through the middle word "lo" on line 1
  const w1 = (await ev(() => IL.app.editor.rowWords(0)))[1]; const ys = g.y + (76 + 0.5 * g.L) * g.s;
  await pen([[g.x + (w1.x0 - 2) * g.s, ys], [g.x + (w1.x1 + 2) * g.s, ys + 1]]); await sleep(300);
  t = await ev(() => IL.app.editor.page.rows[0]); log('      after strike:', JSON.stringify(t)); if (/\blo\b/.test(t) || !/^hello \S+$/.test(t)) throw new Error('strike did not delete the middle word: ' + JSON.stringify(t));
  await page.click('#undo-btn'); await sleep(200);
});
await step('ERASER on text: rubbing a typed word deletes it; over a highlight it removes only the highlight; undo restores', async () => {
  const g = await pageGeom(); const words = await ev(() => IL.app.editor.rowWords(0)); const w = words[1]; // "lo" on line 1
  const y = g.y + (76 + 0.5 * g.L) * g.s;
  await page.click('#tool-eraser');
  await pen([[g.x + (w.x0 - 1) * g.s, y], [g.x + ((w.x0 + w.x1) / 2) * g.s, y + 1], [g.x + (w.x1 + 1) * g.s, y]]); await sleep(250);
  let t = await ev(() => IL.app.editor.page.rows[0]); log('      after erasing a word:', JSON.stringify(t)); if (/\blo\b/.test(t) || !/^hello \S+$/.test(t)) throw new Error('eraser did not delete the word: ' + JSON.stringify(t));
  await page.click('#undo-btn'); await sleep(150); t = await ev(() => IL.app.editor.page.rows[0]); if (!/^hello lo \S+$/.test(t)) throw new Error('undo did not restore: ' + JSON.stringify(t));
  // highlight over "hello" then erase: only the highlight goes
  await page.click('#tool-hl'); const w0 = words[0];
  await pen([[g.x + (w0.x0 - 4) * g.s, y], [g.x + (w0.x1 + 4) * g.s, y + 1]]); await sleep(150);
  if ((await ev(() => IL.app.editor.page.strokes.filter(s => s.kind === 'hl').length)) !== 1) throw new Error('no highlight');
  await page.click('#tool-eraser'); await pen([[g.x + (w0.x0 + 2) * g.s, y], [g.x + ((w0.x0 + w0.x1) / 2) * g.s, y + 1], [g.x + (w0.x1 - 2) * g.s, y]]); await sleep(250);
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('highlight not erased');
  t = await ev(() => IL.app.editor.page.rows[0]); if (!/^hello lo \S+$/.test(t)) throw new Error('eraser removed text under the highlight: ' + JSON.stringify(t));
  await page.click('#tool-pen');
});
await step('FLOW: a late i-dot is absorbed into the committed word', async () => {
  await page.click('#enter-btn'); await sleep(200);
  const g = await pageGeom(); const base = g.y + (76 + 16 * g.L) * g.s; const xh = 0.42 * g.L * g.s; const x = g.x + 140 * g.s;
  await pen([[x, base - xh], [x, base]]); await sleep(1700);
  let t = await ev(() => IL.app.editor.page.rows[3]); log('      stem alone →', JSON.stringify(t)); if (!t) throw new Error('stem not committed');
  await pen([[x, base - xh * 1.8], [x + 0.6, base - xh * 1.8 + 0.6]]); await sleep(500);
  t = await ev(() => IL.app.editor.page.rows[3]); log('      after dot →', JSON.stringify(t)); if (!/^[iI!]$/.test(t)) throw new Error('dot not absorbed: ' + JSON.stringify(t));
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('dot left as ink');
});
await step('FLOW: undo of a commit restores ink without re-committing; Convert button finishes it', async () => {
  await page.click('#undo-btn'); await page.click('#undo-btn'); await sleep(1800);
  const n = await ev(() => IL.app.editor.page.strokes.length); const t = await ev(() => IL.app.editor.page.rows[3]);
  log('      after undo: strokes', n, 'line 4', JSON.stringify(t)); if (n < 1) throw new Error('ink not restored'); if (t) throw new Error('re-committed after undo');
  await page.click('#convert-btn'); await sleep(600);
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('convert button left ink');
  await ev(() => { IL.app.settings.live = false; });
});
await step('FINGER: single finger pans instead of drawing', async () => {
  const g = await pageGeom(); const before = await ev(() => document.getElementById('page-scroller').scrollTop);
  await page.click('#zoom-in-btn'); await page.click('#zoom-in-btn'); await sleep(100);
  await finger([[g.x + 300, 700], [g.x + 300, 650], [g.x + 300, 600], [g.x + 300, 500]]); await sleep(100);
  const after = await ev(() => document.getElementById('page-scroller').scrollTop);
  const n = await ev(() => IL.app.editor.page.strokes.length);
  if (n !== 0) throw new Error('finger drew ' + n); if (after <= before) throw new Error(`no pan ${before}→${after}`);
  await ev(() => { IL.app.editor.setZoom(1); document.getElementById('page-scroller').scrollTop = 0; });
});
await step('FINGER: toggle finger-draws → finger writes a stroke', async () => {
  await page.click('#finger-btn'); await sleep(50);
  await writeWord('o', 16, 'finger'); await sleep(100);
  const n = await ev(() => IL.app.editor.page.strokes.length); if (n !== 1) throw new Error('strokes ' + n);
});
await step('PINCH: two fingers zoom in and out without drawing', async () => {
  const z0 = await ev(() => IL.app.editor.zoom); const n0 = await ev(() => IL.app.editor.page.strokes.length);
  await pinch(450, 600, 120, 320); await sleep(150);
  const z1 = await ev(() => IL.app.editor.zoom); if (!(z1 > z0 * 1.5)) throw new Error(`zoom ${z0}→${z1}`);
  await pinch(450, 600, 320, 140); await sleep(150);
  const z2 = await ev(() => IL.app.editor.zoom); if (!(z2 < z1)) throw new Error(`zoom out ${z1}→${z2}`);
  const n1 = await ev(() => IL.app.editor.page.strokes.length); if (n1 !== n0) throw new Error('pinch drew strokes');
  await ev(() => IL.app.editor.setZoom(1));
});
await step('ERASER: pen erases the finger stroke; undo restores', async () => {
  await page.click('#tool-eraser'); const g = await pageGeom();
  const b = await ev(() => { const s = IL.app.editor.page.strokes[0]; const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, x0: Math.min(...xs) }; });
  await pen([[g.x + (b.x0 - 5) * g.s, g.y + b.y * g.s], [g.x + b.x * g.s, g.y + b.y * g.s], [g.x + (b.x + 10) * g.s, g.y + b.y * g.s]]); await sleep(100);
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('not erased');
  await page.click('#undo-btn'); if ((await ev(() => IL.app.editor.page.strokes.length)) !== 1) throw new Error('undo failed');
  await page.click('#redo-btn'); if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('redo failed');
  await page.click('#tool-pen');
});
await step('PHOTO: insert → selected in Select mode with action bar', async () => {
  await ev(async () => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#F4A03A'; x.fillRect(0, 0, 400, 300); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await IL.app.editor.addPhotos([new File([blob], 'sunset.png', { type: 'image/png' })]); });
  await sleep(300);
  if ((await ev(() => IL.app.editor.tool)) !== 'select') throw new Error('tool'); if (!(await ev(() => IL.app.editor.tf.selected()))) throw new Error('not selected');
  if (await page.isHidden('#media-actions')) throw new Error('actions hidden');
});
async function photoCenter() { return ev(() => { const r = document.querySelector('.pm-image').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, r }; }); }
await step('PHOTO: deselect by tapping paper, then re-select by tapping it with the PEN tool', async () => {
  const g = await pageGeom(); await page.mouse.click(g.x + 60, g.y + 40); await sleep(100);
  if (await ev(() => IL.app.editor.tf.selected())) throw new Error('still selected');
  await page.click('#tool-pen'); const c = await photoCenter();
  await pen([[c.x, c.y], [c.x + 0.5, c.y + 0.5]]); await sleep(150);
  if ((await ev(() => IL.app.editor.tool)) !== 'select') throw new Error('tool is ' + (await ev(() => IL.app.editor.tool)));
  if (!(await ev(() => IL.app.editor.tf.selected()))) throw new Error('photo not selected');
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('tap left a stroke');
});
await step('PHOTO: finger tap in Keyboard mode selects it too', async () => {
  const g = await pageGeom(); await page.mouse.click(g.x + 60, g.y + 40); await page.click('#tool-type'); const c = await photoCenter();
  await page.touchscreen.tap(c.x, c.y); await sleep(150);
  if ((await ev(() => IL.app.editor.tool)) !== 'select' || !(await ev(() => IL.app.editor.tf.selected()))) throw new Error('not selected via finger');
});
await step('PHOTO: drag moves it (mouse) and (finger)', async () => {
  let c = await photoCenter(); const m0 = await ev(() => ({ ...IL.app.editor.page.media[0] }));
  await mouseDrag(c.x, c.y, c.x + 80, c.y + 40); await sleep(100);
  let m1 = await ev(() => ({ ...IL.app.editor.page.media[0] })); const g = await pageGeom();
  if (Math.abs((m1.x - m0.x) * g.s - 80) > 4) throw new Error(`mouse drag dx=${(m1.x - m0.x) * g.s}`);
  c = await photoCenter(); await finger([[c.x, c.y], [c.x - 20, c.y - 10], [c.x - 40, c.y - 20], [c.x - 60, c.y - 30]]); await sleep(100);
  const m2 = await ev(() => ({ ...IL.app.editor.page.media[0] })); if (Math.abs((m2.x - m1.x) * g.s + 60) > 4) throw new Error(`finger drag dx=${(m2.x - m1.x) * g.s}`);
});
await step('PHOTO: corner handle resizes, top handle rotates', async () => {
  const m0 = await ev(() => ({ ...IL.app.editor.page.media[0] }));
  const se = await ev(() => { const r = document.querySelector('.page .tf-h.se').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await mouseDrag(se.x, se.y, se.x + 60, se.y + 45); await sleep(100);
  const m1 = await ev(() => ({ ...IL.app.editor.page.media[0] })); if (!(m1.w > m0.w * 1.15)) throw new Error(`w ${m0.w}→${m1.w}`); if (Math.abs(m1.w / m1.h - m0.w / m0.h) > 0.02) throw new Error('aspect changed');
  const rot = await ev(() => { const r = document.querySelector('.page .tf-h.rot').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const c = await photoCenter();
  await mouseDrag(rot.x, rot.y, c.x + 120, c.y - 60, 10); await sleep(100);
  const m2 = await ev(() => ({ ...IL.app.editor.page.media[0] })); if (Math.abs(m2.rot) < 10) throw new Error('rot ' + m2.rot);
  log('      size', Math.round(m0.w), '→', Math.round(m1.w), ' rot →', Math.round(m2.rot));
});
await step('PHOTO: front/back buttons, delete via trash, undo brings it back', async () => {
  await page.click('#media-actions [data-act="front"]'); await page.click('#media-actions [data-act="back"]'); await sleep(50);
  await page.click('#media-actions [data-act="del"]'); await sleep(100);
  if ((await ev(() => IL.app.editor.page.media.length)) !== 0) throw new Error('not deleted'); if (!(await page.isHidden('#media-actions'))) throw new Error('actions still visible');
  await page.click('#undo-btn'); await sleep(100); if ((await ev(() => IL.app.editor.page.media.length)) !== 1) throw new Error('undo failed');
  if (!(await ev(() => !!document.querySelector('.pm-image img').getAttribute('src')))) throw new Error('image src lost after undo');
});
await step('PEN in Select mode on empty paper writes immediately', async () => {
  await ev(() => IL.app.editor.tf.select(IL.app.editor.page.media[0].id)); const g = await pageGeom();
  const spot = await ev(() => { for (const y of [1060, 1000, 940, 880]) for (const x of [120, 300, 500, 650]) if (!IL.app.editor.hitMedia(x, y)) return { x, y }; return { x: 120, y: 1060 }; });
  await pen([[g.x + spot.x * g.s, g.y + spot.y * g.s], [g.x + (spot.x + 30) * g.s, g.y + (spot.y + 8) * g.s], [g.x + (spot.x + 60) * g.s, g.y + spot.y * g.s]]); await sleep(100);
  if ((await ev(() => IL.app.editor.tool)) !== 'pen') throw new Error('tool'); if ((await ev(() => IL.app.editor.page.strokes.length)) !== 1) throw new Error('no stroke');
  await page.click('#undo-btn');
});
await step('VIDEO LINK chip: added, clickable href, selectable, renamable', async () => {
  await ev(() => IL.app.editor.addVideoLink('youtube.com/watch?v=abc')); await sleep(100);
  const href = await ev(() => document.querySelector('.pm-video a').href); if (!/^https:\/\/youtube\.com/.test(href)) throw new Error(href);
  if (!(await ev(() => IL.app.editor.tf.selected()))) throw new Error('not selected');
  await page.click('#media-actions [data-act="rename"]'); await page.waitForSelector('#sheet-prompt:not([hidden])'); await page.fill('#prompt-input', 'Lecture 3'); await page.click('#prompt-ok'); await sleep(100);
  if ((await page.textContent('.pm-video .vname')) !== 'Lecture 3') throw new Error('rename failed');
  await page.click('#media-actions [data-act="del"]');
});
await step('LIVE: switching tool commits pending ink; Live toggle button works', async () => {
  await page.click('#tool-pen'); await ev(() => { IL.app.settings.live = true; IL.app.settings.autoDelay = 3; });
  const len0 = await ev(() => IL.app.editor.page.rows.join('').length);
  await writeWord('lo', 18, 'pen'); await sleep(300);
  await page.click('#tool-select'); await sleep(700);
  const len1 = await ev(() => IL.app.editor.page.rows.join('').length); const n = await ev(() => IL.app.editor.page.strokes.length);
  log('      text grew by', len1 - len0, 'strokes left', n); if (len1 <= len0 || n !== 0) throw new Error('tool switch did not commit');
  await page.click('#tool-pen'); await page.click('#auto-btn'); if ((await ev(() => IL.app.settings.live)) !== false) throw new Error('toggle off failed'); await page.click('#auto-btn'); if (!(await ev(() => IL.app.settings.live))) throw new Error('toggle on failed');
  await ev(() => { IL.app.settings.live = false; IL.app.settings.autoDelay = 1.2; });
});

await step('HIGHLIGHTER: translucent stroke, ignored by live mode, removable by the eraser', async () => {
  await ev(() => { IL.app.settings.live = true; }); await ev(() => IL.app.editor.goTo(0)); await sleep(300); await page.click('#tool-hl');
  if (await page.isHidden('#hl-colors')) throw new Error('highlighter colors hidden'); await page.click('#hl-colors .hl-dot:nth-child(3)');
  const g = await pageGeom(); const y = g.y + (76 + 1.5 * g.L) * g.s; // across the first text row
  await pen([[g.x + 100 * g.s, y], [g.x + 250 * g.s, y + 1], [g.x + 400 * g.s, y]]); await sleep(200);
  const st = await ev(() => IL.app.editor.page.strokes.map(s => ({ kind: s.kind, color: s.color, w: s.width })));
  log('      strokes:', JSON.stringify(st)); if (st.length !== 1 || st[0].kind !== 'hl' || st[0].color !== '#FFB5D8') throw new Error('no highlighter stroke');
  if ((await ev(() => document.querySelectorAll('.pv').length)) !== 0) throw new Error('highlighter produced a preview');
  await sleep(1600); if ((await ev(() => IL.app.editor.page.strokes.length)) !== 1) throw new Error('live mode converted the highlight');
  const row0 = await ev(() => IL.app.editor.page.rows[0]); if (row0 !== 'Welcome to Inkleaf') throw new Error('row text changed: ' + row0);
  await page.click('#tool-eraser'); await pen([[g.x + 240 * g.s, y - 4], [g.x + 260 * g.s, y + 4]]); await sleep(100);
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== 0) throw new Error('eraser did not remove the highlight');
  await page.click('#tool-pen'); await ev(() => { IL.app.settings.live = false; });
});

/* ---- lasso ---- */
const strokeInfo = () => ev(() => IL.app.editor.page.strokes.map(s => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of s.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return { x0, y0, x1, y1, color: s.color, w: s.width, kind: s.kind }; }));
const lassoBox = () => ev(() => { const el = document.querySelector('.page.is-active .lasso-box, .page .lasso-box:not([hidden])'); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
await step('LASSO: a loop around a word picks up its strokes; frame and action bar appear; loop around nothing picks nothing', async () => {
  await ev(() => { IL.app.settings.live = false; }); await ev(() => IL.app.editor.goTo(0)); await sleep(200); await page.click('#tool-pen');
  await writeWord('hello', 6, 'pen'); await writeWord('lo', 9, 'pen'); await sleep(200);
  const n0 = await ev(() => IL.app.editor.page.strokes.length); log('      strokes written:', n0); if (n0 < 7) throw new Error('writing failed');
  await page.click('#tool-lasso'); if (!(await ev(() => document.querySelector('.page').classList.contains('tool-lasso')))) throw new Error('lasso tool not active');
  const info = await strokeInfo(); const g = await pageGeom();
  const word = info.slice(0, n0 - 2); const bx0 = Math.min(...word.map(b => b.x0)) - 12, bx1 = Math.max(...word.map(b => b.x1)) + 12, by0 = Math.min(...word.map(b => b.y0)) - 12, by1 = Math.max(...word.map(b => b.y1)) + 12;
  const loop = densify([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1], [bx0, by0 + 2]], 10).map(([x, y]) => [g.x + x * g.s, g.y + y * g.s]);
  await pen(loop); await sleep(150);
  const sel = await ev(() => IL.app.editor.lassoSel ? IL.app.editor.lassoSel.strokes.length : 0); log('      picked up:', sel, 'of', n0);
  if (sel !== n0 - 2) throw new Error(`expected ${n0 - 2} strokes, got ${sel}`);
  if (!(await lassoBox())) throw new Error('no selection frame'); if (await page.isHidden('#lasso-actions')) throw new Error('action bar hidden');
  if ((await ev(() => IL.app.editor.page.strokes.length)) !== n0) throw new Error('lasso loop left ink behind');
  // a loop on empty paper selects nothing and clears the selection
  const ey = g.y + (76 + 15 * g.L) * g.s; await pen(densify([[g.x + 500 * g.s, ey], [g.x + 560 * g.s, ey], [g.x + 560 * g.s, ey + 40], [g.x + 500 * g.s, ey + 40], [g.x + 500 * g.s, ey + 2]], 8)); await sleep(100);
  if (await ev(() => !!IL.app.editor.lassoSel)) throw new Error('empty loop kept a selection'); if (!(await page.isHidden('#lasso-actions'))) throw new Error('action bar still shown');
});
await step('LASSO: tap on a word picks the whole word; dragging the frame moves the ink; undo moves it back', async () => {
  const info = await strokeInfo(); const g = await pageGeom(); const first = info[0];
  await pen([[g.x + (first.x0 + 1) * g.s, g.y + (first.y0 + first.y1) / 2 * g.s]]); await sleep(150);
  const sel = await ev(() => IL.app.editor.lassoSel ? IL.app.editor.lassoSel.strokes.length : 0); log('      tap picked:', sel); if (sel < info.length - 2) throw new Error('tap did not pick the word: ' + sel);
  const b = await lassoBox(); const before = await strokeInfo();
  await pen([[b.cx, b.cy], [b.cx + 20, b.cy + 10], [b.cx + 60, b.cy + 30], [b.cx + 90, b.cy + 45]]); await sleep(200);
  const after = await strokeInfo(); const dx = (after[0].x0 - before[0].x0) * g.s, dy = (after[0].y0 - before[0].y0) * g.s; log('      moved by (screen px):', dx.toFixed(1), dy.toFixed(1));
  if (Math.abs(dx - 90) > 3 || Math.abs(dy - 45) > 3) throw new Error('ink did not follow the drag');
  if (Math.abs(after[after.length - 1].x0 - before[before.length - 1].x0) > 0.01) throw new Error('unselected ink moved too');
  if (await page.isHidden('#lasso-actions')) throw new Error('action bar not back after the move');
  await page.click('#undo-btn'); await sleep(100); const undone = await strokeInfo(); if (Math.abs(undone[0].x0 - before[0].x0) > 0.01) throw new Error('undo did not move it back');
  await page.click('#redo-btn'); await sleep(100); const redone = await strokeInfo(); if (Math.abs(redone[0].x0 - after[0].x0) > 0.01) throw new Error('redo failed');
});
await step('LASSO: corner handle resizes; ink colour recolours the selection; copy, paste, cut, delete; convert selection', async () => {
  const g = await pageGeom(); const info = await strokeInfo(); const n0 = info.length;
  await pen([[g.x + (info[0].x0 + 1) * g.s, g.y + (info[0].y0 + info[0].y1) / 2 * g.s]]); await sleep(120);
  let b = await lassoBox(); if (!b) throw new Error('no selection');
  const h = await ev(() => { const r = document.querySelector('.lasso-box:not([hidden]) .lasso-h').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await pen([[h.x, h.y], [h.x + (b.w) * 0.25, h.y + b.h * 0.25], [h.x + b.w * 0.5, h.y + b.h * 0.5]]); await sleep(150);
  const b2 = await lassoBox(); log('      frame', Math.round(b.w) + 'x' + Math.round(b.h), '→', Math.round(b2.w) + 'x' + Math.round(b2.h)); if (b2.w < b.w * 1.25) throw new Error('resize did not grow the ink');
  await page.click('#pen-colors .ink-dot:nth-child(2)'); await sleep(80);
  const colors = await ev(() => [...new Set(IL.app.editor.lassoSel.strokes.map(s => s.color))]); log('      recoloured to', colors); if (colors.length !== 1 || colors[0] === info[0].color) throw new Error('recolour failed');
  if (!(await ev(() => IL.app.editor.tool === 'lasso'))) throw new Error('colour tap switched tools');
  await page.click('#lasso-actions [data-act="copy"]'); await sleep(80); if (!(await ev(() => !!IL.app.editor.inkClipboard))) throw new Error('copy failed');
  await page.click('#lasso-actions [data-act="paste"]'); await sleep(150);
  const n1 = await ev(() => IL.app.editor.page.strokes.length); log('      strokes after paste:', n1); if (n1 !== n0 + (n0 - 2)) throw new Error('paste count wrong');
  if (!(await ev(() => IL.app.editor.lassoSel && IL.app.editor.lassoSel.strokes.length === IL.app.editor.inkClipboard.strokes.length))) throw new Error('pasted ink not selected');
  await page.click('#lasso-actions [data-act="cut"]'); await sleep(100); if ((await ev(() => IL.app.editor.page.strokes.length)) !== n0) throw new Error('cut did not remove the pasted ink');
  // tap on empty paper offers Paste there
  const ey = g.y + (76 + 13.5 * g.L) * g.s; await pen([[g.x + 420 * g.s, ey]]); await sleep(120);
  if (await page.isHidden('#lasso-actions [data-act="paste"]')) throw new Error('no paste offer on tap'); await page.click('#lasso-actions [data-act="paste"]'); await sleep(150);
  const pasted = await strokeInfo(); const pb = await lassoBox(); log('      pasted at', Math.round(pb.cx - g.x), Math.round(pb.cy - g.y), 'tap at', Math.round(420 * g.s), Math.round(ey - g.y));
  if (Math.abs(pb.cx - (g.x + 420 * g.s)) > 6 || Math.abs(pb.cy - ey) > 6) throw new Error('paste not centred on the tap');
  await page.keyboard.press('Delete'); await sleep(100); if ((await ev(() => IL.app.editor.page.strokes.length)) !== n0) throw new Error('Delete key did not remove the selection');
  await page.click('#undo-btn'); await sleep(100); if ((await ev(() => IL.app.editor.page.strokes.length)) !== pasted.length) throw new Error('undo did not restore the deleted ink'); await page.click('#redo-btn'); await sleep(100);
  // convert only the selected word (the 'lo' on row 9 stays ink)
  const rows0 = await ev(() => IL.app.editor.page.rows.slice());
  await pen([[g.x + (info[0].x0 + 1) * g.s, g.y + (info[0].y0 + info[0].y1) / 2 * g.s]]); await sleep(120);
  await page.click('#lasso-actions [data-act="convert"]'); await waitFor(n => IL.app.editor.page.strokes.length === n, 2, 8000);
  const rows1 = await ev(() => IL.app.editor.page.rows.slice()); const changed = rows1.map((r, i) => r !== rows0[i] ? { i, from: rows0[i], to: r } : null).filter(Boolean); log('      changed rows:', JSON.stringify(changed));
  if (!changed.some(c => /hel|hallo/i.test(c.to.slice(c.from.length)))) throw new Error('selection was not converted into text'); if ((await ev(() => IL.app.editor.page.strokes.length)) !== 2) throw new Error('other ink was converted too');
  // typed words: a loop around the converted word picks it up; Delete removes it from the row; undo restores; a tap picks a word too
  const trow = changed[0].i; const wbox = await ev(r => { const ws = IL.app.editor.rowWords(r); const w = ws[ws.length - 1]; return { x0: w.x0, x1: w.x1, text: w.text, L: IL.app.editor.L, top: IL.editor.PAGE.top + r * IL.app.editor.L }; }, trow);
  const lp = densify([[wbox.x0 - 6, wbox.top + 2], [wbox.x1 + 6, wbox.top + 2], [wbox.x1 + 6, wbox.top + wbox.L - 2], [wbox.x0 - 6, wbox.top + wbox.L - 2], [wbox.x0 - 6, wbox.top + 4]], 8).map(([x, y]) => [g.x + x * g.s, g.y + y * g.s]);
  await pen(lp); await sleep(150);
  const wsel = await ev(() => IL.app.editor.lassoSel && IL.app.editor.lassoSel.words.map(w => w.text)); log('      words picked:', JSON.stringify(wsel)); if (!wsel || wsel.length !== 1 || wsel[0] !== wbox.text) throw new Error('typed word not picked up');
  await page.click('#lasso-actions [data-act="del"]'); await sleep(120);
  const rowAfter = await ev(r => IL.app.editor.page.rows[r], trow); if (rowAfter.includes(wbox.text)) throw new Error('typed word not deleted: ' + rowAfter);
  await page.click('#undo-btn'); await sleep(120); if (!(await ev(r => IL.app.editor.page.rows[r], trow)).includes(wbox.text)) throw new Error('undo did not restore the word');
  await pen([[g.x + (wbox.x0 + wbox.x1) / 2 * g.s, g.y + (wbox.top + wbox.L / 2) * g.s]]); await sleep(120);
  const tsel = await ev(() => IL.app.editor.lassoSel && IL.app.editor.lassoSel.words.length); if (tsel !== 1) throw new Error('tap did not pick the typed word'); await page.keyboard.press('Escape');
  await page.click('#tool-eraser'); const rest = await strokeInfo(); for (const s of rest) await pen([[g.x + (s.x0 + s.x1) / 2 * g.s, g.y + (s.y0 + s.y1) / 2 * g.s]]); await sleep(100);
  await page.click('#tool-pen');
});
await step('FLIP ZONES: tinted from the cover, tap right zone turns the page with the 3D animation', async () => {
  const tint = await ev(() => getComputedStyle(document.getElementById('page-area')).getPropertyValue('--flip-tint-rgb').trim()); log('      tint rgb:', tint); if (!/^\d+,\d+,\d+$/.test(tint)) throw new Error('no tint');
  const zw = await ev(() => document.getElementById('flip-right').getBoundingClientRect().width); log('      zone width (portrait 900x1300):', zw); if (zw < 20) throw new Error('zone too small');
  const p0 = await ev(() => IL.app.editor.pageIndex);
  const z = await ev(() => { const r = document.getElementById('flip-right').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  // Record the animation from inside the page: with the software GPU of headless Chromium a frame can block the main thread for seconds, so polling from outside would miss it.
  await ev(() => { window.__fl = { shown: 0, gl: false, canvas: false, frames: 0 }; const L = document.getElementById('flip-layer'); new MutationObserver(() => { if (!L.hidden) { window.__fl.shown++; window.__fl.gl = !!(IL.app.editor.flipParts && IL.app.editor.flipParts.gl); window.__fl.canvas = !!L.querySelector('canvas'); } }).observe(L, { attributes: true, attributeFilter: ['hidden'] }); const ed = IL.app.editor, o = ed.setFlipProgress; ed.setFlipProgress = function (q) { window.__fl.frames++; return o.call(this, q); }; });
  await page.mouse.click(z.x, z.y);
  await waitFor(v => IL.app.editor.pageIndex === v && !IL.app.editor.flipBusy, p0 + 1, 10000); await settled();
  const fl = await ev(() => { const r = window.__fl; IL.app.editor.setFlipProgress = Object.getPrototypeOf(IL.app.editor).setFlipProgress; return r; });
  log('      animation:', JSON.stringify(fl)); if (!fl.shown || !fl.canvas || !fl.gl || fl.frames < 2) throw new Error('no WebGL curl animation');
  const p1 = await ev(() => IL.app.editor.pageIndex); if (p1 !== p0 + 1) throw new Error(`page ${p0} → ${p1}`);
  if (!(await ev(() => document.getElementById('flip-layer').hidden))) throw new Error('flip layer still visible');
});
await step('FLIP ZONES: a sheet in flight can be caught and pushed back', async () => {
  if (await ev(() => IL.app.editor.turnTarget(-1) == null)) { await ev(() => IL.app.editor.goTo(1)); await sleep(300); }
  const start = await ev(() => IL.app.editor.pageIndex);
  await ev(() => IL.app.editor.turnPage(-1));                                        // the previous sheet comes over by itself …
  const caught = await waitFor(() => { const f = IL.app.editor.flip; return !!(f && f.ready && f.progress < 0.95); }, null, 14000);
  if (!caught) throw new Error('could not catch the sheet in flight');
  // (the software GPU of headless Chromium blocks the main thread for whole frames, so the grab is driven through the handlers directly)
  const g = await ev(() => { const ed = IL.app.editor, f = ed.flip; if (!f) return null; const x = 60, w = ed.area.clientWidth, t = performance.now();
    ed.flipDown({ pointerId: 99, clientX: x, clientY: 300, timeStamp: t, preventDefault() {} }, -1);                   // … a finger grabs it …
    const out = { same: ed.flip === f, grabbed: f.grabbed, goal: f.goal, p: +f.progress.toFixed(2) };
    ed.flipMove({ pointerId: 99, clientX: x - 0.6 * w, timeStamp: t + 40 }); ed.flipUp({ pointerId: 99, clientX: x - 0.6 * w, timeStamp: t + 50 });   // … and pushes it back where it came from
    out.goalAfter = f.goal; out.pAfter = +f.progress.toFixed(2); return out; });
  log('      grab:', JSON.stringify(g)); if (!g || !g.same || !g.grabbed || g.goal !== null || g.goalAfter !== 0) throw new Error('grab did not take hold of the sheet');
  await settled();
  const p1 = await ev(() => IL.app.editor.pageIndex); log('      page after pushing the sheet back:', p1, '(was', start + ')'); if (p1 !== start) throw new Error('sheet was not pushed back');
});
await step('FLIP ZONES: drag in the left zone turns back; a short drag snaps back; pen in the zone writes nothing', async () => {
  const p0 = await ev(() => IL.app.editor.pageIndex);
  const z = await ev(() => { const r = document.getElementById('flip-left').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: document.getElementById('page-area').clientWidth }; });
  await page.mouse.move(z.x, z.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(z.x + z.w * 0.5 * i / 8, z.y); await sleep(20); } await page.mouse.up();
  await waitFor(v => IL.app.editor.pageIndex === v && !IL.app.editor.flipBusy, p0 - 1); await settled();
  if ((await ev(() => IL.app.editor.pageIndex)) !== p0 - 1) throw new Error('drag flip failed');
  // short drag → snap back
  const zr = await ev(() => { const r = document.getElementById('flip-right').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(zr.x, zr.y); await page.mouse.down(); await page.mouse.move(zr.x - 30, zr.y, { steps: 4 }); await sleep(400); await page.mouse.up(); await settled(); await sleep(150);
  if ((await ev(() => IL.app.editor.pageIndex)) !== p0 - 1) throw new Error('short drag should snap back');
  // a pen touch inside the zone never draws: it turns the page instead
  const before = await ev(() => IL.app.editor.pages.map(p => p.strokes.length));
  await pen([[zr.x, zr.y + 100], [zr.x - 5, zr.y + 101]]);
  await waitFor(v => IL.app.editor.pageIndex === v && !IL.app.editor.flipBusy, p0); await settled();
  const after = await ev(() => IL.app.editor.pages.map(p => p.strokes.length)); if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('pen drew inside the flip zone');
  if ((await ev(() => IL.app.editor.pageIndex)) !== p0) throw new Error('pen tap in the zone should turn the page');
  await ev(() => IL.app.editor.goTo(0)); await sleep(200);
  if (!(await ev(() => document.getElementById('flip-left').classList.contains('is-disabled')))) throw new Error('left zone should be disabled on the first page');
});
await step('FLIP ZONES: wider in landscape; arrow keys turn pages', async () => {
  await page.setViewportSize({ width: 1300, height: 900 }); await sleep(300);
  const zw = await ev(() => document.getElementById('flip-right').getBoundingClientRect().width); log('      zone width (landscape):', zw); if (zw < 50) throw new Error('landscape zone width ' + zw);
  await ev(() => IL.app.editor.goTo(0)); await sleep(200); const p0 = await ev(() => IL.app.editor.pageIndex);
  // a wide landscape screen shows two facing pages; a turn then moves a whole sheet
  const spread = await ev(() => ({ on: IL.app.editor.spreadMode(), sheets: IL.app.editor.sheets.length, label: document.getElementById('page-indicator').textContent, fwd: IL.app.editor.turnTarget(1) }));
  log('      spread:', JSON.stringify(spread)); if (!spread.on || spread.sheets !== 2) throw new Error('expected a two-page spread in landscape');
  await page.keyboard.press('ArrowRight'); await waitFor(v => IL.app.editor.pageIndex === v && !IL.app.editor.flipBusy, spread.fwd); await settled();
  if ((await ev(() => IL.app.editor.pageIndex)) !== spread.fwd) throw new Error('ArrowRight → ' + (await ev(() => IL.app.editor.pageIndex)) + ' expected ' + spread.fwd);
  const back = await ev(() => IL.app.editor.turnTarget(-1));
  await page.keyboard.press('ArrowLeft'); await waitFor(v => IL.app.editor.pageIndex === v && !IL.app.editor.flipBusy, back); await settled(); if ((await ev(() => IL.app.editor.pageIndex)) !== back) throw new Error('ArrowLeft');
  // writing on the facing page puts the text on that page
  await ev(() => IL.app.editor.goTo(0)); await sleep(200); await ev(() => { IL.app.settings.live = false; });
  const right = await ev(() => { const r = IL.app.editor.sheets[1].pageEl.getBoundingClientRect(); return { x: r.left, y: r.top, s: IL.app.editor.s, idx: IL.app.editor.sheets[1].pageIndex }; });
  await page.click('#tool-pen'); await pen([[right.x + 120 * right.s, right.y + 300 * right.s], [right.x + 160 * right.s, right.y + 302 * right.s], [right.x + 200 * right.s, right.y + 300 * right.s]]); await sleep(150);
  const where = await ev(() => ({ active: IL.app.editor.pageIndex, strokes: IL.app.editor.pages.map(p => p.strokes.length) }));
  log('      after writing on the right page:', JSON.stringify(where)); if (where.active !== right.idx || !where.strokes[right.idx]) throw new Error('ink did not land on the facing page');
  await ev(() => IL.app.editor.undo()); await ev(() => { IL.app.settings.live = true; });
  // Enter at the bottom of the left page continues on the facing page
  await ev(() => { const ed = IL.app.editor; ed.activate(0); ed.setCaret(ed.page.rows.length - 1); });
  await page.click('#enter-btn'); await sleep(300);
  const after = await ev(() => ({ active: IL.app.editor.active, idx: IL.app.editor.pageIndex, row: IL.app.editor.caret.row, pages: IL.app.editor.pages.length }));
  log('      enter from the left page bottom:', JSON.stringify(after)); if (after.active !== 1 || after.row !== 0) throw new Error('Enter did not continue on the facing page');
  // live recognition keeps the two pages apart: a word on each page, written one after the other, each lands on its own page
  await ev(async () => { const ed = IL.app.editor; while (ed.pages.length < 4) await ed.addPage(); await ed.goTo(2); IL.app.settings.live = true; IL.app.settings.autoDelay = 2.0; });   // a long pause so a slow test machine cannot split the word
  await sleep(300);
  const sp2 = await ev(() => IL.app.editor.sheets.map(sh => sh.pageIndex)); log('      spread pages:', JSON.stringify(sp2)); if (sp2.join() !== '2,3') throw new Error('expected pages 3–4 on screen');
  const before = await ev(() => ({ left: IL.app.editor.pages[2].rows.slice(), right: IL.app.editor.pages[3].rows.slice() }));
  await writeWord('hello', 1, 'pen', 0); await writeWord('lo', 1, 'pen', 1); await sleep(3800);
  const rows = await ev(() => ({ left: IL.app.editor.pages[2].rows.slice(), right: IL.app.editor.pages[3].rows.slice(), ink: IL.app.editor.pages.map(p => p.strokes.length) }));
  const changed = (a, b) => b.map((t, i) => t !== a[i] ? t.replace(a[i], '').trim() : null).filter(t => t != null);
  const addedLeft = changed(before.left, rows.left), addedRight = changed(before.right, rows.right);
  log('      added left:', JSON.stringify(addedLeft), 'added right:', JSON.stringify(addedRight), 'ink left:', JSON.stringify(rows.ink));
  if (addedLeft.length !== 1 || !/hello/.test(addedLeft[0]) || /\blo\b/.test(addedLeft[0]) || addedRight.join() !== 'lo') throw new Error('live text crossed between the pages');
  await ev(() => { IL.app.settings.autoDelay = 1.2; });
  await page.screenshot({ path: '/tmp/landscape.png' });
  await page.setViewportSize({ width: 900, height: 1300 }); await sleep(300);
});

/* ---- control sweep ---- */
await step('SWEEP toolbar: tools, colors, widths, zoom, pager', async () => {
  await page.setViewportSize({ width: 900, height: 1300 }); await ev(() => IL.app.editor.goTo(0)); await sleep(300);
  for (const sel of ['#tool-hl', '#tool-eraser', '#tool-type', '#tool-select', '#tool-pen']) await page.click(sel);
  for (const b of await page.$$('#pen-styles .pen-style')) await b.click(); await page.click('#pen-styles .pen-style[data-pen="ball"]');
  await page.click('#tool-hl'); for (const b of await page.$$('#hl-colors .hl-dot')) await b.click(); await page.click('#tool-pen');
  for (const b of await page.$$('#pen-colors .ink-dot')) await b.click();
  for (const b of await page.$$('#pen-widths .width-dot')) await b.click();
  await page.click('#zoom-in-btn'); await page.click('#zoom-out-btn'); await page.click('#auto-btn'); await page.click('#auto-btn'); await page.click('#finger-btn'); await page.click('#finger-btn');
  await page.click('#convert-btn'); await sleep(100); // nothing to convert → toast
  await ev(() => IL.app.editor.goTo(0)); await sleep(200);
  const pg = await ev(() => ({ idx: IL.app.editor.pageIndex, n: IL.app.editor.pages.length, next: document.getElementById('page-next').disabled, prev: document.getElementById('page-prev').disabled, label: document.getElementById('page-indicator').textContent, flip: !!IL.app.editor.flip, busy: !!IL.app.editor.flipBusy, queued: IL.app.editor._queuedTurn || null, sheets: IL.app.editor.sheets.map(s => s.pageIndex) }));
  log('      pager before clicks:', JSON.stringify(pg));
  await ev(() => { document.getElementById('toast').hidden = true; });   // the "nothing to convert" toast sits over the pager for a moment
  await page.click('#page-next'); await settled(); await page.click('#page-prev'); await settled(); await page.click('#page-add'); await sleep(300); await page.click('#page-prev'); await settled();
  const n = await ev(() => IL.app.editor.pages.length); if (n < 3) throw new Error('pages ' + n);
});
await step('SWEEP search: open, type, next/prev, close', async () => {
  await page.click('#nb-search-btn'); await page.fill('#search-input', 'the'); await sleep(300); await page.click('#search-next'); await page.click('#search-prev'); await page.keyboard.press('Enter'); await page.fill('#search-input', 'zzzz'); await sleep(300);
  if ((await page.textContent('#search-count')) !== '0 / 0') throw new Error('count'); await page.click('#search-close');
});
await step('SWEEP pages sheet: thumbnails, insert, delete page', async () => {
  await page.click('#nb-pages-btn'); await page.waitForSelector('#sheet-pages:not([hidden])');
  const pn = await ev(() => IL.app.editor.pages.length);
  await page.click('.page-thumb:nth-child(2) .pt-row .icon-btn[aria-label^="Insert"]'); await sleep(300);
  if ((await ev(() => IL.app.editor.pages.length)) !== pn + 1) throw new Error('insert failed');
  await page.click('.page-thumb:nth-child(3) .pt-row .icon-btn[aria-label^="Delete"]'); await page.waitForSelector('#sheet-confirm:not([hidden])'); await page.click('#confirm-ok'); await sleep(400);
  if ((await ev(() => IL.app.editor.pages.length)) !== pn) throw new Error('delete failed');
  await page.click('.page-thumb:nth-child(1) canvas'); await sleep(100); if ((await ev(() => IL.app.editor.pageIndex)) !== 0) throw new Error('jump failed');
});
await step('SWEEP settings: every font/size/color/paper/spacing, toggles, slider', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])');
  for (const b of await page.$$('#font-grid .font-opt')) await b.click();
  for (const b of await page.$$('#size-row .chip')) await b.click();
  for (const b of await page.$$('#text-colors .color-dot')) await b.click();
  for (const b of await page.$$('#paper-row .chip')) await b.click();
  for (const b of await page.$$('#spacing-row .chip')) await b.click();
  await page.click('#margin-toggle'); await page.click('#margin-toggle'); await page.click('#auto-toggle'); await page.click('#auto-toggle'); await page.click('#finger-toggle'); await page.click('#finger-toggle');
  for (const b of await page.$$('#engine-row .chip')) await b.click(); await page.click('#engine-row .chip[data-engine="inkleaf"]');
  await ev(() => { const s = document.getElementById('auto-delay'); s.value = 3; s.dispatchEvent(new Event('input', { bubbles: true })); });
  if ((await page.textContent('#auto-delay-val')) !== '3 s') throw new Error('slider label');
  await page.click('#font-grid .font-opt[data-font="Caveat"]'); await page.click('#paper-row .chip[data-paper="ruled"]'); await page.click('#spacing-row .chip[data-spacing="medium"]');
});
await step('TRAIN words: write prompted words, save 8, adapt the neural engine on-device, status persists, reset', async () => {
  await ev(() => { IL.app.settings.engine = 'neural'; IL.hwrClient.setMode('neural'); });
  await page.click('#train-btn'); await page.waitForSelector('#sheet-training:not([hidden])');
  if (await page.isHidden('#train-words')) await page.click('#train-modes .chip[data-mode="words"]');
  if (!(await ev(() => document.getElementById('tw-adapt').disabled))) throw new Error('adapt enabled without samples');
  const r = await ev(() => { const b = document.getElementById('tw-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const writeOnCanvas = async word => { let x = r.x + r.w * 0.1; const base = r.y + r.h * (140 / 190); for (const ch of word) { const tall = 'hl'.includes(ch); const hh = (tall ? 0.42 : 0.24) * r.h; const w = (ch === 'l' ? 0.3 : 0.9) * hh; for (const sh of SHAPES[ch]) await pen(densify(sh, 6).map(([px, py]) => [x + px / 100 * w, base - (100 - py) / 100 * hh])); x += w + 0.04 * r.w; } };
  await writeOnCanvas('hello'); await page.click('#tw-test'); await waitFor(() => !/Reading/.test(document.getElementById('tw-result').textContent), null, 15000); log('      reads as:', await page.textContent('#tw-result'));
  const first = await page.textContent('#tw-current');
  for (let i = 0; i < 8; i++) { if (i) await writeOnCanvas(i % 2 ? 'lo' : 'hello'); await page.click('#tw-save'); await sleep(120); }
  const n = (await ev(() => IL.db.kvGet('neuralSamples', []))).length; const cur = await page.textContent('#tw-current'); log('      saved', n, 'samples; prompt moved', JSON.stringify(first), '→', JSON.stringify(cur));
  if (n !== 8 || cur === first) throw new Error('saving failed');
  if (await ev(() => document.getElementById('tw-adapt').disabled)) throw new Error('adapt still disabled');
  await page.click('#tw-adapt'); await waitFor(() => /Adapted on/.test(document.getElementById('tw-status').textContent) || /did not work/.test(document.getElementById('tw-status').textContent), null, 90000);
  const st = await page.textContent('#tw-status'); log('      status:', st); if (!/Adapted on/.test(st)) throw new Error('adaptation failed: ' + st);
  const d = await ev(async () => { const d = await IL.db.kvGet('neuralDense', null); return d && { n: d.n, ow: d.ow && d.ow.length, ob: d.ob && d.ob.length, before: d.before, after: d.after }; }); log('      saved weights:', JSON.stringify(d));
  if (!d || !d.ow || d.ow !== d.ob * 256) throw new Error('adapted weights not saved'); if (!(await ev(() => IL.hwrClient.adapted))) throw new Error('client does not know about the adaptation');
  await page.click('#tw-reset'); await page.waitForSelector('#sheet-confirm:not([hidden])'); await page.click('#confirm-ok'); await sleep(300);
  if ((await ev(() => IL.db.kvGet('neuralSamples', []))).length !== 0 || await ev(() => IL.hwrClient.adapted)) throw new Error('reset failed');
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await page.click('#train-btn'); await page.waitForSelector('#sheet-training:not([hidden])');
  await page.click('#train-modes .chip[data-mode="letters"]'); if (await page.isHidden('#train-letters')) throw new Error('letters panel hidden');
  await ev(() => IL.app.closeSheets()); await ev(() => { IL.app.settings.engine = 'inkleaf'; IL.hwrClient.setMode('classic'); });
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])');
});
await step('SWEEP training: pick chars, draw, save, test, reset', async () => {
  await page.click('#train-btn'); await page.waitForSelector('#sheet-training:not([hidden])'); await page.click('#train-modes .chip[data-mode="letters"]');
  await page.click('#train-chars .chip[data-label="oO0"]');
  const r = await ev(() => { const b = document.getElementById('train-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; });
  const pts = densify(SHAPES.o[0], 6).map(([px, py]) => [r.x + r.w * 0.25 + px / 100 * r.w * 0.5, r.y + r.w * 0.25 + py / 100 * r.w * 0.5]);
  await pen(pts); await page.click('#train-test'); const res = await page.textContent('#train-result'); log('      reads as:', res);
  await page.click('#train-save'); await sleep(300);
  const n = await ev(() => IL.hwr.templateCount().user); if (n !== 1) throw new Error('user templates ' + n);
  await page.click('#train-clear'); await page.click('#train-reset'); await page.waitForSelector('#sheet-confirm:not([hidden])'); await page.click('#confirm-ok'); await sleep(200);
  if ((await ev(() => IL.hwr.templateCount().user)) !== 0) throw new Error('reset failed');
});
await step('SWEEP lock: enable (PIN 2468), change PIN, lock-after chips, disable', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await page.click('#lock-enable-btn'); await page.waitForSelector('#view-lock:not([hidden])');
  for (const k of '2468') await page.click(`#pin-pad [data-k="${k}"]`); await page.click('#pin-pad [data-k="ok"]'); await sleep(200);
  for (const k of '2468') await page.click(`#pin-pad [data-k="${k}"]`); await sleep(700);
  if (await page.isVisible('#lock-bio-setup')) await page.click('#lock-bio-skip');
  await page.waitForSelector('#view-notebook:not([hidden])');
  if (!(await ev(() => IL.Lock.enabled))) throw new Error('lock not enabled');
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await sleep(200);
  for (const b of await page.$$('#lock-after .chip')) await b.click();
  await page.click('#lock-pin-btn'); await page.waitForSelector('#view-lock:not([hidden])');
  for (const k of '2468') await page.click(`#pin-pad [data-k="${k}"]`); await sleep(500); // verify current
  for (const k of '13579') await page.click(`#pin-pad [data-k="${k}"]`); await page.click('#pin-pad [data-k="ok"]'); await sleep(200);
  for (const k of '13579') await page.click(`#pin-pad [data-k="${k}"]`); await sleep(700); if (await page.isVisible('#lock-bio-setup')) await page.click('#lock-bio-skip');
  await page.waitForSelector('#view-notebook:not([hidden])');
  if (!(await ev(() => IL.Lock.verifyPin('13579')))) throw new Error('new PIN not stored');
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await sleep(200); await page.click('#lock-disable-btn'); await page.waitForSelector('#view-lock:not([hidden])');
  for (const k of '13579') await page.click(`#pin-pad [data-k="${k}"]`); await sleep(500); await page.waitForSelector('#view-notebook:not([hidden])');
  if (await ev(() => IL.Lock.enabled)) throw new Error('still enabled');
});
let backupPath;
await step('SWEEP export: share fallback + copy text', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await page.click('#nb-export-btn'); await page.waitForSelector('#sheet-export:not([hidden])'); await sleep(600);
  await page.click('#export-copy'); await sleep(100);
  const json = await ev(() => navigator.clipboard.readText().catch(() => null));
  await page.click('#export-share'); await sleep(300);
  if (json) { backupPath = path.join(os.tmpdir(), 'inkleaf-test-backup.json'); fs.writeFileSync(backupPath, json); log('      backup bytes', json.length); }
  await page.click('#sheet-export .sheet-close');
});
await step('SWEEP cover editor: all themes, custom color, patterns, bindings, every sticker category, actions, title', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await page.click('#nb-cover-btn'); await page.waitForSelector('#view-cover:not([hidden])');
  for (const b of await page.$$('#theme-grid .swatch')) await b.click();
  await ev(() => { const i = document.getElementById('theme-custom'); i.value = '#aa3366'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  for (const b of await page.$$('#pattern-row .chip')) await b.click();
  for (const b of await page.$$('#spine-row .chip')) await b.click();
  // material and closure
  await page.click('#material-row .chip[data-material="leather"]'); if (!(await ev(() => !!document.querySelector('#cover-canvas .cover-material.leather')))) throw new Error('leather not rendered');
  await page.click('#clasp-row .chip[data-clasp="magnet"]'); if (!(await ev(() => !!document.querySelector('#cover-canvas .cover-clasp .strap .stud')))) throw new Error('magnetic strap not rendered');
  await page.click('#clasp-row .chip[data-clasp="lock"]'); if (!(await ev(() => !!document.querySelector('#cover-canvas .cover-clasp .lockplate .keyhole') && !!document.querySelector('#cover-canvas .cover-clasp .hasp .tongue')))) throw new Error('key lock not rendered');
  const lockBox = await ev(() => { const c = document.querySelector('#cover-canvas').getBoundingClientRect(), p = document.querySelector('#cover-canvas .lockplate').getBoundingClientRect(); return { x: (p.left - c.left) / c.width, y: (p.top - c.top) / c.height, w: p.width / c.width }; });
  log('      lock plate at', JSON.stringify(lockBox)); if (lockBox.x < 0.7 || lockBox.y < 0.3 || lockBox.y > 0.6 || lockBox.w > 0.3) throw new Error('lock plate misplaced');
  await page.click('#clasp-row .chip[data-clasp="none"]'); await page.click('#material-row .chip[data-material="none"]');
  await page.click('.tab[data-panel="stickers"]');
  for (const cat of await page.$$('#sticker-cats .chip')) { await cat.click(); const n = await page.$$eval('#sticker-grid .sticker-btn', b => b.length); if (n < 8) throw new Error('few stickers in ' + await cat.textContent()); await page.click('#sticker-grid .sticker-btn:nth-child(2)'); }
  const n = await ev(() => IL.app.coverEditor.cover.elements.filter(e => e.type === 'sticker').length); if (n < 8) throw new Error('stickers ' + n);
  for (const act of ['front', 'back', 'flip', 'dup', 'del']) await page.click(`#el-actions [data-act="${act}"]`);
  await page.click('.tab[data-panel="photos"]');
  await ev(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 300; c.getContext('2d').fillStyle = '#3CCB92'; c.getContext('2d').fillRect(0, 0, 300, 300); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await IL.app.coverEditor.addPhotos([new File([blob], 'p.png', { type: 'image/png' })]); });
  await sleep(300); if (!(await ev(() => IL.app.coverEditor.cover.elements.some(e => e.type === 'image')))) throw new Error('cover photo missing');
  for (let i = 0; i < 4; i++) await page.click('#el-actions [data-act="mask"]');
  // photo layouts / filters / opacity
  const imgId = await ev(() => IL.app.coverEditor.cover.elements.find(e => e.type === 'image').id);
  await ev(id => IL.app.coverEditor.tf.select(id), imgId);
  if (await page.isHidden('#photo-opts')) throw new Error('photo options hidden');
  for (const b of await page.$$('#photo-layout .chip')) await b.click();
  await page.click('#photo-layout .chip[data-layout="full"]'); await sleep(50);
  let im = await ev(id => IL.app.coverEditor.cover.elements.find(e => e.id === id), imgId);
  if (!(im.locked && im.w === 300 && im.h === 400 && im.x === 0)) throw new Error('full layout ' + JSON.stringify(im));
  if ((await ev(() => IL.app.coverEditor.cover.elements[0].type)) !== 'image') throw new Error('background not sent to back');
  const fc = await ev(() => { const r = document.querySelector('#cover-canvas .cel-image').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await mouseDrag(fc.x, fc.y, fc.x + 50, fc.y + 50); im = await ev(id => IL.app.coverEditor.cover.elements.find(e => e.id === id), imgId); if (im.x !== 0) throw new Error('locked photo moved');
  await page.click('#photo-layout .chip[data-layout="top"]'); im = await ev(id => IL.app.coverEditor.cover.elements.find(e => e.id === id), imgId); if (im.h !== 200) throw new Error('top half');
  for (const b of await page.$$('#photo-filter .chip')) { await b.click(); await sleep(30); }
  await page.click('#photo-filter .chip[data-filter="mosaic"]'); await sleep(500);
  const src = await ev(() => document.querySelector('#cover-canvas .cel-image img').getAttribute('src')); if (!src) throw new Error('mosaic image has no src');
  const cls = await ev(() => document.querySelector('#cover-canvas .cel-image').className); if (!/filter-mosaic/.test(cls)) throw new Error(cls);
  await page.click('#photo-filter .chip[data-filter="invert"]');
  await ev(() => { const r = document.getElementById('photo-opacity'); r.value = 0.5; r.dispatchEvent(new Event('input', { bubbles: true })); });
  if ((await ev(() => document.querySelector('#cover-canvas .cel-image img').style.opacity)) !== '0.5') throw new Error('opacity not applied live');
  await page.click('#photo-layout .chip[data-layout="free"]'); im = await ev(id => IL.app.coverEditor.cover.elements.find(e => e.id === id), imgId); if (im.locked || im.w !== 170) throw new Error('free layout ' + JSON.stringify(im));
  for (const b of await page.$$('#photo-mask .chip')) await b.click();
  // live sticker resize: emoji font-size must change during the drag, before release
  const stk = await ev(() => { const el = document.querySelector('#cover-canvas .cel-sticker .emoji').closest('.cel'); IL.app.coverEditor.tf.select(el.dataset.id); return el.dataset.id; });
  const fs0 = await ev(id => parseFloat(getComputedStyle(document.querySelector(`.cel[data-id="${id}"] .emoji`)).fontSize), stk);
  const se2 = await ev(() => { const r = document.querySelector('#cover-canvas .tf-h.se').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(se2.x, se2.y); await page.mouse.down(); await page.mouse.move(se2.x + 40, se2.y + 40, { steps: 5 });
  const fsMid = await ev(id => parseFloat(getComputedStyle(document.querySelector(`.cel[data-id="${id}"] .emoji`)).fontSize), stk);
  await page.mouse.up();
  log('      emoji font-size during drag', fs0.toFixed(1), '→', fsMid.toFixed(1)); if (!(fsMid > fs0 * 1.2)) throw new Error('sticker did not resize live');
  await page.click('.tab[data-panel="title"]'); await page.fill('#title-input', 'Physics 101');
  for (const b of await page.$$('#title-fonts .font-opt')) await b.click();
  for (const b of await page.$$('#title-colors .color-dot')) await b.click();
  await page.click('#title-show'); await page.click('#title-show');
  // pinch on the selected sticker: select first sticker then two-finger
  const st = await ev(() => { const ce = IL.app.coverEditor; const m = ce.cover.elements.find(e => e.type === 'sticker'); Object.assign(m, { x: 150, y: 20, w: 90, h: 90, rot: 0 }); ce.cover.elements.push(ce.cover.elements.splice(ce.cover.elements.indexOf(m), 1)[0]); ce.paint(); ce.tf.select(m.id); const el = document.querySelector(`#cover-canvas .cel[data-id="${m.id}"]`); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: m.id }; });
  const w0 = await ev(id => IL.app.coverEditor.cover.elements.find(e => e.id === id).w, st.id);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: st.x - 20, y: st.y, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: st.x - 20, y: st.y, id: 0 }, { x: st.x + 20, y: st.y, id: 1 }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: st.x - 20 - i * 6, y: st.y, id: 0 }, { x: st.x + 20 + i * 6, y: st.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(100);
  const w1 = await ev(id => IL.app.coverEditor.cover.elements.find(e => e.id === id).w, st.id); log('      pinch sticker', Math.round(w0), '→', Math.round(w1));
  if (!(w1 > w0 * 1.5)) throw new Error('pinch resize failed');
  await page.click('#cover-done'); await page.waitForSelector('#view-notebook:not([hidden])');
  if ((await page.textContent('#nb-title')) !== 'Physics 101') throw new Error('title');
});
await step('OPEN animation: key lock → key appears, turns, hasp opens, then the cover; magnetic strap flips first', async () => {
  await ev(() => IL.app.closeNotebook()); await page.waitForSelector('#view-home:not([hidden])'); await settled(); await sleep(300);
  await ev(async () => { const nb = IL.app.notebooks[0]; nb.cover.clasp = 'lock'; await IL.app.saveNotebook(nb); IL.app.renderHome(); window.__open = { key: 0, keyMaxRot: 0, hasp: 0 }; new MutationObserver(() => { const k = document.querySelector('.bo-key'); if (k) window.__open.key++; }).observe(document.body, { childList: true, subtree: true }); });
  const t0 = Date.now(); await page.click('.nb-card .cover');
  await waitFor(() => !document.getElementById('view-notebook').hidden && !document.querySelector('.bookopen'), null, 15000);
  const dt = Date.now() - t0; const seen = await ev(() => window.__open); log('      lock open took', dt, 'ms; key seen:', seen.key > 0);
  if (!seen.key) throw new Error('no key in the lock animation'); if (dt > 9000) throw new Error('lock opening too slow: ' + dt);
  await ev(() => IL.app.closeNotebook()); await page.waitForSelector('#view-home:not([hidden])'); await settled(); await sleep(200);
  await ev(async () => { const nb = IL.app.notebooks[0]; nb.cover.clasp = 'magnet'; await IL.app.saveNotebook(nb); IL.app.renderHome(); window.__strap = []; const ob = new MutationObserver(() => { const s = document.querySelector('.bookopen .cover-clasp .strap'); if (s) { const a = s.getAnimations()[0]; if (a) window.__strap.push(1); } }); ob.observe(document.body, { childList: true, subtree: true, attributes: true }); });
  await page.click('.nb-card .cover'); await waitFor(() => !document.getElementById('view-notebook').hidden && !document.querySelector('.bookopen'), null, 15000);
  const strap = await ev(() => window.__strap.length); log('      magnet: strap animation observed', strap > 0); if (!strap) throw new Error('strap did not animate');
  await ev(async () => { const nb = IL.app.notebooks[0]; nb.cover.clasp = 'none'; await IL.app.saveNotebook(nb); });
});
await step('SWEEP home: rename, duplicate, import backup, delete', async () => {
  await page.click('#nb-back'); await page.waitForSelector('#view-home:not([hidden])');
  await page.click('.nb-meta .icon-btn'); await page.waitForSelector('#popover:not([hidden])'); await page.click('#popover button:has-text("Rename")'); await page.fill('#prompt-input', 'Chemistry'); await page.click('#prompt-ok'); await sleep(200);
  if (!(await page.$$eval('.nb-name', e => e.map(x => x.textContent))).includes('Chemistry')) throw new Error('rename');
  await page.click('.nb-meta .icon-btn'); await page.click('#popover button:has-text("Duplicate")'); await sleep(800);
  let names = await page.$$eval('.nb-name', e => e.map(x => x.textContent)); if (!names.includes('Chemistry copy')) throw new Error('dup: ' + names);
  if (backupPath) { await page.setInputFiles('#file-import', backupPath); await sleep(1200); names = await page.$$eval('.nb-name', e => e.map(x => x.textContent)); log('      after import:', names.join(' | ')); if (names.length < 3) throw new Error('import'); }
  await page.click('.nb-meta .icon-btn'); await page.click('#popover button:has-text("Delete")'); await page.waitForSelector('#sheet-confirm:not([hidden])'); await page.click('#confirm-ok'); await sleep(400);
  const after = await page.$$eval('.nb-name', e => e.length); log('      notebooks now', after);
  await page.click('#home-train-btn'); await page.waitForSelector('#sheet-training:not([hidden])'); await page.click('#sheet-training .sheet-close');
});
await step('phone width: no horizontal overflow on home/notebook/cover', async () => {
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(200);
  const check = async where => { const over = await ev(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1); if (over) throw new Error('overflow on ' + where); };
  await check('home'); await page.click('.nb-card .cover'); await page.waitForSelector('.page .row'); await sleep(300); await check('notebook');
  const z = await ev(() => IL.app.editor.zoom); log('      phone default zoom', z.toFixed(2)); if (!(z > 1)) throw new Error('phone zoom not applied');
  await page.click('#nb-settings-btn'); await page.click('#nb-cover-btn'); await page.waitForSelector('#view-cover:not([hidden])'); await sleep(200); await check('cover'); await page.click('#cover-done');
});
await step('text scan: no "undefined", "NaN" or "[object" in visible UI', async () => {
  const bad = await ev(() => { const t = document.body.innerText; return ['undefined', 'NaN', '[object'].filter(w => t.includes(w)); }); if (bad.length) throw new Error(bad.join(','));
});

log('\nerrors captured:', errors.length ? '\n' + errors.join('\n') : 'none');
log(fails ? `\n${fails} step(s) failed` : '\nall steps passed');
await browser.close(); server.close();
