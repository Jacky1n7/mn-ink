// ---------------------------------------------------------------------------
// Development hot-reload channel. Only present in `npm run build -- --dev`.
//
//   scripts/dev.mjs opens marginnote4app://addon/mninkdev?id=<id>&key=<dev key>&c=<js>
//   (a hot-reload push is too big for a URL: it puts "mnink-dev:<id>:<js>" on
//   the clipboard instead and leaves out c=)
//   The add-on evaluates the JS in global scope and answers through the
//   MN Agent Bridge receiver (mnagentbridge://result?id=…), so module code
//   can be replaced without reinstalling MarginNote's add-on.
//
// The key is random per dev build and never shipped in a release build.
// ---------------------------------------------------------------------------

var INK_DEV_KEY = '__DEV_KEY__';

function inkDevReply(id, value) {
  var json;
  try {
    json = JSON.stringify(value === undefined ? null : value);
  } catch (e) {
    json = JSON.stringify({ unserializable: String(e) });
  }
  var size = 60000;
  var total = Math.max(1, Math.ceil(json.length / size));
  for (var i = 0; i < total; i++) {
    var url = 'mnagentbridge://result?id=' + encodeURIComponent(id) + '&part=' + i + '&total=' + total
      + '&payload=' + encodeURIComponent(json.slice(i * size, (i + 1) * size));
    Application.sharedInstance().openURL(NSURL.URLWithString(url));
  }
}

function inkDevHandle(message) {
  if (message.indexOf('mninkdev?') !== 0) return false;
  var q = {};
  message.slice(9).split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  });
  if (q.key !== INK_DEV_KEY || !/^[A-Za-z0-9_-]{1,80}$/.test(q.id || '')) return true;
  // Small snippets travel in the URL (c=…); only big pushes use the clipboard.
  var code = q.c;
  if (code === undefined) {
    var clip = String(UIPasteboard.generalPasteboard().string || '');
    var prefix = 'mnink-dev:' + q.id + ':';
    if (clip.indexOf(prefix) !== 0) {
      inkDevReply(q.id, { ok: false, error: 'clipboard payload missing' });
      return true;
    }
    code = clip.slice(prefix.length);
  }
  var out;
  try {
    out = { ok: true, value: (0, eval)(code) };
  } catch (e) {
    out = { ok: false, error: String(e), stack: e && e.stack ? String(e.stack) : null };
  }
  inkDevReply(q.id, out);
  return true;
}
