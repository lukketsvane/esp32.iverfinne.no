import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/live-capture-gesture.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
function harness(options={}){
  let time=0,nextTimer=0,ready=true,captured=null,stills=0;
  const timers=new Map(),starts=[],finishes=[],cancels=[],progress=[],errors=[],points=new Set(),legacy=[];
  class Target{
    constructor(){this.listeners=new Map()}
    addEventListener(name,handler,options){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push({handler,capture:options===true||!!options?.capture})}
    removeEventListener(name,handler){this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item.handler!==handler))}
    dispatch(name,event,capture){for(const item of this.listeners.get(name)||[]){if(capture!==undefined&&item.capture!==capture)continue;item.handler(event);if(event.immediate)break}}
    get count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.length,0)}
  }
  const win=new Target(),doc=new Target(),surface=new Target();doc.hidden=false;doc.defaultView=win;surface.ownerDocument=doc;surface.disabled=false;
  surface.setPointerCapture=id=>{captured=id};surface.hasPointerCapture=id=>captured===id;surface.releasePointerCapture=id=>{if(captured===id){captured=null;emit('lostpointercapture',{pointerId:id})}};
  const context=vm.createContext({window:win,document:doc,AbortController,Promise,performance:{now:()=>time},setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,at:time+delay});return id},clearTimeout:id=>timers.delete(id),console:{error:error=>errors.push(error)}});
  vm.runInContext(source,context);
  const control=context.bindLiveCaptureGesture(surface,{enabled:()=>ready,hitTest:event=>event.clientX>=0&&event.clientX<=100&&event.clientY>=0&&event.clientY<=100,onStart:value=>{starts.push(value);return options.onStart?.(value)},onFinish:value=>{finishes.push(value);return options.onFinish?.(value)},onCancel:value=>{cancels.push(value);return options.onCancel?.(value)},onProgress:value=>{progress.push(value);return options.onProgress?.(value)},...options.timing});
  function emit(name,values={},target=surface){
    const event={type:name,target:surface,pointerId:1,pointerType:'touch',isPrimary:true,clientX:50,clientY:50,button:0,detail:1,prevented:false,immediate:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.immediate=true},...values};
    if(target===surface&&name.startsWith('pointer'))doc.dispatch(name,event,true);
    if(!event.immediate)target.dispatch(name,event);
    if(target===surface&&!event.immediate){
      legacy.push(name);
      if(name==='pointerdown'&&!control.active){points.add(event.pointerId);surface.setPointerCapture(event.pointerId)}
      if(['pointerup','pointercancel','lostpointercapture'].includes(name))points.delete(event.pointerId);
      if(name==='click')stills++;
    }
    return event;
  }
  return {control,surface,doc,win,starts,finishes,cancels,progress,errors,points,legacy,timers,emit,get stills(){return stills},get captured(){return captured},setReady(value){ready=value},advance(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;const [id,value]=next;time=value.at;timers.delete(id);value.callback()}time=end},hold(){emit('pointerdown');this.advance(350)},hide(){doc.hidden=true;emit('visibilitychange',{},doc)},key(values){return emit('keydown',{pointerType:undefined,detail:0,...values},win)}};
}

test('a short tap stays a still photograph and does not block existing photo gestures',()=>{
  const app=harness();assert.equal(app.emit('pointerdown').immediate,false);app.advance(349);assert.equal(app.control.active,false);assert.equal(app.starts.length,0);
  assert.equal(app.emit('pointerup').immediate,false);app.emit('click');assert.equal(app.stills,1);assert.equal(app.points.size,0);assert.equal(app.timers.size,0);app.control.dispose();
});

