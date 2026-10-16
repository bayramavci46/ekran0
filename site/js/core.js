/*
 * Small shared helpers for the website. Everything lives on window.KM.
 * Formatting comes from the editor's own js/util.js so the site and the app agree.
 */
(function (root) {
  'use strict';
  const KM = (root.KM = root.KM || {});
  const U = root.PipEditor.util;

  KM.$ = (sel, ctx) => (ctx || document).querySelector(sel);
  KM.$$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  KM.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  KM.timecode = (sec) => U.timecode(sec, 30);
  KM.decimal = U.decimal;
  KM.duration = U.duration;
  KM.signed = (sec) => U.signedSeconds(sec, 2);

  const reduce = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  KM.reducedMotion = () => reduce.matches;

  /** Calls onChange(true/false) as the element enters or leaves the viewport. */
  KM.observe = (el, onChange, options) => {
    if (typeof IntersectionObserver !== 'function') {
      onChange(true);
      return () => {};
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) onChange(e.isIntersecting, e);
    }, options || { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  };

  /** True while the user is typing into a form field (keyboard demos stay out of the way). */
  KM.isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));

  /** Runs fn on the next animation frame, at most once per frame. */
  KM.rafThrottle = (fn) => {
    let queued = false;
    return (...args) => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn(...args);
      });
    };
  };
})(self);
