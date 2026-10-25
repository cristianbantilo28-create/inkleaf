"""Realistic handwriting strokes from a pretrained Graves-style synthesis network (sjvasquez/handwriting-synthesis,
trained on IAM-OnDB), run in plain numpy from its TensorFlow checkpoint. Used to make pen-like training words for the
Inkleaf CRNN: the network writes any ASCII text in the style of real writers (13 priming styles + random writers).

  python3 hwsynth.py gen  <repo_dir> <out.npz> <n_words> [seed]   # generate words (strokes + text)
  python3 hwsynth.py grid <out.npz> <grid.png>                     # preview

The .npz holds pts (N,3: x, y, pen-up-after-this-point), idx (M+1 offsets into pts) and texts (M strings).
"""
import os, sys, json, time, math
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tfckpt import Checkpoint

ALPHABET = ['\x00', ' ', '!', '"', '#', "'", '(', ')', ',', '-', '.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '?',
            'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'Y',
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
A2N = {c: i for i, c in enumerate(ALPHABET)}
NA = len(ALPHABET)

def sigmoid(x): return 1.0 / (1.0 + np.exp(-x))
def softplus(x): return np.logaddexp(0.0, x)

class Hand:
    def __init__(self, repo):
        ck = Checkpoint(os.path.join(repo, 'checkpoints', 'model-17900'))
        g = lambda n: np.ascontiguousarray(ck.get('rnn/LSTMAttentionCell/' + n).astype(np.float32))
        self.W1, self.b1 = g('lstm_cell/kernel'), g('lstm_cell/bias')
        self.W2, self.b2 = g('lstm_cell_1/kernel'), g('lstm_cell_1/bias')
        self.W3, self.b3 = g('lstm_cell_2/kernel'), g('lstm_cell_2/bias')
        self.Wa, self.ba = g('attention/weights'), g('attention/biases')
        self.Wg = np.ascontiguousarray(ck.get('rnn/gmm/weights').astype(np.float32)); self.bg = ck.get('rnn/gmm/biases').astype(np.float32)
        self.K = 20; self.NU = 400
        self.styles = []
        for i in range(13):
            sp = os.path.join(repo, 'styles', 'style-%d-strokes.npy' % i); cp = os.path.join(repo, 'styles', 'style-%d-chars.npy' % i)
            if os.path.exists(sp) and os.path.exists(cp):
                self.styles.append((np.load(sp).astype(np.float32), np.load(cp).tobytes().decode('utf-8')))
        self._primed = {}

    @staticmethod
    def lstm(inp, h, c, W, b):
        m = np.concatenate([inp, h], 1) @ W + b          # TF LSTMCell: [x, h_prev] @ kernel, gates i, j, f, o
        n = h.shape[1]
        i, j, f, o = m[:, :n], m[:, n:2 * n], m[:, 2 * n:3 * n], m[:, 3 * n:]
        c2 = sigmoid(f + 1.0) * c + sigmoid(i) * np.tanh(j)
        h2 = sigmoid(o) * np.tanh(c2)
        return h2, c2

    def zero_state(self, B):
        z = lambda n: np.zeros((B, n), np.float32)
        return {'h1': z(400), 'c1': z(400), 'h2': z(400), 'c2': z(400), 'h3': z(400), 'c3': z(400), 'kappa': z(10), 'w': z(NA)}

    def step(self, x, st, C, mask):
        """x (B,3) input offsets; C (B,L,NA) one-hot chars; mask (B,L). Returns new state and phi (B,L)."""
        h1, c1 = self.lstm(np.concatenate([st['w'], x], 1), st['h1'], st['c1'], self.W1, self.b1)
        att = softplus(np.concatenate([st['w'], x, h1], 1) @ self.Wa + self.ba)
        alpha, beta, kappa = att[:, :10], att[:, 10:20], att[:, 20:]
        kappa = st['kappa'] + kappa / 25.0
        beta = np.maximum(beta, 0.01)
        u = np.arange(C.shape[1], dtype=np.float32)[None, None, :]
        phi = (alpha[:, :, None] * np.exp(-np.square(kappa[:, :, None] - u) / beta[:, :, None])).sum(1)   # (B,L)
        w = ((phi * mask)[:, :, None] * C).sum(1)
        h2, c2 = self.lstm(np.concatenate([x, h1, w], 1), st['h2'], st['c2'], self.W2, self.b2)
        h3, c3 = self.lstm(np.concatenate([x, h2, w], 1), st['h3'], st['c3'], self.W3, self.b3)
        return {'h1': h1, 'c1': c1, 'h2': h2, 'c2': c2, 'h3': h3, 'c3': c3, 'kappa': kappa, 'w': w}, phi

    def output(self, st, bias, rng):
        """Samples the next offset (dx, dy, eos) from the mixture density head."""
        B = st['h3'].shape[0]; K = self.K
        p = st['h3'] @ self.Wg + self.bg
        pis, sig, rho, mu, e = p[:, :K], p[:, K:3 * K], p[:, 3 * K:4 * K], p[:, 4 * K:6 * K], p[:, 6 * K]
        pis = pis * (1 + bias[:, None]); sig = sig - bias[:, None]
        pis = np.exp(pis - pis.max(1, keepdims=True)); pis /= pis.sum(1, keepdims=True); pis[pis < 0.01] = 0; pis /= pis.sum(1, keepdims=True)
        sig = np.maximum(np.exp(sig), 1e-4); rho = np.clip(np.tanh(rho), -1 + 1e-8, 1 - 1e-8)
        es = sigmoid(e); es[es < 0.01] = 0
        cum = np.cumsum(pis, 1); r = rng.random((B, 1)); idx = np.minimum((cum < r).sum(1), K - 1)
        ar = np.arange(B)
        m1, m2 = mu[ar, idx], mu[ar, K + idx]; s1, s2 = sig[ar, idx], sig[ar, K + idx]; rh = rho[ar, idx]
        z1, z2 = rng.standard_normal(B), rng.standard_normal(B)
        x = m1 + s1 * z1; y = m2 + s2 * (rh * z1 + np.sqrt(1 - rh * rh) * z2)
        eos = (rng.random(B) < es).astype(np.float32)
        return np.stack([x, y, eos], 1).astype(np.float32)

    def encode(self, texts):
        L = max(len(t) for t in texts) + 1
        C = np.zeros((len(texts), L, NA), np.float32); mask = np.zeros((len(texts), L), np.float32); clen = np.zeros(len(texts), np.int32)
        for i, t in enumerate(texts):
            ids = [A2N.get(ch, 0) for ch in t] + [0]
            C[i, np.arange(len(ids)), ids] = 1; mask[i, :len(ids)] = 1; clen[i] = len(ids)
        return C, mask, clen

    def primed_state(self, style, text_hint):
        """Runs the style's real strokes through the network once (cached), so sampling continues in that handwriting."""
        if style in self._primed: return self._primed[style]
        x_p, c_p = self.styles[style]
        C, mask, clen = self.encode([c_p + ' ' + text_hint])
        st = self.zero_state(1)
        for t in range(len(x_p)):
            st, _ = self.step(x_p[t:t + 1], st, C, mask)
        self._primed[style] = (st, len(c_p) + 1)
        return self._primed[style]

    def sample(self, texts, rng, bias=None, style=None, max_factor=40):
        """Writes each text. Returns a list of (points (n,3) offsets→coords done, char_index per point) per text."""
        B = len(texts)
        bias = np.full(B, 0.75, np.float32) if bias is None else np.asarray(bias, np.float32)
        if style is None:
            C, mask, clen = self.encode(texts); st = self.zero_state(B); offset = 0
            x = np.tile(np.array([[0, 0, 1]], np.float32), (B, 1)); first = x.copy(); emit_first = True
        else:
            pst, offset = self.primed_state(style, texts[0])
            _, c_p = self.styles[style]
            C, mask, clen = self.encode([c_p + ' ' + t for t in texts])
            st = {k: np.repeat(v, B, 0) for k, v in pst.items()}
            x = self.output(st, bias, rng); emit_first = False
        steps = max_factor * max(len(t) for t in texts)
        out = [[] for _ in range(B)]; chars = [[] for _ in range(B)]
        done = np.zeros(B, bool)
        if emit_first:
            for i in range(B): out[i].append(first[i]); chars[i].append(0)
        for t in range(steps):
            st, phi = self.step(x, st, C, mask)
            ci = phi.argmax(1)
            x = self.output(st, bias, rng)
            for i in range(B):
                if done[i]: continue
                if ci[i] >= clen[i]: done[i] = True; continue
                out[i].append(x[i]); chars[i].append(ci[i] - offset)
                if ci[i] >= clen[i] - 1 and x[i, 2] == 1: done[i] = True
            if done.all(): break
        res = []
        for i in range(B):
            o = np.array(out[i], np.float32) if out[i] else np.zeros((0, 3), np.float32)
            coords = np.concatenate([np.cumsum(o[:, :2], 0), o[:, 2:3]], 1) if len(o) else o
            res.append((coords, np.array(chars[i], np.int32)))
        return res

# ---------------------------------------------------------------- post-processing
def align(coords):
    """Removes global slope (least squares) like the reference implementation; y up → flipped to image coords later."""
    if len(coords) < 3: return coords
    X = np.stack([np.ones(len(coords)), coords[:, 0]], 1); y = coords[:, 1]
    try: off, slope = np.linalg.lstsq(X, y, rcond=None)[0]
    except Exception: return coords
    th = math.atan(slope); R = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    c = coords.copy(); c[:, :2] = coords[:, :2] @ R; c[:, 1] -= off
    return c

def smooth(coords):
    """Savitzky-Golay-like smoothing per stroke (window 7, cubic) to take the sampling jitter off."""
    from scipy.signal import savgol_filter
    out = []; start = 0
    ends = list(np.where(coords[:, 2] == 1)[0] + 1)
    if not ends or ends[-1] != len(coords): ends.append(len(coords))
    for e in ends:
        s = coords[start:e]; start = e
        if len(s) == 0: continue
        if len(s) >= 7:
            s = s.copy(); s[:, 0] = savgol_filter(s[:, 0], 7, 3, mode='nearest'); s[:, 1] = savgol_filter(s[:, 1], 7, 3, mode='nearest')
        out.append(s)
    return np.concatenate(out, 0) if out else coords

def valid_text(t):
    return all(ch in A2N for ch in t) and any(ch.isalnum() for ch in t)

def word_texts(rng, n, gen):
    """Texts for the generator: words from the app's own pools (ASCII only), numbers and codes the network can write."""
    out = []
    while len(out) < n:
        r = rng.random()
        if r < 0.54: t = gen.pick_word(rng, 'en')
        elif r < 0.74: t = gen.pick_word(rng, 'de')
        elif r < 0.85: t = gen.pick_word(rng, 'es')
        elif r < 0.93: t = gen.pick_word(rng, 'extra')
        elif r < 0.985: t = gen.random_number(rng)      # the network is weak on digits; most numbers come from the other renderers
        else: t = gen.random_code(rng)
        c = rng.random()
        if t.isalpha():
            if c < 0.25: t = t[:1].upper() + t[1:]
            elif c < 0.30: t = t.upper()
        p = rng.random()
        if p < 0.08: t = t + rng.choice(['.', ',', '!', '?', ':', ';'])
        elif p < 0.10: t = '"' + t + '"'
        elif p < 0.12: t = '(' + t + ')'
        elif p < 0.14 and t.isalpha(): t = t + "'s"
        if rng.random() < float(os.environ.get('HW_PHRASE_SHARE', 0.0)) and t.isalpha():   # short phrases: joined-up writing across a space
            t2 = gen.pick_word(rng, 'en' if rng.random() < 0.7 else 'de')
            if valid_text(t2) and len(t) + 1 + len(t2) <= 16: t = t + ' ' + t2
        if not valid_text(t) or len(t) > 16: continue
        out.append(t)
    return out

def generate(repo, out_path, n_words, seed=1, B=96, log=print):
    import gen
    hand = Hand(repo); rng = np.random.default_rng(seed)
    pts = []; idx = [0]; texts = []; t0 = time.time(); nb = 0
    while len(texts) < n_words:
        batch = word_texts(rng, B, gen)
        use_style = rng.random() < 0.45 and hand.styles
        style = int(rng.integers(0, len(hand.styles))) if use_style else None
        bias = rng.uniform(float(os.environ.get('HW_BIAS_LO', 0.4)), float(os.environ.get('HW_BIAS_HI', 1.8)), B).astype(np.float32)
        res = hand.sample(batch, rng, bias=bias, style=style)
        for t, (coords, ci) in zip(batch, res):
            if len(coords) < 4 * len(t) or len(coords) > 45 * len(t) + 30: continue   # gave up / collapsed / ran on
            # the attention window says which character each point belongs to: every letter should have got some ink
            counts = np.bincount(np.clip(ci, 0, len(t)), minlength=len(t) + 1)
            need = [i for i, ch in enumerate(t) if ch != ' ']
            if sum(counts[i] >= 2 for i in need) < 0.8 * len(need) or counts[len(t)] > 0.3 * len(coords): continue
            coords = coords.copy()
            c = smooth(coords); c = align(c); c[:, 1] *= -1           # image coords: y down
            c[:, 2] = coords[:, 2] if len(c) == len(coords) else c[:, 2]
            c[-1, 2] = 1
            w = c[:, 0].max() - c[:, 0].min(); h = c[:, 1].max() - c[:, 1].min()
            if h < 1e-3 or w < 1e-3 or w / h > 30 or h / w > 6: continue
            pts.append(c.astype(np.float32)); idx.append(idx[-1] + len(c)); texts.append(t)
        nb += 1
        if nb % 5 == 0: log('%d words, %.0fs, %.1f words/s' % (len(texts), time.time() - t0, len(texts) / (time.time() - t0)))
        if nb % 20 == 0: _save(out_path, pts, idx, texts)
    _save(out_path, pts, idx, texts)
    log('done: %d words in %.0fs' % (len(texts), time.time() - t0))

def _save(out_path, pts, idx, texts):
    np.savez_compressed(out_path, pts=np.concatenate(pts, 0) if pts else np.zeros((0, 3), np.float32), idx=np.array(idx, np.int64), texts=np.array(texts, dtype=object).astype(str))

def load(path):
    z = np.load(path, allow_pickle=False)
    return z['pts'], z['idx'], [str(t) for t in z['texts']]

def strokes_of(pts, idx, i):
    """Word i as a list of (n,2) stroke arrays."""
    c = pts[idx[i]:idx[i + 1]]
    out = []; start = 0
    for e in np.where(c[:, 2] == 1)[0] + 1:
        s = c[start:e, :2]; start = e
        if len(s): out.append(s)
    if start < len(c): out.append(c[start:, :2])
    return out

def grid(npz, png, n=48, seed=3):
    import cv2
    pts, idx, texts = load(npz); rng = np.random.default_rng(seed)
    sel = rng.choice(len(texts), min(n, len(texts)), replace=False)
    cell_w, cell_h = 360, 90; cols = 4; rows = (len(sel) + cols - 1) // cols
    canvas = np.full((rows * cell_h, cols * cell_w), 255, np.uint8)
    for k, i in enumerate(sel):
        strokes = strokes_of(pts, idx, i)
        allp = np.concatenate(strokes, 0); mn = allp.min(0); mx = allp.max(0)
        sc = min((cell_w - 20) / max(1e-3, mx[0] - mn[0]), (cell_h - 30) / max(1e-3, mx[1] - mn[1]))
        ox = (k % cols) * cell_w + 10; oy = (k // cols) * cell_h + 8
        for s in strokes:
            p = ((s - mn) * sc + [ox, oy]).astype(np.int32).reshape(-1, 1, 2)
            cv2.polylines(canvas, [p], False, 0, 2, cv2.LINE_AA)
        cv2.putText(canvas, texts[i], (ox, oy + cell_h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, 128, 1, cv2.LINE_AA)
    cv2.imwrite(png, canvas)

if __name__ == '__main__':
    if sys.argv[1] == 'gen':
        generate(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]) if len(sys.argv) > 5 else 1)
    elif sys.argv[1] == 'grid':
        grid(sys.argv[2], sys.argv[3])
