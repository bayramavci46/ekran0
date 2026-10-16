/*
 * Kurgu Masası as a desktop app: one window that shows the editor (app/editor.html, the same
 * files the website serves). Nothing is loaded from the internet; links open in the browser.
 *
 * The editor's top bar doubles as the window's title bar: on macOS the traffic lights sit in it,
 * on Windows the minimise/maximise/close buttons are drawn over its right end.
 *
 * Recording: the editor records the screen and the camera itself (js/recorder.js). Here the app
 * lets it use the camera, the microphone and the screen, offers the screens and windows to pick
 * from (macOS 15 and later show the system's own picker instead), and while a recording runs it
 * keeps an icon in the tray (the menu bar on macOS) to pause or stop it, steps the window aside if
 * asked to, and keeps the system from putting the app to sleep.
 *
 * `--smoke-test` starts the app without showing it, runs smoke-renderer.js in the page (fonts,
 * encoders, automatic sync, a short encode) and exits with 0 when everything works. The release
 * workflow runs it on every platform before publishing.
 */
'use strict';
const {
  app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme,
  powerSaveBlocker, screen, session, shell, systemPreferences, webContents,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const smokeTest = process.argv.includes('--smoke-test');
const PAGE = path.join(__dirname, 'app', 'editor.html');
const REPO = 'https://github.com/bayramavci46/ekran0';
const RELEASES = `${REPO}/releases`;
const TOP_BAR = 64; // height of the editor's top bar in css/app.css

// Permissions the editor never needs; everything else (camera and microphone, the screen,
// saving files, fullscreen) is allowed. The window only ever shows the editor's own files.
const DENIED = new Set([
  'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'keyboardLock',
  'idle-detection', 'window-management', 'mediaKeySystem', 'openExternal',
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

  // During an export or a recording the editor asks the page not to be closed; ask the user
  // instead of refusing silently.
  contents.on('will-prevent-unload', (e) => {
    const recordingNow = recording.state !== 'idle';
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Çık', 'Vazgeç'],
      defaultId: 1,
      cancelId: 1,
      message: recordingNow ? 'Kayıt sürüyor' : 'Dışa aktarma sürüyor',
      detail: recordingNow ? 'Şimdi çıkarsanız bu kayıt silinir.' : 'Şimdi çıkarsanız video kaydedilmez.',
    });
    if (choice === 0) e.preventDefault();
  });

  win.on('closed', () => {
    win = null;
    if (pendingPick) pendingPick(null);
    pendingPick = null;
    recording = { state: 'idle', elapsed: 0, hide: false };
    syncTray();
    if (sleepBlocker !== null) powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
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

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- Recording ------------------------------------------------------------------------------

/** The screens and windows to record, for the editor's picker (when the system has none). */
async function captureSources() {
  let sources = [];
  // The first look right after start can come back empty (seen on Linux); look again shortly after.
  for (const wait of [0, 400, 1200]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 } });
    if (sources.some((s) => s.id.startsWith('screen:'))) break;
  }
  const own = win ? win.getMediaSourceId() : '';
  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => !s.id.startsWith('screen:') && s.id !== own && s.name);
  return [...screens, ...windows].map((s) => ({
    source: s,
    id: s.id,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    name: s.id.startsWith('screen:') ? (screens.length > 1 ? `Ekran ${screens.indexOf(s) + 1}` : 'Tüm ekran') : s.name,
    thumbnail: s.thumbnail.isEmpty() ? '' : `data:image/jpeg;base64,${s.thumbnail.toJPEG(82).toString('base64')}`,
  }));
}

let pendingPick = null;

/** Shows the picker in the editor's recording panel; resolves to the chosen source's id, or null. */
function askForSource(list) {
  if (pendingPick) pendingPick(null);
  return new Promise((resolve) => {
    pendingPick = resolve;
    const access = isMac ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
    win.webContents.send('kurgu:pick-source', {
      access,
      sources: list.map(({ id, kind, name, thumbnail }) => ({ id, kind, name, thumbnail })),
    });
  });
}

async function onDisplayMediaRequest(request, callback) {
  let answered = false;
  const answer = (streams) => {
    if (answered) return;
    answered = true;
    // No argument at all is how Electron is told that nothing was chosen.
    if (streams) callback(streams);
    else callback();
  };
  try {
    if (!win || !request.frame || webContents.fromFrame(request.frame) !== win.webContents) {
      answer(null);
      return;
    }
    const list = await captureSources();
    const id = await askForSource(list);
    const chosen = id && list.find((s) => s.id === id);
    if (!chosen) {
      answer(null);
      return;
    }
    // Only Windows can hand over the computer's own sound.
    answer({ video: chosen.source, ...(isWindows && request.audioRequested ? { audio: 'loopback' } : {}) });
  } catch (err) {
    console.error(err);
    answer(null);
  }
}

