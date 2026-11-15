// node tests/editor-backend.test.js  -- runs the REAL handlers against a strict in-memory Firestore fake
// (rejects undefined values, nested arrays and reads-after-writes in transactions, like the real thing).
const fs=require('fs'),assert=require('assert');
function Blob_(u){this.u=u;} Blob_.fromUint8Array=u=>new Blob_(Uint8Array.from(u)); Blob_.prototype.toUint8Array=function(){return this.u;};   // legacy Firestore Blob
function strict(v,p='doc'){ if(v===undefined) throw new Error('Firestore: undefined at '+p);
  if(typeof v==='string'&&v.length>1000000) throw new Error('Firestore: string over 1 MiB at '+p);
  if(Array.isArray(v)) v.forEach((x,i)=>{ if(Array.isArray(x)) throw new Error('Firestore: nested array at '+p); strict(x,p+'['+i+']'); });
  else if(v&&typeof v==='object'&&!(v instanceof Blob_)) for(const k in v) strict(v[k],p+'.'+k); }
const S=new Map(); let n=0; const clone=d=>d instanceof Blob_?d:Array.isArray(d)?d.map(clone):d&&typeof d==='object'?Object.fromEntries(Object.entries(d).map(([k,v])=>[k,clone(v)])):d;   // keeps legacy Blob instances intact
const kids=path=>[...S.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1);
const D=path=>({path,id:path.split('/').pop(),get:async()=>{const d=S.get(path);return{exists:d!==undefined,id:path.split('/').pop(),ref:D(path),data:()=>clone(d)};},
  set:async(v,o)=>{strict(v);S.set(path,o&&o.merge?Object.assign({},S.get(path),v):v);},delete:async()=>{S.delete(path);},collection:c=>C(path+'/'+c)});
const C=path=>({doc:id=>D(path+'/'+(id||'a'+(++n).toString(36)+Math.random().toString(36).slice(2,6))),
  orderBy:(f,dir)=>({limit:m=>({get:async()=>({docs:kids(path).map(k=>({id:k.split('/').pop(),ref:D(k),data:()=>clone(S.get(k))})).sort((a,b)=>dir==='desc'?b.data()[f]-a.data()[f]:a.data()[f]-b.data()[f]).slice(0,m)})})}),
  where:(f,_,v)=>({get:async()=>({docs:kids(path).filter(k=>S.get(k)[f]===v).map(k=>({id:k.split('/').pop(),ref:D(k),data:()=>clone(S.get(k))}))})})});
const db={collection:C,batch:()=>{const ops=[];return{delete:r=>ops.push(r),commit:async()=>{for(const r of ops) await r.delete();}};},
  runTransaction:async fn=>{const w=[];let wrote=false;const tx={get:async r=>{if(wrote) throw new Error('read after write in tx');return r.get();},
    set:(r,v)=>{strict(v);wrote=true;w.push(()=>r.set(v));},delete:r=>{wrote=true;w.push(()=>r.delete());}};const res=await fn(tx);for(const f of w) await f();return res;}};
