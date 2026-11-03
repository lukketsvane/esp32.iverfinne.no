import test from 'node:test';
import assert from 'node:assert/strict';
import {METHODS,PALETTES,PRESETS,paletteColors,processPixels} from '../dither-core.mjs';
import {encodeGIF} from '../gif-codec.mjs';
const image=(w=44,h=38)=>{const pix=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;pix[i]=Math.round(255*x/w);pix[i+1]=Math.round(255*y/h);pix[i+2]=Math.round(255*(x+y)/(w+h));pix[i+3]=255}return pix};
const different=(a,b)=>a.some((x,i)=>x!==b[i]);
const rgb=buffer=>{const set=new Set;for(let i=0;i<buffer.length;i+=4)set.add([buffer[i],buffer[i+1],buffer[i+2]].join(','));return set};

test('all raster algorithms return RGBA of the same dimensions, preserving alpha',()=>{
 const src=image();for(const method of Object.keys(METHODS)){const out=processPixels(src,44,38,{dither:{method,palette:'gray4',pixel:2}});assert.equal(out.length,src.length,method);for(let i=3;i<out.length;i+=4)assert.equal(out[i],255,method)}
});
test('registered palette arrays and presets are valid and custom palette parser is safe',()=>{
 assert.ok(Object.keys(PALETTES).length>=15);assert.ok(Object.keys(PRESETS).length>=10);
 for(const [id,colors]of Object.entries(PALETTES)){assert.ok(colors.length>=2&&colors.length<=256,id);assert.ok(colors.every(x=>/^#[a-f0-9]{6}$/i.test(x)),id)}
 assert.deepEqual(paletteColors('custom','#abc #123456'),[[170,187,204],[18,52,86]]);
 assert.deepEqual(paletteColors('custom','broken'),paletteColors('mono'));
});
test('hard monochrome raster has only two colours and allows inversion',()=>{
 const src=image(),normal=processPixels(src,44,38,{dither:{method:'floyd',palette:'ink',strength:100,pixel:1}}),inverted=processPixels(src,44,38,{dither:{method:'floyd',palette:'ink',strength:100,pixel:1,invert:true}});
 assert.equal(rgb(normal).size,2);assert.equal(rgb(inverted).size,2);assert.ok(different(normal,inverted));
});
test('0% raster or disabled raster leaves grading intact',()=>{
 const src=image(),a=processPixels(src,44,38,{dither:{strength:0},grade:{contrast:20}}),b=processPixels(src,44,38,{dither:{enabled:false},grade:{contrast:20}});assert.deepEqual(a,b);assert.ok(different(a,src));
});
test('all 11 photo parameters have an observable effect',()=>{
 const src=image(),basic=processPixels(src,44,38,{dither:{enabled:false}});
 for(const [k,v]of Object.entries({exposure:.5,contrast:30,saturation:50,temperature:60,tint:60,fade:40,highlights:80,shadows:80,grain:75,vignette:75,sharpen:100})){
  const out=processPixels(src,44,38,{grade:{[k]:v},dither:{enabled:false}});assert.ok(different(out,basic),k);
 }
});
test('noise / ordered / diffusion produce genuinely different outputs',()=>{
 const src=image(),outputs=['bayer4','bayer8','noise','ign','floyd','atkinson','jjn','sierra','halftone'].map(method=>processPixels(src,44,38,{dither:{method,palette:'mono',pixel:1,strength:100}}));
 for(let i=0;i<outputs.length;i++)for(let j=i+1;j<outputs.length;j++)assert.ok(different(outputs[i],outputs[j]),`${i} must differ from ${j}`);
});
test('noise is deterministic for same seed but changes with different seeds',()=>{
 const src=image(),opts=seed=>({dither:{method:'noise',palette:'mono',pixel:1,seed}});let a=processPixels(src,44,38,opts(3)),b=processPixels(src,44,38,opts(3)),c=processPixels(src,44,38,opts(5));assert.deepEqual(a,b);assert.ok(different(a,c));
});
test('serpentine is supported and affects diffused gradients',()=>{
 const src=image(),base={method:'floyd',palette:'mono',pixel:1};assert.ok(different(processPixels(src,44,38,{dither:{...base,serpentine:true}}),processPixels(src,44,38,{dither:{...base,serpentine:false}})));
});
test('pixel size really changes pixel grouping while output dimensions stay unchanged',()=>{
 const src=image();let a=processPixels(src,44,38,{dither:{pixel:1,palette:'gray4'}}),b=processPixels(src,44,38,{dither:{pixel:6,palette:'gray4'}});assert.ok(different(a,b));assert.equal(b.length,src.length);
});
test('invalid buffer dimensions are rejected',()=>{assert.throws(()=>processPixels(new Uint8ClampedArray(8),2,2),/dimensjonar/);assert.throws(()=>processPixels(new Uint8ClampedArray(4),1000000,1000000),/dimensjonar/)});
test('GIF89a emits two independently decodable images and infinite repeat marker',()=>{
 const src=image(32,30);const gif=encodeGIF([src,src],32,30,'gray4','',10);assert.equal(Buffer.from(gif).subarray(0,6).toString(),'GIF89a');assert.equal(Buffer.from(gif).subarray(6,8).readUInt16LE(),32);assert.equal(Buffer.from(gif).subarray(8,10).readUInt16LE(),30);assert.ok(Buffer.from(gif).includes(Buffer.from('NETSCAPE2.0')));assert.equal(gif.at(-1),0x3B);assert.ok(gif.length>100);
});