const TRAY_ICONS = {};
function trayIcon(name) {
  if (!TRAY_ICONS[name]) TRAY_ICONS[name] = nativeImage.createFromPath(path.join(__dirname, 'assets', `${name}.png`));
  return TRAY_ICONS[name];
}

let recording = { state: 'idle', elapsed: 0, hide: false };
let tray = null;
let trayMenuFor = '';
let steppedAside = false;
let sleepBlocker = null;

const clock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const pad = (n) => String(n).padStart(2, '0');
  return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

function syncTray() {
  const { state } = recording;
  if (state === 'idle') {
    if (tray) tray.destroy();
    tray = null;
    trayMenuFor = '';
    return;
  }
  const active = state === 'recording' || state === 'paused';
  if (!tray) {
    tray = new Tray(trayIcon('tray-recording'));
    // Windows opens the menu with the right button; the left one brings the editor back.
    if (!isMac) tray.on('click', showWindow);
  }
  const time = clock(recording.elapsed);
  const label = state === 'paused' ? 'Kayıt duraklatıldı' : state === 'finishing' ? 'Kayıt hazırlanıyor…' : 'Kaydediliyor';
  tray.setImage(trayIcon(state === 'paused' ? 'tray-paused' : 'tray-recording'));
  tray.setToolTip(`Kurgu Masası · ${label} · ${time}`);
  if (isMac) tray.setTitle(` ${time}`, { fontType: 'monospacedDigit' });
  // The menu is rebuilt when the state changes only, so an open menu stays open while the time runs.
  if (trayMenuFor === state) return;
  trayMenuFor = state;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    { label: state === 'paused' ? 'Devam et' : 'Duraklat', enabled: active, click: command('record-pause') },
    { label: 'Kaydı bitir', enabled: active, click: command('record-stop') },
    { type: 'separator' },
    { label: 'Kurgu Masası’nı göster', click: showWindow },
  ]));
}

/** The editor tells how its recording goes: {state: idle|recording|paused|finishing, elapsed, hide}. */
function onRecordingState(e, info) {
  if (!win || e.sender !== win.webContents || !info || typeof info !== 'object') return;
  const state = ['recording', 'paused', 'finishing'].includes(info.state) ? info.state : 'idle';
  const before = recording.state;
  recording = { state, elapsed: Number(info.elapsed) || 0, hide: info.hide === true };
  const running = state === 'recording' || state === 'paused';
  if (before === 'idle' && state === 'recording') {
    // Keep recording while the window is minimised or hidden: no timer throttling, no App Nap.
    win.webContents.setBackgroundThrottling(false);
    if (sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension');
    if (recording.hide && !win.isMinimized()) {
      win.minimize();
      steppedAside = true;
    }
  }
  if (!running && (before === 'recording' || before === 'paused')) {
    if (steppedAside) showWindow();
    steppedAside = false;
  }
  if (state === 'idle' && before !== 'idle') {
    win.webContents.setBackgroundThrottling(true);
    if (sleepBlocker !== null) powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
  syncTray();
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
        { label: 'Ekranı ve kamerayı kaydet…', accelerator: 'CmdOrCtrl+Shift+R', click: command('record') },
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
    // The tray icon comes with a recording and goes with it.
    const fake = { sender: w.webContents };
    onRecordingState(fake, { state: 'recording', elapsed: 65, hide: false });
    const shown = !!tray && !tray.isDestroyed();
    onRecordingState(fake, { state: 'idle', elapsed: 0, hide: false });
    result.checks.push({ name: 'tray icon while recording', ok: shown && tray === null, info: null });
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
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, callback) => callback(!DENIED.has(permission)));
    ses.setPermissionCheckHandler((wc, permission) => !DENIED.has(permission));
    // macOS 15 and later: the system's own picker (with its privacy guarantees); elsewhere the editor's.
    ses.setDisplayMediaRequestHandler(onDisplayMediaRequest, { useSystemPicker: true });
    ipcMain.on('kurgu:choose-source', (e, id) => {
      if (!win || e.sender !== win.webContents || !pendingPick) return;
      const resolve = pendingPick;
      pendingPick = null;
      resolve(typeof id === 'string' ? id : null);
    });
    ipcMain.on('kurgu:recording', onRecordingState);
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
