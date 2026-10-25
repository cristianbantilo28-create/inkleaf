/* Inkleaf — neural handwriting recognizer: a CRNN (convolutional + bidirectional LSTM + CTC) that reads a whole
   handwritten word at once, so joined-up writing works without cutting it into letters first.
   Plain JS + typed arrays, no dependencies; runs inside the recognition worker. Weights are trained with tools/crnn/. */
(function () {
  const root = typeof window !== 'undefined' ? window : self; const IL = (root.IL = root.IL || {});
  const H = 32, WMAX = 256, PAD = 2;
  let M = null, version = 0;   // the loaded model: { chars, layers }; version bumps whenever the weights change (adaptation)
  let wasm = null, wptr = null, weightsEnd = 0;   // WebAssembly kernels (SIMD) when available; plain JS otherwise
  const b64bytes = b64 => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  /* instantiates the SIMD kernels; resolves true when they are in use */
  async function initWasm() {
    if (wasm) return true; if (!root.WebAssembly || !IL.crnnWasmB64) return false;
    try { const { instance } = await WebAssembly.instantiate(b64bytes(IL.crnnWasmB64), {}); wasm = instance.exports; wasm.arena_reset(); if (M) uploadWeights(); return true; }
    catch (e) { wasm = null; return false; }
  }
  function uploadWeights() {
    wasm.arena_reset(); wptr = {};
    for (const n in M.T) { const d = M.T[n].data; const p = wasm.arena_alloc(d.length); new Float32Array(wasm.memory.buffer, p, d.length).set(d); wptr[n] = p; }
    weightsEnd = wasm.arena_used();
  }

  /* ---------- weights: int8 per output column + float32 biases, in one ArrayBuffer with a JSON header ---------- */
  function load(buf) {
    const dv = new DataView(buf); const hlen = dv.getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
    let off = 4 + hlen; const T = {};
    for (const t of meta.tensors) {
      if (t.dtype === 'int8') {
        const n = t.shape[0] * t.shape[1]; const q = new Int8Array(buf, off, n); off += n;
        const sc = new Float32Array(buf.slice(off, off + 4 * t.shape[1])); off += 4 * t.shape[1];
        const out = new Float32Array(n); const cols = t.shape[1];
        for (let i = 0; i < n; i++) out[i] = q[i] * sc[i % cols];
        T[t.name] = { data: out, shape: t.shape };
      } else { const n = t.shape.reduce((a, b) => a * b, 1); T[t.name] = { data: new Float32Array(buf.slice(off, off + 4 * n)), shape: t.shape }; off += 4 * n; }
      off = (off + 3) & ~3;
    }
    M = { chars: meta.chars, Hn: meta.Hn, chans: meta.chans, layers: meta.layers || 1, pools: meta.pools || [[2, 2], [2, 2], [2, 1], [2, 1]], T, meta };
    if (wasm) uploadWeights();
    return M;
  }
  const ready = () => !!M;

  /* ---------- rasterizing ink into the 32-px strip the network was trained on ---------- */
  /* strokes: [{pts:[[x,y],...]}] in any units. Returns { img: Float32Array(H*W), W } */
  function rasterize(strokes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) for (const p of s.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    if (!isFinite(x0)) return null;
    const bh = Math.max(1, y1 - y0), bw = Math.max(1, x1 - x0);
    let k = (H - 2 * PAD) / bh; let w = Math.ceil(bw * k) + 2 * PAD + 2;
    if (w > WMAX) { k *= (WMAX - 2 * PAD - 2) / (w - 2 * PAD - 2); w = WMAX; }
    const ih = bh * k; const top = PAD + ((H - 2 * PAD) - ih) / 2;
    const W = Math.max(32, Math.ceil(w / 32) * 32); const img = new Float32Array(H * W);
    const r = Math.max(1.1, Math.min(2.2, 1.35 * Math.sqrt(k * 0.08 + 1)));   // pen radius in strip pixels
    const stamp = (cx, cy) => {
      const xa = Math.max(0, Math.floor(cx - r - 1)), xb = Math.min(W - 1, Math.ceil(cx + r + 1)), ya = Math.max(0, Math.floor(cy - r - 1)), yb = Math.min(H - 1, Math.ceil(cy + r + 1));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); const v = Math.max(0, Math.min(1, (r + 0.5 - d))); if (v > img[y * W + x]) img[y * W + x] = v; }
    };
    for (const s of strokes) {
      const pts = s.pts; let px = null, py = null;
      for (const p of pts) {
        const cx = PAD + 1 + (p[0] - x0) * k, cy = top + (p[1] - y0) * k;
        if (px == null) stamp(cx, cy);
        else { const d = Math.hypot(cx - px, cy - py); const n = Math.max(1, Math.ceil(d / 0.5)); for (let i = 1; i <= n; i++) stamp(px + (cx - px) * i / n, py + (cy - py) * i / n); }
        px = cx; py = cy;
      }
    }
    return { img, W };
  }

  /* ---------- layers (NHWC) ---------- */
  function conv3(inp, Hh, Wd, Cin, Wt, b, Cout) {
    const out = new Float32Array(Hh * Wd * Cout);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < Wd; x++) {
      const o = (y * Wd + x) * Cout; for (let c = 0; c < Cout; c++) out[o + c] = b[c];
      for (let dy = 0; dy < 3; dy++) { const yy = y + dy - 1; if (yy < 0 || yy >= Hh) continue;
        for (let dx = 0; dx < 3; dx++) { const xx = x + dx - 1; if (xx < 0 || xx >= Wd) continue;
          const i = (yy * Wd + xx) * Cin; const wrow0 = (dy * 3 + dx) * Cin;
          for (let ci = 0; ci < Cin; ci++) { const v = inp[i + ci]; if (v === 0) continue; const wr = (wrow0 + ci) * Cout; for (let c = 0; c < Cout; c++) out[o + c] += v * Wt[wr + c]; } } }
      for (let c = 0; c < Cout; c++) if (out[o + c] < 0) out[o + c] = 0;       // relu
    }
    return out;
  }
  function pool(inp, Hh, Wd, C, ph, pw) {
    const H2 = Hh / ph | 0, W2 = Wd / pw | 0; const out = new Float32Array(H2 * W2 * C);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const o = (y * W2 + x) * C;
      for (let c = 0; c < C; c++) { let m = -Infinity; for (let dy = 0; dy < ph; dy++) for (let dx = 0; dx < pw; dx++) { const v = inp[((y * ph + dy) * Wd + (x * pw + dx)) * C + c]; if (v > m) m = v; } out[o + c] = m; } }
    return { out, H: H2, W: W2 };
  }
  const sig = z => 1 / (1 + Math.exp(-z));
  /* x: (T, F) → h: (T, Hn) */
  function lstm(x, T, F, Wx, Wh, b, Hn, reverse) {
    const hs = new Float32Array(T * Hn); let h = new Float32Array(Hn), c = new Float32Array(Hn); const g = new Float32Array(4 * Hn);
    for (let s = 0; s < T; s++) {
      const t = reverse ? T - 1 - s : s; const xo = t * F;
      for (let j = 0; j < 4 * Hn; j++) g[j] = b[j];
      for (let i = 0; i < F; i++) { const v = x[xo + i]; if (v === 0) continue; const wr = i * 4 * Hn; for (let j = 0; j < 4 * Hn; j++) g[j] += v * Wx[wr + j]; }
      for (let i = 0; i < Hn; i++) { const v = h[i]; if (v === 0) continue; const wr = i * 4 * Hn; for (let j = 0; j < 4 * Hn; j++) g[j] += v * Wh[wr + j]; }
      const nh = new Float32Array(Hn), nc = new Float32Array(Hn);
      for (let j = 0; j < Hn; j++) { const ig = sig(g[j]), fg = sig(g[Hn + j]), og = sig(g[2 * Hn + j]), u = Math.tanh(g[3 * Hn + j]); nc[j] = fg * c[j] + ig * u; nh[j] = og * Math.tanh(nc[j]); }
      h = nh; c = nc; hs.set(h, t * Hn);
    }
    return hs;
  }
  /* returns log-probabilities (T, C) */
  function forward(img, W) {
    if (wasm && wptr) { try { return forwardWasm(img, W); } catch (e) { wasm = null; } }
    return forwardJS(img, W);
  }
  const lstmPrefix = k => k === 0 ? 'l' : 'l' + (k + 1);
  function forwardWasm(img, W, featOnly) {
    const ch = M.chans; const pools = M.pools;
    wasm.arena_set(weightsEnd);
    const F32 = (p, n) => new Float32Array(wasm.memory.buffer, p, n);
    let x = wasm.arena_alloc(H * W); F32(x, H * W).set(img); let Hh = H, Wd = W, C = 1;
    for (let i = 0; i < 4; i++) {
      const out = wasm.arena_alloc(Hh * Wd * ch[i]); wasm.conv3(x, Hh, Wd, C, wptr['c' + i + 'w'], wptr['c' + i + 'b'], ch[i], out); C = ch[i];
      const H2 = Hh / pools[i][0] | 0, W2 = Wd / pools[i][1] | 0; const pooled = wasm.arena_alloc(H2 * W2 * C); wasm.pool(out, Hh, Wd, C, pools[i][0], pools[i][1], pooled); x = pooled; Hh = H2; Wd = W2;
    }
    const Tn = Wd, F = Hh * C; const xs = F32(x, Hh * Wd * C); const featP = wasm.arena_alloc(Tn * F); const feat = F32(featP, Tn * F);
    for (let t = 0; t < Tn; t++) for (let y = 0; y < Hh; y++) for (let c = 0; c < C; c++) feat[t * F + y * C + c] = xs[(y * Wd + t) * C + c];
    const Hn = M.Hn; const g = wasm.arena_alloc(4 * Hn), h = wasm.arena_alloc(Hn), c = wasm.arena_alloc(Hn);
    let inP = featP, inF = F, hf = 0, hb = 0;
    for (let k = 0; k < M.layers; k++) {
      const pre = lstmPrefix(k); hf = wasm.arena_alloc(Tn * Hn); hb = wasm.arena_alloc(Tn * Hn);
      wasm.lstm(inP, Tn, inF, wptr[pre + 'fx'], wptr[pre + 'fh'], wptr[pre + 'fb'], Hn, 0, hf, g, h, c);
      wasm.lstm(inP, Tn, inF, wptr[pre + 'bx'], wptr[pre + 'bh'], wptr[pre + 'bb'], Hn, 1, hb, g, h, c);
      if (k < M.layers - 1) {   // the next layer reads the concatenated outputs
        const catP = wasm.arena_alloc(Tn * 2 * Hn); const cat = F32(catP, Tn * 2 * Hn), a = F32(hf, Tn * Hn), b = F32(hb, Tn * Hn);
        for (let t = 0; t < Tn; t++) { cat.set(a.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn); cat.set(b.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn + Hn); }
        inP = catP; inF = 2 * Hn;
      }
    }
    if (featOnly) { const out = new Float32Array(Tn * 2 * Hn), a = F32(hf, Tn * Hn), b = F32(hb, Tn * Hn); for (let t = 0; t < Tn; t++) { out.set(a.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn); out.set(b.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn + Hn); } return { h: out, T: Tn }; }
    const nc = M.T.ob.data.length; const lp = wasm.arena_alloc(Tn * nc); wasm.dense_logsoftmax(hf, hb, Tn, Hn, wptr.ow, wptr.ob, nc, lp);
    return { logp: new Float32Array(F32(lp, Tn * nc)), T: Tn, C: nc };
  }
  function forwardJS(img, W, featOnly) {
    const T = M.T; const ch = M.chans; let x = img, Hh = H, Wd = W, C = 1;
    const pools = M.pools;
    for (let i = 0; i < 4; i++) { const w = T['c' + i + 'w'], b = T['c' + i + 'b']; x = conv3(x, Hh, Wd, C, w.data, b.data, ch[i]); C = ch[i]; const p = pool(x, Hh, Wd, C, pools[i][0], pools[i][1]); x = p.out; Hh = p.H; Wd = p.W; }
    const Tn = Wd, F = Hh * C;        // columns: features (Hh rows x C) per time step
    const feat = new Float32Array(Tn * F);
    for (let t = 0; t < Tn; t++) for (let y = 0; y < Hh; y++) for (let c = 0; c < C; c++) feat[t * F + y * C + c] = x[(y * Wd + t) * C + c];
    const Hn = M.Hn; let inp = feat, inF = F, hf = null, hb = null;
    for (let k = 0; k < M.layers; k++) {
      const pre = lstmPrefix(k);
      hf = lstm(inp, Tn, inF, T[pre + 'fx'].data, T[pre + 'fh'].data, T[pre + 'fb'].data, Hn, false); hb = lstm(inp, Tn, inF, T[pre + 'bx'].data, T[pre + 'bh'].data, T[pre + 'bb'].data, Hn, true);
      if (k < M.layers - 1) { const cat = new Float32Array(Tn * 2 * Hn); for (let t = 0; t < Tn; t++) { cat.set(hf.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn); cat.set(hb.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn + Hn); } inp = cat; inF = 2 * Hn; }
    }
    const h = new Float32Array(Tn * 2 * Hn); for (let t = 0; t < Tn; t++) { h.set(hf.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn); h.set(hb.subarray(t * Hn, t * Hn + Hn), t * 2 * Hn + Hn); }
    if (featOnly) return { h, T: Tn };
    return denseLogp(h, Tn);
  }
  /* the output layer on cached BiLSTM features h (T, 2Hn) → log-probabilities (T, C) */
  function denseLogp(h, Tn) {
    const ow = M.T.ow.data, ob = M.T.ob.data; const nc = ob.length; const F = 2 * M.Hn; const logp = new Float32Array(Tn * nc);
    for (let t = 0; t < Tn; t++) {
      const o = t * nc; for (let k = 0; k < nc; k++) logp[o + k] = ob[k];
      for (let i = 0; i < F; i++) { const v = h[t * F + i]; if (v === 0) continue; const wr = i * nc; for (let k = 0; k < nc; k++) logp[o + k] += v * ow[wr + k]; }
      let m = -Infinity; for (let k = 0; k < nc; k++) if (logp[o + k] > m) m = logp[o + k];
      let s = 0; for (let k = 0; k < nc; k++) s += Math.exp(logp[o + k] - m); const ls = m + Math.log(s);
      for (let k = 0; k < nc; k++) logp[o + k] -= ls;
    }
    return { logp, T: Tn, C: nc };
  }
  /* BiLSTM features of a strip, for on-device adaptation */
  function features(img, W) {
    if (wasm && wptr) { try { return forwardWasm(img, W, true); } catch (e) { wasm = null; } }
    return forwardJS(img, W, true);
  }

  /* ---------- CTC decoding ---------- */
  function greedy(logp, T, C) {
    let out = '', prev = 0, score = 0;
    for (let t = 0; t < T; t++) { let b = 0, bv = -Infinity; for (let k = 0; k < C; k++) { const v = logp[t * C + k]; if (v > bv) { bv = v; b = k; } } score += bv; if (b !== prev && b !== 0) out += M.chars[b - 1]; prev = b; }
    return { text: out, score };
  }
  const lse = (a, b) => a === -Infinity ? b : b === -Infinity ? a : Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));
  /* prefix beam search; returns [{text, score}] best first */
  function beam(logp, T, C, width) {
    width = width || 8;
    let beams = new Map([['', [0, -Infinity]]]);          // prefix → [log p(blank-ending), log p(non-blank-ending)]
    for (let t = 0; t < T; t++) {
      const next = new Map(); const row = t * C;
      // candidate symbols at this step: the top few
      const cand = []; for (let k = 0; k < C; k++) if (logp[row + k] > -7) cand.push(k);
      if (!cand.length) { let b = 0, bv = -Infinity; for (let k = 0; k < C; k++) if (logp[row + k] > bv) { bv = logp[row + k]; b = k; } cand.push(b); }
      for (const [pre, [pb, pnb]] of beams) {
        const total = lse(pb, pnb);
        for (const k of cand) {
          const p = logp[row + k];
          if (k === 0) { const cur = next.get(pre) || [-Infinity, -Infinity]; cur[0] = lse(cur[0], total + p); next.set(pre, cur); continue; }
          const ch = M.chars[k - 1]; const last = pre[pre.length - 1];
          const np = pre + ch; const cur = next.get(np) || [-Infinity, -Infinity];
          if (ch === last) { cur[1] = lse(cur[1], pb + p); const same = next.get(pre) || [-Infinity, -Infinity]; same[1] = lse(same[1], pnb + p); next.set(pre, same); }
          else cur[1] = lse(cur[1], total + p);
          next.set(np, cur);
        }
      }
      beams = new Map([...next.entries()].sort((a, b) => lse(b[1][0], b[1][1]) - lse(a[1][0], a[1][1])).slice(0, width));
    }
    return [...beams.entries()].map(([text, [pb, pnb]]) => ({ text, score: lse(pb, pnb) })).sort((a, b) => b.score - a.score);
  }
  /* log P(text | logp) under CTC, by the forward algorithm (for re-scoring dictionary candidates) */
  function score(logp, T, C, text) {
    const lab = []; for (const ch of text) { const k = M.chars.indexOf(ch); if (k < 0) return -Infinity; lab.push(k + 1); }
    const S = 2 * lab.length + 1; const ext = new Array(S).fill(0); for (let i = 0; i < lab.length; i++) ext[2 * i + 1] = lab[i];
    let a = new Float64Array(S).fill(-Infinity); a[0] = logp[0]; if (S > 1) a[1] = logp[ext[1]];
    for (let t = 1; t < T; t++) {
      const na = new Float64Array(S).fill(-Infinity); const row = t * C;
      for (let s = 0; s < S; s++) {
        let v = a[s]; if (s > 0) v = lse(v, a[s - 1]); if (s > 1 && ext[s] !== 0 && ext[s] !== ext[s - 2]) v = lse(v, a[s - 2]);
        if (v > -Infinity) na[s] = v + logp[row + ext[s]];
      }
      a = na;
    }
    return S > 1 ? lse(a[S - 1], a[S - 2]) : a[0];
  }

  /* ---------- on-device adaptation: the output layer learns the person's own words ----------
     The convolution and LSTM layers stay as trained; only the last layer (2Hn x classes) moves, pulled back toward
     its trained values, so a few dozen words cannot wreck the general model. CTC gradient as in tools/crnn/train.py. */
  function ctcGrad(logp, T, C, lab) {
    const L = lab.length, S = 2 * L + 1; const ext = new Int32Array(S); for (let i = 0; i < L; i++) ext[2 * i + 1] = lab[i];
    const skip = new Uint8Array(S); for (let s = 2; s < S; s++) skip[s] = ext[s] !== 0 && ext[s] !== ext[s - 2] ? 1 : 0;
    const NEG = -Infinity; const al = new Float64Array(T * S).fill(NEG), be = new Float64Array(T * S).fill(NEG);
    al[0] = logp[ext[0]]; if (S > 1) al[1] = logp[ext[1]];
    for (let t = 1; t < T; t++) { const row = t * C, o = t * S, po = (t - 1) * S; for (let s = 0; s < S; s++) { let v = al[po + s]; if (s > 0) v = lse(v, al[po + s - 1]); if (skip[s]) v = lse(v, al[po + s - 2]); if (v > NEG) al[o + s] = v + logp[row + ext[s]]; } }
    const ll = S > 1 ? lse(al[(T - 1) * S + S - 1], al[(T - 1) * S + S - 2]) : al[(T - 1) * S];
    if (!(ll > NEG)) return null;   // strip too short for the label
    const lo = (T - 1) * S; be[lo + S - 1] = logp[(T - 1) * C + ext[S - 1]]; if (S > 1) be[lo + S - 2] = logp[(T - 1) * C + ext[S - 2]];
    for (let t = T - 2; t >= 0; t--) { const row = t * C, o = t * S, no = (t + 1) * S; for (let s = 0; s < S; s++) { let v = be[no + s]; if (s + 1 < S) v = lse(v, be[no + s + 1]); if (s + 2 < S && skip[s + 2]) v = lse(v, be[no + s + 2]); if (v > NEG) be[o + s] = v + logp[row + ext[s]]; } }
    const grad = new Float32Array(T * C);
    for (let t = 0; t < T; t++) { const row = t * C, o = t * S; for (let k = 0; k < C; k++) grad[row + k] = Math.exp(logp[row + k]); for (let s = 0; s < S; s++) { const v = al[o + s] + be[o + s] - logp[row + ext[s]] - ll; if (v > NEG) grad[row + ext[s]] -= Math.exp(v); } }
    return { loss: -ll, grad };
  }
  function keepBase() { if (!M.base) M.base = { ow: new Float32Array(M.T.ow.data), ob: new Float32Array(M.T.ob.data) }; }
  /* features + labels for [{strokes:[{pts}], text}] (skips words with characters the model does not know) */
  function prepare(samples) {
    const data = [];
    for (const smp of samples) {
      const text = (smp.text || '').trim(); if (!text) continue;
      const lab = []; let ok = true; for (const ch of text) { const k = M.chars.indexOf(ch); if (k < 0) { ok = false; break; } lab.push(k + 1); } if (!ok) continue;
      const r = rasterize(smp.strokes || []); if (!r) continue;
      const f = features(r.img, r.W); if (f.T < lab.length) continue;
      data.push({ h: f.h, T: f.T, lab, text });
    }
    return data;
  }
  function editDistance(a, b) { const dp = []; for (let j = 0; j <= b.length; j++) dp[j] = j; for (let i = 1; i <= a.length; i++) { let prev = dp[0]; dp[0] = i; for (let j = 1; j <= b.length; j++) { const cur = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } } return dp[b.length]; }
  /* greedy reads of prepared samples: { words: exact (case-insensitive) count, errs: total edit distance, chars } */
  function evalSet(data) {
    const C = M.T.ob.data.length; let words = 0, errs = 0, chars = 0;
    for (const d of data) { const t = greedy(denseLogp(d.h, d.T).logp, d.T, C).text; if (t.toLowerCase() === d.text.toLowerCase()) words++; errs += editDistance(t.toLowerCase(), d.text.toLowerCase()); chars += d.text.length; }
    return { words, errs, chars, n: data.length };
  }
  const SETTINGS = { mild: { epochs: 8, lr: 1e-3, l2: 0.05 }, strong: { epochs: 15, lr: 3e-3, l2: 0.01 } };
  /* fine-tunes the output layer in place on prepared samples (CTC, Adam, pulled back toward the trained weights) */
  function trainDense(data, setting) {
    const { epochs, lr, l2 } = typeof setting === 'string' ? SETTINGS[setting] : setting; const bs = 8;
    const F = 2 * M.Hn, C = M.T.ob.data.length;
    const ow = M.T.ow.data, ob = M.T.ob.data; const W0 = new Float32Array(ow), b0 = new Float32Array(ob);
    const mW = new Float32Array(ow.length), vW = new Float32Array(ow.length), mb = new Float32Array(C), vb = new Float32Array(C);
    const gW = new Float32Array(ow.length), gb = new Float32Array(C); let step = 0; let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let wk = null;   // SIMD outer product when the kernels are up
    if (wasm && wasm.outer_acc) { try { wasm.arena_set(weightsEnd); const hp = wasm.arena_alloc(WMAX / 2 * F), gp = wasm.arena_alloc(WMAX / 2 * C), wp = wasm.arena_alloc(ow.length); wk = { hp, gp, wp }; } catch (e) { wk = null; } }
    for (let ep = 0; ep < epochs; ep++) {
      const order = data.map((_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      for (let bi = 0; bi < order.length; bi += bs) {
        gW.fill(0); gb.fill(0); let used = 0;
        if (wk) new Float32Array(wasm.memory.buffer, wk.wp, ow.length).fill(0);
        for (const i of order.slice(bi, bi + bs)) {
          const d = data[i]; const { logp } = denseLogp(d.h, d.T); const g = ctcGrad(logp, d.T, C, d.lab); if (!g) continue; used++;
          for (let t = 0; t < d.T; t++) { const go = t * C; for (let k = 0; k < C; k++) gb[k] += g.grad[go + k]; }
          if (wk && d.T * F <= WMAX / 2 * F) { new Float32Array(wasm.memory.buffer, wk.hp, d.T * F).set(d.h); new Float32Array(wasm.memory.buffer, wk.gp, d.T * C).set(g.grad); wasm.outer_acc(wk.hp, wk.gp, d.T, F, C, wk.wp); }
          else for (let t = 0; t < d.T; t++) { const go = t * C, ho = t * F; for (let f = 0; f < F; f++) { const v = d.h[ho + f]; if (v === 0) continue; const wr = f * C; for (let k = 0; k < C; k++) gW[wr + k] += v * g.grad[go + k]; } }
        }
        if (!used) continue; step++;
        if (wk) { const acc = new Float32Array(wasm.memory.buffer, wk.wp, ow.length); for (let i = 0; i < ow.length; i++) gW[i] += acc[i]; }
        const sc = 1 / used; const c1 = 1 - Math.pow(0.9, step), c2 = 1 - Math.pow(0.999, step);
        for (let i = 0; i < ow.length; i++) { const g = gW[i] * sc + l2 * (ow[i] - W0[i]); mW[i] = 0.9 * mW[i] + 0.1 * g; vW[i] = 0.999 * vW[i] + 0.001 * g * g; ow[i] -= lr * (mW[i] / c1) / (Math.sqrt(vW[i] / c2) + 1e-8); }
        for (let k = 0; k < C; k++) { const g = gb[k] * sc + l2 * (ob[k] - b0[k]); mb[k] = 0.9 * mb[k] + 0.1 * g; vb[k] = 0.999 * vb[k] + 0.001 * g * g; ob[k] -= lr * (mb[k] / c1) / (Math.sqrt(vb[k] / c2) + 1e-8); }
      }
    }
    if (wasm && wptr) uploadWeights(); version++;
  }
  function restoreDense(ow, ob) { M.T.ow.data.set(ow); M.T.ob.data.set(ob); }
  /* samples: [{strokes:[{pts}], text}]. With a dozen or more words a part is held out to check that the adaptation actually
     helps on words it has not seen; the setting that reads those best wins, and "leave it as trained" can win too.
     Returns { n, setting, before, after, holdout: {n, before, after} | null, ow, ob }. */
  function adapt(samples, opts) {
    if (!M) return null; opts = opts || {}; keepBase();
    const data = prepare(samples); if (!data.length) return { n: 0, setting: 'none', before: 0, after: 0, holdout: null };
    const ow0 = new Float32Array(M.T.ow.data), ob0 = new Float32Array(M.T.ob.data);   // where we start (may already be adapted)
    const C = M.T.ob.data.length; const before = evalSet(data).words;
    let setting = opts.setting || 'mild', holdout = null;
    if (!opts.setting && data.length >= 12) {
      let seed = 777; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const order = data.map((_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      const nh = Math.max(4, Math.round(data.length * 0.3)); const hold = order.slice(0, nh).map(i => data[i]), rest = order.slice(nh).map(i => data[i]);
      const base = evalSet(hold); const trials = { none: base };
      for (const name of ['mild', 'strong']) { restoreDense(ow0, ob0); trainDense(rest, name); trials[name] = evalSet(hold); }
      restoreDense(ow0, ob0);
      setting = 'none'; let best = base.errs;
      for (const name of ['mild', 'strong']) if (trials[name].errs < best) { best = trials[name].errs; setting = name; }
      holdout = { n: nh, before: base.words, after: trials[setting].words, beforeErrs: base.errs, afterErrs: trials[setting].errs, chars: base.chars };
    }
    if (setting !== 'none') trainDense(data, setting); else { if (wasm && wptr) uploadWeights(); version++; }
    const after = evalSet(data).words;
    return { n: data.length, setting, before, after, holdout, ow: new Float32Array(M.T.ow.data), ob: new Float32Array(M.T.ob.data) };
  }
  /* applies saved adapted output weights (null = back to the trained ones) */
  function setDense(ow, ob) {
    if (!M) return false; keepBase();
    const src = ow && ob && ow.length === M.T.ow.data.length && ob.length === M.T.ob.data.length ? { ow, ob } : M.base;
    M.T.ow.data.set(src.ow); M.T.ob.data.set(src.ob); if (wasm && wptr) uploadWeights(); version++; return true;
  }
  const adapted = () => !!(M && M.base && M.T.ow.data.some((v, i) => v !== M.base.ow[i]));

  /* ---------- the public call ---------- */
  /* Recognizes one word's strokes. Returns { text, score, alts: [{text, score}], T } or null when the model is not loaded. */
  function recognize(strokes, opts) {
    if (!M) return null; opts = opts || {};
    const r = rasterize(strokes); if (!r) return null;
    const { logp, T, C } = forward(r.img, r.W);
    if (opts.fast) { const g = greedy(logp, T, C); return { text: g.text, score: g.score, alts: [], T, logp: opts.keepLogits ? logp : null, C }; }
    const alts = beam(logp, T, C, opts.width || 8);
    const best = alts[0] || greedy(logp, T, C);
    return { text: best.text, score: best.score, alts, T, C, logp: opts.keepLogits ? logp : null };
  }
  IL.crnn = { load, ready, initWasm, rasterize, forward, forwardJS, features, denseLogp, ctcGrad, adapt, setDense, adapted, greedy, beam, score, recognize, get model() { return M; }, get wasm() { return !!wasm; }, get version() { return version; } };
})();
