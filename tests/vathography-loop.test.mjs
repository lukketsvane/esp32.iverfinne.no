import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {GrayGifEncoder,rgbaToGrayIndices} from '../vendor/gif-encoder.mjs';
import {loopPhase,loopFramePhase,loopToneParameters,VATHO_LOOP_MODES,VATHO_LOOP_FRAMES} from '../vendor/vathography-loop.mjs';

test('seamless loop first frame equals periodic endpoint, no duplicated last frame',()=>{
  assert.equal(loopPhase(0),0);
  assert.equal(loopPhase(3000),0);
  assert.equal(loopPhase(-3000),0);
  assert.equal(loopFramePhase(0),0);
  assert.equal(loopFramePhase(VATHO_LOOP_FRAMES-1),59/60);
  assert.throws(()=>loopFramePhase(VATHO_LOOP_FRAMES));
  const trajectories=new Set();
  for(const {id} of VATHO_LOOP_MODES){
    const base={position:.12,width:1.22};
    assert.deepEqual(loopToneParameters(base,id,0),base);
    assert.deepEqual(loopToneParameters(base,id,1),base);
    const path=Array.from({length:VATHO_LOOP_FRAMES},(_,i)=>loopToneParameters(base,id,loopFramePhase(i)));
    assert.ok(path.some(tone=>tone.position!==base.position),'single-finger depth position moves: '+id);
    trajectories.add(JSON.stringify(path));
    for(const start of [{position:-1,width:.25},{position:1,width:3}]){
      const positions=Array.from({length:60},(_,i)=>loopToneParameters(start,id,i/60));
      assert.ok(positions.some(v=>v.position!==start.position||v.width!==start.width),'motion at boundary '+id);
      assert.ok(positions.every(v=>v.position>=-1&&v.position<=1&&v.width>=.25&&v.width<=3));
    }
  }
  assert.equal(trajectories.size,VATHO_LOOP_MODES.length);
  assert.ok(trajectories.size>=6);
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
