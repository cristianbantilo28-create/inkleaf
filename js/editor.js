/* Inkleaf — notebook editor: ruled pages with ink, typed/converted text rows, photos and video chips.
   Page space is 800 x 1132 logical units; everything is scaled by --s for display. */
(function () {
  const IL = (window.IL = window.IL || {});
  const PAGE = { W: 800, H: 1132, top: 76, bottom: 44, left: 64, right: 36 };
  const SPACING = { narrow: 28, medium: 34, wide: 42 };
  const SIZES = { small: 0.52, medium: 0.62, large: 0.74 };
  const FONTS = [
    { key: 'Caveat', css: "'Caveat', 'Segoe Print', cursive", label: 'Caveat' },
    { key: 'Patrick Hand', css: "'Patrick Hand', 'Segoe Print', cursive", label: 'Patrick Hand' },
    { key: 'Kalam', css: "'Kalam', cursive", label: 'Kalam' },
    { key: 'Indie Flower', css: "'Indie Flower', cursive", label: 'Indie Flower' },
    { key: 'Architects Daughter', css: "'Architects Daughter', cursive", label: 'Architects Daughter' },
    { key: 'Shadows Into Light', css: "'Shadows Into Light', cursive", label: 'Shadows Into Light' },
    { key: 'Gloria Hallelujah', css: "'Gloria Hallelujah', cursive", label: 'Gloria Hallelujah' },
    { key: 'Homemade Apple', css: "'Homemade Apple', cursive", label: 'Homemade Apple' },
    { key: 'Nanum Pen Script', css: "'Nanum Pen Script', cursive", label: 'Nanum Pen' },
    { key: 'Figtree', css: "'Figtree', system-ui, sans-serif", label: 'Figtree (sans)' },
    { key: 'Lora', css: "'Lora', Georgia, serif", label: 'Lora (serif)' },
    { key: 'Courier Prime', css: "'Courier Prime', 'Courier New', monospace", label: 'Courier (mono)' },
    { key: 'System', css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", label: 'System' }
  ];
  const PEN_COLORS = ['#1B1F2A', '#2D4FC9', '#C8402E', '#1F8A4C', '#7A3FB8', '#E06C00'];
  const PEN_WIDTHS = [1.6, 2.6, 4.2];
  const TEXT_COLORS = ['#1B1F2A', '#2D4FC9', '#C8402E', '#1F8A4C', '#7A3FB8', '#8B5A2B', '#5B6372'];
  const ZOOM_MIN = 0.6, ZOOM_MAX = 4;

  const fontCss = key => (FONTS.find(f => f.key === key) || FONTS[0]).css;
  const rowsCount = L => Math.floor((PAGE.H - PAGE.top - PAGE.bottom) / L);
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDuration = sec => { if (!isFinite(sec) || sec == null) return ''; sec = Math.round(sec); const m = Math.floor(sec / 60), s = sec % 60; return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' : m + ':') + String(s).padStart(2, '0'); };
  const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';

  function defaultSettings() { return { font: 'Caveat', size: 'medium', color: '#1B1F2A', paper: 'ruled', spacing: 'medium', marginLine: true }; }
  function newPage(notebookId, index, L) { return { id: IL.uid(), notebookId, index, rows: Array(rowsCount(L)).fill(''), strokes: [], media: [] }; }
  function strokeBox(s) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of s.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; }
  function widthAt(stroke, p) { return stroke.width * (0.55 + 0.9 * (p[2] == null ? 0.5 : p[2])); }
  /* even-odd point-in-polygon (ray casting) for the lasso */
  function pointInPoly(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
  const HL_COLORS = ['#FFE66D', '#B5F2A5', '#FFB5D8', '#A5D8FF', '#FFC98A'];
  /* Highlighter: one constant-width translucent path (drawn in a single stroke so overlaps don't darken). */
  function drawHighlight(ctx, st) {
    const pts = st.pts; if (!pts.length) return;
    ctx.save(); ctx.globalAlpha = 0.38; ctx.strokeStyle = st.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = st.width;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const mid = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; ctx.quadraticCurveTo(pts[i][0], pts[i][1], mid[0], mid[1]); }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke(); ctx.restore();
  }
  /* ---------- pen styles ---------- */
  const PEN_STYLES = [
    { key: 'ball', label: 'Ballpoint', hint: 'Ballpoint: even line, a little pressure' },
    { key: 'fine', label: 'Fine liner', hint: 'Fine point: thin, crisp, constant line' },
    { key: 'marker', label: 'Marker', hint: 'Marker (Sharpie): bold, opaque' },
    { key: 'brush', label: 'Brush pen', hint: 'Brush: width follows pressure and speed, tapered ends' },
    { key: 'fountain', label: 'Fountain pen', hint: 'Fountain pen: swells gently with pressure, thins when fast' },
    { key: 'callig', label: 'Calligraphy', hint: 'Calligraphy: chisel nib, thick and thin by direction' },
    { key: 'pencil', label: 'Pencil', hint: 'Pencil: soft, grainy graphite' }
  ];
  const NIB = 35 * Math.PI / 180;                     // chisel-nib angle for the calligraphy pen
  const hash01 = i => { let x = (i * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x & 0xffff) / 65535; };
  /* per-point speed in page units per ms, lightly smoothed */
  function speeds(pts) {
    const v = new Array(pts.length).fill(0.8);
    for (let i = 1; i < pts.length; i++) { const dt = pts[i][3] != null && pts[i - 1][3] != null ? Math.max(1, pts[i][3] - pts[i - 1][3]) : 12; v[i] = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / dt; }
    if (pts.length > 1) v[0] = v[1];
    for (let k = 0; k < 2; k++) for (let i = 1; i < v.length - 1; i++) v[i] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4;
    return v;
  }
  /* half widths along a stroke for the variable-width pens */
  function halfWidths(st) {
    const pts = st.pts, w = st.width, n = pts.length, v = speeds(pts); const hw = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i][2] == null ? 0.5 : pts[i][2]; const sp = Math.min(1, v[i] / 1.6);
      let d;
      if (st.pen === 'brush') d = w * 1.45 * (0.25 + 1.55 * p) * (1.15 - 0.6 * sp);
      else d = w * 0.95 * (0.62 + 0.76 * p) * (1.08 - 0.3 * sp);          // fountain
      hw[i] = d / 2;
    }
    for (let k = 0; k < 2; k++) for (let i = 1; i < n - 1; i++) hw[i] = (hw[i - 1] + 2 * hw[i] + hw[i + 1]) / 4;
    if (st.pen === 'brush') { const tap = Math.min(4, Math.floor(n / 3)); for (let i = 0; i < tap; i++) { const f = 0.25 + 0.75 * (i + 1) / (tap + 1); hw[i] *= f; hw[n - 1 - i] *= f; } }
    return hw;
  }
  /* fills a ribbon of varying half width around the polyline; `from` draws only the tail (live drawing) */
  function ribbon(ctx, pts, hw, from, caps) {
    const n = pts.length; if (n < 2) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], hw[0], 0, 6.2832); ctx.fill(); return; }
    const i0 = Math.max(0, (from || 1) - 2); const left = [], right = [];
    for (let i = i0; i < n; i++) {
      const p = pts[i]; const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const h = hw[i]; left.push([p[0] - dy * h, p[1] + dx * h]); right.push([p[0] + dy * h, p[1] - dx * h]);
    }
    ctx.beginPath(); ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath(); ctx.fill();
    if (caps !== 'flat') for (let i = i0; i < n; i++) { if (hw[i] > 0.25) { ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], hw[i], 0, 6.2832); ctx.fill(); } }
  }
  /* chisel nib: the ribbon is offset along a fixed nib direction, so the width changes with the stroke direction by itself */
  function chisel(ctx, pts, half, from) {
    const n = pts.length; const nx = Math.cos(NIB) * half, ny = -Math.sin(NIB) * half;
    if (n < 2) { ctx.beginPath(); ctx.moveTo(pts[0][0] - nx, pts[0][1] - ny); ctx.lineTo(pts[0][0] + nx, pts[0][1] + ny); ctx.lineWidth = half * 0.5; ctx.lineCap = 'round'; ctx.stroke(); return; }
    const i0 = Math.max(0, (from || 1) - 2);
    for (let i = i0 + 1; i < n; i++) {
      const a = pts[i - 1], b = pts[i];
      ctx.beginPath(); ctx.moveTo(a[0] - nx, a[1] - ny); ctx.lineTo(b[0] - nx, b[1] - ny); ctx.lineTo(b[0] + nx, b[1] + ny); ctx.lineTo(a[0] + nx, a[1] + ny); ctx.closePath(); ctx.fill();
    }
    // a thin stroke along the nib edges keeps the hairlines from vanishing when the pen moves along the nib
    ctx.lineWidth = Math.max(0.6, half * 0.22); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[i0][0], pts[i0][1]); for (let i = i0 + 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  }
  function smoothPath(ctx, pts, from, widthFn) {
    let i = Math.max(1, from || 1); let prev = pts[i - 1];
    let start = i === 1 ? prev : [(pts[i - 2][0] + prev[0]) / 2, (pts[i - 2][1] + prev[1]) / 2];
    for (; i < pts.length; i++) {
      const cur = pts[i]; const mid = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2];
      ctx.lineWidth = widthFn(cur, i);
      ctx.beginPath(); ctx.moveTo(start[0], start[1]); ctx.quadraticCurveTo(prev[0], prev[1], mid[0], mid[1]); ctx.stroke();
      start = mid; prev = cur;
    }
    ctx.beginPath(); ctx.moveTo(start[0], start[1]); ctx.lineTo(prev[0], prev[1]); ctx.stroke();
  }
  function drawStroke(ctx, st, from) {
    if (st.kind === 'hl') { if (from) return; drawHighlight(ctx, st); return; }
    const pts = st.pts; if (!pts.length) return;
    const pen = st.pen || 'ball';
    ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (pen === 'brush' || pen === 'fountain') { ribbon(ctx, pts, halfWidths(st), from); return; }
    if (pen === 'callig') { chisel(ctx, pts, st.width * 1.15, from); return; }
    if (pen === 'pencil') {
      ctx.save(); ctx.globalAlpha = 0.5;
      const base = st.width * 0.9;
      if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], base / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
      smoothPath(ctx, pts, from, p => base * (0.72 + 0.56 * (p[2] == null ? 0.5 : p[2])));
      ctx.globalAlpha = 0.22;                              // two faint, slightly offset passes give the graphite grain
      for (let pass = 0; pass < 2; pass++) { const off = pts.map((p, i) => [p[0] + (hash01(i * 7 + pass * 3) - 0.5) * base * 0.9, p[1] + (hash01(i * 11 + pass * 5) - 0.5) * base * 0.9, p[2], p[3]]); smoothPath(ctx, off, from, () => base * 0.55); }
      ctx.restore(); return;
    }
    const wf = pen === 'fine' ? () => st.width * 0.7 : pen === 'marker' ? () => st.width * 2.4 : p => widthAt(st, p);
    if (pen === 'marker') { ctx.save(); ctx.globalAlpha = 0.97; }
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], wf(pts[0]) / 2, 0, Math.PI * 2); ctx.fill(); if (pen === 'marker') ctx.restore(); return; }
    smoothPath(ctx, pts, from, wf);
    if (pen === 'marker') ctx.restore();
  }

  class Editor {
    constructor(app) {
      this.app = app;
      this.view = document.getElementById('view-notebook');
      this.scroller = document.getElementById('page-scroller');
      this.stage = document.getElementById('page-stage');
      this.mediaActions = document.getElementById('media-actions');
      this.lassoActions = document.getElementById('lasso-actions');
      this.lassoSel = null; this.lassoDraw = null; this.lassoDrag = null; this.inkClipboard = null; this.textClipboard = null;   // lasso: picked-up strokes/words/photos, the loop being drawn, a drag in progress, copied ink and words
      this.tool = 'pen'; this.penColor = PEN_COLORS[0]; this.penWidth = PEN_WIDTHS[1]; this.hlColor = HL_COLORS[0]; this.penStyle = 'ball';
      this.zoom = 1; this.s = 1; this.dpr = Math.min(3, window.devicePixelRatio || 1);
      this.nb = null; this.pages = []; this._pageIndex = 0;
      this.sheets = []; this.active = 0; this.focus = 0;        // sheets: the page(s) on screen; active: the sheet page-level calls refer to; focus: the one the person works on
      this.highlightsByPage = null; this.touches = new Map(); this.penActive = false;
      this.mctx = document.createElement('canvas').getContext('2d');
      this.bind();
    }
    get L() { return SPACING[this.nb.settings.spacing] || SPACING.medium; }
    get page() { return this.pages[this.pageIndex]; }
    get rowW() { return PAGE.W - PAGE.left - PAGE.right; }
    get pageIndex() { return this._pageIndex; }
    set pageIndex(v) { this._pageIndex = v; }
    /* ---------- sheets: one page on screen, or two side by side on a wide landscape screen ---------- */
    get sheet() { return this.sheets[this.active]; }
    get pageEl() { const sh = this.sheet; return sh ? sh.pageEl : null; }
    get rowsEl() { const sh = this.sheet; return sh ? sh.rowsEl : null; }
    get canvas() { const sh = this.sheet; return sh ? sh.canvas : null; }
    get ctx() { const sh = this.sheet; return sh ? sh.ctx : null; }
    get mediaLayer() { const sh = this.sheet; return sh ? sh.mediaLayer : null; }
    get chipLayer() { const sh = this.sheet; return sh ? sh.chipLayer : null; }
    get previewLayer() { const sh = this.sheet; return sh ? sh.previewLayer : null; }
    get lassoLayer() { const sh = this.sheet; return sh ? sh.lassoLayer : null; }
    get tf() { const sh = this.sheet; return sh ? sh.tf : null; }
    get lv() { const sh = this.sheet; return sh ? sh.lv : null; }
    set lv(v) { const sh = this.sheet; if (sh) sh.lv = v; }
    get highlights() { return this.highlightsByPage ? this.highlightsByPage.get(this.pageIndex) || null : null; }
    spreadMode() { return this.app.settings.spread !== false && window.innerWidth > window.innerHeight && window.innerWidth >= 900; }
    spreadBase(i) { return this.spreadMode() ? i - (i % 2) : i; }
    slotOfPage(i) { return this.sheets.findIndex(sh => sh.pageIndex === i); }
    /* the person touched this sheet: it becomes the one the toolbar, caret and Enter act on */
    activate(slot) {
      const sh = this.sheets[slot]; if (!sh) return;
      const changed = slot !== this.focus;
      this.active = slot; this.focus = slot; this._pageIndex = sh.pageIndex;
      if (changed) {
        this.nb.lastPage = sh.pageIndex; this.app.saveNotebookSoon(this.nb);
        this.sheets.forEach((o, k) => { o.pageEl.classList.toggle('is-active', k === slot); if (k !== slot && o.tf && o.tf.selected()) { o.tf.select(null); this.mediaActions.hidden = true; } });
        if (this.lassoSel && this.lassoSel.sheet !== sh) this.clearLasso();
        this.eachSheet(() => this.renderCaret()); this.updateUndoButtons(); this.updatePager();
        this.app.onPageChanged && this.app.onPageChanged();
      }
    }
    /* runs fn with page-level calls pointing at another sheet, then restores the context */
    using(slot, fn) {
      const sh = this.sheets[slot]; if (!sh) return undefined;
      const pa = this.active, pi = this._pageIndex; this.active = slot; this._pageIndex = sh.pageIndex;
      try { return fn(sh); } finally { this.active = pa; this._pageIndex = pi; }
    }
    eachSheet(fn) { this.sheets.forEach((sh, k) => this.using(k, () => fn(sh, k))); }
    /* true when the sheet captured at the start of an async step is still on screen */
    sheetLive(sh) { return this.sheets.includes(sh); }

    /* ---------- lifecycle ---------- */
    async open(nb, opts) {
      await this.flush();
      if (!this._styleLoaded) { this._styleLoaded = true; try { this.setPenStyle(await IL.db.kvGet('penStyle', 'ball'), true); } catch (e) {} }
      this.nb = nb; nb.settings = Object.assign(defaultSettings(), nb.settings || {});
      let pages = await IL.db.allBy('pages', 'byNotebook', nb.id);
      pages.sort((a, b) => a.index - b.index);
      if (!pages.length) { pages = [newPage(nb.id, 0, this.L)]; await IL.db.put('pages', pages[0]); }
      this._sid = this._sid || 0;
      pages.forEach(p => { p.media = p.media || []; p.strokes = p.strokes || []; p.strokes.forEach(st => this.strokeId(st)); p._undo = []; p._redo = []; });
      this.pages = pages; this.normalizeRows();
      this.pageIndex = Math.min(nb.lastPage || 0, pages.length - 1);
      pages.forEach(p => p.rows.forEach(r => IL.hwrClient.learnWords(r)));
      IL.hwrClient.boot();
      document.getElementById('nb-title').textContent = nb.title;
      this.applyStyle(); this.renderPage(); this.updatePager(); this.setTool(this.tool);
      if (opts && opts.measure) { this.view.classList.add('measuring'); this.view.hidden = false; this.fitZoom(); this.layout(); return; } // laid out but still covered (opening animation)
      this.app.showView('notebook');
      requestAnimationFrame(() => { this.fitZoom(); this.layout(); });
    }
    /* on narrow screens start zoomed in enough that a ruled row is at least ~20px tall */
    fitZoom() { const fit = this.fitScale(); this.zoom = fit * this.L < 20 ? Math.min(2.2, 20 / (fit * this.L)) : 1; }
    async close() { await this.flush(); }
    normalizeRows() {
      const n = rowsCount(this.L);
      for (let i = 0; i < this.pages.length; i++) {
        const p = this.pages[i];
        if (p.rows.length < n) p.rows = p.rows.concat(Array(n - p.rows.length).fill(''));
        else if (p.rows.length > n) {
          const extra = p.rows.slice(n).filter(Boolean); p.rows = p.rows.slice(0, n);
          if (extra.length) { const np = newPage(this.nb.id, i + 1, this.L); extra.forEach((t, k) => { if (k < np.rows.length) np.rows[k] = t; }); np._undo = []; np._redo = []; this.pages.splice(i + 1, 0, np); this.pages.forEach((q, k) => q.index = k); this.markDirty(np); }
          this.markDirty(p);
        }
      }
    }
    applyStyle() {
      const st = this.nb.settings; const root = this.stage;
      root.style.setProperty('--note-font', fontCss(st.font));
      root.style.setProperty('--note-color', st.color);
      root.style.setProperty('--fs', SIZES[st.size] || SIZES.medium);
      root.style.setProperty('--L', this.L); root.style.setProperty('--top', PAGE.top); root.style.setProperty('--bottom', PAGE.bottom);
      root.style.setProperty('--left', PAGE.left); root.style.setProperty('--rowW', this.rowW); root.style.setProperty('--W', PAGE.W); root.style.setProperty('--H', PAGE.H);
      root.style.setProperty('--rows', rowsCount(this.L));
      this.refreshPageClasses();
      this.mctx.font = `${this.L * (SIZES[st.size] || SIZES.medium)}px ${fontCss(st.font)}`;
      document.fonts && document.fonts.load(this.mctx.font).catch(() => {});
    }
    pageClass() { const st = this.nb.settings; return `page paper-${st.paper} tool-${this.tool} engine-${this.app.settings.engine === 'system' ? 'system' : 'inkleaf'}`; }
    applyEngine() { this.refreshPageClasses(); }
    refreshPageClasses() { const cls = this.pageClass(); this.sheets.forEach((sh, k) => { sh.pageEl.className = cls + (k === this.focus ? ' is-active' : ''); }); }
    settingsChanged() { const oldRows = rowsCount(this.L); this.applyStyle(); if (rowsCount(this.L) !== oldRows || true) { this.normalizeRows(); this.pageIndex = Math.min(this.pageIndex, this.pages.length - 1); } this.renderPage(); this.layout(); this.updatePager(); this.app.saveNotebook(this.nb); }

    /* ---------- rendering ---------- */
    renderPage() {
      this.lassoSel = null; this.lassoDraw = null; this.lassoDrag = null; if (this.lassoActions) this.lassoActions.hidden = true;
      this.stage.innerHTML = ''; this.sheets = [];
      const spread = this.spreadMode(); this._spreadRendered = spread;
      const base = this.spreadBase(this.pageIndex);
      const idxs = spread ? [base, base + 1].filter(i => i < this.pages.length) : [base];
      const wrap = document.createElement('div'); wrap.className = 'spread' + (spread ? ' is-spread' : ''); this.spreadEl = wrap;
      idxs.forEach((pi, slot) => this.sheets.push(this.buildSheet(pi, slot, wrap)));
      if (spread && idxs.length === 1) { const ghost = document.createElement('button'); ghost.type = 'button'; ghost.className = 'page page-ghost'; ghost.innerHTML = '<svg><use href="#i-plus"/></svg><span>Add a page</span>'; ghost.addEventListener('click', () => this.addPage(base)); wrap.appendChild(ghost); this.ghostEl = ghost; } else this.ghostEl = null;
      this.stage.appendChild(wrap);
      this.focus = Math.max(0, idxs.indexOf(this.pageIndex)); this.active = this.focus; this._pageIndex = idxs[this.focus];
      this.eachSheet(() => { this.renderRows(); this.renderMedia(); this.renderCaret(); });
      this.refreshPageClasses();
      this.pushUndoEnabled = true; this.updateUndoButtons();
    }
    buildSheet(pi, slot, parent) {
      const st = this.nb.settings;
      const page = document.createElement('div'); page.className = this.pageClass(); page.dataset.slot = slot;
      if (st.marginLine && st.paper !== 'blank') { const ml = document.createElement('div'); ml.className = 'margin-line'; page.appendChild(ml); }
      const rows = document.createElement('div'); rows.className = 'rows'; page.appendChild(rows);
      const media = document.createElement('div'); media.className = 'media-layer'; page.appendChild(media);
      const canvas = document.createElement('canvas'); canvas.className = 'ink'; page.appendChild(canvas);
      const pv = document.createElement('div'); pv.className = 'preview-layer'; page.appendChild(pv);
      const chips = document.createElement('div'); chips.className = 'chip-layer'; page.appendChild(chips);
      const lasso = document.createElement('div'); lasso.className = 'lasso-layer';
      lasso.innerHTML = `<svg class="lasso-svg" viewBox="0 0 ${PAGE.W} ${PAGE.H}" preserveAspectRatio="none" aria-hidden="true"><path class="lasso-path" d="" hidden/></svg><div class="lasso-box" hidden><div class="lasso-h" title="Resize"></div></div>`;
      page.appendChild(lasso);
      parent.appendChild(page);
      const sh = { slot, pageIndex: pi, pageEl: page, rowsEl: rows, mediaLayer: media, canvas, ctx: canvas.getContext('2d'), previewLayer: pv, chipLayer: chips, lassoLayer: lasso, tf: null, lv: { lines: new Map(), commits: [], suspended: false, lastKey: null }, pendingX: null };
      const on = (type, fn, opts) => page.addEventListener(type, e => { this.activate(slot); fn(e); }, opts);
      on('pointerdown', e => this.onPointerDown(e), true);
      on('pointermove', e => this.onPointerMove(e));
      on('pointerup', e => this.onPointerUp(e));
      on('pointercancel', e => this.onPointerUp(e));
      page.addEventListener('contextmenu', e => { if (this.tool !== 'type') e.preventDefault(); });
      sh.tf = IL.makeTransformer({
        container: page, itemSelector: '.pm', enabled: () => this.tool === 'select',
        getModel: id => this.pages[sh.pageIndex].media.find(m => m.id === id), pxPerUnit: () => this.s,
        onChange: (m, phase) => this.using(slot, () => { const node = page.querySelector(`.pm[data-id="${m.id}"]`); if (node) this.applyMediaStyle(node, m); if (phase === 'end') { this.pushUndo({ type: 'media', before: this._mediaBefore || this.cloneMedia(), after: this.cloneMedia() }); this._mediaBefore = null; this.markDirty(); } else if (phase === 'move' && !this._mediaBefore) { this._mediaBefore = this.cloneMedia(); } this.positionMediaActions(); }),
        onSelect: id => this.using(slot, () => this.onMediaSelect(id))
      });
      return sh;
    }
    /* how many page widths sit side by side on screen */
    columns() { return this.sheets.length + (this.ghostEl ? 1 : 0) || 1; }
    /* foldables and dual screens: two side-by-side viewport segments; the spread then puts its spine on the hinge */
    hinge() {
      try { const vv = window.visualViewport; const segs = vv && vv.segments; if (segs && segs.length === 2 && Math.abs(segs[0].y - segs[1].y) < 2 && segs[0].x < segs[1].x) return { left: segs[0], right: segs[1], gap: Math.max(0, segs[1].x - (segs[0].x + segs[0].width)) }; } catch (e) {}
      return null;
    }
    fitScale() {
      const n = this.columns(); const hg = n === 2 ? this.hinge() : null;
      if (hg) return Math.max(0.2, (Math.min(hg.left.width, hg.right.width) - 32) / PAGE.W);
      return Math.max(0.2, (this.scroller.clientWidth - 40 - (n > 1 ? 8 : 0)) / (PAGE.W * n));
    }
    layout() {
      if (!this.sheets.length) return;
      if (this.spreadMode() !== this._spreadRendered) { this.renderPage(); }
      this.s = this.fitScale() * this.zoom;
      this.stage.style.setProperty('--s', this.s);
      const hg = this.columns() === 2 ? this.hinge() : null; if (this.spreadEl) { this.spreadEl.style.gap = hg ? hg.gap + 'px' : ''; this.spreadEl.classList.toggle('on-hinge', !!hg); }
      this.eachSheet(() => { this.resizeCanvas(); this.redraw(); this.tf && this.tf.refresh(); });
      this.positionMediaActions(); this.positionLassoActions();
    }
    resizeCanvas() {
      const w = Math.round(PAGE.W * this.s * this.dpr), h = Math.round(PAGE.H * this.s * this.dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    }
    redraw() {
      const ctx = this.ctx; const k = this.s * this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      for (const st of this.page.strokes) if (st.kind === 'hl') drawStroke(ctx, st);
      if (this.live && this.live.stroke.kind === 'hl') drawStroke(ctx, this.live.stroke);
      for (const st of this.page.strokes) if (st.kind !== 'hl') drawStroke(ctx, st);
      if (this.live && this.live.stroke.kind !== 'hl') drawStroke(ctx, this.live.stroke);
    }
    renderRows() {
      const rowsEl = this.rowsEl; rowsEl.innerHTML = '';
      const n = rowsCount(this.L);
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div'); d.className = 'row'; d.dataset.i = i; d.style.setProperty('--i', i);
        try { d.contentEditable = 'plaintext-only'; } catch (e) { d.contentEditable = 'true'; }
        if (d.contentEditable !== 'plaintext-only') d.contentEditable = 'true';
        d.spellcheck = false; d.setAttribute('autocapitalize', 'sentences');
        this.fillRow(d, i); rowsEl.appendChild(d);
      }
      const slot = this.active; const on = (type, fn) => rowsEl.addEventListener(type, e => { this.activate(slot); fn(e); });
      on('input', e => this.onRowInput(e));
      on('keydown', e => this.onRowKey(e));
      on('paste', e => this.onRowPaste(e));
      on('focusin', e => { const r = e.target.closest('.row'); if (r) { this._rowsBefore = this.page.rows.slice(); this.page.caret = { row: +r.dataset.i }; this.renderCaret(); } });
      on('focusout', e => { const r = e.target.closest('.row'); if (r && this._rowsBefore) { const before = this._rowsBefore; this._rowsBefore = null; if (before.join('\n') !== this.page.rows.join('\n')) this.pushUndo({ type: 'rows', before, after: this.page.rows.slice() }); } setTimeout(() => this.using(slot, () => this.renderCaret()), 0); });
      this.renderCaret();
    }
    fillRow(d, i) {
      const text = this.page.rows[i] || '';
      const hl = this.highlights && this.highlights.get(i);
      if (!hl || !hl.length) { d.textContent = text; return; }
      let html = '', pos = 0;
      for (const h of hl) { html += esc(text.slice(pos, h.start)) + `<mark${h.cur ? ' class="cur"' : ''}>${esc(text.slice(h.start, h.end))}</mark>`; pos = h.end; }
      html += esc(text.slice(pos)); d.innerHTML = html;
    }
    refreshRow(i) { const d = this.rowsEl.children[i]; if (d && d.classList.contains('row') && document.activeElement !== d) this.fillRow(d, i); }
    refreshRows() { for (let i = 0; i < this.page.rows.length; i++) this.refreshRow(i); }

    /* ---------- text rows ---------- */
    measure(text) { return this.mctx.measureText(text).width; }
    maxW() { return this.rowW * 0.985; }
    findCut(t) {
      let lo = 0, hi = t.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.measure(t.slice(0, mid)) <= this.maxW()) lo = mid; else hi = mid - 1; }
      const sp = t.lastIndexOf(' ', lo);
      return sp > 0 ? sp : Math.max(1, lo);
    }
    /* Pushes overflowing text down to the following rows. Returns {row, offset} when the caret should move. */
    reflowFrom(i, caret) {
      const rows = this.page.rows; let moved = null; let k = i;
      while (k < rows.length - 1) {
        const t = rows[k]; if (this.measure(t) <= this.maxW()) break;
        const cut = this.findCut(t); const head = t.slice(0, cut).replace(/\s+$/, ''); const tailStart = cut + (t.slice(cut).length - t.slice(cut).replace(/^\s+/, '').length); const tail = t.slice(tailStart);
        rows[k] = head; rows[k + 1] = tail + (rows[k + 1] ? ' ' + rows[k + 1] : '');
        if (k === i && caret != null && caret > head.length) moved = { row: k + 1, offset: Math.max(0, caret - tailStart) };
        this.refreshRow(k); k++;
      }
      this.refreshRow(k);
      if (k > i) this.refreshRow(i);
      return moved == null ? k : moved;
    }
    caretOffset(el) { const sel = window.getSelection(); if (!sel.rangeCount) return null; const r = sel.getRangeAt(0); if (!el.contains(r.startContainer)) return null; const pre = r.cloneRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset); return pre.toString().length; }
    setCaretIn(el, offset) {
      el.focus(); const sel = window.getSelection(); const range = document.createRange();
      let remaining = Math.max(0, Math.min(offset, el.textContent.length)); let node = null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while ((node = walker.nextNode())) { if (remaining <= node.length) { range.setStart(node, remaining); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); return; } remaining -= node.length; }
      range.selectNodeContents(el); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
    }
    focusRow(i, offset) { const d = this.rowsEl.children[i]; if (!d || !d.classList.contains('row')) return; this.setCaretIn(d, offset == null ? d.textContent.length : offset); }
    onRowInput(e) {
      const d = e.target.closest('.row'); if (!d) return; const i = +d.dataset.i;
      const caret = this.caretOffset(d);
      const text = d.textContent.replace(/[\r\n]+/g, ' ');
      this.page.rows[i] = text;
      if (this.measure(text) > this.maxW()) {
        const moved = this.reflowFrom(i, caret);
        this.fillRow(d, i);
        if (moved && typeof moved === 'object') this.focusRow(moved.row, moved.offset); else this.setCaretIn(d, Math.min(caret || 0, this.page.rows[i].length));
      } else if (d.querySelector('mark') && this.highlights) { /* keep typing smooth: drop stale marks on this row */ this.highlights.delete(i); }
      IL.hwrClient.learnWords(text);
      this.markDirty(); this.app.onTextChanged && this.app.onTextChanged();
    }
    onRowKey(e) {
      const d = e.target.closest('.row'); if (!d) return; const i = +d.dataset.i; const n = this.page.rows.length;
      if (e.key === 'Enter') { e.preventDefault(); if (i < n - 1) this.focusRow(i + 1, 0); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (i < n - 1) this.focusRow(i + 1, Math.min(this.caretOffset(d) || 0, this.page.rows[i + 1].length)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) this.focusRow(i - 1, Math.min(this.caretOffset(d) || 0, this.page.rows[i - 1].length)); return; }
      if (e.key === 'Backspace' && this.caretOffset(d) === 0 && i > 0) {
        e.preventDefault(); const prev = this.page.rows[i - 1], cur = this.page.rows[i];
        if (cur && this.measure(prev + (prev ? ' ' : '') + cur) <= this.maxW()) { this.page.rows[i - 1] = prev + (prev ? ' ' : '') + cur; this.page.rows[i] = ''; this.refreshRow(i); this.refreshRow(i - 1); this.focusRow(i - 1, prev.length); this.markDirty(); }
        else this.focusRow(i - 1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i' || e.key === 'u')) e.preventDefault();
    }
    onRowPaste(e) {
      const d = e.target.closest('.row'); if (!d) return; e.preventDefault();
      const i = +d.dataset.i; const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      const lines = text.replace(/\r/g, '').split('\n'); const caret = this.caretOffset(d) || 0;
      const cur = this.page.rows[i]; const before = cur.slice(0, caret), after = cur.slice(caret);
      this.page.rows[i] = before + lines[0] + (lines.length === 1 ? after : '');
      for (let k = 1; k < lines.length && i + k < this.page.rows.length; k++) { const last = k === lines.length - 1; this.page.rows[i + k] = lines[k] + (last ? after : '') + (this.page.rows[i + k] ? ' ' + this.page.rows[i + k] : ''); }
      for (let k = 0; k < lines.length && i + k < this.page.rows.length; k++) { this.refreshRow(i + k); this.reflowFrom(i + k, null); }
      this.fillRow(d, i); this.setCaretIn(d, Math.min(this.page.rows[i].length, before.length + lines[0].length));
      this.markDirty(); IL.hwrClient.learnWords(text); this.app.onTextChanged && this.app.onTextChanged();
    }

    /* ---------- media (photos, videos, links) ---------- */
    cloneMedia() { return this.page.media.map(m => ({ ...m })); }
    renderMedia() {
      this.mediaLayer.innerHTML = ''; this.chipLayer.innerHTML = '';
      for (const m of this.page.media) {
        const node = document.createElement(m.type === 'link' ? 'div' : 'div');
        node.className = 'pm pm-' + (m.type === 'image' ? 'image' : 'video'); node.dataset.id = m.id;
        if (m.type === 'image') {
          const img = document.createElement('img'); img.alt = ''; img.draggable = false; IL.blobs.url(m.key).then(u => { if (u) img.src = u; }); node.appendChild(img); this.mediaLayer.appendChild(node);
          node.addEventListener('click', () => { if (this.tool !== 'select') this.selectMedia(m.id); });
        }
        else {
          const chip = document.createElement(m.type === 'link' ? 'a' : 'button'); chip.className = 'vchip';
          if (m.type === 'link') { chip.href = m.url; chip.target = '_blank'; chip.rel = 'noopener'; } else chip.type = 'button';
          const thumb = document.createElement('span'); thumb.className = 'vthumb'; if (m.poster) IL.blobs.url(m.poster).then(u => { if (u) thumb.style.backgroundImage = `url("${u}")`; });
          const txt = document.createElement('span'); txt.className = 'vtext';
          const sub = m.type === 'link' ? (safeHost(m.url) || 'Video link') : [fmtDuration(m.duration), m.size ? fmtSize(m.size) : ''].filter(Boolean).join(' · ') || 'Video';
          txt.innerHTML = `<span class="vname">${esc(m.name || 'Video')}</span><span class="vsub">${esc(sub)}</span>`;
          chip.appendChild(thumb); chip.appendChild(txt); chip.draggable = false;
          chip.addEventListener('click', e => { if (this.tool === 'select') { e.preventDefault(); return; } if (m.type === 'video') { e.preventDefault(); this.playVideo(m); } });
          node.appendChild(chip); this.chipLayer.appendChild(node);
        }
        this.applyMediaStyle(node, m);
      }
    }
    applyMediaStyle(node, m) { node.style.setProperty('--x', m.x); node.style.setProperty('--y', m.y); node.style.setProperty('--w', m.w); node.style.setProperty('--h', m.h); node.style.setProperty('--rot', m.rot || 0); }
    /* Topmost photo/video under a page point (x,y in page units), honoring rotation. */
    hitMedia(x, y) {
      const list = this.page.media;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]; const cx = m.x + m.w / 2, cy = m.y + m.h / 2; const a = -(m.rot || 0) * Math.PI / 180;
        const dx = x - cx, dy = y - cy; const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(lx) <= m.w / 2 && Math.abs(ly) <= m.h / 2) return m;
      }
      return null;
    }
    selectMedia(id) { this.setTool('select'); this.tf.select(id); this.app.toast('Drag to move. Corner handle resizes, top handle rotates, the trash button removes it.', 2600); }
    onMediaSelect(id) {
      const m = id ? this.page.media.find(x => x.id === id) : null;
      this.mediaActions.hidden = !m;
      if (!m) return;
      this.mediaActions.querySelector('[data-act="play"]').hidden = m.type === 'image';
      this.mediaActions.querySelector('[data-act="rename"]').hidden = m.type === 'image';
      this.positionMediaActions();
    }
    positionMediaActions() {
      const id = this.tf && this.tf.selected(); if (!id || this.mediaActions.hidden) return;
      const node = this.pageEl.querySelector(`.pm[data-id="${id}"]`); if (!node) return;
      const r = node.getBoundingClientRect(), sr = this.scroller.getBoundingClientRect();
      const left = Math.max(8, Math.min(sr.width - this.mediaActions.offsetWidth - 8, r.left - sr.left + r.width / 2 - this.mediaActions.offsetWidth / 2));
      let top = r.top - sr.top - 54; if (top < 6) top = r.bottom - sr.top + 10;
      this.mediaActions.style.left = left + 'px'; this.mediaActions.style.top = top + 'px';
    }
    mediaAction(act) {
      const id = this.tf.selected(); const list = this.page.media; const i = list.findIndex(m => m.id === id); if (i < 0) return; const m = list[i];
      const before = this.cloneMedia();
      if (act === 'del') { list.splice(i, 1); this.tf.select(null); this.mediaActions.hidden = true; } // stored files stay until the startup clean-up, so undo can restore the picture
      else if (act === 'front') { if (i < list.length - 1) { list.splice(i, 1); list.splice(i + 1, 0, m); } }
      else if (act === 'back') { if (i > 0) { list.splice(i, 1); list.splice(i - 1, 0, m); } }
      else if (act === 'play') { if (m.type === 'link') { const a = document.createElement('a'); a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); } else this.playVideo(m); return; }
      else if (act === 'rename') { this.app.prompt('Label', m.name || '', v => { if (v != null) { m.name = v.trim() || m.name; this.renderMedia(); this.tf.select(m.id); this.markDirty(); } }); return; }
      this.renderMedia(); if (act !== 'del') this.tf.select(m.id);
      this.pushUndo({ type: 'media', before, after: this.cloneMedia() }); this.markDirty();
    }
    visibleCenter() {
      const sr = this.scroller.getBoundingClientRect(), pr = this.pageEl.getBoundingClientRect();
      const cx = (sr.left + sr.width / 2 - pr.left) / this.s, cy = (sr.top + sr.height / 2 - pr.top) / this.s;
      return { x: Math.max(60, Math.min(PAGE.W - 60, cx)), y: Math.max(80, Math.min(PAGE.H - 80, cy)) };
    }
    addMedia(m) {
      const before = this.cloneMedia(); this.page.media.push(m); this.renderMedia();
      this.pushUndo({ type: 'media', before, after: this.cloneMedia() }); this.markDirty();
      this.setTool('select'); this.tf.select(m.id);
    }
    async addPhotos(files) {
      let added = 0;
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        try {
          const { blob, width, height } = await IL.blobs.shrinkImage(f, 1600);
          const key = await IL.blobs.put(blob, { kind: 'image', name: f.name });
          const w = Math.min(340, this.rowW), h = Math.round(w * height / width); const c = this.visibleCenter();
          this.addMedia({ id: IL.uid(), type: 'image', key, name: f.name, x: Math.round(c.x - w / 2 + added * 16), y: Math.round(Math.max(PAGE.top, c.y - h / 2 + added * 16)), w, h, rot: 0 }); added++;
        } catch (err) { this.app.toast('That photo could not be read.'); }
      }
      if (added) this.app.toast(added === 1 ? 'Photo added. Drag it where you want it.' : `${added} photos added.`);
    }
    async addVideo(file) {
      if (!file) return;
      if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(file.name)) { this.app.toast('That file is not a video.'); return; }
      if (file.size > 600e6) { this.app.toast('That video is over 600 MB; the browser cannot store it. Add it as a link instead.'); return; }
      this.app.toast('Adding video…');
      try {
        const key = await IL.blobs.put(file, { kind: 'video', name: file.name });
        const info = await IL.blobs.videoInfo(file);
        let poster = null; if (info.poster) poster = await IL.blobs.put(info.poster, { kind: 'poster' });
        const c = this.visibleCenter(); const w = Math.min(280, this.rowW);
        this.addMedia({ id: IL.uid(), type: 'video', key, poster, name: file.name.replace(/\.[^.]+$/, ''), duration: info.duration, size: file.size, x: Math.round(c.x - w / 2), y: Math.round(c.y - 28), w, h: 56, rot: 0 });
        this.app.toast('Video added as a link on the page. Tap it to play.');
      } catch (err) { console.error(err); this.app.toast('The video could not be saved. It may be too large for this browser.'); }
    }
    addVideoLink(url) {
      url = (url || '').trim(); if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      try { new URL(url); } catch (e) { this.app.toast('That does not look like a web link.'); return; }
      const c = this.visibleCenter(); const w = Math.min(280, this.rowW);
      this.addMedia({ id: IL.uid(), type: 'link', url, name: safeHost(url) === 'youtube.com' || safeHost(url) === 'youtu.be' ? 'YouTube video' : 'Video link', x: Math.round(c.x - w / 2), y: Math.round(c.y - 28), w, h: 56, rot: 0 });
    }
    async playVideo(m) {
      const url = await IL.blobs.url(m.key); if (!url) { this.app.toast('This video is no longer stored on this device.'); return; }
      const player = document.getElementById('player'), v = document.getElementById('player-video');
      document.getElementById('player-name').textContent = m.name || 'Video';
      const open = document.getElementById('player-open'); open.href = url; open.download = (m.name || 'video') + '.mp4';
      player.hidden = false; v.src = url;
      try { await v.play(); } catch (e) {}
      try { if (v.webkitEnterFullscreen && /iPhone|iPad/.test(navigator.userAgent)) v.webkitEnterFullscreen(); else if (v.requestFullscreen) await v.requestFullscreen(); } catch (e) {}
    }
    closePlayer() { const player = document.getElementById('player'), v = document.getElementById('player-video'); try { v.pause(); } catch (e) {} v.removeAttribute('src'); try { v.load(); } catch (e) {} player.hidden = true; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }

    /* ---------- pointer input ---------- */
    pagePoint(e) { const r = this.pageEl.getBoundingClientRect(); return [(e.clientX - r.left) / this.s, (e.clientY - r.top) / this.s]; }
    onPointerDown(e) {
      if (e.target.closest('.tf-h') || e.target.closest('.el-actions')) return;
      const tool = this.tool;
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 2) { if (this.live && this.live.pointerType === 'touch') this.cancelStroke(); if (this.lassoDraw && this.lassoDraw.pointerType === 'touch') this.cancelLasso(); this.pan = null; this.startPinch(); return; }
        if (this.penActive) return;
      }
      if (e.pointerType === 'pen' && !this.app.settings.penSeen) this.app.penDetected();
      if (tool === 'lasso') { this.lassoDown(e); return; }
      if (tool === 'select') {
        // a pen on empty paper while something is selected: go straight back to writing
        if (e.pointerType !== 'pen' || e.target.closest('.pm') || e.target.closest('.tf-frame')) return;
        this.setTool('pen');
      }
      if (e.target.closest('.pm-video') && tool !== 'eraser') return; // let the chip take the tap
      if (tool === 'pen' && this.app.settings.engine === 'system') return; // system engine: the pen writes straight into the editable lines (Scribble / Gboard)
      if (tool === 'type' && e.pointerType !== 'pen') return; // typing: taps focus rows natively
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'touch' && (!this.app.settings.fingerDraws || tool === 'type')) { this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
      if (e.pointerType === 'pen') this.penActive = true;
      e.preventDefault(); e.stopPropagation();
      try { this.pageEl.setPointerCapture(e.pointerId); } catch (err) {}
      const erasing = tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32));
      const [x, y] = this.pagePoint(e);
      if (this.area) { clearTimeout(this._writingT); this.area.classList.add('is-writing'); }
      if (erasing) { this.erase = { id: e.pointerId, removed: [] }; this.eraseAt(x, y); return; }
      const hl = tool === 'hl';
      const stroke = hl ? { kind: 'hl', pts: [[x, y, 0.5, 0]], color: this.hlColor, width: this.L * 0.6, at: 0 } : { pts: [[x, y, e.pressure || 0.5, 0]], color: this.penColor, width: this.penWidth, pen: this.penStyle, at: 0 };
      this.live = { stroke, id: e.pointerId, pointerType: e.pointerType, t0: performance.now(), drawn: 1 };
      const ctx = this.ctx; ctx.setTransform(this.s * this.dpr, 0, 0, this.s * this.dpr, 0, 0); drawStroke(ctx, stroke);
      if (this.tf && this.tf.selected()) this.tf.select(null);
    }
    onPointerMove(e) {
      if (this.pinch && e.pointerType === 'touch') { this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.updatePinch(); return; }
      if ((this.lassoDraw && e.pointerId === this.lassoDraw.id) || (this.lassoDrag && e.pointerId === this.lassoDrag.id)) { this.lassoMove(e); return; }
      if (this.pan && e.pointerId === this.pan.id) { this.scroller.scrollLeft -= e.clientX - this.pan.x; this.scroller.scrollTop -= e.clientY - this.pan.y; this.pan.x = e.clientX; this.pan.y = e.clientY; return; }
      if (this.erase && e.pointerId === this.erase.id) { const [x, y] = this.pagePoint(e); this.eraseAt(x, y); return; }
      if (!this.live || e.pointerId !== this.live.id) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const st = this.live.stroke; const r = this.pageEl.getBoundingClientRect();
      for (const ev of events) {
        const x = (ev.clientX - r.left) / this.s, y = (ev.clientY - r.top) / this.s; const last = st.pts[st.pts.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) < 0.35) continue;
        st.pts.push([x, y, ev.pressure || 0.5, Math.round(performance.now() - this.live.t0)]);
      }
      if (st.pts.length > this.live.drawn) { if (st.kind === 'hl') { this.redraw(); } else { const ctx = this.ctx; ctx.setTransform(this.s * this.dpr, 0, 0, this.s * this.dpr, 0, 0); drawStroke(ctx, st, Math.max(1, this.live.drawn - 1)); } this.live.drawn = st.pts.length; }
    }
    onPointerUp(e) {
      if (e.pointerType === 'touch') { this.touches.delete(e.pointerId); if (this.pinch && this.touches.size < 2) { this.endPinch(); } }
      if (e.pointerType === 'pen') this.penActive = false;
      this.writingDone(e.pointerId);
      if ((this.lassoDraw && e.pointerId === this.lassoDraw.id) || (this.lassoDrag && e.pointerId === this.lassoDrag.id)) { this.lassoUp(e); return; }
      if (this.pan && e.pointerId === this.pan.id) { this.pan = null; return; }
      if (this.erase && e.pointerId === this.erase.id) {
        const er = this.erase; this.erase = null; const rem = er.removed;
        if (rem.length || er.rowsBefore) { this.pushUndo({ type: 'erase', removed: rem, rowsBefore: er.rowsBefore || null, rowsAfter: er.rowsBefore ? this.page.rows.slice() : null }); this.markDirty(); this.liveRefresh(); if (er.words && er.words.length) this.app.toast(`Deleted “${er.words.join(' ')}”. Undo brings it back.`, 2200); }
        else { const [x, y] = this.pagePoint(e); const hit = this.hitMedia(x, y); if (hit) this.selectMedia(hit.id); }
        return;
      }
      if (!this.live || e.pointerId !== this.live.id) return;
      const st = this.live.stroke, startedAt = this.live.t0; this.live = null;
      // a plain tap on a photo or video selects it instead of leaving a dot
      const span = st.pts.reduce((m, p) => Math.max(m, Math.hypot(p[0] - st.pts[0][0], p[1] - st.pts[0][1])), 0);
      if (span < 2.5 && performance.now() - startedAt < 400) {
        const hit = this.hitMedia(st.pts[0][0], st.pts[0][1]);
        if (hit) { this.redraw(); this.selectMedia(hit.id); return; }
      }
      st.at = Date.now(); st.pts = st.pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 100) / 100, p[3]]);
      this.page.strokes.push(st); this.pushUndo({ type: 'stroke', stroke: st }); this.markDirty(); this.redraw();
      if (st.kind !== 'hl' && this.editGesture(st)) return;
      this.liveStroke(st);
    }
    cancelStroke() { this.live = null; this.redraw(); this.writingDone(); }
    /* the pointer that was drawing or erasing is up: the floating Enter button comes back a moment after the pen lifts
       (so it does not flicker between the strokes of a word, and it is there as soon as the hand pauses) */
    writingDone(pointerId, delay) {
      clearTimeout(this._writingT);
      this._writingT = setTimeout(() => {
        const busy = (this.live && this.live.id !== pointerId) || (this.erase && this.erase.id !== pointerId);
        if (!busy && this.area) this.area.classList.remove('is-writing');
      }, delay == null ? 280 : delay);
    }
    eraseAt(x, y) {
      const r = 11 / Math.sqrt(this.s) + 4; const strokes = this.page.strokes; let hit = false;
      if (this.erase.mode !== 'text') {
        for (let i = strokes.length - 1; i >= 0; i--) {
          const st = strokes[i]; const b = strokeBox(st);
          if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) continue;
          if (st.pts.some(pt => Math.hypot(pt[0] - x, pt[1] - y) <= r)) { this.erase.removed.push({ stroke: st, index: i }); strokes.splice(i, 1); hit = true; }
        }
        if (hit) { this.erase.mode = 'ink'; this.redraw(); return; }
      }
      if (this.erase.mode !== 'ink') this.eraseTextAt(x, y, r);
    }
    /* Rubbing the eraser over a typed word removes the word. Hits are judged against the row's layout as it was
       when the gesture first touched text, so words sliding left after a deletion are not swallowed too. */
    eraseTextAt(x, y, r) {
      const L = this.L; const row = Math.floor((y - PAGE.top) / L); if (row < 0 || row >= this.page.rows.length) return;
      const yIn = y - (PAGE.top + row * L); if (yIn < 0.05 * L || yIn > 0.97 * L) return;
      const er = this.erase; er.layouts = er.layouts || {};
      if (!er.layouts[row]) er.layouts[row] = this.rowWords(row).map(w => ({ ...w, gone: false }));
      const words = er.layouts[row]; const pad = Math.min(4, r);
      let hit = words.find(w => !w.gone && x >= w.x0 && x <= w.x1);
      if (!hit) { const near = words.filter(w => !w.gone && x >= w.x0 - pad && x <= w.x1 + pad); if (near.length) hit = near.sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - x) - Math.abs((b.x0 + b.x1) / 2 - x))[0]; }
      if (!hit) return;
      if (!er.rowsBefore) er.rowsBefore = this.page.rows.slice();
      er.mode = 'text'; er.words = (er.words || []).concat(hit.text); hit.gone = true;
      // remove this occurrence from the current text (it may have shifted left after earlier deletions)
      const text = this.page.rows[row]; const removedBefore = words.filter(w => w.gone && w !== hit && w.start < hit.start).reduce((n, w) => n + (w.end - w.start) + 1, 0);
      let s0 = text.indexOf(hit.text, Math.max(0, hit.start - removedBefore - 1)); if (s0 < 0) s0 = text.indexOf(hit.text); if (s0 < 0) return;
      let e0 = s0 + hit.text.length; if (text[e0] === ' ') e0++; else if (s0 > 0 && text[s0 - 1] === ' ') s0--;
      this.page.rows[row] = (text.slice(0, s0) + text.slice(e0)).replace(/\s+$/, '');
      if (this.lv) this.lv.commits = this.lv.commits.filter(c => c.row !== row);
      this.refreshRow(row); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
    }
    startPinch() {
      const pts = [...this.touches.values()]; const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; const r = this.pageEl.getBoundingClientRect();
      this.pinch = { d0: d, z0: this.zoom, lx: (mid.x - r.left) / this.s, ly: (mid.y - r.top) / this.s, mid };
    }
    updatePinch() {
      const pts = [...this.touches.values()]; if (pts.length < 2) return;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1; const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.pinch.z0 * d / this.pinch.d0));
      this.setZoom(z, { lx: this.pinch.lx, ly: this.pinch.ly, cx: mid.x, cy: mid.y }, true);
    }
    endPinch() { this.pinch = null; this.layout(); }
    setZoom(z, anchor, light) {
      this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
      this.s = this.fitScale() * this.zoom;
      this.stage.style.setProperty('--s', this.s);
      if (anchor) {
        const sr = this.scroller.getBoundingClientRect();
        this.scroller.scrollLeft = this.pageEl.offsetLeft + anchor.lx * this.s - (anchor.cx - sr.left);
        this.scroller.scrollTop = this.pageEl.offsetTop + anchor.ly * this.s - (anchor.cy - sr.top);
      }
      const paint = () => this.eachSheet(() => { this.resizeCanvas(); this.redraw(); this.tf && this.tf.refresh(); });
      if (light) { if (!this._zoomRaf) this._zoomRaf = requestAnimationFrame(() => { this._zoomRaf = null; paint(); }); }
      else { paint(); this.positionMediaActions(); this.positionLassoActions(); }
    }
    zoomBy(f) { const sr = this.scroller.getBoundingClientRect(); const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2; const pr = this.pageEl.getBoundingClientRect(); this.setZoom(this.zoom * f, { lx: (cx - pr.left) / this.s, ly: (cy - pr.top) / this.s, cx, cy }); }

    /* ---------- lasso: draw a loop around ink to pick it up, then move, resize, copy, cut, paste, recolour, convert or delete it ---------- */
    lassoDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { this.pageEl.setPointerCapture(e.pointerId); } catch (err) {}
      if (e.pointerType === 'pen') this.penActive = true;
      const [x, y] = this.pagePoint(e); const sel = this.lassoSel;
      if (sel && sel.sheet === this.sheet) {
        const b = sel.box, pad = 6 / this.s;
        if (e.target.closest('.lasso-h')) { this.lassoDrag = { id: e.pointerId, mode: 'scale', ax: b.x0, ay: b.y0, d0: Math.max(4, Math.hypot(x - b.x0, y - b.y0)), orig: this.lassoSnapshot(sel.strokes, sel.media), moved: false }; this.lassoBoxEl().classList.add('moving'); return; }
        if (x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad) { this.lassoDrag = { id: e.pointerId, mode: 'move', x, y, dx: 0, dy: 0, orig: this.lassoSnapshot(sel.strokes, sel.media), moved: false }; this.lassoBoxEl().classList.add('moving'); this.lassoActions.hidden = true; return; }
      }
      const hadSel = !!(sel && sel.sheet === this.sheet); this.clearLasso();
      this.lassoDraw = { id: e.pointerId, pts: [[x, y]], pointerType: e.pointerType, t0: performance.now(), deselect: hadSel };
      this.renderLassoPath(this.lassoDraw.pts, false);
    }
    lassoMove(e) {
      const r = this.pageEl.getBoundingClientRect();
      if (this.lassoDraw) {
        const pts = this.lassoDraw.pts; const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events) { const x = (ev.clientX - r.left) / this.s, y = (ev.clientY - r.top) / this.s; const last = pts[pts.length - 1]; if (Math.hypot(x - last[0], y - last[1]) >= 1.2) pts.push([x, y]); }
        this.renderLassoPath(pts, false); return;
      }
      const d = this.lassoDrag, sel = this.lassoSel; if (!d || !sel) return;
      const x = (e.clientX - r.left) / this.s, y = (e.clientY - r.top) / this.s;
      if (d.mode === 'move') {
        const dx = x - d.x, dy = y - d.y; if (!dx && !dy) return;
        d.x = x; d.y = y; d.dx += dx; d.dy += dy; d.moved = true;
        for (const st of sel.strokes) for (const p of st.pts) { p[0] += dx; p[1] += dy; }
        for (const m of sel.media || []) { m.x += dx; m.y += dy; this.applyMediaNode(m); }
        sel.box = { x0: sel.box.x0 + dx, y0: sel.box.y0 + dy, x1: sel.box.x1 + dx, y1: sel.box.y1 + dy };   // typed words follow on drop (they live in rows)
      } else {
        const k = Math.max(0.12, Math.min(8, Math.hypot(x - d.ax, y - d.ay) / d.d0)); d.k = k; d.moved = true;
        for (const o of d.orig.strokes) { o.st.pts = o.pts.map(p => [d.ax + (p[0] - d.ax) * k, d.ay + (p[1] - d.ay) * k, p[2], p[3]]); o.st.width = Math.max(0.4, Math.min(60, o.width * k)); }
        for (const o of d.orig.media) { o.m.x = d.ax + (o.x - d.ax) * k; o.m.y = d.ay + (o.y - d.ay) * k; o.m.w = Math.max(20, o.w * k); if (o.h != null) o.m.h = Math.max(20, o.h * k); this.applyMediaNode(o.m); }
        sel.box = this.lassoBounds(sel.strokes, sel.words, sel.media);
      }
      this.renderLassoBox(); this.scheduleRedraw();
    }
    applyMediaNode(m) { const node = this.mediaLayer && this.mediaLayer.querySelector(`.pm[data-id="${m.id}"]`); if (node) this.applyMediaStyle(node, m); }
    lassoUp(e) {
      if (this.lassoDraw) {
        const draw = this.lassoDraw; this.lassoDraw = null;
        if (e.type === 'pointercancel') { this.renderLassoPath(null); return; }
        this.lassoSelect(draw.pts, performance.now() - draw.t0, draw.deselect);
        return;
      }
      const d = this.lassoDrag, sel = this.lassoSel; this.lassoDrag = null; if (!sel) return;
      this.lassoBoxEl().classList.remove('moving');
      if (d.moved) {
        const page = this.page; const entries = [];
        this.roundStrokes(sel.strokes); for (const st of sel.strokes) st.lineKey = null;
        if (sel.strokes.length || (sel.media && sel.media.length)) entries.push({ type: 'xform', before: d.orig, after: this.lassoSnapshot(sel.strokes, sel.media) });
        if (d.mode === 'move' && sel.words && sel.words.length) {
          // typed words move by whole rows: the row under the frame's new position takes them (at its end)
          const shift = Math.round(d.dy / this.L);
          if (shift) {
            const rowsBefore = page.rows.slice(); const moved = this.takeWords(sel.words);
            const groups = new Map(); for (const w of moved) { const r = Math.max(0, Math.min(page.rows.length - 1, w.row + shift)); groups.set(r, (groups.get(r) || []).concat(w.text)); }
            let last = 0; for (const [r, texts] of [...groups.entries()].sort((a, b) => a[0] - b[0])) { const t = page.rows[r] || ''; page.rows[r] = (t && !/\s$/.test(t) ? t + ' ' : t) + texts.join(' '); last = Math.max(last, this.reflowFrom(r, null)); }
            entries.push({ type: 'rows', before: rowsBefore, after: page.rows.slice() });
            sel.words = this.findWords(moved.map(w => ({ ...w, row: Math.max(0, Math.min(page.rows.length - 1, w.row + shift)) })));
            this.refreshRows(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
          }
        }
        if (entries.length) this.pushUndo(entries.length === 1 ? entries[0] : { type: 'multi', entries });
        sel.box = this.lassoBounds(sel.strokes, sel.words, sel.media); this.renderLassoBox();
        this.markDirty(); this.redraw(); this.liveRefresh();
      }
      this.lassoActions.hidden = false; this.positionLassoActions();
    }
    /* removes the given typed words from their rows (right to left so offsets stay valid); returns them with their text */
    takeWords(words) {
      const page = this.page; const byRow = new Map(); for (const w of words) byRow.set(w.row, (byRow.get(w.row) || []).concat(w));
      for (const [r, list] of byRow) {
        let t = page.rows[r] || '';
        for (const w of list.sort((a, b) => b.start - a.start)) { let s0 = w.start, e0 = w.end; if (t.slice(s0, e0) !== w.text) { const i = t.indexOf(w.text); if (i < 0) continue; s0 = i; e0 = i + w.text.length; } if (t[e0] === ' ') e0++; else if (s0 > 0 && t[s0 - 1] === ' ') s0--; t = t.slice(0, s0) + t.slice(e0); }
        page.rows[r] = t.replace(/\s+$/, ''); if (this.lv) this.lv.commits = this.lv.commits.filter(c => c.row !== r);
      }
      return words.map(w => ({ row: w.row, text: w.text }));
    }
    /* finds typed words again after a text change (same row, same text, in order) so the selection can keep pointing at them */
    findWords(list) {
      const out = []; const used = new Map();
      for (const w of list) { const cands = this.rowWords(w.row); const from = used.get(w.row) || 0; const i = cands.findIndex((c, k) => k >= from && c.text === w.text); if (i < 0) continue; used.set(w.row, i + 1); const c = cands[i]; out.push({ row: w.row, start: c.start, end: c.end, text: c.text, x0: c.x0, x1: c.x1 }); }
      return out;
    }
    cancelLasso() { this.lassoDraw = null; this.renderLassoPath(null); }
    scheduleRedraw() { if (this._redrawRaf) return; const sh = this.sheet; this._redrawRaf = requestAnimationFrame(() => { this._redrawRaf = null; if (this.sheetLive(sh)) this.using(this.sheets.indexOf(sh), () => this.redraw()); }); }
    roundStrokes(strokes) { for (const st of strokes) st.pts = st.pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, p[2], p[3]]); }
    lassoSnapshot(strokes, media) { return { strokes: strokes.map(st => ({ st, pts: st.pts.map(p => p.slice()), width: st.width, color: st.color })), media: (media || []).map(m => ({ m, x: m.x, y: m.y, w: m.w, h: m.h })) }; }
    lassoRestore(snap) {
      for (const o of snap.strokes || []) { o.st.pts = o.pts.map(p => p.slice()); o.st.width = o.width; if (o.color) o.st.color = o.color; o.st.lineKey = null; }
      for (const o of snap.media || []) { o.m.x = o.x; o.m.y = o.y; o.m.w = o.w; if (o.h != null) o.m.h = o.h; }
      if (snap.media && snap.media.length) this.renderMedia();
    }
    lassoBoxEl() { return this.lassoLayer ? this.lassoLayer.querySelector('.lasso-box') : null; }
    lassoBounds(strokes, words, media) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const st of strokes) { const b = strokeBox(st); const w = (st.width || 2) / 2; x0 = Math.min(x0, b.x0 - w); y0 = Math.min(y0, b.y0 - w); x1 = Math.max(x1, b.x1 + w); y1 = Math.max(y1, b.y1 + w); }
      const L = this.L; for (const w of words || []) { x0 = Math.min(x0, w.x0); x1 = Math.max(x1, w.x1); y0 = Math.min(y0, PAGE.top + w.row * L + L * 0.08); y1 = Math.max(y1, PAGE.top + (w.row + 1) * L - L * 0.06); }
      for (const m of media || []) { const h = m.h != null ? m.h : m.w; x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + h); }
      const pad = 4; return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }
    renderLassoPath(pts, closed) {
      const layer = this.lassoLayer; if (!layer) return; const path = layer.querySelector('.lasso-path');
      if (!pts || pts.length < 2) { path.setAttribute('hidden', ''); path.setAttribute('d', ''); path.classList.remove('closed'); return; }
      path.removeAttribute('hidden'); path.classList.toggle('closed', !!closed);   // SVG elements have no .hidden property
      path.setAttribute('d', 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + (closed ? 'Z' : ''));
    }
    renderLassoBox() {
      const sel = this.lassoSel; const el = this.lassoBoxEl(); if (!el) return;
      if (!sel || sel.sheet !== this.sheet) { el.hidden = true; return; }
      el.hidden = false; const b = sel.box;
      el.style.setProperty('--x0', b.x0); el.style.setProperty('--y0', b.y0); el.style.setProperty('--x1', b.x1); el.style.setProperty('--y1', b.y1);
    }
    positionLassoActions() {
      const sel = this.lassoSel; if (!sel || this.lassoActions.hidden || this.lassoActions.dataset.mode === 'paste') return;
      const el = sel.sheet.lassoLayer.querySelector('.lasso-box'); if (!el || el.hidden) return;
      const r = el.getBoundingClientRect(), sr = this.scroller.getBoundingClientRect();
      this.lassoActions.querySelector('[data-act="paste"]').hidden = !this.inkClipboard && !this.textClipboard;
      const left = Math.max(8, Math.min(sr.width - this.lassoActions.offsetWidth - 8, r.left - sr.left + r.width / 2 - this.lassoActions.offsetWidth / 2));
      let top = r.top - sr.top - 54; if (top < 6) top = r.bottom - sr.top + 14;
      this.lassoActions.style.left = left + 'px'; this.lassoActions.style.top = top + 'px';
    }
    /* finishes the loop: picks the strokes that are (mostly) inside it; a short tap picks the word under the finger */
    lassoSelect(pts, ms, quiet) {
      const page = this.page; let picked = []; const words = [], media = [];
      const span = pts.reduce((m, p) => Math.max(m, Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])), 0);
      if (span < 4 && ms < 500) {
        const [x, y] = pts[0]; const r = 10 / Math.sqrt(this.s) + 3;
        const hit = page.strokes.filter(st => { const b = strokeBox(st); return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r && st.pts.some(p => Math.hypot(p[0] - x, p[1] - y) <= r); });
        if (hit.length) {
          // grow to the whole word: ink strokes whose boxes nearly touch, in the same line
          const L = this.L; picked = hit.slice(); let grew = true;
          while (grew) { grew = false; const pb = this.lassoBounds(picked); const gap = Math.max(0.35 * L, 0.6 * (pb.y1 - pb.y0)); for (const st of page.strokes) { if (picked.includes(st) || st.kind === 'hl') continue; const b = strokeBox(st); if (b.x1 >= pb.x0 - gap && b.x0 <= pb.x1 + gap && b.y1 >= pb.y0 - 0.1 * L && b.y0 <= pb.y1 + 0.1 * L) { picked.push(st); grew = true; } } }
        }
      } else if (pts.length >= 3) {
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; for (const p of pts) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
        for (const st of page.strokes) {
          const b = strokeBox(st); if (b.x1 < bx0 || b.x0 > bx1 || b.y1 < by0 || b.y0 > by1) continue;
          let inside = 0; for (const p of st.pts) if (pointInPoly(p[0], p[1], pts)) inside++;
          if (inside >= Math.max(1, Math.ceil(st.pts.length * 0.35))) picked.push(st);
        }
        // typed words whose middle lies in the loop, and photos / video chips
        const L = this.L; const r0 = Math.max(0, Math.floor((by0 - PAGE.top) / L)), r1 = Math.min(page.rows.length - 1, Math.floor((by1 - PAGE.top) / L));
        for (let r = r0; r <= r1; r++) { if (!(page.rows[r] || '').trim()) continue; const cy = PAGE.top + (r + 0.55) * L; for (const w of this.rowWords(r)) if (pointInPoly((w.x0 + w.x1) / 2, cy, pts)) words.push({ row: r, start: w.start, end: w.end, text: w.text, x0: w.x0, x1: w.x1 }); }
        for (const m of page.media || []) { const h = m.h != null ? m.h : m.w; if (pointInPoly(m.x + m.w / 2, m.y + h / 2, pts)) media.push(m); }
      }
      if (!picked.length && !words.length && !media.length && span < 4) {   // a tap on a typed word or a photo picks it
        const [x, y] = pts[0]; const r = Math.floor((y - PAGE.top) / this.L);
        if (r >= 0 && r < page.rows.length) { const w = this.rowWords(r).find(w => x >= w.x0 - 2 && x <= w.x1 + 2); if (w) words.push({ row: r, start: w.start, end: w.end, text: w.text, x0: w.x0, x1: w.x1 }); }
        if (!words.length) { const hit = this.hitMedia(x, y); if (hit) media.push(hit); }
      }
      this.renderLassoPath(null);
      if (!picked.length && !words.length && !media.length) {
        if (span < 4 && (this.inkClipboard || this.textClipboard)) { this.showPasteBar(pts[0][0], pts[0][1]); return; }   // a tap on empty paper with something on the clipboard: offer to paste here
        if (quiet) return;
        if (span >= 4) this.app.toast('Nothing inside the loop. Draw it around handwriting, typed words or a photo to pick them up.', 2600);
        else this.app.toast('Draw a loop around handwriting or words to pick them up, or tap a word.', 2400);
        return;
      }
      this.lassoSel = { sheet: this.sheet, pageIndex: this.pageIndex, strokes: picked, words, media, box: null };
      this.lassoSel.box = this.lassoBounds(picked, words, media);
      this.renderLassoBox(); this.lassoActions.hidden = false; this.positionLassoActions();
      try { if (navigator.vibrate) navigator.vibrate(6); } catch (err) {}
      this._lassoHints = (this._lassoHints || 0) + 1;
      const parts = []; if (picked.length) parts.push(`${picked.length} stroke${picked.length > 1 ? 's' : ''}`); if (words.length) parts.push(`${words.length} word${words.length > 1 ? 's' : ''}`); if (media.length) parts.push(`${media.length} photo${media.length > 1 ? 's' : ''}`);
      if (this._lassoHints <= 3) this.app.toast(`${parts.join(', ')} picked up. Drag to move, corner handle resizes, the bar cuts, copies, converts or deletes.`, 2800);
    }
    /* a "Paste" button where the person tapped; the pasted ink is centred there */
    showPasteBar(x, y) {
      this.pasteAt = { sheet: this.sheet, x, y };
      const bar = this.lassoActions; bar.dataset.mode = 'paste'; bar.hidden = false; bar.querySelector('[data-act="paste"]').hidden = false;
      const pr = this.pageEl.getBoundingClientRect(), sr = this.scroller.getBoundingClientRect();
      const left = Math.max(8, Math.min(sr.width - bar.offsetWidth - 8, pr.left - sr.left + x * this.s - bar.offsetWidth / 2));
      let top = pr.top - sr.top + y * this.s - 54; if (top < 6) top = pr.top - sr.top + y * this.s + 24;
      bar.style.left = left + 'px'; bar.style.top = top + 'px';
    }
    clearLasso() {
      this.lassoDraw = null; this.lassoDrag = null; this.pasteAt = null; this.lassoActions.dataset.mode = '';
      if (this.lassoSel) { const sh = this.lassoSel.sheet; this.lassoSel = null; if (this.sheetLive(sh)) { const el = sh.lassoLayer.querySelector('.lasso-box'); el.hidden = true; el.classList.remove('moving'); sh.lassoLayer.querySelector('.lasso-path').setAttribute('hidden', ''); } }
      this.lassoActions.hidden = true;
    }
    /* runs fn on the page that owns the selection, even when another sheet is active */
    withLasso(fn) { const sel = this.lassoSel; if (!sel || !this.sheetLive(sel.sheet)) return undefined; return this.using(this.sheets.indexOf(sel.sheet), () => fn(sel, this.page)); }
    lassoAction(act) {
      if (act === 'paste') { this.pasteInk(); return; }
      const sel = this.lassoSel; if (!sel) return;
      const words = sel.words || [], media = sel.media || [];
      if (act === 'copy' || act === 'cut') {
        if (sel.strokes.length) this.inkClipboard = { strokes: sel.strokes.map(st => ({ pts: st.pts.map(p => p.slice()), color: st.color, width: st.width, kind: st.kind, pen: st.pen })), box: { ...sel.box }, pageId: this.withLasso((s, p) => p.id) };
        else if (words.length) this.inkClipboard = null;
        this.textClipboard = words.length ? words.map(w => w.text).join(' ') : null;
        if (this.textClipboard) { try { navigator.clipboard && navigator.clipboard.writeText(this.textClipboard).catch(() => {}); } catch (e) {} }
        if (act === 'copy') { this.app.toast(media.length && !sel.strokes.length && !words.length ? 'Photos cannot be copied yet — move or delete them.' : 'Copied. Paste lands it on any page.', 2000); this.positionLassoActions(); return; }
      }
      if (act === 'del' || act === 'cut') {
        const n = sel.strokes.length + words.length + media.length;
        this.withLasso((s, page) => {
          const entries = [];
          if (s.strokes.length) { const removed = s.strokes.map(st => ({ stroke: st, index: page.strokes.indexOf(st) })).filter(it => it.index >= 0).sort((a, b) => a.index - b.index); const set = new Set(s.strokes); page.strokes = page.strokes.filter(st => !set.has(st)); entries.push({ type: 'erase', removed }); }
          if (words.length) { const before = page.rows.slice(); this.takeWords(words); entries.push({ type: 'rows', before, after: page.rows.slice() }); this.refreshRows(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged(); }
          if (media.length) { const before = this.cloneMedia(); const ids = new Set(media.map(m => m.id)); page.media = page.media.filter(m => !ids.has(m.id)); entries.push({ type: 'media', before, after: this.cloneMedia() }); this.renderMedia(); }
          if (entries.length) this.pushUndo(entries.length === 1 ? entries[0] : { type: 'multi', entries });
          this.markDirty(); this.redraw(); this.liveRefresh();
        });
        this.clearLasso();
        this.app.toast(act === 'cut' ? 'Cut. Paste lands it on any page.' : `Deleted ${n} item${n > 1 ? 's' : ''}. Undo brings them back.`, 2000);
        return;
      }
      if (act === 'convert') {
        const strokes = sel.strokes.filter(st => st.kind !== 'hl');
        if (!strokes.length) { this.app.toast(words.length ? 'That is already text.' : 'Only highlighter marks or photos in the selection — nothing to convert.', 2200); return; }
        const slot = this.sheets.indexOf(sel.sheet); this.clearLasso();
        this.using(slot, () => this.convert(null, false, strokes));
      }
    }
    /* pastes copied ink (and copied words, at the end of the row under the paste point): on the same page a little
       below-right of the original, elsewhere at the same spot (kept on the page) */
    pasteInk() {
      const clip = this.inkClipboard, text = this.textClipboard; if (!clip && !text) return;
      const at = this.pasteAt && this.sheetLive(this.pasteAt.sheet) ? this.pasteAt : null;
      const sh = at ? at.sheet : this.sheets[this.focus]; if (!sh) return;
      this.using(this.sheets.indexOf(sh), () => {
        const page = this.page; const L = this.L; const entries = []; let clones = [];
        if (clip) {
          const w = clip.box.x1 - clip.box.x0, h = clip.box.y1 - clip.box.y0;
          let x0 = clip.box.x0, y0 = clip.box.y0;
          if (at) { x0 = at.x - w / 2; y0 = at.y - h / 2; } else if (page.id === clip.pageId) { x0 += L * 0.6; y0 += L * 0.6; }
          x0 = Math.max(2, Math.min(PAGE.W - w - 2, x0)); y0 = Math.max(2, Math.min(PAGE.H - h - 2, y0));
          const dx = x0 - clip.box.x0, dy = y0 - clip.box.y0; const now = Date.now();
          clones = clip.strokes.map((st, i) => ({ pts: st.pts.map(p => [Math.round((p[0] + dx) * 10) / 10, Math.round((p[1] + dy) * 10) / 10, p[2], p[3]]), color: st.color, width: st.width, kind: st.kind, pen: st.pen, at: now + i }));
          clones.forEach(st => this.strokeId(st)); page.strokes.push(...clones);
          entries.push({ type: 'strokes', strokes: clones });
        }
        let pastedWords = [];
        if (text) {
          const r = Math.max(0, Math.min(page.rows.length - 1, at ? Math.floor((at.y - PAGE.top) / L) : this.caret.row));
          const before = page.rows.slice(); const t = page.rows[r] || ''; page.rows[r] = (t && !/\s$/.test(t) ? t + ' ' : t) + text; this.reflowFrom(r, null);
          entries.push({ type: 'rows', before, after: page.rows.slice() }); this.refreshRows(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
          pastedWords = this.findWords(text.split(/\s+/).filter(Boolean).map(tx => ({ row: r, text: tx })));
        }
        if (entries.length) this.pushUndo(entries.length === 1 ? entries[0] : { type: 'multi', entries });
        this.markDirty(); this.redraw(); this.liveRefresh();
        this.clearLasso(); if (this.tool !== 'lasso') this.setTool('lasso');
        if (clones.length || pastedWords.length) { this.lassoSel = { sheet: this.sheet, pageIndex: this.pageIndex, strokes: clones, words: pastedWords, media: [], box: null }; this.lassoSel.box = this.lassoBounds(clones, pastedWords, []); this.renderLassoBox(); this.lassoActions.hidden = false; this.positionLassoActions(); }
      });
      this.app.toast('Pasted. Drag it where you want it.', 1800);
    }
    /* an ink or highlighter colour tapped while ink is picked up recolours the selection instead of changing the pen */
    recolorSelection(color, kind) {
      const sel = this.lassoSel; if (!sel) return false;
      const targets = sel.strokes.filter(st => (st.kind === 'hl') === (kind === 'hl')); if (!targets.length) return false;
      const before = this.lassoSnapshot(targets); targets.forEach(st => { st.color = color; }); const after = this.lassoSnapshot(targets);
      this.withLasso(() => { this.pushUndo({ type: 'xform', before, after }); this.markDirty(); this.redraw(); });
      return true;
    }

    /* ---------- ink lines: write anywhere, any size ---------- */
    strokeId(st) { if (!st.id) st.id = 'k' + (++this._sid); return st.id; }
    /* Groups ink into handwritten lines by vertical overlap in writing order, and estimates each line's letter scale. */
    inkLines(strokes) {
      const items = strokes.filter(st => st.kind !== 'hl').map(st => ({ st, b: strokeBox(st), at: st.at || 0 }));
      items.sort((a, b) => a.at - b.at);
      const lines = [];
      for (const it of items) {
        const h = it.b.y1 - it.b.y0; let best = null, bestScore = -1;
        for (const ln of lines) {
          const lh = Math.max(1, ln.y1 - ln.y0);
          const ov = Math.min(ln.y1, it.b.y1) - Math.max(ln.y0, it.b.y0);
          const vScore = ov / Math.max(1, Math.min(lh, h));
          const inBand = it.b.cy > ln.y0 - 0.45 * lh && it.b.cy < ln.y1 + 0.45 * lh;
          const nearX = it.b.x0 < ln.x1 + 3 * lh && it.b.x1 > ln.x0 - 3 * lh;
          const ok = nearX && (vScore > 0.3 || (inBand && h < 0.6 * lh));
          if (ok && vScore > bestScore) { best = ln; bestScore = vScore; }
        }
        if (best) { best.strokes.push(it.st); it.st.lineKey = best.key; best.x0 = Math.min(best.x0, it.b.x0); best.x1 = Math.max(best.x1, it.b.x1); best.y0 = Math.min(best.y0, it.b.y0); best.y1 = Math.max(best.y1, it.b.y1); best.lastAt = Math.max(best.lastAt, it.at); }
        else { const key = it.st.lineKey || this.strokeId(it.st); it.st.lineKey = key; lines.push({ key, strokes: [it.st], x0: it.b.x0, x1: it.b.x1, y0: it.b.y0, y1: it.b.y1, lastAt: it.at }); }
      }
      // a line keeps its key even after its first strokes were committed; split lines get fresh keys
      const seen = new Set(); for (const ln of lines) { if (seen.has(ln.key)) { ln.key = this.strokeId(ln.strokes[0]) + '~'; ln.strokes.forEach(st => st.lineKey = ln.key); } seen.add(ln.key); }
      for (const ln of lines) {
        const hs = ln.strokes.map(st => { const b = strokeBox(st); return b.y1 - b.y0; }).sort((a, b) => a - b);
        const med = hs[hs.length >> 1] || 1, max = hs[hs.length - 1] || 1, h = Math.max(2, ln.y1 - ln.y0);
        const mixed = max > 1.4 * med;                  // tall letters next to short ones
        ln.L = Math.max(10, mixed ? h / 0.8 : h / 0.45); // the ruled-row height this writing would correspond to
        const bottoms = ln.strokes.map(st => strokeBox(st).y1).sort((a, b) => a - b);
        ln.rowTop = bottoms[bottoms.length >> 1] - ln.L;
      }
      return lines;
    }
    lineByKey(key) { return this.inkLines(this.page.strokes).find(l => l.key === key) || null; }

    /* ---------- caret: where converted text goes ---------- */
    defaultCaret(page) { let r = -1; page.rows.forEach((t, i) => { if (t.trim()) r = i; }); return r < 0 ? { row: 0 } : { row: r }; }
    get caret() { const p = this.page; if (!p.caret || p.caret.row >= p.rows.length) p.caret = this.defaultCaret(p); return p.caret; }
    setCaret(row) { this.page.caret = { row: Math.max(0, Math.min(this.page.rows.length - 1, row)) }; this.renderCaret(); this.markDirty(); }
    renderCaret() {
      if (!this.rowsEl) return;
      let c = this.rowsEl.querySelector('.caret'); if (!c) { c = document.createElement('div'); c.className = 'caret'; this.rowsEl.appendChild(c); }
      const row = this.caret.row; const text = this.page.rows[row] || '';
      c.style.setProperty('--i', row); c.style.setProperty('--cx', (PAGE.left + 3 + this.measure(text)).toFixed(1));
      const focused = document.activeElement && document.activeElement.classList.contains('row');
      c.hidden = focused || this.tool === 'type' || this.app.settings.engine === 'system';
      for (let i = 0; i < this.rowsEl.children.length; i++) { const d = this.rowsEl.children[i]; if (d.classList.contains('row')) d.classList.toggle('is-current', i === row && !c.hidden); }
    }
    /* New line: moves the caret to the next row (adding a page at the end of the last one). */
    async enter() {
      if (this.tool === 'type' || this.app.settings.engine === 'system') {
        const d = document.activeElement && document.activeElement.classList.contains('row') ? document.activeElement : null;
        const i = d ? +d.dataset.i : this.caret.row;
        if (i < this.page.rows.length - 1) this.focusRow(i + 1, 0); else { await this.addPage(this.pageIndex); this.focusRow(0, 0); }
        this.setCaret(d ? Math.min(i + 1, this.page.rows.length - 1) : this.caret.row); return;
      }
      this.liveCommitAll(); await this.liveFlush();
      if (this.caret.row < this.page.rows.length - 1) this.setCaret(this.caret.row + 1);
      else if (this.active === 0 && this.sheets[1]) { this.activate(1); this.setCaret(0); }   // facing page of the spread
      else { await this.addPage(this.pageIndex); this.setCaret(0); }
    }
    /* Inserts words at the caret, reflows, moves the caret on. Returns [{row,start,end,text}] for each word. */
    insertAtCaret(texts) {
      const page = this.page; const row = this.caret.row; const placed = [];
      let t = page.rows[row] || '';
      for (const w of texts) { const sep = t && !/\s$/.test(t) ? ' ' : ''; t = t + sep + w; }
      page.rows[row] = t;
      const last = this.reflowFrom(row, null); const endRow = typeof last === 'number' ? last : row;
      // find where each word ended up after the reflow (search back from the caret row)
      let r = endRow, cursor = Infinity;
      for (let k = texts.length - 1; k >= 0; k--) {
        const w = texts[k]; let found = null;
        for (let rr = r; rr >= row && !found; rr--) { const hay = page.rows[rr] || ''; const idx = hay.lastIndexOf(w, rr === r ? cursor : Infinity); if (idx >= 0) { found = { row: rr, start: idx, end: idx + w.length, text: w }; r = rr; cursor = idx - 1; } }
        placed.unshift(found || { row, start: 0, end: 0, text: w });
      }
      page.caret = { row: endRow }; this.renderCaret();
      return placed;
    }
    /* Converts every line of ink on the page (in writing order) into text at the caret. */
    async convert(rowFilter, silent, subset) {
      this.liveCommitAll();
      const page = this.page; const source = subset ? subset.filter(st => page.strokes.includes(st)) : page.strokes;
      if (!source.some(st => st.kind !== 'hl')) { if (!silent) this.app.toast('Nothing to convert yet. Write anywhere on the page first.'); return; }
      if (this.converting) return; this.converting = true;
      const sh = this.sheet; const here = fn => this.sheetLive(sh) ? this.using(this.sheets.indexOf(sh), fn) : undefined;
      try {
        const lines = this.inkLines(source); if (!lines.length) return;
        const rowsBefore = page.rows.slice(); const removed = []; let count = 0, k = 0;
        for (const ln of lines) {
          if (!silent && lines.length > 1) { this.app.toast(`Converting line ${++k} of ${lines.length}…`, 4000); await new Promise(res => setTimeout(res, 0)); }
          let words = []; try { words = await IL.hwrClient.recognizeRowWords(ln.strokes, ln.rowTop, ln.L); } catch (e) {}
          if (!this.sheetLive(sh)) return;
          for (const st of ln.strokes) { const i = page.strokes.indexOf(st); if (i >= 0) removed.push({ s: st, i }); }
          if (words.length) { here(() => { this.insertAtCaret(words.map(w => w.text)); }); words.forEach(w => IL.hwrClient.learnWords(w.text)); count += words.length; }
        }
        here(() => {
          const set = new Set(removed.map(it => it.s)); page.strokes = page.strokes.filter(st => !set.has(st));
          this.pushUndo({ type: 'convert', before: rowsBefore, after: page.rows.slice(), removed: removed.sort((a, b) => a.i - b.i), caretBefore: this.page.caret });
          this.refreshRows(); this.redraw(); this.markDirty(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
          if (this.lv) { for (const [key] of this.lv.lines) this.renderPreview(key, null); this.lv.lines.clear(); }
          const d = this.rowsEl.children[this.caret.row]; if (d) { d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); }
        });
        if (!silent) this.app.toast(count ? `Converted ${count} word${count > 1 ? 's' : ''}.` : 'No letters recognized in that ink.');
      } finally { this.converting = false; }
    }

    /* ---------- pen gestures over typed text: X, scribble or strike-through deletes the word ---------- */
    strokeShape(st) {
      const pts = st.pts; const b = strokeBox(st); let len = 0, flipsX = 0, flipsY = 0, lastX = 0, lastY = 0;
      for (let i = 1; i < pts.length; i++) { const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1]; len += Math.hypot(dx, dy); if (Math.abs(dx) > 0.6) { const sg = Math.sign(dx); if (lastX && sg !== lastX) flipsX++; lastX = sg; } if (Math.abs(dy) > 0.6) { const sg = Math.sign(dy); if (lastY && sg !== lastY) flipsY++; lastY = sg; } }
      const flips = Math.max(flipsX, flipsY);
      const chord = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]);
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      return { b, w, h, len, straight: len ? chord / len : 0, slope: w > 0.5 ? (pts[pts.length - 1][1] - pts[0][1]) / (pts[pts.length - 1][0] - pts[0][0] || 0.01) : 99, flips };
    }
    /* words of a row with their x extents in page units */
    rowWords(r) {
      const text = this.page.rows[r] || ''; const out = []; const re = /\S+/g; let m;
      while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0], x0: PAGE.left + 3 + this.measure(text.slice(0, m.index)), x1: PAGE.left + 3 + this.measure(text.slice(0, m.index + m[0].length)) });
      return out;
    }
    /* the text row a gesture most likely targets: among rows its box touches, the one whose words overlap it most */
    rowForGesture(b) {
      const L = this.L; const r0 = Math.max(0, Math.floor((b.y0 - PAGE.top) / L)), r1 = Math.min(this.page.rows.length - 1, Math.floor((b.y1 - PAGE.top) / L));
      let best = -1, bestOv = 0;
      for (let r = r0; r <= r1; r++) { if (!(this.page.rows[r] || '').trim()) continue; const words = this.rowWords(r); const ov = words.reduce((m, w) => m + Math.max(0, Math.min(w.x1, b.x1) - Math.max(w.x0, b.x0)), 0); const bandOv = Math.min(b.y1, PAGE.top + (r + 1) * L) - Math.max(b.y0, PAGE.top + r * L); const score = ov * Math.max(0, bandOv); if (score > bestOv) { bestOv = score; best = r; } }
      return best;
    }
    editGesture(st) {
      const L = this.L; const sh = this.strokeShape(st); const b = sh.b;
      const r = this.rowForGesture(b); if (r < 0) { this.sheet.pendingX = null; return false; }
      // ignore while a word is being written nearby (its other strokes are still fresh ink)
      const now = Date.now();
      const others = this.page.strokes.filter(s2 => s2 !== st && s2.kind !== 'hl' && !(this.sheet.pendingX && this.sheet.pendingX.stroke === s2) && now - (s2.at || 0) < 2500);
      if (others.some(s2 => { const ob = strokeBox(s2); return Math.abs(ob.cy - b.cy) < 1.2 * L && ob.x1 > b.x0 - 1.5 * L && ob.x0 < b.x1 + 1.5 * L; })) { this.sheet.pendingX = null; return false; }
      let gestureBox = null, kind = null;
      const diagonal = sh.straight > 0.86 && Math.abs(sh.slope) > 0.35 && Math.abs(sh.slope) < 3 && sh.w > 0.25 * L && sh.h > 0.25 * L && sh.h < 2.2 * L;
      if (diagonal) {
        const px = this.sheet.pendingX;
        if (px && Date.now() - px.at < 1500 && Math.sign(px.slope) !== Math.sign(sh.slope)) {
          const ov = Math.min(px.b.x1, b.x1) - Math.max(px.b.x0, b.x0); const minW = Math.max(1, Math.min(px.b.x1 - px.b.x0, sh.w));
          if (ov > 0.5 * minW) { gestureBox = { x0: Math.min(px.b.x0, b.x0), x1: Math.max(px.b.x1, b.x1), cx: (Math.min(px.b.x0, b.x0) + Math.max(px.b.x1, b.x1)) / 2 }; kind = 'x'; }
        }
        if (!gestureBox) { this.sheet.pendingX = { stroke: st, at: Date.now(), slope: sh.slope, b }; return false; }
      }
      if (!gestureBox && sh.flips >= 4 && sh.len > 2.5 * sh.w && sh.w > 0.45 * L && sh.h > 0.15 * L && sh.h < 1.7 * L) { gestureBox = { x0: b.x0, x1: b.x1, cx: b.cx }; kind = 'scribble'; }
      if (!gestureBox && sh.straight > 0.9 && Math.abs(sh.slope) < 0.18 && sh.h < 0.3 * L && sh.w > 0.6 * L) {
        const yIn = b.cy - (PAGE.top + r * L); if (yIn > 0.25 * L && yIn < 0.85 * L) { gestureBox = { x0: b.x0, x1: b.x1, cx: b.cx }; kind = 'strike'; }
      }
      if (!gestureBox) return false;
      const words = this.rowWords(r); const minLen = kind === 'strike' ? 0.6 : 0.35;
      const hit = words.filter(w => { const ov = Math.min(w.x1, gestureBox.x1) - Math.max(w.x0, gestureBox.x0); return (gestureBox.cx >= w.x0 && gestureBox.cx <= w.x1) || ov > minLen * (w.x1 - w.x0); });
      if (!hit.length) { this.sheet.pendingX = null; return false; }
      this.deleteWords(r, hit, kind === 'x' ? [this.sheet.pendingX.stroke, st] : [st]);
      this.sheet.pendingX = null; return true;
    }
    deleteWords(r, hits, gestureStrokes) {
      const page = this.page; const before = page.rows.slice();
      let text = page.rows[r]; const ranges = hits.map(h => [h.start, h.end]).sort((a, b) => b[0] - a[0]);
      for (const [s0, e0] of ranges) { let s1 = s0, e1 = e0; if (text[e1] === ' ') e1++; else if (s1 > 0 && text[s1 - 1] === ' ') s1--; text = text.slice(0, s1) + text.slice(e1); }
      page.rows[r] = text.replace(/\s+$/, '');
      const set = new Set(gestureStrokes); page.strokes = page.strokes.filter(s2 => !set.has(s2));
      // fold the gesture strokes' undo steps into a single word deletion step
      page._undo = page._undo.filter(e => !(e.type === 'stroke' && set.has(e.stroke)));
      page._undo.push({ type: 'rows', before, after: page.rows.slice() }); page._redo.length = 0; this.updateUndoButtons();
      if (this.lv) this.lv.commits = this.lv.commits.filter(c => c.row !== r);
      this.refreshRows(); this.redraw(); this.markDirty(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
      const d = this.rowsEl.children[r]; if (d) { d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); }
      this.app.toast(`Deleted “${hits.map(h => h.text).join(' ')}”. Undo brings it back.`, 2200);
    }

    /* ---------- live conversion: preview while writing, commit per word at the caret ---------- */
    get liveOn() { return this.app.settings.live !== false; }
    liveReset() { this.lv = { lines: new Map(), commits: [], suspended: false, lastKey: null }; if (this.previewLayer) this.previewLayer.innerHTML = ''; }
    /* timers and recognizer replies come back later: run them against the sheet they were started on */
    later(fn, delay) { const slot = this.active, sh = this.sheet; return setTimeout(() => { if (this.sheetLive(sh)) this.using(this.sheets.indexOf(sh), fn); }, delay); }
    liveStroke(stroke) {
      if (!this.liveOn || stroke.kind === 'hl') return;
      const lv = this.lv; lv.suspended = false;
      if (this.liveRetro(stroke)) return;
      const lines = this.inkLines(this.page.strokes); const ln = lines.find(l => l.strokes.includes(stroke)); if (!ln) return;
      for (const [key, st] of lv.lines) { if (key !== ln.key) { if (lines.some(l => l.key === key)) this.liveScheduleCommit(key, 450); else { clearTimeout(st.timer); clearTimeout(st.pauseTimer); this.renderPreview(key, null); lv.lines.delete(key); } } }
      lv.lastKey = ln.key;
      this.liveSchedule(ln.key, 90);
    }
    liveState(key) { let st = this.lv.lines.get(key); if (!st) { st = { seq: 0, words: [] }; this.lv.lines.set(key, st); } return st; }
    liveSchedule(key, delay) { const st = this.liveState(key); clearTimeout(st.timer); st.timer = this.later(() => this.livePreview(key), delay); }
    async livePreview(key) {
      const sh = this.sheet; const st = this.lv.lines.get(key); if (!st) return;
      const ln = this.lineByKey(key); if (!ln) { this.renderPreview(key, null); this.lv.lines.delete(key); return; }
      const seq = ++st.seq; let words = [];
      try { words = await IL.hwrClient.recognizeRowWords(ln.strokes, ln.rowTop, ln.L); } catch (e) {}
      if (!this.sheetLive(sh)) return;
      this.using(this.sheets.indexOf(sh), () => {
        if (seq !== st.seq || !this.lv.lines.has(key)) return;
        st.words = words.map(w => ({ text: w.text, x0: w.x0, x1: w.x1, lastAt: w.lastAt, strokes: w.idx.map(i => ln.strokes[i]) }));
        st.line = ln;
        this.renderPreview(key, st.words, ln);
        this.liveEvaluate(key);
      });
    }
    renderPreview(key, words, ln) {
      if (!this.previewLayer) return;
      this.previewLayer.querySelectorAll(`.pv[data-key="${key}"]`).forEach(n => n.remove());
      if (!words || !ln) return;
      for (const w of words) {
        const d = document.createElement('div'); d.className = 'pv'; d.dataset.key = key; d.textContent = w.text;
        d.style.setProperty('--px', w.x0.toFixed(1)); d.style.setProperty('--py', (ln.y0 - 0.62 * ln.L).toFixed(1)); d.style.setProperty('--pl', ln.L.toFixed(1));
        this.previewLayer.appendChild(d);
      }
    }
    liveEvaluate(key) {
      const st = this.lv.lines.get(key); if (!st || !st.words.length || this.lv.suspended) return;
      const now = Date.now(), grace = 450, pause = Math.max(400, (this.app.settings.autoDelay || 1.2) * 1000);
      const words = st.words.slice().sort((a, b) => a.x0 - b.x0);
      const ready = words.filter((w, i) => i < words.length - 1 && now - w.lastAt > grace);
      if (ready.length) { this.commitWords(key, ready); return; }
      const last = words[words.length - 1]; const wait = Math.max(60, pause - (now - last.lastAt));
      clearTimeout(st.pauseTimer); st.pauseTimer = this.later(() => { if (!this.live && !this.erase) this.liveCommitLine(key); else this.liveSchedule(key, 300); }, wait);
    }
    liveScheduleCommit(key, delay) { const st = this.lv.lines.get(key); if (!st) return; clearTimeout(st.pauseTimer); st.pauseTimer = this.later(() => this.liveCommitLine(key), delay); }
    async liveCommitLine(key) {
      if (!this.liveOn || this.lv.suspended) return;
      const sh = this.sheet; const ln = this.lineByKey(key); if (!ln) { this.renderPreview(key, null); this.lv.lines.delete(key); return; }
      const st = this.liveState(key); const seq = ++st.seq; let words = [];
      try { words = await IL.hwrClient.recognizeRowWords(ln.strokes, ln.rowTop, ln.L); } catch (e) {}
      if (!this.sheetLive(sh)) return;
      this.using(this.sheets.indexOf(sh), () => {
        if (seq !== st.seq) return;
        if (!words.length) { st.words = []; this.renderPreview(key, null); return; } // unreadable ink stays as ink
        this.commitWords(key, words.map(w => ({ text: w.text, x0: w.x0, x1: w.x1, lastAt: w.lastAt, strokes: w.idx.map(i => ln.strokes[i]) })), ln);
      });
    }
    commitWords(key, words, ln) {
      const page = this.page; words = words.slice().sort((a, b) => a.x0 - b.x0);
      const before = page.rows.slice(), caretBefore = { ...this.caret }; const removed = [];
      const st = this.lv.lines.get(key); const line = ln || (st && st.line) || this.lineByKey(key);
      const placed = this.insertAtCaret(words.map(w => w.text));
      words.forEach((w, i) => {
        this.lv.commits.push({ ...placed[i], strokes: w.strokes.slice(), x0: w.x0, x1: w.x1, y0: line ? line.y0 : 0, y1: line ? line.y1 : 0, L: line ? line.L : this.L, at: Date.now() });
        for (const s2 of w.strokes) { const i2 = page.strokes.indexOf(s2); if (i2 >= 0) removed.push({ s: s2, i: i2 }); }
        IL.hwrClient.learnWords(w.text);
      });
      const set = new Set(removed.map(it => it.s)); page.strokes = page.strokes.filter(s2 => !set.has(s2));
      this.lv.commits = this.lv.commits.filter(c => Date.now() - c.at < 10000).slice(-30);
      this.pushUndo({ type: 'convert', before, after: page.rows.slice(), removed: removed.sort((a, b) => a.i - b.i), caretBefore });
      this.refreshRows(); this.redraw(); this.markDirty(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
      const d = this.rowsEl.children[this.caret.row]; if (d) { d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); }
      const left = this.lineByKey(key);
      if (!left) { this.renderPreview(key, null); this.lv.lines.delete(key); }
      else { if (st) { st.words = st.words.filter(w => w.strokes.some(s2 => left.strokes.includes(s2))); this.renderPreview(key, st.words, left); } this.liveSchedule(key, 120); }
    }
    /* A dot or crossbar added right after a word was committed: re-read that word with the new stroke. */
    liveRetro(stroke) {
      const b = strokeBox(stroke); const now = Date.now();
      const c = this.lv.commits.slice().reverse().find(c => now - c.at < 4000 && Math.max(b.x1 - b.x0, b.y1 - b.y0) < 0.3 * c.L && b.cx > c.x0 - 0.1 * c.L && b.cx < c.x1 + 0.1 * c.L && b.cy > c.y0 - 0.7 * c.L && b.cy < c.y1 + 0.3 * c.L);
      if (!c) return false;
      const page = this.page;
      if ((page.rows[c.row] || '').slice(c.start, c.end) !== c.text) return false;
      const strokes = c.strokes.concat([stroke]); const sh = this.sheet;
      const L = c.L; const bottoms = strokes.map(s2 => strokeBox(s2).y1).sort((a, b2) => a - b2); const rowTop = bottoms[bottoms.length >> 1] - L;
      IL.hwrClient.recognizeRowWords(strokes, rowTop, L).then(words => { if (!this.sheetLive(sh)) return; this.using(this.sheets.indexOf(sh), () => {
        const newText = words.map(w => w.text).join(' ');
        const i = page.strokes.indexOf(stroke); if (i < 0) return;
        if ((page.rows[c.row] || '').slice(c.start, c.end) !== c.text) return;
        const before = page.rows.slice();
        if (newText && newText !== c.text) {
          page.rows[c.row] = page.rows[c.row].slice(0, c.start) + newText + page.rows[c.row].slice(c.end);
          const delta = newText.length - c.text.length; c.end += delta; c.text = newText;
          this.lv.commits.forEach(o => { if (o !== c && o.row === c.row && o.start >= c.end - delta) { o.start += delta; o.end += delta; } });
        }
        c.strokes.push(stroke); page.strokes.splice(i, 1);
        const k = page._undo.map(e => e.type === 'stroke' && e.stroke === stroke).lastIndexOf(true);
        const entry = { type: 'rows', before, after: page.rows.slice() };
        if (k >= 0) page._undo[k] = entry; else page._undo.push(entry);
        page._redo.length = 0; this.updateUndoButtons();
        this.reflowFrom(c.row, null); this.refreshRows(); this.redraw(); this.markDirty(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
      }); }).catch(() => {});
      return true;
    }
    /* after erasing or undo: refresh previews but do not commit until the next stroke */
    liveRefresh() {
      if (!this.liveOn || !this.lv) return;
      this.lv.suspended = true;
      const lines = this.inkLines(this.page.strokes); const keys = new Set(lines.map(l => l.key));
      for (const [key, st] of this.lv.lines) { clearTimeout(st.pauseTimer); if (!keys.has(key)) { this.renderPreview(key, null); this.lv.lines.delete(key); } }
      lines.forEach(l => this.liveSchedule(l.key, 150));
    }
    liveCommitAll() { if (!this.lv) return; for (const [, st] of this.lv.lines) { clearTimeout(st.timer); clearTimeout(st.pauseTimer); } }
    /* commit whatever is still ink right now (Enter button, leaving the page) */
    async liveFlush() { if (!this.liveOn || !this.page.strokes.some(st => st.kind !== 'hl')) return; await this.convert(null, true); }

    /* ---------- undo / redo ---------- */
    pushUndo(entry) { const p = this.page; p._undo.push(entry); if (p._undo.length > 80) p._undo.shift(); p._redo.length = 0; this.updateUndoButtons(); }
    undo() { if (this.sheets[this.focus]) this.activate(this.focus); const p = this.page; const e = p._undo.pop(); if (!e) return; this.applyEntry(e, true); p._redo.push(e); this.updateUndoButtons(); }
    redo() { if (this.sheets[this.focus]) this.activate(this.focus); const p = this.page; const e = p._redo.pop(); if (!e) return; this.applyEntry(e, false); p._undo.push(e); this.updateUndoButtons(); }
    applyEntry(e, undo) {
      const p = this.page;
      if (e.type === 'stroke') { if (undo) { const i = p.strokes.indexOf(e.stroke); if (i >= 0) p.strokes.splice(i, 1); } else p.strokes.push(e.stroke); }
      else if (e.type === 'erase') { if (undo) e.removed.slice().sort((a, b) => a.index - b.index).forEach(it => p.strokes.splice(Math.min(it.index, p.strokes.length), 0, it.stroke)); else { const set = new Set(e.removed.map(it => it.stroke)); p.strokes = p.strokes.filter(s => !set.has(s)); } if (e.rowsBefore) p.rows = (undo ? e.rowsBefore : e.rowsAfter).slice(); }
      else if (e.type === 'rows') { p.rows = (undo ? e.before : e.after).slice(); }
      else if (e.type === 'convert') { p.rows = (undo ? e.before : e.after).slice(); if (undo) { e.removed.forEach(it => p.strokes.splice(Math.min(it.i, p.strokes.length), 0, it.s)); if (e.caretBefore) p.caret = { ...e.caretBefore }; } else { const set = new Set(e.removed.map(it => it.s)); p.strokes = p.strokes.filter(s => !set.has(s)); } }
      else if (e.type === 'media') { p.media = (undo ? e.before : e.after).map(m => ({ ...m })); this.renderMedia(); if (this.tf) this.tf.select(null); this.mediaActions.hidden = true; }
      else if (e.type === 'strokes') { if (undo) { const set = new Set(e.strokes); p.strokes = p.strokes.filter(s => !set.has(s)); } else p.strokes.push(...e.strokes); }
      else if (e.type === 'xform') { this.lassoRestore(undo ? e.before : e.after); }
      else if (e.type === 'multi') { for (const sub of (undo ? e.entries.slice().reverse() : e.entries)) this.applyEntry(sub, undo); return; }
      if (this.lassoSel) this.clearLasso();
      if (document.activeElement && document.activeElement.classList.contains('row')) document.activeElement.blur();
      this.refreshRows(); this.redraw(); this.markDirty(); this.renderCaret(); this.app.onTextChanged && this.app.onTextChanged();
      this.liveRefresh();
    }
    updateUndoButtons() { const sh = this.sheets[this.focus]; const p = sh ? this.pages[sh.pageIndex] : this.page; document.getElementById('undo-btn').disabled = !p || !p._undo.length; document.getElementById('redo-btn').disabled = !p || !p._redo.length; }
    /* undo/redo act on the page the person is working on */
    focusPage() { const sh = this.sheets[this.focus]; return sh ? this.pages[sh.pageIndex] : this.page; }

    /* ---------- pages ---------- */
    /* the page a turn lands on, or null at the ends; in a spread a turn moves a whole sheet (two pages) */
    turnTarget(dir) {
      const n = this.pages.length;
      if (!this.spreadMode()) { const t = this.pageIndex + dir; return t < 0 || t >= n ? null : t; }
      const base = this.spreadBase(this.pageIndex);
      if (dir > 0) return base + 2 < n ? base + 2 : null;
      return base - 2 >= 0 ? Math.min(base - 1, n - 1) : null;
    }
    updatePager() {
      this.updateZones();
      const n = this.pages.length; let label = `Page ${this.pageIndex + 1} of ${n}`;
      if (this.spreadMode()) { const b = this.spreadBase(this.pageIndex); label = b + 1 < n ? `Pages ${b + 1}–${b + 2} of ${n}` : `Page ${b + 1} of ${n}`; }
      document.getElementById('page-indicator').textContent = label;
      document.getElementById('page-prev').disabled = this.turnTarget(-1) == null;
      document.getElementById('page-next').disabled = this.turnTarget(1) == null;
    }
    /* flushes pending live ink on every sheet on screen */
    async liveFlushAll() { for (let k = 0; k < this.sheets.length; k++) { const sh = this.sheets[k]; if (this.liveOn && sh.lv && sh.lv.lines.size) await this.using(k, () => this.liveFlush()); } }
    async goTo(i) {
      i = Math.max(0, Math.min(this.pages.length - 1, i)); if (i === this.pageIndex && this.pageEl) return;
      if (document.activeElement && document.activeElement.classList.contains('row')) document.activeElement.blur();
      const slot = this.slotOfPage(i);
      if (slot >= 0 && this.spreadMode() === this._spreadRendered) { // the page is already on screen: just make it the one to work on
        if (this.liveOn && this.lv && this.lv.lines.size) await this.liveFlush();
        this.activate(slot); return;
      }
      await this.liveFlushAll();
      await this.flush(); this.pageIndex = i; this.nb.lastPage = i; this.renderPage(); this.layout(); this.updatePager(); this.scroller.scrollTop = 0;
      this.app.saveNotebookSoon(this.nb); this.app.onPageChanged && this.app.onPageChanged();
    }
    async addPage(after) {
      const idx = after == null ? this.pages.length : after + 1;
      const np = newPage(this.nb.id, idx, this.L); np._undo = []; np._redo = [];
      this.pages.splice(idx, 0, np); this.pages.forEach((p, k) => { if (p.index !== k) { p.index = k; this.markDirty(p); } });
      this.markDirty(np); await this.flush(); this.nb.pageCount = this.pages.length; this.app.saveNotebookSoon(this.nb);
      await this.goTo(idx); this.updatePager();
    }
    async deletePage(i) {
      if (this.pages.length <= 1) { this.app.toast('A notebook keeps at least one page.'); return; }
      const [p] = this.pages.splice(i, 1); await IL.db.del('pages', p.id);
      for (const m of p.media || []) { if (m.key) IL.blobs.del(m.key); if (m.poster) IL.blobs.del(m.poster); }
      this.pages.forEach((q, k) => { if (q.index !== k) { q.index = k; this.markDirty(q); } });
      this.nb.pageCount = this.pages.length; this.app.saveNotebookSoon(this.nb);
      this.pageIndex = Math.min(this.pageIndex, this.pages.length - 1); this.renderPage(); this.layout(); this.updatePager(); await this.flush();
    }
    /* Paints a page (paper, lines, text, media, ink) into a canvas at `cssW` CSS pixels wide. imgs: Map key -> HTMLImageElement. */
    paintPage(page, canvas, cssW, imgs, dpr) {
      const k = cssW / PAGE.W; dpr = dpr || 1; canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(PAGE.H * k * dpr);
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
      const st = this.nb.settings;
      ctx.fillStyle = '#FFFEFB'; ctx.fillRect(0, 0, PAGE.W, PAGE.H);
      const n = rowsCount(this.L);
      if (st.paper === 'ruled' || st.paper === 'grid') { ctx.strokeStyle = st.paper === 'grid' ? '#DCE4F2' : '#C6D4EA'; ctx.lineWidth = 1 / k; for (let i = 1; i <= n; i++) { const y = PAGE.top + i * this.L; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE.W, y); ctx.stroke(); } }
      if (st.paper === 'grid') { for (let x = this.L; x < PAGE.W; x += this.L) { ctx.beginPath(); ctx.moveTo(x, PAGE.top); ctx.lineTo(x, PAGE.top + n * this.L); ctx.stroke(); } }
      if (st.paper === 'dotted') { ctx.fillStyle = '#C6D4EA'; for (let i = 0; i <= n; i++) for (let x = PAGE.left; x < PAGE.W; x += this.L) { ctx.beginPath(); ctx.arc(x, PAGE.top + i * this.L, 1.4, 0, 7); ctx.fill(); } }
      if (st.marginLine && st.paper !== 'blank') { ctx.strokeStyle = '#F0B9B9'; ctx.lineWidth = 1 / k; ctx.beginPath(); ctx.moveTo(PAGE.left - 14, PAGE.top * 0.5); ctx.lineTo(PAGE.left - 14, PAGE.H - PAGE.bottom * 0.5); ctx.stroke(); }
      for (const m of page.media || []) {
        ctx.save(); ctx.translate(m.x + m.w / 2, m.y + m.h / 2); ctx.rotate((m.rot || 0) * Math.PI / 180);
        const img = imgs && m.type === 'image' && imgs.get(m.key);
        if (img && img.naturalWidth) { try { ctx.drawImage(img, -m.w / 2, -m.h / 2, m.w, m.h); } catch (e) { ctx.fillStyle = '#CBD2E0'; ctx.fillRect(-m.w / 2, -m.h / 2, m.w, m.h); } }
        else if (m.type === 'image') { ctx.fillStyle = '#CBD2E0'; ctx.fillRect(-m.w / 2, -m.h / 2, m.w, m.h); }
        else { ctx.fillStyle = '#1B1F2A'; const r = 10; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, r) : ctx.rect(-m.w / 2, -m.h / 2, m.w, m.h); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `600 ${14}px ${fontCss('Figtree')}`; ctx.textBaseline = 'middle'; ctx.fillText('▶ ' + (m.name || 'Video'), -m.w / 2 + 14, 0, m.w - 28); }
        ctx.restore();
      }
      ctx.fillStyle = st.color; ctx.font = this.mctx.font; ctx.textBaseline = 'alphabetic';
      page.rows.forEach((t, i) => { if (t) ctx.fillText(t, PAGE.left + 2, PAGE.top + i * this.L + this.L * 0.78, this.rowW); });
      for (const s2 of page.strokes) if (s2.kind === 'hl') drawStroke(ctx, s2);
      for (const s2 of page.strokes) if (s2.kind !== 'hl') drawStroke(ctx, s2);
    }
    drawThumb(page, canvas, w) { this.paintPage(page, canvas, w, null, 2); }
    async mediaImages(page) {
      const map = new Map();
      await Promise.all((page.media || []).filter(m => m.type === 'image').map(async m => { try { const u = await IL.blobs.url(m.key); if (!u) return; const img = new Image(); img.src = u; await img.decode(); map.set(m.key, img); } catch (e) {} }));
      return map;
    }

    /* ---------- page turning (flip zones + 3D turn) ---------- */
    setupFlip() {
      this.area = document.getElementById('page-area'); this.flipLayer = document.getElementById('flip-layer');
      this.zones = { '-1': document.getElementById('flip-left'), '1': document.getElementById('flip-right') };
      for (const dir of [-1, 1]) {
        const z = this.zones[dir];
        z.addEventListener('pointerdown', e => this.flipDown(e, dir));
        z.addEventListener('pointermove', e => this.flipMove(e));
        z.addEventListener('pointerup', e => this.flipUp(e));
        z.addEventListener('pointercancel', e => this.flipUp(e, true));
      }
      this.updateZones();
    }
    updateZones() {
      if (!this.zones) return;
      this.zones['-1'].classList.toggle('is-disabled', this.turnTarget(-1) == null);
      this.zones['1'].classList.toggle('is-disabled', this.turnTarget(1) == null);
      const rgb = this.nb && this.nb.cover ? IL.cover.tintOf(this.nb.cover) : [45, 79, 201];
      this.area.style.setProperty('--flip-tint-rgb', rgb.join(','));
    }
    /* ---- interaction: a damped spring carries the sheet; a finger can grab it at any moment ---- */
    flipDown(e, dir) {
      if (this.flip) {                                             // a sheet is in flight: take hold of it where it is
        const f = this.flip; if (f.pointerId != null) return;
        e.preventDefault(); const z = this.zones[dir]; try { z.setPointerCapture(e.pointerId); } catch (err) {}
        f.pointerId = e.pointerId; f.zone = dir; f.x0 = e.clientX; f.p0 = f.progress; f.lastX = e.clientX; f.lastT = e.timeStamp || performance.now(); f.vx = 0; f.goal = null; f.velocity = 0; f.t0 = f.lastT; f.grabbed = true;
        z.classList.add('is-active'); return;
      }
      const target = this.turnTarget(dir);
      if (target == null) { this.app.toast(dir > 0 ? 'Last page. Use "Add page" for a new one.' : 'This is the first page.'); return; }
      e.preventDefault(); const z = this.zones[dir]; try { z.setPointerCapture(e.pointerId); } catch (err) {}
      z.classList.add('is-active'); if (IL.paperSound && this.app.settings.pageSound !== false) IL.paperSound.ensure();
      const now = e.timeStamp || performance.now();
      const f = { dir, target, zone: dir, pointerId: e.pointerId, x0: e.clientX, p0: 0, t0: now, progress: 0, velocity: 0, goal: null, width: this.area.clientWidth, lastX: e.clientX, lastT: now, vx: 0, ready: false, grabbed: false };
      this.flip = f; this.flipBusy = true;
      f.begin = this.beginFlip(dir, target).then(() => { f.ready = true; this.flipLoop(); }).catch(err => { console.warn(err); f.ready = true; f.goal = 0; this.flipLoop(); });
    }
    flipMove(e) {
      const f = this.flip; if (!f || e.pointerId !== f.pointerId) return;
      const dx = e.clientX - f.x0; const now = e.timeStamp || performance.now();
      f.vx = (e.clientX - f.lastX) / Math.max(1, now - f.lastT); f.lastX = e.clientX; f.lastT = now;
      const raw = f.p0 + (-dx * f.dir) / (f.width * 0.55);
      f.progress = raw < 0 ? raw * 0.15 : raw > 1 ? 1 + (raw - 1) * 0.15 : raw;     // rubber-banding past the ends
      if (f.ready) this.setFlipProgress(Math.max(0, Math.min(1, f.progress)));
      if (IL.paperSound && this.app.settings.pageSound !== false) IL.paperSound.slide(Math.abs(f.vx) / 1.4);
    }
    flipUp(e, cancelled) {
      const f = this.flip; if (!f || e.pointerId !== f.pointerId) return;
      this.zones[f.zone].classList.remove('is-active'); f.pointerId = null;
      const quickTap = !f.grabbed && Math.abs(e.clientX - f.x0) < 12;   // press and release in place turns the page, however long it took
      const throwV = (-f.vx * f.dir) / (f.width * 0.55);                 // release speed in progress units per ms
      const complete = !cancelled && (quickTap || throwV > 0.0012 || (throwV > -0.0012 && f.progress > 0.5) || (f.progress > 0.3 && throwV > -0.0004));
      f.goal = complete ? 1 : 0; f.velocity = quickTap ? 0.002 : Math.max(-0.01, Math.min(0.01, throwV));
      if (IL.paperSound) IL.paperSound.slide(0);
      if (f.ready) this.flipLoop();
    }
    /* the physics tick: F = -k (p - goal) - c v, integrated per frame; drives the shader while nobody is holding the sheet */
    flipLoop() {
      const f = this.flip; if (!f || f.looping) return;
      f.looping = true; let last = performance.now(); const snd = IL.paperSound;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const k = 1.95e-4, c = 0.0251;                                   // ~450 ms period, damping ratio 0.9: a quick fall with a soft settle
      const tick = () => {
        if (this.flip !== f) { f.looping = false; return; }
        const now = performance.now(); let dt = Math.min(120, now - last); last = now;   // slow frames (weak GPUs) still advance the physics at real speed
        if (f.pointerId == null && f.goal != null) {
          if (reduce) { f.progress = f.goal; }
          else { const n = Math.max(1, Math.ceil(dt / 8)), h = dt / n; for (let i = 0; i < n; i++) { const a = -k * (f.progress - f.goal) - c * f.velocity; f.velocity += a * h; f.progress += f.velocity * h; } }
          if (snd && this.app.settings.pageSound !== false) snd.slide(Math.abs(f.velocity) * 900);
          if (Math.abs(f.progress - f.goal) < 0.002 && Math.abs(f.velocity) < 0.0002 || reduce) {
            f.progress = f.goal; this.setFlipProgress(f.progress); f.looping = false;
            this.endFlip(f.goal === 1 ? f.target : null).finally(() => { this.flipBusy = false; }); return;
          }
        }
        this.setFlipProgress(Math.max(0, Math.min(1, f.progress)));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    /* ---- WebGL page curl: a real sheet of paper bending over a cone, lit, translucent, casting shadows ---- */
    flipGL() {
      if (this._gl !== undefined) return this._gl;
      const cv = document.createElement('canvas'); this.flipLayer.innerHTML = ''; this.flipLayer.appendChild(cv);
      const gl = cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false }) || cv.getContext('experimental-webgl');
      if (!gl) { this._gl = null; return null; }
      const VS = `attribute vec2 aPos; uniform vec2 uArea, uOff, uSize, uQuadOff, uQuadSize, uN; uniform float uA, uR, uF, uIsUnder, uTmin, uTmax, uQ, uMirror, uSpineX, uSag;
        varying vec2 vUV, vP; varying vec3 vNrm; varying float vD, vIsUnder, vR, vZ, vSX, vQ, vMirror, vFrameW;
        void main(){ vIsUnder = uIsUnder; vQ = uQ; vMirror = uMirror; vFrameW = uSize.x;
          vec2 p = aPos * uQuadSize + (uQuadOff - uOff);                 /* position in the frame of the turning sheet */
          vec3 pos = vec3(p, 0.0); vec3 nrm = vec3(0.0, 0.0, 1.0);
          vec2 tdir = vec2(-uN.y, uN.x); float along = clamp((dot(p, tdir) - uTmin) / max(1.0, uTmax - uTmin), 0.0, 1.0);
          float R = uR * mix(1.3, 0.78, along); vR = R;                 /* a cone: tighter toward the corner that peels first */
          float d = dot(p, uN) - uA; vD = d;
          if (uIsUnder < 0.5 && d > 0.0) { float t = d / R;
            if (t < 3.14159265) { float s = sin(t), c = cos(t); pos = vec3(p - uN * d + uN * (R * s), R * (1.0 - c)); nrm = vec3(-uN * s, c); }
            else { pos = vec3(p - uN * d - uN * (d - 3.14159265 * R), 2.0 * R); nrm = vec3(0.0, 0.0, -1.0); }
            pos.y += uSag * clamp(pos.z / max(1.0, 2.0 * R), 0.0, 1.0) * sin(3.14159265 * uQ); /* gravity: the lifted paper droops a little */ }
          vUV = vec2(uMirror > 0.5 ? 1.0 - aPos.x : aPos.x, aPos.y); vNrm = nrm; vZ = pos.z; vP = pos.xy;
          float sc = uF / (uF - pos.z); vec2 c0 = uSize * 0.5; vec2 sp = uOff + c0 + (pos.xy - c0) * sc; vSX = sp.x - uOff.x;
          if (uMirror > 0.5) sp.x = 2.0 * uSpineX - sp.x;
          gl_Position = vec4(sp.x / uArea.x * 2.0 - 1.0, 1.0 - sp.y / uArea.y * 2.0, uIsUnder > 0.5 ? 0.5 : 0.45 - pos.z / 20000.0, 1.0); }`;
      const FS = `precision mediump float; uniform sampler2D uTex, uTexBack, uNoise; uniform float uHasBack, uRows, uSpread;
        varying vec2 vUV, vP; varying vec3 vNrm; varying float vD, vIsUnder, vR, vZ, vSX, vQ, vMirror, vFrameW;
        void main(){
          vec3 L = normalize(vec3(-0.35, -0.5, 0.79)); vec3 V = vec3(0.0, 0.0, 1.0); float flatDiff = 0.79; float PI = 3.14159265;
          float settle = 1.0 - smoothstep(0.8, 1.0, vQ);                                                                  /* shadows die away as the page lands */
          float g1 = texture2D(uNoise, vP / 96.0).r, g2 = texture2D(uNoise, vP / 23.0 + 0.37).r; float grain = g1 * 0.6 + g2 * 0.4;   /* paper fibre */
          if (vIsUnder > 0.5) {
            vec3 c = texture2D(uTex, vUV).rgb;
            float lift = clamp(vD / (1.6 * vR), 0.0, 1.0); float w = mix(0.1, 0.9, lift) * vR;                         /* contact-hardening: sharp at the fold, soft where the sheet is high */
            float arch = (1.0 - smoothstep(0.0, 2.1 * vR, vD)) * smoothstep(-0.5 * w, 0.04 * vR, vD);
            float over = smoothstep(PI * vR - 0.55 * vR, PI * vR + 0.1 * vR, vD);                                      /* under the part lying over */
            float ao = 0.3 * arch + 0.1 * over;
            float gutter = uSpread > 0.5 ? 0.16 * exp(-abs(vP.x) / (0.06 * vFrameW)) : 0.0;                                /* the spine's own shadow */
            gl_FragColor = vec4(c * (1.0 - ao * settle) * (1.0 - gutter), 1.0);
          } else {
            float fade = uSpread > 0.5 ? 1.0 : smoothstep(-60.0, -6.0, vSX);                                             /* a single page dissolves past the spine */
            if (fade <= 0.002) discard;
            vec3 n = normalize(normalize(vNrm) + vec3((grain - 0.5) * 0.07, (g2 - 0.5) * 0.07, 0.0));                  /* fibre micro-normals catch the sheen */
            float diff = max(dot(n, L), 0.0); float spec = pow(max(dot(reflect(-L, n), V), 0.0), 24.0) * (0.55 + 0.45 * grain);
            float lift = clamp(vZ / (vR + 1.0), 0.0, 1.0);
            float edge = (smoothstep(0.992, 1.0, vUV.x) + smoothstep(0.995, 1.0, vUV.y) + smoothstep(0.995, 1.0, 1.0 - vUV.y)) * lift * 0.16;  /* the paper's thickness */
            float tone = 0.985 + 0.03 * grain;
            bool front = gl_FrontFacing != (vMirror > 0.5);
            vec3 col;
            if (front) { vec3 c = texture2D(uTex, vUV).rgb; float light = min(1.05, 0.60 + 0.40 * diff / flatDiff); col = c * light * tone + spec * 0.07 + edge; }
            else {
              float diffB = max(dot(-n, L), 0.0); float trans = max(dot(n, L), 0.0) * 0.16;                            /* light coming through the paper */
              float lum = dot(texture2D(uTex, vUV).rgb, vec3(0.3, 0.59, 0.11));
              float light = min(1.05, 0.62 + 0.38 * diffB / flatDiff) + trans;
              if (uHasBack > 0.5) { vec3 c = texture2D(uTexBack, vec2(1.0 - vUV.x, vUV.y)).rgb; col = (c - (1.0 - lum) * 0.06) * light * tone + spec * 0.05 + edge; }
              else { vec3 back = vec3(0.962, 0.952, 0.93); float line = step(0.965, fract(vUV.y * uRows)) * 0.05; col = (back - line - (1.0 - lum) * 0.10) * light * tone + spec * 0.04 + edge; } }
            gl_FragColor = vec4(col * fade, fade); } }`;
      const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(o)); return null; } return o; };
      const prog = gl.createProgram(); const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
      if (!v || !f) { this._gl = null; return null; }
      gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('flip shader link failed', gl.getProgramInfoLog(prog)); this._gl = null; return null; }
      gl.useProgram(prog);
      const NX = 128, NY = 32; const verts = [], idx = [];
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) verts.push(i / NX, j / NY);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      const u = {}; ['uArea', 'uOff', 'uSize', 'uQuadOff', 'uQuadSize', 'uN', 'uA', 'uR', 'uF', 'uIsUnder', 'uTex', 'uTexBack', 'uNoise', 'uHasBack', 'uRows', 'uTmin', 'uTmax', 'uQ', 'uMirror', 'uSpineX', 'uSag', 'uSpread'].forEach(n => u[n] = gl.getUniformLocation(prog, n));
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      const mkTex = (wrap, mip) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); if (mip && aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1)); return t; };
      // paper fibre: a small tileable noise texture
      const N = 128, noise = new Uint8Array(N * N * 4); let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const base = new Float32Array(N * N); for (let i = 0; i < N * N; i++) base[i] = rnd();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += base[((y + dy + N) % N) * N + ((x + dx + N) % N)]; v = v / 9 * 0.7 + base[y * N + x] * 0.3; const o = (y * N + x) * 4; noise[o] = noise[o + 1] = noise[o + 2] = Math.round(v * 255); noise[o + 3] = 255; }
      const texNoise = mkTex(gl.REPEAT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);
      const pot = document.createElement('canvas'); pot.width = pot.height = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 1024, (window.devicePixelRatio || 1) > 1.5 ? 2048 : 1024);
      this._gl = { gl, cv, prog, u, count: idx.length, texSheet: mkTex(null, true), texBack: mkTex(null, true), texUnderL: mkTex(null, true), texUnderR: mkTex(null, true), texNoise, pot };
      return this._gl;
    }
    /* paints a page (or blank paper when the page is missing) at the texture size */
    async snapshot(page, texW, dpr) {
      const cv = document.createElement('canvas'); const imgs = page ? await this.mediaImages(page) : null;
      this.paintPage(page || { rows: [], strokes: [], media: [] }, cv, texW, imgs, dpr); return cv;
    }
    async beginFlip(dir, target) {
      const ar = this.area.getBoundingClientRect(); const spread = this.spreadMode() && this._spreadRendered;
      const layer = this.flipLayer; const dpr = Math.min(2, window.devicePixelRatio || 1);
      const G = this.flipGL();
      const rects = this.sheets.map(sh => sh.pageEl.getBoundingClientRect()); const r0 = rects[0];
      const texW = Math.min(r0.width, 1400 / dpr);
      const n = this.pages.length; const P = i => (i >= 0 && i < n) ? this.pages[i] : null;
      let frame, under, sheetFront, sheetBack, mirror = false, spineX = 0;
      if (!spread) {
        const cur = this.page, next = this.pages[target]; frame = r0;
        sheetFront = dir > 0 ? cur : next; under = [{ rect: r0, page: dir > 0 ? next : cur }]; sheetBack = null;
      } else {
        const base = this.spreadBase(this.pageIndex);
        const left = rects[0], right = rects[1] || { left: r0.left + r0.width, top: r0.top, width: r0.width, height: r0.height };
        spineX = (left.left + left.width + right.left) / 2 - ar.left;
        if (dir > 0) { frame = right; sheetFront = P(base + 1); sheetBack = P(base + 2); under = [{ rect: left, page: P(base) }, { rect: right, page: P(base + 3) }]; }
        else { mirror = true; frame = right; sheetFront = P(base); sheetBack = P(base - 1); under = [{ rect: left, page: P(base - 2) }, { rect: right, page: P(base + 1) }]; } // mirrored: the left page is drawn in the right page's frame and flipped back in the shader
      }
      const toArea = r => ({ x: r.left - ar.left, y: r.top - ar.top, w: r.width, h: r.height });
      const [snapFront, snapBack, ...snapUnder] = await Promise.all([this.snapshot(sheetFront, texW, dpr), sheetBack ? this.snapshot(sheetBack, texW, dpr) : null, ...under.map(uq => this.snapshot(uq.page, texW, dpr))]);
      layer.hidden = false;
      if (!G) { // no WebGL: plain crossfade on a flat canvas
        layer.innerHTML = ''; const c = document.createElement('canvas'); c.className = 'flip-flat'; layer.appendChild(c);
        const flatRect = mirror ? rects[0] : frame, flatUnder = spread ? (mirror ? snapUnder[0] : snapUnder[1]) : snapUnder[0];
        this.flipParts = { flat: { c, snapSheet: snapFront, snapUnder: flatUnder, r: flatRect, ar }, dir, spread };
        this.sheets.forEach(sh => sh.pageEl.classList.add('is-flipping')); if (this.ghostEl) this.ghostEl.classList.add('is-flipping'); this.setFlipProgress(0); return;
      }
      const { gl, cv } = G; cv.width = Math.round(ar.width * dpr); cv.height = Math.round(ar.height * dpr); cv.style.width = ar.width + 'px'; cv.style.height = ar.height + 'px';
      gl.viewport(0, 0, cv.width, cv.height);
      const pot = G.pot, px = pot.getContext('2d');
      const up = (t, c) => { px.drawImage(c, 0, 0, pot.width, pot.height); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pot); gl.generateMipmap(gl.TEXTURE_2D); };
      up(G.texSheet, snapFront); if (snapBack) up(G.texBack, snapBack); up(G.texUnderL, snapUnder[0]); if (snapUnder[1]) up(G.texUnderR, snapUnder[1]);
      const fr = toArea(frame);
      this.flipParts = { gl: G, dir, spread, mirror, spineX, off: [fr.x, fr.y], size: [fr.w, fr.h], area: [ar.width, ar.height], rows: rowsCount(this.L) + 2, hasBack: !!snapBack,
        under: under.map((uq, k) => { const q = toArea(uq.rect); if (mirror) q.x = 2 * spineX - (q.x + q.w); return { x: q.x, y: q.y, w: q.w, h: q.h, tex: k === 0 ? G.texUnderL : G.texUnderR }; }) };
      this.sheets.forEach(sh => sh.pageEl.classList.add('is-flipping')); if (this.ghostEl) this.ghostEl.classList.add('is-flipping');
      this.setFlipProgress(0);
    }
    setFlipProgress(p) {
      const fp = this.flipParts; if (!fp) return;
      const q = Math.max(0, Math.min(1, (fp.spread || fp.dir > 0) ? p : 1 - p)); // 0 = lying flat, 1 = turned over
      if (fp.flat) { const { c, snapSheet, snapUnder, r } = fp.flat; c.width = snapUnder.width; c.height = snapUnder.height; c.style.cssText = `position:absolute;left:${fp.flat.r.left - fp.flat.ar.left}px;top:${fp.flat.r.top - fp.flat.ar.top}px;width:${r.width}px;height:${r.height}px`; const x = c.getContext('2d'); x.drawImage(snapUnder, 0, 0); x.globalAlpha = 1 - q; x.drawImage(snapSheet, 0, 0); return; }
      const { gl, u, count, texSheet, texBack, texNoise } = fp.gl; const [W, H] = fp.size;
      let phi, R, A;
      const n0 = a => [Math.cos(a), Math.sin(a)];
      const extents = n => { const corners = [[0, 0], [W, 0], [0, H], [W, H]]; const dots = corners.map(c => c[0] * n[0] + c[1] * n[1]); const tdir = [-n[1], n[0]]; const ts = corners.map(c => c[0] * tdir[0] + c[1] * tdir[1]); return { dmax: Math.max(...dots), dmin: Math.min(...dots), tmin: Math.min(...ts), tmax: Math.max(...ts) }; };
      if (fp.spread) {
        phi = 0.30 * Math.pow(1 - q, 1.4);                              // lifts from the lower corner, lands square on the spine
        R = W * (0.25 * Math.pow(Math.sin(Math.PI * q), 0.8) + 0.004);  // opens up mid-flight, flattens out to land
      } else {
        phi = 0.26 - 0.16 * q; R = W * (0.23 - 0.09 * q);
      }
      const n = n0(phi); const ex = extents(n);
      A = fp.spread ? ex.dmax - q * (ex.dmax + Math.PI * R / 2) : ex.dmax - q * (ex.dmax - ex.dmin + Math.PI * R * 1.3);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform2f(u.uArea, fp.area[0], fp.area[1]); gl.uniform2f(u.uOff, fp.off[0], fp.off[1]); gl.uniform2f(u.uSize, W, H);
      gl.uniform2f(u.uN, n[0], n[1]); gl.uniform1f(u.uA, A); gl.uniform1f(u.uR, R); gl.uniform1f(u.uF, 4.2 * Math.max(W, H)); gl.uniform1f(u.uRows, fp.rows); gl.uniform1f(u.uTmin, ex.tmin); gl.uniform1f(u.uTmax, ex.tmax); gl.uniform1f(u.uQ, q);
      gl.uniform1f(u.uMirror, fp.mirror ? 1 : 0); gl.uniform1f(u.uSpineX, fp.spineX); gl.uniform1f(u.uSag, fp.spread ? 0.028 * H : 0.012 * H); gl.uniform1f(u.uSpread, fp.spread ? 1 : 0); gl.uniform1f(u.uHasBack, fp.hasBack ? 1 : 0);
      gl.uniform1i(u.uTex, 0); gl.uniform1i(u.uTexBack, 1); gl.uniform1i(u.uNoise, 2);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texNoise);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texBack);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(u.uIsUnder, 1);
      for (const uq of fp.under) { gl.uniform2f(u.uQuadOff, uq.x, uq.y); gl.uniform2f(u.uQuadSize, uq.w, uq.h); gl.bindTexture(gl.TEXTURE_2D, uq.tex); gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0); }
      gl.uniform1f(u.uIsUnder, 0); gl.uniform2f(u.uQuadOff, fp.off[0], fp.off[1]); gl.uniform2f(u.uQuadSize, W, H);
      gl.bindTexture(gl.TEXTURE_2D, texSheet); gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }
    async endFlip(target) {
      this.flip = null; const snd = IL.paperSound; if (snd) snd.slide(0);
      if (target != null) { await this.goTo(target); if (snd && this.app.settings.pageSound !== false) snd.flap(); if (navigator.vibrate && this.app.settings.haptics !== false) { try { navigator.vibrate(6); } catch (e) {} } }
      this.sheets.forEach(sh => sh.pageEl.classList.remove('is-flipping')); if (this.ghostEl) this.ghostEl.classList.remove('is-flipping');
      if (this.flipParts && this.flipParts.gl) { const { gl } = this.flipParts.gl; gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      if (this.flipParts && this.flipParts.flat) this.flipLayer.innerHTML = '', this._gl = undefined;
      this.flipLayer.hidden = true; this.flipParts = null;
      this.updateZones();
      const q = this._queuedTurn; this._queuedTurn = null; if (q) setTimeout(() => this.turnPage(q), 0);
    }
    /* keyboard / buttons: the sheet is flicked over by the spring (a finger can still catch it on the way) */
    turnPage(dir) {
      if (this.flip || this.flipBusy) { this._queuedTurn = dir; return; } const target = this.turnTarget(dir); if (target == null) return;
      if (IL.paperSound && this.app.settings.pageSound !== false) IL.paperSound.ensure();
      const f = { dir, target, zone: dir, pointerId: null, x0: 0, p0: 0, t0: performance.now(), progress: 0, velocity: 0.0028, goal: 1, width: this.area.clientWidth, lastX: 0, lastT: 0, vx: 0, ready: false, grabbed: false };
      this.flip = f; this.flipBusy = true;
      f.begin = this.beginFlip(dir, target).then(() => { f.ready = true; this.flipLoop(); }).catch(err => { console.warn(err); this.flip = null; this.endFlip(target).finally(() => { this.flipBusy = false; }); });
    }

    /* ---------- search highlighting ---------- */
    setHighlights(byPage) { this.highlightsByPage = byPage; this.eachSheet(() => this.refreshRows()); }
    scrollToMark() { const m = this.rowsEl.querySelector('mark.cur'); if (m) m.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }

    /* ---------- tools & toolbar ---------- */
    setTool(t) {
      if ((t === 'type' || t === 'select') && this.tool !== t && this.liveOn && this.page && this.lv && this.lv.lines.size) { this.liveFlush(); }
      const was = this.tool; this.tool = t;
      document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('is-active', b.dataset.tool === t));
      this.refreshPageClasses();
      if (t !== 'select' && this.tf) { this.tf.select(null); this.mediaActions.hidden = true; }
      if (t !== 'lasso') { if (this.lassoSel || this.lassoDraw) this.clearLasso(); }
      else if (was !== 'lasso' && !this.lassoSel) this.app.toast('Lasso: draw a loop around handwriting to pick it up, or tap a word.', 2200);
      if (this.rowsEl) this.renderCaret();
      document.getElementById('pen-colors').hidden = t === 'hl'; document.getElementById('pen-widths').hidden = t === 'hl'; document.getElementById('hl-colors').hidden = t !== 'hl';
      document.getElementById('pen-styles').hidden = t !== 'pen';
      document.getElementById('pen-colors').style.opacity = t === 'pen' ? '' : '.45';
      document.getElementById('pen-widths').style.opacity = t === 'pen' ? '' : '.45';
    }
    setPenStyle(key, silent) {
      if (!PEN_STYLES.some(p => p.key === key)) key = 'ball';
      this.penStyle = key; document.querySelectorAll('#pen-styles .pen-style').forEach(b => b.classList.toggle('is-active', b.dataset.pen === key));
      if (!silent) { IL.db.kvSet('penStyle', key); if (this.tool !== 'pen') this.setTool('pen'); const p = PEN_STYLES.find(x => x.key === key); this.app.toast(p.hint, 1800); }
    }
    bind() {
      document.querySelectorAll('.tool[data-tool]').forEach(b => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
      const styles = document.getElementById('pen-styles');
      PEN_STYLES.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pen-style' + (p.key === this.penStyle ? ' is-active' : ''); b.dataset.pen = p.key; b.title = p.label; b.setAttribute('aria-label', p.label); b.innerHTML = `<svg viewBox="0 0 36 22" aria-hidden="true"><use href="#ps-${p.key}"/></svg>`; b.addEventListener('click', () => this.setPenStyle(p.key)); styles.appendChild(b); });
      const colors = document.getElementById('pen-colors');
      PEN_COLORS.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ink-dot' + (c === this.penColor ? ' is-active' : ''); b.style.background = c; b.title = 'Ink color'; b.setAttribute('aria-label', 'Ink ' + c); b.addEventListener('click', () => { if (this.recolorSelection(c, 'pen')) return; this.penColor = c; colors.querySelectorAll('.ink-dot').forEach(x => x.classList.toggle('is-active', x === b)); if (this.tool !== 'pen') this.setTool('pen'); }); colors.appendChild(b); });
      const hls = document.getElementById('hl-colors');
      HL_COLORS.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'hl-dot' + (c === this.hlColor ? ' is-active' : ''); b.style.background = c; b.title = 'Highlighter color'; b.setAttribute('aria-label', 'Highlighter ' + c); b.addEventListener('click', () => { if (this.recolorSelection(c, 'hl')) return; this.hlColor = c; hls.querySelectorAll('.hl-dot').forEach(x => x.classList.toggle('is-active', x === b)); }); hls.appendChild(b); });
      const widths = document.getElementById('pen-widths');
      PEN_WIDTHS.forEach(w => { const b = document.createElement('button'); b.type = 'button'; b.className = 'width-dot' + (w === this.penWidth ? ' is-active' : ''); b.title = 'Pen thickness'; b.setAttribute('aria-label', 'Thickness ' + w); b.innerHTML = `<i style="width:${4 + w * 2.2}px;height:${4 + w * 2.2}px"></i>`; b.addEventListener('click', () => { this.penWidth = w; widths.querySelectorAll('.width-dot').forEach(x => x.classList.toggle('is-active', x === b)); if (this.tool !== 'pen') this.setTool('pen'); }); widths.appendChild(b); });
      document.getElementById('undo-btn').addEventListener('click', () => this.undo());
      document.getElementById('redo-btn').addEventListener('click', () => this.redo());
      document.getElementById('convert-btn').addEventListener('click', () => this.convert());
      document.getElementById('zoom-in-btn').addEventListener('click', () => this.zoomBy(1.25));
      document.getElementById('zoom-out-btn').addEventListener('click', () => this.zoomBy(1 / 1.25));
      document.getElementById('page-prev').addEventListener('click', () => this.turnPage(-1));
      document.getElementById('page-next').addEventListener('click', () => this.turnPage(1));
      this.setupFlip();
      document.getElementById('enter-btn').addEventListener('click', () => this.enter());
      document.getElementById('page-add').addEventListener('click', () => this.addPage());
      this.mediaActions.addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.mediaAction(b.dataset.act); });
      this.lassoActions.addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.lassoAction(b.dataset.act); });
      this.lassoActions.addEventListener('pointerdown', e => e.stopPropagation());
      document.getElementById('player-close').addEventListener('click', () => this.closePlayer());
      document.getElementById('file-page-image').addEventListener('change', e => { this.addPhotos([...e.target.files]); e.target.value = ''; });
      document.getElementById('file-video').addEventListener('change', e => { this.addVideo(e.target.files[0]); e.target.value = ''; });
      this.scroller.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); const pr = this.pageEl.getBoundingClientRect(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { lx: (e.clientX - pr.left) / this.s, ly: (e.clientY - pr.top) / this.s, cx: e.clientX, cy: e.clientY }); } }, { passive: false });
      this.scroller.addEventListener('scroll', () => { this.positionMediaActions(); this.positionLassoActions(); });
      window.addEventListener('resize', () => { if (!this.view.hidden && this.pageEl) { if (this.spreadMode() !== this._spreadRendered) { this.renderPage(); } this.layout(); this.updatePager(); } });
      document.addEventListener('keydown', e => {
        if (this.view.hidden) return; const inRow = document.activeElement && document.activeElement.classList.contains('row');
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z' && !inRow) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
        else if (mod && e.key.toLowerCase() === 'y' && !inRow) { e.preventDefault(); this.redo(); }
        else if (e.key === 'Escape') { if (!document.getElementById('player').hidden) this.closePlayer(); else if (this.lassoSel) this.clearLasso(); else if (this.tf && this.tf.selected()) { this.tf.select(null); this.mediaActions.hidden = true; } }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && !inRow && this.lassoSel) { e.preventDefault(); this.lassoAction('del'); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && !inRow && this.tf && this.tf.selected()) { e.preventDefault(); this.mediaAction('del'); }
        else if (mod && !inRow && this.lassoSel && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) { e.preventDefault(); this.lassoAction(e.key.toLowerCase() === 'c' ? 'copy' : 'cut'); }
        else if (mod && !inRow && (this.inkClipboard || this.textClipboard) && e.key.toLowerCase() === 'v' && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) { e.preventDefault(); this.pasteInk(); }
        else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !inRow && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) { e.preventDefault(); this.turnPage(e.key === 'ArrowRight' ? 1 : -1); }
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
      // pointers whose up/cancel never reaches the page (finger slid off it, palm, system gestures): forget them, show Enter again
      const stray = e => { if (e.pointerType === 'touch') this.touches.delete(e.pointerId); if (!this.live && !this.erase && this.area && this.area.classList.contains('is-writing')) this.writingDone(e.pointerId); };
      window.addEventListener('pointerup', stray, true); window.addEventListener('pointercancel', stray, true);
      window.addEventListener('blur', () => { this.touches.clear(); if (!this.live && !this.erase) this.writingDone(); });
    }

    /* ---------- persistence ---------- */
    markDirty(page) { (page || this.page)._dirty = true; clearTimeout(this._saveT); this._saveT = setTimeout(() => this.flush(), 700); }
    async flush() {
      clearTimeout(this._saveT); if (!this.nb) return;
      const dirty = this.pages.filter(p => p._dirty);
      for (const p of dirty) { p._dirty = false; await IL.db.put('pages', { id: p.id, notebookId: p.notebookId, index: p.index, rows: p.rows, strokes: p.strokes.map(st => ({ pts: st.pts, color: st.color, width: st.width, at: st.at, kind: st.kind, pen: st.pen })), media: p.media, caret: p.caret }); }
      if (dirty.length) { this.nb.updatedAt = Date.now(); this.nb.pageCount = this.pages.length; this.nb.preview = (this.pages[0].rows.find(r => r.trim()) || '').slice(0, 80); this.app.saveNotebookSoon(this.nb); }
    }
  }

  function safeHost(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  IL.editor = { PAGE, SPACING, SIZES, FONTS, TEXT_COLORS, PEN_COLORS, PEN_STYLES, defaultSettings, newPage, rowsCount, Editor, drawStroke };
})();
