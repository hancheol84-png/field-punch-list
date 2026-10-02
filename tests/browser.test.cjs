const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
let server, browser, origin;
const serverOverrides=new Map();
before(async () => {
  server = http.createServer((req,res) => {
    let name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name.startsWith('/field-punch-list/'))name=name.slice('/field-punch-list'.length);
    const file = path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,data) => {
      if(err){res.writeHead(404).end();return;}
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json'};
      res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
      res.setHeader('Cache-Control','no-store');
      if(serverOverrides.has(name))data=Buffer.from(serverOverrides.get(name)(data.toString('utf8')));
      res.end(data);
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  origin='http://127.0.0.1:'+server.address().port;
  browser=process.env.TEST_CDP_URL ? await chromium.connectOverCDP(process.env.TEST_CDP_URL) : await chromium.launch({executablePath:process.env.CHROME_PATH || path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),headless:true});
});
after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
async function pageFor(t, init, options={}){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul'});
  t.after(()=>context.close());
  if(init) await context.addInitScript(init);
  const page=await context.newPage();
  if(options.clock) await page.clock.install({time:new Date(options.clock)});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(()=>assert.deepEqual(errors,[]));
  await page.goto(origin+(options.path||"/"));
  await page.waitForFunction(()=>document.documentElement.dataset.ready==="true");
  return page;
}
test('R2: 390px layout fits and focused input keeps add action in view',async t=>{
  const page=await pageFor(t);
  assert.equal(await page.locator('html').getAttribute('lang'),'ko');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  await page.locator('#textIn').focus();
  assert.equal(await page.locator('.input-actions').evaluate(e=>getComputedStyle(e).position),'fixed');
  const box=await page.locator('#addBtn').boundingBox();
  assert.ok(box.y+box.height<=844 && box.height>=44);
  fs.mkdirSync(path.join(root,'.test-output'),{recursive:true});
  await page.screenshot({path:path.join(root,'.test-output/mobile.png'),fullPage:true});
});

async function selectUnit(page,unit='1503'){
  await page.locator('#unitIn').fill(unit);await page.locator('#unitGo').click();
}
test('R3: missing unit preserves draft and reload; IME Enter cannot submit',async t=>{
  const page=await pageFor(t);
  await page.locator('#textIn').fill('벽면 보수');await page.locator('#addBtn').click();
  assert.equal(await page.locator('#textIn').inputValue(),'벽면 보수');
  assert.equal(await page.locator('#tb .record-row').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'unitIn');
  await page.reload();assert.equal(await page.locator('#textIn').inputValue(),'벽면 보수');
  await selectUnit(page);
  await page.locator('#textIn').dispatchEvent('keydown',{key:'Enter',isComposing:true});
  await page.locator('#textIn').dispatchEvent('keydown',{key:'Enter',keyCode:229});
  assert.equal(await page.locator('#tb .record-row').count(),0);
  await page.locator('#addBtn').click();
  assert.equal(await page.locator('#tb .record-row').count(),1);
  assert.equal(await page.locator('#textIn').inputValue(),'');
  await page.reload();assert.equal(await page.locator('#tb .record-row').count(),1);
});
test('R3: storage failure stays visible while rows remain exportable in memory',async t=>{
  const page=await pageFor(t,()=>{Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};});
  await selectUnit(page);await page.locator('#textIn').fill('천장 보수');await page.locator('#addBtn').click();
  assert.equal(await page.locator('#tb .record-row').count(),1);
  assert.equal(await page.locator('#storageWarn').isVisible(),true);
  assert.match(await page.locator('#storageWarn').textContent(),/저장되지/);
});

test('R5: creation time persists and export keeps each row date; old rows stay unknown',async t=>{
  const page=await pageFor(t,()=>{
    localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[{dong:'101',unit:'1501',text:'기존 항목'}, {dong:'101',unit:'1401',text:'어제 항목',createdAt:new Date(Date.now()-86400000).toISOString()}]}));
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});
  });
  await page.locator('#listAll').click();await page.locator('.group-toggle').filter({hasText:'1501호'}).click();
  assert.match(await page.locator('#tb').textContent(),/날짜 미상/);
  await page.locator('#copyBtn').click();
  const text=await page.evaluate(()=>window.copied);
  assert.match(text,/날짜 미상/);
  const yesterday=await page.evaluate(()=>{const d=new Date(Date.now()-86400000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');});
  assert.ok(text.includes(yesterday));
  await selectUnit(page);await page.locator('#textIn').fill('새 항목');await page.locator('#addBtn').click();
  const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows);
  assert.ok(Number.isFinite(Date.parse(rows[2].createdAt)));
  assert.equal(rows[0].createdAt,undefined);
});

test('R4: browser downloads a real XLSX and failed clipboard shows selectable fallback',async t=>{
  const page=await pageFor(t,()=>{
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}}});
    document.execCommand=()=>false;
  });
  await selectUnit(page);await page.locator('#textIn').fill(' =1+1\t확인\n벽 보수');await page.locator('#addBtn').click();
  assert.equal(await page.locator('#tb .record-row').count(),1);
  const pending=page.waitForEvent('download',{timeout:8000});pending.catch(()=>{});await page.locator('#downloadBtn').click();
  assert.match(await page.locator('#heard').textContent(),/파일 받기/, 'download action feedback');
  const download=await pending;assert.match(download.suggestedFilename(),/^펀치리스트_샘플현장_\d{8}\.xlsx$/);
  const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const output=require('node:child_process').execFileSync(process.env.PYTHON_PATH||'python',[path.join(__dirname,'verify_xlsx.py')],{input:Buffer.concat(chunks),encoding:'utf8'});
  assert.match(output,/OK/);
  await page.locator('#copyBtn').click();
  await page.locator('#copyFallback').waitFor({state:'visible'});
  assert.match(await page.locator('#heard').textContent(),/실패/);
  assert.match(await page.locator('#copyText').inputValue(),/'=1\+1/);
});

