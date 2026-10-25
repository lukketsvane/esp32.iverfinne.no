import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sha256, loadAsset, loadCachedAsset, storeAsset } from '../pointcloud/assets.mjs';
import { memoryIndexedDB } from './helpers/indexeddb.mjs';
import { inferenceSize, normalizedImage, pointStride, imageToPointCloud, gaussianSplats } from '../pointcloud/math.mjs';
import { createDepthScene } from '../vendor/scene.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const image = () => {
  const rgba = Uint8ClampedArray.from({ length: 64 }, (_, i) => i % 4 === 3 ? 255 : i);
  const depth = Float32Array.from({ length: 16 }, (_, i) => i);
  return { rgba, width: 4, height: 4, depth, depthWidth: 4, depthHeight: 4, stride: 1 };
};

test('inference dimensions fit the real model and preserve bounded point counts', () => {
  for (const [width,height] of [[1600,1200],[1200,1600],[320,240],[4000,500]]) {
    const size = inferenceSize(width,height);
    assert.ok(size.width <= 420 && size.height <= 420);
    assert.equal(size.width % 14, 0);
    assert.equal(size.height % 14, 0);
    const stride = pointStride(width,height);
    assert.ok(Math.ceil(width/stride)*Math.ceil(height/stride) <= 42000);
  }
});

test('model normalization uses independent colour channels and ImageNet statistics', () => {
  const tensor = normalizedImage(new Uint8ClampedArray([255,0,128,255]),1,1);
  assert.equal(tensor.length,3);
  assert.ok(Math.abs(tensor[0]-(1-.485)/.229)<1e-6);
  assert.ok(Math.abs(tensor[1]-(0-.456)/.224)<1e-6);
  assert.ok(Math.abs(tensor[2]-(128/255-.406)/.225)<1e-6);
});

test('real inverse-depth values control geometry independently of photograph brightness', () => {
  const input = image(), cloud = imageToPointCloud(input);
  assert.equal(cloud.count,16);
  assert.ok(cloud.positions[2] < cloud.positions[47]);
  assert.deepEqual([...cloud.colors.subarray(0,3)],[0,1,2]);
  const changed = imageToPointCloud({...input,rgba:new Uint8ClampedArray(input.rgba).fill(255)});
  assert.deepEqual(changed.positions,cloud.positions);
  assert.equal(cloud.estimated,true);
  assert.equal(cloud.units,'relative');
});

test('invalid depth data cannot become an invented 3D scene', () => {
  assert.throws(()=>imageToPointCloud({...image(),depth:new Float32Array(16).fill(NaN)}),/ugyldige punkt/);
  assert.throws(()=>imageToPointCloud({...image(),depth:new Float32Array(2)}),/djupnekart/);
});

test('stereo confidence removes unmatched pixels without filling or interpolating holes',()=>{
  const input=image(),depth=new Float32Array(16).fill(NaN),valid=new Uint8Array(16);depth[0]=4;depth[15]=12;valid[0]=valid[15]=1;
  const cloud=imageToPointCloud({...input,depth,valid});
  assert.equal(cloud.count,2);assert.deepEqual([...cloud.pixelOffsets],[0,60]);assert.ok([...cloud.positions].every(Number.isFinite));
  assert.throws(()=>imageToPointCloud({...input,depth,valid:new Uint8Array(16).fill(1)}),/ugyldige punkt/);
  assert.throws(()=>imageToPointCloud({...input,depth,valid:new Uint8Array(2)}),/stereomaske/);
});

test('Gaussian renderer records carry finite XYZ, depth-scaled isotropic covariance, RGB, opacity and identity rotation', () => {
  const cloud = imageToPointCloud(image()), bytes = gaussianSplats(cloud), view = new DataView(bytes.buffer);
  assert.equal(bytes.length,cloud.count*32);
  for(let i=0;i<cloud.count;i++) {
    for(let c=0;c<3;c++)assert.equal(view.getFloat32(i*32+c*4,true),cloud.positions[i*3+c]);
    const scale=view.getFloat32(i*32+12,true);
    assert.ok(Number.isFinite(scale)&&scale>0);
    assert.equal(view.getFloat32(i*32+16,true),scale);
    assert.equal(view.getFloat32(i*32+20,true),scale);
    assert.deepEqual([...bytes.subarray(i*32+24,i*32+27)],[...cloud.colors.subarray(i*3,i*3+3)]);
    assert.deepEqual([...bytes.subarray(i*32+27,i*32+32)],[230,255,128,128,128]);
  }
  assert.ok(view.getFloat32(12,true)>view.getFloat32((cloud.count-1)*32+12,true));
  assert.throws(()=>gaussianSplats({...cloud,positions:new Float32Array(cloud.count*3).fill(NaN)}),/Ugyldig/);
});

