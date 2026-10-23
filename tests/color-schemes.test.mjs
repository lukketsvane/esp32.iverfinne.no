import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_SCHEMES, resolveColorScheme, ditherInk, gaussianInk, readColorScheme, saveColorScheme } from '../vendor/color-schemes.mjs';
import { processPhoto } from '../vendor/photo-view.mjs';

test('palettes have unique stable names and bounded four-stop RGB inks',()=>{
  assert.equal(new Set(COLOR_SCHEMES.map(scheme=>scheme.id)).size,COLOR_SCHEMES.length);
  assert.equal(COLOR_SCHEMES[0].id,'original');
  assert.ok(COLOR_SCHEMES.length>=6);
  for(const scheme of COLOR_SCHEMES){
    assert.equal(scheme.colors.length,4);
    for(const rgb of scheme.colors){assert.equal(rgb.length,3);for(const value of rgb)assert.ok(Number.isInteger(value)&&value>=0&&value<=255)}
    assert.equal(resolveColorScheme(scheme.id),scheme);
  }
  assert.equal(resolveColorScheme('unknown').id,'original');
});

test('dithering pattern is unchanged while coloured inks follow original intensity',()=>{
  const luma=[20,170,245,80],rgba=new Uint8ClampedArray(luma.flatMap(value=>[value,value,value,255]));
  const mono=processPhoto(rgba,2,2,0,1,1);
  const signal=processPhoto(rgba,2,2,0,1,1,'signal'),scheme=resolveColorScheme('signal');
  for(let pixel=0;pixel<4;pixel++){
    const offset=pixel*4,lit=mono[offset]===255,color=ditherInk(scheme,lit,luma[pixel]/255);
    assert.deepEqual([...signal.subarray(offset,offset+3)],color);
    assert.equal(signal[offset+3],255);
    assert.ok(mono[offset]===0||mono[offset]===255);
  }
  assert.deepEqual([...signal.subarray(4,7)],scheme.colors[2]);
  assert.deepEqual([...signal.subarray(8,11)],scheme.colors[3]);
  assert.deepEqual(processPhoto(rgba,2,2,1,1,1,'original'),processPhoto(rgba,2,2,1,1,1));
});

test('depth Gaussian colour bands keep the geometry-independent depth order',()=>{
  const scheme=resolveColorScheme('coral');
  assert.deepEqual(gaussianInk(scheme,0,0),scheme.colors[0]);
  assert.deepEqual(gaussianInk(scheme,1,1),scheme.colors[3]);
  for(let i=1;i<10;i++){
    const previous=scheme.colors.indexOf(gaussianInk(scheme,(i-1)/10,.5));
    const next=scheme.colors.indexOf(gaussianInk(scheme,i/10,.5));
    assert.ok(next>=previous);
  }
});

test('per-mode preference is saved independently with safe storage fallback',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),store=new Map();
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)}});
    assert.equal(readColorScheme('photo'),'signal');
    saveColorScheme('photo','ember');
    saveColorScheme('depth','ultraviolet');
    assert.equal(readColorScheme('photo'),'ember');
    assert.equal(readColorScheme('depth'),'ultraviolet');
    saveColorScheme('photo','invalid');
    assert.equal(readColorScheme('photo'),'original');
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked')}});
    assert.equal(readColorScheme('depth'),'signal');
    assert.doesNotThrow(()=>saveColorScheme('depth','signal'));
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage}
});
