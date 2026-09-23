/* ═══════════════════════════════════════════════════════
   renderer.js — 场景渲染器
   绘制顺序：天空 → 星空 → 落日 → 地面 → 山脊层 →
             透视网格 → 地平线辉光 → 城市灯带 →
             【Bloom 泛光合成】→ CRT 后期(暗角/扫描线/噪点)
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

  /* ── 离屏缓冲（Bloom 用） ─────────────────── */
  let buf = null, bufCtx = null;
  function ensureBuf(w, h) {
    if (!buf) {
      buf = document.createElement('canvas');
      bufCtx = buf.getContext('2d');
    }
    if (buf.width !== w || buf.height !== h) {
      buf.width = w;
      buf.height = h;
    }
    return bufCtx;
  }

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
      g.fillStyle = 'rgba(0,0,0,0.34)';
      g.fillRect(0, 0, 1, 1);
      g.fillStyle = 'rgba(0,0,0,0.16)';
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
      if (s.r > 1.8) { // 亮星加十字星芒
        ctx.strokeStyle = rgba(s.tint, a * 0.6);
        ctx.lineWidth = Math.max(1, sc * 0.9);
        ctx.beginPath();
        ctx.moveTo(x - r * 4.5, y); ctx.lineTo(x + r * 4.5, y);
        ctx.moveTo(x, y - r * 4.5); ctx.lineTo(x, y + r * 4.5);
        ctx.stroke();
      }
    }
  }

  /* ── 落日：渐变圆盘 + 发光切条 ────────────── */
  function drawSun(ctx, w, horizonY, p, skyGrad) {
    const c = p.colors;
    const R = w * p.sunSize;
    const cx = w / 2;
    const cy = horizonY - p.sunElev * R;
    const sc = Math.max(1, w / 1600);

    // 双层光晕
    const halo2 = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 3.4);
    halo2.addColorStop(0, rgba(c.sunB, 0.20));
    halo2.addColorStop(1, rgba(c.sunB, 0));
    ctx.fillStyle = halo2;
    ctx.fillRect(cx - R * 3.4, cy - R * 3.4, R * 6.8, R * 6.8);

    const halo = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 2.1);
    halo.addColorStop(0, rgba(c.sunA, 0.34));
    halo.addColorStop(1, rgba(c.sunB, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 2.1, cy - R * 2.1, R * 4.2, R * 4.2);

    // 圆盘渐变
    const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    g.addColorStop(0, lighten(c.sunA, 0.25));
    g.addColorStop(0.45, c.sunA);
    g.addColorStop(1, c.sunB);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.closePath();
    ctx.shadowColor = rgba(c.sunB, 0.95);
    ctx.shadowBlur = 60 * (0.4 + p.glow * 0.6) * sc;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 条纹镂空：用同一天空渐变当"洞"，条纹上缘加亮线 → 霓虹切口感
    ctx.clip();
    let y = cy + R * 0.04;
    let band = R * 0.05;
    let gap = R * 0.055;
    while (y < cy + R) {
      ctx.fillStyle = skyGrad;
      ctx.fillRect(cx - R, y, R * 2, band);
      ctx.fillStyle = rgba(lighten(c.sunA, 0.55), 0.95);
      ctx.fillRect(cx - R, y, R * 2, Math.max(1, R * 0.012));
      y += band + gap;
      band *= 1.42;
      gap *= 1.5;
    }
    ctx.restore();

    // 圆盘外缘亮环
    ctx.strokeStyle = rgba(lighten(c.sunA, 0.5), 0.85);
    ctx.lineWidth = Math.max(1.2, R * 0.014);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.stroke();
  }

  /* ── 山脊层：后层亮而高，前层暗而近 —— 三重描边 ── */
  function drawRidges(ctx, w, horizonY, p, ridges) {
    const L = ridges.length;
    const sc = Math.max(1, w / 1600);
    const lineW = Math.max(1.2, sc * 1.6);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < L; i++) {
      const hs = ridges[i];
      const n = hs.length;
      const factor = L > 1 ? 1 - (i / L) * 0.58 : 1;          // 后层(i=0)最高
      const rise = horizonY * 0.94 * p.amplitude * factor;
      const k = L > 1 ? i / (L - 1) : 0;                       // 越靠前越暗
      const base = mix(p.colors.ridge, '#07031a', k * 0.86);
      const rim = mix(base, p.colors.grid, i === 0 ? 0.35 : 0.12);

      // ── 填充体
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(0, horizonY - hs[0] * rise);
      for (let j = 1; j < n; j++) {
        ctx.lineTo((j / (n - 1)) * w, horizonY - hs[j] * rise);
      }
      ctx.lineTo(w, horizonY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, horizonY - rise, 0, horizonY);
      grad.addColorStop(0, mix(base, '#ffffff', 0.07));
      grad.addColorStop(0.5, darken(base, 0.25));
      grad.addColorStop(1, darken(base, 0.62));
      ctx.fillStyle = grad;
      ctx.fill();

      // ── 描边轮廓（复用路径构建）
      const strokePath = () => {
        ctx.beginPath();
        ctx.moveTo(0, horizonY - hs[0] * rise);
        for (let j = 1; j < n; j++) {
          ctx.lineTo((j / (n - 1)) * w, horizonY - hs[j] * rise);
        }
      };

      // 1) 宽幅辉光层
      strokePath();
      ctx.strokeStyle = rgba(rim, 0.28);
      ctx.lineWidth = lineW * 5;
      ctx.stroke();

      // 2) 霓虹本体层（带 shadowBlur）
      strokePath();
      ctx.strokeStyle = rgba(lighten(rim, 0.25), 0.95);
      ctx.lineWidth = lineW * 1.8;
      ctx.shadowColor = rgba(rim, 1);
      ctx.shadowBlur = 22 * p.glow * sc;
      ctx.stroke();

      // 3) 白热芯线
      strokePath();
      ctx.strokeStyle = rgba(lighten(rim, 0.85), 0.95);
      ctx.lineWidth = Math.max(0.8, lineW * 0.7);
      ctx.shadowBlur = 0;
      ctx.stroke();
    }
  }

  /* ── 透视网格（三重线：辉光/本体/亮芯） ────── */
  function drawGrid(ctx, w, h, horizonY, p, t) {
    const col = p.colors.grid;
    const gx = w / 2, gy = horizonY;
    const depth = h - gy;
    if (depth <= 0) return;
    const sc = Math.max(1, w / 1600);

    ctx.save();

    // 放射竖线（消失点在地平线中央）—— 先画辉光宽带，再画亮芯
    const count = Math.round(p.gridDensity);
    const half = w * 1.15;
    const strokeFan = (lw, alpha) => {
      const vGrad = ctx.createLinearGradient(0, gy, 0, h);
      vGrad.addColorStop(0, rgba(col, 0));
      vGrad.addColorStop(0.14, rgba(col, 0.38 * alpha));
      vGrad.addColorStop(1, rgba(col, 0.9 * alpha));
      ctx.strokeStyle = vGrad;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let j = -count; j <= count; j++) {
        ctx.moveTo(gx, gy + 0.5);
        ctx.lineTo(gx + (j / count) * half, h);
      }
      ctx.stroke();
    };
    strokeFan(Math.max(3, 5 * sc), 0.22);
    strokeFan(Math.max(1, 1.3 * sc), 1);

    // 横线：指数透视 y = A·e^(k·(i+φ))，相位循环无缝
    const k = 0.52 - ((p.gridDensity - 8) / 32) * 0.24;
    const A = Math.max(1.2, h * 0.0022);
    const phase = ((t * (0.06 + p.gridSpeed * 0.42)) % 1 + 1) % 1;
    const iMax = Math.min(
      240,
      Math.ceil(Math.log(Math.max(depth * 1.6, A * 2) / A) / k) + 2
    );
    const rows = [];
    for (let i = 0; i <= iMax; i++) {
      const y = gy + A * Math.exp(k * (i + phase));
      if (y > h) break;
      rows.push(y);
    }
    // 辉光带
    ctx.shadowBlur = 0;
    for (let r = 0; r < rows.length; r++) {
      const y = rows[r];
      const f = Math.min(1, (y - gy) / Math.max(depth * 0.3, 1));
      ctx.strokeStyle = rgba(col, 0.10 * f);
      ctx.lineWidth = Math.max(3, 5 * sc);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // 亮芯线
    for (let r = 0; r < rows.length; r++) {
      const y = rows[r];
      const f = Math.min(1, (y - gy) / Math.max(depth * 0.3, 1));
      ctx.strokeStyle = rgba(lighten(col, 0.35), 0.10 + 0.85 * f * f);
      ctx.lineWidth = Math.max(1, 1.3 * sc);
      ctx.shadowColor = rgba(col, 0.9);
      ctx.shadowBlur = 7 * p.glow * sc;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
  }

  /* ── 地平线辉光：暖色氛围带 + 青色主光带 ───── */
  function drawHorizon(ctx, w, h, horizonY, p) {
    const c = p.colors;
    const sc = Math.max(1, w / 1600);
    const r = Math.max(34, h * 0.085);

    // 暖色（天空底色）氛围
    const warm = ctx.createLinearGradient(0, horizonY - r * 1.4, 0, horizonY + r * 0.7);
    warm.addColorStop(0, rgba(c.skyBottom, 0));
    warm.addColorStop(0.6, rgba(lighten(c.skyBottom, 0.15), 0.35 * Math.min(p.glow, 1.5)));
    warm.addColorStop(1, rgba(c.skyBottom, 0));
    ctx.fillStyle = warm;
    ctx.fillRect(0, horizonY - r * 1.4, w, r * 2.1);

    // 青色主光带
    const g = ctx.createLinearGradient(0, horizonY - r, 0, horizonY + r);
    g.addColorStop(0, rgba(c.grid, 0));
    g.addColorStop(0.5, rgba(c.grid, 0.34 * Math.min(p.glow, 1.5)));
    g.addColorStop(1, rgba(c.grid, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizonY - r, w, r * 2);

    // 白热核心线
    ctx.save();
    ctx.shadowColor = rgba(lighten(c.grid, 0.4), 1);
    ctx.shadowBlur = 26 * p.glow * sc;
    ctx.fillStyle = rgba(lighten(c.grid, 0.7), 0.98);
    ctx.fillRect(0, horizonY - Math.max(1, h / 700), w, Math.max(2, h / 340));
    ctx.restore();
  }

  /* ── 地平线城市灯带：霓虹微光柱 ─────────────── */
  function drawCityLights(ctx, w, horizonY, p, lights, t) {
    if (!lights || !lights.length) return;
    const c = p.colors;
    const sc = Math.max(1, w / 1600);
    ctx.save();
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      const lw = Math.max(1.5, L.w * w);
      const lh = (2.5 + L.h * 9) * sc;
      const x = L.x * w;
      const col = L.c < 0.55 ? c.grid : c.sunB;
      const tw = 0.68 + 0.32 * Math.sin(t * 1.7 + L.ph);
      ctx.shadowColor = rgba(col, 1);
      ctx.shadowBlur = 9 * p.glow * sc;
      ctx.fillStyle = rgba(lighten(col, 0.3), 0.95 * tw);
      ctx.fillRect(x, horizonY - lh, lw, lh);
      // 柱底亮点
      ctx.shadowBlur = 0;
      ctx.fillStyle = rgba('#ffffff', 0.9 * tw);
      ctx.fillRect(x, horizonY - lh, lw, Math.max(1, 1.4 * sc));
    }
    ctx.restore();
  }

  /* ── CRT 后期：暗角 + 扫描线 + 胶片噪点 ────── */
  function postProcess(ctx, w, h) {
    const vg = ctx.createRadialGradient(
      w / 2, h * 0.5, Math.min(w, h) * 0.3,
      w / 2, h * 0.5, Math.max(w, h) * 0.82
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    const scan = ctx.createPattern(getScanSrc(), 'repeat');
    if (scan) {
      ctx.globalAlpha = Math.min(1, Math.max(0.5, w / 2400));
      ctx.fillStyle = scan;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    const noise = ctx.createPattern(getNoiseSrc(), 'repeat');
    if (noise) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = noise;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* ── 场景绘制（进离屏缓冲，不含后期） ──────── */
  function drawScene(ctx, w, h, p, geo, t) {
    const horizonY = h * p.horizon;
    const c = p.colors;
    ctx.clearRect(0, 0, w, h);

    // 1. 天空渐变（更深邃的顶部 → 底部高饱和）
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, darken(c.skyTop, 0.25));
    sky.addColorStop(0.38, c.skyTop);
    sky.addColorStop(0.78, mix(c.skyTop, c.skyBottom, 0.62));
    sky.addColorStop(1, lighten(c.skyBottom, 0.1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizonY + 1);

    // 2. 星空
    drawStars(ctx, w, horizonY, geo.stars, t);

    // 3. 落日（低于地平线的部分随后被地面覆盖）
    drawSun(ctx, w, horizonY, p, sky);

    // 4. 地面（比之前更深，反衬霓虹）
    const ground = mix(mix(c.skyTop, c.skyBottom, 0.18), '#000004', 0.78);
    const gg = ctx.createLinearGradient(0, horizonY, 0, h);
    gg.addColorStop(0, mix(c.skyBottom, ground, 0.55));
    gg.addColorStop(0.14, ground);
    gg.addColorStop(1, darken(ground, 0.5));
    ctx.fillStyle = gg;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // 5. 山脊
    drawRidges(ctx, w, horizonY, p, geo.ridges);

    // 6. 网格
    drawGrid(ctx, w, h, horizonY, p, t);

    // 7. 地平线
    drawHorizon(ctx, w, h, horizonY, p);

    // 8. 城市灯带
    drawCityLights(ctx, w, horizonY, p, geo.lights, t);
  }

  /* ── 主渲染入口：Bloom 泛光 + CRT 后期 ────── */
  function render(ctx, w, h, p, geo, t) {
    if (!ctx || w < 2 || h < 2 || !geo) return;

    // 1) 场景 → 离屏缓冲
    const bctx = ensureBuf(w, h);
    drawScene(bctx, w, h, p, geo, t);

    // 2) 合成到目标
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(buf, 0, 0);

    // 3) Bloom：模糊副本以 additive 叠加 → 霓虹泛光
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.38;
    ctx.filter = 'blur(' + Math.max(4, Math.round(w / 260)) + 'px) saturate(1.5)';
    ctx.drawImage(buf, 0, 0);
    // 第二遍小半径强化近处辉光
    ctx.globalAlpha = 0.22;
    ctx.filter = 'blur(' + Math.max(2, Math.round(w / 700)) + 'px)';
    ctx.drawImage(buf, 0, 0);
    ctx.restore();

    // 4) CRT 后期
    postProcess(ctx, w, h);
  }

  global.ForgeRender = { render };
})(window);
