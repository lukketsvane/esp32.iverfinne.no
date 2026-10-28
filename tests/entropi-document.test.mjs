import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {crc32,inflateRawSync} from 'node:zlib';
import {createEntropiDocument,encodeEntropiDocument,decodeEntropiDocument} from '../vendor/entropi-document.mjs';

const left=new Blob([Uint8Array.of(255,216,1,3,255,217)],{type:'image/jpeg'}),right=new Blob([Uint8Array.of(255,216,2,4,255,217)],{type:'image/jpeg'});
const example=()=>createEntropiDocument({left,right,result:{width:3,height:2,depth:Float32Array.of(.12345678,-0,NaN,Infinity,-Infinity,21.875),model:'Depth Anything',source:'browser'},recipe:{preset:4,position:.2,width:1.25},preview:new Blob(['preview'],{type:'image/png'})});
function members(buffer){
  const bytes=Buffer.from(buffer),entries=[];let cursor=bytes.readUInt32LE(bytes.length-6);
  for(let i=0,count=bytes.readUInt16LE(bytes.length-12);i<count;i++){
    const method=bytes.readUInt16LE(cursor+10),length=bytes.readUInt32LE(cursor+20),nameLength=bytes.readUInt16LE(cursor+28),offset=bytes.readUInt32LE(cursor+42),name=bytes.toString('utf8',cursor+46,cursor+46+nameLength),start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28),compressed=bytes.subarray(start,start+length);
    entries.push({name,data:method===8?inflateRawSync(compressed):compressed,method,central:cursor,local:offset,start});cursor+=46+nameLength+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32);
  }
  return entries;
}
function rebuild(entries){
  const chunks=[],directory=[];let offset=0;
  for(const {name,data}of entries){
    const filename=Buffer.from(name),head=Buffer.alloc(30+filename.length),record=Buffer.alloc(46+filename.length),crc=crc32(data);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(filename.length,26);filename.copy(head,30);
    record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);filename.copy(record,46);
    chunks.push(head,data);directory.push(record);offset+=head.length+data.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.reduce((sum,item)=>sum+item.length,0),12);end.writeUInt32LE(offset,16);
  return new Blob([...chunks,...directory,end]);
}
function updateManifest(entries,change){const entry=entries.find(item=>item.name==='manifest.json'),manifest=JSON.parse(entry.data.toString());change(manifest);entry.data=Buffer.from(JSON.stringify(manifest));return rebuild(entries)}
const rawBytes=values=>new Uint8Array(values.buffer,values.byteOffset,values.byteLength);

test('numerical master roundtrips raw float bits, originals, validity, recipe and identity',async()=>{
  const document=example();new Uint32Array(document.result.depth.buffer)[2]=0x7fc12345;
  document.result.validity[0]=0;
  const output=await encodeEntropiDocument(document),reopened=await decodeEntropiDocument(output);
  assert.equal(output.type,'application/x-entropi');assert.equal(reopened.id,document.id);assert.equal(reopened.created,document.created);
  assert.deepEqual(rawBytes(reopened.result.depth),rawBytes(document.result.depth));assert.deepEqual(reopened.result.validity,document.result.validity);
  assert.deepEqual(await reopened.left.arrayBuffer(),await left.arrayBuffer());assert.deepEqual(await reopened.right.arrayBuffer(),await right.arrayBuffer());
  assert.deepEqual(reopened.recipe,document.recipe);assert.equal(reopened.result.quantity,'relative-depth');assert.equal(reopened.result.units,'relative');
  assert.equal(reopened.geometry.calibration,null);assert.deepEqual(reopened.capture,{left:null,right:null,synchronized:false});
  reopened.recipe.preset=2;const edited=await decodeEntropiDocument(await encodeEntropiDocument(reopened));
  assert.equal(edited.id,document.id);assert.equal(edited.recipe.preset,2);assert.deepEqual(rawBytes(edited.result.depth),rawBytes(document.result.depth));
});

