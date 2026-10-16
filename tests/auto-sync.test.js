'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Envelope, fft, bestLag, judge, match, anchorTime } = require('../js/auto-sync.js');

function prng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A speech-like signal: syllables of a few tones under a smooth envelope, with short and long pauses. */
function speech(seed, seconds) {
  const rnd = prng(seed);
  const syllables = [];
  let t = 0.3;
  while (t < seconds) {
    const dur = 0.08 + rnd() * 0.22;
    const tones = [0, 1, 2].map(() => ({ f: 200 + rnd() * 2800, p: rnd() * 6.28, a: 0.3 + rnd() * 0.7 }));
    syllables.push({ start: t, dur, tones, amp: 0.2 + rnd() * 0.6 });
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
    const s = syllables[lo];
    const x = (time - s.start) / s.dur;
    if (x < 0 || x > 1) return 0;
    const env = Math.sin(Math.PI * x) ** 2;
    let v = 0;
    for (const tone of s.tones) v += tone.a * Math.sin(2 * Math.PI * tone.f * time + tone.p);
    return s.amp * env * v;
  };
}

/**
 * A "microphone": samples f(t) over [0, seconds) at `rate`, with optional echo, a duller sound
 * (fewer high tones are not modelled; a one-pole low-pass is), noise and gain.
 */
function record(f, { rate = 48000, seconds = 30, echo = 0, lowpass = 0, noise = 0, gain = 1, seed = 1 } = {}) {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const rnd = prng(seed);
  const a = lowpass ? Math.exp((-2 * Math.PI * lowpass) / rate) : 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let x = f(t);
    if (echo) x += 0.45 * f(t - 0.031) + 0.25 * f(t - 0.067);
    y = lowpass ? (1 - a) * x + a * y : x;
    out[i] = gain * y + noise * (rnd() * 2 - 1);
  }
  return out;
}

/** Feeds samples to an Envelope in decoder-sized blocks, the way the browser does. */
function envelope(samples, rate, { seconds = samples.length / rate, block = 1024, t0 = 0, channels = 1 } = {}) {
  const e = new Envelope(seconds);
  for (let i = 0; i < samples.length; i += block) {
    const part = samples.subarray(i, Math.min(samples.length, i + block));
    const ch = channels === 1 ? [part] : [part, part.map((v) => v * 0.8)];
    if (!e.add(t0 + i / rate, rate, ch)) break;
  }
  return e;
}

const options = (a, b) => ({ minOverlap: 8, minOffset: -b + 0.1, maxOffset: a - 0.1 });

test('finds a camera that started 2.4 s late, through echo, a duller microphone and noise', () => {
  const voice = speech(7, 40);
  const offset = 2.4; // camera time = screen time − offset
  const screen = record(voice, { seconds: 30, noise: 0.003 });
  const camera = record((t) => voice(t + offset), { seconds: 26, echo: 1, lowpass: 2500, noise: 0.02, gain: 0.4, seed: 2 });
  const m = match(envelope(screen, 48000).finish(), envelope(camera, 48000).finish(), options(30, 26));
  assert.ok(Math.abs(m.offset - offset) < 0.015, `offset ${m.offset}`);
  assert.equal(m.confidence, 'sure');
});

test('finds a camera that started 1.7 s early at another sample rate, in stereo, in odd block sizes', () => {
  const voice = speech(11, 40);
  const offset = -1.7;
  const screen = record(voice, { seconds: 30, noise: 0.002 });
  const camera = record((t) => voice(t + offset), { rate: 44100, seconds: 30, echo: 1, noise: 0.01, gain: 0.6, seed: 3 });
  const m = match(
    envelope(screen, 48000, { block: 960 }).finish(),
    envelope(camera, 44100, { block: 1157, channels: 2 }).finish(),
    options(30, 30),
  );
  assert.ok(Math.abs(m.offset - offset) < 0.015, `offset ${m.offset}`);
  assert.ok(m.confidence === 'sure' || m.confidence === 'likely', m.confidence);
});

