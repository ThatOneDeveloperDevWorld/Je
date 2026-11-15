// node tests/editor-backend.test.js  -- runs the real handlers against a strict in-memory Firestore/Storage fake.
const fs=require('fs'),assert=require('assert');
function strict(v,p='doc'){ if(v===undefined) throw new Error('Firestore: undefined at '+p);
  if(Array.isArray(v)) v.forEach((x,i)=>{ if(Array.isArray(x)) throw new Error('Firestore: nested array at '+p); strict(x,p+'['+i+']'); });
  else if(v&&typeof v==='object'&&!(v instanceof Blob)) for(const k in v) strict(v[k],p+'.'+k); }
function Blob(u){this.u=u;} Blob.fromUint8Array=u=>new Blob(Uint8Array.from(u)); Blob.prototype.toUint8Array=function(){return this.u;};
const S=new Map(); let n=0;
const D=path=>({path,id:path.split('/').pop(),get:async()=>{const d=S.get(path);return{exists:d!==undefined,id:path.split('/').pop(),ref:D(path),data:()=>d&&JSON.parse(JSON.stringify(d,(k,v)=>v&&v.u?{__b:[...v.u]}:v),(k,v)=>v&&v.__b?Blob.fromUint8Array(v.__b):v)};},
  set:async(v,o)=>{strict(v);S.set(path,o&&o.merge?Object.assign({},S.get(path),v):v);},delete:async()=>{S.delete(path);},
  collection:c=>C(path+'/'+c)});
const C=path=>({orderBy:(f,dir)=>({limit:n=>({get:async()=>({docs:[...S.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1).map(k=>({id:k.split('/').pop(),ref:D(k),data:()=>S.get(k)})).sort((a,b)=>dir==='desc'?b.data()[f]-a.data()[f]:a.data()[f]-b.data()[f]).slice(0,n)})})}),doc:id=>D(path+'/'+(id||'a'+(++n).toString(36)+Math.random().toString(36).slice(2,6))),
  where:(f,_,v)=>({get:async()=>({docs:[...S.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1&&S.get(k)[f]===v).map(k=>({id:k.split('/').pop(),ref:D(k),data:()=>S.get(k)}))})})});
const db={collection:C,batch:()=>{const ops=[];return{delete:r=>ops.push(r),commit:async()=>{for(const r of ops) await r.delete();}};},
  runTransaction:async fn=>{const w=[];let wrote=false;const tx={get:async r=>{if(wrote) throw new Error('read after write in tx');return r.get();},
    set:(r,v)=>{strict(v);wrote=true;w.push(()=>r.set(v));},delete:r=>{wrote=true;w.push(()=>r.delete());}};const res=await fn(tx);for(const f of w) await f();return res;}};
