// ---------------------------------------------------------------------------
// Lifecycle: keep the ink attached to whatever mind map is on screen.
// A 1 s timer re-attaches after MarginNote rebuilds its canvas (switching
// notebooks or sub-mind-maps) and lets ink follow cards that moved.
// ---------------------------------------------------------------------------

var INK_TIMER = null;

function inkStartTimer(addon) {
  if (INK_TIMER) INK_TIMER.invalidate();
  INK_TIMER = NSTimer.scheduledTimerWithTimeInterval(1.0, true, function () {
    inkSafe(function () { inkSync(addon); });
  });
}

function inkStopTimer() {
  if (INK_TIMER) INK_TIMER.invalidate();
  INK_TIMER = null;
}

function inkNotebookWillOpen(addon, topicid) {
  NSTimer.scheduledTimerWithTimeInterval(0.6, false, function () {
    inkSafe(function () { inkSync(addon); });
  });
  inkStartTimer(addon);
}

function inkNotebookWillClose(addon, topicid) {
  inkCloseOverlay();
  inkStopTimer();
  inkSaveNow();
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
  inkSaveNow();
  inkTeardown();
}

// …and rebuild them with the new code.
function inkAfterReload() {
  var addon = INK_ADDONS[0];
  if (!addon) return 'no add-on instance';
  inkStartTimer(addon);
  var v = inkSync(addon);
  return v ? 'reloaded, ' + INK_STORE.strokes.length + ' strokes' : 'reloaded (no mind map open)';
}
