// Takes screenshots of the start screen and reader in different accent colours (visual check, not a test).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const SITE = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'screenshots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'x' }); fs.createReadStream(f).pipe(r);
}).listen(0, async () => {
  const base = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(base);
  await pg.waitForSelector('#view-welcome:not([hidden])');
  await pg.evaluate(() => { localStorage.setItem('marginalia-name', 'Sanne'); localStorage.setItem('marginalia-accent', 'rose'); });
  await pg.reload();
  await pg.waitForTimeout(3800);
  await pg.screenshot({ path: path.join(OUT, 'looks-welcome-rose.png') });
  await pg.evaluate(() => { localStorage.setItem('marginalia-accent', 'sea'); });
  await pg.reload(); await pg.waitForTimeout(3800);
  await pg.emulateMedia({ colorScheme: 'dark' }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(OUT, 'looks-welcome-sea-dark.png') });
  await pg.emulateMedia({ colorScheme: 'light' });
  await pg.evaluate(() => { localStorage.setItem('marginalia-accent', 'plum'); });
  await pg.goto(base + '#/library');
  await pg.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'sample-article.pdf'));
  await pg.waitForSelector('.page.rendered .textLayer span');
  await pg.reload(); await pg.waitForSelector('.page.rendered .textLayer span');
  await pg.screenshot({ path: path.join(OUT, 'looks-reader-plum.png') });
  await b.close(); srv.close();
});
