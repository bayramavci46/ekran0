#!/usr/bin/env node
/*
 * Starts the packaged app from desktop/dist with --smoke-test (see main.js and smoke-renderer.js)
 * and fails unless every check passes. The release workflow runs it on Windows and macOS.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function findApp() {
  const dirs = existsSync(dist) ? readdirSync(dist) : [];
  if (process.platform === 'win32') {
    const dir = join(dist, 'win-unpacked');
    const exe = existsSync(dir) && readdirSync(dir).find((f) => /^KurguMasasi\.exe$/i.test(f));
    return exe ? join(dir, exe) : null;
  }
  if (process.platform === 'darwin') {
    for (const d of dirs.filter((x) => x.startsWith('mac'))) {
      const bundle = readdirSync(join(dist, d)).find((f) => f.endsWith('.app'));
      if (!bundle) continue;
      const macos = join(dist, d, bundle, 'Contents', 'MacOS');
      const [exe] = readdirSync(macos);
      if (exe) return join(macos, exe);
    }
    return null;
  }
  const dir = join(dist, 'linux-unpacked');
  const exe = existsSync(dir) && readdirSync(dir).find((f) => /^kurgumasasi$/i.test(f));
  return exe ? join(dir, exe) : null;
}

const app = findApp();
if (!app) {
  console.error(`No packaged app found in ${dist}; run "npm run dist" first.`);
  process.exit(2);
}
const out = join(tmpdir(), `kurgu-smoke-${process.pid}.json`);
console.log(`Starting ${app}`);
const args = ['--smoke-test', `--smoke-out=${out}`];
// Chromium refuses to start its sandbox as root (CI containers on Linux).
if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
const child = spawn(app, args, { stdio: ['ignore', 'inherit', 'inherit'] });
const timer = setTimeout(() => {
  console.error('Smoke test timed out');
  child.kill();
}, 240000);
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)));
clearTimeout(timer);

const result = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
if (!result) {
  console.error(`The app exited with ${code} and wrote no result.`);
  process.exit(1);
}
console.log(`\n${result.platform || process.platform} · Electron ${result.electron || '?'}`);
for (const c of result.checks || []) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.info === null ? '' : ` · ${JSON.stringify(c.info)}`}`);
}
for (const e of result.consoleErrors || []) console.log(`FAIL console error · ${e}`);
if (result.error) console.log(`FAIL ${result.error}`);
const ok = code === 0 && result.ok;
console.log(ok ? '\nAll checks passed' : '\nSmoke test failed');
process.exit(ok ? 0 : 1);
