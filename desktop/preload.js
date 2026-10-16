/*
 * Runs before the editor's own scripts. It only marks the page as the desktop app, so the
 * stylesheet can make room for the window buttons in the top bar (see "Desktop app" in css/app.css).
 * The page gets no access to Node or Electron.
 */
'use strict';

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
