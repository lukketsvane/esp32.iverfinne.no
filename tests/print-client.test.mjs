import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/print-client.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const image=()=>({width:384,height:1,data:new Uint8ClampedArray(384*4).fill(255)});
function harness({printer,buildJob=()=>new Uint8Array([1,2,3]),blocked=false}={}){
  const listeners=new Map(),opened=[],messages=[],reports=[],polls=new Map(),timeouts=new Map();let closed=false;
  const popup={closed:false,postMessage:(data,origin,ports)=>messages.push({data,origin,ports}),close(){closed=true;this.closed=true}};
  const context=vm.createContext({WeakSet,Uint8Array,Uint8ClampedArray,crypto:webcrypto,window:{open:(url,name)=>{opened.push({url,name});popup.closed=false;return blocked?null:popup},addEventListener:(name,listener)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(listener)},removeEventListener:(name,listener)=>listeners.get(name)?.delete(listener)},setTimeout:(callback,delay)=>{timeouts.set(delay,callback);return delay},clearTimeout:id=>timeouts.delete(id),setInterval:(callback,delay)=>{polls.set(delay,callback);return delay},clearInterval:id=>polls.delete(id)});
  vm.runInContext(source,context);const client=context.createPrintClient({printer,buildJob,report:message=>reports.push(message)});
  async function emit(data,details={}){for(const listener of [...listeners.get('message')??[]])listener({data,source:popup,origin:'https://esp32.iverfinne.no',...details});await flush()}
  return {client,popup,opened,messages,reports,emit,expire:async delay=>{timeouts.get(delay)?.();await flush()},hide:async(persisted=false)=>{for(const listener of [...listeners.get('pagehide')??[]])listener({persisted});await flush()},poll:async()=>{for(const callback of [...polls.values()])callback();await flush()},get session(){return opened.at(-1)?.url.split('#')[1]},get closed(){return closed}};
}
function directPrinter(choose=async()=>true){
  const jobs=[];let choices=0,disposed=false;
  const printer={supported:true,ready:false,device:null,addEventListener(){},async choose(){choices++;const result=await choose();this.ready=result;return result},async start(){return this.ready},enqueue(id,bytes){jobs.push({id,bytes});return true},dispose(){disposed=true}};
  return {printer,jobs,get choices(){return choices},get disposed(){return disposed}};
}

test('a direct print invokes the native chooser in the same gesture and queues one immutable job',async()=>{
  const device=directPrinter(),app=harness({printer:device.printer}),snapshot=image();
  const printing=app.client.print(snapshot);assert.equal(device.choices,1);assert.equal(await printing,true);
  assert.equal(device.jobs.length,1);assert.match(device.jobs[0].id,/^entropi-[a-f0-9]{32}$/);
  assert.equal(await app.client.print(snapshot),false);assert.equal(device.jobs.length,1);app.client.dispose();assert.equal(device.disposed,true);
});

test('cancelled pairing can be retried, while stale and disposed results cannot enqueue',async()=>{
  let release;const device=directPrinter(()=>new Promise(resolve=>{release=resolve})),app=harness({printer:device.printer}),snapshot=image();let current=true;
  const printing=app.client.print(snapshot,()=>current);current=false;release(true);assert.equal(await printing,false);assert.equal(device.jobs.length,0);
  current=true;const cancelled=app.client.print(snapshot);release(false);assert.equal(await cancelled,false);
  const late=app.client.print(snapshot);app.client.dispose();release(true);assert.equal(await late,false);assert.equal(device.jobs.length,0);
});

test('a connection quota failure retains the short retry guidance without queuing an image',async()=>{
  const device=directPrinter(async()=>false);device.printer.lastError='Vent eitt minutt før nytt forsøk.';
  const app=harness({printer:device.printer});assert.equal(await app.client.print(image()),false);assert.equal(device.jobs.length,0);assert.deepEqual(app.reports,[device.printer.lastError]);app.client.dispose();
});

