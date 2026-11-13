# Marginalia

Static web app for reading PDF articles and keeping structured notes. Plain HTML, CSS and JavaScript:
no framework, no backend, no build step. Everything is stored in the user's browser (IndexedDB).
Deploy by dragging this folder onto Netlify (the repo root (the `tests` folder is only for development)).

UI language is English (a personal tool, not a client site). Laptop only: designed for 1280px and up, the notes
panel starts collapsed below 1280px, and below 1024px a "Open this on a laptop" message replaces the app.

## Structure
```
index.html        all markup: library, reader, dialogs, floating toolbar, print root
css/style.css     all styles. Theme tokens at the top (light, dark, auto via data-theme on <html>)
js/util.js        DOM helper h(), ids, debounce, icons, toast(), confirmDialog()
js/db.js          IndexedDB wrapper (DB), newArticle(), displayTitle(), Autosave (debounced save + "Saved")
js/settings.js    colour names (stored in IndexedDB, travel with backups) and theme (localStorage)
js/library.js     start screen + library: reading list, folders, list, search, upload (button / drop zone / whole-window drop), delete
js/reader.js      PDF.js loading, lazy page rendering, text layer, zoom, page counter, highlight overlay layer
js/highlighter.js selection -> highlights, floating toolbar, Ctrl/Cmd+H, click on a highlight
js/ink.js         pen + stroke eraser: one SVG layer per page, strokes in `article.ink`
js/notes.js       sidebar: Highlights tab, About tab, questions, tabs, resizable/collapsible panel
js/exporter.js    Markdown + HTML of one article, clipboard, print, full JSON backup and import
js/app.js         hash router and start-up
```
Scripts are plain `<script>` tags that share globals (`Reader`, `Notes`, `DB`, ...). Load order is in `index.html`.
Routes: `#/` start screen ("Do you want to work on an article?", Choose a PDF / Open my library / Continue card),
`#/library` library, `#/article/<id>` reader (so a reload reopens the same article).

PDF.js is pinned to **3.11.174** from jsDelivr (script, CSS and worker), with SRI hashes on the script and CSS.
3.x is used because it ships a classic (non-module) build. If you bump the version, update the hashes in `index.html`
and `PDFJS_BASE` in `js/reader.js`.

## Data model (IndexedDB database `marginalia`, version 1)
- `articles` (key `id`): one record per article, everything except the PDF bytes.
- `files` (key `id` = article id): `{ id, data: ArrayBuffer }`, the PDF itself. Kept separate so the library never loads big files.
  Stored as ArrayBuffer, not Blob, because some engines (and older Safari) cannot store Blobs in IndexedDB.
- `settings` (key `key`): `{ key: 'colorLabels', value: { yellow, green, blue, pink } }` and
  `{ key: 'folders', value: ['Methods', 'Climate', ...] }` (folder names, in creation order). Both travel with backups.

Article record:
```
id, fileName, addedAt, updatedAt, numPages, hasText (null | true | false)
folder:     string                     // folder name, '' = no folder (old records have no field: treat as '')
toRead:     boolean                    // on the reading list (old records: undefined = false)
view:       { page, scale }            // last page; scale null = "fit width"
info:       { title, authors, year, source, link, tags: string[] }
summary, freeNotes: string
questions:  [{ id, text, highlightId | null }]
thumb:      small JPEG data URL of page 1 (library rows and the Continue card)
highlights: [{ id, page, text, rects: [{x,y,w,h}], color, note, createdAt, updatedAt }]
```
- `color` is one of `yellow | green | blue | pink`. Their meaning lives in settings, never in the highlight.
- `rects` are **fractions (0..1) of the page width/height**, one rectangle per text line, so they survive zoom and
  re-render. The overlay draws them with percentage CSS, so zooming costs nothing.
- A selection that spans two pages becomes **one highlight per page** (each with its own text and note).
- `hasText: false` means the PDF has no text layer (a scan): the app shows a banner and highlighting is disabled.
- Display title = `info.title`, falling back to the file name without `.pdf`.

## Reading list and folders
- The library has a left column: All articles, Reading list, one entry per folder (with counts) and "No folder".
  `Library.filter` is `all | toread | unsorted | folder:<name>`. The start screen shows a "Reading list (n)" button.
