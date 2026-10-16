/*
 * Navigation: compacts after the first scroll, shows the page as a timeline (a playhead that
 * follows the reading position, with a timecode measured in reading time), marks the current
 * section and opens a menu sheet on small screens.
 */
(function (root) {
  'use strict';
  const KM = root.KM;

  KM.initNav = function () {
    const nav = KM.$('#nav');
    const track = KM.$('.nav-track', nav);
    const fill = KM.$('#navFill');
    const head = KM.$('#navHead');
    const tc = KM.$('#navTc');

    // The page's "duration": reading time at about 200 words a minute.
    const words = (KM.$('main').textContent || '').split(/\s+/).filter(Boolean).length;
    const total = Math.max(60, Math.round(words / 3.3));
    const endTc = KM.$('#endTc');
    if (endTc) endTc.textContent = KM.timecode(total);

    const update = () => {
      const max = document.documentElement.scrollHeight - root.innerHeight;
      const p = max > 0 ? KM.clamp(root.scrollY / max, 0, 1) : 0;
      nav.classList.toggle('is-scrolled', root.scrollY > 8);
      fill.style.setProperty('--p', p.toFixed(4));
      head.style.setProperty('--p', p.toFixed(4));
      tc.textContent = KM.timecode(p * total);
    };
    const measure = () => head.style.setProperty('--track-w', `${track.clientWidth}px`);
    const onScroll = KM.rafThrottle(update);
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('resize', KM.rafThrottle(() => {
      measure();
      update();
      placeIndicator();
    }));
    measure();
    update();

    // Current section indicator under the links.
    const links = KM.$$('#navLinks a');
    const indicator = KM.$('.nav-indicator', nav);
    let active = null;
    const placeIndicator = () => {
      if (!active) {
        indicator.style.setProperty('--o', '0');
        return;
      }
      indicator.style.setProperty('--x', `${active.offsetLeft + 12}px`);
      indicator.style.setProperty('--w', `${active.offsetWidth - 24}px`);
      indicator.style.setProperty('--o', '1');
    };
    const setActive = (id) => {
      active = links.find((a) => a.getAttribute('href') === `#${id}`) || null;
      links.forEach((a) => (a === active ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
      placeIndicator();
    };
    const visible = new Map();
    const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const current = sections.find((s) => visible.get(s.id));
        setActive(current ? current.id : null);
      }, { rootMargin: '-40% 0px -55% 0px' });
      sections.forEach((s) => io.observe(s));
    }

    // Menu sheet for small screens.
    const toggle = KM.$('#navToggle');
    const sheet = KM.$('#navSheet');
    const setOpen = (open) => {
      sheet.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
    };
    toggle.addEventListener('click', () => setOpen(sheet.hidden));
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });
    const wide = root.matchMedia('(min-width: 901px)');
    const onWide = (e) => { if (e.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else wide.addListener(onWide);
  };
})(self);
