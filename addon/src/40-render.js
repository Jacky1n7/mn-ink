// ---------------------------------------------------------------------------
// Native rendering: one CAShapeLayer per stroke, inside MarginNote's own
// scrolling views, so ink pans and zooms with the content and stays vector.
//
// Two surfaces:
//   map  notebookController.mindmapView      MindMapScrollView (a UIView!)
//          └ UIScrollView (contentOffset / zoomScale)
//              └ MindMapCanvas                ← ink root; mind map units
//        groups: one per anchor card (origin = card frame), "_" = absolute.
//   doc  readerController.currentDocumentController.view   MbUIBookView
//          └ MbUIBookScrollView (a UIScrollView: bounds.origin = offset)
//              └ UIView (content)              ← ink root; content units
//                  └ PDFPageScrollView × visible page segments (recycled!)
//        groups: one per page segment "page:<md5>:<index>", stored in units
//        of page-width/1000, placed at the segment's frame in the content.
//        Segment index = currPageIndex (the segment at the viewport's middle)
//        ± position among the visible segments sorted by y.
//
// Never read UIScrollView properties on mindmapView itself, never assign null
// to a CGColor property, never assign `bezier.CGPath` (pass the UIBezierPath),
// never use CAShapeLayer.layer() (use .new()): each aborts MarginNote.
// ---------------------------------------------------------------------------

var INK_ROOT_TAG = 5148011;
var INK_SURF = {};       // kind → { kind, root, markerRoot, penRoot, groups, layers, place }
var INK_DOC_CACHE = {};  // md5 → { width, place: {key: {x, y, s, h}} }

function inkClassName(obj) {
  return String(obj).replace(/^\[object |\]$/g, '');
}

function inkVisible(v) {
  if (!v || !v.window) return false;
  for (var x = v; x; x = x.superview) {
    if (x.hidden || x.alpha === 0) return false;
  }
  return v.frame.width > 40 && v.frame.height > 40;
}

// The scroll view is a plain UIScrollView until MarginNote's own pen has been
// used; then it is a PKCanvasView (PencilKit) whose content view holds the
// MindMapCanvas next to MarginNote's own ink (PKCanvasAttachmentView).
function inkFindMap(sc) {
  var mv = sc.notebookController ? sc.notebookController.mindmapView : null;
  if (!mv || !mv.subviews || !inkVisible(mv)) return null;
  var subs = mv.subviews;
  for (var i = 0; i < subs.length; i++) {
    var cls = inkClassName(subs[i]);
    if (!/ScrollView$/.test(cls) && cls !== 'PKCanvasView') continue;
    var sv = subs[i];
    var canvas = inkFindChild(sv, 'MindMapCanvas', 2);
    if (canvas) return { kind: 'map', host: mv, scroll: sv, canvas: canvas, mv: mv };
  }
  return null;
}

