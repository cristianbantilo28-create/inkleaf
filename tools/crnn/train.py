"""Trains the Inkleaf CRNN (CNN + bidirectional LSTM + CTC) in plain numpy with hand-written backprop.

Layout is NHWC. Model:
  conv3x3(1→16) relu pool2x2 → conv3x3(16→32) relu pool2x2 → conv3x3(32→64) relu pool(2,1) → conv3x3(64→64) relu pool(2,1)
  → columns of 2*64=128 features per time step (T = W/4) → BiLSTM(96) → linear(192→classes) → CTC.

  python3 train.py gradcheck           numerical gradient check on a tiny model
  python3 train.py train [steps]       train (resumes from ckpt.npz when present)
"""
import os, sys, time, json, math
import numpy as np
import multiprocessing as mp

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen

OUT = os.environ.get('CRNN_OUT', os.path.join(HERE, 'out'))
os.makedirs(OUT, exist_ok=True)
DT = np.float32

# ------------------------------------------------------------------ layers
def conv_fwd(x, W, b):
    """x (B,H,Wd,C) → (B,H,Wd,O), 3x3, pad 1. Keeps cols for backward."""
    B, Hh, Wd, C = x.shape
    xp = np.pad(x, ((0, 0), (1, 1), (1, 1), (0, 0)))
    cols = np.empty((B, Hh, Wd, 9, C), x.dtype)
    k = 0
    for dy in range(3):
        for dx in range(3):
            cols[:, :, :, k, :] = xp[:, dy:dy + Hh, dx:dx + Wd, :]; k += 1
    flat = cols.reshape(B * Hh * Wd, 9 * C)
    out = (flat @ W + b).reshape(B, Hh, Wd, -1)
    return out, (flat, x.shape)

def conv_bwd(dout, W, cache):
    flat, xshape = cache
    B, Hh, Wd, C = xshape
    d = dout.reshape(B * Hh * Wd, -1)
    dW = flat.T @ d
    db = d.sum(0)
    dcols = (d @ W.T).reshape(B, Hh, Wd, 9, C)
    dxp = np.zeros((B, Hh + 2, Wd + 2, C), dout.dtype)
    k = 0
    for dy in range(3):
        for dx in range(3):
            dxp[:, dy:dy + Hh, dx:dx + Wd, :] += dcols[:, :, :, k, :]; k += 1
    return dxp[:, 1:-1, 1:-1, :], dW, db

def relu_fwd(x):
    m = x > 0
    return x * m, m

def relu_bwd(d, m): return d * m

