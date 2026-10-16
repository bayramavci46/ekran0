/*
 * The editor inside the iPhone, iPad and Android app (mobile/, Capacitor). Elsewhere it does
 * nothing. In the app it marks the page with data-native, hands finished videos to the system's
 * share sheet (Save Video, Files, Drive…), and lets Android's back button close panels first.
 */
(function (root) {
  'use strict';
  const PE = root.PipEditor;
  const cap = root.Capacitor;
  const platform = cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() ? cap.getPlatform() : null;

  if (!platform) {
    PE.native = null;
    return;
  }
  document.documentElement.dataset.native = platform;
  const { App, Filesystem, Share } = cap.Plugins;
  const FOLDER = 'paylas';
  const CHUNK = 3 * 1024 * 1024;

  /** A part of a file as base64, the way plugin calls carry data. */
  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        resolve(url.slice(url.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Copies the file into the app's cache, where other apps can be given it.
   * @param {Blob} blob
   * @param {string} name
   * @param {(fraction: number) => void} [onProgress]
   * @returns {Promise<string>} the copy's file:// address
   */
  async function save(blob, name, onProgress) {
    const path = `${FOLDER}/${name}`;
    // Only one file waits to be shared at a time.
    const { files } = await Filesystem.readdir({ path: '', directory: 'CACHE' });
    if (files.some((f) => f.name === FOLDER)) await Filesystem.rmdir({ path: FOLDER, directory: 'CACHE', recursive: true });
    let at = 0;
    do {
      const data = await base64(blob.slice(at, at + CHUNK));
      if (at === 0) await Filesystem.writeFile({ path, data, directory: 'CACHE', recursive: true });
      else await Filesystem.appendFile({ path, data, directory: 'CACHE' });
      at += CHUNK;
      if (onProgress) onProgress(Math.min(1, at / Math.max(1, blob.size)));
    } while (at < blob.size);
    return (await Filesystem.getUri({ path, directory: 'CACHE' })).uri;
  }

  /**
   * Opens the share sheet for the file (Save Video, Files, Drive…).
   * @param {Blob} blob
   * @param {string} name
   * @param {(fraction: number) => void} [onProgress] while copying
   * @returns {Promise<boolean>} false when the sheet was closed without choosing anything
   */
  async function share(blob, name, onProgress) {
    const uri = await save(blob, name, onProgress);
    try {
      await Share.share({ title: name, files: [uri], dialogTitle: 'Videoyu kaydet ya da paylaş' });
      return true;
    } catch (err) {
      if (/cancel/i.test(String(err && err.message))) return false;
      throw err;
    }
  }

  // Android's back button closes an open panel; on the editor itself it puts the app aside
  // (like Home), so an export keeps going and nothing is lost.
  if (platform === 'android' && App) {
    App.addListener('backButton', () => {
      const open = [...document.querySelectorAll('.drawer:not([hidden])')].pop();
      const close = open && open.querySelector('[data-drawer-close]');
      if (close) close.click();
      else App.minimizeApp();
    });
  }

  PE.native = { platform, save, share };
})(self);
