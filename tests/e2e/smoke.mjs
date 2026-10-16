#!/usr/bin/env node
/*
 * End-to-end check in a real browser: loads two generated recordings that hear the same
 * sound, checks that the automatic sync finds how far apart they started, moves and
 * resizes the camera window, nudges the offset, undoes, swaps the recordings, sets the
 * in/out points, exports, and inspects the resulting file with ffprobe. Then it records
 * Chromium's fake screen, camera and microphone with the editor's own recorder, with a
 * pause, and checks that both files arrive in the editor aligned.
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

// One "room" sound heard by both recordings: noise bursts that switch on and off irregularly,
// like speech. The camera started CAMERA_LATE seconds after the screen recording and hears it
// through a duller microphone, more quietly and with more noise.
const CAMERA_LATE = 1.25;
const room = 'aevalsrc=exprs=0.6*(random(0)-0.5)*gt(sin(2*PI*1.31*t)\\,0.25)*gt(sin(2*PI*0.53*t+1)\\,-0.3)'
  + '*gt(sin(2*PI*2.71*t+2)\\,-0.5):s=48000:d=20';
// VP9/Opus in WebM plays in every Chromium build, including ones without H.264.
const screenFile = join(outDir, 'screen.webm');
const cameraFile = join(outDir, 'camera.webm');
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', room,
  '-af', 'atrim=0:8', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus',
  '-t', '8', screenFile]);
ffmpeg(['-f', 'lavfi', '-i', 'smptebars=size=640x480:rate=25:duration=6', '-f', 'lavfi', '-i', room,
  '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.01:duration=20:seed=3',
  '-filter_complex', `[1:a]atrim=${CAMERA_LATE}:${CAMERA_LATE + 6},asetpts=PTS-STARTPTS,lowpass=f=3000,volume=0.5[v];[v][2:a]amix=inputs=2:duration=first:normalize=0[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '600k', '-c:a', 'libopus',
  '-t', '6', cameraFile]);

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

// Fake camera, microphone and screen, and their permission prompts answered with yes.
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
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
  const syncDone = () => page.waitForFunction(() => PipEditor.app.state.sync.status !== 'running', null, { timeout: 30000 });
  const offset = () => page.evaluate(() => PipEditor.app.state.offset);
  const syncChip = () => page.evaluate(() => document.getElementById('syncStatusText').textContent);
  await page.setInputFiles('#fileScreen', screenFile);
  await loaded('screen');
  await page.setInputFiles('#fileCamera', cameraFile);
  await loaded('camera');

  await syncDone();
  const sync = await page.evaluate(() => ({ status: PipEditor.app.state.sync.status, offset: PipEditor.app.state.offset }));
  check(sync.status === 'ok' && Math.abs(sync.offset - CAMERA_LATE) < 0.03,
    `automatic sync finds that the camera started ${CAMERA_LATE} s later (${sync.status}, ${sync.offset} s)`);
  check(await syncChip() === 'Eşleşti', 'the sync card reports the match');
  check(await page.locator('.toast', { hasText: 'Senkronlandı' }).count() === 1, 'a toast offers to undo the sync');
  const matched = await offset();

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
  check(Math.abs(await offset() - (matched + 1)) < 1e-6, 'offset buttons shift the camera by one second');
  check(await syncChip() === 'Elle ayarlandı', 'the sync card notices the hand-set offset');
  await page.click('#undoBtn');
  check(await offset() === matched, 'undo puts the camera back where the sync put it');

  await page.click('#swapBtn');
  await page.waitForFunction((o) => PipEditor.app.state.offset === -o, matched, { timeout: 20000 });
  check(true, 'swapping the recordings flips the offset');
  await page.click('#swapBtn');
  await page.waitForFunction((o) => PipEditor.app.state.offset === o, matched, { timeout: 20000 });

  await page.evaluate(() => PipEditor.app.player.seek(0.5));
  await page.keyboard.press('i');
  await page.evaluate(() => PipEditor.app.player.seek(5.5));
  await page.keyboard.press('o');
  const trim = await page.evaluate(() => PipEditor.app.state.trim);
  check(Math.abs(trim.start - 0.5) < 0.05 && Math.abs(trim.end - 5.5) < 0.05, 'I and O set the in and out points');

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

  // ---- Recording the screen and the camera in the editor ----
  await page.keyboard.press('r');
  await page.waitForFunction(() => !document.getElementById('recStart').disabled, null, { timeout: 15000 });
  check(await page.evaluate(() => !document.getElementById('recVideo').hidden), 'the recording panel shows the camera');
  await page.click('#recStart');
  await page.waitForFunction(() => document.getElementById('recStatusText').textContent === 'Kaydediliyor', null, { timeout: 15000 });
  check(await page.textContent('#exportBtn') === 'Kayıt sürüyor…', 'export waits while recording');
  await page.waitForTimeout(1500);
  await page.click('#recPause');
  check(await page.waitForFunction(() => document.title.startsWith('❚❚'), null, { timeout: 3000 }).then(() => true, () => false),
    'the tab title shows the pause');
  await page.waitForTimeout(1000);
  await page.click('#recPause');
  await page.waitForTimeout(1500);
  await page.click('#recStop');
  await page.waitForFunction(() => PipEditor.app.state.sync.status === 'recorded' && PipEditor.app.state.media.camera,
    null, { timeout: 30000 });
  await loaded('screen');
  await loaded('camera');
  const recorded = await page.evaluate(() => {
    const { media, offset } = PipEditor.app.state;
    const info = (m) => ({ name: m.name, duration: m.duration, video: !!(m.analysis && m.analysis.video), audio: !!(m.analysis && m.analysis.audio) });
    return { screen: info(media.screen), camera: info(media.camera), offset, chip: document.getElementById('syncStatusText').textContent };
  });
  check(/^ekran-kaydi-.*\.(mp4|webm)$/.test(recorded.screen.name) && /^kamera-kaydi-.*\.(mp4|webm)$/.test(recorded.camera.name),
    `both recordings are in the editor (${recorded.screen.name}, ${recorded.camera.name})`);
  // About 3 s were recorded around a 1 s pause; with the pause both would last about 4 s.
  check([recorded.screen, recorded.camera].every((m) => m.duration > 2.6 && m.duration < 3.6),
    `the pause is left out of both (${recorded.screen.duration} s, ${recorded.camera.duration} s)`);
  check(recorded.camera.audio && recorded.camera.video && recorded.screen.video, 'the microphone is in the camera recording');
  check(Math.abs(recorded.offset) < 0.3 && recorded.chip === 'Birlikte kaydedildi',
    `the camera is aligned by the shared clock (${recorded.offset} s, “${recorded.chip}”)`);
  check(await page.locator('#slotCamera [data-action="save"]').isVisible(), 'a recording made here can be downloaded');

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
