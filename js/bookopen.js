/* Inkleaf — opening a notebook: the book lifts off the shelf, its closure comes undone (a magnetic strap flips away,
   or a key appears, turns in the lock and the hasp swings open), the cover swings open in 3D and the open page zooms
   toward the reader until it is exactly where the real page sits. Closing plays the same in reverse. */
(function () {
  const IL = (window.IL = window.IL || {});
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const done = a => a.finished.catch(() => {});
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const sound = name => { try { const s = IL.paperSound; if (s && IL.app && IL.app.settings.pageSound !== false && s.ensure()) s[name](); } catch (e) {} };

  /* Builds the overlay: a backdrop plus a "book" sized like the page, with a page face and a cover hinged on its left edge. */
  function build(nb, pageW, pageH, paint) {
    const ov = document.createElement('div'); ov.className = 'bookopen'; ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = `<div class="bo-backdrop"></div><div class="bo-scene"><div class="bo-book"><div class="bo-pages"><div class="bo-edge"></div><canvas class="bo-page"></canvas></div><div class="bo-cover"><div class="bo-cover-front"></div><div class="bo-cover-in"></div></div></div></div><div class="bo-fx"></div>`;
    const book = ov.querySelector('.bo-book'); book.style.width = pageW + 'px'; book.style.height = pageH + 'px';
    const front = ov.querySelector('.bo-cover-front'); const face = document.createElement('div'); IL.cover.render(face, nb.cover || IL.cover.defaultCover(nb.title)); front.appendChild(face);
    const inside = ov.querySelector('.bo-cover-in'); const rgb = IL.cover.tintOf(nb.cover); inside.style.background = `linear-gradient(90deg, rgba(${rgb.join(',')},.5), rgba(${rgb.join(',')},.3) 60%, rgba(${rgb.join(',')},.38))`;
    try { paint && paint(ov.querySelector('.bo-page'), Math.min(900, pageW)); } catch (e) {}
    document.body.appendChild(ov);
    return { ov, book, face, cover: ov.querySelector('.bo-cover'), backdrop: ov.querySelector('.bo-backdrop'), pages: ov.querySelector('.bo-pages'), fx: ov.querySelector('.bo-fx') };
  }
  const tf = (x, y, k) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
  /* a lifted, centred pose for a page of pageW x pageH (a little right of centre so the opened cover has room) */
  function lifted(pageW, pageH, frac) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const h1 = Math.min(vh * frac, pageH, vw * 0.9 * pageH / pageW), k1 = h1 / pageH, w1 = pageW * k1;
    return { x: vw / 2 - w1 / 2 + Math.min(w1 * 0.22, Math.max(0, (vw - w1) / 2 - 8)), y: vh / 2 - h1 / 2, k: k1 };
  }

  const KEY_SVG = `<svg viewBox="0 0 100 40" aria-hidden="true"><defs><linearGradient id="kg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0B8"/><stop offset=".45" stop-color="#E9BE55"/><stop offset="1" stop-color="#A9771B"/></linearGradient></defs>
    <g fill="url(#kg)" stroke="#6E4E0E" stroke-width="1.2" stroke-linejoin="round">
      <rect x="18" y="16" width="52" height="8" rx="2"/><rect x="21" y="22" width="6" height="11" rx="1.5"/><rect x="31" y="22" width="6" height="8" rx="1.5"/>
      <path d="M82 6a14 14 0 1 1-0.01 0z M82 13a7 7 0 1 0 0.01 0z" fill-rule="evenodd"/>
    </g><path d="M22 18h44" stroke="#FFF6D6" stroke-width="1.4" stroke-linecap="round" opacity=".8"/></svg>`;

  const SHADOW = 'drop-shadow(0 6px 10px rgba(20,24,40,.45))';
  /* the magnetic strap lets go and flips away toward the back cover: the stud pops, then the tab swings up and over */
  async function unstrap(face) {
    const strap = face.querySelector('.cover-clasp .strap'); if (!strap) return;
    const stud = strap.querySelector('.stud');
    sound('snap');
    if (stud) stud.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: .4 }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    await done(strap.animate([{ transform: 'rotateY(0deg)', easing: 'cubic-bezier(.5,0,.8,.4)' }, { transform: 'rotateY(18deg)', offset: .3, easing: 'cubic-bezier(.2,.6,.3,1)' }, { transform: 'rotateY(100deg)' }], { duration: 300, fill: 'forwards' }));
  }
  /* the key arrives on an arc, slides in with a tiny contact bump, turns the tumblers (the tongue slides clear and a
     gleam runs over the plate), and the hasp springs open — the rest of the cover softly falls out of focus meanwhile */
  async function unlock(face, fx, front) {
    const plate = face.querySelector('.cover-clasp .lockplate'), hole = face.querySelector('.cover-clasp .keyhole'), hasp = face.querySelector('.cover-clasp .hasp'), tongue = face.querySelector('.cover-clasp .tongue');
    if (!plate || !hole || !hasp) return;
    const hr = hole.getBoundingClientRect(), pr = plate.getBoundingClientRect(), fr = fx.getBoundingClientRect(), cr = front.getBoundingClientRect();
    const W = pr.width * 2.2, H = W * 0.4; const cx = hr.left + hr.width / 2 - fr.left, cy = hr.top + hr.height * 0.45 - fr.top;
    // focus pull: a soft vignette on the cover, clear around the lock
    const focus = document.createElement('div'); focus.className = 'bo-focus'; focus.style.setProperty('--fx', ((hr.left + hr.width / 2 - cr.left) / cr.width * 100).toFixed(1) + '%'); focus.style.setProperty('--fy', ((hr.top + hr.height / 2 - cr.top) / cr.height * 100).toFixed(1) + '%'); front.appendChild(focus);
    focus.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards', easing: 'ease-out' });
    const key = document.createElement('div'); key.className = 'bo-key'; key.innerHTML = KEY_SVG;
    key.style.width = W + 'px'; key.style.height = H + 'px'; key.style.left = (cx - W * 0.2) + 'px'; key.style.top = (cy - H / 2) + 'px'; fx.appendChild(key);
    // 1. entrance along an arc from the lower right, with a touch of motion blur that clears as it slows
    await done(key.animate([
      { transform: 'translate(78%, 95%) rotate(-42deg) scale(.6)', opacity: 0, filter: 'blur(2.5px) ' + SHADOW, offset: 0, easing: 'cubic-bezier(.3,.6,.4,1)' },
      { transform: 'translate(46%, 44%) rotate(-26deg) scale(.86)', opacity: 1, filter: 'blur(1.2px) ' + SHADOW, offset: .42, easing: 'cubic-bezier(.3,.5,.3,1)' },
      { transform: 'translate(14%, 8%) rotate(-8deg) scale(1)', opacity: 1, filter: 'blur(0px) ' + SHADOW, offset: .8, easing: 'ease-out' },
      { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1, filter: 'blur(0px) ' + SHADOW, offset: 1 }
    ], { duration: 240, fill: 'forwards' }));
    // 2. insertion: forward along the key's own axis, then a one-frame contact bump against the back stop
    sound('clink');
    await done(key.animate([{ transform: 'translate(0,0) scale(1)', easing: 'ease-in' }, { transform: 'translate(-3.2%, 0) scale(.97)' }], { duration: 70, fill: 'forwards' }));
    await done(key.animate([{ transform: 'translate(-3.2%, 0) scale(.97)' }, { transform: 'translate(-2.4%, 0) scale(.975)', offset: .35 }, { transform: 'translate(-3.3%, 0) scale(.968)', offset: .7 }, { transform: 'translate(-3%, 0) scale(.97)' }], { duration: 70, fill: 'forwards' }));
    // 3. the turn: tumblers resist, then give; the tongue slides clear and a gleam runs across the plate
    const gleam = document.createElement('div'); gleam.className = 'gleam'; plate.appendChild(gleam);
    gleam.animate([{ transform: 'translateX(-130%)' }, { transform: 'translateX(130%)' }], { duration: 380, delay: 40, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    if (tongue) tongue.animate([{ transform: 'translateX(0)', easing: 'cubic-bezier(.6,0,.4,1)' }, { transform: 'translateX(0)', offset: .35 }, { transform: 'translateX(115%)' }], { duration: 200, fill: 'forwards' });
    const turn = key.animate([{ transform: 'translate(-3%, 0) scale(.97) rotate(0deg)', easing: 'cubic-bezier(.6,0,.2,1)' }, { transform: 'translate(-3%, 0) scale(.97) rotate(96deg)', offset: .78, easing: 'cubic-bezier(.3,0,.4,1)' }, { transform: 'translate(-3%, 0) scale(.97) rotate(90deg)' }], { duration: 200, fill: 'forwards' });
    setTimeout(() => sound('click'), 130);
    await done(turn);
    // 4. the hasp springs open (a quick kick, then the swing) while the key withdraws and the focus returns
    key.animate([{ transform: 'translate(-3%, 0) scale(.97) rotate(90deg)', opacity: 1 }, { transform: 'translate(18%, 30%) scale(.9) rotate(90deg)', opacity: 0 }], { duration: 190, delay: 40, easing: 'ease-in', fill: 'forwards' });
    focus.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 60, fill: 'forwards', easing: 'ease-in' });
    await done(hasp.animate([{ transform: 'rotateY(0deg)', easing: 'cubic-bezier(.1,.9,.3,1.3)' }, { transform: 'rotateY(34deg)', offset: .32, easing: 'cubic-bezier(.3,0,.3,1)' }, { transform: 'rotateY(100deg)' }], { duration: 230, fill: 'forwards' }));
  }

  /* fromRect: the cover card. toRect: the real page (laid out but still covered). paint(canvas, cssW) draws the page face.
     onCovered() is called once the backdrop hides everything, which is the moment to swap the views underneath. */
  async function open({ fromRect, toRect, nb, paint, onCovered }) {
    if (reduce() || !fromRect || !toRect) { onCovered && onCovered(); return; }
    const pageW = toRect.width, pageH = toRect.height;
    const { ov, book, face, cover, backdrop, pages, fx } = build(nb, pageW, pageH, paint); const front = ov.querySelector('.bo-cover-front');
    const k0 = fromRect.height / pageH, x0 = fromRect.left, y0 = fromRect.top;
    const L1 = lifted(pageW, pageH, 0.56);
    const clasp = nb.cover && nb.cover.clasp;
    // 1. the book lifts off the shelf
    const TA = 330;
    const lift = book.animate([{ transform: tf(x0, y0, k0), easing: 'cubic-bezier(.22,.8,.26,1)' }, { transform: tf(L1.x, L1.y, L1.k) }], { duration: TA, fill: 'forwards' });
    pages.animate([{ boxShadow: '0 2px 6px rgba(20,24,40,.25)' }, { boxShadow: '0 34px 70px rgba(20,24,40,.38)' }], { duration: TA, fill: 'forwards' });
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TA * 0.9, fill: 'forwards' });
    await done(lift);
    onCovered && onCovered();
    // 2. the closure comes undone
    if (clasp === 'lock') await unlock(face, fx, front); else if (clasp === 'magnet') await unstrap(face); else await wait(40);
    // 3. the cover swings open — heavy board: it overshoots a little and settles — and, as it nears flat, the page zooms into place
    const TC = 460, TD = 390, overlap = 150;
    cover.animate([{ transform: 'rotateY(0deg)', easing: 'cubic-bezier(.45,.05,.3,1)' }, { transform: 'rotateY(-171deg)', offset: .74, easing: 'cubic-bezier(.3,0,.5,1)' }, { transform: 'rotateY(-183deg)', offset: .88, easing: 'cubic-bezier(.4,0,.5,1)' }, { transform: 'rotateY(-179deg)', offset: .96, easing: 'ease-out' }, { transform: 'rotateY(-180deg)' }], { duration: TC, fill: 'forwards' });
    setTimeout(() => sound('thud'), TC * 0.8);
    const zoom = book.animate([{ transform: tf(L1.x, L1.y, L1.k), easing: 'cubic-bezier(.5,0,.15,1)' }, { transform: tf(toRect.left, toRect.top, 1) }], { duration: TD, delay: TC - overlap, fill: 'forwards' });
    pages.animate([{ boxShadow: '0 34px 70px rgba(20,24,40,.32)' }, { boxShadow: '0 12px 30px rgba(20,24,40,.14)' }], { duration: TD, delay: TC - overlap, fill: 'forwards' });
    backdrop.animate([{ opacity: 1 }, { opacity: 1, offset: .45 }, { opacity: 0 }], { duration: TD, delay: TC - overlap, fill: 'forwards' });
    await done(zoom);
    await done(ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }));
    ov.remove();
  }

  /* Closing: the page shrinks back into the book and the cover closes (then the strap or hasp snaps back on); once covered,
     getTarget() swaps to the home screen and returns the card's rect, where the book then settles. */
  async function close({ fromRect, nb, paint, getTarget }) {
    if (reduce() || !fromRect) { getTarget && await getTarget(); return; }
    const pageW = fromRect.width, pageH = fromRect.height;
    const { ov, book, face, cover, backdrop } = build(nb, pageW, pageH, paint);
    cover.style.transform = 'rotateY(-180deg)';
    const closure = face.querySelector('.cover-clasp .strap, .cover-clasp .hasp'); if (closure) closure.style.transform = 'rotateY(100deg)';
    const L1 = lifted(pageW, pageH, 0.5);
    const T1 = 480, T2 = 480;
    const a1 = book.animate([{ transform: tf(fromRect.left, fromRect.top, 1), easing: 'cubic-bezier(.4,0,.2,1)' }, { transform: tf(L1.x, L1.y, L1.k) }], { duration: T1, fill: 'forwards' });
    const shut = cover.animate([{ transform: 'rotateY(-180deg)', offset: 0, easing: 'linear' }, { transform: 'rotateY(-180deg)', offset: 0.35, easing: 'cubic-bezier(.5,0,.4,1)' }, { transform: 'rotateY(0deg)', offset: 1 }], { duration: T1 + 240, fill: 'forwards' });
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T1 * 0.8, fill: 'forwards' });
    await done(a1);
    const toRect = getTarget ? await getTarget() : null;
    const t = toRect || { left: window.innerWidth / 2 - 60, top: window.innerHeight + 40, height: pageH * 0.2 };
    await done(shut);
    if (closure) { sound(closure.classList.contains('hasp') ? 'click' : 'snap'); await done(closure.animate([{ transform: 'rotateY(100deg)', easing: 'cubic-bezier(.3,0,.2,1)' }, { transform: 'rotateY(0deg)' }], { duration: 220, fill: 'forwards' })); }
    const a2 = book.animate([{ transform: tf(L1.x, L1.y, L1.k), easing: 'cubic-bezier(.22,.8,.26,1)' }, { transform: tf(t.left, t.top, t.height / pageH) }], { duration: T2, delay: 60, fill: 'forwards' });
    backdrop.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0, offset: 1 }], { duration: T2 + 60, fill: 'forwards' });
    await done(a2);
    await done(ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }));
    ov.remove();
  }

  IL.bookOpen = { open, close };
})();
