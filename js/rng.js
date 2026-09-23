/* ═══════════════════════════════════════════════════════
   rng.js — 确定性随机内核
   同一个种子 → 同一条山脊线（可复现的版画）
   ═══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /** mulberry32：小巧、快速、分布良好的 32 位 PRNG */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 任意字符串/数字 → 32 位种子（FNV-1a 变体混合） */
  function seedFrom(value) {
    const str = String(value);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  global.ForgeRNG = { mulberry32, seedFrom };
})(window);
