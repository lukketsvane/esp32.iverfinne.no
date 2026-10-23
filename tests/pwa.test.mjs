import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../',import.meta.url),origin='https://esp32.iverfinne.no';
const read=path=>readFile(new URL(path,root),'utf8');
const worker=await read('sw.js'),prepare=await read('prepare/sw.js'),registration=await read('pwa.mjs');
const rewrites=JSON.parse(await read('vercel.json')).rewrites,printFiles=['/print/','/print/app.mjs','/print/printer.mjs','/print/px10-protocol.mjs'];

function serviceWorker(source,network=async()=>new Response('online'),options={}){
  const listeners=new Map(),stores=new Map(),deleted=[],calls=[],installed=[],timers=new Map();let claimed=0,skipped=0,timerId=0,now=100000;
  const cache=name=>{if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);return {addAll:async paths=>{for(const path of paths){installed.push(path);values.set(path,new Response('cached:'+path))}},match:async path=>values.get(path)?.clone()}};
  const context={URL,Response,AbortController,Date:{now:()=>now},setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id},clearTimeout:id=>timers.delete(id),caches:{open:async name=>cache(name),keys:async()=>[...stores.keys()],delete:async name=>{deleted.push(name);return stores.delete(name)}},fetch:async(request,options)=>{calls.push(request);return network(request,options)},self:{location:{origin,pathname:options.scriptPath??'/sw.js'},clients:{claim:async()=>{claimed++},matchAll:async()=>options.windows??[]},skipWaiting:async()=>{skipped++},addEventListener:(name,listener)=>listeners.set(name,listener)}};
  vm.runInNewContext(source+'\nglobalThis.files=FILES;globalThis.cacheName=CACHE;',context);
  async function lifecycle(name){let promise;listeners.get(name)({waitUntil:value=>{promise=value}});await promise}
  async function request(path,options={}){let promise;listeners.get('fetch')({request:{url:new URL(path,origin).href,method:'GET',mode:'navigate',...options},respondWith:value=>{promise=value}});return promise?await promise:null}
  const expire=delay=>{for(const[id,timer]of[...timers])if(timer.delay===delay){timers.delete(id);timer.callback()}};
  return {files:Array.from(context.files),name:context.cacheName,stores,deleted,calls,installed,lifecycle,request,expire,advance:delay=>{now+=delay},get claimed(){return claimed},get skipped(){return skipped}};
}

