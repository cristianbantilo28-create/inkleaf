/* Inkleaf — search every page of the open notebook; next/previous walk the results and highlight them on the page. */
(function () {
  const IL = (window.IL = window.IL || {});
  class Search {
    constructor(editor) {
      this.editor = editor;
      this.bar = document.getElementById('searchbar');
      this.input = document.getElementById('search-input');
      this.count = document.getElementById('search-count');
      this.prevBtn = document.getElementById('search-prev');
      this.nextBtn = document.getElementById('search-next');
      this.results = []; this.cur = -1; this.term = '';
      document.getElementById('nb-search-btn').addEventListener('click', () => this.toggle());
      document.getElementById('search-close').addEventListener('click', () => this.close());
      this.prevBtn.addEventListener('click', () => this.step(-1));
      this.nextBtn.addEventListener('click', () => this.step(1));
      this.input.addEventListener('input', () => { clearTimeout(this._t); this._t = setTimeout(() => this.run(this.input.value), 120); });
      this.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') this.close(); });
      document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !document.getElementById('view-notebook').hidden) { e.preventDefault(); this.open(); } });
    }
    get isOpen() { return !this.bar.hidden; }
    toggle() { this.isOpen ? this.close() : this.open(); }
    open() { this.bar.hidden = false; this.input.focus(); this.input.select(); if (this.input.value) this.run(this.input.value); }
    close() { this.bar.hidden = true; this.results = []; this.cur = -1; this.term = ''; this.editor.setHighlights(null); this.render(); }
    /* Called by the editor when text changes or the page changes. */
    refresh() { if (!this.isOpen || !this.term) return; const prev = this.results[this.cur]; this.collect(this.term); this.cur = this.results.length ? Math.max(0, Math.min(this.cur, this.results.length - 1)) : -1; if (prev) { const same = this.results.findIndex(r => r.p === prev.p && r.r === prev.r && r.start === prev.start); if (same >= 0) this.cur = same; } this.apply(false); }
    collect(term) {
      const q = term.trim().toLowerCase(); this.results = []; if (!q) return;
      this.editor.pages.forEach((page, p) => page.rows.forEach((row, r) => {
        const low = row.toLowerCase(); let idx = low.indexOf(q);
        while (idx >= 0) { this.results.push({ p, r, start: idx, end: idx + q.length }); idx = low.indexOf(q, idx + Math.max(1, q.length)); }
      }));
    }
    run(term) {
      this.term = term; this.collect(term);
      if (!this.results.length) { this.cur = -1; this.apply(false); return; }
      // start at the first result on or after the current page
      const p = this.editor.pageIndex; let i = this.results.findIndex(x => x.p >= p); if (i < 0) i = 0;
      this.cur = i; this.apply(true);
    }
    step(dir) { if (!this.results.length) return; this.cur = (this.cur + dir + this.results.length) % this.results.length; this.apply(true); }
    async apply(scroll) {
      const current = this.results[this.cur];
      if (current && current.p !== this.editor.pageIndex) await this.editor.goTo(current.p);
      const byPage = new Map();
      this.results.forEach((x, i) => { if (!byPage.has(x.p)) byPage.set(x.p, new Map()); const map = byPage.get(x.p); if (!map.has(x.r)) map.set(x.r, []); map.get(x.r).push({ start: x.start, end: x.end, cur: i === this.cur }); });
      this.editor.setHighlights(this.results.length ? byPage : null);
      if (scroll && current) requestAnimationFrame(() => this.editor.scrollToMark());
      this.render();
    }
    render() {
      const n = this.results.length;
      this.count.textContent = n ? `${this.cur + 1} / ${n}` : (this.term.trim() ? '0 / 0' : '');
      this.prevBtn.disabled = this.nextBtn.disabled = n < 2;
      this.count.style.color = this.term.trim() && !n ? 'var(--danger)' : '';
    }
  }
  IL.Search = Search;
})();
