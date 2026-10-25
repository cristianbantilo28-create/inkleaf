/* Inkleaf — notebook covers: rendering (home grid + editor) and the cover editor. Cover space is 300 x 400 units. */
(function () {
  const IL = (window.IL = window.IL || {});
  const CW = 300, CH = 400;

  const THEMES = [
    { id: 'midnight', name: 'Midnight', bg: 'linear-gradient(160deg,#243370 0%,#121A3D 100%)', title: '#F3E9C8' },
    { id: 'ink', name: 'Ink', bg: 'linear-gradient(160deg,#2F55D4,#1B2E7A)', title: '#FFFFFF' },
    { id: 'ocean', name: 'Ocean', bg: 'linear-gradient(160deg,#1E7FB0,#0E3B5E)', title: '#E9F6FF' },
    { id: 'sky', name: 'Sky', bg: 'linear-gradient(160deg,#C7E6FF,#7DB9F0)', title: '#143A66' },
    { id: 'mint', name: 'Mint', bg: 'linear-gradient(160deg,#B4EBD6,#56B89A)', title: '#0F3D2E' },
    { id: 'forest', name: 'Forest', bg: 'linear-gradient(160deg,#357A4F,#17402A)', title: '#F1F7E8' },
    { id: 'sunshine', name: 'Sunshine', bg: 'linear-gradient(160deg,#FFD66B,#F4A03A)', title: '#4D2E00' },
    { id: 'terracotta', name: 'Terracotta', bg: 'linear-gradient(160deg,#D0704A,#8E3F22)', title: '#FFF2E6' },
    { id: 'cherry', name: 'Cherry', bg: 'linear-gradient(160deg,#C9304A,#7E1120)', title: '#FFEDEF' },
    { id: 'blush', name: 'Blush', bg: 'linear-gradient(160deg,#F7BFC9,#E07A95)', title: '#4A1F2B' },
    { id: 'lavender', name: 'Lavender', bg: 'linear-gradient(160deg,#C4B2EE,#7A5FBF)', title: '#FFFFFF' },
    { id: 'kraft', name: 'Kraft', bg: 'linear-gradient(160deg,#CFA978,#A67C4E)', title: '#3B2A14' },
    { id: 'linen', name: 'Linen', bg: 'linear-gradient(160deg,#F7F2E8,#E6DDCB)', title: '#3A3328' },
    { id: 'charcoal', name: 'Charcoal', bg: 'linear-gradient(160deg,#50565F,#23262E)', title: '#F2F2F2' }
  ];
  const PATTERNS = [['none', 'Plain'], ['dots', 'Dots'], ['grid', 'Grid'], ['stripes', 'Stripes'], ['checks', 'Checks'], ['waves', 'Waves'], ['confetti', 'Confetti']];
  const SPINES = [['rings', 'Spiral rings'], ['band', 'Cloth spine'], ['stitch', 'Stitched'], ['none', 'None']];
  const TITLE_FONTS = [['Fraunces', "'Fraunces', Georgia, serif"], ['Figtree', "'Figtree', system-ui, sans-serif"], ['Caveat', "'Caveat', cursive"], ['Patrick Hand', "'Patrick Hand', cursive"], ['Kalam', "'Kalam', cursive"], ['Gloria Hallelujah', "'Gloria Hallelujah', cursive"], ['Homemade Apple', "'Homemade Apple', cursive"], ['Lora', "'Lora', Georgia, serif"], ['Courier Prime', "'Courier Prime', monospace"]];
  const TITLE_COLORS = ['#FFFFFF', '#F3E9C8', '#1B1F2A', '#2D4FC9', '#E63946', '#F6B93B', '#3CCB92', '#FF6B9D'];
  const LAYOUTS = [['free', 'Free'], ['full', 'Whole cover'], ['top', 'Top half'], ['bottom', 'Bottom half'], ['left', 'Left half'], ['right', 'Right half']];
  const FILTERS = [['none', 'None'], ['bw', 'Black & white'], ['sepia', 'Sepia'], ['vivid', 'Vivid'], ['warm', 'Warm'], ['cool', 'Cool'], ['invert', 'Negative'], ['mosaic', 'Mosaic'], ['blur', 'Soft blur'], ['tint', 'Tint'], ['faded', 'Faded']];
  const MASKS = [['none', 'Square'], ['round', 'Rounded'], ['circle', 'Circle'], ['polaroid', 'Polaroid']];
  const LAYOUT_BOX = { full: [0, 0, CW, CH], top: [0, 0, CW, CH / 2], bottom: [0, CH / 2, CW, CH / 2], left: [0, 0, CW / 2, CH], right: [CW / 2, 0, CW / 2, CH] };
  /* Applies a layout to a photo element: fixed layouts pin the box and lock dragging/resizing. */
  function applyLayout(e, layout, elements) {
    e.fit = layout;
    if (LAYOUT_BOX[layout]) {
      const [x, y, w, h] = LAYOUT_BOX[layout]; Object.assign(e, { x, y, w, h, rot: 0, locked: true, mask: 'none' });
      const i = elements.indexOf(e); if (i > 0) { elements.splice(i, 1); elements.unshift(e); } // behind stickers and title
    } else {
      e.locked = false;
      if (e.w >= CW - 1 || e.h >= CH - 1 || e.w === CW / 2 || e.h === CH / 2) { const ratio = e.h / e.w; e.w = 170; e.h = Math.round(170 * ratio); e.x = (CW - e.w) / 2; e.y = Math.max(20, (CH - e.h) / 2 - 30); e.mask = 'round'; }
    }
  }

  function hexToRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return [45, 79, 201]; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(rgb, target, t) { return 'rgb(' + rgb.map((c, i) => Math.round(c + (target[i] - c) * t)).join(',') + ')'; }
  function customBg(hex) { const rgb = hexToRgb(hex); return `linear-gradient(160deg, ${mix(rgb, [255, 255, 255], 0.18)}, ${mix(rgb, [0, 0, 0], 0.35)})`; }
  function isDarkColor(hex) { const [r, g, b] = hexToRgb(hex); return (r * 299 + g * 587 + b * 114) / 1000 < 150; }

  function defaultCover(title) {
    const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
    return {
      theme: theme.id, color: '#2d4fc9', pattern: 'none', spine: 'rings', showTitle: true,
      elements: [{ id: IL.uid(), type: 'text', role: 'title', text: title || 'Untitled', font: 'Fraunces', color: theme.title, x: 48, y: 150, w: 220, fs: 30, rot: 0, align: 'center' }]
    };
  }
  function themeOf(cover) { return THEMES.find(t => t.id === cover.theme) || null; }
  function bgFor(cover) { const t = themeOf(cover); return t ? t.bg : customBg(cover.color || '#2d4fc9'); }
  /* A representative color of the cover (for UI tinting), as [r,g,b]. */
  function tintOf(cover) { if (!cover) return [45, 79, 201]; const t = themeOf(cover); const hex = t ? (t.bg.match(/#[0-9a-f]{6}/i) || ['#2d4fc9'])[0] : (cover.color || '#2d4fc9'); return hexToRgb(hex); }
  function titleColorFor(cover) { const t = themeOf(cover); return t ? t.title : (isDarkColor(cover.color) ? '#FFFFFF' : '#1B1F2A'); }

  /* Renders a cover into `el`. Elements are positioned in percentages so the same markup scales anywhere. */
  function render(el, cover, opts) {
    opts = opts || {};
    el.className = 'cover' + (opts.edit ? ' cover-edit' : '') + (opts.extraClass ? ' ' + opts.extraClass : '');
    el.style.background = bgFor(cover);
    el.innerHTML = '';
    const pat = document.createElement('div'); pat.className = 'cover-pattern ' + (cover.pattern || 'none'); el.appendChild(pat);
    const sheen = document.createElement('div'); sheen.className = 'cover-sheen'; el.appendChild(sheen);
    for (const e of cover.elements || []) {
      if (e.type === 'text' && e.role === 'title' && cover.showTitle === false) continue;
      el.appendChild(renderElement(e));
    }
    const spine = document.createElement('div'); spine.className = 'cover-spine ' + (cover.spine || 'none'); el.appendChild(spine);
    return el;
  }
  function applyElementStyle(node, e) {
    node.style.left = (e.x / CW * 100) + '%'; node.style.top = (e.y / CH * 100) + '%';
    node.style.width = (e.w / CW * 100) + '%';
    if (e.type !== 'text') node.style.height = ((e.h != null ? e.h : e.w) / CH * 100) + '%';
    node.style.transform = `rotate(${e.rot || 0}deg)`;
    node.classList.toggle('flipped', !!e.flip);
    if (e.type === 'text') {
      node.style.fontSize = (e.fs / CH * 100) + 'cqh'; node.style.color = e.color || '#fff'; node.style.textAlign = e.align || 'center';
      const f = TITLE_FONTS.find(x => x[0] === e.font); node.style.fontFamily = f ? f[1] : TITLE_FONTS[0][1];
    }
    if (e.type === 'image') {
      node.className = 'cel cel-image mask-' + (e.mask || 'none') + ' fit-' + (e.fit || 'free') + ' filter-' + (e.filter || 'none') + (node.classList.contains('is-selected') ? ' is-selected' : '');
      const img = node.querySelector('img'); if (img) img.style.opacity = e.opacity == null ? '' : e.opacity;
    }
    if (e.type === 'sticker') { const em = node.querySelector('.emoji'); if (em) em.style.fontSize = ((e.h != null ? e.h : e.w) / CH * 100 * 0.82).toFixed(2) + 'cqh'; }
  }
  function renderElement(e) {
    const node = document.createElement('div');
    node.dataset.id = e.id;
    node.className = 'cel cel-' + e.type;
    if (e.type === 'sticker') {
      const item = IL.stickers.get(e.ref);
      const inner = document.createElement('div'); inner.className = 'flip';
      inner.style.display = 'flex'; inner.style.alignItems = 'center'; inner.style.justifyContent = 'center';
      inner.innerHTML = IL.stickers.html(item, '');
      node.appendChild(inner);
    } else if (e.type === 'image') {
      const inner = document.createElement('div'); inner.className = 'flip';
      const img = document.createElement('img'); img.alt = ''; img.draggable = false;
      // show the original right away; a derived version (mosaic) replaces it once generated
      IL.blobs.url(e.key).then(u => { if (u && !img.dataset.derived) img.src = u; });
      if (e.filter === 'mosaic') IL.blobs.derivedUrl(e.key, 'mosaic', b => IL.blobs.mosaic(b, 26)).then(u => { if (u) { img.dataset.derived = '1'; img.src = u; } });
      inner.appendChild(img);
      if (e.filter === 'tint') { const t = document.createElement('div'); t.className = 'tint'; inner.appendChild(t); }
      node.appendChild(inner);
    } else if (e.type === 'text') {
      node.textContent = e.text || '';
    }
    applyElementStyle(node, e);
    return node;
  }

  /* ---------------- editor ---------------- */
  class CoverEditor {
    constructor(app) {
      this.app = app;
      this.view = document.getElementById('view-cover');
      this.canvas = document.getElementById('cover-canvas');
      this.actions = document.getElementById('el-actions');
      this.nb = null; this.cover = null; this.onDone = null;
      this.tf = IL.makeTransformer({
        container: this.canvas, itemSelector: '.cel',
        getModel: id => (this.cover.elements || []).find(e => e.id === id),
        pxPerUnit: () => this.canvas.getBoundingClientRect().width / CW,
        onChange: (m, phase) => { const node = this.canvas.querySelector(`.cel[data-id="${m.id}"]`); if (node) applyElementStyle(node, m); if (phase === 'end' || phase === 'tap') this.saveSoon(); },
        onSelect: id => this.onSelect(id)
      });
      this.bind();
    }
    bind() {
      document.getElementById('cover-back').addEventListener('click', () => this.finish());
      document.getElementById('cover-done').addEventListener('click', () => this.finish());
      this.view.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
        this.view.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t === tab));
        this.view.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== 'panel-' + tab.dataset.panel);
      }));
      // themes
      const tg = document.getElementById('theme-grid');
      THEMES.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.dataset.theme = t.id; b.style.background = t.bg; b.title = t.name; b.innerHTML = `<span>${t.name}</span>`; b.addEventListener('click', () => this.setTheme(t.id)); tg.appendChild(b); });
      document.getElementById('theme-custom').addEventListener('input', e => { this.cover.color = e.target.value; this.cover.theme = 'custom'; this.syncTitleColor(); this.paint(); this.saveSoon(); });
      const pr = document.getElementById('pattern-row');
      PATTERNS.forEach(([id, name]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.pattern = id; b.textContent = name; b.addEventListener('click', () => { this.cover.pattern = id; this.paint(); this.saveSoon(); }); pr.appendChild(b); });
      const sr = document.getElementById('spine-row');
      SPINES.forEach(([id, name]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.spine = id; b.textContent = name; b.addEventListener('click', () => { this.cover.spine = id; this.paint(); this.saveSoon(); }); sr.appendChild(b); });
      // stickers
      const cats = document.getElementById('sticker-cats');
      IL.stickers.categories.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (i === 0 ? ' is-active' : ''); b.dataset.cat = c.id; b.textContent = c.name; b.addEventListener('click', () => this.showStickers(c.id)); cats.appendChild(b); });
      this.showStickers(IL.stickers.categories[0].id);
      // photos
      document.getElementById('photo-add-btn').addEventListener('click', () => { const inp = document.getElementById('file-image'); inp.value = ''; inp.click(); });
      document.getElementById('file-image').addEventListener('change', e => this.addPhotos([...e.target.files]));
      const mkChips = (id, list, key, apply) => { const row = document.getElementById(id); row.innerHTML = ''; list.forEach(([v, name]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset[key] = v; b.textContent = name; b.addEventListener('click', () => { const el = this.selectedEl(); if (el && el.type === 'image') { apply(el, v); this.paint(); this.tf.select(el.id); this.saveSoon(); } }); row.appendChild(b); }); };
      mkChips('photo-layout', LAYOUTS, 'layout', (el, v) => applyLayout(el, v, this.cover.elements));
      mkChips('photo-filter', FILTERS, 'filter', (el, v) => { el.filter = v; });
      mkChips('photo-mask', MASKS, 'mask', (el, v) => { el.mask = v; });
      document.getElementById('photo-opacity').addEventListener('input', e => { const el = this.selectedEl(); if (el && el.type === 'image') { el.opacity = +e.target.value; document.getElementById('photo-opacity-val').textContent = Math.round(el.opacity * 100) + '%'; const node = this.canvas.querySelector(`.cel[data-id="${el.id}"]`); if (node) applyElementStyle(node, el); this.saveSoon(); } });
      // title
      const ti = document.getElementById('title-input');
      ti.addEventListener('input', () => { const t = this.titleEl(); if (t) { t.text = ti.value; } this.nb.title = ti.value.trim() || 'Untitled'; this.paint(); this.saveSoon(); });
      const tf = document.getElementById('title-fonts');
      TITLE_FONTS.forEach(([name, css]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'font-opt'; b.dataset.font = name; b.innerHTML = `<span class="sample" style="font-family:${css}">${name}</span><span class="fname">${name}</span>`; b.addEventListener('click', () => { const t = this.titleEl(); if (t) { t.font = name; this.paint(); this.saveSoon(); } }); tf.appendChild(b); });
      const tc = document.getElementById('title-colors');
      TITLE_COLORS.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'color-dot'; b.dataset.color = c; b.style.background = c; b.setAttribute('aria-label', c); b.addEventListener('click', () => { const t = this.titleEl(); if (t) { t.color = c; this.paint(); this.saveSoon(); } }); tc.appendChild(b); });
      document.getElementById('title-custom-color').addEventListener('input', e => { const t = this.titleEl(); if (t) { t.color = e.target.value; this.paint(); this.saveSoon(); } });
      document.getElementById('title-show').addEventListener('change', e => { this.cover.showTitle = e.target.checked; this.paint(); this.saveSoon(); });
      // element actions
      this.actions.addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.elementAction(b.dataset.act); });
      window.addEventListener('resize', () => { if (!this.view.hidden) this.tf.refresh(); });
    }
    titleEl() { return (this.cover.elements || []).find(e => e.type === 'text' && e.role === 'title'); }
    selectedEl() { const id = this.tf.selected(); return id ? (this.cover.elements || []).find(e => e.id === id) : null; }
    syncPhotoOpts() {
      const el = this.selectedEl(); const box = document.getElementById('photo-opts');
      box.hidden = !(el && el.type === 'image'); if (box.hidden) return;
      document.querySelectorAll('#photo-layout .chip').forEach(b => b.classList.toggle('is-active', b.dataset.layout === (el.fit || 'free')));
      document.querySelectorAll('#photo-filter .chip').forEach(b => b.classList.toggle('is-active', b.dataset.filter === (el.filter || 'none')));
      document.querySelectorAll('#photo-mask .chip').forEach(b => b.classList.toggle('is-active', b.dataset.mask === (el.mask || 'none')));
      document.getElementById('photo-opacity').value = el.opacity == null ? 1 : el.opacity;
      document.getElementById('photo-opacity-val').textContent = Math.round((el.opacity == null ? 1 : el.opacity) * 100) + '%';
      document.getElementById('photo-mask').parentElement.hidden = !!el.locked;
    }
    syncTitleColor() { const t = this.titleEl(); if (t && !t.customColor) t.color = titleColorFor(this.cover); }
    open(nb, onDone) {
      this.nb = nb; this.cover = nb.cover = nb.cover || defaultCover(nb.title); this.onDone = onDone;
      if (!this.titleEl()) this.cover.elements.unshift(defaultCover(nb.title).elements[0]);
      this.titleEl().text = nb.title;
      document.getElementById('title-input').value = nb.title;
      document.getElementById('title-show').checked = this.cover.showTitle !== false;
      this.paint(); this.syncPanels();
      this.app.showView('cover');
    }
    paint() {
      render(this.canvas, this.cover, { edit: true });
      this.canvas.appendChild(this.tf.frame);
      this.tf.refresh();
      this.syncPanels();
      this.renderPhotoGrid();
      this.syncPhotoOpts();
    }
    syncPanels() {
      document.querySelectorAll('#theme-grid .swatch').forEach(b => b.classList.toggle('is-active', b.dataset.theme === this.cover.theme));
      document.querySelectorAll('#pattern-row .chip').forEach(b => b.classList.toggle('is-active', b.dataset.pattern === (this.cover.pattern || 'none')));
      document.querySelectorAll('#spine-row .chip').forEach(b => b.classList.toggle('is-active', b.dataset.spine === (this.cover.spine || 'none')));
      const t = this.titleEl();
      document.querySelectorAll('#title-fonts .font-opt').forEach(b => b.classList.toggle('is-active', !!t && b.dataset.font === t.font));
      document.querySelectorAll('#title-colors .color-dot').forEach(b => b.classList.toggle('is-active', !!t && b.dataset.color.toLowerCase() === (t.color || '').toLowerCase()));
    }
    setTheme(id) { this.cover.theme = id; this.syncTitleColor(); this.paint(); this.saveSoon(); }
    showStickers(catId) {
      document.querySelectorAll('#sticker-cats .chip').forEach(b => b.classList.toggle('is-active', b.dataset.cat === catId));
      const grid = document.getElementById('sticker-grid'); grid.innerHTML = '';
      const cat = IL.stickers.categories.find(c => c.id === catId);
      cat.items.forEach(item => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sticker-btn'; b.title = item.name; b.innerHTML = IL.stickers.html(item, 'font-size:30px'); b.addEventListener('click', () => this.addSticker(item.id)); grid.appendChild(b); });
    }
    addElement(e) {
      this.cover.elements.push(e); this.paint(); this.tf.select(e.id); this.saveSoon();
    }
    addSticker(ref) {
      const n = this.cover.elements.length; const size = 80;
      this.addElement({ id: IL.uid(), type: 'sticker', ref, x: 110 + ((n * 23) % 90) - 45, y: 240 + ((n * 17) % 70) - 35, w: size, h: size, rot: ((n * 13) % 30) - 15 });
    }
    async addPhotos(files) {
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        try {
          const { blob, width, height } = await IL.blobs.shrinkImage(f, 1400);
          const key = await IL.blobs.put(blob, { kind: 'image', name: f.name });
          const w = 170, h = Math.round(w * height / width);
          this.addElement({ id: IL.uid(), type: 'image', key, x: (CW - w) / 2 + 10, y: Math.max(20, (CH - h) / 2 - 30), w, h, rot: ((this.cover.elements.length * 7) % 12) - 6, mask: 'round' });
        } catch (err) { this.app.toast('That photo could not be read.'); }
      }
      this.view.querySelector('.tab[data-panel="photos"]').click();
    }
    renderPhotoGrid() {
      const grid = document.getElementById('photo-grid'); grid.innerHTML = '';
      const imgs = (this.cover.elements || []).filter(e => e.type === 'image');
      if (!imgs.length) { grid.innerHTML = '<p class="muted small-text">No photos on this cover yet.</p>'; return; }
      imgs.forEach(e => { const b = document.createElement('button'); b.type = 'button'; const img = document.createElement('img'); img.alt = ''; IL.blobs.url(e.key).then(u => { if (u) img.src = u; }); b.appendChild(img); b.addEventListener('click', () => this.tf.select(e.id)); grid.appendChild(b); });
    }
    onSelect(id) {
      const e = id ? this.cover.elements.find(x => x.id === id) : null;
      this.actions.hidden = !e;
      this.syncPhotoOpts();
      if (!e) return;
      this.actions.querySelector('[data-act="mask"]').hidden = e.type !== 'image' || !!e.locked;
      this.actions.querySelector('[data-act="flip"]').hidden = e.type === 'text';
      this.actions.querySelector('[data-act="del"]').hidden = e.role === 'title';
      this.actions.querySelector('[data-act="dup"]').hidden = e.role === 'title' || !!e.locked;
      if (e.type === 'text') this.view.querySelector('.tab[data-panel="title"]').click();
      if (e.type === 'image') this.view.querySelector('.tab[data-panel="photos"]').click();
    }
    elementAction(act) {
      const id = this.tf.selected(); const els = this.cover.elements; const i = els.findIndex(e => e.id === id); if (i < 0) return;
      const e = els[i];
      if (act === 'del') { els.splice(i, 1); this.paint(); this.tf.select(null); this.actions.hidden = true; }
      else if (act === 'dup') { const c = Object.assign({}, e, { id: IL.uid(), x: e.x + 14, y: e.y + 14, role: undefined }); els.push(c); this.paint(); this.tf.select(c.id); }
      else if (act === 'front') { if (i < els.length - 1) { els.splice(i, 1); els.splice(i + 1, 0, e); this.paint(); this.tf.select(e.id); } }
      else if (act === 'back') { if (i > 0) { els.splice(i, 1); els.splice(i - 1, 0, e); this.paint(); this.tf.select(e.id); } }
      else if (act === 'flip') { e.flip = !e.flip; this.paint(); this.tf.select(e.id); }
      else if (act === 'mask') { const order = ['round', 'circle', 'polaroid', 'none']; e.mask = order[(order.indexOf(e.mask || 'none') + 1) % order.length]; this.paint(); this.tf.select(e.id); }
      this.saveSoon();
    }
    saveSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.app.saveNotebook(this.nb), 400); }
    async finish() { clearTimeout(this._t); this.tf.select(null); await this.app.saveNotebook(this.nb); const cb = this.onDone; this.onDone = null; cb && cb(); }
  }

  IL.cover = { THEMES, PATTERNS, SPINES, TITLE_FONTS, LAYOUTS, FILTERS, MASKS, CW, CH, defaultCover, render, bgFor, tintOf, applyLayout, Editor: CoverEditor };
})();
