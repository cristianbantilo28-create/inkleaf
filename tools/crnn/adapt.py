"""Writer-adaptation experiment: how much does fine-tuning a small part of the CRNN on a few words of ONE writer
improve recognition of that writer's other words? Writers are simulated with the handwriting synthesis network
(one priming style, fixed neatness) and with single fonts.

  python3 adapt.py [ckpt.npz] [n_adapt] [n_test]
"""
import os, sys, json, time, math
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import gen, train, evalapp, hwsynth

REPO = os.environ.get('HW_REPO', '/tmp/claude-0/-home-claude/5f316a34-64ce-52ec-b099-46f9be5b8602/scratchpad/data/handwriting-synthesis')

def writer_hw(hand, rng, style, bias, n):
    """n (strip, text) pairs written by one synthetic writer, rasterized exactly like the app does."""
    out = []
    while len(out) < n:
        texts = [t for t in hwsynth.word_texts(rng, 48, gen) if t.isalpha() or rng.random() < 0.3]
        res = hand.sample(texts, rng, bias=np.full(len(texts), bias, np.float32), style=style)
        for t, (coords, ci) in zip(texts, res):
            if len(coords) < 4 * len(t) or len(coords) > 45 * len(t) + 30: continue
            counts = np.bincount(np.clip(ci, 0, len(t)), minlength=len(t) + 1); need = [i for i, ch in enumerate(t) if ch != ' ']
            if sum(counts[i] >= 2 for i in need) < 0.8 * len(need) or counts[len(t)] > 0.3 * len(coords): continue
            c = hwsynth.smooth(coords.copy()); c = hwsynth.align(c); c[:, 1] *= -1; c[-1, 2] = 1
            strokes = []; start = 0
            for e in np.where(c[:, 2] == 1)[0] + 1:
                s = c[start:e, :2]; start = e
                if len(s): strokes.append(s)
            img = gen.rasterize_app(np.random.default_rng(0), strokes)
            if img is None: continue
            out.append((img, t))
            if len(out) >= n: break
    return out

def writer_font(rng, font, n):
    out = []
    while len(out) < n:
        t = evalapp.realistic_text(rng)
        if not font.supports(t): continue
        try: img = gen.render_text(rng, font, t, int(rng.integers(44, 64)))
        except Exception: continue
        o = gen.augment(rng, img, 52)
        if o is None or o.shape[1] < 6: continue
        out.append((o, t))
    return out

def batchify(samples):
    W = max(gen.bucket_width(im.shape[1]) for im, _ in samples)
    X = np.zeros((len(samples), gen.H, W), np.float32)
    for i, (im, _) in enumerate(samples): X[i, :, :min(W, im.shape[1])] = im[:, :W]
    return X, [[gen.C2I[c] for c in t] for _, t in samples], [t for _, t in samples]

def evaluate(m, samples):
    ok_g = ok_a = 0; ce = 0; cn = 0
    for img, t in samples:
        W = gen.bucket_width(img.shape[1]); xb = np.zeros((1, gen.H, W), np.float32); xb[0, :, :img.shape[1]] = img[:, :W]
        lg = m.forward(xb, train=False)[0]; lg = lg - lg.max(axis=1, keepdims=True); lp = lg - np.log(np.exp(lg).sum(axis=1, keepdims=True))
        g = train.greedy_decode(lg[None])[0]; a = evalapp.app_read(lp)
        ok_g += g == t; ok_a += a.lower() == t.lower(); ce += train.edit_distance(a, t); cn += len(t)
    n = len(samples); return 100 * ok_g / n, 100 * ok_a / n, 100 * ce / cn

def adapt(m, samples, params, epochs=12, lr=2e-3, l2=0.02, bs=8, seed=0):
    """Fine-tunes the given parameter names on the samples (CTC), pulling them back toward their initial values (l2)."""
    rng = np.random.default_rng(seed)
    P0 = {k: m.P[k].copy() for k in params}
    adam = {k: (np.zeros_like(m.P[k]), np.zeros_like(m.P[k])) for k in params}
    step = 0
    for ep in range(epochs):
        order = rng.permutation(len(samples))
        for i in range(0, len(order), bs):
            batch = [samples[j] for j in order[i:i + bs]]
            X, labels, _ = batchify(batch)
            logits = m.forward(X, train=True)
            loss, dl = train.ctc_loss_grad(logits, labels)
            if not np.isfinite(loss): continue
            G = m.backward(dl); step += 1
            for k in params:
                g = G[k] + l2 * (m.P[k] - P0[k])
                mo, vo = adam[k]; mo *= 0.9; mo += 0.1 * g; vo *= 0.999; vo += 0.001 * g * g
                m.P[k] -= (lr * (mo / (1 - 0.9 ** step)) / (np.sqrt(vo / (1 - 0.999 ** step)) + 1e-8)).astype(m.P[k].dtype)
    return m

def main():
    ck = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'ckpt-v2c2-best.npz')
    n_adapt = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    n_test = int(sys.argv[3]) if len(sys.argv) > 3 else 160
    z = np.load(ck); meta = json.loads(str(z['__meta']))
    def fresh():
        m = train.model_from_meta(meta, gen.NCLASS); m.load(ck); return m
    hand = hwsynth.Hand(REPO); rng = np.random.default_rng(11)
    writers = []
    for style, bias in [(2, 1.0), (7, 0.8), (11, 1.2), (4, 0.6)]:
        s = writer_hw(hand, rng, style, bias, n_adapt + n_test); writers.append(('hw style %d bias %.1f' % (style, bias), s[:n_adapt], s[n_adapt:]))
    fs = gen.fonts()
    for name in ['Caveat', 'Kalam', 'IndieFlower', 'HomemadeApple']:
        f = next((f for f in fs if name.lower() in os.path.basename(f.path).lower()), None)
        if f is None: continue
        s = writer_font(rng, f, n_adapt + n_test); writers.append(('font ' + name, s[:n_adapt], s[n_adapt:]))
    configs = json.loads(os.environ['ADAPT_CONFIGS']) if os.environ.get('ADAPT_CONFIGS') else [
               ('dense only', ['ow', 'ob'], dict(epochs=15, lr=3e-3, l2=0.01)),
               ('dense + top BiLSTM', ['ow', 'ob', 'l2fx', 'l2fh', 'l2fb', 'l2bx', 'l2bh', 'l2bb'], dict(epochs=12, lr=1e-3, l2=0.02)),
               ('everything', None, dict(epochs=10, lr=5e-4, l2=0.02))]
    print('model step', meta.get('step'), '| %d adaptation words, %d test words per writer' % (n_adapt, n_test))
    for wname, ad, te in writers:
        m = fresh(); base = evaluate(m, te)
        line = '%-24s base: greedy %.1f%% app %.1f%% CER %.1f%%' % (wname, *base)
        for cname, params, kw in configs:
            m = fresh(); t0 = time.time()
            adapt(m, ad, params or list(m.P.keys()), **kw)
            r = evaluate(m, te)
            line += ' | %s: app %.1f%% CER %.1f%% (%.0fs)' % (cname, r[1], r[2], time.time() - t0)
        print(line, flush=True)

if __name__ == '__main__':
    main()
