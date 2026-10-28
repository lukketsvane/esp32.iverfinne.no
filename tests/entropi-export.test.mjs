import test from 'node:test';
import assert from 'node:assert/strict';
import {quantizeDepth,encodeDepthTiff,encodeDepthDng} from '../vendor/entropi-export.mjs';
import {createEntropiDocument,encodeEntropiDocument,decodeEntropiDocument} from '../vendor/entropi-document.mjs';

const result=values=>({depth:Float32Array.from(values),width:values.length,height:1,polarity:'near',model:'Depth Anything',source:'browser'});
async function inspect(blob){
  const buffer=await blob.arrayBuffer(),view=new DataView(buffer),bytes=new Uint8Array(buffer),tags=new Map();
  assert.equal(view.getUint16(0,true),0x4949);assert.equal(view.getUint16(2,true),42);
  const start=view.getUint32(4,true),count=view.getUint16(start,true);
  for(let i=0;i<count;i++){
    const at=start+2+i*12,tag=view.getUint16(at,true),type=view.getUint16(at+2,true),length=view.getUint32(at+4,true),size={1:1,2:1,3:2,4:4,5:8,10:8}[type],offset=length*size>4?view.getUint32(at+8,true):at+8;
    assert.ok(offset+length*size<=buffer.byteLength);
    tags.set(tag,{type,length,value:type===2?new TextDecoder().decode(bytes.subarray(offset,offset+length-1)):Array.from({length},(_,n)=>type===1?view.getUint8(offset+n):type===3?view.getUint16(offset+n*2,true):view.getUint32(offset+n*size,true))});
  }
  const offset=tags.get(273).value[0],size=tags.get(279).value[0];
  return {tags,pixels:Array.from({length:size/2},(_,i)=>view.getUint16(offset+i*2,true)),metadata:JSON.parse(tags.get(270).value)};
}

test('16-bit exports retain fractional predictions beyond 8-bit display precision',async()=>{
  const input=result([0,.1,.1001,.5,1]),copy=input.depth.slice();
  const quantized=quantizeDepth(input);
  assert.notEqual(quantized.pixels[1],quantized.pixels[2]);
  for(let i=0;i<input.depth.length;i++)assert.ok(Math.abs(quantized.pixels[i]/65535-input.depth[i])<=quantized.mapping.maxQuantizationError);
  for(const encode of [encodeDepthTiff,encodeDepthDng]){
    const decoded=await inspect(encode(input));assert.deepEqual(decoded.pixels,[...quantized.pixels]);
    assert.equal(decoded.tags.get(258).value[0],16);assert.equal(decoded.metadata.quantity,'relative-depth');assert.equal(decoded.metadata.units,'relative');assert.equal(decoded.metadata.sensorRaw,false);
  }
  assert.deepEqual(input.depth,copy);
});

test('range, polarity, invalid values and mask are recorded without inventing distances',async()=>{
  const input=result([10,11,NaN,Infinity,12,50]);input.validity=Uint8Array.of(1,1,0,0,1,0);
  const {pixels,mapping}=quantizeDepth(input,{invert:true});
  assert.deepEqual([...pixels],[65535,32768,0,0,0,0]);assert.equal(mapping.invalidCount,3);assert.equal(mapping.min,10);assert.equal(mapping.max,12);assert.equal(mapping.validityPreserved,false);
  const decoded=await inspect(encodeDepthTiff(input));assert.equal(decoded.metadata.invalidDisplayValue,0);assert.equal(decoded.metadata.units,'relative');assert.equal(decoded.metadata.polarity,'near');
  const clipped=quantizeDepth(input,{min:10.5,max:11.5});assert.equal(clipped.mapping.clippedCount,2);assert.equal(clipped.mapping.maxQuantizationError,1/131070);
});

