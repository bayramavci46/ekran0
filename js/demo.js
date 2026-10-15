/*
 * Example pictures shown before any recording is loaded, so the editor opens in a
 * working state: a code-editor "screen" and a webcam-style "camera" you can already
 * drag and resize. Also draws the placeholder used when only the camera is loaded.
 */
(function (root) {
  'use strict';

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Syntax-coloured "code" lines: [indent, [width, colour]...]
  const CODE = [
    [0, [90, '#d98e3b'], [210, '#c9d3d1']],
    [1, [140, '#6fb8b0'], [60, '#c9d3d1'], [180, '#e2b86b']],
    [1, [120, '#6fb8b0'], [260, '#8fa3a1']],
    [2, [80, '#d98e3b'], [150, '#c9d3d1'], [90, '#e2b86b']],
    [2, [220, '#c9d3d1'], [70, '#6fb8b0']],
    [1, [40, '#c9d3d1']],
    [0],
    [0, [130, '#7c8f8d'], [300, '#7c8f8d']],
    [0, [90, '#d98e3b'], [170, '#c9d3d1'], [60, '#e2b86b']],
    [1, [160, '#6fb8b0'], [240, '#c9d3d1']],
    [1, [110, '#d98e3b'], [90, '#c9d3d1']],
    [2, [200, '#e2b86b'], [120, '#c9d3d1']],
    [2, [140, '#c9d3d1'], [180, '#6fb8b0']],
    [1, [40, '#c9d3d1']],
    [0, [40, '#c9d3d1']],
  ];

  function drawScreen(c) {
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#24383d');
    bg.addColorStop(1, '#0e1618');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Editor window
    const wx = 110;
    const wy = 80;
    const ww = W - 220;
    const wh = H - 170;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 18;
    roundRect(ctx, wx, wy, ww, wh, 18);
    ctx.fillStyle = '#182022';
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, wx, wy, ww, wh, 18);
    ctx.clip();
    ctx.fillStyle = '#212b2e';
    ctx.fillRect(wx, wy, ww, 56);
    ['#e06c5b', '#e2b14f', '#6cc28a'].forEach((col, i) => {
      ctx.beginPath();
      ctx.arc(wx + 34 + i * 30, wy + 28, 9, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    });
    ctx.fillStyle = '#8b9b9a';
    ctx.font = '500 24px "Barlow", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('ders-03 / sunum.js', wx + 140, wy + 29);

    // File tree
    ctx.fillStyle = '#1c2527';
    ctx.fillRect(wx, wy + 56, 330, wh - 56);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i === 3 ? 'rgba(240,167,58,0.18)' : 'transparent';
      ctx.fillRect(wx, wy + 92 + i * 46 - 16, 330, 40);
      ctx.fillStyle = i === 3 ? '#f0a73a' : '#55686a';
      roundRect(ctx, wx + 40 + (i % 4 === 0 ? 0 : 26), wy + 86 + i * 46 - 6, 110 + ((i * 37) % 90), 14, 7);
      ctx.fill();
    }

    // Code with line numbers
    const cx = wx + 330;
    ctx.font = '400 22px "JetBrains Mono", ui-monospace, monospace';
    CODE.forEach((line, i) => {
      const y = wy + 110 + i * 48;
      ctx.fillStyle = '#4a5b5d';
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), cx + 64, y);
      ctx.textAlign = 'left';
      let x = cx + 104 + line[0] * 44;
      for (let j = 1; j < line.length; j++) {
        const [w, col] = line[j];
        ctx.fillStyle = col;
        roundRect(ctx, x, y - 8, w, 16, 8);
        ctx.fill();
        x += w + 18;
      }
    });
    // Current line highlight
    ctx.fillStyle = 'rgba(240,167,58,0.08)';
    ctx.fillRect(cx, wy + 110 + 9 * 48 - 22, ww - 330, 44);
    ctx.restore();

    // Mouse pointer
    ctx.save();
    ctx.translate(1060, 540);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 44);
    ctx.lineTo(11, 33);
    ctx.lineTo(20, 52);
    ctx.lineTo(28, 48);
    ctx.lineTo(19, 30);
    ctx.lineTo(34, 30);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawCamera(c) {
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#4b3a2c');
    bg.addColorStop(1, '#1b1512');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Soft window light and lamp bokeh
    const glow = ctx.createRadialGradient(W * 0.82, H * 0.2, 10, W * 0.82, H * 0.2, W * 0.45);
    glow.addColorStop(0, 'rgba(255,214,150,0.55)');
    glow.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    [[0.12, 0.25, 50], [0.2, 0.6, 34], [0.9, 0.7, 40]].forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(W * x, H * y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,200,130,0.12)';
      ctx.fill();
    });

    // Person silhouette with a warm rim light
    const cx = W / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(255,190,110,0.55)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#120e0c';
    ctx.beginPath();
    ctx.ellipse(cx, H * 1.02, W * 0.3, H * 0.36, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - 46, H * 0.52, 92, H * 0.2);
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.42, 108, 132, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlaceholder(c) {
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    ctx.fillStyle = '#0c1112';
    ctx.fillRect(0, 0, W, H);
    ctx.setLineDash([22, 16]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#3a4a4d';
    roundRect(ctx, 80, 80, W - 160, H - 160, 24);
    ctx.stroke();
    ctx.fillStyle = '#8b9b9a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 56px "Barlow", system-ui, sans-serif';
    ctx.fillText('Ekran kaydını yükleyin', W / 2, H / 2 - 30);
    ctx.font = '400 34px "Barlow", system-ui, sans-serif';
    ctx.fillText('Kamera kaydınız bu görüntünün üstünde yer alacak', W / 2, H / 2 + 40);
  }

  function create() {
    const screen = canvas(1920, 1080);
    const camera = canvas(1280, 720);
    const placeholder = canvas(1920, 1080);
    const paint = () => {
      drawScreen(screen);
      drawCamera(camera);
      drawPlaceholder(placeholder);
    };
    paint();
    return {
      screen: { source: screen, width: screen.width, height: screen.height },
      camera: { source: camera, width: camera.width, height: camera.height },
      placeholder: { source: placeholder, width: placeholder.width, height: placeholder.height },
      repaint: paint,
    };
  }

  root.PipEditor.demo = { create };
})(self);
