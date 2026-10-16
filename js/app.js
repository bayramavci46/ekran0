/*
 * Wires the editor together: state, file loading, preview rendering, controls,
 * undo/redo, automatic sync, saved preferences and the export flow.
 */
(function (root) {
  'use strict';
  const PE = root.PipEditor;
  const KM = root.KM;
  const U = PE.util;
  const G = PE.geometry;
  const exporter = PE.exporter;
  const autoSync = PE.autoSync;
  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = 'ekran-kamera-kurgu:v1';
  const DEMO_FRAME = { width: 1920, height: 1080 };
  const VIDEO_NAME = /\.(mp4|m4v|mov|webm|mkv|ogv|3gp)$/i;
  const RESOLUTIONS = [2160, 1440, 1080, 720, 480];

  const state = {
    media: { screen: null, camera: null },
    look: {
      box: null, shape: 'rounded', radius: 0.35, borderWidth: 4, borderColor: '#ffffff',
      shadow: true, mirror: false, visible: true,
    },
    offset: 0,
    trim: { start: 0, end: 0 },
    audio: { screen: { volume: 1, muted: false }, camera: { volume: 1, muted: false } },
    // format stays null until the user picks one; until then the best available is used.
    output: { preset: 'source', fps: 30, quality: 'high', format: null },
    formats: null,
    plan: null,
    exporting: null,
    result: null,
    // Automatic sync: whether it runs on load, and the last run ({status, result, before, ...}).
    autoSync: true,
    sync: { status: 'idle' },
  };

  const els = {
    monitor: $('monitor'), frame: $('frame'), canvas: $('preview'), camBox: $('camBox'),
    guides: $('guides'), readout: $('camReadout'), badge: $('frameBadge'), dropVeil: $('dropVeil'),
    status: $('projectStatus'), statusText: $('projectStatusText'), undo: $('undoBtn'), redo: $('redoBtn'),
    shortcutsBtn: $('shortcutsBtn'), exportJump: $('exportJumpBtn'), exportPanel: $('exportPanel'),
    shellFile: $('shellFile'), shellMeta: $('shellMeta'), shellSync: $('shellSync'), shellSyncText: $('shellSyncText'),
    syncBtn: $('autoSyncBtn'), syncLabel: $('autoSyncLabel'), applySync: $('applySyncBtn'),
    autoSyncOnLoad: $('autoSyncOnLoad'), syncStatus: $('syncStatus'), syncStatusText: $('syncStatusText'),
    syncScope: $('syncScope'), syncCanvas: $('syncCanvas'), syncMeta: $('syncMeta'), timeline: $('timeline'),
    play: $('playBtn'), toStart: $('toStartBtn'), toEnd: $('toEndBtn'),
    prevFrame: $('prevFrameBtn'), nextFrame: $('nextFrameBtn'),
    tcNow: $('tcNow'), tcTotal: $('tcTotal'), markIn: $('markInBtn'), markOut: $('markOutBtn'),
    rangeInfo: $('rangeInfo'),
    slots: { screen: $('slotScreen'), camera: $('slotCamera') },
    inputs: { screen: $('fileScreen'), camera: $('fileCamera') },
    drops: { screen: $('dropScreen'), camera: $('dropCamera') },
    swap: $('swapBtn'), loadError: $('loadError'),
    shapeGroup: $('shapeGroup'), radiusField: $('radiusField'), radius: $('radius'), radiusOut: $('radiusOut'),
    size: $('size'), sizeOut: $('sizeOut'), border: $('border'), borderOut: $('borderOut'),
    swatches: $('swatches'), borderColor: $('borderColor'),
    shadow: $('shadow'), mirror: $('mirror'), camVisible: $('camVisible'),
    vol: { screen: $('volScreen'), camera: $('volCamera') },
    volOut: { screen: $('volScreenOut'), camera: $('volCameraOut') },
    mute: { screen: $('muteScreen'), camera: $('muteCamera') },
    offset: $('offset'), align: $('alignBtn'),
    outRes: $('outRes'), outFps: $('outFps'), outQuality: $('outQuality'), outFormat: $('outFormat'),
    method: $('exportMethod'), exportBtn: $('exportBtn'),
    progress: $('exportProgress'), progressWrap: $('progressBarWrap'), progressBar: $('progressBar'),
    progressText: $('progressText'), cancel: $('cancelBtn'),
    result: $('exportResult'), resultVideo: $('resultVideo'), resultText: $('resultText'),
    download: $('downloadBtn'), closeResult: $('closeResultBtn'),
    exportError: $('exportError'), retryRealtime: $('retryRealtimeBtn'), volumeNote: $('volumeNote'),
  };
  const videos = { screen: $('screenVideo'), camera: $('cameraVideo') };
  const ctx = els.canvas.getContext('2d', { alpha: false });
  const demo = PE.demo.create();
  const player = new PE.SyncPlayer(videos.screen, videos.camera);

  // ---- Derived values -------------------------------------------------------

  const isDemo = () => !state.media.screen && !state.media.camera;
  const cameraEditable = () => isDemo() || !!state.media.camera;
  const fps = () => state.output.fps;

  function frameSize() {
    const s = state.media.screen;
    return s ? { width: s.width, height: s.height } : DEMO_FRAME;
  }

  function outputSize() {
    const f = frameSize();
    return G.outputSize(f.width, f.height, state.output.preset === 'source' ? null : Number(state.output.preset));
  }

  function cameraAspect() {
    const c = state.media.camera;
    return c ? c.width / c.height : demo.camera.width / demo.camera.height;
  }

  const gain = (a) => (a.muted ? 0 : a.volume);

  // iPhone and iPad keep media volume at 100 % (only muting works), so the preview cannot follow the sliders.
  const volumeLocked = (() => {
    const probe = document.createElement('video');
    probe.volume = 0.5;
    return probe.volume !== 0.5;
  })();

  /** The container to export: the user's choice, or the first one this browser encodes fast. */
  function formatId() {
    const list = state.formats || [];
    if (state.output.format && (!state.formats || list.some((f) => f.id === state.output.format))) {
      return state.output.format;
    }
    const best = list.find((f) => f.fast) || list[0];
    return best ? best.id : 'mp4';
  }

  // ---- Preferences ----------------------------------------------------------

  const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

  function loadPrefs() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (err) {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return;
    const look = saved.look || {};
    const L = state.look;
    const b = look.box;
    if (b && ['x', 'y', 'w', 'h'].every((k) => finite(b[k], 0, 1)) && b.w > 0.01 && b.h > 0.01) L.box = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (['rect', 'rounded', 'circle'].includes(look.shape)) L.shape = look.shape;
    if (finite(look.radius, 0, 1)) L.radius = look.radius;
    if (finite(look.borderWidth, 0, 24)) L.borderWidth = look.borderWidth;
    if (/^#[0-9a-f]{6}$/i.test(look.borderColor || '')) L.borderColor = look.borderColor;
    for (const k of ['shadow', 'mirror', 'visible']) if (typeof look[k] === 'boolean') L[k] = look[k];
    const out = saved.output || {};
    if (['source', ...RESOLUTIONS.map(String)].includes(out.preset)) state.output.preset = out.preset;
    if ([24, 25, 30, 50, 60].includes(out.fps)) state.output.fps = out.fps;
    if (['very-high', 'high', 'medium', 'low'].includes(out.quality)) state.output.quality = out.quality;
    if (['mp4', 'webm'].includes(out.format)) state.output.format = out.format;
    if (typeof saved.autoSync === 'boolean') state.autoSync = saved.autoSync;
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ look: state.look, output: state.output, autoSync: state.autoSync }));
    } catch (err) {
      // Storage can be unavailable (private mode); preferences are a convenience only.
    }
  }

  // ---- Undo / redo ----------------------------------------------------------

  const history = { past: [], future: [] };
  const snapshot = () => JSON.stringify({ look: state.look, offset: state.offset, trim: state.trim });
  let current = null;

  function commit() {
    const now = snapshot();
    if (now === current) return;
    if (current !== null) {
      history.past.push(current);
      if (history.past.length > 100) history.past.shift();
    }
    history.future.length = 0;
    current = now;
    savePrefs();
    syncUndo();
    refreshPlan();
  }

  function resetHistory() {
    history.past.length = 0;
    history.future.length = 0;
    current = snapshot();
    syncUndo();
  }

  function restore(snap) {
    const s = JSON.parse(snap);
    state.look = s.look;
    state.offset = s.offset;
    const D = player.duration;
    state.trim = D > 0
      ? { start: G.clamp(s.trim.start, 0, D), end: G.clamp(s.trim.end, 0, D) }
      : s.trim;
    current = snap;
    applyPlayerSettings();
    player.resync();
    savePrefs();
    syncAll();
    refreshPlan();
  }

  function undo() {
    if (!history.past.length) return;
    history.future.push(current);
    restore(history.past.pop());
  }

  function redo() {
    if (!history.future.length) return;
    history.past.push(current);
    restore(history.future.pop());
  }

  function syncUndo() {
    els.undo.disabled = history.past.length === 0;
    els.redo.disabled = history.future.length === 0;
  }

  // ---- Rendering ------------------------------------------------------------

  function currentScene() {
    if (isDemo()) return { screen: demo.screen, camera: demo.camera, look: state.look };
    let screen = demo.placeholder;
    let camera = null;
    const sv = videos.screen;
    const cv = videos.camera;
    if (state.media.screen) {
      screen = sv.readyState >= 2 ? { source: sv, width: sv.videoWidth, height: sv.videoHeight } : null;
    }
    if (state.media.camera && cv.readyState >= 2) {
      const active = state.media.screen ? player.cameraActiveAt(player.currentTime) : true;
      if (active) camera = { source: cv, width: cv.videoWidth, height: cv.videoHeight };
    }
    return { screen, camera, look: state.look };
  }

  function render() {
    renderQueued = false;
    PE.renderer.drawFrame(ctx, els.canvas.width, els.canvas.height, currentScene());
  }

  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  const stacked = matchMedia('(max-width: 860px)');

  function fitFrame() {
    const { width: FW, height: FH } = frameSize();
    const aspect = FW / FH;
    const mon = els.monitor;
    const cs = getComputedStyle(mon);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = mon.clientWidth - padX;
    let w;
    let h;
    if (stacked.matches) {
      w = availW;
      h = w / aspect;
      const maxH = window.innerHeight * 0.68;
      if (h > maxH) {
        h = maxH;
        w = h * aspect;
      }
      const monH = `${Math.round(h + padY)}px`;
      if (mon.style.height !== monH) mon.style.height = monH;
    } else {
      if (mon.style.height) mon.style.height = '';
      const availH = mon.clientHeight - padY;
      w = Math.min(availW, availH * aspect);
      h = w / aspect;
    }
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    els.frame.style.width = `${w}px`;
    els.frame.style.height = `${h}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(2, Math.min(Math.round(w * dpr), FW));
    const ch = Math.max(2, Math.round(cw / aspect));
    if (els.canvas.width !== cw || els.canvas.height !== ch) {
      els.canvas.width = cw;
      els.canvas.height = ch;
    }
    editor.setLook(state.look, cameraEditable());
    render();
  }

  // ---- Camera box -----------------------------------------------------------

  const editor = new PE.CameraBoxEditor({
    frame: els.frame,
    box: els.camBox,
    guides: els.guides,
    readout: els.readout,
    outputSize,
    onChange(box, phase) {
      state.look.box = box;
      editor.setLook(state.look, cameraEditable());
      syncCameraControls();
      requestRender();
      if (phase === 'commit') commit();
    },
  });

  function ensureBox() {
    if (state.look.box) return;
    const { width: W, height: H } = frameSize();
    let box = G.defaultBox(cameraAspect(), W, H);
    if (state.look.shape === 'circle') box = G.placeAt(G.toSquare(box, W, H), 'br', W, H);
    state.look.box = G.toNorm(box, W, H);
  }

  /** Keeps the camera's on-screen shape when the frame's aspect ratio changes. */
  function reframe(oldF, newF) {
    const b = state.look.box;
    if (!b || (oldF.width === newF.width && oldF.height === newF.height)) return;
    const px = G.toPx(b, oldF.width, oldF.height);
    const aspect = px.w / px.h;
    const w = b.w * newF.width;
    const h = w / aspect;
    const cx = (b.x + b.w / 2) * newF.width;
    const cy = (b.y + b.h / 2) * newF.height;
    const fitted = G.fitInside({ x: cx - w / 2, y: cy - h / 2, w, h }, newF.width, newF.height);
    state.look.box = G.toNorm(fitted, newF.width, newF.height);
  }

  function updateBox(fn) {
    const { width: W, height: H } = frameSize();
    state.look.box = G.toNorm(fn(G.toPx(state.look.box, W, H), W, H), W, H);
  }

  function setShape(shape) {
    if (shape === state.look.shape) return;
    const from = state.look.shape;
    state.look.shape = shape;
    if (shape === 'circle') updateBox((b, W, H) => G.toSquare(b, W, H));
    else if (from === 'circle') updateBox((b, W, H) => G.withAspect(b, cameraAspect(), W, H));
    commit();
    syncCamera();
  }

  const shapeControl = KM.segmented(els.shapeGroup, setShape);

  // ---- Media loading --------------------------------------------------------

  function probeDuration(el) {
    // Files written by MediaRecorder often report an infinite duration until the end is seen.
    return new Promise((resolve) => {
      const finish = () => {
        el.removeEventListener('durationchange', check);
        el.removeEventListener('seeked', check);
        clearTimeout(timer);
        const d = el.duration;
        el.currentTime = 0;
        resolve(Number.isFinite(d) ? d : NaN);
      };
      const check = () => { if (Number.isFinite(el.duration)) finish(); };
      const timer = setTimeout(finish, 15000);
      el.addEventListener('durationchange', check);
      el.addEventListener('seeked', check);
      el.currentTime = 1e101;
    });
  }

  /** Plays a muted element for a moment; Safari on iPhone loads nothing until playback starts. */
  function nudge(el) {
    const started = el.play();
    if (started) started.then(() => el.pause()).catch(() => {});
  }

  /** Waits until a frame can be drawn (or gives up after a few seconds). */
  function firstFrame(el) {
    if (el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      let nudgeTimer = 0;
      let giveUp = 0;
      const done = () => {
        el.removeEventListener('loadeddata', done);
        clearTimeout(nudgeTimer);
        clearTimeout(giveUp);
        resolve();
      };
      el.addEventListener('loadeddata', done);
      nudgeTimer = setTimeout(() => nudge(el), 400);
      giveUp = setTimeout(done, 6000);
    });
  }

  function openVideo(el, url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let nudgeTimer = 0;
      let giveUp = 0;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        el.removeEventListener('loadedmetadata', onMeta);
        el.removeEventListener('error', onError);
        clearTimeout(nudgeTimer);
        clearTimeout(giveUp);
        fn(value);
      };
      const onMeta = () => finish(resolve);
      const onError = () => finish(reject, new Error('unsupported'));
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('error', onError);
      // Muted media may load and play without a click; the real mute state is restored afterwards.
      el.muted = true;
      el.src = url;
      el.load();
      nudgeTimer = setTimeout(() => nudge(el), 1000);
      giveUp = setTimeout(() => finish(reject, new Error('timeout')), 30000);
    }).then(async () => {
      if (!el.videoWidth || !el.videoHeight) throw new Error('no-video');
      const duration = Number.isFinite(el.duration) ? el.duration : await probeDuration(el);
      if (!(duration > 0)) throw new Error('no-duration');
      await firstFrame(el);
      return { width: el.videoWidth, height: el.videoHeight, duration };
    });
  }

  function loadErrorText(name, err) {
    if (err.message === 'no-video') return `“${name}” dosyasında görüntü yok. Lütfen bir video dosyası seçin.`;
    if (err.message === 'no-duration') return `“${name}” dosyasının süresi okunamadı. Dosya bozuk ya da yarım kalmış olabilir.`;
    if (err.message === 'timeout') return `“${name}” yüklenemedi: tarayıcı 30 saniye içinde dosyayı açamadı. Sayfayı yenileyip yeniden deneyin.`;
    return `“${name}” açılamadı. Tarayıcınız bu biçimi oynatamıyor olabilir; MP4 (H.264) ya da WebM olarak kaydedip yeniden deneyin.`;
  }

  async function loadFile(slot, file) {
    showLoadError(null);
    if (!file) return;
    if (!(file.type.startsWith('video/') || VIDEO_NAME.test(file.name))) {
      showLoadError(`“${file.name}” bir video dosyası değil.`);
      return;
    }
    if (state.exporting) return;
    player.pause();
    const url = URL.createObjectURL(file);
    const el = videos[slot];
    const previous = state.media[slot];
    try {
      const info = await openVideo(el, url);
      const media = { file, url, name: file.name, size: file.size, ...info, analysis: undefined };
      const oldFrame = frameSize();
      state.media[slot] = media;
      if (previous) URL.revokeObjectURL(previous.url);
      mediaChanged(oldFrame, slot);
      exporter.analyzeFile(file).then((analysis) => {
        if (state.media[slot] !== media) return;
        media.analysis = analysis;
        syncSlots();
        syncAudioControls();
        refreshPlan();
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      showLoadError(loadErrorText(file.name, err));
      // Put the previous recording back into the element.
      if (previous) await openVideo(el, previous.url).catch(() => {});
      else {
        el.removeAttribute('src');
        el.load();
      }
      applyPlayerSettings();
    }
  }

  function removeMedia(slot) {
    const media = state.media[slot];
    if (!media || state.exporting) return;
    player.pause();
    const oldFrame = frameSize();
    state.media[slot] = null;
    const el = videos[slot];
    el.removeAttribute('src');
    el.load();
    URL.revokeObjectURL(media.url);
    mediaChanged(oldFrame, slot);
  }

  async function swapMedia() {
    if (state.exporting) return;
    const { screen, camera } = state.media;
    if (!screen && !camera) return;
    player.pause();
    const oldFrame = frameSize();
    const attach = async (slot, media) => {
      const el = videos[slot];
      if (media) {
        await openVideo(el, media.url);
      } else {
        el.removeAttribute('src');
        el.load();
      }
    };
    const offset = state.offset;
    const sync = state.sync;
    try {
      await Promise.all([attach('screen', camera), attach('camera', screen)]);
      state.media.screen = camera;
      state.media.camera = screen;
      // The same moment seen from the other recording: the offset changes sign.
      mediaChanged(oldFrame, 'both', { offset: -offset, sync: swappedSync(sync) });
    } catch (err) {
      showLoadError('Kayıtların yeri değiştirilemedi.');
    }
  }

  /**
   * @param {string} slot 'screen', 'camera' or 'both'
   * @param {{offset: number, sync: object}} [keep] timing that stays valid (after a swap)
   */
  function mediaChanged(oldFrame, slot, keep) {
    stopAutoSync();
    const { screen, camera } = state.media;
    player.hasScreen = !!screen;
    player.hasCamera = !!camera;
    reframe(oldFrame, frameSize());
    if (slot !== 'screen' && camera && state.look.box && state.look.shape !== 'circle') {
      // A new camera recording gets a window with its own proportions.
      updateBox((b, W, H) => G.withAspect(b, cameraAspect(), W, H));
    }
    ensureBox();
    state.offset = keep ? keep.offset : 0;
    state.sync = keep ? keep.sync : { status: 'idle' };
    if (slot !== 'camera' || state.trim.end <= 0) {
      state.trim = { start: 0, end: screen ? screen.duration : 0 };
    }
    applyPlayerSettings();
    if (screen) player.seek(slot === 'camera' ? player.currentTime : 0);
    else if (camera) videos.camera.currentTime = 0;
    buildResolutionOptions();
    resetHistory();
    closeResult();
    fitFrame();
    syncAll();
    refreshPlan();
    if (!keep && screen && camera && state.autoSync) runAutoSync('load');
  }

  function applyPlayerSettings() {
    player.offset = state.offset;
    player.trimStart = state.trim.start;
    player.trimEnd = state.trim.end;
    player.setVolumes(state.audio.screen, state.audio.camera);
  }

  // ---- Sync of controls ------------------------------------------------------

  function syncAll() {
    syncStatus();
    syncSlots();
    syncCamera();
    syncAudioControls();
    syncOffset();
    syncTransport();
    syncTimeline();
    syncExportControls();
    syncUndo();
  }

  /** Range inputs show their value as an amber fill (WebKit has no ::-moz-range-progress). */
  function paintRange(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const p = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${G.clamp(p, 0, 100).toFixed(2)}%`);
  }

  function setRange(input, value) {
    input.value = value;
    paintRange(input);
  }

  function setStatus(chip, textEl, tone, text) {
    if (tone) chip.dataset.tone = tone;
    else delete chip.dataset.tone;
    if (textEl.textContent !== text) textEl.textContent = text;
  }

  function syncStatus() {
    const { screen, camera } = state.media;
    els.badge.hidden = !isDemo();
    let tone = '';
    let text = 'Örnek görüntü';
    if (state.exporting) {
      tone = 'busy';
      text = 'Dışa aktarılıyor';
    } else if (screen && camera) {
      tone = 'ok';
      text = 'Ekran ve kamera hazır';
    } else if (screen) {
      tone = 'ok';
      text = 'Ekran kaydı hazır · kamera yok';
    } else if (camera) {
      tone = 'warn';
      text = 'Ekran kaydı bekleniyor';
    }
    setStatus(els.status, els.statusText, tone, text);
    syncShell();
  }

  /** The line above the monitor: what is playing, its size and length, and the camera offset. */
  function syncShell() {
    const { screen, camera } = state.media;
    const f = frameSize();
    if (screen) {
      els.shellFile.textContent = screen.name;
      els.shellMeta.textContent = `${f.width} × ${f.height} · ${U.clock(screen.duration)}`;
    } else if (camera) {
      els.shellFile.textContent = 'Ekran kaydı yok';
      els.shellMeta.textContent = '';
    } else {
      els.shellFile.textContent = 'Örnek görüntü';
      els.shellMeta.textContent = `${f.width} × ${f.height}`;
    }
    const both = !!screen && !!camera;
    els.shellSync.hidden = !both;
    if (both) els.shellSyncText.textContent = `Kamera ${U.signedSeconds(state.offset, 2)}`;
  }

  function mediaMeta(m) {
    const parts = [`${m.width}×${m.height}`, U.clock(m.duration)];
    const a = m.analysis;
    if (a && a.readable) {
      if (a.video) parts.push(exporter.codecName(a.video.codec));
      parts.push(a.audio ? `${exporter.codecName(a.audio.codec)} ses` : 'sessiz');
    }
    parts.push(U.bytes(m.size));
    return parts.join(' · ');
  }

  function syncSlots() {
    for (const slot of ['screen', 'camera']) {
      const m = state.media[slot];
      const node = els.slots[slot];
      els.drops[slot].hidden = !!m;
      const info = node.querySelector('.slot-file');
      info.hidden = !m;
      if (m) {
        info.querySelector('.slot-name').textContent = m.name;
        info.querySelector('.slot-meta').textContent = mediaMeta(m);
      }
    }
    els.swap.disabled = !state.media.screen && !state.media.camera;
  }

  function matchingPosition() {
    const { width: W, height: H } = frameSize();
    const box = G.toPx(state.look.box, W, H);
    for (const pos of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']) {
      const p = G.placeAt(box, pos, W, H);
      if (Math.abs(p.x - box.x) < 1 && Math.abs(p.y - box.y) < 1) return pos;
    }
    return null;
  }

  function syncCameraControls() {
    const L = state.look;
    setRange(els.size, Math.round(L.box.w * 100));
    els.sizeOut.textContent = U.percent(L.box.w);
    const pos = matchingPosition();
    for (const b of document.querySelectorAll('.pos-grid button')) {
      b.setAttribute('aria-pressed', String(b.dataset.pos === pos));
    }
  }

  function syncCamera() {
    const L = state.look;
    shapeControl.set(L.shape);
    els.radiusField.hidden = L.shape !== 'rounded';
    setRange(els.radius, Math.round(L.radius * 100));
    els.radiusOut.textContent = U.percent(L.radius);
    setRange(els.border, L.borderWidth);
    els.borderOut.textContent = L.borderWidth === 0 ? 'yok' : `${L.borderWidth} px`;
    let preset = false;
    for (const s of els.swatches.querySelectorAll('.swatch[data-color]')) {
      s.style.setProperty('--swatch', s.dataset.color);
      const on = s.dataset.color.toLowerCase() === L.borderColor.toLowerCase();
      preset = preset || on;
      s.setAttribute('aria-checked', String(on));
    }
    els.borderColor.value = L.borderColor;
    els.borderColor.parentElement.classList.toggle('is-active', !preset);
    els.shadow.checked = L.shadow;
    els.mirror.checked = L.mirror;
    els.camVisible.checked = L.visible;
    syncCameraControls();
    editor.setLook(L, cameraEditable());
    requestRender();
  }

  function syncAudioControls() {
    for (const slot of ['screen', 'camera']) {
      const a = state.audio[slot];
      const m = state.media[slot];
      const silent = m && m.analysis && m.analysis.readable && !m.analysis.audio;
      setRange(els.vol[slot], Math.round(a.volume * 100));
      els.vol[slot].disabled = !!silent;
      els.mute[slot].disabled = !!silent;
      els.mute[slot].setAttribute('aria-pressed', String(a.muted));
      els.volOut[slot].textContent = silent ? 'ses yok' : a.muted ? 'kapalı' : U.percent(a.volume);
    }
    player.setVolumes(state.audio.screen, state.audio.camera);
  }

  function syncOffset() {
    if (document.activeElement !== els.offset) els.offset.value = state.offset.toFixed(2);
    const has = !!state.media.camera && !!state.media.screen;
    els.offset.disabled = !has;
    for (const b of document.querySelectorAll('[data-nudge]')) b.disabled = !has;
    els.align.disabled = !has;
    syncShell();
    syncSyncPanel();
  }

  function syncTransport() {
    const ready = !!state.media.screen;
    for (const b of [els.play, els.toStart, els.toEnd, els.prevFrame, els.nextFrame, els.markIn, els.markOut]) {
      b.disabled = !ready;
    }
    els.play.classList.toggle('is-playing', player.playing);
    els.play.setAttribute('aria-label', player.playing ? 'Duraklat' : 'Oynat');
    els.tcTotal.textContent = U.timecode(player.duration, fps());
    syncTime();
  }

  function syncTime() {
    const t = player.currentTime;
    els.tcNow.textContent = U.timecode(t, fps());
    timeline.setTime(t);
  }

  function syncTimeline() {
    const { screen, camera } = state.media;
    timeline.update({
      duration: player.duration,
      time: player.currentTime,
      trimStart: state.trim.start,
      trimEnd: state.trim.end,
      fps: fps(),
      screenName: screen ? screen.name : '',
      camera: camera && screen ? { offset: state.offset, duration: camera.duration } : null,
    });
    syncRangeInfo();
  }

  function syncRangeInfo() {
    if (!state.media.screen) {
      els.rangeInfo.textContent = state.media.camera
        ? 'Kamera kaydı yüklendi. Zaman çizelgesi için ekran kaydını da yükleyin.'
        : 'Zaman çizelgesi, ekran kaydını yükleyince açılır.';
      return;
    }
    const { start, end } = state.trim;
    els.rangeInfo.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = `${U.timecode(start, fps())} → ${U.timecode(end, fps())}`;
    els.rangeInfo.append('Dışa aktarılacak bölüm: ', strong, ` · ${U.duration(end - start)}`);
  }

  function buildResolutionOptions() {
    const { width, height } = frameSize();
    const short = Math.min(width, height);
    const sel = els.outRes;
    sel.textContent = '';
    const add = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    };
    add('source', `Orijinal (${G.even(width)}×${G.even(height)})`);
    for (const r of RESOLUTIONS) {
      if (r < short) {
        const s = G.outputSize(width, height, r);
        add(String(r), `${r}p (${s.width}×${s.height})`);
      }
    }
    if (![...sel.options].some((o) => o.value === state.output.preset)) state.output.preset = 'source';
    sel.value = state.output.preset;
  }

  function buildFormatOptions() {
    const sel = els.outFormat;
    sel.textContent = '';
    const list = state.formats || [{ id: 'mp4', label: 'MP4' }, { id: 'webm', label: 'WebM' }];
    for (const f of list) {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.label;
      sel.appendChild(o);
    }
    sel.value = formatId();
    sel.disabled = list.length === 0;
  }

  function syncExportControls() {
    els.outRes.value = state.output.preset;
    els.outFps.value = String(state.output.fps);
    els.outQuality.value = state.output.quality;
    els.outFormat.value = formatId();
    const busy = !!state.exporting;
    for (const s of [els.outRes, els.outFps, els.outQuality, els.outFormat]) s.disabled = busy;
    // While the sync is still listening the offset may change, so the export waits for it.
    const listening = state.sync.status === 'running';
    els.exportBtn.disabled = busy || listening || !state.media.screen || !state.plan || state.plan.method === 'none';
    els.exportBtn.textContent = listening ? 'Senkron bekleniyor…' : 'Videoyu dışa aktar';
  }

  // ---- Export ----------------------------------------------------------------

  function buildJob() {
    const out = outputSize();
    return {
      screen: state.media.screen,
      camera: state.media.camera,
      look: { ...state.look, box: { ...state.look.box } },
      offset: state.offset,
      trimStart: state.trim.start,
      trimEnd: state.trim.end,
      gains: {
        screen: gain(state.audio.screen),
        camera: state.media.camera ? gain(state.audio.camera) : 0,
      },
      output: {
        width: out.width, height: out.height, fps: state.output.fps,
        quality: state.output.quality, format: formatId(),
      },
    };
  }

  let planSeq = 0;
  let planTimer = 0;
  function refreshPlan() {
    clearTimeout(planTimer);
    planTimer = setTimeout(async () => {
      const seq = ++planSeq;
      if (!state.media.screen) {
        state.plan = null;
        setMethodText(null);
        syncExportControls();
        return;
      }
      const plan = await exporter.plan(buildJob());
      if (seq !== planSeq) return;
      state.plan = plan;
      setMethodText(plan);
      syncExportControls();
    }, 120);
  }

  function setMethodText(plan) {
    const m = els.method;
    m.textContent = '';
    if (!plan) {
      m.textContent = 'Dışa aktarmak için önce ekran kaydını yükleyin.';
      return;
    }
    const chip = document.createElement('span');
    chip.className = 'chip';
    if (plan.method === 'fast') {
      const out = outputSize();
      chip.textContent = 'Hızlı';
      const codecs = [exporter.codecName(plan.videoCodec), exporter.codecName(plan.audioCodec)].filter(Boolean).join(' + ');
      m.append(chip, `${plan.container.toUpperCase()} · ${codecs} · ${out.width}×${out.height} · ${fps()} fps. Video, gerçek süresinden hızlı işlenir.`);
      if (plan.note) m.append(` ${plan.note}`);
    } else if (plan.method === 'realtime') {
      chip.textContent = 'Gerçek zamanlı';
      chip.classList.add('is-slow');
      const span = U.duration(state.trim.end - state.trim.start);
      m.append(chip, `${plan.reasons[0] || ''} Video oynatılarak kaydedilir: yaklaşık ${span} sürer, bu sekme açık kalmalı.`);
    } else {
      m.textContent = 'Bu tarayıcı video kaydetmeyi desteklemiyor. Güncel bir Chrome, Edge, Firefox ya da Safari deneyin.';
    }
  }

  function realtimeFallbackPlan() {
    const p = state.plan;
    if (p && p.method === 'realtime') return p;
    const types = state.formats && state.formats.find((f) => f.id === formatId());
    const rt = (types && types.realtime) || (state.formats || []).map((f) => f.realtime).find(Boolean);
    return rt ? { method: 'realtime', container: rt.container, mimeType: rt.mimeType, reasons: [] } : null;
  }

  let progressShownAt = 0;
  function showProgress(p) {
    const ex = state.exporting;
    const now = performance.now();
    if (p < 1 && now - progressShownAt < 100) return;
    progressShownAt = now;
    const pct = Math.max(0, Math.min(1, p));
    els.progressBar.style.setProperty('--p', pct.toFixed(4));
    els.progressWrap.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
    setStatus(els.status, els.statusText, 'busy', `Dışa aktarılıyor · ${U.percent(pct)}`);
    const total = ex.job.trimEnd - ex.job.trimStart;
    const done = pct * total;
    const elapsed = (now - ex.started) / 1000;
    let text = `${U.percent(pct)} · ${U.clock(done)} / ${U.clock(total)}`;
    if (elapsed > 1.5 && pct > 0.01) {
      const speed = done / elapsed;
      const left = (total - done) / speed;
      text += ` · kalan ~${U.duration(left)}`;
      if (ex.method === 'fast') text += ` · ${U.decimal(speed, 1)}× hız`;
    }
    els.progressText.textContent = text;
  }

  let wakeLock = null;

  async function startExport(forceRealtime) {
    if (state.exporting || !state.media.screen) return;
    const chosen = forceRealtime ? realtimeFallbackPlan() : state.plan;
    if (!chosen || chosen.method === 'none') return;
    const job = buildJob();
    // Real-time export starts its media and audio here, while the click still counts (Safari).
    const kit = chosen.method === 'realtime' ? exporter.prepareRealtime(job) : null;
    let name = U.exportFileName(chosen.container);
    let target = null;
    let onDisk = false;

    showExportError(null);
    closeResult();
    if (chosen.method === 'fast') {
      if (exporter.canPickFile()) {
        try {
          const handle = await exporter.pickFile(name, chosen.container);
          target = await exporter.diskTarget(handle);
          name = handle.name;
          onDisk = true;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          target = null;
        }
      }
      if (!target) target = exporter.memoryTarget();
    }

    const controller = new AbortController();
    state.exporting = { controller, job, method: chosen.method, started: performance.now() };
    player.pause();
    els.progress.hidden = false;
    els.exportBtn.hidden = true;
    progressShownAt = 0;
    showProgress(0);
    syncExportControls();
    try {
      wakeLock = navigator.wakeLock ? await navigator.wakeLock.request('screen').catch(() => null) : null;
    } catch (err) {
      wakeLock = null;
    }

    try {
      let blob;
      if (chosen.method === 'fast') {
        const r = await exporter.exportFast(job, chosen, { target, onProgress: showProgress, signal: controller.signal });
        blob = await target.finish(r.mimeType);
      } else {
        const r = await exporter.exportRealtime(job, chosen, {
          onProgress: showProgress, signal: controller.signal, kit,
        });
        blob = r.blob;
      }
      showProgress(1);
      showResult(blob, name, onDisk);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        showExportError('Dışa aktarma iptal edildi.');
      } else if (err && err.name === 'NotAllowedError') {
        showExportError('Tarayıcı videoyu sesli oynatmaya izin vermedi. Sayfada bir yere dokunup dışa aktarmayı yeniden başlatın.');
      } else {
        console.error(err);
        const msg = err && err.message ? err.message : String(err);
        const canRetry = chosen.method === 'fast' && !!realtimeFallbackPlan();
        showExportError(`Dışa aktarma tamamlanamadı: ${msg}`, canRetry);
      }
      if (kit) exporter.disposeRealtime(kit);
    } finally {
      state.exporting = null;
      els.progress.hidden = true;
      els.exportBtn.hidden = false;
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
      syncExportControls();
      syncStatus();
    }
  }

  function showExportError(text, canRetry) {
    els.exportError.hidden = !text;
    els.exportError.textContent = text || '';
    els.retryRealtime.hidden = !canRetry;
  }

  function showLoadError(text) {
    els.loadError.hidden = !text;
    els.loadError.textContent = text || '';
  }

  // Inside a Claude artifact, files are saved through the viewer's downloads capability.
  let downloadsCapability;
  function getDownloads() {
    if (downloadsCapability === undefined) {
      downloadsCapability = root.claude && typeof root.claude.use === 'function'
        ? root.claude.use('downloads').catch(() => null)
        : Promise.resolve(false);
    }
    return downloadsCapability;
  }

  async function showResult(blob, name, onDisk) {
    const url = URL.createObjectURL(blob);
    state.result = { blob, name, url, onDisk };
    els.resultVideo.src = url;
    els.resultText.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = name;
    if (onDisk) els.resultText.append('Kaydedildi: ', strong, ` (${U.bytes(blob.size)})`);
    else els.resultText.append(strong, ` hazır (${U.bytes(blob.size)}).`);
    els.result.hidden = false;
    els.result.scrollIntoView({ block: 'nearest', behavior: KM.reducedMotion() ? 'auto' : 'smooth' });
    KM.toast(onDisk ? `Kaydedildi · ${name}, ${U.bytes(blob.size)}` : `Video hazır · ${name}, ${U.bytes(blob.size)}`);
    const downloads = onDisk ? false : await getDownloads();
    els.download.hidden = onDisk || downloads === null;
    if (!onDisk && downloads === null) {
      els.resultText.append(' Bu görünümde dosya indirilemiyor; sayfayı tarayıcıda açıp yeniden dışa aktarın.');
    }
  }

  async function download() {
    const r = state.result;
    if (!r) return;
    const downloads = await getDownloads();
    if (downloads) {
      try {
        await downloads.save({ filename: r.name, data: r.blob });
      } catch (err) {
        if (err && err.code !== 'declined') showExportError(`Dosya kaydedilemedi (${err.code || err.message}).`);
      }
      return;
    }
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function closeResult() {
    const r = state.result;
    if (!r) return;
    els.resultVideo.removeAttribute('src');
    els.resultVideo.load();
    URL.revokeObjectURL(r.url);
    state.result = null;
    els.result.hidden = true;
  }

  // ---- Timeline -----------------------------------------------------------------

  const timeline = new PE.Timeline($('timeline'), {
    onSeek(t) {
      player.seek(t);
    },
    onScrub(phase) {
      if (phase === 'start') player.pause();
    },
    onTrim(a, b, phase) {
      state.trim = { start: a, end: b };
      applyPlayerSettings();
      syncTimeline();
      if (phase === 'commit') commit();
    },
    onOffset(o, phase) {
      userOffset(o, phase === 'commit');
    },
  });

  function setOffset(value, commitNow) {
    if (!Number.isFinite(value)) return;
    const s = state.media.screen;
    const c = state.media.camera;
    if (!s || !c) return;
    // Keep at least a sliver of overlap between the two recordings.
    state.offset = Math.round(G.clamp(value, -c.duration + 0.1, s.duration - 0.1) * 1000) / 1000;
    applyPlayerSettings();
    player.resync();
    syncOffset();
    syncTimeline();
    requestRender();
    if (commitNow) commit();
  }

  /** Offsets set by hand stop a sync that is still listening, so its answer cannot overwrite them. */
  function userOffset(value, commitNow) {
    if (state.sync.status === 'running') {
      stopAutoSync();
      state.sync = { status: 'stopped' };
      syncSyncPanel();
      syncExportControls();
    }
    setOffset(value, commitNow);
  }

  // ---- Automatic sync ------------------------------------------------------------------

  let syncSeq = 0;
  const SCOPE_SPAN = 6; // seconds of sound shown around the moment the recordings were matched on

  /** Stops a sync that is still listening; its answer, if it comes, is ignored. */
  function stopAutoSync() {
    syncSeq++;
    if (state.sync.status === 'running') state.sync.controller.abort();
  }

  /**
   * Listens to both recordings and moves the camera to where their sounds line up.
   * @param {'load'|'button'} trigger
   */
  async function runAutoSync(trigger) {
    const { screen, camera } = state.media;
    if (!screen || !camera || state.exporting) return;
    stopAutoSync();
    const seq = syncSeq;
    const controller = new AbortController();
    const before = state.offset;
    state.sync = { status: 'running', progress: 0, controller, trigger };
    syncSyncPanel();
    syncExportControls();
    let next;
    try {
      const MB = await exporter.getMediabunny();
      const result = await autoSync.syncRecordings(MB, screen, camera, {
        signal: controller.signal,
        onProgress(p) {
          if (seq !== syncSeq) return;
          state.sync.progress = p;
          syncSyncStatus();
        },
      });
      next = { status: result.status, result, trigger };
    } catch (err) {
      if (seq !== syncSeq) return;
      if (err && err.name === 'AbortError') next = { status: 'stopped' };
      else {
        console.error(err);
        next = { status: 'error', trigger };
      }
    }
    // A newer run, a new recording or a hand-set offset took over in the meantime.
    if (seq !== syncSeq) return;
    state.sync = next;
    if (next.status === 'ok') {
      setOffset(next.result.offset, true);
      const moved = Math.abs(state.offset - before) >= 0.0005;
      KM.toast(moved ? `Senkronlandı · kamera ${U.signedSeconds(state.offset, 2)}` : 'Kayıtlar zaten eşleşiyor', {
        action: moved ? { label: 'Geri al', onClick: () => userOffset(before, true) } : null,
      });
    } else if (next.status !== 'stopped') {
      KM.toast({
        weak: 'Senkron önerisi hazır · kontrol edip uygulayın',
        unsure: 'Otomatik senkron: ortak ses bulunamadı',
        'no-audio-screen': 'Otomatik senkron: ekran kaydında ses yok',
        'no-audio-camera': 'Otomatik senkron: kamera kaydında ses yok',
        unsupported: 'Otomatik senkron bu tarayıcıda çalışmıyor',
        'too-short': 'Otomatik senkron: kayıtlar çok kısa',
      }[next.status] || 'Otomatik senkron: ses okunamadı', { tone: 'warn' });
    }
    syncSyncPanel();
    syncExportControls();
  }

  /** After the recordings swap places, a finished match still holds, seen from the other side. */
  function swappedSync(sync) {
    const r = sync.result;
    if (!r || !r.screen || (sync.status !== 'ok' && sync.status !== 'weak')) return { status: 'idle' };
    return {
      ...sync,
      result: {
        ...r,
        screen: r.camera,
        camera: r.screen,
        offset: -r.offset,
        anchor: r.anchor === null ? null : r.anchor - r.offset,
      },
    };
  }

  function syncProblem(status) {
    return {
      weak: 'Ortak bir an bulundu ama kesin değil. Öneriyi kontrol edip uygulayabilirsiniz.',
      unsure: 'İki kayıtta ortak bir ses bulunamadı. Kaydırmayı elle ayarlayın.',
      'no-audio-screen': 'Ekran kaydında ses yok; otomatik senkron için iki kayıtta da ses olmalı.',
      'no-audio-camera': 'Kamera kaydında ses yok; otomatik senkron için iki kayıtta da ses olmalı.',
      unsupported: 'Bu tarayıcı kayıtların sesini çözemiyor. Kaydırmayı elle ayarlayın.',
      'too-short': 'Kayıtlar otomatik senkron için çok kısa.',
      error: 'Kayıtların sesi okunamadı. Kaydırmayı elle ayarlayın.',
    }[status] || '';
  }

  function syncSyncStatus() {
    const s = state.sync;
    const both = !!state.media.screen && !!state.media.camera;
    let tone = '';
    let text = 'Hazır';
    if (!both) text = 'İki kayıt bekleniyor';
    else if (s.status === 'running') {
      tone = 'busy';
      text = `Dinleniyor · ${U.percent(s.progress || 0)}`;
    } else if (s.status === 'ok') {
      const kept = Math.abs(state.offset - s.result.offset) < 0.0005;
      tone = kept ? 'ok' : '';
      text = kept ? 'Eşleşti' : 'Elle ayarlandı';
    } else if (s.status === 'weak') {
      tone = 'warn';
      text = 'Emin değil';
    } else if (s.status === 'stopped') {
      text = 'Durduruldu';
    } else if (s.status === 'error') {
      tone = 'bad';
      text = 'Ses okunamadı';
    } else if (s.status !== 'idle') {
      tone = 'warn';
      text = {
        unsure: 'Ortak ses yok',
        'no-audio-screen': 'Ekranda ses yok',
        'no-audio-camera': 'Kamerada ses yok',
        unsupported: 'Desteklenmiyor',
        'too-short': 'Çok kısa',
      }[s.status] || 'Bulunamadı';
    }
    setStatus(els.syncStatus, els.syncStatusText, tone, text);
  }

  function syncSyncPanel() {
    const s = state.sync;
    const both = !!state.media.screen && !!state.media.camera;
    const running = s.status === 'running';
    syncSyncStatus();
    els.syncBtn.disabled = !both || !!state.exporting;
    els.syncBtn.classList.toggle('is-running', running);
    els.syncLabel.textContent = running ? 'Durdur' : s.status === 'ok' ? 'Yeniden eşle' : 'Sesten otomatik eşle';
    els.timeline.classList.toggle('is-syncing', running);
    els.autoSyncOnLoad.checked = state.autoSync;

    const suggestion = both && s.status === 'weak' ? s.result.offset : null;
    els.applySync.hidden = suggestion === null;
    if (suggestion !== null) els.applySync.textContent = `Öneriyi uygula · ${U.signedSeconds(suggestion, 2)}`;

    // One line under the scope: the matched moment and the confidence, or what went wrong.
    const meta = els.syncMeta;
    meta.textContent = '';
    meta.classList.remove('is-note');
    if (both && (s.status === 'ok' || s.status === 'weak') && s.result.anchor !== null) {
      const at = document.createElement('span');
      at.textContent = `${s.status === 'weak' ? 'Önerilen an' : 'Eşleşen an'} ${U.clock(s.result.anchor)}`;
      const how = document.createElement('span');
      how.textContent = { sure: 'güven yüksek', likely: 'güven orta' }[s.result.confidence] || 'güven düşük';
      meta.append(at, how);
    } else if (both && s.status !== 'idle' && s.status !== 'running' && s.status !== 'stopped' && s.status !== 'ok') {
      meta.textContent = syncProblem(s.status);
      meta.classList.add('is-note');
    }
    meta.hidden = !meta.textContent;
    drawSyncScope();
  }

  /**
   * Both recordings' loudness around the matched moment, the camera drawn where the current
   * offset puts it. When the two peaks sit on the centre line, the recordings are in sync.
   */
  function drawSyncScope() {
    const s = state.sync;
    const r = s.result;
    const both = !!state.media.screen && !!state.media.camera;
    const show = both && !!r && !!r.screen && (s.status === 'ok' || s.status === 'weak') && r.anchor !== null;
    els.syncScope.hidden = !show;
    if (!show) return;
    const canvas = els.syncCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const HOP = autoSync.HOP;
    const offset = state.offset;
    const start = r.anchor - SCOPE_SPAN / 2;
    const step = 5 * dpr;
    const bars = Math.floor(w / step);
    const per = SCOPE_SPAN / bars;
    const peak = (level, t) => {
      const a = Math.max(0, Math.floor(t / HOP));
      const b = Math.min(level.length, Math.ceil((t + per) / HOP));
      let m = 0;
      for (let k = a; k < b; k++) if (level[k] > m) m = level[k];
      return m;
    };
    // The matched moment is highlighted in both lanes; the camera's moves off the line when the offset does.
    const lane = (level, top, shift, moment, dim, bright) => {
      const mid = top + h / 4 + 4 * dpr;
      const max = h / 4 - 8 * dpr;
      for (let i = 0; i < bars; i++) {
        const t = start + i * per;
        const v = peak(level, t - shift);
        const bh = Math.max(dpr, v * max);
        g.fillStyle = Math.abs(t + per / 2 - moment) < 0.2 ? bright : dim;
        g.fillRect(i * step + dpr, mid - bh, step - 2 * dpr, bh * 2);
      }
    };
    lane(r.screen.level, 0, 0, r.anchor, 'rgba(232, 238, 236, 0.3)', '#f0a73a');
    lane(r.camera.level, h / 2, offset, r.anchor - r.offset + offset, 'rgba(95, 196, 187, 0.42)', '#5fc4bb');
    g.fillStyle = 'rgba(240, 167, 58, 0.85)';
    g.fillRect(Math.round(w / 2 - dpr / 2), 0, Math.max(1, Math.round(dpr)), h);
  }

  function setMark(which) {
    const t = player.currentTime;
    const D = player.duration;
    if (which === 'in') state.trim.start = G.clamp(t, 0, Math.max(0, state.trim.end - 0.1));
    else state.trim.end = G.clamp(t, Math.min(D, state.trim.start + 0.1), D);
    applyPlayerSettings();
    syncTimeline();
    commit();
  }

  const step = (seconds) => player.seek(player.currentTime + seconds);

  // ---- Event wiring ----------------------------------------------------------------

  player.addEventListener('time', () => {
    syncTime();
    if (player.playing) render();
    else requestRender();
  });
  player.addEventListener('frame', () => {
    syncTime();
    requestRender();
  });
  player.addEventListener('state', syncTransport);

  const togglePlay = () => Promise.resolve(player.toggle()).catch(() => {});
  els.play.addEventListener('click', togglePlay);
  els.toStart.addEventListener('click', () => player.seek(state.trim.start));
  els.toEnd.addEventListener('click', () => player.seek(state.trim.end));
  els.prevFrame.addEventListener('click', () => step(-1 / fps()));
  els.nextFrame.addEventListener('click', () => step(1 / fps()));
  els.markIn.addEventListener('click', () => setMark('in'));
  els.markOut.addEventListener('click', () => setMark('out'));
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);
  const shortcuts = KM.drawer($('shortcuts'));
  els.shortcutsBtn.addEventListener('click', () => shortcuts.open(els.shortcutsBtn));

  // "Dışa aktar" in the top bar brings the export card into view and points at it.
  els.exportJump.addEventListener('click', () => {
    const panel = els.exportPanel;
    panel.scrollIntoView({ block: 'nearest', behavior: KM.reducedMotion() ? 'auto' : 'smooth' });
    panel.classList.remove('is-flash');
    requestAnimationFrame(() => panel.classList.add('is-flash'));
    if (!els.exportBtn.disabled) els.exportBtn.focus({ preventScroll: true });
  });
  els.exportPanel.addEventListener('animationend', () => els.exportPanel.classList.remove('is-flash'));

  for (const slot of ['screen', 'camera']) {
    const input = els.inputs[slot];
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      loadFile(slot, file);
    });
    els.slots[slot].querySelector('[data-action="replace"]').addEventListener('click', () => input.click());
    els.slots[slot].querySelector('[data-action="remove"]').addEventListener('click', () => removeMedia(slot));
    const drop = els.drops[slot];
    const slotEl = els.slots[slot];
    slotEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.add('is-over');
    });
    slotEl.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    slotEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('is-over');
      els.dropVeil.hidden = true;
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      loadFile(slot, file);
    });
  }
  els.swap.addEventListener('click', swapMedia);

  // Dropping files on the rest of the page fills the empty slots, screen first.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    els.dropVeil.hidden = false;
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.dropVeil.hidden = true;
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.dropVeil.hidden = true;
    const files = [...e.dataTransfer.files];
    const empty = ['screen', 'camera'].filter((s) => !state.media[s]);
    if (!empty.length) {
      showLoadError('İki kayıt da yüklü. Değiştirmek için dosyayı sağdaki ilgili alana bırakın.');
      return;
    }
    for (const slot of empty) {
      const file = files.shift();
      if (!file) break;
      await loadFile(slot, file);
    }
  });

  // Every slider paints its own fill while it is dragged.
  document.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') paintRange(e.target);
  });

  els.radius.addEventListener('input', () => {
    state.look.radius = Number(els.radius.value) / 100;
    els.radiusOut.textContent = U.percent(state.look.radius);
    editor.setLook(state.look, cameraEditable());
    requestRender();
  });
  els.radius.addEventListener('change', commit);

  els.size.addEventListener('input', () => {
    const target = Number(els.size.value) / 100;
    updateBox((b, W, H) => {
      const minW = Math.min(W, H) * 0.05;
      return G.scaleAbout(b, (target * W) / b.w, b.x + b.w / 2, b.y + b.h / 2, W, H, minW);
    });
    editor.setLook(state.look, cameraEditable());
    els.sizeOut.textContent = U.percent(state.look.box.w);
    requestRender();
  });
  els.size.addEventListener('change', () => {
    syncCameraControls();
    commit();
  });

  document.querySelector('.pos-grid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pos]');
    if (!b) return;
    updateBox((box, W, H) => G.placeAt(box, b.dataset.pos, W, H));
    commit();
    syncCamera();
  });

  els.border.addEventListener('input', () => {
    state.look.borderWidth = Number(els.border.value);
    els.borderOut.textContent = state.look.borderWidth === 0 ? 'yok' : `${state.look.borderWidth} px`;
    requestRender();
  });
  els.border.addEventListener('change', commit);
  els.swatches.addEventListener('click', (e) => {
    const s = e.target.closest('.swatch[data-color]');
    if (!s) return;
    state.look.borderColor = s.dataset.color;
    if (state.look.borderWidth === 0) state.look.borderWidth = 4;
    commit();
    syncCamera();
  });
  els.borderColor.addEventListener('input', () => {
    state.look.borderColor = els.borderColor.value;
    requestRender();
  });
  els.borderColor.addEventListener('change', () => {
    commit();
    syncCamera();
  });

  for (const [input, key] of [[els.shadow, 'shadow'], [els.mirror, 'mirror'], [els.camVisible, 'visible']]) {
    input.addEventListener('change', () => {
      state.look[key] = input.checked;
      commit();
      syncCamera();
    });
  }

  for (const slot of ['screen', 'camera']) {
    els.vol[slot].addEventListener('input', () => {
      state.audio[slot].volume = Number(els.vol[slot].value) / 100;
      state.audio[slot].muted = false;
      syncAudioControls();
    });
    els.vol[slot].addEventListener('change', refreshPlan);
    els.mute[slot].addEventListener('click', () => {
      state.audio[slot].muted = !state.audio[slot].muted;
      syncAudioControls();
      refreshPlan();
    });
  }

  els.offset.addEventListener('change', () => userOffset(els.offset.valueAsNumber, true));
  els.offset.addEventListener('blur', syncOffset);
  for (const b of document.querySelectorAll('[data-nudge]')) {
    b.addEventListener('click', () => userOffset(state.offset + Number(b.dataset.nudge), true));
  }
  els.align.addEventListener('click', () => userOffset(player.currentTime, true));

  els.syncBtn.addEventListener('click', () => {
    if (state.sync.status !== 'running') {
      runAutoSync('button');
      return;
    }
    stopAutoSync();
    state.sync = { status: 'stopped' };
    syncSyncPanel();
    syncExportControls();
  });
  els.applySync.addEventListener('click', () => {
    const s = state.sync;
    if (s.status !== 'weak') return;
    const before = state.offset;
    state.sync = { ...s, status: 'ok' };
    userOffset(s.result.offset, true);
    KM.toast(`Öneri uygulandı · kamera ${U.signedSeconds(state.offset, 2)}`, {
      action: { label: 'Geri al', onClick: () => userOffset(before, true) },
    });
  });
  els.autoSyncOnLoad.addEventListener('change', () => {
    state.autoSync = els.autoSyncOnLoad.checked;
    savePrefs();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => drawSyncScope()).observe(els.syncScope);

  els.outRes.addEventListener('change', () => {
    state.output.preset = els.outRes.value;
    savePrefs();
    editor.setLook(state.look, cameraEditable());
    refreshPlan();
  });
  els.outFps.addEventListener('change', () => {
    state.output.fps = Number(els.outFps.value);
    savePrefs();
    syncTransport();
    syncTimeline();
    refreshPlan();
  });
  els.outQuality.addEventListener('change', () => {
    state.output.quality = els.outQuality.value;
    savePrefs();
    refreshPlan();
  });
  els.outFormat.addEventListener('change', () => {
    state.output.format = els.outFormat.value;
    savePrefs();
    refreshPlan();
  });

  els.exportBtn.addEventListener('click', () => startExport(false));
  els.retryRealtime.addEventListener('click', () => {
    showExportError(null);
    startExport(true);
  });
  els.cancel.addEventListener('click', () => {
    if (state.exporting) state.exporting.controller.abort();
  });
  els.download.addEventListener('click', download);
  els.closeResult.addEventListener('click', closeResult);

  window.addEventListener('beforeunload', (e) => {
    if (state.exporting) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const typing = (el) => el && (el.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const target = e.target;
    if (shortcuts.isOpen) return;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      if (typing(target) && target.type !== 'range' && target.type !== 'checkbox') return;
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod || e.altKey || typing(target) || state.exporting) return;
    const onButton = target && target.tagName === 'BUTTON';
    switch (e.key) {
      case '?':
        shortcuts.open(els.shortcutsBtn);
        break;
      case ' ':
        if (onButton) return;
        e.preventDefault();
        if (state.media.screen) togglePlay();
        break;
      case ',':
        step(-1 / fps());
        break;
      case '.':
        step(1 / fps());
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!state.media.screen) return;
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        step(dir * (e.shiftKey ? 1 : 1 / fps()));
        break;
      }
      case 'i':
      case 'I':
        if (state.media.screen) setMark('in');
        break;
      case 'o':
      case 'O':
        if (state.media.screen) setMark('out');
        break;
      case 'Home':
        if (state.media.screen) player.seek(state.trim.start);
        break;
      case 'End':
        if (state.media.screen) player.seek(state.trim.end);
        break;
      default:
        break;
    }
  });

  // Commands from the desktop app's menu (desktop/main.js). They arrive with a user gesture,
  // so file pickers and the save dialog may open.
  window.addEventListener('kurgu:command', (e) => {
    const el = document.activeElement;
    const inText = typing(el) && el.type !== 'range' && el.type !== 'checkbox';
    switch (e.detail) {
      case 'undo':
        if (inText) document.execCommand('undo');
        else undo();
        break;
      case 'redo':
        if (inText) document.execCommand('redo');
        else redo();
        break;
      case 'open-screen':
      case 'open-camera':
        if (!state.exporting) els.inputs[e.detail === 'open-screen' ? 'screen' : 'camera'].click();
        break;
      case 'export':
        if (!els.exportBtn.disabled) startExport(false);
        else els.exportJump.click();
        break;
      case 'shortcuts':
        shortcuts.open(els.shortcutsBtn);
        break;
      default:
        break;
    }
  });

  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitFrame()).observe(els.monitor);
  if (stacked.addEventListener) stacked.addEventListener('change', fitFrame);
  else stacked.addListener(fitFrame);
  window.addEventListener('resize', fitFrame);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      demo.repaint();
      requestRender();
    });
  }

  // ---- Start ---------------------------------------------------------------------

  els.volumeNote.hidden = !volumeLocked;
  loadPrefs();
  ensureBox();
  buildResolutionOptions();
  buildFormatOptions();
  applyPlayerSettings();
  resetHistory();
  syncAll();
  fitFrame();
  setMethodText(null);

  exporter.detectFormats().then((formats) => {
    state.formats = formats;
    buildFormatOptions();
    refreshPlan();
  });

  // Exposed for debugging and automated tests.
  PE.app = { state, player, loadFile, startExport, buildJob, commit, undo, redo, runAutoSync };
})(self);
