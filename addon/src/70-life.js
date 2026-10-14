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
// With the takeover on, MarginNote's own action on its pen buttons (it enters
// MarginNote's handwriting mode: zoom jump, its paper background, its tool
// picker) is taken off, so the button only toggles MN Ink. Kept here to put
// back when the takeover is switched off or the user asks for MN's own pen.
// (Survives a hot reload.)
var INK_MN_ORIG = (typeof INK_MN_ORIG !== 'undefined' && INK_MN_ORIG) || { map: null, doc: null };
var INK_MN_NATIVE = (typeof INK_MN_NATIVE !== 'undefined' && INK_MN_NATIVE) || null; // { at } while MN's own pen is in use

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
  if (INK_UI) inkSafe(function () { inkAlignOverlay(inkFindViews(addon)); });
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
  if (INK_TICKS % 4 === 0) inkCheckMNNative(addon, views);
  if (INK_UI && INK_TICKS % 4 === 0) inkPushCards(views, false); // cards moved / branch folded
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
  var take = inkTakeoverOn() && !INK_MN_NATIVE;
  ['map', 'doc'].forEach(function (k) {
    var t = INK_MN[k];
    if (!t) return;
    var sel = k === 'map' ? 'onMNMapPen:' : 'onMNDocPen:';
    try {
      t.pen.removeTargetActionForControlEvents(addon, sel, 1 << 6);
      if (take) {
        inkStripMNActions(k, t.pen);
        t.pen.addTargetActionForControlEvents(addon, sel, 1 << 6);
        t.pen.selected = !!(INK_UI && INK_UI.surface === k);
      } else {
        inkRestoreMNActions(k);
      }
    } catch (e) {
      inkLog('hook failed: ' + e);
    }
  });
}

// Take MarginNote's own target / actions off a pen button (remembered).
function inkStripMNActions(k, pen) {
  var o = INK_MN_ORIG[k];
  if (o && o.pen !== pen) o = INK_MN_ORIG[k] = null; // a new button (view rebuilt)
  var targets = pen.allTargets();
  var list = targets && targets.allObjects ? targets.allObjects() : [];
  list.forEach(function (x) {
    if (/^MNInk/.test(inkClassName(x))) return;
    var acts = pen.actionsForTargetForControlEvent(x, 1 << 6) || [];
    if (!acts.length) return;
    if (!o) o = INK_MN_ORIG[k] = { pen: pen, pairs: [] };
    acts.forEach(function (a) {
      o.pairs.push({ target: x, action: String(a) });
      pen.removeTargetActionForControlEvents(x, String(a), 1 << 6);
    });
  });
}

function inkRestoreMNActions(k) {
  var o = INK_MN_ORIG[k];
  if (!o) return;
  INK_MN_ORIG[k] = null;
  o.pairs.forEach(function (p) {
    try {
      o.pen.addTargetActionForControlEvents(p.target, p.action, 1 << 6);
    } catch (e) {}
  });
}

// "Use MarginNote's own pen" (to edit handwriting written with it): close MN
// Ink, give the button back its own action and press it. The takeover comes
// back once MarginNote's handwriting mode is left.
function inkUseMNPen(addon) {
  var kind = INK_UI ? INK_UI.surface : 'map';
  inkCloseOverlay();
  var views = inkSync(addon);
  if (!views) return;
  INK_MN_NATIVE = { at: Date.now() };
  inkHookMNPens(addon, views);
  var t = INK_MN[kind] || INK_MN.map || INK_MN.doc;
  if (t) t.pen.sendActionsForControlEvents(1 << 6);
}

function inkCheckMNNative(addon, views) {
  if (!INK_MN_NATIVE || Date.now() - INK_MN_NATIVE.at < 2500) return;
  var on = ['map', 'doc'].some(function (k) { return INK_MN[k] && INK_MN[k].pen.window && INK_MN[k].pen.selected; });
  if (on) return;
  INK_MN_NATIVE = null;
  inkHookMNPens(addon, views);
}

// Back to MarginNote's selection tool if its pen is on.
function inkGuardMNPen(addon) {
  if (INK_MN_NATIVE) return false;
  var switched = false;
  ['map', 'doc'].forEach(function (k) {
    var t = INK_MN[k];
    // A button whose own action we took off cannot have entered MarginNote's
    // mode (its "selected" look is ours); pressing the already selected hand
    // would only open the hand's settings.
    if (INK_MN_ORIG[k] && INK_MN_ORIG[k].pen === (t && t.pen)) return;
    if (t && t.pen.window && t.pen.selected && t.hand && t.hand.window && !t.hand.selected) {
      t.hand.sendActionsForControlEvents(1 << 6);
      switched = true;
    }
  });
  return switched;
}

// MarginNote's pen button was tapped: it toggles MN Ink on that surface.
function inkOnMNPen(addon, kind) {
  if (!inkTakeoverOn() || INK_MN_NATIVE) return;
  NSTimer.scheduledTimerWithTimeInterval(0.05, false, function () {
    inkSafe(function () {
      inkGuardMNPen(addon);
      if (INK_UI && INK_UI.surface === kind) inkCloseOverlay();
      else inkOpenOverlay(addon, kind);
      inkMarkMNPens();
    });
  });
}

// MarginNote's pen buttons light up while MN Ink is open on their surface.
function inkMarkMNPens() {
  if (!inkTakeoverOn() || INK_MN_NATIVE) return;
  ['map', 'doc'].forEach(function (k) {
    var t = INK_MN[k];
    if (t && t.pen.window) t.pen.selected = !!(INK_UI && INK_UI.surface === k);
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
  inkRestoreMNActions('map');
  inkRestoreMNActions('doc');
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
