// ---------------------------------------------------------------------------
// Shared state and small helpers.
// ---------------------------------------------------------------------------

var INK_VERSION = '__INK_VERSION__';
var INK_MAIN_PATH = '';

function inkApp() {
  return Application.sharedInstance();
}

function inkStudy(addon) {
  return inkApp().studyController(addon.window);
}

function inkHud(addon, text, secs) {
  inkApp().showHUD(text, addon.window, secs || 2);
}

function inkLog(msg) {
  try {
    JSB.log('MNInk %@', String(msg));
  } catch (e) {}
}