test('holding starts at350ms, follows outside movement and finishes once without a second still',()=>{
  const app=harness();app.hold();assert.equal(app.control.active,true);assert.equal(app.starts.length,1);assert.equal(app.starts[0].maxMs,15000);assert.equal(app.progress[0].elapsedMs,0);
  const moves=app.legacy.filter(name=>name==='pointermove').length;assert.equal(app.emit('pointermove',{clientX:600,clientY:900}).immediate,true);assert.equal(app.legacy.filter(name=>name==='pointermove').length,moves);
  app.advance(1000);assert.equal(app.progress.at(-1).elapsedMs,1000);app.emit('pointerup',{clientX:600,clientY:900});app.emit('click');
  assert.equal(app.finishes.length,1);assert.equal(app.finishes[0].reason,'release');assert.equal(app.finishes[0].elapsedMs,1000);assert.equal(app.starts[0].signal.aborted,false);
  assert.equal(app.control.active,false);assert.equal(app.stills,0);assert.equal(app.captured,null);assert.equal(app.points.size,0);assert.ok(app.legacy.includes('lostpointercapture'));assert.equal(app.timers.size,0);app.control.dispose();
});

test('the fifteen second deadline finishes even while held and consumes the later release',()=>{
  const app=harness();app.hold();app.advance(14999);assert.equal(app.control.active,true);app.advance(1);
  assert.equal(app.control.active,false);assert.equal(app.finishes.length,1);assert.equal(app.finishes[0].reason,'limit');assert.equal(app.finishes[0].elapsedMs,15000);assert.equal(app.starts[0].signal.aborted,false);
  app.advance(2000);app.emit('pointerup');app.emit('click');assert.equal(app.finishes.length,1);assert.equal(app.stills,0);assert.equal(app.points.size,0);assert.equal(app.timers.size,0);app.control.dispose();
});

test('movement before the threshold disarms the hold and lets existing controls continue',()=>{
  const app=harness();app.emit('pointerdown');app.advance(100);const event=app.emit('pointermove',{clientX:63});assert.equal(event.immediate,false);assert.equal(event.prevented,false);
  app.advance(500);app.emit('pointerup');app.emit('click');assert.equal(app.starts.length,0);assert.equal(app.stills,0);assert.equal(app.points.size,0);app.control.dispose();
});

test('holding outside the live viewport does not arm a recording',()=>{
  const app=harness();app.emit('pointerdown',{clientX:150});app.advance(500);app.emit('pointerup',{clientX:150});app.emit('click');assert.equal(app.starts.length,0);assert.equal(app.stills,1);app.control.dispose();
});

for(const action of ['pointercancel','lostpointercapture','secondtouch','hidden','pagehide','blur','escape','cancelled'])test(action+' cancels recording and leaves no captured photo-gesture points',()=>{
  const app=harness();app.hold();app.advance(100);
  if(action==='secondtouch'){app.emit('pointerdown',{pointerId:2,isPrimary:false});app.emit('pointerup',{pointerId:2,isPrimary:false})}
  else if(action==='hidden')app.hide();
  else if(action==='pagehide'||action==='blur')app.emit(action,{},app.win);
  else if(action==='escape')assert.equal(app.key({key:'Escape'}).immediate,true);
  else if(action==='cancelled')app.control.cancel();
  else app.emit(action);
  app.emit('pointerup');app.emit('click');app.advance(16000);
  assert.equal(app.control.active,false);assert.equal(app.finishes.length,0);assert.equal(app.cancels.length,1);assert.equal(app.cancels[0].reason,action==='lostpointercapture'?'lostcapture':action);assert.equal(app.starts[0].signal.aborted,true);
  assert.equal(app.stills,0);assert.equal(app.points.size,0);assert.equal(app.timers.size,0);app.control.dispose();
});

test('a second touch before the threshold cancels only the pending hold',()=>{
  const app=harness();app.emit('pointerdown');const second=app.emit('pointerdown',{pointerId:2,isPrimary:false});assert.equal(second.immediate,false);app.advance(500);
  assert.equal(app.starts.length,0);assert.equal(app.cancels.length,0);assert.equal(app.points.size,2);app.emit('pointerup',{pointerId:2,isPrimary:false});app.emit('pointerup');app.emit('click');assert.equal(app.stills,0);assert.equal(app.points.size,0);app.control.dispose();
});

