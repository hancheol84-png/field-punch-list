const {test}=require('node:test'),assert=require('node:assert/strict'),T=require('../trade.js');
test('R28: short on-device findings and cabinet speech spacing classify without rewriting',()=>{
 const samples=[
  ['공용 욕실 바닥 타일 들뜸','타일'],
  ['거실 피엘 창호 손잡이 개폐 불량','PL창호'],
  ['주방 싱크대 하부 당 문 닫힌 불량','주방가구'],
  ['욕실 벽 타일 깨짐','타일'],
  ['안방 피엘 창호 손잡이 흔들림','PL창호'],
  ['싱크대 하부장 경첩 조정 필요','주방가구'],
  ['싱크대 하 부 장 문 닫힘 불량','주방가구'],
  ['싱크대 상부 당 경첩 조정 필요','주방가구'],
  ['거실 창 호 손잡이 개폐 불량','PL창호']
 ];
 for(const [text,trade] of samples)assert.equal(T.classify(text).trade,trade,text);
 for(const text of ['안방 붙박이장 하부장 문 닫힘 불량','싱크대 하부 단차','싱크대 하부 당과 타일 들뜸','싱크대 하부 당 고장 의심'])assert.equal(T.classify(text).trade,'',text);
});

test('R23: clear object and issue rules classify without changing text',()=>{
 for(const [text,trade] of [['침실1 벽지 이음부 들뜸','도배'],['거실 창짝 개폐 불량','PL창호'],['공용욕실 세면대 배수 불량','설비'],['주방 타일 줄눈 탈락','타일'],['페인트 벗겨짐','도장'],['콘센트 전원 불량','전기']])assert.equal(T.classify(text).trade,trade,text);
});

test('R27: explicit window and kitchen cabinet keywords map to the requested trades',()=>{
 for(const [text,trade] of [
  ['창호','PL창호'],
  ['거실 창호 손잡이 잠금 불량, 프레임은 이상 없음','PL창호'],
  ['싱크대 하부장 문이 닫히지 않음','주방가구'],
  ['주방가구 경첩 파손','주방가구']
 ])assert.equal(T.classify(text).trade,trade,text);
 assert.equal(T.classify('창호와 싱크대 하부장 모두 확인').trade,'');
 assert.equal(T.classify('창호 의심').trade,'');
});
test('R23: generic, missing, competing and uncertain clues require review',()=>{
 for(const text of ['침실1 우측 벽 균열','공용욕실 오염','줄눈 탈락','문틀 틈새','벽지','벽지는 양호, 창짝 개폐 불량과 도배 보수','벽지 또는 페인트 보수','타일 아님, 벽지 들뜸'])assert.equal(T.classify(text).trade,'',text);
 assert.equal(T.classify('창틀 주변 벽지 들뜸').trade,'도배');assert.equal(T.classify('콘센트 주변 벽지 찢어짐').trade,'도배');
 assert.equal(T.note({trade:''}),'공종 확인필요');assert.equal(T.note({trade:'  '}),'공종 확인필요');assert.equal(T.note({trade:'직접 지정'}),'');
});


test('R25: negated and tentative findings stay unassigned for review',()=>{
 for(const text of ['벽지 들뜸 없음','타일 깨짐 없음','세면대 누수 없음','창짝 개폐 불량 없음','페인트 박리 없음','견출 보수 불필요','벽지 보수가 필요할 수도 있음','타일 들뜸인 것 같음','창호 의심','누수 여부 확인']){
  const result=T.classify(text);assert.equal(result.trade,'',text);assert.match(result.reason,/부정·추측/);
 }
});

test('R25: common explicit defect terms classify by their stated object and nearby symptom',()=>{
 for(const [text,trade] of [['벽지 손상','도배'],['타일 균열','타일'],['조명 깜빡임','전기'],['스위치 고정 불량','전기'],['페인트 기포','도장'],['페인트 균열','도장'],['배수관 주변 벽지 들뜸','도배'],['세면대 배수관 파손','설비']])assert.equal(T.classify(text).trade,trade,text);
});

test('R25: object names alone do not impersonate symptoms; mixed clues remain reviewable',()=>{
 for(const text of ['배수관','배수관 점검','등기구','벽지 또는 페인트 보수','배수관 주변 벽지 들뜸 및 배수 불량'])assert.equal(T.classify(text).trade,'',text);
 assert.match(T.classify('배수관 주변 벽지 들뜸 및 배수 불량').reason,/여러 .*확인 필요/);
});
