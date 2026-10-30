import test from 'node:test';
import assert from 'node:assert/strict';
import {attachGalleryNavigation} from '../vendor/gallery-navigation.mjs';

function harness(){
  const events=new Map(),steps=[];let enabled=true,dismissed=0;
  const image={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),setPointerCapture(){}};
  const control=attachGalleryNavigation(image,{enabled:()=>enabled,onStep:value=>steps.push(value),onDismiss:()=>dismissed++});
  function emit(type,x=0,y=0,details={}){const event={type,pointerId:1,clientX:x,clientY:y,button:0,timeStamp:type==='pointerdown'?0:200,preventDefault(){this.prevented=true},...details};events.get(type)?.(event);return event}
  return {emit,steps,events,control,get dismissed(){return dismissed},disable(){enabled=false}};
}

test('horizontal gallery swipes advance and reverse while downward swipes dismiss',()=>{
  const app=harness();app.emit('pointerdown',200,100);assert.equal(app.emit('pointerup',100,110).prevented,true);assert.deepEqual(app.steps,[1]);
  app.emit('pointerdown',100,100);app.emit('pointerup',190,110);assert.deepEqual(app.steps,[1,-1]);
  app.emit('pointerdown',100,100);app.emit('pointerup',110,210);assert.equal(app.dismissed,1);
});

test('taps, diagonals, upward swipes and holds cannot navigate or dismiss',()=>{
  for(const [x,y,timeStamp]of [[8,8,200],[70,70,200],[0,-110,200],[100,0,1300]]){
    const app=harness();app.emit('pointerdown');app.emit('pointerup',x,y,{timeStamp});assert.deepEqual(app.steps,[]);assert.equal(app.dismissed,0);
  }
});

test('a cancelled pointer or interrupted gallery cannot complete a swipe',()=>{
  for(const type of ['pointercancel','lostpointercapture']){const app=harness();app.emit('pointerdown');app.emit(type,100);app.emit('pointerup',100);assert.deepEqual(app.steps,[])}
  const app=harness();app.emit('pointerdown');app.control.cancel();app.emit('pointerup',100);assert.deepEqual(app.steps,[]);
  app.emit('pointerdown');app.disable();app.emit('pointerup',100);assert.deepEqual(app.steps,[]);
});

test('multitouch cannot become a swipe after one finger lifts',()=>{
  const app=harness();app.emit('pointerdown');app.emit('pointerdown',0,0,{pointerId:2});app.emit('pointerup',0,0,{pointerId:2});app.emit('pointerup',100);assert.deepEqual(app.steps,[]);
  app.emit('pointerdown');app.emit('pointerup',-100);assert.deepEqual(app.steps,[1]);
});

test('right mouse buttons are ignored and disposal removes all listeners',()=>{
  const app=harness();app.emit('pointerdown',0,0,{button:2});app.emit('pointerup',100);assert.deepEqual(app.steps,[]);
  app.control.dispose();assert.equal(app.events.size,0);
});
