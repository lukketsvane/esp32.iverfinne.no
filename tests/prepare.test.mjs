import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const html=await readFile(new URL('../prepare/index.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../prepare/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const origin='http://192.168.4.1',secure='https://esp32.iverfinne.no';
const bytes={asset:new Uint8Array([1,2,3,4]),runtime:new Uint8Array([5,6,7])};
const manifest=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,{key,bytes:value.length}]));
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}}

function harness(options={}){
  const elements=new Map(),events=new Map(),workerEvents=new Map(),timers=new Map(),messages=[],opened=[],reads={asset:0,runtime:0},downloads=[],registrations=[];let timerId=0,closed=0,focused=0,reloads=0;
  for(const match of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g))elements.set(match[1],{hidden:/\bhidden\b/.test(match[0]),textContent:'',listeners:new Map(),attributes:new Map(),setAttribute(name,value){this.attributes.set(name,String(value))},addEventListener(name,listener){this.listeners.set(name,listener)},removeAttribute(name){delete this[name]},async click(event={}){this.listeners.get('click')?.({preventDefault(){},...event});await flush()}});
  const addEventListener=(name,listener)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(listener)};
  const peer={closed:false,photo:null,focus(){focused++},postMessage:(data,target)=>messages.push({data,target})};
  const document={hidden:false,addEventListener,documentElement:{dataset:{}},referrer:options.referrer??origin+'/',getElementById:id=>elements.get(id)};
  const scope=options.start?'/start/':'/prepare/',expected=secure+scope+'sw.js',registration={scope:secure+scope,active:{scriptURL:expected}},controller=options.noController?null:{scriptURL:options.controller??expected};
  const context=vm.createContext({
    document,location:{origin:secure,href:secure+scope+(options.transfer?'?transfer':options.camera?'?camera':''),reload(){reloads++}},history:options.history,URL,AbortController,DOMException,Uint8Array,ArrayBuffer,crypto:webcrypto,
    window:{opener:options.transfer?peer:null,addEventListener,open(url,target){opened.push({url,target});if(options.popupBlocked)return null;peer.closed=false;peer.photo=null;return peer},close(){closed++}},
    navigator:{onLine:options.onLine,serviceWorker:options.noServiceWorker?undefined:{controller,ready:Promise.resolve(registration),register:async(...args)=>{registrations.push(args);if(options.registrationError)throw options.registrationError;await options.registration?.();return registration},addEventListener(name,listener){if(!workerEvents.has(name))workerEvents.set(name,[]);workerEvents.get(name).push(listener)},removeEventListener(name,listener){workerEvents.set(name,(workerEvents.get(name)||[]).filter(value=>value!==listener))}},storage:{persist:async()=>true}},
    fetch:async()=>({ok:true,json:async()=>manifest}),
    loadAsset:async(asset,progress,signal)=>{downloads.push(asset.key);await options.load?.(asset.key,{progress,signal});signal.throwIfAborted();progress(100);return bytes[asset.key].slice()},
    loadCachedAsset:async asset=>{const count=++reads[asset.key];if(options.read)await options.read(asset.key,count);return bytes[asset.key].slice()},
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(source,context,{filename:'prepare/app.mjs'});
  async function event(name,details={}){for(const listener of events.get(name)??[])listener({type:name,...details});await flush()}
  const emit=(data,details={})=>event('message',{data,source:peer,origin,...details});
  async function connect(){await elements.get('open-camera').click();await emit({type:'entropi-models-connect'})}
  async function cameraReady(details={}){const port={closed:false,onmessage:null,start(){},close(){this.closed=true},async emit(data){this.onmessage?.({data});await flush()}};await emit({type:'entropi-camera-ready'},{ports:[port],...details});return port}
  async function complete(session){await emit({type:'entropi-model-ack',session,key:'asset'});await emit({type:'entropi-model-ack',session,key:'runtime'})}
  async function expire(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.callback()}await flush()}
  async function update(details={}){for(const listener of workerEvents.get('message')??[])listener({source:controller,origin:secure,data:{type:'entropi-update-ready'},...details});await flush()}
  return {get:id=>elements.get(id),document,peer,messages,opened,reads,downloads,registrations,event,emit,connect,cameraReady,complete,expire,update,get closed(){return closed},get focused(){return focused},get reloads(){return reloads}};
}

