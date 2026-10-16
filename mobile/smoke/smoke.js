/*
 * In-app check that the CI runs in the Android emulator and the iOS simulator (only builds made
 * with `node scripts/copy-app.mjs --smoke` contain it). It opens two test videos that hear the
 * same sound 1.5 s apart (the camera one turned like a phone video), waits for the automatic
 * sync, tries the parts of the fast export one by one (decoding, encoding the picture and the
 * sound, writing to private storage), exports two seconds the way the Export button does, and
 * copies the result where the share sheet takes it from. Every step has a time limit, so a part
 * that hangs is named, with how far it came, instead of stopping the check.
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

  // WebCodecs names for the codecs the export plan picks.
  const VIDEO = { avc: 'avc1.64001f', hevc: 'hvc1.1.6.L93.B0', vp9: 'vp09.00.31.08', vp8: 'vp8', av1: 'av01.0.04M.08' };
  const AUDIO = { aac: 'mp4a.40.2', opus: 'opus' };

  /** WebCodecs on their own, without the export around them. */
  const probes = (MB, file, plan, size) => [
    ['decodes video', 45, async (notes) => {
      const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        const config = await track.getDecoderConfig();
        Object.assign(notes, { codec: config.codec, sent: 0, frames: 0, dequeued: 0 });
        notes.supported = (await VideoDecoder.isConfigSupported(config)).supported;
        const decoder = new VideoDecoder({
          output: (frame) => { notes.frames++; frame.close(); },
          error: (err) => { notes.failed = message(err); },
        });
        decoder.addEventListener('dequeue', () => notes.dequeued++);
        decoder.configure(config);
        for await (const packet of new MB.EncodedPacketSink(track).packets()) {
          decoder.decode(packet.toEncodedVideoChunk());
          notes.sent++;
          notes.queue = decoder.decodeQueueSize;
          if (notes.sent === 30) break;
        }
        await decoder.flush();
        decoder.close();
        return notes.frames > 0 && !notes.failed;
      } finally {
        input.dispose();
      }
    }],
    ['encodes video', 45, async (notes) => {
      const config = {
        codec: VIDEO[plan.videoCodec], width: size.width, height: size.height, bitrate: 2e6, framerate: 30,
        hardwareAcceleration: plan.videoAcceleration,
      };
      if (plan.videoCodec === 'avc') config.avc = { format: 'avc' };
      Object.assign(notes, { codec: config.codec, acceleration: config.hardwareAcceleration, sent: 0, chunks: 0, dequeued: 0, queue: 0 });
      notes.supported = (await VideoEncoder.isConfigSupported(config)).supported;
      const encoder = new VideoEncoder({
        output: () => notes.chunks++,
        error: (err) => { notes.failed = message(err); },
      });
      encoder.addEventListener('dequeue', () => notes.dequeued++);
      encoder.configure(config);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `hsl(${i * 12} 70% 50%)`;
        ctx.fillRect(0, 0, size.width, size.height);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / 30), duration: Math.round(1e6 / 30) });
        encoder.encode(frame, { keyFrame: i === 0 });
        frame.close();
        notes.sent++;
        notes.queue = Math.max(notes.queue, encoder.encodeQueueSize);
        await wait(0);
      }
      await encoder.flush();
      encoder.close();
      return notes.chunks > 0 && !notes.failed;
    }],
    ['encodes sound', 45, async (notes) => {
      if (!plan.audioCodec) return true;
      const rate = 48000;
      const config = { codec: AUDIO[plan.audioCodec], sampleRate: rate, numberOfChannels: 2, bitrate: 128000 };
      Object.assign(notes, { codec: config.codec, sent: 0, chunks: 0, dequeued: 0, queue: 0 });
      notes.supported = (await AudioEncoder.isConfigSupported(config)).supported;
      const encoder = new AudioEncoder({
        output: () => notes.chunks++,
        error: (err) => { notes.failed = message(err); },
      });
      encoder.addEventListener('dequeue', () => notes.dequeued++);
      encoder.configure(config);
      const n = 2048;
      for (let i = 0; i < 24; i++) {
        const data = new Float32Array(n * 2);
        for (let j = 0; j < n; j++) data[j] = data[n + j] = 0.2 * Math.sin((2 * Math.PI * 440 * (i * n + j)) / rate);
        const audio = new AudioData({
          format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2,
          timestamp: Math.round((i * n * 1e6) / rate), data,
        });
        encoder.encode(audio);
        audio.close();
        notes.sent++;
        notes.queue = Math.max(notes.queue, encoder.encodeQueueSize);
        await wait(0);
      }
      await encoder.flush();
      encoder.close();
      return notes.chunks > 0 && !notes.failed;
    }],
    ['writes to private storage', 30, async (notes) => {
      const target = await PE.exporter.privateTarget('deneme.bin');
      notes.available = !!target;
      if (!target) return true; // the export then keeps the video in memory
      const writer = target.writable.getWriter();
      await writer.write({ type: 'write', position: 0, data: new Uint8Array(3 << 20) });
      await writer.write({ type: 'write', position: 1024, data: new Uint8Array(16).fill(7) });
      notes.written = true;
      await writer.close();
      const file = await target.finish('application/octet-stream');
      const head = new Uint8Array(await file.slice(1024, 1040).arrayBuffer());
      notes.bytes = file.size;
      return file.size === 3 << 20 && head.every((b) => b === 7);
    }],
  ];

  const PE = window.PipEditor;
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

    const job = { ...PE.app.buildJob(), trimStart: 3, trimEnd: 5 };
    const formats = await PE.exporter.detectFormats();
    const plan = await PE.exporter.plan(job);
    check('export plan', plan.method !== 'none', {
      method: plan.method, video: plan.videoCodec || null, acceleration: plan.videoAcceleration || null, audio: plan.audioCodec || null,
      size: `${job.output.width}x${job.output.height}`, formats: formats.map((f) => f.label), reasons: plan.reasons,
    });
    const MB = await PE.exporter.getMediabunny();
    if (plan.method === 'fast') {
      for (const [name, limit, fn] of probes(MB, screen.file, plan, job.output)) await step(name, limit, fn);
    }

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
        const target = (await PE.exporter.privateTarget('deneme.mp4')) || PE.exporter.memoryTarget();
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
        notes.uri = await PE.native.save(blob, 'deneme.mp4');
        notes.size = Number((await window.Capacitor.Plugins.Filesystem.stat({ path: notes.uri })).size);
        return notes.size === blob.size;
      });
    }
  } catch (err) {
    check('no exceptions', false, String(err && err.stack ? err.stack : err));
  }
  check('no errors in the page', errors.length === 0, errors);
  say('KURGU_SMOKE_DONE', { ok: checks.every((c) => c.ok) });
})();
