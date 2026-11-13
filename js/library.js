'use strict';
/* Library screen: list, search, upload (button, drop zone, whole-window drop), delete. */

const Library = {
  articles: [],
  query: '',

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
    try { this.articles = await DB.listArticles(); }
    catch (e) { console.error(e); toast('Could not open your library. Is storage blocked in this browser?'); this.articles = []; }
    this.articles.sort((a, b) => b.addedAt - a.addedAt);
    this.render();
  },

  _haystack(a) {
    const i = a.info;
    return [
      displayTitle(a), a.fileName, i.authors, i.source, i.year, (i.tags || []).join(' '),
      a.summary, a.freeNotes,
      ...a.questions.map(q => q.text),
      ...a.highlights.map(x => x.note + ' ' + x.text)
    ].join('\n').toLowerCase();
  },

  render() {
    const q = this.query.trim().toLowerCase();
    const list = $('#article-list');
    const shown = q ? this.articles.filter(a => this._haystack(a).includes(q)) : this.articles;

    list.replaceChildren(...shown.map(a => this._row(a)));

    const empty = $('#lib-empty');
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      empty.textContent = this.articles.length
        ? `Nothing matches “${this.query.trim()}”.`
        : 'No articles yet. Add a PDF to start reading.';
    }
    $('#lib-count').textContent = this.articles.length
      ? (q ? `${shown.length} of ${this.articles.length} articles` : `${this.articles.length} ${this.articles.length === 1 ? 'article' : 'articles'}`)
      : '';
  },

  _row(a) {
    const title = displayTitle(a);
    const sub = [a.info.authors, a.info.year, a.info.source].map(s => (s || '').trim()).filter(Boolean).join(' · ');
    const n = a.highlights.length;
    return h('li', { class: 'art', dataset: { id: a.id } },
      h('a', { class: 'art-main', href: '#/article/' + encodeURIComponent(a.id) },
        h('span', { class: 'art-thumb', style: a.thumb ? { 'background-image': `url(${a.thumb})` } : {}, 'aria-hidden': 'true' }),
        h('span', { class: 'art-text' },
          h('span', { class: 'art-title', text: title }),
          sub ? h('span', { class: 'art-sub', text: sub }) : null)),
      h('span', { class: 'art-meta' },
        h('span', { class: 'art-count', text: `${n} ${n === 1 ? 'highlight' : 'highlights'}` }),
        h('span', { class: 'art-date', text: 'Added ' + formatDate(a.addedAt) })),
      h('button', {
        type: 'button', class: 'icon-btn danger-hover', 'aria-label': `Delete ${title}`, title: 'Delete article',
        html: icon('trash'),
        onclick: () => this.remove(a)
      }));
  },

  async remove(a) {
    const n = a.highlights.length;
    const extra = n ? ` Its ${n} ${n === 1 ? 'highlight' : 'highlights'} and notes will be deleted too.` : '';
    if (!await confirmDialog(`Delete “${displayTitle(a)}”?${extra} This can’t be undone.`, 'Delete article')) return;
    await DB.deleteArticle(a.id);
    toast('Article deleted');
    await this.refresh();
  },

  /** Add PDFs from a FileList. Opens the reader when exactly one file was added. */
  async addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* optional */ }
    const added = [];
    for (const file of files) {
      if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { toast(`“${file.name}” is not a PDF.`); continue; }
      try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        const article = newArticle(file.name, pdf.numPages);
        article.thumb = await this.makeThumb(pdf);
        pdf.destroy();
        await DB.addArticle(article, new Blob([buf], { type: 'application/pdf' }));
        added.push(article);
      } catch (err) {
        console.error(err);
        toast(`Could not read “${file.name}”. The file may be damaged or password protected.`);
      }
    }
    if (!added.length) return;
    if (added.length === 1) { location.hash = '#/article/' + encodeURIComponent(added[0].id); return; }
    toast(`Added ${added.length} PDFs`);
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