test('SHA-256 works without a secure browser context, including padding boundaries', () => {
  for(const length of [0,1,3,55,56,63,64,65,127,128,1024*1024]) {
    const bytes=Uint8Array.from({length},(_,i)=>(i*71+19)%256);
    assert.equal(sha256(bytes),digest(bytes));
  }
});

test('online preparation uses its own verified model before a pinned public fallback', async () => {
  const bytes=new Uint8Array([1,2,3,4]),calls=[];
  const asset={local:'/pointcloud/model',url:'https://example.test/model',bytes:bytes.length,sha256:digest(bytes)};
  const result=await loadAsset(asset,()=>{},undefined,async url=>{calls.push(url);return new Response(bytes)});
  assert.deepEqual(result,bytes);
  assert.deepEqual(calls,[asset.local]);
});

test('a corrupt online model falls back to a verified pinned download', async () => {
  const bytes=new Uint8Array([1,2,3,4]),calls=[];
  const asset={local:'/pointcloud/model',url:'https://example.test/model',bytes:bytes.length,sha256:digest(bytes)};
  const result=await loadAsset(asset,()=>{},undefined,async url=>{calls.push(url);return new Response(url===asset.local?new Uint8Array([9,9,9,9]):bytes)});
  assert.deepEqual(result,bytes);
  assert.deepEqual(calls,[asset.local,asset.url]);
});

test('wrong checksums, truncated data and oversized streams never reach inference', async () => {
  const bytes=new Uint8Array([1,2,3,4]),asset={local:'/model',bytes:4,sha256:digest(bytes)};
  for(const data of [new Uint8Array([1,2,3]),new Uint8Array([9,9,9,9]),new Uint8Array([1,2,3,4,5])]) {
    await assert.rejects(loadAsset(asset,()=>{},undefined,async()=>new Response(data)),{code:'PHONE_SETUP_REQUIRED'});
  }
});

test('camera inference loads only verified phone cache and never requires a card or network', async () => {
  const previous=globalThis.indexedDB;globalThis.indexedDB=memoryIndexedDB();
  const bytes=new Uint8Array([1,2,3,4]),asset={bytes:4,sha256:digest(bytes)};
  try{
    await assert.rejects(loadCachedAsset(asset),{code:'PHONE_SETUP_REQUIRED'});
    assert.deepEqual(await storeAsset(asset,bytes),bytes);
    assert.deepEqual(await loadCachedAsset(asset),bytes);
    await assert.rejects(storeAsset(asset,new Uint8Array([9,9,9,9])),/kontrollerast/);
    assert.deepEqual(await loadCachedAsset(asset),bytes);
    const db=await new Promise(resolve=>{const request=indexedDB.open('entropi-depth-v1',1);request.onsuccess=()=>resolve(request.result)});
    await new Promise(resolve=>{const transaction=db.transaction('assets','readwrite');transaction.objectStore('assets').put(new Uint8Array([9,9,9,9]).buffer,asset.sha256);transaction.oncomplete=resolve});
    await assert.rejects(loadCachedAsset(asset),{code:'PHONE_SETUP_REQUIRED'});
  }finally{if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous}
});

test('abort prevents model fetching and scene allocation', async () => {
  const controller=new AbortController();controller.abort();let fetched=false;
  await assert.rejects(loadAsset({local:'/model',bytes:1,sha256:digest(new Uint8Array([1]))},()=>{},controller.signal,async()=>{fetched=true}),{name:'AbortError'});
  await assert.rejects(createDepthScene(null,new Blob(),()=>{},controller.signal),{name:'AbortError'});
  assert.equal(fetched,false);
});

test('closing processing terminates the inference worker without generating fake results', async () => {
  const saved={Image:globalThis.Image,document:globalThis.document,Worker:globalThis.Worker};
  let worker,terminated=false;
  globalThis.Image=class {naturalWidth=1600;naturalHeight=1200;async decode(){}};
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:(x,y,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)})})})};
  globalThis.Worker=class {constructor(){worker=this}postMessage(){}terminate(){terminated=true}};
  try {
    const controller=new AbortController(),processing=createDepthScene(null,new Blob(['jpeg']),()=>{},controller.signal);
    await Promise.resolve();await Promise.resolve();
    assert.ok(worker);controller.abort();
    await assert.rejects(processing,{name:'AbortError'});
    assert.equal(terminated,true);
  } finally {for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});

test('manifest pins the original local model and matching WASM runtime', async () => {
  const manifest=JSON.parse(await readFile(new URL('../pointcloud/models/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.asset.bytes,27258801);
  assert.equal(manifest.runtime.bytes,14239897);
  assert.equal(manifest.asset.local,'/pointcloud/models/model_quantized.onnx');
  assert.equal(manifest.runtime.local,'/pointcloud/vendor/ort-wasm-simd-threaded.wasm');
  assert.match(manifest.asset.sha256,/^[a-f0-9]{64}$/);
  assert.match(manifest.runtime.sha256,/^[a-f0-9]{64}$/);
});
