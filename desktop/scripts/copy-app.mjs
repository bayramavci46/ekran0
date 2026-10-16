#!/usr/bin/env node
/*
 * Puts the editor into desktop/app for packaging: the same files the website serves, plus
 *  - the fonts, bundled from @fontsource (SIL Open Font License), so the app needs no internet,
 *  - a Content-Security-Policy that only lets the page use its own files and the videos you open.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(desktop, '..');
const out = join(desktop, 'app');

const FONTS = [
  ['barlow', [400, 500, 600]],
  ['barlow-condensed', [500, 600]],
  ['jetbrains-mono', [400, 500]],
];
// Turkish needs both: ı is in "latin", ğ ş İ are in "latin-ext".
const SUBSETS = /-(latin|latin-ext)-\d+-normal$/;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const dir of ['css', 'js', 'vendor']) cpSync(join(repo, dir), join(out, dir), { recursive: true });

// ---- Fonts ----

let fontsCss = '/* Fonts bundled with the desktop app (SIL Open Font License, see ../fonts). */\n';
for (const [pkg, weights] of FONTS) {
  const base = join(desktop, 'node_modules', '@fontsource', pkg);
  for (const weight of weights) {
    const css = readFileSync(join(base, `${weight}.css`), 'utf8');
    for (const [, name, body] of css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g)) {
      if (!SUBSETS.test(name)) continue;
      copyFileSync(join(base, 'files', `${name}.woff2`), join(out, 'fonts', `${name}.woff2`));
      const face = body.replace(/src:[^;]+;/, `src: url(../fonts/${name}.woff2) format('woff2');`);
      fontsCss += `\n@font-face {${face}}\n`;
    }
  }
  copyFileSync(join(base, 'LICENSE'), join(out, 'fonts', `LICENSE-${pkg}.txt`));
}
writeFileSync(join(out, 'css', 'fonts.css'), fontsCss);

// ---- Page ----

let html = readFileSync(join(repo, 'editor.html'), 'utf8');
const replace = (pattern, replacement) => {
  if (!pattern.test(html)) throw new Error(`editor.html: ${pattern} not found`);
  html = html.replace(pattern, replacement);
};
replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/, '');
replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/, '');
replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]+">/, '<link rel="stylesheet" href="css/fonts.css">');
replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
if (/(?:src|href)="https?:/.test(html)) throw new Error('editor.html still loads something from the internet');
writeFileSync(join(out, 'editor.html'), html);

// Everything the page refers to must be in the app.
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  if (!existsSync(join(out, ref))) throw new Error(`missing in the app: ${ref}`);
}
console.log(`${out} ready`);
