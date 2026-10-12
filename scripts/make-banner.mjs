// Generate assets/design/banner.html: the strokes are drawn with the same
// perfect-freehand settings the add-on uses, so the banner shows real output.
// Render: Chrome --headless --window-size=1280,700 --force-device-scale-factor=2 --screenshot …
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { freehand, root } from './assemble.mjs';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(freehand() + '\n' + fs.readFileSync(path.join(root, 'addon/web/shared.js'), 'utf8'), ctx);

function outlinePath(pts, brush, size) {
  const o = ctx.INK_FREEHAND.getStroke(pts, ctx.inkFreehandOptions(brush, size, false, true, 0.6));
  let d = `M${o[0][0].toFixed(1)},${o[0][1].toFixed(1)}`;
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    d += ` Q${a[0].toFixed(1)},${a[1].toFixed(1)} ${((a[0] + b[0]) / 2).toFixed(1)},${((a[1] + b[1]) / 2).toFixed(1)}`;
  }
  return d + ' Z';
}

// A handwritten integral sign: one cubic S-curve with hooks, heavy in the middle.
function integral(x, y, h) {
  const B0 = [x + 34, y + 6], C1 = [x - 14, y - 40], C2 = [x + 46, y + h + 40], B3 = [x - 4, y + h - 6];
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80, u = 1 - t;
    const px = u * u * u * B0[0] + 3 * u * u * t * C1[0] + 3 * u * t * t * C2[0] + t * t * t * B3[0];
    const py = u * u * u * B0[1] + 3 * u * u * t * C1[1] + 3 * u * t * t * C2[1] + t * t * t * B3[1];
    pts.push([px, py, 0.12 + 0.88 * Math.pow(Math.sin(t * Math.PI), 1.4)]);
  }
  return pts;
}

// A sketched graph: y = sin x, written in one smooth stroke.
function wave(x, y, w) {
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    pts.push([x + t * w, y - Math.sin(t * Math.PI * 2) * 30, 0.35 + 0.5 * Math.sin(t * Math.PI)]);
  }
  return pts;
}

// Rough radical as written by hand, and the tidied version next to it.
function roughRadical(x, y, s) {
  const raw = [[0, 22], [3, 10], [6, 0], [10, 14], [14, 30], [16, 18], [18, -8], [19, -24], [26, -25], [60, -26], [96, -24]];
  const pts = [];
  for (let i = 1; i < raw.length; i++) {
    for (let k = 0; k < 6; k++) {
      const t = k / 6, a = raw[i - 1], b = raw[i];
      pts.push([x + (a[0] + (b[0] - a[0]) * t) * s + Math.sin(i * 3 + k) * 0.8, y + (a[1] + (b[1] - a[1]) * t) * s, 0.5]);
    }
  }
  return pts;
}

const rad = ctx.inkRecognizeRadical(roughRadical(0, 0, 1).map(([a, b]) => [a, b, 0.5]));

const S = {
  integral: outlinePath(integral(760, 120, 190), 'fountain', 6.5),
  squiggle: outlinePath(wave(830, 236, 170), 'fountain', 4.2),
  axes: [[812, 300], [812, 166]],
  axis2: [[800, 236], [1012, 236]],
  marker: outlinePath([[790, 372, 0.5], [900, 369, 0.5], [1010, 371, 0.5]], 'marker', 28),
  rough: outlinePath(roughRadical(1052, 158, 1.05), 'ballpoint', 3.6),
  clean: rad ? rad.pts.map(([px, py]) => [1052 + px * 1.05, 330 + py * 1.05]) : null
};

