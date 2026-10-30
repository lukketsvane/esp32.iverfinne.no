import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRenderedTiff} from '../vendor/entropi-rendered-export.mjs';
import {encodeGrayscale16Tiff,encodeRgba16Tiff} from '../vendor/entropi-export.mjs';
import {createEntropiDocument,encodeEntropiDocument,decodeEntropiDocument} from '../vendor/entropi-document.mjs';
import {normalizeDepth,toneDepth} from '../vendor/vathography.mjs';
import {PHOTO_PRESETS,applyPhotoEdits} from '../vendor/photo-adjustments.mjs';

const left=new Blob([Uint8Array.of(255,216,255,217)],{type:'image/jpeg'});
function document(values,recipe={preset:1,position:0,width:1},options={}){
  return createEntropiDocument({left,recipe,result:{depth:Float32Array.from(values),width:values.length,height:1,normalized:true,polarity:'near',...options}});
}
const size=(width,height)=>({readSourceSize:async()=>({width,height})});

async function inspect(blob){
  assert.equal(blob.type,'image/tiff');
  const buffer=await blob.arrayBuffer(),view=new DataView(buffer),bytes=new Uint8Array(buffer),tags=new Map();
  assert.equal(view.getUint16(0,true),0x4949);assert.equal(view.getUint16(2,true),42);
  const start=view.getUint32(4,true),count=view.getUint16(start,true);
  for(let i=0;i<count;i++){
    const at=start+2+i*12,tag=view.getUint16(at,true),type=view.getUint16(at+2,true),length=view.getUint32(at+4,true),unit={1:1,2:1,3:2,4:4,5:8}[type],offset=length*unit>4?view.getUint32(at+8,true):at+8;
    assert.ok(offset+length*unit<=buffer.byteLength);
    tags.set(tag,type===2?new TextDecoder().decode(bytes.subarray(offset,offset+length-1)):Array.from({length},(_,n)=>type===3?view.getUint16(offset+n*2,true):view.getUint32(offset+n*unit,true)));
  }
  assert.equal(view.getUint32(start+2+count*12,true),0);
  const offset=tags.get(273)[0],length=tags.get(279)[0];
  assert.equal(offset+length,buffer.byteLength);
  return {tags,pixels:Array.from({length:length/2},(_,i)=>view.getUint16(offset+i*2,true)),metadata:JSON.parse(tags.get(270))};
}

test('rendered TIFF matches every current recipe at original dimensions with both raw polarities',async()=>{
  for(const polarity of ['near','far'])for(let preset=0;preset<5;preset++){
    const recipe={preset,position:.13,width:1.25};
    const input=document([2,4,6,8,10,12],recipe,{width:3,height:2,normalized:false,polarity}),copy=input.result.depth.slice();
    const decoded=await inspect(await encodeRenderedTiff(input,{readSourceSize:async source=>{assert.equal(source,left);return {width:7,height:5}}}));
    const normalized=normalizeDepth(input.result.depth,{polarity,validity:input.result.validity});
    const preview=toneDepth(normalized,3,2,{...recipe,outputWidth:7,outputHeight:5,validity:input.result.validity});
    assert.deepEqual(decoded.tags.get(256),[7]);assert.deepEqual(decoded.tags.get(257),[5]);
    assert.deepEqual(decoded.tags.get(258),[16,16]);assert.deepEqual(decoded.tags.get(277),[2]);
    assert.deepEqual(decoded.tags.get(262),[1]);assert.deepEqual(decoded.tags.get(338),[2]);assert.deepEqual(decoded.tags.get(339),[1,1]);
    for(let i=0;i<35;i++){
      assert.ok(Math.abs(decoded.pixels[i*2]/257-preview[i*4])<=.502,polarity+', preset '+preset+', pixel '+i);
      assert.equal(decoded.pixels[i*2+1],65535);
    }
    assert.deepEqual(decoded.metadata.recipe,recipe);assert.equal(decoded.metadata.sourceWidth,7);assert.equal(decoded.metadata.sourceHeight,5);
    assert.equal(decoded.metadata.mapWidth,3);assert.equal(decoded.metadata.mapHeight,2);
    assert.equal(decoded.metadata.sensorRaw,false);assert.equal(decoded.metadata.encoding,'uint16-display-tones');
    assert.deepEqual(input.result.depth,copy);
  }
});

