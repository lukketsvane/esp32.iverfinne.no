import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {crc32,inflateRawSync} from 'node:zlib';
import {createEntropiDocument,encodeEntropiDocument,decodeEntropiDocument,normalizePanorama} from '../vendor/entropi-document.mjs';

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
const panorama=()=>({frames:[{id:'first',left,right,accepted:true,capturedAt:1793340000000,timing:{left:12,right:14,synchronized:false}},{id:'second',left:new Blob(['unaltered png bytes'],{type:'image/png'}),right:null,accepted:true,capturedAt:'2026-10-30T08:00:01Z'},{id:'rejected',left:new Blob(['rejected original'],{type:'image/jpeg'}),right,accepted:false,reason:'Insufficient overlap'}],transforms:[[1,0,0,0,1,0,0,0,1],[1,0,24,0,1,2,0,0,1],null],analysis:{width:640,height:480},output:{width:1040,height:480,scale:1,origin:[0,-2]},metadata:{coverage:.85}});

test('version 3 preserves every panorama original and homography independently of the derived image',async()=>{
  const input=example();input.right=null;input.panorama=panorama();input.result.source='stereo-panorama';input.result.provenance={panorama:{accepted:2,total:3,metric:false}};
  input.recipe.edits={preset:'P5',exposure:.2};new Uint32Array(input.result.depth.buffer)[2]=0x7fc45678;
  const document=createEntropiDocument(input),bits=rawBytes(document.result.depth).slice();
  input.panorama.transforms[1][2]=999;input.panorama.frames[0].timing.left=99;input.panorama.metadata.coverage=0;
  const file=await encodeEntropiDocument(document),entries=members(await file.arrayBuffer()),manifest=JSON.parse(entries.find(item=>item.name==='manifest.json').data);
  assert.equal(manifest.version,3);assert.equal(manifest.originals.right,null);assert.equal(manifest.panorama.frames[1].left,'panorama/1/left');
  const reopened=await decodeEntropiDocument(file);
  assert.equal(reopened.id,document.id);assert.equal(reopened.created,document.created);assert.equal(reopened.right,null);
  assert.deepEqual(reopened.recipe,document.recipe);assert.deepEqual(reopened.result.provenance,document.result.provenance);assert.deepEqual(rawBytes(reopened.result.depth),bits);
  assert.deepEqual(reopened.result.validity,document.result.validity);assert.deepEqual(await reopened.left.arrayBuffer(),await left.arrayBuffer());
  assert.deepEqual(reopened.panorama.transforms,document.panorama.transforms);assert.equal(reopened.panorama.transforms[1][2],24);
  assert.equal(reopened.panorama.frames[0].timing.left,12);assert.equal(reopened.panorama.metadata.coverage,.85);assert.equal(reopened.panorama.frames[2].accepted,false);
  for(const [index,frame]of document.panorama.frames.entries())for(const side of ['left','right']){
    const loaded=reopened.panorama.frames[index][side];
    if(!frame[side]){assert.equal(loaded,null);continue}
    const bytes=Buffer.from(await frame[side].arrayBuffer()),path='panorama/'+index+'/'+side;
    assert.deepEqual(Buffer.from(await loaded.arrayBuffer()),bytes);assert.equal(loaded.type,frame[side].type);
    assert.deepEqual(entries.find(entry=>entry.name===path).data,bytes);assert.equal(manifest.files[path].sha256,createHash('sha256').update(bytes).digest('hex'));
  }
  reopened.recipe.edits.crop={x:.1,y:.1,width:.8,height:.8};
  const edited=await decodeEntropiDocument(await encodeEntropiDocument(reopened));
  assert.deepEqual(edited.panorama.transforms,document.panorama.transforms);assert.deepEqual(rawBytes(edited.result.depth),bits);
  assert.deepEqual(await edited.panorama.frames[2].left.arrayBuffer(),await document.panorama.frames[2].left.arrayBuffer());
});

test('eight paired panorama frames fit the bounded 22-member archive and do not require photo edits',async()=>{
  const input=example();input.right=null;input.result.confidence=Float32Array.of(.1,.2,.3,.4,.5,.6);
  input.panorama={frames:Array.from({length:8},(_,id)=>({id,left,right})),transforms:Array.from({length:8},(_,i)=>[1,0,i*10,0,1,0,0,0,1])};
  const file=await encodeEntropiDocument(input),entries=members(await file.arrayBuffer()),manifest=JSON.parse(entries.find(item=>item.name==='manifest.json').data);
  assert.equal(entries.length,22);assert.equal(manifest.version,3);assert.equal(manifest.recipe.edits,undefined);
  const reopened=await decodeEntropiDocument(file);assert.equal(reopened.panorama.frames.length,8);assert.deepEqual(reopened.result.confidence,input.result.confidence);
});

