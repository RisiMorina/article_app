'use strict';
/* Highlighter: floating toolbar, turning a text selection into highlights
   (one per page it touches), and click-to-open on existing highlights. */

const Highlighter = {
  lastColor: 'yellow',
  range: null,          // range the toolbar is currently showing for

  get toolbar() { return $('#sel-toolbar'); },

  /* ---------- selection -> highlights ---------- */
  selectionRange() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!Reader.pagesEl.contains(range.commonAncestorContainer)) return null;
    if (!range.toString().trim()) return null;
    return range;
  },

  /** Text + rectangles of the part of `range` that lies on one page. */
  _extract(range, page) {
    const pr = page.el.getBoundingClientRect();
    const segs = [];
    const walker = document.createTreeWalker(page.textEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!range.intersectsNode(n)) continue;
      const start = n === range.startContainer ? range.startOffset : 0;
      const end = n === range.endContainer ? range.endOffset : n.length;
      if (end <= start) continue;
      const sub = document.createRange();
      sub.setStart(n, start);
      sub.setEnd(n, end);
      const rects = Array.from(sub.getClientRects()).filter(r => r.width > 0.5 && r.height > 2);
      if (!rects.length) continue;
      segs.push({ text: n.data.slice(start, end), rects, first: rects[0] });
    }
    if (!segs.length) return null;

    // Join text: spaces between lines, repair words hyphenated at a line break.
    let out = '';
    let prev = null;
    for (const s of segs) {
      const r = s.first;
      if (prev) {
        const sameLine = Math.abs((r.top + r.bottom) / 2 - (prev.top + prev.bottom) / 2) < Math.min(r.height, prev.height) * 0.5;
        if (sameLine) {
          if (r.left - prev.right > r.height * 0.15 && !/\s$/.test(out) && !/^\s/.test(s.text)) out += ' ';
        } else if (/[A-Za-zÀ-ɏ]-$/.test(out) && /^[a-zß-ÿ]/.test(s.text)) {
          out = out.slice(0, -1);
        } else if (!/\s$/.test(out)) out += ' ';
      }
      out += s.text;
      prev = r;
    }
    out = out.replace(/\s+/g, ' ').trim();
    if (!out) return null;

    // Merge fragments on the same line into one rectangle per line (in px, relative to the page).
    const px = [];
    for (const s of segs) for (const r of s.rects) px.push({ l: r.left - pr.left, t: r.top - pr.top, r: r.right - pr.left, b: r.bottom - pr.top });
    px.sort((a, b) => a.t - b.t || a.l - b.l);
    const lines = [];
    for (const r of px) {
      const hgt = r.b - r.t;
      const line = lines.find(o => {
        const overlap = Math.min(o.b, r.b) - Math.max(o.t, r.t);
        const gap = Math.max(r.l - o.r, o.l - r.r);
        return overlap > 0.6 * Math.min(o.b - o.t, hgt) && gap < hgt * 0.8;
      });
      if (line) { line.l = Math.min(line.l, r.l); line.r = Math.max(line.r, r.r); line.t = Math.min(line.t, r.t); line.b = Math.max(line.b, r.b); }
      else lines.push({ ...r });
    }
    const W = pr.width, H = pr.height;
    const clamp = v => Math.min(Math.max(v, 0), 1);
    const rects = lines.map(l => ({ x: clamp(l.l / W), y: clamp(l.t / H), w: clamp((l.r - l.l) / W), h: clamp((l.b - l.t) / H) }));
    return { text: out, rects };
  },

  fromSelection(color, withNote) {
    const range = this.selectionRange();
    const a = Reader.article;
    if (!range || !a) return false;
    if (a.hasText === false) return false;

    const made = [];
    for (const page of Reader.pages) {
      if (!page.rendered || !range.intersectsNode(page.textEl)) continue;
      const part = this._extract(range, page);
      if (!part) continue;
      const now = Date.now();
      made.push({ id: uid(), page: page.num, text: part.text, rects: part.rects, color, note: '', createdAt: now, updatedAt: now });
    }
    if (!made.length) return false;

    this.lastColor = color;
    a.highlights.push(...made);
    window.getSelection().removeAllRanges();
    this.hideToolbar();
    new Set(made.map(m => m.page)).forEach(n => Reader.refreshHighlightLayer(n));
    Notes.renderHighlights();
    Notes.changed();
    if (withNote) Notes.reveal(made[0].id, { focusNote: true });
    else made.forEach(m => Reader.flash(m.id));
    return true;
  },

  /* ---------- toolbar ---------- */
  showToolbar(range) {
    if (Reader.article && Reader.article.hasText === false) return;
    this.range = range.cloneRange();
    this.toolbar.hidden = false;
    this.reposition();
  },
  hideToolbar() {
    this.range = null;
    this.toolbar.hidden = true;
  },
  reposition() {
    if (!this.range || this.toolbar.hidden) return;
    const rects = Array.from(this.range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
    if (!rects.length) { this.hideToolbar(); return; }
    const tb = this.toolbar;
    const last = rects[rects.length - 1], first = rects[0];
    const w = tb.offsetWidth, hgt = tb.offsetHeight;
    const sc = Reader.scroller.getBoundingClientRect();
    // hide when the selection scrolled out of view
    if (last.bottom < sc.top || first.top > sc.bottom) { tb.style.visibility = 'hidden'; return; }
    tb.style.visibility = '';
    let top = last.bottom + 8;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, first.top - hgt - 8);
    let left = Math.min(Math.max(last.right - w / 2, 8), window.innerWidth - w - 8);
    tb.style.top = top + 'px';
    tb.style.left = left + 'px';
  },

  refreshLabels() {
    $$('.swatch', this.toolbar).forEach(b => {
      const c = b.dataset.color;
      b.setAttribute('aria-label', `Highlight: ${Settings.label(c)}`);
      b.title = `${Settings.label(c)}`;
    });
  },

  /* ---------- clicking an existing highlight ---------- */
  hitTest(ev) {
    const pageEl = ev.target.closest && ev.target.closest('.page');
    if (!pageEl || !Reader.article) return null;
    const r = pageEl.getBoundingClientRect();
    const nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
    const num = +pageEl.dataset.num;
    const hits = Reader.article.highlights.filter(hl => hl.page === num &&
      hl.rects.some(q => nx >= q.x && nx <= q.x + q.w && ny >= q.y && ny <= q.y + q.h));
    return hits.length ? hits.sort((a, b) => b.createdAt - a.createdAt)[0] : null;
  },

  init() {
    this.refreshLabels();
    Settings.onChange(() => this.refreshLabels());
    const tb = this.toolbar;

    // Keep the text selected while pressing toolbar buttons
    tb.addEventListener('mousedown', e => e.preventDefault());
    tb.addEventListener('click', e => {
      const sw = e.target.closest('.swatch');
      if (sw) this.fromSelection(sw.dataset.color, false);
      else if (e.target.closest('#tb-note')) this.fromSelection(this.lastColor, true);
    });

    document.addEventListener('mouseup', e => {
      if (!Reader.article || $('#view-reader').hidden || tb.contains(e.target) || Ink.tool !== 'select') return;
      // wait one tick: the browser finalises the selection after mouseup
      setTimeout(() => {
        const range = this.selectionRange();
        if (range) { this.showToolbar(range); return; }
        this.hideToolbar();
        if (e.button === 0 && Reader.pagesEl.contains(e.target)) {
          const hl = this.hitTest(e);
          if (hl) Notes.reveal(hl.id, { focusNote: true });
        }
      }, 0);
    });

    document.addEventListener('keyup', e => {
      if (!Reader.article || $('#view-reader').hidden) return;
      if (e.shiftKey || e.key.startsWith('Arrow') || e.key === 'Shift') {
        const range = this.selectionRange();
        if (range) this.showToolbar(range);
      }
    });

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed) this.hideToolbar();
    });

    // Ctrl/Cmd+H highlights the current selection with the last used colour
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'h') return;
      if (!Reader.article || $('#view-reader').hidden) return;
      e.preventDefault();
      if (!this.fromSelection(this.lastColor, false)) {
        toast(Reader.article.hasText === false ? 'This PDF has no text layer, so text can’t be highlighted.' : 'Select some text in the article first.');
      }
    });

    // Cursor feedback over existing highlights
    let raf = 0;
    Reader.pagesEl.addEventListener('mousemove', e => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; Reader.pagesEl.classList.toggle('over-hl', !!this.hitTest(e)); });
    });
  }
};
