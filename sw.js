const CACHE='entropi-app-v2',FILES=['/','/style.css','/app.mjs','/pwa.mjs','/manifest.webmanifest','/favicon.svg','/favicon.ico','/apple-touch-icon.png','/icons/icon-192.png','/icons/icon-512.png','/vendor/viewfinder.mjs','/vendor/photo.mjs','/vendor/scene.mjs','/vendor/studio.mjs','/vendor/viewer-gestures.mjs','/vendor/model-bridge.mjs','/vendor/print-client.mjs','/pointcloud/math.mjs','/pointcloud/primitive.mjs','/pointcloud/assets.mjs','/pointcloud/depth-worker.mjs','/pointcloud/models/manifest.json','/pointcloud/vendor/ort.wasm.min.mjs','/pointcloud/vendor/ort-wasm-simd-threaded.mjs','/prepare/','/prepare/app.mjs','/prepare/print.html','/prepare/print.mjs','/vendor/print/printer.mjs','/vendor/print/px10-protocol.mjs','/vendor/print/cloud-raster.mjs','/vendor/print/raster.mjs'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('entropi-app-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const path=url.pathname==='/index.html'?'/':url.pathname==='/prepare/index.html'?'/prepare/':url.pathname;if(!FILES.includes(path))return;
  const fallback=()=>caches.open(CACHE).then(cache=>cache.match(path));
  event.respondWith(fetch(event.request).then(async response=>response.ok?response:await fallback()||response).catch(async()=>await fallback()||Response.error()));
});