test('R6: seven-day boundary, 3/1 day warning, unknown dates and download marker',async t=>{
 const page=await pageFor(t,()=>{
   const age=n=>new Date(Date.parse('2026-09-22T03:00:00Z')-n*86400000).toISOString();
   localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[
    {dong:'101',unit:'1501',text:'만료',createdAt:age(7)},
    {dong:'101',unit:'1502',text:'일일',createdAt:age(6)},
    {dong:'101',unit:'1503',text:'삼일',createdAt:age(4)},
    {dong:'101',unit:'1504',text:'미상'}]}));
 },{clock:'2026-09-22T03:00:00Z'});
 await page.locator('#listAll').click();
 assert.equal(await page.locator('.group-toggle').count(),3);
 await page.locator('.group-toggle').filter({hasText:'1504호'}).click();
 const warning=await page.locator('#retentionWarn').textContent();
 assert.match(warning,/1건이 1일/);assert.match(warning,/1건이 3일/);assert.match(warning,/날짜 미상 1건/);
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();await pending;
 assert.match(await page.locator('#tb').textContent(),/요청 2026-09-22/);
 await page.clock.fastForward(86400000);
 assert.equal(await page.locator('.group-toggle').count(),2);
 assert.match(await page.locator('#tb').textContent(),/미상/);
});

function fakeSpeech(){
 window.recognizers=[];window.wakeResolvers=[];window.released=0;
 window.SpeechRecognition=class{
  constructor(){window.recognizers.push(this);}
  start(){this.startCount=(this.startCount||0)+1;}
  stop(){this.onend?.();}abort(){this.onend?.();}
 };
 Object.defineProperty(navigator,'wakeLock',{value:{request:()=>new Promise(resolve=>window.wakeResolvers.push(()=>resolve({release:async()=>{window.released++;},addEventListener:()=>{}})))}});
}
test('R7: actual speech events, bounded errors, manual stop and late Wake Lock release',async t=>{
 const page=await pageFor(t,fakeSpeech,{clock:'2026-09-22T03:00:00Z'});
 await page.locator('#micBtn').click();assert.match(await page.locator('#micWarn').textContent(),/권한 요청/);
 await page.evaluate(()=>recognizers[0].onstart());assert.match(await page.locator('#micWarn').textContent(),/듣는 중/);
 await page.locator('#micBtn').click();
 await page.evaluate(async()=>{wakeResolvers.shift()();await Promise.resolve();});
 assert.equal(await page.evaluate(()=>released),1);
 await page.evaluate(()=>recognizers[0].onend());await page.clock.fastForward(10000);
 assert.equal(await page.evaluate(()=>recognizers.length),1);
 await page.locator('#micBtn').click();
 await page.evaluate(()=>recognizers[1].onerror({error:'network'}));
 assert.match(await page.locator('#micWarn').textContent(),/멈춤/);
 await page.clock.fastForward(1100);assert.equal(await page.evaluate(()=>recognizers.length),3);
 await page.evaluate(()=>recognizers[2].onerror({error:'network'}));
 assert.match(await page.locator('#micWarn').textContent(),/오류.*자판 마이크/);
 await page.clock.fastForward(20000);assert.equal(await page.evaluate(()=>recognizers.length),3);
});
test('R7: speech cannot change unit; stale results ignored and hidden view releases lock',async t=>{
 const page=await pageFor(t,fakeSpeech);
 await selectUnit(page,'1503');await page.locator('#micBtn').click();
 await page.evaluate(()=>{recognizers[0].onstart();recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'102동 1601호'}],{isFinal:true})]});});
 assert.match(await page.locator('#ctxBig').textContent(),/101동 1503/);
 assert.equal(await page.locator('#tb .record-row').count(),1);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0].text),'102동 1601호');
 await page.evaluate(()=>recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'거실 타일 벽면 보수 필요'}],{isFinal:true})]}));
 assert.equal(await page.locator('#tb .record-row').count(),2);
 await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));wakeResolvers.shift()();await Promise.resolve();});
 assert.equal(await page.evaluate(()=>released),1);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.evaluate(()=>recognizers.length),2);
 await page.locator('#micBtn').click();
 await page.evaluate(()=>recognizers[1].onresult({resultIndex:0,results:[Object.assign([{transcript:'추가되면 안 되는 항목'}],{isFinal:true})]}));
 assert.equal(await page.locator('#tb .record-row').count(),2);
});

test('R8: installed shell reloads offline and exports without any remote resources',async t=>{
 const page=await pageFor(t);
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const requests=[];page.on('request',r=>requests.push(r.url()));
 await page.evaluate(()=>caches.open('unrelated-project-sentinel'));
 await page.context().setOffline(true);await page.reload();
 assert.match(await page.locator('h1').textContent(),/현장 펀치리스트/);
 await selectUnit(page);await page.locator('#textIn').fill('오프라인 보수');await page.locator('#addBtn').click();
 assert.equal(await page.locator('#tb .record-row').count(),1);
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();await pending;
 assert.ok(requests.every(url=>url.startsWith(origin+'/')||url.startsWith('blob:')));
 assert.ok((await page.evaluate(()=>caches.keys())).includes('unrelated-project-sentinel'));
 assert.match(await page.locator('#offlineNotice').textContent(),/오프라인/);
});

