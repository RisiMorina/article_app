'use strict';
/* Library screen: reading list, folders, list, search, upload (button, drop zone, whole-window drop), delete. */

const Library = {
  articles: [],
  folders: [],          // folder names, in the order the user made them
  query: '',
  filter: 'all',        // 'all' | 'toread' | 'unsorted' | 'folder:<name>'

  hideAll() { $('#view-welcome').hidden = true; $('#view-library').hidden = true; },

  updateGreeting() {
    const g = $('#greet'), n = Settings.name();
    g.hidden = !n;
    g.textContent = n ? `Hi ${n},` : '';
  },

  async showWelcome() {
    this.hideAll();
    this.updateGreeting();
    $('#view-welcome').hidden = false;
    document.title = 'Marginalia: read and annotate PDFs';
    try { this.articles = await DB.listArticles(); this.folders = await DB.getSetting('folders', []); } catch (e) { this.articles = []; }
    for (const a of this.articles) if (a.folder && !this._hasFolder(a.folder)) this.folders.push(a.folder);
    this.renderHero();
    const n = this.articles.length;
    $('#welcome-library').hidden = n === 0;
    $('#welcome-library').textContent = `Open my library (${n})`;
    const queued = this.articles.filter(a => a.toRead).length;
    const tr = $('#welcome-toread');
    tr.hidden = queued === 0;
    tr.textContent = `Reading list (${queued})`;
    tr.onclick = () => { this.filter = 'toread'; };
    $('#welcome-library').onclick = () => { this.filter = 'all'; };
    const last = [...this.articles].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const c = $('#welcome-continue');
    c.hidden = !last;
    if (last) {
      c.href = '#/article/' + encodeURIComponent(last.id);
      $('#continue-title').textContent = displayTitle(last);
      $('.continue-thumb', c).style.backgroundImage = last.thumb ? `url(${last.thumb})` : '';
    }
  },

  /** Small JPEG of page 1 for the library and the welcome card. */
  async makeThumb(pdf) {
    try {
      const page = await pdf.getPage(1);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 150 / vp0.width });
      const canvas = h('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch (e) { return null; }
  },

  async show() {
    this.hideAll();
    $('#view-library').hidden = false;
    document.title = 'Marginalia: read and annotate PDFs';
    await this.refresh();
  },

  async refresh() {
    try {
      this.articles = await DB.listArticles();
      this.folders = await DB.getSetting('folders', []);
    } catch (e) { console.error(e); toast('Could not open your library. Is storage blocked in this browser?'); this.articles = []; }
    // Folders that only exist on articles (for example after an import) still show up.
    for (const a of this.articles) if (a.folder && !this._hasFolder(a.folder)) this.folders.push(a.folder);
    // A filter that points at a folder that is gone falls back to all.
    if (this.filter.startsWith('folder:') && !this._hasFolder(this.filter.slice(7))) this.filter = 'all';
    this.articles.sort((a, b) => b.addedAt - a.addedAt);
    this._refreshView();
  },

  /** Redraw whichever screen is showing (start screen hero or library). */
  _refreshView() { if (!$('#view-welcome').hidden) this.renderHero(); else this.render(); },

  /** The start screen's first screen: a library room. Two photographed bookcases stand in a 90 degree corner (CSS 3D). */
  renderHero() {
    const shelves = this._cases('', 'all');
    const slots = this._slotsFor(shelves);
    const per = this.SLOTS.length;
    const box = $('#hero-shelves');
    const vh = window.innerHeight, vw = window.innerWidth;
    const PW = 560;                                        // photo width in px before the room is scaled to fit
    box.classList.toggle('intro', !this._heroShown);
    this._heroShown = true;
    // The hero shows the first two cases; the library page shows all of them.
    const left = h('div', { class: 'wall left' }, this._pcase(slots.slice(0, per), 'left', PW));
    const right = h('div', { class: 'wall right' }, this._pcase(slots.slice(per, per * 2), 'right', PW));
    box.replaceChildren(h('div', { class: 'stage' },
      h('div', { class: 'floor', 'aria-hidden': 'true' }, h('div', { class: 'rug' })),
      left, right));
    $$('.book', box).forEach((b, i) => b.style.setProperty('--i', i));
    // Fit the whole room on the first screen (the outer edges come closer in perspective, so leave 50% room).
    const sh = $('.stage', box).offsetHeight || 900;
    box.style.setProperty('--rs', Math.min(1, vw / 1250, (vh - 40) / (sh * 1.3)).toFixed(3));
  },

  /** Flat tooltip for hero books (the cabinets are tilted in 3D, so a card inside them would be skewed). */
  initHeroTip() {
    const box = $('#hero-shelves'), tip = $('#hero-tip');
    box.addEventListener('mouseover', e => {
      const book = e.target.closest('.book');
      if (!book) return;
      $('.tip-title', tip).textContent = book.dataset.title;
      $('.tip-sub', tip).textContent = book.dataset.sub || '';
      tip.hidden = false;
      const r = book.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(Math.max(r.left + r.width / 2 - tw / 2, 8), window.innerWidth - tw - 8) + 'px';
      tip.style.top = (r.top - th - 14 < 8 ? r.bottom + 14 : r.top - th - 14) + 'px';
    });
    box.addEventListener('mouseout', e => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.book')) tip.hidden = true; });
  },

  _hasFolder(name) { return this.folders.some(f => f.toLowerCase() === name.toLowerCase()); },
  _saveFolders() { return DB.setSetting('folders', [...this.folders]); },

  _haystack(a) {
    const i = a.info;
    return [
      displayTitle(a), a.fileName, a.folder, i.authors, i.source, i.year, (i.tags || []).join(' '),
      a.summary, a.freeNotes,
      ...a.questions.map(q => q.text),
      ...a.highlights.map(x => x.note + ' ' + x.text)
    ].join('\n').toLowerCase();
  },

  _inView(a) {
    const f = this.filter;
    if (f === 'toread') return !!a.toRead;
    if (f === 'unsorted') return !a.folder;
    if (f.startsWith('folder:')) return a.folder === f.slice(7);
    return true;
  },

  _viewTitle() {
    const f = this.filter;
    if (f === 'toread') return 'Reading list';
    if (f === 'unsorted') return 'No folder';
    if (f.startsWith('folder:')) return f.slice(7);
    return 'My library';
  },

  _navItem(key, label, count, iconName) {
    return h('li', null,
      h('button', {
        type: 'button', class: 'folder-btn', 'aria-current': this.filter === key ? 'true' : null,
        onclick: () => { this.filter = key; this.render(); }
      },
        h('span', { class: 'folder-ic', html: icon(iconName, 16) }),
        h('span', { class: 'folder-label', text: label }),
        h('span', { class: 'folder-n', text: String(count) })));
  },

  renderNav() {
    const all = this.articles;
    const items = [
      this._navItem('all', 'Whole library', all.length, 'inbox'),
      this._navItem('toread', 'Reading list', all.filter(a => a.toRead).length, 'bookmark'),
      h('li', { class: 'folder-sep', role: 'presentation' }, h('span', { text: 'Folders' }))
    ];
    for (const f of this.folders) items.push(this._navItem('folder:' + f, f, all.filter(a => a.folder === f).length, 'folder'));
    if (all.some(a => !a.folder) && this.folders.length) items.push(this._navItem('unsorted', 'No folder', all.filter(a => !a.folder).length, 'folder'));
    $('#folder-nav').replaceChildren(...items);
    if (!this.folders.length) {
      $('#folder-nav').append(h('li', { class: 'folder-hint', text: 'Make a folder for each topic, then sort your articles into it.' }));
    }
  },

  /** Shelves to draw for the current view: [{ title, folder (undefined = no drop), books }]. One shelf per folder. */
  _cases(q, f = this.filter) {
    const all = this.articles;
    let cases;
    if (f === 'toread') cases = [{ title: 'Reading list', books: all.filter(a => a.toRead) }];
    else if (f === 'unsorted') cases = [{ title: 'No folder', folder: '', books: all.filter(a => !a.folder) }];
    else if (f.startsWith('folder:')) { const n = f.slice(7); cases = [{ title: n, folder: n, books: all.filter(a => a.folder === n) }]; }
    else {
      cases = this.folders.map(n => ({ title: n, folder: n, books: all.filter(a => a.folder === n) }));
      const loose = all.filter(a => !a.folder);
      if (loose.length || !this.folders.length) cases.push({ title: this.folders.length ? 'No folder' : 'My books', folder: '', books: loose });
    }
    if (q) cases = cases.map(c => ({ ...c, books: c.books.filter(a => this._haystack(a).includes(q)) })).filter(c => c.books.length);
    return cases;
  },

  render() {
    this.renderNav();
    const q = this.query.trim().toLowerCase();
    const inView = this.articles.filter(a => this._inView(a));
    const cases = this._cases(q);
    const shownCount = cases.reduce((n, c) => n + c.books.length, 0);

    $('#lib-view-title').textContent = this._viewTitle();
    $('#folder-tools').hidden = !this.filter.startsWith('folder:');

    // Every folder is a shelf of a photographed bookcase (5 shelves per case); more folders mean more cases.
    const W = $('#shelves').clientWidth || 760;
    const pw = Math.max(Math.min(640, W - 140), 300);
    const slots = this._slotsFor(cases);
    const groups = [];
    for (let i = 0; i < slots.length; i += this.SLOTS.length) groups.push(slots.slice(i, i + this.SLOTS.length));
    const box = $('#shelves');
    box.className = 'shelves';
    box.replaceChildren(...groups.map(g => this._pcase(g, 'left', pw)));

    const empty = $('#lib-empty');
    empty.hidden = shownCount > 0 || (!q && this.filter !== 'toread' && !!this.articles.length);
    if (!shownCount) {
      if (q) empty.textContent = `Nothing matches “${this.query.trim()}”.`;
      else if (!this.articles.length) empty.textContent = 'No books yet. Add a PDF and it goes on your shelf and your reading list.';
      else if (this.filter === 'toread') empty.textContent = 'Your reading list is empty. Hover a book and use “To read” to put it here.';
      else empty.textContent = '';
    }
    $('#lib-count').textContent = inView.length
      ? (q ? `${shownCount} of ${inView.length}` : `${inView.length} ${inView.length === 1 ? 'article' : 'articles'}`)
      : '';
  },

  /* ---------- bookcases (a photo of an empty case; the books are real 3D boxes standing on its shelves) ---------- */
  _hash(s) { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; },

  // The case photo is 880 x 1168 "units". Shelf floors and compartment heights were measured on images/case.webp.
  SLOTS: [{ floor: 298, h: 175 }, { floor: 470, h: 136 }, { floor: 636, h: 134 }, { floor: 806, h: 134 }, { floor: 964, h: 120 }],
  CASE: { w: 880, h: 1168, left: 160, inner: 557 },
  ROW_CAP: 547,                                  // usable width of one shelf, in units

  /** Turn shelves (folders) into slots, one per row of books. A full folder takes several slots. */
  _slotsFor(cases) {
    const out = [];
    for (const c of cases) {
      const rows = [[]];
      let used = 0;
      for (const a of c.books) {
        const w = this._bookWidth(a) + 5;
        if (used + w > this.ROW_CAP && rows.at(-1).length) { rows.push([]); used = 0; }
        rows.at(-1).push(a);
        used += w;
      }
      rows.forEach((r, i) => out.push({ title: i === 0 ? c.title : '', folder: c.folder, count: c.books.length, row: r, first: i === 0, key: c.title + ':' + i }));
    }
    return out;
  },

  /** One bookcase: the photo, and one slot per shelf with its label and its books. */
  _pcase(slots, side, pw) {
    const C = this.CASE;
    const padded = slots.slice();
    while (padded.length < this.SLOTS.length) padded.push({ blank: true, row: [], key: 'blank' + padded.length });
    return h('div', { class: 'pcase ' + side, style: { '--pw': pw + 'px', '--u': (pw / C.w) + 'px' } },
      h('img', { class: 'pcase-img pcase-back', src: 'images/case-back.webp', alt: '', draggable: 'false' }),
      h('span', { class: 'cs cs-il', 'aria-hidden': 'true' }), h('span', { class: 'cs cs-ir', 'aria-hidden': 'true' }),
      h('span', { class: 'cs cs-ol', 'aria-hidden': 'true' }), h('span', { class: 'cs cs-or', 'aria-hidden': 'true' }),
      ...padded.map((s, i) => this._pslot(s, i, side)),
      h('img', { class: 'pcase-img pcase-front', src: 'images/case-frame.webp', alt: '', draggable: 'false' }));
  },

  _pslot(s, i, side) {
    const C = this.CASE, g = this.SLOTS[i];
    const droppable = s.folder !== undefined && !s.blank;
    const label = !s.title ? null : h('div', { class: 'shelf-label' },
      h('button', {
        type: 'button', class: 'case-name', text: s.title, title: 'Show only this shelf',
        onclick: () => { this.filter = s.title === 'Reading list' && s.folder === undefined ? 'toread' : s.folder ? 'folder:' + s.folder : this.folders.length ? 'unsorted' : 'all'; this.render(); }
      }),
      h('span', { class: 'case-n', text: `${s.count} ${s.count === 1 ? 'book' : 'books'}` }));
    const empty = !s.blank && s.first && !s.count;
    const el = h('div', {
      class: 'pslot', style: { bottom: ((C.h - g.floor) / C.h * 100) + '%', height: (g.h / C.h * 100) + '%' }
    },
      label,
      h('ul', { class: 'books', style: { left: (C.left / C.w * 100) + '%', width: (C.inner / C.w * 100) + '%' } },
        ...this._rowItems(s.row, s.key, side),
        empty ? h('li', { class: 'shelf-empty', text: droppable ? 'Empty. Drag a book here.' : 'Nothing here yet.' }) : null));
    if (droppable) {
      el.addEventListener('dragover', e => {
        if (!Array.from(e.dataTransfer.types || []).includes('text/x-article')) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop');
      });
      el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
      el.addEventListener('drop', e => {
        const id = e.dataTransfer.getData('text/x-article');
        el.classList.remove('drop');
        const a = this.articles.find(x => x.id === id);
        if (!a) return;
        e.preventDefault();
        if ((a.folder || '') !== s.folder) this.moveTo(a, s.folder);
      });
    }
    return el;
  },

  /** One row, arranged like a real shelf: mostly standing, the odd book leaning on its neighbour, and a short stack lying
      flat at the end. Decided from a hash of the ids, so it looks the same on every visit. */
  _rowItems(books, key, side) {
    const n = books.length;
    const seed = this._hash(key + ':' + n);
    let stack = [];
    let standing = books;
    if (n >= 4 && seed % 2 === 0) { const k = Math.min(3, n - 2); standing = books.slice(0, n - k); stack = books.slice(n - k); }
    const items = standing.map((a, i) => {
      const hh = this._hash(a.id + 'lean');
      let deg = 0;
      if (i === standing.length - 1 && standing.length > 1 && !stack.length) deg = -(13 + hh % 9);
      else if (i < standing.length - 1 && hh % 6 === 0) deg = 7 + (hh >>> 4) % 9;
      return this._book(a, side === 'right', { lean: deg });
    });
    if (stack.length) {
      items.push(h('li', { class: 'stack' }, ...stack.map(a => {
        const hh = this._hash(a.id + 'flat');
        const len = 112 + hh % 30, thick = Math.max(16, Math.round(this._bookWidth(a) * 0.6));
        return this._book(a, side === 'right', { flat: true, len, thick, off: (hh >>> 6) % 6, tilt: ((hh >>> 3) % 5 - 2) * 0.5 });
      })));
    }
    return items;
  },

  // Book sizes are in case-photo units (see CASE): thicker for longer articles, a little height variety.
  _bookWidth(a) { return Math.round(Math.min(Math.max(22 + (a.numPages || 8) * 0.4, 25), 52)); },
  _bookHeight(a) { return 98 + (this._hash(a.id) % 5) * 5; },
  _palette: [
    ['#6b2530', '#f0dca4'], ['#2f4a36', '#f0dca4'], ['#26364f', '#f0dca4'], ['#5a3a24', '#f0dca4'], ['#a7782c', '#2b1d08'],
    ['#2f5b5c', '#f0dca4'], ['#512f4c', '#f0dca4'], ['#b79b6c', '#2b2210'], ['#575a2b', '#f0dca4'], ['#3c4d66', '#f0dca4'],
    ['#7a3b22', '#f0dca4'], ['#1f2a24', '#e6cf93'], ['#8b2f2a', '#f3e2b4'], ['#44352a', '#e6cf93']
  ],
  _spine(a) { return this._palette[this._hash(a.id + 'x') % this._palette.length]; },

  _book(a, alignRight, opt = {}) {
    const title = displayTitle(a);
    const sub = [a.info.authors, a.info.year, a.info.source].map(s => (s || '').trim()).filter(Boolean).join(' · ');
    const n = a.highlights.length;
    const [bg, fg] = this._spine(a);
    const select = h('select', {
      class: 'art-folder', 'aria-label': `Folder for ${title}`, title: 'Move to a folder',
      onchange: e => this.moveTo(a, e.target.value)
    },
      h('option', { value: '', text: 'No folder' }),
      ...this.folders.map(f => h('option', { value: f, text: f })),
      h('option', { value: '__new__', text: 'New folder…' }));
    select.value = a.folder || '';
    const href = '#/article/' + encodeURIComponent(a.id);
    const lean = opt.lean || 0;
    const style = { '--bw': opt.flat ? opt.len : this._bookWidth(a), '--bh': opt.flat ? opt.thick : this._bookHeight(a), '--bg': bg, '--fg': fg };
    style['--spine'] = 'url(' + new URL('images/spines/s' + String(1 + this._hash(a.id + 'sp') % 23).padStart(2, '0') + '.webp', document.baseURI).href + ')';
    if (lean) { style['--lean'] = lean + 'deg'; style['--ls'] = Math.abs(Math.sin(lean * Math.PI / 180)).toFixed(3); }
    if (opt.flat) { style['--off'] = opt.off; style['--tilt'] = opt.tilt + 'deg'; }
    const li = h(opt.flat ? 'div' : 'li', {
      class: 'book' + (a.toRead ? ' toread' : '') + (alignRight ? ' card-right' : '') + (opt.flat ? ' flat' : '') + (lean < 0 ? ' lean-l' : lean > 0 ? ' lean-r' : ''),
      dataset: { id: a.id, title, sub }, draggable: 'true', style
    },
      h('div', { class: 'body' },
        h('a', { class: 'spine', href, draggable: 'false', 'aria-label': title + (a.toRead ? ' (on your reading list)' : '') },
          h('span', { class: 'spine-title', text: title })),
        h('span', { class: 'face side-l', 'aria-hidden': 'true' }), h('span', { class: 'face side-r', 'aria-hidden': 'true' }), h('span', { class: 'face top', 'aria-hidden': 'true' })),
      h('div', { class: 'book-card' },
        h('a', { class: 'card-title', href, draggable: 'false', text: title }),
        sub ? h('span', { class: 'card-sub', text: sub }) : null,
        h('span', { class: 'card-meta', text: `${n} ${n === 1 ? 'highlight' : 'highlights'} · added ${formatDate(a.addedAt)}` }),
        h('div', { class: 'card-actions' },
          h('button', {
            type: 'button', class: 'toread-btn', 'aria-pressed': a.toRead ? 'true' : 'false',
            title: a.toRead ? 'On your reading list. Click to take it off.' : 'Put on your reading list',
            onclick: () => this.setToRead(a, !a.toRead)
          }, h('span', { html: icon('bookmark', 15) }), h('span', { text: 'To read' })),
          select,
          h('button', {
            type: 'button', class: 'icon-btn danger-hover', 'aria-label': `Delete ${title}`, title: 'Delete article',
            html: icon('trash'), onclick: () => this.remove(a)
          }))));
    li.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/x-article', a.id);
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    return li;
  },

  async setToRead(a, on) {
    a.toRead = on;
    await DB.putArticle(a);
    toast(on ? 'Added to your reading list' : 'Taken off your reading list');
    this._refreshView();
  },

  async moveTo(a, value) {
    if (value === '__new__') {
      const name = await this.askFolderName();
      if (!name) { this._refreshView(); return; }
      value = name;
    }
    a.folder = value;
    await DB.putArticle(a);
    this._refreshView();
    toast(value ? `Moved to “${value}”` : 'Taken out of its folder');
  },

  /* ---------- folders ---------- */

  /** Ask for a folder name in the dialog. Resolves to the final name, or null when cancelled. */
  askFolderName({ title = 'New folder', ok = 'Create folder', value = '', current = '' } = {}) {
    const dlg = $('#dlg-folder'), input = $('#folder-name'), err = $('#folder-error');
    $('#folder-dlg-title').textContent = title;
    $('#folder-ok').textContent = ok;
    input.value = value; err.hidden = true;
    return new Promise(resolve => {
      let result = null;
      const onSubmit = e => {
        e.preventDefault();
        const name = input.value.trim().replace(/\s+/g, ' ');
        if (!name) { err.textContent = 'Give the folder a name.'; err.hidden = false; return; }
        if (name.toLowerCase() !== current.toLowerCase() && this._hasFolder(name)) { err.textContent = 'You already have a folder with that name.'; err.hidden = false; return; }
        result = name; dlg.close();
      };
      const onCancel = () => dlg.close();
      $('#folder-form').addEventListener('submit', onSubmit);
      $('#folder-cancel').addEventListener('click', onCancel);
      dlg.addEventListener('close', async () => {
        $('#folder-form').removeEventListener('submit', onSubmit);
        $('#folder-cancel').removeEventListener('click', onCancel);
        if (result && !current && !this._hasFolder(result)) {
          this.folders.push(result);
          try { await this._saveFolders(); } catch (e) { console.error(e); }
        }
        resolve(result);
      }, { once: true });
      dlg.showModal();
      input.focus();
    });
  },

  async newFolder() {
    const name = await this.askFolderName();
    if (name) { this.filter = 'folder:' + name; this.render(); }
  },

  async renameFolder() {
    const old = this.filter.slice(7);
    const name = await this.askFolderName({ title: 'Rename folder', ok: 'Save', value: old, current: old });
    if (!name || name === old) return;
    this.folders = this.folders.map(f => f === old ? name : f);
    const moved = this.articles.filter(a => a.folder === old);
    for (const a of moved) { a.folder = name; await DB.putArticle(a); }
    await this._saveFolders();
    this.filter = 'folder:' + name;
    this.render();
  },

  async deleteFolder() {
    const name = this.filter.slice(7);
    const inside = this.articles.filter(a => a.folder === name);
    const extra = inside.length ? ` The ${inside.length} ${inside.length === 1 ? 'article' : 'articles'} in it stay in your library, without a folder.` : '';
    if (!await confirmDialog(`Delete the folder “${name}”?${extra}`, 'Delete folder')) return;
    for (const a of inside) { a.folder = ''; await DB.putArticle(a); }
    this.folders = this.folders.filter(f => f !== name);
    await this._saveFolders();
    this.filter = 'all';
    this.render();
  },

  async remove(a) {
    const n = a.highlights.length;
    const extra = n ? ` Its ${n} ${n === 1 ? 'highlight' : 'highlights'} and notes will be deleted too.` : '';
    if (!await confirmDialog(`Delete “${displayTitle(a)}”?${extra} This can’t be undone.`, 'Delete article')) return;
    await DB.deleteArticle(a.id);
    toast('Article deleted');
    await this.refresh();
  },

  /** Add PDFs from a FileList.
      In the library they go on the reading list (and into the open folder) without opening the reader.
      From the start screen, one file opens straight away. */
  async addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* optional */ }
    const inLibrary = !$('#view-library').hidden;
    const folder = this.filter.startsWith('folder:') ? this.filter.slice(7) : '';
    const added = [];
    for (const file of files) {
      if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { toast(`“${file.name}” is not a PDF.`); continue; }
      try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        const article = newArticle(file.name, pdf.numPages);
        article.thumb = await this.makeThumb(pdf);
        if (inLibrary) { article.toRead = true; article.folder = folder; }
        pdf.destroy();
        await DB.addArticle(article, new Blob([buf], { type: 'application/pdf' }));
        added.push(article);
      } catch (err) {
        console.error(err);
        toast(`Could not read “${file.name}”. The file may be damaged or password protected.`);
      }
    }
    if (!added.length) return;
    if (!inLibrary) {
      if (added.length === 1) { location.hash = '#/article/' + encodeURIComponent(added[0].id); return; }
      this.filter = 'all';
      toast(`Added ${added.length} PDFs`);
      location.hash = '#/library';
      return;
    }
    toast(added.length === 1 ? 'Added to your reading list' : `Added ${added.length} PDFs to your reading list`);
    await this.refresh();
  },

  init() {
    const fileInput = $('#file-input');
    $('#btn-upload').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { this.addFiles(fileInput.files); fileInput.value = ''; });

    const dz = $('#dropzone');
    dz.addEventListener('click', () => fileInput.click());
    $('#welcome-open').addEventListener('click', () => fileInput.click());
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });

    $('#search').addEventListener('input', e => { this.query = e.target.value; this.render(); });
    window.addEventListener('resize', debounce(() => { if (!$('#view-welcome').hidden || !$('#view-library').hidden) this._refreshView(); }, 200));
    this.initHeroTip();
    $('#hero-down').addEventListener('click', e => { e.preventDefault(); $('#welcome-more').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); });
    $('#btn-folder-new').addEventListener('click', () => this.newFolder());
    $('#btn-folder-rename').addEventListener('click', () => this.renameFolder());
    $('#btn-folder-delete').addEventListener('click', () => this.deleteFolder());

    // Whole-window drop while the library is showing
    const overlay = $('#drop-overlay');
    let depth = 0;
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const libraryOpen = () => !$('#view-library').hidden || !$('#view-welcome').hidden;
    document.addEventListener('dragenter', e => { if (libraryOpen() && hasFiles(e)) { depth++; overlay.hidden = false; dz.classList.add('over'); } });
    document.addEventListener('dragleave', e => { if (libraryOpen() && hasFiles(e) && --depth <= 0) { depth = 0; overlay.hidden = true; dz.classList.remove('over'); } });
    document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0; overlay.hidden = true; dz.classList.remove('over');
      if (libraryOpen()) this.addFiles(e.dataTransfer.files);
    });
  }
};
