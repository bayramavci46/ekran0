/*
 * Two-lane timeline: the screen recording on top, the camera recording below it.
 * - click or drag anywhere to move the playhead,
 * - drag the [ and ] marks to choose the part that gets exported,
 * - drag the camera clip sideways to line it up with the screen recording.
 */
(function (root) {
  'use strict';
  const U = root.PipEditor.util;
  const clamp = U.clamp;

  const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const MIN_RANGE = 0.1;
  const SNAP_PX = 8;

  function el(tag, cls, parent) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }

  class Timeline {
    constructor(container, callbacks) {
      this.cb = callbacks;
      this.d = { duration: 0, time: 0, trimStart: 0, trimEnd: 0, camera: null, fps: 30, screenName: '' };
      this.drag = null;

      container.classList.add('tl');
      const labels = el('div', 'tl-labels', container);
      el('span', 'tl-label tl-label-ruler', labels);
      el('span', 'tl-label', labels).textContent = 'Ekran';
      el('span', 'tl-label', labels).textContent = 'Kamera';

      const area = el('div', 'tl-area', container);
      this.area = area;
      this.ruler = el('div', 'tl-ruler', area);
      const lanes = el('div', 'tl-lanes', area);
      const screenLane = el('div', 'tl-lane', lanes);
      this.screenClip = el('div', 'tl-clip tl-clip-screen', screenLane);
      this.screenClipName = el('span', 'tl-clip-name', this.screenClip);
      const camLane = el('div', 'tl-lane', lanes);
      this.camClip = el('div', 'tl-clip tl-clip-camera', camLane);
      this.camClip.tabIndex = 0;
      this.camClip.setAttribute('role', 'slider');
      this.camClip.setAttribute('aria-label', 'Kamera kaydının zamanlaması (sürükleyerek kaydırın)');
      this.camClipName = el('span', 'tl-clip-name', this.camClip);
      this.camEmpty = el('span', 'tl-lane-empty', camLane);
      this.camEmpty.textContent = 'Kamera kaydı yok';

      this.shadeBefore = el('div', 'tl-shade', area);
      this.shadeAfter = el('div', 'tl-shade', area);
      this.markIn = el('div', 'tl-mark tl-mark-in', area);
      this.markOut = el('div', 'tl-mark tl-mark-out', area);
      this.playhead = el('div', 'tl-playhead', area);
      el('span', 'tl-playhead-knob', this.playhead);

      const slider = (node, label) => {
        node.tabIndex = 0;
        node.setAttribute('role', 'slider');
        node.setAttribute('aria-label', label);
      };
      slider(this.markIn, 'Başlangıç noktası');
      slider(this.markOut, 'Bitiş noktası');
      slider(this.playhead, 'Oynatma konumu');

      area.addEventListener('pointerdown', (e) => this._down(e));
      area.addEventListener('pointermove', (e) => this._move(e));
      area.addEventListener('pointerup', (e) => this._up(e));
      area.addEventListener('pointercancel', (e) => this._up(e));
      this.markIn.addEventListener('keydown', (e) => this._key(e, 'in'));
      this.markOut.addEventListener('keydown', (e) => this._key(e, 'out'));
      this.playhead.addEventListener('keydown', (e) => this._key(e, 'time'));
      this.camClip.addEventListener('keydown', (e) => this._key(e, 'offset'));

      this._width = 0;
      new ResizeObserver(() => {
        const w = this.area.clientWidth;
        if (w !== this._width) {
          this._width = w;
          this._renderRuler();
        }
      }).observe(area);
    }

    update(patch) {
      const prevDuration = this.d.duration;
      Object.assign(this.d, patch);
      if (this.d.duration !== prevDuration) this._renderRuler();
      this._render();
    }

    setTime(t) {
      this.d.time = t;
      this._place(this.playhead, t);
      this._aria(this.playhead, t, 0, this.d.duration);
    }

    // ---- rendering -------------------------------------------------------

    _pct(t) {
      const D = this.d.duration;
      return D > 0 ? (t / D) * 100 : 0;
    }

    _place(node, t) {
      node.style.left = `${this._pct(t)}%`;
    }

    _aria(node, value, min, max) {
      node.setAttribute('aria-valuemin', min.toFixed(2));
      node.setAttribute('aria-valuemax', max.toFixed(2));
      node.setAttribute('aria-valuenow', value.toFixed(2));
      node.setAttribute('aria-valuetext', U.timecode(value, this.d.fps));
    }

    _render() {
      const { duration: D, trimStart: a, trimEnd: b, camera, time } = this.d;
      const empty = D <= 0;
      this.area.parentElement.classList.toggle('is-empty', empty);
      this.screenClip.hidden = empty;
      this.screenClipName.textContent = this.d.screenName;

      this.shadeBefore.style.left = '0%';
      this.shadeBefore.style.width = `${this._pct(a)}%`;
      this.shadeAfter.style.left = `${this._pct(b)}%`;
      this.shadeAfter.style.width = `${100 - this._pct(b)}%`;
      this._place(this.markIn, a);
      this._place(this.markOut, b);
      this._aria(this.markIn, a, 0, b);
      this._aria(this.markOut, b, a, D);
      this.setTime(time);

      const hasCam = !!camera && !empty;
      this.camClip.hidden = !hasCam;
      this.camEmpty.hidden = hasCam;
      if (hasCam) {
        this.camClip.style.left = `${this._pct(camera.offset)}%`;
        this.camClip.style.width = `${this._pct(camera.duration)}%`;
        this.camClipName.textContent = `Kamera · ${U.signedSeconds(camera.offset)}`;
        this.camClip.setAttribute('aria-valuenow', camera.offset.toFixed(2));
        this.camClip.setAttribute('aria-valuetext', U.signedSeconds(camera.offset));
      }
    }

    _renderRuler() {
      const D = this.d.duration;
      const width = this.area.clientWidth;
      this.ruler.textContent = '';
      if (D <= 0 || width <= 0) return;
      const pxPerSec = width / D;
      const major = STEPS.find((s) => s * pxPerSec >= 72) || STEPS[STEPS.length - 1];
      const minor = major / (major * pxPerSec >= 120 ? 10 : 5);
      const frag = document.createDocumentFragment();
      const count = Math.floor(D / minor + 1e-6);
      for (let i = 0; i <= count; i++) {
        const t = i * minor;
        const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
        const tick = el('span', isMajor ? 'tl-tick tl-tick-major' : 'tl-tick', frag);
        tick.style.left = `${(t / D) * 100}%`;
        if (isMajor && t < D - major * 0.4) {
          const label = el('span', 'tl-tick-label', tick);
          label.textContent = U.clock(t);
        }
      }
      this.ruler.appendChild(frag);
    }

    // ---- interaction -----------------------------------------------------

    _timeAt(clientX) {
      const r = this.area.getBoundingClientRect();
      return clamp((clientX - r.left) / r.width, 0, 1) * this.d.duration;
    }

    _pxPerSec() {
      return this.area.clientWidth / (this.d.duration || 1);
    }

    _down(e) {
      if (this.d.duration <= 0 || e.button > 0) return;
      const target = e.target;
      let mode = 'scrub';
      if (target.closest('.tl-mark-in')) mode = 'in';
      else if (target.closest('.tl-mark-out')) mode = 'out';
      else if (target.closest('.tl-clip-camera')) mode = 'offset';
      this.drag = { mode, id: e.pointerId, x: e.clientX, offset: this.d.camera ? this.d.camera.offset : 0 };
      this.area.setPointerCapture(e.pointerId);
      this.area.classList.add(`is-dragging-${mode}`);
      e.preventDefault();
      if (mode === 'scrub') {
        this.cb.onScrub('start');
        this.cb.onSeek(this._timeAt(e.clientX));
        this.playhead.focus({ preventScroll: true });
      } else if (mode === 'offset') {
        this.camClip.focus({ preventScroll: true });
      } else {
        (mode === 'in' ? this.markIn : this.markOut).focus({ preventScroll: true });
      }
    }

    _move(e) {
      const drag = this.drag;
      if (!drag || e.pointerId !== drag.id) return;
      const t = this._timeAt(e.clientX);
      if (drag.mode === 'scrub') {
        this.cb.onSeek(t);
      } else if (drag.mode === 'in' || drag.mode === 'out') {
        this._setMark(drag.mode, t, 'live');
      } else if (drag.mode === 'offset') {
        const pps = this._pxPerSec();
        let offset = drag.offset + (e.clientX - drag.x) / pps;
        // Snap the clip start to the timeline start or to the playhead.
        for (const target of [0, this.d.time]) {
          if (Math.abs(offset - target) * pps <= SNAP_PX) offset = target;
        }
        this.cb.onOffset(offset, 'live');
      }
    }

    _up(e) {
      const drag = this.drag;
      if (!drag || e.pointerId !== drag.id) return;
      this.drag = null;
      this.area.classList.remove(`is-dragging-${drag.mode}`);
      if (drag.mode === 'scrub') this.cb.onScrub('end');
      else if (drag.mode === 'offset') this.cb.onOffset(this.d.camera ? this.d.camera.offset : 0, 'commit');
      else this.cb.onTrim(this.d.trimStart, this.d.trimEnd, 'commit');
    }

    _setMark(which, t, phase) {
      const D = this.d.duration;
      let a = this.d.trimStart;
      let b = this.d.trimEnd;
      if (which === 'in') a = clamp(t, 0, Math.max(0, b - MIN_RANGE));
      else b = clamp(t, Math.min(D, a + MIN_RANGE), D);
      this.cb.onTrim(a, b, phase);
      this.cb.onSeek(which === 'in' ? a : b);
    }

    _key(e, which) {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      const isHome = e.key === 'Home';
      const isEnd = e.key === 'End';
      if (!dir && !isHome && !isEnd) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 1 : 1 / this.d.fps;
      const D = this.d.duration;
      if (which === 'time') {
        const t = isHome ? this.d.trimStart : isEnd ? this.d.trimEnd : this.d.time + dir * step;
        this.cb.onSeek(clamp(t, 0, D));
      } else if (which === 'in' || which === 'out') {
        const cur = which === 'in' ? this.d.trimStart : this.d.trimEnd;
        const t = isHome ? 0 : isEnd ? D : cur + dir * step;
        this._setMark(which, t, 'commit');
      } else if (which === 'offset' && this.d.camera) {
        const o = isHome ? 0 : isEnd ? this.d.time : this.d.camera.offset + dir * step;
        this.cb.onOffset(o, 'commit');
      }
    }
  }

  root.PipEditor.Timeline = Timeline;
})(self);