- Adding PDFs inside the library does **not** open the reader: they go on the reading list (`toRead: true`) and into the
  folder that is open. Only the start screen's "Choose a PDF" with one file still opens the reader straight away.
- The library is drawn as **photographed bookcases** (see "Photographed bookcases" below): every folder is a shelf, labelled beside the case.
  Drag a book onto another shelf to move it. Hovering or focusing a book pulls it out and (in the library page) shows a card with the title,
  details, the "To read" toggle, a folder select (with "New folder…") and delete. Clicking the spine opens it.
- (Old list rows are gone; `.art*` CSS is unused.) Folder select and "To read" toggle: Folders are created/renamed/deleted in the
  library; deleting a folder keeps its articles (they become "No folder"). Names are unique, case-insensitive.

## Pen and eraser
- Reader header has Select / Pen / Eraser buttons (keys V, P, E; Esc goes back to Select) and four pen colours.
  Ctrl+Z takes back the last stroke drawn in this session while Pen or Eraser is active.
- `article.ink = [{ id, page, color: red|blue|green|black, width, pts: [[x, y], ...] }]`. x and y are fractions of the
  page width/height, width is a fraction of the page width (so zoom just scales it). Drawn as SVG paths in a layer
  above the text layer; with Pen or Eraser active that layer takes the pointer and the text layer is disabled.
- The eraser removes whole strokes it touches. Ink is saved with the article and travels in backups, but it is not
  part of the Markdown/HTML/print export (notes only).

## Start screen hero
- `#/` has two sections. The first screen (`.hero`, 100svh) shows **only a library room**: the real library as two photographed
  bookcases meeting at a **90 degree corner** (real CSS 3D: each `.wall` is turned 45 degrees around the corner line, with a
  perspective on `.hero-room`). Wallpaper, crown molding, a wooden floor (a plane cut to a wedge) with a rug, and a pendant
  lamp with a warm glow make it read as a library. Shelves are padded with unlabelled empty ones up to 6.
  `Library.renderHero` scales books (`--k`) and the whole room (`--rs`) so it fits the screen. A small chevron scrolls down.
- Because the walls are tilted, hover cards inside them would be skewed: in the hero the books show a flat tooltip (`#hero-tip`,
  `Library.initHeroTip`) instead. Full actions (To read, move, delete) live in the library.
- Below it (`#welcome-more`) is the old start content: heading, Choose a PDF / Open my library / Reading list, Continue card.
- Intro moment: the books drop onto their shelves one after another, once per page load (`.intro`, off with reduced motion).
- `Library._refreshView()` redraws the hero or the library, whichever is showing.
- The room is dark green in both themes on purpose (it is a scene, not UI).

## Textures (made with Higgsfield, gpt_image_2_6, 2026-11-13)
`images/` holds WebP textures used by the bookcases and the hero room: `wood.webp` (walnut: frame, cornice, back panel, shelves),
`wallpaper.webp` (green damask), `floor.webp` (oak planks), `rug.webp`, `leather.webp` (grey book cloth, blended with `overlay` over each
spine colour). All are AI-generated, tileable or flat, no text. The original PNGs are not kept in the project (large); re-generate with
similar prompts if they need changing. A bookcase is `.cabinet-frame` (wood) > `.cabinet-inner` (dark panelled back) > shelves.

## Photographed bookcases (real 3D)
- The case comes from one AI-generated (Higgsfield) photo of an empty carved walnut bookcase, 880 x 1168 "units", cut into layers:
  `images/case-back.webp` (back panel at the wall, boards painted out), `images/case-frame.webp` (frame + shelf boards, the shelf openings are
  transparent) placed `--cd` (150 units) in front of it, and between them real planes: inner/outer side panels (`.cs-*`, wood texture) and a
  board top under every shelf (`.pslot::before`). Books stand between the layers, so you see real depth when the view is angled.
  `images/case.webp` is the uncut photo (kept for measuring; not used at runtime).
- 5 usable shelves per case (arched top + four more; the short bottom one is unused). Floors and heights are measured in units in
  `Library.SLOTS` (with `CASE`, `ROW_CAP`). If the photo is replaced, re-measure, and redo the three layer images (alpha cutout, frame openings,
  back with boards painted out: see the Higgsfield notes below).
- `Library._slotsFor` turns folders into slots (one per row of books; a full folder takes several), `_pcase` builds one case. More folders mean
  more cases. The library page shows all cases (looking from the right, `#shelves` perspective); the hero shows the first two, in the corner.
