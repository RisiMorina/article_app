'use strict';
/* IndexedDB wrapper + debounced autosave.
   Stores:  articles (metadata, notes, highlights)  |  files (PDF bytes)  |  settings (key/value)
   The PDF blob lives in its own store so the library list never loads big files. */

const DB = (() => {
  const NAME = 'marginalia';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('articles', { keyPath: 'id' });
          db.createObjectStore('files', { keyPath: 'id' });
          db.createObjectStore('settings', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
      });
    }
    return dbPromise;
  }

  const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  async function run(stores, mode, fn) {
    const db = await open();
    const tx = db.transaction(stores, mode);
    const done = new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
    });
    const out = await fn(tx);
    await done;
    return out;
  }

  return {
    listArticles: () => run('articles', 'readonly', tx => wrap(tx.objectStore('articles').getAll())),
    getArticle: id => run('articles', 'readonly', tx => wrap(tx.objectStore('articles').get(id))),
    putArticle: article => run('articles', 'readwrite', tx => wrap(tx.objectStore('articles').put(article))),
    // The PDF is stored as an ArrayBuffer (not a Blob): that works in every browser's IndexedDB,
    // including Safari versions and engines that cannot store Blobs.
    getFile: id => run('files', 'readonly', tx => wrap(tx.objectStore('files').get(id)))
      .then(r => r && (r.data ? new Blob([r.data], { type: 'application/pdf' }) : r.blob)),
    addArticle: async (article, blob) => {
      const data = await blob.arrayBuffer();
      return run(['articles', 'files'], 'readwrite', tx => Promise.all([
        wrap(tx.objectStore('articles').put(article)),
        wrap(tx.objectStore('files').put({ id: article.id, data }))
      ]));
    },
    deleteArticle: id => run(['articles', 'files'], 'readwrite', tx => Promise.all([
      wrap(tx.objectStore('articles').delete(id)),
      wrap(tx.objectStore('files').delete(id))
    ])),
    async getSetting(key, fallback) {
      const r = await run('settings', 'readonly', tx => wrap(tx.objectStore('settings').get(key)));
      return r ? r.value : fallback;
    },
    setSetting: (key, value) => run('settings', 'readwrite', tx => wrap(tx.objectStore('settings').put({ key, value })))
  };
})();

/** Fresh article record. See CLAUDE.md for the data model. */
function newArticle(fileName, numPages) {
  const now = Date.now();
  return {
    id: uid(),
    fileName,
    addedAt: now,
    updatedAt: now,
    numPages: numPages || null,
    folder: '',                    // folder name, '' = unsorted
    toRead: false,                 // on the reading list
    hasText: null,                 // null = not checked yet, false = scan without text layer
    view: { page: 1, scale: null },
    info: { title: '', authors: '', year: '', source: '', link: '', tags: [] },
    summary: '',
    freeNotes: '',
    questions: [],                 // { id, text, highlightId|null }
    thumb: null,                   // small JPEG data URL of page 1 (library + welcome card)
    highlights: []                 // { id, page, text, rects[{x,y,w,h}], color, note, createdAt, updatedAt }
  };
}

function displayTitle(article) {
  return (article.info.title || '').trim() || fileBaseName(article.fileName);
}

/* ---------- Autosave ---------- */
const Autosave = {
  article: null,
  timer: null,
  dirty: false,
  inflight: null,
  visible: false,

  bind(article) { this.article = article; this.dirty = false; this.visible = false; this._ui('saved'); },
  unbind() { this.article = null; },

  /** Call after any change. silent = don't flip the indicator (e.g. scroll position). */
  touch(silent = false) {
    if (!this.article) return;
    if (!silent) { this.article.updatedAt = Date.now(); this.visible = true; this._ui('saving'); }
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), silent ? 1500 : 450);
  },

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.inflight) await this.inflight.catch(() => {});
    if (!this.dirty || !this.article) return;
    const article = this.article;
    this.dirty = false;
    this.inflight = DB.putArticle(article);
    try {
      await this.inflight;
      if (!this.dirty && this.article === article) this._ui('saved');
    } catch (err) {
      console.error('Autosave failed', err);
      this.dirty = true;
      this._ui('error');
      this.timer = setTimeout(() => this.flush(), 4000);
    } finally {
      this.inflight = null;
    }
    if (this.dirty && !this.timer) this.touch(true);
  },

  _ui(state) {
    const el = $('#save-state');
    if (!el) return;
    el.dataset.state = state;
    el.textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Could not save, retrying' : 'Saved';
  }
};

window.addEventListener('pagehide', () => Autosave.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Autosave.flush(); });
