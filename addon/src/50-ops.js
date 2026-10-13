// ---------------------------------------------------------------------------
// Editing operations on the surface the overlay is on: add, erase (whole
// stroke / partial / highlighter only), lasso select (anything it touches) /
// move / resize / rotate / recolor / copy / cut / paste / delete, shape node
// editing. Input points arrive in overlay (screen) coordinates.
//
// Changes are applied in memory at once and written to the notebook by
// inkCommit(label) — one step in MarginNote's own undo history. Undo / redo
// call MarginNote's UndoManager and reload the ink from the notebook.
// ---------------------------------------------------------------------------

var INK_SEL = null;      // { ids: [...] }
var INK_HIDDEN = null;   // stroke id hidden while the page previews a node edit
var INK_CLIP = null;     // copied strokes, in screen units around their centre

function inkResetHistory() {
  INK_SEL = null;
}

function inkView(views) {
  return inkSurfView(views.active);
}

function inkToCanvas(v, x, y) {
  return [(x + v.ox) / v.z, (y + v.oy) / v.z];
}

function inkToScreen(v, x, y) {
  return [x * v.z - v.ox, y * v.z - v.oy];
}

// Placement of a stroke's group, or null when it is not on screen.
function inkOrigin(s) {
  return inkPlaceOf(inkGroupKey(s));
}

function inkAbsBox(s, o) {
  var b = inkStrokeBox(s);
  return { x0: b.x0 * o.s + o.x, y0: b.y0 * o.s + o.y, x1: b.x1 * o.s + o.x, y1: b.y1 * o.s + o.y };
}

function inkRound(n) {
  return Math.round(n * 100) / 100;
}

function inkCopyStroke(s) {
  return {
    id: s.id, tool: s.tool, b: s.b, color: s.color, w: s.w, k: s.k, ps: s.ps, sim: s.sim, shape: s.shape,
    closed: s.closed, dash: s.dash, fill: s.fill, op: s.op, l: s.l, a: s.a, pts: s.pts ? s.pts.slice() : []
  };
}

function inkApply(op) {
  var store = INK_STORE;
  inkNoAnim(function () {
    (op.remove || []).forEach(function (s) {
      delete store.byId[s.id];
      store.dirty[inkGroupKey(s)] = true;
      inkUnrenderStroke(s.id);
    });
    if ((op.remove || []).length) {
      store.strokes = store.strokes.filter(function (s) { return !!store.byId[s.id]; });
    }
    (op.add || []).forEach(function (s) {
      store.byId[s.id] = s;
      store.strokes.push(s);
      store.dirty[inkGroupKey(s)] = true;
      inkRenderStroke(s);
    });
  });
}

function inkUndoRedo(addon, redo) {
  inkCommit();
  var um = UndoManager.sharedInstance();
  if (redo ? !um.canRedo() : !um.canUndo()) return false;
  if (redo) um.redo();
  else um.undo();
  INK_SEL = null;
  if (inkReloadIfChanged()) inkRerenderAll(addon);
  return true;
}

function inkHistoryState() {
  var um = UndoManager.sharedInstance();
  return { canUndo: !!um.canUndo(), canRedo: !!um.canRedo(), count: INK_STORE ? INK_STORE.strokes.length : 0 };
}

// Absolute surface points → a stroke in the right group (card or page).
function inkMakeStroke(base, absPts, ctx, v, forceKey) {
  var s = inkCopyStroke(base);
  s.id = base.id || inkNewId();
  s.pts = absPts;
  s.a = null;
  var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (var i = 0; i + 2 < absPts.length; i += 3) {
    bx0 = Math.min(bx0, absPts[i]); bx1 = Math.max(bx1, absPts[i]);
    by0 = Math.min(by0, absPts[i + 1]); by1 = Math.max(by1, absPts[i + 1]);
  }
  var surf = inkSurf(ctx.kind);
  var place = surf ? surf.place : {};
  var key = forceKey && place[forceKey] ? forceKey : ctx.kind === 'map'
    ? inkPickAnchor(place, { x0: bx0, y0: by0, x1: bx1, y1: by1 })
    : inkPickPage(place, (bx0 + bx1) / 2, (by0 + by1) / 2);
  var p = key ? place[key] : null;
  if (ctx.kind === 'doc' && !p) return null;
  if (!p) p = { x: 0, y: 0, s: 1 };
  var sc = p.s;
  for (var j = 0; j + 2 < s.pts.length; j += 3) {
    s.pts[j] = inkRound((s.pts[j] - p.x) / sc);
    s.pts[j + 1] = inkRound((s.pts[j + 1] - p.y) / sc);
  }
  s.w = base.w / sc;
  s.k = (v ? v.z : 1) * sc;
  s.a = key || null;
  delete s._box;
  return s;
}

