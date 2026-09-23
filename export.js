/* Dependency-free OOXML + ZIP STORE export. All user values are string cells. */
(function(root){
'use strict';
const HEADERS=['점검일','동','코어','호수','위치','공종','내용','확인사항'];
const REVIEW='공종 확인필요';
function needsReview(r){return !String(r.trade||'').trim();}
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG='http://schemas.openxmlformats.org/package/2006/relationships';
const encoder=new TextEncoder();
function xml(value){
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu,'')
    .replace(/_x[0-9a-f]{4}_/gi,m=>'_x005F_'+m.slice(1))
    .replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function day(iso){
  if(typeof iso!=='string' || !Number.isFinite(Date.parse(iso))) return '날짜 미상';
  const d=new Date(iso);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function sort(rows){
  const compare=(a,b)=>String(a??'').localeCompare(String(b??''),'ko',{numeric:true});
  const floor=u=>Math.floor((parseInt(u,10)||0)/100);
  return rows.slice().sort((a,b)=>compare(a.dong,b.dong)||compare(a.core,b.core)||floor(b.unit)-floor(a.unit)||compare(a.unit,b.unit));
}
function values(r){return [day(r.createdAt),r.dong,r.core||'',r.unit,r.spot||'',needsReview(r)?'':r.trade,r.text,needsReview(r)?REVIEW:''];}
function tsv(rows){
  const cell=v=>{
    let s=String(v??'').replace(/[\t\r\n\u0000-\u001F\u007F\u2028\u2029]/g,' ');
    if(/^\s*[=+\-@]/u.test(s)) s="'"+s;
    return s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  return [HEADERS,...sort(rows).map(values)].map(r=>r.map(cell).join('\t')).join('\n');
}
function filename(site,now=new Date()){
  const safe=String(site||'샘플현장').replace(/[<>:"/\\|?*\u0000-\u001F]/g,'_').replace(/[. ]+$/,'').slice(0,60)||'샘플현장';
  return '펀치리스트_'+safe+'_'+day(now.toISOString()).replaceAll('-','')+'.xlsx';
}
function sheets(rows){
  const ordered=sort(rows),groups=[{name:'전체',rows:ordered}];
  const pending=ordered.filter(needsReview);if(pending.length)groups.push({name:REVIEW,rows:pending});
  const byTrade=new Map();
  ordered.filter(r=>!needsReview(r)).forEach(r=>{const key=r.trade;if(!byTrade.has(key))byTrade.set(key,[]);byTrade.get(key).push(r);});
  const used=new Set(['전체',REVIEW,'history']);
  byTrade.forEach((items,trade)=>{
    let base=String(trade).replace(/[\[\]:*?/\\\u0000-\u001F]/g,'·').replace(/^'+|'+$/g,'').trim()||'미지정';
    base=Array.from(base).slice(0,31).join('');
    let name=base, n=2;
    while(used.has(name.toLowerCase())){const suffix=' ('+(n++)+')';name=Array.from(base).slice(0,31-suffix.length).join('')+suffix;}
    used.add(name.toLowerCase());groups.push({name,rows:items});
  });
  return groups;
}
function range(rows){
  const days=[...new Set(rows.map(r=>day(r.createdAt)).filter(d=>d!=='날짜 미상'))].sort();
  let out=days.length ? days[0]+(days.length>1?' ~ '+days.at(-1):'') : '날짜 미상';
  if(days.length && rows.some(r=>day(r.createdAt)==='날짜 미상'))out+=' · 날짜 미상 포함';
  return out;
}
function sheetXml(rows,site,inspector){
  function cell(v,col,row,style){
    if(String(v??'').length>32767)throw new Error('한 셀의 내용이 너무 깁니다. 32,767자 이하로 줄여 주세요.');
    return '<c r="'+String.fromCharCode(65+col)+row+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';
  }
  function row(values,n,style,height){return '<row r="'+n+'"'+(height?' ht="'+height+'" customHeight="1"':'')+'>'+values.map((v,c)=>cell(v,c,n,n>=5&&c===7&&v===REVIEW?5:style)).join('')+'</row>';}
  const last=4+rows.length;
  let data=row(['CHECK LIST'],1,1,28)+row(['현장명',site,'','점검일',range(rows),'점검인',inspector||''],2,3,42)
    +row(['완료요구일','','','수령인','','연락처',''],3,3,24)+row(HEADERS,4,2,24);
  rows.forEach((r,i)=>{const lines=String(r.text||'').split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/32)),0);data+=row(values(r),i+5,4,Math.min(409,Math.max(26,lines*16)));});
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="'+NS+'">'
    +'<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:H'+last+'"/>'
    +'<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    +'<sheetFormatPr defaultRowHeight="24"/><cols>'+[13,8,10,9,15,14,64,20].map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols>'
    +'<sheetData>'+data+'</sheetData><autoFilter ref="A4:H'+last+'"/><mergeCells count="5"><mergeCell ref="A1:H1"/><mergeCell ref="B2:C2"/><mergeCell ref="B3:C3"/><mergeCell ref="G2:H2"/><mergeCell ref="G3:H3"/></mergeCells>'
    +'<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'
    +'<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}
const styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="'+NS+'">'
 +'<fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="16"/><color rgb="FF0F3557"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts>'
 +'<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F3557"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE8A3"/><bgColor indexed="64"/></patternFill></fill></fills>'
 +'<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>'+['left','right','top','bottom'].map(d=>'<'+d+' style="thin"><color rgb="FFB7BFC8"/></'+d+'>').join('')+'<diagonal/></border></borders>'
 +'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6">'
 +'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
 +'<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
 +'<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
 +'<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
 +'<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
 +'<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
 +'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
function crc32(bytes){let crc=0xFFFFFFFF;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);}return (crc^0xFFFFFFFF)>>>0;}
function zip(files){
  const locals=[],central=[];let offset=0;
  function header(size){const a=new Uint8Array(size);return [a,new DataView(a.buffer)];}
  files.forEach(([name,text])=>{
    const n=encoder.encode(name),b=encoder.encode(text),crc=crc32(b);
    const [a,v]=header(30);v.setUint32(0,0x04034B50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,b.length,true);v.setUint32(22,b.length,true);v.setUint16(26,n.length,true);
    locals.push(a,n,b);
    const [c,d]=header(46);d.setUint32(0,0x02014B50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,b.length,true);d.setUint32(24,b.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);central.push(c,n);
    offset+=a.length+n.length+b.length;
  });
  const size=central.reduce((n,a)=>n+a.length,0);const [end,v]=header(22);v.setUint32(0,0x06054B50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
  const result=new Uint8Array(offset+size+22);let i=0;for(const bytes of [...locals,...central,end]){result.set(bytes,i);i+=bytes.length;}return result;
}
function xlsx(rows,site='',inspector=''){
  if(!rows.length)throw new Error('내려받을 기록이 없습니다.');
  const groups=sheets(rows);
  if(groups.length>65000)throw new Error('공종 수가 너무 많습니다.');
  const files=[['[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+groups.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],
    ['_rels/.rels','<?xml version="1.0"?><Relationships xmlns="'+PKG+'"><Relationship Id="rId1" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="'+NS+'" xmlns:r="'+REL+'"><sheets>'+groups.map((g,i)=>'<sheet name="'+xml(g.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets><definedNames>'+groups.map((g,i)=>'<definedName name="_xlnm.Print_Titles" localSheetId="'+i+'">'+xml("'"+g.name.replaceAll("'","''")+"'!$4:$4")+'</definedName>').join('')+'</definedNames></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="'+PKG+'">'+groups.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="styles" Type="'+REL+'/styles" Target="styles.xml"/></Relationships>'],['xl/styles.xml',styles]];
  groups.forEach((g,i)=>files.push(['xl/worksheets/sheet'+(i+1)+'.xml',sheetXml(g.rows,site,inspector)]));
  return zip(files);
}
const api={xlsx,tsv,sort,day,filename,sheets};
if(typeof module!=='undefined')module.exports=api;else root.PunchExport=api;
})(typeof window==='undefined'?globalThis:window);
