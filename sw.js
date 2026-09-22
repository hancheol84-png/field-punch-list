/* The prefix includes scope so other project sites on the same host are untouched. */
'use strict';
const PREFIX='field-punch-list:'+self.registration.scope+':';
const CACHE=PREFIX+'v14';
const ASSETS=['./','./index.html','./export.js','./manifest.webmanifest','./icon.svg'];
const URLS=ASSETS.map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS.map(url=>new Request(url,{cache:'reload'})))));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);url.search='';url.hash='';
 if(!URLS.includes(url.href))return;
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.href))||fetch(event.request)));
});
