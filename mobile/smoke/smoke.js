/*
 * In-app check that the CI runs in the Android emulator and the iOS simulator (only builds made
 * with `node scripts/copy-app.mjs --smoke` contain it). It opens two test videos that hear the
 * same sound 1.5 s apart (the camera one turned like a phone video), waits for the automatic
 * sync, exports two seconds the way the Export button does, and copies the result where the
 * share sheet takes it from. Each check is printed to the console, which the app writes to its
 * log, and a last line says whether all passed:
 *   KURGU_SMOKE_CHECK {"name": …, "ok": …, "info": …}
 *   KURGU_SMOKE_DONE {"ok": …}
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
  };
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason && e.reason.message ? e.reason.message : e.reason)));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (fn, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(200)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  };

  try {
    const PE = window.PipEditor;
    check('editor loaded', PE && PE.app && PE.exporter && window.KM);
    check('runs as the phone app', !!PE.native && document.documentElement.dataset.native === PE.native.platform,
      PE.native ? PE.native.platform : null);

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

    const job = { ...PE.app.buildJob(), trimStart: 3, trimEnd: 5 };
    const formats = await PE.exporter.detectFormats();
    const plan = await PE.exporter.plan(job);
    check('export plan', plan.method !== 'none', {
      method: plan.method, video: plan.videoCodec || null, audio: plan.audioCodec || null,
      formats: formats.map((f) => f.label), reasons: plan.reasons,
    });
    let blob = null;
    const signal = new AbortController().signal;
    if (plan.method === 'fast') {
      const target = (await PE.exporter.privateTarget('deneme.mp4')) || PE.exporter.memoryTarget();
      const r = await PE.exporter.exportFast(job, plan, { target, onProgress() {}, signal });
      blob = await target.finish(r.mimeType);
    } else if (plan.method === 'realtime') {
      const kit = PE.exporter.prepareRealtime(job);
      blob = (await PE.exporter.exportRealtime(job, plan, { onProgress() {}, signal, kit })).blob;
    }
    if (blob) {
      const MB = await PE.exporter.getMediabunny();
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

      const uri = await PE.native.save(blob, 'deneme.mp4');
      const stat = await window.Capacitor.Plugins.Filesystem.stat({ path: uri });
      check('copied for the share sheet', Number(stat.size) === blob.size, { uri, size: Number(stat.size) });
    }
  } catch (err) {
    check('no exceptions', false, String(err && err.stack ? err.stack : err));
  }
  check('no errors in the page', errors.length === 0, errors);
  say('KURGU_SMOKE_DONE', { ok: checks.every((c) => c.ok) });
})();