test('R9: unsupported or corrupt storage never overwrites original; old origin key untouched',async t=>{
 const page=await pageFor(t,()=>{
  localStorage.setItem('punchlist.v2','{"version":99,"rows":[]}');
  localStorage.setItem('punchTest.v1','old unrelated data');
 });
 assert.match(await page.locator('#storageWarn').textContent(),/읽을 수 없습니다/);
 await selectUnit(page);await page.locator('#textIn').fill('복구 전 새 입력');await page.locator('#addBtn').click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('punchlist.v2')),'{"version":99,"rows":[]}');
 assert.equal(await page.evaluate(()=>localStorage.getItem('punchTest.v1')),'old unrelated data');
 assert.equal(await page.locator('#tb .record-row').count(),1);
 assert.equal(await page.locator('#storageRecovery').isVisible(),true);
 await page.evaluate(()=>localStorage.setItem('punchlist.v2','{"version":2,"rows":[null]}'));
 // init scripts run on reload; use a new context with malformed data for independent validation.
 const malformed=await pageFor(t,()=>localStorage.setItem('punchlist.v2','{"version":2,"rows":[null]}'));
 assert.equal(await malformed.locator('#storageWarn').isVisible(),true);
 assert.equal(await malformed.evaluate(()=>localStorage.getItem('punchlist.v2')),'{"version":2,"rows":[null]}');
});

test('R8: Pages subpath and waiting-worker update preserve draft; failed save blocks refresh',async t=>{
 const page=await pageFor(t,null,{path:'/field-punch-list/'});
 t.after(()=>serverOverrides.clear());
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 assert.match(await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL),/\/field-punch-list\/sw\.js$/);
 await selectUnit(page);await page.locator('#textIn').fill('업데이트 전 초안');
 serverOverrides.set('/sw.js',data=>data.replace(/const CACHE=PREFIX\+'v\d+';/,"const CACHE=PREFIX+'v999';"));
 serverOverrides.set('/index.html',data=>data.replace('</head>','<meta name="release-test" content="updated"></head>'));
 serverOverrides.set('/',serverOverrides.get('/index.html'));
 await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
 await page.locator('#updateNotice').waitFor({state:'visible'});
 await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('full');};});
 await page.locator('#updateBtn').click();
 assert.match(await page.locator('#updateText').textContent(),/보류/);
 assert.equal(await page.locator('meta[name="release-test"]').count(),0);
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSet;});
 await page.locator('#updateBtn').click();
 await page.locator('meta[name="release-test"]').waitFor({state:'attached'});
 assert.equal(await page.locator('#textIn').inputValue(),'업데이트 전 초안');
 await page.context().setOffline(true);await page.reload();
 assert.equal(await page.locator('#textIn').inputValue(),'업데이트 전 초안');
 assert.match(await page.locator('h1').textContent(),/현장 펀치리스트/);
});


test('R11: second tab cannot overwrite records and can take over after editor closes',async t=>{
 const a=await pageFor(t);const b=await a.context().newPage();await b.goto(origin+'/');
 await b.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 assert.equal(await b.locator('#unitGo').isDisabled(),true);
 await selectUnit(a);await a.locator('#textIn').fill('첫 창 기록');await a.locator('#addBtn').click();
 await b.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 assert.equal(await b.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows.length),1);
 await a.close();await b.locator('#reloadGuard').click();await b.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 assert.equal(await b.locator('#unitGo').isDisabled(),false);assert.equal(await b.locator('#tb .record-row').count(),1);
 await b.locator('#textIn').fill('이어 쓴 기록');await b.locator('#addBtn').click();
 assert.equal(await b.locator('#tb .record-row').count(),2);
});
test('R11: external storage change blocks stale save but preserves local export',async t=>{
 const page=await pageFor(t);await selectUnit(page);
 await page.evaluate(()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[{dong:'102',unit:'1401',text:'다른 창 기록'}]})));
 await page.locator('#textIn').fill('이 창 초안');
 assert.match(await page.locator('#editGuard').textContent(),/다른 창에서 기록이 바뀌어/);
 assert.equal(await page.locator('#addBtn').isDisabled(),true);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0].text),'다른 창 기록');
});


test('R12: whitespace choices and duplicate cores cannot damage saved settings',async t=>{
 const page=await pageFor(t);await selectUnit(page);
 for(const name of ['＋ 위치','＋ 공종','＋']){
  page.once('dialog',d=>d.accept('   '));await page.getByRole('button',{name,exact:true}).click();
 }
 await page.reload();assert.equal(await page.locator('#storageRecovery').isVisible(),false);
 await page.locator('#setup summary').click();await page.locator('#siteIn').fill('가상 현장');
 await page.locator('#coreIn').fill('1코어=01; 2코어=01');await page.locator('#saveSet').click();
 assert.match(await page.locator('#setupWarn').textContent(),/중복/);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).site),'샘플현장');
});
test('R12: site rename requires explicit acknowledgement while records exist',async t=>{
 const page=await pageFor(t);await selectUnit(page);await page.locator('#textIn').fill('보수');await page.locator('#addBtn').click();
 await page.locator('#setup summary').click();await page.locator('#siteIn').fill('가상 현장');
 page.once('dialog',d=>d.dismiss());await page.locator('#saveSet').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).site),'샘플현장');
 page.once('dialog',d=>d.accept());await page.locator('#saveSet').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).site),'가상 현장');
});


test('R13: draft stays with its original unit unless explicitly moved',async t=>{
 const page=await pageFor(t);await selectUnit(page);await page.locator('#textIn').fill('기존 세대 초안');
 await selectUnit(page,'1403');assert.equal(await page.locator('#contextDialog').isVisible(),true);
 await page.locator('#draftStay').click();assert.match(await page.locator('#ctxBig').textContent(),/1503/);
 await selectUnit(page,'1403');await page.locator('#draftSaveMove').click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));
 assert.equal(saved.rows[0].unit,'1503');assert.equal(saved.current.unit,'1403');assert.equal(saved.draft,'');
 await page.locator('#textIn').fill('명시적 이동');await selectUnit(page,'1303');await page.locator('#draftCarry').click();await page.locator('#addBtn').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[1].unit),'1303');
 await page.locator('#dongs').getByRole('button',{name:'102',exact:true}).click();
 assert.match(await page.locator('#ctxBig').textContent(),/호수를 정하세요/);
});
test('R13: late speech from previous unit is ignored after unit transition',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);await page.locator('#micBtn').click();
 await selectUnit(page,'1403');
 await page.evaluate(()=>recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'이전 세대 결과'}],{isFinal:true})]}));
 assert.equal(await page.locator('#tb .record-row').count(),0);
 await page.evaluate(()=>recognizers[1].onresult({resultIndex:0,results:[Object.assign([{transcript:'벽면 보수'}],{isFinal:true})]}));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0].unit),'1403');
});