test('HTTP camera opens a session-bound HTTPS printer synchronously and authenticates every message',async()=>{
  const app=harness(),snapshot=image(),printing=app.client.print(snapshot);assert.equal(app.opened.length,1);assert.match(app.opened[0].url,/^https:\/\/esp32\.iverfinne\.no\/print\/#/);assert.match(app.session,/^[a-f0-9]{32}$/);
  const ready={type:'entropi-print-ready',session:app.session};
  await app.emit(ready,{origin:'https://untrusted.test'});await app.emit(ready,{source:{}});await app.emit({...ready,session:'wrong'});assert.equal(app.messages.length,0);
  await app.emit(ready);await app.emit(ready);assert.equal(app.messages.length,1);assert.equal(app.messages[0].origin,'https://esp32.iverfinne.no');
  assert.equal(app.messages[0].data.data.byteLength,384*4);assert.equal(snapshot.data.byteLength,384*4);
  await app.emit({type:'entropi-print-started',session:app.session});await app.emit({type:'entropi-print-result',session:app.session,ok:true});assert.equal(await printing,true);assert.equal(app.closed,false);
  assert.equal(await app.client.print(snapshot),false);
  app.client.dispose();assert.equal(app.closed,true);
});

test('an attempted partial print cannot be replayed by retrying the same snapshot',async()=>{
  const app=harness(),snapshot=image(),printing=app.client.print(snapshot),session=app.session;
  await app.emit({type:'entropi-print-ready',session});await app.emit({type:'entropi-print-started',session});await app.emit({type:'entropi-print-result',session,ok:false,message:'Radio lost'});
  assert.equal(await printing,false);assert.equal(await app.client.print(snapshot),false);assert.equal(app.opened.length,1);
});

test('a paced helper transfer can finish after two minutes and an unresponsive helper still times out',async()=>{
  const app=harness(),snapshot={width:384,height:1024,data:new Uint8ClampedArray(384*1024*4)},printing=app.client.print(snapshot),session=app.session;
  await app.emit({type:'entropi-print-ready',session});await app.emit({type:'entropi-print-started',session});await app.expire(120000);assert.equal(app.closed,false);
  await app.emit({type:'entropi-print-result',session,ok:true});assert.equal(await printing,true);assert.equal(app.closed,false);app.client.dispose();
  const stalled=harness(),pending=stalled.client.print(image());await stalled.expire(300000);assert.equal(await pending,false);assert.equal(stalled.closed,true);assert.match(stalled.reports.at(-1),/svara ikkje/);stalled.client.dispose();
});

test('concurrent gestures, stale results, closed popups and disposal never send another image',async()=>{
  const app=harness(),snapshot=image();let current=true;const printing=app.client.print(snapshot,()=>current);
  assert.equal(await app.client.print(image()),false);current=false;await app.poll();assert.equal(await printing,false);assert.equal(app.messages.length,0);
  const disposed=harness(),pending=disposed.client.print(image());disposed.client.dispose();assert.equal(await pending,false);assert.equal(disposed.closed,true);
  const closed=harness(),closing=closed.client.print(image());closed.popup.closed=true;await closed.poll();assert.equal(await closing,false);assert.equal(closed.messages.length,0);
});

test('invalid snapshots and blocked popups fail without Bluetooth or image delivery',async()=>{
  const app=harness();assert.equal(await app.client.print({width:383,height:1,data:new Uint8Array(1532)}),false);assert.equal(app.opened.length,0);
  const blocked=harness({blocked:true});assert.equal(await blocked.client.print(image()),false);assert.equal(blocked.messages.length,0);assert.match(blocked.reports[0],/Tillat opning/);
});

test('navigating away cancels an unfinished helper while the client remains usable after restoration',async()=>{
  const app=harness(),printing=app.client.print(image());await app.hide();assert.equal(await printing,false);assert.equal(app.closed,true);assert.equal(app.messages.length,0);
  const next=app.client.print(image());assert.equal(app.opened.length,2);app.client.dispose();assert.equal(await next,false);
});

test('a cached page departure preserves the exact helper session before and during sending',async()=>{
  const app=harness(),snapshot=image(),printing=app.client.print(snapshot),session=app.session;
  await app.hide(true);assert.equal(app.closed,false);await app.emit({type:'entropi-print-ready',session});await app.emit({type:'entropi-print-started',session});await app.hide(true);await app.poll();assert.equal(app.closed,false);
  await app.emit({type:'entropi-print-result',session,ok:true});assert.equal(await printing,true);assert.equal(app.opened.length,1);assert.equal(app.messages.length,1);assert.equal(await app.client.print(snapshot),false);app.client.dispose();
});

test('a real departure after a cached departure still closes an unfinished helper',async()=>{
  const app=harness(),printing=app.client.print(image());await app.hide(true);assert.equal(app.closed,false);await app.hide(false);assert.equal(await printing,false);assert.equal(app.closed,true);app.client.dispose();
});
