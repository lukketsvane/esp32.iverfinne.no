import test from 'node:test';
import assert from 'node:assert/strict';
import { originalPhotoPreview } from '../vendor/original-photo-editor.mjs';

test('before and after use identical rotated, cropped pixels with independent colour adjustments',()=>{
  const values=Uint8ClampedArray.from([10,20,30,40,50,60].flatMap(r=>[r,17,31,255]));
  const source={width:3,height:2,data:values};
  const edits={geometry:{turns:1},crop:{x:0,y:0,width:.5,height:1},exposure:1};
  const before=originalPhotoPreview(source,edits,{comparing:true}),after=originalPhotoPreview(source,edits);
  assert.deepEqual([before.width,before.height],[1,3]);assert.deepEqual([after.width,after.height],[1,3]);
  assert.deepEqual([...before.data.filter((_,i)=>i%4===0)],[40,50,60]);
  assert.ok(after.data[0]>before.data[0]);assert.equal(before.data[1],17);
  const cropBefore=originalPhotoPreview(source,edits,{comparing:true,cropping:true});
  assert.deepEqual([cropBefore.width,cropBefore.height],[2,3]);
  assert.equal(edits.crop.width,.5);
});
