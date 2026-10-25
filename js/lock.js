/* Inkleaf — app lock: a PIN (hashed with PBKDF2) plus Face ID / Touch ID / fingerprint through WebAuthn platform authenticators.
   This gate keeps casual eyes off the notebooks on a shared device; notes themselves are stored unencrypted in the browser's database. */
(function () {
  const IL = (window.IL = window.IL || {});
  const te = new TextEncoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  async function hashPin(pin, saltHex) {
    const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120000 }, key, 256);
    return hex(bits);
  }
  function derToRaw(sig) {
    // ECDSA DER SEQUENCE { INTEGER r, INTEGER s } -> r||s (32 bytes each)
    let i = 2; if (sig[1] & 0x80) i += (sig[1] & 0x7f);
    const read = () => { if (sig[i++] !== 0x02) throw new Error('bad der'); let len = sig[i++]; let v = sig.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
    const r = read(), s = read(); const out = new Uint8Array(64); out.set(r, 0); out.set(s, 32); return out;
  }
  const bioAvailable = async () => {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
  };
  async function enrollBio() {
    const challenge = crypto.getRandomValues(new Uint8Array(32)), userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Inkleaf' }, user: { id: userId, name: 'inkleaf-owner', displayName: 'Inkleaf owner' }, challenge,
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, attestation: 'none'
    } });
    const r = cred.response; let spki = null, alg = null;
    try { if (r.getPublicKey) { const k = r.getPublicKey(); if (k) { spki = b64(k); alg = r.getPublicKeyAlgorithm(); } } } catch (e) {}
    return { id: b64(cred.rawId), spki, alg };
  }
  async function verifyBio(bio) {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ id: unb64(bio.id), type: 'public-key', transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
    const r = assertion.response; const authData = new Uint8Array(r.authenticatorData);
    if (!(authData[32] & 0x04)) throw new Error('The device did not verify you.');
    const client = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
    if (client.challenge !== b64(challenge)) throw new Error('Challenge mismatch.');
    if (bio.spki && (bio.alg === -7 || bio.alg === -257)) {
      const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', r.clientDataJSON));
      const signed = new Uint8Array(authData.length + clientHash.length); signed.set(authData); signed.set(clientHash, authData.length);
      let key, algo, sig = new Uint8Array(r.signature);
      if (bio.alg === -7) { key = await crypto.subtle.importKey('spki', unb64(bio.spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); algo = { name: 'ECDSA', hash: 'SHA-256' }; sig = derToRaw(sig); }
      else { key = await crypto.subtle.importKey('spki', unb64(bio.spki), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']); algo = { name: 'RSASSA-PKCS1-v1_5' }; }
      if (!await crypto.subtle.verify(algo, key, sig, signed)) throw new Error('Signature check failed.');
    }
    return true;
  }

  const Lock = {
    state: null,
    async load() { this.state = await IL.db.kvGet('lock', null); return this.state; },
    async save() { await IL.db.kvSet('lock', this.state); },
    get enabled() { return !!(this.state && this.state.enabled); },
    async setPin(pin) {
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      this.state = Object.assign({ enabled: true, bio: null, autoLock: '1' }, this.state || {}, { enabled: true, salt, pinHash: await hashPin(pin, salt), pinLen: pin.length });
      await this.save();
    },
    async verifyPin(pin) { if (!this.state) return false; return (await hashPin(pin, this.state.salt)) === this.state.pinHash; },
    bioAvailable, enrollBio, verifyBio,
    async disable() { this.state = { enabled: false, bio: null, autoLock: '1' }; await this.save(); }
  };

  const BIO_LABEL = () => /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'Face ID / Touch ID' : /Android/.test(navigator.userAgent) ? 'fingerprint / face unlock' : 'Windows Hello / fingerprint';

  class LockScreen {
    constructor(app) {
      this.app = app; this.view = document.getElementById('view-lock');
      this.title = document.getElementById('lock-title'); this.text = document.getElementById('lock-text');
      this.bioBtn = document.getElementById('bio-btn'); this.pinArea = document.getElementById('pin-area'); this.dots = document.getElementById('pin-dots'); this.pad = document.getElementById('pin-pad');
      this.err = document.getElementById('lock-error'); this.setup = document.getElementById('lock-setup'); this.bioSetup = document.getElementById('lock-bio-setup'); this.forgot = document.getElementById('lock-forgot');
      this.entry = ''; this.mode = null; this.resolve = null;
      this.buildPad();
      this.bioBtn.addEventListener('click', () => this.tryBio());
      document.getElementById('lock-setup-start').addEventListener('click', () => this.show('new-pin'));
      document.getElementById('lock-setup-skip').addEventListener('click', () => this.finish(false));
      document.getElementById('lock-bio-add').addEventListener('click', () => this.addBio());
      document.getElementById('lock-bio-skip').addEventListener('click', () => this.finish(true));
      this.forgot.addEventListener('click', () => this.app.confirm('Forgot your PIN?', 'The only way past a forgotten PIN is to erase everything in Inkleaf on this device: notebooks, covers, photos and videos. A backup file can be imported afterwards.', 'Erase everything', async () => { await this.app.eraseAll(); location.reload(); }));
      document.addEventListener('keydown', e => { if (this.view.hidden || !this.pinArea || this.pinArea.hidden) return; if (/^[0-9]$/.test(e.key)) this.press(e.key); else if (e.key === 'Backspace') this.press('back'); else if (e.key === 'Enter') this.press('ok'); });
    }
    buildPad() {
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
      this.pad.innerHTML = '';
      keys.forEach(k => { const b = document.createElement('button'); b.type = 'button'; b.dataset.k = k; if (k === 'back') { b.className = 'ghost'; b.innerHTML = '<svg><use href="#i-backspace"/></svg>'; b.setAttribute('aria-label', 'Delete'); } else if (k === 'ok') { b.className = 'ok'; b.innerHTML = '<svg><use href="#i-check"/></svg>'; b.setAttribute('aria-label', 'Confirm'); } else b.textContent = k; b.addEventListener('click', () => this.press(k)); this.pad.appendChild(b); });
    }
    renderDots() { const n = Math.max(4, this.entry.length, this.mode === 'unlock' && Lock.state && Lock.state.pinLen ? Lock.state.pinLen : 4); this.dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < this.entry.length ? 'on' : ''}"></i>`).join(''); this.pad.querySelector('[data-k="ok"]').disabled = this.entry.length < 4; }
    shake(msg) { this.err.textContent = msg || ''; this.dots.classList.remove('shake'); void this.dots.offsetWidth; this.dots.classList.add('shake'); this.entry = ''; this.renderDots(); }
    /* mode: 'first-run' | 'new-pin' | 'confirm-pin' | 'bio-offer' | 'unlock' | 'verify' */
    show(mode, opts) {
      opts = opts || {}; this.mode = mode; this.entry = ''; this.err.textContent = ''; if (opts.resolve) this.resolve = opts.resolve;
      this.setup.hidden = mode !== 'first-run'; this.bioSetup.hidden = mode !== 'bio-offer'; this.forgot.hidden = mode !== 'unlock';
      this.pinArea.hidden = !(mode === 'new-pin' || mode === 'confirm-pin' || mode === 'unlock' || mode === 'verify');
      this.bioBtn.hidden = !(mode === 'unlock' && Lock.state && Lock.state.bio);
      const copy = {
        'first-run': ['Keep your notebooks private', `Set a PIN now and unlock with ${BIO_LABEL()} every time you open Inkleaf. You can also turn this on later in Settings.`],
        'new-pin': ['Choose a PIN', 'Four to eight digits. You will need it if the device cannot read your face or fingerprint.'],
        'confirm-pin': ['Enter the PIN again', 'Just to make sure it matches.'],
        'bio-offer': [`Add ${BIO_LABEL()}?`, 'Unlock faster next time. The PIN stays as a backup.'],
        'unlock': ['Locked', Lock.state && Lock.state.bio ? `Use ${BIO_LABEL()} or enter your PIN.` : 'Enter your PIN to open your notebooks.'],
        'verify': [opts.title || 'Enter your current PIN', opts.text || 'Confirm it is you before changing the lock.']
      }[mode];
      this.title.textContent = copy[0]; this.text.textContent = copy[1];
      this.renderDots(); this.app.showView('lock');
      if (mode === 'unlock' && Lock.state.bio && !opts.noAutoBio) setTimeout(() => this.tryBio(true), 350);
    }
    async press(k) {
      if (k === 'back') { this.entry = this.entry.slice(0, -1); this.renderDots(); return; }
      if (k === 'ok') { await this.submit(); return; }
      if (this.entry.length >= 8) return;
      this.entry += k; this.renderDots(); this.err.textContent = '';
      if (this.mode === 'unlock' && Lock.state.pinLen && this.entry.length === Lock.state.pinLen) await this.submit();
      else if (this.mode === 'verify' && Lock.state.pinLen && this.entry.length === Lock.state.pinLen) await this.submit();
      else if (this.mode === 'confirm-pin' && this.entry.length === this.pending.length) await this.submit();
    }
    async submit() {
      const pin = this.entry; if (pin.length < 4) { this.shake('Use at least four digits.'); return; }
      if (this.mode === 'new-pin') { this.pending = pin; this.show('confirm-pin'); return; }
      if (this.mode === 'confirm-pin') {
        if (pin !== this.pending) { this.shake('The PINs do not match. Start again.'); this.show('new-pin'); return; }
        await Lock.setPin(pin); this.pending = null;
        if (!Lock.state.bio && await bioAvailable()) this.show('bio-offer'); else this.finish(true);
        return;
      }
      if (this.mode === 'unlock' || this.mode === 'verify') {
        this.pad.querySelectorAll('button').forEach(b => b.disabled = true);
        const ok = await Lock.verifyPin(pin);
        this.pad.querySelectorAll('button').forEach(b => b.disabled = false);
        if (ok) this.finish(true); else this.shake('Wrong PIN. Try again.');
      }
    }
    async tryBio(auto) {
      if (!Lock.state || !Lock.state.bio) return;
      this.err.textContent = ''; this.bioBtn.disabled = true;
      try { await verifyBio(Lock.state.bio); this.finish(true); }
      catch (e) { if (!auto) this.err.textContent = friendlyBioError(e); else if (e && e.name === 'SecurityError') this.err.textContent = friendlyBioError(e); }
      finally { this.bioBtn.disabled = false; }
    }
    async addBio() {
      const btn = document.getElementById('lock-bio-add'); btn.disabled = true; this.err.textContent = '';
      try { Lock.state.bio = await enrollBio(); await Lock.save(); this.app.toast(`${BIO_LABEL()} added.`); this.finish(true); }
      catch (e) { this.err.textContent = friendlyBioError(e); }
      finally { btn.disabled = false; }
    }
    finish(ok) { const r = this.resolve; this.resolve = null; this.pending = null; this.entry = ''; r && r(ok); }
    /* Promise helpers used by the app */
    unlock() { return new Promise(resolve => this.show('unlock', { resolve })); }
    firstRun() { return new Promise(resolve => this.show('first-run', { resolve })); }
    setupPin() { return new Promise(resolve => this.show('new-pin', { resolve })); }
    verify(title, text) { return new Promise(resolve => this.show('verify', { resolve, title, text })); }
  }
  function friendlyBioError(e) {
    const n = e && e.name; const msg = (e && e.message) || '';
    if (/permission|policy|feature|origin|frame|ancestor/i.test(msg)) return `${BIO_LABEL()} cannot run inside this preview window. It works once Inkleaf is opened or installed from its own web address. Use the PIN here.`;
    if (n === 'NotAllowedError') return 'Not verified. You can try again or use your PIN.';
    if (n === 'SecurityError' || n === 'NotSupportedError') return `${BIO_LABEL()} is not available here. It works once the app is installed from its own web address (https). Use the PIN for now.`;
    if (n === 'InvalidStateError') return 'This device already has a key for Inkleaf. Try unlocking instead.';
    return (e && e.message) ? e.message : 'Something went wrong. Use your PIN.';
  }

  IL.Lock = Lock; IL.LockScreen = LockScreen; IL.bioLabel = BIO_LABEL; IL.bioError = friendlyBioError;
})();
