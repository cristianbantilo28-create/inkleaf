"""Evaluates the recognizer the way the app uses it: beam search + dictionary re-scoring + digit/letter look-alike fixes,
on word distributions that resemble real notes (common words, numbers, a few codes), rendered with the handwriting fonts
and with the app's own pen-stroke letter shapes.

  python3 evalapp.py [ckpt.npz] [n_batches]
"""
import os, sys, json, re, math
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import gen, train, lm

def load_lexicon():
    p = os.path.join(HERE, '..', '..', 'js', 'lexicon.js'); words = set()
    if os.path.exists(p):
        m = re.search(r'lexiconWords = "([^"]*)"', open(p, encoding='utf-8').read())
        if m: words = set(m.group(1).split(' '))
    return words

LEX = load_lexicon()
def in_lex(w): return w.lower() in LEX
def edit_distance(a, b): return train.edit_distance(a, b)
def near_lex(word):
    core = re.sub(r'^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ]+$', '', word)
    if len(core) < 3: return []
    i = word.index(core); lead, trail = word[:i], word[i + len(core):]
    low = core.lower(); maxd = 2 if len(core) >= 6 else 1; out = []
    def recase(w):
        if core == core.upper() and len(core) > 1: return w.upper()
        if core[0].isupper(): return w[0].upper() + w[1:]
        return w
    for w in LEX:
        if abs(len(w) - len(low)) > maxd or w == low: continue
        if maxd < 2 and w[0] != low[0] and w[-1] != low[-1]: continue
        d = edit_distance(w, low)
        if d <= maxd: out.append((lead + recase(w) + trail, d))
    out.sort(key=lambda x: x[1]); return out[:16]

D2L_LOW = {'0': 'o', '1': 'l', '5': 's', '9': 'g', '2': 'z', '8': 'B', '6': 'b'}; D2L_UP = {'0': 'O', '1': 'I', '5': 'S', '2': 'Z', '8': 'B', '6': 'G', '9': 'g'}
L2D = {'o': '0', 'O': '0', 'l': '1', 'I': '1', 'i': '1', 's': '5', 'S': '5', 'g': '9', 'q': '9', 'z': '2', 'Z': '2', 'B': '8', 'b': '6', 'G': '6', 'D': '0', 'Q': '0'}
def fix_digits(text):
    letters = len(re.findall(r'[A-Za-zÀ-ÿ]', text)); digits = len(re.findall(r'[0-9]', text))
    if not letters or not digits: return text
    if re.match(r'^\d+(st|nd|rd|th|er|te|s|x|m|cm|mm|kg|g|h|min|pm|am|k|K|M|€|\$|%)$', text) or re.match(r'^[A-Za-z]\d+$', text) or re.match(r'^\d+[A-Za-z]$', text): return text
    upper = len(re.findall(r'[A-Z]', text)) > len(re.findall(r'[a-z]', text))
    as_letters = re.sub(r'[0-9]', lambda m: (D2L_UP if upper else D2L_LOW).get(m.group(0), m.group(0)), text)
    if not re.search(r'[0-9]', as_letters) and in_lex(re.sub(r'^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ]+$', '', as_letters)): return as_letters
    if letters >= 2 and letters > digits: return as_letters
    if digits >= 2 and digits > letters and all(re.match(r'[0-9.,:\-/%€$]', ch) or ch in L2D for ch in text): return re.sub(r'[A-Za-z]', lambda m: L2D.get(m.group(0), m.group(0)), text)
    return text

def fix_mixed_case(text):
    up = len(re.findall(r'[A-ZÀ-Ý]', text)); lo = len(re.findall(r'[a-zà-ÿ]', text))
    if up >= 2 and up >= 2 * lo and lo > 0: return re.sub(r'[cosuvwxzkmnpij]', lambda m: m.group(0).upper(), text)
    if lo >= 2 and lo >= 2 * up and up > 0: return text[0] + re.sub(r'[COSUVWXZKMNP]', lambda m: m.group(0).lower(), text[1:])
    return text

def ctc_score(logp, text):
    lab = [gen.C2I[c] for c in text if c in gen.C2I]
    if len(lab) != len(text): return -1e9
    S = 2 * len(lab) + 1; ext = [0] * S
    for i, l in enumerate(lab): ext[2 * i + 1] = l
    T = logp.shape[0]; a = np.full(S, -np.inf); a[0] = logp[0, 0]
    if S > 1: a[1] = logp[0, ext[1]]
    for t in range(1, T):
        na = np.full(S, -np.inf)
        for s_ in range(S):
            v = a[s_]
            if s_ > 0: v = lm.lse(v, a[s_ - 1])
            if s_ > 1 and ext[s_] != 0 and ext[s_] != ext[s_ - 2]: v = lm.lse(v, a[s_ - 2])
            if v > -np.inf: na[s_] = v + logp[t, ext[s_]]
        a = na
    return lm.lse(a[S - 1], a[S - 2]) if S > 1 else a[0]

def app_read(logp, width=8, bonus=1.2):
    alts = lm.beam_decode(logp, gen.CHARS, width)
    if not alts or not alts[0][0].strip(): return ''
    cands = {t: (s, 0) for t, s in alts[:6] if t.strip()}
    best = alts[0][0]
    for w, d in near_lex(best):
        if w not in cands: cands[w] = (ctc_score(logp, w), d)
    pick, ps = best, -np.inf
    for w, (sc, d) in cands.items():
        v = sc; core = re.sub(r'^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9]+$', '', w)
        if len(core) >= 2 and in_lex(core): v += 0.8 if d >= 2 else bonus
        if v > ps: ps, pick = v, w
    return fix_mixed_case(fix_digits(pick.strip()))

