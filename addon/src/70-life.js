// ---------------------------------------------------------------------------
// Lifecycle and integration with MarginNote's own tools.
//
// - A timer keeps the ink attached to whatever mind map / PDF is on screen
//   (0.25 s while a PDF is visible: its page views are recycled on scroll),
//   lets ink follow moved cards, and notices notebook changes made behind our
//   back (MarginNote undo / redo, iCloud sync).
// - MarginNote's pen buttons (mind map toolbar squiggle, PDF tool picker pen)
//   get an extra target: tapping them opens MN Ink instead (switchable).
// - While MN Ink is open, MarginNote's own pen is switched back to the
//   selection tool, so the two never write at the same time.
// ---------------------------------------------------------------------------

var INK_TIMER = null;
var INK_TICKS = 0;
var INK_MN = { map: null, doc: null, at: 0 }; // found MarginNote tool buttons

function inkStartTimer(addon) {
  inkStopTimer();
  INK_TIMER = NSTimer.scheduledTimerWithTimeInterval(0.25, true, function () {
    INK_TICKS++;
    inkSafe(function () { inkTick(addon); });
  });
}

function inkStopTimer() {
  if (INK_TIMER) INK_TIMER.invalidate();
  INK_TIMER = null;
}

function inkTick(addon) {
  var docShown = !!INK_SURF.doc;
  // Mind maps only need a slow pulse; PDFs recycle page views on scroll.
  if (!docShown && INK_TICKS % 4 !== 0) return;
  var views = inkSync(addon);
  if (!views) return;
  if (INK_TICKS % 8 === 0 && inkReloadIfChanged()) {
    inkRerenderAll(addon);
    if (INK_UI) {
      inkCall('layers', inkLayersInfo());
      inkPushState(inkFindViews(addon) || views, { nodes: true, sel: true });
    }
  }
  if (INK_TICKS % 8 === 0) inkHookMNPens(addon, views);
  if (INK_UI) inkGuardMNPen(addon);
}

// ---- MarginNote's own tools ---------------------------------------------------

function inkButtons(v) {
  return (v.subviews || []).filter(function (b) { return inkClassName(b) === 'UIButton' && !b.hidden; });
}

// Mind map: the right-hand column of 44-pt buttons; pen = the bottom one,
// selection ("hand") = the first button below the separator line.
function inkFindMapTools(root) {
  var found = null;
  (function walk(v, depth) {
    if (found || depth > 8) return;
    var bs = inkButtons(v);
    if (bs.length >= 5 && bs.every(function (b) { return Math.abs(b.frame.width - 44) < 1 && Math.abs(b.frame.x - bs[0].frame.x) < 1; })) {
      bs.sort(function (a, b) { return a.frame.y - b.frame.y; });
      var sep = (v.subviews || []).filter(function (x) { return inkClassName(x) !== 'UIButton' && x.frame.height <= 2 && x.frame.width > 10; })[0];
      var hand = sep ? bs.filter(function (b) { return b.frame.y > sep.frame.y; })[0] : bs[2];
      found = { pen: bs[bs.length - 1], hand: hand || bs[2] };
      return;
    }
    var subs = v.subviews || [];
    if (subs.length > 60) return;
    for (var i = 0; i < subs.length; i++) if (!subs[i].hidden) walk(subs[i], depth + 1);
  })(root, 0);
  return found;
}

// PDF: ExcerptToolPicker; selection = first button, pen = first after the separator.
function inkFindDocTools(root) {
  var picker = null;
  (function walk(v, depth) {
    if (picker || depth > 7) return;
    if (inkClassName(v) === 'ExcerptToolPicker') { picker = v; return; }
    var subs = v.subviews || [];
    if (subs.length > 60) return;
    for (var i = 0; i < subs.length; i++) if (!subs[i].hidden) walk(subs[i], depth + 1);
  })(root, 0);
  if (!picker || !picker.subviews || !picker.subviews.length) return null;
  var strip = picker.subviews[0];
  var bs = inkButtons(strip).sort(function (a, b) { return a.frame.x - b.frame.x; });
  var sep = (strip.subviews || []).filter(function (x) { return inkClassName(x) === 'UIView' && x.frame.width <= 2 && x.frame.height > 8; })[0];
  if (!bs.length || !sep) return null;
  var pen = bs.filter(function (b) { return b.frame.x > sep.frame.x; })[0];
  return pen ? { pen: pen, hand: bs[0] } : null;
}