test('QR and camera are available while model readiness waits for both verified cache readbacks',async()=>{
  const asset=deferred(),runtime=deferred(),app=harness({read:key=>(key==='asset'?asset:runtime).promise});await flush();
  assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.get('ready').hidden,false);assert.equal(app.get('network').hidden,false);assert.equal(app.get('open-camera').disabled,false);
  asset.resolve();await flush();assert.equal(app.reads.runtime,1);assert.equal(app.document.documentElement.dataset.ready,'false');
  runtime.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('ready').hidden,false);
  await app.get('open-camera').click();assert.equal(app.opened.length,1);
  assert.deepEqual(app.downloads,['asset','runtime']);assert.equal(app.opened[0].url,origin+'/?connect');assert.match(app.opened[0].target,/^entropi-camera-[0-9a-f-]+$/);
});

test('automatic preparation keeps QR and camera usable without a skip action or loading caption',async()=>{
  const loading=deferred(),app=harness({load:key=>key==='asset'?loading.promise:undefined});await flush();
  assert.equal(app.get('ready').hidden,false);assert.equal(app.get('retry').hidden,true);assert.equal(app.get('status').textContent,'');assert.equal(app.get('progress').hidden,false);
  await app.get('open-camera').click();assert.equal(app.opened.length,1);assert.doesNotMatch(source+html,/Berre foto|photoFlow|Klargjer …/);
  loading.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('ready').hidden,false);await app.cameraReady();await app.get('open-camera').click();assert.equal(app.opened.length,1);assert.equal(app.focused,1);
});

test('routine camera and transfer states stay silent while connection instructions remain available on demand',async()=>{
  const app=harness();await flush();assert.equal(app.get('status').textContent,'');await app.connect();assert.equal(app.get('status').textContent,'');assert.equal(app.get('progress').hidden,false);await app.emit({type:'entropi-models-request',session:'silent'});assert.equal(app.get('status').textContent,'');await app.complete('silent');assert.equal(app.get('status').textContent,'');await app.cameraReady();assert.equal(app.get('status').textContent,'');assert.equal(app.get('open-camera').textContent,'Tilbake til kameraet');assert.match(html,/Hald inne QR-koden og vel «Kople til nettverk»/);assert.match(html,/<code>http:\/\/192\.168\.4\.1<\/code>/);assert.match(html,/Advarsel om usikker forbindelse/);assert.doesNotMatch(html,/id="http-help" hidden|<strong>ENTROPI|\.network\{[^}]*border:|Utan passord · utan internett|button\{[^}]*border:1px|button:focus-visible[^}]*outline:1px/);
});

test('QR instructions are immediate and hide when a camera connects before models finish',async()=>{
  const loading=deferred(),app=harness({load:key=>key==='asset'?loading.promise:undefined});await flush();
  assert.equal(app.get('network').hidden,false);assert.equal(app.get('retry').hidden,true);assert.equal(app.get('open-camera').disabled,false);
  await app.get('open-camera').click();await app.cameraReady();assert.equal(app.get('network').hidden,true);assert.equal(app.get('open-camera').textContent,'Tilbake til kameraet');assert.equal(app.document.documentElement.dataset.ready,'false');loading.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('network').hidden,true);
});

test('only the returned camera child and an allowed HTTP origin can start a retained transfer',async()=>{
  const app=harness();await flush();
  await app.emit({type:'entropi-models-connect'});assert.equal(app.messages.length,0);
  await app.get('open-camera').click();
  await app.emit({type:'entropi-models-connect'},{source:{}});
  await app.emit({type:'entropi-models-connect'},{origin:'https://untrusted.test'});
  await app.emit({type:'entropi-models-request',session:'early'});assert.equal(app.messages.length,0);
  await app.emit({type:'entropi-models-connect'});assert.equal(app.messages[0].data.type,'entropi-models-ready');assert.equal(app.messages[0].target,origin);
  await app.emit({type:'entropi-models-request',session:'wrong-source'},{source:{}});
  await app.emit({type:'entropi-models-request',session:'wrong-origin'},{origin:'https://untrusted.test'});assert.equal(app.messages.length,1);
  await app.emit({type:'entropi-models-request',session:'current'});assert.equal(app.messages.at(-1).data.key,'asset');await app.complete('current');
  assert.equal(app.messages.at(-1).data.type,'entropi-models-complete');assert.equal(app.closed,0);
});

