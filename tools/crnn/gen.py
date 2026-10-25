"""Synthetic handwriting generator for the Inkleaf CRNN.

Renders words with handwriting fonts (Google Fonts, Handwritten / Informal / Upright-script tags),
letter by letter with jitter, then distorts them the way real pen writing varies: slant, uneven baseline,
elastic warping, stroke thickness, pressure, blur and noise. Output: float32 images, 32 px tall, ink = 1.

Usage: python3 gen.py preview out.png      (grid of samples for a visual check)
"""
import os, sys, random, math, re, json
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

DATA = os.environ.get('CRNN_DATA', '/tmp/claude-0/-home-claude/5f316a34-64ce-52ec-b099-46f9be5b8602/scratchpad/data')
H = 32
WMAX = 256
CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?'\"-()/&+=%@#$€äöüÄÖÜßñÑáéíóúÁÉÍÓÚ¿¡ "
C2I = {c: i + 1 for i, c in enumerate(CHARS)}   # 0 = CTC blank
NCLASS = len(CHARS) + 1

# ---------------------------------------------------------------- fonts
def font_files():
    out = []
    for base in ('fonts/ofl', 'fonts/apache', 'fonts/ufl'):
        d = os.path.join(DATA, base)
        if not os.path.isdir(d): continue
        for fam in sorted(os.listdir(d)):
            for f in sorted(os.listdir(os.path.join(d, fam))):
                if not f.lower().endswith('.ttf'): continue
                if re.search(r'Guides|Dots|Arrows|Italic', f): continue
                out.append(os.path.join(d, fam, f))
    return out

class Font:
    def __init__(self, path):
        self.path = path
        tt = TTFont(path, lazy=True)
        cmap = tt.getBestCmap() or {}
        self.chars = set(chr(k) for k in cmap.keys())
        self.cursive = bool(re.search(r'cursive|script|allura|alex|dancing|sacramento|satisfy|yellowtail|tangerine|great|parisienne|pinyon|rouge|niconne|petit|clicker|dynalight|engagement|euphoria|felipa|fondamento|grand|kristi|league|lovers|montez|norican|oleo|playball|princess|rochester|ruthie|sail|seaweed|sofia|stalemate|vibur|waterfall|homemade|herr|dafoe|delafield|doulaise|aguafina|italianno|meddon|qwigley|cedarville|bilbo|bonheur|birthstone|comforter|corinthia|babylonica|allison|inspiration|imperial|lavishly|license|whisper|ms|mrs|mr|monsieur|ballet|carattere|puppies|updock|estonia|ephesis|explora|festive|fleur|fuggles|grechen|hurricane|ingrid|island|kolker|luxurious|mea|moon|neonderthaw|oooh|passions|praise|send|smooch|splash|square|style|twinkle|water|whisper|yesteryear|zeyada|la belle|nothing|reenie|over the|waiting|loved|give you|sue ellen|dawning|swanky|girl next|crafty|annie', os.path.basename(path), re.I))
        self._cache = {}
    def pil(self, size):
        f = self._cache.get(size)
        if f is None:
            f = ImageFont.truetype(self.path, size)
            self._cache[size] = f
        return f
    def supports(self, text):
        return all((c in self.chars) or c == ' ' for c in text)

_FONTS = None
def fonts():
    global _FONTS
    if _FONTS is None:
        _FONTS = []
        for p in font_files():
            try:
                f = Font(p)
                if f.supports('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,'):
                    _FONTS.append(f)
            except Exception as e:
                print('skip font', p, e, file=sys.stderr)
    return _FONTS

# ---------------------------------------------------------------- words
def load_words(lang, n=50000):
    p = os.path.join(DATA, 'FrequencyWords/content/2018/%s/%s_50k.txt' % (lang, lang))
    words, weights = [], []
    if not os.path.exists(p): return words, weights
    for line in open(p, encoding='utf-8'):
        parts = line.split()
        if len(parts) != 2: continue
        w, c = parts
        if not all(ch in C2I for ch in w) or ' ' in w or len(w) > 14 or len(w) < 1: continue
        words.append(w); weights.append(float(c) ** 0.5)
        if len(words) >= n: break
    weights = np.array(weights); weights /= weights.sum()
    return words, weights

