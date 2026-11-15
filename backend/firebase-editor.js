// Editor persistence on Firestore (binary files via firebase-blobs.js). Replaces the dead server's Game_Save/Get/Del* commands.
// Layout (all under users/{uid}/, owner-only by rules):
//   meta/index        id lists the game expects inside Game_Login (games, tile, actor, ...) + colors + actor groups
//   games/{id}        game data as JSON string (j) + server-owned lists (worldIds, gameShopIds, gameRankIds)
//   worlds/{id}       info JSON (infoJ) + layout as base64 TEXT (layout) + gameId
//   vars/{id}         game variables (gameId, j)
//   conf_<type>/{id}  tile | actor | device | prop | weapon | bullet confs as JSON (j)
//   creative/{key}    per-game template confs
// Data goes in as JSON STRINGS on purpose: Firestore rejects undefined values and nested arrays, which game data has.
(function(){
  var B=window.JEBackend, MAX=900000;
  var TYPES=['tile','actor','device','prop','weapon','bullet'];
  var db=function(){return B.db;};
  function uid(){ var u=B.auth&&B.auth.currentUser; if(!u) throw new Error('not signed in'); return u.uid; }
  function col(n){ return db().collection('users').doc(uid()).collection(n); }
  function idx(){ return col('meta').doc('index'); }
  function newId(c){ return col(c).doc().id; }
  function enc(o){ var s=JSON.stringify(o); if(s===undefined) s='null';
    if(s.length>MAX) throw new Error('data too large for Firestore ('+s.length+' bytes)'); return s; }
  function dec(s){ return s?JSON.parse(s):null; }
  function list(d,k){ return Array.isArray(d[k])?d[k].slice():[]; }
  function u8(x){ return x instanceof Uint8Array?x:new Uint8Array(x); }
  function blob(x){ var t=JEBlobs.encode(u8(x)); if(t.length>MAX) throw new Error('world too large for Firestore ('+t.length+' base64 chars)'); return t; }
  function without(a,ids){ return a.filter(function(x){return ids.indexOf(x)<0;}); }
  async function mutateIndex(fn){ var ref=idx();
    return db().runTransaction(async function(tx){ var s=await tx.get(ref), d=s.exists?s.data():{};
      var ch=fn(d); tx.set(ref,Object.assign({},d,ch)); return ch; }); }
  async function deleteDocs(refs){ for(var i=0;i<refs.length;i+=400){ var b=db().batch();
    refs.slice(i,i+400).forEach(function(r){b.delete(r);}); await b.commit(); } }

  // id lists for Game_Login (role.games, roleGameConf.*, role.customColors, customActorGroups)
  B.loadEditorIndex=async function(){ var s=await idx().get(), d=s.exists?s.data():{};
    var r={games:list(d,'games'),colors:dec(d.colors)||[],groups:dec(d.groups)||[],conf:{}};
    TYPES.forEach(function(t){ r.conf[t]=list(d,t); }); return r; };

  // ---------------- games ----------------
  B.register('game_saverolegamedata', async function(p){
    var data=p.data||{}, id=p.id, creating=!id; if(creating) id=newId('games');
    var gref=col('games').doc(id), iref=idx(), now=Date.now();
    await db().runTransaction(async function(tx){
      var gs=await tx.get(gref), is=creating?await tx.get(iref):null;
      if(!creating&&!gs.exists) throw new Error('game not found '+id);
      var cur=gs.exists?gs.data():{};
      var doc=Object.assign({},cur,{j:enc(data),status:cur.status||0,updatedAt:now});
      if(!gs.exists){ doc.createdAt=now; doc.worldIds=[]; doc.gameShopIds=[]; doc.gameRankIds=[];
        if(p.creativeSourceUId) doc.creativeSourceUId=String(p.creativeSourceUId); }
      else ['worldIds','gameShopIds','gameRankIds'].forEach(function(k){ if(Array.isArray(data[k])) doc[k]=data[k].slice(); });
      tx.set(gref,doc);
      if(creating){ var d=is.exists?is.data():{}, g=list(d,'games'); g.unshift(id); tx.set(iref,Object.assign({},d,{games:g})); }
    });
    return {id:id};
  });
  B.register('game_getrolegamedata', async function(p){
    var datas=await Promise.all((p.ids||[]).map(async function(id){      // positions must match ids (null = missing)
      var s=await col('games').doc(id).get(); if(!s.exists) return null;
      var d=s.data(), vs=(await col('vars').where('gameId','==',id).get()).docs.map(function(x){
        var v=dec(x.data().j)||{}; v.id=x.id; return {v:v,at:x.data().at||0}; }).sort(function(a,b){return a.at-b.at;}).map(function(x){return x.v;});
      return {id:id,data:dec(d.j)||{},lastPublishTime:d.lastPublishTime||0,firstPublishTime:d.firstPublishTime||0,
        thumbCnt:0,collectionCnt:0,hurryCnt:0,playCnt:0,worldIds:list(d,'worldIds'),gameShopIds:list(d,'gameShopIds'),
        gameRankIds:list(d,'gameRankIds'),isOff:!!d.isOff,thawTime:0,status:d.status||0,offReason:[],
        variableIds:vs.map(function(v){return v.id;}),variableDatas:vs,isOldTangData:false};
    }));
    return {datas:datas};
  });
  B.register('game_delrolegamedata', async function(p){ var ids=p.ids||[], refs=[];
    for(var i=0;i<ids.length;i++){ var id=ids[i];
      (await col('worlds').where('gameId','==',id).get()).docs.forEach(function(x){refs.push(x.ref);});
      (await col('vars').where('gameId','==',id).get()).docs.forEach(function(x){refs.push(x.ref);});
      refs.push(col('games').doc(id)); }
    await deleteDocs(refs); await mutateIndex(function(d){ return {games:without(list(d,'games'),ids)}; });
    return {ids:ids}; });

  // ---------------- worlds ----------------
  B.register('game_saveworlddata', async function(p){
    var id=p.id, creating=!id; if(creating) id=newId('worlds');
    var wref=col('worlds').doc(id), gid=p.gameId||null, gref=gid?col('games').doc(gid):null, lay=p.layoutMin?blob(p.layoutMin):null;
    var infoJ=(p.info!=null)?enc(p.info):null;
    await db().runTransaction(async function(tx){
      var ws=await tx.get(wref), gs=gref?await tx.get(gref):null;
      if(!creating&&!ws.exists) throw new Error('world not found '+id);
      var doc=Object.assign({},ws.exists?ws.data():{},{updatedAt:Date.now()});
      if(infoJ!==null) doc.infoJ=infoJ; if(lay) doc.layout=lay;
      if(creating){ doc.createdAt=Date.now(); if(gid) doc.gameId=gid; }
      tx.set(wref,doc);
      if(creating&&gs){ if(!gs.exists) throw new Error('game not found '+gid);
        var g=gs.data(), w=list(g,'worldIds'); if(w.indexOf(id)<0) w.push(id); tx.set(gref,Object.assign({},g,{worldIds:w})); }
    });
    return {gameId:gid,id:id};
  });
  B.register('game_getworlddata', async function(p){ var need=!!p.needData;
    var datas=await Promise.all((p.ids||[]).map(async function(id){
      var s=await col('worlds').doc(id).get(); if(!s.exists) return null; var d=s.data(), o={id:id,info:dec(d.infoJ)};
      if(need&&d.layout) o.layoutMin=typeof d.layout==='string'?JEBlobs.decode(d.layout):d.layout.toUint8Array(); return o; }));   // old docs: Firestore Blob
    return {datas:datas}; });
  B.register('game_delworlddata', async function(p){ var ids=p.ids||[];
    for(var i=0;i<ids.length;i++){ var id=ids[i], wref=col('worlds').doc(id);
      await db().runTransaction(async function(tx){ var ws=await tx.get(wref); if(!ws.exists) return;
        var gid=ws.data().gameId, gref=gid?col('games').doc(gid):null, gs=gref?await tx.get(gref):null;
        tx.delete(wref);
        if(gs&&gs.exists){ var g=gs.data(); tx.set(gref,Object.assign({},g,{worldIds:without(list(g,'worldIds'),[id])})); } }); }
    return {ids:ids}; });

  // ---------------- tile/actor/device/prop/weapon/bullet confs ----------------
  TYPES.forEach(function(t){ var cn='conf_'+t;
    B.register('game_saverole'+t+'conf', async function(p){ var id=p.id||newId(cn), ref=col(cn).doc(id), iref=idx(), j=enc(p.data);
      await db().runTransaction(async function(tx){ var s=await tx.get(ref), is=await tx.get(iref), d=is.exists?is.data():{}, l=list(d,t);
        tx.set(ref,Object.assign({},s.exists?s.data():{},{j:j,updatedAt:Date.now()}));
        if(l.indexOf(id)<0){ l.unshift(id); var ch={}; ch[t]=l; tx.set(iref,Object.assign({},d,ch)); } });
      return {id:id}; });
    B.register('game_getrole'+t+'conf', async function(p){ var out=[];
      await Promise.all((p.ids||[]).map(async function(id){ var s=await col(cn).doc(id).get();
        if(s.exists) out.push({id:id,conf:dec(s.data().j),goodsUId:s.data().goodsUId}); }));
      var order=p.ids||[]; out.sort(function(a,b){return order.indexOf(a.id)-order.indexOf(b.id);}); return {datas:out}; });
    B.register('game_delrole'+t+'conf', async function(p){ var ids=p.ids||[];
      await deleteDocs(ids.map(function(i){return col(cn).doc(i);}));
      await mutateIndex(function(d){ var ch={}; ch[t]=without(list(d,t),ids); return ch; }); return {ids:ids}; });
  });

  // ---------------- per-game template confs (creative) ----------------
  function ckey(p){ return p.gameId+'__'+p.confType+'__'+p.confId; }
  B.register('game_saverolecreativeconf', async function(p){ await col('creative').doc(ckey(p)).set({gameId:p.gameId,confType:p.confType,confId:p.confId,j:enc(p.data)});
    return {gameId:p.gameId,confId:p.confId}; });
  B.register('game_delrolecreativeconf', async function(p){ await col('creative').doc(ckey(p)).delete(); return {gameId:p.gameId,confId:p.confId}; });
  B.register('game_getrolecreativeconf', async function(p){ var m=new Map();   // confMap: Map<confType, {confId: conf}>
    (await col('creative').where('gameId','==',p.gameId).get()).docs.forEach(function(x){ var d=x.data(), o=m.get(d.confType)||{}; o[d.confId]=dec(d.j); m.set(d.confType,o); });
    return {confMap:m}; });

  // ---------------- variables ----------------
  B.register('game_savevariable', async function(p){ var id=p.id||newId('vars'), ref=col('vars').doc(id), s=await ref.get();
    await ref.set({gameId:p.gameId,j:enc(p.data),at:s.exists?(s.data().at||0):Date.now()}); return {gameId:p.gameId,id:id}; });
  B.register('game_saveallvariable', async function(p){ var out=[], items=p.variableDatas||[];
    for(var i=0;i<items.length;i++){ var v=items[i], id=v.id||newId('vars'), ref=col('vars').doc(id), s=await ref.get();
      await ref.set({gameId:v.gameId,j:enc(v.data),at:s.exists?(s.data().at||0):Date.now()+i}); out.push(Object.assign({},v,{id:id})); }
    return {retVariableDatas:out}; });
  B.register('game_delvariable', async function(p){ var ids=p.ids||[]; await deleteDocs(ids.map(function(i){return col('vars').doc(i);})); return {ids:ids}; });

  // ---------------- custom colors / actor groups (kept in meta/index) ----------------
  function withIds(a){ return (a||[]).map(function(c){ return Object.assign({},c,{id:c.id||newId('meta')}); }); }
  B.register('game_saveallcustomcolors', async function(p){ var out=withIds(p.colorDatas); await mutateIndex(function(){return {colors:enc(out)};}); return {colorDatas:out}; });
  B.register('game_savecustomcolors', async function(p){ var inc=withIds(p.colorDatas);
    await mutateIndex(function(d){ var cur=dec(d.colors)||[]; inc.forEach(function(c){ var i=cur.findIndex(function(x){return x.id==c.id;}); if(i>=0) cur[i]=c; else cur.push(c); }); return {colors:enc(cur)}; });
    return {colorDatas:inc}; });
  B.register('game_delcustomcolors', async function(p){ var ids=p.ids||[];
    await mutateIndex(function(d){ return {colors:enc((dec(d.colors)||[]).filter(function(c){return ids.indexOf(c.id)<0;}))}; }); return {}; });
  B.register('game_saveactorgroups', async function(p){
    await mutateIndex(function(d){ var cur=dec(d.groups)||[], g={groupName:p.groupName,refDataList:p.refDataList}, i=cur.findIndex(function(x){return x.groupName==p.groupName;});
      if(i>=0) cur[i]=g; else cur.unshift(g); return {groups:enc(cur)}; }); return {}; });
  B.register('game_delactorgroups', async function(p){
    await mutateIndex(function(d){ return {groups:enc((dec(d.groups)||[]).filter(function(x){return x.groupName!=p.groupName;}))}; }); return {}; });

  // ---------------- profile + image upload ----------------
  B.register('game_updateuserinfo', async function(p){ var u={};
    if(p.userName!=null){ var n=String(p.userName).trim(); if(!n||n.length>30) return {__code:20010,__error:'bad name'}; u.userName=n; }
    if(p.userIntro!=null) u.userIntro=String(p.userIntro).slice(0,200);
    if(p.userImg!=null){ u.userImg=String(p.userImg); if(u.userImg.length>JEAssets.IMG_MAX) return {__code:20012,__error:'avatar too large'}; }
    if(Object.keys(u).length) await db().collection('users').doc(uid()).set(u,{merge:true});
    return {code:0,sensitiveWords:[]}; });
  // Images are BASE64 inside the url itself ("pixel/<b64url>.png", fileCDN = "b64://"): no hosting, no review. See firebase-blobs.js.
  B.register('game_uploadimage', async function(p){
    if(!p.content) return {isOK:false,url:'',reason:'empty image',sensitiveImageResult:null};
    var url=JEAssets.encode(p.content,'png');
    if(url.length>JEAssets.IMG_MAX) return {isOK:false,url:'',reason:'image too large ('+url.length+' chars, max '+JEAssets.IMG_MAX+')',sensitiveImageResult:null};
    return {isOK:true,url:url,reason:'',sensitiveImageResult:null}; });
  // Avatar: the client marks it "in review" and waits for a server push; we approve instantly and push it.
  B.register('game_updateuserimg', async function(p){
    var img=String(p.newUserImg||''); if(img.length>JEAssets.IMG_MAX) return {__code:20012,__error:'avatar too large'};
    var u=uid(); await db().collection('users').doc(u).set({userImg:img},{merge:true});
    var mine=await db().collection('published').where('uid','==',u).get(); for(var i=0;i<mine.docs.length;i++) await mine.docs[i].ref.set({userImg:img},{merge:true});
    setTimeout(function(){ if(window.JE&&JE.push) JE.push('Game_RRoleNewUserImgNotify',{status:1,userImg:img}); },0);   // status 1 = ManReviewStatus.success
    return {}; });
})();
