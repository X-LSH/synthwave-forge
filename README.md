# SYNTHWAVE FORGE · 合成波地平线

> 程序化生成霓虹地平线场景 —— **地形生成算法的美术输出**
> 随机山脉轮廓线 + 落日 + 透视网格 + 星空，全部可调，一键导出 PNG。

**🎮 [在线体验 →](https://x-lsh.github.io/synthwave-forge/)**

![palette](https://img.shields.io/badge/style-synthwave-ff2d95) ![deps](https://img.shields.io/badge/dependencies-zero-22e6ff) ![license](https://img.shields.io/badge/license-MIT-8a5cff)

## ✨ 特性

- **双算法轮廓线**
  - **中点位移 Midpoint Displacement**（MDP）：分形布朗运动的经典近似，512 段递归细分，粗糙度控制每级扰动衰减
  - **正弦叠加 Sine Stack**：`Σ aₖ·sin(2π·fₖ·t + φₖ)`，倍频翻倍 + 持续度衰减，调出 1/f 风格的连绵山峦
- **确定性随机**：mulberry32 PRNG，同一个种子永远生成同一条山脊 —— 每个 seed 就是一张独立版画
- **全场景可调**：山脊层数/振幅/粗糙度、地平线高度、太阳大小与悬浮高度、星空密度、网格密度与滚动速度、辉光强度
- **5 套预设色板**：OUTRUN / MIAMI / NOIR / DUNE / VAPOR，外加 6 个自定义取色器
- **高分辨率导出**：FHD / QHD / **4K** / 方形 / 竖屏，场景以归一化坐标绘制，任意分辨率不失真
- **CRT 后期**：暗角、扫描线、胶片噪点实时合成，所见即所得
- **快捷键**：`R` 随机生成 · `E` 导出 PNG
- **零依赖**：原生 HTML/CSS/JS，无构建步骤

## 🚀 本地运行

```bash
git clone https://github.com/X-LSH/synthwave-forge.git
cd synthwave-forge
# 直接双击 index.html 即可，或起个静态服务：
npx serve .
```

## 📐 渲染管线

```
rng.js ────── mulberry32 PRNG + 种子哈希
generator.js ─ 中点位移 / 正弦叠加 → 归一化山脊 (0..1) + 星空
renderer.js ── 天空 → 星空 → 落日 → 地面 → 山脊层 → 网格 → 地平线 → CRT 后期
app.js ─────── 控制台装配 · 实时预览循环 · 离屏画布导出
```

分辨率与算法解耦：`generator` 输出的永远是 513 个 0..1 采样点，`renderer` 负责映射到任意画布尺寸，因此预览和 4K 导出像素级同构。

## 🔧 部署到 GitHub Pages

本仓库已启用 Pages（main 分支根目录）。若 fork 后需要重新启用：

```bash
gh api -X POST repos/X-LSH/synthwave-forge/pages \
  -f source[branch]=main -f source[path]=/
```

## License

MIT
