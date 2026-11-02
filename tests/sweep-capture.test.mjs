import test from 'node:test';
import assert from 'node:assert/strict';
import {createSweepCapture} from '../vendor/sweep-capture.mjs';

const frame=()=>({left:new Blob(['jpeg'],{type:'image/jpeg'}),right:null});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('sweep serializes requests and finishes on release with completed sources',async()=>{
  let active=0,peak=0;
  const sweep=createSweepCapture({maxMs:500,intervalMs:5,capture:async signal=>{active++;peak=Math.max(peak,active);await pause(10);active--;signal.throwIfAborted();return frame()},onFrame:n=>{if(n===3)sweep.finish()}});
  const frames=await sweep.done;
  assert.equal(peak,1);assert.equal(frames.length,3);assert.ok(frames.every(f=>f.left.size&&Number.isFinite(f.elapsedMs)&&f.capturedAt));
});
test('hard deadline aborts in-flight capture and retains completed frames',async()=>{
  let count=0,aborted=false;
  const sweep=createSweepCapture({maxMs:60,intervalMs:0,capture:signal=>{if(++count<3)return frame();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason)},{once:true}))}});
  assert.equal((await sweep.done).length,2);assert.equal(aborted,true);
});
test('cancel discards a sweep even after usable frames',async()=>{
  const sweep=createSweepCapture({maxMs:500,intervalMs:0,capture:async()=>frame(),onFrame:n=>{if(n===2)sweep.cancel()}});
  await assert.rejects(sweep.done,{name:'AbortError'});
});
test('source count is bounded while held and release cannot request another photo',async()=>{
  let count=0;
  const sweep=createSweepCapture({maxMs:500,maxFrames:2,intervalMs:0,capture:async()=>{count++;return frame()}});
  await pause(30);assert.equal(count,2);sweep.finish();sweep.finish();assert.equal((await sweep.done).length,2);assert.equal(count,2);
});
test('failed capture reports its error and a short hold keeps its one original',async()=>{
  const empty=createSweepCapture({maxMs:25,intervalMs:10,capture:async()=>{throw new Error('Camera offline')}});
  await assert.rejects(empty.done,/Camera offline/);
  const original={...frame(),right:new Blob(['right'],{type:'image/jpeg'})};
  const one=createSweepCapture({maxMs:50,intervalMs:100,capture:async()=>original});
  const [photo]=await one.done;assert.equal(photo.left,original.left);assert.equal(photo.right,original.right);
});
test('releasing during the first exposure finishes that shot without taking a second',async()=>{
  const original=frame();let complete,calls=0;
  const sweep=createSweepCapture({maxMs:500,capture:()=>{calls++;return new Promise(resolve=>{complete=resolve})}});
  sweep.finish();complete(original);
  const frames=await sweep.done;assert.equal(calls,1);assert.equal(frames.length,1);assert.equal(frames[0].left,original.left);
});

test('the deadline and cancellation still stop a first exposure after release',async()=>{
  for(const cancel of [false,true]){
    let signal;
    const sweep=createSweepCapture({maxMs:40,capture:s=>{signal=s;return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}))}});
    sweep.finish();assert.equal(signal.aborted,false);
    if(cancel)sweep.cancel();
    await assert.rejects(sweep.done,cancel?{name:'AbortError'}:/rakk ikkje/);assert.equal(signal.aborted,true);
  }
});

test('capture limits cannot exceed hardware and memory bounds',()=>{
  for(const options of [{maxMs:15001},{maxFrames:9},{intervalMs:-1}])assert.throws(()=>createSweepCapture({capture:async()=>frame(),...options}));
});
