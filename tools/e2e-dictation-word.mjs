// Dictation and "Share as Word": headless Chromium with a stand-in speech recognizer; the .docx is opened with python-docx,
// converted by pandoc and rendered by LibreOffice.   node tools/e2e-dictation-word.mjs
import pw from '/opt/npm-tools/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { netlifyHeaders, FAKE_BADGE } from './headers.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const headersFor = netlifyHeaders(root);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f); if (p === '/index.html') body = Buffer.from(body.toString().replace('</body>', FAKE_BADGE + '\n</body>'));
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', ...headersFor(p) }); res.end(body);
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'inkleaf-word-'));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 }, acceptDownloads: true });
// a stand-in for the browser's speech recognizer: the test fires its results
await ctx.addInitScript(() => {
  class FakeSR {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = ''; FakeSR.instances.push(this); }
    start() { FakeSR.started++; this._on = true; setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { this._on = false; setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
    fire(items) { const results = items.map(it => Object.assign([{ transcript: it.t, confidence: 0.9 }], { isFinal: !!it.final })); this.onresult && this.onresult({ resultIndex: 0, results }); }
    fail(code) { this.onerror && this.onerror({ error: code }); setTimeout(() => this.onend && this.onend(), 0); }
  }
  FakeSR.instances = []; FakeSR.started = 0;
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR; window.__FakeSR = FakeSR;
});
const page = await ctx.newPage(); page.setDefaultTimeout(8000);
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/ERR_FAILED|fonts\.|GL Driver Message|inline script/.test(t)) errors.push(`[${m.type()}] ${t}`); } });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

const LOG = '/tmp/e2e-dictation-word.log'; fs.writeFileSync(LOG, ''); const olog = console.log; console.log = (...a) => { const s = a.join(' '); fs.appendFileSync(LOG, s + '\n'); olog(s); };
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok   ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); process.exitCode = 1; try { await page.screenshot({ path: root + '/tools/fail-' + name.replace(/\W+/g, '_').slice(0, 30) + '.png' }); } catch (e2) {} } };
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire = (items) => ev(items => { const r = window.__FakeSR.instances[window.__FakeSR.instances.length - 1]; r.fire(items); }, items);
const rows = () => ev(() => IL.app.editor.page.rows.filter(Boolean));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await page.waitForTimeout(500);
await step('set a PIN and open the sample notebook', async () => {
  await page.waitForSelector('#view-lock:not([hidden])'); await page.click('#lock-setup-start');
  for (const k of '1234') await page.click(`#pin-pad [data-k="${k}"]`); await page.click('#pin-pad [data-k="ok"]'); await sleep(300);
  for (const k of '1234') await page.click(`#pin-pad [data-k="${k}"]`); await sleep(800);
  if (await page.isVisible('#lock-bio-setup')) await page.click('#lock-bio-skip');
  await page.waitForSelector('#view-home:not([hidden])'); await page.click('.nb-card .cover'); await page.waitForSelector('#view-notebook:not([hidden])'); await page.waitForSelector('.page .row');
});

