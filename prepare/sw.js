const CACHE='entropi-prepare-v5',FILES=['/prepare/','/prepare/app.mjs','/pointcloud/assets.mjs','/pointcloud/models/manifest.json','/prepare/print.html','/prepare/print.mjs','/vendor/print/printer.mjs','/vendor/print/px10-protocol.mjs','/vendor/print/cloud-raster.mjs','/vendor/print/raster.mjs','/pwa.mjs','/manifest.webmanifest','/favicon.svg','/favicon.ico','/apple-touch-icon.png','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('entropi-prepare-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const path=url.pathname==='/prepare/index.html'?'/prepare/':url.pathname;if(!FILES.includes(path))return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(path)).then(response=>response||fetch(event.request)));
});