function inkFindChild(v, cls, depth) {
  var subs = v.subviews || [];
  for (var i = 0; i < subs.length; i++) {
    if (inkClassName(subs[i]) === cls) return subs[i];
  }
  if (depth > 1) {
    for (var j = 0; j < subs.length; j++) {
      if ((subs[j].subviews || []).length > 20) continue;
      var hit = inkFindChild(subs[j], cls, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function inkFindDoc(sc) {
  var rc = sc.readerController;
  var dc = rc ? rc.currentDocumentController : null;
  if (!dc || !dc.docMd5) return null;
  var bv = dc.view;
  if (!bv || !inkVisible(bv)) return null;
  var bsv = null;
  var subs = bv.subviews || [];
  for (var i = 0; i < subs.length; i++) {
    if (inkClassName(subs[i]) === 'MbUIBookScrollView') { bsv = subs[i]; break; }
  }
  if (!bsv || !bsv.subviews || !bsv.subviews.length) return null;
  return { kind: 'doc', host: bv, scroll: bsv, canvas: bsv.subviews[0], dc: dc, md5: String(dc.docMd5) };
}

function inkFindViews(addon) {
  var sc = inkStudy(addon);
  if (!sc || !sc.notebookController) return null;
  var topicId = sc.notebookController.notebookId ? String(sc.notebookController.notebookId) : '';
  if (!topicId) return null;
  var views = { sc: sc, topicId: topicId, map: inkFindMap(sc), doc: inkFindDoc(sc), active: null };
  if (!views.map && !views.doc) return null;
  if (INK_UI && views[INK_UI.surface]) views.active = views[INK_UI.surface];
  return views;
}

// Screen (overlay) ↔ surface units: canvas = (screen + o) / z.
function inkSurfView(ctx) {
  if (ctx.kind === 'map') {
    var off = ctx.scroll.contentOffset;
    return { ox: off.x, oy: off.y, z: ctx.scroll.zoomScale };
  }
  var b = ctx.scroll.bounds, cf = ctx.canvas.frame, cb = ctx.canvas.bounds;
  var z = cb.width ? cf.width / cb.width : 1;
  return { ox: b.x - cf.x, oy: b.y - cf.y, z: z };
}

function inkNoAnim(fn) {
  CATransaction.begin();
  CATransaction.setDisableActions(true);
  try {
    fn();
  } finally {
    CATransaction.commit();
  }
}

var INK_COLOR_CACHE = {};

function inkColor(hex, alpha) {
  var key = hex + '/' + alpha;
  if (INK_COLOR_CACHE[key]) return INK_COLOR_CACHE[key];
  var n = parseInt(String(hex).replace('#', ''), 16) || 0;
  var c = UIColor.colorWithRedGreenBlueAlpha(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha);
  INK_COLOR_CACHE[key] = c;
  return c;
}

// Unflatten pts → [[x, y, p], …].
function inkTriples(flat) {
  var out = [];
  for (var i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

function inkSurfaceKind(s) {
  return s.a && s.a.indexOf('page:') === 0 ? 'doc' : 'map';
}

// Does the stroke belong to what this surface currently shows?
function inkOnSurface(s, ctx) {
  if (ctx.kind === 'map') return inkSurfaceKind(s) === 'map';
  return !!s.a && s.a.indexOf('page:' + ctx.md5 + ':') === 0;
}

// Outline in group units (perfect-freehand runs at the drawing-time scale k).
function inkStrokeOutline(s) {
  var k = s.k || 1;
  var pts = inkTriples(s.pts).map(function (p) { return [p[0] * k, p[1] * k, p[2]]; });
  var outline = INK_FREEHAND.getStroke(pts, inkFreehandOptions(inkBrushOf(s.tool, s.b), s.w * k, s.sim, true, s.ps));
  return outline.map(function (p) { return [p[0] / k, p[1] / k]; });
}

// Path in surface units relative to the group origin (group scale `sc`).
function inkStrokePath(s, sc) {
  sc = sc || 1;
  var path = UIBezierPath.bezierPath();
  if (s.shape) {
    var pts = inkTriples(s.pts);
    path.moveToPoint({ x: pts[0][0] * sc, y: pts[0][1] * sc });
    for (var i = 1; i < pts.length; i++) path.addLineToPoint({ x: pts[i][0] * sc, y: pts[i][1] * sc });
    if (s.closed) path.closePath();
    return path;
  }
  var o = inkStrokeOutline(s);
  if (o.length < 3) return null;
  // Same smoothing as perfect-freehand's SVG helper: quadratic curves through midpoints.
  path.moveToPoint({ x: o[0][0] * sc, y: o[0][1] * sc });
  for (var j = 0; j < o.length; j++) {
    var a = o[j], b = o[(j + 1) % o.length];
    path.addQuadCurveToPointControlPoint({ x: ((a[0] + b[0]) / 2) * sc, y: ((a[1] + b[1]) / 2) * sc }, { x: a[0] * sc, y: a[1] * sc });
  }
  path.closePath();
  return path;
}

function inkMakeLayer(s, sc) {
  var path = inkStrokePath(s, sc);
  if (!path) return null;
  var brush = inkBrushOf(s.tool, s.b);
  var alpha = inkBrushAlpha(brush);
  var layer = CAShapeLayer.new();
  layer.path = path;
  if (s.shape) {
    var lw = inkShapeWidth(brush, s.w) * (sc || 1);
    layer.fillColor = s.fill ? inkColor(s.fill, 0.18) : UIColor.clearColor();
    layer.strokeColor = inkColor(s.color, alpha);
    layer.lineWidth = lw;
    layer.lineCap = 'round';
    layer.lineJoin = 'round';
    if (s.dash) layer.lineDashPattern = [lw * 2.6, lw * 2.2];
  } else {
    layer.fillColor = inkColor(s.color, alpha);
    layer.strokeColor = UIColor.clearColor();
  }
  return layer;
}

// Local bounding box of a stroke (group units), padded by the brush.
function inkStrokeBox(s) {
  if (s._box) return s._box;
  var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (var i = 0; i + 2 < s.pts.length; i += 3) {
    var x = s.pts[i], y = s.pts[i + 1];
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (x > b.x1) b.x1 = x;
    if (y > b.y1) b.y1 = y;
  }
  var pad = s.w;
  s._box = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  return s._box;
}

function inkGroupKey(s) {
  return s.a || '_';
}

function inkSurf(kind) {
  return INK_SURF[kind] || null;
}

// Placement of a group on its surface: {x, y, s} or null when not on screen.
function inkPlaceOf(key) {
  var kind = key.indexOf('page:') === 0 ? 'doc' : 'map';
  var surf = INK_SURF[kind];
  if (!surf) return null;
  if (key === '_') return { x: 0, y: 0, s: 1 };
  return surf.place[key] || null;
}

function inkGroup(surf, key) {
  var g = surf.groups[key];
  if (g) return g;
  g = { marker: CALayer.new(), pen: CALayer.new(), x: 0, y: 0, s: 1, hidden: false };
  surf.markerRoot.addSublayer(g.marker);
  surf.penRoot.addSublayer(g.pen);
  surf.groups[key] = g;
  var p = key === '_' ? { x: 0, y: 0, s: 1 } : surf.place[key];
  g.s = p ? p.s : 1;
  inkPlaceGroup(key, g, p);
  return g;
}

function inkPlaceGroup(key, g, p) {
  var hide = key !== '_' && !p;
  if (hide !== g.hidden) {
    g.marker.hidden = hide;
    g.pen.hidden = hide;
    g.hidden = hide;
  }
  if (!p) return;
  if (p.x !== g.x || p.y !== g.y) {
    g.x = p.x;
    g.y = p.y;
    g.marker.position = { x: g.x, y: g.y };
    g.pen.position = { x: g.x, y: g.y };
  }
}

function inkRenderStroke(s) {
  var surf = INK_SURF[inkSurfaceKind(s)];
  if (!surf) return;
  if (surf.kind === 'doc' && s.a.indexOf('page:' + surf.md5 + ':') !== 0) return;
  var g = inkGroup(surf, inkGroupKey(s));
  var layer = inkMakeLayer(s, g.s);
  if (!layer) return;
  (s.tool === 'marker' ? g.marker : g.pen).addSublayer(layer);
  surf.layers[s.id] = layer;
}

function inkUnrenderStroke(id) {
  for (var k in INK_SURF) {
    var surf = INK_SURF[k];
    var layer = surf && surf.layers[id];
    if (layer) {
      layer.removeFromSuperlayer();
      delete surf.layers[id];
    }
  }
}

function inkLayerOf(id) {
  for (var k in INK_SURF) {
    if (INK_SURF[k] && INK_SURF[k].layers[id]) return INK_SURF[k].layers[id];
  }
  return null;
}

// ---- placements ---------------------------------------------------------------

function inkMapPlaces(ctx) {
  var map = {};
  var nodes = ctx.mv.mindmapNodes;
  if (!nodes) return map;
  for (var i = 0; i < nodes.length; i++) {
    var note = nodes[i].note;
    if (note) {
      var f = nodes[i].frame;
      map[String(note.noteId)] = { x: f.x, y: f.y, s: 1, w: f.width, h: f.height };
    }
  }
  return map;
}

function inkDocPlaces(ctx) {
  var width = ctx.canvas.bounds.width;
  var cache = INK_DOC_CACHE[ctx.md5];
  if (!cache || Math.abs(cache.width - width) > 0.5) cache = INK_DOC_CACHE[ctx.md5] = { width: width, place: {} };
  var pages = (ctx.canvas.subviews || []).filter(function (v) {
    return inkClassName(v) === 'PDFPageScrollView' && !v.hidden;
  }).sort(function (a, b) { return a.frame.y - b.frame.y; });
  if (!pages.length) return cache.place;
  var b = ctx.scroll.bounds;
  // currPageIndex lags while scrolling: only trust a layout seen twice in a row.
  var stable = cache.lastY === b.y && cache.lastH === b.height;
  cache.lastY = b.y;
  cache.lastH = b.height;
  if (!stable) return cache.place;
  var mid = b.y + b.height / 2 - ctx.canvas.frame.y;
  var z = inkSurfView(ctx).z;
  mid = mid / z;
  var at = -1;
  for (var i = 0; i < pages.length; i++) {
    var f = pages[i].frame;
    if (f.x > 1 || (i && f.y < pages[i - 1].frame.y + pages[i - 1].frame.height - 2)) return cache.place; // not a vertical scroll layout
    if (f.y <= mid && f.y + f.height > mid) at = i;
  }
  if (at < 0) return cache.place;
  var curr = ctx.dc.currPageIndex;
  for (var j = 0; j < pages.length; j++) {
    var pf = pages[j].frame;
    var key = 'page:' + ctx.md5 + ':' + (curr + j - at);
    for (var k in cache.place) {
      if (k !== key && Math.abs(cache.place[k].y - pf.y) < 1) delete cache.place[k]; // contradicted
    }
    cache.place[key] = { x: pf.x, y: pf.y, s: pf.width / 1000, w: pf.width, h: pf.height };
  }
  return cache.place;
}

// ---- attach / sync ----------------------------------------------------------------

function inkTeardownSurface(kind) {
  var surf = INK_SURF[kind];
  if (!surf) return;
  try {
    surf.root.removeFromSuperview();
  } catch (e) {}
  delete INK_SURF[kind];
}

function inkTeardown() {
  inkTeardownSurface('map');
  inkTeardownSurface('doc');
}

function inkAttachSurface(ctx, place) {
  var tag = ctx.kind === 'map' ? INK_ROOT_TAG : INK_ROOT_TAG + 1;
  var surf = INK_SURF[ctx.kind];
  var attached = surf && (ctx.kind !== 'doc' || surf.md5 === ctx.md5) && ctx.canvas.viewWithTag(tag);
  if (attached) {
    // MarginNote re-adds recycled page views on top; keep the ink above them.
    var subs = ctx.canvas.subviews;
    if (subs.length && subs[subs.length - 1].tag !== tag) ctx.canvas.addSubview(surf.root);
    return surf;
  }
  inkTeardownSurface(ctx.kind);
  var bnd = ctx.canvas.bounds;
  var root = new UIView({ x: 0, y: 0, width: bnd.width, height: bnd.height });
  root.tag = tag;
  root.userInteractionEnabled = false;
  root.backgroundColor = UIColor.clearColor();
  root.autoresizingMask = (1 << 1) | (1 << 4);
  ctx.canvas.addSubview(root);
  surf = INK_SURF[ctx.kind] = {
    kind: ctx.kind, md5: ctx.md5 || null, root: root, markerRoot: CALayer.new(), penRoot: CALayer.new(),
    groups: {}, layers: {}, place: place
  };
  root.layer.addSublayer(surf.markerRoot);
  root.layer.addSublayer(surf.penRoot);
  inkNoAnim(function () {
    INK_STORE.strokes.forEach(function (s) {
      if (!inkOnSurface(s, ctx)) return;
      try {
        inkRenderStroke(s);
      } catch (e) {
        inkLog('render failed ' + s.id + ': ' + e);
      }
    });
  });
  return surf;
}

// Re-render every stroke of a group (its scale changed: the PDF was zoomed).
function inkRerenderGroup(surf, key) {
  inkNoAnim(function () {
    INK_STORE.strokes.forEach(function (s) {
      if (inkGroupKey(s) !== key) return;
      inkUnrenderStroke(s.id);
      inkRenderStroke(s);
    });
  });
}

function inkUpdatePlaces(surf, place) {
  surf.place = place;
  for (var key in surf.groups) {
    if (key === '_') continue;
    var g = surf.groups[key];
    var p = place[key];
    if (p && Math.abs(p.s - g.s) > 1e-4) {
      g.s = p.s;
      inkPlaceGroup(key, g, p);
      inkRerenderGroup(surf, key);
    } else {
      inkPlaceGroup(key, g, p);
    }
  }
}

// Make sure the ink of the open notebook is loaded and attached to what is on
// screen; re-place groups whose card / page moved.
function inkSync(addon) {
  var views = inkFindViews(addon);
  if (!views) {
    inkTeardown();
    return null;
  }
  if (!INK_STORE || INK_STORE.topicId !== views.topicId) {
    if (INK_STORE) inkCommit();
    inkTeardown();
    INK_STORE = inkLoadStore(views.topicId);
    inkResetHistory();
  }
  ['map', 'doc'].forEach(function (kind) {
    var ctx = views[kind];
    if (!ctx) {
      inkTeardownSurface(kind);
      return;
    }
    var place = kind === 'map' ? inkMapPlaces(ctx) : inkDocPlaces(ctx);
    var surf = inkAttachSurface(ctx, place);
    inkUpdatePlaces(surf, place);
  });
  return views;
}

// Rebuild everything from the store (after undo / redo / sync).
function inkRerenderAll(addon) {
  inkTeardown();
  return inkSync(addon);
}

// Choose the card a new stroke belongs to: the card nearest to the stroke's
// centre, with a size penalty so a small card next to the ink beats a big
// container card (frame layouts nest every card inside its parent's frame).
function inkPickAnchor(frames, box) {
  var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  var best = null, bestScore = Infinity;
  for (var id in frames) {
    var f = frames[id];
    var dx = Math.max(f.x - cx, 0, cx - (f.x + f.w));
    var dy = Math.max(f.y - cy, 0, cy - (f.y + f.h));
    var d = Math.hypot(dx, dy);
    var score = d + 0.1 * Math.sqrt(f.w * f.h);
    if (score < bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

// The page segment under a point (surface units), else the nearest one.
function inkPickPage(places, cx, cy) {
  var best = null, bestD = Infinity;
  for (var key in places) {
    var p = places[key];
    var d = cy < p.y ? p.y - cy : cy > p.y + p.h ? cy - (p.y + p.h) : 0;
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  }
  return best;
}
