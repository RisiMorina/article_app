'use strict';
/* Small shared helpers: DOM, ids, debounce, icons, toasts, confirm dialog. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element. props: class, dataset, style (object, css vars ok), on* handlers, text, html (trusted only). */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style' && typeof v === 'object') for (const [a, b] of Object.entries(v)) e.style.setProperty(a, b);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fileBaseName(name) {
  return String(name || 'Untitled').replace(/\.pdf$/i, '');
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'notes';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- Icons (24x24, stroke) ---------- */
const ICONS = {
  'arrow-left': '<path d="M19 12H5m7-7-7 7 7 7"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'minus': '<path d="M5 12h14"/>',
  'x': '<path d="M6 6l12 12M18 6 6 18"/>',
  'trash': '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  'sliders': '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  'cursor': '<path d="M5 3l14 7-6 2-2 6z"/>',
  'pen': '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
  'eraser': '<path d="M9 20h11M4.5 14.5l9-9 5 5-7.5 7.5H8z"/>',
  'bookmark':'<path d="M6 4h12v17l-6-4-6 4z"/>',
  'folder': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'inbox': '<path d="M4 13h4l1 3h6l1-3h4M4 13l2-8h12l2 8v6H4z"/>',
  'jump':'<path d="M7 17 17 7M8 7h9v9"/>'
};
function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}
/** Put icons in every element that has data-icon and no icon yet. */
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach(el => {
    if (el.querySelector(':scope > svg.ic')) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}

/* ---------- Toasts ---------- */
function toast(message, opts = {}) {
  const box = $('#toasts');
  const t = h('div', { class: 'toast' }, h('span', { text: message }));
  let timer;
  const close = () => { clearTimeout(timer); t.remove(); };
  if (opts.actionLabel) {
    t.append(h('button', { type: 'button', class: 'toast-action', text: opts.actionLabel, onclick: () => { close(); opts.onAction && opts.onAction(); } }));
  }
  box.append(t);
  timer = setTimeout(close, opts.timeout || (opts.actionLabel ? 7000 : 3500));
  return close;
}

/* ---------- Confirm dialog (native <dialog>) ---------- */
function confirmDialog(message, okLabel = 'Delete') {
  const dlg = $('#dlg-confirm');
  $('#confirm-msg').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  dlg.returnValue = '';
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    $('#confirm-cancel').focus();
  });
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}
