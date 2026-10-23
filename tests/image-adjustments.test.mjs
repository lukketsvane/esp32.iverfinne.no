import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_ADJUSTMENTS,DITHER_TYPES,normalizeAdjustments,readAdjustments,saveAdjustments,applyLevels} from '../vendor/image-adjustments.mjs';
import {COLOR_SCHEMES} from '../vendor/color-schemes.mjs';
import {processPhoto} from '../vendor/photo-view.mjs';

const defaults={black:0,white:255,gamma:1,contrast:1,dither:'profile',strength:1};
const algorithms=['threshold','bayer','floyd','atkinson'];
function pixels(width,height,color=(x,y)=>[1+(x*13+y*3)%254,1+(x*5+y*17)%254,1+(x*19+y*7)%254]){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...color(x,y),255],(y*width+x)*4);
  return data;
}
const rgb=(data,width,x,y)=>[...data.subarray((y*width+x)*4,(y*width+x)*4+3)];
const hash=data=>Buffer.from(data).toString('base64');
function render(source,width,height,scheme,adjustments={}){return processPhoto(source,width,height,scheme.style,1,1,scheme.id,normalizeAdjustments(adjustments))}

test('adjustment defaults and algorithm choices expose one safe normalized setting object',()=>{
  assert.deepEqual(DEFAULT_ADJUSTMENTS,defaults);
  assert.deepEqual(DITHER_TYPES.map(type=>type.id),['profile',...algorithms]);
  for(const input of [undefined,null,[],false,'broken',42])assert.deepEqual(normalizeAdjustments(input),defaults);
  assert.deepEqual(normalizeAdjustments({black:NaN,white:Infinity,gamma:'2',contrast:null,strength:undefined,dither:'invalid',extra:'ignored'}),defaults);
  const invalid={black:254,white:-100,gamma:100,contrast:-100,dither:'floyd',strength:9};
  const result=normalizeAdjustments(invalid);
  assert.deepEqual(result,{black:254,white:255,gamma:3,contrast:.5,dither:'floyd',strength:1});
  assert.equal(invalid.white,-100);
  const settings=normalizeAdjustments({black:-20,white:200,gamma:.01,contrast:10,dither:'bayer',strength:-1});
  assert.deepEqual(settings,{black:0,white:200,gamma:.2,contrast:3,dither:'bayer',strength:0});
});

test('settings storage round trips independently and tolerates corrupted or unavailable storage',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),store=new Map([['entropi-pixel-size-v1','4'],['entropi-screen-photo-v2','zx']]);
  const restore=()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage};
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)}});
    assert.deepEqual(readAdjustments(),defaults);
    const chosen={black:25,white:220,gamma:1.5,contrast:.8,dither:'atkinson',strength:.6};
    saveAdjustments(chosen);assert.deepEqual(readAdjustments(),chosen);
    assert.deepEqual(JSON.parse(store.get('entropi-image-adjustments-v1')),chosen);
    assert.equal(store.get('entropi-pixel-size-v1'),'4');assert.equal(store.get('entropi-screen-photo-v2'),'zx');
    for(const raw of ['{broken','null','[]','"bad"']){store.set('entropi-image-adjustments-v1',raw);assert.deepEqual(readAdjustments(),defaults)}
    store.set('entropi-image-adjustments-v1',JSON.stringify({gamma:-50,dither:'unknown',strength:3}));
    assert.deepEqual(readAdjustments(),{...defaults,gamma:.2,strength:1});
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('storage blocked')}});
    assert.deepEqual(readAdjustments(),defaults);assert.doesNotThrow(()=>saveAdjustments(chosen));
  }finally{restore()}
});