test('16-bit rendering retains sub-display precision instead of expanding 8-bit pixels',async()=>{
  const input=document([.6,.6001]),preview=toneDepth(input.result.depth,2,1,input.recipe);
  assert.equal(preview[0],preview[4]);
  const rendered=toneDepth(input.result.depth,2,1,{...input.recipe,bitDepth:16});
  assert.ok(rendered instanceof Uint16Array);
  assert.notEqual(rendered[0],rendered[4]);assert.ok(rendered[0]%257!==0||rendered[4]%257!==0);
  const {pixels}=await inspect(await encodeRenderedTiff(input,size(2,1)));
  assert.deepEqual(pixels,[rendered[0],65535,rendered[4],65535]);
  assert.ok(toneDepth(input.result.depth,2,1) instanceof Uint8ClampedArray);
  for(const bitDepth of [0,10,32,'16',null])assert.throws(()=>toneDepth(input.result.depth,2,1,{bitDepth}),/bitdjupn/);
});

test('upscaled TIFF interpolates floating depth before the nonlinear tone curve',async()=>{
  const input=document([.53,.79],{preset:0,position:0,width:1});
  const {pixels}=await inspect(await encodeRenderedTiff(input,size(3,1)));
  assert.ok(pixels[2]>62000);assert.ok(pixels[0]<13000);assert.ok(pixels[4]<13000);
  const reference=toneDepth([input.result.depth[0],(input.result.depth[0]+input.result.depth[1])/2,input.result.depth[1]],3,1,{bitDepth:16});
  assert.deepEqual(pixels,[reference[0],65535,reference[4],65535,reference[8],65535]);
});

test('invalid samples remain transparent and distinguishable from valid black, including after upscaling',async()=>{
  const input=document([0,NaN,1],{preset:0,position:0,width:1}),copy=input.result.depth.slice(),mask=input.result.validity.slice();
  const native=await inspect(await encodeRenderedTiff(input,size(3,1)));
  assert.deepEqual(native.pixels.slice(0,4),[0,65535,0,0]);
  assert.equal(native.metadata.validityPreserved,true);assert.equal(native.metadata.sourceValidSamples,2);
  const scaled=await inspect(await encodeRenderedTiff(input,size(5,1)));
  assert.deepEqual(scaled.pixels.filter((_,i)=>i%2===1),[65535,0,0,0,65535]);
  assert.deepEqual(input.result.depth,copy);assert.deepEqual(input.result.validity,mask);
});

test('reopened documents use original image dimensions and preserve the current recipe',async()=>{
  const input=document([.2,.5,.8],{preset:4,position:-.2,width:.8},{sourceWidth:99,sourceHeight:77});
  const reopened=await decodeEntropiDocument(await encodeEntropiDocument(input));
  assert.equal(reopened.result.sourceWidth,undefined);
  const decoded=await inspect(await encodeRenderedTiff(reopened,{readSourceSize:async source=>{
    assert.equal(source.type,left.type);assert.equal(source.size,left.size);return {width:9,height:3};
  }}));
  assert.deepEqual(decoded.tags.get(256),[9]);assert.deepEqual(decoded.tags.get(257),[3]);
  assert.deepEqual(decoded.metadata.recipe,input.recipe);
});

test('all ten photo presets export matching 16-bit tones, crop and transparency after reopening',async()=>{
  const outputs=new Set();
  for(const {id}of PHOTO_PRESETS){
    const input=document([.1,.3,NaN,.55,.7,.9],{preset:1,position:.05,width:1.1,edits:{preset:id,strength:.8,exposure:.15,contrast:.1,sharpen:.2,denoise:.3,crop:{x:.125,y:.125,width:.75,height:.75}}},{width:3,height:2});
    const depth=input.result.depth.slice(),validity=input.result.validity.slice(),recipe=structuredClone(input.recipe);
    const reopened=await decodeEntropiDocument(await encodeEntropiDocument(input)),decoded=await inspect(await encodeRenderedTiff(reopened,size(16,8)));
    const rgba=toneDepth(input.result.depth,3,2,{...recipe,outputWidth:16,outputHeight:8,bitDepth:16,validity});
    const expected=applyPhotoEdits(rgba,16,8,recipe.edits,{bitDepth:16}),gray=['B1','B5','X1'].includes(id),channels=gray?2:4;
    const pixels=gray?Array.from(expected.data).filter((_,i)=>i%4===0||i%4===3):Array.from(expected.data);
    assert.deepEqual(decoded.pixels,pixels,id);outputs.add(JSON.stringify(decoded.pixels));
    assert.deepEqual(decoded.tags.get(256),[12]);assert.deepEqual(decoded.tags.get(257),[6]);
    assert.deepEqual(decoded.tags.get(258),Array(channels).fill(16));assert.deepEqual(decoded.tags.get(277),[channels]);
    assert.deepEqual(decoded.tags.get(262),[gray?1:2]);assert.deepEqual(decoded.tags.get(338),[2]);assert.deepEqual(decoded.tags.get(339),Array(channels).fill(1));
    const alpha=decoded.pixels.filter((_,i)=>i%channels===channels-1);
    assert.ok(alpha.includes(0));assert.ok(alpha.includes(65535));assert.ok(decoded.pixels.some(value=>value%257!==0));
    assert.equal(decoded.metadata.version,2);assert.equal(decoded.metadata.channels,gray?'gray-alpha':'rgba');assert.deepEqual(decoded.metadata.recipe,recipe);
    assert.equal(decoded.metadata.sourceWidth,16);assert.equal(decoded.metadata.sourceHeight,8);assert.equal(decoded.metadata.outputWidth,12);assert.equal(decoded.metadata.outputHeight,6);
    assert.equal(decoded.metadata.mapWidth,3);assert.equal(decoded.metadata.mapHeight,2);
    assert.deepEqual(input.result.depth,depth);assert.deepEqual(input.result.validity,validity);assert.deepEqual(input.recipe,recipe);
  }
  assert.equal(outputs.size,10);
});