function inkTakeoverOn() {
  var p = inkLoadPrefs();
  return !p || p.takeover !== false;
}

function inkHookMNPens(addon, views) {
  var root = views.sc.view;
  INK_MN.map = inkFindMapTools(root);
  INK_MN.doc = inkFindDocTools(root);
  ['map', 'doc'].forEach(function (k) {
    var t = INK_MN[k];
    if (!t) return;
    var sel = k === 'map' ? 'onMNMapPen:' : 'onMNDocPen:';
    try {
      t.pen.removeTargetActionForControlEvents(addon, sel, 1 << 6);
      if (inkTakeoverOn()) t.pen.addTargetActionForControlEvents(addon, sel, 1 << 6);
    } catch (e) {
      inkLog('hook failed: ' + e);
    }
  });
}

// Back to MarginNote's selection tool if its pen is on.
function inkGuardMNPen(addon) {
  var switched = false;
  ['map', 'doc'].forEach(function (k) {
    var t = INK_MN[k];
    if (t && t.pen.window && t.pen.selected && t.hand && t.hand.window) {
      t.hand.sendActionsForControlEvents(1 << 6);
      switched = true;
    }
  });
  return switched;
}

// MarginNote's pen button was tapped: open MN Ink on that surface instead.
function inkOnMNPen(addon, kind) {
  if (!inkTakeoverOn()) return;
  NSTimer.scheduledTimerWithTimeInterval(0.05, false, function () {
    inkSafe(function () {
      inkGuardMNPen(addon);
      if (!INK_UI || INK_UI.surface !== kind) inkOpenOverlay(addon, kind);
    });
  });
}

// MarginNote undo / redo (menu, ⌘Z, toolbar): reload if the ink changed.
function inkOnUndoChange(addon) {
  NSTimer.scheduledTimerWithTimeInterval(0.05, false, function () {
    inkSafe(function () {
      if (!inkReloadIfChanged()) return;
      INK_SEL = null;
      var views = inkRerenderAll(addon);
      if (INK_UI && views) {
        views = inkFindViews(addon) || views;
        inkCall('layers', inkLayersInfo());
        inkPushState(views, { nodes: true, sel: true });
      }
    });
  });
}

// ---- notebook lifecycle ---------------------------------------------------------

function inkNotebookWillOpen(addon, topicid) {
  NSTimer.scheduledTimerWithTimeInterval(0.6, false, function () {
    inkSafe(function () {
      var views = inkSync(addon);
      if (views) inkHookMNPens(addon, views);
    });
  });
  inkStartTimer(addon);
}

function inkNotebookWillClose(addon, topicid) {
  inkCloseOverlay();
  inkStopTimer();
  inkCommit();
  inkTeardown();
  INK_STORE = null;
  inkResetHistory();
}

function inkLayout(addon, controller) {
  inkLayoutOverlay(addon);
}

function inkHandleBroadcast(addon, message) {}

// Hot reload (scripts/dev.mjs push): drop views built by the old code…
function inkBeforeReload() {
  inkCloseOverlay();
  inkStopTimer();
  try {
    inkCommit();
  } catch (e) {}
  inkTeardown();
}

// …and rebuild them with the new code.
function inkAfterReload() {
  var addon = INK_ADDONS[0];
  if (!addon) return 'no add-on instance';
  INK_STORE = null;
  inkStartTimer(addon);
  var v = inkSync(addon);
  return v ? 'reloaded, ' + INK_STORE.strokes.length + ' strokes (' + (INK_STORE.file ? 'file' : 'notebook') + ')' : 'reloaded (nothing open)';
}
