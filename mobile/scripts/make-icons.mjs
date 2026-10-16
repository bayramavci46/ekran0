#!/usr/bin/env node
/*
 * Draws the app icons and launch screens of the iOS and Android apps from the SVGs in
 * mobile/assets (which are made from desktop/build/icon.svg), and the icons of the installable
 * website (icons/). Run it after changing the icon; the PNGs it writes are kept in the
 * repository. Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright bulunamadı: npm i -g playwright && NODE_PATH="$(npm root -g)" node scripts/make-icons.mjs');
  process.exit(2);
}

const svg = (name) => readFileSync(join(mobile, 'assets', name), 'utf8');
const LIGHT = '#eef1f0';
const DARK = '#0c1112';

// ---- Drawing ----

const browser = await chromium.launch();
const page = await browser.newPage();

/** Renders HTML at size × size pixels; `opaque` gives a PNG without an alpha channel. */
async function draw(file, size, body, { opaque = false, background = 'transparent' } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${background};overflow:hidden}
    svg{display:block;width:100%;height:100%}</style>${body}`);
  const png = await page.screenshot({ omitBackground: !opaque });
  // The App Store refuses icons with an alpha channel; on an opaque page Chromium writes plain RGB.
  if (opaque && png[25] !== 2) throw new Error(`${file}: expected an RGB PNG, got colour type ${png[25]}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
}

const ios = join(mobile, 'ios', 'App', 'App', 'Assets.xcassets');
await draw(join(ios, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), 1024, svg('icon-ios.svg'), { opaque: true, background: DARK });

// Launch screen: the icon on the page colour, light and dark (the storyboard fills the screen with it).
for (const [name, color] of [['splash-light.png', LIGHT], ['splash-dark.png', DARK]]) {
  const tile = `<div style="position:absolute;left:50%;top:50%;width:380px;height:380px;margin:-190px 0 0 -190px;border-radius:86px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.25)">${svg('icon-ios.svg')}</div>`;
  await draw(join(ios, 'Splash.imageset', name), 2732, tile, { opaque: true, background: color });
}

const res = join(mobile, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, scale] of Object.entries(DENSITIES)) {
  const dir = join(res, `mipmap-${d}`);
  const layer = Math.round(108 * scale);
  await draw(join(dir, 'ic_launcher_foreground.png'), layer, svg('icon-android-foreground.svg'));
  await draw(join(dir, 'ic_launcher_background.png'), layer, svg('icon-android-background.svg'), { opaque: true });
  // Before Android 8 there are no adaptive icons: a rounded square and a circle.
  const legacy = Math.round(48 * scale);
  const both = `<div style="position:absolute;inset:0">${svg('icon-android-background.svg')}</div><div style="position:absolute;inset:0">${svg('icon-android-foreground.svg')}</div>`;
  await draw(join(dir, 'ic_launcher.png'), legacy, `<div style="position:absolute;inset:4%;border-radius:18%;overflow:hidden">${both}</div>`);
  await draw(join(dir, 'ic_launcher_round.png'), legacy, `<div style="position:absolute;inset:4%;border-radius:50%;overflow:hidden">${both}</div>`);
}
// The installable website (manifest.webmanifest): the desktop icon's tile, a full-bleed one for
// launchers that cut their own shape, and the one iOS puts on the home screen.
const web = join(mobile, '..', 'icons');
const tile = readFileSync(join(mobile, '..', 'desktop', 'build', 'icon.svg'), 'utf8');
await draw(join(web, 'icon-192.png'), 192, tile);
await draw(join(web, 'icon-512.png'), 512, tile);
await draw(join(web, 'icon-maskable-512.png'), 512, `<div style="position:absolute;inset:0">${svg('icon-android-background.svg')}</div><div style="position:absolute;inset:0">${svg('icon-android-foreground.svg')}</div>`, { opaque: true });
await draw(join(web, 'apple-touch-icon.png'), 180, svg('icon-ios.svg'), { opaque: true, background: DARK });

await browser.close();
console.log('icons written');