test('panorama validation rejects malformed metadata, transforms and images before archiving',()=>{
  const changes=[value=>value.frames=[],value=>value.frames=Array(1),value=>value.frames=Array(9).fill(value.frames[0]),value=>value.transforms=[],value=>value.transforms[0]=[1,0,0],value=>value.transforms[0][0]=Infinity,value=>value.frames[0].left=new Blob(),value=>value.frames[0].right=new Blob(['x'],{type:'text/plain'}),value=>value.frames[0].accepted='yes',value=>value.frames[0].timing=[],value=>value.metadata.bad=NaN,value=>value.metadata.bad=()=>1,value=>value.metadata.bad=new Uint8Array(1),value=>value.metadata.circular=value,value=>value.metadata.large='x'.repeat(65537)];
  for(const change of changes){const value=panorama();change(value);assert.throws(()=>normalizePanorama(value));}
  const input=example();input.panorama=panorama();assert.throws(()=>createEntropiDocument(input),/originalpara/);
  const large=new Blob(['x'],{type:'image/jpeg'});Object.defineProperty(large,'size',{value:32*1024*1024+1});
  const oversized=panorama();oversized.frames[0].left=large;assert.throws(()=>normalizePanorama(oversized),/originalbilete/);
  const bounded=new Blob(['x'],{type:'image/jpeg'});Object.defineProperty(bounded,'size',{value:32*1024*1024});
  const full={frames:Array.from({length:4},()=>({left:bounded,right:null})),transforms:Array(4).fill(null)};
  input.right=null;input.panorama=full;assert.throws(()=>createEntropiDocument(input),/for stor/);
});

test('panorama import rejects source aliasing, omitted sources, invalid transforms and mismatched versions',async()=>{
  const input=example();input.right=null;input.panorama=panorama();const bytes=await (await encodeEntropiDocument(input)).arrayBuffer();
  for(const change of [value=>value.version=1,value=>value.version=2,value=>delete value.panorama,value=>value.panorama.frames[0].left='sources/left',value=>value.panorama.frames[1].left='panorama/0/left',value=>delete value.panorama.frames[0].right,value=>value.panorama.frames.pop(),value=>value.panorama.transforms[1]=[1,2,3],value=>value.files['panorama/0/left'].type='text/html'])await assert.rejects(decodeEntropiDocument(updateManifest(members(bytes),change)));
  const damaged=members(bytes);damaged.find(entry=>entry.name==='panorama/0/right').data[2]^=1;
  await assert.rejects(decodeEntropiDocument(rebuild(damaged)),/skadd/);
  const missing=members(bytes).filter(entry=>entry.name!=='panorama/2/left');await assert.rejects(decodeEntropiDocument(rebuild(missing)));
});

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

test('photo edits use version 2 and retain uncropped originals and exact depth bits when reopened',async()=>{
  const input=example();new Uint32Array(input.result.depth.buffer)[2]=0x7fc54321;
  input.recipe.edits={exposure:.35,contrast:-.2,sharpen:.6,denoise:.4,preset:'P5',strength:.7,crop:{x:.1,y:.2,width:.75,height:.6}};
  const saved=createEntropiDocument(input),expected=structuredClone(saved.recipe),bits=rawBytes(saved.result.depth).slice();
  input.recipe.edits.crop.x=.2;
  const file=await encodeEntropiDocument(saved),entries=members(await file.arrayBuffer()),manifest=JSON.parse(entries.find(item=>item.name==='manifest.json').data);
  assert.equal(manifest.version,2);assert.deepEqual(manifest.recipe,expected);
  const reopened=await decodeEntropiDocument(file);
  assert.equal(reopened.id,saved.id);assert.equal(reopened.created,saved.created);
  assert.deepEqual(reopened.recipe,expected);assert.deepEqual(rawBytes(reopened.result.depth),bits);
  assert.deepEqual(reopened.result.validity,saved.result.validity);
  assert.equal(reopened.result.width,3);assert.equal(reopened.result.height,2);
  assert.deepEqual(await reopened.left.arrayBuffer(),await left.arrayBuffer());assert.deepEqual(await reopened.right.arrayBuffer(),await right.arrayBuffer());
  reopened.recipe.edits.crop={x:0,y:0,width:1,height:1};
  const uncropped=await decodeEntropiDocument(await encodeEntropiDocument(reopened));
  assert.deepEqual(rawBytes(uncropped.result.depth),bits);assert.deepEqual(uncropped.recipe.edits.crop,{x:0,y:0,width:1,height:1});
});

