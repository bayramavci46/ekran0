#!/usr/bin/env node
/*
 * Puts the editor into mobile/www for Capacitor (see scripts/bundle-app.mjs): the same files the
 * website serves, with the fonts bundled and a Content-Security-Policy, as index.html.
 *
 * --smoke adds the in-app check (smoke/smoke.js) and its two test videos; the CI workflow builds
 * such an app, starts it in the Android emulator and the iOS simulator, and reads the result
 * from the app's log.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleApp } from '../../scripts/bundle-app.mjs';

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(mobile, 'www');
const smoke = process.argv.includes('--smoke');

bundleApp({
  out,
  fonts: join(mobile, 'node_modules'),
  name: 'index.html',
  page: (html) => (smoke ? html.replace('</body>', '<script src="smoke/smoke.js"></script>\n</body>') : html),
  extra: smoke ? { smoke: join(mobile, 'smoke') } : {},
});
console.log(`${out} ready${smoke ? ' (with the smoke test)' : ''}`);
