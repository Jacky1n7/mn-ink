// ---------------------------------------------------------------------------
// Ink storage lives *inside the notebook*, so MarginNote's own backup,
// iCloud sync, .marginpkg export and ⌘Z undo all cover it.
//
// Each notebook gets one hidden storage note (hidden = never drawn on the mind
// map, like MarginNote's own AI-chat and sketch notes). Add-ons cannot set the
// hidden flag, but cloning a hidden note keeps it, so the storage note is a
// clone of any hidden note, emptied and re-labelled.
//
// Comments of the storage note:
//   [0]  "mnink:store:v1 …"           header (marks the note as ours)
//   [i]  "mnink:v1:<key>\n<json>"      one per group, json = {strokes: […]}
// <key> = anchor card id, "page:<docMd5>:<pageIndex>" or "_" (no anchor).
//
// Every change is written inside UndoManager.undoGrouping, i.e. it is one step
// of MarginNote's undo history; after an undo/redo the add-on reloads.
// If no hidden note exists anywhere to clone, ink falls back to a JSON file in
// <MarginNote Documents>/MNInk/<notebookId>.json (older versions used it too).
//
// Stroke:
//   id     unique id
//   tool   "pen" | "marker" (marker layers sit under pen layers)
//   b      brush: "fountain" | "ballpoint" | "brush" | "pencil" (pen only)
//   color  "#rrggbb"
//   w      brush size in anchor units (mind map units, or PDF points on pages)
//   k      screen points per anchor unit when drawn (the outline is computed
//          at that scale so the stroke looks exactly like the live preview)
//   ps     pressure sensitivity 0–1 (missing = 0.6)
//   sim    true when the input had no pressure (mouse / finger)
//   shape  true for a recognised shape (stroked polyline, no pressure)
//   closed shape is closed
//   dash   dashed shape outline
//   a      group key (see above); null = "_"
//   pts    flat [x, y, p, x, y, p, …] relative to the group's origin
// ---------------------------------------------------------------------------

var INK_STORE = null; // { topicId, strokes, byId, noteId, sig, file, dirty: {key: true} }
var INK_HEADER = 'mnink:store:v1';
// The storage note also shows up in MarginNote's AI chat history (it lists
// hidden notes), so the header says plainly what it is.
var INK_HEADER_TEXT = '✒️ MN Ink 手写笔迹存储（请勿删除，这不是聊天记录）\n' + INK_HEADER;
var INK_STORE_IDS_KEY = 'io.github.jacky1n7.mnink.storeIds';

function inkDir() {
  return String(inkApp().documentPath) + '/MNInk';
}

function inkFile(topicId) {
  return inkDir() + '/' + topicId + '.json';
}

function inkDb() {
  return Database.sharedInstance();
}

function inkGroupKeyOf(s) {
  return s.a || '_';
}

function inkCleanStroke(s) {
  var o = { id: s.id, tool: s.tool, color: s.color, w: s.w, k: s.k, pts: s.pts };
  if (s.b) o.b = s.b;
  if (s.ps != null) o.ps = s.ps;
  if (s.sim) o.sim = true;
  if (s.shape) o.shape = true;
  if (s.closed) o.closed = true;
  if (s.dash) o.dash = true;
  if (s.fill) o.fill = s.fill;
  if (s.op != null && s.op < 1) o.op = s.op;
  if (s.l && s.l !== 'default') o.l = s.l;
  return o;
}

// ---- sketch layers -------------------------------------------------------------
// Stored as one more comment: "mnink:meta:v1\n{layers: [{id, name, hidden}], active}".

var INK_META_PREFIX = 'mnink:meta:v1\n';

function inkDefaultMeta() {
  return { layers: [{ id: 'default', name: '默认图层', hidden: false }], active: 'default' };
}

function inkParseMeta(note) {
  var c = note ? note.comments || [] : [];
  for (var i = 0; i < c.length; i++) {
    var t = String(c[i].text || '');
    if (t.indexOf(INK_META_PREFIX) !== 0) continue;
    try {
      var m = JSON.parse(t.slice(INK_META_PREFIX.length));
      if (m && m.layers && m.layers.length) {
        if (!m.layers.some(function (l) { return l.id === m.active; })) m.active = m.layers[0].id;
        return m;
      }
    } catch (e) {}
  }
  return inkDefaultMeta();
}

