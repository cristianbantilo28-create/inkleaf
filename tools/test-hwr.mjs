import fs from 'node:fs';
import vm from 'node:vm';
const ctx = { window: {}, navigator: {}, console, TextDecoder, performance, WebAssembly, atob: s => Buffer.from(s, 'base64').toString('binary') };
ctx.window.navigator = ctx.navigator;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../js/lexicon.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(new URL('../js/hwr.js', import.meta.url), 'utf8'), ctx);
const IL = ctx.window.IL;
const MODE = process.argv[2] === 'neural' ? 'neural' : 'classic';
if (MODE === 'neural') {
  for (const f of ['crnn.js', 'crnn-wasm.js', 'crnn-weights.js']) vm.runInContext(fs.readFileSync(new URL('../js/' + f, import.meta.url), 'utf8'), ctx);
  const buf = Buffer.from(IL.crnnWeightsB64, 'base64'); IL.crnn.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); console.log('wasm', await IL.crnn.initWasm(), '| model step', IL.crnn.model.meta.step);
}
IL.hwr.setMode(MODE);

// Hand-drawn-ish glyph polylines (100x100 box, baseline at y=100, descenders below 100).
const SHAPES = {
  a: [[[70,72],[62,48],[44,42],[26,52],[18,72],[26,92],[44,100],[62,92],[70,72],[70,42],[72,100]]],
  b: [[[22,0],[22,100],[22,52],[36,46],[56,50],[68,66],[64,88],[48,100],[30,96],[22,88]]],
  c: [[[74,50],[60,40],[44,40],[30,50],[22,70],[30,90],[44,100],[60,100],[74,90]]],
  d: [[[60,76],[52,54],[40,52],[28,58],[20,76],[28,94],[44,100],[60,92],[68,76],[68,0],[68,100]]],
  e: [[[18,70],[80,70],[78,56],[66,44],[50,40],[34,44],[22,56],[18,70],[22,84],[34,96],[50,100],[64,96]]],
  g: [[[70,66],[62,44],[44,40],[26,50],[20,66],[26,84],[44,92],[62,86],[70,66],[68,120],[60,136],[44,140],[26,134]]],
  h: [[[20,0],[20,100],[20,74],[22,60],[32,52],[44,52],[56,58],[64,68],[68,76],[68,100]]],
  i: [[[50,30],[50,100]],[[50,10],[51,11],[50,12]]],
  k: [[[20,0],[20,100]],[[64,40],[22,72],[66,100]]],
  l: [[[50,0],[50,100]]],
  m: [[[16,100],[16,40],[16,60],[22,46],[32,40],[42,46],[48,60],[48,100],[48,60],[54,46],[64,40],[74,46],[80,60],[80,100]]],
  n: [[[24,100],[24,40],[24,60],[30,48],[46,40],[62,48],[72,60],[72,100]]],
  o: [[[50,40],[70,46],[78,70],[70,94],[50,100],[30,94],[22,70],[30,46],[50,40]]],
  r: [[[24,100],[24,40],[24,60],[30,48],[42,42],[54,44],[64,52]]],
  s: [[[70,48],[56,40],[40,40],[30,50],[36,62],[50,68],[64,74],[70,86],[60,98],[42,100],[28,92]]],
  t: [[[40,10],[40,96],[46,100],[58,96]],[[20,44],[62,44]]],
  u: [[[22,40],[22,78],[28,92],[46,100],[62,92],[70,78],[70,40],[70,100]]],
  w: [[[12,40],[30,100],[50,50],[70,100],[88,40]]],
  y: [[[22,40],[22,78],[28,92],[46,100],[62,92],[70,78],[70,40],[70,125],[62,138],[48,140],[36,134]]],
  D: [[[20,0],[20,100]],[[20,0],[50,2],[76,20],[84,50],[76,80],[50,98],[20,100]]],
  E: [[[80,0],[20,0],[20,100],[80,100]],[[20,50],[66,50]]],
  H: [[[20,0],[20,100]],[[80,0],[80,100]],[[20,50],[80,50]]],
  L: [[[20,0],[20,100],[80,100]]],
  O: [[[50,0],[80,10],[94,50],[80,90],[50,100],[20,90],[6,50],[20,10],[50,0]]],
  T: [[[10,0],[90,0]],[[50,0],[50,100]]],
  '0': [[[50,0],[74,10],[84,50],[74,90],[50,100],[26,90],[16,50],[26,10],[50,0]]],
  '2': [[[24,15],[36,4],[50,2],[66,8],[80,28],[70,50],[20,100],[84,100]]],
  '4': [[[60,0],[16,66],[86,66]],[[64,0],[64,100]]],
  '5': [[[78,0],[26,0],[22,46],[40,40],[60,46],[72,66],[64,88],[48,100],[30,96],[22,84]]],
};
const TALL = new Set(['b','d','h','k','l','t']);
function rand(a, b) { return a + Math.random() * (b - a); }
function densify(poly, step) { // emit points every `step` units along the polyline
  const out = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const [x0, y0] = poly[i - 1], [x1, y1] = poly[i]; const d = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return out;
}
function makeRow(text, L, rowTop, jitter) {
  const strokes = []; let x = 100; const base = rowTop + L;
  for (const ch of text) {
    if (ch === ' ') { x += 0.6 * L; continue; }
    const shape = SHAPES[ch]; if (!shape) throw new Error('no shape for ' + ch);
    const tall = TALL.has(ch) || /[A-Z0-9]/.test(ch);
    const h = (tall ? 0.72 : 0.42) * L * rand(0.88, 1.12);
    let wf = rand(0.75, 1.1); if (ch === 'm' || ch === 'w') wf *= 1.5; if ('li'.includes(ch)) wf *= 0.45; if (ch === 'r') wf *= 0.75; if (ch === 't') wf *= 0.8;
    const w = h * wf * (tall ? 0.8 : 1);
    const ys = shape.flatMap(s => s.map(p => p[1])); const yTop = Math.min(...ys); const span = 100 - yTop; // part above baseline
    const slant = rand(-0.12, 0.12);
    for (const s of shape) {
      const dense = densify(s, 6);
      const pts = dense.map(([px, py]) => { const yy = base - (100 - py) / span * h; return [x + px / 100 * w + (base - yy) * slant + rand(-jitter, jitter), yy + rand(-jitter, jitter), 0.5, 0]; });
      strokes.push({ pts });
    }
    x += w + rand(0.05, 0.14) * L;
  }
  return strokes;
}
const L = 34, rowTop = 76;
const tests = ['hello world', 'the red cat', 'notes', 'HELLO', 'milk and eggs', 'call mom', 'TODO list', '2045', 'good idea', 'buy bread', 'thank you', 'DELETE', 'my dog is old', 'homework', 'water', 'sunday'];
let ok = 0, trials = 3;
for (const t of tests) {
  const outs = [];
  for (let k = 0; k < trials; k++) outs.push(IL.hwr.recognizeRowBuiltin(makeRow(t, L, rowTop, 0.25), rowTop, L));
  const passes = outs.filter(o => o === t).length; ok += passes;
  console.log(`${passes}/${trials} ${JSON.stringify(t)} -> ${outs.map(o => JSON.stringify(o)).join(', ')}`);
}
console.log(MODE, 'total', ok + '/' + tests.length * trials);
