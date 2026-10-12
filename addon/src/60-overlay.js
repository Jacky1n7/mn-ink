// ---------------------------------------------------------------------------
// Drawing mode: a transparent web page laid over the mind map captures the
// pen (with pressure and tilt), draws the stroke in progress, and hands each
// finished stroke to the add-on, which renders it natively in the canvas.
//
// Page → add-on: location.href = "mnink://m?<url-encoded {seq, msgs}>",
//   intercepted in MNInkWebDelegate. One batch in flight at a time; the add-on
//   answers every batch with ink.ack(seq) so nothing is dropped.
// Add-on → page: webView.evaluateJavaScript("ink.<fn>(…)").
// ---------------------------------------------------------------------------

var INK_UI = null; // { web, delegate, addon, lastSeq }

function inkIsDrawing(addon) {
  return !!INK_UI;
}

function inkToggle(addon) {
  if (INK_UI) inkCloseOverlay();
  else inkOpenOverlay(addon);
}

function inkOpenOverlay(addon) {
  var views = inkSync(addon);
  if (!views) {
    inkHud(addon, 'MN Ink：请先打开脑图 · open a mind map first');
    return;
  }
  var web = new UIWebView(views.mv.frame);
  web.scalesPageToFit = false;
  web.autoresizingMask = (1 << 1) | (1 << 4);
  inkMakeTransparent(web);
  var delegate = MNInkWebBridge.new();
  web.delegate = delegate;
  views.mv.superview.insertSubviewAboveSubview(web, views.mv);
  INK_UI = { web: web, delegate: delegate, addon: addon, lastSeq: 0 };
  web.loadHTMLStringBaseURL(INK_PAGE_HTML, null);
  inkRefreshButton(addon);
}

// MarginNote's UIWebView is a wrapper (MNUWebView) around a WKWebView; every
// layer down to the scroll view must be non-opaque for the mind map to show.
function inkMakeTransparent(view) {
  var queue = [view];
  for (var depth = 0; depth < 3 && queue.length; depth++) {
    var next = [];
    queue.forEach(function (v) {
      v.opaque = false;
      v.backgroundColor = UIColor.clearColor();
      var subs = v.subviews || [];
      for (var i = 0; i < subs.length; i++) next.push(subs[i]);
    });
    queue = next;
  }
}

function inkCloseOverlay() {
  var ui = INK_UI;
  if (!ui) return;
  INK_UI = null;
  INK_SEL = null;
  try {
    ui.web.stopLoading();
    ui.web.delegate = null;
    ui.web.removeFromSuperview();
  } catch (e) {}
  inkSaveNow();
  inkRefreshButton(ui.addon);
}

function inkRefreshButton(addon) {
  try {
    inkStudy(addon).refreshAddonCommands();
  } catch (e) {}
}

function inkLayoutOverlay(addon) {
  if (!INK_UI) return;
  var views = inkFindViews(addon);
  if (!views) {
    inkCloseOverlay();
    return;
  }
  INK_UI.web.frame = views.mv.frame;
}

function inkJs(code) {
  if (INK_UI) INK_UI.web.evaluateJavaScript(code, null);
}

function inkCall(fn, arg) {
  inkJs('window.ink && ink.' + fn + '(' + JSON.stringify(arg === undefined ? null : arg) + ')');
}

function inkOnPageUrl(url) {
  if (!INK_UI) return;
  var q = url.indexOf('?');
  if (q < 0) return;
  var data = JSON.parse(decodeURIComponent(url.slice(q + 1)));
  if (data.seq > INK_UI.lastSeq) {
    INK_UI.lastSeq = data.seq;
    var onlyView = data.msgs.every(function (m) { return m.t === 'view' || m.t === 'move'; });
    var views = onlyView ? inkFindViews(INK_UI.addon) : inkSync(INK_UI.addon);
    if (!views) {
      inkCloseOverlay();
      return;
    }
    for (var i = 0; i < data.msgs.length && INK_UI; i++) {
      var m = data.msgs[i];
      try {
        inkHandleMsg(views, m);
      } catch (e) {
        inkLog('message ' + m.t + ' failed: ' + e);
        inkCall('error', String(e && e.message ? e.message : e));
      }
    }
  }
  inkJs('window.ink && ink.ack(' + data.seq + ')');
}

function inkHandleMsg(views, m) {
  switch (m.t) {
    case 'ready':
      inkCall('init', { prefs: inkLoadPrefs(), z: views.sv.zoomScale, state: inkHistoryState(), version: INK_VERSION });
      break;
    case 'view': {
      var z0 = views.sv.zoomScale;
      var z = inkApplyView(views, m);
      if (z !== z0) inkCall('setZoom', z);
      break;
    }
    case 'stroke': {
      var s = inkCommitStroke(views, m);
      inkCall('committed', { lid: m.lid, ok: !!s, state: inkHistoryState() });
      break;
    }
    case 'erase':
      inkErase(views, m);
      inkCall('state', inkHistoryState());
      break;
    case 'lasso':
      inkCall('lassoResult', inkLasso(views, m));
      break;
    case 'move':
      inkMovePreview(views, m.dx, m.dy);
      break;
    case 'moveEnd':
      inkMoveCommit(views, m.dx, m.dy);
      inkCall('state', inkHistoryState());
      break;
    case 'recolor':
      inkRecolorSelection(String(m.color));
      inkCall('state', inkHistoryState());
      break;
    case 'deleteSel':
      inkDeleteSelection();
      inkCall('selection', null);
      inkCall('state', inkHistoryState());
      break;
    case 'deselect':
      INK_SEL = null;
      break;
    case 'undo':
    case 'redo':
      if (m.t === 'undo') inkUndo();
      else inkRedo();
      inkCall('selection', null);
      inkCall('state', inkHistoryState());
      break;
    case 'prefs':
      inkSavePrefs(m.prefs);
      break;
    case 'close':
      inkCloseOverlay();
      break;
    case 'log':
      inkLog('page: ' + m.text);
      break;
  }
}

// Pan / pinch forwarded from the page. m: { dx, dy, s, cx, cy } in screen units.
function inkApplyView(views, m) {
  var sv = views.sv;
  var off = sv.contentOffset;
  var z = sv.zoomScale;
  var nz = z;
  if (m.s && m.s !== 1) {
    nz = Math.max(sv.minimumZoomScale, Math.min(sv.maximumZoomScale, z * m.s));
    var cx = (m.cx + off.x) / z, cy = (m.cy + off.y) / z;
    sv.setZoomScaleAnimated(nz, false);
    off = { x: cx * nz - m.cx, y: cy * nz - m.cy };
  }
  sv.setContentOffsetAnimated({ x: off.x - (m.dx || 0), y: off.y - (m.dy || 0) }, false);
  return nz;
}
