/*
 * Registers the service worker (sw.js) that lets the site open without internet and be
 * installed as an app. Only where the site is served over https (or from this computer): not in
 * the desktop or phone apps, which carry their own files, and not inside another page's frame.
 */
(function () {
  'use strict';
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || window.Capacitor || window.self !== window.top) return;
  if (location.protocol !== 'https:' && !local) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
})();
