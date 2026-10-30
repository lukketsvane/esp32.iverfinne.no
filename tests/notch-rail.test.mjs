import test from 'node:test';
import assert from 'node:assert/strict';
import {attachNotchRail} from '../vendor/notch-rail.mjs';

function railFixture(options={}){
  const events=new Map(),calls={starts:0,selected:[],taps:[],ends:[]};let capture=null;
  const rail={addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name),setPointerCapture:id=>capture=id,hasPointerCapture:id=>capture===id,releasePointerCapture:()=>capture=null};
  const buttons=[0,1,2,3,4].map(index=>({getBoundingClientRect:()=>({top:index*100,height:44})}));
  const control=attachNotchRail(rail,buttons,{onStart:()=>calls.starts++,onSelect:index=>calls.selected.push(index),onTap:index=>calls.taps.push(index),onEnd:event=>calls.ends.push(event),...options});
  return {control,calls,events,get capture(){return capture},emit(name,values={}){const event={pointerId:1,clientX:20,clientY:22,button:0,detail:1,prevented:false,stopped:false,immediate:false,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},stopImmediatePropagation(){this.immediate=true},...values};events.get(name)?.(event);return event}};
}

test('a tap selects the closest notch even from the invisible gap',()=>{
  const rail=railFixture();rail.emit('pointerdown',{clientY:75});assert.equal(rail.capture,1);assert.equal(rail.control.active,true);
  rail.emit('pointerup',{clientY:75});assert.deepEqual(rail.calls.taps,[1]);assert.deepEqual(rail.calls.selected,[]);assert.equal(rail.capture,null);assert.equal(rail.control.active,false);
  const click=rail.emit('click');assert.equal(click.immediate,true);assert.equal(click.prevented,true);rail.control.dispose();
});

test('scrubbing follows vertical proximity outside the rail and avoids repeated selections',()=>{
  const rail=railFixture();rail.emit('pointerdown',{clientY:60});rail.emit('pointermove',{clientY:62});assert.deepEqual(rail.calls.selected,[]);
  for(const [clientX,clientY]of [[20,125],[300,135],[300,425],[300,430]])rail.emit('pointermove',{clientX,clientY});
  assert.deepEqual(rail.calls.selected,[1,4]);rail.emit('pointerup',{clientX:300,clientY:430});assert.deepEqual(rail.calls.taps,[]);assert.deepEqual(rail.calls.ends,[{cancelled:false,moved:true}]);
  rail.emit('lostpointercapture');assert.equal(rail.calls.ends.length,1);assert.equal(rail.emit('click').immediate,true);rail.control.dispose();
});

test('cancellation releases capture once without triggering a tap',()=>{
  for(const event of ['pointercancel','lostpointercapture']){
    const rail=railFixture();rail.emit('pointerdown');rail.emit('pointermove',{clientY:222});rail.emit(event);rail.emit(event);
    assert.deepEqual(rail.calls.selected,[2]);assert.deepEqual(rail.calls.taps,[]);assert.deepEqual(rail.calls.ends,[{cancelled:true,moved:true}]);assert.equal(rail.capture,null);rail.control.dispose();
  }
});

test('keyboard activation is preserved and inactive rails do not intercept events',()=>{
  const rail=railFixture();rail.emit('pointerdown');rail.emit('pointerup');assert.equal(rail.emit('click',{detail:0}).immediate,false);rail.control.dispose();
  const disabled=railFixture({enabled:()=>false});const event=disabled.emit('pointerdown');assert.equal(event.prevented,false);assert.equal(event.stopped,false);assert.equal(disabled.control.active,false);disabled.control.dispose();
});

test('disposal cancels an active scrub and removes every listener',()=>{
  const rail=railFixture();rail.emit('pointerdown');rail.emit('pointermove',{clientY:422});rail.control.dispose();
  assert.equal(rail.capture,null);assert.equal(rail.events.size,0);assert.deepEqual(rail.calls.ends,[{cancelled:true,moved:true}]);rail.control.dispose();assert.equal(rail.calls.ends.length,1);
});
