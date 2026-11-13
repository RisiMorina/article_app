'use strict';
/* App shell: hash router (#/ = library, #/article/<id> = reader), global keys, start-up. */

const App = {
  async route() {
    const m = location.hash.match(/^#\/article\/(.+)$/);
    if (m) {
      Library.hideAll();
      Notes.setSidebar(Notes.initialSidebarState());
      await Reader.open(decodeURIComponent(m[1]));
      return;
    }
    if (Reader.article) await Autosave.flush();
    Reader.close();
    if (location.hash === '#/library') await Library.show();
    else await Library.showWelcome();
  },

  async init() {
    $('#btn-settings-lib').dataset.icon = 'sliders';
    $('#btn-settings-welcome').dataset.icon = 'sliders';
    $('#btn-settings').dataset.icon = 'sliders';
    $('#btn-sidebar').dataset.icon = 'panel-right';
    hydrateIcons();

    Settings.init();
    Library.init();
    Reader.init();
    Highlighter.init();
    Ink.init();
    Notes.init();
    Exporter.init();

    $('#btn-settings-lib').addEventListener('click', () => Settings.open());
    $('#btn-settings').addEventListener('click', () => Settings.open());
    $('#btn-settings-welcome').addEventListener('click', () => Settings.open());
    $('#btn-back').addEventListener('click', () => { location.hash = '#/library'; });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { Highlighter.hideToolbar(); Exporter.closeMenu(); }
    });

    await Settings.load();
    window.addEventListener('hashchange', () => this.route());
    await this.route();
  }
};

App.init();
