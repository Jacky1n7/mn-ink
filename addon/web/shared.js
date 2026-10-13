// ---------------------------------------------------------------------------
// Code shared by the add-on (JavaScriptCore) and the drawing page (WebKit):
// brush settings and shape recognition. No DOM, no MarginNote objects.
// ---------------------------------------------------------------------------

// Brushes. thinning = how much pressure changes the width; alpha = ink opacity;
// shape = width of a recognised shape relative to the brush size.
var INK_BRUSHES = {
  normal: { name: '普通', thinning: 0.38, smoothing: 0.5, streamline: 0.45, alpha: 1, shape: 0.82 },
  ballpoint: { name: '等宽', thinning: 0.08, smoothing: 0.5, streamline: 0.45, alpha: 1, shape: 0.95 },
  fountain: { name: '钢笔', thinning: 0.62, smoothing: 0.55, streamline: 0.4, alpha: 1, shape: 0.72, ease: 'sine' },
  brush: { name: '毛笔', thinning: 0.9, smoothing: 0.62, streamline: 0.5, alpha: 1, shape: 0.6, ease: 'cubic', taper: 3 },
  pencil: { name: '铅笔', thinning: 0.4, smoothing: 0.4, streamline: 0.3, alpha: 0.78, shape: 0.8 },
  watercolor: { name: '水彩', thinning: 0.5, smoothing: 0.75, streamline: 0.55, alpha: 0.42, shape: 1.2, soft: 0.6 },
  crayon: { name: '蜡笔', thinning: 0.25, smoothing: 0.35, streamline: 0.3, alpha: 0.82, shape: 1, grain: true },
  marker: { name: '荧光笔', thinning: 0, smoothing: 0.7, streamline: 0.55, alpha: 0.36, shape: 1 }
};
var INK_PEN_TYPES = ['normal', 'ballpoint', 'fountain', 'brush', 'pencil', 'watercolor', 'crayon'];

function inkBrushOf(tool, brush) {
  if (tool === 'marker') return 'marker';
  return INK_BRUSHES[brush] && brush !== 'marker' ? brush : 'fountain';
}

// Ink opacity: the brush's own alpha times the tool's opacity setting (0–1).
function inkBrushAlpha(brush, op) {
  var a = (INK_BRUSHES[brush] || INK_BRUSHES.fountain).alpha;
  return op == null ? a : a * Math.max(0.05, Math.min(1, op));
}

function inkBrushInfo(brush) {
  return INK_BRUSHES[brush] || INK_BRUSHES.fountain;
}

function inkShapeWidth(brush, size) {
  return size * (INK_BRUSHES[brush] || INK_BRUSHES.fountain).shape;
}

// perfect-freehand options. `size` is the nominal width in the units of the
// points; `simulate` = the input device has no pressure (mouse, finger).
// `sens` (0–1, default 0.6) scales how strongly pressure changes the width.
function inkFreehandOptions(brush, size, simulate, last, sens) {
  var b = INK_BRUSHES[brush] || INK_BRUSHES.fountain;
  var k = sens == null ? 1 : Math.max(0, Math.min(1.6, sens / 0.6));
  var o = {
    size: size, thinning: Math.min(0.95, b.thinning * k), smoothing: b.smoothing, streamline: b.streamline,
    simulatePressure: brush === 'marker' ? false : !!simulate, last: !!last,
    start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }
  };
  if (b.ease === 'sine') o.easing = function (t) { return Math.sin((t * Math.PI) / 2); };
  if (b.ease === 'cubic') o.easing = function (t) { return t * t * (3 - 2 * t); };
  if (b.taper) {
    o.start = { cap: true, taper: size * b.taper * 0.5 };
    o.end = { cap: true, taper: size * b.taper };
  }
  return o;
}

function inkDist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function inkDistToSegment(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1];
  var len2 = dx * dx + dy * dy;
  var t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function inkPathLength(pts) {
  var L = 0;
  for (var i = 1; i < pts.length; i++) L += inkDist(pts[i - 1], pts[i]);
  return L;
}

