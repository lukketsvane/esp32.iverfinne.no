import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {GrayGifEncoder,rgbaToGrayIndices} from '../vendor/gif-encoder.mjs';
import {loopPhase,loopFramePhase,depthSweepIntensity,sampleLoopDepth,renderLoopFrame,VATHO_LOOP_FRAMES} from '../vendor/vathography-loop.mjs';

test('seamless loop first frame equals periodic endpoint, no duplicated last frame',()=>{
  assert.equal(loopPhase(0),0);
  assert.equal(loopPhase(3000),0);
  assert.equal(loopPhase(-3000),0);
  assert.equal(loopFramePhase(0),0);
  assert.equal(loopFramePhase(VATHO_LOOP_FRAMES-1),59/60);
  assert.throws(()=>loopFramePhase(VATHO_LOOP_FRAMES));
  const samples=Float32Array.from([0,.25,.5,.75,1,NaN]);
  const base=new Uint8ClampedArray(samples.length*4).fill(90);
  for(let i=0;i<samples.length;i++)base[i*4+3]=255;
  const first=renderLoopFrame(base,samples,0);
  const last=renderLoopFrame(base,samples,1);
  assert.deepEqual([...first],[...last]);
  const nearFirst=renderLoopFrame(base,samples,1/6000);
  const nearLast=renderLoopFrame(base,samples,1-1/6000);
  const difference=nearFirst.reduce((n,v,i)=>n+Math.abs(v-nearLast[i]),0);
  assert.ok(difference<6);
  assert.deepEqual(depthSweepIntensity(NaN,.5),{light:0,shadow:0});
});
test('depth sampling respects crop and validity',()=>{
  const values=Float32Array.from([0,.25,.5,1]),validity=Uint8Array.from([1,1,0,1]);
  const output=sampleLoopDepth(values,2,2,2,2,{validity});
  assert.equal(output[0],0);assert.equal(output[1],.25);
  assert.ok(Number.isNaN(output[2]));
  const cropped=sampleLoopDepth(values,2,2,1,1,{crop:{x:.5,y:.5,width:.5,height:.5}});
  assert.equal(cropped[0],1);
});
test('GIF89a, Netscape infinite loop, 20 fps and deterministic bytes',async()=>{
  const encoder=new GrayGifEncoder(256,256,{fps:20});
  const a=new Uint8Array(65536),b=new Uint8Array(65536);
  for(let i=0;i<a.length;i++){a[i]=(Math.imul(i,47)+((i>>>8)*19))&255;b[i]=(a[i]+33)&255}
  encoder.addFrame(a);encoder.addFrame(b);
  const result=new Uint8Array(await encoder.finish().arrayBuffer());
  assert.equal(Buffer.from(result.subarray(0,6)).toString(),'GIF89a');
  assert.equal(Buffer.from(result).includes(Buffer.from('NETSCAPE2.0')),true);
  assert.equal(result.at(-1),0x3b);
  assert.equal(result[6],0);assert.equal(result[7],1);
  const fixture=process.env.VATHO_TEST_GIF;
  if(fixture)await fs.writeFile(fixture,result);
});
test('supports rgba input conversion for neutral black/white',()=>{
  assert.deepEqual([...rgbaToGrayIndices(Uint8Array.from([0,0,0,255,255,255,255,255,255,0,0,255]))],[0,255,54]);
  assert.throws(()=>new GrayGifEncoder(1,1,{fps:30}));
});
