/*
 * "Nasıl çalışır": as each step reaches the middle of the screen, the pinned preview
 * acts it out (files dropped in, camera placed, clip synced and trimmed, export done).
 */
(function (root) {
  'use strict';
  const KM = root.KM;

  const CAPTIONS = {
    1: 'Ekran kaydı ve kamera kaydı yüklendi',
    2: 'Kamera sağ alta yerleşti · daire, 403 × 403',
    3: 'Kamera 2,40 sn kaydırıldı · başı ve sonu kesildi',
    4: 'ders-03.mp4 hazır · 260 MB',
  };

  KM.initHow = function (stage) {
    const steps = KM.$$('.how-step');
    const caption = KM.$('#howCaption');
    const drop = KM.$('.drop-overlay', stage.root);
    const xo = KM.$('.export-overlay', stage.root);
    const xoPct = KM.$('.xo-pct', stage.root);
    let current = 0;
    let timers = [];
    let raf = 0;
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const reset = () => {
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(raf);
    };
    const timeline = (camOffset, inPoint, outPoint) => {
      stage.root.style.setProperty('--cam-off', camOffset);
      stage.root.style.setProperty('--in', inPoint);
      stage.root.style.setProperty('--out', outPoint);
    };

    stage.seek(0.36);
    timeline('2%', '0%', '100%');

    function go(n) {
      if (n === current) return;
      current = n;
      reset();
      steps.forEach((s) => s.classList.toggle('is-active', Number(s.dataset.step) === n));
      stage.root.dataset.step = String(n);
      caption.textContent = CAPTIONS[n];
      drop.classList.remove('is-shown', 'has-files');
      xo.classList.remove('is-done');
      stage.root.style.setProperty('--xp', '0');

      if (n === 1) {
        stage.setLook({ shape: 'rounded' });
        stage.box = { ...KM.Stage.defaultBox };
        stage.apply();
        timeline('2%', '0%', '100%');
        drop.classList.add('is-shown');
        later(() => drop.classList.add('has-files'), 250);
        later(() => drop.classList.remove('is-shown'), 1700);
      } else if (n === 2) {
        stage.preset('ders');
        timeline('2%', '0%', '100%');
        later(() => stage.flashGuides(), 450);
      } else {
        stage.preset('ders');
        timeline('12%', '7%', '91%');
      }
      if (n === 4) {
        const start = performance.now();
        const dur = KM.reducedMotion() ? 1 : 1800;
        const frame = (now) => {
          const p = Math.min(1, (now - start) / dur);
          stage.root.style.setProperty('--xp', p.toFixed(3));
          xoPct.textContent = `%${Math.round(p * 100)}`;
          if (p < 1) raf = requestAnimationFrame(frame);
          else xo.classList.add('is-done');
        };
        later(() => { raf = requestAnimationFrame(frame); }, 300);
      }
    }

    if (typeof IntersectionObserver !== 'function') {
      go(4);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) go(Number(e.target.dataset.step));
      }
    }, { rootMargin: '-48% 0px -48% 0px' });
    steps.forEach((s) => io.observe(s));
  };
})(self);
