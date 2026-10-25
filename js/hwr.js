/* Inkleaf — handwriting recognition.
   1) Segments ink on a ruled row into words and characters.
   2) Recognizes each character with a $P-style point-cloud matcher against built-in templates plus the user's own samples.
   3) Resolves case/digits from letter height and word context, then checks a small lexicon.
   When the browser exposes the Handwriting Recognition API (navigator.createHandwritingRecognizer), that engine is used for whole rows instead. */
(function () {
  const root = typeof window !== 'undefined' ? window : self; const IL = (root.IL = root.IL || {});
  const N = 32;

  /* ---------- template authoring helpers (100x100 box, y down) ---------- */
  function A(cx, cy, rx, ry, a0, a1) {
    const n = Math.max(4, Math.round(Math.abs(a1 - a0) / 15)); const out = [];
    for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return out;
  }
  const J = (...parts) => parts.flat();
  const DOT = (x, y) => A(x, y, 2.5, 2.5, 0, 360);

  /* label → variants → strokes → points. Multi-character labels are families whose members differ only by size (resolved later). */
  const DEF = {
    a: [[J(A(42, 72, 28, 28, 0, -360), [[70, 72], [70, 42], [72, 100]])], [[[30, 48], [44, 36], [62, 38], [70, 50], [70, 100]], A(50, 82, 20, 18, 0, 360)]],
    b: [[J([[22, 0], [22, 100], [22, 52]], A(46, 76, 24, 24, -90, 90), [[22, 100]])]],
    cC: [[A(50, 70, 30, 30, -50, -310)]],
    d: [[J(A(44, 76, 24, 24, -40, 320), [[68, 0], [68, 100]])]],
    e: [[J([[18, 70], [80, 70]], A(50, 70, 32, 30, 0, -300))]],
    f: [[J(A(52, 20, 20, 20, 0, -180), [[32, 20], [32, 100]]), [[15, 50], [55, 50]]]],
    g: [[J(A(44, 66, 24, 24, 0, -360), [[68, 66], [68, 120]], A(44, 120, 24, 20, 0, 180))]],
    h: [[J([[20, 0], [20, 100], [20, 74]], A(44, 74, 24, 22, 180, 360), [[68, 74], [68, 100]])]],
    i: [[[[50, 30], [50, 100]], DOT(50, 10)]],
    j: [[J([[60, 30], [60, 110]], A(40, 110, 20, 18, 0, 180)), DOT(60, 10)]],
    kK: [[[[20, 0], [20, 100]], [[64, 40], [22, 72], [66, 100]]], [[[20, 0], [20, 100]], [[80, 0], [20, 55], [80, 100]]], [[[20, 0], [20, 100]], [[64, 40], [22, 72]], [[34, 64], [66, 100]]]],
    lI1: [[[[50, 0], [50, 100]]], [[[46, 0], [46, 94], [52, 100], [64, 96]]], [[[30, 0], [70, 0]], [[50, 0], [50, 100]], [[30, 100], [70, 100]]]],
    m: [[J([[16, 100], [16, 40], [16, 60]], A(32, 60, 16, 22, 180, 360), [[48, 60], [48, 100], [48, 60]], A(64, 60, 16, 22, 180, 360), [[80, 60], [80, 100]])]],
    n: [[J([[24, 100], [24, 40], [24, 60]], A(48, 60, 24, 22, 180, 360), [[72, 60], [72, 100]])]],
    oO0: [[A(50, 70, 28, 30, -90, 270)]],
    pP: [[J([[22, 42], [22, 130], [22, 44]], A(46, 68, 24, 24, -90, 90), [[22, 92]])]],
    q: [[J(A(44, 66, 24, 24, -40, 320), [[68, 44], [68, 130], [76, 122]])]],
    r: [[J([[24, 100], [24, 40], [24, 60]], A(46, 62, 22, 20, 180, 330))]],
    sS: [[J(A(50, 55, 22, 15, -30, -250), A(50, 85, 22, 15, -110, 160))]],
    t: [[[[40, 10], [40, 96], [46, 100], [58, 96]], [[20, 44], [62, 44]]], [[[40, 10], [40, 100]], [[20, 44], [62, 44]]]],
    uU: [[J([[22, 40], [22, 78]], A(46, 78, 24, 22, 180, 0), [[70, 78], [70, 40], [70, 100]])], [J([[20, 0], [20, 70]], A(50, 70, 30, 30, 180, 0), [[80, 70], [80, 0]])]],
    vV: [[[[20, 40], [50, 100], [80, 40]]]],
    wW: [[[[12, 40], [30, 100], [50, 50], [70, 100], [88, 40]]]],
    xX: [[[[22, 40], [78, 100]], [[78, 40], [22, 100]]]],
    yY: [[J([[22, 40], [22, 78]], A(46, 78, 24, 22, 180, 0), [[70, 78], [70, 40], [70, 125]], A(50, 125, 20, 16, 0, 180))], [[[20, 40], [50, 100]], [[80, 40], [36, 135]]], [[[10, 0], [50, 50], [90, 0]], [[50, 50], [50, 100]]]],
    zZ: [[[[22, 40], [78, 40], [22, 100], [78, 100]]], [[[22, 40], [78, 40], [22, 100], [78, 100]], [[32, 70], [68, 70]]]],
    A: [[[[10, 100], [50, 0], [90, 100]], [[26, 62], [74, 62]]]],
    B: [[[[20, 0], [20, 100]], J([[20, 0]], A(44, 25, 24, 25, -90, 90), [[20, 50]], A(46, 75, 26, 25, -90, 90), [[20, 100]])]],
    D: [[[[20, 0], [20, 100]], J([[20, 0]], A(40, 50, 42, 50, -90, 90), [[20, 100]])]],
    E: [[[[80, 0], [20, 0], [20, 100], [80, 100]], [[20, 50], [66, 50]]]],
    F: [[[[80, 0], [20, 0], [20, 100]], [[20, 50], [64, 50]]]],
    G: [[J(A(50, 50, 38, 48, -40, -330), [[88, 56], [56, 56]])]],
    H: [[[[20, 0], [20, 100]], [[80, 0], [80, 100]], [[20, 50], [80, 50]]]],
    J: [[J([[60, 0], [60, 80]], A(40, 80, 20, 20, 0, 180))], [[[30, 0], [80, 0]], J([[60, 0], [60, 80]], A(40, 80, 20, 20, 0, 180))]],
    L: [[[[20, 0], [20, 100], [80, 100]]]],
    M: [[[[10, 100], [10, 0], [50, 70], [90, 0], [90, 100]]]],
    N: [[[[20, 100], [20, 0], [80, 100], [80, 0]]]],
    P: [[J([[20, 100], [20, 0]], A(46, 26, 26, 26, -90, 90), [[20, 52]])]],
    Q: [[A(50, 46, 36, 46, -90, 270), [[62, 70], [88, 104]]]],
    R: [[J([[20, 100], [20, 0]], A(46, 26, 26, 26, -90, 90), [[20, 52]]), [[44, 52], [84, 100]]]],
    T: [[[[10, 0], [90, 0]], [[50, 0], [50, 100]]]],
    '1': [[[[36, 14], [50, 0], [50, 100]]]],
    '2': [[J(A(50, 28, 30, 26, -150, 60), [[20, 100], [84, 100]])]],
    '3': [[J(A(48, 26, 26, 26, -150, 90), A(50, 74, 28, 26, -90, 150))]],
    '4': [[[[60, 0], [16, 66], [86, 66]], [[64, 0], [64, 100]]], [[[20, 0], [20, 60], [80, 60]], [[64, 0], [64, 100]]]],
    '5': [[[[78, 0], [26, 0], [22, 46]], J([[22, 46]], A(48, 72, 28, 28, -110, 170))]],
    '6': [[J([[72, 0], [40, 40]], A(50, 72, 28, 28, -150, 210))]],
    '7': [[[[16, 0], [84, 0], [40, 100]]], [[[16, 0], [84, 0], [40, 100]], [[30, 50], [66, 50]]]],
    '8': [[J(A(50, 26, 24, 26, 90, -270), A(50, 74, 26, 26, -90, 270))]],
    '9': [[J(A(50, 28, 28, 28, 0, 360), [[78, 28], [76, 70], [58, 100]])]],
    '!': [[[[50, 0], [50, 70]], DOT(50, 96)]],
    '?': [[J(A(50, 26, 26, 26, -160, 60), [[50, 52], [50, 70]]), DOT(50, 96)]],
    '(': [[A(80, 50, 40, 52, 130, 230)]],
    ')': [[A(20, 50, 40, 52, -50, 50)]]
  };
  /* Note: 'P' is an alias of the pP family in practice; keep the distinct P so a tall bowl-at-top with no descender still reads as P. */

  const DIGIT_LABELS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  const UPPER_DISTINCT = new Set(['A', 'B', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'M', 'N', 'P', 'Q', 'R', 'T']);
  const TALL_OF = { m: 'M', n: 'N' };
  const SHORT_OF = { M: 'm', N: 'n', P: 'p' };
  const DIGIT_OF = { sS: '5', zZ: '2', lI1: '1', oO0: '0', uU: '0', g: '9', b: '6', q: '9', I: '1', l: '1' };
  /* Which heights each label may have: s = x-height, t = tall (ascender/capital), d = below the baseline. Families accept every height of their members. */
  const HEIGHT = {};
  'a c e i m n o r s u v w x z'.split(' ').forEach(l => HEIGHT[l] = 's');
  'b d f h k l t A B D E F G H J L M N P Q R T 1 2 3 4 5 6 7 8 9 ! ? ( )'.split(' ').forEach(l => HEIGHT[l] = 't');
  'g j p q y'.split(' ').forEach(l => HEIGHT[l] = 'd');
  function heightAllowed(label, cls) {
    if (label.length > 1) {
      if (label === 'lI1' || label === 'kK') return cls !== 's' ? true : (label === 'lI1'); // a short bare stroke can still be an l written small
      if (label === 'pP') return cls === 'd' || cls === 't';
      if (label === 'yY') return cls === 'd' || cls === 't';
      return true;
    }
    const h = HEIGHT[label]; if (!h) return true;
    if (h === cls) return true;
    if (h === 'd' && cls === 't') return label === 'g' || label === 'q' || label === 'j'; // tall-and-descending handwriting
    return false;
  }

  /* ---------- geometry ---------- */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function bboxPts(pts) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; } return { x0, y0, x1, y1 }; }
  function bboxStroke(stroke) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of stroke.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; }
  function unionBox(a, b) { const x0 = Math.min(a.x0, b.x0), y0 = Math.min(a.y0, b.y0), x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; }

  function pathLength(pts) { let d = 0; for (let i = 1; i < pts.length; i++) if (pts[i].id === pts[i - 1].id) d += dist(pts[i - 1], pts[i]); return d; }
  function resample(points, n) {
    const pts = points.map(p => ({ x: p.x, y: p.y, id: p.id }));
    const total = pathLength(pts);
    if (total < 1e-6) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y, id: pts[0].id }));
    const I = total / (n - 1); let D = 0; const out = [{ x: pts[0].x, y: pts[0].y, id: pts[0].id }];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].id === pts[i - 1].id) {
        const d = dist(pts[i - 1], pts[i]);
        if (d > 0 && D + d >= I) {
          const t = (I - D) / d;
          const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y), id: pts[i].id };
          out.push(q); pts.splice(i, 0, q); D = 0;
        } else D += d;
      }
    }
    while (out.length < n) out.push({ ...out[out.length - 1] });
    return out.slice(0, n);
  }
  /* Scales to a unit box. Thin shapes (lines, dots) keep their proportions so they don't inflate into blobs. */
  function normalize(pts) {
    const bb = bboxPts(pts); const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, m = Math.max(w, h) || 1;
    const sx = w > 0.2 * m ? w : m, sy = h > 0.2 * m ? h : m;
    let cx = 0, cy = 0;
    const out = pts.map(p => ({ x: (p.x - bb.x0) / sx, y: (p.y - bb.y0) / sy, id: p.id }));
    for (const p of out) { cx += p.x; cy += p.y; } cx /= out.length; cy /= out.length;
    for (const p of out) { p.x -= cx; p.y -= cy; }
    return out;
  }
  /* Light smoothing for dense pen input only; sparse template polylines must keep their corners. */
  function smooth(stroke) {
    if (stroke.length < 24) return stroke;
    const out = [stroke[0]];
    for (let i = 1; i < stroke.length - 1; i++) out.push([(stroke[i - 1][0] + 2 * stroke[i][0] + stroke[i + 1][0]) / 4, (stroke[i - 1][1] + 2 * stroke[i][1] + stroke[i + 1][1]) / 4]);
    out.push(stroke[stroke.length - 1]);
    return out;
  }
  /* Slant estimate (dx/dy of steep segments). Writers slant consistently, templates are upright. */
  function estimateShear(strokes) {
    let num = 0, den = 0;
    for (const s of strokes) for (let i = 1; i < s.length; i++) {
      const dx = s[i][0] - s[i - 1][0], dy = s[i][1] - s[i - 1][1], ady = Math.abs(dy);
      if (ady > 1.7 * Math.abs(dx) && ady > 0.2) { num += (dx / dy) * ady; den += ady; }
    }
    if (!den) return 0;
    const sh = Math.max(-0.6, Math.min(0.6, num / den));
    return Math.abs(sh) < 0.04 ? 0 : sh;
  }
  function deskew(strokes, shear) {
    if (!shear) return strokes;
    return strokes.map(s => s.map(p => { const q = p.slice(); q[0] = p[0] - p[1] * shear; return q; }));
  }
  /* strokes: array of arrays of [x,y,...]; opts.deskew removes the sample's own slant (user samples); opts.smooth for real pen input. */
  function prepare(strokes, opts) {
    opts = opts || {};
    if (opts.deskew) strokes = deskew(strokes, estimateShear(strokes));
    const pts = [];
    strokes.forEach((s, id) => { for (const p of (opts.smooth ? smooth(s) : s)) pts.push({ x: p[0], y: p[1], id }); });
    if (!pts.length) return null;
    const bb = bboxPts(pts); const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
    const cloud = thin(normalize(resample(pts, N * 3)), N);
    const xs = new Float64Array(N), ys = new Float64Array(N);
    cloud.forEach((p, i) => { xs[i] = p.x; ys[i] = p.y; });
    return { xs, ys, pts: cloud, aspect: (w + h) > 0 ? w / (w + h) : 0.5, n: strokes.length };
  }
  /* Farthest-point thinning: keeps the ink's shape coverage, so retraced or slow strokes don't weigh more. */
  function thin(pts, k) {
    if (pts.length <= k) return pts;
    const chosen = [pts[0]]; const minD = new Array(pts.length).fill(Infinity);
    while (chosen.length < k) {
      const last = chosen[chosen.length - 1]; let best = -1, bestD = -1;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - last.x, dy = pts[i].y - last.y; const d = dx * dx + dy * dy;
        if (d < minD[i]) minD[i] = d;
        if (minD[i] > bestD) { bestD = minD[i]; best = i; }
      }
      if (bestD <= 0) { chosen.push(pts[best]); continue; }
      chosen.push(pts[best]);
    }
    return chosen;
  }
  /* Greedy cloud matching on flat arrays (first n points), with early exit once the running sum passes `limit`. */
  const matched = new Uint8Array(N);
  function cloudDistance(ax, ay, bx, by, n, start, limit) {
    matched.fill(0, 0, n); let sum = 0, i = start;
    do {
      const x = ax[i], y = ay[i]; let min = Infinity, idx = -1;
      for (let j = 0; j < n; j++) { if (matched[j]) continue; const dx = x - bx[j], dy = y - by[j]; const d = dx * dx + dy * dy; if (d < min) { min = d; idx = j; } }
      matched[idx] = 1;
      sum += (1 - ((i - start + n) % n) / n) * Math.sqrt(min);
      if (sum > limit) return sum;
      i = (i + 1) % n;
    } while (i !== start);
    return sum;
  }
  function greedyMatch(a, b, n, limit) {
    const step = Math.floor(Math.sqrt(n)); let min = limit == null ? Infinity : limit;
    for (let i = 0; i < n; i += step) { min = Math.min(min, cloudDistance(a.xs, a.ys, b.xs, b.ys, n, i, min)); min = Math.min(min, cloudDistance(b.xs, b.ys, a.xs, a.ys, n, i, min)); }
    return min;
  }
  function extras(c, t) { return 3.2 * Math.abs(c.aspect - t.aspect) + 0.7 * Math.min(2, Math.abs(c.n - t.n)); }
  function distance(c, t, limit) {
    const extra = extras(c, t);
    if (limit != null && extra >= limit) return Infinity;
    return greedyMatch(c, t, N, limit == null ? null : limit - extra) + extra;
  }
  /* Coarse distance on the first 16 farthest-point samples (a well-spread subset), scaled to the 32-point range. */
  const N1 = 16;
  function coarseDistance(c, t) { return greedyMatch(c, t, N1, null) * (N / N1) + extras(c, t); }

  /* ---------- templates ---------- */
  const builtin = [];
  for (const [label, variants] of Object.entries(DEF)) for (const strokes of variants) { const c = prepare(strokes); if (c) builtin.push({ label, cloud: c, user: false }); }
  let userTemplates = [];
  IL.hwr = {}; IL.hwr._def = DEF;   /* raw letter shapes, used by the training-data generator */
  IL.hwr.setUserTemplates = function (list) {
    userTemplates = [];
    for (const t of list || []) { const c = prepare(t.strokes || [], { deskew: true, smooth: true }); if (c) userTemplates.push({ label: t.ch, cloud: c, user: true, id: t.id }); }
  };
  IL.hwr.templateCount = () => ({ builtin: builtin.length, user: userTemplates.length });
  IL.hwr.trainLabels = ['a', 'b', 'cC', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'kK', 'lI1', 'm', 'n', 'oO0', 'pP', 'q', 'r', 'sS', 't', 'uU', 'vV', 'wW', 'xX', 'yY', 'zZ', 'A', 'B', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'M', 'N', 'P', 'Q', 'R', 'T', '1', '2', '3', '4', '5', '6', '7', '8', '9', '!', '?', '(', ')'];
  IL.hwr.labelName = label => label.length > 1 ? label.split('').join(' / ') : label;

  /* Returns the best-matching labels for a character's strokes. heightCls ('s' | 't' | 'd') comes from the row geometry when known. */
  function recognizeChar(strokes, heightCls) {
    const c = prepare(strokes, { smooth: true }); if (!c) return [];
    const penalty = t => (heightCls && !heightAllowed(t.label, heightCls) ? 0.9 : 0);
    // stage 1: cheap 16-point pass over every template, keep a shortlist
    const pool = builtin.map(t => ({ t, mult: 1 })).concat(userTemplates.map(t => ({ t, mult: 0.88 })));
    for (const e of pool) e.d1 = coarseDistance(c, e.t.cloud) * e.mult + penalty(e.t);
    pool.sort((a, b) => a.d1 - b.d1);
    const short = pool.slice(0, 12);
    // stage 2: full match on the shortlist with early exit
    const best = new Map(); let cutoff = Infinity;
    for (const e of short) {
      const pen = penalty(e.t); const limit = cutoff === Infinity ? null : (cutoff - pen) / e.mult;
      if (limit != null && limit <= 0) continue;
      const raw = distance(c, e.t.cloud, limit); if (!isFinite(raw)) continue;
      const d = raw * e.mult + pen; if (d >= cutoff) continue;
      const prev = best.get(e.t.label);
      if (prev === undefined || d < prev) { best.set(e.t.label, d); if (best.size >= 4) { const ds = [...best.values()].sort((a, b) => a - b); cutoff = ds[3]; } }
    }
    return [...best.entries()].map(([label, d]) => ({ label, d, score: 1 / (1 + d) })).sort((a, b) => a.d - b.d).slice(0, 4);
  }
  IL.hwr.recognizeChar = recognizeChar;

  /* ---------- segmentation ---------- */
  /* Groups the row's strokes into characters (x-overlap, dots/crossbars) and words (gaps). L = row height. */
  function segmentRow(strokes, L) {
    const items = strokes.map(s => ({ strokes: [s], box: bboxStroke(s) })).sort((a, b) => a.box.x0 - b.box.x0);
    const clusters = [];
    for (const it of items) {
      let merged = false;
      for (let k = clusters.length - 1; k >= Math.max(0, clusters.length - 3); k--) {
        const c = clusters[k];
        const ov = Math.min(c.box.x1, it.box.x1) - Math.max(c.box.x0, it.box.x0);
        const small = it.box.w < 0.22 * L && it.box.h < 0.22 * L;
        const smallC = c.box.w < 0.22 * L && c.box.h < 0.22 * L;
        const minW = Math.min(c.box.w, it.box.w) || 1;
        /* strokes that touch a thin stem (k, H, t, 4) can have zero or slightly negative x-overlap */
        const thin = c.box.w < 0.1 * L || it.box.w < 0.1 * L;
        const vOverlap = Math.min(c.box.y1, it.box.y1) - Math.max(c.box.y0, it.box.y0);
        if (ov > 0.35 * minW || ov > 0.16 * L || (thin && ov > -0.05 * L && vOverlap > 0.25 * L) ||
          (small && it.box.cx > c.box.x0 - 0.12 * L && it.box.cx < c.box.x1 + 0.12 * L && it.box.cy < c.box.cy) ||
          (smallC && c.box.cx > it.box.x0 - 0.12 * L && c.box.cx < it.box.x1 + 0.12 * L && c.box.cy < it.box.cy)) {
          c.strokes.push(...it.strokes); c.box = unionBox(c.box, it.box); merged = true; break;
        }
      }
      if (!merged) clusters.push({ strokes: it.strokes.slice(), box: it.box });
    }
    clusters.sort((a, b) => a.box.x0 - b.box.x0);
    const gaps = [];
    for (let i = 1; i < clusters.length; i++) gaps.push(Math.max(0, clusters[i].box.x0 - clusters[i - 1].box.x1));
    const positive = gaps.filter(g => g > 0).sort((a, b) => a - b);
    const median = positive.length ? positive[Math.floor(positive.length / 2)] : 0;
    const thresh = Math.max(0.30 * L, 2.2 * median);
    const words = [[clusters[0]]];
    for (let i = 1; i < clusters.length; i++) { if (gaps[i - 1] > thresh) words.push([clusters[i]]); else words[words.length - 1].push(clusters[i]); }
    return words;
  }

  function median(arr) { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

  /* ---------- lexicon ---------- */
  const LEX = new Set(('the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did does am hello hi hey note notes notebook page pages list todo meeting call email buy milk bread eggs coffee tea water lunch dinner breakfast today tomorrow yesterday week month morning afternoon evening night home office school class test exam study read write book plan idea ideas project task tasks done start finish next last before again always never often maybe yes okay ok thanks thank please sorry love happy sad great nice small big long short high low old young early late important remember forget check order send pay money price cost total number name date time hour minute second dog cat bird fish tree flower sun moon star sky sea rain snow wind hot cold warm cool red blue green yellow black white pink purple orange brown three four five six seven eight nine ten hundred thousand monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december mom dad family friend friends birthday party gift travel trip car bus train flight hotel city country world house room kitchen door window phone computer internet game music song movie photo picture draw paint color art math science history english german spanish language word words sentence question answer problem solution example chapter lesson homework teacher student doctor hospital health food apple banana rice chicken meat cheese sugar salt cake pizza shopping store market bank card cash key bag box pen paper ink line text font search find open close save delete add remove change move copy paste cut undo redo help learn teach warehouse stock delivery site team boss shift truck pallet item items count report invoice budget sales client customer service quality safety tool tools machine fix build design cover sticker theme light dark mode setting settings very much many more less few little own same different each every both such only here where why who whom whose while during until since without within between among through under above below off down away around still already yet soon later together again almost quite really ever too also just even once twice').split(/\s+/));
  const extraLex = new Set();
  if (IL.lexiconWords) { IL.lexiconWords.split(' ').forEach(w => LEX.add(w)); IL.lexiconWords = null; }   // js/lexicon.js, when loaded before this file
  IL.hwr.addLexicon = words => { (words || '').split(' ').forEach(w => { if (w) LEX.add(w); }); };
  IL.hwr.learnWords = function (text) { (text || '').toLowerCase().match(/[a-z]{3,}/g)?.forEach(w => extraLex.add(w)); };
  IL.hwr.learnedWords = () => [...extraLex];
  const inLex = w => { const l = w.toLowerCase(); return LEX.has(l) || extraLex.has(l); };

  /* ---------- word assembly ---------- */
  function rowGeometry(clusters, L, rowTop) {
    const heights = clusters.map(c => c.box.h), bottoms = clusters.map(c => c.box.y1);
    let base = median(bottoms);
    const core = bottoms.filter(b => b < base + 0.12 * L); if (core.length) base = median(core);
    return { medH: median(heights), maxH: Math.max(...heights), base, rowTop };
  }
  function charGeo(c, g, L) {
    const h = c.box.h;
    const tall = h > 0.56 * L || (h > 0.8 * g.maxH && g.maxH > 1.35 * g.medH);
    const desc = c.box.y1 > g.base + 0.14 * L;
    return { tall, desc, cls: desc ? 'd' : tall ? 't' : 's', h, top: c.box.y0, bottom: c.box.y1 };
  }
  /* Simple marks that don't need the matcher. */
  function punctuationFor(c, g, L) {
    const { w, h } = c.box;
    if (Math.max(w, h) < 0.09 * L) return c.box.y1 > g.rowTop + 0.6 * L ? '.' : "'";
    if (h < 0.1 * L && w > 0.22 * L) return '-';
    if (w < 0.12 * L && h < 0.26 * L) return c.box.y0 > g.rowTop + 0.55 * L ? ',' : "'";
    return null;
  }
  function resolveLabel(label, geo, ctx) {
    if (ctx.digits && DIGIT_OF[label]) return DIGIT_OF[label];
    if (label.length === 1) {
      if (ctx.upper && TALL_OF[label] && geo.tall) return TALL_OF[label];
      if (!geo.tall && SHORT_OF[label] && !ctx.upper) return SHORT_OF[label];
      return label;
    }
    switch (label) {
      case 'lI1': return ctx.digits ? '1' : (ctx.single || ctx.upper) ? 'I' : 'l';
      case 'oO0': return ctx.digits ? '0' : (geo.tall || ctx.upper) ? 'O' : 'o';
      case 'pP': return geo.desc ? 'p' : 'P';
      case 'yY': return geo.desc ? 'y' : 'Y';
      case 'kK': return ctx.upper ? 'K' : 'k';
      default: return (geo.tall || ctx.upper) ? label[1] : label[0];
    }
  }
  function assembleWord(chars, g, L) {
    const n = chars.length;
    /* chars: [{cands:[{label,score}], geo, punct}] */
    const digitVotes = chars.filter(c => !c.punct && c.cands[0] && (DIGIT_LABELS.has(c.cands[0].label))).length;
    const letterVotes = chars.filter(c => !c.punct && c.cands[0] && !DIGIT_LABELS.has(c.cands[0].label) && !['lI1', 'oO0'].includes(c.cands[0].label)).length;
    const digits = digitVotes > 0 && digitVotes >= letterVotes;
    const upperVotes = chars.filter(c => !c.punct && c.cands[0] && (UPPER_DISTINCT.has(c.cands[0].label) || (c.cands[0].label.length > 1 && !['lI1', 'kK', 'pP', 'yY'].includes(c.cands[0].label) && c.geo.tall))).length;
    const caseable = chars.filter(c => !c.punct && c.cands[0] && !DIGIT_LABELS.has(c.cands[0].label)).length;
    const upper = caseable > 0 && upperVotes >= Math.max(1, Math.ceil(caseable * 0.6));
    const ctx = { digits, upper, single: n === 1 };
    const build = pick => chars.map((c, i) => c.punct ? c.punct : (c.cands[pick[i]] ? resolveLabel(c.cands[pick[i]].label, c.geo, ctx) : '')).join('');
    const scoreOf = pick => chars.reduce((s, c, i) => s + (c.punct ? 0 : Math.log(c.cands[pick[i]] ? c.cands[pick[i]].score : 1e-3)), 0);
    const base = chars.map(() => 0);
    const bestWord = build(base), bestScore = scoreOf(base);
    if (inLex(bestWord) || digits) return bestWord;
    /* try nearby alternatives (one or two substitutions) for a lexicon word */
    let found = null, foundScore = -Infinity;
    const tryPick = pick => { const w = build(pick); if (inLex(w)) { const s = scoreOf(pick); if (s > foundScore) { foundScore = s; found = w; } } };
    for (let i = 0; i < n; i++) { if (chars[i].punct) continue; for (let a = 1; a < Math.min(3, chars[i].cands.length); a++) { const p = base.slice(); p[i] = a; tryPick(p); } }
    if (!found && n <= 8) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if (chars[i].punct || chars[j].punct) continue; for (let a = 1; a < Math.min(3, chars[i].cands.length); a++) for (let b = 1; b < Math.min(3, chars[j].cands.length); b++) { const p = base.slice(); p[i] = a; p[j] = b; tryPick(p); } }
    }
    // only prefer a dictionary word when it is nearly as good a shape match as the raw reading
    if (found && foundScore > bestScore - (n <= 2 ? 0.25 : 0.45) * n) return found;
    return bestWord;
  }

  /* ---------- neural engine: the CRNN in js/crnn.js reads a whole word at once ---------- */
  let mode = 'neural';                         // 'neural' | 'classic'
  IL.hwr.setMode = m => { mode = m === 'classic' ? 'classic' : 'neural'; };
  IL.hwr.getMode = () => mode;
  IL.hwr.neuralReady = () => !!(IL.crnn && IL.crnn.ready());
  function editDistance(a, b) {
    const dp = new Array(b.length + 1); for (let j = 0; j <= b.length; j++) dp[j] = j;
    for (let i = 1; i <= a.length; i++) { let prev = dp[0]; dp[0] = i; for (let j = 1; j <= b.length; j++) { const cur = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } }
    return dp[b.length];
  }
  /* dictionary words close to the reading, in the reading's casing */
  function nearLex(word) {
    const core = word.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ]+$/g, ''); if (core.length < 3) return [];
    const lead = word.slice(0, word.indexOf(core)), trail = word.slice(word.indexOf(core) + core.length);
    const low = core.toLowerCase(); const maxD = core.length >= 6 ? 2 : 1; const out = [];
    const recase = w => core === core.toUpperCase() && core.length > 1 ? w.toUpperCase() : core[0] === core[0].toUpperCase() && core[0] !== core[0].toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w;
    const consider = w => { if (Math.abs(w.length - low.length) > maxD || w === low || w[0] !== low[0] && w[w.length - 1] !== low[low.length - 1] && maxD < 2) return; const d = editDistance(w, low); if (d <= maxD) out.push({ text: lead + recase(w) + trail, d }); };
    LEX.forEach(consider); extraLex.forEach(consider);
    out.sort((a, b) => a.d - b.d); return out.slice(0, 16);
  }
  const AMBIG = /[cosuvwxzmnpCOSUVWXZMNP]/;
  /* letters whose upper and lower case look alike get their case from their height within the line */
  function fixCase(text, clusters, g, L) {
    if (!AMBIG.test(text)) return text;
    const core = clusters.filter(c => c.box.w > 0.1 * L || c.box.h > 0.2 * L);   // ignore dots and ticks
    if (core.length === text.length && core.length > 0) {           // printed letters: one cluster per character
      const sorted = core.slice().sort((a, b) => a.box.x0 - b.box.x0);
      return text.split('').map((ch, i) => {
        const geo = charGeo(sorted[i], g, L); const lo = ch.toLowerCase(), up = ch.toUpperCase();
        if (/[cosuvwxzmn]/i.test(ch)) return geo.tall ? up : lo;
        if (/p/i.test(ch)) return geo.desc ? 'p' : (geo.tall ? 'P' : ch);
        return ch;
      }).join('');
    }
    const mixed = g.maxH > 1.35 * g.medH;
    let y0 = Infinity, y1 = -Infinity; for (const c of core.length ? core : clusters) { if (c.box.y0 < y0) y0 = c.box.y0; if (c.box.y1 > y1) y1 = c.box.y1; }
    const h = y1 - y0;
    if (mixed && h < 1.25 * g.medH && h < 0.5 * L) return text.replace(/[COSUVWXZMN]/g, ch => ch.toLowerCase());
    // joined-up writing: judge the first letter by the ink height at the start of the word against the rest of it
    if (/^[cosuvwxzmnCOSUVWXZMN]/.test(text) && text.length > 1) {
      const pts = clusters.flatMap(c => c.strokes.flatMap(s => s.pts)); let x0 = Infinity, x1 = -Infinity; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; }
      const bin = Math.max(2, (x1 - x0) / Math.max(4, text.length * 2)); const n = Math.ceil((x1 - x0) / bin) + 1; const top = new Array(n).fill(Infinity), bot = new Array(n).fill(-Infinity);
      for (const p of pts) { const i = Math.min(n - 1, Math.floor((p[0] - x0) / bin)); if (p[1] < top[i]) top[i] = p[1]; if (p[1] > bot[i]) bot[i] = p[1]; }
      const hs = []; for (let i = 0; i < n; i++) if (isFinite(top[i])) hs.push(bot[i] - top[i]);
      const first = Math.max(1, Math.round(hs.length / text.length));
      const h1 = Math.max(...hs.slice(0, first)); const rest = hs.slice(first).sort((a, b) => a - b); const hr = rest.length ? rest[rest.length >> 1] : h1;
      if (hr > 0 && h1 > 1.45 * hr && !/[A-Z]/.test(text.slice(1))) return text[0].toUpperCase() + text.slice(1);
      if (hr > 0 && h1 < 1.15 * hr && /^[COSUVWXZMN]/.test(text) && /^[A-Z][a-zà-ÿ]/.test(text)) return text[0].toLowerCase() + text.slice(1);
    }
    return text;
  }
  /* digits inside a word of letters (and the reverse) are usually look-alikes: 0/O, 1/l, 5/S, 9/g … */
  const D2L_LOW = { '0': 'o', '1': 'l', '5': 's', '9': 'g', '2': 'z', '8': 'B', '6': 'b' }, D2L_UP = { '0': 'O', '1': 'I', '5': 'S', '2': 'Z', '8': 'B', '6': 'G', '9': 'g' };
  const L2D = { o: '0', O: '0', l: '1', I: '1', i: '1', s: '5', S: '5', g: '9', q: '9', z: '2', Z: '2', B: '8', b: '6', G: '6', D: '0', Q: '0' };
  function fixDigits(text) {
    const letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length, digits = (text.match(/[0-9]/g) || []).length;
    if (!letters || !digits) return text;
    if (/^\d+(st|nd|rd|th|er|te|s|x|m|cm|mm|kg|g|h|min|pm|am|k|K|M|€|\$|%)$/.test(text) || /^[A-Za-z]\d+$/.test(text) || /^\d+[A-Za-z]$/.test(text)) return text;
    const upper = (text.match(/[A-Z]/g) || []).length > (text.match(/[a-z]/g) || []).length;
    const asLetters = text.replace(/[0-9]/g, d => (upper ? D2L_UP : D2L_LOW)[d] || d);
    if (!/[0-9]/.test(asLetters) && inLex(asLetters.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ]+$/g, ''))) return asLetters;   // "e99s" → "eggs"
    if (letters >= 2 && letters > digits) return asLetters;
    if (digits >= 2 && digits > letters && [...text].every(ch => /[0-9.,:\-\/%€$]/.test(ch) || L2D[ch])) return text.replace(/[A-Za-z]/g, ch => L2D[ch] || ch);
    return text;
  }
  /* the network's reading of a word is cached by the strokes that form it, so a line is not re-read in full after every new stroke */
  const neuralCache = new Map(); const CACHE_MAX = 96;
  /* a word written in one case rarely mixes: stray look-alike letters follow the majority */
  function fixMixedCase(text) {
    const up = (text.match(/[A-ZÀ-Ý]/g) || []).length, lo = (text.match(/[a-zà-ÿ]/g) || []).length;
    if (up >= 2 && up >= 2 * lo && lo > 0) return text.replace(/[cosuvwxzkmnpij]/g, ch => ch.toUpperCase());
    if (lo >= 2 && lo >= 2 * up && up > 0) return text[0] + text.slice(1).replace(/[COSUVWXZKMNP]/g, ch => ch.toLowerCase());
    return text;
  }
  function neuralWord(clusters, g, L) {
    if (clusters.length === 1) { const p = punctuationFor(clusters[0], g, L); if (p) return p; }
    const strokes = clusters.flatMap(c => c.strokes);
    const key = strokes.map(s => (s.at || 0) + ':' + s.pts.length + ':' + Math.round(s.pts[0][0] * 2) + ',' + Math.round(s.pts[0][1] * 2) + ',' + Math.round(s.pts[s.pts.length - 1][0] * 2)).join('|');
    const ver = IL.crnn.version || 0; if (ver !== neuralCache.ver) { neuralCache.clear(); neuralCache.ver = ver; }   // adapted weights: forget old reads
    let r = neuralCache.get(key);
    if (r === undefined) {
      r = IL.crnn.recognize(strokes, { width: 8, keepLogits: true }) || null;
      neuralCache.set(key, r); if (neuralCache.size > CACHE_MAX) neuralCache.delete(neuralCache.keys().next().value);
    } else if (r) { neuralCache.delete(key); neuralCache.set(key, r); }
    if (!r || !r.text || !r.text.trim()) return null;
    const best = r.alts[0] || { text: r.text, score: r.score };
    const cands = new Map(); r.alts.slice(0, 6).forEach(a => { if (a.text.trim()) cands.set(a.text, { score: a.score, d: 0 }); });
    for (const c of nearLex(best.text)) if (!cands.has(c.text)) cands.set(c.text, { score: IL.crnn.score(r.logp, r.T, r.C, c.text), d: c.d });
    let pick = best.text, pickScore = -Infinity;
    for (const [w, c] of cands) { let v = c.score; const core = w.replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9]+$/g, ''); if (core.length >= 2 && inLex(core)) v += c.d >= 2 ? 0.8 : 1.2; if (v > pickScore) { pickScore = v; pick = w; } }
    return fixCase(fixMixedCase(fixDigits(pick.trim())), clusters, g, L);
  }

  /* Recognizes one ruled row of ink with the built-in engine. Returns words in left-to-right order with the
     indices of the strokes that formed each word and its x-range. rowTop/L in the same units as the strokes. */
  function recognizeRowWords(strokes, rowTop, L) {
    if (!strokes.length) return { words: [] };
    let tagged = strokes.map((s, i) => ({ pts: s.pts, _i: i, at: s.at || 0 }));
    const shear = estimateShear(tagged.map(s => s.pts));
    if (shear) tagged = tagged.map(s => ({ pts: deskew([s.pts], shear)[0], _i: s._i, at: s.at }));
    const words = segmentRow(tagged, L);
    const all = words.flat();
    const g = rowGeometry(all, L, rowTop);
    const neural = mode === 'neural' && IL.crnn && IL.crnn.ready();
    const out = [];
    for (const word of words) {
      let text = null;
      if (neural) { try { text = neuralWord(word, g, L); } catch (e) { text = null; } }
      if (text == null) {
        const chars = word.map(c => {
          const geo = charGeo(c, g, L);
          const punct = punctuationFor(c, g, L);
          if (punct) return { punct, cands: [], geo };
          return { punct: null, cands: recognizeChar(c.strokes.map(s => s.pts), geo.cls), geo };
        });
        text = assembleWord(chars, g, L);
      }
      const idx = word.flatMap(c => c.strokes.map(s => s._i));
      let x0 = Infinity, x1 = -Infinity, last = 0;
      for (const i of idx) { for (const p of strokes[i].pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; } if (strokes[i].at > last) last = strokes[i].at; }
      if (text) out.push({ text, idx, x0, x1, lastAt: last });
    }
    return { words: out };
  }
  function recognizeRowBuiltin(strokes, rowTop, L) { return recognizeRowWords(strokes, rowTop, L).words.map(w => w.text).join(' '); }
  IL.hwr.recognizeRowWords = recognizeRowWords;
  IL.hwr.recognizeRowBuiltin = recognizeRowBuiltin;

  /* ---------- system engine (Handwriting Recognition API) ---------- */
  let nativeState = null; // null = unknown, false = unavailable, object = ready
  async function nativeReady() {
    if (nativeState !== null) return nativeState;
    try {
      if (!('createHandwritingRecognizer' in navigator)) { nativeState = false; return false; }
      if (navigator.queryHandwritingRecognizer) { const q = await navigator.queryHandwritingRecognizer({ languages: ['en'] }); if (!q) { nativeState = false; return false; } }
      const rec = await navigator.createHandwritingRecognizer({ languages: ['en'] });
      nativeState = { rec }; return nativeState;
    } catch (e) { nativeState = false; return false; }
  }
  IL.hwr.nativeAvailable = async () => !!(await nativeReady());
  async function recognizeRowNative(strokes) {
    const st = await nativeReady(); if (!st) return null;
    try {
      const drawing = st.rec.startDrawing({ recognitionType: 'text', inputType: 'stylus', alternatives: 1 });
      for (const s of strokes) {
        const hs = new HandwritingStroke();
        s.pts.forEach((p, i) => hs.addPoint({ x: p[0], y: p[1], t: Math.round(p[3] != null ? p[3] : i * 8) }));
        drawing.addStroke(hs);
      }
      const preds = await drawing.getPrediction();
      return preds && preds[0] && preds[0].text ? preds[0].text.trim() : null;
    } catch (e) { return null; }
  }

  IL.hwr.recognizeRow = async function (strokes, rowTop, L, opts) {
    opts = opts || {};
    if (opts.preferNative !== false) { const t = await recognizeRowNative(strokes); if (t) return t; }
    return recognizeRowBuiltin(strokes, rowTop, L);
  };
  IL.hwr.engineName = async () => (await nativeReady()) ? 'System handwriting engine (supports joined-up writing)' : 'Inkleaf built-in engine (best with printed letters; teach it your handwriting for better results)';
})();
