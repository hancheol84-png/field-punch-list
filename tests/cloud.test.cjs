const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../cloud.js');
const config={url:'https://punch-test.supabase.co',publicKey:'sb_publishable_test',loginDomain:'accounts.field-punch-list.invalid'};
const UID='afafafaf-afaf-4faf-8faf-afafafafafaf';
function fixture(){
 const values=new Map(),calls=[],listeners=[];let revision=0,state={rows:[]},offline=false,wait=null,revoked=false,wrongIdentity=false;
 const sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const respond=(data,status=200)=>({ok:status<400,status,json:async()=>data});
 const fetch=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body,headers:options.headers});
  if(offline)throw Error('offline');
  if(revoked)return respond({code:'invalid_token'},url.includes('/token?')?400:401);
  if(url.includes('/token?'))return respond({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:UID,email:'pilot01@'+config.loginDomain}});
  if(url.endsWith('/user'))return respond({id:UID,email:'pilot01@'+config.loginDomain});
  if(url.includes('/logout'))return respond({});
  if(url.endsWith('/punch_push')){
   if(wait)await wait;
   if(body.expected_revision!==revision)return respond({code:'40001'},409);
   state=JSON.parse(JSON.stringify(body.new_state));revision++;
  }
  return respond({state:JSON.parse(JSON.stringify(state)),revision,userId:wrongIdentity?'bfbfbfbf-bfbf-4fbf-8fbf-bfbfbfbfbfbf':UID,serverTime:new Date().toISOString()});
 };
 const cloud=C.create(config,{fetch,sessionStorage});cloud.subscribe(e=>listeners.push(e));
 return {cloud,values,calls,listeners,set offline(v){offline=v;},set revoked(v){revoked=v;},set wrongIdentity(v){wrongIdentity=v;},get state(){return state;},advance(){revision++;},hold(){wait=new Promise(resolve=>{this.release=()=>{wait=null;resolve();};});}};
}
test('R31: managed auth receives password once; credentials are not kept in record storage',async()=>{
 const f=fixture();await f.cloud.login('PILOT01','p'.repeat(12));
 assert.equal(f.calls[0].body.email,'pilot01@'+config.loginDomain);
 assert.ok(f.calls[0].url.endsWith('/token?grant_type=password'));
 assert.ok([...f.values.values()].every(raw=>!raw.includes('p'.repeat(12))));
 assert.equal(f.cloud.user.id,UID);
 const other=C.create(config,{fetch:async()=>{throw Error('offline');},sessionStorage:{getItem:()=>null}});
 assert.equal(await other.bootstrap(),null);
});
test('R31: drafts and current unit stay on device; account snapshots exclude them',()=>{
 const source={rows:[{text:'타일 들뜸',downloadRequestedAt:'device-marker'}],site:'샘플현장',draft:'개인 초안',current:{unit:'1503'},_cloud:{userId:UID}};
 assert.deepEqual(C.projection(source),{site:'샘플현장',rows:[{text:'타일 들뜸'}]});
 assert.equal(C.stable({b:1,a:2}),C.stable({a:2,b:1}));
});
test('R31: offline inputs remain pending, retry uploads them and unsafe logout is blocked',async()=>{
 const f=fixture();await f.cloud.login('pilot01','p'.repeat(12));f.offline=true;
 f.cloud.enqueue({rows:[{id:'one',text:'타일 들뜸'}]});await assert.rejects(()=>f.cloud.flush(),/연결되지/);
 assert.equal(f.cloud.pending(),true);await assert.rejects(()=>f.cloud.logout(),/연결되지/);assert.equal(f.cloud.user.id,UID);
 f.offline=false;await f.cloud.flush();assert.equal(f.state.rows[0].text,'타일 들뜸');assert.equal(f.cloud.pending(),false);
 f.offline=true;await f.cloud.logout();assert.equal(f.cloud.user,null);assert.equal(f.values.size,0);
});
test('R31: edits during a network request are sent afterwards; latest input is never replaced',async()=>{
 const f=fixture();await f.cloud.login('pilot01','p'.repeat(12));f.hold();
 f.cloud.enqueue({rows:[{id:'one',text:'첫 입력'}]});const upload=f.cloud.flush();
 await new Promise(resolve=>setImmediate(resolve));f.cloud.enqueue({rows:[{id:'one',text:'수정한 내용'},{id:'two',text:'다음 입력'}]});f.release();await upload;
 assert.deepEqual(f.state.rows.map(r=>r.text),['수정한 내용','다음 입력']);assert.equal(f.cloud.pending(),false);
});
test('R31: a stale version stops instead of overwriting another device',async()=>{
 const f=fixture();await f.cloud.login('pilot01','p'.repeat(12));f.advance();f.cloud.enqueue({rows:[{text:'미전송'}]});
 await assert.rejects(()=>f.cloud.flush(),/서버 기록이 바뀌/);assert.equal(f.cloud.status,'conflict');assert.equal(f.cloud.pending(),true);assert.deepEqual(f.state.rows,[]);
 await assert.rejects(()=>f.cloud.flush(),/동기화를 멈췄/);
});
test('R31: configuration rejects admin keys and insecure or unrelated endpoints',()=>{
 for(const changes of [{publicKey:'sb_secret_example'},{url:'http://punch-test.supabase.co'},{url:'https://unrelated.example'}])assert.throws(()=>C.validateConfig({...config,...changes}));
});

test('R31: revoked sessions stop uploading and clear credentials while pending data remains',async()=>{
 const f=fixture();await f.cloud.login('pilot01','p'.repeat(12));f.revoked=true;f.cloud.enqueue({rows:[{text:'미전송'}]});
 await assert.rejects(()=>f.cloud.flush(),/아이디 또는 비밀번호/);assert.equal(f.cloud.status,'expired');assert.equal(f.cloud.pending(),true);assert.equal(f.values.size,0);
 await assert.rejects(()=>f.cloud.flush(),/동기화를 멈췄/);
});

test('R31: a server response for another account is rejected before accepting private records',async()=>{
 const f=fixture();f.wrongIdentity=true;await assert.rejects(()=>f.cloud.login('pilot01','p'.repeat(12)),/서버 응답/);assert.equal(f.cloud.user,null);assert.equal(f.values.size,0);
});
