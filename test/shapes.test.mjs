// Shape recognition on synthetic "hand-drawn" strokes (seeded jitter).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../addon/web/shared.js', import.meta.url), 'utf8'), ctx);
const { inkRecognizeShape } = ctx;

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const wobble = (pts, amp) => pts.map(([x, y]) => [x + rnd() * amp, y + rnd() * amp, 0.5]);
const along = (a, b, n) => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)]);

function ellipse(cx, cy, rx, ry, rot = 0, sweep = 1.04) {
  const out = [];
  for (let i = 0; i <= 80; i++) {
    const t = (i / 80) * Math.PI * 2 * sweep - 0.3;
    const u = rx * Math.cos(t), v = ry * Math.sin(t);
    out.push([cx + u * Math.cos(rot) - v * Math.sin(rot), cy + u * Math.sin(rot) + v * Math.cos(rot)]);
  }
  return out;
}
function poly(vs, closeOvershoot = true) {
  let out = [];
  for (let i = 0; i < vs.length - 1; i++) out = out.concat(along(vs[i], vs[i + 1], 20));
  if (closeOvershoot) out = out.concat(along(vs[vs.length - 1], [vs[1][0] * 0.1 + vs[0][0] * 0.9, vs[1][1] * 0.1 + vs[0][1] * 0.9], 4));
  return out;
}

const kind = (pts) => inkRecognizeShape(pts)?.kind ?? null;

test('circle', () => assert.equal(kind(wobble(ellipse(200, 200, 80, 78), 4)), 'circle'));
test('ellipse', () => assert.equal(kind(wobble(ellipse(200, 200, 140, 60), 4)), 'ellipse'));
test('rotated ellipse', () => assert.equal(kind(wobble(ellipse(200, 200, 140, 60, 0.6), 4)), 'ellipse'));
test('rectangle', () => {
  const r = inkRecognizeShape(wobble(poly([[100, 100], [320, 104], [318, 240], [98, 236], [100, 100]]), 4));
  assert.equal(r?.kind, 'rect');
  // snapped to the axes
  assert.ok(Math.abs(r.pts[0][1] - r.pts[1][1]) < 0.01);
});
test('triangle', () => assert.equal(kind(wobble(poly([[100, 300], [220, 100], [340, 300], [100, 300]]), 4)), 'triangle'));
test('nearly horizontal line snaps flat', () => {
  const r = inkRecognizeShape(wobble(along([50, 100], [400, 112], 60), 3));
  assert.equal(r?.kind, 'line');
  assert.ok(Math.abs(r.pts[0][1] - r.pts[1][1]) < 0.01);
});
test('diagonal line keeps 45°', () => {
  const r = inkRecognizeShape(wobble(along([50, 50], [300, 290], 60), 3));
  assert.equal(r?.kind, 'line');
});
test('L-shaped axes', () => {
  const r = inkRecognizeShape(wobble(along([100, 40], [102, 300], 40).concat(along([102, 300], [380, 296], 40)), 3));
  assert.equal(r?.kind, 'polyline');
  assert.equal(r.pts[0][0], r.pts[1][0]);
});
test('handwriting-ish squiggle is left alone', () => {
  const s = [];
  for (let i = 0; i < 120; i++) s.push([50 + i * 3, 200 + Math.sin(i / 5) * 40 + Math.sin(i / 2.3) * 12]);
  assert.equal(kind(wobble(s, 2)), null);
});
test('a "2"-like stroke is left alone', () => {
  const s = ellipse(200, 150, 60, 50, 0, 0.45).concat(along([250, 180], [140, 300], 30), along([140, 300], [280, 300], 30));
  assert.equal(kind(wobble(s, 2)), null);
});
