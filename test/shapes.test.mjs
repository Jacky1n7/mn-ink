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

// ---- √ recognition ----------------------------------------------------------
const { inkRecognizeRadical, inkAdjustShape, inkSnapShape } = ctx;
const userRadicals = JSON.parse(fs.readFileSync(new URL('./fixtures/radicals.json', import.meta.url), 'utf8'));

test('the user\'s own √ strokes are recognised', () => {
  for (const pts of userRadicals) {
    const r = inkRecognizeShape(pts.map(([x, y]) => [x, y, 0.5]));
    assert.equal(r?.kind, 'radical', JSON.stringify(pts.slice(0, 5)));
    // bar is horizontal and starts at the top of the rise
    assert.equal(r.pts[3][1], r.pts[4][1]);
  }
});
test('synthetic √ without the little tick', () => {
  const s = along([100, 160], [120, 200], 10).concat(along([120, 200], [130, 100], 20), along([130, 100], [260, 102], 30));
  assert.equal(inkRecognizeRadical(wobble(s, 2))?.kind, 'radical');
});
test('a "V" is not a radical', () => {
  const s = along([100, 100], [130, 200], 20).concat(along([130, 200], [160, 100], 20));
  assert.equal(inkRecognizeRadical(wobble(s, 1)), null);
});
test('a check mark is not a radical', () => {
  const s = along([100, 150], [125, 180], 10).concat(along([125, 180], [190, 90], 25));
  assert.equal(inkRecognizeRadical(wobble(s, 1)), null);
});
test('"r" / "n"-like strokes are not radicals', () => {
  const s = along([100, 100], [100, 200], 20).concat(along([100, 200], [102, 120], 15), along([102, 120], [140, 112], 10));
  assert.equal(inkRecognizeRadical(wobble(s, 1)), null);
});

// ---- hold + drag fine-tuning ------------------------------------------------
test('dragging after a line snaps moves its end, angle snapped to 15°', () => {
  const r = inkAdjustShape({ kind: 'line', closed: false, pts: [[0, 0], [100, 0]] }, [100, 0], [200, 3]);
  assert.ok(Math.abs(r.pts[1][1]) < 1e-9 && Math.abs(r.pts[1][0] - 200.02) < 0.1);
});
test('dragging a radical extends its bar', () => {
  const base = inkRecognizeRadical(userRadicals[0].map(([x, y]) => [x, y, 0.5]));
  const r = inkAdjustShape(base, base.pts[4], [base.pts[4][0] + 80, base.pts[4][1] + 9]);
  assert.equal(r.pts[4][0], base.pts[4][0] + 80);
  assert.equal(r.pts[4][1], base.pts[3][1]);
});
test('dragging a rectangle corner resizes it from the opposite corner', () => {
  const rect = { kind: 'rect', closed: true, pts: [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]] };
  const r = inkAdjustShape(rect, [100, 50], [200, 100]);
  assert.deepEqual([...r.pts[2]], [200, 100]);
  assert.deepEqual([...r.pts[0]], [0, 0]);
});
test('corners snap to nearby nodes', () => {
  const r = inkSnapShape({ kind: 'line', closed: false, pts: [[0, 0], [98, 3]] }, [[100, 0]], null, 10);
  assert.deepEqual([...r.pts[1]], [100, 0]);
});

// ---- arcs and arrows -------------------------------------------------------
test('a quarter arc is recognised as an arc', () => {
  const arc = [];
  for (let i = 0; i <= 40; i++) { const a = Math.PI + (i / 40) * (Math.PI / 2); arc.push([200 + 100 * Math.cos(a), 200 + 100 * Math.sin(a)]); }
  const r = inkRecognizeShape(wobble(arc, 2));
  assert.equal(r?.kind, 'arc');
  assert.ok(Math.abs(r.arc.r - 100) < 6);
});
test('a semicircle is an arc, a full circle is still a circle', () => {
  const semi = [];
  for (let i = 0; i <= 50; i++) { const a = (i / 50) * Math.PI; semi.push([200 + 80 * Math.cos(a), 200 + 80 * Math.sin(a)]); }
  assert.equal(kind(wobble(semi, 2)), 'arc');
  assert.equal(kind(wobble(ellipse(200, 200, 80, 79), 3)), 'circle');
});
test('a one-stroke arrow is recognised', () => {
  const s = along([50, 200], [300, 200], 40).concat(along([300, 200], [270, 180], 6), along([270, 180], [300, 200], 6), along([300, 200], [270, 222], 6));
  const r = inkRecognizeShape(wobble(s, 1.5));
  assert.equal(r?.kind, 'arrow');
  assert.ok(Math.abs(r.pts[1][1] - 200) < 3);
});
test('the user\'s √ is still a radical, not an arc or arrow', () => {
  for (const pts of userRadicals) assert.equal(inkRecognizeShape(pts.map(([x, y]) => [x, y, 0.5]))?.kind, 'radical');
});
test('dragging an arc extends it along the circle', () => {
  const arc = [];
  for (let i = 0; i <= 40; i++) { const a = Math.PI + (i / 40) * (Math.PI / 2); arc.push([200 + 100 * Math.cos(a), 200 + 100 * Math.sin(a)]); }
  const base = inkRecognizeShape(arc);
  const end = [200 + 100 * Math.cos(2 * Math.PI), 200 + 100 * Math.sin(2 * Math.PI)];
  const r = inkAdjustShape(base, base.pts[base.pts.length - 1], end);
  const last = r.pts[r.pts.length - 1];
  assert.ok(Math.hypot(last[0] - end[0], last[1] - end[1]) < 2);
});