test('R14: oversize input remains a draft and cannot block workbook generation',async t=>{
 const page=await pageFor(t);await selectUnit(page);await page.locator('#textIn').fill('가'.repeat(32768));await page.locator('#addBtn').click();
 assert.equal(await page.locator('#tb .record-row').count(),0);assert.equal((await page.locator('#textIn').inputValue()).length,32768);
 assert.match(await page.locator('#inputWarn').textContent(),/32,767/);
 await page.locator('#textIn').fill('수정한 내용');await page.locator('#addBtn').click();
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();await pending;
 assert.equal(await page.locator('#exportWarn').isVisible(),false);
});


test('R15: editing fixes record and core without extending retention; draft stays intact',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);await page.locator('#textIn').fill('고칠 내용');await page.locator('#addBtn').click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0].createdAt);
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();await pending;
 await page.locator('#textIn').fill('다음 항목 초안');await page.locator('#micBtn').click();
 await page.locator('#tb .record-row').first().click();await page.locator('#detailEdit').click();
 await page.locator('#editUnit').fill('1401');await page.locator('#editText').fill('수정한 내용');await page.locator('#editSave').click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));
 assert.equal(saved.rows[0].createdAt,before);assert.equal(saved.rows[0].core,'1코어');assert.equal(saved.rows[0].unit,'1401');assert.equal(saved.rows[0].text,'수정한 내용');
 assert.equal(saved.rows[0].downloadRequestedAt,undefined);assert.equal(saved.draft,'다음 항목 초안');
 await page.evaluate(()=>recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'오래된 결과'}],{isFinal:true})]}));
 assert.equal(await page.locator('#tb .record-row').count(),0);assert.equal(await page.evaluate(()=>recognizers.length),2);
 await page.reload();await page.locator('#listAll').click();await page.locator('.group-toggle').filter({hasText:'1401호'}).click();assert.match(await page.locator('#tb').textContent(),/수정한 내용/);
});
test('R15: edit cannot revive a record expiring while the dialog is open',async t=>{
 const page=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[{dong:'101',unit:'1503',text:'만료 직전',createdAt:new Date(Date.parse('2026-09-22T03:00:00Z')-7*86400000+10000).toISOString()}]})),{clock:'2026-09-22T03:00:00Z'});
 await selectUnit(page);await page.locator('#tb .record-row').click();await page.locator('#detailEdit').click();await page.clock.fastForward(11000);await page.locator('#editSave').click();
 assert.match(await page.locator('#editWarn').textContent(),/보관 기간/);assert.equal(await page.locator('#tb .record-row').count(),0);
});


test('R16: single and all deletion can be restored without changing insertion order or dates',async t=>{
 const page=await pageFor(t);await selectUnit(page,'1401');await page.locator('#textIn').fill('먼저 입력');await page.locator('#addBtn').click();
 await selectUnit(page,'1501');await page.locator('#textIn').fill('나중 입력');await page.locator('#addBtn').click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows);
 await page.locator('#tb .record-row').first().click();await page.locator('#detailDelete').click();await page.locator('#restoreBtn').click();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows),before);
 await page.locator('#undoBtn').click();await page.locator('#listAll').click();await page.locator('.group-toggle').filter({hasText:'1401호'}).click();assert.match(await page.locator('#tb').textContent(),/먼저 입력/);assert.doesNotMatch(await page.locator('#tb').textContent(),/나중 입력/);
 await page.locator('#restoreBtn').click();
 page.once('dialog',d=>d.accept());await page.locator('#clearBtn').click();assert.equal(await page.locator('#tb .record-row').count(),0);
 await page.locator('#restoreBtn').click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows),before);
});
test('R16: deletion recovery cannot extend expiry and ends after ten seconds',async t=>{
 const page=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[{dong:'101',unit:'1503',text:'만료 직전',createdAt:'2026-09-15T03:00:03Z'}]})),{clock:'2026-09-22T03:00:00Z'});
 await page.locator('#undoBtn').click();await page.clock.fastForward(4000);await page.locator('#restoreBtn').click();
 assert.equal(await page.locator('#tb .record-row').count(),0);assert.match(await page.locator('#heard').textContent(),/보관 기간/);
 await selectUnit(page);await page.locator('#textIn').fill('새 기록');await page.locator('#addBtn').click();await page.locator('#undoBtn').click();
 await page.clock.fastForward(11000);assert.equal(await page.locator('#restoreNotice').isVisible(),false);
});


test('R18: compact rows open full details and allow edit while preserving draft',async t=>{
 const page=await pageFor(t);await selectUnit(page);
 const content='긴 내용 확인 '.repeat(35);await page.locator('#textIn').fill(content);await page.locator('#addBtn').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 assert.ok((await page.locator('#tb .record-text').boundingBox()).height<=46);
 await page.locator('#tb .record-row').click();assert.equal(await page.locator('#detailText').textContent(),content.trim());
 assert.match(await page.locator('#detailMeta').textContent(),/점검일.*코어/s);
 await page.locator('#detailEdit').click();await page.locator('#editText').fill('수정 내용');await page.locator('#editSave').click();
 assert.match(await page.locator('#tb').textContent(),/수정 내용/);
 await page.locator('#recentEdit').click();assert.equal(await page.locator('#editDialog').isVisible(),true);
 await page.locator('#editCancel').click();
});

