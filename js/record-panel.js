/*
 * The recording panel behind the top bar's "Kayıt" button. It picks and shows the camera and the
 * microphone, asks which screen or window to record, and records the screen and the camera
 * together (js/recorder.js). When the recording ends, both files go to the editor, already aligned.
 *
 * The panel can be closed while recording: the top bar's button then shows the time and opens it
 * again. In the desktop app the window can step aside while recording, and the tray icon (the menu
 * bar on macOS) pauses or stops it; there the app's own picker replaces the browser's.
 */
(function (root) {
  'use strict';
  const PE = root.PipEditor;
  const KM = root.KM;
  const R = PE.recorder;
  const U = PE.util;
  const $ = (id) => document.getElementById(id);

  const PREFS_KEY = 'kurgu-masasi:kayit:v1';
  const NONE = 'none';
  // Recordings a closed tab or a crash left in the browser's storage are removed after this long.
  const STALE = 6 * 3600 * 1000;

  const pad = (n) => String(Math.floor(n)).padStart(2, '0');
  const elapsedText = (sec) => {
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    return `${h > 0 ? `${h}:` : ''}${pad((s % 3600) / 60)}:${pad(s % 60)}`;
  };
  const stopStream = (stream) => {
    if (stream) for (const t of stream.getTracks()) t.stop();
  };

  function loadPrefs() {
    const prefs = { camera: '', mic: '', system: false, hide: true };
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        for (const k of ['camera', 'mic']) if (typeof saved[k] === 'string') prefs[k] = saved[k];
        for (const k of ['system', 'hide']) if (typeof saved[k] === 'boolean') prefs[k] = saved[k];
      }
    } catch (err) {
      // Preferences are a convenience only.
    }
    return prefs;
  }

  /**
   * @param {object} o
   * @param {() => Promise<object>} o.getMediabunny
   * @param {() => (string|null)} o.blocked why a recording cannot start right now, or null
   * @param {(r: {screen: File, camera: File|null, offset: number, duration: number}) => Promise<boolean>} o.onRecorded
   *   puts the files into the editor; resolves to whether that worked
   * @param {() => void} o.onChange a recording started or ended
   */
  function create(o) {
    const desktop = root.kurguDesktop || null;
    const platform = desktop ? desktop.platform : /Mac/.test(root.navigator.platform || '') ? 'mac' : 'other';
    const els = {
      button: $('recordBtn'), buttonLabel: $('recordBtnLabel'), cta: $('recordCta'), ctaSub: $('recordCtaSub'),
      or: $('recordOr'), shortcut: $('recordShortcut'),
      video: $('recVideo'), note: $('recPreviewNote'), badge: $('recBadge'), badgeText: $('recBadgeText'), level: $('recLevel'),
      setup: $('recSetup'), camera: $('recCamera'), mic: $('recMic'), system: $('recSystem'),
      hideField: $('recHideField'), hide: $('recHide'), hint: $('recHint'), memoryNote: $('recMemoryNote'), start: $('recStart'),
      sources: $('recSources'), sourceGrid: $('recSourceGrid'), sourceCancel: $('recSourceCancel'),
      running: $('recRunning'), status: $('recStatus'), statusText: $('recStatusText'), clock: $('recClock'),
      meta: $('recMeta'), pause: $('recPause'), stop: $('recStop'), stopLabel: $('recStopLabel'),
      discard: $('recDiscard'), runningHint: $('recRunningHint'), error: $('recError'),
    };
    const supported = R.supported();
    const allowed = R.allowedHere();
    const prefs = loadPrefs();
    const baseTitle = document.title;
    const drawer = KM.drawer($('recorder'), { onClose: closed });

    // setup → choosing (the screen picker is open) → [sources: the desktop app's picker] → starting
    // → recording ⇄ paused → finishing → setup
    let stage = 'setup';
    let preview = null; // camera and microphone; the recording takes them over and stops them at the end
    let previewSeq = 0;
    let previewOpening = null;
    let rec = null;
    let made = []; // files this page recorded, kept in the browser's storage while the editor uses them
    let ticker = 0;
    let meter = null;
    let discardTimer = 0;
    let pickCancelled = false; // the desktop picker was closed; the refusal that follows is not an error

    const recording = () => stage === 'starting' || stage === 'recording' || stage === 'paused' || stage === 'finishing';

    function savePrefs() {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch (err) {
        // Not saved; fine.
      }
    }

    // ---- Camera and microphone ------------------------------------------------------

    function deviceProblem(err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        if (desktop && platform === 'mac') return 'Kamera ve mikrofon izni yok. Sistem Ayarları › Gizlilik ve Güvenlik bölümünde Kamera ve Mikrofon için Kurgu Masası’nı açın. Ekran yine de kaydedilir.';
        if (desktop && platform === 'win') return 'Kamera ve mikrofon izni yok. Windows Ayarları › Gizlilik ve güvenlik bölümünde Kamera ve Mikrofon için masaüstü uygulamalarına izin verin. Ekran yine de kaydedilir.';
        return 'Kamera ve mikrofon izni verilmedi. Adres çubuğundaki izin simgesinden açabilirsiniz; ekran yine de kaydedilir.';
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera bulunamadı. Ekran ve mikrofon kaydedilir.';
      if (name === 'NotReadableError' || name === 'AbortError') return 'Kamera açılamadı; başka bir uygulama kullanıyor olabilir.';
      return 'Kamera açılamadı.';
    }

    /** Opens the chosen devices; falls back to the defaults, then to the microphone alone. */
    async function openDevices() {
      const cam = prefs.camera === NONE ? null : prefs.camera || undefined;
      const mic = prefs.mic === NONE ? null : prefs.mic || undefined;
      const attempts = [[cam, mic]];
      if (cam || mic) attempts.push([cam === null ? null : undefined, mic === null ? null : undefined]);
      if (cam !== null && mic !== null) attempts.push([null, undefined]);
      let first = null;
      for (const [c, m] of attempts) {
        try {
          const stream = await R.openDevices(c, m);
          return { stream, problem: first ? deviceProblem(first) : '' };
        } catch (err) {
          first = first || err;
          if (err.name === 'NotAllowedError' || err.name === 'SecurityError') break;
        }
      }
      return { stream: null, problem: first ? deviceProblem(first) : '' };
    }

    function fillSelect(select, list, noun, noneLabel, value) {
      select.textContent = '';
      const add = (v, label) => {
        const op = document.createElement('option');
        op.value = v;
        op.textContent = label;
        select.appendChild(op);
      };
      list.forEach((d, i) => add(d.deviceId, d.label || `${noun} ${i + 1}`));
      add(NONE, noneLabel);
      select.value = [...select.options].some((x) => x.value === value) ? value : NONE;
    }

    async function fillDevices() {
      const { cameras, mics } = await R.devices();
      const active = (kind) => {
        const t = preview && preview.getTracks().find((x) => x.kind === kind && x.readyState === 'live');
        return t ? t.getSettings().deviceId || '' : NONE;
      };
      fillSelect(els.camera, cameras, 'Kamera', 'Kamera kullanma', active('video'));
      fillSelect(els.mic, mics, 'Mikrofon', 'Mikrofon kullanma', active('audio'));
    }

    function closePreview() {
      previewSeq++;
      previewOpening = null;
      stopMeter();
      stopStream(preview);
      preview = null;
      els.video.srcObject = null;
    }

    /** (Re)opens the camera and microphone for the preview. */
    function refreshPreview() {
      closePreview();
      const seq = previewSeq;
      els.note.hidden = false;
      els.note.textContent = 'Kamera açılıyor…';
      els.video.hidden = true;
      const opening = (async () => {
        const { stream, problem } = await openDevices();
        if (seq !== previewSeq) {
          stopStream(stream);
          return;
        }
        preview = stream;
        await fillDevices();
        if (seq !== previewSeq) return;
        showPreview(problem);
      })();
      previewOpening = opening;
      opening.finally(() => {
        if (previewOpening === opening) previewOpening = null;
        sync();
      });
      sync();
      return opening;
    }

    function showPreview(problem) {
      const cam = preview && preview.getVideoTracks()[0];
      els.video.srcObject = cam ? new MediaStream([cam]) : null;
      els.video.hidden = !cam;
      if (cam) els.video.play().catch(() => {});
      const text = problem || (cam ? '' : prefs.camera === NONE ? 'Kamera kullanılmıyor; yalnızca ekran kaydedilir.' : 'Kamera yok; yalnızca ekran kaydedilir.');
      els.note.textContent = text;
      els.note.hidden = !text;
      if (drawer.isOpen) startMeter();
    }

    /** Microphone level under the preview, so you can see it hears you. */
    function startMeter() {
      stopMeter();
      const track = preview && preview.getAudioTracks().find((t) => t.readyState === 'live');
      els.level.parentElement.hidden = !track;
      if (!track || typeof root.AudioContext !== 'function') return;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const data = new Float32Array(analyser.fftSize);
      let level = 0;
      let raf = 0;
      const draw = () => {
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        const target = U.clamp((20 * Math.log10(peak + 1e-6) + 54) / 54, 0, 1);
        level = target > level ? target : level - (level - target) * 0.12;
        els.level.style.setProperty('--p', level.toFixed(3));
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
      meter = {
        stop() {
          cancelAnimationFrame(raf);
          ctx.close().catch(() => {});
        },
      };
    }

    function stopMeter() {
      if (meter) meter.stop();
      meter = null;
      els.level.style.setProperty('--p', '0');
    }

    // ---- Recording --------------------------------------------------------------------

    function screenProblem(err) {
      const name = err && err.name;
      if (name === 'NotAllowedError') {
        // Cancelling the picker is not a problem; the system refusing is.
        if (!/system/i.test(err.message || '')) return '';
        if (platform === 'mac') {
          return desktop
            ? 'macOS ekran kaydına izin vermiyor. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı bölümünde Kurgu Masası’nı açın, sonra uygulamayı yeniden başlatın.'
            : 'macOS ekran kaydına izin vermiyor. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı bölümünde tarayıcınızı açın, sonra tarayıcıyı yeniden başlatın.';
        }
        return 'Sistem ekran kaydına izin vermedi.';
      }
      if (name === 'NotFoundError') return 'Kaydedilecek bir ekran bulunamadı.';
      if (name === 'NotSupportedError' || name === 'TypeError') return 'Bu tarayıcı ekran kaydını desteklemiyor.';
      return `Ekran paylaşılamadı${name ? ` (${name})` : ''}.`;
    }

    function startProblem(err) {
      if (err && err.message === 'no-encoder') {
        return 'Bu tarayıcı kayıt sırasında video kodlayamıyor. Güncel bir Chrome, Edge ya da Kurgu Masası masaüstü uygulamasıyla deneyin.';
      }
      return `Kayıt başlatılamadı: ${err && err.message ? err.message : err}`;
    }

    function showError(text) {
      els.error.hidden = !text;
      els.error.textContent = text || '';
    }

    function start() {
      if (stage !== 'setup' || !supported) return;
      const reason = o.blocked();
      if (reason) {
        showError(reason);
        return;
      }
      showError(null);
      // The browser only shows its screen picker during a click, so this comes before anything else.
      const withSound = !els.system.closest('[hidden]') && els.system.checked;
      let request;
      try {
        request = R.openScreen(withSound);
      } catch (err) {
        request = Promise.reject(err);
      }
      begin(request, withSound);
    }

    async function begin(request, withSound) {
      pickCancelled = false;
      setStage('choosing');
      let screen;
      try {
        screen = await request;
      } catch (err) {
        setStage('setup');
        showError(pickCancelled ? '' : screenProblem(err));
        if (!drawer.isOpen) closePreview();
        return;
      }
      setStage('starting');
      // The camera may still be opening (its permission prompt); record it rather than start without it.
      if (previewOpening) await previewOpening;
      let current = null;
      try {
        const MB = await o.getMediabunny();
        current = new R.Recording(MB, { screen, devices: preview });
        current.addEventListener('ended', () => finish());
        current.addEventListener('camera-ended', () => {
          KM.toast('Kamera bağlantısı kesildi; ekran kaydı sürüyor', { tone: 'warn' });
        });
        current.addEventListener('error', () => {
          const err = current.failure;
          console.error(err);
          showError(`Kayıt bir sorun yüzünden durdu: ${err && err.message ? err.message : err}`);
          finish();
        });
        rec = current;
        await current.start();
      } catch (err) {
        console.error(err);
        rec = null;
        if (current) await current.cancel();
        stopStream(screen);
        preview = null;
        setStage('setup');
        showError(startProblem(err));
        if (drawer.isOpen) refreshPreview();
        return;
      }
      made.push(...current.parts.map((p) => p.name));
      if (withSound && !current.sound.system) {
        KM.toast(current.sound.mic ? 'Bilgisayarın sesi paylaşılmadı; mikrofon kaydediliyor' : 'Bilgisayarın sesi paylaşılmadı', { tone: 'warn' });
      }
      setStage('recording');
      ticker = setInterval(tick, 250);
      tick();
      o.onChange();
    }

    function togglePause() {
      if (!rec) return;
      if (stage === 'recording') {
        rec.pause();
        setStage('paused');
      } else if (stage === 'paused') {
        rec.resume();
        setStage('recording');
      }
    }

    /** Ends the recording (back to setup), keeping the files only when told to. */
    async function end(keep) {
      const current = rec;
      setStage('finishing');
      let result = null;
      try {
        if (keep) result = await current.stop();
        else await current.cancel();
      } catch (err) {
        console.error(err);
        await current.cancel();
        showError(`Kayıt tamamlanamadı: ${err && err.message ? err.message : err}`);
      }
      if (!result) made = made.filter((n) => !current.parts.some((p) => p.name === n));
      rec = null;
      preview = null;
      clearInterval(ticker);
      stopMeter();
      els.video.srcObject = null;
      setStage('setup');
      o.onChange();
      return result;
    }

    async function finish() {
      if (!rec || (stage !== 'recording' && stage !== 'paused')) return;
      if (rec.elapsed() < 1) {
        await end(false);
        KM.toast('Kayıt bir saniyeden kısaydı, silindi');
        if (drawer.isOpen) refreshPreview();
        return;
      }
      const hadCamera = rec.parts.length > 1;
      const result = await end(true);
      if (result && hadCamera && !result.camera) KM.toast('Kamera kaydı tamamlanamadı; ekran kaydı yüklendi', { tone: 'warn' });
      if (!result) {
        if (!drawer.isOpen) drawer.open(els.button);
        refreshPreview();
        return;
      }
      if (await o.onRecorded(result)) {
        if (drawer.isOpen) drawer.close();
        return;
      }
      // The editor could not open them; at least let them be saved.
      if (!drawer.isOpen) drawer.open(els.button);
      offerFiles(result);
      refreshPreview();
    }

    function offerFiles(result) {
      showError('Kayıt editöre yüklenemedi. Dosyaları indirip başka bir oynatıcıda açabilirsiniz: ');
      for (const file of [result.screen, result.camera].filter(Boolean)) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.textContent = file.name;
        els.error.append(a, ' ');
      }
    }

    async function discard() {
      if (!rec || (stage !== 'recording' && stage !== 'paused')) return;
      if (!discardTimer) {
        // Deleting a recording cannot be undone, so it takes a second press.
        els.discard.textContent = 'Silmek için yeniden basın';
        els.discard.classList.add('is-armed');
        discardTimer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      await end(false);
      KM.toast('Kayıt silindi');
      if (drawer.isOpen) refreshPreview();
    }

    function disarm() {
      clearTimeout(discardTimer);
      discardTimer = 0;
      els.discard.textContent = 'Kaydı sil';
      els.discard.classList.remove('is-armed');
    }

    // ---- The desktop app's screen picker --------------------------------------------

    function showSources(request) {
      if (stage !== 'choosing') {
        desktop.chooseSource(null);
        return;
      }
      const grid = els.sourceGrid;
      grid.textContent = '';
      if (request.access && request.access !== 'granted') {
        const p = document.createElement('p');
        p.className = 'hint rec-source-note';
        p.textContent = 'macOS ekran kaydına izin vermiyorsa küçük resimler boş görünür ve kayıt siyah çıkar. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı bölümünde Kurgu Masası’nı açıp uygulamayı yeniden başlatın.';
        grid.appendChild(p);
      }
      if (!request.sources.length) {
        const p = document.createElement('p');
        p.className = 'hint rec-source-note';
        p.textContent = 'Kaydedilecek bir ekran ya da pencere bulunamadı. Vazgeçip yeniden deneyin.';
        grid.appendChild(p);
      }
      for (const s of request.sources) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rec-source';
        const shot = document.createElement('span');
        shot.className = 'rec-source-shot';
        if (s.thumbnail) {
          const img = document.createElement('img');
          img.src = s.thumbnail;
          img.alt = '';
          shot.appendChild(img);
        }
        const name = document.createElement('span');
        name.className = 'rec-source-name';
        name.textContent = s.name;
        const kind = document.createElement('span');
        kind.className = 'rec-source-kind';
        kind.textContent = s.kind === 'screen' ? 'Ekran' : 'Pencere';
        b.append(shot, name, kind);
        b.addEventListener('click', () => {
          setStage('choosing');
          desktop.chooseSource(s.id);
        });
        grid.appendChild(b);
      }
      setStage('sources');
      const first = grid.querySelector('button');
      if (first) first.focus();
    }

    // ---- Showing the state ---------------------------------------------------------------

    // Where the focus goes when a stage hides the button that had it.
    const FOCUS = { setup: 'start', recording: 'stop', paused: 'pause' };

    function setStage(next) {
      stage = next;
      sync();
      tick();
      const active = document.activeElement;
      const lost = !active || active === document.body || active.offsetParent === null || active.disabled;
      const target = els[FOCUS[stage]];
      if (drawer.isOpen && lost && target && !target.disabled) target.focus();
    }

    let shown = '';
    function tick() {
      if (!rec) return;
      const text = elapsedText(rec.elapsed());
      if (`${stage} ${text}` !== shown) {
        shown = `${stage} ${text}`;
        els.clock.textContent = text;
        els.buttonLabel.textContent = text;
        els.ctaSub.textContent = `Kayıt sürüyor · ${text}`;
        document.title = `${stage === 'paused' ? '❚❚' : '●'} ${text} · ${baseTitle}`;
        const { sizes, sound } = rec;
        const parts = [`Ekran ${sizes.screen.width}×${sizes.screen.height}`];
        if (sizes.camera) parts.push(`kamera ${sizes.camera.width}×${sizes.camera.height}`);
        const heard = [sound.mic && 'mikrofon', sound.system && 'bilgisayar sesi'].filter(Boolean);
        parts.push(heard.length ? heard.join(' ve ') : 'sessiz');
        const bytes = rec.bytes();
        if (bytes) parts.push(U.bytes(bytes));
        els.meta.textContent = parts.join(' · ');
      }
      tellDesktop();
    }

    let told = '';
    function tellDesktop() {
      if (!desktop || typeof desktop.setRecording !== 'function') return;
      const state = recording() && stage !== 'starting' ? stage : 'idle';
      const elapsed = rec ? Math.floor(rec.elapsed()) : 0;
      const key = `${state}:${elapsed}`;
      if (key === told) return;
      told = key;
      desktop.setRecording({ state, elapsed, hide: !!prefs.hide });
    }

    function sync() {
      const busy = recording();
      const active = stage === 'recording' || stage === 'paused';
      els.setup.hidden = busy || stage === 'sources';
      els.sources.hidden = stage !== 'sources';
      els.running.hidden = !busy;
      els.start.disabled = !allowed || stage !== 'setup' || !!previewOpening;
      els.start.lastChild.textContent = stage === 'choosing' ? 'Ekran seçiliyor…' : 'Kaydı başlat';
      els.camera.disabled = stage !== 'setup';
      els.mic.disabled = stage !== 'setup';
      els.pause.disabled = !active;
      els.pause.textContent = stage === 'paused' ? 'Devam et' : 'Duraklat';
      els.stop.disabled = !active;
      els.stopLabel.textContent = stage === 'finishing' ? 'Kayıt hazırlanıyor…' : 'Kaydı bitir';
      els.discard.disabled = !active;
      if (!active) disarm();

      let tone = 'busy';
      let text = stage === 'finishing' ? 'Dosyalar hazırlanıyor' : 'Başlatılıyor';
      if (stage === 'recording') {
        tone = 'bad';
        text = 'Kaydediliyor';
      } else if (stage === 'paused') {
        tone = 'warn';
        text = 'Duraklatıldı';
      }
      els.status.dataset.tone = tone;
      els.statusText.textContent = text;
      els.badge.hidden = !active;
      els.badge.classList.toggle('is-paused', stage === 'paused');
      els.badgeText.textContent = stage === 'paused' ? 'Duraklatıldı' : 'Kayıtta';

      els.button.classList.toggle('is-recording', busy);
      els.button.classList.toggle('is-paused', stage === 'paused');
      els.cta.classList.toggle('is-recording', busy);
      if (!busy) {
        shown = '';
        els.buttonLabel.textContent = 'Kayıt';
        els.ctaSub.textContent = 'İkisi aynı anda kaydedilir, bitince buraya yüklenir';
        els.clock.textContent = '00:00';
        els.meta.textContent = '';
        document.title = baseTitle;
      }
      els.button.setAttribute('aria-label', busy ? `Kayıt sürüyor, ${els.clock.textContent}. Kayıt panelini aç` : 'Ekranı ve kamerayı kaydet');
      tellDesktop();
    }

    // ---- Opening and closing ---------------------------------------------------------------

    function open(from) {
      if (!supported) return;
      if (!drawer.isOpen) drawer.open(from || els.button);
      if (stage === 'setup' && !allowed) {
        els.note.textContent = 'Kayıt bu görünümde kullanılamıyor.';
        els.level.parentElement.hidden = true;
        showError('Bu görünüm ekran kaydına izin vermiyor. Editörü tarayıcıda kendi sekmesinde ya da Kurgu Masası masaüstü uygulamasında açın.');
      } else if (stage === 'setup') {
        showError(null);
        if (!preview && !previewOpening) refreshPreview();
        else startMeter();
      } else if (preview) {
        startMeter();
      }
      sync();
    }

    function cancelPick() {
      pickCancelled = true;
      setStage('choosing');
      desktop.chooseSource(null);
    }

    function closed() {
      if (stage === 'sources') cancelPick();
      stopMeter();
      // Closing the panel turns the camera off, unless it is being recorded.
      if (stage === 'setup') closePreview();
      disarm();
    }

    // ---- Wiring --------------------------------------------------------------------------------

    if (supported) {
      for (const el of [els.button, els.cta, els.or, els.shortcut]) el.hidden = false;
      R.forget([], STALE);
      // Kept in memory, a long recording can run out of room: say so before it starts.
      R.storesOnDisk().then((onDisk) => { els.memoryNote.hidden = onDisk; });
    }
    els.button.addEventListener('click', () => open(els.button));
    els.cta.addEventListener('click', () => open(els.cta));
    els.start.addEventListener('click', start);
    els.pause.addEventListener('click', togglePause);
    els.stop.addEventListener('click', finish);
    els.discard.addEventListener('click', discard);
    els.camera.addEventListener('change', () => {
      prefs.camera = els.camera.value;
      savePrefs();
      refreshPreview();
    });
    els.mic.addEventListener('change', () => {
      prefs.mic = els.mic.value;
      savePrefs();
      refreshPreview();
    });
    els.system.checked = prefs.system;
    els.system.addEventListener('change', () => {
      prefs.system = els.system.checked;
      savePrefs();
    });
    els.hide.checked = prefs.hide;
    els.hide.addEventListener('change', () => {
      prefs.hide = els.hide.checked;
      savePrefs();
    });
    if (root.navigator.mediaDevices && root.navigator.mediaDevices.addEventListener) {
      root.navigator.mediaDevices.addEventListener('devicechange', () => {
        if (drawer.isOpen && stage === 'setup' && !previewOpening) fillDevices();
      });
    }

    if (desktop) {
      els.hideField.hidden = false;
      // The desktop app records the computer's sound on Windows only.
      if (platform !== 'win') els.system.closest('.switch').hidden = true;
      els.runningHint.textContent = platform === 'mac'
        ? 'Kaydı menü çubuğundaki kırmızı simgeden de duraklatıp bitirebilirsiniz.'
        : 'Kaydı görev çubuğunun sağındaki kırmızı simgeden de duraklatıp bitirebilirsiniz.';
      if (typeof desktop.onSourceRequest === 'function') desktop.onSourceRequest(showSources);
      els.sourceCancel.addEventListener('click', cancelPick);
    }

    window.addEventListener('beforeunload', (e) => {
      if (!recording()) return;
      e.preventDefault();
      e.returnValue = '';
    });
    sync();

    return {
      supported,
      open,
      stop: finish,
      togglePause,
      get isOpen() { return drawer.isOpen; },
      get busy() { return recording(); },
      /** Removes earlier recordings of this page that the editor no longer shows. */
      release(inUse) {
        const current = rec ? rec.parts.map((p) => p.name) : [];
        const unused = made.filter((n) => !inUse.includes(n) && !current.includes(n));
        if (!unused.length) return;
        made = made.filter((n) => !unused.includes(n));
        R.forget(unused);
      },
    };
  }

  PE.recordPanel = { create };
})(self);
