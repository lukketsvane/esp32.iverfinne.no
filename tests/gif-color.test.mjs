import test from 'node:test';
import assert from 'node:assert/strict';
import {GrayGifEncoder} from '../vendor/gif-encoder.mjs';

// A single-pixel frame stores a 9-bit clear code, palette index and stop code.
async function decodeSinglePixelFrames(encoder){
  const bytes=new Uint8Array(await encoder.finish().arrayBuffer()),frames=[];
  let offset=13+256*3+19; // Global palette and NETSCAPE2.0 extension.
  while(bytes[offset]===0x21){
    assert.equal(bytes[offset+8],0x2c);
    const start=offset+8+10+2;
    const index=((bytes[start+1]>>1)|(bytes[start+2]<<7))&255;
    frames.push([...bytes.slice(13+3*index,16+3*index)]);
    offset=start+bytes[start-1]+1;
  }
  assert.equal(bytes[offset],0x3b);
  return frames;
}

test('one global color ramp preserves edited tones across frames and black invalid depth',async()=>{
  const ramp=new Uint8ClampedArray(4*256);
  for(let i=0;i<256;i++)ramp.set([i,Math.round(i*.65),Math.round(i*.28),255],4*i);
  const encoder=new GrayGifEncoder(1,1,{palette:ramp});
  for(const tone of [220,73,220])encoder.addRgbaFrame(ramp.slice(tone*4,tone*4+4));
  encoder.addRgbaFrame(Uint8Array.of(255,63,88,0));
  assert.deepEqual(await decodeSinglePixelFrames(encoder),[[220,143,62],[73,47,20],[220,143,62],[0,0,0]]);
});

test('neutral grades preserve every integer gray and color grain can use the RGB cube',async()=>{
  const ramp=new Uint8Array(4*256);
  // Even a flattened monochrome grade must retain the complete neutral palette.
  ramp.fill(128);
  const gray=new GrayGifEncoder(1,1,{palette:ramp});
  for(let i=0;i<256;i++)gray.addRgbaFrame(Uint8Array.of(i,i,i,255));
  assert.deepEqual(await decodeSinglePixelFrames(gray),Array.from({length:256},(_,i)=>[i,i,i]));
  const rgb=new GrayGifEncoder(1,1,{palette:'rgb'});
  rgb.addRgbaFrame(Uint8Array.of(255,0,0,255));
  rgb.addRgbaFrame(Uint8Array.of(0,255,255,255));
  assert.deepEqual(await decodeSinglePixelFrames(rgb),[[255,0,0],[0,255,255]]);
  assert.throws(()=>rgb.addRgbaFrame(new Uint8Array(8)));
});
