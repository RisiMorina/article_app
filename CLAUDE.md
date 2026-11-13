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
- Each row has a folder select (with "New folder…") and a "To read" toggle. Folders are created/renamed/deleted in the
  library; deleting a folder keeps its articles (they become "No folder"). Names are unique, case-insensitive.

## Pen and eraser
- Reader header has Select / Pen / Eraser buttons (keys V, P, E; Esc goes back to Select) and four pen colours.
  Ctrl+Z takes back the last stroke drawn in this session while Pen or Eraser is active.
- `article.ink = [{ id, page, color: red|blue|green|black, width, pts: [[x, y], ...] }]`. x and y are fractions of the
  page width/height, width is a fraction of the page width (so zoom just scales it). Drawn as SVG paths in a layer
  above the text layer; with Pen or Eraser active that layer takes the pointer and the text layer is disabled.
- The eraser removes whole strokes it touches. Ink is saved with the article and travels in backups, but it is not
  part of the Markdown/HTML/print export (notes only).

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
