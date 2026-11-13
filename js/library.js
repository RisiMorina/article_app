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
    try { this.articles = await DB.listArticles(); } catch (e) { this.articles = []; }
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
    this.render();
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
    return 'All articles';
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
      this._navItem('all', 'All articles', all.length, 'inbox'),
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

  render() {
    this.renderNav();
    const q = this.query.trim().toLowerCase();
    const list = $('#article-list');
    const inView = this.articles.filter(a => this._inView(a));
    const shown = q ? inView.filter(a => this._haystack(a).includes(q)) : inView;

    $('#lib-view-title').textContent = this._viewTitle();
    $('#folder-tools').hidden = !this.filter.startsWith('folder:');

    list.replaceChildren(...shown.map(a => this._row(a)));

    const empty = $('#lib-empty');
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      if (q) empty.textContent = `Nothing matches “${this.query.trim()}”.`;
      else if (!this.articles.length) empty.textContent = 'No articles yet. Add a PDF to start your reading list.';
      else if (this.filter === 'toread') empty.textContent = 'Your reading list is empty. Use “To read” on an article to put it here.';
      else if (this.filter.startsWith('folder:')) empty.textContent = 'This folder is empty. Use the folder menu on an article to move it here.';
      else empty.textContent = 'Nothing here.';
    }
    $('#lib-count').textContent = inView.length
      ? (q ? `${shown.length} of ${inView.length}` : `${inView.length} ${inView.length === 1 ? 'article' : 'articles'}`)
      : '';
  },

  _row(a) {
    const title = displayTitle(a);
    const sub = [a.info.authors, a.info.year, a.info.source].map(s => (s || '').trim()).filter(Boolean).join(' · ');
    const n = a.highlights.length;
    const select = h('select', {
      class: 'art-folder', 'aria-label': `Folder for ${title}`, title: 'Move to a folder',
      onchange: e => this.moveTo(a, e.target.value)
    },
      h('option', { value: '', text: 'No folder' }),
      ...this.folders.map(f => h('option', { value: f, text: f })),
      h('option', { value: '__new__', text: 'New folder…' }));
    select.value = a.folder || '';
    return h('li', { class: 'art', dataset: { id: a.id } },
      h('a', { class: 'art-main', href: '#/article/' + encodeURIComponent(a.id) },
        h('span', { class: 'art-thumb', style: a.thumb ? { 'background-image': `url(${a.thumb})` } : {}, 'aria-hidden': 'true' }),
        h('span', { class: 'art-text' },
          h('span', { class: 'art-title', text: title }),
          sub ? h('span', { class: 'art-sub', text: sub }) : null)),
      h('span', { class: 'art-meta' },
        h('span', { class: 'art-count', text: `${n} ${n === 1 ? 'highlight' : 'highlights'}` }),
        h('span', { class: 'art-date', text: 'Added ' + formatDate(a.addedAt) })),
      select,
      h('button', {
        type: 'button', class: 'toread-btn', 'aria-pressed': a.toRead ? 'true' : 'false',
        title: a.toRead ? 'On your reading list. Click to take it off.' : 'Put on your reading list',
        onclick: () => this.setToRead(a, !a.toRead)
      }, h('span', { html: icon('bookmark', 15) }), h('span', { text: 'To read' })),
      h('button', {
        type: 'button', class: 'icon-btn danger-hover', 'aria-label': `Delete ${title}`, title: 'Delete article',
        html: icon('trash'),
        onclick: () => this.remove(a)
      }));
  },

  async setToRead(a, on) {
    a.toRead = on;
    await DB.putArticle(a);
    toast(on ? 'Added to your reading list' : 'Taken off your reading list');
    this.render();
  },

  async moveTo(a, value) {
    if (value === '__new__') {
      const name = await this.askFolderName();
      if (!name) { this.render(); return; }
      value = name;
    }
    a.folder = value;
    await DB.putArticle(a);
    this.render();
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
