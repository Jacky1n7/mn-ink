// Drive the drawing page in headless Chrome with synthetic pointer events and a
// fake add-on, then check the messages it sent. Usage: node scripts/page-test.mjs [--shot out.png]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { page, root } from './assemble.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shotIdx = process.argv.indexOf('--shot');
const shot = shotIdx > 0 ? path.resolve(process.argv[shotIdx + 1]) : null;
const scenario = process.argv.includes('--popover') ? 'popover' : 'full';

const radicals = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'radicals.json'), 'utf8'));

// Runs inside the page before its own script.
const prelude = `<script>
window.__sent = []; window.__errors = [];
window.onerror = function (m, s, l, c) { __errors.push(m + ' @' + l + ':' + c); };
Element.prototype.setPointerCapture = function () {};
window.__pendingBatches = [];
window.__inkTransport = function (url) {
  var batch = JSON.parse(decodeURIComponent(url.slice(url.indexOf('?') + 1)));
  setTimeout(function () {
    if (window.__fakeAddon) window.__fakeAddon(batch); else __pendingBatches.push(batch);
  }, 2);
};
</script>`;

// Runs after the page script: fake add-on + scenario.
const harness = `<script>
(function () {
  var z = 0.5;
  window.__fakeAddon = function (b) { fakeAddon(b); };
  setTimeout(function () { __pendingBatches.splice(0).forEach(fakeAddon); }, 0);
  var SEL = { n: 2, x: 300, y: 300, w: 100, h: 60 };
  function fakeAddon(batch) {
    batch.msgs.forEach(function (m) {
      __sent.push(m);
      if (m.t === 'ready') ink.init({ prefs: null, view: { ox: 100, oy: 50, z: z, minZ: 0.01, maxZ: 2 }, state: { canUndo: false, canRedo: false }, nodes: [400, 300], surface: 'map', surfaces: { map: true, doc: true }, clip: false, storage: 'notebook' });
      if (m.t === 'view') ink.setView({ ox: view.ox, oy: view.oy, z: view.z });
      if (m.t === 'stroke') ink.committed({ lid: m.lid, ok: true, state: { canUndo: true, canRedo: false } });
      if (m.t === 'lasso') ink.lassoResult(m.poly.length === 8 && m.poly[0] > 280 ? SEL : { n: 1, x: 100, y: 100, w: 100, h: 80, shape: { id: 'S1', closed: true, pts: [100, 100, 200, 100, 200, 180, 100, 180], color: '#d7262b', width: 2, alpha: 1, dash: false } });
      if (m.t === 'editEnd') ink.selection({ n: 1, x: 100, y: 100, w: 140, h: 80, shape: { id: 'S1', closed: true, pts: m.pts || [], color: '#d7262b', width: 2, alpha: 1, dash: false } });
      if (m.t === 'xformEnd' || m.t === 'moveEnd') ink.selection(SEL);
      if (m.t === 'copy') ink.clip(2);
      if (m.t === 'dblTap') (m.dots || []).forEach(function (d) { ink.committed({ lid: d.lid, ok: false, state: { canUndo: true, canRedo: false } }); });
      if (m.t === 'pick') ink.picked({ color: '#123456', op: 1 });
      if (m.t === 'cardDrawing') ink.cardDrawing([{ tool: 'pen', b: 'fountain', color: '#1f4fd1', op: 1, size: 3, ps: 0.6, sim: false, shape: false, pts: [100, 100, 0.5, 140, 120, 0.6, 180, 100, 0.5] }]);
      if (m.t === 'layer') ink.layers({ active: m.op === 'add' ? 'L2' : 'default', layers: [{ id: 'default', name: '默认图层', hidden: false, n: 3 }].concat(m.op === 'add' ? [{ id: 'L2', name: '图层 2', hidden: false, n: 0 }] : []) });
    });
    ink.ack(batch.seq);
  }
  var pid = 1;
  function ev(type, x, y, kind, pressure) {
    var e = new PointerEvent(type, { pointerId: kind === 'touch' ? 9 : pid, pointerType: kind || 'pen', clientX: x, clientY: y, pressure: pressure == null ? 0.4 : pressure, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true });
    document.getElementById('live').dispatchEvent(e);
  }
  function stroke(pts, kind) {
    ev('pointerdown', pts[0][0], pts[0][1], kind);
    for (var i = 1; i < pts.length; i++) ev('pointermove', pts[i][0], pts[i][1], kind, 0.2 + 0.5 * Math.sin(i / pts.length * Math.PI));
    ev('pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1], kind);
  }
  function tapEl(el) {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  }
  function toolBtn(key) { return document.querySelector('#bar [data-key="' + key + '"]'); }
  var steps = [];
  var out = {};
  function later(ms, fn) { steps.push([ms, fn]); }
  function run() {
    var t = 0;
    steps.forEach(function (s) { t += s[0]; setTimeout(function () { try { s[1](); } catch (e) { __errors.push('step: ' + e.message + ' ' + e.stack); } }, t); });
    setTimeout(function () {
      out.errors = __errors;
      out.sent = __sent.map(function (m) { var c = {}; for (var k in m) c[k] = k === 'pts' || k === 'poly' ? (m[k] ? m[k].length : null) : m[k]; return c; });
      var pre = document.createElement('pre'); pre.id = '__out'; pre.textContent = JSON.stringify(out);
      document.body.appendChild(pre);
    }, t + 200);
  }
  var RAD = ${JSON.stringify(radicals)};
  var SCEN = ${JSON.stringify(scenario)};

  if (SCEN === 'popover') {
    later(50, function () { prefs.grid = 'square'; drawGrid(); });
    later(50, function () { tapEl(toolBtn('pen1')); });
    later(50, function () { out.popover = !!document.querySelector('.pop'); });
    run();
    return;
  }
  // 1. plain pen stroke with pressure
  later(50, function () { stroke([[300, 300], [320, 310], [340, 330], [360, 320], [380, 300], [400, 310]]); });
  // 2. user's √ (auto-tidied)
  later(50, function () { stroke(RAD[1].map(function (p) { return [p[0] + 200, p[1] - 100]; })); });
  // 3. hold to snap a wobbly line, then drag to lengthen it
  later(50, function () {
    ev('pointerdown', 100, 500);
    for (var i = 1; i <= 30; i++) ev('pointermove', 100 + i * 6, 500 + (i % 2) * 1.5);
  });
  later(600, function () { out.snapped = active && active.shape && active.shape.kind; ev('pointermove', 330, 503); ev('pointermove', 360, 505); });
  later(30, function () { out.adjustedEnd = active && active.shape && active.shape.pts[1].map(Math.round); ev('pointerup', 360, 505); });
  // 4. shape tool: rectangle recognised on lift, corner snaps to node (400,300 canvas → screen 100,100); then an arc
  later(50, function () { setTool('shape'); });
  later(30, function () { stroke([[103, 98], [200, 101], [201, 180], [99, 181], [101, 104]]); });
  later(30, function () {
    var arc = []; for (var i = 0; i <= 30; i++) { var a = Math.PI + i / 30 * Math.PI / 2; arc.push([600 + 80 * Math.cos(a), 400 + 80 * Math.sin(a)]); }
    stroke(arc);
  });
  // 5. eraser, partial mode
  later(50, function () { setTool('eraser'); prefs.eraserMode = 'partial'; });
  later(30, function () { stroke([[300, 280], [330, 340]]); });
  // 6. lasso → single shape → drag node 1
  later(50, function () { setTool('lasso'); });
  later(30, function () { stroke([[90, 90], [220, 90], [220, 200], [90, 200]]); });
  later(60, function () { out.selShape = !!(sel && sel.shape); stroke([[200, 100], [230, 100], [240, 101]], 'mouse'); });
  // 7. rectangle lasso → multi selection → rotate via handle, copy, paste by tapping
  later(60, function () { clearSelection(true); prefs.lassoMode = 'rect'; });
  later(30, function () { stroke([[290, 290], [350, 330], [420, 380]]); });
  later(60, function () { out.multiSel = sel ? sel.n : null; var r = rotHandle(sel.box); stroke([[r[0], r[1]], [r[0] + 40, r[1] + 10], [r[0] + 80, r[1] + 40]], 'mouse'); });
  later(60, function () { tapEl(document.getElementById('selCopy')); });
  later(60, function () { clearSelection(true); stroke([[700, 600], [700.5, 600.5]], 'mouse'); });
  later(60, function () { out.pasteShown = getComputedStyle(document.getElementById('pastebar')).display !== 'none'; tapEl(document.getElementById('pasteBtn')); });
  // 8. laser and vanish-mode strokes send nothing
  later(60, function () { setTool('laser'); out.sentBeforeLaser = __sent.length; stroke([[100, 100], [200, 150], [300, 120]], 'mouse'); });
  later(80, function () { out.laserPoints = laser.length; setTool('pen1'); activeSlot().vanish = true; stroke([[100, 300], [200, 330], [300, 310]]); });
  later(60, function () { out.vanishing = vanishing.length; activeSlot().vanish = false; out.noStrokeSent = __sent.slice(out.sentBeforeLaser).filter(function (m) { return m.t === 'stroke'; }).length === 0; });
  // 9. straight 'always', opacity, brush type travel in the stroke message
  later(60, function () { var s = activeSlot(); s.straight = 'always'; s.op = 0.5; s.brush = 'watercolor'; stroke([[100, 400], [150, 420], [200, 390], [260, 430]]); });
  later(60, function () { var m = __sent.filter(function (x) { return x.t === 'stroke'; }).pop(); out.straightMsg = [m.shape, m.op, m.b]; var s = activeSlot(); s.straight = 'off'; s.op = 1; s.brush = 'fountain'; });
  // 10. ruler: a stroke started at the ruler edge comes out straight along it
  later(60, function () { prefs.ruler = true; ruler = { x: 500, y: 300, a: 0, len: 600, th: 64 }; stroke([[400, 336], [450, 345], [500, 330], [560, 350]]); });
  later(60, function () { var m = __sent.filter(function (x) { return x.t === 'stroke'; }).pop(); var ys = []; for (var i = 1; i < m.pts.length; i += 3) ys.push(m.pts[i]); out.rulerFlat = Math.max.apply(null, ys) - Math.min.apply(null, ys); prefs.ruler = false; });
  // 11. eyedropper, clone slot, layers, convert to card
  later(60, function () { startEyedrop(); stroke([[300, 300], [300.5, 300.5]], 'mouse'); });
  later(60, function () { out.picked = activeSlot().color; var n = prefs.slots.length; openPop('slot', toolBtn('pen1'), buildSlotPop()); var clone = Array.from(document.querySelectorAll('.pop .mini')).find(function (b) { return b.textContent === '复制为新工具'; }); tapEl(clone); out.slotsAfterClone = prefs.slots.length - n; closePopover(); });
  later(60, function () { send({ t: 'layer', op: 'add' }); });
  later(60, function () { out.layers = layersInfo.layers.length + ':' + layersInfo.active; send({ t: 'cardDrawing' }); });
  later(120, function () { var m = __sent.filter(function (x) { return x.t === 'createCard'; }).pop(); out.cardPng = m ? m.png.length : 0; });
  // 12. finger pan, two-finger tap = undo (away from pen activity)
  later(900, function () {
    setTool(prefs.slots[0].id);
    ev('pointerdown', 500, 500, 'touch'); ev('pointermove', 520, 530, 'touch'); ev('pointerup', 520, 530, 'touch');
    out.viewAfterPan = [Math.round(view.ox), Math.round(view.oy), view.z];
    var before = __sent.filter(function (x) { return x.t === 'undo'; }).length;
    var a = new PointerEvent('pointerdown', { pointerId: 21, pointerType: 'touch', clientX: 300, clientY: 300, bubbles: true });
    var b = new PointerEvent('pointerdown', { pointerId: 22, pointerType: 'touch', clientX: 340, clientY: 300, bubbles: true });
    cv.dispatchEvent(a); cv.dispatchEvent(b);
    cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, pointerType: 'touch', clientX: 300, clientY: 300, bubbles: true }));
    cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 22, pointerType: 'touch', clientX: 340, clientY: 300, bubbles: true }));
    out.twoFingerUndoBefore = before;
  });
  later(60, function () { out.twoFingerUndo = __sent.filter(function (x) { return x.t === 'undo'; }).length - out.twoFingerUndoBefore; });
  // 12b. palm rejection: cancelled touches, touches right after the pen
  later(900, function () {
    function t(type, id, x, y) { cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true })); }
    out.palmUndoBefore = __sent.filter(function (x) { return x.t === 'undo'; }).length;
    t('pointerdown', 31, 300, 300); t('pointerdown', 32, 340, 300); t('pointercancel', 31, 300, 300); t('pointercancel', 32, 340, 300);
    stroke([[200, 200], [240, 210], [280, 220]], 'pen');
    t('pointerdown', 33, 300, 300); t('pointerdown', 34, 340, 300); t('pointerup', 33, 300, 300); t('pointerup', 34, 340, 300);
    out.viewBeforePalm = __sent.filter(function (x) { return x.t === 'view'; }).length;
    t('pointerdown', 35, 400, 400); t('pointermove', 35, 430, 440); t('pointermove', 35, 470, 480); t('pointerup', 35, 470, 480);
  });
  later(60, function () {
    out.palmUndo = __sent.filter(function (x) { return x.t === 'undo'; }).length - out.palmUndoBefore;
    out.palmPan = __sent.filter(function (x) { return x.t === 'view'; }).length - out.viewBeforePalm;
  });
  // 12c. a fat finger (iPad reports 2× the radius) still pans; a hovering pen does not block fingers
  later(900, function () {
    out.viewBeforeFat = __sent.filter(function (x) { return x.t === 'view'; }).length;
    cv.dispatchEvent(new PointerEvent('pointermove', { pointerId: 40, pointerType: 'pen', clientX: 600, clientY: 600, buttons: 0, pressure: 0, bubbles: true }));
    function f(type, x, y) { cv.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', clientX: x, clientY: y, width: 80, height: 90, bubbles: true })); }
    f('pointerdown', 400, 400); f('pointermove', 430, 440); f('pointermove', 470, 480); f('pointerup', 470, 480);
  });
  later(60, function () { out.fatFingerPan = __sent.filter(function (x) { return x.t === 'view'; }).length - out.viewBeforeFat; });
  // 13. hand tool pans with the mouse
  later(60, function () { setTool('hand'); var v0 = view.ox; stroke([[300, 300], [340, 300], [380, 300]], 'mouse'); out.handPanned = Math.round(v0 - view.ox); });
  // 13b. two mouse taps on one spot = double tap (no dots); a single tap = a dot
  later(60, function () { setTool('pen1'); out.sentBeforeTaps = __sent.length; stroke([[600, 600], [600.5, 600.5]], 'mouse'); stroke([[601, 600], [601.3, 600.2]], 'mouse'); });
  later(60, function () { var m = __sent.slice(out.sentBeforeTaps); out.dblTap = m.map(function (x) { return x.t; }).join(','); stroke([[700, 600], [700.5, 600.5]], 'mouse'); });
  later(450, function () { var m = __sent.slice(out.sentBeforeTaps); out.afterSingle = m.map(function (x) { return x.t; }).join(','); });
  // 13c. with card frames known: a dot off the cards lands at once, a dot on a card waits
  later(60, function () {
    var c = function (x, y) { return [(x + view.ox) / view.z, (y + view.oy) / view.z]; };
    var a = c(560, 560), b = c(640, 640);
    ink.cards([a[0], a[1], b[0] - a[0], b[1] - a[1]]);
    out.sentBeforeOff = __sent.length; stroke([[300, 650], [300.5, 650.5]], 'mouse');
  });
  later(30, function () { out.offCardDot = __sent.slice(out.sentBeforeOff).map(function (x) { return x.t; }).join(','); out.sentBeforeOn = __sent.length; stroke([[600, 600], [600.5, 600.5]], 'mouse'); });
  later(30, function () { out.onCardHeld = __sent.slice(out.sentBeforeOn).map(function (x) { return x.t; }).join(','); });
  later(450, function () { out.onCardLater = __sent.slice(out.sentBeforeOn).map(function (x) { return x.t; }).join(','); });
  // 14. every popover opens; palette hex input; size slider
  later(60, function () {
    ['shape', 'eraser', 'lasso'].forEach(function (k) { setTool(k); tapEl(toolBtn(k)); out['pop_' + k] = !!document.querySelector('.pop'); closePopover(); });
    setTool('pen1'); tapEl(toolBtn('pen1')); out.pop_slot = !!document.querySelector('.pop .brushes'); closePopover();
    tapEl(toolBtn('layers')); out.pop_layers = !!document.querySelector('.pop .layer'); closePopover();
    tapEl(toolBtn('settings')); out.pop_settings = !!document.querySelector('.pop .toggle'); closePopover();
    var sw = document.querySelector('.sw.on') || document.querySelector('.sw'); tapEl(sw); tapEl(document.querySelector('.sw.on') || sw);
    var hex = document.querySelector('.hexrow input[type=text]');
    if (hex) { hex.value = '#12AB34'; hex.dispatchEvent(new Event('input')); tapEl(document.querySelector('.hexrow .mini')); }
    out.hexApplied = activeSlot().color;
    out.surfaceSwitch = !!document.querySelector('.surf');
  });
  run();
})();
</script>`;