def pool_fwd(x, ph, pw):
    B, Hh, Wd, C = x.shape
    r = x.reshape(B, Hh // ph, ph, Wd // pw, pw, C)
    out = r.max(axis=(2, 4))
    mask = (r == out[:, :, None, :, None, :])
    # break ties: keep only the first max in each window
    cnt = mask.sum(axis=(2, 4), keepdims=True)
    return out, (mask, cnt, x.shape, ph, pw)

def pool_bwd(d, cache):
    mask, cnt, shape, ph, pw = cache
    B, Hh, Wd, C = shape
    dr = (mask * (d[:, :, None, :, None, :] / cnt))
    return dr.reshape(shape)

def sigmoid(z): return 1 / (1 + np.exp(-z))

def lstm_fwd(x, Wx, Wh, b, reverse):
    """x (B,T,F) → h (B,T,H)."""
    B, T, F = x.shape; Hn = Wh.shape[0]
    pre = (x.reshape(B * T, F) @ Wx + b).reshape(B, T, 4 * Hn)
    h = np.zeros((B, Hn), x.dtype); c = np.zeros((B, Hn), x.dtype)
    hs = np.zeros((B, T, Hn), x.dtype); st = []
    order = range(T - 1, -1, -1) if reverse else range(T)
    for t in order:
        g = pre[:, t] + h @ Wh
        i = sigmoid(g[:, :Hn]); f = sigmoid(g[:, Hn:2 * Hn]); o = sigmoid(g[:, 2 * Hn:3 * Hn]); u = np.tanh(g[:, 3 * Hn:])
        cprev = c
        c = f * c + i * u
        tc = np.tanh(c)
        h = o * tc
        hs[:, t] = h
        st.append((t, i, f, o, u, cprev, tc, h))
    return hs, (x, pre, st, Wx, Wh, reverse)

def lstm_bwd(dh_all, cache):
    x, pre, st, Wx, Wh, reverse = cache
    B, T, F = x.shape; Hn = Wh.shape[0]
    dWx = np.zeros_like(Wx); dWh = np.zeros_like(Wh); db = np.zeros(4 * Hn, x.dtype)
    dpre = np.zeros((B, T, 4 * Hn), x.dtype)
    dh_next = np.zeros((B, Hn), x.dtype); dc_next = np.zeros((B, Hn), x.dtype)
    for (t, i, f, o, u, cprev, tc, h) in reversed(st):
        dh = dh_all[:, t] + dh_next
        do = dh * tc
        dc = dh * o * (1 - tc * tc) + dc_next
        di = dc * u; df = dc * cprev; du = dc * i
        dg = np.concatenate([di * i * (1 - i), df * f * (1 - f), do * o * (1 - o), du * (1 - u * u)], axis=1)
        dpre[:, t] = dg
        dh_next = dg @ Wh.T
        dc_next = dc * f
    # dWh = sum_t hprev_t^T dg_t, where hprev is the output of the previously processed step
    hs_prev = np.zeros((B, T, Hn), x.dtype)
    prev = np.zeros((B, Hn), x.dtype)
    for (t, i, f, o, u, cprev, tc, h) in st:
        hs_prev[:, t] = prev; prev = h
    dWh = hs_prev.reshape(B * T, Hn).T @ dpre.reshape(B * T, 4 * Hn)
    dWx = x.reshape(B * T, F).T @ dpre.reshape(B * T, 4 * Hn)
    db = dpre.reshape(B * T, 4 * Hn).sum(0)
    dx = (dpre.reshape(B * T, 4 * Hn) @ Wx.T).reshape(B, T, F)
    return dx, dWx, dWh, db

def logsumexp(a, axis):
    m = a.max(axis=axis, keepdims=True)
    m = np.where(np.isfinite(m), m, 0)
    return (m + np.log(np.exp(a - m).sum(axis=axis, keepdims=True))).squeeze(axis)

def ctc_loss_grad(logits, labels):
    """logits (B,T,C) float; labels: list of int lists. Returns (mean loss, dlogits (B,T,C))."""
    with np.errstate(divide='ignore', invalid='ignore'):
        return _ctc_loss_grad(logits, labels)

def _ctc_loss_grad(logits, labels):
    B, T, C = logits.shape
    x = logits.astype(np.float64)
    x = x - x.max(axis=2, keepdims=True)
    logp = x - np.log(np.exp(x).sum(axis=2, keepdims=True))
    L = max(len(l) for l in labels); S = 2 * L + 1
    ext = np.zeros((B, S), np.int64)       # extended label with blanks
    Slen = np.zeros(B, np.int64)
    for bi, l in enumerate(labels):
        ext[bi, 1:2 * len(l) + 1:2] = l
        Slen[bi] = 2 * len(l) + 1
    NEG = -1e30
    # emission log-probs per (t, b, s)
    bidx = np.arange(B)[:, None]
    em = logp[:, :, ext]                                      # (B,T,B,S)? avoid: gather per batch
    em = np.stack([logp[bi][:, ext[bi]] for bi in range(B)], axis=1)  # (T,B,S)
    svalid = (np.arange(S)[None, :] < Slen[:, None])          # (B,S)
    # skip transitions allowed where ext[s] != blank and ext[s] != ext[s-2]
    skip = np.zeros((B, S), bool)
    skip[:, 2:] = (ext[:, 2:] != 0) & (ext[:, 2:] != ext[:, :-2])
    alpha = np.full((T, B, S), NEG)
    alpha[0, :, 0] = em[0, :, 0]
    alpha[0, :, 1] = np.where(Slen > 1, em[0, :, 1], NEG)
    for t in range(1, T):
        a = alpha[t - 1]
        a1 = np.concatenate([np.full((B, 1), NEG), a[:, :-1]], axis=1)
        a2 = np.concatenate([np.full((B, 2), NEG), a[:, :-2]], axis=1)
        a2 = np.where(skip, a2, NEG)
        m = np.maximum(np.maximum(a, a1), a2)
        m2 = np.where(m > NEG / 2, m, 0)
        s = m2 + np.log(np.exp(a - m2) + np.exp(a1 - m2) + np.exp(a2 - m2))
        alpha[t] = np.where(svalid, s + em[t], NEG)
    # log-likelihood: last two states
    last = alpha[T - 1, bidx[:, 0], Slen - 1]
    last2 = np.where(Slen > 1, alpha[T - 1, bidx[:, 0], np.maximum(Slen - 2, 0)], NEG)
    ll = np.logaddexp(last, last2)
    beta = np.full((T, B, S), NEG)
    beta[T - 1, bidx[:, 0], Slen - 1] = em[T - 1, bidx[:, 0], Slen - 1]
    idx2 = np.maximum(Slen - 2, 0)
    beta[T - 1, bidx[:, 0], idx2] = np.where(Slen > 1, em[T - 1, bidx[:, 0], idx2], beta[T - 1, bidx[:, 0], idx2])
    for t in range(T - 2, -1, -1):
        bnext = beta[t + 1]
        b1 = np.concatenate([bnext[:, 1:], np.full((B, 1), NEG)], axis=1)
        # skip forward: from s to s+2 allowed if skip[s+2]
        b2 = np.concatenate([bnext[:, 2:], np.full((B, 2), NEG)], axis=1)
        skip_fwd = np.concatenate([skip[:, 2:], np.zeros((B, 2), bool)], axis=1)
        b2 = np.where(skip_fwd, b2, NEG)
        m = np.maximum(np.maximum(bnext, b1), b2)
        m2 = np.where(m > NEG / 2, m, 0)
        s = m2 + np.log(np.exp(bnext - m2) + np.exp(b1 - m2) + np.exp(b2 - m2))
        beta[t] = np.where(svalid, s + em[t], NEG)
    # posterior over states: alpha*beta / em  (em counted twice)
    post = alpha + beta - em - ll[None, :, None]        # (T,B,S) log
    post = np.where(svalid[None], post, NEG)
    gamma = np.exp(post)                                 # (T,B,S)
    # accumulate per class
    grad = np.exp(logp)                                  # softmax (B,T,C)
    acc = np.zeros((B, T, C))
    for bi in range(B):
        np.add.at(acc[bi], (slice(None), ext[bi, :Slen[bi]]), gamma[:, bi, :Slen[bi]])
    grad = grad - acc
    loss = -ll.mean()
    return loss, (grad / B).astype(logits.dtype)

# ------------------------------------------------------------------ model
POOLS_V1 = ((2, 2), (2, 2), (2, 1), (2, 1))
POOLS_V2 = ((2, 2), (2, 1), (2, 1), (2, 1))          # keeps the horizontal resolution at W/2 so narrow letters get their own frames

def lstm_names(k):
    """parameter name prefix of BiLSTM layer k: layer 0 keeps the original names (lfx, lbx, …), layer 1 is l2fx, … """
    return 'l' if k == 0 else 'l%d' % (k + 1)

class CRNN:
    def __init__(self, nclass, Hn=128, chans=(16, 32, 64, 64), layers=2, pools=POOLS_V2, dropout=0.2, seed=0, dtype=DT):
        rng = np.random.default_rng(seed)
        self.dtype = dtype; self.Hn = Hn; self.chans = chans; self.nclass = nclass; self.layers = layers; self.pools = tuple(tuple(p) for p in pools); self.dropout = dropout
        self.rng = np.random.default_rng(seed + 1)
        P = {}
        cin = 1
        for i, co in enumerate(chans):
            P['c%dw' % i] = (rng.normal(0, math.sqrt(2 / (9 * cin)), (9 * cin, co))).astype(dtype)
            P['c%db' % i] = np.zeros(co, dtype)
            cin = co
        hrows = 32
        for ph, pw in self.pools: hrows //= ph
        F = chans[-1] * hrows
        for k in range(layers):
            Fk = F if k == 0 else 2 * Hn; pre = lstm_names(k)
            for d in ('f', 'b'):
                P['%s%sx' % (pre, d)] = (rng.uniform(-1, 1, (Fk, 4 * Hn)) * math.sqrt(6 / (Fk + 4 * Hn))).astype(dtype)
                P['%s%sh' % (pre, d)] = (rng.uniform(-1, 1, (Hn, 4 * Hn)) * math.sqrt(6 / (Hn + 4 * Hn))).astype(dtype)
                bb = np.zeros(4 * Hn, dtype); bb[Hn:2 * Hn] = 1.0  # forget gate bias
                P['%s%sb' % (pre, d)] = bb
        P['ow'] = (rng.uniform(-1, 1, (2 * Hn, nclass)) * math.sqrt(6 / (2 * Hn + nclass))).astype(dtype)
        P['ob'] = np.zeros(nclass, dtype)
        self.P = P

    def forward(self, X, train=True):
        """X (B,32,W) → logits (B,T,C). Keeps caches when train."""
        P = self.P; cache = {}
        x = X[..., None].astype(self.dtype)
        for i in range(4):
            x, cache['c%d' % i] = conv_fwd(x, P['c%dw' % i], P['c%db' % i])
            x, cache['r%d' % i] = relu_fwd(x)
            x, cache['p%d' % i] = pool_fwd(x, *self.pools[i])
        B, Hh, T, C = x.shape
        h = x.transpose(0, 2, 1, 3).reshape(B, T, Hh * C)
        cache['featshape'] = (B, Hh, T, C); cache['masks'] = []
        for k in range(self.layers):
            pre = lstm_names(k)
            hf, cache[pre + 'f'] = lstm_fwd(h, P[pre + 'fx'], P[pre + 'fh'], P[pre + 'fb'], False)
            hb, cache[pre + 'b'] = lstm_fwd(h, P[pre + 'bx'], P[pre + 'bh'], P[pre + 'bb'], True)
            h = np.concatenate([hf, hb], axis=2)
            if train and self.dropout > 0 and k < self.layers - 1:         # sequence dropout between the LSTM layers
                m = (self.rng.random(h.shape) >= self.dropout).astype(self.dtype) / (1 - self.dropout); h = h * m; cache['masks'].append(m)
        cache['h'] = h
        logits = h.reshape(B * T, -1) @ P['ow'] + P['ob']
        self.cache = cache if train else None
        return logits.reshape(B, T, -1)

    def backward(self, dlogits):
        P = self.P; cache = self.cache; G = {}
        B, T, C = dlogits.shape
        d = dlogits.reshape(B * T, C)
        h = cache['h']; Hn = self.Hn
        G['ow'] = h.reshape(B * T, -1).T @ d; G['ob'] = d.sum(0)
        dh = (d @ P['ow'].T).reshape(B, T, 2 * Hn)
        for k in range(self.layers - 1, -1, -1):
            pre = lstm_names(k)
            if k < self.layers - 1 and cache['masks']: dh = dh * cache['masks'][k]
            din_f, G[pre + 'fx'], G[pre + 'fh'], G[pre + 'fb'] = lstm_bwd(dh[:, :, :Hn], cache[pre + 'f'])
            din_b, G[pre + 'bx'], G[pre + 'bh'], G[pre + 'bb'] = lstm_bwd(dh[:, :, Hn:], cache[pre + 'b'])
            dh = din_f + din_b
        Bq, Hh, Tq, Cq = cache['featshape']
        dx = dh.reshape(B, T, Hh, Cq).transpose(0, 2, 1, 3)
        for i in range(3, -1, -1):
            dx = pool_bwd(dx, cache['p%d' % i])
            dx = relu_bwd(dx, cache['r%d' % i])
            dx, G['c%dw' % i], G['c%db' % i] = conv_bwd(dx, P['c%dw' % i], cache['c%d' % i])
        self.cache = None
        return G

    def save(self, path, meta):
        meta = dict(meta); meta.update({'Hn': self.Hn, 'chans': list(self.chans), 'layers': self.layers, 'pools': [list(p) for p in self.pools]})
        np.savez(path, **{k: v for k, v in self.P.items()}, __meta=json.dumps(meta))

    def load(self, path, partial=False):
        """loads a checkpoint; partial=True copies every tensor whose name and shape match (warm start from an older model)"""
        z = np.load(path); n = 0
        for k in self.P:
            if k in z.files and (not partial or z[k].shape == self.P[k].shape): self.P[k] = z[k].astype(self.dtype); n += 1
            elif not partial: raise KeyError(k)
        meta = json.loads(str(z['__meta'])); meta['_loaded'] = n
        return meta

def model_from_meta(meta, nclass):
    return CRNN(nclass, Hn=meta.get('Hn', 128), chans=tuple(meta.get('chans', (16, 32, 64, 64))), layers=meta.get('layers', 1), pools=tuple(tuple(p) for p in meta.get('pools', POOLS_V1)), dropout=0.0)

def greedy_decode(logits):
    out = []
    for row in logits.argmax(axis=2):
        s = []; prev = 0
        for k in row:
            if k != prev and k != 0: s.append(gen.CHARS[k - 1])
            prev = k
        out.append(''.join(s))
    return out

def edit_distance(a, b):
    dp = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, dp[0] = dp[0], i
        for j, cb in enumerate(b, 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (ca != cb))
            prev = cur
    return dp[len(b)]

# ------------------------------------------------------------------ gradient check
def gradcheck():
    global DT
    np.random.seed(0)
    m = CRNN(nclass=7, Hn=5, chans=(2, 3, 3, 4), layers=2, dropout=0.0, seed=1, dtype=np.float64)
    X = np.random.rand(2, 32, 32).astype(np.float64)
    labels = [[1, 2, 2], [3, 1]]
    def loss_of():
        lg = m.forward(X); l, _ = ctc_loss_grad(lg, labels); return l
    lg = m.forward(X); loss, dl = ctc_loss_grad(lg, labels); G = m.backward(dl)
    print('loss', loss)
    worst = 0
    for k in ['ow', 'ob', 'l2fx', 'l2bh', 'l2fb', 'lfx', 'lfh', 'lfb', 'lbx', 'lbh', 'lbb', 'c3w', 'c3b', 'c2w', 'c1w', 'c0w', 'c0b']:
        p = m.P[k]; g = G[k]
        for _ in range(4):
            idx = tuple(np.random.randint(0, s) for s in p.shape)
            old = p[idx]; eps = 1e-5
            p[idx] = old + eps; lp = loss_of(); p[idx] = old - eps; lm = loss_of(); p[idx] = old
            num = (lp - lm) / (2 * eps); ana = g[idx]
            rel = abs(num - ana) / max(1e-8, abs(num) + abs(ana))
            worst = max(worst, rel)
            if rel > 1e-4: print('  MISMATCH', k, idx, num, ana, rel)
    print('worst relative error', worst)

# ------------------------------------------------------------------ data producer
def producer(q, seed, batch):
    rng = np.random.default_rng(seed)
    gen.fonts()
    pools = {}
    while True:
        im, t = gen.make_sample(rng)
        if im is None: continue
        w = gen.bucket_width(im.shape[1])
        pools.setdefault(w, []).append((im, t))
        if len(pools[w]) >= batch:
            items = pools[w]; pools[w] = []
            X = np.zeros((batch, gen.H, w), np.float32); labels = []; texts = []
            for i, (img, tx) in enumerate(items):
                ww = min(img.shape[1], w)
                off = int(rng.integers(0, w - ww + 1)) if rng.random() < 0.5 else 0
                X[i, :, off:off + ww] = img[:, :ww]
                labels.append([gen.C2I[c] for c in tx]); texts.append(tx)
            q.put((X, labels, texts))

def eval_batches(seed=12345, n=6):
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        out.append(gen.make_batch(rng, 32, width=None))
    return out

def train(steps):
    nclass = gen.NCLASS
    chans = tuple(int(c) for c in os.environ.get('CRNN_CHANS', '16,32,64,64').split(','))
    m = CRNN(nclass, Hn=int(os.environ.get('CRNN_HN', 128)), chans=chans, layers=int(os.environ.get('CRNN_LAYERS', 2)), pools=POOLS_V2 if os.environ.get('CRNN_POOLS', 'v2') == 'v2' else POOLS_V1, dropout=float(os.environ.get('CRNN_DROPOUT', 0.2)))
    ck = os.path.join(OUT, 'ckpt.npz')
    step0 = 0; adam = {}
    init = os.environ.get('CRNN_INIT')
    if init and os.path.exists(init) and not os.path.exists(ck):
        meta = m.load(init, partial=True); print('warm start from', init, '-', meta['_loaded'], 'tensors copied', flush=True)
    elif os.path.exists(ck):
        meta = m.load(ck); step0 = meta.get('step', 0)
        if os.path.exists(os.path.join(OUT, 'adam.npz')):
            z = np.load(os.path.join(OUT, 'adam.npz')); adam = {k: z[k] for k in z.files}
        print('resumed from step', step0, flush=True)
    for k, v in m.P.items():
        adam.setdefault('m_' + k, np.zeros_like(v)); adam.setdefault('v_' + k, np.zeros_like(v))
    batch = int(os.environ.get('CRNN_BATCH', 32))
    q = mp.Queue(maxsize=24)
    procs = [mp.Process(target=producer, args=(q, 1000 + i + step0, batch), daemon=True) for i in range(int(os.environ.get('CRNN_WORKERS', 1)))]
    for p in procs: p.start()
    evals = eval_batches(n=10)
    lr0 = float(os.environ.get('CRNN_LR', 1e-3)); warm = int(os.environ.get('CRNN_WARM', 300)); total = int(os.environ.get('CRNN_TOTAL', 14000)); wd = float(os.environ.get('CRNN_WD', 1e-4))
    b1, b2, eps = 0.9, 0.999, 1e-8
    t0 = time.time(); losses = []; best_cer = 1.0
    if os.path.exists(os.path.join(OUT, 'best.npz')):
        try: best_cer = json.loads(str(np.load(os.path.join(OUT, 'best.npz'))['__meta'])).get('cer', 1.0)
        except Exception: pass
    log = open(os.path.join(OUT, 'train.log'), 'a')
    for step in range(step0 + 1, step0 + steps + 1):
        X, labels, texts = q.get()
        lr = lr0 * min(1.0, step / warm) * (0.5 * (1 + math.cos(math.pi * min(1.0, step / total))) * 0.99 + 0.01)   # warm-up, then cosine down to 1% (one-cycle)
        logits = m.forward(X)
        loss, dl = ctc_loss_grad(logits, labels)
        if not np.isfinite(loss):
            print('non-finite loss, skipping batch', flush=True); continue
        G = m.backward(dl)
        gn = math.sqrt(sum(float((g.astype(np.float64) ** 2).sum()) for g in G.values()))
        clip = 5.0; sc = min(1.0, clip / (gn + 1e-6))
        for k, v in m.P.items():
            g = G[k] * sc
            adam['m_' + k] = b1 * adam['m_' + k] + (1 - b1) * g
            adam['v_' + k] = b2 * adam['v_' + k] + (1 - b2) * g * g
            mh = adam['m_' + k] / (1 - b1 ** step); vh = adam['v_' + k] / (1 - b2 ** step)
            v -= (lr * mh / (np.sqrt(vh) + eps)).astype(v.dtype)
            if v.ndim == 2 and wd: v -= (lr * wd * v).astype(v.dtype)          # decoupled weight decay (AdamW) on the weight matrices
        losses.append(loss)
        if step % 25 == 0:
            msg = 'step %d loss %.3f gn %.2f lr %.5f W %d  %.2fs/step' % (step, float(np.mean(losses[-25:])), gn, lr, X.shape[2], (time.time() - t0) / 25)
            print(msg, flush=True); log.write(msg + '\n'); log.flush(); t0 = time.time()
        if step % 250 == 0 or step == step0 + steps:
            tot = 0; ok = 0; ce = 0; cn = 0; shown = []
            for (Xe, le, te) in evals:
                pred = greedy_decode(m.forward(Xe, train=False))
                for pz, tz in zip(pred, te):
                    tot += 1; ok += pz == tz; ce += edit_distance(pz, tz); cn += len(tz)
                    if len(shown) < 6: shown.append('%s→%s' % (tz, pz))
            msg = 'EVAL step %d word acc %.1f%% CER %.1f%%  %s' % (step, 100 * ok / tot, 100 * ce / cn, ' | '.join(shown))
            print(msg, flush=True); log.write(msg + '\n'); log.flush()
            m.save(ck, {'step': step, 'chars': gen.CHARS, 'wacc': ok / tot, 'cer': ce / cn})
            np.savez(os.path.join(OUT, 'adam.npz'), **adam)
            if ce / cn < best_cer: best_cer = ce / cn; m.save(os.path.join(OUT, 'best.npz'), {'step': step, 'chars': gen.CHARS, 'wacc': ok / tot, 'cer': ce / cn}); log.write('  (best so far)\n'); log.flush()
    for p in procs: p.terminate()

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'train'
    if cmd == 'gradcheck': gradcheck()
    elif cmd == 'train': train(int(sys.argv[2]) if len(sys.argv) > 2 else 1000)
