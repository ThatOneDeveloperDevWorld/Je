// Binary files (images, published game packs) stored in FIRESTORE, so Firebase Storage (paid plan) isn't needed.
//   blobs/{id}        meta {uid,size,n,type,createdAt}  + d (Firestore Blob) when size <= CHUNK
//   blobs/{id}/c/{i}  chunks of CHUNK bytes when larger (meta first, then chunks)
// "URLs" are  gameEnv.fileCDN ("jefs://") + id  e.g. jefs://Ab3xYz.png ; id keeps its extension so the engine picks the right loader.
// JE.patchAssets() hooks the engine downloader so jefs:// addresses are fetched from Firestore and handed over as blob: URLs.
(function(){
  var CHUNK=900000, MAX=8*1024*1024, PREFIX='jefs://', urls=new Map();
  function db(){ return window.JEBackend.db; }
  function u8(x){ return x instanceof Uint8Array?x:new Uint8Array(x); }
  window.JEBlobs={
    MAX:MAX, PREFIX:PREFIX,
    put:async function(data,type,ext){
      var b=u8(data); if(b.length>MAX) throw new Error('file too large ('+b.length+' bytes, max '+MAX+')');
      var user=window.JEBackend.auth.currentUser; if(!user) throw new Error('not signed in');
      var ref=db().collection('blobs').doc(), id=ref.id+'.'+ext, n=Math.max(1,Math.ceil(b.length/CHUNK));
      var meta={uid:user.uid,size:b.length,n:n,type:type,createdAt:Date.now()}, doc=db().collection('blobs').doc(id);
      if(n===1) meta.d=firebase.firestore.Blob.fromUint8Array(b);
      await doc.set(meta);
      for(var i=0;n>1&&i<n;i++) await doc.collection('c').doc(String(i)).set({d:firebase.firestore.Blob.fromUint8Array(b.slice(i*CHUNK,(i+1)*CHUNK))});
      return id;
    },
    get:async function(id){
      var doc=db().collection('blobs').doc(id), s=await doc.get(); if(!s.exists) throw new Error('missing file '+id);
      var m=s.data(); if(m.d) return {bytes:m.d.toUint8Array(),type:m.type};
      var parts=await Promise.all(Array.from({length:m.n},function(_,i){ return doc.collection('c').doc(String(i)).get(); })), out=new Uint8Array(m.size), o=0;
      parts.forEach(function(p){ var c=p.data().d.toUint8Array(); out.set(c,o); o+=c.length; });
      return {bytes:out,type:m.type};
    },
    objectUrl:function(id){      // memoised per session: one Firestore read per file
      if(!urls.has(id)) urls.set(id,window.JEBlobs.get(id).then(function(r){ return URL.createObjectURL(new Blob([r.bytes],{type:r.type})); }).catch(function(e){ urls.delete(id); throw e; }));
      return urls.get(id);
    }
  };
  window.JE=window.JE||{};
  JE.patchAssets=function(){
    var d=cc.assetManager.downloader, orig=d.download;
    d.download=function(id,url,type,options,onComplete){
      if(typeof url==='string'&&url.indexOf(PREFIX)===0){
        window.JEBlobs.objectUrl(url.slice(PREFIX.length)).then(function(u){ orig.call(d,id,u,type,options,onComplete); },function(e){ console.error('[JE] blob load failed',url,e); onComplete(e); });
        return;
      }
      return orig.apply(d,arguments);
    };
    console.log('[JE] asset downloader patched (jefs://)');
  };
})();