test('neutral photo edits retain the version 1 recipe and disabled preset strength is neutral',async()=>{
  for(const edits of [{},{exposure:0,contrast:0,sharpen:0,denoise:0,crop:{x:0,y:0,width:1,height:1}},{preset:'P5',strength:0}]){
    const input=example();input.recipe.edits=edits;
    const output=await encodeEntropiDocument(input),entries=members(await output.arrayBuffer()),manifest=JSON.parse(entries.find(item=>item.name==='manifest.json').data);
    assert.equal(manifest.version,1);assert.equal('edits' in manifest.recipe,false);
    assert.deepEqual((await decodeEntropiDocument(output)).recipe,example().recipe);
  }
});

test('malformed photo edits and version 2 without edits are rejected on import',async()=>{
  const file=await encodeEntropiDocument(example()),buffer=await file.arrayBuffer();
  for(const edits of [null,[],{preset:'unknown'},{exposure:4},{contrast:-2},{sharpen:-.1},{denoise:1.1},{strength:'1'},{crop:{x:.5,width:.6}},{crop:{height:0}}]){
    const input=example();input.recipe.edits=edits;assert.throws(()=>createEntropiDocument(input));
    await assert.rejects(decodeEntropiDocument(updateManifest(members(buffer),manifest=>{manifest.version=2;manifest.recipe.edits=edits})));
  }
  await assert.rejects(decodeEntropiDocument(updateManifest(members(buffer),manifest=>manifest.version=2)),/versjon/);
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

test('version 4 preserves independent color channels, grain and tone edits with untouched sources',async()=>{
  for(const withPanorama of [false,true]){
    const input=example();if(withPanorama){input.right=null;input.panorama=panorama()}
    input.recipe.edits={preset:'HB2',strength:.48,saturation:.2,highlights:-.4,shadows:.3,temperature:-.15,tint:.08,
      hsl:{red:{hue:.25,saturation:-.1,lightness:.05},orange:{hue:-1,saturation:.76},blue:{lightness:-.3}},
      grain:{strength:.4,size:.875,color:.2}};
    const saved=createEntropiDocument(input),recipe=structuredClone(saved.recipe),bits=rawBytes(saved.result.depth).slice();
    input.recipe.edits.hsl.red.hue=-.8;input.recipe.edits.grain.strength=.9;
    const file=await encodeEntropiDocument(saved),entries=members(await file.arrayBuffer()),manifest=JSON.parse(entries.find(item=>item.name==='manifest.json').data);
    assert.equal(manifest.version,4);assert.deepEqual(manifest.recipe,recipe);
    const reopened=await decodeEntropiDocument(file);
    assert.deepEqual(reopened.recipe,recipe);assert.deepEqual(rawBytes(reopened.result.depth),bits);
    assert.deepEqual(await reopened.left.arrayBuffer(),await saved.left.arrayBuffer());
    if(withPanorama)assert.deepEqual(await reopened.panorama.frames[1].left.arrayBuffer(),await saved.panorama.frames[1].left.arrayBuffer());
    for(const version of [1,2,3])await assert.rejects(decodeEntropiDocument(updateManifest(members(await file.arrayBuffer()),value=>value.version=version)),/versjon/);
  }
});

test('advanced defaults remain legacy compatible and malformed channel values reject before saving',async()=>{
  const neutral={saturation:0,highlights:0,shadows:0,temperature:0,tint:0,hsl:{orange:{hue:0}},grain:{strength:0,size:1,color:1}};
  const input=example();input.recipe.edits=neutral;
  const entries=members(await (await encodeEntropiDocument(input)).arrayBuffer());
  assert.equal(JSON.parse(entries.find(item=>item.name==='manifest.json').data).version,1);
  for(const edits of [{saturation:2},{highlights:NaN},{temperature:'1'},{grain:{strength:1.01}},{grain:{size:-.01}},{grain:{color:Infinity}},{hsl:{red:{hue:1.01}}},{hsl:{orange:{lightness:-2}}},{hsl:{blue:null}}]){
    assert.throws(()=>createEntropiDocument({...example(),recipe:{edits}}));
  }
});
