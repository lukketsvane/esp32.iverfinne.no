import test from 'node:test';
import assert from 'node:assert/strict';
import {PHOTO_PRESETS,normalizePhotoEdits,photoEditsNeutral,applyPhotoEdits} from '../vendor/photo-adjustments.mjs';

function pixels(values,bitDepth=8){
  const Type=bitDepth===16?Uint16Array:Uint8ClampedArray,maximum=bitDepth===16?65535:255;
  return Type.from(values.flatMap(value=>Array.isArray(value)?value:[value,value,value,maximum]));
}
const render=(values,edits={},options={})=>applyPhotoEdits(pixels(values,options.bitDepth),values.length,1,edits,options).data;
const red=data=>Array.from(data).filter((_,index)=>index%4===0);

test('ten unique presets include P5 and normalize to independent neutral edits',()=>{
  assert.equal(PHOTO_PRESETS.length,10);assert.equal(new Set(PHOTO_PRESETS.map(item=>item.id)).size,10);
  assert.ok(PHOTO_PRESETS.some(item=>item.id==='P5'));
  assert.ok(PHOTO_PRESETS.every(item=>item.label&&item.description&&item.defaultStrength>0&&item.defaultStrength<=1));
  const a=normalizePhotoEdits(),b=normalizePhotoEdits();
  assert.deepEqual(a,{exposure:0,contrast:0,sharpen:0,denoise:0,preset:null,strength:1,crop:{x:0,y:0,width:1,height:1}});
  assert.notEqual(a.crop,b.crop);a.crop.width=.5;assert.equal(b.crop.width,1);
  assert.equal(photoEditsNeutral(),true);assert.equal(photoEditsNeutral({preset:'P5',strength:0}),true);
  assert.equal(photoEditsNeutral({crop:{width:.5}}),false);
  assert.equal(photoEditsNeutral({denoise:.01}),false);
});

test('invalid archive edits are rejected instead of coerced or silently clamped',()=>{
  for(const value of [null,[],1,'P5'])assert.throws(()=>normalizePhotoEdits(value));
  for(const [key,values]of Object.entries({exposure:[-3.01,3.01,Infinity,NaN,'1',null],contrast:[-1.01,1.01],sharpen:[-.01,1.01],denoise:[-.01,1.01],strength:[-.01,1.01],preset:['p5','unknown',1,{},'toString']})){
    for(const value of values)assert.throws(()=>normalizePhotoEdits({[key]:value}),key+': '+value);
  }
  for(const crop of [null,[],{width:0},{height:0},{x:-.1},{y:1},{x:.9,width:.2},{y:.6,height:.5},{width:1.01},{x:NaN}])assert.throws(()=>normalizePhotoEdits({crop}));
  assert.deepEqual(normalizePhotoEdits({crop:{x:.2,y:.1,width:.8,height:.9}}).crop,{x:.2,y:.1,width:.8,height:.9});
});

test('neutral pixels retain their identity and arbitrary alpha at both bit depths',()=>{
  for(const bitDepth of [8,16]){
    const input=pixels([[1,2,3,0],[9,12,14,19],[127,128,129,255]],bitDepth),copy=input.slice();
    for(const edits of [{},{preset:'P5',strength:0}]){
      const result=applyPhotoEdits(input,3,1,edits,{bitDepth});
      assert.equal(result.data,input);assert.equal(result.width,3);assert.equal(result.height,1);
    }
    assert.deepEqual(input,copy);
  }
});

test('crop copies exact source pixels and never rewrites source storage',()=>{
  for(const bitDepth of [8,16]){
    const input=pixels(Array.from({length:24},(_,i)=>i*7+1),bitDepth),copy=input.slice();
    const result=applyPhotoEdits(input,6,4,{crop:{x:1/6,y:.25,width:.5,height:.5}},{bitDepth});
    assert.equal(result.width,3);assert.equal(result.height,2);
    assert.deepEqual(Array.from(result.data),[...input.slice(7*4,10*4),...input.slice(13*4,16*4)]);
    assert.notEqual(result.data,input);assert.deepEqual(input,copy);
  }
});

