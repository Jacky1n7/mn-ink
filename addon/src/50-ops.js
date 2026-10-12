// ---------------------------------------------------------------------------
// Editing operations: add, erase, lasso select / move / recolor / delete,
// undo and redo. Input points arrive in overlay (screen) coordinates.
//
// Every change is an op {add: [strokes], remove: [strokes]}; undo applies the
// inverse. Moving or recoloring = remove the old copies + add new ones with the
// same ids.
// ---------------------------------------------------------------------------

var INK_UNDO = [];
var INK_REDO = [];
var INK_SEL = null; // { ids: [...] }

function inkResetHistory() {
  INK_UNDO = [];
  INK_REDO = [];
  INK_SEL = null;
}

function inkView(views) {
  var off = views.sv.contentOffset;
  return { ox: off.x, oy: off.y, z: views.sv.zoomScale };
}

function inkToCanvas(v, x, y) {
  return [(x + v.ox) / v.z, (y + v.oy) / v.z];
}

// Origin of a stroke's group, or null when its card is not on screen.
function inkOrigin(s) {
  if (!s.a) return { x: 0, y: 0 };
  var f = INK_R && INK_R.frames ? INK_R.frames[s.a] : null;
  return f ? { x: f.x, y: f.y } : null;
}

function inkAbsBox(s, o) {
  var b = inkStrokeBox(s);
  return { x0: b.x0 + o.x, y0: b.y0 + o.y, x1: b.x1 + o.x, y1: b.y1 + o.y };
}

function inkApply(op) {
  var store = INK_STORE;
  inkNoAnim(function () {
    (op.remove || []).forEach(function (s) {
      delete store.byId[s.id];
      inkUnrenderStroke(s.id);
    });
    if ((op.remove || []).length) {
      store.strokes = store.strokes.filter(function (s) { return !!store.byId[s.id]; });
    }
    (op.add || []).forEach(function (s) {
      store.byId[s.id] = s;
      store.strokes.push(s);
      inkRenderStroke(s);
    });
  });
  inkSaveSoon();
}

function inkRecord(op) {
  INK_UNDO.push(op);
  if (INK_UNDO.length > 300) INK_UNDO.shift();
  INK_REDO = [];
}

function inkUndo() {
  var op = INK_UNDO.pop();
  if (!op) return;
  inkApply({ add: op.remove, remove: op.add });
  INK_REDO.push(op);
  INK_SEL = null;
}

function inkRedo() {
  var op = INK_REDO.pop();
  if (!op) return;
  inkApply(op);
  INK_UNDO.push(op);
  INK_SEL = null;
}

function inkHistoryState() {
  return { canUndo: INK_UNDO.length > 0, canRedo: INK_REDO.length > 0, count: INK_STORE ? INK_STORE.strokes.length : 0 };
}

// m: { tool, color, size, sim, shape, closed, pts: [x, y, p, …] } in screen units.
function inkCommitStroke(views, m) {
  var v = inkView(views);
  var pts = [];
  for (var i = 0; i + 2 < m.pts.length; i += 3) {
    var c = inkToCanvas(v, m.pts[i], m.pts[i + 1]);
    pts.push(Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100, m.pts[i + 2]);
  }
  if (pts.length < 3) return null;
  var s = {
    id: inkNewId(), tool: m.tool === 'marker' ? 'marker' : 'pen', color: String(m.color || '#1d1d1f'),
    w: m.size / v.z, k: v.z, sim: !!m.sim, shape: !!m.shape, closed: !!m.closed, a: null, pts: pts
  };
  var box = inkStrokeBox(s);
  var anchor = inkPickAnchor(INK_R.frames || {}, box);
  if (anchor) {
    var f = INK_R.frames[anchor];
    for (var j = 0; j + 2 < s.pts.length; j += 3) {
      s.pts[j] = Math.round((s.pts[j] - f.x) * 100) / 100;
      s.pts[j + 1] = Math.round((s.pts[j + 1] - f.y) * 100) / 100;
    }
    s.a = anchor;
  }
  delete s._box;
  var op = { add: [s], remove: [] };
  inkApply(op);
  inkRecord(op);
  return s;
}

