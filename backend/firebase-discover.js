// Discover / Featured / Follow / remix lists, all fed from the public published/{gameId} collection (see firebase-publish.js).
//   Discover > Editor's Pick  : dynamic config "GameChosenIds"        -> newest 12 published games
//   Discover > grid           : Game_GetRecommendGameIdList           -> every published game, newest first, paged per session
//   Featured tab              : Game_GetGameIdListByGameTag (+ GetHomepageGameData for the cards)
//   New Game tab              : Game_GetNewGameList (firebase-publish.js)
//   Remix list                : Game_GetSourceCreativeGameRank        -> games published with "remixable" on
// Not implemented on purpose: following people (so the Follow tab is simply empty) and play/like counters.
(function(){
  var B=window.JEBackend, session={rcmd:null,pos:0};
  var pub=function(){ return B.db.collection('published'); };
  function docs(s){ return s.docs.map(function(x){ return {id:x.id,d:x.data()}; }); }
  async function newest(n){ return docs(await pub().orderBy('publishedAt','desc').limit(n).get()); }
  function cell(x){ return B.publishedCell(x.id,x.d); }

  // card data for a list of game ids (missing/taken-down games are skipped, the client handles that)
  B.register('game_gethomepagegamedata', async function(p){
    var out=await Promise.all((p.ids||[]).map(async function(id){ var s=await pub().doc(id).get(); return s.exists?cell({id:id,d:s.data()}):null; }));
    return {gameDatas:out.filter(Boolean)}; });

  // Featured tab. "ZongBang" is the client's built-in tag for the featured list, so it means "all published games".
  B.register('game_getgameidlistbygametag', async function(p){
    var tag=p.gameTag||'ZongBang', start=p.start||0, end=Math.min(p.end||500,500), list;
    if(tag==='ZongBang') list=await newest(500);
    else list=docs(await pub().where('gameTags','array-contains',tag).limit(500).get()).sort(function(a,b){return b.d.publishedAt-a.d.publishedAt;});
    return {gameIdList:list.slice(start,end).map(function(x){return x.id;})}; });

  // Discover grid: the client asks for 12 more each time you scroll to the bottom; we hand out a fresh slice each call.
  B.register('game_getrecommendgameidlist', async function(p){
    if(!session.rcmd){ session.rcmd=(await newest(200)).map(function(x){return x.id;}); session.pos=0; }
    var n=Math.max(1,Math.min(p.count||12,50)), ids=session.rcmd.slice(session.pos,session.pos+n); session.pos+=ids.length;
    return {recommendList:ids.map(function(id){ return {id:id,bk:'',st:''}; })}; });

  // Editor's Pick row lives in dynamic config; every other key stays empty (= feature switched off).
  B.register('game_getonedynamicconfig', async function(p){
    if(p.id==='GameChosenIds') return {dynamicConfig:(await newest(12)).map(function(x){return x.id;})};
    return {dynamicConfig:{}}; });

  B.register('game_getsourcecreativegamerank', async function(p){      // remixable games; sorted here to avoid needing a composite index
    var l=docs(await pub().where('openCreativeGame','==',true).limit(200).get()).sort(function(a,b){return b.d.publishedAt-a.d.publishedAt;});
    return {gameDatas:l.slice(p.start||0,p.end||20).map(function(x){ var c=cell(x); return Object.assign({},c,{gameTags:x.d.gameTags||[],dataVersion:x.d.dataVersion||'',openData:c.openData}); })}; });

  B.register('game_gethomepagefollowusergames', async function(){ return {gameDatas:[]}; });   // no follow system: nobody to follow

  // Analytics pings the original sent to its recommender; discarded here.
  ['game_reportgameshow','game_reportgameclick','game_reportgoodsshow','game_reportgoodsclick','game_clickrecommendsgames'].forEach(function(c){
    B.register(c, async function(){ return {}; }); });

  // "N people played": one count per player per game. users/{uid}/played/{gameId} remembers who already counted;
  // firestore.rules lets any signed-in player raise published/{id}.playCnt by exactly 1 and change nothing else.
  B.register('game_playgames', async function(p){
    var u=B.auth&&B.auth.currentUser; if(!u) throw new Error('not signed in');
    var ids=p.ids||[], counts=[];
    for(var i=0;i<ids.length;i++){ var id=ids[i], pref=pub().doc(id), mref=B.db.collection('users').doc(u.uid).collection('played').doc(id);
      counts.push(await B.db.runTransaction(async function(tx){
        var ps=await tx.get(pref), ms=await tx.get(mref); if(!ps.exists) return 0;
        var d=ps.data(), n=d.playCnt||0; if(ms.exists) return n;
        tx.set(mref,{at:Date.now()}); tx.set(pref,Object.assign({},d,{playCnt:n+1})); return n+1; })); }
    return {ids:ids,playCntList:counts}; });
  B.register('game_playgamestatistics', async function(){ return {}; });      // play-time analytics: discarded

  B.resetDiscoverSession=function(){ session.rcmd=null; session.pos=0; };
})();
