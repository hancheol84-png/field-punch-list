/* Conservative, local trade suggestions. Never rewrites the record text. */
(function(root){
 'use strict';
 const REVIEW='공종 확인필요';
 const rules=[
  ['도배',/벽지|도배/,/이음|들뜸|찢|벌어|오염|누락|마감|보수|불량|교체|손상|파손/],
  ['PL창호',/창짝|창문|샷시|샤시|창호/,/개폐|잠금|잠기|레일|열리|닫히|닫힘|손잡이|유리|고정|흔들|유격|파손|보수|불량|이탈|뒤틀/],
  ['타일',/타일/,/깨짐|깨진|파손|들뜸|줄눈|단차|탈락|누락|보수|불량|균열|크랙|이색|오염/],
  ['설비',/세면대|변기|수전|배수관|급수관|배수구|트랩/,/배수|누수|막힘|막힌|급수|수압|누설|고정|파손|교체|보수|불량|미설치|탈락|들뜸|마감/],
  ['전기',/콘센트|스위치|등기구|조명/,/전원|작동|점등|누전|결선|전선|깜빡|점멸|불점등|고정|파손|충전|흔들|누락|불량/],
  ['도장',/페인트|도장면|도장부/,/벗겨|벗김|벗겨짐|흘러|흐름|얼룩|누락|박리|보수|불량|기포|핀홀|갈라|균열|들뜸/],
  ['골조견출',/견출/,/보수|불량|누락|필요/],
  ['골조할석',/할석/,/필요|보수|불량|누락/],
  ['미장',/미\s*장/,/보수|필요|불량|누락|단차|균열|틈\s*새|마감/],
  ['내장',/석\s*고/,/틈\s*새|보수|불량|누락|마감|파손|이음|단차|벌어|깨짐/]
 ];
 const explicitTrades=[
  ['PL창호',/창\s*호/],
  // Classifier-only aliases: keep the recognized sentence and measurements intact.
  ['주방가구',/(?:싱\s*크\s*대\s*(?:하\s*부\s*[장당]|상\s*부\s*[장당])|주\s*방\s*가\s*구)/]
 ];
 const uncertainPattern=/가능성|추정|의심|미확인|불명확|필요할 수도|수도 있|것 같|같음|같아요|듯함|듯하다|듯한|듯해 보|모르겠|일지도|또는|인지|여부/;
 const negatedPattern=/없음|없습니다|없고|없는지|없어서|없으니|없으면|양호|정상|문제없|이상없|불필요|아님|아니라|아닌|아닐|제외|말고/;
 function matches(source,pattern){
  const re=new RegExp(pattern.source,pattern.flags.replace(/g/g,'')+'g'),out=[];let match;
  while((match=re.exec(source))!==null){out.push({index:match.index,end:match.index+match[0].length});if(!match[0].length)re.lastIndex++;}
  return out;
 }
 // 대상 이름 안에 우연히 포함된 증상(배수관의 ‘배수’)은 증거가 아니다.
 // 문장에 여러 대상이 있으면 각 증상을 가장 가까운 대상으로 연결한다.
 function relatedTrades(source){
  const objects=[],issueGroups=new Map();
  rules.forEach(([trade,objectPattern,issuePattern])=>{
   matches(source,objectPattern).forEach(object=>objects.push({trade,index:object.index,end:object.end}));
   matches(source,issuePattern).forEach(issue=>{
    const key=issue.index+':'+issue.end;
    if(!issueGroups.has(key))issueGroups.set(key,{index:issue.index,end:issue.end});
   });
  });
  const hits=new Set();
  issueGroups.forEach(issue=>{
   const distances=objects.map(object=>({trade:object.trade,object,distance:Math.max(0,object.index-issue.end,issue.index-object.end)}))
    .filter(candidate=>candidate.distance<=16)
    .filter(candidate=>!(issue.index<candidate.object.end&&issue.end>candidate.object.index));
   if(!distances.length)return;
   const closest=Math.min(...distances.map(candidate=>candidate.distance));
   distances.filter(candidate=>candidate.distance===closest).forEach(candidate=>hits.add(candidate.trade));
  });
  return Array.from(hits);
 }
 function classify(text){
  const source=String(text||'');
  if(uncertainPattern.test(source))return {trade:'',reason:'부정·추측 표현: 확인 필요'};
  const explicit=Array.from(new Set(explicitTrades.filter(([,pattern])=>pattern.test(source)).map(([trade])=>trade)));
  if(explicit.length>1)return {trade:'',reason:'여러 공종 단서: 확인 필요'};
  if(explicit.length===1){
   const otherObjects=rules.some(([trade,objectPattern])=>trade!==explicit[0]&&objectPattern.test(source));
   if(otherObjects)return {trade:'',reason:'여러 대상과 증상: 확인 필요'};
   return {trade:explicit[0],reason:'명시된 공종 키워드'};
  }
  const distinctObjects=new Set(rules.filter(([,object])=>object.test(source)).map(([trade])=>trade));
  if(distinctObjects.has('미장') && ['내장','골조견출','골조할석'].some(trade=>distinctObjects.has(trade)))return {trade:'',reason:'여러 작업 단서: 확인 필요'};
  if(distinctObjects.size>1 && /[,，、;；]|\s및\s|\s그리고\s/.test(source))return {trade:'',reason:'여러 대상과 증상: 확인 필요'};
  if(negatedPattern.test(source))return {trade:'',reason:'부정·추측 표현: 확인 필요'};
  const hits=relatedTrades(source);
  if(hits.length===1)return {trade:hits[0],reason:'대상과 내용이 일치하는 규칙'};
  return {trade:'',reason:hits.length ? '여러 공종 단서: '+hits.join(' · ') : '공종을 정할 단서 부족'};
 }
 function needsReview(row){return !String(row.trade||'').trim();}
 function note(row){return needsReview(row)?REVIEW:'';}
 const api={classify,needsReview,note,REVIEW};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PunchTrade=api;
})(typeof globalThis==='object'?globalThis:this);
