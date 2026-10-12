// ---------------------------------------------------------------------------
// Native rendering: one CAShapeLayer per stroke, inside MarginNote's own
// zoomable mind map canvas, so ink pans and zooms with the cards and stays
// sharp (vector) at every zoom level.
//
// View tree found in MarginNote 4.4 (macOS / iPadOS):
//   notebookController.mindmapView        MindMapScrollView (a UIView!)
//     └ UIScrollView                      contentOffset / zoomScale
//         └ MindMapCanvas                 the zoomed view, mind map units
//             ├ MindMapTiledViewMN        cards
//             └ MNInk root (ours)         ← strokes live here
// MindMapNote.frame is in MindMapCanvas units.
//
// Strokes are grouped by anchor card: each group is a layer positioned at the
// card's top-left corner, so ink follows the card when the layout changes.
//
// Never read UIScrollView properties on mindmapView itself, never assign null
// to a CGColor property, never assign `bezier.CGPath` (pass the UIBezierPath):
// each of those aborts MarginNote.
// ---------------------------------------------------------------------------

var INK_ROOT_TAG = 5148011;
var INK_R = null; // { root, markerRoot, penRoot, groups: {key: {marker, pen, x, y, hidden}}, layers: {id: layer} }

function inkClassName(obj) {
  return String(obj).replace(/^\[object |\]$/g, '');
}

