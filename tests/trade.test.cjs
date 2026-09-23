const {test}=require('node:test'),assert=require('node:assert/strict'),T=require('../trade.js');
test('R23: clear object and issue rules classify without changing text',()=>{
 for(const [text,trade] of [['침실1 벽지 이음부 들뜸','도배'],['거실 창짝 개폐 불량','창호'],['공용욕실 세면대 배수 불량','설비'],['주방 타일 줄눈 탈락','타일'],['페인트 벗겨짐','도장'],['콘센트 전원 불량','전기']])assert.equal(T.classify(text).trade,trade,text);
});
test('R23: generic, missing, competing and uncertain clues require review',()=>{
 for(const text of ['침실1 우측 벽 균열','공용욕실 오염','줄눈 탈락','문틀 틈새','벽지','벽지는 양호, 창짝 개폐 불량과 도배 보수','벽지 또는 페인트 보수','타일 아님, 벽지 들뜸'])assert.equal(T.classify(text).trade,'',text);
 assert.equal(T.classify('창틀 주변 벽지 들뜸').trade,'도배');assert.equal(T.classify('콘센트 주변 벽지 찢어짐').trade,'도배');
 assert.equal(T.note({trade:''}),'공종 확인필요');assert.equal(T.note({trade:'  '}),'공종 확인필요');assert.equal(T.note({trade:'직접 지정'}),'');
});