test('ordinary ZIP reader and independent SHA-256 recover stored samples',async()=>{
  const document=example(),output=await encodeEntropiDocument(document),entries=members(await output.arrayBuffer()),manifest=JSON.parse(entries.find(item=>item.name==='manifest.json').data);
  assert.equal(manifest.version,1);assert.equal(manifest.profile,'numerical-float32');
  for(const entry of entries.filter(item=>item.name!=='manifest.json')){
    assert.equal(createHash('sha256').update(entry.data).digest('hex'),manifest.files[entry.name].sha256);assert.equal(entry.data.length,manifest.files[entry.name].bytes);
  }
  const depth=entries.find(item=>item.name==='data/depth.f32').data;
  assert.equal(depth.readFloatLE(0),document.result.depth[0]);assert.ok(Object.is(depth.readFloatLE(4),-0));assert.ok(Number.isNaN(depth.readFloatLE(8)));
});

test('HTTP and browsers without compression APIs retain full integrity and compatibility',async()=>{
  const crypto=Object.getOwnPropertyDescriptor(globalThis,'crypto'),compression=Object.getOwnPropertyDescriptor(globalThis,'CompressionStream');
  try{
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});Object.defineProperty(globalThis,'CompressionStream',{configurable:true,value:undefined});
    for(const length of [6,55,56,63,64,65,127,128,129]){
      const document=example();document.left=new Blob([Uint8Array.from({length},(_,i)=>i)],{type:'image/jpeg'});
      const output=await encodeEntropiDocument(document),entries=members(await output.arrayBuffer()),manifest=JSON.parse(entries.find(item=>item.name==='manifest.json').data);
      assert.ok(entries.every(entry=>entry.method===0));
      for(const entry of entries.filter(item=>item.name!=='manifest.json'))assert.equal(createHash('sha256').update(entry.data).digest('hex'),manifest.files[entry.name].sha256);
      assert.equal((await decodeEntropiDocument(output)).left.size,length);
    }
  }finally{Object.defineProperty(globalThis,'crypto',crypto);Object.defineProperty(globalThis,'CompressionStream',compression)}
});

test('confidence is independent of validity and samples are copied before editing',async()=>{
  const input=example(),confidence=Float32Array.of(.1,.2,.3,.4,.5,1);input.result.confidence=confidence;input.result.confidenceDefinition='Source match score';
  const document=createEntropiDocument(input);input.result.depth[0]=999;confidence[0]=1;
  const reopened=await decodeEntropiDocument(await encodeEntropiDocument(document));
  assert.notEqual(reopened.result.depth[0],999);assert.equal(reopened.result.confidence[0],Math.fround(.1));assert.equal(reopened.result.validity[2],0);assert.equal(reopened.result.confidence[2],Math.fround(.3));
  assert.equal(reopened.result.confidenceDefinition,'Source match score');
});

test('measured stereo provenance and disparity units survive editing and numerical export',async()=>{
  const input=example();input.result.source='stereo';input.result.quantity='disparity';input.result.units='px';
  input.result.provenance={rigId:'fixed-rig',matchedFraction:.5,metric:false,hardwareSynchronized:false};
  const saved=createEntropiDocument(input);input.result.provenance.rigId='changed';
  const reopened=await decodeEntropiDocument(await encodeEntropiDocument(saved));
  assert.deepEqual(reopened.result.provenance,{rigId:'fixed-rig',matchedFraction:.5,metric:false,hardwareSynchronized:false});
  assert.equal(reopened.result.source,'stereo');assert.equal(reopened.result.quantity,'disparity');assert.equal(reopened.result.units,'px');
  reopened.recipe.position=-.4;const edited=await decodeEntropiDocument(await encodeEntropiDocument(reopened));
  assert.deepEqual(edited.result.provenance,reopened.result.provenance);assert.deepEqual(rawBytes(edited.result.depth),rawBytes(saved.result.depth));
  assert.deepEqual(edited.result.validity,saved.result.validity);assert.deepEqual(await edited.left.arrayBuffer(),await left.arrayBuffer());assert.deepEqual(await edited.right.arrayBuffer(),await right.arrayBuffer());
});

