#!/usr/bin/env node
/*
 * Puts the editor into desktop/app for packaging (see scripts/bundle-app.mjs): the same files the
 * website serves, with the fonts bundled and a Content-Security-Policy.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleApp } from '../../scripts/bundle-app.mjs';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(desktop, 'app');
bundleApp({ out, fonts: join(desktop, 'node_modules') });
console.log(`${out} ready`);
