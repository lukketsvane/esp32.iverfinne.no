import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadCachedAsset, storeAsset } from '../pointcloud/assets.mjs';
import { memoryIndexedDB } from './helpers/indexeddb.mjs';

const source=(await readFile(new URL('../vendor/model-bridge.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const bytes={asset:new Uint8Array([1,2,3,4]),runtime:new Uint8Array([5,6,7])};
const manifest=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,{bytes:value.length,sha256:createHash('sha256').update(value).digest('hex')}]));
const origin='https://esp32.iverfinne.no';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};

function harness(options={}){
  const listeners=new Set(),messages=[],timers=new Map(),progress=[];let opened=false,closed=false,settled=false,nextTimer=0;
  const helper={postMessage:(data,target)=>messages.push({data,target}),close(){closed=true}};
  const controller=new AbortController();
  const context=vm.createContext({
    window:{open(url){opened=url;return options.popupBlocked?null:helper},addEventListener:(name,listener)=>listeners.add(listener),removeEventListener:(name,listener)=>listeners.delete(listener)},
    storeAsset:options.store??storeAsset,loadCachedAsset,fetch:options.fetch??(async()=>new Response(JSON.stringify(manifest))),crypto:webcrypto,Uint8Array,ArrayBuffer,DOMException,AbortController,
    setTimeout:callback=>{const id=++nextTimer;timers.set(id,callback);return id},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(source,context);
  const promise=options.start===false?null:context.requestPhoneModels(controller.signal,update=>progress.push(update),options.existing?helper:null);promise?.then(()=>{settled=true},()=>{settled=true});
  async function emit(data,details={}){await Promise.all([...listeners].map(listener=>listener({data,origin,source:helper,...details})));await flush()}
  async function ready(){await emit({type:'entropi-models-ready'});return messages.find(message=>message.data.type==='entropi-models-request')?.data.session}
  const asset=(key,session,data=bytes[key])=>({type:'entropi-model-asset',session,key,bytes:data.slice().buffer});
  return {promise,controller,messages,progress,helper,emit,ready,asset,modelsReady:()=>context.phoneModelsReady(controller.signal),expire:async()=>{for(const callback of [...timers.values()])callback();await flush()},get opened(){return opened},get closed(){return closed},get settled(){return settled}};
}

async function withDatabase(callback,options){
  const previous=globalThis.indexedDB;globalThis.indexedDB=memoryIndexedDB(options);
  try{await callback()}finally{if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous}
}

test('phone model checks time out or abort when the camera manifest stops responding',async()=>{
  for(const abort of [false,true]){
    const app=harness({start:false,fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
    const checking=app.modelsReady(),failure=assert.rejects(checking,abort?{name:'AbortError'}:/Kameraet svarte ikkje/);
    if(abort)app.controller.abort();else await app.expire();
    await failure;
  }
});

test('phone preparation requires the exact opened window and HTTPS origin before starting',async()=>{
  await withDatabase(async()=>{
    const app=harness();assert.equal(app.opened,origin+'/prepare/?transfer');
    await app.emit({type:'entropi-models-ready'},{origin:'https://untrusted.test'});
    await app.emit({type:'entropi-models-ready'},{source:{}});assert.equal(app.messages.length,0);
    const session=await app.ready();assert.match(session,/^[a-f0-9]{32}$/);assert.equal(app.messages[0].target,origin);
    app.controller.abort();await assert.rejects(app.promise,{name:'AbortError'});
  });
});

test('both verified model files must commit before preparation can complete',async()=>{
  await withDatabase(async()=>{
    const app=harness(),session=await app.ready();
    await app.emit({type:'entropi-models-complete',session});assert.equal(app.settled,false);
    await app.emit(app.asset('runtime',session));assert.equal(app.messages.length,1);
    await app.emit(app.asset('asset','wrong-session'));assert.equal(app.messages.length,1);
    await app.emit(app.asset('asset',session));assert.deepEqual(await loadCachedAsset(manifest.asset),bytes.asset);
    assert.equal(app.messages.at(-1).data.type,'entropi-model-ack');assert.equal(app.messages.at(-1).data.key,'asset');
    await app.emit({type:'entropi-models-complete',session});assert.equal(app.settled,false);
    await app.emit(app.asset('runtime',session));assert.deepEqual(await loadCachedAsset(manifest.runtime),bytes.runtime);
    await app.emit({type:'entropi-models-complete',session});await app.promise;
    assert.equal(app.closed,true);assert.equal(app.progress.at(-1).percent,100);
  });
});

test('wrong-sized and wrong-hash model transfers are rejected without an acknowledgement',async()=>{
  for(const data of [new Uint8Array([1,2,3]),new Uint8Array([9,9,9,9])])await withDatabase(async()=>{
    const app=harness(),session=await app.ready();await app.emit(app.asset('asset',session,data));
    await assert.rejects(app.promise,/kontrollerast/);assert.equal(app.closed,true);assert.equal(app.messages.length,1);
    await assert.rejects(loadCachedAsset(manifest.asset),{code:'PHONE_SETUP_REQUIRED'});
  });
});

test('a partial transfer, abort or timeout never reports a prepared phone',async()=>{
  await withDatabase(async()=>{
    const app=harness(),session=await app.ready();await app.emit(app.asset('asset',session));app.controller.abort();
    await assert.rejects(app.promise,{name:'AbortError'});await assert.rejects(loadCachedAsset(manifest.runtime),{code:'PHONE_SETUP_REQUIRED'});
    assert.equal(app.closed,true);assert.equal(app.progress.some(update=>update.percent===100),false);
  });
  const app=harness();await app.expire();await assert.rejects(app.promise,/internett/);assert.equal(app.closed,true);
});

test('failed phone storage cannot acknowledge a model or report completion',async()=>{
  await withDatabase(async()=>{
    const app=harness(),session=await app.ready();await app.emit(app.asset('asset',session));
    await assert.rejects(app.promise,{code:'PHONE_SETUP_REQUIRED'});assert.equal(app.messages.length,1);
  },{failWrites:true});
});

test('blocked helper windows fail without fetching or falsely completing preparation',async()=>{
  const app=harness({popupBlocked:true});await assert.rejects(app.promise,/Tillat opning/);assert.equal(app.messages.length,0);
});

test('a cache-missing helper error keeps its actionable code and requires the current session',async()=>{
  const app=harness(),session=await app.ready();
  await app.emit({type:'entropi-models-error',session:'old',code:'PHONE_SETUP_REQUIRED',message:'Missing'});
  assert.equal(app.settled,false);
  await app.emit({type:'entropi-models-error',session,code:'PHONE_SETUP_REQUIRED',message:'Prepare online'});
  await assert.rejects(app.promise,{code:'PHONE_SETUP_REQUIRED',message:'Prepare online'});
  assert.equal(app.closed,true);
});

test('phone readiness verifies both cached files without opening a window',async()=>{
  await withDatabase(async()=>{
    const app=harness({start:false});assert.equal(await app.modelsReady(),false);
    await storeAsset(manifest.asset,bytes.asset);assert.equal(await app.modelsReady(),false);
    await storeAsset(manifest.runtime,bytes.runtime);assert.equal(await app.modelsReady(),true);
    assert.equal(app.opened,false);
    app.controller.abort();await assert.rejects(app.modelsReady(),{name:'AbortError'});
  });
});

test('readiness does not conceal manifest or network failures as an unprepared phone',async()=>{
  const app=harness({start:false,fetch:async()=>{throw new Error('Camera unavailable')}});
  await assert.rejects(app.modelsReady(),/Camera unavailable/);
  assert.equal(app.opened,false);
});

test('a prepared HTTPS opener is reused and remains open after verified transfer',async()=>{
  await withDatabase(async()=>{
    const app=harness({existing:true});assert.equal(app.opened,false);
    assert.equal(app.messages[0].data.type,'entropi-models-connect');assert.equal(app.messages[0].target,origin);
    const session=await app.ready();
    await app.emit(app.asset('asset',session));await app.emit(app.asset('runtime',session));await app.emit({type:'entropi-models-complete',session});await app.promise;
    assert.equal(app.closed,false);assert.equal(await loadCachedAsset(manifest.runtime).then(value=>value.length),bytes.runtime.length);
  });
});

test('aborting or rejecting a reused HTTPS opener leaves it available for another attempt',async()=>{
  const aborted=harness({existing:true});aborted.controller.abort();await assert.rejects(aborted.promise,{name:'AbortError'});assert.equal(aborted.closed,false);
  assert.equal(aborted.messages.at(-1).data.type,'entropi-models-cancel');assert.equal(aborted.messages.at(-1).target,origin);
  const rejected=harness({existing:true}),session=await rejected.ready();await rejected.emit({type:'entropi-models-error',session,code:'PHONE_SETUP_REQUIRED',message:'Prepare first'});
  await assert.rejects(rejected.promise,{code:'PHONE_SETUP_REQUIRED'});assert.equal(rejected.closed,false);
  assert.deepEqual({...rejected.messages.at(-1).data},{type:'entropi-models-cancel',session});
});
