'use strict';
/* Notes sidebar: Highlights tab (list, notes, colour filter), About tab (info, summary,
   critical questions, free notes), tab switching, panel resize and collapse. */

const Notes = {
  article: null,
  filter: new Set(),        // colours currently shown; empty = all
  activeId: null,

  bind(article) {
    this.article = article;
    this.filter.clear();
    this.activeId = null;
  },

  /** Called after any edit. Saves and keeps the library data fresh. */
  changed() { Autosave.touch(); },

  sorted() {
    return [...this.article.highlights].sort((a, b) =>
      a.page - b.page || (a.rects[0] ? a.rects[0].y : 0) - (b.rects[0] ? b.rects[0].y : 0) || (a.rects[0] ? a.rects[0].x : 0) - (b.rects[0] ? b.rects[0].x : 0));
  },

  renderAll() {
    this.renderLegend();
    this.renderHighlights();
    this.renderAbout();
  },

  /* ================= Highlights tab ================= */
  renderLegend() {
    const a = this.article;
    if (!a) return;
    $('#legend').replaceChildren(...COLORS.map(c => {
      const n = a.highlights.filter(x => x.color === c).length;
      return h('button', {
        type: 'button', class: 'chip', 'aria-pressed': this.filter.has(c) ? 'true' : 'false',
        title: this.filter.has(c) ? 'Showing only this colour. Click to remove the filter.' : 'Show only this colour',
        onclick: () => { this.filter.has(c) ? this.filter.delete(c) : this.filter.add(c); this.renderLegend(); this.renderHighlights(); }
      }, h('span', { class: 'dot', style: { '--hl': `var(--c-${c})` } }), Settings.label(c), h('span', { class: 'n', text: n }));
    }));
  },

  renderHighlights() {
    const a = this.article;
    if (!a) return;
    $('#hl-count').textContent = a.highlights.length;
    const items = this.sorted().filter(x => !this.filter.size || this.filter.has(x.color));
    $('#hl-list').replaceChildren(...items.map(x => this._item(x)));
    const empty = $('#hl-empty');
    empty.hidden = items.length > 0;
    empty.textContent = a.highlights.length
      ? 'No highlights in this colour.'
      : (a.hasText === false
        ? 'This PDF is a scan without a text layer, so text can’t be highlighted.'
        : 'Select text in the article to highlight it. Each highlight gets its own note here.');
    $$('textarea', $('#hl-list')).forEach(autosize);
    this.renderLegend();
    this.updateLinkOptions();
  },

  _item(x) {
    const long = x.text.length > 170;
    const label = Settings.label(x.color);
    const noteId = 'note-' + x.id;
    const li = h('li', { class: 'hl-item' + (x.id === this.activeId ? ' active' : ''), dataset: { id: x.id }, style: { '--hl': `var(--c-${x.color})` } });
    const quote = h('button', {
      type: 'button', class: 'hl-quote' + (long ? ' clamp' : ''),
      title: 'Show in article',
      onclick: () => this.reveal(x.id, { scroll: true })
    }, h('span', { text: x.text }));
    li.append(...[
      h('div', { class: 'hl-meta' },
        h('button', {
          type: 'button', class: 'dot-btn', title: `${label}. Click to change colour.`,
          'aria-label': `Colour: ${label}. Click to change colour.`,
          onclick: () => this.cycleColor(x.id)
        }, h('span', { class: 'dot' })),
        h('span', { class: 'hl-page', text: 'p. ' + x.page }),
        h('span', { class: 'hl-label', text: label }),
        h('button', { type: 'button', class: 'icon-btn danger-hover', 'aria-label': 'Delete highlight', title: 'Delete highlight', html: icon('trash', 16), onclick: () => this.deleteHighlight(x.id) })),
      quote,
      long ? h('button', {
        type: 'button', class: 'more', text: 'Show more', 'aria-expanded': 'false',
        onclick: e => {
          const open = quote.classList.toggle('clamp') === false;
          e.target.textContent = open ? 'Show less' : 'Show more';
          e.target.setAttribute('aria-expanded', open);
        }
      }) : null,
      h('label', { class: 'sr-only', for: noteId, text: `Note for the highlight on page ${x.page}` }),
      h('textarea', {
        id: noteId, class: 'hl-note', rows: 1, placeholder: 'Write a note…', value: x.note || '',
        oninput: e => { x.note = e.target.value; x.updatedAt = Date.now(); autosize(e.target); this.changed(); },
        onfocus: () => this.setActive(x.id)
      })].filter(Boolean));
    const ta = $('textarea', li); ta.value = x.note || '';
    return li;
  },

  setActive(id) {
    this.activeId = id;
    $$('.hl-item', $('#hl-list')).forEach(li => li.classList.toggle('active', li.dataset.id === id));
    Reader.setActive(id);
  },

  /** Show a highlight in the sidebar (and optionally in the article). */
  reveal(id, { focusNote = false, scroll = false } = {}) {
    const x = this.article.highlights.find(q => q.id === id);
    if (!x) return;
    this.openSidebar();
    this.showTab('highlights');
    if (this.filter.size && !this.filter.has(x.color)) { this.filter.clear(); this.renderHighlights(); }
    this.setActive(id);
    const li = $(`.hl-item[data-id="${id}"]`, $('#hl-list'));
    if (li) {
      li.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      autosize($('textarea', li));
      if (focusNote) $('textarea', li).focus({ preventScroll: true });
    }
    if (scroll) Reader.scrollToHighlight(x);
  },

  cycleColor(id) {
    const x = this.article.highlights.find(q => q.id === id);
    if (!x) return;
    x.color = COLORS[(COLORS.indexOf(x.color) + 1) % COLORS.length];
    x.updatedAt = Date.now();
    Reader.refreshHighlightLayer(x.page);
    this.renderHighlights();
    this.setActive(id);
    this.changed();
  },

  deleteHighlight(id) {
    const a = this.article;
    const idx = a.highlights.findIndex(q => q.id === id);
    if (idx < 0) return;
    const [x] = a.highlights.splice(idx, 1);
    if (this.activeId === id) { this.activeId = null; Reader.setActive(null); }
    Reader.refreshHighlightLayer(x.page);
    this.renderHighlights();
    this.changed();
    toast('Highlight deleted', {
      actionLabel: 'Undo',
      onAction: () => {
        if (this.article !== a) return;
        a.highlights.splice(Math.min(idx, a.highlights.length), 0, x);
        Reader.refreshHighlightLayer(x.page);
        this.renderHighlights();
        this.changed();
      }
    });
  },

  /* ================= About tab ================= */
  _get(path) { return path.split('.').reduce((o, k) => o[k], this.article); },
  _set(path, v) { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], this.article)[last] = v; },

  renderAbout() {
    const a = this.article;
    if (!a) return;
    $$('[data-field]', $('#about-form')).forEach(el => {
      const v = this._get(el.dataset.field);
      el.value = Array.isArray(v) ? v.join(', ') : (v || '');
    });
    this.renderQuestions();
  },

  renderQuestions() {
    const a = this.article;
    const list = $('#q-list');
    list.replaceChildren(...a.questions.map((q, i) => this._question(q, i)));
    $$('textarea', list).forEach(autosize);
    this.updateLinkOptions();
  },

  _question(q, i) {
    const a = this.article;
    const last = a.questions.length - 1;
    const tid = 'q-text-' + q.id, sid = 'q-link-' + q.id;
    const ta = h('textarea', {
      id: tid, class: 'q-text', rows: 2, placeholder: 'What would you ask the author?', 'aria-label': `Question ${i + 1}`,
      oninput: e => { q.text = e.target.value; autosize(e.target); this.changed(); }
    });
    ta.value = q.text || '';
    const sel = h('select', {
      id: sid, class: 'q-select', 'aria-label': `Linked highlight for question ${i + 1}`,
      onchange: e => { q.highlightId = e.target.value || null; this.changed(); this._syncGoto(li, q); }
    });
    const go = h('button', {
      type: 'button', class: 'icon-btn', 'aria-label': 'Show linked highlight', title: 'Show linked highlight', html: icon('jump', 16),
      onclick: () => { const x = a.highlights.find(z => z.id === q.highlightId); if (x) this.reveal(x.id, { scroll: true }); }
    });
    const li = h('li', { class: 'q-item', dataset: { id: q.id } },
      h('div', { class: 'q-row' },
        ta,
        h('div', { class: 'q-actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move question ${i + 1} up`, title: 'Move up', html: icon('chevron-up', 16), disabled: i === 0, onclick: () => this.moveQuestion(q.id, -1) }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move question ${i + 1} down`, title: 'Move down', html: icon('chevron-down', 16), disabled: i === last, onclick: () => this.moveQuestion(q.id, 1) }),
          h('button', { type: 'button', class: 'icon-btn danger-hover', 'aria-label': `Delete question ${i + 1}`, title: 'Delete question', html: icon('trash', 16), onclick: () => this.deleteQuestion(q.id) }))),
      h('div', { class: 'q-link' }, h('label', { for: sid, text: 'Linked highlight' }), sel, go));
    this._syncGoto(li, q);
    return li;
  },

  _syncGoto(li, q) {
    const ok = q.highlightId && this.article.highlights.some(x => x.id === q.highlightId);
    $('.q-link .icon-btn', li).hidden = !ok;
  },

  /** Rebuild the options of every "linked highlight" dropdown (highlights may have changed). */
  updateLinkOptions() {
    const a = this.article;
    if (!a) return;
    const hls = this.sorted();
    $$('.q-item', $('#q-list')).forEach(li => {
      const q = a.questions.find(z => z.id === li.dataset.id);
      if (!q) return;
      const sel = $('select', li);
      sel.replaceChildren(
        h('option', { value: '', text: 'None' }),
        ...hls.map(x => h('option', { value: x.id, text: `p. ${x.page}: ${x.text.length > 60 ? x.text.slice(0, 57) + '…' : x.text}` })));
      sel.value = q.highlightId && hls.some(x => x.id === q.highlightId) ? q.highlightId : '';
      this._syncGoto(li, q);
    });
  },

  addQuestion() {
    const q = { id: uid(), text: '', highlightId: null };
    this.article.questions.push(q);
    this.renderQuestions();
    this.changed();
    const ta = $(`#q-text-${q.id}`);
    if (ta) ta.focus();
  },
  moveQuestion(id, dir) {
    const qs = this.article.questions;
    const i = qs.findIndex(q => q.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    this.renderQuestions();
    this.changed();
    // keep keyboard focus on the same button
    const btn = $$('.q-item', $('#q-list'))[j];
    if (btn) $$('.q-actions .icon-btn', btn)[dir < 0 ? 0 : 1].focus();
  },
  deleteQuestion(id) {
    const qs = this.article.questions;
    const i = qs.findIndex(q => q.id === id);
    if (i < 0) return;
    const [q] = qs.splice(i, 1);
    this.renderQuestions();
    this.changed();
    toast('Question deleted', { actionLabel: 'Undo', onAction: () => { qs.splice(Math.min(i, qs.length), 0, q); this.renderQuestions(); this.changed(); } });
  },

  /* ================= tabs / panel ================= */
  showTab(name) {
    const hl = name === 'highlights';
    $('#tab-highlights').setAttribute('aria-selected', hl);
    $('#tab-highlights').tabIndex = hl ? 0 : -1;
    $('#tab-about').setAttribute('aria-selected', !hl);
    $('#tab-about').tabIndex = hl ? -1 : 0;
    $('#panel-highlights').hidden = !hl;
    $('#panel-about').hidden = hl;
    if (!hl) $$('textarea.q-text', $('#q-list')).forEach(autosize);
  },

  openSidebar() { this.setSidebar(true); },
  setSidebar(open) {
    $('#r-body').classList.toggle('collapsed', !open);
    $('#btn-sidebar').setAttribute('aria-pressed', open);
    try { localStorage.setItem('marginalia-sidebar', open ? 'open' : 'closed'); } catch (e) { /* optional */ }
  },
  initialSidebarState() {
    let saved = null;
    try { saved = localStorage.getItem('marginalia-sidebar'); } catch (e) { /* optional */ }
    if (saved) return saved === 'open';
    return window.innerWidth >= 1280;      // narrower windows start with the panel tucked away
  },

  setWidth(px, persist = true) {
    const max = Math.min(720, Math.round(window.innerWidth * 0.6));
    px = Math.round(Math.min(Math.max(px, 300), max));
    document.documentElement.style.setProperty('--sidebar-w', px + 'px');
    if (persist) try { localStorage.setItem('marginalia-sidebar-w', px); } catch (e) { /* optional */ }
    return px;
  },

  init() {
    // tabs
    const tabs = [$('#tab-highlights'), $('#tab-about')];
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => this.showTab(i ? 'about' : 'highlights'));
      t.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const j = i ? 0 : 1;
          this.showTab(j ? 'about' : 'highlights');
          tabs[j].focus();
        }
      });
    });

    // About form: one delegated handler for the plain fields
    $('#about-form').addEventListener('input', e => {
      const el = e.target.closest('[data-field]');
      if (!el || !this.article) return;
      const path = el.dataset.field;
      if (path === 'info.tags') this._set(path, el.value.split(',').map(s => s.trim()).filter(Boolean));
      else this._set(path, el.value);
      if (path === 'info.title') Reader.updateTitle();
      this.changed();
    });
    $('#q-add').addEventListener('click', () => this.addQuestion());

    // sidebar toggle
    $('#btn-sidebar').addEventListener('click', () => this.setSidebar($('#r-body').classList.contains('collapsed')));

    // resizer
    const rz = $('#resizer');
    const startW = () => $('#sidebar').getBoundingClientRect().width;
    rz.addEventListener('pointerdown', e => {
      e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      rz.classList.add('dragging');
      document.body.classList.add('resizing');
      const x0 = e.clientX, w0 = startW();
      const move = ev => this.setWidth(w0 + (x0 - ev.clientX), false);
      const up = ev => {
        rz.releasePointerCapture(e.pointerId);
        rz.removeEventListener('pointermove', move);
        rz.removeEventListener('pointerup', up);
        rz.classList.remove('dragging');
        document.body.classList.remove('resizing');
        this.setWidth(startW());
      };
      rz.addEventListener('pointermove', move);
      rz.addEventListener('pointerup', up);
    });
    rz.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      this.setWidth(startW() + (e.key === 'ArrowLeft' ? 24 : -24));
    });

    let w = 400;
    try { w = parseInt(localStorage.getItem('marginalia-sidebar-w'), 10) || 400; } catch (e) { /* optional */ }
    this.setWidth(w, false);

    Settings.onChange(() => { if (this.article) { this.renderLegend(); this.renderHighlights(); } });
  }
};
