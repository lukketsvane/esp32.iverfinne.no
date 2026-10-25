import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftStereoRows, estimateStereoVerticalShift } from '../pointcloud/stereo-align.mjs';
import { estimateStereoDepth } from '../pointcloud/stereo.mjs';

function sourceImage(width,height){
  const pixels=new Uint8ClampedArray(width*height*4);let seed=314159;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    const band=Math.floor(y/19)%2?60:160;
    const value=Math.max(0,Math.min(255,(seed>>>24)*.52+band*.48));
    pixels.set([value,value,value,255],(y*width+x)*4);
  }
  return pixels;
}
function stereoRight(left,width,height,disparity){
  const right=sourceImage(width,height);
  for(let y=0;y<height;y++)for(let x=disparity;x<width;x++){
    const dst=(y*width+x-disparity)*4,src=(y*width+x)*4;
    right.set(left.subarray(src,src+4),dst);
  }
  return right;
}

test('vertical rectification preserves right-hand pixels and makes out-of-bounds regions transparent',()=>{
  const width=80,height=64,data=sourceImage(width,height);
  const shift=shiftStereoRows(data,width,height,9);
  for(let y=0;y<9;y++)for(let x=0;x<width;x++)assert.equal(shift[(y*width+x)*4+3],0);
  for(let y=9;y<height;y++)for(let x=0;x<width;x++){
    const dst=(y*width+x)*4,src=((y-9)*width+x)*4;
    assert.deepEqual([...shift.subarray(dst,dst+4)],[...data.subarray(src,src+4)]);
  }
});
test('vertical camera misalignment can be corrected before stereo matching',()=>{
  const width=160,height=112,left=sourceImage(width,height),right=stereoRight(left,width,height,8);
  const displaced=shiftStereoRows(right,width,height,-18);
  const fixed=shiftStereoRows(displaced,width,height,18);
  const output=estimateStereoDepth(left,fixed,width,height);
  assert.ok(output.matchedFraction>.45,output.matchedFraction);
  const center=output.depth.slice(30*width,82*width).filter(Number.isFinite);
  assert.ok(center.length>3000);
  assert.ok(center.every(d=>d===8));
});
test('suggestions are conservative and never automatically modify stereo images',()=>{
  const width=320,height=240,left=sourceImage(width,height),right=stereoRight(left,width,height,9);
  const shifted=shiftStereoRows(right,width,height,-32);
  const proposal=estimateStereoVerticalShift(left,shifted,width,height);
  assert.equal(proposal.reliable,true);
  assert.ok(Math.abs(proposal.offset-32)<=5,JSON.stringify(proposal));
  const flat=new Uint8ClampedArray(width*height*4).fill(130);
  assert.equal(estimateStereoVerticalShift(flat,flat,width,height).reliable,false);
  assert.equal(estimateStereoVerticalShift(left,flat,width,height).reliable,false);
});
