const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../spot.js');
const choices=['주방','거실','침실1','침실2','침실3','팬트리룸','공용욕실','부부욕실','실외기실','발코니1'];
test('R36: explicit spoken room aliases fill only configured locations and leave text intact',()=>{
 for(const [text,spot] of [['침실 일 미장 보수','침실1'],['침실 이 석고 틈새 보수','침실2'],['침실 삼 벽지 들뜸','침실3'],['침실1벽지 보수','침실1'],['팬 트리룸 석고 틈새 보수','팬트리룸'],['부부 욕실 타일 깨짐','부부욕실'],['실외기 실 천장 보수','실외기실'],['발코니 일 페인트 박리','발코니1']])assert.equal(S.classify(text,choices).spot,spot,text);
 assert.equal(S.classify('침실 12 보수',choices).spot,'');assert.equal(S.classify('침실 이음부 보수',choices).spot,'');
 assert.equal(S.classify('침실 12 보수',[...choices,'침실12']).spot,'침실12');
 assert.equal(S.classify('침실1 15mm 단차',choices).spot,'침실1');assert.equal(S.classify('15mm 단차',choices).kind,'none');
});
test('R36: different, unknown and site-specific locations are never guessed from a fallback',()=>{
 for(const text of ['거실 및 주방 보수','안방 벽지 보수','엘베 홀 미장 보수','침실4 석고 보수','욕실 보수']){
  const result=S.resolve(text,choices,'팬트리룸');assert.equal(result.spot,'',text);assert.equal(result.kind,'review');
 }
 assert.equal(S.classify('안방 벽지 보수',[...choices,'안방']).spot,'안방');
 assert.equal(S.classify('엘베 홀 미장 보수',[...choices,'엘리베이터홀']).spot,'엘리베이터홀');
 assert.equal(S.classify('엘베 홀 미장 보수',[...choices,'엘베홀']).spot,'엘베홀');
 assert.equal(S.classify('부부욕실 주변',[...choices,'욕실']).spot,'부부욕실');
 assert.equal(S.classify('구역(A) 보수',['구역(A)']).spot,'구역(A)');
});
test('R36: automatic location is per record while explicit fixed selection wins',()=>{
 assert.equal(S.resolve('침실 이 석고 보수',choices,'팬트리룸').spot,'침실2');
 assert.equal(S.resolve('석고 보수',choices,'팬트리룸').spot,'팬트리룸');
 assert.equal(S.resolve('침실 이 석고 보수',choices,'팬트리룸','manual').spot,'팬트리룸');
 assert.equal(S.resolve('석고 보수',choices).spot,'');
});
