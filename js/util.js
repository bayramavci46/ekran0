/*
 * Small formatting helpers shared by the editor UI.
 * Loaded as a classic script in the browser (window.PipEditor.util) and with require() in tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.PipEditor = root.PipEditor || {}).util = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = (n, len = 2) => String(Math.floor(n)).padStart(len, '0');
  const MINUS = '−';

  function decimal(value, digits) {
    return value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /** SMPTE-style timecode HH:MM:SS:FF at an integer frame rate. */
  function timecode(sec, fps) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const total = Math.round(sec * fps);
    const frames = total % fps;
    const s = Math.floor(total / fps);
    return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}:${pad(frames)}`;
  }

  /** Short clock label for rulers: 0:05, 1:30, 1:02:03. */
  function clock(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  /** Readable duration in Turkish: "45 sn", "3 dk 05 sn", "1 sa 02 dk". */
  function duration(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    if (sec < 10) return `${decimal(sec, 1)} sn`;
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h} sa ${pad(m)} dk`;
    if (m > 0) return `${m} dk ${pad(s % 60)} sn`;
    return `${s} sn`;
  }

  /** Signed seconds with a real minus sign: "+1,25 sn", "−0,40 sn". */
  function signedSeconds(sec, digits = 2) {
    const v = Math.abs(sec) < 0.5 * Math.pow(10, -digits) ? 0 : sec;
    const sign = v > 0 ? '+' : v < 0 ? MINUS : '±';
    return `${sign}${decimal(Math.abs(v), digits)} sn`;
  }

  function bytes(n) {
    if (!Number.isFinite(n) || n < 0) n = 0;
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${i === 0 ? Math.round(n) : decimal(n, n < 10 ? 1 : 0)} ${units[i]}`;
  }

  /** Turkish puts the percent sign first: %28. */
  function percent(fraction) {
    return `%${Math.round(fraction * 100)}`;
  }

  /** "video-2026-10-15-1530.mp4" */
  function exportFileName(ext, date = new Date()) {
    const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return `ekran-kamera-${d}-${pad(date.getHours())}${pad(date.getMinutes())}.${ext}`;
  }

  return { clamp, timecode, clock, duration, signedSeconds, bytes, percent, decimal, exportFileName };
});