global.window=global; global.firebase={firestore:{Blob}};
(0,eval)(fs.readFileSync('backend/backend.js','utf8')); JEBackend.db=db; JEBackend.auth={currentUser:{uid:'u1'}};
(0,eval)(fs.readFileSync('backend/game-config.js','utf8')); (0,eval)(fs.readFileSync('backend/firebase-game.js','utf8')); (0,eval)(fs.readFileSync('backend/firebase-blobs.js','utf8')); (0,eval)(fs.readFileSync('backend/firebase-editor.js','utf8')); (0,eval)(fs.readFileSync('backend/firebase-publish.js','utf8'));
JEBackend.store={getOrCreateRole:async()=>({roleId:7,account:'tester'})};
const call=async(c,p)=>{const r=await JEBackend.dispatch(c,p,'t'); assert.strictEqual(r.code,0,c+' -> '+r.error); return r.decBody;};
(async()=>{
  // game create with the nasty shapes real game data has (undefined + nested arrays)
  const g={id:'',name:'My Games1',worldIds:[],projectLayout:{worldCellPos:{},grid:[[1,2],[3,4]]},thing:undefined,status:0};
  const {id:gid}=await call('Game_SaveRoleGameData',{id:null,creativeSourceUId:null,data:g}); assert(gid);
  let lg=await call('Game_Login',{}); assert.deepStrictEqual(lg.role.games,[gid]); assert.strictEqual(lg.role.userName,'tester');
  // world create + layout bytes round trip, game.worldIds maintained server-side
  const lay=Uint8Array.from([4,34,77,24,9,8,7]); const w=await call('Game_SaveWorldData',{id:null,gameId:gid,info:{name:'W',a:[[1],[2]]},layoutMin:lay});
  let gd=(await call('Game_GetRoleGameData',{ids:[gid,'nope']})).datas; assert.deepStrictEqual(gd[0].worldIds,[w.id]); assert.strictEqual(gd[1],null);
  let wd=(await call('Game_GetWorldData',{ids:[w.id],needData:true})).datas[0]; assert.deepStrictEqual([...wd.layoutMin],[...lay]); assert.deepStrictEqual(wd.info.a,[[1],[2]]);
  await call('Game_SaveWorldData',{id:w.id,gameId:null,info:{name:'W2'},layoutMin:null});       // info-only save must keep layout
  wd=(await call('Game_GetWorldData',{ids:[w.id],needData:true})).datas[0]; assert.strictEqual(wd.info.name,'W2'); assert.deepStrictEqual([...wd.layoutMin],[...lay]);
  // game save keeps server lists, rename
  await call('Game_SaveRoleGameData',{id:gid,creativeSourceUId:null,data:Object.assign({},g,{name:'Renamed',worldIds:[w.id]})});
  gd=(await call('Game_GetRoleGameData',{ids:[gid]})).datas; assert.strictEqual(gd[0].data.name,'Renamed');
  // confs
  const t=await call('Game_SaveRoleTileConf',{id:null,data:{name:'t',textureName:'users%2Fu1%2Fimg%2Fx.png?alt=media',arr:[[0]]}});
  await call('Game_SaveRoleActorConf',{id:null,data:{name:'a'}});
  lg=await call('Game_Login',{}); assert.deepStrictEqual(lg.roleGameConf.tileConfIds,[t.id]); assert.strictEqual(lg.roleGameConf.actorConfIds.length,1);
  const tc=(await call('Game_GetRoleTileConf',{ids:[t.id,'gone']})).datas; assert.strictEqual(tc.length,1); assert.strictEqual(tc[0].conf.name,'t');
  await call('Game_SaveRoleTileConf',{id:t.id,data:{name:'t2'}}); assert.strictEqual((await call('Game_GetRoleTileConf',{ids:[t.id]})).datas[0].conf.name,'t2');
  // variables
  const v=await call('Game_SaveVariable',{gameId:gid,id:null,data:{name:'score',n:0}});
  const all=await call('Game_SaveAllVariable',{variableDatas:[{gameId:gid,id:v.id,data:{name:'score',n:5}},{gameId:gid,id:null,data:{name:'hp'}}]}); assert.strictEqual(all.retVariableDatas.length,2);
  gd=(await call('Game_GetRoleGameData',{ids:[gid]})).datas[0]; assert.strictEqual(gd.variableIds.length,2); assert.strictEqual(gd.variableDatas[0].n,5);
  // colors + groups
  const c1=await call('Game_SaveCustomColors',{colorDatas:[{data:'ff0000'}]}); await call('Game_SaveActorGroups',{groupName:'g',refDataList:[{x:1}]});
  lg=await call('Game_Login',{}); assert.strictEqual(lg.role.customColors.length,1); assert.strictEqual(lg.customActorGroups[0].groupName,'g');
  await call('Game_DelCustomColors',{ids:[c1.colorDatas[0].id]}); assert.strictEqual((await call('Game_Login',{})).role.customColors.length,0);
  // image + profile
  const up=await call('Game_UploadImage',{imageFileType:1,content:new Uint8Array(100),imgThumbs:[]}); assert(up.isOK&&up.url.endsWith('.png')&&up.reason===''); const gb=await JEBlobs.get(up.url); assert.strictEqual(gb.bytes.length,100); assert.strictEqual(gb.type,'image/png');
  assert.strictEqual((await call('Game_UpdateUserInfo',{userName:'Bob',userImg:null,userIntro:'hi'})).code,0);
  // creative map is a real Map; deletes cascade
  assert((await call('Game_GetRoleCreativeConf',{gameId:gid})).confMap instanceof Map);
  await call('Game_DelWorldData',{ids:[w.id]}); assert.deepStrictEqual((await call('Game_GetRoleGameData',{ids:[gid]})).datas[0].worldIds,[]);
  await call('Game_DelRoleGameData',{ids:[gid]}); assert.deepStrictEqual((await call('Game_Login',{})).role.games,[]);
  // ---- engine hook: jefs:// is fetched from Firestore, other URLs pass through untouched
  const calls=[]; global.URL={createObjectURL:b=>'blob:test/'+b.size}; global.Blob=global.Blob||function(p){this.size=p[0].length;};
  global.cc={assetManager:{downloader:{download:function(id,url,type,o,done){calls.push(url);done(null,url);}}}}; JE.patchAssets();
  const got=await new Promise((res,rej)=>cc.assetManager.downloader.download('k','jefs://'+up.url,'.png',{},(e,r)=>e?rej(e):res(r))); assert(/^blob:test\//.test(got));
  await new Promise(res=>cc.assetManager.downloader.download('k2','https://x/y.png','.png',{},res)); assert.strictEqual(calls[1],'https://x/y.png');
  // ---- publish flow (the exact sequence PublishMng runs) ----
  const g2=(await call('Game_SaveRoleGameData',{id:null,creativeSourceUId:null,data:{id:'',name:'Pub',status:0,worldIds:[]}})).id;
  JE_GAME_CONFIG.sensitiveWords=['badword'];
  assert.deepStrictEqual((await call('Game_SensitiveMsg',{msg:'fine哈BadWord here'})).sensitiveWords,['badword']);
  assert.deepStrictEqual((await call('Game_SensitiveMsg',{msg:'Pub哈hello'})).sensitiveWords,[]); JE_GAME_CONFIG.sensitiveWords=[];
  const rel=await call('Game_UploadReleaseGame',{dataVersion:'0.0.1',content:new Uint8Array(2000)}); assert(rel.cdnUrl.endsWith('.bin')); assert.strictEqual((await JEBlobs.get(rel.cdnUrl)).bytes.length,2000);
  const big=Uint8Array.from({length:2500000},(_,i)=>i%251); const bigRel=await call('Game_UploadReleaseGame',{dataVersion:'1',content:big});   // 3 chunks
  const back=(await JEBlobs.get(bigRel.cdnUrl)).bytes; assert.strictEqual(back.length,big.length); assert(back.every((v,i)=>v===big[i]),'chunked file must round-trip byte-for-byte');
  assert.deepStrictEqual((await call('Game_GetNeedReviewImageList',{imageList:['a']})).needImageList,[]);
  assert.strictEqual((await JEBackend.dispatch('Game_UploadReleaseGame',{content:new Uint8Array(9*1024*1024)},'t')).code,30003);
  assert.strictEqual((await call('Game_NOPE_x',{}).catch(e=>({}))).decBody,undefined);
  const pub=await call('Game_PublishGame',{id:g2,name:'Pub',advert:'hi',dataVersion:'0.0.1',iconTextureName:'icon1',gameDataCdnUrl:rel.cdnUrl,gameTags:['ZongBang'],openCreativeGame:true,openData:{openWorldIds:['w'],creativeResList:[{name:'a',list:[[1]]}]},reviewStr:'',reviewImageMap:new Map()});
  assert.strictEqual(pub.id,g2);
  let pg=(await call('Game_GetRoleGameData',{ids:[g2]})).datas[0]; assert.strictEqual(pg.status,1); assert(pg.firstPublishTime>0);
  await call('Game_SaveRoleGameData',{id:g2,creativeSourceUId:null,data:{id:g2,name:'Pub',status:2,worldIds:[]}});   // client saves with local status=inReview
  assert.strictEqual((await call('Game_GetRoleGameData',{ids:[g2]})).datas[0].status,1,'status must stay server-owned');
  const nl=await call('Game_GetNewGameList',{start:0,end:20,startMember:''}); assert.strictEqual(nl.gameDatas.length,1); assert.strictEqual(nl.gameDatas[0].id,g2); assert.strictEqual(nl.gameDatas[0].gameDataCdnUrl,rel.cdnUrl);
  const det=await call('Game_GetGameDetail',{id:g2}); assert.strictEqual(det.creativeGameData.packUrl,rel.cdnUrl); assert.strictEqual(det.authorMsg.userName,'Bob'); assert.strictEqual(det.releaseGameData.openData.openWorldIds[0],'w');
  assert.strictEqual((await JEBackend.dispatch('Game_GetGameDetail',{id:'nope'},'t')).code,30004);
  await call('Game_OwnOffGame',{id:g2}); assert.strictEqual((await call('Game_GetNewGameList',{start:0,end:20})).gameDatas.length,0);
  assert.strictEqual((await call('Game_GetRoleGameData',{ids:[g2]})).datas[0].status,4);
  await call('Game_PublishGame',{id:g2,name:'Pub',gameDataCdnUrl:rel.cdnUrl}); assert.strictEqual((await call('Game_GetNewGameList',{start:0,end:20})).gameDatas.length,1);  // republish
  console.log('ALL EDITOR BACKEND TESTS PASSED');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
