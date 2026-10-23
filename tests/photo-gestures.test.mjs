import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPhotoGestures } from '../vendor/photo-gestures.mjs';

function harness(options={}){
  const events=new Map(),captured=new Set(),changes=[],rect={left:0,top:0,width:390,height:844};let enabled=true;
  const image={naturalWidth:1920,naturalHeight:1080,style:{},parentElement:{getBoundingClientRect:()=>rect},addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const control=attachPhotoGestures(image,{enabled:()=>enabled,onChange:state=>changes.push({...state}),...options});
  function emit(name,id,x,y,details={}){const event={pointerType:'touch',pointerId:id,clientX:x,clientY:y,prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...details};events.get(name)?.(event);if(['pointerup','pointercancel','lostpointercapture'].includes(name))captured.delete(id);return event}
  const pinch=()=>{emit('pointerdown',1,100,422);emit('pointerdown',2,200,422);emit('pointermove',1,0,422);emit('pointermove',2,300,422)};
  const three=()=>{for(const [id,x,y]of [[1,100,422],[2,200,422],[3,150,500]])emit('pointerdown',id,x,y)};
  const moveThree=(dx,dy)=>{for(const [id,x,y]of [[1,100,422],[2,200,422],[3,150,500]])emit('pointermove',id,x+dx,y+dy)};
  const release=()=>{for(const id of [1,2,3,4])emit('pointerup',id,0,0)};
  return {image,control,changes,events,captured,rect,emit,pinch,three,moveThree,release,disable(){enabled=false},enable(){enabled=true}};
}

test('spreading and pinching change pixel size without zooming or moving the photograph',()=>{
  const app=harness();app.control.refresh();app.control.state.grain=2;app.control.state.contrast=1.7;
  app.emit('pointerdown',1,100,422);app.emit('pointerdown',2,200,422);
  for(let x=201;x<=225;x++)app.emit('pointermove',2,x,422);
  assert.equal(app.control.state.grain,2.5);
  const move=app.emit('pointermove',2,150,422);assert.equal(move.prevented,true);assert.equal(move.stopped,true);assert.equal(app.control.state.grain,1);
  assert.equal(app.control.state.contrast,1.7);assert.equal(app.control.state.scale,1);assert.equal(app.control.state.x,0);assert.equal(app.control.state.y,0);
  app.emit('pointerup',2,150,422);app.emit('pointermove',1,2000,2000);assert.equal(app.control.state.grain,1);assert.equal(app.image.style.transform,'');app.control.dispose();
});

test('repeated outward and inward pinches return to the same size and preserve the source',()=>{
  const app=harness();app.control.refresh();const before={...app.control.state},changes=app.changes.length;
  for(let i=0;i<4;i++){app.pinch();assert.equal(app.control.state.grain,3);app.emit('pointermove',1,100,422);app.emit('pointermove',2,200,422);app.release()}
  assert.deepEqual(app.control.state,before);assert.ok(app.changes.length>changes);assert.equal(app.image.naturalWidth,1920);assert.equal(app.image.naturalHeight,1080);assert.equal(app.image.style.transform,'');app.control.dispose();
});

test('recenter clears framing and active fingers while preserving photo tone and image data',()=>{
  const app=harness();app.pinch();app.control.state.grain=4;app.control.state.contrast=1.75;app.control.reset();assert.equal(app.control.state.scale,1);assert.equal(app.control.state.x,0);assert.equal(app.control.state.y,0);assert.equal(app.captured.size,0);
  assert.equal(app.control.state.grain,4);assert.equal(app.control.state.contrast,1.75);assert.equal(app.image.style.transform,'');
  assert.equal(app.image.naturalWidth,1920);app.control.dispose();assert.equal(app.events.size,0);
});

test('three-finger tone adjustment respects the deadzone and locks its first axis without changing framing',()=>{
  const app=harness();app.control.refresh();app.pinch();app.release();app.control.state.grain=4;const before={scale:app.control.state.scale,x:app.control.state.x,y:app.control.state.y},transform=app.image.style.transform;
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

test('three to two to one fingers keep the photo fixed without carrying tone-axis state',()=>{
  const app=harness();app.control.refresh();app.three();app.moveThree(45,0);const contrast=app.control.state.contrast;
  app.emit('pointerup',3,195,500);app.emit('pointermove',1,100,422);assert.equal(app.control.state.scale,1);assert.equal(app.control.state.contrast,contrast);assert.equal(app.control.state.grain,1.45);
  app.emit('pointerup',2,245,422);app.emit('pointermove',1,110,422);assert.equal(app.control.state.x,0);assert.equal(app.control.state.y,0);assert.equal(app.image.style.transform,'');assert.equal(app.control.state.contrast,contrast);app.control.dispose();
});

test('a fourth finger and disabled or mouse input cannot mutate photo framing or tone',()=>{
  const app=harness();app.control.refresh();app.three();app.emit('pointerdown',4,250,500);const before={...app.control.state};app.moveThree(200,300);app.emit('pointermove',4,300,100);assert.deepEqual(app.control.state,before);
  app.disable();app.emit('pointermove',1,500,200);assert.deepEqual(app.control.state,before);app.enable();app.emit('pointerdown',5,100,100,{pointerType:'mouse'});app.emit('pointermove',5,300,300,{pointerType:'mouse'});assert.deepEqual(app.control.state,before);app.control.dispose();
});


test('hidden layout retains tone and reopening remeasures the fixed viewport',()=>{
  const app=harness();app.control.refresh();app.control.state.grain=4;app.control.state.contrast=2;const before={...app.control.state};app.rect.width=app.rect.height=0;app.control.refresh();assert.deepEqual(app.control.state,before);
  app.rect.width=390;app.rect.height=700;app.control.refresh();assert.equal(app.control.state.height,700);assert.equal(app.control.state.x,0);assert.equal(app.control.state.scale,1);assert.equal(app.control.state.grain,4);assert.equal(app.control.state.contrast,2);app.control.dispose();
});

test('live pinch changes pixel size while three fingers retain independent contrast adjustment',()=>{
  const app=harness({toneOnly:true});app.control.refresh();app.emit('pointerdown',1,100,422);assert.equal(app.emit('pointermove',1,150,422).prevented,false);
  app.emit('pointerdown',2,200,422);app.emit('pointermove',2,350,422);assert.equal(app.control.state.scale,1);assert.equal(app.control.state.grain,4);app.release();
  app.three();app.moveThree(50,0);assert.ok(app.control.state.contrast>1);assert.equal(app.control.state.grain,4);assert.equal(app.image.style.transform,'');
  app.emit('pointerup',3,200,500);app.emit('pointermove',2,500,422);assert.equal(app.control.state.scale,1);assert.equal(app.image.style.transform,'');app.control.dispose();assert.equal(app.captured.size,0);
});

test('multitouch at either size limit suppresses default actions through the final release',()=>{
  for(const [grain,x] of [[1,150],[8,300]]){
    let gestures=0;const app=harness({onGesture:()=>gestures++});app.control.refresh();app.control.state.grain=grain;
    app.emit('pointerdown',1,100,422);const second=app.emit('pointerdown',2,200,422);assert.equal(second.prevented,true);assert.equal(second.stopped,false);
    app.emit('pointermove',2,x,422);assert.equal(app.control.state.grain,grain);
    const before=gestures;assert.equal(app.emit('pointerup',2,x,422).prevented,true);assert.equal(app.emit('pointerup',1,100,422).prevented,true);assert.equal(gestures,before+2);
    app.emit('pointerdown',3,100,422);assert.equal(app.emit('pointerup',3,100,422).prevented,false);app.control.dispose();
  }
});

test('cancelling a pinch releases stale pointers and preserves size for a fresh gesture',()=>{
  for(const cancel of ['explicit','disabled','lostcapture']){
    const app=harness();app.control.refresh();app.pinch();assert.equal(app.control.state.grain,3);
    if(cancel==='explicit')app.control.cancel();
    else if(cancel==='disabled'){app.disable();app.emit('pointermove',1,40,422);app.enable()}
    else{app.emit('lostpointercapture',1,0,422);app.emit('lostpointercapture',2,300,422)}
    assert.equal(app.captured.size,0);app.emit('pointerdown',3,100,422);app.emit('pointermove',3,200,422);assert.equal(app.control.state.grain,3);
    app.emit('pointerdown',4,300,422);app.emit('pointermove',4,350,422);assert.equal(app.control.state.grain,4.5);app.control.dispose();
  }
});