function inkFindViews(addon) {
  var sc = inkStudy(addon);
  if (!sc || !sc.notebookController) return null;
  var nc = sc.notebookController;
  var topicId = nc.notebookId ? String(nc.notebookId) : '';
  var mv = nc.mindmapView;
  if (!topicId || !mv || !mv.subviews || !mv.window) return null;
  var sv = null;
  var subs = mv.subviews;
  for (var i = 0; i < subs.length; i++) {
    if (/ScrollView$/.test(inkClassName(subs[i]))) { sv = subs[i]; break; }
  }
  if (!sv) return null;
  var canvas = null;
  var inner = sv.subviews;
  for (var j = 0; j < inner.length; j++) {
    if (inkClassName(inner[j]) === 'MindMapCanvas') { canvas = inner[j]; break; }
  }
  if (!canvas) return null;
  return { sc: sc, mv: mv, sv: sv, canvas: canvas, topicId: topicId };
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

function inkStrokeOutline(s) {
  var k = s.k || 1;
  var pts = inkTriples(s.pts).map(function (p) { return [p[0] * k, p[1] * k, p[2]]; });
  var outline = INK_FREEHAND.getStroke(pts, inkFreehandOptions(inkBrushOf(s.tool, s.b), s.w * k, s.sim, true));
  return outline.map(function (p) { return [p[0] / k, p[1] / k]; });
}

function inkStrokePath(s) {
  var path = UIBezierPath.bezierPath();
  if (s.shape) {
    var pts = inkTriples(s.pts);
    path.moveToPoint({ x: pts[0][0], y: pts[0][1] });
    for (var i = 1; i < pts.length; i++) path.addLineToPoint({ x: pts[i][0], y: pts[i][1] });
    if (s.closed) path.closePath();
    return path;
  }
  var o = inkStrokeOutline(s);
  if (o.length < 3) return null;
  // Same smoothing as perfect-freehand's SVG helper: quadratic curves through midpoints.
  path.moveToPoint({ x: o[0][0], y: o[0][1] });
  for (var j = 0; j < o.length; j++) {
    var a = o[j], b = o[(j + 1) % o.length];
    path.addQuadCurveToPointControlPoint({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }, { x: a[0], y: a[1] });
  }
  path.closePath();
  return path;
}

function inkMakeLayer(s) {
  var path = inkStrokePath(s);
  if (!path) return null;
  var brush = inkBrushOf(s.tool, s.b);
  var alpha = inkBrushAlpha(brush);
  var layer = CAShapeLayer.new();
  layer.path = path;
  if (s.shape) {
    var lw = inkShapeWidth(brush, s.w);
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

// Local bounding box of a stroke (anchor coordinates), padded by the brush.
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

function inkGroup(key) {
  var g = INK_R.groups[key];
  if (g) return g;
  g = { marker: CALayer.new(), pen: CALayer.new(), x: 0, y: 0, hidden: false };
  INK_R.markerRoot.addSublayer(g.marker);
  INK_R.penRoot.addSublayer(g.pen);
  INK_R.groups[key] = g;
  if (key !== '_') inkPlaceGroup(key, g, INK_R.frames ? INK_R.frames[key] : null);
  return g;
}

function inkPlaceGroup(key, g, frame) {
  var hide = key !== '_' && !frame;
  if (hide !== g.hidden) {
    g.marker.hidden = hide;
    g.pen.hidden = hide;
    g.hidden = hide;
  }
  if (!frame) return;
  if (frame.x !== g.x || frame.y !== g.y) {
    g.x = frame.x;
    g.y = frame.y;
    g.marker.position = { x: g.x, y: g.y };
    g.pen.position = { x: g.x, y: g.y };
  }
}

function inkRenderStroke(s) {
  var layer = inkMakeLayer(s);
  if (!layer) return;
  var g = inkGroup(inkGroupKey(s));
  (s.tool === 'marker' ? g.marker : g.pen).addSublayer(layer);
  INK_R.layers[s.id] = layer;
}

function inkUnrenderStroke(id) {
  var layer = INK_R && INK_R.layers[id];
  if (!layer) return;
  layer.removeFromSuperlayer();
  delete INK_R.layers[id];
}

// Current card frames, keyed by note id (only cards visible in this mind map).
function inkNodeFrames(views) {
  var map = {};
  var nodes = views.mv.mindmapNodes;
  if (!nodes) return map;
  for (var i = 0; i < nodes.length; i++) {
    var note = nodes[i].note;
    if (note) map[String(note.noteId)] = nodes[i].frame;
  }
  return map;
}

function inkTeardown() {
  if (!INK_R) return;
  try {
    INK_R.root.removeFromSuperview();
  } catch (e) {}
  INK_R = null;
}

// Make sure the ink of the open notebook is loaded and attached to the
// current mind map canvas; re-place groups whose cards moved.
function inkSync(addon) {
  var views = inkFindViews(addon);
  if (!views) {
    inkTeardown();
    return null;
  }
  if (!INK_STORE || INK_STORE.topicId !== views.topicId) {
    if (INK_STORE) inkSaveNow();
    inkTeardown();
    INK_STORE = inkLoadStore(views.topicId);
    inkResetHistory();
  }
  var frames = inkNodeFrames(views);
  var attached = INK_R && views.canvas.viewWithTag(INK_ROOT_TAG);
  if (!attached) {
    inkTeardown();
    var b = views.canvas.bounds;
    var root = new UIView({ x: 0, y: 0, width: b.width, height: b.height });
    root.tag = INK_ROOT_TAG;
    root.userInteractionEnabled = false;
    root.backgroundColor = UIColor.clearColor();
    views.canvas.addSubview(root);
    INK_R = { root: root, markerRoot: CALayer.new(), penRoot: CALayer.new(), groups: {}, layers: {}, frames: frames };
    root.layer.addSublayer(INK_R.markerRoot);
    root.layer.addSublayer(INK_R.penRoot);
    inkNoAnim(function () {
      INK_STORE.strokes.forEach(function (s) {
        try {
          inkRenderStroke(s);
        } catch (e) {
          inkLog('render failed ' + s.id + ': ' + e);
        }
      });
    });
  } else {
    INK_R.frames = frames;
    // Let groups glide to their card's new position (implicit animation).
    for (var key in INK_R.groups) {
      if (key !== '_') inkPlaceGroup(key, INK_R.groups[key], frames[key]);
    }
  }
  INK_R.frames = frames;
  return views;
}

// Choose the card a new stroke belongs to: the card nearest to the stroke's
// centre, with a size penalty so a small card next to the ink beats a big
// container card (frame layouts nest every card inside its parent's frame).
function inkPickAnchor(frames, box) {
  var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  var best = null, bestScore = Infinity;
  for (var id in frames) {
    var f = frames[id];
    var dx = Math.max(f.x - cx, 0, cx - (f.x + f.width));
    var dy = Math.max(f.y - cy, 0, cy - (f.y + f.height));
    var d = Math.hypot(dx, dy);
    if (d > 900) continue;
    var score = d + 0.1 * Math.sqrt(f.width * f.height);
    if (score < bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}
