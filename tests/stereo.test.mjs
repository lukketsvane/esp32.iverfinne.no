import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { estimateStereoDepth } from '../pointcloud/stereo.mjs';

function texture(width,height,seed=123){
  const image=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    const value=seed>>>24;image.set([value,value,value,255],i*4);
  }
  return image;
}
function shifted(left,width,height,disparity){
  const right=texture(width,height,321);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const d=typeof disparity==='function'?disparity(x,y):disparity;
    if(x-d>=0&&x-d<width)right.set(left.subarray((y*width+x)*4,(y*width+x+1)*4),(y*width+x-d)*4);
  }
  return right;
}
function valuesIn(result,x0,x1,y0,y1){
  const values=[];
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*result.width+x;if(result.valid[i])values.push(result.depth[i])}
  return values;
}

test('known horizontal shift recovers disparity without filling invalid pixels',()=>{
  const width=96,height=64,left=texture(width,height),result=estimateStereoDepth(left,shifted(left,width,height,7),width,height);
  const interior=valuesIn(result,20,88,8,56);
  assert.ok(result.matchedFraction>.65);assert.ok(interior.length>3000);assert.ok(interior.every(value=>value===7));
  assert.ok(result.valid.some(value=>value===0));
  for(let i=0;i<result.depth.length;i++)assert.equal(Number.isFinite(result.depth[i]),result.valid[i]===1);
  assert.equal(result.matchedFraction,result.valid.reduce((sum,value)=>sum+value,0)/(width*height));
});

test('two scene layers retain distinct near and far disparities',()=>{
  const width=128,height=80,left=texture(width,height),right=shifted(left,width,height,(x,y)=>y<40?4:12);
  const result=estimateStereoDepth(left,right,width,height),far=valuesIn(result,24,116,8,32),near=valuesIn(result,24,116,48,72);
  assert.ok(far.length>2000);assert.ok(near.length>2000);
  assert.ok(far.every(value=>value===4));assert.ok(near.every(value=>value===12));
});

test('census correspondence survives a monotonic brightness change',()=>{
  const width=96,height=64,left=texture(width,height),right=shifted(left,width,height,5);
  for(let i=0;i<right.length;i+=4)for(let channel=0;channel<3;channel++)right[i+channel]=Math.round(right[i+channel]*.7+25);
  const result=estimateStereoDepth(left,right,width,height),interior=valuesIn(result,20,88,8,56);
  assert.ok(result.matchedFraction>.6);assert.ok(interior.every(value=>value===5));
});

test('unrelated, flat, transparent and reversed stereo pairs are rejected',()=>{
  const width=96,height=64,left=texture(width,height),flat=new Uint8ClampedArray(width*height*4).fill(128),transparent=left.slice();
  for(let i=3;i<transparent.length;i+=4)transparent[i]=0;
  for(const pair of [[left,texture(width,height,999)],[flat,flat],[transparent,shifted(transparent,width,height,7)],[left,shifted(left,width,height,-7)]]){
    assert.throws(()=>estimateStereoDepth(...pair,width,height),/For få sikre samsvar/);
  }
});

test('malformed dimensions and pixel buffers are rejected before matching',()=>{
  const image=texture(32,24);
  for(const [width,height] of [[0,24],[32,0],[23,24],[32,15],[321,24],[32,321],[320,241],[32.5,24],[NaN,24]])assert.throws(()=>estimateStereoDepth(image,image,width,height),/oppløysing/);
  for(const other of [null,[],new Uint8Array(image),image.subarray(4)])assert.throws(()=>estimateStereoDepth(image,other,32,24),/stereobilete/);
});

test('occluded pixels remain invalid while visible correspondences keep their disparity',()=>{
  const width=128,height=80,left=texture(width,height),right=shifted(left,width,height,6),noise=texture(width,height,987);
  for(let y=16;y<64;y++)for(let x=40;x<80;x++)right.set(noise.subarray((y*width+x)*4,(y*width+x+1)*4),(y*width+x)*4);
  const result=estimateStereoDepth(left,right,width,height),occluded=valuesIn(result,52,80,24,56),visible=valuesIn(result,92,116,16,64);
  assert.ok(occluded.length<10);assert.ok(visible.length>1000);assert.ok(visible.every(value=>value===6));
});

test('a tiny textured patch cannot qualify an otherwise featureless stereo pair',()=>{
  const width=96,height=64,left=new Uint8ClampedArray(width*height*4).fill(128),patch=texture(width,height);
  for(let y=20;y<36;y++)for(let x=40;x<56;x++)left.set(patch.subarray((y*width+x)*4,(y*width+x+1)*4),(y*width+x)*4);
  assert.throws(()=>estimateStereoDepth(left,shifted(left,width,height,5),width,height),/For få sikre samsvar/);
});

test('maximum input size preserves a larger known disparity',()=>{
  const width=320,height=240,left=texture(width,height),result=estimateStereoDepth(left,shifted(left,width,height,40),width,height);
  const interior=valuesIn(result,52,308,12,228);
  assert.ok(result.matchedFraction>.8);assert.ok(interior.length>55000);assert.ok(interior.every(value=>value===40));
});

test('worker transfers valid masks and disparities and reports rejected inputs',async()=>{
  const source=(await readFile(new URL('../pointcloud/stereo-worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  const messages=[],self={postMessage:(message,transfers)=>messages.push({message,transfers})};
  vm.runInNewContext(source,{self,estimateStereoDepth,ArrayBuffer,Uint8ClampedArray});
  const width=64,height=40,left=texture(width,height),right=shifted(left,width,height,4);
  self.onmessage({data:{left:left.buffer,right:right.buffer,width,height}});
  const {message,transfers}=messages[0];assert.equal(message.type,'result');assert.equal(message.width,width);assert.equal(message.height,height);
  assert.deepEqual(Array.from(transfers),[message.depth,message.valid]);assert.ok(message.matchedFraction>.5);
  self.onmessage({data:{left:[],right:[],width,height}});assert.equal(messages[1].message.type,'error');assert.match(messages[1].message.message,/stereobilete/);
  self.onmessage({data:{left:left.buffer,right:texture(width,height,888).buffer,width,height}});assert.equal(messages[2].message.type,'error');
});
