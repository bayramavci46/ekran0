'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry.js');

const W = 1920;
const H = 1080;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const nearBox = (a, b, eps = 1e-6) => ['x', 'y', 'w', 'h'].forEach((k) => near(a[k], b[k], eps));

test('fitInside moves a box back into the frame and shrinks it uniformly', () => {
  nearBox(G.fitInside({ x: -50, y: 1000, w: 400, h: 300 }, W, H), { x: 0, y: 780, w: 400, h: 300 });
  const big = G.fitInside({ x: 0, y: 0, w: 3840, h: 1080 }, W, H);
  near(big.w / big.h, 3840 / 1080);
  near(big.w, W);
});

test('move clamps to the frame edges', () => {
  nearBox(G.move({ x: 100, y: 100, w: 200, h: 100 }, -500, 2000, W, H), { x: 0, y: 980, w: 200, h: 100 });
});

test('corner resize with locked aspect keeps the ratio and the opposite corner', () => {
  const box = { x: 1000, y: 600, w: 320, h: 180 };
  // Drag the bottom-right corner 160px to the right: diagonal projection grows the box.
  const r = G.resize(box, 'se', 1000 + 480, 600 + 180, W, H, { lockAspect: true, minW: 40, minH: 40 });
  near(r.x, 1000);
  near(r.y, 600);
  near(r.w / r.h, 16 / 9);
  assert.ok(r.w > 320);
  // Dragging the top-left corner keeps the bottom-right corner fixed.
  const r2 = G.resize(box, 'nw', 900, 500, W, H, { lockAspect: true, minW: 40, minH: 40 });
  near(r2.x + r2.w, 1320);
  near(r2.y + r2.h, 780);
  near(r2.w / r2.h, 16 / 9);
});

test('locked resize stops at the frame edge and at the minimum size', () => {
  const box = { x: 1500, y: 800, w: 320, h: 180 };
  const grown = G.resize(box, 'se', 5000, 5000, W, H, { lockAspect: true, minW: 40, minH: 40 });
  assert.ok(grown.x + grown.w <= W + 1e-9);
  assert.ok(grown.y + grown.h <= H + 1e-9);
  near(grown.w / grown.h, 16 / 9);
  const shrunk = G.resize(box, 'se', 0, 0, W, H, { lockAspect: true, minW: 64, minH: 64 });
  near(shrunk.h, 64);
  near(shrunk.w / shrunk.h, 16 / 9);
});

test('locked edge resize stays centred on the other axis', () => {
  const box = { x: 800, y: 400, w: 200, h: 200 };
  const r = G.resize(box, 'e', 1100, 0, W, H, { lockAspect: true, minW: 20, minH: 20 });
  near(r.w, 300);
  near(r.h, 300);
  near(r.x, 800);
  near(r.y + r.h / 2, 500);
});

test('free edge resize changes one side only', () => {
  const box = { x: 100, y: 100, w: 400, h: 300 };
  nearBox(G.resize(box, 'e', 700, 999, W, H, { minW: 50, minH: 50 }), { x: 100, y: 100, w: 600, h: 300 });
  nearBox(G.resize(box, 'n', 0, 300, W, H, { minW: 50, minH: 50 }), { x: 100, y: 300, w: 400, h: 100 });
  // Cannot cross the opposite edge.
  nearBox(G.resize(box, 'w', 900, 0, W, H, { minW: 50, minH: 50 }), { x: 450, y: 100, w: 50, h: 300 });
});

test('snap pulls a nearby edge onto the safe margin and reports the guide', () => {
  const m = G.safeMargin(W, H);
  const lines = G.snapLines(W, H);
  const { box, guides } = G.snap({ x: m + 5, y: 300, w: 200, h: 100 }, W, H, lines, 8);
  near(box.x, m);
  assert.deepEqual(guides.x, [m]);
  assert.deepEqual(guides.y, []);
  // Centre lines snap too.
  const centred = G.snap({ x: W / 2 - 100 + 3, y: H / 2 - 50 - 4, w: 200, h: 100 }, W, H, lines, 8);
  near(centred.box.x, W / 2 - 100);
  near(centred.box.y, H / 2 - 50);
});

test('scaleAbout keeps the aspect ratio and stays inside', () => {
  const box = { x: 1500, y: 800, w: 320, h: 180 };
  const r = G.scaleAbout(box, 3, 1660, 890, W, H, 40);
  near(r.w / r.h, 16 / 9);
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 1e-9 && r.y + r.h <= H + 1e-9);
  const tiny = G.scaleAbout(box, 0.01, 1660, 890, W, H, 64);
  near(tiny.w, 64);
});

test('toSquare and withAspect keep the centre', () => {
  const sq = G.toSquare({ x: 100, y: 100, w: 400, h: 200 }, W, H);
  nearBox(sq, { x: 200, y: 100, w: 200, h: 200 });
  const wide = G.withAspect(sq, 16 / 9, W, H);
  near(wide.w * wide.h, 200 * 200, 1e-6);
  near(wide.x + wide.w / 2, 300);
  near(wide.y + wide.h / 2, 200);
});

test('placeAt puts the box in the right corner with the safe margin', () => {
  const m = G.safeMargin(W, H);
  const box = { x: 0, y: 0, w: 400, h: 225 };
  nearBox(G.placeAt(box, 'br', W, H), { x: W - m - 400, y: H - m - 225, w: 400, h: 225 });
  nearBox(G.placeAt(box, 'tl', W, H), { x: m, y: m, w: 400, h: 225 });
  nearBox(G.placeAt(box, 'mc', W, H), { x: (W - 400) / 2, y: (H - 225) / 2, w: 400, h: 225 });
});

test('defaultBox limits tall cameras', () => {
  const wide = G.defaultBox(16 / 9, W, H);
  near(wide.w, W * 0.26);
  const tall = G.defaultBox(9 / 16, W, H);
  near(tall.h, H * 0.42);
  near(tall.w / tall.h, 9 / 16);
});

test('coverSource crops the centre, containRect letterboxes', () => {
  const c = G.coverSource(1920, 1080, 300, 300);
  near(c.sw, 1080);
  near(c.sh, 1080);
  near(c.sx, 420);
  near(c.sy, 0);
  const r = G.containRect(1920, 1200, 1920, 1080);
  near(r.h, 1080);
  near(r.w, 1728);
  near(r.x, 96);
});

test('outputSize scales by the shorter side, never upscales and stays even', () => {
  assert.deepEqual(G.outputSize(1920, 1080, 720), { width: 1280, height: 720 });
  assert.deepEqual(G.outputSize(1920, 1080, 1440), { width: 1920, height: 1080 });
  assert.deepEqual(G.outputSize(2560, 1600, 1080), { width: 1728, height: 1080 });
  assert.deepEqual(G.outputSize(1170, 2532, 720), { width: 720, height: 1558 });
  assert.deepEqual(G.outputSize(1367, 769, null), { width: 1368, height: 770 });
});
