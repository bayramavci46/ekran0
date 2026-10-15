#!/usr/bin/env node
/*
 * Bundles index.html with its stylesheet and scripts into one self-contained HTML file
 * that can be copied anywhere and opened without a server or an internet connection.
 *
 *   node scripts/build-single-file.mjs          → dist/ekran-kamera-kurgu.html (Mediabunny inlined)
 *   node scripts/build-single-file.mjs --cdn    → loads Mediabunny from jsDelivr instead (smaller file)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const useCdn = process.argv.includes('--cdn');
const MEDIABUNNY_CDN = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';

const read = (file) => readFileSync(join(root, file), 'utf8');
const inlineScript = (file) => {
  const code = read(file);
  if (/<\/script/i.test(code)) throw new Error(`${file} contains "</script" and cannot be inlined`);
  return `<script>\n${code}</script>`;
};

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, href) => `<style>\n${read(href)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  if (src.startsWith('vendor/mediabunny') && useCdn) {
    return `<script>window.PIP_MEDIABUNNY_URL = '${MEDIABUNNY_CDN}';</script>`;
  }
  return inlineScript(src);
});

const outFile = join(root, 'dist', 'ekran-kamera-kurgu.html');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`${outFile} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
