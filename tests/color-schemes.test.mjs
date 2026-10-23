import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_SCHEMES, resolveColorScheme, gaussianInk, readColorScheme, saveColorScheme } from '../vendor/color-schemes.mjs';
import { processPhoto } from '../vendor/photo-view.mjs';

test('every profile names a documented historical display and uses valid RGB tones',()=>{
  assert.deepEqual(COLOR_SCHEMES.map(scheme=>scheme.id),['macintosh','ibm5151','ibmcga','gameboy','bluecrt','amber','appleii','c64','zx']);
  for(const scheme of COLOR_SCHEMES){
    assert.match(scheme.label,/(19\d\d|P11|P3)/);
    assert.equal(scheme.colors.length,scheme.mode==='c64'?16:scheme.mode==='zx'?15:scheme.mode==='appleii'?6:4);
    assert.ok([2,4].includes(scheme.tones));
    for(const rgb of scheme.colors){assert.equal(rgb.length,3);for(const value of rgb)assert.ok(Number.isInteger(value)&&value>=0&&value<=255)}
    assert.equal(resolveColorScheme(scheme.id),scheme);
  }
  assert.equal(resolveColorScheme('coral').id,'macintosh');
});

test('Macintosh black-white and IBM CGA four-colour dither render in the actual profile palette',()=>{
  const luma=[0,80,170,255],rgba=new Uint8ClampedArray(luma.flatMap(value=>[value,value,value,255]));
  const mac=processPhoto(rgba,2,2,3,1,1,'macintosh');
  const cga=processPhoto(rgba,2,2,1,1,1,'ibmcga');
  const cgaColors=resolveColorScheme('ibmcga').colors;
  for(let pixel=0;pixel<4;pixel++){
    const offset=pixel*4;
    assert.ok(mac[offset]===0||mac[offset]===255);
    assert.equal(mac[offset],mac[offset+1]);
    assert.equal(mac[offset],mac[offset+2]);
    assert.equal(mac[offset+3],255);
    assert.ok(cgaColors.some(color=>color.every((channel,index)=>channel===cga[offset+index])));
  }
  assert.deepEqual([...cga.subarray(0,3)],cgaColors[0]);
  assert.deepEqual([...cga.subarray(12,15)],cgaColors[3]);
});

test('Game Boy emits exactly the four olive LCD tones rather than a binary tinted photo',()=>{
  const scheme=resolveColorScheme('gameboy');
  const luma=[0,85,170,255],rgba=new Uint8ClampedArray(luma.flatMap(value=>[value,value,value,255]));
  const output=processPhoto(rgba,4,1,1,1,1,scheme.id);
  for(let pixel=0;pixel<4;pixel++){
    const color=[...output.subarray(pixel*4,pixel*4+3)];
    assert.ok(scheme.colors.some(ink=>ink.every((channel,index)=>channel===color[index])));
  }
  assert.notDeepEqual([...output.subarray(0,3)],[255,0,0]);
});

test('Gaussian bands follow depth and Macintosh remains strictly monochrome',()=>{
  for(const scheme of COLOR_SCHEMES){
    assert.deepEqual(gaussianInk(scheme,0,0),scheme.colors[0]);
    assert.deepEqual(gaussianInk(scheme,1,1),scheme.colors[scheme.tones===2?3:3]);
    for(let i=1;i<10;i++){
      const previous=scheme.colors.indexOf(gaussianInk(scheme,(i-1)/10,.5));
      const next=scheme.colors.indexOf(gaussianInk(scheme,i/10,.5));
      assert.ok(next>=previous);
    }
  }
});

test('new historical-profile storage ignores old red choices and keeps photo/depth independent',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),store=new Map([['entropi-color-photo-v1','coral']]);
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)}});
    assert.equal(readColorScheme('photo'),'macintosh');
    saveColorScheme('photo','ibmcga');
    saveColorScheme('depth','gameboy');
    assert.equal(readColorScheme('photo'),'ibmcga');
    assert.equal(readColorScheme('depth'),'gameboy');
    assert.equal(store.get('entropi-screen-photo-v2'),'ibmcga');
    saveColorScheme('photo','invalid');
    assert.equal(readColorScheme('photo'),'macintosh');
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked')}});
    assert.equal(readColorScheme('depth'),'macintosh');
    assert.doesNotThrow(()=>saveColorScheme('depth','ibm5151'));
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage}
});