test('Shift Space starts and finishes from the keyboard while Escape cancels',()=>{
  const app=harness();assert.equal(app.key({code:'Space',key:' ',shiftKey:true}).immediate,true);assert.equal(app.control.active,true);assert.equal(app.starts.length,1);
  app.key({code:'Space',key:' ',shiftKey:true,repeat:true});assert.equal(app.finishes.length,0);app.advance(750);app.key({code:'Space',key:' ',shiftKey:true});assert.equal(app.finishes[0].reason,'keyboard');assert.equal(app.finishes[0].elapsedMs,750);assert.equal(app.starts[0].signal.aborted,false);
  app.key({code:'Space',key:' ',shiftKey:true});app.key({key:'Escape'});assert.equal(app.cancels[0].reason,'escape');assert.equal(app.control.active,false);
  assert.equal(app.key({code:'Space',key:' '}).prevented,false);assert.equal(app.key({code:'Space',key:' ',shiftKey:true,target:{closest:()=>true}}).prevented,false);app.control.dispose();
});

test('a rejected start cleans up and never falls back to taking a still',()=>{
  const app=harness({onStart:()=>false});app.hold();app.emit('pointerup');app.emit('click');assert.equal(app.control.active,false);assert.equal(app.cancels[0].reason,'rejected');assert.equal(app.starts[0].signal.aborted,true);assert.equal(app.progress.length,0);assert.equal(app.stills,0);assert.equal(app.timers.size,0);app.control.dispose();
});

for(const callback of ['onStart','onProgress','onFinish'])test(callback+' errors release capture and report cancellation',()=>{
  const failure=new Error(callback),app=harness({[callback]:()=>{throw failure}});app.hold();if(callback==='onFinish')app.emit('pointerup');
  assert.equal(app.control.active,false);assert.equal(app.captured,null);assert.equal(app.points.size,0);assert.equal(app.timers.size,0);assert.equal(app.cancels.length,1);assert.equal(app.cancels[0].error,failure);assert.equal(app.cancels[0].reason,'error');app.control.dispose();
});

test('a throwing cancellation callback cannot leave recording active',()=>{
  const failure=new Error('cancel'),app=harness({onCancel:()=>{throw failure}});app.hold();app.control.cancel();assert.equal(app.control.active,false);assert.equal(app.timers.size,0);assert.equal(app.captured,null);assert.deepEqual(app.errors,[failure]);app.control.dispose();
});

test('an asynchronous start failure cancels its recording',async()=>{
  const failure=new Error('start'),app=harness({onStart:()=>Promise.reject(failure)});app.hold();await Promise.resolve();await Promise.resolve();assert.equal(app.control.active,false);assert.equal(app.cancels[0].error,failure);assert.equal(app.captured,null);app.control.dispose();
});

test('a stale asynchronous failure cannot cancel the next recording',async()=>{
  let reject,attempt=0;const first=new Promise((_,no)=>reject=no),app=harness({onStart:()=>++attempt===1?first:undefined});app.hold();app.emit('pointerup');app.emit('click');app.hold();
  reject(new Error('old start'));await Promise.resolve();await Promise.resolve();assert.equal(app.control.active,true);assert.equal(app.cancels.length,0);app.control.dispose();
});

test('disablement during the arm delay prevents recording and accidental still capture',()=>{
  const app=harness();app.emit('pointerdown');app.setReady(false);app.advance(500);app.setReady(true);app.emit('pointerup');app.emit('click');assert.equal(app.starts.length,0);assert.equal(app.stills,0);app.control.dispose();
});

test('disposal cancels pending or active work and removes all listeners',()=>{
  for(const active of [false,true]){
    const app=harness();app.emit('pointerdown');if(active)app.advance(350);app.control.dispose();app.control.dispose();app.advance(16000);
    assert.equal(app.control.active,false);assert.equal(app.timers.size,0);assert.equal(app.points.size,0);assert.equal(app.cancels.length,active?1:0);assert.equal(app.surface.count+app.doc.count+app.win.count,0);
  }
});

test('the configured duration cannot exceed fifteen seconds',()=>{
  assert.throws(()=>harness({timing:{maxMs:15001}}),/Ugyldig/);assert.throws(()=>harness({timing:{holdMs:-1}}),/Ugyldig/);
});
