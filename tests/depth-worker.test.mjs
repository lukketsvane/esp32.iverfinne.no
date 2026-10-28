import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scene=(await readFile(new URL('../vendor/scene.mjs',import.meta.url),'utf8')).split('function renderScene(')[0].replace(/^import .*;\r?\n/gm,'');
function host(){
  const workers=[],timers=new Map(),events=new Map();let id=0;
  class Worker{
    constructor(){this.requests=[];this.stopped=false;workers.push(this)}
    postMessage(message){this.requests.push(message)}
    terminate(){this.stopped=true}
    result(value){this.onmessage({data:{type:'result',depth:new Float32Array([value]).buffer,width:1,height:1}})}
  }
  const document={hidden:false,addEventListener:(name,handler)=>events.set(name,handler)};
  const context=vm.createContext({Worker,document,DOMException,Float32Array,Uint8ClampedArray,setTimeout:(fn,delay)=>{const n=++id;timers.set(n,{fn,delay});return n},clearTimeout:n=>timers.delete(n),addEventListener:(name,handler)=>events.set(name,handler)});
  vm.runInContext(scene+'\nglobalThis.run=estimateDepth;',context);
  return {workers,timers,document,events,run:signal=>context.run({data:new Uint8ClampedArray(16),width:2,height:2},()=>{},signal??new AbortController().signal),expire(delay){for(const [n,timer]of [...timers])if(timer.delay===delay){timers.delete(n);timer.fn()}}};
}

test('separate depth jobs reuse one warm worker and return distinct predictions',async()=>{
  const app=host(),first=app.run();app.workers[0].result(3);assert.equal((await first).depth[0],3);
  const next=app.run();assert.equal(app.workers.length,1);assert.equal(app.workers[0].requests.length,2);
  app.workers[0].result(8);assert.equal((await next).depth[0],8);assert.equal(app.workers[0].stopped,false);
  app.expire(30000);assert.equal(app.workers[0].stopped,true);
});

test('aborting work retires its worker and a fresh job cannot receive its late result',async()=>{
  const app=host(),controller=new AbortController(),first=app.run(controller.signal),old=app.workers[0],queued=old.onmessage;
  controller.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(old.stopped,true);
  const next=app.run();queued({data:{type:'result',depth:new Float32Array([99]).buffer,width:1,height:1}});
  app.workers[1].result(7);assert.equal((await next).depth[0],7);assert.equal(app.workers[1].stopped,false);app.expire(30000);
});

test('idle expiry never interrupts the next active inference and job timeout frees memory',async()=>{
  const app=host(),first=app.run();app.workers[0].result(1);await first;const next=app.run();
  app.expire(30000);assert.equal(app.workers[0].stopped,false);app.expire(180000);await assert.rejects(next,/lang tid/);assert.equal(app.workers[0].stopped,true);
});

test('backgrounding releases an idle engine and a background result is not retained',async()=>{
  const app=host(),first=app.run();app.workers[0].result(1);await first;app.document.hidden=true;app.events.get('visibilitychange')();assert.equal(app.workers[0].stopped,true);
  const next=app.run();app.workers[1].result(2);await next;assert.equal(app.workers[1].stopped,true);
});

const worker=(await readFile(new URL('../pointcloud/depth-worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'https://example.test/pointcloud/depth-worker.mjs'");
test('the worker keeps one model session across photographs while freeing per-image tensors',async()=>{
  let created=0,downloads=0,runs=0,disposed=0;const messages=[],manifest={asset:{bytes:4},runtime:{bytes:3}};
  const session={inputNames:['image'],outputNames:['depth'],async run(){runs++;return {depth:{data:new Float32Array(196).fill(runs),dims:[1,14,14],dispose(){disposed++}}}},async release(){}};
  const context=vm.createContext({URL,location:{protocol:'https:'},env:{wasm:{}},self:{postMessage:message=>messages.push(message)},Float32Array,Uint8ClampedArray,
    InferenceSession:{async create(){created++;return session}},Tensor:class{dispose(){disposed++}},normalizedImage:()=>new Float32Array(588),fetch:async()=>({ok:true,json:async()=>manifest}),loadAsset:async(asset,progress)=>{downloads++;progress(100);return new Uint8Array(asset.bytes)},loadCachedAsset:async()=>{throw Error('wrong source')}});
  vm.runInContext(worker,context);
  for(const [width,height] of [[14,14],[14,14],[518,392]])await context.self.onmessage({data:{rgba:new Uint8ClampedArray(width*height*4).buffer,width,height}});
  assert.equal(created,1);assert.equal(downloads,2);assert.equal(runs,3);assert.equal(disposed,6);
  assert.deepEqual(messages.filter(message=>message.type==='result').map(message=>new Float32Array(message.depth)[0]),[1,2,3]);
  const progress=messages.filter(message=>message.type==='progress'&&Number.isFinite(message.percent)).map(message=>message.percent);assert.equal(progress.at(-1),100);assert.ok(progress.every((value,i)=>i===0||value>=progress[i-1]));
  await context.self.onmessage({data:{rgba:new Uint8ClampedArray(532*392*4).buffer,width:532,height:392}});
  assert.equal(runs,3);assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).message,/biletoppløysing/);
});
