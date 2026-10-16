/*
 * Kurgu Masası as a desktop app: one window that shows the editor (app/editor.html, the same
 * files the website serves). Nothing is loaded from the internet; links open in the browser.
 *
 * The editor's top bar doubles as the window's title bar: on macOS the traffic lights sit in it,
 * on Windows the minimise/maximise/close buttons are drawn over its right end.
 *
 * `--smoke-test` starts the app without showing it, runs smoke-renderer.js in the page (fonts,
 * encoders, automatic sync, a short encode) and exits with 0 when everything works. The release
 * workflow runs it on every platform before publishing.
 */
'use strict';
const { app, BrowserWindow, Menu, dialog, nativeTheme, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const smokeTest = process.argv.includes('--smoke-test');
const PAGE = path.join(__dirname, 'app', 'editor.html');
const REPO = 'https://github.com/bayramavci46/ekran0';
const RELEASES = `${REPO}/releases`;
const TOP_BAR = 64; // height of the editor's top bar in css/app.css

// Permissions the editor never needs; everything else (saving files, fullscreen) is allowed.
const DENIED = new Set([
  'media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'keyboardLock',
  'display-capture', 'idle-detection', 'window-management', 'mediaKeySystem', 'openExternal',
  'hid', 'serial', 'usb', 'bluetooth',
]);

const colors = () => (nativeTheme.shouldUseDarkColors
  ? { background: '#0c1112', symbols: '#e7eeec' }
  : { background: '#eef1f0', symbols: '#111a1c' });

let win = null;

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const c = colors();
  win = new BrowserWindow({
    width: Math.min(1440, area.width),
    height: Math.min(900, area.height),
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Kurgu Masası',
    backgroundColor: c.background,
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 25 } } : {}),
    ...(isWindows
      ? { titleBarStyle: 'hidden', titleBarOverlay: { color: c.background, symbolColor: c.symbols, height: TOP_BAR } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const contents = win.webContents;
  win.on('page-title-updated', (e) => e.preventDefault());
  win.once('ready-to-show', () => {
    if (!smokeTest) win.show();
  });

  // The window only ever shows the editor; web links open in the default browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (url === contents.getURL()) return;
    e.preventDefault();
    if (url.startsWith('https://')) shell.openExternal(url);
  });

  // During an export the editor asks the page not to be closed; ask the user instead of refusing silently.
  contents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Çık', 'Vazgeç'],
      defaultId: 1,
      cancelId: 1,
      message: 'Dışa aktarma sürüyor',
      detail: 'Şimdi çıkarsanız video kaydedilmez.',
    });
    if (choice === 0) e.preventDefault();
  });

  win.on('closed', () => {
    win = null;
  });
  win.loadFile(PAGE);
  return win;
}

/** Runs a command of the editor's menu as if it came from a click, so file pickers may open. */
function command(name) {
  return () => {
    if (!win) return;
    win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('kurgu:command', { detail: ${JSON.stringify(name)} }))`,
      true,
    );
  };
}

function buildMenu() {
  if (!isMac) {
    // Windows and Linux get no menu bar: the editor has its own controls, and Ctrl+R must not reload it.
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Kurgu Masası',
      submenu: [
        { role: 'about', label: 'Kurgu Masası hakkında' },
        { type: 'separator' },
        { role: 'services', label: 'Servisler' },
        { type: 'separator' },
        { role: 'hide', label: 'Kurgu Masası’nı gizle' },
        { role: 'hideOthers', label: 'Diğerlerini gizle' },
        { role: 'unhide', label: 'Tümünü göster' },
        { type: 'separator' },
        { role: 'quit', label: 'Kurgu Masası’ndan çık' },
      ],
    },
    {
      label: 'Dosya',
      submenu: [
        { label: 'Ekran kaydını aç…', accelerator: 'CmdOrCtrl+O', click: command('open-screen') },
        { label: 'Kamera kaydını aç…', accelerator: 'CmdOrCtrl+Shift+O', click: command('open-camera') },
        { type: 'separator' },
        { label: 'Videoyu dışa aktar…', accelerator: 'CmdOrCtrl+E', click: command('export') },
        { type: 'separator' },
        { role: 'close', label: 'Pencereyi kapat' },
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        // The editor keeps its own history; in a text field these act on the text instead.
        { label: 'Geri al', accelerator: 'CmdOrCtrl+Z', click: command('undo') },
        { label: 'Yinele', accelerator: 'Shift+CmdOrCtrl+Z', click: command('redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Kes' },
        { role: 'copy', label: 'Kopyala' },
        { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü seç' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [{ role: 'togglefullscreen', label: 'Tam ekran' }],
    },
    {
      role: 'windowMenu',
      label: 'Pencere',
    },
    {
      role: 'help',
      label: 'Yardım',
      submenu: [
        { label: 'Klavye kısayolları', accelerator: 'Shift+CmdOrCtrl+/', click: command('shortcuts') },
        { type: 'separator' },
        { label: 'Yeni sürümler', click: () => shell.openExternal(RELEASES) },
        { label: 'Kaynak kodu', click: () => shell.openExternal(REPO) },
      ],
    },
  ]));
}

// ---- Smoke test ---------------------------------------------------------------------------

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function runSmokeTest() {
  const out = argValue('smoke-out');
  const finish = (result, code) => {
    const text = JSON.stringify(result, null, 2);
    if (out) fs.writeFileSync(out, text);
    process.stdout.write(`${text}\n`);
    app.exit(code);
  };
  const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }, 2), 180000);
  try {
    const w = createWindow();
    const errors = [];
    w.webContents.on('console-message', (e, level, message) => {
      const lvl = e && e.level !== undefined ? e.level : level;
      if (lvl === 'error' || lvl === 3) errors.push(e && e.message !== undefined ? e.message : message);
    });
    await new Promise((resolve, reject) => {
      w.webContents.once('did-finish-load', resolve);
      w.webContents.once('did-fail-load', (e, code, description) => reject(new Error(`${code} ${description}`)));
    });
    const code = fs.readFileSync(path.join(__dirname, 'smoke-renderer.js'), 'utf8');
    const result = await w.webContents.executeJavaScript(code, true);
    result.platform = `${process.platform}-${process.arch}`;
    result.electron = process.versions.electron;
    result.consoleErrors = errors;
    result.ok = result.checks.every((c) => c.ok) && errors.length === 0;
    clearTimeout(timer);
    finish(result, result.ok ? 0 : 1);
  } catch (err) {
    clearTimeout(timer);
    finish({ ok: false, error: String(err && err.stack ? err.stack : err) }, 1);
  }
}

// ---- Start ------------------------------------------------------------------------------------

if (!smokeTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (isWindows) app.setAppUserModelId('io.github.bayramavci46.kurgumasasi');

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(!DENIED.has(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => !DENIED.has(permission));
    app.setAboutPanelOptions({
      applicationName: 'Kurgu Masası',
      applicationVersion: app.getVersion(),
      copyright: '© 2026 Bayram Avcı',
      credits: 'Mediabunny (MPL-2.0), Barlow ve JetBrains Mono (SIL Open Font License) ile.',
      website: REPO,
    });
    buildMenu();

    nativeTheme.on('updated', () => {
      if (!win) return;
      const c = colors();
      win.setBackgroundColor(c.background);
      if (isWindows) win.setTitleBarOverlay({ color: c.background, symbolColor: c.symbols, height: TOP_BAR });
    });

    if (smokeTest) {
      runSmokeTest();
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (!win) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac || smokeTest) app.quit();
  });
}
