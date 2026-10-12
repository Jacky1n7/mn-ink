// ---------------------------------------------------------------------------
// Add-on class. Every hook delegates to a global function so the dev channel
// can replace behaviour at runtime.
// ---------------------------------------------------------------------------

var INK_ADDONS = [];

var INK_UNDO_NOTES = ['NSUndoManagerDidUndoChangeNotification', 'NSUndoManagerDidRedoChangeNotification'];

function inkEnsureObserver(addon) {
  if (INK_ADDONS.indexOf(addon) >= 0) return;
  var nc = NSNotificationCenter.defaultCenter();
  nc.addObserverSelectorName(addon, 'onAddonBroadcast:', 'AddonBroadcast');
  INK_UNDO_NOTES.forEach(function (n) { nc.addObserverSelectorName(addon, 'onUndoChange:', n); });
  INK_ADDONS.push(addon);
}

function inkDropObserver(addon) {
  var nc = NSNotificationCenter.defaultCenter();
  nc.removeObserverName(addon, 'AddonBroadcast');
  INK_UNDO_NOTES.forEach(function (n) { nc.removeObserverName(addon, n); });
  var i = INK_ADDONS.indexOf(addon);
  if (i >= 0) INK_ADDONS.splice(i, 1);
}

function inkSafe(fn) {
  try {
    return fn();
  } catch (e) {
    try {
      Application.sharedInstance().showHUD('MN Ink: ' + String(e && e.message ? e.message : e), INK_ADDONS.length ? INK_ADDONS[0].window : null, 3);
    } catch (e2) {}
  }
  return undefined;
}

JSB.newAddon = function (mainPath) {
  INK_MAIN_PATH = mainPath;
  return JSB.defineClass('MNInk : JSExtension', {
    sceneWillConnect: function () {
      var addon = self;
      inkSafe(function () { inkEnsureObserver(addon); });
    },
    sceneDidDisconnect: function () {
      var addon = self;
      inkSafe(function () { inkDropObserver(addon); });
    },
    notebookWillOpen: function (topicid) {
      var addon = self;
      inkSafe(function () { inkEnsureObserver(addon); });
      inkSafe(function () { inkNotebookWillOpen(addon, topicid); });
    },
    notebookWillClose: function (topicid) {
      var addon = self;
      inkSafe(function () { inkNotebookWillClose(addon, topicid); });
    },
    controllerWillLayoutSubviews: function (controller) {
      var addon = self;
      inkSafe(function () { inkLayout(addon, controller); });
    },
    queryAddonCommandStatus: function () {
      var addon = self;
      inkSafe(function () { inkEnsureObserver(addon); });
      return { image: 'logo.png', object: addon, selector: 'toggleInk:', checked: inkIsDrawing(addon) };
    },
    toggleInk: function (sender) {
      var addon = self;
      inkSafe(function () { inkToggle(addon); });
    },
    onMNMapPen: function (sender) {
      var addon = self;
      inkSafe(function () { inkOnMNPen(addon, 'map'); });
    },
    onMNDocPen: function (sender) {
      var addon = self;
      inkSafe(function () { inkOnMNPen(addon, 'doc'); });
    },
    onUndoChange: function (sender) {
      var addon = self;
      inkSafe(function () { inkOnUndoChange(addon); });
    },
    onAddonBroadcast: function (sender) {
      var addon = self;
      var message = sender && sender.userInfo ? String(sender.userInfo.message || '') : '';
      inkSafe(function () {
        if (typeof inkDevHandle === 'function' && inkDevHandle(message)) return;
        inkHandleBroadcast(addon, message);
      });
    }
  }, {});
};
