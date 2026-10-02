/* Exact whole-word suggestions only. Learned corrections stay local and explicit. */
(function(root){
  'use strict';
  const pairs=[['겸출','견출'],['경출','견출'],['할썩','할석'],['곧조벽','골조벽'],['골초벽','골조벽'],['드래스룸','드레스룸'],['드레쓰룸','드레스룸'],['글라인딩','그라인딩'],['수편불량','수평불량'],['개패불량','개폐불량']];
  const catalog=new Map(pairs);
  const protectedWords=new Set(['좌측','우측','좌우','왼쪽','오른쪽','상부','하부','상단','하단','위쪽','아래쪽','내부','외부','전면','후면','앞쪽','뒤쪽','없음','있음','정상','양호','불량','이상','이하','초과','미만','필요','불필요','미리','밀리미터','센티미터','미터']);
  const directionalParts=['좌','우','상부','하부','상단','하단','위쪽','아래쪽','윗','밑','내부','외부','전면','후면','앞쪽','뒤쪽','오른쪽','왼쪽','미리','밀리','센티','미터','없','있','아님','아닌','양호','정상','불량','이상','이하','초과','미만','필요','가능','의심','추정','미확인'];
  const safeWord=value=>typeof value==='string' && /^[가-힣]{2,16}$/.test(value) && !protectedWords.has(value) && !directionalParts.some(part=>value.includes(part));
  function validRule(rule){return !!rule && typeof rule.from==='string' && typeof rule.to==='string' && rule.from!==rule.to && (catalog.get(rule.from)===rule.to || safeWord(rule.from)&&safeWord(rule.to));}
  function validRules(rules){return Array.isArray(rules) && rules.length<=50 && rules.every(validRule) && new Set(rules.map(r=>r.from)).size===rules.length;}
  function correctionCandidate(before,after,rules=[]){
    if(!validRules(rules))throw new Error('Invalid correction rules');
    if(rules.length>=50)return null;
    const source=String(before||''),corrected=String(after||'');
    const left=Array.from(source.matchAll(/[\p{L}\p{N}_]+/gu)),right=Array.from(corrected.matchAll(/[\p{L}\p{N}_]+/gu));
    if(left.length!==right.length)return null;
    const changed=[];
    for(let i=0;i<left.length;i++)if(left[i][0]!==right[i][0])changed.push({from:left[i][0],to:right[i][0],start:left[i].index,end:left[i].index+left[i][0].length});
    if(changed.length!==1)return null;
    const rule=changed[0];
    if(!safeWord(rule.from)||!safeWord(rule.to)||left.filter(word=>word[0]===rule.from).length!==1||rules.some(item=>item.from===rule.from))return null;
    if(source.slice(0,rule.start)+rule.to+source.slice(rule.end)!==corrected)return null;
    return {from:rule.from,to:rule.to};
  }
  function analyze(text,rules=[]){
    if(!validRules(rules))throw new Error('Invalid correction rules');
    const approved=new Map(rules.map(r=>[r.from,r.to])),applied=new Map(),suggestions=new Map();
    function count(map,from,to){const item=map.get(from)||{from,to,count:0};item.count++;map.set(from,item);}
    const result=text.replace(/[\p{L}\p{N}_]+/gu,word=>{
      const to=approved.get(word)||catalog.get(word);if(!to)return word;
      if(approved.has(word)){count(applied,word,to);return to;}
      count(suggestions,word,to);return word;
    });
    return {text:result,applied:Array.from(applied.values()),suggestions:Array.from(suggestions.values())};
  }
  const api={analyze,validRule,validRules,correctionCandidate};
  if(typeof module==='object' && module.exports)module.exports=api;else root.PunchSpeech=api;
})(typeof globalThis==='object' && globalThis ? globalThis : this);