// m: { tool, b, color, size, ps, sim, shape, closed, dash, pts: [x, y, p, …] } in screen units.
function inkCommitStroke(views, m) {
  var ctx = views.active;
  var v = inkView(views);
  var pts = [];
  for (var i = 0; i + 2 < m.pts.length; i += 3) {
    var c = inkToCanvas(v, m.pts[i], m.pts[i + 1]);
    pts.push(inkRound(c[0]), inkRound(c[1]), m.pts[i + 2]);
  }
  if (pts.length < 3) return null;
  var tool = m.tool === 'marker' ? 'marker' : 'pen';
  var s = inkMakeStroke({
    id: inkNewId(), tool: tool, b: inkBrushOf(tool, m.b), color: String(m.color || '#1d1d1f'), w: m.size / v.z,
    ps: m.ps == null ? null : m.ps, sim: !!m.sim, shape: !!m.shape, closed: !!m.closed, dash: !!m.dash,
    op: m.op == null || m.op >= 1 ? null : m.op, l: inkActiveLayer()
  }, pts, ctx, v, inkBindTarget(views));
  if (!s) return null;
  if (s.ps == null) delete s.ps;
  if (s.op == null) delete s.op;
  if (s.l === 'default') delete s.l;
  inkApply({ add: [s], remove: [] });
  inkCommit(m.shape ? '图形' : '书写');
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
  var pts = inkTriples(s.pts).map(function (p) { return [p[0] * o.s + o.x, p[1] * o.s + o.y, p[2]]; });
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
    var n = Math.min(400, Math.floor(inkDist(a, b) / gap));
    for (var k = 1; k <= n; k++) {
      var t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    out.push(b);
  }
  return out;
}