test('wrong session acknowledgements and cancellations cannot advance or interrupt a transfer',async()=>{
  const app=harness();await flush();await app.connect();await app.emit({type:'entropi-models-request',session:'current'});
  await app.emit({type:'entropi-model-ack',session:'old',key:'asset'});
  await app.emit({type:'entropi-models-cancel',session:'old'});
  await app.emit({type:'entropi-model-ack',session:'current',key:'runtime'});
  assert.equal(app.messages.length,2);assert.equal(app.get('retry').hidden,true);
  await app.complete('current');assert.equal(app.messages.at(-1).data.session,'current');assert.equal(app.messages.at(-1).data.type,'entropi-models-complete');
});

test('cancellation during a read or ACK permits a new session without stale completion',async()=>{
  for(const duringRead of [true,false]){
    const stale=deferred(),app=harness({read:(key,count)=>duringRead&&key==='asset'&&count===2?stale.promise:undefined});
    await flush();await app.connect();await app.emit({type:'entropi-models-request',session:'old'});
    await app.emit({type:'entropi-models-cancel',session:'old'});await app.emit({type:'entropi-models-request',session:'new'});
    stale.resolve();await flush();await app.emit({type:'entropi-model-ack',session:'old',key:'asset'});await app.complete('new');
    assert.deepEqual(app.messages.filter(message=>message.data.type==='entropi-models-complete').map(message=>message.data.session),['new']);
    assert.equal(app.messages.some(message=>message.data.type==='entropi-models-error'),false);assert.equal(app.closed,0);
  }
});

test('successful retained transfers keep their source open and legacy helpers close only after both ACKs',async()=>{
  for(const transfer of [false,true]){
    const app=harness({transfer});await flush();
    if(transfer){assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.downloads.length,0);assert.equal(app.messages[0].data.type,'entropi-models-ready')}
    else await app.connect();
    await app.emit({type:'entropi-models-request',session:'first'});
    await app.emit({type:'entropi-model-ack',session:'first',key:'asset'});await app.expire(150);assert.equal(app.closed,0);
    await app.emit({type:'entropi-model-ack',session:'first',key:'runtime'});await app.expire(150);assert.equal(app.closed,transfer?1:0);
    assert.equal(app.document.documentElement.dataset.ready,'true');
    if(!transfer){await app.emit({type:'entropi-models-request',session:'second'});await app.complete('second');assert.equal(app.messages.at(-1).data.session,'second');assert.equal(app.closed,0)}
  }
});

test('failed cache verification shows retry and cannot advertise a prepared phone',async()=>{
  const app=harness({read:(key,count)=>{if(key==='runtime'&&count===1)throw new Error('Telefonlageret er utilgjengeleg.')}});await flush();
  assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.get('ready').hidden,false);assert.equal(app.get('retry').hidden,false);
  assert.match(app.get('status').textContent,/Telefonlageret/);assert.doesNotMatch(app.get('status').textContent,/Klar\./);
  await app.get('retry').click();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('retry').hidden,true);
  await app.get('open-camera').click();assert.equal(app.opened.length,1);
});

test('an unacknowledged transfer fails visibly and leaves the retained source available to retry',async()=>{
  const app=harness();await flush();await app.connect();await app.emit({type:'entropi-models-request',session:'timed-out'});await app.expire(60000);
  assert.equal(app.closed,0);assert.equal(app.get('ready').hidden,false);assert.equal(app.get('open-camera').textContent,'Opne kameraet ↗');assert.equal(app.document.documentElement.dataset.ready,'true');
  assert.equal(app.messages.at(-1).data.type,'entropi-models-error');assert.equal(app.messages.at(-1).data.session,'timed-out');
  assert.equal(app.messages.some(message=>message.data.type==='entropi-models-complete'),false);
  await app.get('open-camera').click();assert.equal(app.opened.length,2);assert.equal(app.opened[0].target,app.opened[1].target);assert.equal(app.downloads.length,2);
});