test('R14: legacy oversized metadata is repairable and cannot create new unexportable rows',async t=>{
 const page=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[],current:{dong:'101',unit:'1503',spot:'가'.repeat(32768),trade:''}})));
 await page.locator('#textIn').fill('남겨 둘 내용');await page.locator('#addBtn').click();
 assert.equal(await page.locator('#tb .record-row').count(),0);assert.equal(await page.locator('#textIn').inputValue(),'남겨 둘 내용');
 await page.locator('#spots').getByRole('button',{name:'거실',exact:true}).click();await page.locator('#addBtn').click();
 assert.equal(await page.locator('#tb .record-row').count(),1);
});

function seedMany(){
 const rows=Array.from({length:125},(_,i)=>({dong:'101',unit:'1503',core:'2코어',spot:i%2?'거실':'침실1',trade:i%2?'타일':'도장',text:'확인 항목 '+String(i+1).padStart(3,'0')+' 벽면 보수 필요',createdAt:new Date().toISOString()}));
 for(let i=0;i<875;i++)rows.push({dong:String(102+Math.floor(i/100)),unit:String(1001+i%100),spot:'거실',trade:'타일',text:'다른 세대 확인 '+i,createdAt:new Date().toISOString()});
 localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows,current:{dong:'101',unit:'1503',spot:'거실',trade:'타일'}}));
 Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});
}

test('R19: 1000 records stay bounded; scope, search, trade and XLSX retain all data',async t=>{
 const page=await pageFor(t,seedMany);
 assert.equal(await page.locator('#listCurrent').getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('#cnt').textContent(),/1000건/);
 assert.equal(await page.locator('#tb .record-row').count(),20);
 assert.match(await page.locator('#tb .record-row').first().textContent(),/125/);
 await page.locator('.list-more').click();assert.equal(await page.locator('#tb .record-row').count(),40);
 await page.locator('#listSearch').fill('확인 007');assert.equal(await page.locator('#tb .record-row').count(),1);
 await page.locator('#listTrade').selectOption(JSON.stringify('타일'));assert.equal(await page.locator('#tb .record-row').count(),0);
 await page.locator('#listTrade').selectOption(JSON.stringify('도장'));assert.equal(await page.locator('#tb .record-row').count(),1);
 await page.locator('#copyBtn').click();assert.equal((await page.evaluate(()=>window.copied)).trim().split('\n').length,1001);
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();const download=await pending;
 const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
 const output=require('node:child_process').execFileSync(process.env.PYTHON_PATH||'python',['-c','import sys,io,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); t=E.fromstring(z.read("xl/worksheets/sheet1.xml")); print(len(t.findall(".//{*}row")))'],{input:Buffer.concat(chunks),encoding:'utf8'});
 assert.equal(Number(output.trim()),1004); // Four template rows and all 1000 records.
 await page.locator('#listReset').click();await page.locator('#listAll').click();
 assert.equal(await page.locator('.group-toggle').count(),20);assert.equal(await page.locator('#tb .record-row').count(),20);
 await page.locator('.list-more').filter({hasText:'20세대'}).click();assert.equal(await page.locator('.group-toggle').count(),40);
 await page.locator('#listSearch').fill('109동 다른');assert.ok(await page.locator('.group-toggle').count()>0);
 assert.equal(await page.locator('#tb .record-row').count(),0);
 await page.locator('.group-toggle').first().click();assert.equal(await page.locator('#tb .record-row').count(),1);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows.length),1000);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
});

test('R19: filtered detail edits and deletes exactly one row, and scope follows unit moves',async t=>{
 const page=await pageFor(t,seedMany);await page.locator('#listSearch').fill('007');
 await page.locator('.record-row').click();await page.locator('#detailEdit').click();await page.locator('#editText').fill('고친 한 항목');await page.locator('#editSave').click();
 assert.equal(await page.locator('.record-row').count(),0);
 let rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows);assert.equal(rows[6].text,'고친 한 항목');assert.match(rows[7].text,/008/);
 await page.locator('#listSearch').fill('고친');await page.locator('.record-row').click();await page.locator('#detailDelete').click();
 assert.equal(await page.locator('.record-row').count(),0);await page.locator('#restoreBtn').click();assert.equal(await page.locator('.record-row').count(),1);
 await page.locator('#listReset').click();await selectUnit(page,'1403');assert.equal(await page.locator('.record-row').count(),0);assert.match(await page.locator('#listSummary').textContent(),/1403호/);
 await page.locator('#listAll').click();await page.locator('.group-toggle').filter({hasText:'101동 1503호'}).click();assert.equal(await page.locator('.record-row').count(),20);
 await page.locator('.group-toggle').filter({hasText:'101동 1503호'}).click();assert.equal(await page.locator('.record-row').count(),0);
});

test('R19: read-only tab can browse and search without enabling mutations',async t=>{
 const page=await pageFor(t,seedMany);const second=await page.context().newPage();await second.goto(origin);await second.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 assert.equal(await second.locator('#addBtn').isDisabled(),true);
 await second.locator('#listSearch').fill('007');await second.locator('.record-row').click();
 assert.equal(await second.locator('#detailEdit').isDisabled(),true);assert.equal(await second.locator('#detailDelete').isDisabled(),true);
 await second.locator('#detailClose').click();assert.equal(await second.locator('#detailDialog').isVisible(),false);
});


