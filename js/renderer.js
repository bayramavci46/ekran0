/*
 * Draws one composited frame: the screen recording letterboxed to the frame and the
 * camera on top, cropped to its shape. The same function renders the live preview and
 * every exported frame, so what you see is what gets saved.
 *
 * A layer is { source: CanvasImageSource, width, height }.
 * The look is the camera styling from the editor state (box is normalized 0..1).
 */
(function (root) {
  'use strict';
  const G = root.PipEditor.geometry;

  // Border and shadow sizes are authored for a 1080-pixel tall frame and scale with it.
  const REFERENCE = 1080;

  function roundedRect(path, x, y, w, h, r) {
    path.moveTo(x + r, y);
    path.arcTo(x + w, y, x + w, y + h, r);
    path.arcTo(x + w, y + h, x, y + h, r);
    path.arcTo(x, y + h, x, y, r);
    path.arcTo(x, y, x + w, y, r);
    path.closePath();
  }

  function shapePath(box, shape, radius) {
    const path = new Path2D();
    if (shape === 'circle') {
      path.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    } else if (shape === 'rounded') {
      const r = G.clamp(radius, 0, 1) * Math.min(box.w, box.h) / 2;
      roundedRect(path, box.x, box.y, box.w, box.h, r);
    } else {
      path.rect(box.x, box.y, box.w, box.h);
    }
    return path;
  }

  function drawCamera(ctx, W, H, layer, look) {
    const box = G.toPx(look.box, W, H);
    if (box.w < 1 || box.h < 1) return;
    const unit = Math.min(W, H) / REFERENCE;
    const path = shapePath(box, look.shape, look.radius);

    if (look.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 30 * unit;
      ctx.shadowOffsetY = 8 * unit;
      ctx.fillStyle = '#000';
      ctx.fill(path);
      ctx.restore();
    }

    ctx.save();
    ctx.clip(path);
    const src = G.coverSource(layer.width, layer.height, box.w, box.h);
    if (look.mirror) {
      ctx.translate(2 * box.x + box.w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(layer.source, src.sx, src.sy, src.sw, src.sh, box.x, box.y, box.w, box.h);
    ctx.restore();

    const border = look.borderWidth * unit;
    if (border > 0) {
      // Stroke twice the width inside a clip so the whole border sits within the box.
      ctx.save();
      ctx.clip(path);
      ctx.lineWidth = border * 2;
      ctx.strokeStyle = look.borderColor;
      ctx.stroke(path);
      ctx.restore();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} W frame width in canvas pixels
   * @param {number} H frame height in canvas pixels
   * @param {{screen: object|null, camera: object|null, look: object}} scene
   */
  function drawFrame(ctx, W, H, scene) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (scene.screen) {
      const r = G.containRect(scene.screen.width, scene.screen.height, W, H);
      ctx.drawImage(scene.screen.source, r.x, r.y, r.w, r.h);
    }
    if (scene.camera && scene.look.visible) drawCamera(ctx, W, H, scene.camera, scene.look);
    ctx.restore();
  }

  root.PipEditor.renderer = { drawFrame, shapePath };
})(self);
