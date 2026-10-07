/* Managed password authentication and account-scoped synchronization; no CDN. */
(function(root){
 'use strict';
 const FIELDS=['site','inspector','cores','dongs','spots','trades','phrases','speechRules','rows'];
 function projection(state){const out={};for(const key of FIELDS)if(state[key]!==undefined)out[key]=state[key];out.rows=state.rows||[];const clean=JSON.parse(JSON.stringify(out));for(const row of clean.rows)delete row.downloadRequestedAt;return clean;}
 function stable(value){return JSON.stringify(value,function(k,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v;});}
 function fail(message,kind){const error=new Error(message);error.kind=kind;return error;}
 function validateConfig(config){
  if(!config||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url||''))throw fail('서버 주소 설정을 확인하세요.','configuration');
  let allowed=/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publicKey||'');
  if(!allowed){try{const part=config.publicKey.split('.')[1];allowed=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch(e){}}
  if(!allowed)throw fail('공개용 키만 사용할 수 있습니다. 관리자 키는 넣지 마세요.','configuration');
  if(!/^[a-z0-9.-]+\.[a-z]+$/.test(config.loginDomain||''))throw fail('로그인 아이디 설정을 확인하세요.','configuration');
 }
 function create(config,options={}){
  validateConfig(config);
  const transport=options.fetch||root.fetch.bind(root),store=options.sessionStorage||root.sessionStorage;
  const sessionKey='punch.auth.v1:'+(options.sessionNamespace?options.sessionNamespace+':':'')+config.url,base=config.url.replace(/\/$/,'');
  let session=null,user=null,refreshing=null,revision=0,latest=null,ack='',flight=null,timer=null,stopped=false,status='signedout';
  const listeners=[];
  function emit(next,error){status=next;for(const fn of listeners)fn({status,user,revision,pending:pending(),error});}
  function pending(){return latest!==null&&stable(latest)!==ack;}
  function clearSession(){session=null;user=null;try{store.removeItem(sessionKey);}catch(e){}}
  function keepSession(value){
   if(!value||typeof value.access_token!=='string'||typeof value.refresh_token!=='string'||!value.user?.id)throw fail('로그인 응답을 확인할 수 없습니다.','authentication');
   if(user&&value.user.id!==user.id)throw fail('로그인 계정이 바뀌었습니다. 다시 로그인하세요.','authentication');
   session={access_token:value.access_token,refresh_token:value.refresh_token,user:{id:value.user.id,email:value.user.email||''},expires_at:value.expires_at||Math.floor(Date.now()/1000)+(value.expires_in||3600)};
   try{store.setItem(sessionKey,JSON.stringify(session));}catch(e){/* Current tab can continue without remembered session. */}
  }
  async function request(path,body,token,method='POST'){
   let response;
   try{response=await transport(base+path,{method,headers:{apikey:config.publicKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});}catch(e){throw fail('서버에 연결되지 않았습니다. 입력은 이 기기에 남아 있습니다.','network');}
   const data=await response.json().catch(()=>({}));
   if(!response.ok){
    if(data.code==='PT409'||data.code==='40001')throw fail('서버 기록이 바뀌었습니다. 미전송 내용을 보관한 뒤 최신 기록을 불러오세요.','conflict');
    if(response.status===401||response.status===403||data.code==='42501')throw fail('로그인 또는 계정 사용 권한을 확인하세요.','authentication');
    if(response.status===400&&path.startsWith('/auth/'))throw fail('아이디 또는 비밀번호를 확인하세요.','authentication');
    throw fail(response.status===429?'요청이 많습니다. 잠시 후 다시 시도하세요.':'서버 저장에 실패했습니다. 현재 화면의 기록을 엑셀로 받아 두세요.','server');
   }
   return data;
  }
  async function access(force=false){
   if(!session)throw fail('로그인이 필요합니다.','authentication');
   if(!force&&session.expires_at>Date.now()/1000+30)return session.access_token;
   if(!refreshing)refreshing=(async()=>{
    try{keepSession(await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token}));return session.access_token;}
    catch(e){if(e.kind==='authentication'){clearSession();emit('expired',e);}throw e;}
    finally{refreshing=null;}
   })();
   return refreshing;
  }
  async function rpc(name,body){
   let token=await access();
   try{return await request('/rest/v1/rpc/'+name,body,token);}
   catch(e){if(e.kind!=='authentication')throw e;token=await access(true);return request('/rest/v1/rpc/'+name,body,token);}
  }
  async function verify(){
   const token=await access();const identity=await request('/auth/v1/user',undefined,token,'GET');
   if(!identity.id||identity.id!==session.user.id)throw fail('로그인 계정을 확인할 수 없습니다.','authentication');
   user={id:identity.id,loginId:(identity.email||session.user.email).split('@')[0]};return user;
  }
  function accept(result){
   if(!result||result.userId!==user.id||!Number.isSafeInteger(result.revision)||!result.state||!Array.isArray(result.state.rows))throw fail('계정의 서버 응답을 확인할 수 없습니다.','server');
   revision=result.revision;ack=stable(projection(result.state));return result;
  }
  async function bootstrap(){
   try{const raw=store.getItem(sessionKey);if(raw)session=JSON.parse(raw);}catch(e){clearSession();}
   if(!session)return null;
   try{await verify();const result=accept(await rpc('punch_pull',{}));latest=projection(result.state);emit('synced');return result;}
   catch(e){if(e.kind==='authentication')clearSession();emit('signedout',e);throw e;}
  }
  async function login(id,password){
   const loginId=String(id||'').trim().toLowerCase();
   if(!/^[a-z0-9._-]{3,32}$/.test(loginId)||!password)throw fail('아이디와 비밀번호를 입력하세요.','authentication');
   clearSession();keepSession(await request('/auth/v1/token?grant_type=password',{email:loginId+'@'+config.loginDomain,password}));
   try{await verify();const result=accept(await rpc('punch_pull',{}));latest=projection(result.state);stopped=false;emit('synced');return result;}
   catch(e){clearSession();emit('signedout',e);throw e;}
  }
  function metadata(state){return {userId:user.id,revision,pending:stable(projection(state))!==ack};}
  function restoreRevision(value){if(!Number.isSafeInteger(value)||value<0)throw fail('미전송 기록의 저장 버전을 확인하세요.','server');revision=value;}
  function enqueue(state){
   if(!user)return;
   latest=projection(state);
   if(!pending()){if(!flight)emit('synced');return;}
   if(stopped)return;
   emit('pending');clearTimeout(timer);timer=setTimeout(()=>{timer=null;flush().catch(()=>{});},500);
  }
  async function flush(){
   clearTimeout(timer);timer=null;
   if(stopped)throw fail('동기화를 멈췄습니다. 먼저 안내를 확인하세요.','conflict');
   if(flight){await flight;return pending()?flush():null;}
   if(!pending())return null;
   flight=(async()=>{
    emit('syncing');const sent=projection(latest),sentText=stable(sent);
    try{
     const result=accept(await rpc('punch_push',{new_state:sent,expected_revision:revision}));
     // Apply only canonical input dates, never replace newer unsent text or resurrect deleted rows.
     const unchanged=stable(latest)===sentText;
     const returned=new Map(result.state.rows.map(r=>[r.id,r]));
     for(const row of latest.rows){if(returned.has(row.id))row.createdAt=returned.get(row.id).createdAt;}
     if(unchanged)latest=projection(result.state);
     if(options.onSaved)options.onSaved(result);
     emit(pending()?'pending':'synced');return result;
    }catch(e){if(e.kind==='conflict'||e.kind==='authentication'){stopped=true;}emit(e.kind==='conflict'?'conflict':e.kind==='authentication'?'expired':'error',e);throw e;}
    finally{flight=null;}
   })();
   const result=await flight;if(pending())return flush();return result;
  }
  async function logout(){
   if(pending())await flush();
   try{await request('/auth/v1/logout?scope=local',{},await access());}catch(e){/* Local logout still removes credentials if server is unreachable. */}
   finally{clearSession();latest=null;ack='';stopped=true;clearTimeout(timer);emit('signedout');}
  }
  return {bootstrap,login,enqueue,flush,logout,metadata,restoreRevision,pending,get user(){return user;},get revision(){return revision;},get status(){return status;},subscribe(fn){listeners.push(fn);}};
 }
 const api={create,projection,stable,validateConfig};if(typeof module==='object'&&module.exports)module.exports=api;else root.PunchCloud=api;
})(typeof globalThis==='object'?globalThis:this);
