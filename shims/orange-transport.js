// Replaces orange's network transport with the in-browser backend. orange itself stays untouched.
// Must run after all jsList scripts have loaded (orange.js defines the delegates).
(function(){
  window.JE = window.JE || {};
  JE.patchOrange = function(){
    var o=window.orange; if(!o||!o.HttpDelegate||!o.WebSocketDelegate) throw new Error('orange not loaded');
    o.HttpDelegate.prototype.sendAsync=function(req){ return JEBackend.dispatch(req.cmd, req.params, null); };
    var W=o.WebSocketDelegate.prototype, seq=0;
    W.connect=function(opts){ this.close(); JE._ws=this; this._je={token:opts.token,up:true}; return Promise.resolve(true); };
    W.close=function(){ if(this._je) this._je.up=false; };
    Object.defineProperty(W,'connected',{configurable:true,get:function(){return !!(this._je&&this._je.up);}});
    W.sendAsync=function(req){ var d=this; return JEBackend.dispatch(req.cmd, req.params, d._je&&d._je.token).then(function(r){
      r.cmd=req.cmd; r.resp=++seq; r.time=Date.now();
      try{ d.events.emit(r.cmd,r); d.events.emit(o.WebSocketDelegate.EVENT_MSG,r);}catch(e){console.error(e);}
      return r; }); };
    W.send=function(req){ this.sendAsync(req); };
    // Server -> client push (what the real server did for e.g. Game_RRoleNewUserImgNotify); same event shape as a received message.
    JE.push=function(cmd,body){ var d=JE._ws; if(!d||!d.connected) return false; var r={cmd:cmd,code:0,decBody:body,resp:0,time:Date.now()};
      try{ d.events.emit(cmd,r); d.events.emit(o.WebSocketDelegate.EVENT_MSG,r); }catch(e){ console.error(e); } return true; };
    console.log('[JE] orange transport patched');
  };
})();
