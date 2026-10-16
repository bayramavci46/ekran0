/*
 * Records the screen and the camera at the same time, each into its own file, so the editor can
 * lay them out like any other pair of recordings. The screen file carries the computer's sound,
 * the camera file the microphone (with no camera, the microphone goes into the screen file).
 *
 * Frames and sound are encoded as they arrive (WebCodecs through Mediabunny) and written to the
 * browser's private storage when it can, so long recordings do not fill the memory. Both files are
 * timed on one clock, so the camera's offset is known; nothing has to be matched afterwards.
 */
(function (root) {
  'use strict';
  const PE = root.PipEditor;

  const FOLDER = 'kayitlar';
  const FPS = 30;
  const SCREEN = { width: { max: 1920 }, height: { max: 1200 }, frameRate: { ideal: FPS, max: FPS } };
  const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: FPS } };
  const VOICE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  /** Whether this browser can capture the screen and encode while recording. */
  function supported() {
    const md = root.navigator && root.navigator.mediaDevices;
    return !!(md && typeof md.getDisplayMedia === 'function' && typeof md.getUserMedia === 'function'
      && typeof root.VideoEncoder === 'function' && typeof root.AudioEncoder === 'function');
  }

  /** False inside a frame that may not capture the screen (an embedded preview, for example). */
  function allowedHere() {
    const doc = root.document;
    const policy = doc && (doc.permissionsPolicy || doc.featurePolicy);
    if (!policy || typeof policy.allowsFeature !== 'function') return true;
    try {
      return policy.allowsFeature('display-capture');
    } catch (err) {
      return true;
    }
  }

  // ---- Devices -----------------------------------------------------------------

  async function devices() {
    const list = await root.navigator.mediaDevices.enumerateDevices().catch(() => []);
    const pick = (kind) => list.filter((d) => d.kind === kind && d.deviceId);
    return { cameras: pick('videoinput'), mics: pick('audioinput') };
  }

  /** Camera and/or microphone; `null` ids leave that part out. */
  function openDevices(cameraId, micId) {
    if (cameraId === null && micId === null) return Promise.resolve(null);
    const exact = (id) => (id ? { deviceId: { exact: id } } : {});
    return root.navigator.mediaDevices.getUserMedia({
      video: cameraId === null ? false : { ...CAMERA, ...exact(cameraId) },
      audio: micId === null ? false : { ...VOICE, ...exact(micId) },
    });
  }

  /** Asks which screen or window to record. Must be called from a click. */
  function openScreen(withSound) {
    return root.navigator.mediaDevices.getDisplayMedia({
      video: SCREEN,
      audio: withSound ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      systemAudio: withSound ? 'include' : 'exclude',
    });
  }

  // ---- Storage -------------------------------------------------------------------

  async function folder() {
    const storage = root.navigator.storage;
    if (!storage || typeof storage.getDirectory !== 'function') return null;
    return (await storage.getDirectory()).getDirectoryHandle(FOLDER, { create: true });
  }

  /** A file in the origin's private storage (written to disk, read back without copying), or null. */
  async function diskFile(MB, name) {
    try {
      const dir = await folder();
      if (!dir) return null;
      const handle = await dir.getFileHandle(name, { create: true });
      if (typeof handle.createWritable !== 'function') {
        await dir.removeEntry(name).catch(() => {});
        return null;
      }
      const writable = await handle.createWritable();
      let bytes = 0;
      const stream = new WritableStream({
        async write(chunk) {
          await writable.write({ type: 'write', position: chunk.position, data: chunk.data });
          bytes = Math.max(bytes, chunk.position + chunk.data.byteLength);
        },
        close: () => writable.close(),
        abort: (reason) => writable.abort(reason),
      });
      return {
        target: new MB.StreamTarget(stream, { chunked: true, chunkSize: 2 ** 20 }),
        bytes: () => bytes,
        file: async (type) => new File([await handle.getFile()], name, { type }),
        remove: () => dir.removeEntry(name).catch(() => {}),
      };
    } catch (err) {
      return null;
    }
  }

  function memoryFile(MB, name) {
    const target = new MB.BufferTarget();
    return {
      target,
      bytes: () => null,
      file: async (type) => new File([target.buffer], name, { type }),
      remove: async () => {},
    };
  }

  let diskProbe = null;
  /** Whether recordings go to disk here; otherwise they are kept in memory, which limits their length. */
  function storesOnDisk() {
    diskProbe = diskProbe || (async () => {
      try {
        const dir = await folder();
        if (!dir) return false;
        const handle = await dir.getFileHandle('.deneme', { create: true });
        const ok = typeof handle.createWritable === 'function';
        if (ok) await (await handle.createWritable()).close();
        await dir.removeEntry('.deneme');
        return ok;
      } catch (err) {
        return false;
      }
    })();
    return diskProbe;
  }

  /** Deletes recordings from private storage: the named ones, and with `olderThan` (ms) every older one. */
  async function forget(names, olderThan) {
    try {
      const dir = await folder();
      if (!dir) return;
      for await (const [name, handle] of dir.entries()) {
        let drop = names.includes(name);
        if (!drop && olderThan !== undefined && handle.kind === 'file') {
          drop = Date.now() - (await handle.getFile()).lastModified > olderThan;
        }
        // A file that is still being written is locked and stays.
        if (drop) await dir.removeEntry(name).catch(() => {});
      }
    } catch (err) {
      // Nothing to clean up.
    }
  }

  // ---- Recording -------------------------------------------------------------------

  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

  /** The size frames are encoded at: the track's own, made even (H.264 needs that). */
  function encodedSize(track) {
    const s = track.getSettings();
    return { width: even(s.width || 1280), height: even(s.height || 720) };
  }

  /** MP4 with H.264 where the browser encodes it, otherwise WebM. */
  async function chooseFormat(MB, sizes) {
    const options = [['mp4', ['avc'], ['aac', 'opus']], ['webm', ['vp9', 'vp8'], ['opus']]];
    for (const [id, videoCodecs, audioCodecs] of options) {
      let video = null;
      for (const size of sizes) {
        video = await MB.getFirstEncodableVideoCodec(video ? [video] : videoCodecs, size).catch(() => null);
        if (!video) break;
      }
      const audio = await MB.getFirstEncodableAudioCodec(audioCodecs, { numberOfChannels: 2, sampleRate: 48000 }).catch(() => null);
      if (video && audio) return { id, video, audio };
    }
    return null;
  }

  class Recording extends EventTarget {
    /**
     * @param {object} MB Mediabunny
     * @param {{screen: MediaStream, devices: MediaStream|null}} streams the screen (with the
     *   computer's sound, if shared) and the camera and microphone
     */
    constructor(MB, streams) {
      super();
      this.MB = MB;
      this.streams = streams;
      this.state = 'idle';
      this.parts = [];
      this.contexts = [];
      this.pausedFor = 0;
      this.pausedAt = 0;
      this.failure = null;
    }

    async start() {
      const MB = this.MB;
      const screenVideo = this.streams.screen.getVideoTracks()[0];
      const systemSound = this.streams.screen.getAudioTracks()[0] || null;
      const dev = this.streams.devices;
      const camera = dev ? dev.getVideoTracks()[0] || null : null;
      const mic = dev ? dev.getAudioTracks()[0] || null : null;
      this.format = await chooseFormat(MB, [screenVideo, camera].filter(Boolean).map(encodedSize));
      if (!this.format) throw new Error('no-encoder');

      let screenSound = systemSound;
      if (!camera && mic) screenSound = systemSound ? await this._mix([systemSound, mic]) : mic;
      const when = stamp();
      this.parts.push(await this._part(`ekran-kaydi-${when}`, screenVideo, screenSound));
      if (camera) this.parts.push(await this._part(`kamera-kaydi-${when}`, camera, mic));
      this.sizes = { screen: encodedSize(screenVideo), camera: camera ? encodedSize(camera) : null };
      this.sound = { system: !!systemSound, mic: !!mic };

      // Sharing can be stopped from outside (the browser's own bar, or the system): that ends the
      // recording. A camera that goes away leaves its last picture in the camera file.
      screenVideo.addEventListener('ended', () => this.dispatchEvent(new Event('ended')), { once: true });
      if (camera) camera.addEventListener('ended', () => this.dispatchEvent(new Event('camera-ended')), { once: true });
      await Promise.all(this.parts.map((p) => p.output.start()));
      this.startedAt = performance.now();
      this.state = 'recording';
    }

    async _part(base, videoTrack, audioTrack) {
      const MB = this.MB;
      const name = `${base}.${this.format.id}`;
      const storage = (await diskFile(MB, name)) || memoryFile(MB, name);
      const output = new MB.Output({
        format: this.format.id === 'mp4' ? new MB.Mp4OutputFormat() : new MB.WebMOutputFormat(),
        target: storage.target,
      });
      const fail = (err) => this._fail(err);
      const s = videoTrack.getSettings();
      const size = encodedSize(videoTrack);
      const video = new MB.MediaStreamVideoTrackSource(videoTrack, {
        codec: this.format.video,
        quality: MB.QUALITY_HIGH,
        // A shared window can change size; its later frames are fitted into the first size.
        sizeChangeBehavior: 'contain',
        ...(s.width && s.height && (s.width !== size.width || s.height !== size.height) ? { transform: size } : {}),
      }, { frameRate: FPS });
      video.errorPromise.catch(fail);
      output.addVideoTrack(video, { frameRate: FPS });
      let audio = null;
      if (audioTrack) {
        audio = new MB.MediaStreamAudioTrackSource(audioTrack, { codec: this.format.audio, quality: MB.QUALITY_HIGH });
        audio.errorPromise.catch(fail);
        output.addAudioTrack(audio);
      }
      return { name, output, video, audio, storage };
    }

    /** One sound track out of several (computer sound and microphone into the screen file). */
    async _mix(tracks) {
      const ctx = new AudioContext();
      this.contexts.push(ctx);
      const out = ctx.createMediaStreamDestination();
      for (const track of tracks) ctx.createMediaStreamSource(new MediaStream([track])).connect(out);
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      return out.stream.getAudioTracks()[0];
    }

    _fail(err) {
      if (this.failure || this.state === 'done' || this.state === 'canceled') return;
      this.failure = err;
      this.dispatchEvent(new Event('error'));
    }

    /** Seconds recorded so far, without the pauses. */
    elapsed() {
      if (!this.startedAt) return 0;
      const now = this.state === 'paused' ? this.pausedAt : performance.now();
      return Math.max(0, (now - this.startedAt - this.pausedFor) / 1000);
    }

    /** Bytes written so far, when the files are on disk. */
    bytes() {
      let total = 0;
      for (const p of this.parts) {
        const b = p.storage.bytes();
        if (b === null) return null;
        total += b;
      }
      return total;
    }

    pause() {
      if (this.state !== 'recording') return;
      for (const p of this.parts) {
        p.video.pause();
        if (p.audio) p.audio.pause();
      }
      this.pausedAt = performance.now();
      this.state = 'paused';
    }

    resume() {
      if (this.state !== 'paused') return;
      for (const p of this.parts) {
        p.video.resume();
        if (p.audio) p.audio.resume();
      }
      this.pausedFor += performance.now() - this.pausedAt;
      this.state = 'recording';
    }

    /**
     * Finishes both files. A camera file that cannot be finished (its camera never sent a picture,
     * say) is left out; the screen recording is kept whatever happens to the camera.
     * @returns {Promise<{screen: File, camera: File|null, offset: number, duration: number}>}
     */
    async stop() {
      if (this.state !== 'recording' && this.state !== 'paused') throw new Error('not-recording');
      const duration = this.elapsed();
      this.state = 'finishing';
      // Each file starts with its first frame or sound; the gap between those is the camera's offset.
      const first = this.parts.map((p) => p.output._firstMediaStreamTimestamp);
      const offset = first.length > 1 && Number.isFinite(first[0]) && Number.isFinite(first[1]) ? first[1] - first[0] : 0;
      const done = await Promise.allSettled(this.parts.map((p) => p.output.finalize()));
      this._release();
      if (done[0].status === 'rejected') throw done[0].reason;
      const files = await Promise.all(this.parts.map((p, i) => {
        if (done[i].status === 'fulfilled') return p.storage.file(p.output.format.mimeType);
        console.error(done[i].reason);
        return p.storage.remove().then(() => null);
      }));
      this.state = 'done';
      return { screen: files[0], camera: files[1] || null, offset: Math.round(offset * 1000) / 1000, duration };
    }

    /** Throws the recording away. */
    async cancel() {
      if (this.state === 'done' || this.state === 'canceled') return;
      this.state = 'canceled';
      await Promise.all(this.parts.map((p) => p.output.cancel().catch(() => {})));
      this._release();
      await Promise.all(this.parts.map((p) => p.storage.remove()));
    }

    _release() {
      for (const stream of [this.streams.screen, this.streams.devices].filter(Boolean)) {
        for (const track of stream.getTracks()) track.stop();
      }
      for (const ctx of this.contexts) ctx.close().catch(() => {});
      this.contexts = [];
    }
  }

  PE.recorder = { supported, allowedHere, devices, openDevices, openScreen, chooseFormat, storesOnDisk, forget, Recording };
})(self);
