"""Character trigram language model for the recognizer's beam search (shallow fusion).

Case-folded, 40 symbols (letters, a digit class, space, common punctuation, start/end). Trained on the English, German and
Spanish frequency lists plus generated numbers. Stored as a 40^3 table of quantized -log P (uint8, 0.05 nat steps).

  python3 lm.py build          → js/crnn-lm.js
  python3 lm.py tune           → tries alpha/beta on the synthetic eval set with the current checkpoint
"""
import os, sys, json, base64, math
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import gen

SYMS = list('abcdefghijklmnopqrstuvwxyz') + ['#', '_', '.', ',', '-', "'", '!', '?', '(', ')', '/', ':', '*', '^', '$']   # * = any other symbol, ^ = start, $ = end
V = len(SYMS); IDX = {s: i for i, s in enumerate(SYMS)}
FOLD = {'ä': 'a', 'ö': 'o', 'ü': 'u', 'ß': 's', 'ñ': 'n', 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', '"': "'", ';': ',', '¿': '?', '¡': '!', '&': '*', '+': '*', '=': '*', '%': '*', '@': '*', '$': '*', '€': '*'}
def sym(ch):
    c = ch.lower(); c = FOLD.get(c, c)
    if c.isdigit(): return IDX['#']
    if c == ' ': return IDX['_']
    return IDX.get(c, IDX['*'])
def seq(text): return [IDX['^'], IDX['^']] + [sym(c) for c in text] + [IDX['$']]

def build():
    rng = np.random.default_rng(0)
    c3 = np.zeros((V, V, V)); c2 = np.zeros((V, V)); c1 = np.zeros(V)
    def add(text, w):
        s = seq(text)
        for i in range(2, len(s)): c3[s[i - 2], s[i - 1], s[i]] += w; c2[s[i - 1], s[i]] += w; c1[s[i]] += w
    for lang in ('en', 'de', 'es'):
        words, weights = gen.load_words(lang, 30000)
        for w, p in zip(words, weights): add(w, 1000 * p ** 0.5)
    for _ in range(20000): add(gen.random_number(rng), 0.02)
    for _ in range(6000): add(gen.random_code(rng), 0.01)
    for _ in range(4000): add(gen.pick_word(rng, 'en') + ' ' + gen.pick_word(rng, 'en'), 0.02)
    # interpolated absolute discounting: P3 = max(c3-d,0)/c2ctx + lambda * P2 ; P2 = max(c2-d,0)/c1ctx + lambda * P1 ; P1 additive
    d = 0.75
    P1 = (c1 + 0.5) / (c1.sum() + 0.5 * V)
    ctx2 = c2.sum(axis=1, keepdims=True); n2 = (c2 > 0).sum(axis=1, keepdims=True)
    P2 = np.where(ctx2 > 0, np.maximum(c2 - d, 0) / np.maximum(ctx2, 1e-9) + (d * n2 / np.maximum(ctx2, 1e-9)) * P1[None, :], P1[None, :])
    ctx3 = c3.sum(axis=2, keepdims=True); n3 = (c3 > 0).sum(axis=2, keepdims=True)
    P3 = np.where(ctx3 > 0, np.maximum(c3 - d, 0) / np.maximum(ctx3, 1e-9) + (d * n3 / np.maximum(ctx3, 1e-9)) * P2[None, :, :], P2[None, :, :])
    P3 = np.clip(P3, 1e-6, 1)
    q = np.clip(np.round(-np.log(P3) / 0.05), 0, 255).astype(np.uint8)
    b64 = base64.b64encode(q.tobytes()).decode('ascii')
    js = '/* Inkleaf — character trigram language model for the neural recognizer (built by tools/crnn/lm.py). */\n(function(){ const root = typeof window !== "undefined" ? window : self; const IL = (root.IL = root.IL || {}); IL.crnnLMData = { syms: %s, fold: %s, step: 0.05, b64: "%s" }; })();\n' % (json.dumps(SYMS), json.dumps(FOLD), b64)
    open(os.path.join(HERE, '..', '..', 'js', 'crnn-lm.js'), 'w').write(js)
    np.save(os.path.join(HERE, 'out', 'lm_q.npy'), q)
    print('LM table', q.shape, len(js) // 1024, 'KB as JS; sample P(e|th)=%.3f P(x|th)=%.4f P($|ing)=%.3f' % (P3[IDX['t'], IDX['h'], IDX['e']], P3[IDX['t'], IDX['h'], IDX['x']], P3[IDX['n'], IDX['g'], IDX['$']]))
    return q

class LM:
    def __init__(self, q): self.lp = -(q.astype(np.float32) * 0.05)
    def score(self, text):
        s = seq(text); return float(sum(self.lp[s[i - 2], s[i - 1], s[i]] for i in range(2, len(s))))

def lse(a, b):
    if a == -np.inf: return b
    if b == -np.inf: return a
    m = max(a, b); return m + math.log1p(math.exp(-abs(a - b)))

def beam_decode(logp, chars, width=8, lm=None, alpha=0.0, beta=0.0):
    """prefix beam search with optional shallow LM fusion; logp (T, C) log-softmax; returns [(text, score)]"""
    T, C = logp.shape
    beams = {'': (0.0, -np.inf)}
    for t in range(T):
        row = logp[t]; cand = np.where(row > -7)[0]
        if len(cand) == 0: cand = [int(row.argmax())]
        nxt = {}
        for pre, (pb, pnb) in beams.items():
            total = lse(pb, pnb)
            for k in cand:
                p = float(row[k])
                if k == 0:
                    cur = nxt.get(pre, (-np.inf, -np.inf)); nxt[pre] = (lse(cur[0], total + p), cur[1]); continue
                ch = chars[k - 1]; last = pre[-1] if pre else ''
                np_ = pre + ch; cur = nxt.get(np_, (-np.inf, -np.inf))
                bonus = 0.0
                if lm is not None:
                    s = seq(pre)[-2:]; bonus = alpha * float(lm.lp[s[0], s[1], sym(ch)]) + beta
                if ch == last:
                    nxt[np_] = (cur[0], lse(cur[1], pb + p + bonus))
                    same = nxt.get(pre, (-np.inf, -np.inf)); nxt[pre] = (same[0], lse(same[1], pnb + p))
                else:
                    nxt[np_] = (cur[0], lse(cur[1], total + p + bonus))
        beams = dict(sorted(nxt.items(), key=lambda kv: -lse(*kv[1]))[:width])
    out = []
    for text, (pb, pnb) in beams.items():
        sc = lse(pb, pnb)
        if lm is not None and text: s = seq(text)[-3:-1]; sc += alpha * float(lm.lp[s[0], s[1], IDX['$']])
        out.append((text, sc))
    return sorted(out, key=lambda x: -x[1])

def tune():
    import train
    q = np.load(os.path.join(HERE, 'out', 'lm_q.npy')); lm = LM(q)
    ck = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'ckpt.npz')
    z = np.load(ck); meta = json.loads(str(z['__meta'])); m = train.model_from_meta(meta, gen.NCLASS); m.load(ck)
    rng = np.random.default_rng(777); batches = [gen.make_batch(rng, 32) for _ in range(8)]
    logps = []
    for X, labels, texts in batches:
        lg = m.forward(X, train=False); lg = lg - lg.max(axis=2, keepdims=True); lp = lg - np.log(np.exp(lg).sum(axis=2, keepdims=True))
        for i in range(len(texts)): logps.append((lp[i], texts[i]))
    print('model step', meta.get('step'), 'samples', len(logps))
    for alpha, beta in [(0, 0), (0.2, 0.3), (0.3, 0.4), (0.4, 0.6), (0.5, 0.8), (0.6, 1.0), (0.3, 0.8), (0.4, 1.0)]:
        ok = 0; ce = 0; cn = 0
        for lp, t in logps:
            best = beam_decode(lp, gen.CHARS, 8, lm if alpha > 0 else None, alpha, beta)[0][0]
            ok += best == t; ce += train.edit_distance(best, t); cn += len(t)
        print('alpha %.1f beta %.1f  word acc %.1f%%  CER %.1f%%' % (alpha, beta, 100 * ok / len(logps), 100 * ce / cn), flush=True)

if __name__ == '__main__':
    if sys.argv[1] == 'build': build()
    elif sys.argv[1] == 'tune': tune()
