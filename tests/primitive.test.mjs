import test from 'node:test';
import assert from 'node:assert/strict';
import { C64_PALETTE, PRIMITIVE_MODES, normalizePrimitiveLevel, nearestC64, primitiveDimensions, qualityPointBudget } from '../pointcloud/primitive.mjs';
import { pointStride } from '../pointcloud/math.mjs';

const key=color=>color.join(',');

test('the original sixteen C64 colours retain their exact RGB swatches',()=>{
  assert.deepEqual(C64_PALETTE,[[0,0,0],[255,255,255],[150,40,46],[91,214,206],[159,45,173],[65,185,54],[39,36,196],[239,243,71],[159,72,21],[94,53,0],[218,95,102],[71,71,71],[120,120,120],[145,255,132],[104,100,255],[174,174,174]]);
  for(const color of C64_PALETTE)assert.deepEqual(nearestC64(...color),color);
  const palette=new Set(C64_PALETTE.map(key));
  for(let value=0;value<256;value+=17)assert.equal(palette.has(key(nearestC64(value,255-value,value*.6))),true);
});

test('the four point budgets bound high-resolution reconstruction without changing inference dimensions',()=>{
  const counts=[];
  for(const [level,budget]of [4500,10000,70000,95000].entries()){
    assert.equal(qualityPointBudget(level),budget);
    const stride=pointStride(1000,800,budget),count=Math.ceil(1000/stride)*Math.ceil(800/stride);assert.ok(count<=budget);counts.push(count);
  }
  assert.ok(counts.every((count,i)=>!i||count>counts[i-1]));
  assert.equal(qualityPointBudget(),70000);assert.equal(qualityPointBudget(NaN),70000);assert.equal(qualityPointBudget(-9),4500);assert.equal(qualityPointBudget(9),95000);
});

test('legacy grids fit the screen with the original EGA and CGA pixel proportions',()=>{
  assert.deepEqual(primitiveDimensions(0,390,844),{width:390,height:844});
  for(const [width,height]of [[1280,720],[390,844]])for(const level of [1,2,3]){
    const size=primitiveDimensions(level,width,height),mode=PRIMITIVE_MODES[level];
    assert.ok(size.width>0&&size.height>0&&size.width<=mode.width&&size.height<=mode.height);
    assert.ok(Math.abs((width/size.width)/(height/size.height)-mode.pixelAspect)<.02);
  }
  assert.equal(normalizePrimitiveLevel(-1),0);assert.equal(normalizePrimitiveLevel(7),3);assert.equal(normalizePrimitiveLevel(NaN),0);
});
