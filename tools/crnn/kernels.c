/* Inkleaf — CRNN inference kernels compiled to WebAssembly (SIMD). Layout NHWC, float32.
   Built by tools/crnn/build-wasm.sh; the JS side (js/crnn.js) manages memory offsets and falls back to plain JS kernels. */
#include <wasm_simd128.h>
typedef float f32;

static unsigned char *heap_top = 0;
extern unsigned char __heap_base;
__attribute__((export_name("arena_reset"))) void arena_reset(void) { heap_top = &__heap_base; }
__attribute__((export_name("arena_alloc"))) f32 *arena_alloc(int n) { if (!heap_top) heap_top = &__heap_base; f32 *p = (f32 *)heap_top; heap_top += (unsigned)(n * 4 + 15) & ~15u; return p; }
__attribute__((export_name("arena_used"))) int arena_used(void) { if (!heap_top) heap_top = &__heap_base; return (int)(heap_top - &__heap_base); }
__attribute__((export_name("arena_set"))) void arena_set(int used) { heap_top = &__heap_base + used; }

static inline f32 fast_exp(f32 x) {
  if (x < -87.0f) return 0.0f; if (x > 88.0f) x = 88.0f;
  f32 t = x * 1.44269504f; int k = (int)(t < 0 ? t - 0.5f : t + 0.5f); f32 r = t - (f32)k;    /* 2^r, r in [-0.5, 0.5] */
  f32 p = 1.0f + r * (0.69314718f + r * (0.24022651f + r * (0.05550411f + r * (0.00961813f + r * 0.00133336f))));
  union { f32 f; int i; } u; u.i = (k + 127) << 23; return p * u.f;
}
static inline f32 fast_log(f32 x) {                       /* natural log for x > 0 */
  union { f32 f; int i; } u; u.f = x; int e = ((u.i >> 23) & 255) - 127; u.i = (u.i & 0x007fffff) | 0x3f800000; f32 m = u.f;   /* x = m * 2^e, m in [1,2) */
  f32 t = (m - 1.0f) / (m + 1.0f), t2 = t * t;                                                                                     /* log(m) = 2 atanh(t) */
  f32 lm = 2.0f * t * (1.0f + t2 * (0.33333333f + t2 * (0.2f + t2 * (0.14285714f + t2 * 0.11111111f))));
  return lm + 0.69314718f * (f32)e;
}
static inline f32 sigm(f32 z) { return 1.0f / (1.0f + fast_exp(-z)); }
static inline f32 tanhf_(f32 z) { if (z > 9.0f) return 1.0f; if (z < -9.0f) return -1.0f; f32 e = fast_exp(2.0f * z); return (e - 1.0f) / (e + 1.0f); }

