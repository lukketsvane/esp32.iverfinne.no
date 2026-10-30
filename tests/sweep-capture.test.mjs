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
test('too short and failed captures produce actionable errors without a fake panorama',async()=>{
  const empty=createSweepCapture({maxMs:25,intervalMs:10,capture:async()=>{throw new Error('Camera offline')}});
  await assert.rejects(empty.done,/Camera offline/);
  const one=createSweepCapture({maxMs:50,intervalMs:100,capture:async()=>frame()});
  await assert.rejects(one.done,/minst to foto/);
});
test('capture limits cannot exceed hardware and memory bounds',()=>{
  for(const options of [{maxMs:15001},{maxFrames:9},{intervalMs:-1}])assert.throws(()=>createSweepCapture({capture:async()=>frame(),...options}));
});