/* ---------- dictation ---------- */
await step('DICTATE: the button starts listening, the pill shows what is being said', async () => {
  await ev(() => { IL.app.editor.setCaret(IL.app.editor.page.rows.length - 3); });
  await page.click('#dictate-btn'); await sleep(100);
  const on = await ev(() => ({ cls: document.getElementById('dictate-btn').classList.contains('is-listening'), pill: !document.getElementById('dictate-pill').hidden, lang: window.__FakeSR.instances[0].lang, cont: window.__FakeSR.instances[0].continuous && window.__FakeSR.instances[0].interimResults }));
  console.log('      listening:', JSON.stringify(on)); if (!on.cls || !on.pill || !on.cont || !on.lang) throw new Error('not listening');
  await fire([{ t: 'hello wor' }]); await sleep(50);
  const txt = await page.textContent('#dictate-text'); if (txt !== 'hello wor') throw new Error('interim text not shown: ' + txt);
});
await step('DICTATE: final words land on the page with spoken punctuation and a capital', async () => {
  const before = await rows();
  await fire([{ t: 'hello world comma how are you question mark', final: true }]); await sleep(400);
  const after = await rows(); const added = after.filter(r => !before.includes(r)); console.log('      rows added:', JSON.stringify(added));
  if (!added.some(r => r === 'Hello world, how are you?')) throw new Error('dictated text not found');
  if (!(await ev(() => IL.app.editor.page._undo.length > 0))) throw new Error('no undo entry');
});
await step('DICTATE: "new line" starts a new row; a lone "period" attaches to the word before', async () => {
  const caret0 = await ev(() => IL.app.editor.caret.row);
  await fire([{ t: 'new line', final: true }]); await sleep(300);
  await fire([{ t: 'second line', final: true }]); await sleep(300);
  await fire([{ t: 'period', final: true }]); await sleep(300);
  const r = await ev(() => ({ caret: IL.app.editor.caret.row, text: IL.app.editor.page.rows[IL.app.editor.caret.row] }));
  console.log('      caret', caret0, '→', r.caret, JSON.stringify(r.text));
  if (r.caret !== caret0 + 1 || r.text !== 'Second line.') throw new Error('new line / period handling');
});
await step('DICTATE: in the Keyboard tool the words go in at the text caret, mid-row', async () => {
  await page.click('#tool-type');
  await ev(() => { const ed = IL.app.editor; const i = ed.caret.row; ed.page.rows[i] = 'alpha omega'; ed.refreshRow(i); ed.focusRow(i, 5); });
  await fire([{ t: 'beta', final: true }]); await sleep(300);
  const t = await ev(() => IL.app.editor.page.rows[IL.app.editor.caret.row]); console.log('      row:', JSON.stringify(t));
  if (t !== 'alpha beta omega') throw new Error('mid-row insertion: ' + t);
  await page.click('#tool-pen');
});
await step('DICTATE: the session that the browser ends on its own is restarted; Stop ends it', async () => {
  const n0 = await ev(() => window.__FakeSR.started);
  await ev(() => { const r = window.__FakeSR.instances[window.__FakeSR.instances.length - 1]; r.onend(); }); await sleep(50);
  const n1 = await ev(() => window.__FakeSR.started); if (n1 !== n0 + 1) throw new Error('not restarted');
  await page.click('#dictate-stop'); await sleep(100);
  const off = await ev(() => ({ cls: document.getElementById('dictate-btn').classList.contains('is-listening'), pill: document.getElementById('dictate-pill').hidden }));
  if (off.cls || !off.pill) throw new Error('did not stop: ' + JSON.stringify(off));
});
await step('DICTATE: a refused microphone explains itself and stops', async () => {
  await page.click('#dictate-btn'); await sleep(100);
  await ev(() => { const r = window.__FakeSR.instances[window.__FakeSR.instances.length - 1]; r.fail('not-allowed'); }); await sleep(100);
  const t = await page.textContent('#toast'); console.log('      toast:', t);
  if (!/Microphone access was refused/.test(t) || await ev(() => document.getElementById('dictate-btn').classList.contains('is-listening'))) throw new Error('no explanation');
});
await step('DICTATE: leaving the notebook stops listening', async () => {
  await page.click('#dictate-btn'); await sleep(100); if (!(await ev(() => IL.dictation.listening))) throw new Error('not listening');
  await page.click('#nb-back'); await page.waitForSelector('#view-home:not([hidden])');
  if (await ev(() => IL.dictation.listening)) throw new Error('still listening at home');
  await page.click('.nb-card .cover'); await page.waitForSelector('#view-notebook:not([hidden])'); await page.waitForSelector('.page .row');
});
await step('DICTATE: the language chips in Settings set the recognizer language', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])');
  await page.click('#dictation-langs .chip[data-lang="de-DE"]'); await sleep(100);
  const r = await ev(() => ({ set: IL.app.settings.dictationLang, lang: IL.dictation.language(), active: document.querySelector('#dictation-langs .chip.is-active').dataset.lang }));
  if (r.set !== 'de-DE' || r.lang !== 'de-DE' || r.active !== 'de-DE') throw new Error(JSON.stringify(r));
  if (IL_clean_check(await ev(() => IL.dictation.clean('hallo komma wie geht es fragezeichen neue zeile', 'de-DE')))) throw new Error('german punctuation');
  await page.click('#dictation-langs .chip[data-lang="auto"]'); await ev(() => IL.app.closeSheets());
});
function IL_clean_check(s) { return s !== 'hallo, wie geht es?\n'; }

