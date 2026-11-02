import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeVathographyPNG, readVathographyPNG} from '../vendor/vathography-png.mjs';
import {createEntropiDocument,encodeEntropiDocument,decodeEntropiDocument} from '../vendor/entropi-document.mjs';

const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=','base64')],{type:'image/png'});

async function example(){
  const source=new Blob(['original bytes'],{type:'image/jpeg'});
  const master=createEntropiDocument({
    left:source, preview:png, id:'marigold-real-depth',
    result:{width:2,height:2,depth:Float32Array.of(-1,.125,.7,1),
      polarity:'far',model:'Marigold V2 · Log-stage2',source:'import',
      provenance:{checkpoint:'depth/Log-stage2',format:'float32-raw',upscaled:false}},
    recipe:{preset:1,position:-.25,width:.75},
  });
  return {master, archive:await encodeEntropiDocument(master)};
}

test('VATHO PNG remains a standards-compliant PNG and round-trips all raw depth data',async()=>{
  const {master,archive}=await example();
  const image=await encodeVathographyPNG(png,archive);
  assert.equal(image.type,'image/png');
  const bytes=new Uint8Array(await image.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(String.fromCharCode(...bytes.subarray(-8,-4)),'IEND');
  const payload=await readVathographyPNG(image);
  assert.ok(payload instanceof Blob);
  const restored=await decodeEntropiDocument(payload);
  assert.equal(restored.result.model,master.result.model);
  assert.equal(restored.result.polarity,'far');
  assert.equal(restored.result.provenance.checkpoint,'depth/Log-stage2');
  assert.deepEqual([...restored.result.depth],[...master.result.depth]);
  assert.deepEqual(restored.recipe,master.recipe);
  assert.deepEqual(new Uint8Array(await restored.left.arrayBuffer()),new Uint8Array(await master.left.arrayBuffer()));
  assert.deepEqual(new Uint8Array(await restored.preview.arrayBuffer()),new Uint8Array(await png.arrayBuffer()));
});
test('ordinary PNG can be detected without misrepresenting its content as depth',async()=>{
  assert.equal(await readVathographyPNG(png),null);
});
test('re-export replaces the old private chunk rather than duplicating depth payloads',async()=>{
  const {archive}=await example();
  const once=await encodeVathographyPNG(png,archive);
  const twice=await encodeVathographyPNG(once,archive);
  assert.equal(once.size,twice.size);
  assert.deepEqual(new Uint8Array(await once.arrayBuffer()),new Uint8Array(await twice.arrayBuffer()));
});
test('tampered VATHO data fails its PNG CRC check',async()=>{
  const {archive}=await example();
  const encoded=await encodeVathographyPNG(png,archive);
  const bytes=new Uint8Array(await encoded.arrayBuffer()),text=new TextDecoder();
  const at=bytes.findIndex((value,i)=>value===118&&text.decode(bytes.subarray(i,i+4))==='vaTh');
  assert.ok(at>8);
  bytes[at+12]^=0xff;
  await assert.rejects(readVathographyPNG(new Blob([bytes],{type:'image/png'})),/skadd/);
});
test('truncated PNG and incorrect source MIME are refused',async()=>{
  const {archive}=await example();
  await assert.rejects(encodeVathographyPNG(new Blob(['not png'],{type:'image/png'}),archive));
  await assert.rejects(readVathographyPNG(new Blob(['fake'],{type:'image/jpeg'})));
});