function inkSegDist(p, q, a, b) {
  // Segments pq and ab: 0 when they cross, otherwise the closest endpoint distance.
  function orient(u, v, w) {
    return (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  }
  var d1 = orient(p, q, a), d2 = orient(p, q, b), d3 = orient(a, b, p), d4 = orient(a, b, q);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(inkDistToSegment(p, a, b), inkDistToSegment(q, a, b), inkDistToSegment(a, p, q), inkDistToSegment(b, p, q));
}

// Remove every visible stroke touched by the eraser path.
// m: { pts: [x, y, …] screen, r: screen radius, g: gesture id }
function inkErase(views, m) {
  var v = inkView(views);
  var e = [];
  for (var i = 0; i + 1 < m.pts.length; i += 2) e.push(inkToCanvas(v, m.pts[i], m.pts[i + 1]));
  if (!e.length) return;
  if (e.length === 1) e.push(e[0]);
  var r = m.r / v.z;
  var eb = inkBBox(e);
  var hits = [];
  INK_STORE.strokes.forEach(function (s) {
    var o = inkOrigin(s);
    if (!o) return;
    var b = inkAbsBox(s, o);
    if (b.x1 < eb.x0 - r || b.x0 > eb.x1 + r || b.y1 < eb.y0 - r || b.y0 > eb.y1 + r) return;
    var reach = r + (s.shape ? s.w * INK_SHAPE_WIDTH : s.w) / 2;
    var pts = inkTriples(s.pts).map(function (p) { return [p[0] + o.x, p[1] + o.y]; });
    if (s.shape && s.closed) pts.push(pts[0]);
    if (pts.length === 1) pts.push(pts[0]);
    for (var k = 1; k < pts.length; k++) {
      for (var j = 1; j < e.length; j++) {
        if (inkSegDist(pts[k - 1], pts[k], e[j - 1], e[j]) <= reach) {
          hits.push(s);
          return;
        }
      }
    }
  });
  if (!hits.length) return;
  inkApply({ add: [], remove: hits });
  // One undo step per eraser gesture.
  var last = INK_UNDO[INK_UNDO.length - 1];
  if (last && last.g && last.g === m.g) last.remove = last.remove.concat(hits);
  else inkRecord({ add: [], remove: hits, g: m.g });
}

function inkPointInPoly(p, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Select the strokes mostly inside a lasso. Returns the selection box in screen units.
function inkLasso(views, m) {
  var v = inkView(views);
  var poly = [];
  for (var i = 0; i + 1 < m.poly.length; i += 2) poly.push(inkToCanvas(v, m.poly[i], m.poly[i + 1]));
  INK_SEL = null;
  if (poly.length < 3) return null;
  var ids = [];
  var box = null;
  INK_STORE.strokes.forEach(function (s) {
    var o = inkOrigin(s);
    if (!o) return;
    var pts = inkTriples(s.pts).map(function (p) { return [p[0] + o.x, p[1] + o.y]; });
    if (s.shape) pts = inkResample(s.closed ? pts.concat([pts[0]]) : pts, 24);
    var inside = 0;
    pts.forEach(function (p) { if (inkPointInPoly(p, poly)) inside++; });
    if (inside / pts.length < 0.6) return;
    ids.push(s.id);
    var b = inkAbsBox(s, o);
    box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  });
  if (!ids.length) return null;
  INK_SEL = { ids: ids };
  return {
    n: ids.length,
    x: box.x0 * v.z - v.ox, y: box.y0 * v.z - v.oy,
    w: (box.x1 - box.x0) * v.z, h: (box.y1 - box.y0) * v.z
  };
}

function inkSelected() {
  if (!INK_SEL) return [];
  return INK_SEL.ids.map(function (id) { return INK_STORE.byId[id]; }).filter(Boolean);
}

// Live preview while dragging a selection: translate the layers only.
function inkMovePreview(views, dx, dy) {
  var z = views.sv.zoomScale;
  inkNoAnim(function () {
    inkSelected().forEach(function (s) {
      var layer = INK_R.layers[s.id];
      if (layer) layer.position = { x: dx / z, y: dy / z };
    });
  });
}

function inkCopyStroke(s) {
  return { id: s.id, tool: s.tool, color: s.color, w: s.w, k: s.k, sim: s.sim, shape: s.shape, closed: s.closed, a: s.a, pts: s.pts.slice() };
}

function inkMoveCommit(views, dx, dy) {
  var z = views.sv.zoomScale;
  var olds = inkSelected();
  if (!olds.length || (!dx && !dy)) {
    inkMovePreview(views, 0, 0);
    return;
  }
  var news = olds.map(function (s) {
    var c = inkCopyStroke(s);
    for (var i = 0; i + 2 < c.pts.length; i += 3) {
      c.pts[i] = Math.round((c.pts[i] + dx / z) * 100) / 100;
      c.pts[i + 1] = Math.round((c.pts[i + 1] + dy / z) * 100) / 100;
    }
    return c;
  });
  var op = { add: news, remove: olds };
  inkApply(op);
  inkRecord(op);
  INK_SEL = { ids: news.map(function (s) { return s.id; }) };
}

function inkRecolorSelection(color) {
  var olds = inkSelected();
  if (!olds.length) return;
  var news = olds.map(function (s) {
    var c = inkCopyStroke(s);
    c.color = color;
    return c;
  });
  var op = { add: news, remove: olds };
  inkApply(op);
  inkRecord(op);
}

function inkDeleteSelection() {
  var olds = inkSelected();
  INK_SEL = null;
  if (!olds.length) return;
  var op = { add: [], remove: olds };
  inkApply(op);
  inkRecord(op);
}