/* ---------- Word export ---------- */
await step('WORD: prepare a page with ink (not converted), a photo and a video link', async () => {
  await ev(() => { IL.app.settings.live = false; IL.app.saveSettings(); IL.app.syncToolbarToggles(); IL.app.editor.applyEngine && IL.app.editor.applyEngine(); });
  await page.click('#tool-pen');
  const pageBox = await page.$eval('.page', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
  const s = pageBox.w / 800; const base = pageBox.y + (76 + 19 * 34) * s; let x = pageBox.x + 140 * s;
  for (let k = 0; k < 4; k++) { await page.mouse.move(x, base - 20 * s); await page.mouse.down(); await page.mouse.move(x + 10 * s, base, { steps: 4 }); await page.mouse.move(x + 20 * s, base - 22 * s, { steps: 4 }); await page.mouse.up(); x += 30 * s; }
  await sleep(300);
  await ev(async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#4CA6F0'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText('PHOTO', 80, 115); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await IL.app.editor.addPhotos([new File([blob], 'test.png', { type: 'image/png' })]); });
  await sleep(400);
  await ev(() => IL.app.editor.addVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  await sleep(300);
  const st = await ev(() => ({ strokes: IL.app.editor.page.strokes.length, media: (IL.app.editor.page.media || []).map(m => m.type) }));
  console.log('      page has', JSON.stringify(st)); if (st.strokes < 4 || !st.media.includes('image') || !st.media.includes('link')) throw new Error('setup failed');
  await ev(() => IL.app.editor.flush && IL.app.editor.flush());
});
let docxPath = null;
await step('WORD: the export sheet makes a .docx and hands it over as a download', async () => {
  await page.click('#nb-settings-btn'); await page.waitForSelector('#sheet-settings:not([hidden])'); await page.click('#nb-export-btn'); await page.waitForSelector('#sheet-export:not([hidden])');
  await page.waitForFunction(() => /ready/.test(document.getElementById('export-status').textContent), null, { timeout: 20000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#export-docx')]);
  docxPath = path.join(out, dl.suggestedFilename()); await dl.saveAs(docxPath);
  const st = await page.textContent('#export-status'); console.log('      status:', st, '| file:', dl.suggestedFilename(), fs.statSync(docxPath).size, 'bytes');
  if (!/\.docx$/.test(dl.suggestedFilename()) || fs.statSync(docxPath).size < 2000) throw new Error('no document');
});
await step('WORD: python-docx opens it: title, page headings, the page text, pictures and the link', async () => {
  const py = `
import sys, docx, zipfile, re
d = docx.Document(sys.argv[1])
paras = [p for p in d.paragraphs]
styles = [p.style.name for p in paras]
texts = [p.text for p in paras]
z = zipfile.ZipFile(sys.argv[1]); names = z.namelist()
xml = z.read('word/document.xml').decode('utf-8'); rels = z.read('word/_rels/document.xml.rels').decode('utf-8')
import xml.dom.minidom as md
for n in names:
    if n.endswith('.xml') or n.endswith('.rels'): md.parseString(z.read(n))
print('PARAS', len(paras)); print('STYLES', sorted(set(styles)))
print('TITLE', texts[0]); print('HEADINGS', [t for t, s in zip(texts, styles) if s.startswith('Heading')])
print('HAS_WELCOME', any('Welcome' in t for t in texts)); print('HAS_DICTATED', any('Hello world, how are you?' in t for t in texts))
print('PICTURES', xml.count('<w:drawing>'), 'MEDIA', [n for n in names if n.startswith('word/media/')])
print('HYPERLINK', 'youtube.com' in rels and '<w:hyperlink' in xml)
print('INLINE_SHAPES', len(d.inline_shapes))
print('CAPTIONS', [t for t, s in zip(texts, styles) if s == 'Caption'])
`;
  const res = execFileSync('python3', ['-I', '-c', py, docxPath], { encoding: 'utf8' }); console.log(res.trim().split('\n').map(l => '      ' + l).join('\n'));
  if (!/HAS_WELCOME True/.test(res) || !/HAS_DICTATED True/.test(res) || !/HYPERLINK True/.test(res) || !/PICTURES [2-9]/.test(res) || !/HEADINGS \['Page 1'/.test(res)) throw new Error('document content');
});
await step('WORD: pandoc reads the text back; LibreOffice renders it to PDF', async () => {
  const md = execFileSync('pandoc', [docxPath, '-t', 'plain'], { encoding: 'utf8' }); console.log('      pandoc:', JSON.stringify(md.slice(0, 160)));
  if (!/Welcome/.test(md) || !/Hello world, how are you\?/.test(md)) throw new Error('pandoc text');
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', out, docxPath], { encoding: 'utf8', timeout: 120000 });
  const pdf = docxPath.replace(/\.docx$/, '.pdf'); if (!fs.existsSync(pdf)) throw new Error('no pdf'); console.log('      pdf:', pdf, fs.statSync(pdf).size, 'bytes');
  fs.copyFileSync(pdf, path.join(root, 'tools', 'word-export-preview.pdf'));
});

console.log('\nerrors captured:', errors.length ? '\n' + errors.join('\n') : 'none');
console.log(fails ? `\n${fails} step(s) failed` : '\nall steps passed');
await browser.close(); server.close();
