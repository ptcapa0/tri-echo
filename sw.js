const CACHE_PREFIX='tri-echo-';
const CACHE='tri-echo-v4.4.0';
const FILES=[
 './','./index.html','./style.css','./manifest.webmanifest',
 './assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png',
 './js/app.js','./js/audio.js','./js/generator.js','./js/math.js',
 './js/physics.js','./js/physics-calibration.js','./js/floating-pull.js','./js/game-config.js',
 './js/pointer-ownership.js','./js/storage.js','./js/gameplay.js','./js/rules.js'
];

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
 event.waitUntil(
  caches.keys()
   .then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))
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