test('the app manifest starts the native camera and every entry has the same opaque app icons',async()=>{
  const manifest=JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');assert.equal(manifest.background_color,'#000000');
  assert.equal(manifest.id,'/');assert.equal(manifest.name,'Entropi');assert.equal(manifest.short_name,'Entropi');assert.equal(manifest.theme_color,'#000000');
  for(const icon of manifest.icons){const png=await readFile(new URL(icon.src.slice(1),root)),size=Number(icon.sizes.split('x')[0]);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.equal(png[25],2);assert.equal(icon.purpose,'any maskable')}
  const apple=await readFile(new URL('apple-touch-icon.png',root));assert.equal(apple.readUInt32BE(16),180);
  const ico=await readFile(new URL('favicon.ico',root));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
  assert.deepEqual(Array.from({length:3},(_,i)=>[ico[6+i*16],ico[7+i*16]]),[[16,16],[32,32],[48,48]]);
  assert.doesNotMatch(await read('favicon.svg'),/<text|<image/);
  for(const page of ['index.html','prepare/index.html','prepare/print.html']){const html=await read(page);assert.match(html,/rel="manifest" href="\/manifest.webmanifest"/);assert.match(html,/rel="apple-touch-icon" href="\/apple-touch-icon.png"/);assert.match(html,/apple-mobile-web-app-capable" content="yes"/);assert.match(html,/viewport-fit=cover/);assert.match(html,/type="module" src="\/pwa.mjs"/)}
  for(const page of ['index.html','prepare/index.html']){const html=await read(page);assert.match(html,/<link rel="icon" href="\/favicon\.ico" sizes="16x16 32x32 48x48">/);assert.match(html,/<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" sizes="any">/);assert.match(html,/apple-mobile-web-app-title" content="Entropi"/);assert.match(html,/apple-mobile-web-app-status-bar-style" content="black-translucent"/)}
});

test('the offline shell contains its complete small module graph without models, WASM or camera data',async()=>{
  const app=serviceWorker(worker);let total=0;
  for(const path of app.files){
    assert.doesNotMatch(path,/\.(?:onnx|wasm)$|^\/(?:api|capture|stream|photos)(?:\/|$)/);
    const relative=path==='/'?'index.html':path==='/prepare/'?'prepare/index.html':(rewrites.find(route=>route.source===path)?.destination??path).slice(1);total+=(await stat(new URL(relative,root))).size;
    if(path.endsWith('.mjs'))for(const match of (await read(relative)).matchAll(/^import .*? from ['"]([^'"]+)['"]/gm)){const dependency=new URL(match[1],origin+path).pathname;assert.ok(app.files.includes(dependency),path+' -> '+dependency)}
  }
  assert.ok(total<300000,total+' bytes');
  for(const path of ['/pointcloud/depth-worker.mjs','/pointcloud/vendor/ort.wasm.min.mjs','/pointcloud/vendor/ort-wasm-simd-threaded.mjs','/prepare/print.html'])assert.ok(app.files.includes(path));
  await app.lifecycle('install');assert.deepEqual(app.installed,app.files);assert.equal(app.skipped,0);
});

test('root activation cleans only its own old caches and preserves preparation and model storage',async()=>{
  const app=serviceWorker(worker);app.stores.set('entropi-app-old',new Map());app.stores.set('entropi-prepare-v7',new Map());app.stores.set('entropi-start-v1',new Map());app.stores.set('unrelated',new Map());
  await app.lifecycle('install');await app.lifecycle('activate');assert.deepEqual(app.deleted,['entropi-app-old']);assert.equal(app.claimed,1);assert.ok(app.stores.has('entropi-prepare-v7'));assert.ok(app.stores.has('entropi-start-v1'));assert.ok(app.stores.has('unrelated'));
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

test('a stalled network yields the cached shell at the deadline and cancels its pending fetch',async()=>{
  let signal;const app=serviceWorker(worker,(_,options)=>new Promise((_,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(signal.reason))}));await app.lifecycle('install');
  const response=app.request('/');assert.equal(signal.aborted,false);app.expire(1500);
  assert.equal(await(await response).text(),'cached:/');assert.equal(signal.aborted,true);
});

test('one timed-out navigation makes the whole cached module graph immediate for a bounded interval',async()=>{
  let stalled=true;const app=serviceWorker(worker,(_,options)=>stalled?new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason))):new Response('online'));await app.lifecycle('install');
  const first=app.request('/');app.expire(1500);assert.equal(await(await first).text(),'cached:/');
  assert.equal(await(await app.request('/app.mjs')).text(),'cached:/app.mjs');assert.equal(await(await app.request('/vendor/scene.mjs')).text(),'cached:/vendor/scene.mjs');assert.equal(app.calls.length,1);
  stalled=false;app.advance(10001);assert.equal(await(await app.request('/app.mjs')).text(),'online');assert.equal(app.calls.length,2);
});

test('a cache deadline never invents a first-install shell that was not saved',async()=>{
  let respond,settled=false;const app=serviceWorker(worker,()=>new Promise(resolve=>{respond=resolve})),response=app.request('/').then(value=>{settled=true;return value});app.expire(1500);
  for(let index=0;index<10;index++)await Promise.resolve();assert.equal(settled,false);respond(new Response('first install'));
  assert.equal(await(await response).text(),'first install');
});

test('the more specific preparation worker keeps branding and registration available offline without deleting the root cache',async()=>{
  const app=serviceWorker(prepare);app.stores.set('entropi-app-v4',new Map());app.stores.set('entropi-prepare-old',new Map());await app.lifecycle('install');await app.lifecycle('activate');
  assert.deepEqual(app.deleted,['entropi-prepare-old']);assert.ok(app.stores.has('entropi-app-v4'));
  for(const path of ['/pwa.mjs','/manifest.webmanifest','/favicon.svg','/apple-touch-icon.png','/icons/icon-512.png'])assert.equal(await(await app.request(path)).text(),'cached:'+path);
  assert.equal(app.calls.length,0);
});

test('the canonical start route reuses existing sources with its own offline cache family',async()=>{
  const app=serviceWorker(prepare,undefined,{scriptPath:'/start/sw.js'});app.stores.set('entropi-prepare-v5',new Map());app.stores.set('entropi-app-v4',new Map());app.stores.set('entropi-start-old',new Map());await app.lifecycle('install');await app.lifecycle('activate');
  assert.equal(app.name,'entropi-start-v15');assert.deepEqual(app.deleted,['entropi-start-old']);assert.ok(app.stores.has('entropi-prepare-v5'));assert.ok(app.stores.has('entropi-app-v4'));
  for(const path of['/start/','/start/index.html','/start/?camera'])assert.equal(await(await app.request(path)).text(),'cached:/prepare/');
  const config=JSON.parse(await read('vercel.json'));for(const path of['/start','/start/','/start/index.html','/start/sw.js'])assert.equal(config.rewrites.find(route=>route.source===path)?.destination,path.endsWith('sw.js')?'/prepare/sw.js':'/prepare/index.html');
});

test('new print paths bypass a legacy cache graph while its existing helper remains cached',async()=>{
  for(const source of [worker,prepare]){
    const legacy=serviceWorker(source.replace(/,'\/print\/[^']*'/g,''),async()=>{throw new Error('Legacy worker must not intercept fresh paths')});await legacy.lifecycle('install');
    for(const path of [...printFiles,'/print','/print/index.html'])assert.equal(await legacy.request(path),null,path);
    if(source===prepare)assert.equal(await(await legacy.request('/prepare/print.html')).text(),'cached:/prepare/print.html');
    assert.equal(legacy.calls.length,0);
  }
});

test('the fresh print module graph resolves canonical sources and stays available offline',async()=>{
  const destinations={'/print':'/prepare/print.html','/print/':'/prepare/print.html','/print/index.html':'/prepare/print.html','/print/app.mjs':'/prepare/print.mjs','/print/printer.mjs':'/vendor/print/printer.mjs','/print/px10-protocol.mjs':'/vendor/print/px10-protocol.mjs'};
  for(const [path,destination]of Object.entries(destinations)){assert.equal(rewrites.find(route=>route.source===path)?.destination,destination);await stat(new URL(destination.slice(1),root))}
  const html=await read('prepare/print.html'),module=await read('prepare/print.mjs'),printer=await read('vendor/print/printer.mjs');assert.match(html,/src="\/print\/app\.mjs"/);assert.match(module,/from '\/print\/printer\.mjs'/);assert.match(printer,/from '\.\/px10-protocol\.mjs'/);
  for(const [source,scriptPath,name]of [[worker,'/sw.js','entropi-app-v23'],[prepare,'/prepare/sw.js','entropi-prepare-v21'],[prepare,'/start/sw.js','entropi-start-v15']]){
    const app=serviceWorker(source,async()=>{throw new TypeError('Offline')},{scriptPath});await app.lifecycle('install');assert.equal(app.name,name);
    for(const path of printFiles){assert.ok(app.files.includes(path));assert.equal(await(await app.request(path)).text(),'cached:'+path);const file=destinations[path].slice(1);if(path.endsWith('.mjs'))for(const match of(await read(file)).matchAll(/^import .*? from ['"]([^'"]+)['"]/gm))assert.ok(app.files.includes(new URL(match[1],origin+path).pathname),path+' -> '+match[1])}
    for(const path of ['/print','/print/index.html'])assert.equal(await(await app.request(path)).text(),'cached:/print/');
  }
});

test('worker upgrades offer refresh only to their own onboarding windows without forcing unknown clients',async()=>{
  const messages=[],windows=['/prepare/','/prepare/?camera','/prepare/?transfer','/prepare/print.html','/start/'].map(url=>({url:origin+url,postMessage:data=>messages.push({url,...data}),navigate(){throw new Error('Unsafe navigation')}}));
  const app=serviceWorker(prepare,undefined,{windows});app.stores.set('entropi-prepare-v6',new Map());await app.lifecycle('install');await app.lifecycle('activate');
  assert.deepEqual(messages.map(item=>item.url),['/prepare/','/prepare/?camera']);assert.ok(messages.every(item=>item.type==='entropi-update-ready'));
});

test('both offline entry paths include the native Wi-Fi QR image without disabling its callout',async()=>{
  const png=await readFile(new URL('prepare/entropi-wifi.png',root)),html=await read('prepare/index.html');assert.equal(png.subarray(1,4).toString(),'PNG');
  for(const source of[worker,prepare])assert.ok(serviceWorker(source).files.includes('/prepare/entropi-wifi.png'));
  assert.match(html,/<img src="\/prepare\/entropi-wifi.png"[^>]+alt="Kople til ENTROPI Wi-Fi"/);assert.match(html,/\.network img\{[^}]*-webkit-touch-callout:default;[^}]*-webkit-user-select:auto;user-select:auto/);
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
