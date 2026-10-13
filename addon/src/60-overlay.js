// ---------------------------------------------------------------------------
// Drawing mode: a transparent web page laid over the mind map or the PDF
// captures the pen (pressure, coalesced and predicted points), draws the
// stroke in progress, and hands each finished stroke to the add-on, which
// renders it natively on that surface.
//
// Page → add-on: location.href = "mnink://m?<url-encoded {seq, msgs}>",
//   intercepted in MNInkWebBridge. One batch in flight at a time; the add-on
//   answers every batch with ink.ack(seq) so nothing is dropped.
// Add-on → page: webView.evaluateJavaScript("ink.<fn>(…)").
// ---------------------------------------------------------------------------

var INK_UI = null; // { web, delegate, addon, lastSeq, surface: 'map' | 'doc' }

function inkIsDrawing(addon) {
  return !!INK_UI;
}

function inkToggle(addon) {
  if (INK_UI) inkCloseOverlay();
  else inkOpenOverlay(addon);
}

function inkPickSurface(views, wanted) {
  if (wanted && views[wanted]) return wanted;
  var prefs = inkLoadPrefs() || {};
  if (views.map && views.doc) return prefs.surface === 'doc' ? 'doc' : 'map';
  return views.map ? 'map' : 'doc';
}

function inkOpenOverlay(addon, wanted) {
  if (INK_UI) inkCloseOverlay();
  var views = inkSync(addon);
  if (!views) {
    inkHud(addon, 'MN Ink：请先打开脑图或文档 · open a mind map or a PDF first');
    return;
  }
  var surface = inkPickSurface(views, wanted);
  var ctx = views[surface];
  var web = new UIWebView(ctx.host.frame);
  web.scalesPageToFit = false;
  web.autoresizingMask = (1 << 1) | (1 << 4);
  inkMakeTransparent(web);
  var delegate = MNInkWebBridge.new();
  web.delegate = delegate;
  ctx.host.superview.insertSubviewAboveSubview(web, ctx.host);
  INK_UI = { web: web, delegate: delegate, addon: addon, lastSeq: 0, surface: surface };
  web.loadHTMLStringBaseURL(INK_PAGE_HTML, null);
  inkGuardMNPen(addon);
  inkRefreshButton(addon);
}

