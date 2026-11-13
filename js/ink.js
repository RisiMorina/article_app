'use strict';
/* Ink: freehand pen (circle, underline, scribble) and stroke eraser on top of the pages.
   Strokes live in article.ink: { id, page, color, width, pts: [[x, y], ...] }
   x and y are fractions (0..1) of the page width/height, width is a fraction of the page width,
   so strokes survive zoom and re-render, just like highlight rectangles. */

const INK_COLORS = { red: '#d93025', blue: '#1a56db', green: '#188038', black: '#1d2329' };
const INK_WIDTH = 0.0032;          // fraction of the page width (about 2.6px at 100% zoom)
const SVG_NS = 'http://www.w3.org/2000/svg';

const Ink = {
  tool: 'select',                  // 'select' | 'pen' | 'eraser'
  color: 'red',
  drawing: null,                   // { page, pts, el }
  erasing: null,                   // { page }
  undoStack: [],                   // ids of strokes drawn in this reading session, newest last

  /** The SVG layer for one page (created in Reader.buildPages). */
  createLayer() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ink-layer');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  },

  _ratio(page) { return page.h / page.w; },

  _pathData(pts, ratio) {
    if (pts.length === 1) { const [x, y] = pts[0]; return `M${x} ${y * ratio}l0.0001 0`; }
    let d = `M${pts[0][0]} ${pts[0][1] * ratio}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${pts[i][0]} ${pts[i][1] * ratio} ${mx} ${my * ratio}`;
    }
    const last = pts[pts.length - 1];
    return d + `L${last[0]} ${last[1] * ratio}`;
  },

  _pathEl(stroke, ratio) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', this._pathData(stroke.pts, ratio));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', INK_COLORS[stroke.color] || INK_COLORS.red);
    p.setAttribute('stroke-width', stroke.width);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    return p;
  },

  /** Redraw all strokes of a page. */
  refresh(num) {
    const page = Reader.pages[num - 1];
    if (!page || !page.inkEl || !Reader.article) return;
    const ratio = this._ratio(page);
    page.inkEl.setAttribute('viewBox', `0 0 1 ${ratio}`);
    page.inkEl.replaceChildren(...(Reader.article.ink || []).filter(s => s.page === num).map(s => {
      const p = this._pathEl(s, ratio);
      p.dataset.ink = s.id;
      return p;
    }));
  },

  /* ---------- tools ---------- */
  setTool(tool) {
    this.cancelStroke();
    this.tool = tool;
    Reader.pagesEl.classList.toggle('tool-pen', tool === 'pen');
    Reader.pagesEl.classList.toggle('tool-eraser', tool === 'eraser');
    $$('#tool-group [data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false'));
    $('#ink-colors').hidden = tool !== 'pen';
    if (tool !== 'select') { window.getSelection().removeAllRanges(); Highlighter.hideToolbar(); }
  },

  setColor(color) {
    this.color = color;
    $$('#ink-colors [data-ink-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.inkColor === color ? 'true' : 'false'));
  },

  /** Pointer position as fractions of the page. */
  _point(ev, page) {
    const r = page.el.getBoundingClientRect();
    return [Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1)];
  },

  cancelStroke() {
    if (this.drawing && this.drawing.el) this.drawing.el.remove();
    this.drawing = null; this.erasing = null;
  },

  /* ---------- drawing ---------- */
  _down(ev, page) {
    if (!Reader.article || ev.button !== 0 || (ev.pointerType === 'mouse' && ev.buttons !== 1)) return;
    ev.preventDefault();
    page.inkEl.setPointerCapture(ev.pointerId);
    if (this.tool === 'pen') {
      const pts = [this._point(ev, page)];
      const el = this._pathEl({ pts, color: this.color, width: INK_WIDTH }, this._ratio(page));
      page.inkEl.append(el);
      this.drawing = { page, pts, el };
    } else if (this.tool === 'eraser') {
      this.erasing = { page, removed: 0 };
      this._erase(ev, page);
    }
  },

  _move(ev, page) {
    if (this.drawing && this.drawing.page === page) {
      const pts = this.drawing.pts, last = pts[pts.length - 1], p = this._point(ev, page);
      // Points closer than ~0.15% of the page width add nothing but weight.
      if (Math.hypot(p[0] - last[0], (p[1] - last[1]) * this._ratio(page)) < 0.0015) return;
      pts.push(p);
      this.drawing.el.setAttribute('d', this._pathData(pts, this._ratio(page)));
    } else if (this.erasing && this.erasing.page === page) {
      this._erase(ev, page);
    }
  },

  _up(ev, page) {
    if (this.drawing && this.drawing.page === page) {
      const { pts } = this.drawing;
      const stroke = { id: uid(), page: page.num, color: this.color, width: INK_WIDTH, pts: pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]) };
      this.drawing.el.remove();
      this.drawing = null;
      (Reader.article.ink = Reader.article.ink || []).push(stroke);
      this.undoStack.push(stroke.id);
      this.refresh(page.num);
      Autosave.touch();
    } else if (this.erasing) {
      this.erasing = null;
    }
  },

  /** Remove every stroke the eraser touches. */
  _erase(ev, page) {
    const a = Reader.article, ratio = this._ratio(page), [px, py] = this._point(ev, page);
    const reach = 0.012;           // eraser radius, as a fraction of the page width
    const hit = s => {
      const pts = s.pts, r = reach + s.width / 2;
      for (let i = 0; i < pts.length; i++) {
        const ax = pts[i][0], ay = pts[i][1] * ratio;
        const bx = pts[Math.min(i + 1, pts.length - 1)][0], by = pts[Math.min(i + 1, pts.length - 1)][1] * ratio;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 ? Math.min(Math.max(((px - ax) * dx + (py * ratio - ay) * dy) / len2, 0), 1) : 0;
        if (Math.hypot(px - (ax + t * dx), py * ratio - (ay + t * dy)) <= r) return true;
      }
      return false;
    };
    const before = (a.ink || []).length;
    a.ink = (a.ink || []).filter(s => s.page !== page.num || !hit(s));
    if (a.ink.length !== before) { this.refresh(page.num); Autosave.touch(); }
  },

  /** Ctrl+Z while pen or eraser is active: take back the last stroke. */
  undo() {
    const a = Reader.article;
    while (this.undoStack.length) {
      const id = this.undoStack.pop();
      const s = (a.ink || []).find(x => x.id === id);
      if (!s) continue;                 // already erased
      a.ink = a.ink.filter(x => x.id !== id);
      this.refresh(s.page);
      Autosave.touch();
      return true;
    }
    return false;
  },

  /** Called by Reader for each new page element. */
  bindPage(page) {
    const el = page.inkEl;
    el.addEventListener('pointerdown', e => this._down(e, page));
    el.addEventListener('pointermove', e => this._move(e, page));
    el.addEventListener('pointerup', e => this._up(e, page));
    el.addEventListener('pointercancel', () => this.cancelStroke());
  },

  reset() { this.cancelStroke(); this.undoStack = []; this.setTool('select'); },

  init() {
    $$('#tool-group [data-tool]').forEach(b => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    $$('#ink-colors [data-ink-color]').forEach(b => b.addEventListener('click', () => this.setColor(b.dataset.inkColor)));
    this.setColor(this.color);

    document.addEventListener('keydown', e => {
      if (!Reader.article || $('#view-reader').hidden) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && this.tool !== 'select') {
        if (this.undo()) e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') this.setTool(this.tool === 'pen' ? 'select' : 'pen');
      else if (k === 'e') this.setTool(this.tool === 'eraser' ? 'select' : 'eraser');
      else if (k === 'v' || e.key === 'Escape') { if (this.tool !== 'select') this.setTool('select'); }
    });
  }
};
