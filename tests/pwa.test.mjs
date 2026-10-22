import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../',import.meta.url),origin='https://esp32.iverfinne.no';
const read=path=>readFile(new URL(path,root),'utf8');
const worker=await read('sw.js'),prepare=await read('prepare/sw.js'),registration=await read('pwa.mjs');

function serviceWorker(source,network=async()=>new Response('online')){
  const listeners=new Map(),stores=new Map(),deleted=[],calls=[],installed=[];let claimed=0,skipped=0;
  const cache=name=>{if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);return {addAll:async paths=>{for(const path of paths){installed.push(path);values.set(path,new Response('cached:'+path))}},match:async path=>values.get(path)?.clone()}};
  const context={URL,Response,caches:{open:async name=>cache(name),keys:async()=>[...stores.keys()],delete:async name=>{deleted.push(name);return stores.delete(name)}},fetch:async request=>{calls.push(request);return network(request)},self:{location:{origin},clients:{claim:async()=>{claimed++}},skipWaiting:async()=>{skipped++},addEventListener:(name,listener)=>listeners.set(name,listener)}};
  vm.runInNewContext(source+'\nglobalThis.files=FILES;globalThis.cacheName=CACHE;',context);
  async function lifecycle(name){let promise;listeners.get(name)({waitUntil:value=>{promise=value}});await promise}
  async function request(path,options={}){let promise;listeners.get('fetch')({request:{url:new URL(path,origin).href,method:'GET',mode:'navigate',...options},respondWith:value=>{promise=value}});return promise?await promise:null}
  return {files:Array.from(context.files),name:context.cacheName,stores,deleted,calls,installed,lifecycle,request,get claimed(){return claimed},get skipped(){return skipped}};
}