function inkAbsWidth(s, o) {
  return (s.shape ? inkShapeWidth(inkBrushOf(s.tool, s.b), s.w) : s.w) * o.s;
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
function inkSplitStroke(s, o, e, reach, ctx) {
  var pts = inkDensify(inkAbsPoints(s, o), Math.max(reach * 0.4, 0.5 / (o.s || 1)));
  var pieces = [], run = [];
  var w = s.w * o.s;
  function flush() {
    if (run.length >= 2 && inkPathLength(run) > w * 0.8) {
      var flat = [];
      run.forEach(function (p) { flat.push(inkRound(p[0]), inkRound(p[1]), p[2]); });
      var base = inkCopyStroke(s);
      base.id = inkNewId();
      base.w = w;
      var piece = inkMakeStroke(base, flat, ctx, { z: (s.k || 1) / (o.s || 1) });
      if (piece) {
        piece.closed = false;
        pieces.push(piece);
      }
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
// Applied at once; written to the notebook when the gesture ends (eraseEnd).
function inkErase(views, m) {
  var ctx = views.active;
  var v = inkView(views);
  var e = [];
  for (var i = 0; i + 1 < m.pts.length; i += 2) e.push(inkToCanvas(v, m.pts[i], m.pts[i + 1]));
  if (!e.length) return;
  if (e.length === 1) e.push(e[0]);
  var r = m.r / v.z;
  var eb = inkBBox(e);
  var removed = [], added = [];
  INK_STORE.strokes.forEach(function (s) {
    if (!inkEditable(s, ctx)) return;
    if (m.markerOnly && s.tool !== 'marker') return;
    var o = inkOrigin(s);
    if (!o) return;
    var b = inkAbsBox(s, o);
    if (b.x1 < eb.x0 - r || b.x0 > eb.x1 + r || b.y1 < eb.y0 - r || b.y0 > eb.y1 + r) return;
    var reach = r + inkAbsWidth(s, o) / 2;
    if (!inkTouches(inkAbsPoints(s, o), e, reach)) return;
    removed.push(s);
    if (m.mode === 'partial') added = added.concat(inkSplitStroke(s, o, e, r + 0.5 / v.z, ctx));
  });
  if (removed.length) inkApply({ add: added, remove: removed });
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
      var p = inkToScreen(v, tri[i][0] * o0.s + o0.x, tri[i][1] * o0.s + o0.y);
      nodes.push(Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10);
    }
    var brush = inkBrushOf(s0.tool, s0.b);
    info.shape = {
      id: s0.id, closed: !!s0.closed, pts: nodes, color: s0.color, dash: !!s0.dash,
      width: inkAbsWidth(s0, o0) * v.z, alpha: inkBrushAlpha(brush)
    };
  }
  return info;
}

function inkTypeOf(s) {
  if (s.tool === 'marker') return 'marker';
  return s.shape ? 'shape' : 'pen';
}

// GoodNotes-style lasso: a stroke is selected when any part of it is inside
// the lasso or crosses its outline. m: { poly: [x, y, …] screen, types: {pen, marker, shape} }
function inkLasso(views, m) {
  var ctx = views.active;
  var v = inkView(views);
  var poly = [];
  for (var i = 0; i + 1 < m.poly.length; i += 2) poly.push(inkToCanvas(v, m.poly[i], m.poly[i + 1]));
  INK_SEL = null;
  if (poly.length < 3) return null;
  var ring = poly.concat([poly[0]]);
  var pb = inkBBox(poly);
  var types = m.types || { pen: true, marker: true, shape: true };
  var ids = [];
  INK_STORE.strokes.forEach(function (s) {
    if (!inkEditable(s, ctx) || types[inkTypeOf(s)] === false) return;
    var o = inkOrigin(s);
    if (!o) return;
    var b = inkAbsBox(s, o);
    if (b.x1 < pb.x0 || b.x0 > pb.x1 || b.y1 < pb.y0 || b.y0 > pb.y1) return;
    var pts = inkAbsPoints(s, o);
    for (var k = 0; k < pts.length; k++) {
      if (inkPointInPoly(pts[k], poly)) { ids.push(s.id); return; }
    }
    if (inkTouches(pts, ring, inkAbsWidth(s, o) / 2)) ids.push(s.id);
  });
  if (!ids.length) return null;
  INK_SEL = { ids: ids };
  return inkSelectionInfo(views);
}

// Live preview while dragging a selection: translate the layers only.
function inkMovePreview(views, dx, dy) {
  var z = inkView(views).z;
  inkNoAnim(function () {
    inkSelected().forEach(function (s) {
      var layer = inkLayerOf(s.id);
      if (layer) layer.position = { x: dx / z, y: dy / z };
    });
  });
}

// Re-place a stroke after a transform of its absolute points.
function inkTransformed(s, ctx, v, fn, wScale, forceKey) {
  var o = inkOrigin(s) || { x: 0, y: 0, s: 1 };
  var abs = [];
  inkTriples(s.pts).forEach(function (p) {
    var q = fn(p[0] * o.s + o.x, p[1] * o.s + o.y);
    abs.push(inkRound(q[0]), inkRound(q[1]), p[2]);
  });
  var base = inkCopyStroke(s);
  base.w = s.w * o.s * (wScale || 1);
  var t = inkMakeStroke(base, abs, ctx, { z: (s.k || 1) / (o.s || 1) }, forceKey);
  return t;
}

function inkReplaceSelection(news, olds, label) {
  news = news.filter(Boolean);
  inkApply({ add: news, remove: olds });
  inkCommit(label);
  INK_SEL = { ids: news.map(function (s) { return s.id; }) };
}

function inkMoveCommit(views, dx, dy) {
  var v = inkView(views);
  var olds = inkSelected();
  if (!olds.length || (!dx && !dy)) {
    inkMovePreview(views, 0, 0);
    return;
  }
  inkReplaceSelection(olds.map(function (s) {
    return inkTransformed(s, views.active, v, function (x, y) { return [x + dx / v.z, y + dy / v.z]; });
  }), olds, '移动');
}

// Resize / rotate about a fixed screen point. m: { sx, sy, rot, ax, ay }
function inkTransformFn(views, m) {
  var v = inkView(views);
  var a = inkToCanvas(v, m.ax, m.ay);
  var c = Math.cos(m.rot || 0), sn = Math.sin(m.rot || 0);
  var sx = m.sx || 1, sy = m.sy || 1;
  return function (x, y) {
    var dx = (x - a[0]) * sx, dy = (y - a[1]) * sy;
    return [a[0] + dx * c - dy * sn, a[1] + dx * sn + dy * c];
  };
}

function inkTransformPreview(views, m) {
  var sel = inkSelected();
  if (sel.length > 40) return; // big selections: the page shows the box only
  var v = inkView(views);
  var fn = inkTransformFn(views, m);
  var wScale = Math.sqrt(Math.abs((m.sx || 1) * (m.sy || 1)));
  inkNoAnim(function () {
    sel.forEach(function (s) {
      var layer = inkLayerOf(s.id);
      var o = inkOrigin(s);
      if (!layer || !o) return;
      var abs = inkTriples(s.pts).map(function (p) { return fn(p[0] * o.s + o.x, p[1] * o.s + o.y); });
      var t = inkCopyStroke(s);
      t.pts = [];
      abs.forEach(function (q, i) { t.pts.push((q[0] - o.x) / o.s, (q[1] - o.y) / o.s, s.pts[i * 3 + 2]); });
      t.w = s.w * wScale;
      var path = inkStrokePath(t, o.s);
      if (path) layer.path = path;
      if (t.shape) layer.lineWidth = inkAbsWidth(t, o);
    });
  });
}

function inkTransformCommit(views, m) {
  var olds = inkSelected();
  if (!olds.length) return;
  var idle = Math.abs((m.sx || 1) - 1) < 0.005 && Math.abs((m.sy || 1) - 1) < 0.005 && Math.abs(m.rot || 0) < 0.003;
  if (idle) {
    inkNoAnim(function () { olds.forEach(function (s) { inkUnrenderStroke(s.id); inkRenderStroke(s); }); });
    return;
  }
  var v = inkView(views);
  var fn = inkTransformFn(views, m);
  var wScale = Math.sqrt(Math.abs((m.sx || 1) * (m.sy || 1)));
  inkReplaceSelection(olds.map(function (s) { return inkTransformed(s, views.active, v, fn, wScale); }), olds, m.rot ? '旋转' : '缩放');
}

function inkRecolorSelection(color) {
  var olds = inkSelected();
  if (!olds.length) return;
  inkReplaceSelection(olds.map(function (s) {
    var c = inkCopyStroke(s);
    c.color = color;
    return c;
  }), olds, '改颜色');
}

function inkDuplicateSelection(views) {
  var olds = inkSelected();
  if (!olds.length) return;
  var v = inkView(views);
  var d = 24 / v.z;
  var copies = olds.map(function (s) {
    var c = inkTransformed(s, views.active, v, function (x, y) { return [x + d, y + d]; });
    if (c) c.id = inkNewId();
    return c;
  }).filter(Boolean);
  inkApply({ add: copies, remove: [] });
  inkCommit('复制');
  INK_SEL = { ids: copies.map(function (s) { return s.id; }) };
}

// Clipboard keeps screen-unit geometry, so a paste looks the same size.
function inkCopySelection(views) {
  var sel = inkSelected();
  if (!sel.length) return 0;
  var v = inkView(views);
  var items = [], bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  sel.forEach(function (s) {
    var o = inkOrigin(s);
    if (!o) return;
    var pts = [];
    inkTriples(s.pts).forEach(function (p) {
      var q = inkToScreen(v, p[0] * o.s + o.x, p[1] * o.s + o.y);
      pts.push(q[0], q[1], p[2]);
      bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]);
    });
    var c = inkCopyStroke(s);
    c.w = s.w * o.s * v.z; // screen units
    c.pts = pts;
    items.push(c);
  });
  var cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  items.forEach(function (c) {
    for (var i = 0; i + 2 < c.pts.length; i += 3) { c.pts[i] -= cx; c.pts[i + 1] -= cy; }
  });
  INK_CLIP = items;
  return items.length;
}