const arc = [];
for (let i = 0; i <= 40; i++) {
  const a = Math.PI * 1.1 + (i / 40) * Math.PI * 0.8;
  arc.push([985 + 120 * Math.cos(a), 560 + 120 * Math.sin(a)]);
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>MN Ink banner</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 640px; overflow: hidden; }
  body { background: #fbfaf7; font-family: -apple-system, "SF Pro Display", "Hiragino Sans GB", sans-serif; color: #141a2b; position: relative; }
  .paper { position: absolute; inset: 0; background-image:
      linear-gradient(rgba(70,110,170,.10) 1px, transparent 1px),
      linear-gradient(90deg, rgba(70,110,170,.10) 1px, transparent 1px);
    background-size: 32px 32px; background-position: -1px -1px;
    -webkit-mask-image: linear-gradient(90deg, transparent 0%, transparent 38%, #000 62%); }
  .text { position: absolute; left: 84px; top: 0; bottom: 0; width: 680px; display: flex; flex-direction: column; justify-content: center; }
  .eyebrow { font-family: "SF Mono", ui-monospace, monospace; font-size: 16px; letter-spacing: .18em; color: #0a84ff; margin-bottom: 24px; }
  h1 { font-size: 108px; line-height: .95; font-weight: 700; letter-spacing: -0.04em; }
  h1 span { font-weight: 300; color: #5a6380; }
  .zh { font-family: "Hiragino Sans GB", -apple-system, sans-serif; font-size: 28px; white-space: nowrap; font-weight: 600; margin-top: 34px; letter-spacing: .02em; }
  .en { font-size: 18px; color: #737b95; margin-top: 12px; line-height: 1.5; max-width: 500px; }
  .chips { display: flex; gap: 8px; margin-top: 28px; flex-wrap: nowrap; }
  .chip { font-size: 13px; white-space: nowrap; color: #3a4361; border: 1px solid #d7d9e0; background: rgba(255,255,255,.7); border-radius: 999px; padding: 6px 13px; }
  svg { position: absolute; left: 0; top: 0; }
  .lbl { font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; fill: #8b95b3; letter-spacing: .08em; }
</style></head>
<body>
<div class="paper"></div>
<div class="text">
  <div class="eyebrow">MARGINNOTE 4 · HANDWRITING</div>
  <h1>MN <span>Ink</span></h1>
  <div class="zh">在 MarginNote 上像 GoodNotes 一样手写</div>
  <div class="en">Pressure brushes, shape snapping, a GoodNotes-style lasso — on mind maps and PDFs, saved inside your notebook.</div>
  <div class="chips"><span class="chip">压感笔刷</span><span class="chip">图形规整 · 根号 · 圆弧</span><span class="chip">套索 · 局部橡皮</span><span class="chip">脑图 + PDF</span><span class="chip">MN 撤销与备份</span></div>
</div>
<svg width="1280" height="640" viewBox="0 0 1280 640">
  <path d="${S.marker}" fill="#ffd60a" opacity=".38"/>
  <path d="${S.integral}" fill="#1d2a4a"/>
  <polyline points="${S.axes.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#1d2a4a" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M806,174 L812,164 L818,174" fill="none" stroke="#1d2a4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="${S.axis2.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#1d2a4a" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M1002,230 L1012,236 L1002,242" fill="none" stroke="#1d2a4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${S.squiggle}" fill="#1f4fd1"/>
  <path d="${S.rough}" fill="#8e93a6"/>
  ${S.clean ? `<polyline points="${S.clean.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#1f4fd1" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
  <path d="M1110,244 l0,26 m-7,-8 l7,8 l7,-8" fill="none" stroke="#b8bdcc" stroke-width="2" stroke-linecap="round"/>
  <polyline points="${arc.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#d7262b" stroke-width="3" stroke-linecap="round"/>
  ${[arc[0], arc[40]].map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="7" fill="#fff" stroke="#0a84ff" stroke-width="2.2"/>`).join('')}
  <circle cx="985" cy="560" r="3" fill="#0a84ff"/>
  <text x="1052" y="384" class="lbl">√ 写完自动整齐</text>
  <text x="1180" y="602" class="lbl" text-anchor="end">按住 → 圆弧</text>
</svg>
</body></html>`;
fs.writeFileSync(path.join(root, 'assets/design/banner.html'), html);
console.log('wrote assets/design/banner.html', rad ? '(radical ok)' : '(radical NOT recognised)');