test('levels map black and white endpoints, gamma changes midtones, and contrast remains monotonic',()=>{
  for(let value=0;value<=255;value++)assert.ok(Math.abs(applyLevels(value,defaults)-value)<1e-10);
  for(const gamma of [.2,.5,1,2,3])for(const contrast of [.5,1,2,3]){
    const settings=normalizeAdjustments({black:20,white:220,gamma,contrast});
    for(const value of [-10,0,20])assert.equal(applyLevels(value,settings),0);
    for(const value of [220,255,999])assert.equal(applyLevels(value,settings),255);
    let previous=-1;
    for(let value=0;value<=255;value++){const actual=applyLevels(value,settings);assert.ok(Number.isFinite(actual)&&actual>=previous&&actual>=0&&actual<=255);previous=actual}
  }
  assert.ok(Math.abs(applyLevels(120,normalizeAdjustments({black:20,white:220,gamma:2}))-255*Math.sqrt(.5))<1e-9);
  assert.ok(Math.abs(applyLevels(120,normalizeAdjustments({black:20,white:220,gamma:.5}))-63.75)<1e-9);
  assert.ok(applyLevels(80,{...defaults,contrast:.5})>80);assert.ok(applyLevels(175,{...defaults,contrast:.5})<175);
});

test('default profile settings preserve every existing profile while explicit algorithms affect coloured output',()=>{
  const width=48,height=32,source=pixels(width,height),original=source.slice();
  for(const scheme of COLOR_SCHEMES){
    assert.deepEqual(render(source,width,height,scheme),processPhoto(source,width,height,scheme.style,1,1,scheme.id),scheme.id+' preserves profile defaults');
    const outputs=algorithms.map(dither=>render(source,width,height,scheme,{dither}));
    assert.equal(new Set(outputs.map(hash)).size,algorithms.length,scheme.id+' distinguishes every explicit algorithm');
    for(const output of outputs){
      const allowed=new Set(scheme.colors.map(color=>color.join(',')));
      for(let at=0;at<output.length;at+=4){assert.ok(allowed.has([...output.subarray(at,at+3)].join(',')),scheme.id+' keeps its palette');assert.equal(output[at+3],255)}
    }
    const adjusted=render(source,width,height,scheme,{black:25,white:200,gamma:2,contrast:1.5});
    assert.notDeepEqual(adjusted,render(source,width,height,scheme),scheme.id+' applies shared levels in profile mode');
  }
  assert.deepEqual(source,original);
});

test('zero dithering strength becomes threshold quantization and positive strength affects each coloured mode',()=>{
  const width=48,height=32,source=pixels(width,height);
  for(const scheme of COLOR_SCHEMES){
    const threshold=render(source,width,height,scheme,{dither:'threshold'});
    for(const dither of ['bayer','floyd','atkinson']){
      assert.deepEqual(render(source,width,height,scheme,{dither,strength:0}),threshold,scheme.id+' '+dither+' strength 0');
      assert.notDeepEqual(render(source,width,height,scheme,{dither,strength:.5}),threshold,scheme.id+' '+dither+' strength .5');
      assert.notDeepEqual(render(source,width,height,scheme,{dither,strength:1}),threshold,scheme.id+' '+dither+' strength 1');
    }
  }
});

test('explicit dithering preserves global pixel cells, optical black masks, alpha, and unmodified source data',()=>{
  const width=37,height=29,grain=4,source=pixels(width,height),original=source.slice();
  for(let i=0;i<source.length;i+=4)source[i+3]=i%12?255:128;
  const withAlpha=source.slice();
  for(const scheme of COLOR_SCHEMES)for(const dither of algorithms){
    const output=processPhoto(source,width,height,scheme.style,grain,1,scheme.id,normalizeAdjustments({dither,black:10,white:240,gamma:1.2}));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      assert.deepEqual(rgb(output,width,x,y),rgb(output,width,Math.floor(x/grain)*grain,Math.floor(y/grain)*grain),scheme.id+' '+dither+' cell');
      assert.equal(output[(y*width+x)*4+3],source[(y*width+x)*4+3]);
    }
  }
  assert.deepEqual(source,withAlpha);assert.notDeepEqual(source,original);
  const masked=pixels(16,16,(x,y)=>x<2||y<2||x>13||y>13?[0,0,0]:[120,170,90]);masked[3]=0;masked[7]=64;
  for(const scheme of COLOR_SCHEMES)for(const dither of algorithms){
    const output=render(masked,16,16,scheme,{dither,black:10,white:200,gamma:3,contrast:.5});
    for(const [x,y]of [[0,0],[15,0],[0,15],[15,15],[1,8],[8,15]])assert.deepEqual(rgb(output,16,x,y),[0,0,0],scheme.id+' '+dither+' black mask');
    for(let at=3;at<output.length;at+=4)assert.equal(output[at],masked[at]);
  }
});
