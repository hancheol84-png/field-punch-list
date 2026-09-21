const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const X=require('../export.js');
const rows=[
 {dong:'102',core:'1코어',unit:'1401',trade:'A/B',text:'@문자'},
 {dong:'101',core:'2코어',unit:'1503',trade:'A:B',text:'+문자'},
 {dong:'101',core:'1코어',unit:'1401',trade:'전체',text:'-문자'},
 {dong:'101',core:'1코어',unit:'1501',trade:'A/B',text:' =1+1\t줄\n보수 <&> "따옴표"'}
];
test('R4: generated workbook opens with independent OOXML reader and safe text',()=>{
 const bytes=X.xlsx(rows,'샘플현장','점검자 A');
 const result=execFileSync(process.env.PYTHON_PATH||'python',[path.join(__dirname,'verify_xlsx.py'),'--fixture'],{input:bytes,encoding:'utf8'});
 assert.match(result,/OK/);
});
test('R4: TSV is rectangular and protects formula prefixes; names stay valid and unique',()=>{
 const tsv=X.tsv(rows);assert.equal(tsv.split('\n').length,5);
 for(const row of tsv.split('\n'))assert.equal(row.split('\t').length,7);
 assert.ok(tsv.includes("' =1+1"));assert.ok(tsv.includes("'+문자"));assert.ok(tsv.includes("'@문자"));
 const groups=X.sheets(rows);assert.equal(new Set(groups.map(g=>g.name.toLowerCase())).size,groups.length);
 assert.ok(groups.every(g=>g.name.length<=31&&!/[\[\]:*?/\\]/.test(g.name)));
 assert.doesNotMatch(X.filename('샘플/현장:?'),/[<>:"/\\|?*]/);
 assert.throws(()=>X.xlsx([]),/기록/);
});
