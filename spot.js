/* Extract explicit registered locations without changing the input text. */
(function(root){
 'use strict';
 const names=['현관','거실','주방','침실','안방','드레스룸','팬트리룸','부부욕실','공용욕실','욕실','대피공간','발코니','실외기실','복도','계단실창','계단실','엘리베이터홀'];
 const numerals=['','일','이','삼','사','오','육','칠','팔','구'];
 const compact=value=>String(value).replace(/\s+/g,'');
 function canonical(value){const name=compact(value);if(name==='엘베홀')return '엘리베이터홀';const m=/^(침실|발코니)([일이삼사오육칠팔구])$/.exec(name);return m ? m[1]+numerals.indexOf(m[2]) : name;}
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const literal=value=>Array.from(value).map(escape).join('\\s*');
 function classify(text,choices=[]){
  const registered=new Map();
  choices.filter(v=>typeof v==='string'&&v.trim()).forEach(v=>registered.set(canonical(v),v));
  const candidates=new Set([...names,...registered.keys()]);
  for(const base of ['침실','발코니'])for(let n=1;n<=9;n++)candidates.add(base+n);
  const found=[];
  candidates.forEach(name=>{
   if(!name||name.length>120)return;
   const patterns=[literal(name)+( /\d$/.test(name)?'(?!\\d)':'')];
   const numbered=/^(침실|발코니)([1-9])$/.exec(name);
   if(numbered)patterns.push(literal(numbered[1]+numerals[Number(numbered[2])])+'(?![가-힣\\d])');
   if(name==='엘리베이터홀')patterns.push(literal('엘베홀'));
   const re=new RegExp(patterns.join('|'),'gu');let match;
   while((match=re.exec(String(text||'')))!==null)found.push({name,index:match.index,end:match.index+match[0].length});
  });
  // Prefer full names (부부욕실, 침실12) over contained generic/prefix names.
  const distinct=Array.from(new Set(found.filter(a=>!found.some(b=>b!==a&&b.index<=a.index&&b.end>=a.end&&(b.end-b.index>a.end-a.index))).map(v=>v.name)));
  if(distinct.length>1)return {spot:'',kind:'review',reason:'여러 위치가 나옵니다. 직접 선택하세요.'};
  if(!distinct.length)return {spot:'',kind:'none',reason:'말한 위치 없음'};
  const name=distinct[0];
  if(!registered.has(name))return {spot:'',kind:'review',reason:'등록되지 않은 위치: '+name};
  return {spot:registered.get(name),kind:'matched',reason:'말한 위치 자동 인식'};
 }
 function resolve(text,choices,selected='',mode='auto'){
  if(mode==='manual')return {spot:selected,kind:'manual',reason:'선택 위치 고정'};
  const decision=classify(text,choices);
  if(decision.kind!=='none')return decision;
  return {spot:selected,kind:selected?'selected':'none',reason:selected?'말한 위치가 없어 선택 위치 사용':'위치 미지정 · 위치 버튼으로 선택하세요.'};
 }
 const api={classify,resolve};if(typeof module==='object'&&module.exports)module.exports=api;else root.PunchSpot=api;
})(typeof globalThis==='object'?globalThis:this);
