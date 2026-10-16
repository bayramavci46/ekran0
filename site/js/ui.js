/*
 * Reusable interface pieces: segmented control, popover, drawer, toast and accordion.
 * They share the same motion tokens (see site.css) and keyboard behaviour.
 */
(function (root) {
  'use strict';
  const KM = root.KM;

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
    return { open, close };
  };

  /** Short confirmation message in the corner of the screen. */
  KM.toast = (text) => {
    const host = KM.$('#toasts');
    if (!host) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = '<svg class="i i-sm" aria-hidden="true"><use href="#i-check"/></svg>';
    const span = document.createElement('span');
    span.textContent = text;
    t.appendChild(span);
    host.appendChild(t);
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 240);
    }, 3200);
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
