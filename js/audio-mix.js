/*
 * Streaming audio mixer for the fast export path. Each input track delivers decoded
 * chunks ({t0, rate, len, ch}) in time order; the mixer resamples them linearly to the
 * output rate and adds them, with a gain, into stereo output blocks. Only the chunks
 * around the current block are kept in memory, so long recordings stay cheap.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.PipEditor = root.PipEditor || {}).audioMix = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const chunkEnd = (c) => c.t0 + c.len / c.rate;

  /**
   * Turns planar channel data into a stereo pair. Mono is duplicated; for more than two
   * channels the third one (front centre in the usual WAVE order) is folded into both sides.
   */
  function toStereo(channels) {
    if (channels.length === 1) return [channels[0], channels[0]];
    if (channels.length === 2) return [channels[0], channels[1]];
    const len = channels[0].length;
    const l = new Float32Array(len);
    const r = new Float32Array(len);
    const c = channels[2];
    for (let i = 0; i < len; i++) {
      l[i] = channels[0][i] + 0.707 * c[i];
      r[i] = channels[1][i] + 0.707 * c[i];
    }
    return [l, r];
  }

  class TrackMixer {
    /**
     * @param {() => Promise<{t0:number, rate:number, len:number, ch:Float32Array[]}|null>} next
     *   Pulls the next decoded chunk, or null at the end of the track.
     * @param {number} gain Linear gain applied while mixing.
     */
    constructor(next, gain) {
      this.next = next;
      this.gain = gain;
      this.chunks = [];
      this.done = false;
    }

    /** Pulls chunks until the buffered audio reaches `tEnd` (track time, seconds). */
    async ensure(tEnd) {
      while (!this.done) {
        const last = this.chunks[this.chunks.length - 1];
        if (last && chunkEnd(last) >= tEnd) return;
        const chunk = await this.next();
        if (!chunk) {
          this.done = true;
          return;
        }
        if (chunk.len > 0) this.chunks.push({ ...chunk, ch: toStereo(chunk.ch) });
      }
    }

    /** Forgets chunks that end before `t`. */
    drop(t) {
      while (this.chunks.length > 0 && chunkEnd(this.chunks[0]) <= t) this.chunks.shift();
    }

    /**
     * Adds this track into outL/outR. Output sample k corresponds to track time
     * tStart + k / outRate. Gaps and times outside the track stay silent.
     */
    mixInto(outL, outR, tStart, outRate) {
      const chunks = this.chunks;
      const g = this.gain;
      if (g === 0 || chunks.length === 0) return;
      let ci = 0;
      for (let k = 0; k < outL.length; k++) {
        const t = tStart + k / outRate;
        while (ci < chunks.length && chunkEnd(chunks[ci]) <= t) ci++;
        if (ci >= chunks.length) return;
        const c = chunks[ci];
        if (t < c.t0) continue;
        const pos = (t - c.t0) * c.rate;
        const i = Math.floor(pos);
        const frac = pos - i;
        const L = c.ch[0];
        const R = c.ch[1];
        const l0 = L[i];
        const r0 = R[i];
        let l1 = l0;
        let r1 = r0;
        if (i + 1 < c.len) {
          l1 = L[i + 1];
          r1 = R[i + 1];
        } else {
          const nx = chunks[ci + 1];
          if (nx && Math.abs(nx.t0 - chunkEnd(c)) < 1 / c.rate) {
            l1 = nx.ch[0][0];
            r1 = nx.ch[1][0];
          }
        }
        outL[k] += g * (l0 + (l1 - l0) * frac);
        outR[k] += g * (r0 + (r1 - r0) * frac);
      }
    }
  }

  /** Hard-limits the mix to [-1, 1] so loud overlaps clip instead of wrapping. */
  function limit(samples) {
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      if (v > 1) samples[i] = 1;
      else if (v < -1) samples[i] = -1;
    }
  }

  return { TrackMixer, toStereo, limit };
});
