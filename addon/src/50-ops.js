// ---------------------------------------------------------------------------
// Editing operations: add, erase (whole stroke / partial / highlighter only),
// lasso select / move / resize / recolor / duplicate / delete, shape node
// editing, undo and redo. Input points arrive in overlay (screen) coordinates.
//
// Every change is an op {add: [strokes], remove: [strokes]}; undo applies the
// inverse. Moving, resizing or recoloring = remove the old copies + add new
// ones with the same ids. Eraser gestures merge into one op ({g: gesture id}).
// ---------------------------------------------------------------------------

var INK_UNDO = [];
var INK_REDO = [];
var INK_SEL = null; // { ids: [...] }
var INK_HIDDEN = null; // stroke id hidden while the page previews an edit

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

function inkToScreen(v, x, y) {
  return [x * v.z - v.ox, y * v.z - v.oy];
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

function inkRound(n) {
  return Math.round(n * 100) / 100;
}

function inkCopyStroke(s) {
  return {
    id: s.id, tool: s.tool, b: s.b, color: s.color, w: s.w, k: s.k, sim: s.sim, shape: s.shape, closed: s.closed,
    dash: s.dash, fill: s.fill, a: s.a, pts: s.pts ? s.pts.slice() : []
  };
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

// Merge into the open eraser op of the same gesture (pieces created and
// erased again within one gesture simply disappear from it).
function inkRecordGesture(g, added, removed) {
  var last = INK_UNDO[INK_UNDO.length - 1];
  if (!last || last.g !== g) {
    inkRecord({ add: added, remove: removed, g: g });
    return;
  }
  removed.forEach(function (s) {
    var i = last.add.indexOf(s);
    if (i >= 0) last.add.splice(i, 1);
    else last.remove.push(s);
  });
  last.add = last.add.concat(added);
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

// Re-anchor absolute canvas points to the best card and build the stroke.
function inkMakeStroke(base, absPts) {
  var s = inkCopyStroke(base);
  s.id = inkNewId();
  s.a = null;
  s.pts = absPts;
  delete s._box;
  var anchor = inkPickAnchor(INK_R.frames || {}, inkStrokeBox(s));
  delete s._box;
  if (anchor) {
    var f = INK_R.frames[anchor];
    for (var j = 0; j + 2 < s.pts.length; j += 3) {
      s.pts[j] = inkRound(s.pts[j] - f.x);
      s.pts[j + 1] = inkRound(s.pts[j + 1] - f.y);
    }
    s.a = anchor;
  }
  return s;
}

// m: { tool, b, color, size, sim, shape, closed, dash, pts: [x, y, p, …] } in screen units.
function inkCommitStroke(views, m) {
  var v = inkView(views);
  var pts = [];
  for (var i = 0; i + 2 < m.pts.length; i += 3) {
    var c = inkToCanvas(v, m.pts[i], m.pts[i + 1]);
    pts.push(inkRound(c[0]), inkRound(c[1]), m.pts[i + 2]);
  }
  if (pts.length < 3) return null;
  var tool = m.tool === 'marker' ? 'marker' : 'pen';
  var s = inkMakeStroke({
    tool: tool, b: inkBrushOf(tool, m.b), color: String(m.color || '#1d1d1f'),
    w: m.size / v.z, k: v.z, sim: !!m.sim, shape: !!m.shape, closed: !!m.closed, dash: !!m.dash
  }, pts);
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

// Absolute [x, y, p] points of a stroke; shapes become their (closed) polyline.
function inkAbsPoints(s, o) {
  var pts = inkTriples(s.pts).map(function (p) { return [p[0] + o.x, p[1] + o.y, p[2]]; });
  if (s.shape && s.closed && pts.length > 1) {
    var f = pts[0], l = pts[pts.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) pts.push([f[0], f[1], f[2]]);
  }
  if (pts.length === 1) pts.push(pts[0]);
  return pts;
}

function inkDensify(pts, gap) {
  var out = [pts[0]];
  for (var i = 1; i < pts.length; i++) {
    var a = pts[i - 1], b = pts[i];
    var n = Math.floor(inkDist(a, b) / gap);
    for (var k = 1; k <= n; k++) {
      var t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    out.push(b);
  }
  return out;
}

function inkReach(s, r) {
  return r + (s.shape ? inkShapeWidth(inkBrushOf(s.tool, s.b), s.w) : s.w) / 2;
}

function inkTouches(pts, e, reach) {
  for (var k = 1; k < pts.length; k++) {
    for (var j = 1; j < e.length; j++) {
      if (inkSegDist(pts[k - 1], pts[k], e[j - 1], e[j]) <= reach) return true;
    }
  }
  return false;
}

function inkNearEraser(p, e, reach) {
  for (var j = 1; j < e.length; j++) {
    if (inkDistToSegment(p, e[j - 1], e[j]) <= reach) return true;
  }
  return false;
}

// Partial eraser: cut the erased part out and keep the remaining pieces.
function inkSplitStroke(s, o, e, reach) {
  var pts = inkDensify(inkAbsPoints(s, o), Math.max(reach * 0.4, 0.5));
  var pieces = [], run = [];
  function flush() {
    if (run.length >= 2 && inkPathLength(run) > s.w * 0.8) {
      var flat = [];
      run.forEach(function (p) { flat.push(inkRound(p[0]), inkRound(p[1]), p[2]); });
      var piece = inkMakeStroke(s, flat);
      piece.closed = false;
      pieces.push(piece);
    }
    run = [];
  }
  for (var i = 0; i < pts.length; i++) {
    if (inkNearEraser(pts[i], e, reach)) flush();
    else run.push(pts[i]);
  }
  flush();
  return pieces;
}

// m: { pts: [x, y, …] screen, r: screen radius, g: gesture id, mode: 'stroke'|'partial', markerOnly }
function inkErase(views, m) {
  var v = inkView(views);
  var e = [];
  for (var i = 0; i + 1 < m.pts.length; i += 2) e.push(inkToCanvas(v, m.pts[i], m.pts[i + 1]));
  if (!e.length) return;
  if (e.length === 1) e.push(e[0]);
  var r = m.r / v.z;
  var eb = inkBBox(e);
  var removed = [], added = [];
  INK_STORE.strokes.forEach(function (s) {
    if (m.markerOnly && s.tool !== 'marker') return;
    var o = inkOrigin(s);
    if (!o) return;
    var b = inkAbsBox(s, o);
    if (b.x1 < eb.x0 - r || b.x0 > eb.x1 + r || b.y1 < eb.y0 - r || b.y0 > eb.y1 + r) return;
    var reach = inkReach(s, r);
    if (!inkTouches(inkAbsPoints(s, o), e, reach)) return;
    removed.push(s);
    if (m.mode === 'partial') added = added.concat(inkSplitStroke(s, o, e, m.r / v.z + 0.5 / v.z));
  });
  if (!removed.length) return;
  inkApply({ add: added, remove: removed });
  inkRecordGesture(m.g, added, removed);
}

function inkPointInPoly(p, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function inkSelected() {
  if (!INK_SEL) return [];
  return INK_SEL.ids.map(function (id) { return INK_STORE.byId[id]; }).filter(Boolean);
}

// Selection box (screen) plus, for a single editable shape, its nodes.
function inkSelectionInfo(views) {
  var v = inkView(views);
  var sel = inkSelected();
  var box = null;
  sel.forEach(function (s) {
    var o = inkOrigin(s);
    if (!o) return;
    var b = inkAbsBox(s, o);
    box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  });
  if (!box) {
    INK_SEL = null;
    return null;
  }
  var info = {
    n: sel.length,
    x: box.x0 * v.z - v.ox, y: box.y0 * v.z - v.oy,
    w: (box.x1 - box.x0) * v.z, h: (box.y1 - box.y0) * v.z
  };
  var s0 = sel[0];
  if (sel.length === 1 && s0.shape && s0.pts.length / 3 <= 16) {
    var o0 = inkOrigin(s0);
    var nodes = [];
    var tri = inkTriples(s0.pts);
    var count = s0.closed && tri.length > 1 ? tri.length - 1 : tri.length;
    for (var i = 0; i < count; i++) {
      var p = inkToScreen(v, tri[i][0] + o0.x, tri[i][1] + o0.y);
      nodes.push(Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10);
    }
    var brush = inkBrushOf(s0.tool, s0.b);
    info.shape = {
      id: s0.id, closed: !!s0.closed, pts: nodes, color: s0.color, dash: !!s0.dash,
      width: inkShapeWidth(brush, s0.w) * v.z, alpha: inkBrushAlpha(brush)
    };
  }
  return info;
}

// Select the strokes mostly inside a lasso.
function inkLasso(views, m) {
  var v = inkView(views);
  var poly = [];
  for (var i = 0; i + 1 < m.poly.length; i += 2) poly.push(inkToCanvas(v, m.poly[i], m.poly[i + 1]));
  INK_SEL = null;
  if (poly.length < 3) return null;
  var ids = [];
  INK_STORE.strokes.forEach(function (s) {
    var o = inkOrigin(s);
    if (!o) return;
    var pts = inkAbsPoints(s, o);
    if (s.shape) pts = inkResample(pts, 24);
    var inside = 0;
    pts.forEach(function (p) { if (inkPointInPoly(p, poly)) inside++; });
    if (inside / pts.length >= 0.6) ids.push(s.id);
  });
  if (!ids.length) return null;
  INK_SEL = { ids: ids };
  return inkSelectionInfo(views);
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

function inkTransformed(s, fn, wScale) {
  var c = inkCopyStroke(s);
  for (var i = 0; i + 2 < c.pts.length; i += 3) {
    var q = fn(c.pts[i], c.pts[i + 1]);
    c.pts[i] = inkRound(q[0]);
    c.pts[i + 1] = inkRound(q[1]);
  }
  if (wScale) c.w = s.w * wScale;
  return c;
}

function inkReplaceSelection(news, olds) {
  var op = { add: news, remove: olds };
  inkApply(op);
  inkRecord(op);
  INK_SEL = { ids: news.map(function (s) { return s.id; }) };
}

function inkMoveCommit(views, dx, dy) {
  var z = views.sv.zoomScale;
  var olds = inkSelected();
  if (!olds.length || (!dx && !dy)) {
    inkMovePreview(views, 0, 0);
    return;
  }
  inkReplaceSelection(olds.map(function (s) {
    return inkTransformed(s, function (x, y) { return [x + dx / z, y + dy / z]; });
  }), olds);
}

// Resize about a fixed screen point. m: { sx, sy, ax, ay }
function inkScaler(views, s, m) {
  var v = inkView(views);
  var o = inkOrigin(s) || { x: 0, y: 0 };
  var a = inkToCanvas(v, m.ax, m.ay);
  var lx = a[0] - o.x, ly = a[1] - o.y;
  return function (x, y) { return [lx + (x - lx) * m.sx, ly + (y - ly) * m.sy]; };
}

function inkScalePreview(views, m) {
  var sel = inkSelected();
  if (sel.length > 40) return; // big selections: the page shows the box only
  inkNoAnim(function () {
    sel.forEach(function (s) {
      var layer = INK_R.layers[s.id];
      if (!layer) return;
      var t = inkTransformed(s, inkScaler(views, s, m), Math.sqrt(Math.abs(m.sx * m.sy)));
      var path = inkStrokePath(t);
      if (path) layer.path = path;
      if (t.shape) layer.lineWidth = inkShapeWidth(inkBrushOf(t.tool, t.b), t.w);
    });
  });
}

function inkScaleCommit(views, m) {
  var olds = inkSelected();
  if (!olds.length) return;
  if (Math.abs(m.sx - 1) < 0.005 && Math.abs(m.sy - 1) < 0.005) {
    inkApply({ add: olds, remove: olds });
    return;
  }
  var wScale = Math.sqrt(Math.abs(m.sx * m.sy));
  inkReplaceSelection(olds.map(function (s) { return inkTransformed(s, inkScaler(views, s, m), wScale); }), olds);
}

function inkRecolorSelection(color) {
  var olds = inkSelected();
  if (!olds.length) return;
  inkReplaceSelection(olds.map(function (s) {
    var c = inkCopyStroke(s);
    c.color = color;
    return c;
  }), olds);
}

function inkDuplicateSelection(views) {
  var olds = inkSelected();
  if (!olds.length) return;
  var d = 24 / views.sv.zoomScale;
  var copies = olds.map(function (s) {
    var c = inkTransformed(s, function (x, y) { return [x + d, y + d]; });
    c.id = inkNewId();
    return c;
  });
  var op = { add: copies, remove: [] };
  inkApply(op);
  inkRecord(op);
  INK_SEL = { ids: copies.map(function (s) { return s.id; }) };
}

function inkDeleteSelection() {
  var olds = inkSelected();
  INK_SEL = null;
  if (!olds.length) return;
  var op = { add: [], remove: olds };
  inkApply(op);
  inkRecord(op);
}

// Node editing of a single shape: hide the native copy while the page previews.
function inkEditBegin(id) {
  var layer = INK_R && INK_R.layers[id];
  if (layer) layer.hidden = true;
  INK_HIDDEN = id;
}

function inkEditEnd(views, m) {
  var s = INK_STORE.byId[m.id];
  var layer = INK_R && INK_R.layers[m.id];
  if (layer) layer.hidden = false;
  INK_HIDDEN = null;
  if (!s || !m.pts) return;
  var v = inkView(views);
  var o = inkOrigin(s) || { x: 0, y: 0 };
  var pts = [];
  for (var i = 0; i + 1 < m.pts.length; i += 2) {
    var c = inkToCanvas(v, m.pts[i], m.pts[i + 1]);
    pts.push(inkRound(c[0] - o.x), inkRound(c[1] - o.y), 0.5);
  }
  if (s.closed) pts.push(pts[0], pts[1], 0.5);
  var c2 = inkCopyStroke(s);
  c2.pts = pts;
  inkReplaceSelection([c2], [s]);
}

// Snap targets for the page: corners of visible straight-edged shapes and
// centres of circles / ellipses, in mind map units.
function inkSnapNodes() {
  var out = [];
  if (!INK_STORE) return out;
  for (var i = 0; i < INK_STORE.strokes.length && out.length < 4000; i++) {
    var s = INK_STORE.strokes[i];
    if (!s.shape) continue;
    var o = inkOrigin(s);
    if (!o) continue;
    var tri = inkTriples(s.pts);
    if (tri.length <= 16) {
      tri.forEach(function (p) { out.push(inkRound(p[0] + o.x), inkRound(p[1] + o.y)); });
    } else {
      var b = inkStrokeBox(s);
      out.push(inkRound((b.x0 + b.x1) / 2 + o.x), inkRound((b.y0 + b.y1) / 2 + o.y));
    }
  }
  return out;
}
