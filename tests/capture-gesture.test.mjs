import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/capture-gesture.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
function harness(){
  const events=new Map(),globalEvents=new Map(),attributes=new Map(),timers=new Map();let next=0,captures=0,enabled=true;
  const button={disabled:false,setPointerCapture(){},setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name),addEventListener:(name,handler)=>events.set(name,handler)};
  const document={hidden:false,addEventListener:(name,handler)=>globalEvents.set(name,handler)};
  const state=vm.createContext({document,window:{addEventListener:(name,handler)=>globalEvents.set(name,handler)},setTimeout:callback=>{timers.set(++next,callback);return next},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source,state);state.bindCaptureGesture(button,{onCapture:()=>captures++,enabled:()=>enabled});
  function emit(name,details={},global=false){const event={pointerId:1,isPrimary:true,clientX:20,clientY:20,button:0,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...details};(global?globalEvents:events).get(name)?.(event);return event}
  return {button,attributes,emit,get captures(){return captures},hold(){for(const [id,fn]of timers){timers.delete(id);fn()}},hide(){document.hidden=true;emit('visibilitychange',{},true)},disable(){enabled=false}};
}

test('short tap preserves normal return while a hold captures only when released and consumes its click',()=>{
  const app=harness();app.emit('pointerdown');app.emit('pointerup');assert.equal(app.emit('click').stopped,undefined);assert.equal(app.captures,0);
  app.emit('pointerdown');app.hold();assert.equal(app.attributes.get('data-capture-ready'),'true');assert.equal(app.captures,0);
  app.emit('pointerup');assert.equal(app.captures,1);assert.equal(app.emit('click').stopped,true);assert.equal(app.attributes.has('data-capture-ready'),false);
});

for(const type of ['pointercancel','lostpointercapture','visibilitychange','pagehide','blur','move','second'])test(type+' cancels an armed capture',()=>{
  const app=harness();app.emit('pointerdown');app.hold();
  if(type==='move')app.emit('pointermove',{clientX:60});
  else if(type==='second')app.emit('pointerdown',{pointerId:2},true);
  else if(type==='visibilitychange')app.hide();
  else app.emit(type,{},['pagehide','blur'].includes(type));
  app.emit('pointerup');assert.equal(app.captures,0);assert.equal(app.emit('click').stopped,true);
});

test('Shift Enter captures once while normal Enter and repeated keys retain their normal meaning',()=>{
  const app=harness();assert.equal(app.emit('keydown',{key:'Enter'}).prevented,undefined);assert.equal(app.captures,0);
  assert.equal(app.emit('keydown',{key:'Enter',shiftKey:true}).prevented,true);assert.equal(app.captures,1);
  app.emit('keydown',{key:'Enter',shiftKey:true,repeat:true});app.disable();app.emit('keydown',{key:'Enter',shiftKey:true});assert.equal(app.captures,1);
});