test('subpixel edge crops return at least one valid source pixel',()=>{
  const input=pixels([10,20,30,40]);
  const result=applyPhotoEdits(input,2,2,{crop:{x:.999,y:.999,width:.001,height:.001}});
  assert.equal(result.width,1);assert.equal(result.height,1);assert.deepEqual(result.data,input.slice(12));
});

test('exposure operates in linear light and contrast expands around middle gray',()=>{
  const brighter=render([64,128,192],{exposure:1}),darker=render([64,128,192],{exposure:-1});
  assert.ok(Math.abs(brighter[4]-175)<=1);assert.ok(Math.abs(darker[4]-92)<=1);
  for(let i=0;i<3;i++){assert.ok(brighter[i*4]>[64,128,192][i]);assert.ok(darker[i*4]<[64,128,192][i])}
  const contrast=red(render([64,128,192],{contrast:.5}));
  assert.ok(contrast[0]<64);assert.ok(Math.abs(contrast[1]-128)<=1);assert.ok(contrast[2]>192);
});

test('every preset is deterministic, strength blends continuously, and alpha is exact',()=>{
  const input=pixels([[16,40,72,0],[48,32,80,64],[128,96,72,128],[230,210,190,255]]),copy=input.slice();
  for(const {id}of PHOTO_PRESETS){
    const full=applyPhotoEdits(input,4,1,{preset:id}).data,half=applyPhotoEdits(input,4,1,{preset:id,strength:.5}).data;
    assert.deepEqual(full,applyPhotoEdits(input,4,1,{preset:id}).data);
    assert.deepEqual(full.slice(0,4),input.slice(0,4));
    for(let i=0;i<input.length;i++){
      if(i%4===3)assert.equal(full[i],input[i]);
      else assert.ok(Math.abs(half[i]-(input[i]+full[i])/2)<=1,id+', channel '+i);
    }
    assert.notDeepEqual(full,input,id);assert.deepEqual(input,copy);
  }
});

test('black and white presets remove hue while the other presets tint a gray ramp',()=>{
  for(const {id}of PHOTO_PRESETS){
    const data=render([[20,80,140,255],[90,170,60,255],[160,80,200,255]],{preset:id});
    if(['B1','B5','X1'].includes(id))for(let i=0;i<data.length;i+=4){assert.equal(data[i],data[i+1]);assert.equal(data[i],data[i+2])}
    else{const ramp=render([32,96,160,224],{preset:id});assert.ok([0,4,8,12].some(i=>ramp[i]!==ramp[i+1]||ramp[i]!==ramp[i+2]),id)}
  }
});

test('P5 follows the reference shadow, midtone, and highlight color changes',()=>{
  const [shadow,mid,light]=[32,112,208].map(value=>Array.from(render([value],{preset:'P5'})).slice(0,3));
  assert.ok(shadow[1]>shadow[0]&&shadow[1]>shadow[2]);
  assert.ok(mid[2]>mid[1]&&mid[2]>mid[0]);
  assert.ok(light[1]>light[2]&&light[1]>light[0]);
  assert.ok(light[1]-light[0]>15);
});

test('16-bit edits retain sub-display precision and agree with 8-bit previews',()=>{
  for(const {id}of PHOTO_PRESETS){
    const source=pixels([30000,30008,30016],16),data=applyPhotoEdits(source,3,1,{preset:id,exposure:.1},{bitDepth:16}).data;
    assert.ok(data instanceof Uint16Array);assert.ok(data[0]<data[4]&&data[4]<data[8],id);
    assert.ok([data[0],data[4],data[8]].some(value=>value%257!==0),id);
    const a=render([32,96,160,224],{preset:id,exposure:.25,contrast:.1}),b=render([32,96,160,224].map(value=>value*257),{preset:id,exposure:.25,contrast:.1},{bitDepth:16});
    for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i]/257)<=.51,id+', channel '+i);
  }
});

test('large grayscale exports preserve the exact per-pixel 16-bit transform',()=>{
  const values=Array.from({length:257},(_,i)=>Math.min(65535,i*256)),small=pixels(values,16),large=new Uint16Array(257*256*4);
  for(let row=0;row<256;row++)large.set(small,row*small.length);
  const edits={preset:'P5',exposure:.17,contrast:-.13,strength:.73};
  const expected=applyPhotoEdits(small,257,1,edits,{bitDepth:16}).data,actual=applyPhotoEdits(large,257,256,edits,{bitDepth:16}).data;
  for(let row=0;row<256;row++)assert.deepEqual(actual.subarray(row*small.length,(row+1)*small.length),expected);
});

