// On-device adaptation check: adapts the JS CRNN's output layer on 40 words of one synthetic writer and measures the
// other 30 words of the same writer before and after.   node test-adapt.mjs [wasm|js] [weights.js] [samples.json]
import fs from 'node:fs';
import vm from 'node:vm';
const here = new URL('.', import.meta.url).pathname;
const ctx = { self: {}, console, TextDecoder, performance, WebAssembly, atob: s => Buffer.from(s, 'base64').toString('binary') };
ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(here + '../../js/crnn.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(process.argv[3] || (here + '../../js/crnn-weights.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(here + '../../js/crnn-wasm.js', 'utf8'), ctx);
const b64 = ctx.IL.crnnWeightsB64; const buf = Buffer.from(b64, 'base64'); ctx.IL.crnn.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (process.argv[2] !== 'js') console.log('wasm:', await ctx.IL.crnn.initWasm());
const sets = JSON.parse(fs.readFileSync(process.argv[4] || (here + 'out/adapt-samples.json'), 'utf8'));
const crnn = ctx.IL.crnn;
const toStrokes = w => w.strokes.map(pts => ({ pts }));
const acc = words => words.reduce((n, w) => { const r = crnn.recognize(toStrokes(w), { width: 8 }); return n + (r && r.text.toLowerCase() === w.text.toLowerCase() ? 1 : 0); }, 0);
for (const set of sets) {
  crnn.setDense(null, null);
  const train = set.words.slice(0, 40), test = set.words.slice(40);
  const b = acc(test);
  const t0 = performance.now(); const r = crnn.adapt(train.map(w => ({ strokes: toStrokes(w), text: w.text }))); const dt = performance.now() - t0;
  const a = acc(test);
  console.log(`style ${set.style}: chose "${r.setting}"${r.holdout ? ` (its own hold-out of ${r.holdout.n}: ${r.holdout.before}→${r.holdout.after} words, ${r.holdout.beforeErrs}→${r.holdout.afterErrs} char errors)` : ''}; train words read ${r.before}/${r.n} → ${r.after}/${r.n}; held-out ${b}/${test.length} → ${a}/${test.length}  (adapt ${dt.toFixed(0)} ms)`);
  // the saved weights round-trip
  const ow = new Float32Array(r.ow), ob = new Float32Array(r.ob); crnn.setDense(null, null); const reset = acc(test); crnn.setDense(ow, ob); const again = acc(test);
  console.log(`   reset → ${reset}/${test.length}; re-applied → ${again}/${test.length}; adapted flag ${crnn.adapted()}`);
}