function inkBBox(pts) {
  var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    if (p[0] < b.x0) b.x0 = p[0];
    if (p[1] < b.y0) b.y0 = p[1];
    if (p[0] > b.x1) b.x1 = p[0];
    if (p[1] > b.y1) b.y1 = p[1];
  }
  return b;
}

// n points spaced evenly along the polyline.
function inkResample(pts, n) {
  var L = inkPathLength(pts);
  if (!L || pts.length < 2) return pts.map(function (p) { return [p[0], p[1]]; });
  var step = L / (n - 1);
  var out = [[pts[0][0], pts[0][1]]];
  var acc = 0;
  var prev = pts[0];
  for (var i = 1; i < pts.length && out.length < n; i++) {
    var cur = pts[i];
    var d = inkDist(prev, cur);
    while (d > 0 && acc + d >= step && out.length < n) {
      var t = (step - acc) / d;
      var q = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
      out.push(q);
      prev = q;
      d = inkDist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

// Ramer–Douglas–Peucker; returns the indices that survive.
function inkRdp(pts, eps) {
  var keep = [0, pts.length - 1];
  (function rec(i, j) {
    var best = -1, bestD = eps;
    for (var k = i + 1; k < j; k++) {
      var d = inkDistToSegment(pts[k], pts[i], pts[j]);
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best >= 0) {
      keep.push(best);
      rec(i, best);
      rec(best, j);
    }
  })(0, pts.length - 1);
  return keep.sort(function (a, b) { return a - b; });
}

function inkMeanDistToPolyline(pts, poly, closed) {
  var sum = 0;
  for (var i = 0; i < pts.length; i++) {
    var best = Infinity;
    var segs = closed ? poly.length : poly.length - 1;
    for (var k = 0; k < segs; k++) {
      var d = inkDistToSegment(pts[i], poly[k], poly[(k + 1) % poly.length]);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / pts.length;
}

// Snap an angle (radians) to the nearest multiple of `step` when within `tol`.
function inkSnapAngle(a, step, tol) {
  var k = Math.round(a / step);
  return Math.abs(a - k * step) <= tol ? k * step : a;
}

function inkFitEllipse(ring) {
  var n = ring.length, cx = 0, cy = 0;
  for (var i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
  cx /= n; cy /= n;
  var sxx = 0, syy = 0, sxy = 0;
  for (i = 0; i < n; i++) {
    var dx = ring[i][0] - cx, dy = ring[i][1] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  var c = Math.cos(theta), s = Math.sin(theta);
  var vu = 0, vv = 0;
  for (i = 0; i < n; i++) {
    var ex = ring[i][0] - cx, ey = ring[i][1] - cy;
    var u = ex * c + ey * s, v = -ex * s + ey * c;
    vu += u * u; vv += v * v;
  }
  // Evenly sampled ellipse: variance along an axis ≈ r² / 2.
  var rx = Math.sqrt((2 * vu) / n), ry = Math.sqrt((2 * vv) / n);
  var err = 0;
  for (i = 0; i < n; i++) {
    var fx = ring[i][0] - cx, fy = ring[i][1] - cy;
    var uu = fx * c + fy * s, ww = -fx * s + fy * c;
    err += Math.abs(Math.sqrt((uu / rx) * (uu / rx) + (ww / ry) * (ww / ry)) - 1);
  }
  return { cx: cx, cy: cy, rx: rx, ry: ry, theta: theta, err: err / n };
}

function inkEllipsePoints(e, n) {
  var out = [];
  var c = Math.cos(e.theta), s = Math.sin(e.theta);
  for (var i = 0; i <= n; i++) {
    var t = (i / n) * Math.PI * 2;
    var u = e.rx * Math.cos(t), v = e.ry * Math.sin(t);
    out.push([e.cx + u * c - v * s, e.cy + u * s + v * c]);
  }
  return out;
}

function inkCornerAngle(a, b, c) {
  var v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  var d = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  return d ? Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) : 0;
}

// Fit an (optionally rotated) rectangle to a ring, given the dominant edge angle.
function inkFitRect(ring, angle) {
  var c = Math.cos(angle), s = Math.sin(angle);
  var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (var i = 0; i < ring.length; i++) {
    var u = ring[i][0] * c + ring[i][1] * s, v = -ring[i][0] * s + ring[i][1] * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  // Trim the overshoot that hand-drawn corners always have.
  var tu = (u1 - u0) * 0.02, tv = (v1 - v0) * 0.02;
  u0 += tu; u1 -= tu; v0 += tv; v1 -= tv;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]].map(function (p) {
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  });
}

/**
 * Recognise a hand-drawn stroke as a clean shape.
 * @param pts [[x, y, pressure?], …] in screen units
 * @returns {kind, pts: [[x, y], …], closed} or null when nothing fits
 */
function inkRecognizeShape(pts) {
  if (!pts || pts.length < 4) return null;
  var L = inkPathLength(pts);
  var bb = inkBBox(pts);
  var diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0);
  if (L < 24 || diag < 16) return null;
  var first = pts[0], last = pts[pts.length - 1];
  var span = inkDist(first, last);

  // Straight line: the ends are almost as far apart as the path is long.
  if (span / L > 0.93) {
    var ang = Math.atan2(last[1] - first[1], last[0] - first[0]);
    var snapped = inkSnapAngle(ang, Math.PI / 4, (5 * Math.PI) / 180);
    var mx = (first[0] + last[0]) / 2, my = (first[1] + last[1]) / 2;
    var h = span / 2;
    return {
      kind: 'line', closed: false,
      pts: [[mx - h * Math.cos(snapped), my - h * Math.sin(snapped)], [mx + h * Math.cos(snapped), my + h * Math.sin(snapped)]]
    };
  }

  var ring = inkResample(pts, 72);
  var closed = span < Math.max(0.22 * diag, 10);

  if (closed) {
    // Close the ring for fitting: drop the overlapping tail, if any.
    var ell = inkFitEllipse(ring);

    // Corners: RDP from the point farthest from the start, so the start is not forced to be a corner.
    var far = 0, farD = -1;
    for (var i = 0; i < ring.length; i++) {
      var d0 = inkDist(ring[0], ring[i]);
      if (d0 > farD) { farD = d0; far = i; }
    }
    var rot = ring.slice(far).concat(ring.slice(1, far + 1));
    var idx = inkRdp(rot, 0.06 * diag);
    var poly = idx.map(function (k) { return rot[k]; });
    if (poly.length > 1 && inkDist(poly[0], poly[poly.length - 1]) < 0.15 * diag) poly.pop();
    // Merge corners that are too close to each other.
    poly = poly.filter(function (p, k) {
      return k === 0 || inkDist(p, poly[k - 1]) > 0.12 * diag;
    });
    var polyErr = poly.length >= 3 ? inkMeanDistToPolyline(ring, poly, true) / diag : Infinity;

    if (poly.length >= 3 && poly.length <= 5 && polyErr < 0.03 && polyErr * 2.2 < ell.err) {
      if (poly.length === 4) {
        var right = true;
        for (var k = 0; k < 4; k++) {
          var a = inkCornerAngle(poly[(k + 3) % 4], poly[k], poly[(k + 1) % 4]);
          if (Math.abs(a - Math.PI / 2) > (16 * Math.PI) / 180) right = false;
        }
        if (right) {
          // Orientation of the longest edge, snapped to the axes when close.
          var bestLen = -1, edgeAng = 0;
          for (k = 0; k < 4; k++) {
            var p1 = poly[k], p2 = poly[(k + 1) % 4];
            var len = inkDist(p1, p2);
            if (len > bestLen) { bestLen = len; edgeAng = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]); }
          }
          edgeAng = inkSnapAngle(edgeAng, Math.PI / 2, (8 * Math.PI) / 180);
          return { kind: 'rect', closed: true, pts: inkFitRect(ring, edgeAng) };
        }
      }
      return { kind: poly.length === 3 ? 'triangle' : 'polygon', closed: true, pts: poly.concat([poly[0]]) };
    }

    if (ell.err < 0.11 && ell.rx > 4 && ell.ry > 4) {
      var e = { cx: ell.cx, cy: ell.cy, rx: ell.rx, ry: ell.ry, theta: ell.theta };
      var ratio = Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry);
      if (ratio > 0.85) {
        e.rx = e.ry = (e.rx + e.ry) / 2;
        e.theta = 0;
      } else {
        e.theta = inkSnapAngle(e.theta, Math.PI / 2, (10 * Math.PI) / 180);
      }
      return { kind: ratio > 0.85 ? 'circle' : 'ellipse', closed: true, pts: inkEllipsePoints(e, 96) };
    }
    return null;
  }

  var rad = inkRecognizeRadical(pts);
  if (rad) return rad;

  var arrow = inkRecognizeArrow(pts);
  if (arrow) return arrow;

  var arc = inkRecognizeArc(pts, ring, diag);
  if (arc) return arc;

  // Open polyline with a few straight segments (an "L", a zig-zag, an arrow shaft…).
  var oidx = inkRdp(ring, 0.05 * diag);
  if (oidx.length >= 3 && oidx.length <= 4) {
    var opoly = oidx.map(function (k) { return ring[k]; });
    opoly[0] = [first[0], first[1]];
    opoly[opoly.length - 1] = [last[0], last[1]];
    var oerr = inkMeanDistToPolyline(ring, opoly, false) / diag;
    var shortest = Infinity;
    for (var m = 1; m < opoly.length; m++) shortest = Math.min(shortest, inkDist(opoly[m - 1], opoly[m]));
    if (oerr < 0.018 && shortest > 0.15 * diag) {
      return { kind: 'polyline', closed: false, pts: inkSnapPolyline(opoly) };
    }
  }
  return null;
}

// Make nearly horizontal / vertical segments exact by moving shared vertices.
function inkSnapPolyline(poly) {
  var out = poly.map(function (p) { return [p[0], p[1]]; });
  var tol = (6 * Math.PI) / 180;
  for (var i = 1; i < out.length; i++) {
    var a = out[i - 1], b = out[i];
    var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    var s = inkSnapAngle(ang, Math.PI / 2, tol);
    if (s === ang) continue;
    if (Math.abs(Math.sin(s)) < 0.5) b[1] = a[1];
    else b[0] = a[0];
  }
  return out;
}

/**
 * A square-root sign written in one stroke: optional tick up, down to the
 * bottom, (near) vertical rise, horizontal bar. Returns a tidy radical or null.
 * Screen coordinates (y grows downwards).
 */
function inkRecognizeRadical(pts, strict) {
  if (!pts || pts.length < 6) return null;
  var bb = inkBBox(pts);
  var H = bb.y1 - bb.y0, Wd = bb.x1 - bb.x0;
  if (H < 10 || Wd < 10) return null;
  var ring = inkResample(pts, 80);
  var idx = inkRdp(ring, 0.055 * Math.max(H, Wd * 0.5));
  var v = idx.map(function (k) { return ring[k]; });
  if (v.length < 4 || v.length > 11) return null;

  // T: first vertex (from the 3rd on) that reaches the top band.
  var ti = -1;
  for (var i = 2; i < v.length; i++) {
    if (v[i][1] <= bb.y0 + 0.2 * H) { ti = i; break; }
  }
  if (ti < 0 || ti === v.length - 1 && inkDist(v[ti], ring[ring.length - 1]) > 0.1 * H) return null;
  var T = v[ti], B = v[ti - 1];
  var rise = B[1] - T[1];
  if (B[1] < bb.y1 - 0.25 * H || rise < 0.6 * H) return null;
  if (Math.abs(T[0] - B[0]) > 0.75 * rise) return null; // the rise is steep

  // Tick: the part before B goes down into B.
  var S = v[ti - 2];
  if (B[1] - S[1] < 0.15 * rise || B[1] - S[1] > 0.9 * rise) return null;
  if (S[0] > B[0] + 0.1 * rise) return null;
  if (B[0] - v[0][0] > 1.2 * rise) return null;

  // Bar: everything after T stays close to a horizontal line and goes right.
  var E = pts[pts.length - 1];
  var barLen = E[0] - T[0];
  if (barLen < (strict ? 0.7 : 0.45) * rise) return null;
  var tStart = idx[ti];
  for (var k = tStart; k < ring.length; k++) {
    if (Math.abs(ring[k][1] - T[1]) > 0.22 * rise) return null;
    if (ring[k][0] < T[0] - 0.15 * rise) return null;
  }

  var h = rise;
  var b = [B[0], B[1]];
  var t = [B[0] + 0.22 * h, B[1] - h];
  var s1 = [B[0] - 0.3 * h, B[1] - 0.42 * h];
  var s0 = [s1[0] - 0.12 * h, s1[1] + 0.1 * h];
  var e = [Math.max(E[0], t[0] + 0.45 * h), t[1]];
  return { kind: 'radical', closed: false, pts: [s0, s1, b, t, e] };
}

// ---------------------------------------------------------------------------
// Snapping. `nodes` are [x, y] candidates (vertices of other shapes); grid is
// {ox, oy, step} in the same units, or null.
// ---------------------------------------------------------------------------
function inkSnapPoint(p, nodes, grid, radius) {
  var best = null, bestD = radius;
  for (var i = 0; nodes && i < nodes.length; i++) {
    var d = inkDist(p, nodes[i]);
    if (d < bestD) { bestD = d; best = [nodes[i][0], nodes[i][1]]; }
  }
  if (best) return { p: best, kind: 'node' };
  if (grid && grid.step > 0) {
    var gx = grid.ox + Math.round((p[0] - grid.ox) / grid.step) * grid.step;
    var gy = grid.oy + Math.round((p[1] - grid.oy) / grid.step) * grid.step;
    if (Math.hypot(gx - p[0], gy - p[1]) < Math.min(radius, grid.step * 0.3)) return { p: [gx, gy], kind: 'grid' };
  }
  return null;
}

// Snap the corner points of a straight-edged shape; curves keep their form.
function inkSnapShape(shape, nodes, grid, radius) {
  if (!shape || shape.kind === 'circle' || shape.kind === 'ellipse' || shape.kind === 'arc') return shape;
  if (shape.kind === 'arrow') {
    var tail = inkSnapPoint(shape.pts[0], nodes, grid, radius);
    var tip = inkSnapPoint(shape.pts[1], nodes, grid, radius);
    var a = tail ? tail.p : shape.pts[0], t = tip ? tip.p : shape.pts[1];
    return { kind: 'arrow', closed: false, pts: inkArrowPoints(a, t, inkDist(shape.pts[1], shape.pts[2])) };
  }
  var pts = shape.pts.map(function (p) {
    var hit = inkSnapPoint(p, nodes, grid, radius);
    return hit ? hit.p : [p[0], p[1]];
  });
  if (shape.closed && pts.length > 1) pts[pts.length - 1] = [pts[0][0], pts[0][1]];
  return { kind: shape.kind, closed: shape.closed, pts: pts };
}

/**
 * Fine-tune a snapped shape while the pen keeps moving ("hold, then drag").
 * base: the shape as recognised; p0: pen position when it snapped; p: pen now.
 */
function inkAdjustShape(base, p0, p) {
  var pts = base.pts;
  var k = base.kind;
  if (k === 'line') {
    var a = pts[0];
    var ang = Math.atan2(p[1] - a[1], p[0] - a[0]);
    var len = inkDist(a, p);
    ang = inkSnapAngle(ang, Math.PI / 12, (3 * Math.PI) / 180);
    return { kind: k, closed: false, pts: [a, [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]] };
  }
  if (k === 'arrow') {
    var a0p = pts[0], tip0 = pts[1];
    var head0 = inkDist(pts[1], pts[2]);
    var ang2 = inkSnapAngle(Math.atan2(p[1] - a0p[1], p[0] - a0p[0]), Math.PI / 12, (3 * Math.PI) / 180);
    var len2 = inkDist(a0p, p);
    return { kind: k, closed: false, pts: inkArrowPoints(a0p, [a0p[0] + len2 * Math.cos(ang2), a0p[1] + len2 * Math.sin(ang2)], head0) };
  }
  if (k === 'arc' && base.arc) {
    // The start stays put; the end follows the pen. The arc keeps its shape
    // and is scaled / turned about its start (like dragging a line's end).
    var A = base.arc;
    var st = pts[0], e0 = pts[pts.length - 1];
    var l0 = inkDist(st, e0);
    if (l0 < 1) return base;
    var sc = Math.max(0.05, inkDist(st, p) / l0);
    var rot = Math.atan2(p[1] - st[1], p[0] - st[0]) - Math.atan2(e0[1] - st[1], e0[0] - st[0]);
    var cr = Math.cos(rot), sr = Math.sin(rot);
    var move = function (q) {
      var dx = (q[0] - st[0]) * sc, dy = (q[1] - st[1]) * sc;
      return [st[0] + dx * cr - dy * sr, st[1] + dx * sr + dy * cr];
    };
    var c = move([A.cx, A.cy]);
    var arc = { cx: c[0], cy: c[1], r: A.r * sc, a0: A.a0 + rot, sweep: A.sweep };
    var n = Math.max(12, Math.round((Math.abs(arc.sweep) / Math.PI) * 48));
    return { kind: k, closed: false, pts: inkArcPoints(arc.cx, arc.cy, arc.r, arc.a0, arc.sweep, n), arc: arc };
  }
  if (k === 'radical') {
    var out = pts.map(function (q) { return [q[0], q[1]]; });
    out[4][0] = Math.max(out[3][0] + 4, p[0]);
    return { kind: k, closed: false, pts: out };
  }
  if (k === 'polyline') {
    var o2 = pts.map(function (q) { return [q[0], q[1]]; });
    o2[o2.length - 1] = [p[0], p[1]];
    return { kind: k, closed: false, pts: inkSnapPolyline(o2) };
  }
  var bb = inkBBox(pts);
  if (k === 'circle') {
    var c = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2];
    var d0 = inkDist(c, p0);
    var sc = d0 > 1 ? inkDist(c, p) / d0 : 1;
    return { kind: k, closed: true, pts: pts.map(function (q) { return [c[0] + (q[0] - c[0]) * sc, c[1] + (q[1] - c[1]) * sc]; }) };
  }
  // Scale about the bounding-box corner opposite to where the pen was.
  var ax = Math.abs(p0[0] - bb.x0) < Math.abs(p0[0] - bb.x1) ? bb.x1 : bb.x0;
  var ay = Math.abs(p0[1] - bb.y0) < Math.abs(p0[1] - bb.y1) ? bb.y1 : bb.y0;
  var sx = Math.abs(p0[0] - ax) > 4 ? (p[0] - ax) / (p0[0] - ax) : 1;
  var sy = Math.abs(p0[1] - ay) > 4 ? (p[1] - ay) / (p0[1] - ay) : 1;
  return { kind: k, closed: base.closed, pts: pts.map(function (q) { return [ax + (q[0] - ax) * sx, ay + (q[1] - ay) * sy]; }) };
}