function inkLayerOfStroke(s) {
  return s.l || 'default';
}

function inkLayerHidden(id) {
  var m = INK_STORE && INK_STORE.meta;
  if (!m) return false;
  for (var i = 0; i < m.layers.length; i++) if (m.layers[i].id === id) return !!m.layers[i].hidden;
  return false;
}

function inkSaveMeta(label) {
  var store = INK_STORE;
  if (!store || store.file) return;
  var note = inkStorageNote();
  if (!note) return;
  UndoManager.sharedInstance().undoGrouping('MN Ink: ' + (label || '图层'), store.topicId, function () {
    var c = note.comments || [];
    for (var i = c.length - 1; i >= 0; i--) {
      if (String(c[i].text || '').indexOf(INK_META_PREFIX) === 0) note.removeCommentByIndex(i);
    }
    note.appendTextComment(INK_META_PREFIX + JSON.stringify(store.meta));
  });
  store.sig = inkNoteSig(inkDb().getNoteById(store.noteId));
}

// ---- storage note -----------------------------------------------------------

function inkIsStorageNote(n) {
  if (!n || !n.hidden) return false;
  var c = n.comments;
  if (!c) return false;
  for (var i = 0; i < c.length; i++) {
    if (c[i].type === 'TextNote' && String(c[i].text || '').indexOf(INK_HEADER) >= 0) return true;
  }
  return false;
}

function inkStoreIds() {
  try {
    var s = NSUserDefaults.standardUserDefaults().objectForKey(INK_STORE_IDS_KEY);
    return s ? JSON.parse(String(s)) : {};
  } catch (e) {
    return {};
  }
}

function inkRememberStoreId(topicId, noteId) {
  var ids = inkStoreIds();
  ids[topicId] = noteId;
  NSUserDefaults.standardUserDefaults().setObjectForKey(JSON.stringify(ids), INK_STORE_IDS_KEY);
}

function inkFindStorageNote(topicId) {
  var db = inkDb();
  var known = inkStoreIds()[topicId];
  if (known) {
    var k = db.getNoteById(known);
    if (k && String(k.notebookId) === topicId && inkIsStorageNote(k)) return k;
  }
  var nb = db.getNotebookById(topicId);
  var notes = nb ? nb.notes || [] : [];
  for (var i = 0; i < notes.length; i++) {
    if (notes[i].hidden && inkIsStorageNote(notes[i])) {
      inkRememberStoreId(topicId, String(notes[i].noteId));
      return notes[i];
    }
  }
  return null;
}

function inkPlainHidden(n) {
  if (!n || !n.hidden) return false;
  var c = n.comments || [];
  return c.every(function (x) { return x.type === 'TextNote' || x.type === 'HtmlNote' || x.type === 'MarkdownNote'; });
}

// A hidden note to clone. Prefer one from the same notebook (the clone then
// carries this notebook's own document id), then our storage notes, then any.
function inkFindHiddenSeed(topicId) {
  var db = inkDb();
  var own = db.getNotebookById(topicId);
  var notes = own ? own.notes || [] : [];
  for (var j = 0; j < notes.length; j++) {
    if (inkPlainHidden(notes[j]) && !inkIsStorageNote(notes[j])) return notes[j];
  }
  var ids = inkStoreIds();
  for (var t in ids) {
    var n = db.getNoteById(ids[t]);
    if (n && inkIsStorageNote(n)) return n;
  }
  var books = (db.allNotebooks() || []).filter(function (b) { return String(b.topicId) !== topicId; });
  for (var i = 0; i < books.length; i++) {
    var ns = books[i].notes || [];
    for (var k = 0; k < ns.length; k++) {
      if (inkPlainHidden(ns[k])) return ns[k];
    }
  }
  return null;
}

