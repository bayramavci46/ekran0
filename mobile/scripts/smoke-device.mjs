#!/usr/bin/env node
/*
 * Starts a test build of the app (copy-app.mjs --smoke) on an Android emulator or an iOS
 * simulator, reads the in-app check's results (smoke/smoke.js) from the app's log and fails
 * unless every check passes. The CI workflow runs it; locally it needs a running emulator
 * (adb) or Xcode's simulators.
 *
 *   node scripts/smoke-device.mjs android android/app/build/outputs/apk/debug/app-debug.apk
 *   node scripts/smoke-device.mjs ios build/sim/Build/Products/Debug-iphonesimulator/App.app
 *
 * A screenshot of the app is saved as smoke-<platform>.png and, made small, printed to the log
 * between KURGU_SCREENSHOT markers (a base64 JPEG), so it can be looked at without downloading.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const APP_ID = 'io.github.bayramavci46.kurgumasasi';
const TIMEOUT = 8 * 60 * 1000;
const [platform, appPath] = process.argv.slice(2);
if (!['android', 'ios'].includes(platform) || !appPath || !existsSync(appPath)) {
  console.error('Kullanım: node scripts/smoke-device.mjs android|ios <apk ya da .app>');
  process.exit(2);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

let device = null;
let log;
if (platform === 'android') {
  run('adb', ['wait-for-device']);
  run('adb', ['install', '-r', appPath], { stdio: 'inherit' });
  run('adb', ['logcat', '-c']);
  // Only the page's console (Capacitor writes it with this tag), as plain messages.
  log = spawn('adb', ['logcat', '-v', 'brief', 'Capacitor/Console:V', '*:S']);
  run('adb', ['shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`], { stdio: 'inherit' });
} else {
  // The newest iPhone the installed Xcode has.
  const list = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).devices;
  const phones = Object.entries(list)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([runtime, devices]) => devices.filter((d) => d.name.startsWith('iPhone')).map((d) => ({ ...d, runtime })))
    .sort((a, b) => a.runtime.localeCompare(b.runtime, 'en', { numeric: true }));
  if (!phones.length) throw new Error('no iPhone simulator');
  device = phones[phones.length - 1];
  console.log(`Simulator: ${device.name} (${device.runtime.split('.').pop()})`);
  if (device.state !== 'Booted') run('xcrun', ['simctl', 'boot', device.udid], { stdio: 'inherit' });
  run('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { stdio: 'inherit' });
  run('xcrun', ['simctl', 'install', device.udid, appPath], { stdio: 'inherit' });
  // The app's own output: Capacitor prints the page's console there in debug builds.
  log = spawn('xcrun', ['simctl', 'launch', '--console-pty', '--terminate-running-process', device.udid, APP_ID]);
}

const checks = [];
const consoleErrors = [];
let done = null;
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), TIMEOUT);
  let rest = '';
  const onData = (chunk) => {
    rest += chunk.toString();
    const lines = rest.split(/\r?\n/);
    rest = lines.pop();
    for (const line of lines) {
      const at = line.indexOf('KURGU_SMOKE_');
      if (at >= 0) {
        const [tag, ...json] = line.slice(at).split(' ');
        const data = JSON.parse(json.join(' '));
        if (tag === 'KURGU_SMOKE_CHECK') checks.push(data);
        if (tag === 'KURGU_SMOKE_DONE') {
          done = data;
          clearTimeout(timer);
          resolve('done');
        }
      } else if (/^E\/Capacitor\/Console|\[error\]/.test(line)) {
        consoleErrors.push(line.replace(/^.*?Msg: |^.*?\[error\] - /, ''));
      }
    }
  };
  log.stdout.on('data', onData);
  log.stderr.on('data', onData);
});

// A picture of the app as the check left it.
const shot = `smoke-${platform}.png`;
try {
  if (platform === 'android') writeFileSync(shot, execFileSync('adb', ['exec-out', 'screencap', '-p']));
  else run('xcrun', ['simctl', 'io', device.udid, 'screenshot', shot]);
  const small = `smoke-${platform}-small.jpg`;
  if (platform === 'ios') run('sips', ['-Z', '420', '-s', 'format', 'jpeg', '-s', 'formatOptions', '55', shot, '--out', small]);
  else run('convert', [shot, '-resize', '420x420>', '-quality', '55', small]);
  console.log(`KURGU_SCREENSHOT_BEGIN ${readFileSync(small).toString('base64')} KURGU_SCREENSHOT_END`);
} catch (err) {
  console.log(`No screenshot: ${err.message}`);
}
log.kill();
if (platform === 'ios') {
  try {
    run('xcrun', ['simctl', 'terminate', device.udid, APP_ID]);
  } catch {
    // Already closed.
  }
}

console.log(`\n${platform} · ${result === 'timeout' ? 'no result in time' : 'finished'}`);
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.info === null ? '' : ` · ${JSON.stringify(c.info)}`}`);
for (const e of consoleErrors) console.log(`FAIL console error · ${e}`);
const ok = result === 'done' && done.ok && checks.length > 0 && consoleErrors.length === 0;
console.log(ok ? '\nAll checks passed' : '\nSmoke test failed');
process.exit(ok ? 0 : 1);
