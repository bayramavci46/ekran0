'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TrackMixer, toStereo, limit } = require('../js/audio-mix.js');

/** Splits a mono signal f(t) at `rate` into chunks of `size` samples starting at `t0`. */
function source(f, rate, t0, seconds, size) {
  const total = Math.round(seconds * rate);
  let pos = 0;
  return async () => {
    if (pos >= total) return null;
    const len = Math.min(size, total - pos);
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) data[i] = f(t0 + (pos + i) / rate);
    const chunk = { t0: t0 + pos / rate, rate, len, ch: [data] };
    pos += len;
    return chunk;
  };
}

async function render(mixer, tStart, seconds, outRate) {
  const n = Math.round(seconds * outRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  await mixer.ensure(tStart + seconds);
  mixer.mixInto(L, R, tStart, outRate);
  mixer.drop(tStart + seconds);
  return { L, R };
}

test('resamples 44.1 kHz to 48 kHz with linear interpolation across chunk borders', async () => {
  const ramp = (t) => t; // slope 1 per second, easy to check
  const mixer = new TrackMixer(source(ramp, 44100, 0, 2, 1024), 1);
  const { L, R } = await render(mixer, 0.5, 0.5, 48000);
  for (let k = 0; k < L.length; k += 997) {
    const t = 0.5 + k / 48000;
    assert.ok(Math.abs(L[k] - t) < 1e-4, `L[${k}]=${L[k]} expected ${t}`);
    assert.equal(L[k], R[k]);
  }
});

test('applies gain and leaves time outside the track silent', async () => {
  const one = () => 1;
  // Track starts at t=1s and lasts 1s.
  const mixer = new TrackMixer(source(one, 48000, 1, 1, 4800), 0.5);
  const { L } = await render(mixer, 0.5, 2, 48000);
  assert.equal(L[0], 0); // 0.5 s: before the track
  assert.equal(L[48000], 0.5); // 1.5 s: inside
  assert.equal(L[L.length - 1], 0); // 2.5 s: after the end
});

test('streams block by block and drops old chunks', async () => {
  const sine = (t) => Math.sin(2 * Math.PI * 440 * t);
  const mixer = new TrackMixer(source(sine, 48000, 0, 3, 1000), 1);
  for (let b = 0; b < 30; b++) {
    const { L } = await render(mixer, b * 0.1, 0.1, 48000);
    const t = b * 0.1 + 100 / 48000;
    assert.ok(Math.abs(L[100] - sine(t)) < 1e-3);
    assert.ok(mixer.chunks.length <= 7, `kept ${mixer.chunks.length} chunks`);
  }
  await mixer.ensure(10);
  assert.equal(mixer.done, true);
});

test('two tracks add up and the limiter clips', async () => {
  const a = new TrackMixer(source(() => 0.75, 48000, 0, 1, 2048), 1);
  const b = new TrackMixer(source(() => 0.5, 32000, 0, 1, 2048), 1);
  const L = new Float32Array(4800);
  const R = new Float32Array(4800);
  for (const m of [a, b]) {
    await m.ensure(0.1);
    m.mixInto(L, R, 0, 48000);
  }
  assert.equal(L[10], 1.25);
  limit(L);
  assert.equal(L[10], 1);
});

test('toStereo duplicates mono and folds the centre channel', () => {
  const mono = new Float32Array([0.1, 0.2]);
  const [l, r] = toStereo([mono]);
  assert.equal(l, mono);
  assert.equal(r, mono);
  const [l5, r5] = toStereo([new Float32Array([0.1]), new Float32Array([0.2]), new Float32Array([1])]);
  assert.ok(Math.abs(l5[0] - 0.807) < 1e-6);
  assert.ok(Math.abs(r5[0] - 0.907) < 1e-6);
});
