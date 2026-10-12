// ---------------------------------------------------------------------------
// UIWebView delegate for the drawing page. The class only forwards to global
// functions, so a hot reload can change behaviour without redefining it.
//
// In this callback NSURLRequest/NSURL members are bridged as methods:
// request.URL() and url.absoluteString() (property access yields a function).
// ---------------------------------------------------------------------------

function inkMember(obj, name) {
  var v = obj ? obj[name] : undefined;
  return typeof v === 'function' ? v.call(obj) : v;
}

function inkWebShouldStart(webView, request, type) {
  var url = String(inkMember(inkMember(request, 'URL'), 'absoluteString') || '');
  if (url.indexOf('mnink:') === 0) {
    inkSafe(function () { inkOnPageUrl(url); });
    return false;
  }
  return true;
}

if (typeof MNInkWebBridge === 'undefined') {
  var MNInkWebBridge = JSB.defineClass('MNInkWebBridge : NSObject <UIWebViewDelegate>', {
    webViewShouldStartLoadWithRequestNavigationType: function (webView, request, type) {
      return inkWebShouldStart(webView, request, type);
    },
    webViewDidFailLoadWithError: function (webView, error) {
      inkSafe(function () { inkLog('page failed: ' + inkMember(error, 'localizedDescription')); });
    }
  });
}
