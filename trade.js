/* Conservative, local trade suggestions. Never rewrites the record text. */
(function(root){
 'use strict';
 const REVIEW='공종 확인필요';
 const rules=[
  ['도배',/벽지|도배/,/이음|들뜸|찢|벌어|오염|누락|마감|보수|불량|교체/],
  ['창호',/창짝|창문|샷시|샤시|창호/,/개폐|잠금|잠기|레일|열리|닫히|닫힘|손잡이|유리/],
  ['타일',/타일/,/깨짐|깨진|파손|들뜸|줄눈|단차|탈락|누락|보수|불량/],
  ['설비',/세면대|변기|수전|배수관|급수관|배수구|트랩/,/배수|누수|막힘|막힌|급수|수압|누설|고정|파손|교체|보수|불량/],
  ['전기',/콘센트|스위치|등기구|조명/,/전원|작동|점등|누전|결선|전선/],
  ['도장',/페인트|도장면|도장부/,/벗겨|벗김|벗겨짐|흘러|흐름|얼룩|누락|박리|보수|불량/],
  ['골조견출',/견출/,/보수|불량|누락|필요/],
  ['골조할석',/할석/,/필요|보수|불량|누락/]
 ];
 function classify(text){
  const source=String(text||'');
  if(/아님|아니라|아닌|제외|말고|또는|인지|가능성|추정|의심/.test(source))return {trade:'',reason:'단정하기 어려운 표현'};
  const hits=rules.filter(([,object,issue])=>object.test(source)&&issue.test(source)).map(([trade])=>trade);
  if(hits.length===1)return {trade:hits[0],reason:'대상과 내용이 일치하는 규칙'};
  return {trade:'',reason:hits.length ? '여러 공종 단서: '+hits.join(' · ') : '공종을 정할 단서 부족'};
 }
 function needsReview(row){return !String(row.trade||'').trim();}
 function note(row){return needsReview(row)?REVIEW:'';}
 const api={classify,needsReview,note,REVIEW};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PunchTrade=api;
})(typeof globalThis==='object'?globalThis:this);
