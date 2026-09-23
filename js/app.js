/* ═══════════════════════════════════════════════════════
   app.js — 控制台装配 · 实时预览 · PNG 导出
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 调色板 ───────────────────────────────── */
  const PALETTES = [
    { id: 'OUTRUN', label: 'OUTRUN', colors: {
      skyTop: '#0b0130', skyBottom: '#7a1065', sunA: '#ffe66d',
      sunB: '#ff2d95', grid: '#22e6ff', ridge: '#ff3fa4' } },
    { id: 'MIAMI', label: 'MIAMI', colors: {
      skyTop: '#02102e', skyBottom: '#14707e', sunA: '#ffd166',
      sunB: '#ff5e7e', grid: '#4fffe0', ridge: '#ff8fb1' } },
    { id: 'NOIR', label: 'NOIR', colors: {
      skyTop: '#05060c', skyBottom: '#33203a', sunA: '#ffb347',
      sunB: '#ff3b30', grid: '#35d0ba', ridge: '#e64a5c' } },
    { id: 'DUNE', label: 'DUNE', colors: {
      skyTop: '#170a05', skyBottom: '#b2431f', sunA: '#ffe0b0',
      sunB: '#ff7b00', grid: '#ffd166', ridge: '#ff8c42' } },
    { id: 'VAPOR', label: 'VAPOR', colors: {
      skyTop: '#2a1a4a', skyBottom: '#ff9a9e', sunA: '#fff5e6',
      sunB: '#ffc2e0', grid: '#b388ff', ridge: '#ffafcc' } }
  ];

  const DEFAULTS = {
    seed: 1984,
    mode: 'midpoint',
    layers: 4,
    amplitude: 0.62,
    roughness: 0.55,
    octaves: 5,
    baseFreq: 1.6,
    horizon: 0.54,
    sunSize: 0.13,
    sunElev: 0.9,
    stars: 180,
    glow: 1.0,
    gridDensity: 24,
    gridSpeed: 0.4,
    palette: 'OUTRUN',
    colors: { ...PALETTES[0].colors }
  };

  /* 控件配置：type = range | seg | palette | color */
  const SECTIONS = [
    { idx: '01', title: '地形 TERRAIN', items: [
      { type: 'seg', key: 'mode', label: '轮廓算法', en: 'ALGORITHM',
        options: [['midpoint', '中点位移 MDP'], ['sine', '正弦叠加 SINE']] },
      { type: 'range', key: 'layers', label: '山脊层数', en: 'LAYERS', min: 1, max: 6, step: 1 },
      { type: 'range', key: 'amplitude', label: '山脊振幅', en: 'AMPLITUDE', min: 0.15, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
      { type: 'range', key: 'roughness', label: '粗糙度', en: 'ROUGHNESS', min: 0.05, max: 0.98, step: 0.01, fmt: v => v.toFixed(2) },
      { type: 'range', key: 'octaves', label: '正弦倍频', en: 'OCTAVES', min: 1, max: 8, step: 1, when: p => p.mode === 'sine' },
      { type: 'range', key: 'baseFreq', label: '基础频率', en: 'FREQ', min: 0.5, max: 5, step: 0.1, fmt: v => v.toFixed(1), when: p => p.mode === 'sine' }
    ]},
    { idx: '02', title: '天体 CELESTIAL', items: [
      { type: 'range', key: 'horizon', label: '地平线高度', en: 'HORIZON', min: 0.3, max: 0.75, step: 0.005, fmt: v => Math.round(v * 100) + '%' },
      { type: 'range', key: 'sunSize', label: '太阳大小', en: 'SUN SIZE', min: 0.06, max: 0.24, step: 0.005, fmt: v => Math.round(v * 100) + '%' },
      { type: 'range', key: 'sunElev', label: '太阳高度', en: 'SUN LIFT', min: 0.1, max: 1.6, step: 0.02, fmt: v => v.toFixed(2) },
      { type: 'range', key: 'stars', label: '星空密度', en: 'STARS', min: 0, max: 400, step: 5 },
      { type: 'range', key: 'glow', label: '辉光强度', en: 'GLOW', min: 0, max: 2, step: 0.05, fmt: v => v.toFixed(2) }
    ]},
    { idx: '03', title: '网格 GRID', items: [
      { type: 'range', key: 'gridDensity', label: '网格密度', en: 'DENSITY', min: 8, max: 40, step: 1 },
      { type: 'range', key: 'gridSpeed', label: '滚动速度', en: 'SPEED', min: 0, max: 1, step: 0.01, fmt: v => v.toFixed(2) }
    ]},
    { idx: '04', title: '调色 PALETTE', items: [
      { type: 'palette' },
      { type: 'colors', list: [
        ['colors.skyTop', '天空顶部', 'SKY TOP'],
        ['colors.skyBottom', '地平线', 'HORIZON'],
        ['colors.sunA', '太阳亮色', 'SUN TOP'],
        ['colors.sunB', '太阳暗色', 'SUN BASE'],
        ['colors.grid', '网格线', 'GRID'],
        ['colors.ridge', '山脊线', 'RIDGE']
      ]}
    ]}
  ];

  const GEO_KEYS = new Set(['seed', 'mode', 'layers', 'roughness', 'octaves', 'baseFreq', 'stars']);

  /* ── 状态 ─────────────────────────────────── */
  let params = clone(DEFAULTS);
  let geo = null;
  let animTime = 0;
  let lastTs = performance.now();

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const stage = document.querySelector('.stage');
  const controlsBox = document.getElementById('controls');

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function get(k) { return k.split('.').reduce((a, key) => a[key], params); }
  function set(k, v) {
    const ks = k.split('.');
    const last = ks.pop();
    ks.reduce((a, key) => a[key], params)[last] = v;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ── 变更管线 ─────────────────────────────── */
  function onChange(key) {
    if (GEO_KEYS.has(key)) geo = ForgeGen.build(params);
    updateHUD();
  }

  function updateHUD() {
    document.getElementById('hud-seed').textContent = params.seed;
    document.getElementById('hud-algo').textContent =
      params.mode === 'sine' ? 'SINE STACK' : 'MIDPOINT DISPLACEMENT';
    document.getElementById('hud-layers').textContent =
      params.layers + '× / ' + Math.round(params.roughness * 100) + 'R';
  }

  /* ── 控件构建 ─────────────────────────────── */
  function paintRange(spec, input, valEl) {
    const v = parseFloat(input.value);
    valEl.textContent = spec.fmt ? spec.fmt(v) : String(+v.toFixed(2));
    input.style.setProperty(
      '--p',
      ((v - spec.min) / (spec.max - spec.min)) * 100 + '%'
    );
  }

  function buildRange(spec) {
    const wrap = el('label', 'ctrl');
    const top = el('div', 'ctrl__top');
    const name = el('span', 'ctrl__name', spec.label);
    const en = document.createElement('i');
    en.textContent = spec.en || '';
    name.appendChild(en);
    const val = el('b', 'ctrl__val');
    top.append(name, val);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = spec.min; input.max = spec.max; input.step = spec.step;
    input.value = get(spec.key);

    paintRange(spec, input, val);
    input.addEventListener('input', () => {
      set(spec.key, parseFloat(input.value));
      paintRange(spec, input, val);
      onChange(spec.key);
      if (spec.key === 'mode') buildControls(); // 显隐正弦专属控件
    });

    wrap.append(top, input);
    if (spec.when && !spec.when(params)) wrap.style.display = 'none';
    return wrap;
  }

  function buildSeg(spec) {
    const wrap = el('div', 'ctrl ctrl--seg');
    const top = el('div', 'ctrl__top');
    const name = el('span', 'ctrl__name', spec.label);
    const en = document.createElement('i');
    en.textContent = spec.en || '';
    name.appendChild(en);
    wrap.appendChild(top);
    top.append(name);

    const seg = el('div', 'seg');
    spec.options.forEach(([val, text]) => {
      const b = el('button', null, text);
      b.type = 'button';
      if (get(spec.key) === val) b.classList.add('is-active');
      b.addEventListener('click', () => {
        if (get(spec.key) === val) return;
        set(spec.key, val);
        onChange(spec.key);
        buildControls();
      });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }

  function buildPalette() {
    const wrap = el('div', 'ctrl');
    const top = el('div', 'ctrl__top');
    const name = el('span', 'ctrl__name', '预设色板');
    const en = document.createElement('i');
    en.textContent = 'PRESETS';
    name.appendChild(en);
    const val = el('b', 'ctrl__val', params.palette);
    val.id = 'palette-val';
    top.append(name, val);
    wrap.appendChild(top);

    const row = el('div', 'pal-row');
    PALETTES.forEach(pal => {
      const chip = el('button', 'pal-chip');
      chip.type = 'button';
      if (params.palette === pal.id) chip.classList.add('is-active');
      chip.style.background =
        'linear-gradient(180deg,' + pal.colors.skyTop + ',' +
        pal.colors.skyBottom + ' 70%,' + pal.colors.grid + ')';
      chip.appendChild(el('span', null, pal.label));
      chip.title = pal.label + ' 配色';
      chip.addEventListener('click', () => {
        params.palette = pal.id;
        params.colors = clone(pal.colors);
        buildControls();
        toast('调色板 · ' + pal.label);
      });
      row.appendChild(chip);
    });
    wrap.appendChild(row);
    return wrap;
  }

  function buildColors(spec) {
    const wrap = el('div', 'ctrl');
    const top = el('div', 'ctrl__top');
    const name = el('span', 'ctrl__name', '自定义颜色');
    const en = document.createElement('i');
    en.textContent = 'CUSTOM';
    name.appendChild(en);
    top.append(name);
    wrap.appendChild(top);

    const grid = el('div', 'colors');
    spec.list.forEach(([key, zh, enLabel]) => {
      const item = el('div', 'color-ctrl');
      const input = document.createElement('input');
      input.type = 'color';
      input.value = get(key);
      const id = 'clr-' + key.replace('.', '-');
      input.id = id;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.innerHTML = ''; // 防 XSS，全部用 textContent 构建
      label.appendChild(document.createTextNode(zh));
      const small = document.createElement('b');
      small.textContent = enLabel;
      label.appendChild(small);

      input.addEventListener('input', () => {
        set(key, input.value);
        params.palette = 'CUSTOM';
        const chipHost = document.getElementById('palette-val');
        if (chipHost) chipHost.textContent = 'CUSTOM';
      });
      item.append(input, label);
      grid.appendChild(item);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function buildControls() {
    controlsBox.textContent = '';
    SECTIONS.forEach(sec => {
      const box = el('div', 'section');
      const head = el('div', 'section__head');
      head.appendChild(el('i', null, sec.idx));
      head.appendChild(document.createTextNode(sec.title));
      box.appendChild(head);

      sec.items.forEach(spec => {
        if (spec.when && !spec.when(params)) return;
        if (spec.type === 'range') box.appendChild(buildRange(spec));
        else if (spec.type === 'seg') box.appendChild(buildSeg(spec));
        else if (spec.type === 'palette') box.appendChild(buildPalette());
        else if (spec.type === 'colors') box.appendChild(buildColors(spec));
      });
      controlsBox.appendChild(box);
    });
  }

  /* ── 种子 & 随机 ──────────────────────────── */
  const seedInput = document.getElementById('seed');

  function applySeed(v, rebuildControls) {
    params.seed = Math.max(0, Math.min(99999999, v | 0));
    seedInput.value = params.seed;
    onChange('seed');
    if (rebuildControls) buildControls();
  }

  seedInput.addEventListener('change', () => applySeed(+seedInput.value || 0, false));
  document.getElementById('roll').addEventListener('click', () => {
    applySeed((Math.random() * 99999999) | 0, false);
    toast('新种子 · ' + params.seed);
  });

  function randomize() {
    const r = Math.random;
    params.mode = r() < 0.5 ? 'midpoint' : 'sine';
    params.layers = 3 + ((r() * 4) | 0);
    params.roughness = +(0.25 + r() * 0.6).toFixed(2);
    params.amplitude = +(0.4 + r() * 0.45).toFixed(2);
    params.octaves = 3 + ((r() * 5) | 0);
    params.baseFreq = +(0.8 + r() * 2.6).toFixed(1);
    params.horizon = +(0.42 + r() * 0.2).toFixed(3);
    params.sunSize = +(0.09 + r() * 0.1).toFixed(3);
    params.sunElev = +(0.4 + r() * 1.0).toFixed(2);
    params.gridDensity = 14 + ((r() * 22) | 0);
    params.stars = 80 + ((r() * 260) / 5 | 0) * 5;
    applySeed((r() * 99999999) | 0, true);
    toast('◈ 随机参数已生成');
  }

  document.getElementById('randomize').addEventListener('click', randomize);

  document.getElementById('reset').addEventListener('click', () => {
    params = clone(DEFAULTS);
    seedInput.value = params.seed;
    onChange('seed');
    buildControls();
    toast('↺ 已重置为默认场景');
  });

  /* ── 导出 PNG ─────────────────────────────── */
  function exportPNG() {
    const sel = document.getElementById('resolution');
    const [w, h] = sel.value.split('x').map(Number);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    ForgeRender.render(octx, w, h, params, geo, animTime);
    off.toBlob(blob => {
      if (!blob) { toast('导出失败'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'synthwave-forge_' + params.seed + '_' + w + 'x' + h + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('⬇ 已导出 ' + w + '×' + h + ' PNG');
    }, 'image/png');
  }

  document.getElementById('export').addEventListener('click', exportPNG);

  /* ── 快捷键 ───────────────────────────────── */
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'r' || e.key === 'R') randomize();
    if (e.key === 'e' || e.key === 'E') exportPNG();
  });

  /* ── 提示条 ───────────────────────────────── */
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-show'), 2200);
  }

  /* ── 画布尺寸 ─────────────────────────────── */
  function resize() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(r.width * dpr));
    const h = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);

  /* ── 主循环 ───────────────────────────────── */
  function frame(now) {
    const dt = Math.min((now - lastTs) / 1000, 0.1);
    lastTs = now;
    if (!reduceMotion) animTime += dt;
    resize();
    ForgeRender.render(ctx, canvas.width, canvas.height, params, geo, animTime);
    requestAnimationFrame(frame);
  }

  /* ── 启动 ─────────────────────────────────── */
  geo = ForgeGen.build(params);
  seedInput.value = params.seed;
  buildControls();
  updateHUD();
  resize();
  requestAnimationFrame(frame);
})();
