// Checks the JS CRNN against the numpy model on the exported test vector, and times it.
import fs from 'node:fs';
import vm from 'node:vm';
const here = new URL('.', import.meta.url).pathname;
const ctx = { self: {}, console, TextDecoder, performance, WebAssembly, atob: s => Buffer.from(s, 'base64').toString('binary') };
ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(here + '../../js/crnn.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(process.argv[3] || (here + '../../js/crnn-weights.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(here + '../../js/crnn-wasm.js', 'utf8'), ctx);
const b64 = ctx.IL.crnnWeightsB64; const buf = Buffer.from(b64, 'base64'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const t0 = performance.now(); ctx.IL.crnn.load(ab); console.log('load', (performance.now() - t0).toFixed(0), 'ms; classes', ctx.IL.crnn.model.chars.length + 1);
const tv = JSON.parse(fs.readFileSync(here + 'out/testvec.json', 'utf8'));
const H = 32, W = tv.W; const img = new Float32Array(H * W); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = tv.img[y][x];
const useWasm = process.argv[2] !== 'js'; if (useWasm) console.log('wasm:', await ctx.IL.crnn.initWasm());
const t1 = performance.now(); const { logp, T, C } = ctx.IL.crnn.forward(img, W); const dt = performance.now() - t1;
let maxDiff = 0; for (let t = 0; t < T; t++) for (let k = 0; k < C; k++) maxDiff = Math.max(maxDiff, Math.abs(logp[t * C + k] - tv.logp[t][k]));
const g = ctx.IL.crnn.greedy(logp, T, C); const beams = ctx.IL.crnn.beam(logp, T, C, 8);
console.log(`W=${W} T=${T}: forward ${dt.toFixed(1)} ms, max |Δlogp| vs numpy = ${maxDiff.toFixed(4)}`);
console.log('truth:', tv.text, '| numpy int8 greedy:', tv.greedy_q, '| js greedy:', g.text, '| js beam:', beams.slice(0, 3).map(b => b.text + ' (' + b.score.toFixed(1) + ')').join(', '));
console.log('ctc score of truth:', ctx.IL.crnn.score(logp, T, C, tv.text).toFixed(2), ' of greedy:', ctx.IL.crnn.score(logp, T, C, g.text).toFixed(2));
// timing over typical widths
for (const w of [64, 96, 128, 192, 256]) { const im = new Float32Array(H * w); for (let i = 0; i < im.length; i++) im[i] = Math.random() < 0.1 ? 1 : 0; const a = performance.now(); ctx.IL.crnn.forward(im, w); console.log(`  W=${w}: ${(performance.now() - a).toFixed(1)} ms`); }
if (maxDiff > 0.02) { console.log('MISMATCH'); process.exit(1); }