test('a wrong Wi-Fi timeout retries the same per-page window without preparing models again',async()=>{
  const app=harness();await flush();await app.get('open-camera').click();
  assert.equal(app.get('open-camera').disabled,true);assert.equal(app.get('status').textContent,'');
  await app.get('open-camera').click();assert.equal(app.opened.length,1);
  await app.expire(10000);assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('open-camera').disabled,false);
  assert.equal(app.get('status').textContent,'Finn ikkje kameraet. Vel ENTROPI under Wi-Fi og prøv igjen.');assert.equal(app.get('open-camera').textContent,'Prøv igjen');
  await app.get('open-camera').click();assert.equal(app.opened[0].target,app.opened[1].target);assert.deepEqual(app.downloads,['asset','runtime']);assert.deepEqual(app.reads,{asset:1,runtime:1});
  const other=harness();await flush();await other.get('open-camera').click();assert.notEqual(app.opened[0].target,other.opened[0].target);
});

test('only a known camera ready message enables a focus return that preserves its photo',async()=>{
  const app=harness();await flush();await app.get('open-camera').click();
  await app.cameraReady({source:{}});await app.cameraReady({origin:'https://untrusted.test'});await app.emit({type:'entropi-camera-ready'});
  await app.expire(10000);assert.match(app.get('status').textContent,/Finn ikkje kameraet/);
  const port=await app.cameraReady();assert.equal(app.get('status').textContent,'');assert.equal(app.get('open-camera').textContent,'Tilbake til kameraet');
  assert.equal(app.get('connection-hint').hidden,true);app.peer.photo='original-jpeg';
  await app.emit({type:'entropi-camera-left'},{source:{}});await app.emit({type:'entropi-camera-left'},{origin:'https://untrusted.test'});await app.emit({type:'entropi-camera-left'});
  await app.get('open-camera').click();assert.equal(app.focused,1);assert.equal(app.opened.length,1);assert.equal(app.peer.photo,'original-jpeg');assert.equal(app.closed,0);assert.equal(port.closed,false);
});

test('a protocol hello and model completion cannot claim the camera is ready',async()=>{
  const app=harness();await flush();await app.connect();await app.expire(10000);
  assert.match(app.get('status').textContent,/Finn ikkje kameraet/);const cameraError=app.get('status').textContent;
  await app.emit({type:'entropi-models-request',session:'current'});await app.complete('current');
  assert.equal(app.get('status').textContent,cameraError);assert.equal(app.get('open-camera').disabled,false);assert.equal(app.get('connection-help').open,true);
  await app.cameraReady();await app.expire(10000);assert.equal(app.get('status').textContent,'');
});

test('a departed or closed child is reopened in its named window instead of focused',async()=>{
  for(const departed of [true,false]){
    const app=harness();await flush();await app.get('open-camera').click();const port=await app.cameraReady();
    if(departed)await port.emit({type:'entropi-camera-left'});else app.peer.closed=true;
    await app.get('open-camera').click();assert.equal(app.focused,0);assert.equal(app.opened.length,2);assert.equal(app.opened[0].target,app.opened[1].target);assert.equal(app.closed,0);
    assert.equal(port.closed,true);
  }
});

test('a replaced lifecycle port cannot reset a newer ready camera',async()=>{
  const app=harness();await flush();await app.get('open-camera').click();const old=await app.cameraReady(),queued=old.onmessage,current=await app.cameraReady();
  assert.equal(old.closed,true);assert.equal(old.onmessage,null);queued({data:{type:'entropi-camera-left'}});await flush();
  assert.equal(app.get('status').textContent,'');assert.equal(current.closed,false);
  await current.emit({type:'unrelated'});assert.equal(app.get('status').textContent,'');
  await current.emit({type:'entropi-camera-left'});assert.equal(current.closed,true);assert.equal(app.get('status').textContent,'');
  await app.get('open-camera').click();assert.equal(app.opened.length,2);assert.equal(app.opened[0].target,app.opened[1].target);
});

test('leaving the preparation page closes its lifecycle port and ignores queued departure',async()=>{
  const app=harness();await flush();await app.get('open-camera').click();const port=await app.cameraReady(),queued=port.onmessage;
  await app.event('pagehide');assert.equal(port.closed,true);queued({data:{type:'entropi-camera-left'}});await flush();
  assert.equal(app.document.documentElement.dataset.ready,'false');await app.get('open-camera').click();assert.equal(app.opened.length,1);
});