_CURSIVE = None
def cursive_fonts():
    global _CURSIVE
    if _CURSIVE is None: _CURSIVE = [f for f in fonts() if f.cursive]
    return _CURSIVE

_WORDS = None
def word_pools():
    global _WORDS
    if _WORDS is None:
        _WORDS = {lang: load_words(lang) for lang in ('en', 'de', 'es')}
        extra = ['Inkleaf', 'Berlin', 'Frankfurt', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'meeting', 'todo', 'Note', 'Notes', 'Idea', 'ideas', 'call', 'email', 'order', 'stock', 'pallet', 'pallets', 'delivery', 'invoice', 'warehouse', 'site', 'cable', 'cables', 'tray', 'bolts', 'boxes', 'pcs', 'kg', 'mm', 'cm', 'm', 'km', 'EUR', 'USD', 'Qty', 'Total', 'Subtotal', 'Tax', 'Date', 'Time', 'Name', 'Phone', 'Address', 'Chapter', 'Page', 'Summary', 'Review', 'Draft', 'Final', 'Urgent', 'Done', 'Pending', 'OK', 'ok', 'yes', 'no', 'maybe', 'Thanks', 'Hello', 'Hi', 'Dear', 'Regards', 'Best', 'Lunch', 'Dinner', 'Breakfast', 'Gym', 'Shopping', 'Milk', 'Bread', 'Eggs', 'Coffee', 'Water', 'Birthday', 'Mom', 'Dad', 'Kids', 'School', 'Homework', 'Math', 'Physics', 'Chemistry', 'Biology', 'History', 'English', 'German', 'Spanish', 'Deutsch', 'Español']
        _WORDS['extra'] = (extra, np.ones(len(extra)) / len(extra))
    return _WORDS

def pick_word(rng, lang):
    words, weights = word_pools()[lang]
    if not words: words, weights = word_pools()['en']
    return words[rng.choice(len(words), p=weights)]

def random_number(rng):
    k = rng.random()
    if k < 0.3: return str(rng.integers(0, 10000))
    if k < 0.45: return '%d.%d' % (rng.integers(0, 1000), rng.integers(0, 100)) if rng.random() < 0.5 else '%d,%d' % (rng.integers(0, 1000), rng.integers(0, 100))
    if k < 0.6: return '%02d.%02d.%d' % (rng.integers(1, 32), rng.integers(1, 13), rng.integers(1990, 2031)) if rng.random() < 0.5 else '%d/%d' % (rng.integers(1, 13), rng.integers(1, 32))
    if k < 0.72: return '%d:%02d' % (rng.integers(0, 24), rng.integers(0, 60))
    if k < 0.84: return rng.choice(['€', '$']) + str(rng.integers(1, 2000)) if rng.random() < 0.5 else str(rng.integers(1, 2000)) + rng.choice(['€', '$', '%', 'kg', 'cm', 'mm', 'm', 'x', 'pcs', 'st'])
    if k < 0.92: return '%d-%d' % (rng.integers(0, 100), rng.integers(0, 100))
    return '#' + str(rng.integers(1, 500)) if rng.random() < 0.5 else 'Nr.' + str(rng.integers(1, 500))

def random_code(rng):
    n = rng.integers(2, 7)
    pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    return ''.join(rng.choice(list(pool)) for _ in range(n))

def sample_text(rng):
    r = rng.random()
    if r < 0.42: t = pick_word(rng, 'en')
    elif r < 0.60: t = pick_word(rng, 'de')
    elif r < 0.70: t = pick_word(rng, 'es')
    elif r < 0.76: t = pick_word(rng, 'extra')
    elif r < 0.89: t = random_number(rng)
    elif r < 0.92: t = random_code(rng)
    elif r < 0.96: t = pick_word(rng, 'en') + ' ' + pick_word(rng, 'en')
    else: t = pick_word(rng, 'en')
    # casing
    c = rng.random()
    if t.isalpha():
        if c < 0.22: t = t[:1].upper() + t[1:]
        elif c < 0.30: t = t.upper()
        elif c < 0.33: t = ''.join(ch.upper() if rng.random() < 0.3 else ch for ch in t)
    # attached punctuation
    p = rng.random()
    if p < 0.10: t = t + rng.choice(['.', ',', '!', '?', ':', ';'])
    elif p < 0.14: t = '"' + t + '"'
    elif p < 0.17: t = '(' + t + ')'
    elif p < 0.20 and t.isalpha(): t = t + "'s"
    elif p < 0.22: t = t + '-'
    if len(t) > 16: t = t[:16]
    return t

