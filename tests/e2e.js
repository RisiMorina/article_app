// End-to-end test for Marginalia.
//   node e2e.js                 -> Chromium, 1280x800 and 1440x900, screenshots in ./screenshots
//   BROWSER=firefox node e2e.js -> also: webkit, msedge, chrome
const playwright = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, 'screenshots');
const BROWSER = process.env.BROWSER || 'chromium';
const SIZES = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }];
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(SITE, p);
      if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, () => resolve(srv));
  });
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : '  ' + extra}`);
}

async function spanBoxes(page, texts) {
  // scroll the first span to the middle, then measure all
  return page.evaluate(ts => {
    const spans = [...document.querySelectorAll('.page.rendered .textLayer span')];
    const find = t => spans.find(s => s.textContent.includes(t));
    const first = find(ts[0]);
    if (!first) return null;
    first.scrollIntoView({ block: 'center' });
    return ts.map(t => { const s = find(t); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  }, texts);
}

async function dragSelect(page, fromText, toText) {
  const b = await spanBoxes(page, [fromText, toText]);
  if (!b || !b[0] || !b[1]) throw new Error(`text not found: ${fromText} / ${toText}`);
  await page.waitForTimeout(150);
  const b2 = await spanBoxes(page, [fromText, toText]);
  const [a, z] = b2;
  await page.mouse.move(a.x + 1, a.y + a.h / 2);
  await page.mouse.down();
  await page.mouse.move(z.x + z.w - 2, z.y + z.h / 2, { steps: 12 });
  await page.mouse.up();
}

const hlCount = page => page.evaluate(() => Reader.article.highlights.length);
const waitSaved = async page => { await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved'); await page.waitForTimeout(250); };
const waitRendered = page => page.waitForSelector('.page.rendered .textLayer span', { timeout: 20000 });

async function scenario(browser, size, ctxOpts = {}) {
  const tag = `${BROWSER}-${size.width}x${size.height}`;
  console.log(`\n== ${tag} ==`);
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const context = await browser.newContext({ viewport: size, acceptDownloads: true, ...ctxOpts });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // ---- library, empty ----
  await page.goto(base);
  await page.waitForSelector('#view-welcome:not([hidden])');
  check('start screen asks "Do you want to work on an article?"', (await page.textContent('#welcome-title')).includes('work on an article'));
  check('no library button or continue card while empty', (await page.isHidden('#welcome-library')) && (await page.isHidden('#welcome-continue')));
  await page.waitForTimeout(3800);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-0-welcome.png`) });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#welcome-open')]);
  check('"Choose a PDF" opens the file picker', !!chooser);
  await page.goto(base + '#/library');
  await page.waitForSelector('#view-library:not([hidden])');
  check('library shows empty state', (await page.textContent('#lib-empty')).includes('No articles yet'));

  // ---- upload ----
  await page.setInputFiles('#file-input', path.join(FIX, 'sample-article.pdf'));
  await page.waitForSelector('#view-reader:not([hidden])');
  await waitRendered(page);
  const total = +(await page.textContent('#page-total'));
  check('PDF opens with all pages', total >= 4, `pages=${total}`);
  check('text layer present, no scan banner', await page.isHidden('#scan-banner'));
  check('sidebar visible at this size', await page.isVisible('#sidebar'));

  // ---- multi-line highlight with colour from the toolbar ----
  await dragSelect(page, 'Local newspapers have lost', 'In smaller towns');
  await page.waitForSelector('#sel-toolbar:not([hidden])');
  const tbBox = await page.locator('#sel-toolbar').boundingBox();
  check('toolbar appears near selection and inside window', tbBox && tbBox.x >= 0 && tbBox.y >= 0 && tbBox.x + tbBox.width <= size.width + 1);
  await page.click('#sel-toolbar .swatch[data-color="green"]');
  check('highlight 1 saved to state', (await hlCount(page)) === 1);
  const first = await page.evaluate(() => Reader.article.highlights[0]);
  check('multi-line selection gives several rects', first.rects.length >= 2, JSON.stringify(first.rects.length));
  check('quote text is clean', first.text.startsWith('Local newspapers have lost') && !first.text.includes('  '), first.text);
  check('rects normalised 0..1', first.rects.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.001 && r.y + r.h <= 1.001));
  check('highlight drawn on page', (await page.locator('.hl-rect.c-green').count()) >= 2);
  check('toolbar closes after highlighting', await page.isHidden('#sel-toolbar'));

  // ---- Highlight + note ----
  await dragSelect(page, 'Residents who still read', 'Residents who still read');
  await page.waitForSelector('#sel-toolbar:not([hidden])');
  await page.click('#tb-note');
  const focusedNote = await page.evaluate(() => document.activeElement.classList.contains('hl-note'));
  check('"Highlight + note" focuses the note field', focusedNote);
  await page.keyboard.type('First note: local papers matter for turnout.');
  check('two highlights now', (await hlCount(page)) === 2);

  // ---- page 2, Ctrl+H and pink ----
  await page.fill('#page-input', '2');
  await page.press('#page-input', 'Enter');
  await page.waitForTimeout(500);
  await waitRendered(page);
  await dragSelect(page, 'Second, closures', 'Second, closures');
  await page.keyboard.press('ControlOrMeta+h');
  await page.waitForFunction(() => Reader.article.highlights.length === 3);
  check('Ctrl+H highlights selection with last colour', true);

  await dragSelect(page, 'Even so, the pattern', 'Even so, the pattern');
  await page.waitForSelector('#sel-toolbar:not([hidden])');
  await page.keyboard.press('Escape');
  check('Esc closes the toolbar', await page.isHidden('#sel-toolbar'));
  await page.evaluate(() => getSelection().removeAllRanges());   // a mousedown on a live selection would start a text drag
  await dragSelect(page, 'Even so, the pattern', 'Even so, the pattern');
  await page.waitForSelector('#sel-toolbar:not([hidden])');
  await page.click('#sel-toolbar .swatch[data-color="pink"]');
  check('pink highlight added', (await hlCount(page)) === 4);

  // ---- selection across two pages ----
  await page.evaluate(() => {
    const pg = Reader.pages;
    const walk = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const out = []; for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.trim()) out.push(n); return out; };
    // find two neighbouring rendered pages
    for (let i = 0; i < pg.length - 1; i++) {
      if (pg[i].rendered && pg[i + 1].rendered) {
        const a = walk(pg[i].textEl), b = walk(pg[i + 1].textEl);
        const na = a[a.length - 1], nb = b[0];
        const sel = getSelection();
        sel.setBaseAndExtent(na, Math.max(0, na.data.length - 12), nb, Math.min(10, nb.data.length));
        const target = nb.parentElement;
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
        window.__crossPages = [pg[i].num, pg[i + 1].num];
        return;
      }
    }
  });
  const cross = await page.evaluate(() => window.__crossPages);
  await page.waitForSelector('#sel-toolbar:not([hidden])');
  await page.click('#sel-toolbar .swatch[data-color="blue"]');
  const pagesWithBlue = await page.evaluate(() => Reader.article.highlights.filter(h => h.color === 'blue').map(h => h.page));
  check('selection over two pages makes one highlight per page', cross && pagesWithBlue.length === 2 && pagesWithBlue.includes(cross[0]) && pagesWithBlue.includes(cross[1]), JSON.stringify([cross, pagesWithBlue]));

  // ---- About tab ----
  await page.click('#tab-about');
  await page.fill('#f-title', 'Where the local paper used to be');
  await page.fill('#f-authors', 'A. de Vries, M. Okafor');
  await page.fill('#f-year', '2023');
  await page.fill('#f-source', 'Journal of Civic Media');
  await page.fill('#f-link', 'https://doi.org/10.0000/example');
  await page.fill('#f-tags', 'local news, turnout');
  await page.fill('#f-summary', 'Towns that lose their paper see turnout fall.\nThe effect grows over several years.');
  await page.click('#q-add');
  await page.keyboard.type('Could closures simply follow a decline in civic life?');
  const opts = await page.locator('.q-item select option').count();
  check('question can link to a highlight', opts === 1 + 6, `options=${opts}`);
  await page.selectOption('.q-item select', { index: 1 });
  await page.click('#q-add');
  await page.keyboard.type('What would a causal design look like?');
  await page.click('.q-item:nth-child(2) [aria-label^="Move question"][aria-label$="up"]');
  check('questions can be reordered', (await page.inputValue('.q-item:nth-child(1) .q-text')).startsWith('What would'));
  await page.fill('#f-free', 'Check the matching procedure in the appendix.');
  check('title in header follows info panel', (await page.textContent('#r-title')) === 'Where the local paper used to be');
  await page.screenshot({ path: path.join(SHOTS, `${tag}-3-about.png`) });
  await page.click('#tab-highlights');

  // ---- autosave + reload ----
  await waitSaved(page);
  const stateBefore = await page.evaluate(() => JSON.stringify({ n: Reader.article.highlights.length, note: Reader.article.highlights.find(h => h.note).note }));
  await page.reload();
  await page.waitForSelector('#view-reader:not([hidden])');
  await waitRendered(page);
  await page.waitForSelector('.hl-item');
  const after = await page.evaluate(() => JSON.stringify({ n: Reader.article.highlights.length, note: Reader.article.highlights.find(h => h.note).note }));
  check('highlights and note survive a reload', stateBefore === after, `${stateBefore} vs ${after}`);
  check('highlight list matches', (await page.locator('.hl-item').count()) === 6);
  check('highlight overlays redrawn after reload', (await page.locator('.hl-rect').count()) >= 6);
  check('note text back in its field', (await page.locator('.hl-note').evaluateAll(els => els.some(e => e.value.startsWith('First note')))));
  await page.click('#tab-about');
  check('info fields persisted', (await page.inputValue('#f-authors')) === 'A. de Vries, M. Okafor' && (await page.inputValue('#f-year')) === '2023' && (await page.inputValue('#f-tags')) === 'local news, turnout');
  check('summary persisted (multi-line)', (await page.inputValue('#f-summary')).includes('\nThe effect grows'));
  check('both questions persisted', (await page.locator('.q-item').count()) === 2);
  check('question link persisted', (await page.locator('.q-item select').evaluateAll(s => s.some(x => x.value !== ''))));
  check('free notes persisted', (await page.inputValue('#f-free')).startsWith('Check the matching'));
  await page.click('#tab-highlights');

  // ---- click a highlight in the PDF opens its note ----
  await page.evaluate(() => Reader.scrollToPage(1));
  await page.waitForTimeout(400);
  const greenId = await page.evaluate(() => Reader.article.highlights.find(h => h.color === 'green').id);
  const rc = await page.evaluate(id => { const el = document.querySelector(`.hl-rect[data-hl="${id}"]`); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, greenId);
  await page.waitForTimeout(300);
  await page.mouse.click(rc.x, rc.y);
  await page.waitForTimeout(200);
  const opened = await page.evaluate(() => ({ focusInNote: document.activeElement.classList.contains('hl-note'), activeItem: document.querySelector('.hl-item.active')?.dataset.id }));
  check('clicking a highlight in the PDF opens its note', opened.focusInNote && opened.activeItem === greenId, JSON.stringify(opened));

  // ---- click a sidebar item scrolls the PDF + flashes ----
  await page.evaluate(() => Reader.scrollToPage(1));
  await page.waitForTimeout(300);
  const pinkId = await page.evaluate(() => Reader.article.highlights.find(h => h.color === 'pink').id);
  const top0 = await page.evaluate(() => document.querySelector('#pdf-scroll').scrollTop);
  await page.click(`.hl-item[data-id="${pinkId}"] .hl-quote`);
  await page.waitForTimeout(150);
  check('flash class set on the highlight', (await page.locator(`.hl-rect[data-hl="${pinkId}"].flash`).count()) > 0);
  await page.waitForTimeout(900);
  const top1 = await page.evaluate(() => document.querySelector('#pdf-scroll').scrollTop);
  check('clicking a sidebar item scrolls the PDF', top1 > top0 + 100, `${top0} -> ${top1}`);

  // ---- colour filter, change colour, delete + undo ----
  await page.click('#legend .chip >> nth=0');
  check('colour legend filters list', (await page.locator('.hl-item').count()) < 6);
  await page.click('#legend .chip >> nth=0');
  const n0 = await page.locator('.hl-item').count();
  await page.click('.hl-item >> nth=-1 >> [aria-label="Delete highlight"]');
  check('delete removes highlight', (await page.locator('.hl-item').count()) === n0 - 1);
  await page.click('.toast-action');
  check('undo brings it back', (await page.locator('.hl-item').count()) === n0);

  // ---- zoom: overlay stays aligned ----
  const label0 = await page.textContent('#zoom-level');
  const w0 = await page.evaluate(() => document.querySelector('.page').offsetWidth);
  await page.click('#zoom-in');
  await page.waitForTimeout(600);
  const label1 = await page.textContent('#zoom-level');
  const w1 = await page.evaluate(() => document.querySelector('.page').offsetWidth);
  check('zoom in changes size and label', w1 > w0 && label0 !== label1, `${label0}->${label1}`);
  await waitRendered(page);
  check('text layer re-rendered after zoom', (await page.locator('.page.rendered .textLayer span').count()) > 10);
  await page.click('#zoom-level');
  await page.waitForTimeout(400);

  // ---- resize sidebar ----
  const rz = await page.locator('#resizer').boundingBox();
  const sw0 = (await page.locator('#sidebar').boundingBox()).width;
  await page.mouse.move(rz.x + 3, rz.y + 300);
  await page.mouse.down();
  await page.mouse.move(rz.x - 117, rz.y + 300, { steps: 8 });
  await page.mouse.up();
  const sw1 = (await page.locator('#sidebar').boundingBox()).width;
  check('sidebar can be resized by dragging', sw1 > sw0 + 80, `${sw0} -> ${sw1}`);

  await page.evaluate(() => Reader.scrollToPage(1));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-2-reader.png`) });

  // ---- export markdown ----
  await page.click('#btn-export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exp-md')]);
  const mdPath = path.join(SHOTS, `${tag}-notes.md`);
  await dl.saveAs(mdPath);
  const md = fs.readFileSync(mdPath, 'utf8');
  check('markdown has title, info, summary, questions', md.startsWith('# Where the local paper used to be') && md.includes('- **Authors:** A. de Vries, M. Okafor') && md.includes('## Summary') && md.includes('## Critical questions') && md.includes('1. What would a causal design look like?'));
  check('markdown quotes highlights with page and note', md.includes('> Local newspapers have lost') && /> p\. 1 · Evidence/.test(md) && md.includes('First note: local papers matter for turnout.'));
  const html = await page.evaluate(() => Exporter.toHtml(Reader.article));
  check('html flavour for Word/Notion paste', html.includes('<h2>Highlights</h2>') && html.includes('<blockquote>') && html.includes('<ol>'));

  // ---- back to library ----
  await page.click('#btn-back');
  await page.waitForSelector('#view-library:not([hidden]) .art');
  check('library row shows title from info panel', (await page.textContent('.art-title')) === 'Where the local paper used to be');
  check('library row shows highlight count', (await page.textContent('.art-count')) === '6 highlights');
  await page.fill('#search', 'turnout');
  check('search finds by note text', (await page.locator('.art').count()) === 1);
  await page.fill('#search', 'okafor');
  check('search finds by author', (await page.locator('.art').count()) === 1);
  await page.fill('#search', 'zzzz-nothing');
  check('search with no match shows message', (await page.locator('.art').count()) === 0 && (await page.isVisible('#lib-empty')));
  await page.fill('#search', '');

  // ---- second PDF in another colour set ----
  await page.setInputFiles('#file-input', path.join(FIX, 'second-article.pdf'));
  await page.waitForSelector('#view-reader:not([hidden])');
  await waitRendered(page);
  await dragSelect(page, 'Reading well is mostly', 'Reading well is mostly');
  await page.waitForSelector('#sel-toolbar:not([hidden])');
  await page.click('#sel-toolbar .swatch[data-color="blue"]');
  check('second article: highlight made', (await hlCount(page)) === 1);
  await page.click('#tab-about');
  await page.fill('#f-title', 'How to read an article twice');
  await waitSaved(page);
  await page.click('#btn-back');
  await page.waitForSelector('#view-library:not([hidden]) .art');
  await page.waitForFunction(() => document.querySelectorAll('.art').length === 2).catch(() => {});
  check('library lists two articles', (await page.locator('.art').count()) === 2);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-1-library.png`) });

  // ---- settings: rename a colour ----
  await page.click('#btn-settings-lib');
  await page.fill('#label-pink', 'I disagree');
  await page.click('#settings-close');
  await page.waitForTimeout(500);

  // ---- backup, then import into a brand-new browser profile ----
  const [bk] = await Promise.all([page.waitForEvent('download'), page.click('#btn-backup-export')]);
  const bkPath = path.join(SHOTS, `${tag}-backup.json`);
  await bk.saveAs(bkPath);
  const backup = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
  check('backup holds both articles with PDFs as base64', backup.articles.length === 2 && backup.articles.every(a => a.pdfBase64 && a.pdfBase64.length > 1000));
  check('backup holds colour names', backup.settings.colorLabels.pink === 'I disagree');

  const ctx2 = await browser.newContext({ viewport: size, acceptDownloads: true, ...ctxOpts });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '#/library');
  await p2.waitForSelector('#view-library:not([hidden])');
  check('fresh profile starts empty', (await p2.locator('.art').count()) === 0);
  await p2.setInputFiles('#backup-input', bkPath);
  await p2.waitForSelector('.art');
  await p2.waitForFunction(() => document.querySelectorAll('.art').length === 2);
  check('import restores both articles', true);
  await p2.click('.art-title >> text=Where the local paper used to be');
  await p2.waitForSelector('#view-reader:not([hidden])');
  await waitRendered(p2);
  await p2.waitForSelector('.hl-item');
  check('imported article has highlights and notes', (await p2.locator('.hl-item').count()) === 6 && (await p2.locator('.hl-note').evaluateAll(els => els.some(e => e.value.startsWith('First note')))));
  check('imported colour name applied', (await p2.locator('.legend .chip').nth(3).textContent()).includes('I disagree'));
  await ctx2.close();

  // ---- scan without text layer ----
  await page.setInputFiles('#file-input', path.join(FIX, 'scan.pdf'));
  await page.waitForSelector('#view-reader:not([hidden])');
  await page.waitForSelector('#scan-banner:not([hidden])', { timeout: 15000 });
  check('scanned PDF shows a clear message', (await page.textContent('#scan-banner')).includes('no text layer'));
  await page.screenshot({ path: path.join(SHOTS, `${tag}-4-scan.png`) });
  await page.click('#btn-back');
  await page.waitForSelector('#view-library:not([hidden]) .art');

  // ---- delete with confirm ----
  await page.click('.art:has(.art-title:text-is("scan")) [aria-label^="Delete"]');
  check('confirm dialog opens', await page.isVisible('#dlg-confirm'));
  await page.click('#confirm-cancel');
  check('cancel keeps article', (await page.locator('.art').count()) === 3);
  await page.click('.art:has(.art-title:text-is("scan")) [aria-label^="Delete"]');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => document.querySelectorAll('.art').length === 2);
  check('delete removes article', true);

  // ---- start screen with a continue card ----
  await page.click('.home');
  await page.waitForSelector('#view-welcome:not([hidden]) #welcome-continue:not([hidden])');
  check('start screen offers to continue the last article', (await page.textContent('#continue-title')).length > 3 && (await page.textContent('#welcome-library')).includes('(2)'));
  await page.waitForTimeout(3800);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-0b-welcome-continue.png`) });
  await page.click('#welcome-continue');

  // ---- dark mode + print ----
  await page.click('#btn-back');
  await page.click('.art-title >> text=Where the local paper used to be');
  await page.waitForSelector('#view-reader:not([hidden])');
  await waitRendered(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-5-reader-dark.png`) });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => Exporter.fillPrint(Reader.article));
  await page.emulateMedia({ media: 'print' });
  const printVisible = await page.evaluate(() => ({ app: getComputedStyle(document.querySelector('#app')).display, root: getComputedStyle(document.querySelector('#print-root')).display, text: document.querySelector('#print-root').innerText.includes('Local newspapers') }));
  check('print view shows only the notes', printVisible.app === 'none' && printVisible.root === 'block' && printVisible.text, JSON.stringify(printVisible));
  await page.emulateMedia({ media: 'screen' });

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
  srv.close();
}

(async () => {
  let browser;
  const launch = { chromium: () => playwright.chromium.launch(), firefox: () => playwright.firefox.launch(), webkit: () => playwright.webkit.launch(),
    msedge: () => playwright.chromium.launch({ channel: 'msedge' }), chrome: () => playwright.chromium.launch({ channel: 'chrome' }) };
  browser = await launch[BROWSER]();
  for (const size of SIZES) {
    try { await scenario(browser, size); }
    catch (err) { check(`scenario ${size.width}x${size.height} completed`, false, err.stack || String(err)); }
  }
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${BROWSER}: ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
