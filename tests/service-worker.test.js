import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
const source=await readFile('sw.js','utf8');
const scope='https://example.test/tri-echo/';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const bodies={'index.html':'<!doctype html>one','js/app.js':'export const version=1;'};
 const descriptor={schema:1,version:'4.7.2',commit:'test',resources:Object.entries(bodies).map(([path,body])=>({path,sha256:sha(body),category:path.endsWith('.js')?'javascript':'html'}))};
 const release={...descriptor,releaseId:sha(JSON.stringify(descriptor))};
 const prefix='tri-echo-pr9-'+encodeURIComponent(scope)+'-',name=prefix+release.releaseId,marker=scope+'__tri_echo_complete__';
 const maps=new Map(),handlers={},log=[],fetches=[];let fault=null,putFault=false,deleteFault=false;
 const caches={
  keys:async()=>[...maps.keys()],
  open:async key=>{if(!maps.has(key))maps.set(key,new Map());const data=maps.get(key);return{
   match:async req=>data.get(typeof req==='string'?req:req.url)?.clone(),
   keys:async()=>[...data.keys()].map(url=>new Request(url)),
   put:async(req,response)=>{const url=typeof req==='string'?req:req.url;log.push(['put',key,url]);if(putFault)throw new Error('cache quota');data.set(url,response.clone())}
  }},
  delete:async key=>{log.push(['delete',key]);if(deleteFault)throw new Error('cleanup denied');return maps.delete(key)}
 };
 const fetch=async request=>{
  fetches.push(request);assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');
  if(fault==='network')throw new Error('disconnected');
  const path=request.url.slice(scope.length),body=fault==='digest'?'stale':bodies[path];
  const response=new Response(body,{status:fault==='status'?500:200,headers:{'content-type':fault==='media'?'text/html':path.endsWith('.js')?'text/javascript':'text/html'}});
  Object.defineProperty(response,'url',{value:fault==='url'?scope+'other':request.url});
  Object.defineProperty(response,'redirected',{value:fault==='redirect'});
  return response;
 };
 vm.runInNewContext(source.replace('__TRI_ECHO_RELEASE__',JSON.stringify(release)),{self:{registration:{scope},addEventListener:(name,fn)=>handlers[name]=fn},caches,fetch,Request,Response,URL,crypto:webcrypto,Uint8Array,Map});
 async function event(type){let promise;handlers[type]({waitUntil:p=>promise=p});await promise}
 async function request(url,{mode='cors',method='GET'}={}){let promise;handlers.fetch({request:{url,method,mode},respondWith:p=>promise=p});return promise?await promise:undefined}
 return{maps,log,fetches,caches,event,request,release,name,prefix,marker,bodies,setFault:x=>fault=x,setPutFault:x=>putFault=x,setDeleteFault:x=>deleteFault=x};
}
test('template cannot install without generated descriptor',()=>assert.throws(()=>vm.runInNewContext(source,{self:{}}),/not defined/));
test('complete marker is last; repeat same-ID install reuses validated cache',async()=>{
 const f=fixture();await f.event('install');assert.equal(f.log.at(-1)[2],f.marker);assert.equal(f.fetches.length,2);
 await f.event('install');assert.equal(f.fetches.length,2);await f.event('activate');
});
for(const fault of ['status','media','digest','url','redirect','network'])test(`failed ${fault} candidate never completes or deletes active cache`,async()=>{
 const f=fixture();f.maps.set(f.prefix+'previous',new Map());f.setFault(fault);
 await assert.rejects(f.event('install'));assert.equal(f.maps.has(f.name),false);assert.equal(f.maps.has(f.prefix+'previous'),true);
 assert.equal(f.log.some(row=>row[2]===f.marker),false);
});
test('put rejection is awaited, cleanup failure preserves original install error',async()=>{
 const f=fixture();f.setPutFault(true);f.setDeleteFault(true);await assert.rejects(f.event('install'),/cache quota/);
 assert.equal(f.log.some(row=>row[2]===f.marker),false);
});
test('damaged same-ID completed cache is never deleted during install',async()=>{
 const f=fixture();await f.event('install');f.maps.get(f.name).delete(scope+'js/app.js');
 await assert.rejects(f.event('install'),/damaged/);assert.ok(f.maps.has(f.name));
});
test('cleanup is scope-specific, protects ambiguous legacy ownership and ignores delete failure',async()=>{
 const f=fixture();await f.event('install');
 for(const [name,url] of [[f.prefix+'old',scope+'index.html'],['tri-echo-v4.7.1',scope+'index.html'],['tri-echo-v4.6.0','https://example.test/other/index.html'],['other-app',scope+'index.html'],['tri-echo-pr9-'+encodeURIComponent('https://example.test/other/')+'-old','https://example.test/other/index.html']])f.maps.set(name,new Map([[url,new Response('old')]]));
 await f.event('activate');assert.equal(f.maps.has(f.prefix+'old'),false);assert.equal(f.maps.has('tri-echo-v4.7.1'),false);
 assert.ok(f.maps.has('tri-echo-v4.6.0'));assert.ok(f.maps.has('other-app'));assert.equal(f.maps.size,4);
 f.maps.set(f.prefix+'orphan',new Map());f.setDeleteFault(true);await f.event('activate');assert.ok(f.maps.has(f.name));
});
test('incomplete activation fails before deleting older release',async()=>{
 const f=fixture();f.maps.set(f.prefix+'old',new Map());await assert.rejects(f.event('activate'),/Incomplete/);assert.ok(f.maps.has(f.prefix+'old'));
});
test('routing pins installed bytes and queries, limits HTML to navigation, leaves non-app requests alone',async()=>{
 const f=fixture();await f.event('install');f.setFault('network');
 assert.equal(await (await f.request(scope+'js/app.js?b=new')).text(),f.bodies['js/app.js']);
 assert.equal(await (await f.request(scope+'deep/route?test',{mode:'navigate'})).text(),f.bodies['index.html']);
 assert.deepEqual(await (await f.request(scope+'precache-manifest.json')).json(),f.release);
 for(const url of [scope+'missing.js',scope+'missing.css',scope+'missing.png','https://other.test/tri-echo/js/app.js','https://example.test/other/index.html'])assert.equal(await f.request(url),undefined);
 assert.equal(await f.request(scope+'js/app.js',{method:'POST'}),undefined);
 assert.equal((await f.request(f.marker)).type,'error');assert.equal(f.fetches.length,2);
});
test('corrupt/missing cache entries repair only matching bytes and await successful write',async()=>{
 const f=fixture();await f.event('install');f.maps.get(f.name).set(scope+'js/app.js',new Response('wrong',{headers:{'content-type':'text/javascript'}}));
 assert.equal(await (await f.request(scope+'js/app.js')).text(),f.bodies['js/app.js']);
 f.maps.get(f.name).delete(scope+'js/app.js');f.setFault('digest');assert.equal((await f.request(scope+'js/app.js')).type,'error');assert.equal(f.maps.get(f.name).has(scope+'js/app.js'),false);
 f.setFault(null);f.setPutFault(true);assert.equal((await f.request(scope+'js/app.js')).type,'error');
});
