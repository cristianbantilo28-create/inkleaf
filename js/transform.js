/* Inkleaf — shared controller for moving, resizing and rotating placed items (cover stickers/photos, page photos/videos).
   Items are absolutely positioned inside `container`; the model holds x, y, w, h (in model units) and rot (degrees). */
(function () {
  const IL = (window.IL = window.IL || {});

  IL.makeTransformer = function (opts) {
    const { container, itemSelector, getModel, pxPerUnit, onChange, onSelect, keepAspect, frameClass } = opts;
    let selectedId = null;
    const pointers = new Map(); // pointerId -> {x,y}
    let gesture = null; // {kind:'move'|'resize'|'rotate'|'pinch', id, start:{...}}

    const frame = document.createElement('div');
    frame.className = (frameClass || 'tf-frame');
    frame.innerHTML = '<div class="tf-h rot" data-h="rot" title="Rotate"><svg><use href="#i-rotate"/></svg></div><div class="tf-h se" data-h="se" title="Resize"></div>';
    frame.hidden = true;
    container.appendChild(frame);

    function px() { return pxPerUnit(); }
    function positionFrame() {
      const m = selectedId ? getModel(selectedId) : null;
      if (!m) { frame.hidden = true; return; }
      const s = px(); const el = container.querySelector(`${itemSelector}[data-id="${selectedId}"]`);
      const r = el ? el.getBoundingClientRect() : null;
      frame.hidden = false; frame.classList.toggle('locked', !!m.locked);
      // Use the item's untransformed box: left/top/width/height from the model, then the same rotation.
      frame.style.left = (m.x * s) + 'px'; frame.style.top = (m.y * s) + 'px';
      const h = (m.h != null ? m.h : (r ? r.height / s : m.w));
      frame.style.width = (m.w * s) + 'px'; frame.style.height = (h * s) + 'px';
      frame.style.transform = `rotate(${m.rot || 0}deg)`;
    }
    function select(id) {
      if (selectedId === id) { positionFrame(); return; }
      selectedId = id;
      container.querySelectorAll(itemSelector).forEach(el => el.classList.toggle('is-selected', el.dataset.id === id));
      positionFrame();
      onSelect && onSelect(id);
    }
    function center(m) { const s = px(); const h = (m.h != null ? m.h : m.w); const rect = container.getBoundingClientRect(); return { x: rect.left + (m.x + m.w / 2) * s, y: rect.top + (m.y + h / 2) * s }; }
    function local(e) { const rect = container.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }

    function onDown(e) {
      if (opts.enabled && !opts.enabled()) return;
      if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
      const handle = e.target.closest && e.target.closest('.tf-h');
      const item = e.target.closest && e.target.closest(itemSelector);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (handle && selectedId) {
        const m = getModel(selectedId); if (!m) return;
        e.preventDefault(); e.stopPropagation();
        container.setPointerCapture(e.pointerId);
        const c = center(m);
        const a0 = Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;
        const d0 = Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1;
        gesture = { kind: handle.dataset.h === 'rot' ? 'rotate' : 'resize', id: selectedId, m0: { ...m }, a0, d0, c };
        return;
      }
      if (item) {
        const id = item.dataset.id;
        const lockedModel = getModel(id);
        if (lockedModel && lockedModel.locked) { select(id); e.preventDefault(); e.stopPropagation(); return; }
        if (pointers.size === 2 && selectedId === id) {
          // second finger on the selected item: pinch
          const pts = [...pointers.values()]; const m = getModel(id);
          gesture = { kind: 'pinch', id, m0: { ...m }, d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, a0: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180 / Math.PI };
          e.preventDefault();
          return;
        }
        select(id);
        e.preventDefault(); e.stopPropagation();
        container.setPointerCapture(e.pointerId);
        const m = getModel(id);
        gesture = { kind: 'move', id, m0: { ...m }, start: { x: e.clientX, y: e.clientY }, moved: false, pointerId: e.pointerId };
        return;
      }
      if (!e.target.closest('.tf-frame')) select(null);
    }
    function onMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      const m = getModel(gesture.id); if (!m) { gesture = null; return; }
      const s = px();
      if (gesture.kind === 'move') {
        if (e.pointerId !== gesture.pointerId) return;
        const dx = (e.clientX - gesture.start.x) / s, dy = (e.clientY - gesture.start.y) / s;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) gesture.moved = true;
        m.x = gesture.m0.x + dx; m.y = gesture.m0.y + dy;
      } else if (gesture.kind === 'resize') {
        const d = Math.hypot(e.clientX - gesture.c.x, e.clientY - gesture.c.y);
        const f = Math.max(0.15, d / gesture.d0);
        const h0 = gesture.m0.h != null ? gesture.m0.h : gesture.m0.w;
        const nw = Math.max(8 / s, gesture.m0.w * f), nh = h0 * f;
        m.x = gesture.m0.x + (gesture.m0.w - nw) / 2; m.y = gesture.m0.y + (h0 - nh) / 2; m.w = nw;
        if (m.h != null) m.h = nh;
        if (m.fs != null) m.fs = (gesture.m0.fs || 10) * f;
      } else if (gesture.kind === 'rotate') {
        const a = Math.atan2(e.clientY - gesture.c.y, e.clientX - gesture.c.x) * 180 / Math.PI;
        let rot = (gesture.m0.rot || 0) + (a - gesture.a0);
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        if (Math.abs(((rot % 360) + 360) % 360) < 3 || Math.abs(((rot % 360) + 360) % 360 - 360) < 3) rot = 0;
        m.rot = rot;
      } else if (gesture.kind === 'pinch') {
        if (pointers.size < 2) return;
        const pts = [...pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180 / Math.PI;
        const f = Math.max(0.15, d / gesture.d0);
        const h0 = gesture.m0.h != null ? gesture.m0.h : gesture.m0.w;
        const nw = gesture.m0.w * f, nh = h0 * f;
        m.x = gesture.m0.x + (gesture.m0.w - nw) / 2; m.y = gesture.m0.y + (h0 - nh) / 2; m.w = nw;
        if (m.h != null) m.h = nh; if (m.fs != null) m.fs = (gesture.m0.fs || 10) * f;
        m.rot = (gesture.m0.rot || 0) + (a - gesture.a0);
      }
      onChange(m, 'move');
      positionFrame();
    }
    function onUp(e) {
      pointers.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'pinch') { if (pointers.size === 0) { onChange(getModel(gesture.id), 'end'); gesture = null; } else { gesture = null; } return; }
      const m = getModel(gesture.id);
      const wasTap = gesture.kind === 'move' && !gesture.moved;
      gesture = null;
      if (m) onChange(m, wasTap ? 'tap' : 'end');
      positionFrame();
    }
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onUp);
    container.addEventListener('lostpointercapture', () => {});

    return {
      select, selected: () => selectedId, refresh: positionFrame, frame,
      destroy() { container.removeEventListener('pointerdown', onDown); container.removeEventListener('pointermove', onMove); container.removeEventListener('pointerup', onUp); container.removeEventListener('pointercancel', onUp); frame.remove(); }
    };
  };
})();
