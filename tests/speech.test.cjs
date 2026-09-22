const {test}=require('node:test');
const assert=require('node:assert/strict');
const Speech=require('../speech.js');
test('R22: unconfirmed suggestions never change wording, dimensions or valid construction terms',()=>{
 for(const raw of ['균열 없음','양호','발코니','욕실','8미리미터','삼십 미리','단자/단차 서고/석고 그라인더/그라인딩 모르탈/몰탈','겸출 보수, 할썩 필요','좌측 2개 부족, 우측 0.8mm 이상 없음'])assert.equal(Speech.analyze(raw).text,raw);
 assert.deepEqual(Speech.analyze('겸출 보수').suggestions,[{from:'겸출',to:'견출',count:1}]);
});
test('R22: confirmed corrections match whole words once and preserve whitespace and punctuation',()=>{
 const rules=[{from:'겸출',to:'견출'}];
 const result=Speech.analyze('겸출  보수\n(겸출), 겸출부 겸출1 겸출_확인 할썩',rules);
 assert.equal(result.text,'견출  보수\n(견출), 겸출부 겸출1 겸출_확인 할썩');
 assert.equal(result.applied[0].count,2);assert.equal(result.suggestions[0].from,'할썩');
 assert.equal(Speech.analyze(result.text,rules).text,result.text);
});
test('R22: rules cannot invent numbers, directions, unsupported substitutions or duplicate mappings',()=>{
 for(const rules of [[{from:'균열',to:'단열'}],[{from:'8',to:'9'}],[{from:'좌측',to:'우측'}],[{from:'겸출',to:'견출'},{from:'겸출',to:'견출'}],null])assert.equal(Speech.validRules(rules),false);
 assert.equal(Speech.validRules([]),true);assert.throws(()=>Speech.analyze('원문',[{from:'없음',to:'있음'}]));
});