test('a blocked camera window leaves verified preparation intact for a launch retry',async()=>{
  const app=harness({popupBlocked:true});await flush();await app.get('open-camera').click();
  assert.match(app.get('status').textContent,/Tillat opning/);assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('open-camera').textContent,'Prøv igjen');
  await app.get('open-camera').click();assert.equal(app.opened[0].target,app.opened[1].target);assert.deepEqual(app.downloads,['asset','runtime']);
});

test('a restored page keeps camera opening available while revalidating model storage',async()=>{
  const restored=deferred(),app=harness({read:(key,count)=>key==='asset'&&count===2?restored.promise:undefined});await flush();
  assert.equal(app.document.documentElement.dataset.ready,'true');await app.event('pagehide');await app.event('pageshow',{persisted:true});
  assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.get('open-camera').disabled,false);assert.equal(app.get('network').hidden,false);
  restored.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.reads.runtime,2);await app.get('open-camera').click();assert.equal(app.opened.length,1);
});

test('camera entry skips downloads and can connect for photos without claiming model readiness',async()=>{
  const stored=new Set(),missing=()=>Object.assign(new Error('Model missing'),{code:'PHONE_SETUP_REQUIRED'});
  const app=harness({camera:true,read:key=>{if(!stored.has(key))throw missing()},load:key=>stored.add(key)});await flush();
  assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.downloads.length,0);assert.equal(app.get('retry').hidden,false);assert.equal(app.get('network').hidden,false);
  await app.get('open-camera').click();const port=await app.cameraReady();app.peer.photo='original-jpeg';
  assert.equal(app.get('status').textContent,'');assert.equal(app.document.documentElement.dataset.ready,'false');
  await app.emit({type:'entropi-models-request',session:'missing'});
  assert.equal(app.messages.at(-1).data.code,'PHONE_SETUP_REQUIRED');assert.equal(app.messages.at(-1).data.session,'missing');assert.equal(app.messages.some(message=>message.data.type==='entropi-model-asset'),false);
  await app.get('retry').click();assert.deepEqual(app.downloads,['asset','runtime']);assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(port.closed,false);
  await app.get('open-camera').click();assert.equal(app.focused,1);assert.equal(app.opened.length,1);assert.equal(app.peer.photo,'original-jpeg');
  await app.emit({type:'entropi-models-request',session:'prepared'});await app.complete('prepared');assert.equal(app.messages.at(-1).data.type,'entropi-models-complete');
});

test('optional model failure preserves an already connected photo and leaves retry available',async()=>{
  const app=harness({camera:true,read:()=>{throw Object.assign(new Error('Model missing'),{code:'PHONE_SETUP_REQUIRED'})},load:()=>{throw new Error('Internett manglar.')}});await flush();
  await app.get('open-camera').click();const port=await app.cameraReady();app.peer.photo='original-jpeg';await app.get('retry').click();
  assert.match(app.get('status').textContent,/Internett manglar/);assert.equal(app.get('retry').hidden,false);assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(port.closed,false);
  await app.get('open-camera').click();assert.equal(app.focused,1);assert.equal(app.opened.length,1);assert.equal(app.peer.photo,'original-jpeg');
});

test('success or failure copying models preserves a camera that already owns a photo',async()=>{
  for(const complete of[true,false]){
    const app=harness();await flush();await app.get('open-camera').click();const port=await app.cameraReady();app.peer.photo='original-jpeg';
    await app.emit({type:'entropi-models-connect'});await app.emit({type:'entropi-models-request',session:'copy'});
    if(complete)await app.complete('copy');else await app.expire(60000);
    await app.expire(10000);assert.equal(app.get('open-camera').textContent,'Tilbake til kameraet');assert.equal(app.get('open-camera').disabled,false);assert.equal(app.get('progress').hidden,true);assert.equal(port.closed,false);
    await app.get('open-camera').click();assert.equal(app.focused,1);assert.equal(app.opened.length,1);assert.equal(app.peer.photo,'original-jpeg');
  }
});

test('initial HTML supplies visible QR and an actual HTTP camera link even if its module never loads',()=>{
  assert.doesNotMatch(html,/<(?:section|div)\b[^>]*id="(?:ready|network)"[^>]*\bhidden\b/);assert.match(html,/<a id="open-camera" href="http:\/\/192\.168\.4\.1\/\?connect" target="_blank">/);assert.doesNotMatch(html,/id="http-help" hidden/);
});

