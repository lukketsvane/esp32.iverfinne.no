import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPhotoGestures } from '../vendor/photo-gestures.mjs';

function harness(){
  const events=new Map(),captured=new Set(),changes=[],rect={left:0,top:0,width:390,height:844};let enabled=true;
  const image={naturalWidth:1920,naturalHeight:1080,style:{},parentElement:{getBoundingClientRect:()=>rect},addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const control=attachPhotoGestures(image,{enabled:()=>enabled,onChange:state=>changes.push({...state})});
  function emit(name,id,x,y,details={}){const event={pointerType:'touch',pointerId:id,clientX:x,clientY:y,prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...details};events.get(name)?.(event);if(['pointerup','pointercancel','lostpointercapture'].includes(name))captured.delete(id);return event}
  const pinch=()=>{emit('pointerdown',1,100,422);emit('pointerdown',2,200,422);emit('pointermove',1,0,422);emit('pointermove',2,300,422)};
  const three=()=>{for(const [id,x,y]of [[1,100,422],[2,200,422],[3,150,500]])emit('pointerdown',id,x,y)};
  const moveThree=(dx,dy)=>{for(const [id,x,y]of [[1,100,422],[2,200,422],[3,150,500]])emit('pointermove',id,x+dx,y+dy)};
  const release=()=>{for(const id of [1,2,3,4])emit('pointerup',id,0,0)};
  return {image,control,changes,events,captured,rect,emit,pinch,three,moveThree,release,disable(){enabled=false},enable(){enabled=true}};
}

test('photo pinch preserves its focal point and single-finger pan stays within the photograph',()=>{
  const app=harness();app.pinch();assert.equal(app.control.state.scale,3);assert.ok(Math.abs(app.control.state.x-90)<1e-9);
  app.emit('pointerup',2,300,422);app.emit('pointermove',1,2000,2000);assert.equal(app.control.state.x,390);assert.equal(app.control.state.y,0);assert.match(app.image.style.transform,/scale\(3\)/);app.control.dispose();
});

test('pinching back to the base size restores the untransformed photo',()=>{
  const app=harness();app.pinch();app.emit('pointermove',1,100,422);app.emit('pointermove',2,200,422);
  assert.equal(app.control.state.scale,1);assert.equal(app.control.state.x,0);assert.equal(app.image.style.transform,'');app.control.dispose();
});

test('recenter clears framing and active fingers while preserving photo tone and image data',()=>{
  const app=harness();app.pinch();app.control.state.grain=4;app.control.state.contrast=1.75;app.control.reset();assert.equal(app.control.state.scale,1);assert.equal(app.control.state.x,0);assert.equal(app.control.state.y,0);assert.equal(app.captured.size,0);
  assert.equal(app.control.state.grain,4);assert.equal(app.control.state.contrast,1.75);assert.equal(app.image.style.transform,'');
  assert.equal(app.image.naturalWidth,1920);app.control.dispose();assert.equal(app.events.size,0);
});

test('three-finger tone adjustment respects the deadzone and locks its first axis without changing framing',()=>{
  const app=harness();app.pinch();app.release();app.control.state.grain=4;const before={scale:app.control.state.scale,x:app.control.state.x,y:app.control.state.y},transform=app.image.style.transform;
  app.three();app.moveThree(6,6);assert.equal(app.control.state.contrast,1);assert.equal(app.control.state.grain,4);
  app.moveThree(50,3);assert.ok(app.control.state.contrast>1);const contrast=app.control.state.contrast;
  app.moveThree(50,400);assert.equal(app.control.state.contrast,contrast);assert.equal(app.control.state.grain,4);
  assert.deepEqual({scale:app.control.state.scale,x:app.control.state.x,y:app.control.state.y},before);assert.equal(app.image.style.transform,transform);
  app.release();app.three();app.moveThree(3,100);assert.ok(app.control.state.grain>4);const grain=app.control.state.grain;app.moveThree(300,100);
  assert.equal(app.control.state.grain,grain);assert.equal(app.control.state.contrast,contrast);assert.deepEqual({scale:app.control.state.scale,x:app.control.state.x,y:app.control.state.y},before);app.control.dispose();
});

test('up is finer, down is coarser and contrast/grain stay inside their supported bounds',()=>{
  const app=harness();app.control.refresh();app.control.state.grain=4;app.three();app.moveThree(0,-100);assert.ok(app.control.state.grain<4);app.moveThree(0,5000);assert.equal(app.control.state.grain,8);app.moveThree(0,-5000);assert.equal(app.control.state.grain,1);assert.equal(app.control.state.contrast,1);
  app.release();app.three();app.moveThree(3000,0);assert.equal(app.control.state.contrast,3);app.moveThree(-3000,0);assert.equal(app.control.state.contrast,.5);assert.equal(app.control.state.grain,1);app.control.dispose();
});

test('three to two to one fingers resume pinch and pan without carrying tone-axis state',()=>{
  const app=harness();app.control.refresh();app.three();app.moveThree(45,0);const contrast=app.control.state.contrast;
  app.emit('pointerup',3,195,500);app.emit('pointermove',1,100,422);assert.ok(app.control.state.scale>1);assert.equal(app.control.state.contrast,contrast);assert.equal(app.control.state.grain,1);
  app.emit('pointerup',2,245,422);const before=app.control.state.x;app.emit('pointermove',1,110,422);assert.ok(app.control.state.x>before);assert.equal(app.control.state.contrast,contrast);app.control.dispose();
});

test('a fourth finger and disabled or mouse input cannot mutate photo framing or tone',()=>{
  const app=harness();app.control.refresh();app.three();app.emit('pointerdown',4,250,500);const before={...app.control.state};app.moveThree(200,300);app.emit('pointermove',4,300,100);assert.deepEqual(app.control.state,before);
  app.disable();app.emit('pointermove',1,500,200);assert.deepEqual(app.control.state,before);app.enable();app.emit('pointerdown',5,100,100,{pointerType:'mouse'});app.emit('pointermove',5,300,300,{pointerType:'mouse'});assert.deepEqual(app.control.state,before);app.control.dispose();
});


test('hidden layout cannot erase retained pan and reopening remeasures the viewport',()=>{
  const app=harness();app.pinch();const before={...app.control.state};app.rect.width=app.rect.height=0;app.control.refresh();assert.deepEqual(app.control.state,before);
  app.rect.width=390;app.rect.height=700;app.control.refresh();assert.equal(app.control.state.height,700);assert.equal(app.control.state.x,before.x);app.control.dispose();
});