function inkPaste(views, m) {
  if (!INK_CLIP || !INK_CLIP.length) return;
  var ctx = views.active;
  var v = inkView(views);
  var news = INK_CLIP.map(function (c) {
    var abs = [];
    for (var i = 0; i + 2 < c.pts.length; i += 3) {
      var q = inkToCanvas(v, c.pts[i] + m.x, c.pts[i + 1] + m.y);
      abs.push(inkRound(q[0]), inkRound(q[1]), c.pts[i + 2]);
    }
    var base = inkCopyStroke(c);
    base.id = inkNewId();
    base.w = c.w / v.z;
    return inkMakeStroke(base, abs, ctx, v);
  }).filter(Boolean);
  inkApply({ add: news, remove: [] });
  inkCommit('粘贴');
  INK_SEL = { ids: news.map(function (s) { return s.id; }) };
}

function inkDeleteSelection(label) {
  var olds = inkSelected();
  INK_SEL = null;
  if (!olds.length) return;
  inkApply({ add: [], remove: olds });
  inkCommit(label || '删除');
}

// Node editing of a single shape: hide the native copy while the page previews.
function inkEditBegin(id) {
  var layer = inkLayerOf(id);
  if (layer) layer.hidden = true;
  INK_HIDDEN = id;
}

function inkEditEnd(views, m) {
  var s = INK_STORE.byId[m.id];
  var layer = inkLayerOf(m.id);
  if (layer) layer.hidden = false;
  INK_HIDDEN = null;
  if (!s || !m.pts) return;
  var v = inkView(views);
  var o = inkOrigin(s) || { x: 0, y: 0, s: 1 };
  var pts = [];
  for (var i = 0; i + 1 < m.pts.length; i += 2) {
    var c = inkToCanvas(v, m.pts[i], m.pts[i + 1]);
    pts.push(inkRound((c[0] - o.x) / o.s), inkRound((c[1] - o.y) / o.s), 0.5);
  }
  if (s.closed) pts.push(pts[0], pts[1], 0.5);
  var c2 = inkCopyStroke(s);
  c2.pts = pts;
  inkReplaceSelection([c2], [s], '编辑节点');
}

