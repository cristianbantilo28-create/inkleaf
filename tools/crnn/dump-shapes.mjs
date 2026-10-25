// Dumps the built-in letter shapes (js/hwr.js) and the test shapes (tools/test-hwr.mjs) as JSON for the training-data generator.
import fs from 'node:fs'; import vm from 'node:vm';
const ctx = { window: {}, navigator: {}, console }; ctx.window.navigator = ctx.navigator; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../js/hwr.js', import.meta.url), 'utf8'), ctx);
const DEF = ctx.window.IL.hwr._def;
const out = {};
const add = (ch, strokes) => { (out[ch] = out[ch] || []).push(strokes.map(s => s.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]))); };
for (const [label, variants] of Object.entries(DEF)) for (const v of variants) for (const ch of label) add(ch, v);
// the hand-drawn-ish shapes from the recognizer test
const src = fs.readFileSync(new URL('../test-hwr.mjs', import.meta.url), 'utf8');
const m = src.match(/const SHAPES = (\{[\s\S]*?\n\});/); if (m) { const SHAPES = vm.runInNewContext('(' + m[1] + ')'); for (const [ch, strokes] of Object.entries(SHAPES)) add(ch, strokes); }
fs.writeFileSync(new URL('./out/shapes.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'characters,', Object.values(out).reduce((n, v) => n + v.length, 0), 'variants');
