const CACHE='tri-echo-v4.1.0';
const FILES=[
 './','./index.html','./style.css','./manifest.webmanifest',
 './assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png',
 './js/app.js','./js/audio.js','./js/generator.js','./js/math.js',
 './js/physics.js','./js/storage.js','./js/gameplay.js'
];

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
 event.waitUntil(
  caches.keys()
   .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
   .then(()=>self.clients.claim())
 );
});

self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 event.respondWith(
  fetch(event.request)
   .then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
   })
   .catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./index.html')))
 );
});
