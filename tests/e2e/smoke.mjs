#!/usr/bin/env node
/*
 * End-to-end check in a real browser: loads two generated recordings, moves and
 * resizes the camera window, sets the sync offset and the in/out points, exports,
 * and inspects the resulting file with ffprobe.
 *
 * Needs ffmpeg/ffprobe on PATH and Playwright with Chromium
 * (npm i -D playwright && npx playwright install chromium, or a global install via
 * NODE_PATH="$(npm root -g)").
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'tests', 'e2e', 'output');
mkdirSync(outDir, { recursive: true });

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright bulunamadı: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'stream=codec_type,width,height:format=duration', '-of', 'json', file]).toString());

// VP9/Opus in WebM plays in every Chromium build, including ones without H.264.
const screenFile = join(outDir, 'screen.webm');
const cameraFile = join(outDir, 'camera.webm');
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
  '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus', screenFile]);
ffmpeg(['-f', 'lavfi', '-i', 'smptebars=size=640x480:rate=25:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=5',
  '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '600k', '-c:a', 'libopus', cameraFile]);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm' };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}/editor.html`;

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(url);

  const loaded = (slot) => page.waitForFunction((s) => {
    const m = PipEditor.app.state.media[s];
    return m && m.analysis !== undefined;
  }, slot, { timeout: 20000 });
  await page.setInputFiles('#fileScreen', screenFile);
  await loaded('screen');
  await page.setInputFiles('#fileCamera', cameraFile);
  await loaded('camera');

  const box = await page.locator('#camBox').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y - 200, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate(() => PipEditor.app.state.look.box);
  check(moved.x < 0.5 && moved.y < 0.5, 'camera window moves with the mouse');

  await page.locator('#camBox').hover();
  const se = await page.locator('#camBox .handle[data-h="se"]').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + 120, se.y + 60, { steps: 6 });
  await page.mouse.up();
  const resized = await page.evaluate(() => PipEditor.app.state.look.box);
  check(resized.w > moved.w, 'corner handle enlarges the camera window');
  check(Math.abs((resized.w * 1280) / (resized.h * 720) - 4 / 3) < 0.01, 'corner resize keeps the 4:3 camera shape');

  await page.click('[data-nudge="1"]');
  await page.evaluate(() => PipEditor.app.player.seek(0.5));
  await page.keyboard.press('i');
  await page.evaluate(() => PipEditor.app.player.seek(5.5));
  await page.keyboard.press('o');
  const edit = await page.evaluate(() => ({ offset: PipEditor.app.state.offset, trim: PipEditor.app.state.trim }));
  check(edit.offset === 1, 'offset buttons shift the camera by one second');
  check(Math.abs(edit.trim.start - 0.5) < 0.05 && Math.abs(edit.trim.end - 5.5) < 0.05, 'I and O set the in and out points');

  await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, null, { timeout: 15000 });
  await page.click('#exportBtn');
  await page.waitForFunction(() => !document.getElementById('exportResult').hidden || !document.getElementById('exportError').hidden,
    null, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const r = PipEditor.app.state.result;
    if (!r) return { error: document.getElementById('exportError').textContent };
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { name: r.name, b64: btoa(bin) };
  });
  check(!result.error, `export finishes${result.error ? `: ${result.error}` : ''}`);
  if (!result.error) {
    const file = join(outDir, result.name);
    writeFileSync(file, Buffer.from(result.b64, 'base64'));
    const info = probe(file);
    const types = info.streams.map((s) => s.codec_type).sort().join(',');
    check(types === 'audio,video', `output has one video and one audio stream (${types})`);
    check(Math.abs(Number(info.format.duration) - 5) < 0.15, `output lasts the selected 5 s (${info.format.duration} s)`);
    console.log(`     ${file}`);
  }
  check(errors.length === 0, `no errors in the console${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
