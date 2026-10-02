// Build the separate static pilot app from the reviewed app sources.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function artifacts(){
 const out={};
 for(const name of ['cloud.js','export.js','speech.js','trade.js','icon.svg'])out[name]=fs.readFileSync(path.join(root,name),'utf8');
 out['index.html']=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace('<head>','<head>\n<script>globalThis.PunchPilotRequired=true;document.documentElement.dataset.cloud="on";</script>')
  .replace('<title>현장 펀치리스트</title>','<title>현장 펀치리스트 · 시범운영</title>')
  .replace('<section id="cloudLogin"','<p id="pilotNotice" class="note" style="max-width:480px;margin:16px auto;padding:0 20px">시범운영 · 계정별 서버 저장</p>\n<section id="cloudLogin"')
  .replace('앱 버전 2026.10.02.4','앱 버전 2026.10.02.5 · 시범운영');
 out['manifest.webmanifest']=JSON.stringify({...JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8')),id:'./',name:'현장 펀치리스트 · 시범운영',short_name:'펀치리스트 시험'},null,2)+'\n';
 out['sw.js']=fs.readFileSync(path.join(root,'sw.js'),'utf8').replace("const CACHE=PREFIX+'v26';","const CACHE=PREFIX+'pilot-v1';");
 return out;
}
if(require.main===module){
 const target=path.join(root,'pilot');fs.mkdirSync(target,{recursive:true});
 for(const [name,content] of Object.entries(artifacts()))fs.writeFileSync(path.join(target,name),content,'utf8');
 process.stdout.write('Separate pilot assets generated. Public configuration left unchanged.\n');
}
module.exports={artifacts};
