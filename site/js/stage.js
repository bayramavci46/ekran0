/*
 * A small, honest copy of the editor: a mock screen recording with a camera window on top.
 * The same component is used three times (hero, steps, shape card). Live stages let people
 * drag and resize the camera with the editor's own geometry (js/geometry.js), so it snaps to
 * the same safe-area lines as the real thing.
 */
(function (root) {
  'use strict';
  const KM = root.KM;
  const G = root.PipEditor.geometry;

  // Every stage frame is 16:9. Layouts are computed in this virtual frame and kept as fractions.
  const VW = 1600;
  const VH = 900;
  const CAM_ASPECT = 16 / 9;
  const LOOP = 14; // seconds for one pass of the hero "video"

  const PRESETS = {
    ders: { shape: 'circle', size: 0.21, pos: 'br' },
    demo: { shape: 'rounded', size: 0.25, pos: 'tr' },
    sunum: { shape: 'rounded', size: 0.4, pos: 'ml' },
  };

  function boxFor(shape, size, pos) {
    const w = size * VW;
    const h = shape === 'circle' ? w : w / CAM_ASPECT;
    return G.toNorm(G.placeAt({ x: 0, y: 0, w, h }, pos, VW, VH), VW, VH);
  }

  class Stage {
    /**
     * @param {HTMLElement} mount
     * @param {{live?: boolean, timeline?: boolean, onChange?: (phase: string) => void, onTick?: (p: number) => void}} opts
     */
    constructor(mount, opts) {
      mount.appendChild(document.getElementById('stageTemplate').content.cloneNode(true));
      this.root = mount.querySelector('.stage');
      this.frame = this.root.querySelector('.frame');
      this.cam = this.root.querySelector('.cam');
      this.guides = this.root.querySelector('.guides');
      this.readout = this.root.querySelector('.cam-readout');
      this.lines = Array.from(this.root.querySelectorAll('.scr-code li'));
      this.pointer = this.root.querySelector('.scr-pointer');
      this.opts = opts;
      this.look = { shape: 'rounded', border: '#ffffff', shadow: true, mirror: false };
      this.box = boxFor('rounded', 0.26, 'br');
      this.drag = null;
      this.raf = 0;
      this.shown = -1;
      this.root.classList.add(opts.live ? 'stage-live' : 'stage-static');
      // Only the camera window of a live stage is something to operate; the rest is illustration.
      if (!opts.live) this.frame.setAttribute('aria-hidden', 'true');
      if (opts.timeline === false) this.root.classList.add('stage-notl');
      if (opts.live) this._bind();
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.apply()).observe(this.frame);
      this.apply();
    }

    preset(name) {
      const p = PRESETS[name];
      if (!p) return;
      this.look.shape = p.shape;
      this.box = boxFor(p.shape, p.size, p.pos);
      this.apply();
    }

    setLook(patch) {
      const from = this.look.shape;
      Object.assign(this.look, patch);
      if (patch.shape && patch.shape !== from) {
        const px = G.toPx(this.box, VW, VH);
        const next = patch.shape === 'circle'
          ? G.toSquare(px, VW, VH)
          : from === 'circle' ? G.withAspect(px, CAM_ASPECT, VW, VH) : px;
        this.box = G.toNorm(next, VW, VH);
      }
      this.apply();
    }

    apply() {
      const b = this.box;
      const cam = this.cam;
      const L = this.look;
      cam.style.left = `${b.x * 100}%`;
      cam.style.top = `${b.y * 100}%`;
      cam.style.width = `${b.w * 100}%`;
      cam.style.height = `${b.h * 100}%`;
      cam.dataset.shape = L.shape;
      const fw = this.frame.clientWidth || VW;
      const fh = this.frame.clientHeight || VH;
      let radius = '0.5cqw';
      if (L.shape === 'circle') radius = '50%';
      else if (L.shape === 'rounded') radius = `${(0.35 * Math.min(b.w * fw, b.h * fh)) / 2}px`;
      cam.style.setProperty('--cam-r', radius);
      cam.style.setProperty('--cam-bw', L.border === 'none' ? '0px' : '0.42cqw');
      if (L.border !== 'none') cam.style.setProperty('--cam-bc', L.border);
      cam.classList.toggle('has-shadow', L.shadow);
      cam.classList.toggle('is-mirrored', L.mirror);
      // Size as it would come out of a 1920 × 1080 export.
      this.readout.textContent = `${Math.round(b.w * 1920)} × ${Math.round(b.h * 1080)}`;
    }

    // ---- playback of the mock recording -------------------------------------------------

    play() {
      if (this.raf || KM.reducedMotion()) return;
      this.root.classList.add('is-playing');
      let last = performance.now();
      const tick = (now) => {
        this.t = (this.t + Math.min(now - last, 100) / 1000) % LOOP;
        last = now;
        this.seek(this.t / LOOP);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    pause() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    /** Shows the recording at position p (0..1): playhead, typed lines and the mouse pointer. */
    seek(p) {
      this.t = p * LOOP;
      this.root.style.setProperty('--p', p.toFixed(4));
      // A few lines are already there when the recording starts; the rest are typed as it plays.
      const count = Math.min(this.lines.length, 5 + Math.floor(p * (this.lines.length - 4)));
      if (count !== this.shown) {
        this.shown = count;
        this.lines.forEach((li, i) => {
          li.classList.toggle('on', i < count);
          li.classList.toggle('is-current', i === count - 1);
        });
        const i = count - 1;
        this.pointer.style.setProperty('--px', `${44 + ((i * 17) % 26)}%`);
        this.pointer.style.setProperty('--py', `${21 + i * 4.9}%`);
      }
      if (this.opts.onTick) this.opts.onTick(p);
    }

    // ---- direct manipulation ---------------------------------------------------------------

    _bind() {
      const cam = this.cam;
      cam.tabIndex = 0;
      cam.setAttribute('aria-label',
        'Kamera penceresi. Sürükleyerek taşıyın, köşelerinden büyütün. Ok tuşları taşır, artı ve eksi büyütüp küçültür.');
      cam.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        const handle = e.target.closest('.cam-handle');
        const W = this.frame.clientWidth;
        const H = this.frame.clientHeight;
        this.drag = {
          id: e.pointerId, handle: handle ? handle.dataset.h : null,
          x: e.clientX, y: e.clientY, start: G.toPx(this.box, W, H), W, H, moved: false,
        };
        cam.setPointerCapture(e.pointerId);
        cam.classList.add('is-dragging');
        e.preventDefault();
      });
      cam.addEventListener('pointermove', (e) => this._move(e));
      cam.addEventListener('pointerup', (e) => this._end(e));
      cam.addEventListener('pointercancel', (e) => this._end(e));
      cam.addEventListener('keydown', (e) => this._key(e));
    }

    _move(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      d.moved = true;
      let next;
      let guides = null;
      if (!d.handle) {
        const snapped = G.snap(G.move(d.start, dx, dy, d.W, d.H), d.W, d.H, G.snapLines(d.W, d.H), 6);
        next = snapped.box;
        guides = snapped.guides;
      } else {
        const [hx, hy] = G.HANDLES[d.handle];
        const s = d.start;
        const px = (hx === 1 ? s.x + s.w : s.x) + dx;
        const py = (hy === 1 ? s.y + s.h : s.y) + dy;
        const min = Math.max(36, Math.min(d.W, d.H) * 0.12);
        next = G.resize(s, d.handle, px, py, d.W, d.H, { lockAspect: true, minW: min, minH: min });
      }
      this.box = G.toNorm(next, d.W, d.H);
      this._showGuides(guides, d.W, d.H);
      this.apply();
      if (this.opts.onChange) this.opts.onChange('drag');
    }

    _end(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.cam.classList.remove('is-dragging');
      this._showGuides(null);
      if (!d.moved) return;
      this._magnet(d.W, d.H);
      if (this.opts.onChange) this.opts.onChange('drop');
    }

    /** Released close to a corner, the window settles into it like a magnet. */
    _magnet(W, H) {
      const box = G.toPx(this.box, W, H);
      let best = null;
      for (const pos of ['tl', 'tr', 'bl', 'br']) {
        const p = G.placeAt(box, pos, W, H);
        const dist = Math.hypot(p.x - box.x, p.y - box.y);
        if (!best || dist < best.dist) best = { dist, p };
      }
      if (best && best.dist > 0.5 && best.dist < W * 0.09) {
        this.box = G.toNorm(best.p, W, H);
        this.apply();
      }
    }

    _key(e) {
      const W = this.frame.clientWidth;
      const H = this.frame.clientHeight;
      const box = G.toPx(this.box, W, H);
      const step = (e.shiftKey ? 0.06 : 0.02) * W;
      const min = Math.max(36, Math.min(W, H) * 0.12);
      const grow = (f) => G.scaleAbout(box, f, box.x + box.w / 2, box.y + box.h / 2, W, H, min);
      const moves = {
        ArrowLeft: () => G.move(box, -step, 0, W, H),
        ArrowRight: () => G.move(box, step, 0, W, H),
        ArrowUp: () => G.move(box, 0, -step, W, H),
        ArrowDown: () => G.move(box, 0, step, W, H),
        '+': () => grow(1.08),
        '=': () => grow(1.08),
        '-': () => grow(1 / 1.08),
      };
      const fn = moves[e.key];
      if (!fn) return;
      e.preventDefault();
      this.box = G.toNorm(fn(), W, H);
      this.apply();
      if (this.opts.onChange) this.opts.onChange('drop');
    }

    _showGuides(guides, W, H) {
      this.guides.textContent = '';
      if (!guides) return;
      for (const x of guides.x) {
        const g = document.createElement('span');
        g.className = 'guide guide-v';
        g.style.left = `${(x / W) * 100}%`;
        this.guides.appendChild(g);
      }
      for (const y of guides.y) {
        const g = document.createElement('span');
        g.className = 'guide guide-h';
        g.style.top = `${(y / H) * 100}%`;
        this.guides.appendChild(g);
      }
    }

    /** Briefly shows the safe-area lines the window just aligned to (used by the steps). */
    flashGuides() {
      const W = VW;
      const H = VH;
      const box = G.toPx(this.box, W, H);
      const m = G.safeMargin(W, H);
      this._showGuides({ x: [box.x + box.w >= W - m - 1 ? W - m : m], y: [box.y + box.h >= H - m - 1 ? H - m : m] }, W, H);
      clearTimeout(this._flash);
      this._flash = setTimeout(() => this._showGuides(null), 900);
    }
  }

  KM.Stage = Stage;
  KM.Stage.PRESETS = PRESETS;
  // Starting window before any preset: rounded, about a quarter of the frame, bottom right.
  KM.Stage.defaultBox = boxFor('rounded', 0.27, 'br');
})(self);
