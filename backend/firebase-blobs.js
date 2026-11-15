// ASSETS: user-made images (avatars, tiles, actors, game icons...) are BASE64 strings stored right inside the data that
// references them, so they need no file hosting and no review. The game addresses them as  gameEnv.fileCDN + url  where
//   fileCDN = "b64://"      and      url = "pixel/" + base64url(PNG bytes) + ".png"
// ("pixel/" is mandatory: the game's Util.isCdnPng() decides "custom upload vs built-in sprite" by that substring.)
// JE.patchAssets() hooks the engine downloader: it DECODES b64://pixel/... into a blob: URL the loaders can read.
// Published game packs (too big for a document field) are base64 text in chunked Firestore docs: b64://pack/<id>.bin
(function(){
  var BCHUNK=690000, MAX=8*1024*1024, SCHEME='b64://', IMG_MAX=400000, memo=new Map(), packs=new Map();
  function db(){ return window.JEBackend.db; }
  function u8(x){ return x instanceof Uint8Array?x:new Uint8Array(x); }
  function toB64(b){ var s='',i; for(i=0;i<b.length;i+=0x8000) s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000)); return btoa(s); }
  function fromB64(t){ var s=atob(t), o=new Uint8Array(s.length), i; for(i=0;i<s.length;i++) o[i]=s.charCodeAt(i); return o; }

  window.JEAssets={
    SCHEME:SCHEME, IMG_MAX:IMG_MAX,
    encode:function(bytes,ext){ return 'pixel/'+toB64(u8(bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')+'.'+(ext||'png'); },
    decode:function(url){                       // "pixel/<b64url>.png" -> {bytes, ext}
      var p=url.indexOf('pixel/')===0?url.slice(6):url, dot=p.lastIndexOf('.'), body=dot<0?p:p.slice(0,dot), ext=dot<0?'png':p.slice(dot+1);
      body=body.replace(/-/g,'+').replace(/_/g,'/'); while(body.length%4) body+='=';
      return {bytes:fromB64(body),ext:ext};
    },
    objectUrl:function(url){                    // memoised: decode once per session
      if(!memo.has(url)){ var d=this.decode(url); memo.set(url,URL.createObjectURL(new Blob([d.bytes],{type:'image/'+d.ext}))); }
      return memo.get(url);
    }
  };

  // Big binaries (published packs) as chunked Firestore docs holding BASE64 TEXT (plain strings: no special Firestore types).
  // 690000 bytes -> 920000 base64 chars per chunk, safely under the 1 MiB document limit.
  window.JEBlobs={
    MAX:MAX, CHUNK:BCHUNK,
    encode:function(b){ return toB64(u8(b)); },
    decode:function(t){ return fromB64(t); },
    put:async function(data,type,ext){
      var b=u8(data); if(b.length>MAX) throw new Error('file too large ('+b.length+' bytes, max '+MAX+')');
      var user=window.JEBackend.auth.currentUser; if(!user) throw new Error('not signed in');
      var id=db().collection('blobs').doc().id+'.'+ext, n=Math.max(1,Math.ceil(b.length/BCHUNK)), doc=db().collection('blobs').doc(id);
      var meta={uid:user.uid,size:b.length,n:n,type:type,createdAt:Date.now()};
      if(n===1) meta.b64=toB64(b);
      await doc.set(meta);
      for(var i=0;n>1&&i<n;i++) await doc.collection('c').doc(String(i)).set({b64:toB64(b.subarray(i*BCHUNK,(i+1)*BCHUNK))});
      return id;
    },
    get:async function(id){
      var doc=db().collection('blobs').doc(id), s=await doc.get(); if(!s.exists) throw new Error('missing file '+id);
      var m=s.data(); function bytes(x){ return typeof x.b64==='string'?fromB64(x.b64):x.d.toUint8Array(); }   // x.d = legacy Firestore Blob
      if(m.b64!==undefined||m.d) return {bytes:bytes(m),type:m.type};
      var parts=await Promise.all(Array.from({length:m.n},function(_,i){ return doc.collection('c').doc(String(i)).get(); })), out=new Uint8Array(m.size), o=0;
      parts.forEach(function(p){ var c=bytes(p.data()); out.set(c,o); o+=c.length; });
      return {bytes:out,type:m.type};
    },
    objectUrl:function(id){
      if(!packs.has(id)) packs.set(id,window.JEBlobs.get(id).then(function(r){ return URL.createObjectURL(new Blob([r.bytes],{type:r.type})); }).catch(function(e){ packs.delete(id); throw e; }));
      return packs.get(id);
    }
  };

  window.JE=window.JE||{};
  JE.patchAssets=function(){
    var d=cc.assetManager.downloader, orig=d.download;
    d.download=function(id,url,type,options,onComplete){
      if(typeof url==='string'&&url.indexOf(SCHEME)===0){
        var p=url.slice(SCHEME.length), ext=p.slice(p.lastIndexOf('.')), go=function(u){ orig.call(d,id,u,type||ext,options,onComplete); };
        try{
          if(p.indexOf('pixel/')===0) go(window.JEAssets.objectUrl(p));
          else if(p.indexOf('pack/')===0) window.JEBlobs.objectUrl(p.slice(5)).then(go,function(e){ console.error('[JE] pack load failed',p,e); onComplete(e); });
          else throw new Error('unknown b64 address '+p.slice(0,20));
        }catch(e){ console.error('[JE] asset decode failed',e); onComplete(e); }
        return;
      }
      return orig.apply(d,arguments);
    };
    console.log('[JE] asset downloader patched (b64://)');
  };
})();
