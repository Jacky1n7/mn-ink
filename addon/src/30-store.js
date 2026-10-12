// ---------------------------------------------------------------------------
// Per-notebook ink storage.
//
// File: <MarginNote Documents>/MNInk/<notebookId>.json
//   { "v": 1, "ink": "<JSON string of {strokes: [...]}>" }
// The payload is a JSON *string* so it comes back through NSJSONSerialization
// as one JS string instead of thousands of bridged NSNumbers.
//
// Stroke:
//   id     unique id
//   tool   "pen" | "marker" (marker layers sit under pen layers)
//   b      brush: "fountain" | "ballpoint" | "brush" | "pencil" (pen only)
//   color  "#rrggbb"
//   w      brush size in mind map units
//   k      zoom at drawing time (outline is computed at that scale so the
//          stroke looks exactly like the live preview)
//   sim    true when the input had no pressure (mouse / finger)
//   shape  true for a recognised shape (stroked polyline, no pressure)
//   closed shape is closed
//   dash   dashed shape outline
//   a      anchor note id, or null (absolute mind map coordinates)
//   pts    flat [x, y, p, x, y, p, …] relative to the anchor's top-left corner
// ---------------------------------------------------------------------------

var INK_STORE = null; // { topicId, strokes, byId }
var INK_SAVE_TIMER = null;

function inkDir() {
  return String(inkApp().documentPath) + '/MNInk';
}

function inkFile(topicId) {
  return inkDir() + '/' + topicId + '.json';
}

function inkLoadStore(topicId) {
  var store = { topicId: topicId, strokes: [], byId: {} };
  try {
    var path = inkFile(topicId);
    if (NSFileManager.defaultManager().fileExistsAtPath(path)) {
      var obj = NSJSONSerialization.JSONObjectWithDataOptions(NSData.dataWithContentsOfFile(path), 0);
      var data = obj && obj.ink ? JSON.parse(String(obj.ink)) : null;
      if (data && data.strokes) store.strokes = data.strokes;
    }
  } catch (e) {
    inkLog('load failed: ' + e);
  }
  store.strokes.forEach(function (s) { store.byId[s.id] = s; });
  return store;
}

function inkSaveNow() {
  if (INK_SAVE_TIMER) {
    INK_SAVE_TIMER.invalidate();
    INK_SAVE_TIMER = null;
  }
  var store = INK_STORE;
  if (!store || !store.dirty) return;
  var fm = NSFileManager.defaultManager();
  if (!fm.fileExistsAtPath(inkDir())) fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(inkDir(), true, null);
  var clean = store.strokes.map(function (s) {
    return {
      id: s.id, tool: s.tool, b: s.b, color: s.color, w: s.w, k: s.k, sim: s.sim, shape: s.shape, closed: s.closed,
      dash: s.dash, fill: s.fill, a: s.a, pts: s.pts
    };
  });
  var json = JSON.stringify({ v: 1, ink: JSON.stringify({ strokes: clean }) });
  var ok = NSData.dataWithStringEncoding(json, 4).writeToFileAtomically(inkFile(store.topicId), true);
  if (ok) store.dirty = false;
  else inkLog('save failed');
}

function inkSaveSoon() {
  if (!INK_STORE) return;
  INK_STORE.dirty = true;
  if (INK_SAVE_TIMER) INK_SAVE_TIMER.invalidate();
  INK_SAVE_TIMER = NSTimer.scheduledTimerWithTimeInterval(1.5, false, function () {
    INK_SAVE_TIMER = null;
    inkSafe(inkSaveNow);
  });
}

function inkNewId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

// Brush / tool settings, remembered across sessions.
var INK_PREFS_KEY = 'io.github.jacky1n7.mnink.prefs';

function inkLoadPrefs() {
  try {
    var s = NSUserDefaults.standardUserDefaults().objectForKey(INK_PREFS_KEY);
    return s ? JSON.parse(String(s)) : null;
  } catch (e) {
    return null;
  }
}

function inkSavePrefs(prefs) {
  NSUserDefaults.standardUserDefaults().setObjectForKey(JSON.stringify(prefs), INK_PREFS_KEY);
}