- Books are 3D boxes: sizes are unitless numbers in photo units, `--u` (px per unit) is set per case from its width. **No `filter`, `opacity`,
  `overflow` or `mask` on elements between the wall and a book**, or the browser flattens the 3D.
- Spines are 23 photographed leather spines (`images/spines/s01..s23.webp`, cut from two generated photos), chosen per book by a hash of its id,
  with a small dark title plaque. The texture URL is set in JS as an absolute URL (`--spine`) because a relative URL in a custom property
  would resolve against the stylesheet.
- Hover/focus pulls a book out towards you (`translate3d(0, -3px, 0.42 * --D)`).
- Higgsfield prompts used (gpt_image_2_6): empty ornate walnut bookcase, straight-on, five empty shelves, grey background (3:4); twelve leather
  spines side by side, no text, black background (16:9). The original PNGs are not in the project.
- Old CSS for the earlier CSS-drawn cases (`.cabinet*`, `.cab-*`, `.plank`, `.shelf-row`, `.cabinets`) is unused and can be deleted in a cleanup.

## Natural shelves
- Only real articles are on the shelves (no decorative filler books; an empty folder is an empty shelf, on purpose).
- `Library._rowItems` arranges each row like a real shelf, decided from a hash of ids (same on every visit): mostly standing books, the last one
  leaning back on the others (`.lean-l`, 13 to 21 degrees), now and then one leaning on its neighbour (`.lean-r`), and in rows of 4+ books a
  short **stack lying flat** at the end (`li.stack` > `.book.flat`, spine text horizontal, small offsets and tilts).
  Leaning is `rotate(--lean)` on `.body` with the pivot at the bottom corner, plus a margin of `height * sin(lean)` so it does not overlap.
- Row capacity: `ROW_CAP` (547 units); each book counts its width + 5.
- `Library._palette` holds the vintage spine colours.

## How things work
- Pages are placeholders sized from the real page sizes. An IntersectionObserver renders canvas + text layer
  1200px before a page scrolls into view, and frees pages that are more than 5000px away.
- The text layer sits above the highlight layer so text stays selectable. Clicking an existing highlight is done by
  hit-testing the click position against the stored rectangles (`Highlighter.hitTest`).
- Autosave: every edit calls `Autosave.touch()` (450 ms debounce). `Autosave.flush()` runs on route change, page hide
  and before export. Scroll position is saved "silently" (no indicator).
- Colour names are changed in Settings. Highlight colours on the page use `mix-blend-mode: multiply`.
- Export: `Exporter.toMarkdown` and `Exporter.toHtml` share one model. "Copy" puts both flavours on the clipboard
  (HTML for Word/Notion, Markdown as plain text). Print fills `#print-root`; `@media print` hides the rest.
- Backup JSON: `{ format: 'marginalia-backup', version: 1, settings, articles: [{...article, pdfBase64}] }`.
  Import skips articles whose id already exists and only applies colour names if local ones are still the defaults.

## Shortcuts
Ctrl+H (Ctrl on Mac too; Cmd+H is taken by macOS) highlights the selection with the last used colour. Esc closes the toolbar or menu.

## Limits to know about
- Data lives in one browser on one origin. A different URL or browser starts empty, so use Export backup / Import backup to move.
- Safari clears site data after about 7 days without a visit (unless added to the Dock/Home Screen), so keep a backup.
- A backup is one JSON file with base64 PDFs; a library of several hundred MB may be too large to export in one go.
- Scanned PDFs need OCR first. Right-to-left and vertical text are untested.

## Tests
`tests` holds a Playwright end-to-end test (dev only, never deployed):
```
cd tests
npm install && npx playwright install chromium firefox webkit
node make-fixtures.js          # sample PDFs into fixtures/
node e2e.js                    # Chromium at 1280x800 and 1440x900, screenshots into screenshots/
BROWSER=firefox node e2e.js    # or webkit, msedge, chrome
```

## Personal touches
Settings has "Make it yours": a name (greeting on the start screen, localStorage `marginalia-name`) and an accent colour
(plum, sea, rose, forest; `data-accent` on <html>, localStorage `marginalia-accent`). All surfaces are tinted from the accent via `color-mix`, see the end of `css/style.css`.
