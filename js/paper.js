/* Inkleaf — paper sounds for page turns, synthesized with the Web Audio API (no files to load, works offline).
   slide(speed): the soft whisper of paper sliding, following the drag speed. flap(): a page settling — a short, airy
   "fff" with the faintest body, never a slap. Everything runs through one quiet master with a gentle compressor. */
(function () {
  const IL = (window.IL = window.IL || {});
  let ctx = null, master = null, hiss = null, hissGain = null, hissFilter = null, grain = null, noiseBuf = null, lastSlide = 0, lastFlap = 0;
  const MASTER = 0.30;        // overall level: a quiet background cue, well below the app's other sounds
  function noise(ac, seconds) {
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate); const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; } // pink-ish noise
    return buf;
  }
  /* must be called from a user gesture the first time (browsers only start audio then) */
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    try {
      ctx = new AC(); noiseBuf = noise(ctx, 2);
      // master: tone shaping (no rumble, no harsh top) → soft compressor → volume
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170; hp.Q.value = 0.6;            // keep the low-mid warmth, lose rumble
      const dip = ctx.createBiquadFilter(); dip.type = 'peaking'; dip.frequency.value = 1500; dip.Q.value = 0.9; dip.gain.value = -4;   // no boxy mid resonance
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5500; lp.Q.value = 0.6;             // nothing sharp above 5.5 kHz
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -34; comp.knee.value = 20; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.14;
      master = ctx.createGain(); master.gain.value = MASTER;
      hp.connect(dip); dip.connect(lp); lp.connect(comp); comp.connect(master); master.connect(ctx.destination);
      master.input = hp;
      // the sliding whisper: pink noise → band-pass that opens with speed → fibre "grain" (slow random wobble) → gain
      hiss = ctx.createBufferSource(); hiss.buffer = noiseBuf; hiss.loop = true;
      hissFilter = ctx.createBiquadFilter(); hissFilter.type = 'bandpass'; hissFilter.frequency.value = 1300; hissFilter.Q.value = 0.5;
      grain = ctx.createGain(); grain.gain.value = 1;
      const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 9; const lfoG = ctx.createGain(); lfoG.gain.value = 0.18; lfo.connect(lfoG); lfoG.connect(grain.gain); lfo.start();
      hissGain = ctx.createGain(); hissGain.gain.value = 0;
      hiss.connect(hissFilter); hissFilter.connect(grain); grain.connect(hissGain); hissGain.connect(master.input); hiss.start();
      return true;
    } catch (e) { ctx = null; return false; }
  }
  let pitch = 1;   // ±4% per turn so consecutive turns never sound identical
  /* speed: roughly 0 (still) … 1 (fast swipe). Slow drags are nearly silent, a medium turn is a soft sweep, and a
     fast fling is not louder — just shorter. */
  function slide(speed) {
    if (!ctx || !hissGain) return;
    const v = Math.max(0, Math.min(1, speed)); const now = ctx.currentTime;
    const shaped = Math.pow(Math.min(1, v / 0.6), 1.5) * (1 - 0.3 * Math.max(0, v - 0.6) / 0.4);
    hissGain.gain.setTargetAtTime(shaped * 0.03, now, v > lastSlide ? 0.035 : 0.1);
    hissFilter.frequency.setTargetAtTime((900 + 1400 * v) * pitch, now, 0.07);
    lastSlide = v;
  }
  /* the edge being lifted: a short, very soft rustle at the start of a turn (and a fresh pitch for this turn) */
  function lift() {
    if (!ctx) return;
    pitch = 0.96 + Math.random() * 0.08; const now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = pitch;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7; bp.frequency.value = 700 * pitch;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.02, now + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(bp); bp.connect(g); g.connect(master.input); src.start(now, Math.random() * 1.4, 0.2);
  }
  /* the page comes to rest: the whisper fades out and a short, soft "fff" with a faint body plays */
  function flap() {
    if (!ctx) return;
    const now = ctx.currentTime; if (now - lastFlap < 0.08) return; lastFlap = now;
    hissGain.gain.setTargetAtTime(0, now, 0.05); lastSlide = 0;
    const vary = pitch * (0.97 + Math.random() * 0.06);
    // airy brush of the sheet meeting the page — one of many slightly different takes
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = vary;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.45; bp.frequency.setValueAtTime(2200 * vary, now); bp.frequency.exponentialRampToValueAtTime(500, now + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.045, now + 0.022); g.gain.exponentialRampToValueAtTime(0.012, now + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    src.connect(bp); bp.connect(g); g.connect(master.input); src.start(now, Math.random() * 1.2, 0.3);
    // the faintest low body — the paper settling, felt more than heard
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, now); o.frequency.exponentialRampToValueAtTime(65, now + 0.09);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, now); og.gain.exponentialRampToValueAtTime(0.02, now + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    o.connect(og); og.connect(master); o.start(now); o.stop(now + 0.11);   // straight to the master (below the high-pass on purpose)
  }
  /* short foley for the closures: clink = key meeting the lock (bright, tiny), click = the tumblers turning (heavier
     mechanical), snap = a magnet letting go (dull, soft), thud = the cover settling (low, felt more than heard) */
  const FOLEY = {
    clink: { f: 4600, q: 8, nz: 0.09, nt: 0.035, tone: 2400, tone2: 1800, tg: 0.03, tt: 0.05 },
    click: { f: 1900, q: 4, nz: 0.14, nt: 0.06, tone: 640, tone2: 380, tg: 0.065, tt: 0.09 },
    snap:  { f: 1400, q: 2.5, nz: 0.07, nt: 0.07, tone: 240, tone2: 120, tg: 0.045, tt: 0.08 },
    thud:  { f: 320, q: 0.9, nz: 0.06, nt: 0.12, tone: 95, tone2: 55, tg: 0.05, tt: 0.14 }
  };
  function tick(kind) {
    if (!ctx) return;
    const now = ctx.currentTime; const p = FOLEY[kind] || FOLEY.click;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = kind === 'thud' ? 'lowpass' : 'bandpass'; bp.frequency.value = p.f; bp.Q.value = p.q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(p.nz, now + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, now + p.nt);
    src.connect(bp); bp.connect(g); g.connect(kind === 'thud' ? master : master.input); src.start(now, Math.random() * 1.5, 0.2);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(p.tone, now); o.frequency.exponentialRampToValueAtTime(p.tone2, now + p.tt * 0.7);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, now); og.gain.exponentialRampToValueAtTime(p.tg, now + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, now + p.tt);
    o.connect(og); og.connect(master); o.start(now); o.stop(now + p.tt + 0.01);
    if (kind === 'click') {   // a second, softer tumbler a moment later
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(900, now + 0.045); o2.frequency.exponentialRampToValueAtTime(500, now + 0.1);
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, now + 0.045); g2.gain.exponentialRampToValueAtTime(0.02, now + 0.05); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      o2.connect(g2); g2.connect(master); o2.start(now + 0.045); o2.stop(now + 0.12);
    }
  }
  IL.paperSound = { ensure, lift, slide, flap, click: () => tick('click'), clink: () => tick('clink'), snap: () => tick('snap'), thud: () => tick('thud'), get ready() { return !!ctx; }, get context() { return ctx; } };
})();