// cloneNotesToTopic returns the new note ids (strings); the notebook's
// `notes` list does not show the clone right away, so look it up by id.
function inkCloneInto(note, topicId, label) {
  var db = inkDb();
  var res = null;
  UndoManager.sharedInstance().undoGrouping(label, topicId, function () {
    res = db.cloneNotesToTopic([note], topicId);
  });
  var id = res && res.length ? String(res[0]) : null;
  return id ? db.getNoteById(id) : null;
}

function inkCreateStorageNote(topicId) {
  var seed = inkFindHiddenSeed(topicId);
  if (!seed) return null;
  var db = inkDb();
  var note = inkCloneInto(seed, topicId, 'MN Ink: 创建笔迹存储');
  if (!note || !note.hidden) return null;
  UndoManager.sharedInstance().undoGrouping('MN Ink: 创建笔迹存储', topicId, function () {
    for (var k = note.comments.length - 1; k >= 0; k--) note.removeCommentByIndex(k);
    note.appendTextComment(INK_HEADER_TEXT);
  });
  note = db.getNoteById(String(note.noteId));
  if (!inkIsStorageNote(note)) return null;
  inkRememberStoreId(topicId, String(note.noteId));
  return note;
}

// ---- load / save --------------------------------------------------------------

function inkParseGroups(note) {
  var strokes = [];
  var c = note.comments || [];
  for (var i = 0; i < c.length; i++) {
    var t = String(c[i].text || '');
    if (t.indexOf('mnink:v1:') !== 0) continue;
    var nl = t.indexOf('\n');
    var key = t.slice(9, nl);
    try {
      var data = JSON.parse(t.slice(nl + 1));
      (data.strokes || []).forEach(function (s) {
        s.a = key === '_' ? null : key;
        strokes.push(s);
      });
    } catch (e) {
      inkLog('bad group ' + key + ': ' + e);
    }
  }
  return strokes;
}

// Cheap fingerprint of the storage note, to notice undo / redo / sync.
function inkNoteSig(note) {
  var c = note.comments || [];
  var sig = c.length + ':';
  for (var i = 0; i < c.length; i++) {
    var t = String(c[i].text || '');
    sig += t.length + '.' + t.charCodeAt(t.length - 2) + ',';
  }
  return sig;
}

function inkLoadFile(topicId) {
  try {
    var path = inkFile(topicId);
    if (!NSFileManager.defaultManager().fileExistsAtPath(path)) return null;
    var obj = NSJSONSerialization.JSONObjectWithDataOptions(NSData.dataWithContentsOfFile(path), 0);
    var data = obj && obj.ink ? JSON.parse(String(obj.ink)) : null;
    return data && data.strokes ? data.strokes : [];
  } catch (e) {
    inkLog('file load failed: ' + e);
    return null;
  }
}

function inkLoadStore(topicId) {
  var store = { topicId: topicId, strokes: [], byId: {}, noteId: null, sig: '', file: false, dirty: {}, meta: inkDefaultMeta() };
  var note = inkFindStorageNote(topicId);
  var legacy = inkLoadFile(topicId);
  if (!note && legacy && legacy.length) note = inkCreateStorageNote(topicId);
  if (note) {
    store.noteId = String(note.noteId);
    inkUpgradeHeader(note, topicId);
    store.strokes = inkParseGroups(note);
    store.meta = inkParseMeta(note);
    if (legacy && legacy.length && !store.strokes.length) {
      // Move ink from the old JSON file into the notebook (one undo step).
      store.strokes = legacy;
      legacy.forEach(function (s) { store.dirty[inkGroupKeyOf(s)] = true; });
      INK_STORE = store;
      store.strokes.forEach(function (s) { store.byId[s.id] = s; });
      inkCommit('迁移笔迹');
      try {
        NSFileManager.defaultManager().moveItemAtPathToPath(inkFile(topicId), inkFile(topicId) + '.migrated');
      } catch (e) {}
      return store;
    }
    store.sig = inkNoteSig(note);
  } else if (legacy) {
    store.file = true;
    store.strokes = legacy;
  }
  store.strokes.forEach(function (s) { store.byId[s.id] = s; });
  return store;
}

