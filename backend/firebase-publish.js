// Publishing on Firestore (packs via firebase-blobs.js). No moderation queue: a publish goes live immediately.
// Flow the client runs (PublishMng.publish):
//   Game_SensitiveMsg -> Game_UploadReleaseGame (packed game, gzip+bon) -> Game_GetNeedReviewImageList -> Game_PublishGame
// Public listing lives in top-level published/{gameId} (readable by everyone, writable only by its owner).
// Game status values: 0 noPublish, 1 success, 2 inReview, 3 fail, 4 off.
(function(){
  var B=window.JEBackend;
  var db=function(){return B.db;};
  function uid(){ var u=B.auth&&B.auth.currentUser; if(!u) throw new Error('not signed in'); return u.uid; }
  function col(n){ return db().collection('users').doc(uid()).collection(n); }
  function u8(x){ return x instanceof Uint8Array?x:new Uint8Array(x); }
  function parse(s){ try{ return s?JSON.parse(s):{}; }catch(e){ return {}; } }

  // Optional word filter: set JE_GAME_CONFIG.sensitiveWords in backend/game-config.js. Empty by default.
  B.register('game_sensitivemsg', async function(p){
    var words=(window.JE_GAME_CONFIG&&window.JE_GAME_CONFIG.sensitiveWords)||[], parts=String(p.msg||'').toLowerCase().split('哈'), hit=[];
    words.forEach(function(w){ var lw=String(w).toLowerCase(); if(lw&&parts.some(function(s){return s.indexOf(lw)>=0;})&&hit.indexOf(w)<0) hit.push(w); });
    return {code:0,sensitiveWords:hit}; });

  B.register('game_getneedreviewimagelist', async function(){ return {needImageList:[]}; });   // no image review queue

  // cdnUrl is relative to gameEnv.fileCDN ("b64://"), full address = "b64://"+cdnUrl, resolved by firebase-blobs.js.
  B.register('game_uploadreleasegame', async function(p){
    if(!p.content) return {__code:30001,__error:'empty release pack'};
    var bin=u8(p.content); if(bin.length>JEBlobs.MAX) return {__code:30003,__error:'release pack too large ('+bin.length+' bytes, max '+JEBlobs.MAX+')'};
    return {cdnUrl:'pack/'+await JEBlobs.put(bin,'application/octet-stream','bin')}; });

  B.register('game_publishgame', async function(p){
    var id=p.id; if(!id||!p.gameDataCdnUrl) return {__code:30002,__error:'bad publish request'};
    var u=uid(), gref=col('games').doc(id), uref=db().collection('users').doc(u), pref=db().collection('published').doc(id), now=Date.now();
    await db().runTransaction(async function(tx){
      var gs=await tx.get(gref), us=await tx.get(uref); if(!gs.exists) throw new Error('game not found '+id);
      var g=gs.data(), ud=us.exists?us.data():{}, first=g.firstPublishTime||now;
      tx.set(gref,Object.assign({},g,{status:1,isOff:false,publishTimes:(g.publishTimes||0)+1,firstPublishTime:first,lastPublishTime:now}));
      tx.set(pref,{uid:u,gameId:id,playerId:ud.roleId||0,userName:ud.userName||ud.account||'',userImg:ud.userImg||'',
        name:String(p.name||''),advert:String(p.advert||''),iconTextureName:String(p.iconTextureName||''),dataVersion:String(p.dataVersion||''),
        gameDataCdnUrl:String(p.gameDataCdnUrl),gameTags:Array.isArray(p.gameTags)?p.gameTags.map(String):[],openCreativeGame:!!p.openCreativeGame,
        openData:JSON.stringify(p.openData||{}),publishedAt:now,firstPublishTime:first,lastPublishTime:now,thumbCnt:0,playCnt:0});
    });
    return {id:id,code:0,sensitiveWords:[]}; });

  // "Take down": hides it from discovery and marks it off; publishing again brings it back.
  B.register('game_ownoffgame', async function(p){
    var gref=col('games').doc(p.id), pref=db().collection('published').doc(p.id);
    await db().runTransaction(async function(tx){ var gs=await tx.get(gref); if(!gs.exists) throw new Error('game not found '+p.id);
      tx.set(gref,Object.assign({},gs.data(),{status:4,isOff:true})); tx.delete(pref); });
    return {}; });

  function cell(id,d){ return {id:id,uId:'',playerId:d.playerId||0,name:d.name,advert:d.advert,iconTextureName:d.iconTextureName,status:1,isOff:false,
    thumbCnt:d.thumbCnt||0,collectionCnt:0,playCnt:d.playCnt||0,hurryCnt:0,worldIds:[],variableIds:[],gameShopIds:[],gameRankIds:[],variableDatas:[],data:{},
    thawTime:0,isOldTangData:false,offReason:[],openCreativeGame:!!d.openCreativeGame,publishTimes:1,creativeSourceUId:'',openData:parse(d.openData),
    gameDataCdnUrl:d.gameDataCdnUrl,firstPublishTime:d.firstPublishTime||0,lastPublishTime:d.lastPublishTime||0}; }

  // New Game tab / Discover: newest published games first.
  B.register('game_getnewgamelist', async function(p){
    var n=Math.min(Math.max(p.end||20,1),100), snap=await db().collection('published').orderBy('publishedAt','desc').limit(n).get();
    return {gameDatas:snap.docs.slice(p.start||0,n).map(function(x){return cell(x.id,x.data());}),startMember:''}; });

  // Cover page of a published game (also what "play" loads: releaseGameData.gameDataCdnUrl / creativeGameData.packUrl).
  B.register('game_getgamedetail', async function(p){
    var s=await db().collection('published').doc(p.id).get(); if(!s.exists) return {__code:30004,__error:'game not published'};
    var d=s.data(), od=parse(d.openData);
    return {authorMsg:{id:d.playerId||0,userName:d.userName,coin:0,diamond:0,level:1,creditScore:3,isFollow:false,authed:true,userImg:d.userImg||'',fansCount:0,followsCount:0},
      releaseGameData:{id:p.id,name:d.name,iconTextureName:d.iconTextureName,advert:d.advert,status:1,isPlay:false,isThumb:false,isHurry:false,isCollection:false,
        thumbCnt:d.thumbCnt||0,collectionCnt:0,playCnt:d.playCnt||0,hurryCnt:0,reportCnt:0,dataVersion:d.dataVersion,gameDataCdnUrl:d.gameDataCdnUrl,gameTags:d.gameTags||[],
        openCreativeGame:!!d.openCreativeGame,creativeSourceUId:'',openData:od,lastPublishTime:d.lastPublishTime||0,hurryList:[],playUserList:[],tagList:[]},
      gameTopComment:{uId:'',gameId:p.id,id:'',commentsCnt:0,commentsCntSum:0,comments:[]},
      creativeGameData:{id:p.id,playerName:d.userName,name:d.name,iconTextureName:d.iconTextureName,advert:d.advert,openData:od,packUrl:d.gameDataCdnUrl,secondaryCnt:0,secondaryList:[],lastPublishTime:d.lastPublishTime||0},
      rankList:[]}; });
})();