def realistic_text(rng):
    r = rng.random()
    if r < 0.55: t = gen.pick_word(rng, 'en')
    elif r < 0.75: t = gen.pick_word(rng, 'de')
    elif r < 0.85: t = gen.pick_word(rng, 'es')
    elif r < 0.97: return gen.random_number(rng)
    else: return gen.random_code(rng)
    c = rng.random()
    if c < 0.2: t = t[:1].upper() + t[1:]
    elif c < 0.27: t = t.upper()
    if rng.random() < 0.08: t += rng.choice(['.', ',', '!', '?'])
    return t[:16]

def make_eval(rng, n, strokes_only=False):
    X = []; texts = []
    fs = gen.fonts()
    while len(X) < n:
        t = realistic_text(rng); size = int(rng.integers(40, 72))
        if strokes_only or rng.random() < 0.15:
            img = gen.render_strokes(rng, t, size)
            if img is None: continue
        else:
            f = fs[rng.integers(0, len(fs))]
            if not f.supports(t): continue
            try: img = gen.render_text(rng, f, t, size)
            except Exception: continue
        out = gen.augment(rng, img, size)
        if out is None or out.shape[1] < 6: continue
        X.append(out); texts.append(t)
    return X, texts

def run(m, X, texts):
    stats = {'greedy': [0, 0], 'beam': [0, 0], 'app': [0, 0], 'app_nocase': [0, 0]}; ce = 0; cn = 0; examples = []
    for img, t in zip(X, texts):
        W = gen.bucket_width(img.shape[1]); xb = np.zeros((1, gen.H, W), np.float32); xb[0, :, :img.shape[1]] = img[:, :W]
        lg = m.forward(xb, train=False)[0]; lg = lg - lg.max(axis=1, keepdims=True); lp = lg - np.log(np.exp(lg).sum(axis=1, keepdims=True))
        g = train.greedy_decode(lg[None])[0]; b = lm.beam_decode(lp, gen.CHARS, 8)[0][0]; a = app_read(lp)
        stats['greedy'][0] += g == t; stats['beam'][0] += b == t; stats['app'][0] += a == t; stats['app_nocase'][0] += a.lower() == t.lower()
        for k in stats: stats[k][1] += 1
        ce += edit_distance(a, t); cn += len(t)
        if a != t and len(examples) < 12: examples.append('%s→%s' % (t, a))
    return {k: 100 * v[0] / max(1, v[1]) for k, v in stats.items()}, 100 * ce / max(1, cn), examples

def make_hw_eval(n, path=None):
    """Held-out words from the handwriting synthesis network (out/hw-eval.npz, not used for training), rasterized
    exactly the way the app does it, without any augmentation."""
    path = path or os.path.join(HERE, 'out', 'hw-eval.npz')
    if not os.path.exists(path): return [], []
    z = np.load(path, allow_pickle=False); pts, idx, texts = z['pts'], z['idx'], [str(t) for t in z['texts']]
    X = []; T = []; rng = np.random.default_rng(0)
    for i in range(min(n, len(texts))):
        c = pts[idx[i]:idx[i + 1]]; strokes = []; start = 0
        for e in np.where(c[:, 2] == 1)[0] + 1:
            s = c[start:e, :2]; start = e
            if len(s): strokes.append(s)
        if start < len(c): strokes.append(c[start:, :2])
        img = gen.rasterize_app(np.random.default_rng(0), strokes)
        if img is None: continue
        X.append(img); T.append(texts[i])
    return X, T

if __name__ == '__main__':
    ck = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'best.npz')
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 400
    z = np.load(ck); meta = json.loads(str(z['__meta'])); m = train.model_from_meta(meta, gen.NCLASS); m.load(ck)
    print('model step', meta.get('step'), 'lexicon', len(LEX), 'words')
    rng = np.random.default_rng(2024)
    X, texts = make_eval(rng, n); acc, cer, ex = run(m, X, texts)
    print('realistic mix (fonts + 15%% strokes): greedy %.1f%%  beam %.1f%%  app pipeline %.1f%% (ignoring case %.1f%%)  CER(app) %.1f%%' % (acc['greedy'], acc['beam'], acc['app'], acc['app_nocase'], cer)); print('  misses:', ' | '.join(ex))
    X, texts = make_eval(rng, n // 2, strokes_only=True); acc, cer, ex = run(m, X, texts)
    print('pen-stroke letters only: greedy %.1f%%  beam %.1f%%  app pipeline %.1f%% (ignoring case %.1f%%)  CER(app) %.1f%%' % (acc['greedy'], acc['beam'], acc['app'], acc['app_nocase'], cer)); print('  misses:', ' | '.join(ex))
    X, texts = make_hw_eval(n)
    if X:
        acc, cer, ex = run(m, X, texts)
        print('generated real-writer handwriting (held out, %d words): greedy %.1f%%  beam %.1f%%  app pipeline %.1f%% (ignoring case %.1f%%)  CER(app) %.1f%%' % (len(X), acc['greedy'], acc['beam'], acc['app'], acc['app_nocase'], cer)); print('  misses:', ' | '.join(ex))
