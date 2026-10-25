/* Inkleaf — app shell: startup, lock flow, home screen, settings, training, backups, install. */
(function () {
  const IL = (window.IL = window.IL || {});
  const $ = id => document.getElementById(id);
  const relTime = t => { const d = Date.now() - t; const m = Math.round(d / 6e4); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago'; const days = Math.round(h / 24); if (days < 7) return days + ' d ago'; return new Date(t).toLocaleDateString(); };

  const APP_VERSION = '1.8.3';   // keep in step with VERSION in sw.js (tools/build.mjs checks)
  const app = {
    get version() { return APP_VERSION; },
    settings: { live: true, autoDelay: 1.2, fingerDraws: true, penSeen: false, engine: 'inkleaf', spread: true, pageSound: true, theme: 'light' },
    /* light (default), dark, or auto (follow the device). Mirrored in localStorage so the first paint already has it. */
    applyTheme() {
      const t = ['light', 'dark', 'auto'].includes(this.settings.theme) ? this.settings.theme : 'light';
      if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
      try { localStorage.setItem('inkleafTheme', t); } catch (e) {}
      const dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#1B1F29' : '#FFFFFF'));
      document.querySelectorAll('#theme-chips .chip').forEach(b => b.classList.toggle('is-active', b.dataset.theme === t));
    },
    /* First time a stylus touches the page: pen draws, finger scrolls (palm rejection on tablets). */
    penDetected() {
      this.settings.penSeen = true; this.settings.fingerDraws = false; this.saveSettings(); this.syncToolbarToggles();
      this.toast('Pen detected: the pen draws, fingers scroll and zoom. Change this with the hand button.', 4000);
    },
    notebooks: [], current: null, view: 'home', installEvent: null,

    async init() {
      await IL.db.ready();
      if (IL.storageFallback) $('storage-warning').hidden = false;
      Object.assign(this.settings, await IL.db.kvGet('settings', {}));
      this.applyTheme();
      if (this.settings.live === undefined) { this.settings.live = true; if (this.settings.autoDelay > 2) this.settings.autoDelay = 1.2; }
      if (!this.settings.engineChosen && this.settings.engine === 'inkleaf') this.settings.engine = 'neural';   // the neural engine is the default unless the person picked one
      IL.hwrClient.setMode(this.settings.engine === 'inkleaf' ? 'classic' : 'neural');
      IL.hwrClient.onNeural = () => { if (!$('sheet-settings').hidden) this.syncSettings(); };
      IL.hwrClient.setUserTemplates(await IL.db.all('templates'));
      try { const d = await IL.db.kvGet('neuralDense', null); if (d && d.ow && d.ob) IL.hwrClient.setDense(d.ow, d.ob, d.model); } catch (e) {}   // the person's adapted output layer
      IL.hwrClient.onModelChanged = () => this.relearnHandwriting();   // the recognizer was updated: an adaptation learned on the old one is dropped and learned again
      this.editor = new IL.editor.Editor(this);
      this.search = new IL.Search(this.editor);
      this.coverEditor = new IL.cover.Editor(this);
      this.lockScreen = new IL.LockScreen(this);
      this.bindUI();
      this.notebooks = await IL.db.all('notebooks');
      if (!this.notebooks.length && !(await IL.db.kvGet('seeded'))) { await this.seedSample(); await IL.db.kvSet('seeded', true); }
      this.notebooks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      await IL.Lock.load();
      if (!IL.Lock.state) { await this.lockScreen.firstRun(); if (!IL.Lock.state) { IL.Lock.state = { enabled: false, bio: null, autoLock: '1' }; await IL.Lock.save(); } }
      else if (IL.Lock.enabled) await this.lockScreen.unlock();
      this.renderHome(); this.showView('home');
      this.setupInstall(); this.setupAutoLock();
      setTimeout(() => this.gcBlobs(), 6000);
      this.setupUpdates();
      await this.resumeAfterUpdate();
    },
    /* ---------- updates: a new version pushed to the site takes over as soon as it is downloaded ----------
       The service worker installs the new files and claims the page; we then restart the app at the first quiet moment
       (not mid-stroke, not mid-animation), reopening the same notebook and page. The app also looks for updates whenever
       it comes back to the foreground and every quarter of an hour while open. */
    setupUpdates() {
      $('version-label').textContent = 'Inkleaf ' + APP_VERSION;
      $('update-btn').addEventListener('click', () => this.checkForUpdates());
      if (!('serviceWorker' in navigator) || window.__INKLEAF_NO_SW) { $('update-btn').hidden = true; return; }
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController) { hadController = true; return; } this.restartWhenIdle(); });
      navigator.serviceWorker.register('./sw.js').then(reg => {
        this.swReg = reg;
        reg.addEventListener('updatefound', () => { this.updateFound = true; const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') $('update-status').textContent = 'Update downloaded — restarting in a moment…'; }); });
        const check = () => { try { reg.update().catch(() => {}); } catch (e) {} };
        document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
        window.addEventListener('online', check);
        setInterval(check, 15 * 60 * 1000);
      }).catch(() => {});
    },
    async checkForUpdates() {
      const st = $('update-status'); st.textContent = 'Checking…'; this.updateFound = false;
      if (!this.swReg) { st.textContent = 'Updates arrive through the installed app; open the Netlify address again to get the newest version.'; return; }
      try { await this.swReg.update(); } catch (e) { st.textContent = 'Could not reach the server — are you online?'; return; }
      setTimeout(() => { if (!this.updateFound && !this._restarting) st.textContent = 'You have the latest version (' + APP_VERSION + ').'; }, 2500);
    },
    /* After a recognizer update the saved adaptation no longer fits; re-learn it from the saved word samples once the
       person is not writing, quietly, and keep it only when it helps (the same hold-out check as the Adapt button). */
    relearnHandwriting() {
      if (this._relearning) return; this._relearning = true;
      (async () => {
        try { await IL.db.kvSet('neuralDense', null); } catch (e) {}
        const list = await IL.db.kvGet('neuralSamples', []); if (!list || list.length < 8 || this.settings.engine !== 'neural') { this._relearning = false; return; }
        const ed = () => this.editor;
        const idle = () => !(ed() && (ed().live || ed().erase || ed().lassoDraw || ed().lassoDrag || ed().flip)) && !this.opening && !(document.activeElement && document.activeElement.classList.contains('row'));
        const run = async () => {
          try {
            const r = await IL.hwrClient.adapt(list.map(s => ({ strokes: s.strokes.map(pts => ({ pts })), text: s.text })), {});
            if (r && r.n && r.setting !== 'none') {
              await IL.db.kvSet('neuralDense', { ow: r.ow, ob: r.ob, model: r.model || IL.hwrClient.modelId, at: Date.now(), n: r.n, before: r.before, after: r.after, setting: r.setting, holdout: r.holdout });
              this.toast('Inkleaf updated its recognizer and learned your handwriting again from your saved words.', 3600);
            } else { await IL.hwrClient.setDense(null, null); this.toast('Inkleaf updated its recognizer; it reads your saved words well as trained.', 3200); }
            if (this.twStatus && !$('sheet-training').hidden) this.twStatus();
          } catch (e) { console.warn('re-learning the handwriting adaptation failed', e); }
          this._relearning = false;
        };
        const wait = setInterval(() => { if (idle()) { clearInterval(wait); setTimeout(run, 1500); } }, 2000);
      })();
    },
    restartWhenIdle() {
      if (this._restarting) return; this._restarting = true;
      const ed = this.editor;
      const idle = () => !(ed && (ed.live || ed.erase || ed.lassoDraw || ed.lassoDrag || ed.flip)) && !this.opening && !document.querySelector('.bookopen') && !(document.activeElement && document.activeElement.classList.contains('row'));
      const go = async () => {
        try { if (ed) await ed.flush(); } catch (e) {}
        try { await IL.db.kvSet('resumeAfterUpdate', this.view === 'notebook' && this.current ? { id: this.current.id, page: ed.pageIndex, at: Date.now() } : { at: Date.now() }); } catch (e) {}
        this.toast('Updating Inkleaf…', 1500);
        setTimeout(() => location.reload(), 350);
      };
      if (idle()) { go(); return; }
      const t = setInterval(() => { if (idle()) { clearInterval(t); go(); } }, 1200);
    },
    async resumeAfterUpdate() {
      let r = null; try { r = await IL.db.kvGet('resumeAfterUpdate', null); if (r) await IL.db.kvSet('resumeAfterUpdate', null); } catch (e) {}
      if (!r || Date.now() - (r.at || 0) > 120000) return;
      this.toast('Inkleaf was updated to the latest version.', 2600);
      const nb = r.id && this.notebooks.find(n => n.id === r.id); if (!nb) return;
      try { nb.lastPage = r.page || 0; await this.openNotebook(nb, null); } catch (e) {}
    },

    showView(name) {
      ['lock', 'home', 'cover', 'notebook'].forEach(v => { const el = $('view-' + v); el.hidden = v !== name; el.classList.remove('measuring'); });
      this.view = name; this.closeSheets(); $('popover').hidden = true;
    },
    saveSettings() { return IL.db.kvSet('settings', this.settings); },
    async saveNotebook(nb) { nb.updatedAt = nb.updatedAt || Date.now(); await IL.db.put('notebooks', nb); if (this.view === 'home') this.renderHome(); },
    saveNotebookSoon(nb) { clearTimeout(this._nbT); this._nbT = setTimeout(() => this.saveNotebook(nb), 500); },

    /* ---------- home ---------- */
    renderHome() {
      const grid = $('notebook-grid'); grid.innerHTML = '';
      this.notebooks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const nb of this.notebooks) {
        const card = document.createElement('div'); card.className = 'nb-card';
        const cover = document.createElement('div'); IL.cover.render(cover, nb.cover || IL.cover.defaultCover(nb.title));
        cover.setAttribute('role', 'button'); cover.tabIndex = 0; cover.setAttribute('aria-label', 'Open ' + nb.title); cover.dataset.nb = nb.id;
        cover.addEventListener('click', () => this.openNotebook(nb, cover));
        cover.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openNotebook(nb, cover); } });
        let pressTimer; cover.addEventListener('pointerdown', e => { pressTimer = setTimeout(() => this.notebookMenu(nb, e.clientX, e.clientY), 550); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cover.addEventListener(ev, () => clearTimeout(pressTimer)));
        cover.addEventListener('contextmenu', e => { e.preventDefault(); this.notebookMenu(nb, e.clientX, e.clientY); });
        const meta = document.createElement('div'); meta.className = 'nb-meta';
        meta.innerHTML = `<div style="min-width:0;flex:1"><div class="nb-name"></div><div class="nb-sub">${nb.pageCount || 1} page${(nb.pageCount || 1) > 1 ? 's' : ''} · ${relTime(nb.updatedAt || nb.createdAt || Date.now())}</div></div>`;
        meta.querySelector('.nb-name').textContent = nb.title;
        const more = document.createElement('button'); more.type = 'button'; more.className = 'icon-btn'; more.setAttribute('aria-label', 'Options for ' + nb.title); more.innerHTML = '<svg><use href="#i-more"/></svg>';
        more.addEventListener('click', e => { const r = more.getBoundingClientRect(); this.notebookMenu(nb, r.right, r.bottom); });
        meta.appendChild(more); card.appendChild(cover); card.appendChild(meta); grid.appendChild(card);
      }
      const add = document.createElement('button'); add.type = 'button'; add.className = 'nb-card add'; add.innerHTML = '<svg style="width:32px;height:32px"><use href="#i-plus"/></svg><span>New notebook</span>'; add.addEventListener('click', () => this.newNotebook()); grid.appendChild(add);
    },
    notebookMenu(nb, x, y) {
      this.popover([
        { label: 'Open', icon: 'i-book', run: () => this.openNotebook(nb, $('notebook-grid').querySelector(`[data-nb="${nb.id}"]`)) },
        { label: 'Edit cover', icon: 'i-palette', run: () => this.editCover(nb, () => { this.renderHome(); this.showView('home'); }) },
        { label: 'Rename', icon: 'i-edit', run: () => this.prompt('Rename notebook', nb.title, v => { if (v && v.trim()) { nb.title = v.trim(); const t = (nb.cover.elements || []).find(e => e.role === 'title'); if (t) t.text = nb.title; nb.updatedAt = Date.now(); this.saveNotebook(nb); } }) },
        { label: 'Duplicate', icon: 'i-copy', run: () => this.duplicateNotebook(nb) },
        { label: 'Export backup', icon: 'i-download', run: () => this.exportNotebook(nb) },
        { label: 'Delete', icon: 'i-trash', danger: true, run: () => this.confirm('Delete this notebook?', `"${nb.title}" and all of its pages, photos and videos will be removed from this device.`, 'Delete', () => this.deleteNotebook(nb)) }
      ], x, y, nb.title);
    },
    async newNotebook() {
      const nb = { id: IL.uid(), title: 'Untitled', createdAt: Date.now(), updatedAt: Date.now(), cover: IL.cover.defaultCover('Untitled'), settings: Object.assign(IL.editor.defaultSettings(), await IL.db.kvGet('lastStyle', {})), pageCount: 1, lastPage: 0 };
      this.notebooks.unshift(nb); await this.saveNotebook(nb);
      this.editCover(nb, () => this.openNotebook(nb));
    },
    editCover(nb, done) { this.coverEditor.open(nb, done); },
    /* fromEl: the cover card the tap came from; with it the notebook opens with the book animation. */
    async openNotebook(nb, fromEl) {
      this.current = nb;
      const fromRect = fromEl && fromEl.getBoundingClientRect && fromEl.getBoundingClientRect();
      if (!fromRect || !fromRect.width || !IL.bookOpen || this.opening) { await this.editor.open(nb); this.search.close(); return; }
      this.opening = true;
      try {
        await this.editor.open(nb, { measure: true }); this.search.close();
        const ed = this.editor; const toRect = ed.pageEl.getBoundingClientRect(); const page = ed.page; const imgs = await ed.mediaImages(page);
        let covered = false;
        await IL.bookOpen.open({ fromRect, toRect, nb, paint: (cv, w) => ed.paintPage(page, cv, w, imgs, 2), onCovered: () => { covered = true; this.showView('notebook'); } });
        if (!covered) this.showView('notebook');
      } catch (e) { console.warn(e); this.showView('notebook'); } finally { this.opening = false; }
    },
    async closeNotebook() {
      const ed = this.editor, nb = this.current; const fromRect = ed.pageEl && ed.pageEl.getBoundingClientRect();
      const page = ed.page; const imgs = page ? await ed.mediaImages(page) : null; const paint = (cv, w) => ed.paintPage(page, cv, w, imgs, 2);
      await ed.close(); this.search.close();
      const toHome = () => { this.renderHome(); this.showView('home'); const el = $('notebook-grid').querySelector(`[data-nb="${nb.id}"]`); if (!el) return null; try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {} return el.getBoundingClientRect(); };
      if (!fromRect || !IL.bookOpen || !nb) { toHome(); return; }
      await IL.bookOpen.close({ fromRect, nb, paint, getTarget: toHome });
    },
    async deleteNotebook(nb) {
      const pages = await IL.db.allBy('pages', 'byNotebook', nb.id);
      for (const p of pages) { for (const m of p.media || []) { if (m.key) await IL.blobs.del(m.key); if (m.poster) await IL.blobs.del(m.poster); } await IL.db.del('pages', p.id); }
      for (const e of (nb.cover && nb.cover.elements) || []) if (e.type === 'image' && e.key) await IL.blobs.del(e.key);
      await IL.db.del('notebooks', nb.id); this.notebooks = this.notebooks.filter(n => n.id !== nb.id); this.renderHome(); this.toast('Notebook deleted.');
    },
    async duplicateNotebook(nb) {
      const copy = JSON.parse(JSON.stringify(nb)); copy.id = IL.uid(); copy.title = nb.title + ' copy'; copy.createdAt = copy.updatedAt = Date.now();
      const t = (copy.cover.elements || []).find(e => e.role === 'title'); if (t) t.text = copy.title;
      for (const e of copy.cover.elements || []) if (e.type === 'image' && e.key) { const rec = await IL.blobs.get(e.key); if (rec) e.key = await IL.blobs.put(rec.blob, { kind: 'image' }); }
      const pages = await IL.db.allBy('pages', 'byNotebook', nb.id);
      for (const p of pages) { const np = JSON.parse(JSON.stringify(p)); np.id = IL.uid(); np.notebookId = copy.id; for (const m of np.media || []) { if (m.key) { const rec = await IL.blobs.get(m.key); if (rec) m.key = await IL.blobs.put(rec.blob, { kind: rec.kind }); } if (m.poster) { const rec = await IL.blobs.get(m.poster); if (rec) m.poster = await IL.blobs.put(rec.blob, { kind: 'poster' }); } } await IL.db.put('pages', np); }
      this.notebooks.unshift(copy); await this.saveNotebook(copy); this.toast('Notebook duplicated.');
    },

    /* ---------- sample content ---------- */
    async seedSample() {
      const nb = { id: IL.uid(), title: 'Welcome to Inkleaf', createdAt: Date.now(), updatedAt: Date.now(), settings: IL.editor.defaultSettings(), pageCount: 2, lastPage: 0,
        cover: { theme: 'ink', color: '#2d4fc9', pattern: 'dots', spine: 'rings', showTitle: true, elements: [
          { id: IL.uid(), type: 'text', role: 'title', text: 'Welcome to Inkleaf', font: 'Fraunces', color: '#FFFFFF', x: 40, y: 120, w: 230, fs: 30, rot: 0, align: 'center' },
          { id: IL.uid(), type: 'sticker', ref: 'planet-ringed', x: 160, y: 250, w: 96, h: 96, rot: 12 },
          { id: IL.uid(), type: 'sticker', ref: 'heart-sparkle', x: 48, y: 290, w: 64, h: 64, rot: -14 },
          { id: IL.uid(), type: 'sticker', ref: 'galaxy-spiral', x: 196, y: 30, w: 80, h: 80, rot: 0 }] } };
      const L = IL.editor.SPACING.medium;
      const p1 = IL.editor.newPage(nb.id, 0, L);
      ['Welcome to Inkleaf', 'This is a sample notebook. Delete it any time.', '', '1. Tap the pen tool and write on the lines with a pen or a finger.', '2. Tap Convert to turn the handwriting into typed text in this font.', '3. Change the font, color and paper under Settings (the gear icon).', '4. Search (the magnifier) finds a word on every page of the notebook.', '5. Insert adds photos and videos; videos become tap-to-play links.', '6. Long-press a cover on the home screen to redesign it.', '', 'Tip: teach it your letters under Settings > Teach it my handwriting.', 'Tip: on an iPad, the Keyboard tool also accepts Apple Pencil Scribble.'].forEach((t, i) => { if (i < p1.rows.length) p1.rows[i] = t; });
      const p2 = IL.editor.newPage(nb.id, 1, L);
      ['Shopping list', 'milk, bread, eggs, coffee', '', 'Ideas for the weekend', 'Walk by the river, call mom, finish the book'].forEach((t, i) => p2.rows[i] = t);
      await IL.db.put('pages', p1); await IL.db.put('pages', p2);
      nb.preview = p1.rows[0]; this.notebooks.push(nb); await IL.db.put('notebooks', nb);
    },

    /* ---------- sheets, popovers, toasts ---------- */
    openSheet(id) { this.closeSheets(); $('sheet-backdrop').hidden = false; $(id).hidden = false; },
    closeSheets() { document.querySelectorAll('.sheet').forEach(s => s.hidden = true); $('sheet-backdrop').hidden = true; },
    popover(items, x, y, title) {
      const pop = $('popover'); pop.innerHTML = '';
      if (title) { const t = document.createElement('div'); t.className = 'pop-title'; t.textContent = title; pop.appendChild(t); }
      items.forEach(it => { const b = document.createElement('button'); b.type = 'button'; if (it.danger) b.className = 'danger'; b.innerHTML = `<svg><use href="#${it.icon}"/></svg><span></span>`; b.querySelector('span').textContent = it.label; b.addEventListener('click', () => { pop.hidden = true; it.run(); }); pop.appendChild(b); });
      pop.hidden = false;
      const w = pop.offsetWidth, h = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w + 10)) + 'px';
      pop.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 6)) + 'px';
    },
    toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(this._toastT); this._toastT = setTimeout(() => t.hidden = true, ms || 2600); },
    confirm(title, text, okLabel, onOk) {
      $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-ok').textContent = okLabel || 'OK';
      this.openSheet('sheet-confirm'); this._confirmOk = onOk;
    },
    prompt(title, value, cb) {
      $('prompt-title').textContent = title; const inp = $('prompt-input'); inp.value = value || ''; inp.placeholder = '';
      this.openSheet('sheet-prompt'); this._promptCb = cb; setTimeout(() => { inp.focus(); inp.select(); }, 50);
    },

    /* ---------- settings sheet ---------- */
    /* scope 'nb': everything; 'app' (from the home screen): only the app-wide sections. focus: id of a section to scroll to. */
    async openSettings(scope, focus) {
      await this.syncSettings();
      document.querySelectorAll('#sheet-settings .nb-only').forEach(sec => sec.hidden = scope === 'app' || !this.current);
      this.openSheet('sheet-settings');
      if (focus) { const sec = $(focus); if (sec) { sec.scrollIntoView({ block: 'start' }); sec.classList.remove('flash-sec'); void sec.offsetWidth; sec.classList.add('flash-sec'); } }
    },
    engineShortName() { const e = this.settings.engine; if (e === 'system') return ({ ios: 'Scribble', android: 'Gboard', other: 'System' })[this.platform()]; return e === 'inkleaf' ? 'Classic' : 'Neural'; },
    buildSettings() {
      const ed = IL.editor;
      const fg = $('font-grid'); fg.innerHTML = '';
      ed.FONTS.forEach(f => { const b = document.createElement('button'); b.type = 'button'; b.className = 'font-opt'; b.dataset.font = f.key; b.innerHTML = `<span class="sample" style="font-family:${f.css}">Quick brown fox</span><span class="fname">${f.label}</span>`; b.addEventListener('click', () => this.setNbSetting('font', f.key)); fg.appendChild(b); });
      const sr = $('size-row'); sr.innerHTML = '';
      [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']].forEach(([k, n]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.size = k; b.textContent = n; b.addEventListener('click', () => this.setNbSetting('size', k)); sr.appendChild(b); });
      const tc = $('text-colors'); tc.innerHTML = '';
      ed.TEXT_COLORS.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'color-dot'; b.dataset.color = c; b.style.background = c; b.setAttribute('aria-label', c); b.addEventListener('click', () => this.setNbSetting('color', c)); tc.appendChild(b); });
      $('text-custom-color').addEventListener('input', e => this.setNbSetting('color', e.target.value));
      const pr = $('paper-row'); pr.innerHTML = '';
      [['ruled', 'Ruled'], ['grid', 'Grid'], ['dotted', 'Dotted'], ['blank', 'Blank']].forEach(([k, n]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.paper = k; b.textContent = n; b.addEventListener('click', () => this.setNbSetting('paper', k)); pr.appendChild(b); });
      const spr = $('spacing-row'); spr.innerHTML = '';
      [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']].forEach(([k, n]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.spacing = k; b.textContent = n; b.addEventListener('click', () => this.setNbSetting('spacing', k)); spr.appendChild(b); });
      $('margin-toggle').addEventListener('change', e => this.setNbSetting('marginLine', e.target.checked));
      $('auto-toggle').addEventListener('change', e => { this.settings.live = e.target.checked; this.saveSettings(); this.syncToolbarToggles(); if (this.editor.lv) { this.editor.liveCommitAll(); if (!this.settings.live) for (const [k] of this.editor.lv.lines) this.editor.renderPreview(k, null); } });
      $('auto-delay').addEventListener('input', e => { this.settings.autoDelay = +e.target.value; $('auto-delay-val').textContent = e.target.value + ' s'; this.saveSettings(); });
      $('finger-toggle').addEventListener('change', e => { this.settings.fingerDraws = e.target.checked; this.saveSettings(); this.syncToolbarToggles(); });
      document.querySelectorAll('#theme-chips .chip').forEach(b => b.addEventListener('click', () => { this.settings.theme = b.dataset.theme; this.saveSettings(); this.applyTheme(); }));
      if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme()); } catch (e) {} }
      $('spread-toggle').addEventListener('change', e => { this.settings.spread = e.target.checked; this.saveSettings(); if (this.editor.sheets.length) { this.editor.renderPage(); this.editor.layout(); this.editor.updatePager(); } });
      $('sound-toggle').addEventListener('change', e => { this.settings.pageSound = e.target.checked; this.saveSettings(); });
      const er = $('engine-row'); er.innerHTML = '';
      [['neural', 'Inkleaf Neural'], ['inkleaf', 'Inkleaf Classic'], ['system', this.systemEngineName()]].forEach(([k, n]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.engine = k; b.textContent = n; b.addEventListener('click', () => { this.settings.engine = k; this.settings.engineChosen = true; this.saveSettings(); IL.hwrClient.setMode(k === 'inkleaf' ? 'classic' : 'neural'); this.editor.applyEngine(); this.syncSettings(); this.syncToolbarToggles(); if (k === 'system') this.toast(this.systemEngineHint(), 6000); }); er.appendChild(b); });
      $('train-btn').addEventListener('click', () => this.openTraining());
      $('nb-cover-btn').addEventListener('click', () => { this.closeSheets(); this.editCover(this.current, () => this.openNotebook(this.current)); });
      $('nb-export-btn').addEventListener('click', () => this.exportNotebook(this.current));
      const la = $('lock-after'); la.innerHTML = '';
      [['0', 'Right away'], ['1', 'After 1 min'], ['5', 'After 5 min'], ['15', 'After 15 min'], ['never', 'Only at start']].forEach(([k, n]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.after = k; b.textContent = n; b.addEventListener('click', async () => { IL.Lock.state.autoLock = k; await IL.Lock.save(); this.syncSettings(); }); la.appendChild(b); });
      $('lock-enable-btn').addEventListener('click', async () => { const back = this.view; this.closeSheets(); const ok = await this.lockScreen.setupPin(); this.showView(back); if (ok) this.toast('App lock is on.'); });
      $('lock-pin-btn').addEventListener('click', async () => { const back = this.view; this.closeSheets(); if (await this.lockScreen.verify('Enter your current PIN', 'Then choose a new one.')) { await this.lockScreen.setupPin(); this.toast('PIN changed.'); } this.showView(back); });
      $('lock-disable-btn').addEventListener('click', async () => { const back = this.view; this.closeSheets(); if (await this.lockScreen.verify('Enter your PIN', 'Confirm it is you before turning the lock off.')) { await IL.Lock.disable(); this.toast('App lock is off.'); } this.showView(back); });
      $('lock-bio-btn').addEventListener('click', async () => {
        if (IL.Lock.state.bio) { IL.Lock.state.bio = null; await IL.Lock.save(); this.syncSettings(); this.toast('Face ID / fingerprint removed. The PIN still works.'); return; }
        try { IL.Lock.state.bio = await IL.Lock.enrollBio(); await IL.Lock.save(); this.syncSettings(); this.toast(IL.bioLabel() + ' added.'); }
        catch (e) { this.toast(IL.bioError(e), 5000); }
      });
    },
    platform() { const ua = navigator.userAgent; if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'; if (/Android/.test(ua)) return 'android'; return 'other'; },
    systemEngineName() { return ({ ios: 'Apple Scribble', android: 'Gboard handwriting', other: 'System handwriting keyboard' })[this.platform()]; },
    systemEngineHint() {
      return ({
        ios: 'Apple Scribble: with the Pen tool, write with the Apple Pencil directly on a line and iPadOS turns it into text. If nothing happens, switch Scribble on under iPad Settings → Apple Pencil.',
        android: 'Gboard handwriting: tap a line, then on the keyboard tap the keyboard-switch icon (or hold the comma key) and choose Handwriting. Write in the panel; the text lands on the line.',
        other: 'Writing goes straight into the lines through your device\'s own handwriting keyboard, if it has one. Otherwise use the Inkleaf engine.'
      })[this.platform()];
    },
    setNbSetting(k, v) { const nb = this.current; nb.settings[k] = v; IL.db.kvSet('lastStyle', { font: nb.settings.font, size: nb.settings.size, color: nb.settings.color, paper: nb.settings.paper, spacing: nb.settings.spacing, marginLine: nb.settings.marginLine }); this.editor.settingsChanged(); this.syncSettings(); },
    async syncSettings() {
      const st = this.current ? this.current.settings : IL.editor.defaultSettings();
      document.querySelectorAll('#font-grid .font-opt').forEach(b => b.classList.toggle('is-active', b.dataset.font === st.font));
      document.querySelectorAll('#size-row .chip').forEach(b => b.classList.toggle('is-active', b.dataset.size === st.size));
      document.querySelectorAll('#text-colors .color-dot').forEach(b => b.classList.toggle('is-active', b.dataset.color.toLowerCase() === (st.color || '').toLowerCase()));
      document.querySelectorAll('#paper-row .chip').forEach(b => b.classList.toggle('is-active', b.dataset.paper === st.paper));
      document.querySelectorAll('#spacing-row .chip').forEach(b => b.classList.toggle('is-active', b.dataset.spacing === st.spacing));
      $('margin-toggle').checked = !!st.marginLine;
      const prev = $('style-preview'); prev.style.fontFamily = (IL.editor.FONTS.find(f => f.key === st.font) || IL.editor.FONTS[0]).css; prev.style.color = st.color; prev.style.fontSize = ({ small: 22, medium: 27, large: 32 })[st.size] + 'px';
      $('spread-toggle').checked = this.settings.spread !== false; $('sound-toggle').checked = this.settings.pageSound !== false; this.applyTheme();
      $('auto-toggle').checked = this.settings.live !== false; $('auto-delay').value = this.settings.autoDelay || 1.2; $('auto-delay-val').textContent = (this.settings.autoDelay || 1.2) + ' s'; $('finger-toggle').checked = !!this.settings.fingerDraws;
      const eng = this.settings.engine === 'system' ? 'system' : this.settings.engine === 'inkleaf' ? 'inkleaf' : 'neural';
      document.querySelectorAll('#engine-row .chip').forEach(b => b.classList.toggle('is-active', b.dataset.engine === eng));
      $('engine-hint').textContent = eng === 'system' ? this.systemEngineHint() : eng === 'neural' ? 'Inkleaf Neural reads each word as a whole with a neural network (CRNN) trained on real-writer handwriting, so joined-up writing works too. Runs on this device, offline, with a live preview. Teach it my handwriting → Words adapts it to your hand.' : 'Inkleaf Classic matches letter shapes one by one, including the letters you teach it below. Best with printed letters.';
      const nn = IL.hwrClient.neural;
      $('engine-info').textContent = eng === 'system' ? '' : eng === 'neural' ? (nn.ready ? 'Neural engine ready' + (nn.wasm ? ' (fast SIMD kernels).' : '.') : (IL.hwrClient.inWorker ? 'Neural engine still loading… the classic engine answers meanwhile.' : 'Neural engine loading.')) : 'Classic engine: ' + (IL.hwrClient.inWorker ? 'running in the background' : 'ready') + '. ' + (IL.hwr.templateCount().user ? `${IL.hwr.templateCount().user} of your own samples in use.` : 'No personal samples yet.');
      const lk = IL.Lock.state || { enabled: false }; const bioOk = await IL.Lock.bioAvailable();
      $('lock-status').textContent = lk.enabled ? `On. Unlock with ${lk.bio ? IL.bioLabel() + ' or a ' : 'a '}PIN.` : 'Off. Anyone who opens this app can read your notebooks.';
      $('lock-enable-btn').hidden = lk.enabled; $('lock-pin-btn').hidden = !lk.enabled; $('lock-disable-btn').hidden = !lk.enabled; $('lock-after-row').hidden = !lk.enabled;
      $('lock-bio-btn').hidden = !lk.enabled || (!bioOk && !lk.bio); $('lock-bio-btn').querySelector('span').textContent = lk.bio ? 'Remove ' + IL.bioLabel() : 'Add ' + IL.bioLabel();
      document.querySelectorAll('#lock-after .chip').forEach(b => b.classList.toggle('is-active', b.dataset.after === String(lk.autoLock || '1')));
      this.syncInstallSection();
    },
    syncToolbarToggles() { $('auto-btn').setAttribute('aria-pressed', String(this.settings.live !== false)); $('finger-btn').setAttribute('aria-pressed', String(!!this.settings.fingerDraws)); $('engine-label').textContent = this.engineShortName(); $('engine-btn').title = 'Handwriting engine: ' + (this.settings.engine === 'system' ? this.systemEngineName() : this.settings.engine === 'inkleaf' ? 'Inkleaf Classic' : 'Inkleaf Neural') + '. Tap to change.'; },

    /* ---------- training sheet ---------- */
    buildTraining() {
      const chars = $('train-chars'); chars.innerHTML = '';
      IL.hwr.trainLabels.forEach(l => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.label = l; b.innerHTML = `<span class="lbl">${IL.hwr.labelName(l).replace(/</g, '&lt;')}</span>`; b.addEventListener('click', () => this.selectTrainLabel(l)); chars.appendChild(b); });
      const cv = $('train-canvas'); const ctx = cv.getContext('2d'); this.trainStrokes = []; let live = null;
      const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 300, (e.clientY - r.top) / r.height * 300]; };
      const redraw = () => { ctx.clearRect(0, 0, 300, 300); ctx.strokeStyle = '#C6D4EA'; ctx.lineWidth = 1; [[0, 230], [0, 150]].forEach(([x, y]) => { ctx.setLineDash(y === 150 ? [4, 6] : []); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(300, y); ctx.stroke(); }); ctx.setLineDash([]); ctx.fillStyle = '#8B93A3'; ctx.font = '11px system-ui'; ctx.fillText('baseline', 6, 244); ctx.strokeStyle = '#1B1F2A'; ctx.lineWidth = 4; ctx.lineCap = ctx.lineJoin = 'round'; for (const s of this.trainStrokes.concat(live ? [live] : [])) { ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); } };
      this.trainRedraw = redraw;
      cv.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && live) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); live = [pt(e)]; redraw(); });
      cv.addEventListener('pointermove', e => { if (!live) return; live.push(pt(e)); redraw(); });
      const end = e => { if (!live) return; if (live.length === 1) live.push([live[0][0] + 0.5, live[0][1] + 0.5]); this.trainStrokes.push(live); live = null; redraw(); $('train-result').textContent = ''; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      $('train-clear').addEventListener('click', () => { this.trainStrokes = []; redraw(); $('train-result').textContent = ''; });
      $('train-save').addEventListener('click', async () => {
        if (!this.trainStrokes.length) { this.toast('Write the character first.'); return; }
        const existing = (await IL.db.allBy('templates', 'byChar', this.trainLabel)).sort((a, b) => a.id - b.id);
        if (existing.length >= 4) await IL.db.del('templates', existing[0].id);
        await IL.db.put('templates', { ch: this.trainLabel, strokes: this.trainStrokes.map(s => s.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])), at: Date.now() });
        IL.hwrClient.setUserTemplates(await IL.db.all('templates'));
        this.trainStrokes = []; redraw(); await this.refreshTrainCounts(); this.toast(`Saved a sample for ${IL.hwr.labelName(this.trainLabel)}.`);
        const i = IL.hwr.trainLabels.indexOf(this.trainLabel); if (i < IL.hwr.trainLabels.length - 1) this.selectTrainLabel(IL.hwr.trainLabels[i + 1]);
      });
      $('train-test').addEventListener('click', () => { if (!this.trainStrokes.length) { $('train-result').textContent = 'Write something first.'; return; } const c = IL.hwr.recognizeChar(this.trainStrokes); $('train-result').textContent = c.length ? 'Reads as: ' + c.slice(0, 3).map(x => IL.hwr.labelName(x.label)).join(', then ') : 'Nothing recognized.'; });
      $('train-reset').addEventListener('click', () => this.confirm('Delete all your samples?', 'The recognizer goes back to its built-in letter shapes.', 'Delete samples', async () => { await IL.db.clear('templates'); IL.hwrClient.setUserTemplates([]); await this.refreshTrainCounts(); this.toast('Samples deleted.'); }));
      this.selectTrainLabel('a');
      this.buildWordTraining();
    },
    /* ---------- words for the neural engine: a few dozen written words adapt its output layer on the device ---------- */
    TW_WORDS: ['hello', 'Monday', 'quick', 'brown', 'jumps', 'lazy', 'dog', 'coffee', 'milk', 'Berlin', 'order', 'pallet', 'invoice', 'Thanks', 'meeting', 'because', 'every', 'night', 'yellow', 'fifty', 'Kevin', 'Jacket', 'Quiz', 'Wagon', 'xylophone', 'Zebra', 'Guten', 'Morgen', 'hola', 'gracias', 'number', 'phone', 'water', 'Done', 'urgent', 'Friday', 'Frankfurt', 'tomorrow', 'please', 'Ideas', 'cable', 'delivery', 'Summary', 'Review', 'Lunch', 'School', 'History', 'Physics', 'Vielen', 'Dank'],
    buildWordTraining() {
      const cv = $('tw-canvas'); const ctx = cv.getContext('2d'); const W = 600, Hc = 190, BASE = 140, XH = 95;
      this.twStrokes = []; this.twSamples = null; this.twIndex = 0; let live = null;
      const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * Hc]; };
      const redraw = () => {
        ctx.clearRect(0, 0, W, Hc); ctx.strokeStyle = '#C6D4EA'; ctx.lineWidth = 1;
        [[BASE, []], [XH, [4, 6]]].forEach(([y, dash]) => { ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }); ctx.setLineDash([]);
        ctx.fillStyle = '#8B93A3'; ctx.font = '11px system-ui'; ctx.fillText('baseline', 6, BASE + 14);
        ctx.strokeStyle = '#1B1F2A'; ctx.lineWidth = 3.2; ctx.lineCap = ctx.lineJoin = 'round';
        for (const s of this.twStrokes.concat(live ? [live] : [])) { ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
      };
      this.twRedraw = redraw;
      cv.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && live) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); live = [pt(e)]; redraw(); });
      cv.addEventListener('pointermove', e => { if (!live) return; const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of evs) live.push(pt(ev)); redraw(); });
      const end = () => { if (!live) return; if (live.length === 1) live.push([live[0][0] + 0.5, live[0][1] + 0.5]); this.twStrokes.push(live); live = null; redraw(); $('tw-result').textContent = ''; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      const samples = async () => { if (!this.twSamples) this.twSamples = await IL.db.kvGet('neuralSamples', []); return this.twSamples; };
      this.twLoadSamples = samples;
      const pick = async () => { const list = await samples(); const done = new Set(list.map(s => s.text)); const words = this.TW_WORDS; let w = words[this.twIndex % words.length]; for (let k = 0; k < words.length && done.has(w); k++) { this.twIndex++; w = words[this.twIndex % words.length]; } $('tw-current').textContent = w; $('tw-count').textContent = list.length ? `(${list.length} saved)` : ''; this.twWord = w; };
      this.twPick = pick;
      const status = async () => { const list = await samples(); const d = await IL.db.kvGet('neuralDense', null); const n = list.length; const btn = $('tw-adapt'); btn.disabled = n < 8; let msg = n < 8 ? `${n} of 8 words saved so far.` : `${n} words saved.`; if (d && d.at) msg += ` Adapted on ${new Date(d.at).toLocaleDateString()} from ${d.n} words` + (d.holdout ? ` (checked on ${d.holdout.n} unseen words: ${d.holdout.before} → ${d.holdout.after} read right)` : d.after != null ? ` (read ${d.before} → ${d.after} of them right)` : '') + '.'; else if (n >= 8) msg += ' Ready to adapt.'; if (n >= 8 && n < 12) msg += ' With 12 or more words it also checks itself on words it has not trained on.'; $('tw-status').textContent = msg; };
      this.twStatus = status;
      $('tw-clear').addEventListener('click', () => { this.twStrokes = []; redraw(); $('tw-result').textContent = ''; });
      $('tw-skip').addEventListener('click', async () => { this.twIndex++; this.twStrokes = []; redraw(); $('tw-result').textContent = ''; await pick(); });
      $('tw-save').addEventListener('click', async () => {
        if (!this.twStrokes.length) { this.toast('Write the word first.'); return; }
        const list = await samples(); const text = this.twWord;
        list.push({ text, strokes: this.twStrokes.map(s => s.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])), at: Date.now() });
        await IL.db.kvSet('neuralSamples', list); IL.hwrClient.learnWords(text);
        this.twStrokes = []; redraw(); this.twIndex++; await pick(); await status();
        this.toast(list.length === 8 ? 'Eight words saved — you can adapt now. More words make it better.' : `Saved “${text}” (${list.length}).`, 1800);
      });
      $('tw-test').addEventListener('click', async () => {
        if (!this.twStrokes.length) { $('tw-result').textContent = 'Write something first.'; return; }
        $('tw-result').textContent = 'Reading…';
        try { const words = await IL.hwrClient.recognizeRowWords(this.twStrokes.map((pts, i) => ({ pts, at: i + 1 })), BASE - 92, 92); $('tw-result').textContent = words.length ? 'Reads as: ' + words.map(w => w.text).join(' ') : 'Nothing recognized.'; }
        catch (e) { $('tw-result').textContent = 'Could not read it.'; }
      });
      $('tw-adapt').addEventListener('click', async () => {
        const list = await samples(); if (list.length < 8) { this.toast('Save at least 8 words first.'); return; }
        if (this.settings.engine !== 'neural') { this.toast('Switch the engine to Inkleaf Neural first (Settings → Handwriting).', 2600); return; }
        const btn = $('tw-adapt'); btn.disabled = true; $('tw-status').textContent = `Adapting to your handwriting from ${list.length} words… this takes 10–40 seconds.`;
        try {
          const r = await IL.hwrClient.adapt(list.map(s => ({ strokes: s.strokes.map(pts => ({ pts })), text: s.text })), {});
          if (!r || !r.n) throw new Error('nothing usable');
          if (r.setting === 'none') {
            await IL.db.kvSet('neuralDense', null); await IL.hwrClient.setDense(null, null);
            await status(); $('tw-status').textContent = `Checked on ${r.holdout.n} of your words it had not trained on: adapting did not read them any better (${r.holdout.before} of ${r.holdout.n} right either way), so the engine stays as trained. Your words are in its dictionary already; add more samples and try again later.`;
            this.toast('No change: adapting did not help on words it had not seen.', 3000); btn.disabled = false; return;
          }
          await IL.db.kvSet('neuralDense', { ow: r.ow, ob: r.ob, model: r.model || IL.hwrClient.modelId, at: Date.now(), n: r.n, before: r.before, after: r.after, setting: r.setting, holdout: r.holdout });
          await status(); this.toast(r.holdout ? `Adapted. On ${r.holdout.n} words it had not trained on: ${r.holdout.before} → ${r.holdout.after} read right.` : `Adapted. Of your ${r.n} words it read ${r.before} right before and ${r.after} now.`, 3600);
        } catch (e) { $('tw-status').textContent = 'Adapting did not work: ' + (e && e.message ? e.message : e) + '. Is the Neural engine loaded?'; }
        btn.disabled = false;
      });
      $('tw-export').addEventListener('click', async () => {
        const list = await samples(); if (!list.length) { this.toast('No word samples yet.'); return; }
        const json = JSON.stringify({ inkleafSamples: 1, exportedAt: new Date().toISOString(), canvas: { w: W, h: Hc, baseline: BASE, xheight: XH }, samples: list });
        const file = new File([json], 'inkleaf-handwriting-samples.json', { type: 'application/json' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Inkleaf handwriting samples' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
        const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      });
      $('tw-reset').addEventListener('click', () => this.confirm('Delete your word samples?', 'The Neural engine goes back to its trained weights and the saved words are removed.', 'Delete', async () => { this.twSamples = []; await IL.db.kvSet('neuralSamples', []); await IL.db.kvSet('neuralDense', null); await IL.hwrClient.setDense(null, null); this.twIndex = 0; await pick(); await status(); this.toast('Word samples and adaptation removed.'); }));
      $('train-modes').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => this.setTrainMode(b.dataset.mode)));
    },
    setTrainMode(m) { this.trainMode = m; $('train-modes').querySelectorAll('.chip').forEach(b => b.classList.toggle('is-active', b.dataset.mode === m)); $('train-words').hidden = m !== 'words'; $('train-letters').hidden = m === 'words'; },
    async openTraining() {
      this.openSheet('sheet-training'); this.setTrainMode(this.trainMode || (this.settings.engine === 'inkleaf' ? 'letters' : 'words'));
      await this.refreshTrainCounts(); this.trainStrokes = []; this.trainRedraw();
      this.twStrokes = []; this.twRedraw(); $('tw-result').textContent = ''; await this.twPick(); await this.twStatus();
    },
    selectTrainLabel(l) { this.trainLabel = l; $('train-current').textContent = IL.hwr.labelName(l); document.querySelectorAll('#train-chars .chip').forEach(b => b.classList.toggle('is-active', b.dataset.label === l)); this.trainStrokes = []; this.trainRedraw && this.trainRedraw(); $('train-result').textContent = ''; this.refreshTrainCounts(); },
    async refreshTrainCounts() {
      const all = await IL.db.all('templates'); const counts = {}; all.forEach(t => counts[t.ch] = (counts[t.ch] || 0) + 1);
      document.querySelectorAll('#train-chars .chip').forEach(b => { const n = counts[b.dataset.label] || 0; let badge = b.querySelector('.n'); if (n) { if (!badge) { badge = document.createElement('span'); badge.className = 'n'; b.appendChild(badge); } badge.textContent = n; } else if (badge) badge.remove(); });
      $('train-count').textContent = counts[this.trainLabel] ? `(${counts[this.trainLabel]} saved)` : '';
    },

    /* ---------- backup ---------- */
    async exportNotebook(nb) {
      this.openSheet('sheet-export'); const status = $('export-status'); status.textContent = 'Preparing…';
      const pages = (await IL.db.allBy('pages', 'byNotebook', nb.id)).sort((a, b) => a.index - b.index);
      const blobs = {}; const skipped = [];
      const addBlob = async (key) => { if (!key || blobs[key]) return; const rec = await IL.blobs.get(key); if (!rec) return; if (rec.blob.size > 40e6) { skipped.push(rec.name || key); return; } blobs[key] = { type: rec.blob.type, kind: rec.kind, name: rec.name, data: await blobToDataUrl(rec.blob) }; };
      for (const e of (nb.cover && nb.cover.elements) || []) if (e.type === 'image') await addBlob(e.key);
      for (const p of pages) for (const m of p.media || []) { await addBlob(m.key); await addBlob(m.poster); }
      const data = { inkleaf: 1, exportedAt: new Date().toISOString(), notebook: Object.assign({}, nb), pages: pages.map(p => ({ id: p.id, index: p.index, rows: p.rows, strokes: p.strokes, media: p.media || [] })), blobs };
      const json = JSON.stringify(data); const file = new File([json], `${nb.title.replace(/[^\w\- ]+/g, '').trim() || 'notebook'}.inkleaf.json`, { type: 'application/json' });
      status.textContent = `Backup ready (${(file.size / 1e6).toFixed(1)} MB).` + (skipped.length ? ` Videos over 40 MB were left out: ${skipped.join(', ')}.` : '');
      $('export-share').onclick = async () => {
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: nb.title }); return; } catch (e) { if (e.name === 'AbortError') return; } }
        const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
        status.textContent = 'If no file appeared, this window does not allow downloads. Use "Copy as text" and paste it into a file, or export from the installed app.';
      };
      $('export-copy').onclick = async () => { try { await navigator.clipboard.writeText(json); status.textContent = 'Copied. Paste it into a text file ending in .json to keep it.'; } catch (e) { status.textContent = 'Copying is blocked here. Try "Save or share file".'; } };
    },
    async importBackup(file) {
      try {
        const data = JSON.parse(await file.text()); if (!data || !data.inkleaf || !data.notebook) throw new Error('bad');
        const keyMap = {};
        for (const [k, b] of Object.entries(data.blobs || {})) { const blob = await (await fetch(b.data)).blob(); keyMap[k] = await IL.blobs.put(blob, { kind: b.kind, name: b.name }); }
        const nb = data.notebook; nb.id = IL.uid(); nb.updatedAt = Date.now();
        for (const e of (nb.cover && nb.cover.elements) || []) if (e.type === 'image') e.key = keyMap[e.key] || e.key;
        for (const p of data.pages) { p.id = IL.uid(); p.notebookId = nb.id; for (const m of p.media || []) { if (m.key) m.key = keyMap[m.key] || m.key; if (m.poster) m.poster = keyMap[m.poster] || m.poster; } await IL.db.put('pages', p); }
        nb.pageCount = data.pages.length; this.notebooks.unshift(nb); await this.saveNotebook(nb); this.toast(`Imported "${nb.title}".`);
      } catch (e) { console.error(e); this.toast('That file is not an Inkleaf backup.'); }
    },
    /* Removes stored photos/videos no notebook references any more (deleted pictures keep their file until here so undo works). */
    async gcBlobs() {
      try {
        const refs = new Set();
        for (const nb of await IL.db.all('notebooks')) for (const e of (nb.cover && nb.cover.elements) || []) if (e.key) refs.add(e.key);
        for (const p of await IL.db.all('pages')) for (const m of p.media || []) { if (m.key) refs.add(m.key); if (m.poster) refs.add(m.poster); }
        const now = Date.now();
        for (const b of await IL.db.all('blobs')) { const base = b.key.split('~')[0]; if (!refs.has(base) && now - (b.addedAt || 0) > 3600e3) await IL.blobs.del(b.key); }
      } catch (e) { console.warn('clean-up skipped', e); }
    },
    async eraseAll() { for (const s of ['notebooks', 'pages', 'blobs', 'templates', 'kv']) await IL.db.clear(s); },

    /* ---------- install & lock plumbing ---------- */
    setupInstall() {
      window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); this.installEvent = e; $('install-btn').hidden = false; this.syncInstallSection(); });
      const doInstall = async () => { if (!this.installEvent) return; this.installEvent.prompt(); await this.installEvent.userChoice.catch(() => {}); this.installEvent = null; $('install-btn').hidden = true; this.syncInstallSection(); };
      $('install-btn').addEventListener('click', doInstall); $('install-btn-2').addEventListener('click', doInstall);
      window.addEventListener('appinstalled', () => { $('install-btn').hidden = true; this.toast('Inkleaf is installed.'); });
    },
    syncInstallSection() {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
      const sec = $('install-section'); const hint = $('install-hint'); const btn = $('install-btn-2');
      if (standalone) { sec.hidden = false; hint.textContent = 'Installed. Inkleaf works fully offline on this device.'; btn.hidden = true; return; }
      if (this.installEvent) { sec.hidden = false; hint.textContent = 'Install Inkleaf for a full-screen app that works offline.'; btn.hidden = false; return; }
      if (ios) { sec.hidden = false; hint.textContent = 'On iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen". The app then opens full screen and works offline.'; btn.hidden = true; return; }
      sec.hidden = true;
    },
    setupAutoLock() {
      let hiddenAt = null;
      document.addEventListener('visibilitychange', async () => {
        if (document.hidden) { hiddenAt = Date.now(); return; }
        if (!IL.Lock.enabled || hiddenAt == null || this.view === 'lock') return;
        const after = IL.Lock.state.autoLock == null ? '1' : String(IL.Lock.state.autoLock);
        if (after === 'never') return;
        const mins = after === '0' ? 0 : parseFloat(after);
        if ((Date.now() - hiddenAt) / 60000 >= mins) { const back = this.view; await this.editor.flush(); await this.lockScreen.unlock(); this.showView(back); }
      });
    },

    /* ---------- callbacks from the editor ---------- */
    onTextChanged() { this.search.refresh(); },
    onPageChanged() { this.search.refresh(); if (!$('sheet-pages').hidden) this.renderPagesSheet(); },

    renderPagesSheet() {
      const grid = $('pages-grid'); grid.innerHTML = '';
      this.editor.pages.forEach((p, i) => {
        const wrap = document.createElement('div'); wrap.className = 'page-thumb' + (i === this.editor.pageIndex ? ' is-current' : '');
        const cv = document.createElement('canvas'); this.editor.drawThumb(p, cv, 160); cv.addEventListener('click', () => { this.closeSheets(); this.editor.goTo(i); });
        const row = document.createElement('div'); row.className = 'pt-row'; row.innerHTML = `<span>Page ${i + 1}</span>`;
        const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn'; del.setAttribute('aria-label', 'Delete page ' + (i + 1)); del.innerHTML = '<svg><use href="#i-trash"/></svg>';
        del.addEventListener('click', () => this.confirm(`Delete page ${i + 1}?`, 'Its text, ink, photos and videos will be removed.', 'Delete page', async () => { await this.editor.deletePage(i); this.renderPagesSheet(); this.openSheet('sheet-pages'); }));
        const ins = document.createElement('button'); ins.type = 'button'; ins.className = 'icon-btn'; ins.setAttribute('aria-label', 'Insert page after ' + (i + 1)); ins.innerHTML = '<svg><use href="#i-plus"/></svg>';
        ins.addEventListener('click', async () => { await this.editor.addPage(i); this.renderPagesSheet(); });
        row.appendChild(ins); row.appendChild(del); wrap.appendChild(cv); wrap.appendChild(row); grid.appendChild(wrap);
      });
    },

    bindUI() {
      $('new-notebook-btn').addEventListener('click', () => this.newNotebook());
      $('home-train-btn').addEventListener('click', () => this.openTraining());
      $('home-import-btn').addEventListener('click', () => { const inp = $('file-import'); inp.value = ''; inp.click(); });
      $('file-import').addEventListener('change', e => { if (e.target.files[0]) this.importBackup(e.target.files[0]); });
      $('nb-back').addEventListener('click', () => this.closeNotebook());
      $('nb-title').addEventListener('click', () => this.prompt('Rename notebook', this.current.title, v => { if (v && v.trim()) { this.current.title = v.trim(); const t = (this.current.cover.elements || []).find(e => e.role === 'title'); if (t) t.text = this.current.title; $('nb-title').textContent = this.current.title; this.saveNotebook(this.current); } }));
      $('nb-settings-btn').addEventListener('click', () => this.openSettings('nb'));
      $('home-settings-btn').addEventListener('click', () => this.openSettings('app'));
      $('engine-btn').addEventListener('click', () => this.openSettings('nb', 'settings-handwriting'));
      $('nb-pages-btn').addEventListener('click', () => { this.renderPagesSheet(); this.openSheet('sheet-pages'); });
      $('auto-btn').addEventListener('click', () => { this.settings.live = !this.settings.live; this.saveSettings(); this.syncToolbarToggles(); if (this.editor.lv) { this.editor.liveCommitAll(); if (!this.settings.live) { for (const [k] of this.editor.lv.lines) this.editor.renderPreview(k, null); } else { this.editor.liveRefresh(); this.editor.lv.suspended = false; } } this.toast(this.settings.live ? 'Live: words turn into text as you write.' : 'Live off. Use the Convert button when you are done.'); });
      $('finger-btn').addEventListener('click', () => { this.settings.fingerDraws = !this.settings.fingerDraws; this.saveSettings(); this.syncToolbarToggles(); this.toast(this.settings.fingerDraws ? 'Finger draws. Use two fingers to scroll and zoom.' : 'Finger scrolls; only a pen or mouse draws.'); });
      $('insert-btn').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); this.popover([
        { label: 'Photo from gallery', icon: 'i-image', run: () => { const inp = $('file-page-image'); inp.value = ''; inp.click(); } },
        { label: 'Video from gallery', icon: 'i-video', run: () => { const inp = $('file-video'); inp.value = ''; inp.click(); } },
        { label: 'Video link (YouTube, Drive…)', icon: 'i-video', run: () => this.prompt('Paste a video link', '', v => this.editor.addVideoLink(v)) }
      ], r.right, r.bottom, 'Insert on this page'); });
      $('sheet-backdrop').addEventListener('click', () => this.closeSheets());
      document.querySelectorAll('.sheet-close').forEach(b => b.addEventListener('click', () => this.closeSheets()));
      $('confirm-cancel').addEventListener('click', () => this.closeSheets());
      $('confirm-ok').addEventListener('click', async () => { const cb = this._confirmOk; this._confirmOk = null; this.closeSheets(); cb && await cb(); });
      $('prompt-cancel').addEventListener('click', () => { this.closeSheets(); const cb = this._promptCb; this._promptCb = null; cb && cb(null); });
      $('prompt-ok').addEventListener('click', () => { const cb = this._promptCb; this._promptCb = null; const v = $('prompt-input').value; this.closeSheets(); cb && cb(v); });
      $('prompt-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('prompt-ok').click(); });
      document.addEventListener('pointerdown', e => { const pop = $('popover'); if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; }, true);
      this.buildSettings(); this.buildTraining(); this.syncToolbarToggles();
    }
  };

  function blobToDataUrl(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); }); }

  IL.app = app;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.init()); else app.init();
})();