# ---------------------------------------------------------------- rendering
def render_text(rng, font, text, size):
    """Black ink on white, letter by letter with jitter (or whole string for cursive fonts). Returns uint8 image, ink=255."""
    f = font.pil(size)
    whole = font.cursive and rng.random() < 0.8 or rng.random() < 0.25
    pad = size
    if whole:
        bbox = f.getbbox(text)
        W = int(bbox[2] - bbox[0] + 2 * pad); Hh = int(bbox[3] - bbox[1] + 2 * pad)
        im = Image.new('L', (max(W, 4), max(Hh, 4)), 0)
        ImageDraw.Draw(im).text((pad - bbox[0], pad - bbox[1]), text, font=f, fill=255)
        return np.array(im)
    # per character: advance by the glyph advance with random spacing, vertical jitter and slight size variation
    glyphs = []
    x = pad
    tracking = rng.uniform(-0.04, 0.22) * size
    for ch in text:
        if ch == ' ':
            x += size * rng.uniform(0.35, 0.7); continue
        s = int(size * rng.uniform(0.9, 1.1))
        fc = font.pil(s)
        bbox = fc.getbbox(ch)
        if bbox[2] <= bbox[0]: x += s * 0.3; continue
        adv = fc.getlength(ch)
        gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        g = Image.new('L', (gw + 8, gh + 8), 0)
        ImageDraw.Draw(g).text((4 - bbox[0], 4 - bbox[1]), ch, font=fc, fill=255)
        if rng.random() < 0.6:
            g = g.rotate(rng.uniform(-6, 6), resample=Image.BILINEAR, expand=True)
        dy = rng.normal(0, 0.05) * size
        glyphs.append((int(x + bbox[0]), int(pad + bbox[1] + dy), g))
        x += max(adv + tracking, gw * 0.55 + tracking)
    if not glyphs:
        return np.zeros((4, 4), np.uint8)
    W = int(max(gx + g.width for gx, gy, g in glyphs) + pad)
    Hh = int(max(gy + g.height for gx, gy, g in glyphs) + pad)
    im = Image.new('L', (max(W, 4), max(Hh, 4)), 0)
    for gx, gy, g in glyphs:
        im.paste(g, (gx, gy), g)  # alpha composite (max-ish) so overlapping glyphs stay dark
    return np.array(im)