test('places a sound track that starts late and has a gap at its own time', () => {
  const voice = speech(5, 40);
  const offset = 0.85;
  const screen = record(voice, { seconds: 30 });
  const rate = 48000;
  const camera = record((t) => voice(t + offset), { seconds: 30, gain: 0.5, seed: 4 });
  // The camera's sound starts 0.5 s in and misses 0.3 s around the 10 s mark.
  const e = new Envelope(30);
  for (let i = Math.round(0.5 * rate); i < camera.length; i += 1024) {
    const t = i / rate;
    if (t > 10 && t < 10.3) continue;
    e.add(t, rate, [camera.subarray(i, Math.min(camera.length, i + 1024))]);
  }
  const m = match(envelope(screen, rate).finish(), e.finish(), options(30, 30));
  assert.ok(Math.abs(m.offset - offset) < 0.015, `offset ${m.offset}`);
});

test('does not match two unrelated recordings', () => {
  const screen = record(speech(21, 40), { seconds: 30, noise: 0.003 });
  const camera = record(speech(22, 40), { seconds: 30, noise: 0.01, seed: 9 });
  const m = match(envelope(screen, 48000).finish(), envelope(camera, 48000).finish(), options(30, 30));
  assert.ok(m.confidence !== 'sure' && m.confidence !== 'likely', `${m.confidence} z=${m.z}`);
});

test('silence is not heard and gives no match', () => {
  const quiet = new Float32Array(48000 * 10);
  const e = envelope(quiet, 48000);
  assert.equal(e.heard, false);
  const voice = envelope(record(speech(3, 12), { seconds: 10 }), 48000);
  assert.equal(voice.heard, true);
  assert.equal(match(e.finish(), voice.finish(), options(10, 10)).confidence, 'unsure');
});

test('stops taking audio once the window is full', () => {
  const e = new Envelope(2);
  const block = new Float32Array(48000);
  assert.equal(e.add(0, 48000, [block]), true);
  assert.equal(e.add(1, 48000, [block]), false);
  assert.equal(e.add(2, 48000, [block]), false);
});

test('bestLag recovers the exact shift between two click tracks', () => {
  const rnd = prng(42);
  const a = new Float32Array(3000);
  for (let i = 0; i < 60; i++) a[Math.floor(rnd() * 3000)] = 0.5 + rnd();
  const shift = 137; // camera step j matches screen step j + shift
  const b = new Float32Array(2800);
  for (let j = 0; j < b.length; j++) b[j] = a[j + shift] || 0;
  const m = bestLag(a, b, { minOverlap: 500 });
  assert.equal(Math.round(m.lag), shift);
  assert.ok(Math.abs(m.lag - shift) < 0.5);
  assert.ok(m.z > 20);
});

test('fft followed by the inverse returns the input', () => {
  const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.7) + (i % 5));
  const im = new Float64Array(64);
  const copy = re.slice();
  fft(re, im, false);
  fft(re, im, true);
  for (let i = 0; i < 64; i++) {
    assert.ok(Math.abs(re[i] - copy[i]) < 1e-9);
    assert.ok(Math.abs(im[i]) < 1e-9);
  }
});

test('judge wants a high peak that stands clear of the next best', () => {
  assert.equal(judge({ z: 20, second: 4 }), 'sure');
  assert.equal(judge({ z: 9, second: 4 }), 'likely');
  assert.equal(judge({ z: 20, second: 18 }), 'weak');
  assert.equal(judge({ z: 6.5, second: 4.5 }), 'weak');
  assert.equal(judge({ z: 5, second: 3 }), 'unsure');
  assert.equal(judge(null), 'unsure');
});

test('anchorTime points at the moment both recordings agree on most', () => {
  const a = new Float32Array(2000);
  const b = new Float32Array(2000);
  a[1200] = 5; // a clap at 12 s on the screen recording
  b[1000] = 5; // and at 10 s on the camera
  a[300] = 1;
  b[900] = 1;
  const t = anchorTime(a, b, 200);
  assert.ok(Math.abs(t - 12) < 0.3, `anchor ${t}`);
});
