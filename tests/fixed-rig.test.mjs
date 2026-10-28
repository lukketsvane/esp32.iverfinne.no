import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FIXED_STEREO_RIG,prepareFixedStereo,restoreFixedStereo} from '../pointcloud/stereo-rig.mjs';
import {estimateStereoDepth} from '../pointcloud/stereo.mjs';

function texture(width,height,seed=123){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const v=seed>>>24;data.set([v,v,v,255],i*4)}
  return {data,width,height};
}
function verticalPair(width,height,disparity){
  const left=texture(width,height),right=texture(width,height,999);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const d=typeof disparity==='function'?disparity(x,y):disparity;
    if(y+d<height)right.data.set(left.data.subarray((y*width+x)*4,(y*width+x)*4+4),((y+d)*width+x)*4);
  }
  return [left,right];
}
const identity={...FIXED_STEREO_RIG,left:[0,1,0,0,0,1],right:[0,1,0,0,0,1]};
const solve=(left,right,profile=identity)=>{const p=prepareFixedStereo(left,right,profile);return restoreFixedStereo(estimateStereoDepth(p.left,p.right,p.width,p.height),left.width,left.height,profile)};

test('permanent profile has a fixed sensor direction and makes no metric or sync claim',()=>{
  assert.ok(Object.isFrozen(FIXED_STEREO_RIG));assert.equal(FIXED_STEREO_RIG.quarterTurns,1);
  assert.equal(FIXED_STEREO_RIG.metric,false);assert.equal(FIXED_STEREO_RIG.hardwareSynchronized,false);
  assert.notEqual(FIXED_STEREO_RIG.primary,FIXED_STEREO_RIG.secondary);
});

test('clockwise matching rotation does not change source frames or drop alpha',()=>{
  const a=texture(8,6),b=texture(8,6,999),savedA=a.data.slice(),savedB=b.data.slice();a.data[3]=0;savedA[3]=0;
  const p=prepareFixedStereo(a,b,identity);assert.equal(p.width,6);assert.equal(p.height,8);
  for(let y=0;y<6;y++)for(let x=0;x<8;x++){const source=a.data.subarray((y*8+x)*4,(y*8+x+1)*4);assert.deepEqual(p.left.subarray((x*6+5-y)*4,(x*6+6-y)*4),source[3]<128?new Uint8ClampedArray(4):source)}
  assert.deepEqual(a.data,savedA);assert.deepEqual(b.data,savedB);
  assert.notEqual(p.left.buffer,a.data.buffer);assert.notEqual(p.right.buffer,b.data.buffer);
});

for(const disparity of [5,12,20])test('vertical rig recovers '+disparity+'px without a tuning value',()=>{
  const [left,right]=verticalPair(96,72,disparity),result=solve(left,right),values=[];
  for(let y=8;y<72-disparity-8;y++)for(let x=8;x<88;x++){const i=y*96+x;if(result.valid[i])values.push(result.depth[i])}
  assert.ok(result.matchedFraction>.3);assert.ok(values.length>1200);assert.ok(values.every(value=>value===disparity));
  assert.equal(result.width,96);assert.equal(result.height,72);
  for(let i=0;i<result.depth.length;i++)assert.equal(Number.isFinite(result.depth[i]),result.valid[i]===1);
});

test('measured-axis rectification restores two known depths through nonidentity shear',()=>{
  const width=160,height=120,left=texture(width,height),right=texture(width,height,999);
  const profile={...identity,width,height,left:[-.2,1,8,0,0,1],right:[-.2,1,15,0,0,1]};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const disparity=x<80?10:20,rx=x-.2*disparity-7,ry=y+disparity;
    if(rx>=0&&ry<height)right.data.set(left.data.subarray((y*width+x)*4,(y*width+x+1)*4),(ry*width+rx)*4);
  }
  const originalLeft=left.data.slice(),originalRight=right.data.slice(),result=solve(left,right,profile);
  for(const [x0,x1,disparity] of [[24,64,10],[100,144,20]]){
    const values=[];for(let y=12;y<84;y++)for(let x=x0;x<x1;x++){const i=y*width+x;if(result.valid[i])values.push(result.depth[i])}
    assert.ok(values.length>2000,values.length);
    assert.ok(values.every(value=>value===disparity));
  }
  assert.deepEqual(left.data,originalLeft);assert.deepEqual(right.data,originalRight);
  assert.equal(result.width,width);assert.equal(result.height,height);
  for(let i=0;i<result.depth.length;i++)assert.equal(Number.isFinite(result.depth[i]),result.valid[i]===1);
});