def elastic(rng, img, alpha, sigma_cells):
    h, w = img.shape
    gh, gw = max(2, h // sigma_cells), max(2, w // sigma_cells)
    dx = cv2.resize(rng.normal(0, 1, (gh, gw)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC) * alpha
    dy = cv2.resize(rng.normal(0, 1, (gh, gw)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC) * alpha
    xs, ys = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(img, xs + dx, ys + dy, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

def crop_ink(img, thr=40):
    ys, xs = np.where(img > thr)
    if len(xs) == 0: return None
    return img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def augment(rng, img, size):
    """img: uint8 hi-res ink image. Returns float32 HxW (H=32), ink in [0,1]."""
    h, w = img.shape
    # slant + rotation + horizontal scale (affine)
    shear = math.tan(math.radians(rng.normal(0, 9)))
    shear = max(-0.7, min(0.7, shear))
    rot = math.radians(rng.normal(0, 1.6))
    sx = rng.uniform(0.72, 1.3)
    M = np.array([[sx * math.cos(rot), shear + math.sin(rot) * 0, 0], [math.sin(rot), math.cos(rot), 0]], np.float32)
    cx, cy = w / 2, h / 2
    # keep the image centered after the affine
    M[:, 2] = [cx - (M[0, 0] * cx + M[0, 1] * cy), cy - (M[1, 0] * cx + M[1, 1] * cy)]
    pad = int(abs(shear) * h) + 10
    outw = int(w * sx) + 2 * pad
    M[0, 2] += pad - (cx - cx * sx)  # shift to make room for the scaling and shear
    img = cv2.warpAffine(img, M, (max(outw, 8), h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # perspective: the paper is rarely perfectly square to the pen
    if rng.random() < 0.35:
        h2, w2 = img.shape; dxy = 0.045
        src = np.float32([[0, 0], [w2, 0], [w2, h2], [0, h2]])
        dst = src + np.float32([[rng.uniform(-dxy, dxy) * w2, rng.uniform(-dxy, dxy) * h2] for _ in range(4)])
        Mp = cv2.getPerspectiveTransform(src, dst)
        img = cv2.warpPerspective(img, Mp, (w2, h2), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # motion blur: a quick hand smears the ink a little
    if rng.random() < 0.2:
        k = int(rng.integers(3, 8)); ker = np.zeros((k, k), np.float32); ang = rng.uniform(0, np.pi)
        for i in range(k):
            x = int(round(k / 2 + (i - k / 2) * math.cos(ang))); y = int(round(k / 2 + (i - k / 2) * math.sin(ang)))
            ker[min(k - 1, max(0, y)), min(k - 1, max(0, x))] = 1
        ker /= max(1, ker.sum()); img = cv2.filter2D(img, -1, ker)
    # baseline wobble (sinusoidal vertical offset along x)
    if rng.random() < 0.6:
        ampl = rng.uniform(0, 0.08) * size; period = rng.uniform(1.5, 6) * size; ph = rng.uniform(0, 6.28)
        xs, ys = np.meshgrid(np.arange(img.shape[1], dtype=np.float32), np.arange(img.shape[0], dtype=np.float32))
        img = cv2.remap(img, xs, ys + (ampl * np.sin(xs / period * 6.28 + ph)).astype(np.float32), interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # elastic distortion
    if rng.random() < 0.75:
        img = elastic(rng, img, alpha=rng.uniform(0.5, 3.0) * size / 48, sigma_cells=int(rng.uniform(8, 20)))
    # stroke thickness
    k = rng.random()
    if k < 0.35:
        r = int(rng.integers(1, max(2, min(3, int(size * 0.045)))))
        img = cv2.dilate(img, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r * 2 + 1, r * 2 + 1)))
    elif k < 0.55:
        r = 1 if rng.random() < 0.7 else 2
        img = cv2.erode(img, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r * 2 + 1, r * 2 + 1)))
    img = crop_ink(img)
    if img is None: return None
    # scale to 32 px height with a little random padding
    padt, padb = rng.integers(0, 4), rng.integers(0, 4)
    ih = H - padt - padb
    scale = ih / img.shape[0]
    nw = max(2, int(round(img.shape[1] * scale)))
    if nw > WMAX - 4:
        scale *= (WMAX - 4) / nw; nw = WMAX - 4; ih = max(4, int(round(img.shape[0] * scale)))
    small = cv2.resize(img, (nw, ih), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    out = np.zeros((H, nw + 4), np.float32)
    top = (H - ih) // 2 if ih < H - padt - padb else padt
    out[top:top + ih, 2:2 + nw] = small
    # ink texture: blur, pressure field, contrast, speckle
    if rng.random() < 0.5:
        out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.3, 0.9))
    if rng.random() < 0.5:
        field = cv2.resize(rng.uniform(0.65, 1.0, (3, max(2, nw // 24))).astype(np.float32), (out.shape[1], H), interpolation=cv2.INTER_LINEAR)
        out = out * field
    gain = rng.uniform(0.9, 1.7)
    out = np.clip(out * gain, 0, 1)
    mx = float(out.max())
    if mx < 0.55 and mx > 0: out = np.clip(out * (0.75 / mx), 0, 1)
    if rng.random() < 0.3:
        out = np.clip(out + rng.normal(0, 0.03, out.shape).astype(np.float32), 0, 1)
    if rng.random() < 0.1:
        n = rng.integers(1, 6)
        for _ in range(n):
            x, y = rng.integers(0, out.shape[1]), rng.integers(0, H)
            out[max(0, y - 1):y + 1, max(0, x - 1):x + 1] = rng.uniform(0.3, 1)
    return out

# ---------------------------------------------------------------- pen-stroke rendering from the app's own letter shapes
_SHAPES = None
def shapes():
    global _SHAPES
    if _SHAPES is None:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'shapes.json')
        _SHAPES = json.load(open(p)) if os.path.exists(p) else {}
    return _SHAPES

def render_strokes(rng, text, size):
    """Draws the word with the app's stroke templates (100-unit em, baseline at y=100) the way a pen would: round
    joins, slight jitter and slant, uneven spacing. Returns uint8 image or None when a character has no shape."""
    sh = shapes(); u = size / 100.0
    glyphs = []; x = size * 0.6; slant = rng.normal(0, 0.1); jit = rng.uniform(0.1, 0.9)
    for ch in text:
        if ch == ' ': x += size * rng.uniform(0.35, 0.7); continue
        vs = sh.get(ch)
        if not vs: return None
        strokes = vs[rng.integers(0, len(vs))]
        xs = [p[0] for st in strokes for p in st]; gw = max(1.0, max(xs) - min(xs)); gx0 = min(xs)
        sx = rng.uniform(0.75, 1.15) * u; sy = u * rng.uniform(0.9, 1.1); dy = rng.normal(0, 2.5) * u
        for st in strokes:
            pts = []
            # densify, then wobble a little so the lines are not perfectly straight
            for i in range(len(st)):
                if i == 0: pts.append(st[0]); continue
                (x0, y0), (x1, y1) = st[i - 1], st[i]; d = math.hypot(x1 - x0, y1 - y0); n = max(1, int(d / 5))
                for k in range(1, n + 1): pts.append([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n])
            poly = []
            for (px, py) in pts:
                yy = size * 0.35 + py * sy + dy
                xx = x + (px - gx0) * sx + (100 * u + size * 0.35 - yy) * slant
                poly.append([xx + rng.normal(0, jit), yy + rng.normal(0, jit)])
            glyphs.append(poly)
        x += gw * sx + rng.uniform(0.04, 0.26) * size
    W = int(x + size * 0.6); Hh = int(size * 0.35 + 145 * u + size * 0.4)
    img = np.zeros((max(Hh, 8), max(W, 8)), np.uint8)
    th = int(rng.integers(2, max(3, int(size * 0.09))))
    for poly in glyphs:
        pts = np.array(poly, np.int32).reshape(-1, 1, 2)
        cv2.polylines(img, [pts], False, 255, th, cv2.LINE_AA)
        for (px, py) in poly[::2]: cv2.circle(img, (int(px), int(py)), max(1, th // 2), 255, -1, cv2.LINE_AA)
    return img

# ---------------------------------------------------------------- generated handwriting (hwsynth.py: a Graves-style network trained on real writers)
_HW = None
def hw_data():
    """All out/hw-synth-*.npz files merged: (pts (N,3), idx (M+1,), texts). None when there are none."""
    global _HW
    if _HW is None:
        import glob
        files = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'hw-synth-*.npz')))
        pts, idx, texts = [], [np.zeros(1, np.int64)], []
        base = 0
        for f in files:
            try:
                z = np.load(f, allow_pickle=False)
                p, ix, tx = z['pts'], z['idx'], [str(t) for t in z['texts']]
            except Exception as e:
                print('skip', f, e, file=sys.stderr); continue
            if len(tx) == 0: continue
            pts.append(p); idx.append(ix[1:] + base); texts += tx; base += len(p)
        _HW = (np.concatenate(pts, 0), np.concatenate(idx), texts) if texts else False
    return _HW or None

def hw_word(rng, i=None):
    """A generated word as (list of (n,2) stroke arrays, text)."""
    pts, idx, texts = hw_data()
    if i is None: i = int(rng.integers(0, len(texts)))
    c = pts[idx[i]:idx[i + 1]]
    out = []; start = 0
    for e in np.where(c[:, 2] == 1)[0] + 1:
        s = c[start:e, :2]; start = e
        if len(s): out.append(s)
    if start < len(c): out.append(c[start:, :2])
    return out, texts[i]

def jitter_strokes(rng, strokes):
    """Stroke-level variation: slant, width, size wobble per stroke, point noise, dropped/duplicated pen lifts."""
    allp = np.concatenate(strokes, 0); cx, cy = allp.mean(0)
    shear = max(-0.6, min(0.6, math.tan(math.radians(rng.normal(0, 7)))))
    sx = rng.uniform(0.8, 1.25); rot = math.radians(rng.normal(0, 1.5))
    M = np.array([[sx * math.cos(rot), shear - math.sin(rot)], [math.sin(rot), math.cos(rot)]], np.float32)
    jit = rng.uniform(0, 0.25); out = []
    for s in strokes:
        s = (s - [cx, cy]) @ M.T
        s = s * rng.uniform(0.96, 1.04) + rng.normal(0, 0.3, 2)
        if jit > 0: s = s + rng.normal(0, jit, s.shape)
        out.append(s.astype(np.float32))
    return out

def rasterize_app(rng, strokes):
    """Port of js/crnn.js rasterize(): the strip the app feeds the network, so these samples go through exactly the
    inference path. Returns float32 (H, w) with ink in [0,1], or None."""
    PAD = 2
    allp = np.concatenate(strokes, 0); x0, y0 = allp.min(0); x1, y1 = allp.max(0)
    bh = max(1e-6, y1 - y0); bw = max(1e-6, x1 - x0)
    k = (H - 2 * PAD) / bh; w = int(math.ceil(bw * k)) + 2 * PAD + 2
    if w > WMAX: k *= (WMAX - 2 * PAD - 2) / (w - 2 * PAD - 2); w = WMAX
    if w < 6: return None
    ih = bh * k; top = PAD + ((H - 2 * PAD) - ih) / 2
    img = np.zeros((H, w), np.float32)
    r = max(1.1, min(2.2, 1.35 * math.sqrt(k * 0.08 + 1))) * rng.uniform(0.75, 1.3)
    ys, xs = np.mgrid[0:H, 0:w]; xs = xs + 0.5; ys = ys + 0.5
    for s in strokes:
        pts = np.stack([PAD + 1 + (s[:, 0] - x0) * k, top + (s[:, 1] - y0) * k], 1)
        # densify like the app (steps of 0.5 px) then stamp soft discs
        dense = [pts[:1]]
        for a, b in zip(pts[:-1], pts[1:]):
            d = math.hypot(*(b - a)); n = max(1, int(math.ceil(d / 0.5)))
            dense.append(a + (b - a)[None, :] * (np.arange(1, n + 1) / n)[:, None])
        dense = np.concatenate(dense, 0)
        if len(dense) > 4000: dense = dense[::2]
        for (cx, cy) in dense:
            xa, xb = max(0, int(cx - r - 1)), min(w - 1, int(math.ceil(cx + r + 1))); ya, yb = max(0, int(cy - r - 1)), min(H - 1, int(math.ceil(cy + r + 1)))
            if xb < xa or yb < ya: continue
            d = np.hypot(xs[ya:yb + 1, xa:xb + 1] - cx, ys[ya:yb + 1, xa:xb + 1] - cy)
            v = np.clip(r + 0.5 - d, 0, 1); sub = img[ya:yb + 1, xa:xb + 1]; np.maximum(sub, v, out=sub)
    return img

def render_hw(rng, strokes, size):
    """Hi-res pen rendering of generated strokes (then augment() crops, scales and textures it). uint8, ink = 255."""
    allp = np.concatenate(strokes, 0); mn = allp.min(0); ext = allp.max(0) - mn
    sc = size * rng.uniform(0.8, 1.4) / max(ext[1], ext[0] / 8, 1e-3)
    pad = size * 0.4
    W = int(ext[0] * sc + 2 * pad); Hh = int(ext[1] * sc + 2 * pad)
    if W > 2400 or Hh > 600: return None
    img = np.zeros((max(Hh, 8), max(W, 8)), np.uint8)
    th0 = int(rng.integers(2, max(3, int(size * 0.09))))
    for s in strokes:
        p = ((s - mn) * sc + pad).astype(np.int32)
        th = max(1, th0 + int(rng.integers(-1, 2)))
        cv2.polylines(img, [p.reshape(-1, 1, 2)], False, 255, th, cv2.LINE_AA)
        if th > 2:
            for q in p[::3]: cv2.circle(img, (int(q[0]), int(q[1])), th // 2, 255, -1, cv2.LINE_AA)
    return img

def strip_texture(rng, out):
    """Light ink-texture variation for strips that were rasterized directly at 32 px."""
    if rng.random() < 0.4: out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.3, 0.7))
    if rng.random() < 0.4:
        field = cv2.resize(rng.uniform(0.7, 1.0, (3, max(2, out.shape[1] // 24))).astype(np.float32), (out.shape[1], H), interpolation=cv2.INTER_LINEAR)
        out = out * field
    out = np.clip(out * rng.uniform(0.9, 1.4), 0, 1)
    if rng.random() < 0.25: out = np.clip(out + rng.normal(0, 0.03, out.shape).astype(np.float32), 0, 1)
    return out.astype(np.float32)

def make_hw_sample(rng, size):
    strokes, t = hw_word(rng)
    strokes = jitter_strokes(rng, strokes)
    if rng.random() < 0.5:
        out = rasterize_app(rng, strokes)
        return (strip_texture(rng, out) if out is not None else None), t
    img = render_hw(rng, strokes, size)
    if img is None: return None, t
    return augment(rng, img, size), t

def make_sample(rng, text=None, font=None):
    fs = fonts()
    for _ in range(8):
        t = text or sample_text(rng)
        size = int(rng.integers(40, 72))
        if text is None and font is None and hw_data() and rng.random() < float(os.environ.get('CRNN_HW_SHARE', 0.45)):   # generated handwriting
            out, t = make_hw_sample(rng, size)
            if out is None or out.shape[1] < 6: continue
            return out, t
        if font is None and shapes() and rng.random() < float(os.environ.get('CRNN_STROKE_SHARE', 0.3)):   # pen-stroke rendering of the app's letter shapes
            img = render_strokes(rng, t, size)
            if img is None: continue
            out = augment(rng, img, size)
            if out is None or out.shape[1] < 6: continue
            return out, t
        if font is None and rng.random() < float(os.environ.get('CRNN_CURSIVE_FONT_SHARE', 0.35)):   # joined-up writing gets extra weight
            cf = cursive_fonts(); f = cf[rng.integers(0, len(cf))] if cf else fs[rng.integers(0, len(fs))]
        else: f = font or fs[rng.integers(0, len(fs))]
        if not f.supports(t):
            if text: f = None; continue
            continue
        try:
            img = render_text(rng, f, t, size)
        except Exception:
            continue
        out = augment(rng, img, size)
        if out is None or out.shape[1] < 6: continue
        return out, t
    return None, None

def bucket_width(w):
    return int(min(WMAX, max(32, math.ceil(w / 32) * 32)))

def make_batch(rng, n, width=None):
    """Returns images (n, 32, W), labels list of int lists, texts. Samples are grouped near the requested width bucket."""
    imgs, labels, texts = [], [], []
    while len(imgs) < n:
        im, t = make_sample(rng)
        if im is None: continue
        if width is not None and bucket_width(im.shape[1]) != width: continue
        imgs.append(im); labels.append([C2I[c] for c in t]); texts.append(t)
    W = width or max(bucket_width(im.shape[1]) for im in imgs)
    X = np.zeros((n, H, W), np.float32)
    for i, im in enumerate(imgs):
        w = min(im.shape[1], W)
        off = int(rng.integers(0, W - w + 1)) if rng.random() < 0.5 else 0
        X[i, :, off:off + w] = im[:, :w]
    return X, labels, texts

if __name__ == '__main__':
    if sys.argv[1] == 'preview':
        rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 1)
        print(len(fonts()), 'fonts')
        rows = []
        for r in range(12):
            X, labels, texts = make_batch(rng, 4, width=None)
            row = np.concatenate([np.pad(X[i], ((2, 2), (2, 2))) for i in range(4)], axis=1)
            rows.append((row, texts))
        W = max(r.shape[1] for r, _ in rows)
        canvas = np.ones((len(rows) * 36 + 4, W + 4), np.float32)
        for i, (r, t) in enumerate(rows):
            canvas[i * 36 + 2:i * 36 + 2 + r.shape[0], 2:2 + r.shape[1]] = 1 - r
        cv2.imwrite(sys.argv[2], (canvas * 255).astype(np.uint8))
        for _, t in rows: print(' | '.join(t))
