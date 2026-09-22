/* Exact whole-word suggestions only. No phonetic guessing or number conversion. */
(function(root){
  'use strict';
  const pairs=[['겸출','견출'],['경출','견출'],['할썩','할석'],['곧조벽','골조벽'],['골초벽','골조벽'],['드래스룸','드레스룸'],['드레쓰룸','드레스룸'],['글라인딩','그라인딩'],['수편불량','수평불량'],['개패불량','개폐불량']];
  const catalog=new Map(pairs);
  function validRule(rule){return !!rule && typeof rule.from==='string' && typeof rule.to==='string' && catalog.get(rule.from)===rule.to;}
  function validRules(rules){return Array.isArray(rules) && rules.length<=pairs.length && rules.every(validRule) && new Set(rules.map(r=>r.from)).size===rules.length;}
  function analyze(text,rules=[]){
    if(!validRules(rules))throw new Error('Invalid correction rules');
    const approved=new Set(rules.map(r=>r.from)),applied=new Map(),suggestions=new Map();
    function count(map,from,to){const item=map.get(from)||{from,to,count:0};item.count++;map.set(from,item);}
    const result=text.replace(/[\p{L}\p{N}_]+/gu,word=>{
      const to=catalog.get(word);if(!to)return word;
      if(approved.has(word)){count(applied,word,to);return to;}
      count(suggestions,word,to);return word;
    });
    return {text:result,applied:Array.from(applied.values()),suggestions:Array.from(suggestions.values())};
  }
  const api={analyze,validRule,validRules};
  if(typeof module==='object' && module.exports)module.exports=api;else root.PunchSpeech=api;
})(typeof globalThis==='object'?globalThis:this);
