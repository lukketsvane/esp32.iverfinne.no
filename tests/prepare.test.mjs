import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../prepare/index.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../prepare/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const origin='http://192.168.4.1',secure='https://esp32.iverfinne.no';
const bytes={asset:new Uint8Array([1,2,3,4]),runtime:new Uint8Array([5,6,7])};
const manifest=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,{key,bytes:value.length}]));
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}}

function harness(options={}){
  const elements=new Map(),events=new Map(),timers=new Map(),messages=[],opened=[],reads={asset:0,runtime:0},downloads=[];let timerId=0,closed=0;
  for(const match of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g))elements.set(match[1],{hidden:/\bhidden\b/.test(match[0]),textContent:'',listeners:new Map(),addEventListener(name,listener){this.listeners.set(name,listener)},removeAttribute(name){delete this[name]},async click(){this.listeners.get('click')?.();await flush()}});
  const addEventListener=(name,listener)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(listener)};
  const peer={postMessage:(data,target)=>messages.push({data,target})};
  const document={documentElement:{dataset:{}},referrer:options.referrer??origin+'/',getElementById:id=>elements.get(id)};
  const expected=secure+'/prepare/sw.js',registration={scope:secure+'/prepare/',active:{scriptURL:expected}};
  const context=vm.createContext({
    document,location:{href:secure+'/prepare/'+(options.transfer?'?transfer':'')},URL,AbortController,DOMException,Uint8Array,ArrayBuffer,
    window:{opener:options.transfer?peer:null,addEventListener,open(url,target){opened.push({url,target});return options.popupBlocked?null:peer},close(){closed++}},
    navigator:{serviceWorker:{controller:{scriptURL:expected},ready:Promise.resolve(registration),getRegistration:async()=>registration,addEventListener(){},removeEventListener(){}},storage:{persist:async()=>true}},
    fetch:async()=>({ok:true,json:async()=>manifest}),
    loadAsset:async(asset,progress)=>{downloads.push(asset.key);progress(100);return bytes[asset.key].slice()},
    loadCachedAsset:async asset=>{const count=++reads[asset.key];if(options.read)await options.read(asset.key,count);return bytes[asset.key].slice()},
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(source,context,{filename:'prepare/app.mjs'});
  async function event(name,details={}){for(const listener of events.get(name)??[])listener({type:name,...details});await flush()}
  const emit=(data,details={})=>event('message',{data,source:peer,origin,...details});
  async function connect(){await elements.get('open-camera').click();await emit({type:'entropi-models-connect'})}
  async function complete(session){await emit({type:'entropi-model-ack',session,key:'asset'});await emit({type:'entropi-model-ack',session,key:'runtime'})}
  async function expire(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.callback()}await flush()}
  return {get:id=>elements.get(id),document,peer,messages,opened,reads,downloads,event,emit,connect,complete,expire,get closed(){return closed}};
}

test('camera opening requires both verified cached readbacks',async()=>{
  const asset=deferred(),runtime=deferred(),app=harness({read:key=>(key==='asset'?asset:runtime).promise});await flush();
  assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.get('ready').hidden,true);
  await app.get('open-camera').click();assert.equal(app.opened.length,0);
  asset.resolve();await flush();assert.equal(app.reads.runtime,1);assert.equal(app.document.documentElement.dataset.ready,'false');
  await app.get('open-camera').click();assert.equal(app.opened.length,0);
  runtime.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('ready').hidden,false);
  await app.get('open-camera').click();assert.deepEqual(app.opened,[{url:origin+'/?connect',target:'_blank'}]);
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
  assert.equal(app.document.documentElement.dataset.ready,'false');assert.equal(app.get('ready').hidden,true);assert.equal(app.get('retry').hidden,false);
  assert.match(app.get('status').textContent,/Telefonlageret/);assert.doesNotMatch(app.get('status').textContent,/Klar\./);
  await app.get('open-camera').click();assert.equal(app.opened.length,0);
  await app.get('retry').click();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.get('retry').hidden,true);
});

test('an unacknowledged transfer fails visibly and leaves the retained source available to retry',async()=>{
  const app=harness();await flush();await app.connect();await app.emit({type:'entropi-models-request',session:'timed-out'});await app.expire(60000);
  assert.equal(app.closed,0);assert.equal(app.get('retry').hidden,false);assert.equal(app.document.documentElement.dataset.ready,'false');
  assert.equal(app.messages.at(-1).data.type,'entropi-models-error');assert.equal(app.messages.at(-1).data.session,'timed-out');
  assert.equal(app.messages.some(message=>message.data.type==='entropi-models-complete'),false);
  await app.get('retry').click();assert.equal(app.document.documentElement.dataset.ready,'true');
});

test('a restored page revalidates storage before allowing another camera window',async()=>{
  const restored=deferred(),app=harness({read:(key,count)=>key==='asset'&&count===2?restored.promise:undefined});await flush();
  assert.equal(app.document.documentElement.dataset.ready,'true');await app.event('pagehide');await app.event('pageshow',{persisted:true});
  assert.equal(app.document.documentElement.dataset.ready,'false');await app.get('open-camera').click();assert.equal(app.opened.length,0);
  restored.resolve();await flush();assert.equal(app.document.documentElement.dataset.ready,'true');assert.equal(app.reads.runtime,2);
});