// Snap targets for the page: corners of visible straight-edged shapes and
// centres of circles / ellipses, in surface units.
function inkSnapNodes(views) {
  var out = [];
  if (!INK_STORE || !views || !views.active) return out;
  for (var i = 0; i < INK_STORE.strokes.length && out.length < 4000; i++) {
    var s = INK_STORE.strokes[i];
    if (!s.shape || !inkOnSurface(s, views.active) || inkLayerHidden(inkLayerOfStroke(s))) continue;
    var o = inkOrigin(s);
    if (!o) continue;
    var tri = inkTriples(s.pts);
    if (tri.length <= 16) {
      tri.forEach(function (p) { out.push(inkRound(p[0] * o.s + o.x), inkRound(p[1] * o.s + o.y)); });
    } else {
      var b = inkStrokeBox(s);
      out.push(inkRound(((b.x0 + b.x1) / 2) * o.s + o.x), inkRound(((b.y0 + b.y1) / 2) * o.s + o.y));
    }
  }
  return out;
}

// ---- layers / binding / picking / cards ------------------------------------------

var INK_ACTIVE_LAYER_KEY = 'io.github.jacky1n7.mnink.activeLayer';

// The active layer is a per-device view setting (not an undo step).
function inkActiveLayer() {
  var meta = INK_STORE && INK_STORE.meta;
  if (!meta) return 'default';
  try {
    var all = JSON.parse(String(NSUserDefaults.standardUserDefaults().objectForKey(INK_ACTIVE_LAYER_KEY) || '{}'));
    var id = all[INK_STORE.topicId];
    if (id && meta.layers.some(function (l) { return l.id === id; })) return id;
  } catch (e) {}
  return meta.layers[0].id;
}

function inkSetActiveLayer(id) {
  var all = {};
  try {
    all = JSON.parse(String(NSUserDefaults.standardUserDefaults().objectForKey(INK_ACTIVE_LAYER_KEY) || '{}'));
  } catch (e) {}
  all[INK_STORE.topicId] = id;
  NSUserDefaults.standardUserDefaults().setObjectForKey(JSON.stringify(all), INK_ACTIVE_LAYER_KEY);
}

