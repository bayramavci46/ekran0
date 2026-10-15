/*
 * Box math for the camera overlay. Boxes are {x, y, w, h} in the same units as the
 * frame size (W × H) they are measured against: stage pixels while editing, output
 * pixels while rendering, or 0..1 fractions when stored ("normalized").
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.PipEditor = root.PipEditor || {}).geometry = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Direction of each resize handle: [-1 = left/top, 0 = middle, 1 = right/bottom].
  const HANDLES = {
    nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
    se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
  };

  const toPx = (b, W, H) => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H });
  const toNorm = (b, W, H) => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });

  /** Scales the box down uniformly if it is larger than the frame, then moves it inside. */
  function fitInside(box, W, H) {
    const s = Math.min(1, W / box.w, H / box.h);
    const w = box.w * s;
    const h = box.h * s;
    return { x: clamp(box.x, 0, W - w), y: clamp(box.y, 0, H - h), w, h };
  }

  function move(box, dx, dy, W, H) {
    return {
      x: clamp(box.x + dx, 0, W - box.w),
      y: clamp(box.y + dy, 0, H - box.h),
      w: box.w,
      h: box.h,
    };
  }

  /** Margin used for corner presets and snapping, like a broadcast "action safe" area. */
  function safeMargin(W, H) {
    return Math.min(W, H) * 0.04;
  }

  function snapLines(W, H) {
    const m = safeMargin(W, H);
    return { x: [0, m, W / 2, W - m, W], y: [0, m, H / 2, H - m, H] };
  }

  /**
   * Snaps the box's start, centre or end edge to the closest line within `threshold`.
   * Returns the snapped box and the lines it snapped to (for drawing guides).
   */
  function snap(box, W, H, lines, threshold) {
    const nearest = (start, size, targets) => {
      let best = null;
      for (const line of targets) {
        for (const edge of [start, start + size / 2, start + size]) {
          const d = line - edge;
          if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.d))) {
            best = { d, line };
          }
        }
      }
      return best;
    };
    const sx = nearest(box.x, box.w, lines.x);
    const sy = nearest(box.y, box.h, lines.y);
    const out = { ...box };
    const guides = { x: [], y: [] };
    if (sx) { out.x = clamp(box.x + sx.d, 0, W - box.w); guides.x.push(sx.line); }
    if (sy) { out.y = clamp(box.y + sy.d, 0, H - box.h); guides.y.push(sy.line); }
    return { box: out, guides };
  }

  /**
   * Resizes `box` by dragging `handle` to (px, py). With `lockAspect` the box scales
   * uniformly from the opposite corner (or opposite edge, staying centred on the other
   * axis); without it each dragged edge follows the pointer. The result never leaves
   * the frame and never gets smaller than minW × minH.
   */
  function resize(box, handle, px, py, W, H, opts) {
    const [hx, hy] = HANDLES[handle];
    const minW = opts.minW || 1;
    const minH = opts.minH || 1;
    const x0 = box.x;
    const y0 = box.y;
    const x1 = box.x + box.w;
    const y1 = box.y + box.h;

    if (opts.lockAspect) {
      const ax = hx === 1 ? x0 : hx === -1 ? x1 : (x0 + x1) / 2;
      const ay = hy === 1 ? y0 : hy === -1 ? y1 : (y0 + y1) / 2;
      let s;
      if (hx !== 0 && hy !== 0) {
        // Project the pointer onto the box diagonal so the drag feels continuous.
        const dx0 = hx * box.w;
        const dy0 = hy * box.h;
        s = ((px - ax) * dx0 + (py - ay) * dy0) / (dx0 * dx0 + dy0 * dy0);
      } else if (hx !== 0) {
        s = ((px - ax) * hx) / box.w;
      } else {
        s = ((py - ay) * hy) / box.h;
      }
      const availW = hx === 1 ? W - ax : hx === -1 ? ax : 2 * Math.min(ax, W - ax);
      const availH = hy === 1 ? H - ay : hy === -1 ? ay : 2 * Math.min(ay, H - ay);
      const sMax = Math.min(availW / box.w, availH / box.h);
      const sMin = Math.min(Math.max(minW / box.w, minH / box.h), sMax);
      s = clamp(s, sMin, sMax);
      const w = box.w * s;
      const h = box.h * s;
      return {
        x: hx === 1 ? ax : hx === -1 ? ax - w : ax - w / 2,
        y: hy === 1 ? ay : hy === -1 ? ay - h : ay - h / 2,
        w,
        h,
      };
    }

    let nx0 = x0;
    let ny0 = y0;
    let nx1 = x1;
    let ny1 = y1;
    if (hx === 1) nx1 = clamp(px, Math.min(x0 + minW, W), W);
    if (hx === -1) nx0 = clamp(px, 0, Math.max(x1 - minW, 0));
    if (hy === 1) ny1 = clamp(py, Math.min(y0 + minH, H), H);
    if (hy === -1) ny0 = clamp(py, 0, Math.max(y1 - minH, 0));
    return { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 };
  }

  /** Uniformly scales the box about (cx, cy), keeping it inside the frame. */
  function scaleAbout(box, factor, cx, cy, W, H, minW) {
    let s = Math.max(factor, (minW || 1) / box.w);
    s = Math.min(s, W / box.w, H / box.h);
    const w = box.w * s;
    const h = box.h * s;
    return fitInside({ x: cx - (cx - box.x) * s, y: cy - (cy - box.y) * s, w, h }, W, H);
  }

  /** Square box with the shorter side, same centre (used for the circle shape). */
  function toSquare(box, W, H) {
    const side = Math.min(box.w, box.h);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return fitInside({ x: cx - side / 2, y: cy - side / 2, w: side, h: side }, W, H);
  }

  /** Same area and centre, new aspect ratio (w / h). */
  function withAspect(box, aspect, W, H) {
    const area = box.w * box.h;
    const w = Math.sqrt(area * aspect);
    const h = w / aspect;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return fitInside({ x: cx - w / 2, y: cy - h / 2, w, h }, W, H);
  }

  /**
   * Moves the box to one of nine anchor positions. `pos` is row + column:
   * t/m/b followed by l/c/r, e.g. "br" for bottom right.
   */
  function placeAt(box, pos, W, H) {
    const m = safeMargin(W, H);
    const row = pos[0];
    const col = pos[1];
    const x = col === 'l' ? m : col === 'r' ? W - m - box.w : (W - box.w) / 2;
    const y = row === 't' ? m : row === 'b' ? H - m - box.h : (H - box.h) / 2;
    return fitInside({ x, y, w: box.w, h: box.h }, W, H);
  }

  /** Default camera box: about a quarter of the frame width, bottom right. */
  function defaultBox(aspect, W, H) {
    let w = W * 0.26;
    let h = w / aspect;
    if (h > H * 0.42) {
      h = H * 0.42;
      w = h * aspect;
    }
    return placeAt({ x: 0, y: 0, w, h }, 'br', W, H);
  }

  /** Source rectangle to crop so the image fills dstW × dstH without distortion. */
  function coverSource(srcW, srcH, dstW, dstH) {
    const s = Math.max(dstW / srcW, dstH / srcH);
    const sw = dstW / s;
    const sh = dstH / s;
    return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
  }

  /** Destination rectangle that shows the whole image inside dstW × dstH (letterboxed). */
  function containRect(srcW, srcH, dstW, dstH) {
    const s = Math.min(dstW / srcW, dstH / srcH);
    const w = srcW * s;
    const h = srcH * s;
    return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
  }

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  /**
   * Output size for a "720p"-style preset: `shortSide` is the target length of the
   * shorter side (so phone-shaped portrait recordings work too). Never upscales.
   */
  function outputSize(srcW, srcH, shortSide) {
    const s = shortSide ? shortSide / Math.min(srcW, srcH) : 1;
    if (s >= 1) return { width: even(srcW), height: even(srcH) };
    return { width: even(srcW * s), height: even(srcH * s) };
  }

  return {
    HANDLES, clamp, toPx, toNorm, fitInside, move, safeMargin, snapLines, snap, resize,
    scaleAbout, toSquare, withAspect, placeAt, defaultBox, coverSource, containRect, even, outputSize,
  };
});
