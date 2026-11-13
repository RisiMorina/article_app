'use strict';
/* Export: Markdown / HTML of one article's notes, clipboard, print view,
   and full JSON backup + restore (PDFs as base64). */

const Exporter = {
  /* ---------- one article ---------- */
  /** Neutral structure that both the Markdown and the HTML writers use. */
  model(a) {
    const i = a.info;
    const sorted = [...a.highlights].sort((x, y) => x.page - y.page || (x.rects[0]?.y || 0) - (y.rects[0]?.y || 0) || (x.rects[0]?.x || 0) - (y.rects[0]?.x || 0));
    const info = [
      ['Authors', i.authors], ['Year', i.year], ['Source', i.source], ['Link', i.link], ['Tags', (i.tags || []).join(', ')]
    ].filter(([, v]) => (v || '').trim());
    return {
      title: displayTitle(a),
      info,
      summary: (a.summary || '').trim(),
      questions: a.questions.filter(q => (q.text || '').trim()).map(q => {
        const x = sorted.find(z => z.id === q.highlightId);
        return { text: q.text.trim(), link: x ? { page: x.page, text: x.text } : null };
      }),
      highlights: sorted.map(x => ({ page: x.page, text: x.text, label: Settings.label(x.color), note: (x.note || '').trim() })),
      free: (a.freeNotes || '').trim()
    };
  },

  toMarkdown(a) {
    const m = this.model(a);
    const short = (s, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
    const L = [`# ${m.title}`, ''];
    if (m.info.length) { m.info.forEach(([k, v]) => L.push(`- **${k}:** ${v.trim()}`)); L.push(''); }
    if (m.summary) L.push('## Summary', '', m.summary, '');
    if (m.questions.length) {
      L.push('## Critical questions', '');
      m.questions.forEach((q, i) => {
        L.push(`${i + 1}. ${q.text.replace(/\n+/g, ' ')}`);
        if (q.link) L.push(`   - Linked highlight (p. ${q.link.page}): “${short(q.link.text)}”`);
      });
      L.push('');
    }
    if (m.highlights.length) {
      L.push('## Highlights', '');
      m.highlights.forEach(x => {
        L.push(`> ${x.text}`, '>', `> p. ${x.page} · ${x.label}`, '');
        if (x.note) L.push(x.note, '');
      });
    }
    if (m.free) L.push('## Other notes', '', m.free, '');
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  },

  /** Same content as HTML, so pasting into Word or Notion keeps headings, quotes and lists. */
  toHtml(a) {
    const m = this.model(a);
    const e = escapeHtml;
    const para = s => s.split(/\n{2,}/).map(p => `<p>${e(p).replace(/\n/g, '<br>')}</p>`).join('');
    const short = (s, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
    let out = `<h1>${e(m.title)}</h1>`;
    if (m.info.length) out += '<ul>' + m.info.map(([k, v]) => `<li><b>${e(k)}:</b> ${e(v.trim())}</li>`).join('') + '</ul>';
    if (m.summary) out += `<h2>Summary</h2>${para(m.summary)}`;
    if (m.questions.length) {
      out += '<h2>Critical questions</h2><ol>' + m.questions.map(q =>
        `<li>${e(q.text)}${q.link ? `<ul><li>Linked highlight (p. ${q.link.page}): “${e(short(q.link.text))}”</li></ul>` : ''}</li>`).join('') + '</ol>';
    }
    if (m.highlights.length) {
      out += '<h2>Highlights</h2>' + m.highlights.map(x =>
        `<blockquote><p>${e(x.text)}</p><p><i>p. ${x.page} · ${e(x.label)}</i></p></blockquote>${x.note ? para(x.note) : ''}`).join('');
    }
    if (m.free) out += `<h2>Other notes</h2>${para(m.free)}`;
    return out;
  },

  async copy(a) {
    const md = this.toMarkdown(a);
    try {
      if (window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([md], { type: 'text/plain' }),
          'text/html': new Blob([this.toHtml(a)], { type: 'text/html' })
        })]);
      } else {
        await navigator.clipboard.writeText(md);
      }
      toast('Notes copied');
    } catch (err) {
      console.warn(err);
      try { await navigator.clipboard.writeText(md); toast('Notes copied as Markdown'); }
      catch (e2) { toast('Your browser blocked copying. Use “Download .md file” instead.'); }
    }
  },

  download(a) {
    downloadBlob(new Blob([this.toMarkdown(a)], { type: 'text/markdown;charset=utf-8' }), slugify(displayTitle(a)) + '-notes.md');
  },

  print(a) {
    this.fillPrint(a);
    window.print();
  },
  fillPrint(a) {
    $('#print-root').innerHTML = this.toHtml(a);
  },

  /* ---------- full backup ---------- */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  },

  async exportBackup() {
    const close = toast('Preparing backup…', { timeout: 60000 });
    try {
      if (Reader.article) await Autosave.flush();
      const articles = await DB.listArticles();
      const out = [];
      for (const a of articles) {
        const blob = await DB.getFile(a.id);
        out.push({ ...a, pdfBase64: blob ? await this.blobToBase64(blob) : null });
      }
      const data = { format: 'marginalia-backup', version: 1, exportedAt: new Date().toISOString(), settings: { colorLabels: Settings.labels }, articles: out };
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `marginalia-backup-${stamp}.json`);
      close();
      toast(`Backup saved: ${out.length} ${out.length === 1 ? 'article' : 'articles'}`);
    } catch (err) {
      console.error(err);
      close();
      toast('Could not create the backup. The library may be too large for one file.');
    }
  },

  async importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { toast('That file is not a valid backup.'); return; }
    if (!data || data.format !== 'marginalia-backup' || !Array.isArray(data.articles)) { toast('That file is not a Marginalia backup.'); return; }
    const close = toast('Importing…', { timeout: 60000 });
    let added = 0, skipped = 0;
    try {
      const existing = new Set((await DB.listArticles()).map(a => a.id));
      for (const item of data.articles) {
        if (!item || !item.id || existing.has(item.id)) { skipped++; continue; }
        const { pdfBase64, ...article } = item;
        if (!pdfBase64) { skipped++; continue; }
        const base = newArticle(article.fileName || 'Untitled.pdf', article.numPages);
        const merged = { ...base, ...article, info: { ...base.info, ...(article.info || {}) } };
        const blob = await (await fetch('data:application/pdf;base64,' + pdfBase64)).blob();
        await DB.addArticle(merged, new Blob([blob], { type: 'application/pdf' }));
        added++;
      }
      if (data.settings && data.settings.colorLabels && Settings.isDefault()) await Settings.replaceLabels(data.settings.colorLabels);
    } catch (err) {
      console.error(err);
      close();
      toast('The import stopped part-way. Articles imported so far are kept.');
      await Library.refresh();
      return;
    }
    close();
    toast(`Imported ${added} ${added === 1 ? 'article' : 'articles'}` + (skipped ? `, skipped ${skipped} already in your library` : ''));
    await Library.refresh();
  },

  init() {
    $('#btn-backup-export').addEventListener('click', () => this.exportBackup());
    const input = $('#backup-input');
    $('#btn-backup-import').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files[0]) this.importBackup(input.files[0]); input.value = ''; });

    // reader export menu
    const btn = $('#btn-export'), menu = $('#export-menu');
    const setOpen = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); };
    btn.addEventListener('click', e => { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) setOpen(false); });
    menu.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b || !Reader.article) return;
      setOpen(false);
      await Autosave.flush();
      if (b.id === 'exp-copy') this.copy(Reader.article);
      if (b.id === 'exp-md') this.download(Reader.article);
      if (b.id === 'exp-print') this.print(Reader.article);
    });
    this.closeMenu = () => setOpen(false);

    // Ctrl+P straight from the browser prints the notes too
    window.addEventListener('beforeprint', () => { if (Reader.article) this.fillPrint(Reader.article); });
  }
};
