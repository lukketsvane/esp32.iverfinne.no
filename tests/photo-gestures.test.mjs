import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPhotoGestures } from '../vendor/photo-gestures.mjs';

function harness(){
  const events=new Map(),captured=new Set(),changes=[],rect={left:0,top:0,width:390,height:844};let enabled=true;
  const image={naturalWidth:1920,naturalHeight:1080,style:{},parentElement:{getBoundingClientRect:()=>rect},addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const control=attachPhotoGestures(image,{enabled:()=>enabled,onChange:state=>changes.push({...state})});
  function emit(name,id,x,y){const event={pointerType:'touch',pointerId:id,clientX:x,clientY:y,preventDefault(){},stopImmediatePropagation(){}};events.get(name)?.(event)}
  const pinch=()=>{emit('pointerdown',1,100,422);emit('pointerdown',2,200,422);emit('pointermove',1,0,422);emit('pointermove',2,300,422)};
  return {image,control,changes,events,captured,rect,emit,pinch,disable(){enabled=false}};
}

test('photo pinch preserves its focal point and single-finger pan stays within the photograph',()=>{
  const app=harness();app.pinch();assert.equal(app.control.state.scale,3);assert.ok(Math.abs(app.control.state.x-90)<1e-9);
  app.emit('pointerup',2,300,422);app.emit('pointermove',1,2000,2000);assert.equal(app.control.state.x,390);assert.equal(app.control.state.y,0);assert.match(app.image.style.transform,/scale\(3\)/);app.control.dispose();
});

test('pinching back to the base size restores the untransformed photo',()=>{
  const app=harness();app.pinch();app.emit('pointermove',1,100,422);app.emit('pointermove',2,200,422);
  assert.equal(app.control.state.scale,1);assert.equal(app.control.state.x,0);assert.equal(app.image.style.transform,'');app.control.dispose();
});

test('recenter clears the pose and active fingers without changing image data',()=>{
  const app=harness();app.pinch();app.control.reset();assert.equal(app.control.state.scale,1);assert.equal(app.control.state.x,0);assert.equal(app.control.state.y,0);assert.equal(app.captured.size,0);
  assert.equal(app.image.naturalWidth,1920);app.control.dispose();assert.equal(app.events.size,0);
});

test('a third finger and disabled photo view cannot change the pose',()=>{
  const app=harness();app.pinch();const before={...app.control.state};app.emit('pointerdown',3,200,300);app.emit('pointermove',1,40,300);assert.deepEqual(app.control.state,before);
  app.disable();app.emit('pointermove',2,300,500);assert.deepEqual(app.control.state,before);app.control.dispose();
});


test('hidden layout cannot erase retained pan and reopening remeasures the viewport',()=>{
  const app=harness();app.pinch();const before={...app.control.state};app.rect.width=app.rect.height=0;app.control.refresh();assert.deepEqual(app.control.state,before);
  app.rect.width=390;app.rect.height=700;app.control.refresh();assert.equal(app.control.state.height,700);assert.equal(app.control.state.x,before.x);app.control.dispose();
});
