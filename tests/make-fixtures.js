// Generates three sample PDFs with Chromium: two articles with a text layer, and one image-only "scan".
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'fixtures');
fs.mkdirSync(out, { recursive: true });

const S = [
  'Local newspapers have lost readers for two decades, but the loss is not evenly spread across towns.',
  'In smaller towns the paper is often the only outlet that reports on the council, the schools and the courts.',
  'When that outlet closes, turnout in local elections tends to fall within a few years.',
  'We compare forty municipalities that lost their paper with forty that kept it, matched on size and income.',
  'The difference is small in the first year and then grows steadily.',
  'Residents who still read a local paper report knowing more candidates by name.',
  'This does not prove that the paper caused the change, and we discuss three alternative explanations below.',
  'First, towns that lose a paper may already be losing civic organisations of every kind.',
  'Second, closures cluster in regions where employment was already falling.',
  'Third, online news may fill part of the gap in ways our survey cannot see.',
  'Even so, the pattern holds when we drop the ten most extreme towns from the sample.',
  'We therefore treat the finding as a strong association that deserves a better causal design.'
];
const T = [
  'Reading well is mostly a habit of asking the next question before the author answers it.',
  'A highlight is only useful when it is followed by a sentence in your own words.',
  'Notes that restate the text teach little, while notes that disagree with it teach a lot.',
  'The summary should fit on a card, otherwise it is not yet a summary.',
  'Critical questions work best when they name the evidence that would change your mind.',
  'Return to an article after a week and see which notes still make sense.'
];

const para = (src, i, n) => '<p>' + Array.from({ length: n }, (_, k) => src[(i * 3 + k) % src.length]).join(' ') + '</p>';
const page = (title, body, brk) => `<section style="${brk ? 'break-before:page;' : ''}"><h2>${title}</h2>${body}</section>`;

const css = `
  @page { size: A4; margin: 24mm 22mm; }
  body { font: 12pt/1.55 "Times New Roman", serif; color: #111; }
  h1 { font-size: 22pt; margin: 0 0 4pt; } .by { font-size: 11pt; color: #444; margin-bottom: 14pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; } p { margin: 0 0 9pt; text-align: justify; hyphens: auto; }
  .cols { column-count: 2; column-gap: 8mm; }
`;

const doc1 = `<html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>Where the Local Paper Used to Be</h1><div class="by">A. de Vries and M. Okafor · Journal of Civic Media · 2023</div>
<h2>Abstract</h2>${para(S, 0, 5)}
${page('1. Introduction', para(S, 1, 6) + para(S, 2, 6) + para(S, 3, 6) + para(S, 4, 5), false)}
${page('2. Data and method', '<div class="cols">' + para(S, 5, 7) + para(S, 6, 7) + para(S, 7, 7) + para(S, 8, 7) + '</div>' + para(S, 9, 6), true)}
${page('3. Results', para(S, 10, 6) + para(S, 11, 6) + para(S, 0, 6) + para(S, 1, 6) + para(S, 2, 6), true)}
${page('4. Discussion', para(S, 3, 6) + para(S, 4, 6) + para(S, 5, 6), true)}
</body></html>`;

const doc2 = `<html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>How to Read an Article Twice</h1><div class="by">Notes on a study habit</div>
${page('Why re-read', para(T, 0, 5) + para(T, 1, 5) + para(T, 2, 5), false)}
${page('What to write down', para(T, 3, 6) + para(T, 4, 6) + para(T, 5, 6) + para(T, 0, 6), true)}
${page('Coming back later', para(T, 1, 6) + para(T, 2, 6), true)}
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  for (const [name, html] of [['sample-article.pdf', doc1], ['second-article.pdf', doc2]]) {
    await pg.setContent(html);
    await pg.pdf({ path: path.join(out, name), format: 'A4', printBackground: true, preferCSSPageSize: true });
  }
  // Image-only PDF: a canvas drawn as a picture, no text objects
  await pg.setContent('<html><body style="margin:0"><canvas id="c" width="600" height="800"></canvas></body></html>');
  const dataUrl = await pg.evaluate(() => {
    const c = document.getElementById('c'), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 800); g.fillStyle = '#222'; g.font = '28px serif';
    for (let i = 0; i < 14; i++) g.fillText('This page is only a picture of text ' + i, 40, 70 + i * 48);
    return c.toDataURL('image/png');
  });
  await pg.setContent(`<html><body style="margin:0"><img src="${dataUrl}" style="width:210mm;height:280mm;display:block"></body></html>`);
  await pg.pdf({ path: path.join(out, 'scan.pdf'), width: '210mm', height: '280mm', printBackground: true });
  await browser.close();
  console.log('fixtures written to', out);
})();
