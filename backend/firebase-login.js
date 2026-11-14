// Login_* commands on Firebase Auth + Firestore.
// username -> synthetic email (Firebase needs one). Password = user password, or the oTP until one is set.
(function(){
  firebase.initializeApp(window.JE_FIREBASE_CONFIG);
  var auth=firebase.auth(), db=firebase.firestore();
  var DOMAIN='accounts.julianseditor.invalid';
  var mail=function(a){return String(a).toLowerCase()+'@'+DOMAIN;};
  var fail=function(code,msg){return {__code:code,__error:msg};};
  function otp(){ var c='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',b=new Uint8Array(20); crypto.getRandomValues(b);
    return Array.prototype.map.call(b,function(x){return c[x%c.length];}).join(''); }
  async function taken(a){ return (await db.collection('usernames').doc(String(a).toLowerCase()).get()).exists; }

  JEBackend.register('login_checkaccount', async function(p){ return {ok: !(await taken(p.account))}; });

  JEBackend.register('login_createaccount', async function(p){
    var a=p.account; if(!/^[a-zA-Z][a-zA-Z0-9_]{4,15}$/.test(a)) return fail(20001,'bad username');
    if(await taken(a)) return fail(20003,'taken');
    var pw=otp(), cred;
    try{ cred=await auth.createUserWithEmailAndPassword(mail(a),pw); }
    catch(e){ return fail(e.code==='auth/email-already-in-use'?20003:-3, e.code||e.message); }
    var uid=cred.user.uid, batch=db.batch(), now=firebase.firestore.FieldValue.serverTimestamp();
    batch.set(db.collection('usernames').doc(a.toLowerCase()),{uid:uid,account:a});
    batch.set(db.collection('users').doc(uid),{account:a,createdAt:now,isSetPassword:false});
    await batch.commit();
    return {account:a, oTP:pw};
  });

  JEBackend.register('login_authusersingle', async function(p){
    var info; try{ info=JSON.parse(p.info);}catch(e){ return fail(-4,'bad info'); }
    var a=info.account, pw=info.password||info.oTP, user=auth.currentUser;
    if(!(user && user.email===mail(a))){            // reuse persisted session for same account, else sign in
      try{ user=(await auth.signInWithEmailAndPassword(mail(a),pw)).user; }
      catch(e){
        if(['auth/user-not-found','auth/invalid-credential','auth/wrong-password','auth/invalid-login-credentials'].indexOf(e.code)<0) return fail(-3,e.code);
        return (await taken(a)) ? fail(20004,'wrong password') : fail(20002,'no such user');
      }
    }
    var snap=await db.collection('users').doc(user.uid).get(), d=snap.exists?snap.data():{};
    return { roleToken: await user.getIdToken(), bindInfo:null, bindPlatformUId:'',
             ext: JSON.stringify({account:a, oTP: info.oTP||'', isSetPassword: !!d.isSetPassword}) };
  });
  JEBackend.auth=auth; JEBackend.db=db;
})();
