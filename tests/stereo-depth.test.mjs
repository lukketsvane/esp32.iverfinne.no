import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {FIXED_STEREO_RIG,prepareFixedStereo,restoreFixedStereo} from '../pointcloud/stereo-rig.mjs';
import {estimateStereoDepth} from '../pointcloud/stereo.mjs';
import {imageToPointCloud,pointStride,gaussianSplats} from '../pointcloud/math.mjs';
import {qualityPointBudget} from '../pointcloud/primitive.mjs';

const source=(await readFile(new URL('../vendor/stereo-depth.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const scene=await readFile(new URL('../vendor/scene.mjs',import.meta.url),'utf8');
const identity={...FIXED_STEREO_RIG,left:[0,1,0,0,0,1],right:[0,1,0,0,0,1]};
function texture(width=96,height=72,seed=123){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const value=seed>>>24;data.set([value,value,value,255],i*4)}
  return {width,height,data};
}
function shifted(left,disparity){
  const {width,height}=left,right=texture(width,height,999);
  for(let y=0;y<height-disparity;y++)for(let x=0;x<width;x++)right.data.set(left.data.subarray((y*width+x)*4,(y*width+x+1)*4),((y+disparity)*width+x)*4);
  return right;
}
function harness({hang=false,workerError=null,workerResult,profile=identity}={}){
  const urls=new Map(),revoked=[],workers=[],progress=[],transfers=[];let next=0;
  let workerStarted;const started=new Promise(resolve=>{workerStarted=resolve});
  class Image{
    set src(url){this.pixels=urls.get(url);this.naturalWidth=this.pixels.width;this.naturalHeight=this.pixels.height}
    async decode(){if(this.pixels.decodeError)throw this.pixels.decodeError}
  }
  class Worker{
    constructor(path,options){assert.equal(path,'/pointcloud/stereo-worker.mjs');assert.equal(options.type,'module');workers.push(this);workerStarted()}
    terminate(){this.terminated=true}
    postMessage(message,buffers){
      transfers.push(buffers);if(hang)return;
      queueMicrotask(()=>{
        if(workerError){this.onmessage({data:{type:'error',message:workerError}});return}
        try{
          const result=workerResult?workerResult(message):estimateStereoDepth(new Uint8ClampedArray(message.left),new Uint8ClampedArray(message.right),message.width,message.height);
          this.onmessage({data:{type:'result',depth:result.depth.buffer,valid:result.valid.buffer,width:result.width,height:result.height}});
        }catch(error){this.onmessage({data:{type:'error',message:error.message}})}
      });
    }
  }
  const context=vm.createContext({Image,Worker,Float32Array,Uint8Array,Uint8ClampedArray,DOMException,setTimeout,clearTimeout,
    FIXED_STEREO_RIG,prepareFixedStereo:(left,right)=>prepareFixedStereo(left,right,profile),restoreFixedStereo:(prediction,width,height)=>restoreFixedStereo(prediction,width,height,profile),
    URL:{createObjectURL:blob=>{const url='blob:'+(next++);urls.set(url,blob);return url},revokeObjectURL:url=>{revoked.push(url);urls.delete(url)}},
    document:{createElement:()=>({getContext(){let image;return {drawImage:next=>{image=next},getImageData:(_,__,width,height)=>({width,height,data:image.pixels.data.slice()})}}})}
  });
  vm.runInContext(source,context);
  return {run:(left,right,options={})=>context.runStereoDepth(left,right,{onProgress:value=>progress.push(value.phase),...options}),workers,urls,revoked,progress,transfers,started};
}

test('shared stereo depth uses the right image and preserves numerical validity and source provenance',async()=>{
  const app=harness(),left=texture(),right=shifted(left,5),originalLeft=left.data.slice(),originalRight=right.data.slice();
  const first=await app.run(left,right),second=await app.run(left,shifted(left,12));
  const median=result=>{const values=Array.from(result.depth).filter(Number.isFinite).sort((a,b)=>a-b);return values[Math.floor(values.length/2)]};
  assert.equal(median(first),5);assert.equal(median(second),12);assert.notDeepEqual(first.depth,second.depth);
  assert.equal(first.source,'stereo');assert.equal(first.polarity,'near');assert.equal(first.rigId,FIXED_STEREO_RIG.id);
  assert.equal(first.metric,false);assert.equal(first.hardwareSynchronized,false);assert.match(first.model,/Stereo/);
  assert.equal(first.quantity,'disparity');assert.equal(first.units,'px');assert.equal(first.provenance.rigId,first.rigId);assert.equal(first.provenance.matchedFraction,first.matchedFraction);
  assert.deepEqual([first.width,first.height,first.sourceWidth,first.sourceHeight],[96,72,96,72]);
  assert.equal(first.matchedFraction,first.validity.reduce((sum,value)=>sum+value,0)/first.depth.length);
  for(let i=0;i<first.depth.length;i++)assert.equal(Number.isFinite(first.depth[i]),first.validity[i]===1);
  assert.deepEqual(first.pixels.data,originalLeft);assert.deepEqual(left.data,originalLeft);assert.deepEqual(right.data,originalRight);
  assert.equal(app.urls.size,0);assert.equal(app.revoked.length,4);assert.ok(app.workers.every(worker=>worker.terminated));
  assert.deepEqual(app.progress,['reading','matching','reading','matching']);assert.equal(app.transfers[0].length,2);
});

test('shared stereo depth preserves native dimensions while matching only bounded pixels',async()=>{
  const app=harness(),left=texture(320,240),right=shifted(left,20);
  const result=await app.run({...left,width:1600,height:1200},{...right,width:1600,height:1200});
  assert.deepEqual([result.width,result.height,result.sourceWidth,result.sourceHeight],[320,240,1600,1200]);
  assert.ok(result.matchedFraction>.5);
});

test('a sparse worker result is rejected as insufficient full-frame coverage after restoration',async()=>{
  const app=harness({workerResult:({width,height})=>({width,height,depth:new Float32Array(width*height).fill(12),valid:Uint8Array.from({length:width*height},(_,i)=>i%50===0?1:0)})}),left=texture(320,240);
  await assert.rejects(app.run(left,shifted(left,12)),error=>error.code==='STEREO_COVERAGE_LOW'&&/under 5 %/.test(error.message));
  assert.equal(app.urls.size,0);assert.equal(app.workers[0].terminated,true);
});

test('coverage uses the restored original-frame mask rather than the worker frame',async()=>{
  const profile={...identity,left:[0,2,0,0,0,1]},left=texture(),prediction={width:72,height:96,depth:new Float32Array(72*96).fill(8),valid:new Uint8Array(72*96)};
  for(let y=4;y<12;y++)for(let x=4;x<68;x++)prediction.valid[y*72+x]=1;
  assert.ok(prediction.valid.reduce((sum,value)=>sum+value,0)/prediction.valid.length>.05);
  assert.ok(restoreFixedStereo(prediction,96,72,profile).matchedFraction<.05);
  const app=harness({profile,workerResult:()=>prediction});
  await assert.rejects(app.run(left,shifted(left,8)),error=>error.code==='STEREO_COVERAGE_LOW');
});

test('the coverage floor includes exactly five percent without claiming calibration',async()=>{
  const left=texture(320,240),app=harness({workerResult:({width,height})=>({width,height,depth:new Float32Array(width*height).fill(12),valid:Uint8Array.from({length:width*height},(_,i)=>i%20===0?1:0)})});
  const result=await app.run(left,shifted(left,12));
  assert.equal(result.matchedFraction,.05);assert.equal(result.provenance.metric,false);assert.equal(result.provenance.hardwareSynchronized,false);
});

test('unrelated views and worker failures remain rejected without a monocular substitute',async()=>{
  const app=harness(),left=texture();
  await assert.rejects(app.run(left,texture(96,72,444)),/For få sikre samsvar/);
  assert.equal(app.urls.size,0);assert.ok(app.workers.every(worker=>worker.terminated));
  const failed=harness({workerError:'Worker failure'});
  await assert.rejects(failed.run(left,shifted(left,5)),/Worker failure/);
  assert.ok(failed.workers[0].terminated);
});

test('invalid or cancelled source decoding releases URLs before any worker starts',async()=>{
  const app=harness(),left=texture(),controller=new AbortController();controller.abort();
  await assert.rejects(app.run(left,shifted(left,5),{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(app.run(left,texture(96,73)),/same fotooppløysing/);
  await assert.rejects(app.run(left,{...left,decodeError:new Error('Decode failure')}),/Decode failure/);
  assert.equal(app.urls.size,0);assert.equal(app.workers.length,0);
});

test('cancelling stereo matching terminates its worker',async()=>{
  const app=harness({hang:true}),left=texture(),controller=new AbortController(),pending=app.run(left,shifted(left,5),{signal:controller.signal});
  await app.started;
  assert.equal(app.workers.length,1);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(app.workers[0].terminated,true);
});

test('stereo scene retains every valid measurement when the count fits its point budget',async()=>{
  const width=320,height=240,pixels=texture(width,height),depth=new Float32Array(width*height).fill(NaN),validity=new Uint8Array(depth.length);
  for(let i=0;i<depth.length;i++)if(i%7){validity[i]=1;depth[i]=4+i%13}
  const prediction={depth,validity,width,height,pixels},context=vm.createContext({runStereoDepth:async()=>prediction,imageToPointCloud,pointStride,gaussianSplats,qualityPointBudget,renderScene:(_,cloud)=>cloud});
  vm.runInContext(scene.slice(scene.indexOf('async function stereoScene('),scene.indexOf('export async function createDepthScene(')),context);
  const measured=validity.reduce((sum,value)=>sum+value,0),cloud=await context.stereoScene({},null,null,()=>{},new AbortController().signal,2);
  assert.ok(measured<70000);assert.equal(cloud.count,measured);assert.equal(cloud.stride,1);
  for(const offset of cloud.pixelOffsets)assert.equal(validity[offset/4],1);
  const limited=await context.stereoScene({},null,null,()=>{},new AbortController().signal,0);
  assert.ok(limited.count<=qualityPointBudget(0));assert.ok(limited.stride>1);
});
