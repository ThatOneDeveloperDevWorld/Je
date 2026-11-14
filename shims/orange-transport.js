// Replaces orange's network transport with the in-browser backend. orange itself stays untouched.
// Must run after all jsList scripts have loaded (orange.js defines the delegates).
(function(){
  window.JE = window.JE || {};
  JE.patchOrange = function(){
    var o=window.orange; if(!o||!o.HttpDelegate||!o.WebSocketDelegate) throw new Error('orange not loaded');
    o.HttpDelegate.prototype.sendAsync=function(req){ return JEBackend.dispatch(req.cmd, req.params, null); };
    var W=o.WebSocketDelegate.prototype, seq=0;
    W.connect=function(opts){ this.close(); this._je={token:opts.token,up:true}; return Promise.resolve(true); };
    W.close=function(){ if(this._je) this._je.up=false; };
    Object.defineProperty(W,'connected',{configurable:true,get:function(){return !!(this._je&&this._je.up);}});
    W.sendAsync=function(req){ var d=this; return JEBackend.dispatch(req.cmd, req.params, d._je&&d._je.token).then(function(r){
      r.cmd=req.cmd; r.resp=++seq; r.time=Date.now();
      try{ d.events.emit(r.cmd,r); d.events.emit(o.WebSocketDelegate.EVENT_MSG,r);}catch(e){console.error(e);}
      return r; }); };
    W.send=function(req){ this.sendAsync(req); };
    console.log('[JE] orange transport patched');
  };
})();
