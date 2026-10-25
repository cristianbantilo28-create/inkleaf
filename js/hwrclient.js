/* Inkleaf — runs the recognizer in a Web Worker so the pen never stutters; falls back to the main thread when workers are unavailable. */
(function () {
  const IL = (window.IL = window.IL || {});
  let worker = null, failed = false, booting = null, seq = 0;
  const pending = new Map();
  let templates = [];
  const GLUE = "\nself.onmessage=function(e){var m=e.data;try{if(m.type==='templates'){self.IL.hwr.setUserTemplates(m.list);}else if(m.type==='learn'){self.IL.hwr.learnWords(m.text);}else if(m.type==='mode'){self.IL.hwr.setMode(m.mode);}else if(m.type==='row'){var r=self.IL.hwr.recognizeRowWords(m.strokes,m.rowTop,m.L);self.postMessage({id:m.id,words:r.words});}else if(m.type==='adapt'){var a=self.IL.crnn&&self.IL.crnn.ready()?self.IL.crnn.adapt(m.samples,m.opts):null;self.postMessage({id:m.id,result:a});}else if(m.type==='dense'){var ok=self.IL.crnn&&self.IL.crnn.ready()?self.IL.crnn.setDense(m.ow,m.ob):false;if(m.id)self.postMessage({id:m.id,result:ok});}}catch(err){self.postMessage({id:m.id,error:String(err)});}};" +
    "\n(function(){try{if(self.IL.crnn&&self.IL.crnnWeightsB64){var b=atob(self.IL.crnnWeightsB64),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);self.IL.crnn.load(u.buffer);self.IL.crnnWeightsB64=null;self.IL.crnn.initWasm().then(function(w){self.postMessage({id:'neural',ready:true,wasm:w,model:self.IL.crnn.modelId});},function(){self.postMessage({id:'neural',ready:true,wasm:false,model:self.IL.crnn.modelId});});}else{self.postMessage({id:'neural',ready:false});}}catch(err){self.postMessage({id:'neural',ready:false,error:String(err)});}})();";
  const FILES = [['lexicon-src', 'js/lexicon.js', false], ['hwr-src', 'js/hwr.js', true], ['crnn-src', 'js/crnn.js', false], ['crnn-wasm-src', 'js/crnn-wasm.js', false], ['crnn-weights-src', 'js/crnn-weights.js', false]];
  let neural = { ready: false, wasm: false, model: null };

  /* the recognizer sources: inline <script type="text/plain"> tags in the single-file build, files otherwise */
  async function sources() {
    const parts = await Promise.all(FILES.map(async ([id, path, required]) => {
      const tag = document.getElementById(id);
      if (tag && tag.textContent.length > 1000) return tag.textContent;
      try { const r = await fetch(path); if (!r.ok) throw new Error(path + ' not found'); return await r.text(); }
      catch (e) { if (required) throw e; console.warn('optional recognizer part missing:', path); return ''; }
    }));
    return parts.join('\n;\n');
  }
  /* loads the neural engine on the main thread (only needed when workers are unavailable) */
  async function mainThreadNeural() {
    if (IL.crnn && IL.crnn.ready()) return true;
    try {
      const src = await sources(); if (!IL.crnn) new Function(src.slice(src.indexOf('/* Inkleaf — neural')))();
      if (!IL.crnnWeightsB64) return false;
      const b = atob(IL.crnnWeightsB64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      IL.crnn.load(u.buffer); IL.crnnWeightsB64 = null; neural = { ready: true, wasm: await IL.crnn.initWasm(), model: IL.crnn.modelId }; if (dense && !denseFits()) dropDense(); if (dense) IL.crnn.setDense(dense.ow, dense.ob); return true;
    } catch (e) { console.warn('neural engine unavailable on the main thread', e); return false; }
  }
  function boot() {
    if (worker || failed) return Promise.resolve();
    if (booting) return booting;
    booting = (async () => {
      try {
        const src = await sources();
        const url = URL.createObjectURL(new Blob([src, GLUE], { type: 'text/javascript' }));
        const w = new Worker(url);
        const onNeural = d => { neural = { ready: !!d.ready, wasm: !!d.wasm, model: d.model || null }; if (d.error) console.warn('neural engine:', d.error); if (neural.ready && dense && !denseFits()) dropDense(); if (neural.ready && dense) w.postMessage({ type: 'dense', ow: dense.ow, ob: dense.ob }); IL.hwrClient.onNeural && IL.hwrClient.onNeural(neural); };
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('worker start timeout')), 6000);
          w.onerror = e => { clearTimeout(t); reject(e.error || new Error(e.message || 'worker failed')); };
          w.onmessage = ev => { if (ev.data && ev.data.id === 'neural') onNeural(ev.data); if (ev.data && ev.data.id === 'ping') { clearTimeout(t); resolve(); } };
          w.postMessage({ type: 'row', id: 'ping', strokes: [], rowTop: 0, L: 34 });
        });
        w.onmessage = ev => { if (ev.data && ev.data.id === 'neural') { onNeural(ev.data); return; } const p = pending.get(ev.data.id); if (!p) return; pending.delete(ev.data.id); ev.data.error ? p.reject(new Error(ev.data.error)) : p.resolve(ev.data.words !== undefined ? ev.data.words : ev.data.result); };
        w.onerror = () => { failed = true; worker = null; pending.forEach(p => p.reject(new Error('worker crashed'))); pending.clear(); };
        worker = w;
        worker.postMessage({ type: 'templates', list: templates }); worker.postMessage({ type: 'mode', mode });
        const learned = IL.hwr.learnedWords(); if (learned.length) worker.postMessage({ type: 'learn', text: learned.join(' ') });
      } catch (e) { console.warn('Recognizer worker unavailable, using main thread:', e && e.message); failed = true; worker = null; mainThreadNeural(); }
    })();
    return booting;
  }

  let mode = 'neural', dense = null;   // dense: the person's adapted output layer {ow, ob, model}, applied to the worker (or main-thread model) once it is up
  /* an adaptation belongs to the model it was learned on; after the recognizer is updated it is dropped and the app re-learns it from the saved words */
  const denseFits = () => !dense || !neural.model || dense.model === neural.model;   // a saved layer without a model name predates model names: learned on an older model
  const dropDense = () => { dense = null; try { IL.hwrClient.onModelChanged && IL.hwrClient.onModelChanged(neural.model); } catch (e) {} };
  function call(type, msg, fallback) {
    return boot().then(() => {
      if (!worker) return fallback();
      const id = ++seq;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage(Object.assign({ type, id }, msg)); });
    });
  }
  (async () => { try { const tag = document.getElementById('lexicon-src'); const src = tag && tag.textContent.length > 1000 ? tag.textContent : await (await fetch('js/lexicon.js')).text(); const m = src.match(/lexiconWords = "([^"]*)"/); if (m) IL.hwr.addLexicon(m[1]); } catch (e) {} })();
  IL.hwrClient = {
    boot,
    get inWorker() { return !!worker; },
    get neural() { return neural; },
    get mode() { return mode; },
    /* 'neural' (CRNN) or 'classic' (shape matcher with the taught letters) */
    setMode(m) { mode = m === 'classic' ? 'classic' : 'neural'; IL.hwr.setMode(mode); if (worker) worker.postMessage({ type: 'mode', mode }); },
    setUserTemplates(list) { templates = list || []; IL.hwr.setUserTemplates(templates); if (worker) worker.postMessage({ type: 'templates', list: templates }); },
    learnWords(text) { IL.hwr.learnWords(text); if (worker && text) worker.postMessage({ type: 'learn', text }); },
    /* fine-tunes the neural engine's output layer on [{strokes:[{pts}], text}]; resolves { n, before, after, ow, ob } */
    async adapt(samples, opts) {
      const r = await call('adapt', { samples, opts: opts || {} }, async () => (await mainThreadNeural()) && IL.crnn.adapt(samples, opts || {}));
      if (r && r.ow) { dense = { ow: r.ow, ob: r.ob, model: neural.model || null }; r.model = dense.model; }
      return r;
    },
    /* applies (or with null removes) saved adapted output weights */
    async setDense(ow, ob, model) {
      dense = ow && ob ? { ow, ob, model: model || null } : null;
      if (dense && neural.ready && !denseFits()) { dropDense(); return; }
      if (worker) worker.postMessage({ type: 'dense', ow: dense ? dense.ow : null, ob: dense ? dense.ob : null });
      else if (IL.crnn && IL.crnn.ready()) IL.crnn.setDense(dense ? dense.ow : null, dense ? dense.ob : null);
    },
    get adapted() { return !!dense; },
    get modelId() { return neural.model || null; },
    /* strokes: [{pts, at}] in page units. Resolves with [{text, idx, x0, x1, lastAt}]. */
    async recognizeRowWords(strokes, rowTop, L) {
      await boot();
      const payload = strokes.map(s => ({ pts: s.pts, at: s.at || 0 }));
      if (!worker) return IL.hwr.recognizeRowWords(payload, rowTop, L).words;
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'row', id, strokes: payload, rowTop, L });
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(IL.hwr.recognizeRowWords(payload, rowTop, L).words); } }, 5000);
      });
    }
  };
})();
