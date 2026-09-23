/* ═══════════════════════════════════════════════════════
   generator.js — 地形生成算法内核
   两种轮廓线算法：
   1. 中点位移 Midpoint Displacement（分形布朗运动近似）
   2. 正弦叠加 Sine Stack（1/f 风格的多倍频噪声）
   输出全部归一化到 0..1，与分辨率解耦 → 任意尺寸导出
   ═══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const SAMPLES = 513; // 2^9 + 1，中点位移需要 2^n+1 个采样点

  function normalize(arr) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < min) min = arr[i];
      if (arr[i] > max) max = arr[i];
    }
    const span = (max - min) || 1;
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - min) / span;
    return arr;
  }

  /**
   * 中点位移：反复取区间中点 = 两端均值 + 随机扰动，
   * 扰动幅度逐级 ×decay —— 粗糙度越高，山脊越锯齿。
   */
  function midpointDisplacement(roughness, rnd) {
    const segs = SAMPLES - 1; // 512
    const pts = new Array(SAMPLES);
    pts[0] = rnd();
    pts[segs] = rnd();

    let step = segs;
    let amp = 1;
    const decay = 0.25 + roughness * 0.62; // 0.25(平滑山丘) .. 0.87(破碎锯齿)

    while (step > 1) {
      const half = step >> 1;
      for (let i = half; i < segs; i += step) {
        pts[i] = (pts[i - half] + pts[i + half]) * 0.5
               + (rnd() * 2 - 1) * amp * 0.5;
      }
      step = half;
      amp *= decay;
    }
    return normalize(pts);
  }

  /**
   * 正弦叠加：Σ aₖ·sin(2π·fₖ·t + φₖ)
   * 频率逐倍频翻倍、振幅按粗糙度决定的持续度衰减。
   */
  function sineStack(octaves, baseFreq, roughness, rnd) {
    const persistence = 0.28 + roughness * 0.5;
    const waves = [];
    let amp = 1, freq = baseFreq;
    for (let o = 0; o < octaves; o++) {
      waves.push({
        f: freq * (0.8 + rnd() * 0.4),
        p: rnd() * Math.PI * 2,
        a: amp
      });
      amp *= persistence;
      freq *= 2;
    }
    const pts = new Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1);
      let v = 0;
      for (let w = 0; w < waves.length; w++) {
        v += waves[w].a * Math.sin(t * waves[w].f * Math.PI * 2 + waves[w].p);
      }
      pts[i] = v;
    }
    return normalize(pts);
  }

  /** 依参数构建所有山脊层（每层独立随机流，互不干扰） */
  function buildRidges(p) {
    const base = ForgeRNG.seedFrom(p.seed);
    const layers = [];
    for (let i = 0; i < p.layers; i++) {
      const rnd = ForgeRNG.mulberry32((base + i * 0x9E3779B9) >>> 0);
      if (p.mode === 'sine') {
        // 越靠前的层频率越高（近景细节更密）
        layers.push(sineStack(p.octaves, p.baseFreq * (1 + i * 0.28), p.roughness, rnd));
      } else {
        layers.push(midpointDisplacement(p.roughness, rnd));
      }
    }
    return layers;
  }

  /** 星空：归一化坐标 + 相位，渲染时再映射到画布 */
  function buildStars(p) {
    const rnd = ForgeRNG.mulberry32(ForgeRNG.seedFrom(p.seed + '::stars'));
    const stars = [];
    const tints = ['#ffffff', '#cdefff', '#ffd9f0', '#fff3cf', '#bfe0ff'];
    for (let i = 0; i < p.stars; i++) {
      stars.push({
        x: rnd(),
        y: rnd(),
        r: 0.5 + Math.pow(rnd(), 3) * 2.6,   // 大多数很暗，少数是亮星
        a: 0.30 + rnd() * 0.65,
        ph: rnd() * Math.PI * 2,
        sp: 0.6 + rnd() * 2.2,
        tint: tints[(rnd() * tints.length) | 0]
      });
    }
    return stars;
  }

  global.ForgeGen = {
    SAMPLES,
    midpointDisplacement,
    sineStack,
    build(p) {
      return { ridges: buildRidges(p), stars: buildStars(p) };
    }
  };
})(window);
