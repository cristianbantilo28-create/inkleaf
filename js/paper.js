/* Inkleaf — paper sounds for page turns, synthesized with the Web Audio API (no files to load, works offline).
   slide(speed): a friction hiss whose loudness and pitch follow the drag speed. flap(): the soft slap of a page landing. */
(function () {
  const IL = (window.IL = window.IL || {});
  let ctx = null, hiss = null, hissGain = null, hissFilter = null, noiseBuf = null, lastSlide = 0;
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
      hiss = ctx.createBufferSource(); hiss.buffer = noiseBuf; hiss.loop = true;
      hissFilter = ctx.createBiquadFilter(); hissFilter.type = 'bandpass'; hissFilter.frequency.value = 1400; hissFilter.Q.value = 0.8;
      hissGain = ctx.createGain(); hissGain.gain.value = 0;
      hiss.connect(hissFilter); hissFilter.connect(hissGain); hissGain.connect(ctx.destination); hiss.start();
      return true;
    } catch (e) { ctx = null; return false; }
  }
  /* speed: roughly 0 (still) … 1 (fast swipe) */
  function slide(speed) {
    if (!ctx || !hissGain) return;
    const v = Math.max(0, Math.min(1, speed)); const now = ctx.currentTime;
    hissGain.gain.setTargetAtTime(v * 0.085, now, v > lastSlide ? 0.02 : 0.06);
    hissFilter.frequency.setTargetAtTime(900 + 1700 * v, now, 0.05);
    lastSlide = v;
  }
  function flap() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, now); lp.frequency.exponentialRampToValueAtTime(400, now + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.11, now + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    src.connect(lp); lp.connect(g); g.connect(ctx.destination); src.start(now, Math.random() * 1.2, 0.2);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, now); o.frequency.exponentialRampToValueAtTime(70, now + 0.1);   // the soft thump of the page settling
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, now); og.gain.exponentialRampToValueAtTime(0.05, now + 0.008); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    o.connect(og); og.connect(ctx.destination); o.start(now); o.stop(now + 0.12);
  }
  IL.paperSound = { ensure, slide, flap, get ready() { return !!ctx; } };
})();
