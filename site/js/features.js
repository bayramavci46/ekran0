/*
 * The feature cards are small working demos: style the camera window, line up two
 * recordings by their sound (automatically or by hand), watch an export with its cost
 * shown up front, press keys.
 */
(function (root) {
  'use strict';
  const KM = root.KM;

  function initShape(stage) {
    stage.preset('ders');
    stage.setLook({ shape: 'rounded' });
    stage.box = { ...KM.Stage.defaultBox };
    stage.apply();
    KM.segmented(KM.$('#shapeSeg'), (shape) => stage.setLook({ shape }));
    const swatches = KM.$$('#borderSwatches .swatch');
    swatches.forEach((s) => {
      if (s.dataset.color !== 'none') s.style.setProperty('--swatch', s.dataset.color);
      s.addEventListener('click', () => {
        swatches.forEach((x) => x.setAttribute('aria-checked', String(x === s)));
        stage.setLook({ border: s.dataset.color });
      });
    });
    KM.$('#shadowSwitch').addEventListener('change', (e) => stage.setLook({ shadow: e.target.checked }));
    KM.$('#mirrorSwitch').addEventListener('change', (e) => stage.setLook({ mirror: e.target.checked }));
  }

  // ---- Sync demo -----------------------------------------------------------------

  const BARS = 64;
  const PEAK = 24;
  const START_OFFSET = 7; // bars the camera starts late
  const SECONDS_PER_BAR = 2.4 / START_OFFSET;

  function drawWave(svg, peakAt, seed) {
    let s = seed;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const w = 200 / BARS;
    let out = '';
    for (let i = 0; i < BARS; i++) {
      const dist = Math.abs(i - peakAt);
      let h = 4 + rand() * 12 + Math.sin(i * 0.45 + seed) * 3;
      if (dist === 0) h = 40;
      else if (dist === 1) h = 26;
      else if (dist === 2) h = 16;
      out += `<rect${dist <= 1 ? ' class="peak"' : ''} x="${(i * w + 0.5).toFixed(2)}" y="${((40 - h) / 2).toFixed(2)}" width="${(w - 1).toFixed(2)}" height="${h.toFixed(2)}" rx="0.8"/>`;
    }
    svg.innerHTML = out;
  }

  function initSync() {
    const box = KM.$('.sync');
    const drag = KM.$('#syncDrag');
    const line = KM.$('#syncLine');
    const status = KM.$('#syncStatus');
    const text = KM.$('#syncText');
    drawWave(KM.$('#waveScreen'), PEAK, 7);
    drawWave(KM.$('#waveCamera'), PEAK + START_OFFSET, 3);

    let bars = START_OFFSET; // current lag of the camera, in bars
    let synced = false;
    let byHand = true;
    let listening = 0;
    const auto = KM.$('#syncAuto');
    const barPx = () => drag.clientWidth / BARS;
    const render = (animate) => {
      drag.classList.toggle('is-dragging', !animate);
      drag.style.setProperty('--dx', `${(bars - START_OFFSET) * barPx()}px`);
      const sec = bars * SECONDS_PER_BAR;
      const nowSynced = Math.abs(bars) < 0.01;
      box.classList.toggle('is-synced', nowSynced);
      status.dataset.tone = nowSynced ? 'ok' : 'warn';
      text.textContent = nowSynced ? 'Senkron · eşleşti' : `Kayık · ${KM.signed(sec)}`;
      drag.setAttribute('aria-valuenow', sec.toFixed(2));
      drag.setAttribute('aria-valuetext', nowSynced ? 'Senkron' : `${KM.signed(sec)} kayık`);
      if (nowSynced && !synced) {
        KM.toast(byHand ? 'Senkron yakalandı · kamera 2,40 sn öne alındı' : 'Sesten eşlendi · kamera 2,40 sn öne alındı');
      }
      synced = nowSynced;
    };
    const placeLine = () => {
      const peak = KM.$$('#waveScreen rect.peak')[1];
      const r = peak.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      line.style.setProperty('--peak-x', `${r.left + r.width / 2 - b.left}px`);
    };

    let d = null;
    drag.addEventListener('pointerdown', (e) => {
      stopListening();
      byHand = true;
      d = { id: e.pointerId, x: e.clientX, start: bars };
      drag.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    drag.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return;
      bars = KM.clamp(d.start + (e.clientX - d.x) / barPx(), -12, 16);
      if (Math.abs(bars) < 0.6) bars = 0; // the clap pulls itself into line
      render(false);
    });
    const end = (e) => {
      if (!d || e.pointerId !== d.id) return;
      d = null;
      bars = Math.round(bars);
      render(true);
    };
    drag.addEventListener('pointerup', end);
    drag.addEventListener('pointercancel', end);
    drag.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      stopListening();
      byHand = true;
      bars = KM.clamp(Math.round(bars) + dir * (e.shiftKey ? 3 : 1), -12, 16);
      render(true);
    });
    KM.$('#syncReset').addEventListener('click', () => {
      stopListening();
      bars = START_OFFSET;
      synced = false;
      render(true);
    });

    // "Otomatik eşle" listens for a moment, then slides the camera track onto the clap,
    // the way the editor does it with the real recordings.
    function stopListening() {
      clearTimeout(listening);
      listening = 0;
      auto.disabled = false;
    }
    auto.addEventListener('click', () => {
      if (Math.abs(bars) < 0.01) {
        KM.toast('Kayıtlar zaten eşleşiyor');
        return;
      }
      stopListening();
      auto.disabled = true;
      status.dataset.tone = 'busy';
      text.textContent = 'Sesler dinleniyor…';
      listening = setTimeout(() => {
        stopListening();
        byHand = false;
        bars = 0;
        render(true);
      }, KM.reducedMotion() ? 0 : 900);
    });
    root.addEventListener('resize', KM.rafThrottle(() => {
      placeLine();
      render(true);
    }));
    placeLine();
    render(true);
  }

  // ---- Export demo ------------------------------------------------------------------

  const ESTIMATES = {
    medium: { mb: 130, sec: 50, speed: 5.2 },
    high: { mb: 260, sec: 65, speed: 4 },
    'very-high': { mb: 390, sec: 80, speed: 3.3 },
  };

  function initExport() {
    const run = KM.$('#exportRun');
    const size = KM.$('#estSize');
    const time = KM.$('#estTime');
    const fill = KM.$('#exportFill');
    const pct = KM.$('#exportPct');
    const speed = KM.$('#exportSpeed');
    const doneSize = KM.$('#exportSize');
    let quality = 'high';
    let raf = 0;

    const show = (q) => {
      quality = q;
      const e = ESTIMATES[q];
      for (const el of [size, time]) el.classList.add('is-updating');
      setTimeout(() => {
        size.textContent = `~${e.mb} MB`;
        time.textContent = `~${KM.duration(e.sec)}`;
        doneSize.textContent = `${e.mb} MB`;
        for (const el of [size, time]) el.classList.remove('is-updating');
      }, 120);
      if (run.dataset.state === 'done') run.dataset.state = 'idle';
    };
    KM.segmented(KM.$('#qualitySeg'), show);

    KM.$('#exportBtn').addEventListener('click', () => {
      const e = ESTIMATES[quality];
      run.dataset.state = 'running';
      speed.textContent = `${KM.decimal(e.speed, 1)}× hız`;
      const start = performance.now();
      const dur = KM.reducedMotion() ? 1 : 2400;
      const frame = (now) => {
        const t = Math.min(1, (now - start) / dur);
        const p = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        fill.style.setProperty('--p', p.toFixed(3));
        pct.textContent = `%${Math.round(p * 100)}`;
        if (t < 1) {
          raf = requestAnimationFrame(frame);
          return;
        }
        run.dataset.state = 'done';
        KM.toast(`Örnek tamamlandı · ders-03.mp4, ${e.mb} MB`);
        KM.$('#exportAgain').focus({ preventScroll: true });
      };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    });
    KM.$('#exportAgain').addEventListener('click', () => {
      run.dataset.state = 'idle';
      fill.style.setProperty('--p', '0');
      KM.$('#exportBtn').focus({ preventScroll: true });
    });
  }

  // ---- Keyboard card -------------------------------------------------------------------

  function initKeys() {
    const caps = KM.$$('.keycap');
    const find = (key) => caps.find((c) => c.dataset.key === key.toLowerCase());
    const press = (cap) => {
      cap.classList.add('is-pressed');
      clearTimeout(cap._t);
      cap._t = setTimeout(() => cap.classList.remove('is-pressed'), 160);
    };
    // Pressing I, O or Space anywhere on the page presses the matching keycap.
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || KM.isTyping(e.target)) return;
      const cap = find(e.key);
      if (cap) press(cap);
    });
    caps.forEach((c) => c.addEventListener('pointerdown', () => press(c)));
  }

  KM.initFeatures = function (shapeStage) {
    initShape(shapeStage);
    initSync();
    initExport();
    initKeys();
    const drawer = KM.drawer(KM.$('#shortcuts'));
    KM.$$('[data-drawer-open="shortcuts"]').forEach((b) => b.addEventListener('click', () => drawer.open(b)));
  };
})(self);