const html = page()
  .replace('<head>', '<head>' + prelude)
  .replace('</body>', harness + '</body>')
  .replace('<body>', '<body style="background:#f4f4f2">');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnink-page-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, html);

const args = ['--headless', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(dir, 'prof')}`,
  '--virtual-time-budget=12000', '--window-size=1024,720'];
// Headless Chrome finishes the work but often does not exit: read until done, then kill.
function chrome(extra, until) {
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, [...args, ...extra, 'file://' + file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('chrome timed out')); }, 25000);
    const check = () => {
      if (until(out)) { clearTimeout(timer); p.kill('SIGKILL'); resolve(out); }
    };
    p.stdout.on('data', (d) => { out += d; check(); });
    const poll = setInterval(() => { if (until(out)) { clearInterval(poll); check(); } }, 300);
    p.on('exit', () => { clearInterval(poll); clearTimeout(timer); resolve(out); });
  });
}

if (shot) {
  if (fs.existsSync(shot)) fs.rmSync(shot);
  await chrome([`--screenshot=${shot}`], () => fs.existsSync(shot) && fs.statSync(shot).size > 0);
  console.log('screenshot', shot);
} else {
  const dom = await chrome(['--dump-dom'], (o) => o.includes('</html>'));
  const m = dom.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
  if (!m) {
    console.error('no result from page');
    process.exit(1);
  }
  const txt = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  console.log(JSON.stringify(JSON.parse(txt), null, 1));
}
