/* Build template: direct source registration fails closed until build injects the release. */
const RELEASE=__TRI_ECHO_RELEASE__;
const SCOPE=self.registration.scope;
const PREFIX='tri-echo-pr9-'+encodeURIComponent(SCOPE)+'-';
const CACHE=PREFIX+RELEASE.releaseId;
const MARKER=new URL('__tri_echo_complete__',SCOPE).href;
const ENTRIES=new Map(RELEASE.resources.map(entry=>[new URL(entry.path,SCOPE).href,entry]));
const TYPES={javascript:['text/javascript','application/javascript'],html:['text/html'],css:['text/css'],json:['application/json','application/manifest+json'],svg:['image/svg+xml'],png:['image/png']};
async function verified(response,entry,url=null){
 if(!response||response.status!==200||response.type==='opaque'||response.type==='error')throw new Error('Invalid response');
 if(url&&(response.redirected||response.url!==url))throw new Error('Unexpected resource URL');
 const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!TYPES[entry.category]?.includes(type))throw new Error('Invalid resource media');
 const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
 const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==entry.sha256)throw new Error('Resource digest mismatch');
 return response;
}
async function complete(cache){
 const marker=await cache.match(MARKER);
 if(!marker||await marker.text()!==RELEASE.releaseId)return false;
 try{for(const [url,entry] of ENTRIES)await verified(await cache.match(url),entry);return true}catch{return false}
}
async function install(){
 const cache=await caches.open(CACHE);
 if(await complete(cache))return;
 const hadMarker=!!await cache.match(MARKER);
 try{
  // A completion marker can belong to a same-ID active worker; never remove it.
  if(hadMarker)throw new Error('Existing completed release is damaged');
  for(const [url,entry] of ENTRIES){
   const response=await verified(await fetch(new Request(url,{cache:'no-store',redirect:'error'})),entry,url);
   await cache.put(url,response);
  }
  await cache.put(MARKER,new Response(RELEASE.releaseId,{headers:{'content-type':'text/plain'}}));
 }catch(error){if(!hadMarker)try{await caches.delete(CACHE)}catch{}throw error}
}
self.addEventListener('install',event=>event.waitUntil(install()));
async function cleanup(){
 for(const key of await caches.keys()){
  if(key===CACHE)continue;
  let owned=key.startsWith(PREFIX);
  if(!owned&&/^tri-echo-v\d+(?:\.\d+)+$/.test(key)){
   const entries=await (await caches.open(key)).keys();
   owned=entries.length>0&&entries.every(request=>request.url.startsWith(SCOPE));
  }
  if(owned)try{await caches.delete(key)}catch{}
 }
}
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 if(!await complete(await caches.open(CACHE)))throw new Error('Incomplete release activation');
 try{await cleanup()}catch{}
})()));
async function resource(url,entry){
 const cache=await caches.open(CACHE);
 try{return await verified(await cache.match(url),entry)}catch{}
 try{
  const response=await verified(await fetch(new Request(url,{cache:'no-store',redirect:'error'})),entry,url);
  await cache.put(url,response.clone());
  return response;
 }catch{return Response.error()}
}
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==new URL(SCOPE).origin||!url.href.startsWith(SCOPE))return;
 url.search='';url.hash='';
 if(url.href===MARKER){event.respondWith(Promise.resolve(Response.error()));return}
 if(request.mode==='navigate'){
  const shell=new URL('index.html',SCOPE).href;
  event.respondWith(resource(shell,ENTRIES.get(shell)));return;
 }
 if(url.href===new URL('precache-manifest.json',SCOPE).href){
  event.respondWith(Promise.resolve(new Response(JSON.stringify(RELEASE),{headers:{'content-type':'application/json'}})));return;
 }
 const entry=ENTRIES.get(url.href);
 if(entry)event.respondWith(resource(url.href,entry));
 // Unknown resources remain network requests, including their real failure status.
});
