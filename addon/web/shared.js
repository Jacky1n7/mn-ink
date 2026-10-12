// ---------------------------------------------------------------------------
// Code shared by the add-on (JavaScriptCore) and the drawing page (WebKit):
// brush settings and shape recognition. No DOM, no MarginNote objects.
// ---------------------------------------------------------------------------

// perfect-freehand options per tool. `size` is the nominal width in the units
// of the points; `simulate` = the input device has no pressure (mouse, finger).
function inkFreehandOptions(tool, size, simulate, last) {
  if (tool === 'marker') {
    return {
      size: size, thinning: 0, smoothing: 0.7, streamline: 0.55, simulatePressure: false, last: !!last,
      start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }
    };
  }
  return {
    size: size, thinning: 0.62, smoothing: 0.55, streamline: 0.4, simulatePressure: !!simulate, last: !!last,
    easing: function (t) { return Math.sin((t * Math.PI) / 2); },
    start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }
  };
}

// Width a snapped shape is stroked with, relative to the brush size.
var INK_SHAPE_WIDTH = 0.72;

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
