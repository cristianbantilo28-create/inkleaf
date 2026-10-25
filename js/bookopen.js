/* Inkleaf — opening a notebook: the book lifts off the shelf, its cover swings open in 3D, and the open page zooms
   toward the reader until it is exactly where the real page sits. Closing plays the same in reverse. */
(function () {
  const IL = (window.IL = window.IL || {});
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const done = a => a.finished.catch(() => {});

  /* Builds the overlay: a backdrop plus a "book" sized like the page, with a page face and a cover hinged on its left edge. */
  function build(nb, pageW, pageH, paint) {
    const ov = document.createElement('div'); ov.className = 'bookopen'; ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = `<div class="bo-backdrop"></div><div class="bo-scene"><div class="bo-book"><div class="bo-pages"><div class="bo-edge"></div><canvas class="bo-page"></canvas></div><div class="bo-cover"><div class="bo-cover-front"></div><div class="bo-cover-in"></div></div></div></div>`;
    const book = ov.querySelector('.bo-book'); book.style.width = pageW + 'px'; book.style.height = pageH + 'px';
    const front = ov.querySelector('.bo-cover-front'); const face = document.createElement('div'); IL.cover.render(face, nb.cover || IL.cover.defaultCover(nb.title)); front.appendChild(face);
    const inside = ov.querySelector('.bo-cover-in'); const rgb = IL.cover.tintOf(nb.cover); inside.style.background = `linear-gradient(90deg, rgba(${rgb.join(',')},.5), rgba(${rgb.join(',')},.3) 60%, rgba(${rgb.join(',')},.38))`;
    try { paint && paint(ov.querySelector('.bo-page'), Math.min(900, pageW)); } catch (e) {}
    document.body.appendChild(ov);
    return { ov, book, cover: ov.querySelector('.bo-cover'), backdrop: ov.querySelector('.bo-backdrop'), pages: ov.querySelector('.bo-pages') };
  }
  const tf = (x, y, k) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
  /* a lifted, centred pose for a page of pageW x pageH (a little right of centre so the opened cover has room) */
  function lifted(pageW, pageH, frac) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const h1 = Math.min(vh * frac, pageH, vw * 0.9 * pageH / pageW), k1 = h1 / pageH, w1 = pageW * k1;
    return { x: vw / 2 - w1 / 2 + Math.min(w1 * 0.22, Math.max(0, (vw - w1) / 2 - 8)), y: vh / 2 - h1 / 2, k: k1 };
  }

  /* fromRect: the cover card. toRect: the real page (laid out but still covered). paint(canvas, cssW) draws the page face.
     onCovered() is called once the backdrop hides everything, which is the moment to swap the views underneath. */
  async function open({ fromRect, toRect, nb, paint, onCovered }) {
    if (reduce() || !fromRect || !toRect) { onCovered && onCovered(); return; }
    const pageW = toRect.width, pageH = toRect.height;
    const { ov, book, cover, backdrop, pages } = build(nb, pageW, pageH, paint);
    const k0 = fromRect.height / pageH, x0 = fromRect.left, y0 = fromRect.top;
    const L1 = lifted(pageW, pageH, 0.56);
    const T = 1300;
    const bookAnim = book.animate([
      { transform: tf(x0, y0, k0), offset: 0, easing: 'cubic-bezier(.22,.8,.26,1)' },
      { transform: tf(L1.x, L1.y, L1.k), offset: 0.32, easing: 'linear' },
      { transform: tf(L1.x, L1.y, L1.k), offset: 0.64, easing: 'cubic-bezier(.5,0,.15,1)' },
      { transform: tf(toRect.left, toRect.top, 1), offset: 1 }
    ], { duration: T, fill: 'forwards' });
    pages.animate([
      { boxShadow: '0 2px 6px rgba(20,24,40,.25)', offset: 0 }, { boxShadow: '0 34px 70px rgba(20,24,40,.38)', offset: 0.32 },
      { boxShadow: '0 34px 70px rgba(20,24,40,.32)', offset: 0.64 }, { boxShadow: '0 12px 30px rgba(20,24,40,.14)', offset: 1 }
    ], { duration: T, fill: 'forwards' });
    cover.animate([
      { transform: 'rotateY(0deg)', offset: 0, easing: 'linear' }, { transform: 'rotateY(0deg)', offset: 0.2, easing: 'cubic-bezier(.45,.05,.3,1)' },
      { transform: 'rotateY(-174deg)', offset: 0.66, easing: 'ease-out' }, { transform: 'rotateY(-180deg)', offset: 1 }
    ], { duration: T, fill: 'forwards' });
    backdrop.animate([{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.28 }, { opacity: 1, offset: 0.66 }, { opacity: 0, offset: 1 }], { duration: T, fill: 'forwards' });
    await done(ov.animate([{ opacity: 1 }, { opacity: 1 }], { duration: T * 0.3 }));   // a sentinel that follows the animation clock
    onCovered && onCovered();
    await done(bookAnim);
    await done(ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }));
    ov.remove();
  }

  /* Closing: the page shrinks back into the book and the cover closes; once covered, getTarget() swaps to the home screen and
     returns the card's rect, where the book then settles. */
  async function close({ fromRect, nb, paint, getTarget }) {
    if (reduce() || !fromRect) { getTarget && await getTarget(); return; }
    const pageW = fromRect.width, pageH = fromRect.height;
    const { ov, book, cover, backdrop } = build(nb, pageW, pageH, paint);
    cover.style.transform = 'rotateY(-180deg)';
    const L1 = lifted(pageW, pageH, 0.5);
    const T1 = 520, T2 = 520;
    const a1 = book.animate([{ transform: tf(fromRect.left, fromRect.top, 1), easing: 'cubic-bezier(.4,0,.2,1)' }, { transform: tf(L1.x, L1.y, L1.k) }], { duration: T1, fill: 'forwards' });
    cover.animate([{ transform: 'rotateY(-180deg)', offset: 0, easing: 'linear' }, { transform: 'rotateY(-180deg)', offset: 0.35, easing: 'cubic-bezier(.5,0,.4,1)' }, { transform: 'rotateY(0deg)', offset: 1 }], { duration: T1 + 260, fill: 'forwards' });
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T1 * 0.8, fill: 'forwards' });
    await done(a1);
    const toRect = getTarget ? await getTarget() : null;
    const t = toRect || { left: window.innerWidth / 2 - 60, top: window.innerHeight + 40, height: pageH * 0.2 };
    const a2 = book.animate([{ transform: tf(L1.x, L1.y, L1.k), easing: 'cubic-bezier(.22,.8,.26,1)' }, { transform: tf(t.left, t.top, t.height / pageH) }], { duration: T2, delay: 120, fill: 'forwards' });
    backdrop.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0, offset: 1 }], { duration: T2 + 120, fill: 'forwards' });
    await done(a2);
    await done(ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }));
    ov.remove();
  }

  IL.bookOpen = { open, close };
})();
