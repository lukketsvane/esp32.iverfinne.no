import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveColorScheme} from '../vendor/color-schemes.mjs';
import {renderRetroPixels} from '../vendor/retro-modes.mjs';
import {processPhoto} from '../vendor/photo-view.mjs';
import {pointStride,imageToPointCloud} from '../pointcloud/math.mjs';
import {qualityPointBudget} from '../pointcloud/primitive.mjs';

function frame(width,height,color){
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const rgb=color(x,y),at=(y*width+x)*4;
    pixels[at]=rgb[0];pixels[at+1]=rgb[1];pixels[at+2]=rgb[2];pixels[at+3]=255;
  }
  return pixels;
}
const pixel=(data,width,x,y)=>[...data.subarray((y*width+x)*4,(y*width+x)*4+3)];
const key=rgb=>rgb.join(',');
const rgbSet=(data,width,x0,y0,w,h)=>{
  const unique=new Set();
  for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)unique.add(key(pixel(data,width,x,y)));
  return unique;
};

test('C64 uses all 16 VIC-II hues, four inks per 4x8 cell, and double-width pixels',()=>{
  const palette=resolveColorScheme('c64').colors;
  assert.equal(palette.length,16);
  assert.deepEqual(palette[2],[129,51,56]);
  assert.deepEqual(palette[3],[117,206,200]);
  const input=frame(320,200,(x,y)=>{
    const tileX=Math.floor(x/8),tileY=Math.floor(y/8),local=Math.floor((x%8)/2);
    return palette[(tileX+tileY*7+local*3)%16];
  });
  const output=renderRetroPixels(input,320,200,'c64');
  const possible=new Set(palette.map(key)),used=rgbSet(output,320,0,0,320,200);
  assert.ok(used.size>8);
  for(const entry of used)assert.ok(possible.has(entry),entry);
  for(let y=0;y<200;y+=8)for(let x=0;x<320;x+=8){
    const colors=rgbSet(output,320,x,y,8,8);
    assert.ok(colors.size<=4,'C64 cell '+x+','+y+': '+colors.size);
  }
  for(let y=0;y<200;y++)for(let x=0;x<320;x+=2)assert.deepEqual(pixel(output,320,x,y),pixel(output,320,x+1,y));
});

test('ZX Spectrum uses 15 RGB colors and at most two matching-brightness inks per 8x8 attribute',()=>{
  const palette=resolveColorScheme('zx').colors;
  assert.equal(palette.length,15);
  const normals=new Set(palette.slice(0,8).map(key)),brights=new Set([key(palette[0]),...palette.slice(8).map(key)]);
  const input=frame(256,192,(x,y)=>{
    const cx=Math.floor(x/8),cy=Math.floor(y/8),bright=((cx+cy)&1)===0;
    const first=bright?8+(cx%7):1+(cx%7),second=bright?8+((cy+2)%7):1+((cy+2)%7);
    return palette[(x%8)<4?first:second];
  });
  const output=renderRetroPixels(input,256,192,'zx'),used=rgbSet(output,256,0,0,256,192);
  assert.ok(used.size>7);
  for(const entry of used)assert.ok(palette.some(color=>key(color)===entry),entry);
  for(let y=0;y<192;y+=8)for(let x=0;x<256;x+=8){
    const colors=rgbSet(output,256,x,y,8,8);
    assert.ok(colors.size<=2,'ZX cell '+x+','+y+': '+colors.size);
    assert.ok([...colors].every(color=>normals.has(color))||[...colors].every(color=>brights.has(color)));
  }
});

test('Apple II hi-res has six NTSC artifact colors, white adjacency and colored isolated pixels',()=>{
  const scheme=resolveColorScheme('appleii');
  assert.equal(scheme.colors.length,6);
  const input=frame(280,192,(x,y)=>{
    if(y===0)return x===0||x===1||x===4?[255,255,255]:[0,0,0];
    const target=(x+y*3)%14;
    return target<5?[0,214,56]:target<9?[55,112,255]:target===9?[255,255,255]:[0,0,0];
  });
  const output=renderRetroPixels(input,280,192,'appleii'),colors=rgbSet(output,280,0,0,280,192);
  assert.deepEqual(pixel(output,280,0,0),[255,255,255]);
  assert.deepEqual(pixel(output,280,1,0),[255,255,255]);
  assert.ok([[184,45,255],[55,112,255]].some(color=>key(color)===key(pixel(output,280,4,0))));
  assert.ok(colors.size>3);
  const palette=new Set(scheme.colors.map(key));
  for(const color of colors)assert.ok(palette.has(color),color);
});

test('capture output and preview share conversion with multiple nonmonochrome colors',()=>{
  const source=frame(320,200,(x,y)=>[(x*13+y*3)%256,(x*5+y*17)%256,(x*19+y*7)%256]);
  for(const id of ['appleii','c64','zx']){
    const actual=processPhoto(source,320,200,1,1,1,id),expected=renderRetroPixels(source,320,200,id);
    assert.deepEqual(actual,expected);
    assert.ok(rgbSet(actual,320,0,0,320,200).size>=4,id);
  }
});

test('all three converters preserve the dark outer optical frame',()=>{
  for(const id of ['appleii','c64','zx']){
    const source=frame(320,200,(x,y)=>x<8||y<8||x>=312||y>=192?[0,0,0]:[180,110,220]);
    const output=renderRetroPixels(source,320,200,id);
    for(const [x,y]of [[0,0],[319,0],[0,199],[319,199],[7,100],[100,199]])assert.deepEqual(pixel(output,320,x,y),[0,0,0]);
  }
});

test('new Gaussian geometry uses 50k or more points and keeps depth inference independent',()=>{
  const width=840,height=560,budget=qualityPointBudget(2),stride=pointStride(width,height,budget);
  assert.equal(budget,70000);
  assert.equal(stride,3);
  const rgba=frame(width,height,(x,y)=>[x%256,y%256,(x+y)%256]);
  const depthWidth=420,depthHeight=280,depth=new Float32Array(depthWidth*depthHeight);
  for(let y=0;y<depthHeight;y++)for(let x=0;x<depthWidth;x++)depth[y*depthWidth+x]=(x+y)/(depthWidth+depthHeight);
  const cloud=imageToPointCloud({rgba,width,height,depth,depthWidth,depthHeight,stride});
  assert.ok(cloud.count>=50000&&cloud.count<=budget,cloud.count);
  assert.equal(cloud.pixelOffsets.length,cloud.count);
  assert.ok(cloud.pixelOffsets.at(-1)<rgba.length);
  assert.ok(cloud.count>=3*Math.ceil(420/3)*Math.ceil(280/3));
});