// Older versions wrote a terse header; replace it (position does not matter).
function inkUpgradeHeader(note, topicId) {
  var c = note.comments || [];
  for (var i = 0; i < c.length; i++) {
    var t = String(c[i].text || '');
    if (t.indexOf(INK_HEADER) < 0) continue;
    if (t === INK_HEADER_TEXT) return;
    UndoManager.sharedInstance().undoGrouping('MN Ink: 存储标注', topicId, function () {
      note.removeCommentByIndex(i);
      note.appendTextComment(INK_HEADER_TEXT);
    });
    return;
  }
}

function inkStorageNote() {
  if (!INK_STORE || INK_STORE.file) return null;
  var n = INK_STORE.noteId ? inkDb().getNoteById(INK_STORE.noteId) : null;
  if (n && inkIsStorageNote(n)) return n;
  // The note was deleted (or its creation undone): make a new one and write
  // every group into it, not just the ones that changed.
  n = inkFindStorageNote(INK_STORE.topicId) || inkCreateStorageNote(INK_STORE.topicId);
  INK_STORE.noteId = n ? String(n.noteId) : null;
  if (n) INK_STORE.strokes.forEach(function (s) { INK_STORE.dirty[inkGroupKeyOf(s)] = true; });
  return n;
}

// Write the dirty groups as one step of MarginNote's undo history.
function inkCommit(label) {
  var store = INK_STORE;
  if (!store || !Object.keys(store.dirty).length) return;
  var note = store.file ? null : inkStorageNote(); // may mark every group dirty
  if (!note) {
    store.dirty = {};
    inkSaveFile();
    return;
  }
  var keys = Object.keys(store.dirty);
  store.dirty = {};
  var groups = {};
  keys.forEach(function (k) { groups[k] = []; });
  store.strokes.forEach(function (s) {
    var k = inkGroupKeyOf(s);
    if (groups[k]) groups[k].push(inkCleanStroke(s));
  });
  UndoManager.sharedInstance().undoGrouping('MN Ink: ' + (label || '书写'), store.topicId, function () {
    var c = note.comments || [];
    var remove = [];
    for (var i = c.length - 1; i >= 0; i--) {
      var t = String(c[i].text || '');
      if (t.indexOf('mnink:v1:') !== 0) continue;
      var key = t.slice(9, t.indexOf('\n'));
      if (groups[key]) remove.push(i);
    }
    remove.forEach(function (i) { note.removeCommentByIndex(i); });
    keys.forEach(function (k) {
      if (groups[k].length) note.appendTextComment('mnink:v1:' + k + '\n' + JSON.stringify({ strokes: groups[k] }));
    });
  });
  try {
    inkDb().setNotebookSyncDirty(store.topicId);
  } catch (e) {}
  store.sig = inkNoteSig(inkDb().getNoteById(store.noteId));
}

function inkSaveFile() {
  var store = INK_STORE;
  var fm = NSFileManager.defaultManager();
  if (!fm.fileExistsAtPath(inkDir())) fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(inkDir(), true, null);
  var json = JSON.stringify({ v: 1, ink: JSON.stringify({ strokes: store.strokes.map(function (s) {
    var c = inkCleanStroke(s);
    c.a = s.a;
    return c;
  }) }) });
  NSData.dataWithStringEncoding(json, 4).writeToFileAtomically(inkFile(store.topicId), true);
}

// Re-read the notebook when its storage changed behind our back
// (MarginNote undo / redo, iCloud sync). Returns true when it reloaded.
function inkReloadIfChanged() {
  var store = INK_STORE;
  if (!store || store.file || !store.noteId) return false;
  var note = inkDb().getNoteById(store.noteId);
  if (!note) return false;
  var sig = inkNoteSig(note);
  if (sig === store.sig) return false;
  store.sig = sig;
  store.strokes = inkParseGroups(note);
  store.meta = inkParseMeta(note);
  store.byId = {};
  store.strokes.forEach(function (s) { store.byId[s.id] = s; });
  return true;
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
