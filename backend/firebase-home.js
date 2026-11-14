// Home-screen commands. "EMPTY" = valid empty-state reply until real content storage exists (published games, goods, comments).
(function(){
  var EMPTY={
    game_getgiftdyncfg:        {cfg:{datas:[]}},                               // gift catalogue: server data, not recovered
    game_getonedynamicconfig:  {dynamicConfig:{}},
    game_getchosengoodsids:    {goodsIds:[],recommendGoodsIds:[]},              // Store > Featured
    game_getnewcommentlistv2:  {startIndex:0,newCommentCnt:0,commentList:[]},   // Message > Comments
    game_getrecommendgameidlist:{recommendList:[]},                             // Discover > Editor's Pick
    game_getnewgamelist:       {gameDatas:[],startMember:''}                    // New Game tab
  };
  Object.keys(EMPTY).forEach(function(k){ JEBackend.register(k,function(){ return JSON.parse(JSON.stringify(EMPTY[k])); }); });

  // Tutorial progress persists in users/{uid} so it doesn't replay every login.
  JEBackend.register('game_saveguide', async function(p){
    var u=JEBackend.auth&&JEBackend.auth.currentUser;
    if(JEBackend.store&&JEBackend.store.saveGuide) await JEBackend.store.saveGuide(p);
    else if(u) await JEBackend.db.collection('users').doc(u.uid).set({completeTaskIds:p.completeTaskIds||[],guideVersion:p.guideVersion||''},{merge:true});
    return {};
  });
})();