// MarginNote's UIWebView is a wrapper (MNUWebView) around a WKWebView; every
// layer down to the scroll view must be non-opaque for the content to show.
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
  if (INK_HIDDEN) {
    var layer = inkLayerOf(INK_HIDDEN);
    if (layer) layer.hidden = false;
  }
  INK_HIDDEN = null;
  try {
    ui.web.stopLoading();
    ui.web.delegate = null;
    ui.web.removeFromSuperview();
  } catch (e) {}
  inkCommit();
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
  if (!views || !views.active) {
    inkCloseOverlay();
    return;
  }
  INK_UI.web.frame = views.active.host.frame;
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
    var onlyView = data.msgs.every(function (m) { return m.t === 'view' || m.t === 'move' || m.t === 'xform'; });
    var views = onlyView ? inkFindViews(INK_UI.addon) : inkSync(INK_UI.addon);
    if (!views || !views.active) {
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

function inkPushState(views, opts) {
  inkCall('state', inkHistoryState());
  if (opts && opts.nodes) inkCall('nodes', inkSnapNodes(views));
  if (opts && opts.sel) inkCall('selection', INK_SEL ? inkSelectionInfo(views) : null);
}

function inkViewInfo(views) {
  var v = inkSurfView(views.active);
  if (views.active.kind === 'map') {
    v.minZ = views.active.scroll.minimumZoomScale;
    v.maxZ = views.active.scroll.maximumZoomScale;
  } else {
    v.minZ = v.maxZ = v.z; // PDF zoom stays with MarginNote's own gestures
  }
  return v;
}

function inkHandleMsg(views, m) {
  switch (m.t) {
    case 'ready':
      inkCall('init', {
        prefs: inkLoadPrefs(), view: inkViewInfo(views), state: inkHistoryState(), nodes: inkSnapNodes(views),
        surface: INK_UI.surface, surfaces: { map: !!views.map, doc: !!views.doc }, clip: !!(INK_CLIP && INK_CLIP.length),
        storage: INK_STORE && INK_STORE.file ? 'file' : 'notebook', version: INK_VERSION, layers: inkLayersInfo()
      });
      break;
    case 'pick':
      inkCall('picked', inkPick(views, m));
      break;
    case 'bindAt': {
      var berr = inkBindSelectionAt(views, m);
      if (berr) inkCall('error', berr);
      else inkCall('toast', '已绑定到这张卡片');
      inkPushState(views, { nodes: true, sel: true });
      break;
    }
    case 'cardDrawing':
      inkCall('cardDrawing', inkSelectionDrawing(views));
      break;
    case 'createCard': {
      var cerr = inkCreateCard(views, m);
      if (cerr) inkCall('error', cerr);
      else inkCall('toast', '已转为卡片');
      inkPushState(views, { nodes: true, sel: true });
      break;
    }
    case 'layer': {
      var lerr = inkLayerOp(INK_UI.addon, m);
      if (lerr) inkCall('error', lerr);
      views = inkFindViews(INK_UI.addon) || views;
      inkCall('layers', inkLayersInfo());
      inkPushState(views, { nodes: true, sel: true });
      break;
    }
    case 'tapCard':
      inkTapCard(views, m);
      break;
    case 'view':
      inkApplyView(views, m);
      inkCall('setView', inkSurfView(views.active));
      if (views.active.kind === 'doc') inkSync(INK_UI.addon); // newly visible pages
      break;
    case 'surface':
      inkOpenOverlay(INK_UI.addon, m.kind);
      break;
    case 'stroke': {
      var s = inkCommitStroke(views, m);
      inkCall('committed', { lid: m.lid, ok: !!s, state: inkHistoryState() });
      if (s && s.shape) inkCall('nodes', inkSnapNodes(views));
      if (!s) inkCall('error', '这里不在任何页面上');
      break;
    }
    case 'erase':
      inkErase(views, m);
      break;
    case 'eraseEnd':
      inkCommit('擦除');
      inkPushState(views, { nodes: true });
      break;
    case 'lasso':
      inkCall('lassoResult', inkLasso(views, m));
      break;
    case 'move':
      inkMovePreview(views, m.dx, m.dy);
      break;
    case 'moveEnd':
      inkMoveCommit(views, m.dx, m.dy);
      inkPushState(views, { nodes: true, sel: true });
      break;
    case 'xform':
      inkTransformPreview(views, m);
      break;
    case 'xformEnd':
      inkTransformCommit(views, m);
      inkPushState(views, { nodes: true, sel: true });
      break;
    case 'recolor':
      inkRecolorSelection(String(m.color));
      inkPushState(views, { sel: true });
      break;
    case 'duplicate':
      inkDuplicateSelection(views);
      inkPushState(views, { nodes: true, sel: true });
      break;
    case 'copy':
      inkCall('clip', inkCopySelection(views));
      break;
    case 'cut':
      inkCall('clip', inkCopySelection(views));
      inkDeleteSelection('剪切');
      inkPushState(views, { nodes: true, sel: true });
      break;
    case 'paste':
      inkPaste(views, m);
      inkPushState(views, { nodes: true, sel: true });
      break;
    case 'deleteSel':
      inkDeleteSelection();
      inkPushState(views, { nodes: true, sel: true });
      break;
    case 'deselect':
      INK_SEL = null;
      break;
    case 'editBegin':
      inkEditBegin(m.id);
      break;
    case 'editEnd':
      inkEditEnd(views, m);
      inkPushState(views, { nodes: true, sel: true });
      break;
    case 'undo':
    case 'redo':
      inkUndoRedo(INK_UI.addon, m.t === 'redo');
      if (!INK_UI) break;
      views = inkFindViews(INK_UI.addon) || views;
      inkCall('layers', inkLayersInfo());
      inkPushState(views, { nodes: true, sel: true });
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
  var ctx = views.active;
  if (ctx.kind === 'doc') {
    // MbUIBookScrollView is a UIScrollView; pan it, clamped to its content.
    var sv = ctx.scroll;
    var off = sv.contentOffset;
    var maxY = Math.max(0, ctx.canvas.frame.height - sv.bounds.height);
    var maxX = Math.max(0, ctx.canvas.frame.width - sv.bounds.width);
    sv.setContentOffsetAnimated({
      x: Math.max(0, Math.min(maxX, off.x - (m.dx || 0))),
      y: Math.max(0, Math.min(maxY, off.y - (m.dy || 0)))
    }, false);
    return;
  }
  var msv = ctx.scroll;
  var moff = msv.contentOffset;
  var z = msv.zoomScale;
  if (m.s && m.s !== 1) {
    var nz = Math.max(msv.minimumZoomScale, Math.min(msv.maximumZoomScale, z * m.s));
    var cx = (m.cx + moff.x) / z, cy = (m.cy + moff.y) / z;
    msv.setZoomScaleAnimated(nz, false);
    moff = { x: cx * nz - m.cx, y: cy * nz - m.cy };
  }
  msv.setContentOffsetAnimated({ x: moff.x - (m.dx || 0), y: moff.y - (m.dy || 0) }, false);
}
