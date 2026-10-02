const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
let db;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const row=(id,text)=>({id,dong:'101',unit:'1503',text,createdAt:new Date().toISOString(),trade:'타일',tradeMode:'auto'});
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../server/account-schema.sql'),'utf8'));
 for(const id of [A,B,C])await db.query('insert into auth.users values($1)',[id]);
 await db.query('insert into punch_private.members(user_id,login_id) values($1,$2),($3,$4)',[A,'pilot01',B,'pilot02']);
});
after(async()=>{await db?.close();});
async function asUser(uid,fn){
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 try{return await fn();}finally{await db.exec('reset role');}
}
async function pull(uid){return asUser(uid,async()=>(await db.query('select public.punch_pull() result')).rows[0].result);}
async function push(uid,state,revision){return asUser(uid,async()=>(await db.query('select public.punch_push($1::jsonb,$2::bigint) result',[JSON.stringify(state),revision])).rows[0].result);}

test('R30: accounts see only their own state, even with owner IDs injected in records',async()=>{
 const a=await pull(A),b=await pull(B);assert.deepEqual(a.state.rows,[]);assert.deepEqual(b.state.rows,[]);
 const r=row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','타일 들뜸');r.owner_id=B;r.user_id=B;
 const saved=await push(A,{site:'샘플현장',rows:[r]},a.revision);
 assert.equal(saved.userId,A);assert.equal(saved.state.rows[0].user_id,undefined);assert.equal(saved.state.rows[0].owner_id,undefined);
 assert.equal((await pull(A)).state.rows.length,1);assert.deepEqual((await pull(B)).state.rows,[]);
 await assert.rejects(()=>asUser(B,()=>db.query('select * from punch_private.accounts')),/permission denied/);
 await assert.rejects(()=>asUser(B,()=>db.query('delete from punch_private.accounts')),/permission denied/);
});
test('R30: anonymous, unregistered and deactivated users cannot fetch or change records',async()=>{
 await db.exec('set role anon');try{await assert.rejects(()=>db.query('select public.punch_pull()'),/permission denied/);}finally{await db.exec('reset role');}
 await assert.rejects(()=>pull(C),/not permitted/);
 await db.query('update punch_private.members set active=false where user_id=$1',[B]);
 await assert.rejects(()=>pull(B),/not permitted/);await assert.rejects(()=>push(B,{rows:[]},0),/not permitted/);
 await db.query('update punch_private.members set active=true where user_id=$1',[B]);
});
test('R30: stale PC state cannot overwrite newer phone edits or deletes',async()=>{
 const initial=await pull(B);
 const first=await push(B,{rows:[row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','휴대폰 기록')]},initial.revision);
 await assert.rejects(()=>push(B,{rows:[]},initial.revision),/Another device/);
 assert.equal((await pull(B)).state.rows[0].text,'휴대폰 기록');
 const deleted=await push(B,{rows:[]},first.revision);
 await assert.rejects(()=>push(B,first.state,first.revision),/Another device/);
 assert.deepEqual((await pull(B)).state.rows,[]);assert.ok(deleted.revision>first.revision);
});
test('R30: seven-day boundary is enforced on server, edits cannot extend first input time',async()=>{
 const current=await pull(A),r=row('cccccccc-cccc-4ccc-8ccc-cccccccccccc','보관 기간 시험');
 r.createdAt=new Date(Date.now()-86400000).toISOString();
 const first=await push(A,{rows:[r]},current.revision);const created=first.state.rows[0].createdAt;
 const edited={...first.state.rows[0],createdAt:new Date(Date.now()+30*86400000).toISOString(),text:'수정한 내용'};
 const second=await push(A,{rows:[edited]},first.revision);assert.equal(second.state.rows[0].createdAt,created);
 await db.query(`update punch_private.accounts set state=jsonb_set(state,'{rows,0,createdAt}',to_jsonb(to_char((now()-interval '7 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where user_id=$1`,[A]);
 const expired=await pull(A);assert.deepEqual(expired.state.rows,[]);assert.ok(expired.revision>second.revision);
 const disk=(await db.query('select state from punch_private.accounts where user_id=$1',[A])).rows[0].state;
 assert.deepEqual(disk.rows,[]);
});
test('R30: malformed or duplicated records and caller-selected account fields are rejected atomically',async()=>{
 const current=await pull(A),r=row('dddddddd-dddd-4ddd-8ddd-dddddddddddd','입력 검사');
 for(const state of [{rows:[r,r]},{rows:[{...r,unit:'invalid'}]},{rows:[{...r,text:'x'.repeat(32768)}]},{rows:[{...r,createdAt:'invalid'}]},{rows:[],userId:B}]){
  await assert.rejects(()=>push(A,state,current.revision));assert.equal((await pull(A)).revision,current.revision);
 }
});
