/* ═══════════════════════════════════════════════════════
   renderer.js — 场景渲染器
   绘制顺序：天空 → 星空 → 落日 → 地面 → 山脊层 →
             透视网格 → 地平线辉光 → 暗角/扫描线/噪点
   同一函数同时服务于实时预览与任意分辨率 PNG 导出。
   ═══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── 颜色工具 ─────────────────────────────── */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    const n = m ? parseInt(m[1], 16) : 0x000000;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function mix(a, b, k) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return '#' + A.map((v, i) =>
      Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')
    ).join('');
  }
  const lighten = (c, k) => mix(c, '#ffffff', k);
  const darken  = (c, k) => mix(c, '#000000', k);

  /* ── 噪点 / 扫描线图案（懒创建，模块级缓存） ── */
  let noiseSrc = null, scanSrc = null;

  function getNoiseSrc() {
    if (!noiseSrc) {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const g = c.getContext('2d');
      const img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + Math.random() * 145;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      noiseSrc = c;
    }
    return noiseSrc;
  }
  function getScanSrc() {
    if (!scanSrc) {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.fillRect(0, 0, 1, 1);
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.fillRect(0, 1, 1, 1);
      scanSrc = c;
    }
    return scanSrc;
  }

  /* ── 星空 ─────────────────────────────────── */
  function drawStars(ctx, w, horizonY, stars, t) {
    const limit = horizonY * 0.985;
    const sc = Math.max(1, w / 1600);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      const a = s.a * tw;
      const x = s.x * w, y = s.y * limit, r = s.r * sc;
      ctx.fillStyle = rgba(s.tint, a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
      if (s.r > 2.1) { // 亮星加十字星芒
        ctx.strokeStyle = rgba(s.tint, a * 0.55);
        ctx.lineWidth = Math.max(1, sc * 0.9);
        ctx.beginPath();
        ctx.moveTo(x - r * 4, y); ctx.lineTo(x + r * 4, y);
        ctx.moveTo(x, y - r * 4); ctx.lineTo(x, y + r * 4);
        ctx.stroke();
      }
    }
  }

  /* ── 落日（渐变圆盘 + 反切条纹） ───────────── */
  function drawSun(ctx, w, horizonY, p, skyGrad) {
    const c = p.colors;
    const R = w * p.sunSize;
    const cx = w / 2;
    const cy = horizonY - p.sunElev * R;

    // 光晕
    const halo = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 2.5);
    halo.addColorStop(0, rgba(c.sunB, 0.32));
    halo.addColorStop(1, rgba(c.sunB, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 2.5, cy - R * 2.5, R * 5, R * 5);

    // 圆盘
    const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    g.addColorStop(0, c.sunA);
    g.addColorStop(1, c.sunB);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.closePath();
    ctx.shadowColor = rgba(c.sunB, 0.85);
    ctx.shadowBlur = 46 * (0.4 + p.glow * 0.6);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 条纹镂空：用同一天空渐变当"洞"，视觉上像被切开
    ctx.clip();
    let y = cy + R * 0.02;
    let band = R * 0.045;
    let gap = R * 0.055;
    while (y < cy + R) {
      ctx.fillStyle = skyGrad;
      ctx.fillRect(cx - R, y, R * 2, band);
      y += band + gap;
      band *= 1.42;
      gap *= 1.5;
    }
    ctx.restore();
  }

  /* ── 山脊层：后层亮而高，前层暗而近 ─────────── */
  function drawRidges(ctx, w, horizonY, p, ridges) {
    const L = ridges.length;
    const lineW = Math.max(1.1, w / 1500 * 1.5);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < L; i++) {
      const hs = ridges[i];
      const n = hs.length;
      const factor = L > 1 ? 1 - (i / L) * 0.58 : 1;          // 后层(i=0)最高
      const rise = horizonY * 0.94 * p.amplitude * factor;
      const k = L > 1 ? i / (L - 1) : 0;                       // 越靠前越暗
      const base = mix(p.colors.ridge, '#07031a', k * 0.88);

      // 填充体
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(0, horizonY - hs[0] * rise);
      for (let j = 1; j < n; j++) {
        ctx.lineTo((j / (n - 1)) * w, horizonY - hs[j] * rise);
      }
      ctx.lineTo(w, horizonY);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, horizonY - rise, 0, horizonY);
      grad.addColorStop(0, mix(base, '#ffffff', 0.05));
      grad.addColorStop(1, darken(base, 0.58));
      ctx.fillStyle = grad;
      ctx.fill();

      // 霓虹描边
      ctx.beginPath();
      ctx.moveTo(0, horizonY - hs[0] * rise);
      for (let j = 1; j < n; j++) {
        ctx.lineTo((j / (n - 1)) * w, horizonY - hs[j] * rise);
      }
      ctx.strokeStyle = lighten(base, 0.45);
      ctx.lineWidth = lineW;
      ctx.shadowColor = rgba(lighten(base, 0.15), 0.95);
      ctx.shadowBlur = 16 * p.glow;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  /* ── 透视网格 ─────────────────────────────── */
  function drawGrid(ctx, w, h, horizonY, p, t) {
    const col = p.colors.grid;
    const gx = w / 2, gy = horizonY;
    const depth = h - gy;
    if (depth <= 0) return;

    ctx.save();
    ctx.lineWidth = Math.max(1, w / 1700);
    ctx.shadowColor = rgba(col, 0.9);
    ctx.shadowBlur = 9 * p.glow;

    // 放射竖线（消失点在地平线中央）
    const vGrad = ctx.createLinearGradient(0, gy, 0, h);
    vGrad.addColorStop(0, rgba(col, 0));
    vGrad.addColorStop(0.14, rgba(col, 0.38));
    vGrad.addColorStop(1, rgba(col, 0.85));
    ctx.strokeStyle = vGrad;
    const count = Math.round(p.gridDensity);
    const half = w * 1.15;
    ctx.beginPath();
    for (let j = -count; j <= count; j++) {
      ctx.moveTo(gx, gy + 0.5);
      ctx.lineTo(gx + (j / count) * half, h);
    }
    ctx.stroke();

    // 横线：指数透视 y = A·e^(k·(i+φ))，相位循环无缝
    const k = 0.52 - ((p.gridDensity - 8) / 32) * 0.24;   // 密度越高 k 越小
    const A = Math.max(1.2, h * 0.0022);
    const phase = ((t * (0.06 + p.gridSpeed * 0.42)) % 1 + 1) % 1;
    const iMax = Math.min(
      240,
      Math.ceil(Math.log(Math.max(depth * 1.6, A * 2) / A) / k) + 2
    );
    for (let i = 0; i <= iMax; i++) {
      const y = gy + A * Math.exp(k * (i + phase));
      if (y > h) break;
      const f = Math.min(1, (y - gy) / Math.max(depth * 0.3, 1));
      ctx.strokeStyle = rgba(col, 0.08 + 0.72 * f * f);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── 地平线辉光 ───────────────────────────── */
  function drawHorizon(ctx, w, h, horizonY, p) {
    const col = p.colors.grid;
    const r = Math.max(26, h * 0.055);
    const g = ctx.createLinearGradient(0, horizonY - r, 0, horizonY + r);
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.5, rgba(col, 0.30 * Math.min(p.glow, 1.4)));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizonY - r, w, r * 2);

    ctx.save();
    ctx.shadowColor = rgba(lighten(col, 0.4), 1);
    ctx.shadowBlur = 20 * p.glow;
    ctx.fillStyle = rgba(lighten(col, 0.55), 0.95);
    ctx.fillRect(0, horizonY - Math.max(1, h / 700), w, Math.max(2, h / 350));
    ctx.restore();
  }

  /* ── CRT 后期：暗角 + 扫描线 + 胶片噪点 ────── */
  function postProcess(ctx, w, h) {
    // 暗角
    const vg = ctx.createRadialGradient(
      w / 2, h * 0.5, Math.min(w, h) * 0.32,
      w / 2, h * 0.5, Math.max(w, h) * 0.8
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.52)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // 扫描线
    const scan = ctx.createPattern(getScanSrc(), 'repeat');
    if (scan) {
      ctx.globalAlpha = Math.min(1, Math.max(0.5, w / 2400));
      ctx.fillStyle = scan;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // 颗粒噪点
    const noise = ctx.createPattern(getNoiseSrc(), 'repeat');
    if (noise) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.055;
      ctx.fillStyle = noise;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* ── 主渲染入口 ───────────────────────────── */
  function render(ctx, w, h, p, geo, t) {
    if (!ctx || w < 2 || h < 2 || !geo) return;

    const horizonY = h * p.horizon;
    const c = p.colors;

    ctx.clearRect(0, 0, w, h);

    // 1. 天空渐变
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, c.skyTop);
    sky.addColorStop(0.55, mix(c.skyTop, c.skyBottom, 0.48));
    sky.addColorStop(1, c.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizonY + 1);

    // 2. 星空
    drawStars(ctx, w, horizonY, geo.stars, t);

    // 3. 落日（低于地平线的部分随后被地面覆盖）
    drawSun(ctx, w, horizonY, p, sky);

    // 4. 地面
    const ground = mix(mix(c.skyTop, c.skyBottom, 0.22), '#000005', 0.72);
    const gg = ctx.createLinearGradient(0, horizonY, 0, h);
    gg.addColorStop(0, mix(c.skyBottom, ground, 0.6));
    gg.addColorStop(0.16, ground);
    gg.addColorStop(1, darken(ground, 0.45));
    ctx.fillStyle = gg;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // 5. 山脊
    drawRidges(ctx, w, horizonY, p, geo.ridges);

    // 6. 网格
    drawGrid(ctx, w, h, horizonY, p, t);

    // 7. 地平线
    drawHorizon(ctx, w, h, horizonY, p);

    // 8. CRT 后期
    postProcess(ctx, w, h);
  }

  global.ForgeRender = { render };
})(window);
