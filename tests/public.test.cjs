const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('public assets have no remote runtime resources or spreadsheet files', () => {
  const files = execFileSync('git', ['ls-files'], {cwd:root, encoding:'utf8'}).trim().split('\n');
  assert.equal(files.filter(f => /\.(xlsx?|xlsm|xlsb|csv|tsv)$/i.test(f)).length, 0);
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.equal(html.includes('\0'), false, 'HTML must stay text-searchable');
  assert.doesNotMatch(html, /(?:src|href)=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(html, /(?:fetch|importScripts)\s*\(\s*["']https?:/i);
  assert.match(html, /site: "샘플현장"/);
  const data = JSON.parse(fs.readFileSync(path.join(root,'data/punch_terms.json'),'utf8'));
  assert.deepEqual(Object.keys(data['출처']), ['설명']);
  assert.doesNotMatch(JSON.stringify(data), /[가-힣]{2,4}\s+(?:기사|대리|과장|차장|부장|팀장|사원)(?:\s|[)\]])/);
  assert.doesNotMatch(JSON.stringify(data), /(?:\+82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}/);
  assert.equal(fs.existsSync(path.join(root,'scripts/extract_punch_terms.py')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'.gitignore'),'utf8'), /^!.*xlsx/m);
});

test('R10: help explains local records, expiry, speech and device verification',()=>{
 const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
 for(const phrase of ['7일','자판 마이크','실기기 필요','punchlist.v2','오프라인'])assert.ok(readme.includes(phrase));
 assert.ok(fs.existsSync(path.join(root,'.nojekyll')));
 assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/30초 사용법/);
});

test('R32: pilot assets match reviewed sources; manifests and public configuration stay separate',()=>{
 const expected=require('../scripts/build-pilot.cjs').artifacts();
 for(const [name,content] of Object.entries(expected))assert.equal(fs.readFileSync(path.join(root,'pilot',name),'utf8'),content,name);
 const html=expected['index.html'];assert.match(html,/PunchPilotRequired=true/);assert.doesNotMatch(html,/(?:src|href)=["'](?:https?:)?\/\//i);
 const manifest=JSON.parse(expected['manifest.webmanifest']);assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.id,'./');assert.match(manifest.name,/시범운영/);
 const context={};require('node:vm').runInNewContext(fs.readFileSync(path.join(root,'cloud-config.js'),'utf8'),context);assert.equal(context.PunchCloudConfig.enabled,false);assert.equal(context.PunchCloudConfig.url,'');
});
