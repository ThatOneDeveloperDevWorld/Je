// Command dispatcher. Unimplemented commands fail LOUDLY (code -1); nothing fakes success.
window.JEBackend=(function(){
  var handlers={};
  return {
    register:function(cmd,fn){ handlers[cmd.toLowerCase()]=fn; },
    dispatch:function(cmd,params,token){
      var h=handlers[String(cmd).toLowerCase()];
      if(!h){ console.warn('[JE] NOT IMPLEMENTED:',cmd,params); return Promise.resolve({code:-1,error:'NOT_IMPLEMENTED '+cmd,decBody:null}); }
      return Promise.resolve().then(function(){return h(params||{},token);}).then(function(body){
        return (body&&body.__code)?{code:body.__code,error:body.__error||'',decBody:null}:{code:0,decBody:body}; })
        .catch(function(e){ console.error('[JE] handler error',cmd,e); return {code:-2,error:String(e&&e.message||e),decBody:null}; });
    },
    handlers:handlers
  };
})();
