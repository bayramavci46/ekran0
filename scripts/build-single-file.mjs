#!/usr/bin/env node
/*
 * Bundles a page with its stylesheets and scripts into one self-contained HTML file
 * that can be copied anywhere and opened without a server or an internet connection.
 *
 *   node scripts/build-single-file.mjs                → dist/ekran-kamera-kurgu.html (the editor)
 *   node scripts/build-single-file.mjs index.html     → dist/kurgu-masasi-site.html (the website)
 *   add --cdn to load Mediabunny from jsDelivr instead of inlining it (smaller file)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const useCdn = args.includes('--cdn');
const page = args.find((a) => a.endsWith('.html')) || 'editor.html';
const OUTPUTS = { 'editor.html': 'ekran-kamera-kurgu.html', 'index.html': 'kurgu-masasi-site.html' };
const MEDIABUNNY_CDN = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';

const read = (file) => readFileSync(join(root, file), 'utf8');
const inlineScript = (file) => {
  const code = read(file);
  if (/<\/script/i.test(code)) throw new Error(`${file} contains "</script" and cannot be inlined`);
  return `<script>\n${code}</script>`;
};

let html = read(page);
// One self-contained file has nothing to install or keep offline: no manifest, no service worker.
html = html.replace(/\s*<!-- Installable app[\s\S]*?<!-- \/installable -->/, '');
html = html.replace(/\s*<script src="js\/offline\.js"><\/script>/, '');
html = html.replace(/<link rel="stylesheet" href="((?:css|site)\/[^"]+)">/g, (_, href) => `<style>\n${read(href)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  if (src.startsWith('vendor/mediabunny') && useCdn) {
    return `<script>window.PIP_MEDIABUNNY_URL = '${MEDIABUNNY_CDN}';</script>`;
  }
  return inlineScript(src);
});

const outFile = join(root, 'dist', OUTPUTS[page] || page);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`${outFile} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
