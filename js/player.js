/*
 * Plays the screen and camera <video> elements together. The screen recording is the
 * master clock; the camera follows it shifted by `offset` seconds
 * (camera time = screen time − offset), so a positive offset means the camera
 * recording started later. Small drift is corrected by nudging the camera's
 * playback rate, large drift by seeking.
 *
 * Events: "state" (play/pause), "time" (position changed), "frame" (new frame decoded).
 */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /**
   * Safari can refuse to play with sound when playback was not started by a click. For the
   * preview it is better to keep the picture moving silently than to stall.
   */
  function playOrMute(el, mutedFallback) {
    return el.play().catch((err) => {
      if (!mutedFallback || !err || err.name !== 'NotAllowedError' || el.muted) throw err;
      el.muted = true;
      return el.play();
    });
  }

  class SyncPlayer extends EventTarget {
    constructor(screenEl, cameraEl, options = {}) {
      super();
      this.s = screenEl;
      this.c = cameraEl;
      this.mutedFallback = options.mutedFallback !== false;
      this.offset = 0;
      this.trimStart = 0;
      this.trimEnd = 0;
      this.hasScreen = false;
      this.hasCamera = false;
      this.playing = false;
      this._raf = 0;
      this._tick = this._tick.bind(this);

      for (const el of [screenEl, cameraEl]) {
        el.addEventListener('seeked', () => this._emit('frame'));
        el.addEventListener('loadeddata', () => this._emit('frame'));
      }
      screenEl.addEventListener('ended', () => this.pause());
      // Keep our state honest if the browser pauses the master (media keys, OS events).
      screenEl.addEventListener('pause', () => { if (this.playing && this.s.paused) this.pause(); });
      screenEl.addEventListener('waiting', () => { if (!this.c.paused) this.c.pause(); });
      screenEl.addEventListener('playing', () => this._syncCamera(true));
    }

    get duration() {
      return this.hasScreen && Number.isFinite(this.s.duration) ? this.s.duration : 0;
    }

    get currentTime() {
      return this.hasScreen ? this.s.currentTime : 0;
    }

    get cameraDuration() {
      return this.hasCamera && Number.isFinite(this.c.duration) ? this.c.duration : 0;
    }

    /** True when the camera recording has a picture at screen time `t`. */
    cameraActiveAt(t) {
      if (!this.hasCamera) return false;
      const ct = t - this.offset;
      return ct >= 0 && ct <= this.cameraDuration;
    }

    async play() {
      if (!this.hasScreen || this.playing) return;
      const frame = 1 / 60;
      if (this.s.currentTime >= this.trimEnd - frame || this.s.currentTime < this.trimStart) {
        this.s.currentTime = this.trimStart;
      }
      this.playing = true;
      this._syncCamera(true);
      if (this.hasCamera && this.c.paused) {
        // Touch the camera inside this click so Safari lets it start with sound later on.
        const started = this.c.play();
        if (started) started.catch(() => {});
        this.c.pause();
      }
      this._emit('state');
      try {
        await playOrMute(this.s, this.mutedFallback);
      } catch (err) {
        this.playing = false;
        this.c.pause();
        this._emit('state');
        throw err;
      }
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(this._tick);
    }

    pause() {
      const was = this.playing;
      this.playing = false;
      cancelAnimationFrame(this._raf);
      this.s.pause();
      this.c.pause();
      this.c.playbackRate = 1;
      if (was) this._emit('state');
      this._emit('time');
    }

    toggle() {
      return this.playing ? this.pause() : this.play();
    }

    seek(t) {
      if (!this.hasScreen) return;
      this.s.currentTime = clamp(t, 0, this.duration);
      this._syncCamera(true);
      this._emit('time');
    }

    /** Re-aligns the camera after the offset changed. */
    resync() {
      this._syncCamera(true);
      this._emit('time');
    }

    setVolumes(screen, camera) {
      this.s.volume = clamp(screen.volume, 0, 1);
      this.s.muted = screen.muted;
      this.c.volume = clamp(camera.volume, 0, 1);
      this.c.muted = camera.muted;
    }

    _syncCamera(force) {
      if (!this.hasCamera) return;
      const c = this.c;
      const dur = this.cameraDuration;
      const ct = this.s.currentTime - this.offset;
      if (ct < 0 || ct >= dur - 0.02) {
        if (!c.paused) c.pause();
        c.playbackRate = 1;
        const target = clamp(ct, 0, dur);
        if (force && Math.abs(c.currentTime - target) > 0.01) c.currentTime = target;
        return;
      }
      const drift = c.currentTime - ct;
      if (force || !this.playing || Math.abs(drift) > 0.25) {
        if (Math.abs(drift) > 0.01) c.currentTime = ct;
        c.playbackRate = 1;
      } else if (Math.abs(drift) > 0.03) {
        // Camera ahead → slow it down a little, behind → speed it up.
        c.playbackRate = clamp(1 - drift * 0.8, 0.9, 1.1);
      } else {
        c.playbackRate = 1;
      }
      if (this.playing && c.paused) playOrMute(c, this.mutedFallback).catch(() => {});
      if (!this.playing && !c.paused) c.pause();
    }

    _tick() {
      if (!this.playing) return;
      if (this.s.currentTime >= this.trimEnd) {
        this.pause();
        this.s.currentTime = this.trimEnd;
        return;
      }
      this._syncCamera(false);
      this._emit('time');
      this._raf = requestAnimationFrame(this._tick);
    }

    _emit(type) {
      this.dispatchEvent(new Event(type));
    }
  }

  root.PipEditor.SyncPlayer = SyncPlayer;
})(self);
