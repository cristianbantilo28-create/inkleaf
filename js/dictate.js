/* Inkleaf — dictation: the browser's speech recognition types spoken words where the keyboard would, without the
   keyboard. Safari and Chrome send the audio to Apple's / Google's speech service, so it needs a connection. */
(function () {
  const IL = (window.IL = window.IL || {});
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const LANGS = [['auto', 'Device language'], ['en-US', 'English'], ['de-DE', 'Deutsch'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['it-IT', 'Italiano'], ['pt-PT', 'Português'], ['nl-NL', 'Nederlands'], ['tl-PH', 'Filipino']];
  /* spoken punctuation and commands, by language */
  const SPOKEN = {
    en: { 'comma': ',', 'period': '.', 'full stop': '.', 'question mark': '?', 'exclamation mark': '!', 'exclamation point': '!', 'colon': ':', 'semicolon': ';', 'dash': '-', 'hyphen': '-', 'new line': '\n', 'newline': '\n', 'next line': '\n', 'new paragraph': '\n' },
    de: { 'komma': ',', 'punkt': '.', 'fragezeichen': '?', 'ausrufezeichen': '!', 'doppelpunkt': ':', 'semikolon': ';', 'strichpunkt': ';', 'bindestrich': '-', 'neue zeile': '\n', 'zeilenumbruch': '\n', 'neuer absatz': '\n' },
    es: { 'coma': ',', 'punto': '.', 'punto final': '.', 'signo de interrogación': '?', 'interrogación': '?', 'signo de exclamación': '!', 'exclamación': '!', 'dos puntos': ':', 'punto y coma': ';', 'guion': '-', 'guión': '-', 'nueva línea': '\n', 'salto de línea': '\n', 'nuevo párrafo': '\n' },
    fr: { 'virgule': ',', 'point': '.', 'point d\'interrogation': '?', 'point d\'exclamation': '!', 'deux points': ':', 'point-virgule': ';', 'nouvelle ligne': '\n', 'à la ligne': '\n' },
    it: { 'virgola': ',', 'punto': '.', 'punto interrogativo': '?', 'punto esclamativo': '!', 'due punti': ':', 'punto e virgola': ';', 'a capo': '\n', 'nuova riga': '\n' },
    pt: { 'vírgula': ',', 'ponto': '.', 'ponto final': '.', 'ponto de interrogação': '?', 'ponto de exclamação': '!', 'dois pontos': ':', 'ponto e vírgula': ';', 'nova linha': '\n', 'novo parágrafo': '\n' },
    nl: { 'komma': ',', 'punt': '.', 'vraagteken': '?', 'uitroepteken': '!', 'dubbele punt': ':', 'puntkomma': ';', 'nieuwe regel': '\n', 'nieuwe alinea': '\n' },
    tl: { 'kuwit': ',', 'tuldok': '.', 'tandang pananong': '?', 'tandang padamdam': '!', 'bagong linya': '\n' }
  };
  const MESSAGES = {
    'not-allowed': 'Microphone access was refused. Allow the microphone for Inkleaf in the browser settings, then try again.',
    'service-not-allowed': 'Dictation is not available here. Open Inkleaf in Safari (same address) to dictate, or use the microphone key on the keyboard.',
    'network': 'Dictation needs an internet connection — the speech is understood by Apple’s or Google’s service.',
    'audio-capture': 'No microphone was found.',
    'language-not-supported': 'That language is not available for dictation on this device. Pick another one under Settings → Dictation.',
    'unsupported': 'Dictation is not available in this browser. On an iPad or iPhone use Safari; on Android use Chrome. The microphone key on the keyboard always works.'
  };
  let rec = null, wanted = false, listening = false, restarts = 0, silent = 0, lang = 'auto';
  let handlers = {};
  const emit = (name, ...a) => { try { handlers[name] && handlers[name](...a); } catch (e) { console.warn('dictation handler', e); } };

  function language() {
    if (lang && lang !== 'auto') return lang;
    const l = navigator.language || 'en-US'; return /^[a-z]{2,3}(-[A-Za-z0-9]{2,})?$/.test(l) ? l : 'en-US';
  }
  /* "hello comma how are you question mark" → "hello, how are you?"; "new line" becomes a line break */
  function clean(text, lng) {
    let t = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
    const table = SPOKEN[String(lng || 'en').slice(0, 2).toLowerCase()] || SPOKEN.en;
    for (const k of Object.keys(table).sort((a, b) => b.length - a.length)) {
      const re = new RegExp(' ' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ', 'gi');
      t = t.replace(re, table[k] === '\n' ? ' \n ' : table[k] + ' ');
    }
    return t.replace(/ ([,.;:!?])/g, '$1').replace(/ *\n */g, '\n').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
  }
  /* a sentence start gets a capital: at the beginning of a line or after . ! ? */
  function capitalise(text, before) {
    if (!text || !/^[a-zà-ÿ]/.test(text)) return text;
    const b = (before || '').replace(/\s+$/, '');
    return !b || /[.!?]$/.test(b) ? text[0].toUpperCase() + text.slice(1) : text;
  }
  function setState(s) { listening = s === 'listening'; emit('onState', s); }
  function problem(code) { emit('onProblem', MESSAGES[code] || ('Dictation stopped: ' + code)); }

  function build() {
    const r = new SR(); r.continuous = true; r.interimResults = true; r.maxAlternatives = 1; r.lang = language();
    r.onstart = () => setState('listening');
    r.onresult = ev => {
      let interim = ''; const finals = [];
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const res = ev.results[i]; const t = (res[0] && res[0].transcript) || ''; if (res.isFinal) finals.push(t); else interim += t; }
      if (finals.length) {
        silent = 0;
        const parts = clean(finals.join(' '), r.lang).split('\n');
        parts.forEach((part, i) => { const p = part.trim(); if (p) emit('onText', p); if (i < parts.length - 1) emit('onEnter'); });
      }
      emit('onInterim', interim.trim());
    };
    r.onerror = ev => {
      const code = (ev && ev.error) || 'unknown';
      if (code === 'no-speech') { silent++; return; }        // the session ends after it; onend decides whether to carry on
      if (code === 'aborted') return;
      wanted = false; problem(code);
    };
    r.onend = () => {
      emit('onInterim', '');
      if (wanted && silent < 2 && restarts < 60) { restarts++; try { r.lang = language(); r.start(); return; } catch (e) {} }   // browsers end a session after a while: carry on until stopped
      if (wanted && silent >= 2) emit('onProblem', 'Stopped listening — nothing was said for a while.');
      wanted = false; setState('idle');
    };
    return r;
  }
  function start() {
    if (!SR) { problem('unsupported'); return false; }
    if (listening || wanted) return true;
    try { rec = build(); wanted = true; restarts = 0; silent = 0; rec.start(); return true; }
    catch (e) { wanted = false; rec = null; problem(e && e.name === 'NotAllowedError' ? 'not-allowed' : 'unsupported'); return false; }
  }
  function stop() { const was = wanted || listening; wanted = false; if (rec) { try { rec.stop(); } catch (e) {} } if (!was || !listening) setState('idle'); }

  IL.dictation = {
    LANGS, clean, capitalise, language,
    get supported() { return !!SR; },
    get listening() { return listening || wanted; },
    get lang() { return lang; }, set lang(v) { lang = v || 'auto'; },
    start, stop, toggle() { return (listening || wanted) ? (stop(), false) : start(); },
    /* handlers: onState('listening'|'idle'), onInterim(text), onText(finalText), onEnter(), onProblem(message) */
    bind(h) { handlers = h || {}; }
  };
})();
