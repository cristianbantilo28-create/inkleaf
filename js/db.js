/* Inkleaf — storage: IndexedDB with an in-memory fallback (private windows, blocked storage). */
(function () {
  const IL = (window.IL = window.IL || {});
  const NAME = 'inkleaf', VERSION = 1;
  const STORES = {
    notebooks: { keyPath: 'id' },
    pages: { keyPath: 'id', indexes: [['byNotebook', 'notebookId']] },
    blobs: { keyPath: 'key' },
    templates: { keyPath: 'id', autoIncrement: true, indexes: [['byChar', 'ch']] },
    kv: { keyPath: 'k' }
  };

  IL.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

  let backendPromise = null;

  function openIDB() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, def] of Object.entries(STORES)) {
          if (db.objectStoreNames.contains(name)) continue;
          const os = db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
          (def.indexes || []).forEach(([iname, field]) => os.createIndex(iname, field, { unique: false }));
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
      setTimeout(() => reject(new Error('IndexedDB timeout')), 8000);
    });
  }

  function idbBackend(db) {
    function run(store, mode, make) {
      return new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(store, mode); } catch (e) { return reject(e); }
        const r = make(tx.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
      });
    }
    return {
      kind: 'idb',
      get: (s, k) => run(s, 'readonly', os => os.get(k)),
      put: (s, v) => run(s, 'readwrite', os => os.put(v)),
      del: (s, k) => run(s, 'readwrite', os => os.delete(k)),
      all: (s) => run(s, 'readonly', os => os.getAll()),
      allBy: (s, index, key) => run(s, 'readonly', os => os.index(index).getAll(key)),
      clear: (s) => run(s, 'readwrite', os => os.clear())
    };
  }

  function memBackend() {
    const maps = {}; let auto = 1;
    const m = s => (maps[s] || (maps[s] = new Map()));
    const keyOf = (s, v) => v[STORES[s].keyPath];
    return {
      kind: 'memory',
      async get(s, k) { return m(s).get(k); },
      async put(s, v) { if (keyOf(s, v) === undefined) v[STORES[s].keyPath] = auto++; m(s).set(keyOf(s, v), v); return keyOf(s, v); },
      async del(s, k) { m(s).delete(k); },
      async all(s) { return [...m(s).values()]; },
      async allBy(s, index, key) {
        const field = (STORES[s].indexes || []).find(i => i[0] === index)[1];
        return [...m(s).values()].filter(v => v[field] === key);
      },
      async clear(s) { m(s).clear(); }
    };
  }

  function backend() {
    if (!backendPromise) {
      backendPromise = (typeof indexedDB === 'undefined' ? Promise.reject(new Error('no indexedDB')) : openIDB())
        .then(db => idbBackend(db))
        .catch(err => { console.warn('Storage fallback to memory:', err && err.message); IL.storageFallback = true; return memBackend(); });
    }
    return backendPromise;
  }

  IL.db = {
    ready: () => backend(),
    get: (s, k) => backend().then(b => b.get(s, k)),
    put: (s, v) => backend().then(b => b.put(s, v)),
    del: (s, k) => backend().then(b => b.del(s, k)),
    all: (s) => backend().then(b => b.all(s)),
    allBy: (s, i, k) => backend().then(b => b.allBy(s, i, k)),
    clear: (s) => backend().then(b => b.clear(s)),
    kvGet: async (k, dflt) => { const r = await IL.db.get('kv', k); return r ? r.v : dflt; },
    kvSet: (k, v) => IL.db.put('kv', { k, v })
  };

  /* ---- blobs (photos, videos, posters) ---- */
  const urlCache = new Map(); const inflight = new Map();
  IL.blobs = {
    async put(blob, meta) {
      const key = 'b_' + IL.uid();
      await IL.db.put('blobs', Object.assign({ key, blob, type: blob.type, size: blob.size, addedAt: Date.now() }, meta || {}));
      return key;
    },
    async get(key) { return IL.db.get('blobs', key); },
    async url(key) {
      if (!key) return null;
      if (urlCache.has(key)) return urlCache.get(key);
      const rec = await IL.db.get('blobs', key);
      if (!rec || !rec.blob) return null;
      const u = URL.createObjectURL(rec.blob);
      urlCache.set(key, u);
      return u;
    },
    async del(key) {
      for (const k of [key, key + '~mosaic']) {
        if (urlCache.has(k)) { try { URL.revokeObjectURL(urlCache.get(k)); } catch (e) {} urlCache.delete(k); }
        await IL.db.del('blobs', k);
      }
    },
    /* Shrinks a photo so it fits in maxDim px; keeps PNG transparency, otherwise JPEG. */
    async shrinkImage(file, maxDim) {
      maxDim = maxDim || 1600;
      const bmp = await loadImage(file);
      const ratio = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * ratio)), h = Math.max(1, Math.round(bmp.height * ratio));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const isPng = /png|gif|webp/.test(file.type) && await hasAlpha(c);
      const blob = await new Promise(res => c.toBlob(res, isPng ? 'image/png' : 'image/jpeg', 0.86));
      if (bmp.close) bmp.close();
      return { blob: blob || file, width: w, height: h };
    },
    /* A derived version of a stored image (e.g. a pixelated copy), cached under its own key. */
    async derivedUrl(key, variant, make) {
      const dkey = key + '~' + variant;
      if (urlCache.has(dkey)) return urlCache.get(dkey);
      if (inflight.has(dkey)) return inflight.get(dkey);
      const p = this._derive(key, dkey, make).finally(() => inflight.delete(dkey));
      inflight.set(dkey, p); return p;
    },
    async _derive(key, dkey, make) {
      let rec = await IL.db.get('blobs', dkey);
      if (!rec) {
        const src = await IL.db.get('blobs', key); if (!src || !src.blob) return null;
        const blob = await make(src.blob); if (!blob) return null;
        rec = { key: dkey, blob, type: blob.type, size: blob.size, kind: 'derived', addedAt: Date.now() };
        await IL.db.put('blobs', rec);
      }
      const u = URL.createObjectURL(rec.blob); urlCache.set(dkey, u); return u;
    },
    /* Mosaic: shrink to a handful of columns; the <img> upsamples it with image-rendering: pixelated. */
    async mosaic(blob, cols) {
      const bmp = await loadImage(blob); cols = cols || 26;
      const w = cols, h = Math.max(1, Math.round(cols * bmp.height / bmp.width));
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return new Promise(res => c.toBlob(res, 'image/png'));
    },
    /* Grabs a poster frame and duration from a video file; resolves with nulls if the browser can't decode it. */
    videoInfo(file) {
      return new Promise(resolve => {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'metadata';
        const url = URL.createObjectURL(file);
        let done = false;
        const finish = (poster, duration) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute('src'); try { v.load(); } catch (e) {} resolve({ poster, duration }); };
        const timer = setTimeout(() => finish(null, isFinite(v.duration) ? v.duration : null), 6000);
        v.addEventListener('loadedmetadata', () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 3); } catch (e) { finish(null, v.duration); } });
        v.addEventListener('seeked', () => {
          try {
            const c = document.createElement('canvas');
            const ratio = Math.min(1, 320 / Math.max(v.videoWidth || 320, v.videoHeight || 180));
            c.width = Math.max(1, Math.round((v.videoWidth || 320) * ratio)); c.height = Math.max(1, Math.round((v.videoHeight || 180) * ratio));
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            c.toBlob(b => { clearTimeout(timer); finish(b, v.duration); }, 'image/jpeg', 0.75);
          } catch (e) { clearTimeout(timer); finish(null, v.duration); }
        });
        v.addEventListener('error', () => { clearTimeout(timer); finish(null, null); });
        v.src = url;
      });
    }
  };

  function loadImage(file) {
    if (window.createImageBitmap) return createImageBitmap(file).catch(() => loadImageEl(file));
    return loadImageEl(file);
  }
  function loadImageEl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
      img.src = url;
    });
  }
  async function hasAlpha(canvas) {
    try {
      const ctx = canvas.getContext('2d'); const step = Math.max(1, Math.floor(canvas.width / 40));
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < d.length; i += 4 * step) if (d[i] < 250) return true;
    } catch (e) {}
    return false;
  }
})();
