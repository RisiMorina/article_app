'use strict';
/* Reader: loads the PDF, builds one placeholder per page, renders canvas + text layer lazily,
   handles zoom, page counter, scroll-to-highlight and the highlight overlay of each page. */

const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'build/pdf.worker.min.js';

const CSS_UNITS = 96 / 72;                       // zoom 100% = true CSS size
const ZOOM_STEPS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

const Reader = {
  article: null,
  pdf: null,
  pages: [],            // { num, w, h, proxy, el, canvas, hlEl, textEl, rendered, token, task }
  scale: 1,
  loadToken: 0,
  activeId: null,
  io: null,             // renders pages that come near the viewport
  freeIo: null,         // frees pages that are far away

  get scroller() { return $('#pdf-scroll'); },
  get pagesEl() { return $('#pages'); },
  get zoomPercent() { return Math.round(this.scale / CSS_UNITS * 100); },

  async open(id) {
    this.close();                       // also bumps loadToken, cancelling any older open()
    const token = ++this.loadToken;
    $('#view-reader').hidden = false;
    $('#pdf-loading').hidden = false;
    $('#pdf-loading').textContent = 'Opening PDF…';
    $('#scan-banner').hidden = true;

    let article, blob;
    try {
      [article, blob] = await Promise.all([DB.getArticle(id), DB.getFile(id)]);
    } catch (e) { console.error(e); }
    if (token !== this.loadToken) return;
    if (!article || !blob) { toast('That article could not be found.'); location.hash = '#/'; return; }

    this.article = article;
    Autosave.bind(article);
    Notes.bind(article);
    this.updateTitle();

    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      this.pdf = await pdfjsLib.getDocument({
        data,
        cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: PDFJS_BASE + 'standard_fonts/'
      }).promise;
    } catch (e) {
      console.error(e);
      if (token !== this.loadToken) return;
      $('#pdf-loading').textContent = 'This PDF could not be opened.';
      return;
    }
    if (token !== this.loadToken) { this.pdf.destroy(); this.pdf = null; return; }

    // Page sizes first, so the scrollbar and "scroll to page" are right from the start.
    const n = this.pdf.numPages;
    const sizes = new Array(n);
    for (let start = 1; start <= n; start += 25) {
      const batch = [];
      for (let i = start; i < Math.min(n + 1, start + 25); i++) {
        batch.push(this.pdf.getPage(i).then(p => { const v = p.getViewport({ scale: 1 }); sizes[i - 1] = { proxy: p, w: v.width, h: v.height }; }));
      }
      await Promise.all(batch);
      if (token !== this.loadToken) return;
    }

    $('#pdf-loading').hidden = true;
    this.buildPages(sizes);
    $('#page-total').textContent = n;
    if (article.numPages !== n) { article.numPages = n; Autosave.touch(true); }

    const saved = article.view && article.view.scale;
    this.scale = saved ? saved : this.fitScale();
    this.layout();
    this.observe();
    this.restorePosition();
    this.updateCurrentPage();
    this.checkTextLayer(token);
    if (!article.thumb) Library.makeThumb(this.pdf).then(t => { if (t && this.article === article) { article.thumb = t; Autosave.touch(true); } });
    Notes.renderAll();
  },

  close() {
    this.loadToken++;
    if (this.io) { this.io.disconnect(); this.io = null; }
    if (this.freeIo) { this.freeIo.disconnect(); this.freeIo = null; }
    this.pages.forEach(p => p.task && p.task.cancel && p.task.cancel());
    this.pages = [];
    if (this.pdf) { this.pdf.destroy(); this.pdf = null; }
    this.pagesEl.replaceChildren();
    Highlighter.hideToolbar();
    Ink.reset();
    this.activeId = null;
    Autosave.unbind();
    this.article = null;
    $('#view-reader').hidden = true;
  },

  updateTitle() {
    const t = displayTitle(this.article);
    $('#r-title').textContent = t;
    $('#r-title').title = t;
    document.title = t + ' · Marginalia';
  },

  /* ---------- pages ---------- */
  buildPages(sizes) {
    const frag = document.createDocumentFragment();
    this.pages = sizes.map((s, i) => {
      const num = i + 1;
      const canvas = h('canvas', { class: 'page-canvas' });
      const hlEl = h('div', { class: 'hl-layer' });
      const textEl = h('div', { class: 'textLayer' });
      const inkEl = Ink.createLayer();
      const el = h('div', { class: 'page', dataset: { num }, 'aria-label': `Page ${num}`, role: 'group' }, canvas, hlEl, textEl, inkEl);
      frag.append(el);
      const page = { num, w: s.w, h: s.h, proxy: s.proxy, el, canvas, hlEl, textEl, inkEl, rendered: false, token: 0, task: null };
      this._bindTextLayer(page);
      Ink.bindPage(page);
      return page;
    });
    this.pagesEl.replaceChildren(frag);
    this.pages.forEach(p => { this.refreshHighlightLayer(p.num); Ink.refresh(p.num); });
  },

  /** Mirrors what pdf.js's own viewer does so dragging a selection across gaps doesn't jump. */
  _bindTextLayer(page) {
    const end = h('div', { class: 'endOfContent' });
    page.textEl.addEventListener('mousedown', () => { page.textEl.classList.add('selecting'); });
    page.endEl = end;
  },

  fitScale() {
    const first = this.pages[0];
    if (!first) return CSS_UNITS;
    const avail = this.scroller.clientWidth - 64;
    const s = avail / first.w;
    return Math.min(Math.max(s, 0.7 * CSS_UNITS), 1.3 * CSS_UNITS);
  },

  layout() {
    this.pages.forEach(p => {
      p.el.style.width = Math.floor(p.w * this.scale) + 'px';
      p.el.style.height = Math.floor(p.h * this.scale) + 'px';
      p.el.style.setProperty('--scale-factor', this.scale);
    });
    $('#zoom-level').textContent = this.zoomPercent + '%';
  },

  observe() {
    if (this.io) this.io.disconnect();
    if (this.freeIo) this.freeIo.disconnect();
    this.io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) this.render(this.pages[e.target.dataset.num - 1]); });
    }, { root: this.scroller, rootMargin: '1200px 0px' });
    this.freeIo = new IntersectionObserver(entries => {
      entries.forEach(e => { if (!e.isIntersecting) this.unrender(this.pages[e.target.dataset.num - 1]); });
    }, { root: this.scroller, rootMargin: '5000px 0px' });
    this.pages.forEach(p => { this.io.observe(p.el); this.freeIo.observe(p.el); });
  },

  async render(page) {
    if (!page || page.rendered || page.rendering) return;
    page.rendering = true;
    const token = ++page.token;
    const scale = this.scale;
    try {
      const viewport = page.proxy.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = page.canvas;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      const task = page.proxy.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
      });
      page.task = task;
      await task.promise;

      const textContent = await page.proxy.getTextContent();
      if (token !== page.token || scale !== this.scale) return;
      page.textEl.replaceChildren();
      const tl = pdfjsLib.renderTextLayer({ textContentSource: textContent, container: page.textEl, viewport, textDivs: [] });
      await tl.promise;
      if (token !== page.token) return;
      page.textEl.append(page.endEl);
      page.rendered = true;
      page.el.classList.add('rendered');
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      console.error('Page render failed', page.num, err);
    } finally {
      // If a zoom or unrender happened meanwhile, that call already reset the state and
      // the observers will ask for a fresh render.
      if (token === page.token) { page.rendering = false; page.task = null; }
    }
  },

  unrender(page) {
    if (!page) return;
    page.token++;
    if (page.task && page.task.cancel) page.task.cancel();
    page.rendering = false;
    page.rendered = false;
    page.canvas.width = page.canvas.height = 0;
    page.textEl.replaceChildren();
    page.el.classList.remove('rendered');
  },

  /* ---------- zoom ---------- */
  setScale(scale, { fit = false } = {}) {
    scale = Math.min(Math.max(scale, 0.4 * CSS_UNITS), 3.2 * CSS_UNITS);
    this.article.view.scale = fit ? null : scale;
    Autosave.touch(true);
    if (Math.abs(scale - this.scale) < 0.001) return;
    const sc = this.scroller;
    const ratio = (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight;
    Highlighter.hideToolbar();
    this.scale = scale;
    this.layout();
    sc.scrollTop = ratio * sc.scrollHeight - sc.clientHeight / 2;
    this.pages.forEach(p => this.unrender(p));
    this.observe();
  },
  zoomStep(dir) {
    const cur = this.zoomPercent;
    const next = dir > 0 ? ZOOM_STEPS.find(z => z > cur) : [...ZOOM_STEPS].reverse().find(z => z < cur);
    if (next) this.setScale(next / 100 * CSS_UNITS);
  },
  fit() { this.setScale(this.fitScale(), { fit: true }); },

  /* ---------- position ---------- */
  pageTop(p) {
    return p.el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
  },
  currentPage() {
    const sc = this.scroller;
    const probe = sc.scrollTop + sc.clientHeight * 0.35;
    let cur = 1;
    for (const p of this.pages) { if (this.pageTop(p) <= probe) cur = p.num; else break; }
    return cur;
  },
  updateCurrentPage() {
    if (!this.pages.length) return;
    const cur = this.currentPage();
    const input = $('#page-input');
    if (document.activeElement !== input) input.value = cur;
    if (this.article.view.page !== cur) { this.article.view.page = cur; Autosave.touch(true); }
  },
  scrollToPage(num, behavior = 'auto') {
    const p = this.pages[Math.min(Math.max(num, 1), this.pages.length) - 1];
    if (p) this.scroller.scrollTo({ top: this.pageTop(p) - 12, behavior });
  },
  restorePosition() {
    const pg = this.article.view && this.article.view.page;
    if (pg && pg > 1) this.scrollToPage(pg);
  },

  scrollToHighlight(h, { flash = true } = {}) {
    const p = this.pages[h.page - 1];
    if (!p) return;
    const r = h.rects[0] || { y: 0 };
    const top = this.pageTop(p) + r.y * p.el.offsetHeight - this.scroller.clientHeight * 0.3;
    this.scroller.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (flash) this.flash(h.id);
  },
  flash(id) {
    $$(`.hl-rect[data-hl="${id}"]`, this.pagesEl).forEach(el => {
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
    });
  },
  setActive(id) {
    this.activeId = id;
    $$('.hl-rect.active', this.pagesEl).forEach(el => el.classList.remove('active'));
    if (id) $$(`.hl-rect[data-hl="${id}"]`, this.pagesEl).forEach(el => el.classList.add('active'));
  },

  /* ---------- highlight overlay (percent based, so zoom costs nothing) ---------- */
  refreshHighlightLayer(num) {
    const p = this.pages[num - 1];
    if (!p) return;
    const rects = [];
    for (const hl of this.article.highlights) {
      if (hl.page !== num) continue;
      for (const r of hl.rects) {
        rects.push(h('div', {
          class: 'hl-rect c-' + hl.color + (hl.id === this.activeId ? ' active' : ''),
          dataset: { hl: hl.id },
          style: { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }
        }));
      }
    }
    p.hlEl.replaceChildren(...rects);
  },

  /* ---------- scanned PDFs ---------- */
  async checkTextLayer(token) {
    const a = this.article;
    if (a.hasText === null) {
      const n = this.pdf.numPages;
      const sample = [...new Set([1, 2, 3, Math.ceil(n / 2), n].filter(i => i >= 1 && i <= n))];
      let chars = 0;
      try {
        for (const i of sample) {
          const tc = await (await this.pdf.getPage(i)).getTextContent();
          chars += tc.items.reduce((s, it) => s + (it.str || '').trim().length, 0);
        }
      } catch (e) { console.warn(e); return; }
      if (token !== this.loadToken) return;
      a.hasText = chars > 30;
      Autosave.touch(true);
    }
    $('#scan-banner').hidden = a.hasText !== false;
    if (a.hasText === false) Notes.renderHighlights();
  },

  init() {
    const sc = this.scroller;
    let ticking = false;
    sc.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; this.updateCurrentPage(); Highlighter.reposition(); });
    }, { passive: true });

    $('#zoom-in').addEventListener('click', () => this.zoomStep(1));
    $('#zoom-out').addEventListener('click', () => this.zoomStep(-1));
    $('#zoom-level').addEventListener('click', () => this.fit());
    $('#scan-dismiss').addEventListener('click', () => { $('#scan-banner').hidden = true; });

    const pi = $('#page-input');
    pi.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const n = parseInt(pi.value, 10); if (n) this.scrollToPage(n); pi.blur(); }
      if (e.key === 'Escape') { pi.value = this.currentPage(); pi.blur(); }
    });
    pi.addEventListener('focus', () => pi.select());
    pi.addEventListener('blur', () => { pi.value = this.pages.length ? this.currentPage() : 1; });

    // Selecting across gaps: pdf.js trick, text layer gets a class while the mouse is down
    document.addEventListener('mouseup', () => $$('.textLayer.selecting', this.pagesEl).forEach(t => t.classList.remove('selecting')));

    // Keep "fit to width" fitted when the window or the notes panel changes size,
    // but only if the user never picked a zoom level of their own.
    const refit = debounce(() => {
      if (this.article && !this.article.view.scale && this.pages.length) this.setScale(this.fitScale(), { fit: true });
    }, 250);
    new ResizeObserver(refit).observe(sc);
  }
};
