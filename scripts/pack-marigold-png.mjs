#!/usr/bin/env node
// Pack real Marigold V2 float32 depth into a viewable PNG with a full .entropi document.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createEntropiDocument,encodeEntropiDocument,decodeEntropiDocument} from '../vendor/entropi-document.mjs';
import {encodeVathographyPNG,readVathographyPNG} from '../vendor/vathography-png.mjs';

const args=process.argv.slice(2),arg=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]??null};
const [sourcePath,depthPath,previewPath,outPath]=['original','depth','preview','out'].map(arg);
if(!sourcePath||!depthPath||!previewPath||!outPath){
  console.error('Usage: node scripts/pack-marigold-png.mjs --original photo.jpg --depth marigold.f32 --preview vathography.png --out photo-vatho.png [--metadata manifest.json]');
  process.exitCode=2;
}else{
  const [source,raw,display]=await Promise.all([sourcePath,depthPath,previewPath].map(filename=>fs.readFile(filename)));
  const info=arg('metadata')?JSON.parse(await fs.readFile(arg('metadata'),'utf8')):{};
  if(display.length<33||display.toString('ascii',12,16)!=='IHDR')throw new Error('Preview must be PNG.');
  const width=display.readUInt32BE(16),height=display.readUInt32BE(20),n=width*height;
  if(!n||n>16777216||raw.length!==n*4)throw new Error('Raw depth and preview sizes do not match.');
  const depth=new Float32Array(n),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  for(let i=0;i<n;i++){depth[i]=v.getFloat32(i*4,true);if(!Number.isFinite(depth[i]))throw new Error('Invalid raw depth.')}
  const left=new Blob([source],{type:/\.png$/i.test(sourcePath)?'image/png':'image/jpeg'});
  const preview=new Blob([display],{type:'image/png'});
  const document=createEntropiDocument({
    left,preview,recipe:{preset:1,position:0,width:1},
    result:{width,height,depth,polarity:'far',quantity:'relative-depth',units:'relative',
      model:'Marigold V2 · Log-stage2',source:'imported-marigold-v2',
      provenance:{checkpoint:'huawei-bayerlab/marigold-v2-0/depth/Log-stage2',
        backbone:'Qwen/Qwen-Image-Edit-2509',quantization:info.quantization??null,
        sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),
        sourcePixels:info.input_pixels??null,outputPixels:[width,height],rawFormat:'float32-log-depth',noFallback:true}}
  });
  const encoded=await encodeVathographyPNG(preview,await encodeEntropiDocument(document));
  await fs.mkdir(path.dirname(outPath),{recursive:true});await fs.writeFile(outPath,new Uint8Array(await encoded.arrayBuffer()));
  const reopened=new Blob([await fs.readFile(outPath)],{type:'image/png'});
  const restored=await decodeEntropiDocument(await readVathographyPNG(reopened));
  if(restored.result.depth.length!==n||restored.result.depth.some((d,i)=>d!==depth[i]))throw new Error('Lossless depth round-trip failed!');
  console.log(JSON.stringify({file:outPath,pixels:[width,height],bytes:encoded.size,rawBytes:raw.length,model:'Marigold V2',roundTrip:true}));
}
