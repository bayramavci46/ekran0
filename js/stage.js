/*
 * The camera box on top of the preview: drag it to move, drag a corner to scale
 * (keeping the shape), drag an edge to change the shape (rectangle styles only),
 * scroll over it to scale, or use the keyboard when it has focus.
 *
 * All editing happens in on-screen pixels of the preview frame; the box is stored
 * normalized (0..1) so the same layout applies at any output resolution.
 */
(function (root) {
  'use strict';
  const G = root.PipEditor.geometry;

  const SNAP_PX = 7;

  class CameraBoxEditor {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.frame   element covering the preview canvas
     * @param {HTMLElement} opts.box     the camera box element (with .handle children)
     * @param {HTMLElement} opts.guides  container for snap guide lines
     * @param {HTMLElement} opts.readout size/position label inside the box
     * @param {() => {width:number,height:number}} opts.outputSize
     * @param {(box:object, phase:'live'|'commit') => void} opts.onChange
     */
    constructor(opts) {
      this.frame = opts.frame;
      this.boxEl = opts.box;
      this.guides = opts.guides;
      this.readout = opts.readout;
      this.outputSize = opts.outputSize;
      this.onChange = opts.onChange;
      this.look = null;
      this.drag = null;

      const box = this.boxEl;
      box.addEventListener('pointerdown', (e) => this._down(e));
      box.addEventListener('pointermove', (e) => this._move(e));
      box.addEventListener('pointerup', (e) => this._up(e));
      box.addEventListener('pointercancel', (e) => this._up(e));
      box.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
      box.addEventListener('keydown', (e) => this._key(e));
      box.addEventListener('dblclick', (e) => e.preventDefault());
    }

    setLook(look, enabled) {
      this.look = look;
      const el = this.boxEl;
      el.hidden = !enabled || !look.visible;
      if (el.hidden) return;
      const b = look.box;
      el.style.left = `${b.x * 100}%`;
      el.style.top = `${b.y * 100}%`;
      el.style.width = `${b.w * 100}%`;
      el.style.height = `${b.h * 100}%`;
      el.dataset.shape = look.shape;
      // Mirror the rounded corners on the outline so it hugs the drawn shape.
      if (look.shape === 'rounded') {
        const fw = this.frame.clientWidth;
        const fh = this.frame.clientHeight;
        const r = (look.radius * Math.min(b.w * fw, b.h * fh)) / 2;
        el.style.borderRadius = `${r}px`;
      } else {
        el.style.borderRadius = '';
      }
      this._updateReadout();
    }

    // ---- helpers ---------------------------------------------------------

    _frameSize() {
      return { W: this.frame.clientWidth, H: this.frame.clientHeight };
    }

    _minSize(W, H) {
      const m = Math.max(28, Math.min(W, H) * 0.06);
      return { minW: m, minH: m };
    }

    _commit(pxBox, phase) {
      const { W, H } = this._frameSize();
      this.onChange(G.toNorm(pxBox, W, H), phase);
    }

    _showGuides(guides) {
      this.guides.textContent = '';
      if (!guides) return;
      const { W, H } = this._frameSize();
      for (const x of guides.x) {
        const line = document.createElement('span');
        line.className = 'guide guide-v';
        line.style.left = `${(x / W) * 100}%`;
        this.guides.appendChild(line);
      }
      for (const y of guides.y) {
        const line = document.createElement('span');
        line.className = 'guide guide-h';
        line.style.top = `${(y / H) * 100}%`;
        this.guides.appendChild(line);
      }
    }

    _updateReadout() {
      if (!this.look || !this.readout) return;
      const out = this.outputSize();
      const b = this.look.box;
      this.readout.textContent = `${Math.round(b.w * out.width)} × ${Math.round(b.h * out.height)}`;
    }

    // ---- pointer ---------------------------------------------------------

    _down(e) {
      if (e.button > 0 || !this.look) return;
      const { W, H } = this._frameSize();
      const handle = e.target.closest('.handle');
      const start = G.toPx(this.look.box, W, H);
      this.drag = {
        id: e.pointerId,
        handle: handle ? handle.dataset.h : null,
        x: e.clientX,
        y: e.clientY,
        start,
        moved: false,
      };
      this.boxEl.setPointerCapture(e.pointerId);
      this.boxEl.classList.add(handle ? 'is-resizing' : 'is-moving');
      this.boxEl.focus({ preventScroll: true });
      e.preventDefault();
    }

    _move(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const { W, H } = this._frameSize();
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      d.moved = true;
      let next;
      let guides = null;
      if (!d.handle) {
        next = G.move(d.start, dx, dy, W, H);
        if (!e.altKey) {
          const snapped = G.snap(next, W, H, G.snapLines(W, H), SNAP_PX);
          next = snapped.box;
          guides = snapped.guides;
        }
      } else {
        const [hx, hy] = G.HANDLES[d.handle];
        const s = d.start;
        // Follow the pointer relative to where the handle started, not its absolute position.
        const px = (hx === 1 ? s.x + s.w : hx === -1 ? s.x : s.x + s.w / 2) + dx;
        const py = (hy === 1 ? s.y + s.h : hy === -1 ? s.y : s.y + s.h / 2) + dy;
        const corner = hx !== 0 && hy !== 0;
        const lockAspect = this.look.shape === 'circle' || (corner && !e.shiftKey);
        next = G.resize(s, d.handle, px, py, W, H, { lockAspect, ...this._minSize(W, H) });
      }
      this._showGuides(guides);
      this._commit(next, 'live');
    }

    _up(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.boxEl.classList.remove('is-resizing', 'is-moving');
      this._showGuides(null);
      if (d.moved) this.onChange({ ...this.look.box }, 'commit');
    }

    _wheel(e) {
      if (!this.look) return;
      e.preventDefault();
      const { W, H } = this._frameSize();
      const r = this.frame.getBoundingClientRect();
      const box = G.toPx(this.look.box, W, H);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = G.scaleAbout(box, factor, e.clientX - r.left, e.clientY - r.top, W, H, this._minSize(W, H).minW);
      this._commit(next, 'live');
      clearTimeout(this._wheelTimer);
      this._wheelTimer = setTimeout(() => this.onChange({ ...this.look.box }, 'commit'), 400);
    }

    _key(e) {
      if (!this.look) return;
      const { W, H } = this._frameSize();
      const box = G.toPx(this.look.box, W, H);
      const step = (e.shiftKey ? 0.05 : 0.01) * W;
      let next = null;
      switch (e.key) {
        case 'ArrowLeft': next = G.move(box, -step, 0, W, H); break;
        case 'ArrowRight': next = G.move(box, step, 0, W, H); break;
        case 'ArrowUp': next = G.move(box, 0, -step, W, H); break;
        case 'ArrowDown': next = G.move(box, 0, step, W, H); break;
        case '+':
        case '=':
          next = G.scaleAbout(box, 1.05, box.x + box.w / 2, box.y + box.h / 2, W, H, this._minSize(W, H).minW);
          break;
        case '-':
        case '_':
          next = G.scaleAbout(box, 1 / 1.05, box.x + box.w / 2, box.y + box.h / 2, W, H, this._minSize(W, H).minW);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._commit(next, 'commit');
    }
  }

  root.PipEditor.CameraBoxEditor = CameraBoxEditor;
})(self);