test('R20: compact sticky context leaves room for rows on mobile; desktop and detail fit',async t=>{
 const page=await pageFor(t,seedMany);await page.emulateMedia({colorScheme:'dark'});
 await page.evaluate(()=>window.scrollTo(0,0));
 const original=(await page.locator('#ctx').boundingBox()).height;
 await page.evaluate(()=>window.scrollTo(0,document.querySelector('#tb').getBoundingClientRect().top+scrollY-55));
 await page.waitForFunction(()=>document.querySelector('#ctx').classList.contains('compact'));
 const compact=await page.locator('#ctx').boundingBox();assert.ok(compact.height<original && compact.height<=50);
 assert.ok(compact.y>=0 && compact.y<2);
 const visible=await page.locator('.record-row').evaluateAll(els=>els.filter(el=>{const r=el.getBoundingClientRect();return r.top>=50 && r.bottom<=innerHeight;}).length);
 assert.ok(visible>=7,'at least seven complete short records should fit below the compact header');
 await page.screenshot({path:path.join(root,'.test-output/compact-mobile-dark.png')});
 await page.evaluate(()=>window.scrollTo(0,document.querySelector('#listCard').getBoundingClientRect().top+scrollY-55));
 await page.screenshot({path:path.join(root,'.test-output/compact-mobile-controls.png')});
 await page.locator('#listAll').click();await page.locator('#listSearch').fill('101동');
 await page.screenshot({path:path.join(root,'.test-output/compact-mobile-groups.png')});
 await page.locator('.record-row').first().click();await page.screenshot({path:path.join(root,'.test-output/compact-mobile-detail.png')});await page.locator('#detailClose').click();
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>!document.querySelector('#ctx').classList.contains('compact'));
 assert.ok((await page.locator('#ctx').boundingBox()).height>=original);
 await page.setViewportSize({width:1280,height:900});await page.emulateMedia({colorScheme:'light'});
 await page.locator('#listCurrent').click();await page.locator('#listReset').click();
 await page.evaluate(()=>window.scrollTo(0,document.querySelector('#listCard').getBoundingClientRect().top+scrollY-120));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1280);
 await page.screenshot({path:path.join(root,'.test-output/compact-desktop.png')});
});


async function speak(page,text){
 await page.evaluate(text=>{const r=recognizers[recognizers.length-1];r.onresult({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});},text);
}
test('R21: speech preserves complete sentences and never guesses fields or executes commands',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);
 await page.locator('#spots').getByRole('button',{name:'거실',exact:true}).click();await page.locator('#trades').getByRole('button',{name:'타일',exact:true}).click();
 await page.locator('#micBtn').click();
 const samples=['균열 없음','양호 확인','발코니 확인','욕실 확인','침실1 도장  우측 벽\n균열 없음.','8미리미터 단차','십오 밀리 부족','단자 보수, 서고 확인','102동 1601호와 비교','삭제','취소','겸출 보수'];
 for(const sentence of samples)await speak(page,sentence);
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));
 assert.deepEqual(state.rows.map(r=>r.text),samples);
 assert.ok(state.rows.every(r=>r.dong==='101'&&r.unit==='1503'&&r.spot==='거실'&&r.trade==='타일'));
 assert.equal(state.current.spot,'거실');assert.equal(state.current.trade,'타일');
 await page.reload();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows.map(r=>r.text)),samples);
});
test('R21: keyboard input and draft saved during unit move preserve wording',async t=>{
 const page=await pageFor(t);await selectUnit(page);
 const raw='단자 보수  8밀리미터\n서고 이상 없음';await page.locator('#textIn').fill(raw);await page.locator('#addBtn').click();
 await page.locator('#textIn').fill('모르탈 15 미리');await selectUnit(page,'1403');await page.locator('#draftSaveMove').click();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows.map(r=>r.text)),[raw,'모르탈 15 미리']);
});


