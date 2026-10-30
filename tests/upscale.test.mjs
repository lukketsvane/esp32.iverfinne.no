import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { upscaleSize, sourceTile, writeOutputTile, pngStream } from '../pointcloud/upscale-core.mjs';

test('AI export keeps exact requested dimensions and rejects an unsafe allocation',()=>{
  assert.deepEqual(upscaleSize(1600,1200,8),{width:12800,height:9600});
  assert.throws(()=>upscaleSize(4000,3000,8));
  assert.throws(()=>upscaleSize(1600,1200,3));
});
test('tiles preserve RGB order and replicate only outside the source',()=>{
  const rgba=new Uint8ClampedArray([255,0,0,0,0,255,0,128,0,0,255,255,255,255,255,255]);
  const tile=sourceTile(rgba,2,2,0,0,2,1),plane=16;
  assert.equal(tile.data[0],1);assert.equal(tile.data[plane],0);assert.equal(tile.data[plane*2],0);
  assert.equal(tile.data[5],1);assert.equal(tile.data[plane+6],1);assert.equal(tile.data[plane*2+9],1);
});
test('output stitching uses the neural values while retaining transparent pixels',()=>{
  const source=new Uint8ClampedArray([0,0,0,0,0,0,0,255]),strip=new Uint8ClampedArray(8*4*4),data=new Float32Array(4*4*3);
  data.fill(.25,0,16);data.fill(.5,16,32);data.fill(.75,32);
  writeOutputTile(strip,8,source,2,1,1,0,1,1,4,{data,width:4,height:4},0);
  assert.deepEqual([...strip.slice(16,19)],[64,128,191]);assert.equal(strip[19],159);assert.equal(strip[31],255);assert.equal(strip[0],0);
});
test('streamed PNG decodes to exact RGBA rows and includes model provenance',async()=>{
  const width=3,height=2,rgba=Uint8Array.from({length:24},(_,i)=>(i*31)%256),encoder=pngStream(width,height,{model:'test',factor:4});
  await encoder.write(rgba.subarray(0,12),1);await encoder.write(rgba.subarray(12),1);
  const bytes=new Uint8Array(await (await encoder.finish()).arrayBuffer()),view=new DataView(bytes.buffer),compressed=[];let metadata='';
  for(let at=8;at<bytes.length;){const length=view.getUint32(at),kind=new TextDecoder().decode(bytes.subarray(at+4,at+8)),data=bytes.subarray(at+8,at+8+length);if(kind==='IDAT')compressed.push(data);if(kind==='tEXt')metadata=new TextDecoder().decode(data);at+=length+12}
  const filtered=inflateSync(Buffer.concat(compressed)),actual=new Uint8Array(24);
  for(let y=0;y<2;y++){assert.equal(filtered[y*13],1);for(let x=0;x<12;x++)actual[y*12+x]=(filtered[y*13+1+x]+(x<4?0:actual[y*12+x-4]))&255}
  assert.deepEqual(actual,rgba);assert.match(metadata,/"factor":4/);
});