// Straight-line highlighter: replace a marker stroke with its chord.
function inkStraighten(pts) {
  var a = pts[0], b = pts[pts.length - 1];
  var ang = inkSnapAngle(Math.atan2(b[1] - a[1], b[0] - a[0]), Math.PI / 2, (6 * Math.PI) / 180);
  var len = inkDist(a, b);
  return { kind: 'line', closed: false, pts: [[a[0], a[1]], [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]] };
}

// ---------------------------------------------------------------------------
// Arcs: an open stroke that hugs a circle. Least-squares circle fit (Kåsa).
// ---------------------------------------------------------------------------
function inkFitCircle(pts) {
  var n = pts.length, mx = 0, my = 0;
  for (var i = 0; i < n; i++) { mx += pts[i][0]; my += pts[i][1]; }
  mx /= n; my /= n;
  var suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (i = 0; i < n; i++) {
    var u = pts[i][0] - mx, v = pts[i][1] - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  var det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  var bu = 0.5 * (suuu + suvv), bv = 0.5 * (svvv + svuu);
  var uc = (bu * svv - bv * suv) / det, vc = (svv === 0 ? 0 : (suu * bv - suv * bu) / det);
  var cx = uc + mx, cy = vc + my;
  var r = 0;
  for (i = 0; i < n; i++) r += Math.hypot(pts[i][0] - cx, pts[i][1] - cy);
  r /= n;
  var err = 0;
  for (i = 0; i < n; i++) err += Math.abs(Math.hypot(pts[i][0] - cx, pts[i][1] - cy) - r);
  return { cx: cx, cy: cy, r: r, err: err / n / r };
}

function inkArcPoints(cx, cy, r, a0, sweep, n) {
  var out = [];
  for (var i = 0; i <= n; i++) {
    var a = a0 + (sweep * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function inkRecognizeArc(pts, ring, diag) {
  ring = ring || inkResample(pts, 72);
  var c = inkFitCircle(ring);
  if (!c || c.err > 0.05 || c.r < 8 || c.r > diag * 4) return null;
  // Signed sweep: accumulate the turn around the centre along the stroke.
  var sweep = 0;
  for (var i = 1; i < ring.length; i++) {
    var a = Math.atan2(ring[i - 1][1] - c.cy, ring[i - 1][0] - c.cx);
    var b = Math.atan2(ring[i][1] - c.cy, ring[i][0] - c.cx);
    var d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sweep += d;
  }
  var abs = Math.abs(sweep);
  if (abs < (35 * Math.PI) / 180 || abs > (320 * Math.PI) / 180) return null;
  // A flat arc is better served by the straight-line or polyline rules.
  var straight = inkMeanDistToPolyline(ring, [ring[0], ring[ring.length - 1]], false) / diag;
  if (straight < 0.04) return null;
  var a0 = Math.atan2(ring[0][1] - c.cy, ring[0][0] - c.cx);
  var n = Math.max(12, Math.round((abs / Math.PI) * 48));
  return { kind: 'arc', closed: false, pts: inkArcPoints(c.cx, c.cy, c.r, a0, sweep, n), arc: { cx: c.cx, cy: c.cy, r: c.r, a0: a0, sweep: sweep } };
}

// ---------------------------------------------------------------------------
// Arrows in one stroke: a long shaft, then a short "<" scribbled at the tip.
// ---------------------------------------------------------------------------
function inkArrowPoints(a, tip, head) {
  var ang = Math.atan2(tip[1] - a[1], tip[0] - a[0]);
  var spread = (27 * Math.PI) / 180;
  var b1 = [tip[0] - head * Math.cos(ang - spread), tip[1] - head * Math.sin(ang - spread)];
  var b2 = [tip[0] - head * Math.cos(ang + spread), tip[1] - head * Math.sin(ang + spread)];
  return [[a[0], a[1]], [tip[0], tip[1]], b1, [tip[0], tip[1]], b2];
}

function inkRecognizeArrow(pts) {
  var ring = inkResample(pts, 90);
  var bb = inkBBox(ring);
  var diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0);
  if (diag < 30) return null;
  var idx = inkRdp(ring, 0.035 * diag);
  if (idx.length < 4 || idx.length > 7) return null;
  var v = idx.map(function (k) { return ring[k]; });
  var shaft = inkDist(v[0], v[1]);
  var L = inkPathLength(v);
  if (shaft < 0.55 * L * 0.8 || shaft < 0.6 * diag) return null;
  var tip = v[1];
  // everything after the tip stays close to it (the arrow head)
  var head = 0;
  for (var i = idx[1]; i < ring.length; i++) head = Math.max(head, inkDist(ring[i], tip));
  if (head > 0.4 * shaft || head < 0.06 * shaft) return null;
  // the head goes back towards the shaft (not onward)
  var dir = [(tip[0] - v[0][0]) / shaft, (tip[1] - v[0][1]) / shaft];
  var back = 0;
  for (i = idx[1]; i < ring.length; i++) back = Math.min(back, (ring[i][0] - tip[0]) * dir[0] + (ring[i][1] - tip[1]) * dir[1]);
  if (back > -0.04 * shaft) return null;
  var ang = inkSnapAngle(Math.atan2(tip[1] - v[0][1], tip[0] - v[0][0]), Math.PI / 4, (5 * Math.PI) / 180);
  var t = [v[0][0] + shaft * Math.cos(ang), v[0][1] + shaft * Math.sin(ang)];
  return { kind: 'arrow', closed: false, pts: inkArrowPoints(v[0], t, Math.max(head, 0.08 * shaft)) };
}
