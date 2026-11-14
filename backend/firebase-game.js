// Game_Login on Firestore. Role lives in users/{uid}; numeric roleId comes from a +1-only counter (counters/roles).
(function(){
  var DEFAULT_ROLE_KEYS={ level:1, exp:0, coin:0, diamond:0, creditScore:3 };
  function store(){ // replaceable for tests
    return JEBackend.store || (JEBackend.store = {
      async getOrCreateRole(){
        var db=JEBackend.db, user=JEBackend.auth.currentUser; if(!user) throw new Error('not signed in');
        var uref=db.collection('users').doc(user.uid), cref=db.collection('counters').doc('roles');
        return db.runTransaction(async function(tx){
          var u=await tx.get(uref), d=u.exists?u.data():{};
          if(d.roleId) return d;
          var c=await tx.get(cref), n=(c.exists?c.data().n:0)+1;
          tx.set(cref,{n:n});
          tx.set(uref,{roleId:n},{merge:true});
          return Object.assign({},d,{roleId:n});
        });
      }
    });
  }
  function C(){ return window.JE_GAME_CONFIG; }
  function ms(v){ return v&&v.toMillis?v.toMillis():(typeof v==='number'?v:Date.now()); }
  JEBackend.buildRole=function(d){
    var r=Object.assign({},DEFAULT_ROLE_KEYS);
    ['level','exp','coin','diamond','creditScore'].forEach(function(k){ if(typeof d[k]==='number') r[k]=d[k]; });
    return Object.assign(r,{ id:d.roleId, uId:d.roleId, sId:1, userName:d.account, userIntro:d.userIntro||'',
      userImg:d.userImg||'', authed:true, creatorVersion:'0.8.0', channel:'web', createAt:ms(d.createdAt),
      myGameMaxCnt:d.myGameMaxCnt||C().startGameSlots, myGoodsMaxCnt:d.myGoodsMaxCnt||C().startGoodsSlots,
      completeTaskIds:d.completeTaskIds||[], guideVersion:d.guideVersion||'' });
  };
  JEBackend.register('game_login', async function(){
    var d=await store().getOrCreateRole();
    return { role: JEBackend.buildRole(d), dynamicConfig:{}, hotGameIdList:[], newGameDatas:[], followGameDatas:[],
             gameSlotUnlockLvls:C().gameSlotUnlockLvls, goodsSlotUnlockLvls:C().goodsSlotUnlockLvls };  // dynamicConfig still empty
  });
})();
