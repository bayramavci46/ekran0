/*
 * In-app check that the CI runs in the Android emulator and the iOS simulator (only builds made
 * with `node scripts/copy-app.mjs --smoke` contain it). It opens two test videos that hear the
 * same sound 1.5 s apart (the camera one turned like a phone video), waits for the automatic
 * sync, checks the private storage the export writes to, exports two seconds the way the Export
 * button does (with the codecs the editor's own encoder trial picked), and copies the result
 * where the share sheet takes it from. Every step has a time limit, so a step that hangs is
 * named, with how far it came, instead of stopping the check.
 *
 * Each check is printed to the console, which the app writes to its log, and a last line says
 * whether all passed:
 *   KURGU_SMOKE_CHECK {"name": …, "ok": …, "info": …}
 *   KURGU_SMOKE_DONE {"ok": …}
 * KURGU_SMOKE_INFO and KURGU_SMOKE_PROGRESS lines only tell what is going on.
 */
(async () => {
  const LATE = 1.5;
  const checks = [];
  const errors = [];
  const say = (tag, data) => console.log(`${tag} ${JSON.stringify(data)}`);
  const check = (name, ok, info) => {
    const c = { name, ok: !!ok, info: info === undefined ? null : info };
    checks.push(c);
    say('KURGU_SMOKE_CHECK', c);
    return c.ok;
  };
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason && e.reason.message ? e.reason.message : e.reason)));
  const message = (err) => String(err && err.message ? err.message : err);
  const seconds = (since) => Math.round((performance.now() - since) / 100) / 10;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (fn, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(200)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  };
  /**
   * One step with a time limit. `fn` fills `notes` as it goes, so a step that stops halfway still
   * says how far it came. It passes unless it throws, runs out of time or returns false.
   */
  const step = async (name, limit, fn) => {
    const notes = {};
    const started = performance.now();
    let timer = 0;
    const late = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${limit} s`)), limit * 1000);
    });
    try {
      const ok = await Promise.race([fn(notes), late]);
      return check(name, ok !== false, { s: seconds(started), ...notes });
    } catch (err) {
      return check(name, false, { s: seconds(started), error: message(err), ...notes });
    } finally {
      clearTimeout(timer);
    }
  };

  const PE = window.PipEditor;
  const instance = Math.random().toString(36).slice(2, 8);
  const run = async () => {
    try {
      check('editor loaded', PE && PE.app && PE.exporter && window.KM);
      check('runs as the phone app', !!PE.native && document.documentElement.dataset.native === PE.native.platform,
        PE.native ? PE.native.platform : null);
      say('KURGU_SMOKE_INFO', {
        agent: navigator.userAgent, visible: document.visibilityState,
        webcodecs: ['VideoDecoder', 'VideoEncoder', 'AudioDecoder', 'AudioEncoder'].filter((k) => typeof window[k] === 'function'),
        storage: !!(navigator.storage && navigator.storage.getDirectory),
        writable: typeof FileSystemFileHandle === 'function' && typeof FileSystemFileHandle.prototype.createWritable === 'function',
      });

      const faces = ['400 16px "Barlow"', '600 16px "Barlow Condensed"', '400 16px "JetBrains Mono"'];
      await Promise.all(faces.map((f) => document.fonts.load(f, 'Kurgu Masası ığşİÖü')));
      const fonts = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')));
      check('bundled fonts', ['Barlow', 'Barlow Condensed', 'JetBrains Mono'].every((f) => fonts.has(f)), [...fonts]);

      const load = async (name) => new File([await (await fetch(`smoke/${name}`)).blob()], name, { type: 'video/mp4' });
      const opened = await PE.app.loadFiles({ screen: await load('screen.mp4'), camera: await load('camera.mp4') });
      const { screen, camera } = PE.app.state.media;
      check('test videos open', opened && screen && camera && camera.height > camera.width, screen && camera
        ? { screen: `${screen.width}x${screen.height}`, camera: `${camera.width}x${camera.height}`, duration: [screen.duration, camera.duration] }
        : document.getElementById('loadError').textContent);
      if (!opened) throw new Error('the test videos did not open');

      const sync = await until(() => (['idle', 'running'].includes(PE.app.state.sync.status) ? null : PE.app.state.sync), 90000);
      check('automatic sync', sync && sync.status === 'ok' && Math.abs(PE.app.state.offset - LATE) < 0.05,
        { status: sync ? sync.status : 'timeout', offset: PE.app.state.offset });

      // The format the Export button would use: the editor picks it once it has tried the encoders
      // (MP4 where a fast MP4 encoder works, otherwise WebM; simulators differ from machine to machine).
      const formats = await until(() => PE.app.state.formats, 120000);
      const job = { ...PE.app.buildJob(), trimStart: 3, trimEnd: 5 };
      const plan = await PE.exporter.plan(job);
      check('export plan', plan.method !== 'none', {
        method: plan.method, video: plan.videoCodec || null, acceleration: plan.videoAcceleration || null, audio: plan.audioCodec || null,
        size: `${job.output.width}x${job.output.height}`, format: job.output.format, formats: formats ? formats.map((f) => f.label) : null, reasons: plan.reasons,
      });
      const MB = await PE.exporter.getMediabunny();
      const name = `deneme.${plan.container || job.output.format}`;
      // Where the export writes, so long videos need not fit in memory.
      await step('writes to private storage', 30, async (notes) => {
        const target = await PE.exporter.privateTarget('deneme.bin');
        notes.available = !!target;
        if (!target) return true; // the export then keeps the video in memory
        const writer = target.writable.getWriter();
        await writer.write({ type: 'write', position: 0, data: new Uint8Array(3 << 20) });
        await writer.write({ type: 'write', position: 1024, data: new Uint8Array(16).fill(7) });
        await writer.close();
        const file = await target.finish('application/octet-stream');
        const head = new Uint8Array(await file.slice(1024, 1040).arrayBuffer());
        notes.bytes = file.size;
        return file.size === 3 << 20 && head.every((b) => b === 7);
      });

      let blob = null;
      const controller = new AbortController();
      let shown = -1;
      const started = performance.now();
      const onProgress = (p) => {
        const at = Math.floor(p * 4) * 25;
        if (at > shown) say('KURGU_SMOKE_PROGRESS', { percent: (shown = at), s: seconds(started) });
      };
      const exported = await step('export', 150, async (notes) => {
        notes.method = plan.method;
        if (plan.method === 'fast') {
          const target = (await PE.exporter.privateTarget(name)) || PE.exporter.memoryTarget();
          const r = await PE.exporter.exportFast(job, plan, { target, onProgress, signal: controller.signal });
          notes.encoded = true;
          blob = await target.finish(r.mimeType);
        } else if (plan.method === 'realtime') {
          const kit = PE.exporter.prepareRealtime(job);
          blob = (await PE.exporter.exportRealtime(job, plan, { onProgress, signal: controller.signal, kit })).blob;
        }
        notes.bytes = blob ? blob.size : 0;
        return !!blob;
      });
      if (!exported) {
        controller.abort();
        say('KURGU_SMOKE_INFO', { exportStoppedAt: shown });
      }
      if (blob) {
        const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
        try {
          const duration = await input.computeDuration();
          const v = await input.getPrimaryVideoTrack();
          const a = await input.getPrimaryAudioTrack();
          check('export result', Math.abs(duration - 2) < 0.2 && !!v && !!a, {
            bytes: blob.size, duration, video: v && (await v.getCodec()), audio: a && (await a.getCodec()),
          });
        } finally {
          input.dispose();
        }

        await step('copied for the share sheet', 45, async (notes) => {
          notes.uri = await PE.native.save(blob, name);
          notes.size = Number((await window.Capacitor.Plugins.Filesystem.stat({ path: notes.uri })).size);
          return notes.size === blob.size;
        });
      }
    } catch (err) {
      check('no exceptions', false, String(err && err.stack ? err.stack : err));
    }
    check('no errors in the page', errors.length === 0, errors);
    say('KURGU_SMOKE_DONE', { ok: checks.every((c) => c.ok) });
  };
  // One copy at a time: should the app load the page twice, the second waits instead of using
  // (and clearing) the first one's files. Every copy says when it starts.
  say('KURGU_SMOKE_INFO', { instance, loadedAfter: Math.round(performance.now()) });
  if (navigator.locks) navigator.locks.request('kurgu-smoke', run);
  else run();
})();