test('the app manifest starts the native camera and every entry has the same opaque app icons',async()=>{
  const manifest=JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');assert.equal(manifest.background_color,'#000000');
  for(const icon of manifest.icons){const png=await readFile(new URL(icon.src.slice(1),root)),size=Number(icon.sizes.split('x')[0]);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.equal(png[25],2);assert.equal(icon.purpose,'any maskable')}
  const apple=await readFile(new URL('apple-touch-icon.png',root));assert.equal(apple.readUInt32BE(16),180);
  const ico=await readFile(new URL('favicon.ico',root));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
  assert.doesNotMatch(await read('favicon.svg'),/<text|<image/);
  for(const page of ['index.html','prepare/index.html','prepare/print.html']){const html=await read(page);assert.match(html,/rel="manifest" href="\/manifest.webmanifest"/);assert.match(html,/rel="apple-touch-icon" href="\/apple-touch-icon.png"/);assert.match(html,/apple-mobile-web-app-capable" content="yes"/);assert.match(html,/viewport-fit=cover/);assert.match(html,/type="module" src="\/pwa.mjs"/)}
});

test('the offline shell contains its complete small module graph without models, WASM or camera data',async()=>{
  const app=serviceWorker(worker);let total=0;
  for(const path of app.files){
    assert.doesNotMatch(path,/\.(?:onnx|wasm)$|^\/(?:api|capture|stream|photos)(?:\/|$)/);
    const relative=path==='/'?'index.html':path==='/prepare/'?'prepare/index.html':path.slice(1);total+=(await stat(new URL(relative,root))).size;
    if(path.endsWith('.mjs'))for(const match of (await read(relative)).matchAll(/^import .*? from ['"]([^'"]+)['"]/gm)){const dependency=new URL(match[1],origin+path).pathname;assert.ok(app.files.includes(dependency),path+' -> '+dependency)}
  }
  assert.ok(total<300000,total+' bytes');
  for(const path of ['/pointcloud/depth-worker.mjs','/pointcloud/vendor/ort.wasm.min.mjs','/pointcloud/vendor/ort-wasm-simd-threaded.mjs','/prepare/print.html'])assert.ok(app.files.includes(path));
  await app.lifecycle('install');assert.deepEqual(app.installed,app.files);assert.equal(app.skipped,0);
});

test('root activation cleans only its own old caches and preserves preparation and model storage',async()=>{
  const app=serviceWorker(worker);app.stores.set('entropi-app-old',new Map());app.stores.set('entropi-prepare-v5',new Map());app.stores.set('unrelated',new Map());
  await app.lifecycle('install');await app.lifecycle('activate');assert.deepEqual(app.deleted,['entropi-app-old']);assert.equal(app.claimed,1);assert.ok(app.stores.has('entropi-prepare-v5'));assert.ok(app.stores.has('unrelated'));
});

test('navigation and unversioned modules prefer the network and fall back to the installed shell offline',async()=>{
  let offline=false;const app=serviceWorker(worker,async()=>{if(offline)throw new TypeError('Offline');return new Response('new release')});await app.lifecycle('install');
  assert.equal(await(await app.request('/')).text(),'new release');assert.equal(await(await app.request('/app.mjs',{mode:'cors'})).text(),'new release');
  offline=true;assert.equal(await(await app.request('/index.html')).text(),'cached:/');assert.equal(await(await app.request('/app.mjs',{mode:'cors'})).text(),'cached:/app.mjs');
  assert.equal(await(await app.request('/prepare/index.html?transfer')).text(),'cached:/prepare/');
  assert.equal(await(await app.request('/prepare/print.html#session')).text(),'cached:/prepare/print.html');
});

test('a failed navigation can use the shell while private requests, photos and binaries pass through untouched',async()=>{
  const app=serviceWorker(worker,async()=>new Response('Unavailable',{status:503}));await app.lifecycle('install');assert.equal(await(await app.request('/')).text(),'cached:/');
  for(const path of ['/api/status','/capture','/photo.jpg','/device/EntropiCamera/app_httpd.cpp','/pointcloud/models/model_quantized.onnx','/pointcloud/vendor/ort-wasm-simd-threaded.wasm','https://untrusted.test/app.mjs'])assert.equal(await app.request(path),null,path);
  assert.equal(await app.request('/app.mjs',{method:'POST'}),null);assert.equal(app.calls.length,1);
});

test('the more specific preparation worker keeps branding and registration available offline without deleting the root cache',async()=>{
  const app=serviceWorker(prepare);app.stores.set('entropi-app-v1',new Map());app.stores.set('entropi-prepare-old',new Map());await app.lifecycle('install');await app.lifecycle('activate');
  assert.deepEqual(app.deleted,['entropi-prepare-old']);assert.ok(app.stores.has('entropi-app-v1'));
  for(const path of ['/pwa.mjs','/manifest.webmanifest','/favicon.svg','/apple-touch-icon.png','/icons/icon-512.png'])assert.equal(await(await app.request(path)).text(),'cached:'+path);
  assert.equal(app.calls.length,0);
});

test('registration is secure, idempotent and does not take over the specific preparation scope',async()=>{
  for(const secure of [true,false]){
    const calls=[],handle={scope:origin+'/'};const context={isSecureContext:secure,navigator:{serviceWorker:{register:async(...args)=>{calls.push(args);return handle}}}};
    vm.runInNewContext(registration.replace(/^export /gm,''),context);assert.equal(await context.registerPWA(),secure?handle:null);assert.equal(calls.length,secure?1:0);
    if(secure){assert.equal(calls[0][0],'/sw.js');assert.deepEqual({...calls[0][1]},{scope:'/',updateViaCache:'none'})}
  }
});

test('registration failure leaves the app usable and can retry without a reload',async()=>{
  let attempts=0;const context={isSecureContext:true,navigator:{serviceWorker:{register:async()=>{if(++attempts===1)throw new Error('Offline');return {scope:origin+'/'}}}}};
  vm.runInNewContext(registration.replace(/^export /gm,''),context);assert.equal(await context.registerPWA(),null);assert.equal((await context.registerPWA()).scope,origin+'/');assert.equal(attempts,2);
});