test('RGBA TIFF preserves all four 16-bit channels exactly and rejects incompatible input',async()=>{
  const source=Uint16Array.of(1,2,65534,65535,301,4097,32768,0),copy=source.slice();
  const {pixels,tags}=await inspect(encodeRgba16Tiff(source,2,1));
  assert.deepEqual(pixels,Array.from(source));assert.deepEqual(tags.get(279),[16]);assert.deepEqual(tags.get(258),[16,16,16,16]);
  assert.deepEqual(source,copy);
  for(const values of [new Uint8Array(8),new Uint16Array(7),null])assert.throws(()=>encodeRgba16Tiff(values,2,1));
  assert.throws(()=>encodeRgba16Tiff(source,1.5,1));
});

test('bad source dimensions, recipes and masks reject instead of exporting a misleading image',async()=>{
  const input=document([0,1]);
  for(const [width,height]of [[0,2],[1.5,1],[4097,4096],[Infinity,1],['2',1]])await assert.rejects(()=>encodeRenderedTiff(input,size(width,height)),/biletstorleik/);
  for(const recipe of [{preset:5,position:0,width:1},{preset:1,position:2,width:1},{preset:1,position:0,width:.2}])await assert.rejects(()=>encodeRenderedTiff({...input,recipe},size(2,1)),/framkalling/);
  for(const validity of [new Uint8Array(1),Uint8Array.of(1,2),[1,1]])await assert.rejects(()=>encodeRenderedTiff({...input,result:{...input.result,validity}},size(2,1)),/gyldigheitsmaske/);
  await assert.rejects(()=>encodeRenderedTiff({...input,result:{...input.result,validity:new Uint8Array(2)}},size(2,1)),/gyldige/);
  await assert.rejects(()=>encodeRenderedTiff({...input,left:new Blob()},size(2,1)),/originalbilete/);
  assert.throws(()=>encodeGrayscale16Tiff(Uint16Array.of(1,2,3,65535),1,1),/graatonar/);
  assert.throws(()=>encodeGrayscale16Tiff(new Uint8Array(4),1,1),/16-bits/);
});

test('browser source decoder uses natural image size and revokes object URLs on success and failure',async t=>{
  const previous=globalThis.Image,revoked=[];
  t.mock.method(URL,'createObjectURL',()=> 'blob:test-source');
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  try{
    globalThis.Image=class{naturalWidth=4;naturalHeight=2;async decode(){assert.equal(this.src,'blob:test-source')}};
    const decoded=await inspect(await encodeRenderedTiff(document([0,1])));
    assert.deepEqual(decoded.tags.get(256),[4]);assert.deepEqual(decoded.tags.get(257),[2]);
    assert.deepEqual(revoked,['blob:test-source']);
    globalThis.Image=class{async decode(){throw new Error('decode failed')}};
    await assert.rejects(()=>encodeRenderedTiff(document([0,1])),/decode failed/);
    assert.deepEqual(revoked,['blob:test-source','blob:test-source']);
    // Browsers without Image.decode still wait for onload before reading dimensions.
    globalThis.Image=class{naturalWidth=3;naturalHeight=2;set src(value){assert.equal(value,'blob:test-source');queueMicrotask(()=>this.onload())}};
    const fallback=await inspect(await encodeRenderedTiff(document([0,1])));
    assert.deepEqual(fallback.tags.get(256),[3]);assert.deepEqual(fallback.tags.get(257),[2]);
    assert.equal(revoked.length,3);
  }finally{if(previous===undefined)delete globalThis.Image;else globalThis.Image=previous}
});
