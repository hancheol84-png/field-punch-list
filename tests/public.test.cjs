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
  assert.doesNotMatch(html, /(?:src|href)=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(html, /(?:fetch|importScripts)\s*\(\s*["']https?:/i);
  assert.match(html, /site: "샘플현장"/);
  const data = JSON.parse(fs.readFileSync(path.join(root,'data/punch_terms.json'),'utf8'));
  assert.deepEqual(Object.keys(data['출처']), ['설명']);
  assert.equal(fs.existsSync(path.join(root,'scripts/extract_punch_terms.py')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'.gitignore'),'utf8'), /^!.*xlsx/m);
});
