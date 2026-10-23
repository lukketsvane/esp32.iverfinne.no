const CACHE='entropi-app-v12',FILES=['/','/style.css','/app.mjs','/pwa.mjs','/manifest.webmanifest','/favicon.svg','/favicon.ico','/apple-touch-icon.png','/icons/icon-192.png','/icons/icon-512.png','/vendor/viewfinder.mjs','/vendor/photo.mjs','/vendor/photo-view.mjs','/vendor/photo-gestures.mjs','/vendor/scene.mjs','/vendor/studio.mjs','/vendor/viewer-gestures.mjs','/vendor/model-bridge.mjs','/vendor/print-client.mjs','/pointcloud/math.mjs','/pointcloud/primitive.mjs','/pointcloud/assets.mjs','/pointcloud/depth-worker.mjs','/pointcloud/models/manifest.json','/pointcloud/vendor/ort.wasm.min.mjs','/pointcloud/vendor/ort-wasm-simd-threaded.mjs','/prepare/','/start/','/prepare/app.mjs','/prepare/entropi-wifi.png','/prepare/print.html','/prepare/print.mjs','/vendor/print/printer.mjs','/vendor/print/px10-protocol.mjs','/vendor/print/cloud-raster.mjs','/vendor/print/raster.mjs','/print/','/print/app.mjs','/print/printer.mjs','/print/px10-protocol.mjs'];
let offlineUntil=0;
async function serve(request,path){
  const cached=caches.open(CACHE).then(cache=>cache.match(path)).catch(()=>null);if(Date.now()<offlineUntil){const response=await cached;if(response)return response}
  const controller=new AbortController();let timer;
  const network=fetch(request,{signal:controller.signal}).then(async response=>response.ok?response:await cached||response).catch(async()=>await cached||Response.error());
  try{return await Promise.race([network,new Promise(resolve=>{timer=setTimeout(()=>cached.then(response=>{if(response){offlineUntil=Date.now()+10000;controller.abort();resolve(response)}}),1500)})])}finally{clearTimeout(timer)}
}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('entropi-app-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const path=url.pathname==='/index.html'?'/':url.pathname==='/prepare/index.html'?'/prepare/':url.pathname==='/start/index.html'||url.pathname==='/start'?'/start/':url.pathname==='/print'||url.pathname==='/print/index.html'?'/print/':url.pathname;if(!FILES.includes(path))return;
  event.respondWith(serve(event.request,path));
});
