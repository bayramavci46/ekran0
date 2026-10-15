/*
 * Turns the edit into a video file.
 *
 * Fast path (preferred): Mediabunny demuxes both recordings, WebCodecs decodes and
 * encodes, and every output frame is drawn with the same renderer as the preview.
 * This runs faster than real time, keeps a constant frame rate and writes a proper
 * MP4/WebM file, either straight to disk (File System Access) or into memory.
 *
 * Fallback: play the recordings in hidden <video> elements, draw them onto a canvas
 * and record that canvas plus the mixed audio with MediaRecorder, in real time.
 */
(function (root) {
  'use strict';
  const PE = root.PipEditor;
  const G = PE.geometry;
  const { TrackMixer, limit } = PE.audioMix;

  const AUDIO_RATE = 48000;
  const CODEC_NAMES = {
    avc: 'H.264', hevc: 'H.265', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', prores: 'ProRes',
    aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', eac3: 'E-AC-3',
  };
  const CONTAINERS = {
    mp4: { label: 'MP4', video: ['avc', 'hevc'], audio: ['aac', 'opus'] },
    webm: { label: 'WebM', video: ['vp9', 'vp8', 'av1'], audio: ['opus', 'vorbis'] },
  };
  const REALTIME_TYPES = {
    mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4'],
    webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
  };
  // Bits per pixel per frame for the real-time recorder.
  const REALTIME_BPP = { 'very-high': 0.16, high: 0.11, medium: 0.07, low: 0.045 };

  const codecName = (c) => (c ? CODEC_NAMES[c] || (c.startsWith('pcm') ? 'PCM' : c.toUpperCase()) : '');
  const abortError = () => new DOMException('Dışa aktarma iptal edildi.', 'AbortError');

  // ---- Mediabunny loading ------------------------------------------------

  let mediabunny = null;
  /** Resolves the Mediabunny namespace: a global from vendor/, or a CDN module in the single-file build. */
  function getMediabunny() {
    if (root.Mediabunny) return Promise.resolve(root.Mediabunny);
    if (!mediabunny) {
      mediabunny = root.PIP_MEDIABUNNY_URL
        ? import(root.PIP_MEDIABUNNY_URL).then((m) => (root.Mediabunny = m)).catch(() => null)
        : Promise.resolve(null);
    }
    return mediabunny;
  }

  const hasWebCodecs = () => typeof root.VideoEncoder === 'function' && typeof root.VideoDecoder === 'function';
  const hasAudioCodecs = () => typeof root.AudioEncoder === 'function' && typeof root.AudioDecoder === 'function';

  function quality(MB, level) {
    return { 'very-high': MB.QUALITY_VERY_HIGH, high: MB.QUALITY_HIGH, medium: MB.QUALITY_MEDIUM, low: MB.QUALITY_LOW }[level]
      || MB.QUALITY_HIGH;
  }

  // ---- Probing -------------------------------------------------------------

  /** Reads a recording's tracks and codecs. Returns null when Mediabunny is unavailable. */
  async function analyzeFile(file) {
    const MB = await getMediabunny();
    if (!MB) return null;
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    try {
      if (!(await input.canRead())) return { readable: false };
      const v = await input.getPrimaryVideoTrack();
      const a = await input.getPrimaryAudioTrack();
      const canDecode = async (t) => hasWebCodecs() && (await t.canDecode().catch(() => false));
      return {
        readable: true,
        video: v ? { codec: await v.getCodec(), decodable: await canDecode(v) } : null,
        audio: a
          ? {
            codec: await a.getCodec(),
            decodable: hasAudioCodecs() && (await canDecode(a)),
            channels: await a.getNumberOfChannels(),
            sampleRate: await a.getSampleRate(),
          }
          : null,
      };
    } catch (err) {
      return { readable: false, error: String(err && err.message ? err.message : err) };
    } finally {
      input.dispose();
    }
  }

  /** Which containers the fast path can write here, checked at a common size. */
  async function detectFormats() {
    const MB = await getMediabunny();
    const out = [];
    for (const [id, c] of Object.entries(CONTAINERS)) {
      let fast = null;
      if (MB && hasWebCodecs()) {
        const video = await MB.getFirstEncodableVideoCodec(c.video, { width: 1280, height: 720 }).catch(() => null);
        const audio = hasAudioCodecs()
          ? await MB.getFirstEncodableAudioCodec(c.audio, { numberOfChannels: 2, sampleRate: AUDIO_RATE }).catch(() => null)
          : null;
        if (video) fast = { video, audio };
      }
      const realtime = realtimeType(id, true);
      if (fast || realtime) {
        const detail = fast
          ? [codecName(fast.video), codecName(fast.audio)].filter(Boolean).join(' / ')
          : 'gerçek zamanlı kayıt';
        out.push({ id, label: `${c.label} (${detail})`, fast, realtime });
      }
    }
    return out;
  }

  function realtimeType(container, exact) {
    if (typeof root.MediaRecorder !== 'function' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
    const order = exact ? [container] : container === 'webm' ? ['webm', 'mp4'] : ['mp4', 'webm'];
    for (const id of order) {
      for (const type of REALTIME_TYPES[id]) {
        if (MediaRecorder.isTypeSupported(type)) return { container: id, mimeType: type };
      }
    }
    return null;
  }

  /**
   * Decides how the job will be exported.
   * @returns {Promise<{method:'fast'|'realtime'|'none', container?:string, videoCodec?:string,
   *   audioCodec?:string|null, mimeType?:string, reasons:string[], note?:string}>}
   */
  async function plan(job) {
    const reasons = [];
    const MB = await getMediabunny();
    const sources = [['Ekran kaydı', job.screen, job.gains.screen], ['Kamera kaydı', job.camera, job.gains.camera]]
      .filter(([, media]) => media);
    const needsAudio = sources.some(([, media, gain]) => gain > 0 && media.analysis && media.analysis.audio);

    if (!MB) reasons.push('Hızlı dışa aktarma kütüphanesi yüklenemedi.');
    else if (!hasWebCodecs()) reasons.push('Bu tarayıcı WebCodecs desteklemiyor.');
    else if (needsAudio && !hasAudioCodecs()) reasons.push('Bu tarayıcı WebCodecs ile ses kodlayamıyor.');
    else {
      for (const [label, media, gain] of sources) {
        const a = media.analysis;
        if (!a || !a.readable) reasons.push(`${label} dosyasının biçimi okunamadı.`);
        else if (!a.video || !a.video.decodable) reasons.push(`${label}: ${codecName(a.video && a.video.codec) || 'video'} çözülemiyor.`);
        else if (gain > 0 && a.audio && !a.audio.decodable) reasons.push(`${label}: ${codecName(a.audio.codec)} ses çözülemiyor.`);
      }
    }

    if (reasons.length === 0) {
      const { width, height, fps } = job.output;
      const pick = async (id) => {
        const c = CONTAINERS[id];
        const video = await MB.getFirstEncodableVideoCodec(c.video, { width, height, frameRate: fps }).catch(() => null);
        if (!video) return null;
        const audio = needsAudio
          ? await MB.getFirstEncodableAudioCodec(c.audio, { numberOfChannels: 2, sampleRate: AUDIO_RATE }).catch(() => null)
          : null;
        if (needsAudio && !audio) return null;
        return { method: 'fast', container: id, videoCodec: video, audioCodec: audio, reasons: [] };
      };
      // Respect the chosen container first (fast, then real time), then try the other one.
      const wanted = job.output.format;
      const other = wanted === 'mp4' ? 'webm' : 'mp4';
      const fast = await pick(wanted);
      if (fast) return fast;
      const rt = realtimeType(wanted, true);
      if (rt) {
        return {
          method: 'realtime', container: wanted, mimeType: rt.mimeType,
          reasons: [`${CONTAINERS[wanted].label} bu tarayıcıda hızlı yöntemle kodlanamıyor.`],
        };
      }
      const fastOther = await pick(other);
      if (fastOther) {
        fastOther.note = `${CONTAINERS[wanted].label} bu tarayıcıda kaydedilemiyor; ${CONTAINERS[other].label} kullanılacak.`;
        return fastOther;
      }
      reasons.push(`${width}×${height} çözünürlükte uygun kodlayıcı bulunamadı.`);
    }

    const rt = realtimeType(job.output.format, false);
    if (!rt) return { method: 'none', reasons };
    return { method: 'realtime', container: rt.container, mimeType: rt.mimeType, reasons };
  }

  // ---- Targets -------------------------------------------------------------

  /** Collects positioned writes in memory and hands them back as one Blob. */
  function memoryTarget() {
    const parts = [];
    let size = 0;
    const patch = (position, data) => {
      const end = position + data.byteLength;
      for (const p of parts) {
        const pEnd = p.pos + p.data.byteLength;
        if (pEnd <= position || p.pos >= end) continue;
        const from = Math.max(position, p.pos);
        const to = Math.min(end, pEnd);
        p.data.set(data.subarray(from - position, to - position), from - p.pos);
      }
      if (end > size) {
        if (position > size) {
          parts.push({ pos: size, data: new Uint8Array(position - size) });
          size = position;
        }
        parts.push({ pos: size, data: data.slice(size - position) });
        size = end;
      }
    };
    const writable = new WritableStream({
      write(chunk) {
        if (chunk.position === size) {
          parts.push({ pos: size, data: chunk.data.slice() });
          size += chunk.data.byteLength;
        } else {
          patch(chunk.position, chunk.data);
        }
      },
    });
    return {
      writable,
      cancel() {},
      async finish(type) {
        return new Blob(parts.map((p) => p.data), { type });
      },
    };
  }

  /** Streams writes into a file the user picked (Chrome/Edge). Cancelling discards it. */
  async function diskTarget(handle) {
    const file = await handle.createWritable();
    let cancelled = false;
    const writable = new WritableStream({
      write: (chunk) => file.write({ type: 'write', position: chunk.position, data: chunk.data }),
      close: () => (cancelled ? file.abort() : file.close()),
      abort: (reason) => file.abort(reason),
    });
    return {
      writable,
      cancel() { cancelled = true; },
      finish: () => handle.getFile(),
    };
  }

  const canPickFile = () => typeof root.showSaveFilePicker === 'function' && root.self === root.top;

  async function pickFile(name, container) {
    const types = container === 'mp4'
      ? [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }]
      : [{ description: 'WebM video', accept: { 'video/webm': ['.webm'] } }];
    return root.showSaveFilePicker({ suggestedName: name, types });
  }

  // ---- Fast export ---------------------------------------------------------

  async function exportFast(job, chosen, { target, onProgress, signal }) {
    const MB = await getMediabunny();
    const { width: W, height: H, fps } = job.output;
    const inputs = [];
    const iterators = [];
    let output = null;
    const open = (file) => {
      const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
      inputs.push(input);
      return input;
    };

    try {
      const screenIn = open(job.screen.file);
      const cameraIn = job.camera ? open(job.camera.file) : null;
      const screenTrack = await screenIn.getPrimaryVideoTrack();
      const cameraTrack = cameraIn ? await cameraIn.getPrimaryVideoTrack() : null;
      // <video> elements start every file at 0, so measure from each file's first timestamp.
      const firstTime = async (input) => {
        const t = await input.getFirstTimestamp().catch(() => 0);
        return Number.isFinite(t) ? t : 0;
      };
      const screenBase = await firstTime(screenIn);
      const cameraBase = cameraIn ? await firstTime(cameraIn) : 0;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', { alpha: false });

      const format = chosen.container === 'mp4'
        ? new MB.Mp4OutputFormat({ fastStart: false })
        : new MB.WebMOutputFormat();
      output = new MB.Output({ format, target: new MB.StreamTarget(target.writable, { chunked: true }) });

      const videoSource = new MB.CanvasSource(canvas, {
        codec: chosen.videoCodec,
        quality: quality(MB, job.output.quality),
        keyFrameInterval: 2,
      });
      output.addVideoTrack(videoSource, { frameRate: fps });

      const mixers = [];
      let audioSource = null;
      if (chosen.audioCodec) {
        const tracks = [[screenIn, screenBase, job.gains.screen, 0], [cameraIn, cameraBase, job.gains.camera, job.offset]];
        for (const [input, base, gain, shift] of tracks) {
          if (!input || gain <= 0) continue;
          const track = await input.getPrimaryAudioTrack();
          if (!track) continue;
          const sink = new MB.AudioBufferSink(track);
          const from = base + job.trimStart - shift;
          const iterator = sink.buffers(Math.max(base, from - 0.25))[Symbol.asyncIterator]();
          iterators.push(iterator);
          const next = async () => {
            const r = await iterator.next();
            if (r.done) return null;
            const b = r.value.buffer;
            const ch = [];
            for (let i = 0; i < b.numberOfChannels; i++) ch.push(b.getChannelData(i));
            return { t0: r.value.timestamp, rate: b.sampleRate, len: b.length, ch };
          };
          mixers.push({ mixer: new TrackMixer(next, gain), base, shift, iterator });
        }
        if (mixers.length > 0) {
          audioSource = new MB.AudioBufferSource({ codec: chosen.audioCodec, quality: MB.QUALITY_HIGH });
          output.addAudioTrack(audioSource);
        }
      }

      await output.start();

      const frames = Math.max(1, Math.round((job.trimEnd - job.trimStart) * fps));
      const seconds = frames / fps;
      const camDuration = job.camera ? job.camera.duration : 0;
      const camBox = G.toPx(job.look.box, W, H);
      const screenSink = new MB.CanvasSink(screenTrack, { width: W, height: H, fit: 'contain', poolSize: 2 });
      const cameraSink = cameraTrack && job.look.visible
        ? new MB.CanvasSink(cameraTrack, {
          width: Math.max(2, Math.round(camBox.w)),
          height: Math.max(2, Math.round(camBox.h)),
          fit: 'cover',
          poolSize: 2,
        })
        : null;

      const times = function* (base) {
        for (let i = 0; i < frames; i++) yield base + job.trimStart + i / fps;
      };
      const screenFrames = screenSink.canvasesAtTimestamps(times(screenBase));
      const cameraFrames = cameraSink ? cameraSink.canvasesAtTimestamps(times(cameraBase - job.offset)) : null;
      iterators.push(screenFrames);
      if (cameraFrames) iterators.push(cameraFrames);

      const progress = { video: 0, audio: audioSource ? 0 : 1 };
      const report = () => onProgress(Math.min(progress.video, progress.audio));

      const videoLoop = async () => {
        for (let i = 0; i < frames; i++) {
          if (signal.aborted) throw abortError();
          const [s, c] = await Promise.all([screenFrames.next(), cameraFrames ? cameraFrames.next() : null]);
          const camTime = job.trimStart + i / fps - job.offset;
          const camFrame = c && c.value && camTime >= 0 && camTime <= camDuration ? c.value.canvas : null;
          PE.renderer.drawFrame(ctx, W, H, {
            screen: s.value ? { source: s.value.canvas, width: s.value.canvas.width, height: s.value.canvas.height } : null,
            camera: camFrame ? { source: camFrame, width: camFrame.width, height: camFrame.height } : null,
            look: job.look,
          });
          await videoSource.add(i / fps, 1 / fps);
          progress.video = (i + 1) / frames;
          report();
        }
        videoSource.close();
      };

      const audioLoop = async () => {
        const total = Math.round(seconds * AUDIO_RATE);
        const block = AUDIO_RATE / 2;
        for (let pos = 0; pos < total; pos += block) {
          if (signal.aborted) throw abortError();
          const n = Math.min(block, total - pos);
          const L = new Float32Array(n);
          const R = new Float32Array(n);
          for (const m of mixers) {
            const t0 = m.base + job.trimStart + pos / AUDIO_RATE - m.shift;
            const t1 = t0 + n / AUDIO_RATE;
            await m.mixer.ensure(t1);
            m.mixer.mixInto(L, R, t0, AUDIO_RATE);
            m.mixer.drop(t1);
          }
          limit(L);
          limit(R);
          const buffer = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: AUDIO_RATE });
          buffer.copyToChannel(L, 0);
          buffer.copyToChannel(R, 1);
          await audioSource.add(buffer);
          progress.audio = Math.min(1, (pos + n) / total);
          report();
        }
        audioSource.close();
      };

      await Promise.all([videoLoop(), audioSource ? audioLoop() : null]);
      await output.finalize();
      return { mimeType: format.mimeType, container: chosen.container };
    } catch (err) {
      target.cancel();
      if (output && output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel().catch(() => {});
      }
      throw err;
    } finally {
      // Ending the iterators closes the frames and audio they decoded ahead.
      await Promise.race([
        Promise.allSettled(iterators.map((it) => it.return())),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      for (const input of inputs) input.dispose();
    }
  }

  /**
   * MediaRecorder files lack a duration and seek index; copying the packets into a
   * fresh container (no re-encoding) fixes both. Returns the original on any problem.
   */
  async function remux(blob, container) {
    const MB = await getMediabunny();
    if (!MB || !MB.Conversion) return blob;
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const target = memoryTarget();
    try {
      const format = container === 'mp4' ? new MB.Mp4OutputFormat({ fastStart: false }) : new MB.WebMOutputFormat();
      const output = new MB.Output({ format, target: new MB.StreamTarget(target.writable, { chunked: true }) });
      const conversion = await MB.Conversion.init({ input, output });
      if (!conversion.isValid || conversion.discardedTracks.length > 0) {
        await output.cancel().catch(() => {});
        return blob;
      }
      await conversion.execute();
      return await target.finish(format.mimeType);
    } catch (err) {
      return blob;
    } finally {
      input.dispose();
    }
  }

  // ---- Real-time fallback --------------------------------------------------

  function hiddenVideo(url) {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    return v;
  }

  function waitFor(target, event) {
    return new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('Video yüklenemedi.')); };
      const cleanup = () => {
        target.removeEventListener(event, ok);
        target.removeEventListener('error', fail);
      };
      target.addEventListener(event, ok);
      target.addEventListener('error', fail);
    });
  }

  async function exportRealtime(job, chosen, { onProgress, signal, audioContext }) {
    const { width: W, height: H, fps } = job.output;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    const sv = hiddenVideo(job.screen.url);
    const cv = job.camera ? hiddenVideo(job.camera.url) : document.createElement('video');
    const loads = [waitFor(sv, 'loadeddata')];
    if (job.camera) loads.push(waitFor(cv, 'loadeddata'));
    await Promise.all(loads);

    const ac = audioContext;
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    const route = (video, gain) => {
      const src = ac.createMediaElementSource(video);
      const g = ac.createGain();
      g.gain.value = gain;
      src.connect(g).connect(dest);
    };
    route(sv, job.gains.screen);
    if (job.camera) route(cv, job.gains.camera);

    const stream = canvas.captureStream(fps);
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    const recorder = new MediaRecorder(stream, {
      mimeType: chosen.mimeType,
      videoBitsPerSecond: Math.round(W * H * fps * (REALTIME_BPP[job.output.quality] || REALTIME_BPP.high)),
      audioBitsPerSecond: 192000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = (e) => reject(e.error || new Error('Kayıt hatası.'));
    });

    const player = new PE.SyncPlayer(sv, cv);
    player.hasScreen = true;
    player.hasCamera = !!job.camera;
    player.offset = job.offset;
    player.trimStart = job.trimStart;
    player.trimEnd = job.trimEnd;

    const draw = () => {
      const t = sv.currentTime;
      const camOn = job.camera && player.cameraActiveAt(t) && cv.readyState >= 2;
      PE.renderer.drawFrame(ctx, W, H, {
        screen: { source: sv, width: sv.videoWidth, height: sv.videoHeight },
        camera: camOn ? { source: cv, width: cv.videoWidth, height: cv.videoHeight } : null,
        look: job.look,
      });
      onProgress((t - job.trimStart) / (job.trimEnd - job.trimStart));
    };

    player.seek(job.trimStart);
    await waitFor(sv, 'seeked');
    draw();

    const onVisibility = () => {
      // Hidden tabs stop drawing; pause the recording instead of saving frozen frames.
      if (document.hidden && player.playing) {
        player.pause();
        recorder.pause();
      } else if (!document.hidden && recorder.state === 'paused') {
        recorder.resume();
        player.play().catch(() => {});
      }
    };

    try {
      await new Promise((resolve, reject) => {
        const finish = () => {
          if (!player.playing && sv.currentTime >= job.trimEnd - 1 / fps) resolve();
        };
        player.addEventListener('time', draw);
        player.addEventListener('state', finish);
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
        document.addEventListener('visibilitychange', onVisibility);
        recorder.start(1000);
        player.play().catch(reject);
      });
      draw();
      recorder.stop();
      await stopped;
      const raw = new Blob(chunks, { type: chosen.mimeType.split(';')[0] });
      return { blob: await remux(raw, chosen.container), container: chosen.container };
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
      player.pause();
      if (recorder.state !== 'inactive') recorder.stop();
      for (const v of [sv, cv]) {
        v.removeAttribute('src');
        v.load();
      }
      ac.close().catch(() => {});
    }
  }

  PE.exporter = {
    getMediabunny, analyzeFile, detectFormats, plan, codecName,
    memoryTarget, diskTarget, canPickFile, pickFile, exportFast, exportRealtime,
  };
})(self);