test('unavailable or stalled model setup cannot disable the initial QR and camera action',async()=>{
  const registration=deferred();
  for(const options of[{noServiceWorker:true},{noController:true,registration:()=>registration.promise},{noController:true,registrationError:new Error('Worker unavailable')},{load:()=>{throw new Error('Internett manglar.')}}]){
    const app=harness(options);await flush();assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.get('ready').hidden,false);assert.equal(app.get('network').hidden,false);assert.equal(app.get('open-camera').disabled,false);await app.get('open-camera').click();assert.equal(app.opened.length,1);await app.cameraReady();assert.equal(app.get('open-camera').textContent,'Tilbake til kameraet');assert.equal(app.document.documentElement.dataset.ready,'false');
  }
});

test('model success or failure never erases a camera launch error or its manual HTTP help',async()=>{
  for(const failed of[false,true]){
    const loading=deferred(),app=harness({load:async key=>{if(key==='asset'){await loading.promise;if(failed)throw new Error('Modellnedlastinga feila.')}}});await flush();await app.connect();await app.expire(10000);const error=app.get('status').textContent;assert.match(error,/Finn ikkje kameraet/);assert.equal(app.get('connection-help').open,true);assert.equal(app.get('open-camera').disabled,false);
    loading.resolve();await flush();assert.equal(app.get('status').textContent,error);assert.equal(app.document.documentElement.dataset.ready,String(!failed));assert.equal(app.get('network').hidden,false);assert.equal(app.get('open-camera').disabled,false);const port=await app.cameraReady();app.peer.photo='retained';assert.equal(app.get('status').textContent,failed?'Modellnedlastinga feila.':'');await app.get('open-camera').click();assert.equal(app.focused,1);assert.equal(app.peer.photo,'retained');assert.equal(port.closed,false);
  }
});

test('retrying optional models and hello-only messages cannot block an already connected photo',async()=>{
  let cached=false;const loading=deferred(),missing=()=>Object.assign(new Error('Missing'),{code:'PHONE_SETUP_REQUIRED'}),app=harness({camera:true,read:()=>{if(!cached)throw missing()},load:async()=>{await loading.promise;cached=true}});await flush();await app.get('open-camera').click();await app.cameraReady();app.peer.photo='retained';await app.emit({type:'entropi-models-connect'});assert.equal(app.get('retry').disabled,false);assert.equal(app.get('open-camera').disabled,false);await app.get('retry').click();assert.equal(app.get('retry').hidden,true);assert.equal(app.get('open-camera').disabled,false);await app.get('open-camera').click();assert.equal(app.focused,1);assert.equal(app.opened.length,1);assert.equal(app.peer.photo,'retained');loading.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');
});

test('BFCache restoration preserves the authenticated camera port and focuses its existing photo',async()=>{
  const restored=deferred(),app=harness({read:(key,count)=>key==='asset'&&count===2?restored.promise:undefined});await flush();
  await app.get('open-camera').click();const port=await app.cameraReady();app.peer.photo='original-jpeg';
  await app.event('pagehide',{persisted:true});await app.event('pageshow',{persisted:true});
  assert.equal(port.closed,false);assert.equal(app.document.documentElement.dataset.ready,'false');await app.get('open-camera').click();
  assert.equal(app.focused,1);assert.equal(app.opened.length,1);assert.equal(app.peer.photo,'original-jpeg');assert.deepEqual(app.downloads,['asset','runtime']);
  restored.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');await port.emit({type:'entropi-camera-left'});assert.equal(port.closed,true);
});

test('the back action restores the originating public camera history entry',async()=>{
  let backed=0,prevented=0;const app=harness({referrer:secure+'/',history:{length:2,back(){backed++}}});await flush();
  await app.get('back').click({preventDefault(){prevented++}});assert.equal(backed,1);assert.equal(prevented,1);assert.match(html,/<a id="back" href="\/" aria-label="Tilbake"/);
});

test('canonical QR entry registers its isolated worker scope without duplicating its app',async()=>{
  for(const start of[false,true]){const app=harness({start});await flush();assert.equal(app.registrations[0][0],start?'/start/sw.js':'/prepare/sw.js');assert.deepEqual({...app.registrations[0][1]},{scope:start?'/start/':'/prepare/',updateViaCache:'none'});assert.equal(app.document.documentElement.dataset.ready,'true')}
});