test('R22: review preserves original, learns only after opt-in, and remembers across reload',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);await page.locator('#micBtn').click();await speak(page,'겸출 보수');
 let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.equal(state.version,5);assert.equal(state.rows[0].text,'겸출 보수');
 const created=state.rows[0].createdAt;
 await page.locator('#recentReview').click();assert.equal(await page.locator('#rememberCorrection').isChecked(),false);
 await page.locator('#correctionChoices button').click();assert.equal(await page.locator('#detailText').textContent(),'견출 보수');
 state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.deepEqual(state.speechRules,[]);assert.equal(state.rows[0].inputText,'겸출 보수');assert.equal(state.rows[0].createdAt,created);
 await page.locator('#originalBlock summary').click();assert.equal(await page.locator('#originalText').textContent(),'겸출 보수');
 page.once('dialog',d=>d.accept());await page.locator('#restoreOriginal').click();assert.equal(await page.locator('#detailText').textContent(),'겸출 보수');
 await page.locator('#rememberCorrection').check();await page.locator('#correctionChoices button').click();
 await page.locator('#detailClose').click();await speak(page,'겸출  보수\n우측 이상 없음');
 state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));
 assert.deepEqual(state.speechRules,[{from:'겸출',to:'견출'}]);assert.equal(state.rows[1].text,'견출  보수\n우측 이상 없음');assert.equal(state.rows[1].inputText,'겸출  보수\n우측 이상 없음');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.context().setOffline(true);
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 await page.locator('#textIn').fill('겸출 타이핑');await page.locator('#addBtn').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[2].text),'견출 타이핑');
 await page.locator('#speechSetup summary').click();await page.getByRole('button',{name:'겸출 보정 기억 지우기'}).click();
 await page.locator('#textIn').fill('겸출 기억 해제 후');await page.locator('#addBtn').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[3].text),'겸출 기억 해제 후');
 await page.locator('#recentReview').click();await page.locator('#detailDialog').screenshot({path:path.join(root,'.test-output/speech-review-mobile.png')});
});
test('R22: original and correction history survive edit, delete recovery and export marker reset',async t=>{
 const page=await pageFor(t);await selectUnit(page);await page.locator('#textIn').fill('겸출 보수');await page.locator('#addBtn').click();
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();await pending;
 await page.locator('#recentReview').click();await page.locator('#correctionChoices button').click();
 let row=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0]);assert.equal(row.downloadRequestedAt,undefined);assert.equal(row.correctionLog[0].from,'겸출');
 await page.locator('#detailEdit').click();await page.locator('#editText').fill('직접 수정한 내용');await page.locator('#editSave').click();
 row=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0]);assert.equal(row.inputText,'겸출 보수');assert.deepEqual(row.correctionLog,[]);
 await page.locator('#recentReview').click();await page.locator('#originalBlock summary').click();page.once('dialog',d=>d.accept());await page.locator('#restoreOriginal').click();
 assert.equal(await page.locator('#detailText').textContent(),'겸출 보수');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0].createdAt),row.createdAt);
 await page.locator('#detailDelete').click();await page.locator('#restoreBtn').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0].inputText),'겸출 보수');
});
test('R22: read-only review cannot apply or remember, and expired records cannot be restored by correction',async t=>{
 const page=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[{dong:'101',unit:'1503',text:'겸출 보수',createdAt:'2026-09-15T03:00:10Z'}],current:{dong:'101',unit:'1503',spot:'',trade:''}})),{clock:'2026-09-22T03:00:00Z'});
 // Init scripts are context-wide: use the same fake clock to avoid aging the seed in the second page.
 const second=await page.context().newPage();await second.clock.install({time:new Date('2026-09-22T03:00:00Z')});await second.goto(origin);await second.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 await second.locator('.record-row').click();assert.equal(await second.locator('#correctionChoices button').isDisabled(),true);assert.equal(await second.locator('#rememberCorrection').isDisabled(),true);await second.close();
 // Re-open the authoritative state after the test-only seed script in the second page.
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 await page.locator('.record-row').click();await page.locator('#rememberCorrection').check();await page.clock.fastForward(11000);await page.locator('#correctionChoices button').click();
 assert.match(await page.locator('#detailWarn').textContent(),/보관 기간/);
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.equal(state.rows.length,0);assert.deepEqual(state.speechRules,[]);
});
test('R22: version 2 migration keeps rows and draft, bad rules preserve original storage',async t=>{
 const page=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:2,rows:[{dong:'101',unit:'1503',text:'기존 기록'}],draft:'기존 초안',current:{dong:'101',unit:'1503',spot:'',trade:''}})));
 assert.equal(await page.locator('#textIn').inputValue(),'기존 초안');await page.locator('#addBtn').click();
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.equal(state.version,5);assert.equal(state.rows[0].text,'기존 기록');assert.equal(state.rows[1].inputText,'기존 초안');
 const bad=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:3,rows:[],speechRules:[{from:'없음',to:'있음'}]})));
 assert.equal(await bad.locator('#storageRecovery').isVisible(),true);assert.deepEqual(await bad.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).speechRules),[{from:'없음',to:'있음'}]);
});
test('R22: failed registration retains raw draft before any remembered correction',async t=>{
 const page=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:3,rows:[],speechRules:[{from:'겸출',to:'견출'}]})));
 await page.locator('#textIn').fill('겸출 보수');await page.locator('#addBtn').click();assert.equal(await page.locator('#textIn').inputValue(),'겸출 보수');
 await selectUnit(page);await page.locator('#addBtn').click();const row=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0]);assert.equal(row.inputText,'겸출 보수');assert.equal(row.text,'견출 보수');
});


test('R23: automatic trade is decided per record, manual choice wins, source text stays intact',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);await page.locator('#tradeAuto').click();await page.locator('#micBtn').click();
 const texts=['침실1 벽지 이음부 들뜸','거실 창짝 개폐 불량','침실1 우측 벽 균열','공용욕실 세면대 배수 불량'];
 for(const text of texts)await speak(page,text);
 let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.deepEqual(state.rows.map(r=>r.text),texts);assert.deepEqual(state.rows.map(r=>r.trade),['도배','PL창호','','설비']);assert.equal(state.current.trade,'');
 await page.locator('#trades').getByRole('button',{name:'타일',exact:true}).click();assert.equal(await page.locator('#tradeModeNote').getAttribute('class'),'bad');assert.match(await page.locator('#tradeModeNote').textContent(),/수동 지정 중.*타일.*다음 입력에도 적용/);await speak(page,'벽지 이음부 들뜸');
 state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.equal(state.rows[4].trade,'타일');assert.equal(state.rows[4].tradeMode,'manual');
 await page.locator('#tradeAuto').click();assert.equal(await page.locator('#tradeModeNote').getAttribute('class'),'good');await speak(page,'오염 확인');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[5].trade),'');
 await page.locator('#listNeedsReview').click();assert.equal(await page.locator('.record-row').count(),2);
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert.equal(await page.locator('#tradeAuto').getAttribute('aria-pressed'),'true');
});
test('R28: six short phone findings switch trades per speech result and preserve originals',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);await page.locator('#tradeAuto').click();await page.locator('#micBtn').click();
 const phrases=['공용 욕실 바닥 타일 들뜸','거실 피엘 창호 손잡이 개폐 불량','주방 싱크대 하부 당 문 닫힌 불량','욕실 벽 타일 깨짐','안방 피엘 창호 손잡이 흔들림','싱크대 하부장 경첩 조정 필요'];
 for(const phrase of phrases)await speak(page,phrase);
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));
 assert.deepEqual(state.rows.map(row=>row.trade),['타일','PL창호','주방가구','타일','PL창호','주방가구']);
 assert.deepEqual(state.rows.map(row=>row.text),phrases);assert.deepEqual(state.rows.map(row=>row.inputText),phrases);
 assert.ok(state.rows.every(row=>row.tradeMode==='auto'));assert.equal(state.current.trade,'');
});