test('constant data and explicit metric/disparity provenance stay well-defined',()=>{
  const constant=quantizeDepth(result([4,4,NaN]));assert.deepEqual([...constant.pixels],[32768,32768,0]);assert.equal(constant.mapping.maxQuantizationError,0);
  const metric={...result([.5,8]),quantity:'depth',units:'m'};
  assert.equal(quantizeDepth(metric).mapping.units,'m');assert.equal(quantizeDepth(metric).mapping.maxQuantizationError,7.5/131070);
  delete metric.polarity;assert.equal(quantizeDepth(metric).mapping.polarity,'far');
  assert.equal(quantizeDepth({...metric,polarity:'near'}).mapping.polarity,'near');
  assert.equal(quantizeDepth({...metric,quantity:'disparity',units:'px'}).mapping.quantity,'disparity');
});

test('experimental DNG is a complete monochrome LinearRaw image with no asserted device-depth map',async()=>{
  const dng=encodeDepthDng(result([0,1])),decoded=await inspect(dng);
  assert.equal(dng.type,'image/dng');assert.deepEqual(decoded.tags.get(50706).value,[1,4,0,0]);assert.deepEqual(decoded.tags.get(50707).value,[1,1,0,0]);
  assert.equal(decoded.tags.get(262).value[0],34892);assert.equal(decoded.tags.get(274).value[0],1);assert.equal(decoded.tags.get(50708).value,'Entropi Numerical Values');
  assert.equal(decoded.tags.get(50717).value[0],65535);assert.deepEqual(decoded.tags.get(50720).value,[2,1]);assert.equal(decoded.tags.has(51177),false);assert.equal(decoded.metadata.experimentalDng,true);
  const tiff=await inspect(encodeDepthTiff(result([0,1])));assert.equal(tiff.tags.get(262).value[0],1);assert.equal(tiff.tags.has(50706),false);
});

test('invalid dimensions, ranges and units are rejected before export',()=>{
  for(const input of [result([NaN,Infinity]),{...result([0,1]),width:3},{...result([0,1]),depth:[0,1]},{...result([0,1]),validity:new Uint8Array(1)},{...result([0,1]),validity:0},{...result([0,1]),validity:Uint8Array.of(1,2)},{...result([0,NaN]),validity:Uint8Array.of(1,1)},{...result([0,1]),quantity:'relative-depth',units:'m'},{...result([0,1]),polarity:'unknown'}])assert.throws(()=>encodeDepthTiff(input));
  for(const options of [{min:2,max:1},{min:NaN},{max:Infinity},{invert:1}])assert.throws(()=>encodeDepthDng(result([0,1]),options));
});

test('reopened numerical documents export metric and disparity units without falling back to relative',async()=>{
  const left=new Blob([Uint8Array.of(255,216,255,217)],{type:'image/jpeg'});
  for(const [quantity,units]of [['depth','m'],['disparity','px']]){
    const document=createEntropiDocument({left,result:{...result([.5,2.125,NaN,8]),quantity,units},geometry:{calibration:quantity==='depth'?{baselineMetres:.06,focalLengthPixels:1200}:null}});
    const reopened=await decodeEntropiDocument(await encodeEntropiDocument(document));
    for(const encode of [encodeDepthTiff,encodeDepthDng]){
      const decoded=await inspect(encode(reopened.result));
      assert.equal(decoded.metadata.quantity,quantity);assert.equal(decoded.metadata.units,units);assert.equal(decoded.metadata.invalidCount,1);
      assert.deepEqual(decoded.pixels,[...quantizeDepth(document.result).pixels]);
    }
  }
});

test('legacy unit input is accepted only when it agrees with canonical units',()=>{
  const input={...result([0,1]),quantity:'depth',unit:'m'};
  assert.equal(quantizeDepth(input).mapping.units,'m');assert.equal(quantizeDepth({...input,units:'m'}).mapping.units,'m');
  assert.throws(()=>quantizeDepth({...input,units:'px'}),/Motstridande/);
});