// Strokes that eraser / lasso may touch: on this surface, in the active, visible layer.
function inkEditable(s, ctx) {
  if (!inkOnSurface(s, ctx)) return false;
  var l = inkLayerOfStroke(s);
  return l === inkActiveLayer() && !inkLayerHidden(l);
}

function inkLayersInfo() {
  var meta = INK_STORE ? INK_STORE.meta : inkDefaultMeta();
  var counts = {};
  (INK_STORE ? INK_STORE.strokes : []).forEach(function (s) {
    var l = inkLayerOfStroke(s);
    counts[l] = (counts[l] || 0) + 1;
  });
  return {
    active: inkActiveLayer(),
    layers: meta.layers.map(function (l) { return { id: l.id, name: l.name, hidden: !!l.hidden, n: counts[l.id] || 0 }; })
  };
}

function inkLayerOp(addon, m) {
  var store = INK_STORE;
  if (!store || store.file) return '笔迹暂存在本机文件里时不支持图层';
  var meta = store.meta;
  var layer = null;
  for (var i = 0; i < meta.layers.length; i++) if (meta.layers[i].id === m.id) layer = meta.layers[i];
  if (m.op === 'add') {
    var id = 'L' + inkNewId();
    meta.layers.push({ id: id, name: String(m.name || '图层 ' + (meta.layers.length + 1)), hidden: false });
    inkSaveMeta('新建图层');
    inkSetActiveLayer(id);
  } else if (m.op === 'activate' && layer) {
    inkSetActiveLayer(layer.id);
  } else if (m.op === 'rename' && layer) {
    layer.name = String(m.name || layer.name).slice(0, 40);
    inkSaveMeta('重命名图层');
  } else if (m.op === 'toggle' && layer) {
    layer.hidden = !layer.hidden;
    inkSaveMeta(layer.hidden ? '隐藏图层' : '显示图层');
    inkRerenderAll(addon);
  } else if (m.op === 'delete' && layer) {
    if (meta.layers.length <= 1) return '至少要保留一个图层';
    var doomed = store.strokes.filter(function (s) { return inkLayerOfStroke(s) === layer.id; });
    UndoManager.sharedInstance().undoGrouping('MN Ink: 删除图层', store.topicId, function () {
      if (doomed.length) {
        inkApply({ add: [], remove: doomed });
        inkCommit('删除图层');
      }
      meta.layers = meta.layers.filter(function (l) { return l.id !== layer.id; });
      inkSaveMeta('删除图层');
    });
    if (inkActiveLayer() === layer.id) inkSetActiveLayer(meta.layers[0].id);
  }
  INK_SEL = null;
  return null;
}

// "Bind handwriting to the selected card": the mind map's focused card, if visible.
function inkBindTarget(views) {
  var p = inkLoadPrefs();
  if (!p || !p.bindSelected || !views.active || views.active.kind !== 'map') return null;
  var nc = views.sc.notebookController;
  var fn = nc ? nc.focusNote : null;
  return fn ? String(fn.noteId) : null;
}

// Card under a screen point (smallest frame containing it).
function inkCardAt(views, x, y) {
  if (!views.active || views.active.kind !== 'map') return null;
  var v = inkView(views);
  var c = inkToCanvas(v, x, y);
  var surf = inkSurf('map');
  var best = null, area = Infinity;
  for (var id in (surf ? surf.place : {})) {
    var f = surf.place[id];
    if (c[0] >= f.x && c[0] <= f.x + f.w && c[1] >= f.y && c[1] <= f.y + f.h && f.w * f.h < area) {
      best = id;
      area = f.w * f.h;
    }
  }
  return best;
}

function inkBindSelectionAt(views, m) {
  var key = inkCardAt(views, m.x, m.y);
  if (!key) return '这里没有卡片';
  var v = inkView(views);
  var olds = inkSelected();
  if (!olds.length) return null;
  inkReplaceSelection(olds.map(function (s) {
    return inkTransformed(s, views.active, v, function (x, y) { return [x, y]; }, 1, key);
  }), olds, '绑定到卡片');
  return null;
}