test('R27: voice registration maps explicit window and kitchen cabinet keywords',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);await page.locator('#tradeAuto').click();await page.locator('#micBtn').click();
 const phrases=['거실 창호 손잡이 잠금 불량 프레임은 이상 없음','싱크대 하부장 문이 닫히지 않음'];
 for(const phrase of phrases)await speak(page,phrase);
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));
 assert.deepEqual(state.rows.map(row=>row.text),phrases);
 assert.deepEqual(state.rows.map(row=>row.trade),['PL창호','주방가구']);
 assert.ok(state.trades.includes('PL창호'));assert.ok(state.trades.includes('주방가구'));
});
test('R23: edits recalculate automatic trade, manual edits clear review and stay protected',async t=>{
 const page=await pageFor(t);await selectUnit(page);await page.locator('#textIn').fill('벽지 이음부 들뜸');await page.locator('#addBtn').click();
 await page.locator('#recentEdit').click();assert.equal(await page.locator('#editTrade').inputValue(),'도배');await page.locator('#editText').fill('우측 벽 균열');await page.locator('#editSave').click();
 let row=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0]);assert.equal(row.trade,'');const created=row.createdAt;
 await page.locator('#listNeedsReview').click();await page.locator('.record-row').click();await page.locator('#detailEdit').click();await page.locator('#editTradeMode').selectOption('manual');await page.locator('#editTrade').fill('미장');await page.locator('#editSave').click();assert.equal(await page.locator('.record-row').count(),0);
 await page.locator('#recentEdit').click();await page.locator('#editText').fill('벽지 이음부 들뜸');await page.locator('#editSave').click();row=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0]);assert.equal(row.trade,'미장');assert.equal(row.createdAt,created);
});
test('R23: existing manual settings migrate without retroactive classification',async t=>{
 const page=await pageFor(t,()=>localStorage.setItem('punchlist.v2',JSON.stringify({version:3,rows:[{dong:'101',unit:'1503',text:'벽지 들뜸',trade:''}],current:{dong:'101',unit:'1503',spot:'거실',trade:'타일'}})));
 assert.equal(await page.locator('#tradeAuto').getAttribute('aria-pressed'),'false');await page.locator('#textIn').fill('창짝 개폐 불량');await page.locator('#addBtn').click();const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.equal(state.rows[0].trade,'');assert.equal(state.rows[1].trade,'타일');assert.equal(state.version,5);assert.ok(state.trades.includes('PL창호'));assert.ok(state.trades.includes('주방가구'));assert.ok(!state.trades.includes('창호'));
});


test('R23: correction and original restore recalculate only automatic trade',async t=>{
 const page=await pageFor(t);await selectUnit(page);await page.locator('#textIn').fill('겸출 보수');await page.locator('#addBtn').click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows[0]);
 const before=await read();assert.equal(before.trade,'');await page.locator('#recentReview').click();await page.locator('#correctionChoices button').click();
 let row=await read();assert.equal(row.trade,'골조견출');assert.equal(row.inputText,'겸출 보수');assert.equal(row.createdAt,before.createdAt);
 await page.locator('#originalBlock summary').click();page.once('dialog',d=>d.accept());await page.locator('#restoreOriginal').click();assert.equal((await read()).trade,'');
 await page.locator('#detailDialog').screenshot({path:path.join(root,'.test-output/trade-review-mobile.png')});
 await page.locator('#detailEdit').click();await page.locator('#editTradeMode').selectOption('manual');await page.locator('#editTrade').fill('미장');await page.locator('#editSave').click();
 await page.locator('#recentReview').click();await page.locator('#correctionChoices button').click();assert.equal((await read()).trade,'미장');
 await page.locator('#detailClose').click();await page.locator('#listNeedsReview').click();assert.equal(await page.locator('.record-row').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(root,'.test-output/trade-desktop.png'),fullPage:true});
});


test('R25: negative and uncertain speech needs review; adjacent drain words do not override wallpaper',async t=>{
 const page=await pageFor(t,fakeSpeech);await selectUnit(page);await page.locator('#tradeAuto').click();await page.locator('#micBtn').click();
 const phrases=['벽지 들뜸 없음','타일 깨짐 없음','벽지 보수가 필요할 수도 있음','타일 들뜸인 것 같음','타일 균열','조명 깜빡임','배수관 주변 벽지 들뜸','배수관 주변 벽지 들뜸 및 배수 불량'];
 for(const phrase of phrases)await speak(page,phrase);
 const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')).rows);
 assert.deepEqual(rows.map(row=>row.text),phrases);
 assert.deepEqual(rows.map(row=>row.trade),['','','','','타일','전기','도배','']);
 assert.deepEqual(rows.map(row=>row.tradeReason).slice(0,4),Array(4).fill('부정·추측 표현: 확인 필요'));
 await page.locator('#listNeedsReview').click();assert.equal(await page.locator('.record-row').count(),5);
});
test('R26: one manually corrected safe word can be opted into local learning',async t=>{
 const page=await pageFor(t);await selectUnit(page);
 await page.locator('#textIn').fill('벽치 들뜸');await page.locator('#addBtn').click();await page.locator('#recentEdit').click();
 await page.locator('#editText').fill('벽지 들뜸');assert.equal(await page.locator('#editLearnBox').isVisible(),true);assert.equal(await page.locator('#editLearn').isChecked(),false);await page.locator('#editDialog').screenshot({path:path.join(root,'.test-output/speech-learning-mobile.png')});
 await page.locator('#editSave').click();let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.deepEqual(state.speechRules,[]);
 await page.locator('#textIn').fill('벽치 재확인');await page.locator('#addBtn').click();await page.locator('#recentEdit').click();await page.locator('#editText').fill('벽지 재확인');
 await page.locator('#editLearn').check();await page.locator('#editSave').click();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.deepEqual(state.speechRules,[{from:'벽치',to:'벽지'}]);
 await page.locator('#textIn').fill('벽치 주변 들뜸');await page.locator('#addBtn').click();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.equal(state.rows[2].text,'벽지 주변 들뜸');assert.equal(state.rows[2].inputText,'벽치 주변 들뜸');
 await page.locator('#speechSetup summary').click();await page.getByRole('button',{name:'벽치 보정 기억 지우기'}).click();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchlist.v2')));assert.deepEqual(state.speechRules,[]);
});