test('denoise reduces small flat-field variations while preserving strong edges',()=>{
  const flat=pixels(Array.from({length:81},(_,i)=>128+(i%2?8:-8)));
  const result=applyPhotoEdits(flat,9,9,{denoise:1}).data;
  assert.ok(Math.abs(result[(4*9+4)*4]-128)<Math.abs(flat[(4*9+4)*4]-128));
  const edge=pixels(Array.from({length:81},(_,i)=>i%9<4?32:224));
  const clean=applyPhotoEdits(edge,9,9,{denoise:1}).data;
  assert.ok(clean[(4*9+3)*4]<=33);assert.ok(clean[(4*9+4)*4]>=223);
});

test('sharpen increases local detail while keeping constant fields unchanged',()=>{
  const soft=pixels([100,110,120,130,140,130,120,110,100]);
  const sharp=applyPhotoEdits(soft,9,1,{sharpen:1}).data;
  assert.ok(sharp[4*4]>soft[4*4]);assert.ok(sharp[0]<soft[0]);
  for(const bitDepth of [8,16]){
    const flat=pixels(Array(25).fill(bitDepth===16?31873:127),bitDepth);
    assert.deepEqual(applyPhotoEdits(flat,5,5,{sharpen:1,denoise:1},{bitDepth}).data,flat);
  }
});

test('filters exclude transparent neighbors without dark halos or changing validity',()=>{
  for(const bitDepth of [8,16]){
    const maximum=bitDepth===16?65535:255,value=bitDepth===16?40001:150;
    const input=pixels(Array.from({length:25},(_,i)=>i%5<2?[2,8,19,0]:[value,value,value,i%5===2?Math.round(maximum/2):maximum]),bitDepth);
    const output=applyPhotoEdits(input,5,5,{sharpen:1,denoise:1},{bitDepth}).data;
    assert.deepEqual(output,input);
  }
});

test('spatial filters produce the same cropped pixels as a full-size edit',()=>{
  const input=pixels(Array.from({length:63},(_,i)=>((i*17)%190)+20));
  const edits={preset:'P5',exposure:.3,contrast:-.1,sharpen:.7,denoise:.8};
  const full=applyPhotoEdits(input,9,7,edits),cropped=applyPhotoEdits(input,9,7,{...edits,crop:{x:2/9,y:2/7,width:4/9,height:3/7}});
  const expected=[];for(let y=2;y<5;y++)expected.push(...full.data.slice((y*9+2)*4,(y*9+6)*4));
  assert.deepEqual(Array.from(cropped.data),expected);
});

test('preview filter radius diminishes when sampling below source resolution',()=>{
  const input=pixels([100,110,120,130,140,130,120,110,100]);
  const native=applyPhotoEdits(input,9,1,{sharpen:1}).data;
  const preview=applyPhotoEdits(input,9,1,{sharpen:1},{referenceWidth:90,referenceHeight:10}).data;
  assert.ok(native[16]>preview[16]);assert.deepEqual(preview,input);
});

test('invalid pixel buffers and dimensions are rejected',()=>{
  const input=pixels([32,64]);
  for(const [width,height]of [[0,1],[2,0],[1.5,1],[2,2],[Infinity,1]])assert.throws(()=>applyPhotoEdits(input,width,height));
  for(const bitDepth of [0,10,32,'8',null])assert.throws(()=>applyPhotoEdits(input,2,1,{}, {bitDepth}));
  assert.throws(()=>applyPhotoEdits(input,2,1,{}, {bitDepth:16}));
  assert.throws(()=>applyPhotoEdits(new Uint16Array(8),2,1));
  assert.throws(()=>applyPhotoEdits(Array(8).fill(0),2,1));
  for(const options of [{referenceWidth:0},{referenceHeight:NaN},{referenceWidth:1.5}])assert.throws(()=>applyPhotoEdits(input,2,1,{},options));
});
