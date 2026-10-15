'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');

test('timecode counts frames at the given rate', () => {
  assert.equal(U.timecode(0, 30), '00:00:00:00');
  assert.equal(U.timecode(83.4, 30), '00:01:23:12');
  assert.equal(U.timecode(3661.48, 25), '01:01:01:12');
  assert.equal(U.timecode(-3, 30), '00:00:00:00');
});

test('clock labels for the ruler', () => {
  assert.equal(U.clock(5), '0:05');
  assert.equal(U.clock(90), '1:30');
  assert.equal(U.clock(3723), '1:02:03');
});

test('durations read naturally in Turkish', () => {
  assert.equal(U.duration(4.25), '4,3 sn');
  assert.equal(U.duration(45), '45 sn');
  assert.equal(U.duration(215), '3 dk 35 sn');
  assert.equal(U.duration(3725), '1 sa 02 dk');
});

test('signed seconds use a real minus sign and a decimal comma', () => {
  assert.equal(U.signedSeconds(1.25), '+1,25 sn');
  assert.equal(U.signedSeconds(-0.4), '−0,40 sn');
  assert.equal(U.signedSeconds(0.001), '±0,00 sn');
});

test('bytes and percent', () => {
  assert.equal(U.bytes(512), '512 B');
  assert.equal(U.bytes(25480000), '24 MB');
  assert.equal(U.bytes(5.5 * 1024 * 1024), '5,5 MB');
  assert.equal(U.percent(0.284), '%28');
});

test('export file names carry the date', () => {
  assert.equal(U.exportFileName('mp4', new Date(2026, 9, 15, 9, 5)), 'ekran-kamera-2026-10-15-0905.mp4');
});
