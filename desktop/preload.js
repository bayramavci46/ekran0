/*
 * Runs before the editor's own scripts. It marks the page as the desktop app, so the stylesheet
 * can make room for the window buttons in the top bar (see "Desktop app" in css/app.css), and
 * gives the recording panel (js/record-panel.js) three narrow calls to the app as
 * window.kurguDesktop. The page gets no other access to Node or Electron.
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';

function mark() {
  document.documentElement.dataset.desktop = platform;
}

if (document.documentElement) {
  mark();
} else {
  // The preload runs before the document exists; mark <html> as soon as it is created.
  new MutationObserver((records, observer) => {
    if (!document.documentElement) return;
    mark();
    observer.disconnect();
  }).observe(document, { childList: true });
}

contextBridge.exposeInMainWorld('kurguDesktop', {
  platform,
  /** The app asks which screen or window to record: callback({sources: [{id, kind, name, thumbnail}], access}). */
  onSourceRequest(callback) {
    ipcRenderer.on('kurgu:pick-source', (e, request) => callback(request));
  },
  /** The answer: a source id, or null to cancel. */
  chooseSource(id) {
    ipcRenderer.send('kurgu:choose-source', typeof id === 'string' ? id : null);
  },
  /** How the recording goes ({state, elapsed, hide}), for the tray icon and the window. */
  setRecording(info) {
    ipcRenderer.send('kurgu:recording', {
      state: String(info && info.state),
      elapsed: Number(info && info.elapsed) || 0,
      hide: !!(info && info.hide),
    });
  },
});
