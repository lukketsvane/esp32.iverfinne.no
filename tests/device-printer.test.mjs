import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {cloudPrintJob} from '../vendor/print/cloud-raster.mjs';

const source=(await readFile(new URL('../vendor/print/device-printer.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const random='0123456789abcdef0123456789abcdef',boot='abcdef0123456789',id=boot+'00000007'+random.slice(-8),bytes=new Uint8Array([1,2,3]);
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const head=(values={})=>response({boot,sequence:7,state:'idle',...values});
const state=(name='sent',values={})=>response({id,state:name,bytes:name==='sent'?bytes.length:0,total:bytes.length,message:'',...values},name==='queued'?202:200);
function harness(handle,options={}){
  let now=0,next=0;const timers=new Map(),listeners=new Map(),requests=[],document={hidden:false};
  const add=(name,listener)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(listener)},remove=(name,listener)=>listeners.get(name)?.delete(listener);
  document.addEventListener=add;document.removeEventListener=remove;
  const context=vm.createContext({Uint8Array,AbortController,DOMException,document,addEventListener:add,removeEventListener:remove,setTimeout:(callback,delay)=>{const key=++next;timers.set(key,{at:now+delay,callback});return key},clearTimeout:key=>timers.delete(key),fetch:async(path,init)=>{requests.push({path,init});return await handle(path,init,requests.length)}});
  vm.runInContext(source,context);const printer=context.createDevicePrinter(options);
  async function emit(name,event={}){for(const listener of [...listeners.get(name)??[]])listener(event);await flush()}
  async function advance(ms){const end=now+ms;await flush();while(true){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();await flush()}now=end;await flush()}
  return {printer,requests,document,emit,advance};
}

test('one immutable raster job uses the board boot and sequence and polls that exact id until sent',async()=>{
  const raster=cloudPrintJob({width:384,height:2,data:new Uint8Array(384*2*4).fill(255),photo:true});
  const app=harness((path,init,index)=>index===1?head():state(index===2?'queued':index===3?'sending':'sent',{total:raster.length,bytes:index===4?raster.length:0}));
  const pending=app.printer.print(random,raster);await flush();assert.equal(app.requests[1].path,'/print?id='+id);assert.equal(app.requests[1].init.body,raster);assert.equal(app.requests[1].init.headers['Content-Type'],'application/octet-stream');assert.equal(app.requests[1].init.method,'POST');
  await app.advance(1000);const result=await pending;assert.equal(result.state,'sent');assert.equal(result.physicalPrintVerified,false);assert.deepEqual(app.requests.slice(2).map(item=>item.path),['/print-status?id='+id,'/print-status?id='+id]);assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);app.printer.dispose();
});

test('a lost acceptance response resolves by looking up the same id without another upload',async()=>{
  const app=harness((path,init,index)=>{if(index===1)return head();if(index===2)throw new TypeError('Network lost');return state()});
  assert.equal((await app.printer.print(random,bytes)).state,'sent');assert.deepEqual(app.requests.map(item=>item.path),['/print-status','/print?id='+id,'/print-status?id='+id]);app.printer.dispose();
});

test('an ambiguous POST timeout looks up the same id and an unknown job is never resubmitted',async()=>{
  const app=harness((path,init,index)=>{if(index===1)return head();if(index===2)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError'))));return response(null,404)},{timeout:25});
  const pending=assert.rejects(app.printer.print(random,bytes),/ikkje stadfestast/);await app.advance(25);await pending;assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);assert.equal(app.requests.at(-1).path,'/print-status?id='+id);app.printer.dispose();
});

test('busy or invalid board metadata never uploads and an atomic conflict is not retried',async()=>{
  for(const metadata of [{state:'sending'},{boot:'wrong'},{sequence:0},{sequence:0x100000000},{sequence:1.5}]){
    const app=harness(()=>head(metadata));await assert.rejects(app.printer.print(random,bytes));assert.equal(app.requests.length,1);app.printer.dispose();
  }
  const app=harness((path,init,index)=>index===1?head():response({},409));await assert.rejects(app.printer.print(random,bytes),/alt i gang/);assert.equal(app.requests.length,2);app.printer.dispose();
});

test('response headers do not remove the deadline from a partial acceptance body',async()=>{
  const app=harness((path,init,index)=>index===1?head():index===2?{ok:true,status:202,json:()=>new Promise(()=>{})}:state(),{timeout:25});
  const pending=app.printer.print(random,bytes);await app.advance(25);assert.equal((await pending).state,'sent');assert.equal(app.requests.length,3);assert.equal(app.requests.at(-1).path,'/print-status?id='+id);assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);app.printer.dispose();
});

test('a partial metadata or polling body fails within its deadline without another upload',async()=>{
  for(const partial of [1,3]){
    const app=harness((path,init,index)=>index>=partial?{ok:true,status:200,json:()=>new Promise(()=>{})}:index===1?head():state('queued'),{timeout:25});
    const pending=assert.rejects(app.printer.print(random,bytes),/svara ikkje/);await app.advance(partial===1?25:1575);await pending;assert.equal(app.requests.length,partial===1?1:5);assert.equal(app.requests.filter(item=>item.init.method==='POST').length,partial===1?0:1);app.printer.dispose();
  }
});

test('transient status failures recover the accepted job without another upload',async()=>{
  const app=harness((path,init,index)=>{if(index===1)return head();if(index===2)return state('queued');if(index===3)throw new TypeError('Network lost');if(index===4)return response(null,503);return state()});
  const pending=app.printer.print(random,bytes);await app.advance(1500);assert.equal((await pending).state,'sent');assert.equal(app.requests.length,5);assert.ok(app.requests.slice(2).every(item=>item.path==='/print-status?id='+id));assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);app.printer.dispose();
});

