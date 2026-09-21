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
async function pageFor(t, init){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul'});
  t.after(()=>context.close());
  if(init) await context.addInitScript(init);
  const page=await context.newPage();
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
