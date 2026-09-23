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
 for(const row of tsv.split('\n'))assert.equal(row.split('\t').length,8);
 assert.ok(tsv.includes("' =1+1"));assert.ok(tsv.includes("'+문자"));assert.ok(tsv.includes("'@문자"));
 const groups=X.sheets(rows);assert.equal(new Set(groups.map(g=>g.name.toLowerCase())).size,groups.length);
 assert.ok(groups.every(g=>g.name.length<=31&&!/[\[\]:*?/\\]/.test(g.name)));
 assert.doesNotMatch(X.filename('샘플/현장:?'),/[<>:"/\\|?*]/);
 assert.throws(()=>X.xlsx([]),/기록/);
});


test('R24: eighth review column, yellow cells and pending sheet keep unresolved records visible',()=>{
 const records=[{dong:'101',unit:'1503',trade:'',text:'우측 벽 균열'},{dong:'101',unit:'1403',trade:'도배',text:'벽지 들뜸'},{dong:'101',unit:'1303',trade:'공종 확인필요',text:'직접 지정 이름 충돌 시험'}];
 const bytes=X.xlsx(records,'샘플현장','');const result=execFileSync(process.env.PYTHON_PATH||'python',[path.join(__dirname,'verify_xlsx.py'),'--review'],{input:bytes,encoding:'utf8'});assert.match(result,/OK/);
 const lines=X.tsv(records).split('\n');assert.equal(lines[0].split('\t')[7],'확인사항');assert.equal(lines[1].split('\t')[7],'공종 확인필요');assert.equal(lines[2].split('\t')[7],'');
 assert.equal(X.sheets([{trade:'  ',text:'공종 빈칸'}])[1].name,'공종 확인필요');
 assert.equal(X.sheets([{trade:'도배',text:'벽지 보수'}]).some(s=>s.name==='공종 확인필요'),false);
});