/* 3x3 conv, pad 1, ReLU fused. in (H,W,Cin) → out (H,W,Cout); w (9*Cin, Cout); Cout multiple of 4 */
__attribute__((export_name("conv3"))) void conv3(const f32 *in, int H, int W, int Cin, const f32 *w, const f32 *b, int Cout, f32 *out) {
  for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
    f32 *o = out + (y * W + x) * Cout;
    for (int c = 0; c < Cout; c += 4) wasm_v128_store(o + c, wasm_v128_load(b + c));
    for (int dy = 0; dy < 3; dy++) { int yy = y + dy - 1; if (yy < 0 || yy >= H) continue;
      for (int dx = 0; dx < 3; dx++) { int xx = x + dx - 1; if (xx < 0 || xx >= W) continue;
        const f32 *ip = in + (yy * W + xx) * Cin; const f32 *wr = w + (dy * 3 + dx) * Cin * Cout;
        for (int ci = 0; ci < Cin; ci++, wr += Cout) { f32 v = ip[ci]; if (v == 0.0f) continue; v128_t vv = wasm_f32x4_splat(v);
          for (int c = 0; c < Cout; c += 4) wasm_v128_store(o + c, wasm_f32x4_add(wasm_v128_load(o + c), wasm_f32x4_mul(vv, wasm_v128_load(wr + c)))); } } }
    v128_t z = wasm_f32x4_splat(0.0f);
    for (int c = 0; c < Cout; c += 4) wasm_v128_store(o + c, wasm_f32x4_max(wasm_v128_load(o + c), z));
  }
}
/* max pool ph x pw. in (H,W,C) → out (H/ph, W/pw, C) */
__attribute__((export_name("pool"))) void pool(const f32 *in, int H, int W, int C, int ph, int pw, f32 *out) {
  int H2 = H / ph, W2 = W / pw;
  for (int y = 0; y < H2; y++) for (int x = 0; x < W2; x++) {
    f32 *o = out + (y * W2 + x) * C;
    for (int c = 0; c < C; c++) o[c] = -3.0e38f;
    for (int dy = 0; dy < ph; dy++) for (int dx = 0; dx < pw; dx++) { const f32 *ip = in + ((y * ph + dy) * W + (x * pw + dx)) * C;
      int c = 0; for (; c + 4 <= C; c += 4) wasm_v128_store(o + c, wasm_f32x4_max(wasm_v128_load(o + c), wasm_v128_load(ip + c))); for (; c < C; c++) if (ip[c] > o[c]) o[c] = ip[c]; }
  }
}
/* LSTM over x (T,F) → hs (T,Hn). Wx (F,4Hn), Wh (Hn,4Hn), b (4Hn). g, h, c are scratch of 4Hn / Hn / Hn. 4Hn multiple of 4. */
__attribute__((export_name("lstm"))) void lstm(const f32 *x, int T, int F, const f32 *Wx, const f32 *Wh, const f32 *b, int Hn, int reverse, f32 *hs, f32 *g, f32 *h, f32 *c) {
  int G = 4 * Hn;
  for (int j = 0; j < Hn; j++) { h[j] = 0.0f; c[j] = 0.0f; }
  for (int s = 0; s < T; s++) {
    int t = reverse ? T - 1 - s : s; const f32 *xr = x + t * F;
    for (int j = 0; j < G; j += 4) wasm_v128_store(g + j, wasm_v128_load(b + j));
    for (int i = 0; i < F; i++) { f32 v = xr[i]; if (v == 0.0f) continue; v128_t vv = wasm_f32x4_splat(v); const f32 *wr = Wx + i * G;
      for (int j = 0; j < G; j += 4) wasm_v128_store(g + j, wasm_f32x4_add(wasm_v128_load(g + j), wasm_f32x4_mul(vv, wasm_v128_load(wr + j)))); }
    for (int i = 0; i < Hn; i++) { f32 v = h[i]; if (v == 0.0f) continue; v128_t vv = wasm_f32x4_splat(v); const f32 *wr = Wh + i * G;
      for (int j = 0; j < G; j += 4) wasm_v128_store(g + j, wasm_f32x4_add(wasm_v128_load(g + j), wasm_f32x4_mul(vv, wasm_v128_load(wr + j)))); }
    f32 *ho = hs + t * Hn;
    for (int j = 0; j < Hn; j++) { f32 ig = sigm(g[j]), fg = sigm(g[Hn + j]), og = sigm(g[2 * Hn + j]), u = tanhf_(g[3 * Hn + j]); c[j] = fg * c[j] + ig * u; h[j] = og * tanhf_(c[j]); ho[j] = h[j]; }
  }
}
/* output layer + log-softmax: hf, hb (T,Hn) → logp (T,C). ow (2Hn, C), ob (C) */
__attribute__((export_name("dense_logsoftmax"))) void dense_logsoftmax(const f32 *hf, const f32 *hb, int T, int Hn, const f32 *ow, const f32 *ob, int C, f32 *logp) {
  for (int t = 0; t < T; t++) {
    f32 *o = logp + t * C; for (int k = 0; k < C; k++) o[k] = ob[k];
    for (int i = 0; i < Hn; i++) { f32 v = hf[t * Hn + i]; const f32 *wr = ow + i * C; for (int k = 0; k < C; k++) o[k] += v * wr[k]; }
    for (int i = 0; i < Hn; i++) { f32 v = hb[t * Hn + i]; const f32 *wr = ow + (Hn + i) * C; for (int k = 0; k < C; k++) o[k] += v * wr[k]; }
    f32 m = -3.0e38f; for (int k = 0; k < C; k++) if (o[k] > m) m = o[k];
    f32 s = 0.0f; for (int k = 0; k < C; k++) s += fast_exp(o[k] - m);
    f32 ls = m + fast_log(s); for (int k = 0; k < C; k++) o[k] -= ls;
  }
}

/* gW (F, C) += h^T (F, T) · g (T, C): the output-layer gradient for on-device adaptation. C multiple of 4 handled with a scalar tail. */
__attribute__((export_name("outer_acc"))) void outer_acc(const f32 *h, const f32 *g, int T, int F, int C, f32 *gW) {
  int C4 = C & ~3;
  for (int t = 0; t < T; t++) {
    const f32 *hr = h + t * F; const f32 *gr = g + t * C;
    for (int f = 0; f < F; f++) {
      f32 v = hr[f]; if (v == 0.0f) continue; v128_t vv = wasm_f32x4_splat(v); f32 *w = gW + f * C; int k = 0;
      for (; k < C4; k += 4) wasm_v128_store(w + k, wasm_f32x4_add(wasm_v128_load(w + k), wasm_f32x4_mul(vv, wasm_v128_load(gr + k))));
      for (; k < C; k++) w[k] += v * gr[k];
    }
  }
}
