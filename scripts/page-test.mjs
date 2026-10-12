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
    later(50, function () { tapEl(toolBtn('pen')); });
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
  // 8. laser sends nothing
  later(60, function () { setTool('laser'); out.sentBeforeLaser = __sent.length; stroke([[100, 100], [200, 150], [300, 120]], 'mouse'); });
  later(80, function () { out.laserSentNothing = __sent.filter(function (m) { return m.t === 'stroke' || m.t === 'erase'; }).length === __sent.slice(0, out.sentBeforeLaser).filter(function (m) { return m.t === 'stroke' || m.t === 'erase'; }).length; out.laserPoints = laser.length; });
  // 9. finger pan + pinch
  later(60, function () {
    setTool('pen');
    ev('pointerdown', 500, 500, 'touch'); ev('pointermove', 520, 530, 'touch'); ev('pointerup', 520, 530, 'touch');
    out.viewAfterPan = [Math.round(view.ox), Math.round(view.oy), view.z];
  });
  // 10. every popover opens; palette hex input; size % slider
  later(60, function () {
    TOOLS.forEach(function (k) { setTool(k); tapEl(toolBtn(k)); out['pop_' + k] = !!document.querySelector('.pop'); closePopover(); });
    tapEl(toolBtn('grid')); out.pop_grid = !!document.querySelector('.pop'); closePopover();
    setTool('pen');
    var sw = document.querySelector('.sw.on'); tapEl(sw);
    var hex = document.querySelector('.hexrow input[type=text]');
    hex.value = '#12AB34'; hex.dispatchEvent(new Event('input'));
    tapEl(document.querySelector('.hexrow .mini'));
    out.hexApplied = prefs.penColors[prefs.penColor];
    out.recent = prefs.recentColors.slice(0, 1);
    var sz = document.querySelector('.size.on'); tapEl(sz);
    var range = document.querySelector('.slider input'); range.value = 200; range.dispatchEvent(new Event('input'));
    out.sizeAt200 = prefs.penSizes[prefs.penSize];
    closePopover();
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
  '--virtual-time-budget=6000', '--window-size=1024,720'];
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
