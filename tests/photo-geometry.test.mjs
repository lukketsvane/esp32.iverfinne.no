import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryNeutral, normalizeGeometry, transformPhotoGeometry} from '../vendor/photo-geometry.mjs';
import {applyPhotoEdits,normalizePhotoEdits,photoEditsNeutral} from '../vendor/photo-adjustments.mjs';

const grid = (w,h,Type=Uint8ClampedArray) => Type.from({length:w*h*4}, (_,i)=>i%4===3 ? (Type===Uint16Array?65535:255) : (i>>2)+1);
const red = image => Array.from(image.data.filter((_,i)=>i%4===0));
test('exact turns, flips, alpha and oriented crop retain pixel coordinates at 8 and 16 bit', () => {
  for (const Type of [Uint8ClampedArray,Uint16Array]) {
    const source=grid(3,2,Type), opts={bitDepth:Type===Uint16Array?16:8};
    source[3]=7;
    for(const [turns,values] of [[1,[4,1,5,2,6,3]],[2,[6,5,4,3,2,1]],[3,[3,6,2,5,1,4]]]){
      const image=applyPhotoEdits(source,3,2,{geometry:{turns}},opts);
      assert.deepEqual(red(image),values);assert.equal(image.width,turns===2?3:2);assert.equal(image.height,turns===2?2:3);
      assert.equal(image.data[4*values.indexOf(1)+3],7);
    }
    assert.deepEqual(red(applyPhotoEdits(source,3,2,{geometry:{flipX:true}},opts)),[3,2,1,6,5,4]);
    assert.deepEqual(red(applyPhotoEdits(source,3,2,{geometry:{turns:1,flipY:true}},opts)),[6,3,5,2,4,1]);
    assert.deepEqual(red(applyPhotoEdits(source,3,2,{geometry:{turns:1},crop:{x:0,y:0,width:.5,height:1}},opts)),[4,5,6]);
    assert.equal(applyPhotoEdits(source,3,2,{},opts).data,source);
    assert.equal(source[3],7);
  }
});
test('fine rotation and both perspective axes keep the center, cover the frame, and change different pixels', () => {
  const source=grid(11,9);
  const images=[{straighten:24},{skewX:.7},{skewY:-.7},{turns:1,straighten:17,skewX:-1,skewY:.9}].map(g=>applyPhotoEdits(source,11,9,{geometry:g}));
  for(const image of images){
    assert.equal(red(image)[49],red({data:source})[49]);assert.ok(image.data.filter((_,i)=>i%4===3).every(a=>a===255));
    assert.notDeepEqual(image.data,source);
  }
  assert.equal(new Set(images.map(image=>red(image).join(','))).size,4);
});
test('interpolation weights by alpha and retains 16-bit colour precision', () => {
  const source=new Uint16Array(9*9*4);
  for(let y=0;y<9;y++)for(let x=0;x<9;x++){
    const i=(y*9+x)*4;
    if(x<4)source[i+1]=65535;else{source[i]=50123;source[i+3]=65535}
  }
  const image=transformPhotoGeometry(source,9,9,normalizeGeometry({straighten:24}));
  let softEdges=0;
  for(let i=0;i<image.data.length;i+=4){
    if(image.data[i+3]>0){assert.equal(image.data[i],50123);assert.equal(image.data[i+1],0)}
    if(image.data[i+3]>0&&image.data[i+3]<65535)softEdges++;
  }
  assert.ok(softEdges>0);
});
test('legacy geometry defaults to identity; corrupt geometry cannot be accepted as a recipe', ()=>{
  assert.ok(geometryNeutral(normalizePhotoEdits().geometry));assert.ok(photoEditsNeutral({}));
  assert.equal(photoEditsNeutral({geometry:{skewY:-1}}),false);
  for(const g of [null,[],{turns:1.5},{turns:4},{flipX:1},{straighten:Infinity},{straighten:46},{skewY:-1.1},{skewX:'0.2'}])assert.throws(()=>normalizePhotoEdits({geometry:g}));
});