test('offline camera entry reuses only its installed root or own worker and still verifies model cache',async()=>{
  for(const controller of [secure+'/sw.js',secure+'/start/sw.js']){
    const app=harness({start:true,camera:true,onLine:false,controller});await flush();assert.equal(app.registrations.length,0);assert.deepEqual(app.downloads,[]);assert.deepEqual(app.reads,{asset:1,runtime:1});assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('open-camera').disabled,false);
  }
  const missing=harness({start:true,camera:true,onLine:false,controller:secure+'/sw.js',read:()=>{throw Object.assign(new Error('Missing'),{code:'PHONE_SETUP_REQUIRED'})}});await flush();assert.equal(missing.registrations.length,0);assert.equal(missing.document.documentElement.dataset.ready,'false');assert.equal(missing.get('open-camera').disabled,false);assert.deepEqual(missing.downloads,[]);
  for(const options of [{controller:secure+'/unknown/sw.js'},{noController:true}]){const app=harness({start:true,camera:true,onLine:false,...options});await flush();assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.registrations.length,0);assert.deepEqual(app.reads,{asset:0,runtime:0});assert.match(app.get('status').textContent,/nettlesaren med internett/)}
});

test('a failed registration can reuse a known installed shell when online detection is inaccurate',async()=>{
  for(const controller of [secure+'/sw.js',secure+'/start/sw.js']){const app=harness({start:true,camera:true,onLine:true,controller,registrationError:new Error('Cannot fetch worker')});await flush();assert.equal(app.registrations.length,1);assert.equal(app.document.documentElement.dataset.ready,'true');assert.deepEqual(app.reads,{asset:1,runtime:1});assert.deepEqual(app.downloads,[]);assert.equal(app.get('status').textContent,'')}
  for(const options of [{controller:secure+'/unknown/sw.js'},{noController:true}]){const app=harness({start:true,camera:true,onLine:true,registrationError:new Error('Cannot fetch worker'),...options});await flush();assert.equal(app.registrations.length,1);assert.equal(app.document.documentElement.dataset.ready,'false');assert.deepEqual(app.reads,{asset:0,runtime:0});assert.match(app.get('status').textContent,/Cannot fetch worker/)}
});

test('stalled downloads fail with a retry while preserving camera opening',async()=>{
  const app=harness({load:(_, {signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))});await flush();await app.expire(30000);
  assert.match(app.get('status').textContent,/Nedlastinga stoppa/);assert.equal(app.get('retry').hidden,false);assert.equal(app.get('open-camera').disabled,false);assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.get('network').hidden,false);
});

test('BFCache resumes interrupted automatic preparation while camera entry remains cache only',async()=>{
  let attempts=0;const app=harness({load:(_, {signal})=>{if(attempts++===0)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))}});await flush();
  await app.event('pagehide',{persisted:true});await app.event('pageshow',{persisted:true});assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.downloads.length,3);
  const camera=harness({camera:true,read:()=>{throw Object.assign(new Error('Missing'),{code:'PHONE_SETUP_REQUIRED'})}});await flush();await camera.event('pagehide',{persisted:true});await camera.event('pageshow',{persisted:true});
  assert.equal(camera.document.documentElement.dataset.ready,'false');assert.equal(camera.downloads.length,0);assert.equal(camera.get('open-camera').disabled,false);
});

test('only its controlling worker may request an idle onboarding refresh',async()=>{
  const app=harness({start:true});await flush();await app.update({source:{scriptURL:secure+'/start/sw.js'}});await app.update({origin:'https://untrusted.test'});assert.equal(app.reloads,0);
  await app.update();assert.equal(app.reloads,1);
});

test('worker updates wait for downloads, remain deferred for live peers, and never reload a transfer helper',async()=>{
  const loading=deferred(),downloading=harness({load:key=>key==='asset'?loading.promise:undefined});await flush();await downloading.update();assert.equal(downloading.reloads,0);loading.resolve();await flush();assert.equal(downloading.reloads,1);
  const camera=harness();await flush();await camera.get('open-camera').click();await camera.cameraReady();camera.peer.photo='original-jpeg';await camera.update();await camera.event('visibilitychange');assert.equal(camera.reloads,0);assert.equal(camera.peer.photo,'original-jpeg');
  const helper=harness({transfer:true});await flush();await helper.update();assert.equal(helper.reloads,0);
});
