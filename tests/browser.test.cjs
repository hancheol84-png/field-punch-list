const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
let server, browser, origin;
before(async () => {
  server = http.createServer((req,res) => {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(err,data) => {
      if(err){res.writeHead(404).end();return;}
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json'};
      res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
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
  await page.goto(origin);
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
  assert.equal(await page.locator('#tb tr').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'unitIn');
  await page.reload();assert.equal(await page.locator('#textIn').inputValue(),'벽면 보수');
  await selectUnit(page);
  await page.locator('#textIn').dispatchEvent('keydown',{key:'Enter',isComposing:true});
  await page.locator('#textIn').dispatchEvent('keydown',{key:'Enter',keyCode:229});
  assert.equal(await page.locator('#tb tr').count(),0);
  await page.locator('#addBtn').click();
  assert.equal(await page.locator('#tb tr').count(),1);
  assert.equal(await page.locator('#textIn').inputValue(),'');
  await page.reload();assert.equal(await page.locator('#tb tr').count(),1);
});
test('R3: storage failure stays visible while rows remain exportable in memory',async t=>{
  const page=await pageFor(t,()=>{Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};});
  await selectUnit(page);await page.locator('#textIn').fill('천장 보수');await page.locator('#addBtn').click();
  assert.equal(await page.locator('#tb tr').count(),1);
  assert.equal(await page.locator('#storageWarn').isVisible(),true);
  assert.match(await page.locator('#storageWarn').textContent(),/저장되지/);
});

test('R5: creation time persists and export keeps each row date; old rows stay unknown',async t=>{
  const page=await pageFor(t,()=>{
    localStorage.setItem('punchTest.v1',JSON.stringify({rows:[{dong:'101',unit:'1501',text:'기존 항목'}, {dong:'101',unit:'1401',text:'어제 항목',createdAt:new Date(Date.now()-86400000).toISOString()}]}));
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});
  });
  assert.match(await page.locator('#tb').textContent(),/날짜 미상/);
  await page.locator('#copyBtn').click();
  const text=await page.evaluate(()=>window.copied);
  assert.match(text,/날짜 미상/);
  const yesterday=await page.evaluate(()=>{const d=new Date(Date.now()-86400000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');});
  assert.ok(text.includes(yesterday));
  await selectUnit(page);await page.locator('#textIn').fill('새 항목');await page.locator('#addBtn').click();
  const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('punchTest.v1')).rows);
  assert.ok(Number.isFinite(Date.parse(rows[2].createdAt)));
  assert.equal(rows[0].createdAt,undefined);
});

test('R4: browser downloads a real XLSX and failed clipboard shows selectable fallback',async t=>{
  const page=await pageFor(t,()=>{
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}}});
    document.execCommand=()=>false;
  });
  await selectUnit(page);await page.locator('#textIn').fill(' =1+1\t확인\n벽 보수');await page.locator('#addBtn').click();
  assert.equal(await page.locator('#tb tr').count(),1);
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
   const age=n=>new Date(Date.now()-n*86400000).toISOString();
   localStorage.setItem('punchTest.v1',JSON.stringify({rows:[
    {dong:'101',unit:'1501',text:'만료',createdAt:age(7)},
    {dong:'101',unit:'1502',text:'일일',createdAt:age(6)},
    {dong:'101',unit:'1503',text:'삼일',createdAt:age(4)},
    {dong:'101',unit:'1504',text:'미상'}]}));
 },{clock:'2026-09-22T03:00:00Z'});
 assert.equal(await page.locator('#tb tr').count(),3);
 const warning=await page.locator('#retentionWarn').textContent();
 assert.match(warning,/1건이 1일/);assert.match(warning,/1건이 3일/);assert.match(warning,/날짜 미상 1건/);
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();await pending;
 assert.match(await page.locator('#tb').textContent(),/요청 2026-09-22/);
 await page.clock.fastForward(86400000);
 assert.equal(await page.locator('#tb tr').count(),2);
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
 assert.equal(await page.locator('#tb tr').count(),0);
 await page.evaluate(()=>recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'거실 타일 벽면 보수 필요'}],{isFinal:true})]}));
 assert.equal(await page.locator('#tb tr').count(),1);
 await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));wakeResolvers.shift()();await Promise.resolve();});
 assert.equal(await page.evaluate(()=>released),1);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.evaluate(()=>recognizers.length),2);
 await page.locator('#micBtn').click();
 await page.evaluate(()=>recognizers[1].onresult({resultIndex:0,results:[Object.assign([{transcript:'추가되면 안 되는 항목'}],{isFinal:true})]}));
 assert.equal(await page.locator('#tb tr').count(),1);
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
 assert.equal(await page.locator('#tb tr').count(),1);
 const pending=page.waitForEvent('download');await page.locator('#downloadBtn').click();await pending;
 assert.ok(requests.every(url=>url.startsWith(origin+'/')||url.startsWith('blob:')));
 assert.ok((await page.evaluate(()=>caches.keys())).includes('unrelated-project-sentinel'));
 assert.match(await page.locator('#offlineNotice').textContent(),/오프라인/);
});