// Double tap on a card: select it, then run MarginNote's own "Focus" command
// (the card's branch becomes a focus layer, as with MN's pen settings
// "Double Tap the Card to Enter the Focus"). FocusNote acts on the selected
// card, and the selection only lands after focusNoteInMindMapById's animation.
function inkTapCard(views, m) {
  var key = inkCardAt(views, m.x, m.y);
  if (!key) return false;
  var sc = views.sc;
  sc.focusNoteInMindMapById(key);
  var tries = 0;
  var go = function () {
    inkSafe(function () {
      var nc = sc.notebookController;
      var fn = nc ? nc.focusNote : null;
      if ((!fn || String(fn.noteId) !== key) && ++tries < 6) {
        NSTimer.scheduledTimerWithTimeInterval(0.15, false, go);
        return;
      }
      inkApp().processCommandWithKeyFlagsInWindow('FocusNote', 0, INK_ADDONS[0].window);
      // The canvas is rebuilt for the focus layer; re-attach the ink right away.
      NSTimer.scheduledTimerWithTimeInterval(0.35, false, function () {
        inkSafe(function () {
          var v = inkSync(INK_ADDONS[0]);
          if (INK_UI && v && v.active) {
            INK_UI.web.frame = v.active.host.frame;
            inkCall('setView', inkSurfView(v.active));
            inkPushState(v, { nodes: true, sel: true });
          }
        });
      });
    });
  };
  NSTimer.scheduledTimerWithTimeInterval(0.25, false, go);
  return true;
}

// Eyedropper: the colour of the visible stroke nearest to a screen point.
function inkPick(views, m) {
  var ctx = views.active;
  var v = inkView(views);
  var p = inkToCanvas(v, m.x, m.y);
  var best = null, bestD = 14 / v.z;
  INK_STORE.strokes.forEach(function (s) {
    if (!inkOnSurface(s, ctx) || inkLayerHidden(inkLayerOfStroke(s))) return;
    var o = inkOrigin(s);
    if (!o) return;
    var pts = inkAbsPoints(s, o);
    for (var i = 1; i < pts.length; i++) {
      var d = inkDistToSegment(p, pts[i - 1], pts[i]) - inkAbsWidth(s, o) / 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
  });
  return best ? { color: best.color, op: best.op == null ? 1 : best.op, tool: best.tool, b: inkBrushOf(best.tool, best.b) } : null;
}

// Geometry of the selection in screen units, for the page to rasterise.
function inkSelectionDrawing(views) {
  var v = inkView(views);
  return inkSelected().map(function (s) {
    var o = inkOrigin(s) || { x: 0, y: 0, s: 1 };
    var pts = [];
    inkTriples(s.pts).forEach(function (p) {
      var q = inkToScreen(v, p[0] * o.s + o.x, p[1] * o.s + o.y);
      pts.push(Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10, p[2]);
    });
    return {
      tool: s.tool, b: inkBrushOf(s.tool, s.b), color: s.color, op: s.op == null ? 1 : s.op, size: s.w * o.s * v.z,
      ps: s.ps, sim: s.sim, shape: !!s.shape, closed: !!s.closed, dash: !!s.dash, pts: pts
    };
  });
}

// Turn the selection into a card holding it as an image (one undo step).
function inkCreateCard(views, m) {
  var sel = inkSelected();
  if (!sel.length || !m.png) return '没有选中笔迹';
  var db = inkDb();
  var T = views.topicId;
  var a = sel[0].a;
  var parent = a && a.indexOf('page:') !== 0 ? db.getNoteById(a) : null;
  var note = null;
  UndoManager.sharedInstance().undoGrouping('MN Ink: 转为卡片', T, function () {
    note = db.createNoteWithTitleTopicid('', T);
    note.excerptTextMarkdown = 1;
    note.excerptText = '![手写](data:image/png;base64,' + m.png + ')';
    if (parent) parent.addChild(note);
    if (!m.keep) {
      inkApply({ add: [], remove: sel });
      inkCommit('转为卡片');
    }
  });
  INK_SEL = null;
  inkApp().refreshAfterDBChanged(T);
  return null;
}