test('persistent status failure stops after three reads and foreground return wakes a retry',async()=>{
  const app=harness((path,init,index)=>index===1?head():index===2?state('queued'):response(null,503));
  const pending=assert.rejects(app.printer.print(random,bytes),/ikkje stadfestast/);await app.advance(500);assert.equal(app.requests.length,3);await app.emit('pageshow',{persisted:true});assert.equal(app.requests.length,4);await app.advance(500);await pending;assert.equal(app.requests.length,5);assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);app.printer.dispose();
});

test('invalid polled status is rejected immediately without retrying or uploading again',async()=>{
  for(const result of [response(null,404),state('sent',{id:random}),state('sent',{bytes:2})]){
    const app=harness((path,init,index)=>index===1?head():index===2?state('queued'):result);
    const pending=assert.rejects(app.printer.print(random,bytes),/ikkje stadfestast/);await app.advance(500);await pending;assert.equal(app.requests.length,3);assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);app.printer.dispose();
  }
});

test('wrong ids, impossible progress, incomplete sent and failed states cannot claim success',async()=>{
  for(const result of [state('sent',{id:random}),state('sending',{bytes:4}),state('sent',{bytes:2}),state('queued',{total:4}),state('unknown'),state('failed',{message:'Papir manglar.'})]){
    const app=harness((path,init,index)=>index===1?head():result);await assert.rejects(app.printer.print(random,bytes));assert.equal(app.requests.length,2);app.printer.dispose();
  }
});

test('a persisted page and a twenty second app switch retain one active board job and resume its status',async()=>{
  let release;const app=harness((path,init,index)=>{if(index===1)return head();if(index===2)return state('queued');return new Promise(resolve=>release=resolve)});
  const pending=app.printer.print(random,bytes);await flush();await assert.rejects(app.printer.print(random,bytes),{name:'AbortError'});app.document.hidden=true;await app.emit('pagehide',{persisted:true});await app.advance(20000);assert.equal(app.requests.length,3);assert.equal(app.requests.at(-1).init.signal.aborted,false);
  app.document.hidden=false;await app.emit('pageshow',{persisted:true});release(state());assert.equal((await pending).state,'sent');assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);app.printer.dispose();
});

test('returning to a waiting page immediately polls its current id without waiting for the next interval',async()=>{
  const app=harness((path,init,index)=>index===1?head():state(index===2?'recovering':'sent'),{interval:20000});const pending=app.printer.print(random,bytes);await flush();assert.equal(app.requests.length,2);await app.emit('pageshow',{persisted:true});assert.equal((await pending).state,'sent');assert.equal(app.requests.at(-1).path,'/print-status?id='+id);app.printer.dispose();
});

test('a stale photo before preflight finishes never submits a job',async()=>{
  let release,current=true;const app=harness(()=>new Promise(resolve=>release=resolve)),pending=assert.rejects(app.printer.print(random,bytes,()=>current),{name:'AbortError'});current=false;release(head());await pending;assert.equal(app.requests.length,1);app.printer.dispose();
});

test('a submitted job remains observed after closing or changing its photo until the board finishes',async()=>{
  let current=true;const app=harness((path,init,index)=>index===1?head():state(index===2?'queued':index===3?'sending':'sent')),pending=app.printer.print(random,bytes,()=>current);await flush();current=false;await app.advance(500);assert.equal(app.requests.length,3);await assert.rejects(app.printer.print(random,bytes),{name:'AbortError'});await app.advance(500);assert.equal((await pending).state,'sent');assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);assert.ok(app.requests.slice(2).every(item=>item.path==='/print-status?id='+id));app.printer.dispose();
});

test('genuine unload stops observing without cancelling the board or submitting another job',async()=>{
  const app=harness((path,init,index)=>index===1?head():state('queued')),pending=assert.rejects(app.printer.print(random,bytes),{name:'AbortError'});await flush();await app.emit('pagehide',{persisted:false});await pending;await app.advance(1000);assert.equal(app.requests.length,2);assert.equal(app.requests.filter(item=>item.init.method==='POST').length,1);app.printer.dispose();
});

test('a fresh explicit attempt reads a new sequence after a failed board job',async()=>{
  let sequence=7;const app=harness((path,init)=>path==='/print-status'?head({sequence}):sequence===7?state('failed',{message:'Skrivaren svara ikkje.'}):state('sent',{id:boot+'00000008'+random.slice(-8)}));
  await assert.rejects(app.printer.print(random,bytes),/svara ikkje/);sequence=8;assert.equal((await app.printer.print(random,bytes)).state,'sent');assert.deepEqual(app.requests.filter(item=>item.init.method==='POST').map(item=>item.path),['/print?id='+id,'/print?id='+boot+'00000008'+random.slice(-8)]);app.printer.dispose();
});
