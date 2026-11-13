'use strict';
/* Settings: what each highlight colour means (stored in IndexedDB so it travels with backups)
   and the theme (stored in localStorage so it applies before first paint). */

const COLORS = ['yellow', 'green', 'blue', 'pink'];
const DEFAULT_LABELS = { yellow: 'Key claim', green: 'Evidence', blue: 'Definition', pink: 'Disagree' };

const Settings = {
  labels: { ...DEFAULT_LABELS },
  listeners: [],

  async load() {
    try {
      const saved = await DB.getSetting('colorLabels', null);
      if (saved) this.labels = { ...DEFAULT_LABELS, ...saved };
    } catch (e) { console.warn('Could not load settings', e); }
    this.applyTheme(this.theme());
  },

  label(color) { return (this.labels[color] || '').trim() || color[0].toUpperCase() + color.slice(1); },
  isDefault() { return COLORS.every(c => this.labels[c] === DEFAULT_LABELS[c]); },
  onChange(fn) { this.listeners.push(fn); },

  setLabel(color, text) {
    this.labels[color] = text;
    this._save();
    this.listeners.forEach(fn => fn());
  },
  _save: debounce(() => DB.setSetting('colorLabels', { ...Settings.labels }).catch(console.error), 400),

  async replaceLabels(labels) {
    this.labels = { ...DEFAULT_LABELS, ...labels };
    await DB.setSetting('colorLabels', { ...this.labels });
    this.listeners.forEach(fn => fn());
  },

  theme() { try { return localStorage.getItem('marginalia-theme') || 'auto'; } catch (e) { return 'auto'; } },
  applyTheme(t) {
    document.documentElement.dataset.theme = t === 'light' || t === 'dark' ? t : 'auto';
  },
  setTheme(t) {
    try { t === 'auto' ? localStorage.removeItem('marginalia-theme') : localStorage.setItem('marginalia-theme', t); } catch (e) { /* storage blocked: theme just won't persist */ }
    this.applyTheme(t);
  },

  store(key) { try { return localStorage.getItem('marginalia-' + key) || ''; } catch (e) { return ''; } },
  save(key, v) { try { v ? localStorage.setItem('marginalia-' + key, v) : localStorage.removeItem('marginalia-' + key); } catch (e) { /* optional */ } },
  accent() { return this.store('accent') || 'plum'; },
  applyAccent(a) { document.documentElement.dataset.accent = a; },
  name() { return this.store('name').trim(); },

  /** Build and open the settings dialog. */
  open() {
    const box = $('#color-fields');
    box.replaceChildren(...COLORS.map(c => {
      const id = 'label-' + c;
      return h('div', { class: 'color-field' },
        h('span', { class: 'dot', style: { '--hl': `var(--c-${c})` }, 'aria-hidden': 'true' }),
        h('label', { for: id, class: 'sr-only', text: `Meaning of ${c}` }),
        h('input', {
          id, type: 'text', value: this.labels[c], maxlength: 40, placeholder: DEFAULT_LABELS[c],
          'aria-label': `Meaning of ${c}`,
          oninput: e => this.setLabel(c, e.target.value)
        }));
    }));
    $$('input[name=theme]').forEach(r => { r.checked = r.value === this.theme(); });
    $$('input[name=accent]').forEach(r => { r.checked = r.value === this.accent(); });
    $('#user-name').value = this.name();
    $('#dlg-settings').showModal();
  },

  init() {
    $$('input[name=accent]').forEach(r => r.addEventListener('change', () => { if (r.checked) { this.save('accent', r.value); this.applyAccent(r.value); } }));
    $('#user-name').addEventListener('input', e => { this.save('name', e.target.value.trim()); Library.updateGreeting(); });
    this.applyAccent(this.accent());
    $$('input[name=theme]').forEach(r => r.addEventListener('change', () => { if (r.checked) this.setTheme(r.value); }));
  }
};