test('rejected stereo remains estimated with its reason in the exported provenance',async()=>{
  const input=example();input.result.provenance={stereo:{accepted:false,reason:'No reliable stereo'},modelRevision:'pinned'};
  const saved=createEntropiDocument(input);input.result.provenance.stereo.accepted=true;
  const reopened=await decodeEntropiDocument(await encodeEntropiDocument(saved));
  assert.equal(reopened.result.source,'browser');assert.equal(reopened.result.quantity,'relative-depth');assert.equal(reopened.result.units,'relative');
  assert.deepEqual(reopened.result.provenance,{stereo:{accepted:false,reason:'No reliable stereo'},modelRevision:'pinned'});
});

test('provenance is optional for older masters and bounded like other document metadata',()=>{
  const input=example();delete input.result.provenance;assert.equal(createEntropiDocument(input).result.provenance,null);
  const circular={};circular.self=circular;input.result.provenance=circular;assert.throws(()=>createEntropiDocument(input),/metadata/);
  input.result.provenance={reason:'x'.repeat(65537)};assert.throws(()=>createEntropiDocument(input),/metadata/);
});

test('unknown calibration and metric units cannot be silently substituted',()=>{
  const input=example();input.result.quantity='depth';input.result.units='m';assert.throws(()=>createEntropiDocument(input),/kalibrering/);
  input.geometry.calibration={baselineMetres:.06,focalLengthPixels:1200};assert.equal(createEntropiDocument(input).result.units,'m');
  delete input.result.polarity;assert.equal(createEntropiDocument(input).result.polarity,'far');
  input.result.polarity='near';assert.equal(createEntropiDocument(input).result.polarity,'near');
  input.result.quantity='relative-depth';assert.throws(()=>createEntropiDocument(input),/eining/);
});

test('rejects damaged bytes even when ZIP CRC has been rewritten',async()=>{
  const entries=members(await (await encodeEntropiDocument(example())).arrayBuffer());entries.find(item=>item.name==='sources/left').data[2]^=1;
  await assert.rejects(decodeEntropiDocument(rebuild(entries)),/skadd/);
});

test('rejects unsupported versions, missing metadata and invalid rendering recipes',async()=>{
  for(const change of [manifest=>manifest.version=99,manifest=>delete manifest.id,manifest=>delete manifest.recipe,manifest=>manifest.recipe.preset=8,manifest=>manifest.recipe.position=2,manifest=>manifest.result.width=10000]){
    const entries=members(await (await encodeEntropiDocument(example())).arrayBuffer());await assert.rejects(decodeEntropiDocument(updateManifest(entries,change)));
  }
});

test('rejects unsafe paths, duplicates, alias entries and truncated archives',async()=>{
  const output=await encodeEntropiDocument(example()),buffer=await output.arrayBuffer();
  await assert.rejects(decodeEntropiDocument(new Blob([buffer.slice(0,-1)])));
  const entries=members(buffer);entries.push(entries[0]);await assert.rejects(decodeEntropiDocument(rebuild(entries)));
  entries.pop();entries[0].name='../source';await assert.rejects(decodeEntropiDocument(rebuild(entries)));
  const clean=members(buffer);await assert.rejects(decodeEntropiDocument(updateManifest(clean,manifest=>manifest.result.depth='sources/left')));
});

test('rejects expanded archives over the bound before allocating output',async()=>{
  const output=await encodeEntropiDocument(example()),bytes=Buffer.from(await output.arrayBuffer()),entry=members(bytes)[0];
  bytes.writeUInt32LE(129*1024*1024,entry.central+24);bytes.writeUInt32LE(129*1024*1024,entry.local+22);
  await assert.rejects(decodeEntropiDocument(new Blob([bytes])));
});

test('validation rejects invalid mask, confidence, dimensions and non-float samples',()=>{
  for(const change of [item=>item.result.width=1.5,item=>item.result.depth=[1,2,3,4,5,6],item=>item.result.validity=Uint8Array.of(1,1,1,1,1,1),item=>item.result.validity=Float32Array.of(.5,0,0,0,0,0),item=>item.result.confidence=Float32Array.of(2,0,0,0,0,0),item=>item.recipe.width=0,item=>item.left=new Blob(['bad'],{type:'text/html'})]){
    const document=example();change(document);assert.throws(()=>createEntropiDocument(document));
  }
});