global.window=global; global.firebase={firestore:{Blob:Blob_}};
for(const f of ['backend/backend.js']) (0,eval)(fs.readFileSync(f,'utf8')); JEBackend.db=db; JEBackend.auth={currentUser:{uid:'u1'}};
for(const f of ['backend/game-config.js','backend/firebase-game.js','backend/firebase-blobs.js','backend/firebase-editor.js','backend/firebase-publish.js','shims/orange-transport.js']) (0,eval)(fs.readFileSync(f,'utf8'));
JEBackend.store={getOrCreateRole:async()=>({roleId:7,account:'tester'})};
const call=async(c,p)=>{const r=await JEBackend.dispatch(c,p,'t'); assert.strictEqual(r.code,0,c+' -> '+r.error); return r.decBody;};
const bad=async(c,p)=>(await JEBackend.dispatch(c,p,'t')).code;
(async()=>{
  // ---------- games / worlds ----------
  const g={id:'',name:'My Games1',worldIds:[],projectLayout:{worldCellPos:{},grid:[[1,2],[3,4]]},thing:undefined,status:0};   // undefined + nested arrays, like real game data
  const {id:gid}=await call('Game_SaveRoleGameData',{id:null,creativeSourceUId:null,data:g}); assert(gid);
  let lg=await call('Game_Login',{}); assert.deepStrictEqual(lg.role.games,[gid]); assert.strictEqual(lg.role.userName,'tester'); assert.strictEqual(lg.role.newUserImgReviewStatus,1);
  const lay=Uint8Array.from([4,34,77,24,9,8,7]); const w=await call('Game_SaveWorldData',{id:null,gameId:gid,info:{name:'W',a:[[1],[2]]},layoutMin:lay});
  assert.strictEqual(typeof S.get('users/u1/worlds/'+w.id).layout,'string','layout is stored as base64 text');
  let gd=(await call('Game_GetRoleGameData',{ids:[gid,'nope']})).datas; assert.deepStrictEqual(gd[0].worldIds,[w.id]); assert.strictEqual(gd[1],null);
  let wd=(await call('Game_GetWorldData',{ids:[w.id],needData:true})).datas[0]; assert.deepStrictEqual([...wd.layoutMin],[...lay]); assert.deepStrictEqual(wd.info.a,[[1],[2]]);
  await call('Game_SaveWorldData',{id:w.id,gameId:null,info:{name:'W2'},layoutMin:null});       // info-only save must keep the layout
  wd=(await call('Game_GetWorldData',{ids:[w.id],needData:true})).datas[0]; assert.strictEqual(wd.info.name,'W2'); assert.deepStrictEqual([...wd.layoutMin],[...lay]);
  S.set('users/u1/worlds/old',Object.assign({},S.get('users/u1/worlds/'+w.id),{layout:Blob_.fromUint8Array(lay)}));                // pre-base64 docs still load
  assert.deepStrictEqual([...(await call('Game_GetWorldData',{ids:['old'],needData:true})).datas[0].layoutMin],[...lay]);
  assert.notStrictEqual(await bad('Game_SaveWorldData',{id:null,gameId:gid,info:{},layoutMin:new Uint8Array(700000)}),0,'oversized world is refused, not silently truncated');
  await call('Game_SaveRoleGameData',{id:gid,creativeSourceUId:null,data:Object.assign({},g,{name:'Renamed',worldIds:[w.id]})});
  gd=(await call('Game_GetRoleGameData',{ids:[gid]})).datas; assert.strictEqual(gd[0].data.name,'Renamed');
  // ---------- confs / variables / colors / groups ----------
  const t=await call('Game_SaveRoleTileConf',{id:null,data:{name:'t',textureName:'pixel/AAAA.png',arr:[[0]]}}); await call('Game_SaveRoleActorConf',{id:null,data:{name:'a'}});
  lg=await call('Game_Login',{}); assert.deepStrictEqual(lg.roleGameConf.tileConfIds,[t.id]); assert.strictEqual(lg.roleGameConf.actorConfIds.length,1);
  const tc=(await call('Game_GetRoleTileConf',{ids:[t.id,'gone']})).datas; assert.strictEqual(tc.length,1); assert.strictEqual(tc[0].conf.textureName,'pixel/AAAA.png');
  await call('Game_SaveRoleTileConf',{id:t.id,data:{name:'t2'}}); assert.strictEqual((await call('Game_GetRoleTileConf',{ids:[t.id]})).datas[0].conf.name,'t2');
  const v=await call('Game_SaveVariable',{gameId:gid,id:null,data:{name:'score',n:0}});
  const all=await call('Game_SaveAllVariable',{variableDatas:[{gameId:gid,id:v.id,data:{name:'score',n:5}},{gameId:gid,id:null,data:{name:'hp'}}]}); assert.strictEqual(all.retVariableDatas.length,2);
  gd=(await call('Game_GetRoleGameData',{ids:[gid]})).datas[0]; assert.strictEqual(gd.variableIds.length,2); assert.strictEqual(gd.variableDatas[0].n,5);
  const c1=await call('Game_SaveCustomColors',{colorDatas:[{data:'ff0000'}]}); await call('Game_SaveActorGroups',{groupName:'g',refDataList:[{x:1}]});
  lg=await call('Game_Login',{}); assert.strictEqual(lg.role.customColors.length,1); assert.strictEqual(lg.customActorGroups[0].groupName,'g');
  await call('Game_DelCustomColors',{ids:[c1.colorDatas[0].id]}); assert.strictEqual((await call('Game_Login',{})).role.customColors.length,0);
  // ---------- user-made images: BASE64, no review ----------
  assert.strictEqual(JEBlobs.encode(new TextEncoder().encode('Hi!')),'SGkh'); assert.deepStrictEqual([...JEBlobs.decode(JEBlobs.encode(Uint8Array.from([0,255,1,254,128])))],[0,255,1,254,128]);
  const png=Uint8Array.from({length:3000},(_,i)=>(i*7+3)%256); const up=await call('Game_UploadImage',{imageFileType:1,content:png,imgThumbs:[],checkImgSec:true});
  assert(up.isOK&&up.reason===''&&up.sensitiveImageResult===null,'never flagged for review'); assert(up.url.indexOf('pixel/')>=0,'Util.isCdnPng() needs "pixel/"'); assert(up.url.endsWith('.png'));
  assert(!/[+\/=]/.test(up.url.slice(6,-4)),'url-safe base64'); const dd=JEAssets.decode(up.url); assert.strictEqual(dd.ext,'png'); assert.deepStrictEqual([...dd.bytes],[...png],'round-trips byte-for-byte');
  const huge=await call('Game_UploadImage',{content:Uint8Array.from({length:310000},(_,i)=>i%256)}); assert.strictEqual(huge.isOK,false); assert(/too large/.test(huge.reason));
  assert.strictEqual((await call('Game_UploadImage',{content:null})).isOK,false);
  assert.strictEqual((await call('Game_GetNeedReviewImageList',{imageList:[up.url]})).needImageList.length,0,'no image ever needs review');
  assert.strictEqual((await call('Game_UpdateUserInfo',{userName:'Bob',userImg:null,userIntro:'hi'})).code,0);
  // ---------- engine hook ----------
  const calls=[]; global.URL={createObjectURL:b=>'blob:test/'+b.size};
  global.cc={assetManager:{downloader:{download:function(id,url,type,o,done){calls.push([url,type]);done(null,url);}}}}; JE.patchAssets();
  const dl=(u,ty)=>new Promise((res,rej)=>cc.assetManager.downloader.download('k'+Math.random(),u,ty,{},(e,r)=>e?rej(e):res(r)));
  assert.strictEqual(await dl('b64://'+up.url,'.png'),'blob:test/3000','decoded bytes become a blob: URL'); assert.strictEqual(calls[0][1],'.png');
  assert.strictEqual((await dl('b64://'+up.url,'')),'blob:test/3000'); assert.strictEqual(calls[1][1],'.png','missing type is inferred from the extension');
  await dl('b64://'+up.url,'.bin'); assert.strictEqual(calls[2][1],'.bin','explicit type (downLoadBin) wins');
  assert.strictEqual(await dl('b64://bogus/x','.png').then(()=>false,()=>true),true,'unknown address is an error, not a crash');
  assert.strictEqual(await dl('https://x/y.png','.png'),'https://x/y.png','other URLs pass through untouched');
  // ---------- push shape ----------
  { const got=[], fakeO={HttpDelegate:{prototype:{}},WebSocketDelegate:{prototype:{},EVENT_MSG:'e_msg'}}; global.orange=fakeO; JE.patchOrange();
    const ws=Object.create(fakeO.WebSocketDelegate.prototype); ws.events={emit:(k,v)=>got.push([k,v])}; await ws.connect({token:'t'});
    assert.strictEqual(JE.push('Game_RRoleNewUserImgNotify',{status:1,userImg:'x'}),true); assert.strictEqual(got[0][0],'Game_RRoleNewUserImgNotify'); assert.strictEqual(got[0][1].decBody.status,1,'client handlers read e.decBody');
    ws.close(); assert.strictEqual(JE.push('X',{}),false,'no push when disconnected'); }
  // ---------- publish (exact sequence PublishMng runs) ----------
  const g2=(await call('Game_SaveRoleGameData',{id:null,creativeSourceUId:null,data:{id:'',name:'Pub',status:0,worldIds:[]}})).id;
  JE_GAME_CONFIG.sensitiveWords=['badword'];
  assert.deepStrictEqual((await call('Game_SensitiveMsg',{msg:'fine哈BadWord here'})).sensitiveWords,['badword']); assert.deepStrictEqual((await call('Game_SensitiveMsg',{msg:'Pub哈hello'})).sensitiveWords,[]); JE_GAME_CONFIG.sensitiveWords=[];
  const rel=await call('Game_UploadReleaseGame',{dataVersion:'0.0.1',content:Uint8Array.from({length:2000},(_,i)=>i%256)}); assert(rel.cdnUrl.startsWith('pack/')&&rel.cdnUrl.endsWith('.bin'));
  assert.strictEqual(typeof S.get('blobs/'+rel.cdnUrl.slice(5)).b64,'string','packs are base64 text'); assert.strictEqual((await JEBlobs.get(rel.cdnUrl.slice(5))).bytes.length,2000);
  const big=Uint8Array.from({length:2500000},(_,i)=>i%251); const bigRel=await call('Game_UploadReleaseGame',{dataVersion:'1',content:big}); const bid=bigRel.cdnUrl.slice(5);
  const back=(await JEBlobs.get(bid)).bytes; assert.strictEqual(back.length,big.length); assert(back.every((v,i)=>v===big[i]),'chunked pack round-trips byte-for-byte');
  assert.strictEqual(S.get('blobs/'+bid).n,4); for(let i=0;i<4;i++) assert(S.get('blobs/'+bid+'/c/'+i).b64.length<1000000,'chunk fits one document');
  assert(/^blob:test\//.test(await dl('b64://'+bigRel.cdnUrl,'.bin')),'pack addresses resolve through the hook');
  assert.strictEqual(await bad('Game_UploadReleaseGame',{content:new Uint8Array(9*1024*1024)}),30003);
  const pub=await call('Game_PublishGame',{id:g2,name:'Pub',advert:'hi',dataVersion:'0.0.1',iconTextureName:up.url,gameDataCdnUrl:rel.cdnUrl,gameTags:['ZongBang'],openCreativeGame:true,openData:{openWorldIds:['w'],creativeResList:[{name:'a',list:[[1]]}]},reviewStr:'',reviewImageMap:new Map()});
  assert.strictEqual(pub.id,g2); let pg=(await call('Game_GetRoleGameData',{ids:[g2]})).datas[0]; assert.strictEqual(pg.status,1); assert(pg.firstPublishTime>0);
  await call('Game_SaveRoleGameData',{id:g2,creativeSourceUId:null,data:{id:g2,name:'Pub',status:2,worldIds:[]}});   // client saves with local status=inReview
  assert.strictEqual((await call('Game_GetRoleGameData',{ids:[g2]})).datas[0].status,1,'status stays server-owned');
  const nl=await call('Game_GetNewGameList',{start:0,end:20,startMember:''}); assert.strictEqual(nl.gameDatas.length,1); assert.strictEqual(nl.gameDatas[0].iconTextureName,up.url,'game icon is the base64 image, visible with no review');
  const det=await call('Game_GetGameDetail',{id:g2}); assert.strictEqual(det.creativeGameData.packUrl,rel.cdnUrl); assert.strictEqual(det.authorMsg.userName,'Bob'); assert.strictEqual(det.releaseGameData.openData.openWorldIds[0],'w');
  assert.strictEqual(await bad('Game_GetGameDetail',{id:'nope'}),30004);
  // ---------- avatar: auto-approved + pushed, listings refresh ----------
  const pushed=[]; JE.push=(c,b)=>{pushed.push([c,b]);return true;};
  await call('Game_UpdateUserImg',{newUserImg:up.url}); await new Promise(r=>setTimeout(r,15));
  assert.deepStrictEqual(pushed[0],['Game_RRoleNewUserImgNotify',{status:1,userImg:up.url}],'status 1 = ManReviewStatus.success'); assert.strictEqual(S.get('users/u1').userImg,up.url,'avatar saved on the user document');
  assert.strictEqual((await call('Game_GetGameDetail',{id:g2})).authorMsg.userImg,up.url,'published listings show the new avatar');
  assert.strictEqual(await bad('Game_UpdateUserImg',{newUserImg:'pixel/'+'A'.repeat(401000)}),20012);
  // ---------- take down / republish / cascade ----------
  await call('Game_OwnOffGame',{id:g2}); assert.strictEqual((await call('Game_GetNewGameList',{start:0,end:20})).gameDatas.length,0); assert.strictEqual((await call('Game_GetRoleGameData',{ids:[g2]})).datas[0].status,4);
  await call('Game_PublishGame',{id:g2,name:'Pub',gameDataCdnUrl:rel.cdnUrl}); assert.strictEqual((await call('Game_GetNewGameList',{start:0,end:20})).gameDatas.length,1);
  assert((await call('Game_GetRoleCreativeConf',{gameId:gid})).confMap instanceof Map);
  await call('Game_DelWorldData',{ids:[w.id]}); assert.deepStrictEqual((await call('Game_GetRoleGameData',{ids:[gid]})).datas[0].worldIds,[]);
  await call('Game_DelRoleGameData',{ids:[gid]}); assert.deepStrictEqual((await call('Game_Login',{})).role.games,[g2]);
  console.log('ALL EDITOR BACKEND TESTS PASSED');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
