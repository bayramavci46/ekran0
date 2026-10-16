/*
 * Puts the editor into an app folder: the same files the website serves, plus
 *  - the fonts, bundled from @fontsource (SIL Open Font License), so the app needs no internet,
 *  - a Content-Security-Policy that only lets the page use its own files and the videos you open.
 * desktop/scripts/copy-app.mjs (Electron) and mobile/scripts/copy-app.mjs (Capacitor) use it.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const FONTS = [
  ['barlow', [400, 500, 600]],
  ['barlow-condensed', [500, 600]],
  ['jetbrains-mono', [400, 500]],
];
// Turkish needs both: ı is in "latin", ğ ş İ are in "latin-ext".
const SUBSETS = /-(latin|latin-ext)-\d+-normal$/;

export const CSP = [
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

/**
 * @param {object} o
 * @param {string} o.out folder to (re)create
 * @param {string} o.fonts the node_modules folder that holds @fontsource
 * @param {(html: string) => string} [o.page] last changes to editor.html
 * @param {string} [o.name] the page's file name in the app (Capacitor starts from index.html)
 * @param {Object<string, string>} [o.extra] more folders or files to copy in, by their place in the app
 */
export function bundleApp({ out, fonts, page, name = 'editor.html', extra = {} }) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'fonts'), { recursive: true });
  for (const dir of ['css', 'js', 'vendor']) cpSync(join(repo, dir), join(out, dir), { recursive: true });

  let fontsCss = '/* Fonts bundled with the app (SIL Open Font License, see ../fonts). */\n';
  for (const [pkg, weights] of FONTS) {
    const base = join(fonts, '@fontsource', pkg);
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

  let html = readFileSync(join(repo, 'editor.html'), 'utf8');
  const replace = (pattern, replacement) => {
    if (!pattern.test(html)) throw new Error(`editor.html: ${pattern} not found`);
    html = html.replace(pattern, replacement);
  };
  // The installable website's manifest and service worker have no use in an app.
  replace(/\s*<!-- Installable app[\s\S]*?<!-- \/installable -->/, '');
  replace(/\s*<script src="js\/offline\.js"><\/script>/, '');
  replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/, '');
  replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/, '');
  replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]+">/, '<link rel="stylesheet" href="css/fonts.css">');
  replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
  if (page) html = page(html);
  if (/(?:src|href)="https?:/.test(html)) throw new Error('editor.html still loads something from the internet');
  writeFileSync(join(out, name), html);
  for (const [to, from] of Object.entries(extra)) cpSync(from, join(out, to), { recursive: true });

  // Everything the page refers to must be in the app.
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (!existsSync(join(out, ref))) throw new Error(`missing in the app: ${ref}`);
  }
  return html;
}