test('fixed rectification keeps unmapped borders and transparent source pixels invalid',()=>{
  const left=texture(80,60),right=texture(80,60,999),profile={...identity,width:80,height:60,left:[0,1,4,0,0,1]};
  left.data[(20*80+30)*4+3]=0;
  const original=left.data.slice(),p=prepareFixedStereo(left,right,profile);
  for(let y=0;y<4;y++)for(let x=0;x<p.width;x++)assert.equal(p.left[(y*p.width+x)*4+3],0);
  assert.equal(p.left[((30+4)*p.width+59-20)*4+3],0);
  assert.equal(p.left[((31+4)*p.width+59-20)*4+3],255);
  assert.deepEqual(left.data,original);
});

test('projective row sampling and restoration retain the reference pixel scale',()=>{
  const profile={...identity,width:80,height:60,left:[0,1,0,0,.01,1]};
  for(const [width,height,row,red,sourceX,restoredDepth] of [[80,60,20,75,25,21],[40,30,10,78,12,11]]){
    const left=texture(width,height),right=texture(width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)left.data[(y*width+x)*4]=3*((x+.5)*80/width-.5);
    const prepared=prepareFixedStereo(left,right,profile);
    assert.equal(prepared.left[(row*height+10)*4],red);
    const prediction={width:height,height:width,depth:Float32Array.from({length:width*height},(_,i)=>Math.floor(i/height)+1),valid:new Uint8Array(width*height).fill(1)};
    const restored=restoreFixedStereo(prediction,width,height,profile);
    assert.equal(restored.depth[10*width+sourceX],restoredDepth);
    assert.ok(prepared.left.some((value,index)=>index%4===3&&value===0));
  }
});

test('rotated maximum frame respects the original 76800-pixel budget',()=>{
  const [left,right]=verticalPair(320,240,36),p=prepareFixedStereo(left,right,identity);
  assert.deepEqual([p.width,p.height],[240,320]);
  const r=restoreFixedStereo(estimateStereoDepth(p.left,p.right,p.width,p.height),320,240,identity);
  const values=Array.from(r.depth).filter(Number.isFinite);assert.ok(values.length>15000);
  values.sort((a,b)=>a-b);assert.equal(values[Math.floor(values.length/2)],36);
  assert.throws(()=>estimateStereoDepth(new Uint8ClampedArray(),new Uint8ClampedArray(),320,320),/oppløysing/);
});

test('bad predictions and invalid masks cannot enter the cloud renderer',()=>{
  for(const prediction of [null,{}, {width:6,height:8,depth:new Float32Array(48),valid:new Uint8Array(47)}])assert.throws(()=>restoreFixedStereo(prediction,8,6));
  const r=restoreFixedStereo({width:6,height:8,depth:new Float32Array(48).fill(NaN),valid:new Uint8Array(48).fill(1)},8,6);
  assert.equal(r.matchedFraction,0);assert.ok(r.valid.every(value=>value===0));
  assert.throws(()=>prepareFixedStereo(texture(8,6),texture(8,7)),/same fotooppløysing/);
  assert.throws(()=>prepareFixedStereo(texture(80,80),texture(80,80)),/Kameraformatet/);
  const values=new Float32Array(48).fill(7),mask=new Uint8Array(48).fill(1);values[5]=0;values[10]=-4;values[15]=Infinity;mask[20]=2;mask[25]=0;
  const restored=restoreFixedStereo({width:6,height:8,depth:values,valid:mask},8,6,identity);
  assert.equal(restored.valid.reduce((a,b)=>a+b,0),43);
  for(let i=0;i<restored.depth.length;i++)assert.equal(Number.isFinite(restored.depth[i]),restored.valid[i]===1);
});

test('firmware and hosted offline graph include the same fixed rig',async()=>{
  const scene=await readFile(new URL('../vendor/scene.mjs',import.meta.url),'utf8'),stereo=await readFile(new URL('../vendor/stereo-depth.mjs',import.meta.url),'utf8'),sw=await readFile(new URL('../sw.js',import.meta.url),'utf8'),build=await readFile(new URL('../device/build-ui.py',import.meta.url),'utf8');
  assert.match(scene,/runStereoDepth\(left,right,/);assert.match(stereo,/prepareFixedStereo\(pixels\[0\],pixels\[1\]\)/);assert.match(stereo,/restoreFixedStereo/);
  assert.doesNotMatch(scene+stereo,/verticalShift|shiftStereoRows/);
  assert.match(sw,/\/pointcloud\/stereo-rig\.mjs/);assert.match(build,/pointcloud\/stereo-rig\.mjs/);
});
