const USERS={pilot01:'afafafaf-afaf-4faf-8faf-afafafafafaf',pilot02:'bfbfbfbf-bfbf-4fbf-8fbf-bfbfbfbfbfbf'};
function backend(){
 const states=new Map(Object.values(USERS).map(uid=>[uid,{revision:0,state:{rows:[]}}]));
 const api={states,offline:false,async route(route){
  if(api.offline)return route.abort('internetdisconnected');
  const request=route.request(),url=new URL(request.url()),body=request.postDataJSON()||{};
  let status=200,data={};const token=(request.headers().authorization||'').replace('Bearer access-','');
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'apikey,content-type,authorization','access-control-allow-methods':'POST,GET,OPTIONS'}});
  if(url.pathname.endsWith('/token')){
   const loginId=url.searchParams.get('grant_type')==='password'?(body.email||'').split('@')[0]:Object.keys(USERS).find(id=>'refresh-'+USERS[id]===body.refresh_token);
   const uid=USERS[loginId];
   if(!uid||(body.password!==undefined&&body.password!=='p'.repeat(12))){status=400;data={};}
   else data={access_token:'access-'+uid,refresh_token:'refresh-'+uid,expires_in:3600,user:{id:uid,email:loginId+'@accounts.field-punch-list.invalid'}};
  }else if(url.pathname.endsWith('/user')){
   const id=Object.keys(USERS).find(id=>USERS[id]===token);if(!id)status=401;else data={id:token,email:id+'@accounts.field-punch-list.invalid'};
  }else if(url.pathname.includes('/rpc/')){
   const account=states.get(token);
   if(!account)status=401;
   else if(url.pathname.endsWith('/punch_push')&&body.expected_revision!==account.revision){status=409;data={code:'40001'};}
   else{
    if(url.pathname.endsWith('/punch_push')){account.state=JSON.parse(JSON.stringify(body.new_state));account.revision++;}
    data={userId:token,revision:account.revision,state:account.state,serverTime:new Date().toISOString()};
   }
  }
  return route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'apikey,content-type,authorization'},body:JSON.stringify(data)});
 }};return api;
}
module.exports={backend,USERS};
