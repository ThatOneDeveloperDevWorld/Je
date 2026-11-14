// Safe stand-in for native bridges. The game guards native calls with cc.sys.os (not isNative),
// so an Android/iOS *browser* would otherwise crash on jsb.reflection.
(function(){
  var defaults={ getAppChannel:'web', getPlacementId:'', getIsMobileLogin:false, isTikTokInstalled:false };
  window.jsb = window.jsb || {};
  window.jsb.reflection = { callStaticMethod: function(cls, method){
    console.log('[shim jsb]', cls, method);
    return Object.prototype.hasOwnProperty.call(defaults,method)?defaults[method]:undefined; } };
})();
