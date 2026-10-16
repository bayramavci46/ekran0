/*
 * Shared interface kit for the website and the editor: small helpers and the components that go
 * with css/base.css (segmented control, popover, drawer, toast, accordion). Everything lives on
 * window.KM. Formatting comes from js/util.js so both pages write numbers and times the same way.
 */
(function (root) {
  'use strict';
  const KM = (root.KM = root.KM || {});
  const U = root.PipEditor.util;

  // ---- Helpers ---------------------------------------------------------------

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

  /** True while the user is typing into a form field (keyboard shortcuts stay out of the way). */
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

  // ---- Components --------------------------------------------------------------

  /** Radio-style segmented control with a sliding thumb. */
  KM.segmented = (el, onChange) => {
    const buttons = KM.$$('button[role="radio"]', el);
    const thumb = KM.$('.seg-thumb', el);
    const place = () => {
      const active = buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0];
      if (!thumb || !active) return;
      thumb.style.setProperty('--x', `${active.offsetLeft}px`);
      thumb.style.setProperty('--w', `${active.offsetWidth}px`);
    };
    const select = (button, notify) => {
      for (const b of buttons) {
        const on = b === button;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      place();
      if (notify && onChange) onChange(button.dataset.value);
    };
    buttons.forEach((b) => {
      b.addEventListener('click', () => select(b, true));
      b.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const next = buttons[(buttons.indexOf(b) + dir + buttons.length) % buttons.length];
        select(next, true);
        next.focus();
      });
    });
    select(buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0], false);
    if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(el);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    return {
      set(value) {
        const b = buttons.find((x) => x.dataset.value === value);
        if (b) select(b, false);
      },
    };
  };

  /** Disclosure popover anchored to its trigger; closes on Escape or an outside click. */
  KM.popover = (trigger, panel) => {
    let open = false;
    const close = (focusTrigger) => {
      if (!open) return;
      open = false;
      trigger.setAttribute('aria-expanded', 'false');
      panel.classList.add('is-leaving');
      setTimeout(() => {
        panel.hidden = true;
        panel.classList.remove('is-leaving');
      }, 140);
      if (focusTrigger) trigger.focus();
    };
    const show = () => {
      open = true;
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    };
    trigger.addEventListener('click', () => (open ? close(false) : show()));
    document.addEventListener('pointerdown', (e) => {
      if (open && !panel.contains(e.target) && !trigger.contains(e.target)) close(false);
    });
    document.addEventListener('keydown', (e) => {
      if (open && e.key === 'Escape') close(true);
    });
    return { close };
  };

  /** Side panel dialog with focus trap; keeps the page visible behind it. */
  KM.drawer = (el) => {
    const panel = KM.$('.drawer-panel', el);
    let returnTo = null;
    const focusables = () => KM.$$('button, a[href], [tabindex="0"]', panel);
    const close = () => {
      if (el.hidden || el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      setTimeout(() => {
        el.hidden = true;
        el.classList.remove('is-leaving');
        document.documentElement.style.overflow = '';
        if (returnTo) returnTo.focus();
      }, 230);
    };
    const open = (from) => {
      returnTo = from || document.activeElement;
      el.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      panel.focus();
    };
    KM.$$('[data-drawer-close]', el).forEach((b) => b.addEventListener('click', close));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    return { open, close, get isOpen() { return !el.hidden; } };
  };

  const TOAST_ICONS = {
    check: '<svg class="i i-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="i i-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5V13M12 16.4v.1M10.3 4 2.7 17.2A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.8L13.7 4a2 2 0 0 0-3.4 0z"/></svg>',
  };

  /**
   * Short message in the corner of the screen. `options.action` ({label, onClick}) adds a button,
   * and the message then stays longer; `options.tone: 'warn'` shows a warning sign instead of a tick.
   */
  KM.toast = (text, options) => {
    const o = options || {};
    const host = KM.$('#toasts');
    if (!host) return null;
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = TOAST_ICONS[o.tone === 'warn' ? 'warn' : 'check'];
    const span = document.createElement('span');
    span.textContent = text;
    t.appendChild(span);
    let timer = 0;
    const close = () => {
      if (t.classList.contains('is-leaving')) return;
      clearTimeout(timer);
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 240);
    };
    if (o.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.textContent = o.action.label;
      b.addEventListener('click', () => {
        close();
        o.action.onClick();
      });
      t.appendChild(b);
      t.classList.add('has-action');
    }
    host.appendChild(t);
    // A message with a button waits while the pointer or the keyboard focus is on it.
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(close, o.action ? 7000 : 3200);
    };
    t.addEventListener('pointerenter', () => clearTimeout(timer));
    t.addEventListener('pointerleave', arm);
    t.addEventListener('focusin', () => clearTimeout(timer));
    t.addEventListener('focusout', arm);
    arm();
    return { close };
  };

  /** Accordion whose panels slide open; collapsed panels are hidden from assistive tech. */
  KM.accordion = (el) => {
    KM.$$('.acc-btn', el).forEach((btn) => {
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      let timer = 0;
      btn.addEventListener('click', () => {
        const opening = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(opening));
        clearTimeout(timer);
        if (opening) {
          panel.hidden = false;
          // Let the 0fr state paint once so the height can animate.
          requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('is-open')));
        } else {
          panel.classList.remove('is-open');
          timer = setTimeout(() => { panel.hidden = true; }, 430);
        }
      });
    });
  };
})(self);
