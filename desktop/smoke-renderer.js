/*
 * Smoke test that runs inside the packaged app's page (desktop/main.js --smoke-test).
 * It makes two short recordings that hear the same "voice" 1.5 s apart, with this computer's
 * own encoders, lets the automatic sync find the gap, and exports two seconds of the result
 * the way the Export button does. Then it records two live streams (drawn screen and camera
 * pictures with tones) with the editor's recorder, the way the Kayıt button does.
 * Evaluates to {checks: [{name, ok, info}]}.
 */
(async () => {
  const checks = [];
  const check = (name, ok, info) => checks.push({ name, ok: !!ok, info: info === undefined ? null : info });
  const PE = window.PipEditor;
  const RATE = 48000;
  const LATE = 1.5; // the camera starts this much after the screen recording

  // A speech-like sound: syllables of a few tones under a smooth envelope, with pauses.
  function voice(seed, seconds) {
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const syllables = [];
    for (let t = 0.3; t < seconds;) {
      const dur = 0.08 + rnd() * 0.22;
      const tones = [0, 1, 2].map(() => ({ f: 200 + rnd() * 2800, p: rnd() * 6.28, a: 0.3 + rnd() * 0.7 }));
      syllables.push({ start: t, dur, tones, amp: 0.15 + rnd() * 0.4 });
      t += dur + (rnd() < 0.15 ? 0.4 + rnd() * 0.8 : 0.03 + rnd() * 0.15);
    }
    return (time) => {
      let lo = 0;
      let hi = syllables.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (syllables[mid].start <= time) lo = mid;
        else hi = mid - 1;
      }
      const sy = syllables[lo];
      const x = (time - sy.start) / sy.dur;
      if (x < 0 || x > 1) return 0;
      let v = 0;
      for (const tone of sy.tones) v += tone.a * Math.sin(2 * Math.PI * tone.f * time + tone.p);
      return sy.amp * Math.sin(Math.PI * x) ** 2 * v * 0.5;
    };
  }

  function noise(seed, amount) {
    let s = seed;
    return () => ((s = (s * 48271) % 2147483647) / 2147483647 - 0.5) * 2 * amount;
  }

  /** Encodes a short recording (moving square + sound) with the platform's own encoders. */
  async function record(MB, fmt, { seconds, width, height, color, sound }) {
    const target = new MB.BufferTarget();
    const format = fmt.id === 'mp4' ? new MB.Mp4OutputFormat() : new MB.WebMOutputFormat();
    const output = new MB.Output({ format, target });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const video = new MB.CanvasSource(canvas, { codec: fmt.fast.video, quality: MB.QUALITY_MEDIUM });
    output.addVideoTrack(video, { frameRate: 10 });
    const audio = new MB.AudioBufferSource({ codec: fmt.fast.audio, quality: MB.QUALITY_MEDIUM });
    output.addAudioTrack(audio);
    await output.start();
    const videoLoop = async () => {
      for (let i = 0; i < seconds * 10; i++) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#f0a73a';
        ctx.fillRect((i * 9) % (width - 40), height / 3, 40, 40);
        await video.add(i / 10, 0.1);
      }
      video.close();
    };
    const audioLoop = async () => {
      for (let sec = 0; sec < seconds; sec++) {
        const data = new Float32Array(RATE);
        for (let i = 0; i < RATE; i++) data[i] = sound(sec + i / RATE);
        const buffer = new AudioBuffer({ length: RATE, numberOfChannels: 2, sampleRate: RATE });
        buffer.copyToChannel(data, 0);
        buffer.copyToChannel(data, 1);
        await audio.add(buffer);
      }
      audio.close();
    };
    await Promise.all([videoLoop(), audioLoop()]);
    await output.finalize();
    return new File([target.buffer], `smoke.${fmt.id}`, { type: format.mimeType });
  }

  try {
    check('editor loaded', PE && PE.app && PE.autoSync && PE.exporter && window.KM);
    check('marked as desktop app', !!document.documentElement.dataset.desktop, document.documentElement.dataset.desktop || null);

    const faces = ['400 16px "Barlow"', '600 16px "Barlow"', '600 16px "Barlow Condensed"', '400 16px "JetBrains Mono"'];
    await Promise.all(faces.map((f) => document.fonts.load(f, 'Kurgu Masası ığşİÖü')));
    const loaded = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')));
    check('bundled fonts', ['Barlow', 'Barlow Condensed', 'JetBrains Mono'].every((f) => loaded.has(f)), [...loaded]);

    check('save dialog available', true, PE.exporter.canPickFile());

    const formats = await PE.exporter.detectFormats();
    const fmt = formats.find((f) => f.fast && f.fast.audio);
    check('fast export formats', !!fmt, formats.map((f) => f.label));
    if (!fmt) return { checks };

    const MB = await PE.exporter.getMediabunny();
    const speech = voice(7, 30);
    const hiss = noise(3, 0.003);
    const room = noise(9, 0.01);
    const screenFile = await record(MB, fmt, {
      seconds: 20, width: 640, height: 360, color: '#203a40',
      sound: (t) => speech(t) + hiss(),
    });
    // The camera hears the same voice from further away: later, quieter, with some echo.
    const cameraFile = await record(MB, fmt, {
      seconds: 18, width: 320, height: 240, color: '#5a3d2c',
      sound: (t) => 0.5 * (speech(t + LATE) + 0.35 * speech(t + LATE - 0.031)) + room(),
    });
    check('test recordings encoded', screenFile.size > 1000 && cameraFile.size > 1000, { screen: screenFile.size, camera: cameraFile.size, format: fmt.label });

    const sync = await PE.autoSync.syncRecordings(MB, { file: screenFile, duration: 20 }, { file: cameraFile, duration: 18 });
    check('automatic sync', sync.status === 'ok' && Math.abs(sync.offset - LATE) < 0.03,
      { status: sync.status, offset: sync.offset, confidence: sync.confidence });

    const media = async (file, width, height, duration) => ({
      file, name: file.name, size: file.size, width, height, duration, analysis: await PE.exporter.analyzeFile(file),
    });
    const job = {
      screen: await media(screenFile, 640, 360, 20),
      camera: await media(cameraFile, 320, 240, 18),
      look: {
        box: { x: 0.68, y: 0.62, w: 0.28, h: 0.28 }, shape: 'rounded', radius: 0.35, borderWidth: 4,
        borderColor: '#ffffff', shadow: true, mirror: false, visible: true,
      },
      offset: LATE,
      trimStart: 3,
      trimEnd: 5,
      gains: { screen: 1, camera: 0.5 },
      output: { width: 640, height: 360, fps: 30, quality: 'medium', format: fmt.id },
    };
    const chosen = await PE.exporter.plan(job);
    check('export uses the fast path', chosen.method === 'fast', { method: chosen.method, video: chosen.videoCodec, audio: chosen.audioCodec, reasons: chosen.reasons });
    if (chosen.method !== 'fast') return { checks };

    const target = PE.exporter.memoryTarget();
    const r = await PE.exporter.exportFast(job, chosen, { target, onProgress() {}, signal: new AbortController().signal });
    const blob = await target.finish(r.mimeType);
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      const duration = await input.computeDuration();
      const v = await input.getPrimaryVideoTrack();
      const a = await input.getPrimaryAudioTrack();
      check('export result', Math.abs(duration - 2) < 0.15 && !!v && !!a, {
        bytes: blob.size, duration, video: v && (await v.getCodec()), audio: a && (await a.getCodec()),
        size: v && `${await v.getDisplayWidth()}x${await v.getDisplayHeight()}`,
      });
    } finally {
      input.dispose();
    }

    // ---- Recording ----
    const R = PE.recorder;
    check('desktop bridge', !!window.kurguDesktop && typeof window.kurguDesktop.setRecording === 'function'
      && typeof window.kurguDesktop.chooseSource === 'function', window.kurguDesktop ? window.kurguDesktop.platform : null);
    const onDisk = await R.storesOnDisk();
    check('recording available', R.supported() && R.allowedHere(), { onDisk });
    const live = (width, height, color) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      let i = 0;
      const paint = () => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#f0a73a';
        ctx.fillRect((i++ * 7) % (width - 40), height / 3, 40, 40);
      };
      paint();
      const timer = setInterval(paint, 33);
      return { track: canvas.captureStream(30).getVideoTracks()[0], stop: () => clearInterval(timer) };
    };
    const ac = new AudioContext();
    const tone = (frequency) => {
      const osc = ac.createOscillator();
      osc.frequency.value = frequency;
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream.getAudioTracks()[0];
    };
    const screenLive = live(1280, 720, '#203a40');
    const cameraLive = live(640, 480, '#5a3d2c');
    const recording = new R.Recording(MB, {
      screen: new MediaStream([screenLive.track, tone(440)]),
      devices: new MediaStream([cameraLive.track, tone(660)]),
    });
    let failure = null;
    recording.addEventListener('error', () => { failure = recording.failure; });
    await recording.start();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const taken = await recording.stop();
    screenLive.stop();
    cameraLive.stop();
    ac.close();
    const inspect = async (file) => {
      const recorded = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
      try {
        const v = await recorded.getPrimaryVideoTrack();
        const a = await recorded.getPrimaryAudioTrack();
        return {
          name: file.name, bytes: file.size, duration: await recorded.computeDuration(),
          video: v && `${await v.getCodec()} ${await v.getDisplayWidth()}x${await v.getDisplayHeight()}`,
          audio: a && (await a.getCodec()),
        };
      } finally {
        recorded.dispose();
      }
    };
    const screenTake = await inspect(taken.screen);
    const cameraTake = await inspect(taken.camera);
    check('recording the screen and the camera', !failure
      && [screenTake, cameraTake].every((t) => t.video && t.audio && Math.abs(t.duration - 2.5) < 0.4)
      && Math.abs(taken.offset) < 0.5, {
      format: recording.format, offset: taken.offset, screen: screenTake, camera: cameraTake,
      error: failure ? String(failure) : null,
    });
    await R.forget([taken.screen.name, taken.camera.name]);
  } catch (err) {
    check('no exceptions', false, String(err && err.stack ? err.stack : err));
  }
  return { checks };
})();
