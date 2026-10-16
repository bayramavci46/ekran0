/*
 * Automatic sync: finds how far apart the screen and camera recordings started by listening
 * to both. Each sound track is reduced to an onset envelope, 100 values per second that are
 * high where the sound suddenly gets louder (a clap, a syllable, a key press). Two microphones
 * in the same room hear the same onsets, so the lag at which the two envelopes line up best
 * is the camera offset.
 *
 * The onsets are measured in twelve frequency bands and added up (spectral flux). A noisy or
 * echoing camera microphone buries some bands, but speech still rises clearly in the others.
 *
 * The maths below is plain JavaScript and is unit tested in Node. Decoding the audio needs a
 * browser: Mediabunny with WebCodecs where available, otherwise Web Audio (older Safari).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.PipEditor = root.PipEditor || {}).autoSync = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const HOP = 0.01; // seconds per envelope value
  const RATE = 16000; // audio is resampled to this rate before analysis
  const HOP_SAMPLES = RATE * HOP;
  const WINDOW = 256; // samples per spectrum (16 ms)
  const RANGE_DB = 45; // anything this far below a band's loud parts counts as silence
  const SMOOTH = [1, 2, 3, 2, 1]; // echo spreads the same onset over a few steps
  const EXCLUDE = 0.25; // seconds around the best match that belong to the same peak

  // Twelve bands, evenly spaced on a log scale from 150 Hz to 6 kHz, as ranges of spectrum bins.
  const BANDS = (() => {
    const hz = RATE / WINDOW;
    const edges = [];
    for (let i = 0; i <= 12; i++) edges.push(Math.round((150 * Math.pow(6000 / 150, i / 12)) / hz));
    const out = [];
    for (let i = 0; i < 12; i++) out.push([edges[i], Math.max(edges[i] + 1, edges[i + 1])]);
    return out;
  })();
  const HANN = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));

  const nextPow2 = (n) => {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  };

  // ---- Envelopes -----------------------------------------------------------

  class Envelope {
    /** @param {number} seconds Length of the analysed window, starting at time 0. */
    constructor(seconds) {
      this.size = Math.max(1, Math.ceil(seconds / HOP));
      this.limit = this.size * HOP_SAMPLES; // samples at RATE that fill the window
      this.bands = new Float32Array(this.size * BANDS.length);
      this.valid = new Uint8Array(this.size);
      this.ring = new Float32Array(WINDOW);
      this.pos = 0; // next write position in the ring
      this.written = 0; // samples (at RATE) pushed so far
      this.loud = false;
      this.re = new Float64Array(WINDOW);
      this.im = new Float64Array(WINDOW);
      this.filter = null;
      this.prev = 0; // last filtered input sample and its time, for interpolation
      this.prevTime = -Infinity;
    }

    /** Low-pass biquad that keeps the resampler from folding high frequencies down. */
    _setRate(rate) {
      const f = Math.min(6500, rate * 0.45);
      const w = (2 * Math.PI * f) / rate;
      const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
      const cos = Math.cos(w);
      const a0 = 1 + alpha;
      this.filter = {
        rate,
        b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0,
        a1: (-2 * cos) / a0, a2: (1 - alpha) / a0,
        x1: 0, x2: 0, y1: 0, y2: 0,
      };
    }

    _push(v) {
      this.ring[this.pos] = v;
      if (++this.pos === WINDOW) this.pos = 0;
      this.written++;
      if (v !== 0) this.loud = true;
      if (this.written % HOP_SAMPLES === 0 && this.written >= WINDOW) this._spectrum(this.written / HOP_SAMPLES - 1);
    }

    /** Band energies of the last WINDOW samples; step k ends at time (k + 1) · HOP. */
    _spectrum(k) {
      if (k >= this.size) return;
      const re = this.re;
      const im = this.im;
      for (let i = 0; i < WINDOW; i++) {
        re[i] = this.ring[(this.pos + i) % WINDOW] * HANN[i];
        im[i] = 0;
      }
      fft(re, im, false);
      const off = k * BANDS.length;
      for (let b = 0; b < BANDS.length; b++) {
        let e = 0;
        for (let f = BANDS[b][0]; f < BANDS[b][1]; f++) e += re[f] * re[f] + im[f] * im[f];
        this.bands[off + b] = e;
      }
      this.valid[k] = 1;
    }

    /**
     * Adds decoded audio whose first sample plays at time `t0` (seconds). `channels` are planar
     * sample arrays. Returns false once the window is full, so callers can stop decoding.
     */
    add(t0, rate, channels) {
      if (this.written >= this.limit) return false;
      const n = channels[0].length;
      const nc = channels.length;
      const inv = 1 / nc;
      // A new rate or a jump in time starts the filter and the interpolation afresh.
      if (!this.filter || this.filter.rate !== rate || Math.abs(t0 - this.prevTime - 1 / rate) * rate > 2) {
        this._setRate(rate);
        this.prev = 0;
        this.prevTime = t0 - 1 / rate;
      }
      // Silence up to the first sample (a track that starts late, or a gap).
      const first = Math.min(this.limit, Math.round(t0 * RATE));
      while (this.written < first) this._push(0);
      const F = this.filter;
      let prev = this.prev;
      let prevTime = this.prevTime;
      for (let i = 0; i < n; i++) {
        let x = channels[0][i];
        for (let c = 1; c < nc; c++) x += channels[c][i];
        x *= inv;
        const y = F.b0 * x + F.b1 * F.x1 + F.b2 * F.x2 - F.a1 * F.y1 - F.a2 * F.y2;
        F.x2 = F.x1;
        F.x1 = x;
        F.y2 = F.y1;
        F.y1 = y;
        const t = t0 + i / rate;
        // Emit every output sample that falls between the previous input sample and this one.
        for (let tOut = this.written / RATE; tOut <= t; tOut = this.written / RATE) {
          this._push(tOut < prevTime ? 0 : prev + (y - prev) * (tOut - prevTime) * rate);
          if (this.written >= this.limit) return false;
        }
        prev = y;
        prevTime = t;
      }
      this.prev = prev;
      this.prevTime = prevTime;
      return true;
    }

    /** True when the recording made any sound at all. */
    get heard() {
      return this.loud;
    }

    /**
     * Turns the band energies into
     *  - `level`: overall loudness from 0 (silence) to 1 (the loud parts), for drawing,
     *  - `onsets`: how sharply the loudness rises at each step, summed over the bands, for matching.
     */
    finish() {
      const N = this.size;
      const B = BANDS.length;
      const level = new Float32Array(N);
      const raw = new Float32Array(N);
      const floorOf = (values) => {
        if (values.length < 10) return null;
        values.sort((a, b) => a - b);
        const pick = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
        const top = pick(0.995);
        return { floor: Math.max(pick(0.2), top - RANGE_DB), top };
      };
      const dB = (e) => 10 * Math.log10(e + 1e-12);
      const floors = [];
      for (let b = 0; b < B; b++) {
        const values = [];
        for (let k = 0; k < N; k++) if (this.valid[k]) values.push(dB(this.bands[k * B + b]));
        floors.push(floorOf(values));
      }
      if (floors[0] === null) return { level, onsets: raw };
      const total = new Float32Array(N);
      const totals = [];
      for (let k = 0; k < N; k++) {
        if (!this.valid[k]) continue;
        let e = 0;
        for (let b = 0; b < B; b++) e += this.bands[k * B + b];
        total[k] = dB(e);
        totals.push(total[k]);
      }
      const range = floorOf(totals);
      const span = Math.max(1, range.top - range.floor);
      const last = new Float32Array(B);
      let haveLast = false;
      for (let k = 0; k < N; k++) {
        if (!this.valid[k]) {
          haveLast = false;
          continue;
        }
        level[k] = Math.min(1, Math.max(0, total[k] - range.floor) / span);
        let rise = 0;
        for (let b = 0; b < B; b++) {
          const v = Math.max(dB(this.bands[k * B + b]), floors[b].floor);
          if (haveLast && v > last[b]) rise += v - last[b];
          last[b] = v;
        }
        // The first step of a run has nothing before it to rise from.
        raw[k] = haveLast ? rise : 0;
        haveLast = true;
      }
      const onsets = new Float32Array(N);
      const half = (SMOOTH.length - 1) / 2;
      const weight = SMOOTH.reduce((a, b) => a + b, 0);
      for (let k = 0; k < N; k++) {
        let s = 0;
        for (let i = 0; i < SMOOTH.length; i++) {
          const j = k + i - half;
          if (j >= 0 && j < N) s += SMOOTH[i] * raw[j];
        }
        onsets[k] = s / weight;
      }
      return { level, onsets };
    }
  }

  // ---- Cross-correlation ---------------------------------------------------

  /** In-place radix-2 FFT of a complex signal (length must be a power of two). */
  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const ang = ((inverse ? 2 : -2) * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k;
          const b = a + half;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  /** r[m] = Σ a[j + m] · b[j] for every lag m; negative lags wrap to the end of the array. */
  function crossCorrelation(a, b) {
    const n = nextPow2(a.length + b.length);
    const ar = new Float64Array(n);
    const ai = new Float64Array(n);
    const br = new Float64Array(n);
    const bi = new Float64Array(n);
    ar.set(a);
    br.set(b);
    fft(ar, ai, false);
    fft(br, bi, false);
    for (let i = 0; i < n; i++) {
      // a · conj(b)
      const r = ar[i] * br[i] + ai[i] * bi[i];
      const m = ai[i] * br[i] - ar[i] * bi[i];
      ar[i] = r;
      ai[i] = m;
    }
    fft(ar, ai, true);
    return ar;
  }

  function prefix(x, square) {
    const out = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) out[i + 1] = out[i] + (square ? x[i] * x[i] : x[i]);
    return out;
  }

  function median(values) {
    const s = Float64Array.from(values).sort();
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Finds the lag at which envelope `b` (camera) lines up with envelope `a` (screen): camera
   * step j matches screen step j + lag. Every lag is scored by its normalised correlation,
   * weighted by the square root of the overlap so that a short chance match does not beat a
   * long real one, and the scores are compared with their own spread across all lags.
   *
   * @param {{minLag?: number, maxLag?: number, minOverlap?: number}} opts in envelope steps
   * @returns {{lag: number, z: number, second: number, ncc: number, overlap: number} | null}
   */
  function bestLag(a, b, opts) {
    const o = opts || {};
    const Na = a.length;
    const Nb = b.length;
    const minOverlap = Math.max(2, o.minOverlap || 1);
    const lo = Math.max(o.minLag !== undefined ? Math.ceil(o.minLag) : -Infinity, minOverlap - Nb);
    const hi = Math.min(o.maxLag !== undefined ? Math.floor(o.maxLag) : Infinity, Na - minOverlap);
    if (lo > hi) return null;
    const r = crossCorrelation(a, b);
    const n = r.length;
    const SA = prefix(a, false);
    const SAA = prefix(a, true);
    const SB = prefix(b, false);
    const SBB = prefix(b, true);
    const count = hi - lo + 1;
    const score = new Float64Array(count);
    const ncc = new Float64Array(count);
    const finite = [];
    for (let i = 0; i < count; i++) {
      const lag = lo + i;
      const j0 = Math.max(0, -lag);
      const j1 = Math.min(Nb, Na - lag);
      const cnt = j1 - j0;
      score[i] = NaN;
      if (cnt < minOverlap) continue;
      const sA = SA[j1 + lag] - SA[j0 + lag];
      const sAA = SAA[j1 + lag] - SAA[j0 + lag];
      const sB = SB[j1] - SB[j0];
      const sBB = SBB[j1] - SBB[j0];
      const varA = sAA - (sA * sA) / cnt;
      const varB = sBB - (sB * sB) / cnt;
      if (varA <= 1e-12 || varB <= 1e-12) continue;
      const cov = r[lag >= 0 ? lag : n + lag] - (sA * sB) / cnt;
      ncc[i] = cov / Math.sqrt(varA * varB);
      score[i] = ncc[i] * Math.sqrt(cnt);
      finite.push(score[i]);
    }
    if (finite.length < 3) return null;
    const mid = median(finite);
    const spread = 1.4826 * median(finite.map((v) => Math.abs(v - mid)));
    if (!(spread > 1e-9)) return null;
    let best = -1;
    for (let i = 0; i < count; i++) {
      if (Number.isFinite(score[i]) && (best < 0 || score[i] > score[best])) best = i;
    }
    const exclude = Math.round(EXCLUDE / HOP);
    let second = -Infinity;
    for (let i = 0; i < count; i++) {
      if (Math.abs(i - best) > exclude && Number.isFinite(score[i]) && score[i] > second) second = score[i];
    }
    // Sub-step position of the peak from a parabola through its neighbours.
    let delta = 0;
    if (best > 0 && best < count - 1 && Number.isFinite(score[best - 1]) && Number.isFinite(score[best + 1])) {
      const y0 = score[best - 1];
      const y1 = score[best];
      const y2 = score[best + 1];
      const den = y0 - 2 * y1 + y2;
      if (den < 0) delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
    }
    const lag = lo + best;
    return {
      lag: lag + delta,
      z: (score[best] - mid) / spread,
      second: Number.isFinite(second) ? (second - mid) / spread : 0,
      ncc: ncc[best],
      overlap: Math.min(Nb, Na - lag) - Math.max(0, -lag),
    };
  }

  /**
   * How much to trust a match. 'sure' and 'likely' are applied automatically; 'weak' is only
   * offered, because a chance match between unrelated sounds can reach it; 'unsure' is dropped.
   */
  function judge(match) {
    if (!match) return 'unsure';
    const margin = match.z - match.second;
    if (match.z >= 12 && margin >= 4) return 'sure';
    if (match.z >= 8 && margin >= 2.5) return 'likely';
    if (match.z >= 6 && margin >= 1.5) return 'weak';
    return 'unsure';
  }

  /**
   * The moment both recordings agree on most (a clap, a loud word), in screen time.
   * Used to show the match: both envelopes are drawn around it.
   */
  function anchorTime(a, b, lag) {
    const L = Math.round(lag);
    const win = Math.round(0.4 / HOP);
    let best = -1;
    let bestSum = 0;
    let sum = 0;
    const prod = (k) => {
      const j = k - L;
      return k >= 0 && k < a.length && j >= 0 && j < b.length ? a[k] * b[j] : 0;
    };
    const start = Math.max(0, L);
    const end = Math.min(a.length, b.length + L);
    for (let k = start; k < end; k++) {
      sum += prod(k);
      if (k - win >= start) sum -= prod(k - win);
      if (sum > bestSum) {
        bestSum = sum;
        best = k - win / 2;
      }
    }
    return best < 0 ? null : Math.max(0, best) * HOP;
  }

  /**
   * Matches two finished envelopes. `screen` and `camera` are the results of Envelope#finish().
   * Offsets follow the editor: camera time = screen time − offset.
   */
  function match(screen, camera, opts) {
    const o = opts || {};
    const minOverlap = Math.round((o.minOverlap || 4) / HOP);
    const m = bestLag(screen.onsets, camera.onsets, {
      minOverlap,
      minLag: o.minOffset !== undefined ? o.minOffset / HOP : undefined,
      maxLag: o.maxOffset !== undefined ? o.maxOffset / HOP : undefined,
    });
    if (!m) return { confidence: 'unsure', offset: null };
    return {
      confidence: judge(m),
      offset: Math.round(m.lag * HOP * 1000) / 1000,
      z: m.z,
      second: m.second,
      ncc: m.ncc,
      overlap: m.overlap * HOP,
      anchor: anchorTime(screen.onsets, camera.onsets, m.lag),
    };
  }

  // ---- Decoding (browser) ----------------------------------------------------

  const abortError = () => new DOMException('Senkron iptal edildi.', 'AbortError');

  /** Web Audio decoding with the old callback form as a fallback (Safari before 14.1). */
  function decodeAudioData(ctx, data) {
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  function offlineContext() {
    const Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Ctx) return null;
    for (const rate of [22050, 44100]) {
      try {
        return new Ctx(1, 1, rate);
      } catch (err) {
        // Some versions only accept the common rates.
      }
    }
    return null;
  }

  /**
   * Older Safari decodes video but not audio with WebCodecs. There the audio packets of the
   * window are copied, untouched, into a small sound-only file that Web Audio can decode.
   */
  async function decodeWithWebAudio(MB, input, track, from, seconds, signal) {
    const codec = await track.getCodec();
    const webm = codec === 'opus' || codec === 'vorbis';
    const output = new MB.Output({
      format: webm ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat(),
      target: new MB.BufferTarget(),
    });
    const conversion = await MB.Conversion.init({
      input,
      output,
      video: { discard: true },
      trim: { start: from, end: from + seconds },
      copy: { mode: 'forced' },
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Error('unsupported');
    const onAbort = () => conversion.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw abortError();
    const ctx = offlineContext();
    if (!ctx) throw new Error('unsupported');
    return decodeAudioData(ctx, output.target.buffer);
  }

  /**
   * Listens to the first `seconds` of a recording's main sound track.
   * @returns {Promise<{status: 'ok'|'no-audio'|'unsupported', envelope?: Envelope}>}
   */
  async function listen(MB, file, seconds, { signal, onProgress }) {
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    let iterator = null;
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return { status: 'no-audio' };
      // <video> elements start every file at 0, so times are measured from the file's first timestamp.
      const firstOf = async (x) => {
        const t = await x.getFirstTimestamp().catch(() => 0);
        return Number.isFinite(t) ? t : 0;
      };
      const base = await firstOf(input);
      const envelope = new Envelope(seconds);
      const webCodecs = typeof root.AudioDecoder === 'function' && (await track.canDecode().catch(() => false));
      if (webCodecs) {
        const sink = new MB.AudioBufferSink(track);
        iterator = sink.buffers(base, base + seconds)[Symbol.asyncIterator]();
        for (;;) {
          if (signal.aborted) throw abortError();
          const r = await iterator.next();
          if (r.done) break;
          const b = r.value.buffer;
          const ch = [];
          for (let i = 0; i < b.numberOfChannels; i++) ch.push(b.getChannelData(i));
          const t = r.value.timestamp - base;
          if (onProgress) onProgress(Math.min(1, (t + b.duration) / seconds));
          if (!envelope.add(t, b.sampleRate, ch)) break;
        }
      } else {
        const start = await firstOf(track);
        let audio;
        try {
          audio = await decodeWithWebAudio(MB, input, track, start, seconds, signal);
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          return { status: 'unsupported' };
        }
        const ch = [];
        for (let i = 0; i < audio.numberOfChannels; i++) ch.push(audio.getChannelData(i));
        envelope.add(start - base, audio.sampleRate, ch);
        if (onProgress) onProgress(1);
      }
      return { status: 'ok', envelope };
    } finally {
      if (iterator) {
        await Promise.race([iterator.return(), new Promise((resolve) => setTimeout(resolve, 1000))]).catch(() => {});
      }
      input.dispose();
    }
  }

  /**
   * Finds the camera offset for two loaded recordings ({file, duration}). Listens to the first
   * two minutes of both; when that is not conclusive and the recordings are longer, to the
   * first ten minutes.
   * @returns {Promise<{status: 'ok'|'weak'|'unsure'|'no-audio-screen'|'no-audio-camera'|'unsupported'|'too-short',
   *   offset?: number, confidence?: string, z?: number, anchor?: number|null, screen?: object, camera?: object}>}
   */
  async function syncRecordings(MB, screen, camera, { signal, onProgress } = {}) {
    const sig = signal || new AbortController().signal;
    if (!MB) return { status: 'unsupported' };
    if (Math.min(screen.duration, camera.duration) < 3) return { status: 'too-short' };
    let best = null;
    for (const windowSec of [120, 600]) {
      const sa = Math.min(screen.duration, windowSec);
      const sb = Math.min(camera.duration, windowSec);
      if (best && sa === best.window.screen && sb === best.window.camera) break;
      const progress = { a: 0, b: 0 };
      const report = () => onProgress && onProgress((progress.a + progress.b) / 2, windowSec);
      const [ra, rb] = await Promise.all([
        listen(MB, screen.file, sa, { signal: sig, onProgress: (p) => { progress.a = p; report(); } }),
        listen(MB, camera.file, sb, { signal: sig, onProgress: (p) => { progress.b = p; report(); } }),
      ]);
      if (ra.status === 'no-audio' || (ra.envelope && !ra.envelope.heard)) return { status: 'no-audio-screen' };
      if (rb.status === 'no-audio' || (rb.envelope && !rb.envelope.heard)) return { status: 'no-audio-camera' };
      if (ra.status !== 'ok' || rb.status !== 'ok') return { status: 'unsupported' };
      const a = ra.envelope.finish();
      const b = rb.envelope.finish();
      const m = match(a, b, {
        minOverlap: Math.max(2, Math.min(10, 0.4 * Math.min(sa, sb))),
        minOffset: -camera.duration + 0.1,
        maxOffset: screen.duration - 0.1,
      });
      const result = { ...m, screen: a, camera: b, window: { screen: sa, camera: sb } };
      if (!best || (result.z || 0) > (best.z || 0)) best = result;
      if (m.confidence === 'sure' || m.confidence === 'likely') break;
    }
    const status = { sure: 'ok', likely: 'ok', weak: 'weak' }[best.confidence] || 'unsure';
    return { status, ...best };
  }

  return { HOP, Envelope, fft, crossCorrelation, bestLag, judge, match, anchorTime, listen, syncRecordings };
});
