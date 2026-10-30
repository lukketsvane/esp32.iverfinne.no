import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await Promise.all(['photo-adjustments','notch-rail','photo-editor','marigold-view'].map(name=>readFile(new URL('../vendor/'+name+'.mjs',import.meta.url),'utf8')))).map(text=>text.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
const photo=new Blob(['jpeg'],{type:'image/jpeg'});
const raw=model=>({depth:Float32Array.of(0,.3,.6,1),width:2,height:2,polarity:'far',model,source:model==='Local model'?'local':'browser',images:new Map()});
const stereoResult=()=>({...raw('Stereo census'),source:'stereo',polarity:'near',depth:Float32Array.of(4,NaN,8,12),validity:Uint8Array.of(1,0,1,1),quantity:'disparity',units:'px',provenance:{rigId:'fixed-rig',matchedFraction:.75,metric:false,hardwareSynchronized:false}});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function harness({endpoint=null,localFails=false,browserFails=false,photoWidth=2,photoHeight=2,stereoRun,localRun,browserRun,reducedMotion=false}={}){
  const calls={cloud:0,local:0,browser:0,stereo:0},urls=[],revoked=[],renders=[],drawSources=[],normalizations=[],statuses=[],frames=new Map(),timers=new Map();let nextFrame=0,nextTimer=0,time=1000,changes=0,gestures=0;
  class Element{
    constructor(){this.children=[];this.events=new Map();this.attributes=new Map();this.dataset={};this.properties=new Map();this.style={setProperty:(name,value)=>this.properties.set(name,value),getPropertyValue:name=>this.properties.get(name)||''};this.clientWidth=390;this.clientHeight=844;const classes=new Set();this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),contains:name=>classes.has(name),toggle:(name,force)=>{const next=force??!classes.has(name);if(next)classes.add(name);else classes.delete(name);return next}};this.naturalWidth=2;this.naturalHeight=2;this.hidden=false;this.width=2;this.height=2;this.complete=true;this.selectors=new Map()}
    querySelector(name){if(!this.selectors.has(name))this.selectors.set(name,new Element());return this.selectors.get(name)}
    addEventListener(name,handler){this.events.set(name,handler)}
    removeEventListener(name){this.events.delete(name)}
    setAttribute(name,value){this.attributes.set(name,value)}
    removeAttribute(name){this.attributes.delete(name)}
    prepend(child){this.children.unshift(child)}
    appendChild(child){this.children.push(child)}
    append(child){this.children.push(child)}
    replaceChildren(){this.children=[]}
    getContext(){return {createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData:image=>{this.pixels=image.data.slice();this.paintCount=(this.paintCount??0)+1},drawImage:source=>{this.drawnSource=source;drawSources.push(source)},getImageData:(_,__,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)})}}
    async decode(){}
    focus(){}
    scrollIntoView(){}
    setPointerCapture(id){this.captured=id}
    hasPointerCapture(id){return this.captured===id}
    releasePointerCapture(){this.captured=null}
    remove(){}
    close(){}
    getBoundingClientRect(){
      if(this.className==='mg-art'){
        const scale=Number(host.style.getPropertyValue('--view-scale')||1),x=parseFloat(host.style.getPropertyValue('--view-x'))||0,y=parseFloat(host.style.getPropertyValue('--view-y'))||0,width=390*.76*scale,height=844*.76*scale;
        return {left:195+x-width/2,top:422+y-height/2,width,height};
      }
      return {left:0,top:0,width:390,height:844};
    }
    showModal(){throw new Error('Unexpected upload dialog')}
  }
  const add=(events,name,handler)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(handler)},remove=(events,name,handler)=>events.get(name)?.delete(handler),emit=(events,name)=>{for(const handler of events.get(name)||[])handler()};
  const host=new Element(),documentEvents=new Map(),windowEvents=new Map(),document={createElement:()=>new Element(),body:new Element(),hidden:false,addEventListener:(name,handler)=>add(documentEvents,name,handler),removeEventListener:(name,handler)=>remove(documentEvents,name,handler)},context=vm.createContext({
    document,Image:Element,Blob,DOMException,AbortController,Uint8Array,Uint8ClampedArray,Uint16Array,Float32Array,matchMedia:()=>({matches:reducedMotion}),Date:{now:()=>time},
    addEventListener:(name,handler)=>add(windowEvents,name,handler),removeEventListener:(name,handler)=>remove(windowEvents,name,handler),
    setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,at:time+delay});return id},clearTimeout:id=>timers.delete(id),
    URL:{createObjectURL:()=>{const url='blob:'+urls.length;urls.push(url);return url},revokeObjectURL:url=>revoked.push(url)},
    requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame},cancelAnimationFrame:id=>frames.delete(id),
    localDepthEndpoint:()=>endpoint,
    runMarigoldV2:async()=>{calls.cloud++;throw new Error('GPU quota exceeded')},
    runStereoDepth:async(...args)=>{calls.stereo++;return stereoRun?stereoRun(...args):stereoResult()},
    runLocalDepth:async(...args)=>{calls.local++;if(localRun)return localRun(...args);if(localFails)throw new Error('Local service unavailable');return raw('Local model')},
    runBrowserDepth:async(...args)=>{calls.browser++;if(browserRun)return browserRun(...args);if(browserFails)throw Object.assign(new Error('Klargjer telefonen.'),{code:'PHONE_SETUP_REQUIRED'});return raw('Browser model')},
    normalizeDepth:(depth,options)=>{normalizations.push({depth,...options});return depth},toneDepth:(_,width,height,options)=>{renders.push(options);return new Uint8ClampedArray((options.outputWidth||width)*(options.outputHeight||height)*4)},decodeSpectral(){throw new Error('Unexpected color map')},print(){throw new Error('Unexpected print')},
    VATHOGRAPHY_PRESETS:[{label:'Band'},{label:'Mist'},{label:'Abyss'},{label:'Near'},{label:'Planes'}]
  });
  const original=host.querySelector('.mg-original');original.naturalWidth=photoWidth;original.naturalHeight=photoHeight;
  vm.runInContext(source,context);return {view:context.createMarigoldView(host,{onStatus:status=>statuses.push(status),onChange:()=>changes++,onGesture:()=>gestures++}),host,calls,renders,drawSources,normalizations,statuses,urls,revoked,timers,frames,get pulse(){return host.children.find(node=>node.className==='mg-pulse')},get changes(){return changes},get gestures(){return gestures},flush(){for(const [id,callback]of [...frames]){frames.delete(id);callback(time)}},advance(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [id,timer]=next;time=timer.at;timers.delete(id);timer.callback()}time=end},blur(){emit(windowEvents,'blur')},hide(){document.hidden=true;emit(documentEvents,'visibilitychange')},emit(name,event){host.events.get(name)?.({type:name,target:{closest:()=>false},preventDefault(){},button:0,pointerId:1,clientX:100,clientY:100,...event})}};
}

test('local raw depth retains provenance without a cloud request',async()=>{
  const app=harness({endpoint:'/api/depth'}),result=await app.view.process(photo);
  assert.deepEqual(app.calls,{cloud:0,local:1,browser:0,stereo:0});assert.equal(app.view.ready,true);
  assert.equal(result.model,'Local model');assert.equal(result.source,'local');assert.equal(result.fallbackReason,undefined);
  assert.equal(app.host.dataset.model,'Local model');assert.equal(app.view.snapshot(true).width,2);
  app.view.resetTone();app.view.select(1);app.view.snapshot(false);assert.deepEqual(app.calls,{cloud:0,local:1,browser:0,stereo:0});app.view.dispose();
});

test('local service failure uses the browser model and retains the failure reason',async()=>{
  const app=harness({endpoint:'/api/depth',localFails:true}),result=await app.view.process(photo);
  assert.deepEqual(app.calls,{cloud:0,local:1,browser:1,stereo:0});assert.equal(result.model,'Browser model');assert.equal(result.source,'browser');assert.equal(result.fallbackReason,'Local service unavailable');app.view.dispose();
});

test('a legacy cloud selection has no upload action or consent dialog',async()=>{
  const app=harness();
  await app.view.process(photo,undefined,{provider:'marigold'});
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:1,stereo:0});assert.equal(app.view.ready,true);
  assert.equal(app.host.children.some(node=>node.className==='mg-quality'),false);app.view.dispose();
});

test('portable processing preserves the setup action when model cache is missing',async()=>{
  const app=harness({browserFails:true});
  await assert.rejects(app.view.process(photo),error=>error.code==='PHONE_SETUP_REQUIRED');
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:1,stereo:0});assert.equal(app.view.ready,false);app.view.dispose();
});

test('VATHOgraphy exposes five expressions and remembers the chosen expression across captures',async()=>{
  const app=harness();await app.view.process(photo);
  const buttons=app.host.querySelector('.mg-variants').children;
  assert.equal(buttons.length,5);
  assert.deepEqual(buttons.map(button=>button.attributes.get('aria-label')),['Band','Mist','Abyss','Near','Planes']);
  app.view.select(4);app.emit('keydown',{key:'ArrowRight'});app.flush();
  assert.equal(app.renders.at(-1).preset,4);assert.equal(app.renders.at(-1).position,.02);
  assert.equal(app.calls.browser,1);
  await app.view.process(photo);
  assert.equal(app.view.selectedName,'Planes');assert.equal(app.renders.at(-1).position,.02);
  assert.equal(app.calls.browser,2);app.view.dispose();
});

test('gestures use a bounded preview but release and export restore full photo resolution',async()=>{
  const app=harness({photoWidth:1600,photoHeight:1200});await app.view.process(photo);
  assert.equal(app.renders.at(-1).outputWidth,1600);
  app.emit('pointerdown');app.emit('pointermove',{clientX:140});app.flush();
  assert.equal(app.renders.at(-1).outputWidth,768);assert.equal(app.renders.at(-1).outputHeight,576);
  assert.equal(app.view.snapshot(true).width,1600);assert.equal(app.renders.at(-1).outputWidth,1600);
  app.emit('pointermove',{clientX:150});app.flush();assert.equal(app.renders.at(-1).outputWidth,768);
  app.emit('pointerup');app.flush();assert.equal(app.renders.at(-1).outputWidth,1600);
  assert.equal(app.calls.browser,1);app.view.dispose();
});

test('a reopened numerical master bypasses inference and restores its rendering recipe',async()=>{
  const app=harness(),result=raw('Saved model'),recipe={preset:3,position:-.2,width:1.4};
  await app.view.restore(photo,result,recipe);
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:0,stereo:0});assert.equal(app.view.result,result);
  assert.deepEqual({...app.view.recipe},recipe);assert.equal(app.renders.at(-1).preset,3);assert.equal(app.renders.at(-1).position,-.2);assert.equal(app.renders.at(-1).width,1.4);
  app.view.select(4);assert.equal(app.view.result,result);assert.deepEqual(result.depth,raw('Saved model').depth);
  app.view.dispose();
});

test('invalid saved expression is rejected before the current view is discarded',async()=>{
  const app=harness();await app.view.process(photo);const current=app.view.result;
  await assert.rejects(app.view.restore(photo,raw('Saved model'),{preset:40,position:0,width:1}),/Ugyldig/);
  assert.equal(app.view.result,current);assert.equal(app.view.ready,true);app.view.dispose();
});

test('a paired photograph uses stereo first and forwards its validity through normalization and tone rendering',async()=>{
  const right=new Blob(['right'],{type:'image/jpeg'}),result=stereoResult();let received;
  const app=harness({endpoint:'/api/depth',stereoRun:(...args)=>{received=args;return result}});
  assert.equal(await app.view.process(photo,undefined,{right}),result);
  assert.equal(received[0],photo);assert.equal(received[1],right);assert.equal(received[2].signal.aborted,false);
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:0,stereo:1});assert.equal(app.host.dataset.source,'stereo');
  assert.equal(app.normalizations[0].validity,result.validity);assert.equal(app.renders.at(-1).validity,result.validity);
  assert.equal(app.normalizations[0].polarity,'near');assert.equal(result.stereoFallbackReason,undefined);
  app.view.dispose();
});

test('rejected stereo keeps estimated source provenance through local and browser fallbacks',async()=>{
  for(const localFails of [false,true]){
    const app=harness({endpoint:'/api/depth',localFails,stereoRun:()=>{throw new Error('No reliable stereo')}});
    const result=await app.view.process(photo,undefined,{right:photo});
    assert.equal(result.source,localFails?'browser':'local');assert.equal(app.host.dataset.source,result.source);
    assert.equal(result.stereoFallbackReason,'No reliable stereo');assert.deepEqual({...result.provenance.stereo},{accepted:false,reason:'No reliable stereo'});
    assert.deepEqual(app.calls,{cloud:0,local:1,browser:localFails?1:0,stereo:1});
    assert.equal(app.statuses.filter(status=>status.phase==='fallback').length,localFails?2:1);
    assert.equal(app.renders.at(-1).validity,undefined);app.view.dispose();
  }
});

test('aborting stereo does not start an estimated fallback or create a ready result',async()=>{
  const task=deferred(),controller=new AbortController(),app=harness({stereoRun:()=>task.promise});
  const pending=app.view.process(photo,controller.signal,{right:photo}),rejected=assert.rejects(pending,{name:'AbortError'});
  controller.abort();task.resolve(stereoResult());await rejected;
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:0,stereo:1});assert.equal(app.view.ready,false);assert.equal(app.urls.length,0);app.view.dispose();
});

test('a superseded stereo failure cannot start a fallback or overwrite the next photograph',async()=>{
  const task=deferred(),app=harness({stereoRun:()=>task.promise});
  const pending=app.view.process(photo,undefined,{right:photo}),rejected=assert.rejects(pending,/Old stereo failure/);
  const next=await app.view.process(photo);task.reject(new Error('Old stereo failure'));await rejected;
  assert.equal(app.view.result,next);assert.deepEqual(app.calls,{cloud:0,local:0,browser:1,stereo:1});assert.equal(app.host.dataset.source,'browser');
  assert.equal(app.statuses.filter(status=>status.phase==='ready').length,1);app.view.dispose();
});

test('a superseded estimated fallback cannot replace a newer accepted stereo result',async()=>{
  const fallback=deferred(),started=deferred();let attempts=0;
  const app=harness({stereoRun:()=>{if(++attempts===1)throw new Error('First pair rejected');return stereoResult()},browserRun:()=>{started.resolve();return fallback.promise}});
  const pending=app.view.process(photo,undefined,{right:photo}),rejected=assert.rejects(pending,{name:'AbortError'});
  await started.promise;const current=await app.view.process(photo,undefined,{right:photo});fallback.resolve(raw('Stale browser'));await rejected;
  assert.equal(app.view.result,current);assert.equal(app.host.dataset.source,'stereo');assert.equal(app.statuses.filter(status=>status.phase==='ready').length,1);app.view.dispose();
});

test('restoring a numerical stereo master preserves its mask and recipe without another match',async()=>{
  const app=harness(),result=stereoResult(),recipe={preset:3,position:.2,width:1.4};
  await app.view.restore(photo,result,recipe);
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:0,stereo:0});assert.equal(app.view.result,result);
  assert.equal(app.renders.at(-1).validity,result.validity);assert.deepEqual({...app.view.recipe},recipe);app.view.dispose();
});

test('holding reveals the original only after 450ms and release restores art without saving or printing',async()=>{
  const app=harness();await app.view.process(photo);const before=app.changes,recipe={...app.view.recipe};
  app.emit('pointerdown');app.advance(449);assert.equal(app.host.classList.contains('peeking'),false);
  app.advance(1);assert.equal(app.host.classList.contains('peeking'),true);assert.equal(app.changes,before);assert.equal(app.gestures,1);
  app.emit('pointerup');app.flush();assert.equal(app.host.classList.contains('peeking'),false);assert.equal(app.changes,before);
  assert.deepEqual({...app.view.recipe},recipe);assert.equal(app.host.hidden,false);assert.equal(app.view.ready,true);assert.equal(app.calls.browser,1);app.view.dispose();
});

test('pointer cancellation and lost capture restore a peek without editing the recipe',async()=>{
  for(const event of ['pointercancel','lostpointercapture']){
    const app=harness();await app.view.process(photo);const before=app.changes;
    app.emit('pointerdown');app.advance(450);assert.equal(app.host.classList.contains('peeking'),true);
    app.emit(event);app.flush();assert.equal(app.host.classList.contains('peeking'),false);assert.equal(app.changes,before);assert.equal(app.timers.size,0);app.view.dispose();
  }
});

test('eight pixels of motion cancels holding while smaller touch jitter still allows a peek',async()=>{
  const app=harness();await app.view.process(photo);const before=app.changes;
  app.emit('pointerdown');app.emit('pointermove',{clientX:108});app.advance(500);assert.equal(app.host.classList.contains('peeking'),false);
  app.emit('pointerup');assert.equal(app.changes,before+1);assert.ok(app.view.recipe.position>0);
  app.emit('pointerdown');app.emit('pointermove',{clientX:107});app.advance(450);assert.equal(app.host.classList.contains('peeking'),true);
  app.emit('pointerup');assert.equal(app.changes,before+1);app.view.dispose();
});

test('three fingers adjust tone width and save once after the last finger releases',async()=>{
  const app=harness();await app.view.process(photo);const before=app.changes;
  app.emit('pointerdown',{pointerId:1,clientX:100});app.advance(200);app.emit('pointerdown',{pointerId:2,clientX:200});app.emit('pointerdown',{pointerId:3,clientX:150});app.advance(500);
  assert.equal(app.host.classList.contains('peeking'),false);assert.equal(app.timers.size,0);
  app.emit('pointermove',{pointerId:1,clientX:75});app.emit('pointermove',{pointerId:2,clientX:225});app.flush();assert.ok(Math.abs(app.view.recipe.width-1.5)<1e-9);
  app.emit('pointerup',{pointerId:3});app.emit('pointerup',{pointerId:2});assert.equal(app.changes,before);
  app.emit('pointerup',{pointerId:1});assert.equal(app.changes,before+1);
  await app.view.process(photo);assert.ok(Math.abs(app.view.recipe.width-1.5)<1e-9);app.view.dispose();
});
test('cancelling a changed three-finger width gesture saves exactly once',async()=>{
  const app=harness();await app.view.process(photo);const before=app.changes;
  app.emit('pointerdown',{pointerId:1,clientX:100});app.emit('pointerdown',{pointerId:2,clientX:200});app.emit('pointerdown',{pointerId:3,clientX:150});app.emit('pointermove',{pointerId:1,clientX:75});app.emit('pointermove',{pointerId:2,clientX:225});
  app.emit('pointercancel',{pointerId:3});assert.equal(app.changes,before+1);assert.ok(Math.abs(app.view.recipe.width-1.5)<1e-9);
  app.emit('pointercancel',{pointerId:2});app.emit('pointercancel',{pointerId:1});assert.equal(app.changes,before+1);app.view.dispose();
});
test('the last pointer restores native rendering after a partly cancelled width gesture',async()=>{
  for(const [first,last]of [['pointercancel','pointerup'],['lostpointercapture','pointerup'],['pointercancel','pointercancel']]){
    const app=harness({photoWidth:1600,photoHeight:1200});await app.view.process(photo);const before=app.changes;
    app.emit('pointerdown',{pointerId:1,clientX:100});app.emit('pointerdown',{pointerId:2,clientX:200});app.emit('pointerdown',{pointerId:3,clientX:150});app.emit('pointermove',{pointerId:1,clientX:75});app.emit('pointermove',{pointerId:2,clientX:225});app.flush();
    app.emit(first,{pointerId:3});app.emit('pointerup',{pointerId:2});app.flush();assert.equal(app.renders.at(-1).outputWidth,768);assert.equal(app.changes,before+1);
    app.emit(last,{pointerId:1});app.flush();assert.equal(app.renders.at(-1).outputWidth,1600);assert.equal(app.renders.at(-1).outputHeight,1200);
    assert.equal(app.changes,before+1);assert.ok(Math.abs(app.view.recipe.width-1.5)<1e-9);assert.equal(app.pulse.hidden,true);app.view.dispose();
  }
});
test('double tap resets tone while keeping the expression and processed view open',async()=>{
  const app=harness();await app.view.process(photo);app.view.select(4);app.emit('keydown',{key:'ArrowRight'});app.emit('keydown',{key:'ArrowUp'});app.flush();
  assert.notEqual(app.view.recipe.position,0);assert.notEqual(app.view.recipe.width,1);const before=app.changes;
  app.emit('pointerdown');app.advance(50);app.emit('pointerup');assert.equal(app.changes,before);
  app.advance(150);app.emit('pointerdown');app.advance(50);app.emit('pointerup');app.flush();
  assert.deepEqual({...app.view.recipe},{preset:4,position:0,width:1});assert.equal(app.changes,before+1);
  assert.equal(app.view.ready,true);assert.equal(app.host.hidden,false);assert.equal(app.calls.browser,1);app.view.dispose();
});

test('blur, hidden documents, reset and disposal clear active or pending peeks',async()=>{
  for(const action of ['blur','hide','reset','dispose']){
    const app=harness();await app.view.process(photo);const before=app.changes;
    app.emit('pointerdown');app.advance(450);assert.equal(app.host.classList.contains('peeking'),true);
    if(action==='blur'||action==='hide')app[action]();else app.view[action]();
    assert.equal(app.host.classList.contains('peeking'),false);assert.equal(app.changes,before);assert.equal(app.timers.size,0);
    app.advance(500);assert.equal(app.host.classList.contains('peeking'),false);if(action!=='dispose')app.view.dispose();
  }
});

test('app switching commits an interrupted edit and restores the native resolution',async()=>{
  for(const action of ['blur','hide']){
    const app=harness({photoWidth:1600,photoHeight:1200});await app.view.process(photo);const before=app.changes;
    app.emit('pointerdown');app.emit('pointermove',{clientX:140});app.flush();assert.equal(app.renders.at(-1).outputWidth,768);
    const recipe={...app.view.recipe};app[action]();app.flush();
    assert.equal(app.changes,before+1);assert.equal(app.renders.at(-1).outputWidth,1600);assert.deepEqual({...app.view.recipe},recipe);
    app[action]();assert.equal(app.changes,before+1);app.view.dispose();
  }
});

test('result pulse begins fully black and reveals depth once without changing the recipe, source values or export canvas',async()=>{
  const app=harness(),result=await app.view.process(photo),values=[...result.depth],recipe={...app.view.recipe},changes=app.changes;
  assert.equal(app.pulse.hidden,false);assert.ok(app.pulse.pixels.every((value,index)=>value===(index%4===3?255:0)));app.flush();assert.ok(app.pulse.pixels.every((value,index)=>value===(index%4===3?255:0)));app.advance(700);app.flush();
  assert.equal(app.pulse.hidden,false);assert.equal(app.pulse.pixels[3],0);assert.equal(app.pulse.pixels[15],255);assert.ok(app.pulse.pixels.some((value,index)=>index%4===3&&value>0&&value<255));
  const snapshot=app.view.snapshot(true);assert.equal(snapshot.width,2);assert.equal(app.drawSources.at(-1).className,'mg-art');assert.deepEqual([...result.depth],values);assert.deepEqual({...app.view.recipe},recipe);assert.equal(app.changes,changes);
  app.advance(700);app.flush();assert.equal(app.pulse.hidden,true);assert.equal(app.frames.size,0);assert.equal(app.host.hidden,false);assert.equal(app.view.ready,true);app.advance(2000);app.flush();assert.equal(app.pulse.hidden,true);app.view.dispose();
});

test('pulse respects reduced motion and stops on interaction, backgrounding, reset and disposal',async()=>{
  const quiet=harness({reducedMotion:true});await quiet.view.process(photo);quiet.flush();assert.equal(quiet.pulse.hidden,true);assert.equal(quiet.frames.size,0);quiet.view.dispose();
  for(const action of ['pointerdown','keydown','select','blur','hide','reset','dispose']){
    const app=harness();await app.view.process(photo);app.flush();app.advance(700);app.flush();assert.equal(app.pulse.hidden,false);
    if(action==='pointerdown'||action==='keydown')app.emit(action,{key:'ArrowRight'});else if(action==='select')app.view.select(2);else if(action==='blur'||action==='hide')app[action]();else app.view[action]();
    assert.equal(app.pulse.hidden,true,action);app.flush();assert.equal(app.pulse.hidden,true,action);if(action!=='dispose')app.view.dispose();assert.equal(app.frames.size,0);
  }
});

test('pulse never illuminates invalid stereo samples and caps presentation work at 512 pixels and 24fps',async()=>{
  const app=harness({photoWidth:1600,photoHeight:1200});await app.view.process(photo,undefined,{right:photo});assert.equal(app.pulse.width,512);assert.equal(app.pulse.height,384);
  app.flush();const paints=app.pulse.paintCount;app.advance(20);app.flush();assert.equal(app.pulse.paintCount,paints);app.advance(680);app.flush();
  for(let y=0;y<app.pulse.height/2;y++)for(let x=app.pulse.width/2;x<app.pulse.width;x++){const pixel=(y*app.pulse.width+x)*4;assert.deepEqual([...app.pulse.pixels.slice(pixel,pixel+4)],[0,0,0,255])}
  assert.equal(app.renders.at(-1).outputWidth,1600);assert.equal(app.view.snapshot(true).width,1600);app.view.dispose();
});

test('restored documents pulse once and replacing a result cancels its old pulse immediately',async()=>{
  const pending=deferred(),app=harness({browserRun:()=>pending.promise}),result=raw('Saved model'),recipe={preset:3,position:.2,width:1.4};
  await app.view.restore(photo,result,recipe);app.flush();app.advance(600);app.flush();assert.equal(app.pulse.hidden,false);assert.equal(app.calls.browser,0);
  const replacing=app.view.process(photo);assert.equal(app.pulse.hidden,true);assert.equal(app.frames.size,0);pending.resolve(raw('Browser model'));await replacing;assert.equal(app.frames.size,1);app.view.dispose();assert.equal(app.frames.size,0);
});

const findNode=(parent,className)=>parent.className?.split(' ').includes(className)?parent:parent.children.map(child=>findNode(child,className)).find(Boolean);
const editorEvent=(node,name='click')=>node.events.get(name)?.({target:node,preventDefault(){},stopPropagation(){}});

test('photo adjustments preview without changing the saved recipe until accepted',async()=>{
  const app=harness({photoWidth:320,photoHeight:240});await app.view.process(photo);const before=app.changes;
  const editor=findNode(app.host,'mg-editor'),rail=findNode(editor,'mg-edit-rail'),range=findNode(editor,'mg-edit-range');
  editorEvent(rail.children[0]);range.value='1.25';editorEvent(range,'input');app.flush();
  assert.equal(app.view.recipe.edits,undefined);assert.equal(app.changes,before);assert.equal(app.view.snapshot(true).width,320);
  editorEvent(findNode(editor,'mg-edit-apply'));app.flush();assert.equal(app.view.recipe.edits.exposure,1.25);assert.equal(app.changes,before+1);
  editorEvent(rail.children[0]);range.value='-1';editorEvent(range,'input');app.flush();editorEvent(findNode(editor,'mg-edit-cancel'));app.flush();
  assert.equal(app.view.recipe.edits.exposure,1.25);assert.equal(app.changes,before+1);
  await app.view.process(photo);assert.equal(app.view.recipe.edits,undefined);app.view.dispose();
});

test('crop acceptance updates native snapshots and keeps original comparison aligned',async()=>{
  const app=harness({photoWidth:320,photoHeight:240});await app.view.process(photo);
  const editor=findNode(app.host,'mg-editor'),rail=findNode(editor,'mg-edit-rail'),options=findNode(editor,'mg-crop-options');
  editorEvent(rail.children[3]);editorEvent(options.children.find(node=>node.dataset.ratio==='1:1'));app.flush();
  assert.equal(app.view.recipe.edits,undefined);assert.equal(app.view.snapshot(true).width,320);
  editorEvent(findNode(editor,'mg-edit-apply'));app.flush();const snapshot=app.view.snapshot(true),cropped=findNode(app.host,'mg-original-crop');
  assert.equal(snapshot.width,240);assert.equal(snapshot.height,240);assert.equal(cropped.width,240);assert.equal(cropped.height,240);assert.equal(cropped.hidden,false);
  assert.equal(app.view.recipe.edits.crop.x,.125);assert.equal(app.view.recipe.edits.crop.width,.75);
  const recipe=JSON.parse(JSON.stringify(app.view.recipe));await app.view.restore(photo,raw('Saved model'),recipe);assert.deepEqual(JSON.parse(JSON.stringify(app.view.recipe)),recipe);assert.equal(app.view.snapshot(true).width,240);app.view.dispose();
});

test('invalid archived photo edits are rejected before replacing the current photograph',async()=>{
  const app=harness();await app.view.process(photo);const current=app.view.result;
  for(const edits of [{preset:'missing'},{exposure:NaN},{crop:{x:.8,width:.5}}])await assert.rejects(app.view.restore(photo,raw('Saved model'),{preset:1,position:0,width:1,edits}));
  assert.equal(app.view.result,current);assert.equal(app.view.ready,true);app.view.dispose();
});

test('photo sliders bound moving previews and restore native detail on release',async()=>{
  const app=harness({photoWidth:1600,photoHeight:1200});await app.view.process(photo);
  const editor=findNode(app.host,'mg-editor'),rail=findNode(editor,'mg-edit-rail'),range=findNode(editor,'mg-edit-range');
  editorEvent(rail.children[0]);range.value='.5';editorEvent(range,'input');app.flush();
  assert.equal(app.renders.at(-1).outputWidth,512);assert.equal(app.renders.at(-1).outputHeight,384);
  editorEvent(range,'change');app.flush();assert.equal(app.renders.at(-1).outputWidth,1600);assert.equal(app.renders.at(-1).outputHeight,1200);
  editorEvent(findNode(editor,'mg-edit-apply'));app.flush();assert.equal(app.view.snapshot(true).width,1600);assert.equal(app.view.recipe.edits.exposure,.5);app.view.dispose();
});

const positionRail=rail=>rail.children.forEach((button,index)=>{button.getBoundingClientRect=()=>({left:0,top:100*index,width:44,height:44})});
const railPointer=(rail,name,values={})=>rail.events.get(name)?.({type:name,target:rail,pointerId:17,button:0,clientX:20,clientY:22,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...values});

test('left notch scrubbing previews continuously and saves only the final choice',async()=>{
  const app=harness({photoWidth:1600,photoHeight:1200});await app.view.process(photo);const before=app.changes,rail=app.host.querySelector('.mg-variants');positionRail(rail);
  railPointer(rail,'pointerdown',{clientY:75});assert.equal(rail.captured,17);app.advance(500);assert.equal(app.host.classList.contains('peeking'),false);
  railPointer(rail,'pointermove',{clientY:222});app.flush();assert.equal(app.view.selectedName,'Abyss');assert.equal(app.renders.at(-1).outputWidth,512);
  railPointer(rail,'pointermove',{clientX:300,clientY:422});app.flush();assert.equal(app.view.selectedName,'Planes');assert.equal(app.changes,before);assert.equal(app.view.recipe.preset,1);
  assert.equal(app.view.snapshot(true).width,1600);assert.equal(app.renders.at(-1).preset,1);app.flush();assert.equal(app.renders.at(-1).preset,4);
  railPointer(rail,'pointerup',{clientX:300,clientY:422});app.flush();assert.equal(rail.captured,null);assert.equal(app.changes,before+1);assert.equal(app.view.recipe.preset,4);assert.equal(app.renders.at(-1).outputWidth,1600);
  assert.equal(app.view.recipe.position,0);assert.equal(app.view.recipe.width,1);assert.equal(app.timers.size,0);app.view.dispose();
});

test('left rail cancellation and app switching release capture without double saving',async()=>{
  for(const action of ['pointercancel','lostpointercapture','blur','hide','reset','dispose']){
    const app=harness();await app.view.process(photo);const before=app.changes,rail=app.host.querySelector('.mg-variants');positionRail(rail);
    railPointer(rail,'pointerdown');railPointer(rail,'pointermove',{clientY:222});
    if(action==='blur'||action==='hide')app[action]();else if(action==='reset'||action==='dispose')app.view[action]();else railPointer(rail,action);
    assert.equal(rail.captured,null,action);assert.equal(app.changes,before+(action==='reset'||action==='dispose'?0:1),action);
    railPointer(rail,'lostpointercapture');railPointer(rail,'pointermove',{clientY:422});assert.equal(app.view.selectedName,'Abyss');assert.equal(app.view.recipe.position,0);
    if(action!=='dispose')app.view.dispose();assert.equal(app.frames.size,0);
  }
});

test('right rail scrubbing opens each nearest tool once and leaves depth gestures untouched',async()=>{
  const app=harness();await app.view.process(photo);const before=app.changes,editor=findNode(app.host,'mg-editor'),rail=findNode(editor,'mg-edit-rail'),panel=findNode(editor,'mg-edit-panel');positionRail(rail);
  railPointer(rail,'pointerdown',{clientY:70});railPointer(rail,'pointermove',{clientY:122});assert.equal(panel.hidden,false);assert.equal(rail.children[1].attributes.get('aria-pressed'),'true');
  railPointer(rail,'pointermove',{clientX:200,clientY:130});assert.equal(panel.hidden,false);assert.equal(rail.children[1].attributes.get('aria-pressed'),'true');
  railPointer(rail,'pointermove',{clientX:200,clientY:322});assert.equal(rail.children[3].attributes.get('aria-pressed'),'true');railPointer(rail,'pointercancel');app.flush();
  assert.equal(rail.captured,null);assert.equal(app.changes,before);assert.equal(app.view.recipe.position,0);assert.equal(app.view.recipe.width,1);assert.equal(app.host.classList.contains('peeking'),false);assert.equal(app.timers.size,0);
  railPointer(rail,'pointerdown',{clientY:322});railPointer(rail,'pointerup',{clientY:322});assert.equal(panel.hidden,true);app.view.dispose();
});

const navigationPose=app=>({scale:Number(app.host.style.getPropertyValue('--view-scale')||1),x:parseFloat(app.host.style.getPropertyValue('--view-x'))||0,y:parseFloat(app.host.style.getPropertyValue('--view-y'))||0});
const beginPair=(app,left=145,right=245,y=422)=>{app.emit('pointerdown',{pointerId:31,clientX:left,clientY:y});app.emit('pointerdown',{pointerId:32,clientX:right,clientY:y})};
const movePair=(app,left,right,y)=>{app.emit('pointermove',{pointerId:31,clientX:left,clientY:y});app.emit('pointermove',{pointerId:32,clientX:right,clientY:y})};
const endPair=app=>{app.emit('pointerup',{pointerId:31});app.emit('pointerup',{pointerId:32});app.flush()};

test('two fingers pan in all four directions at fit without changing tone or image data',async()=>{
  const app=harness({photoWidth:320,photoHeight:240});await app.view.process(photo);const recipe=JSON.stringify(app.view.recipe),before=app.changes;
  for(const [dx,dy]of [[20,0],[-20,0],[0,20],[0,-20]]){
    app.view.resetView();beginPair(app);movePair(app,145+dx,245+dx,422+dy);endPair(app);
    const pose=navigationPose(app);assert.ok(Math.abs(pose.scale-1)<1e-9);assert.ok(Math.abs(pose.x-dx)<1e-9);assert.ok(Math.abs(pose.y-dy)<1e-9);assert.equal(JSON.stringify(app.view.recipe),recipe);assert.equal(app.changes,before);
  }
  assert.equal(app.calls.browser,1);app.view.dispose();
});
test('pinch is anchored and bounded from one to eight while native export stays unchanged',async()=>{
  const app=harness({photoWidth:320,photoHeight:240});await app.view.process(photo);const recipe=JSON.stringify(app.view.recipe),before=app.changes;
  beginPair(app,185,205);movePair(app,-805,1195,422);endPair(app);
  assert.equal(navigationPose(app).scale,8);assert.ok(Math.abs(navigationPose(app).x)<1e-9);assert.ok(Math.abs(navigationPose(app).y)<1e-9);
  const saved=app.view.snapshot(true);assert.equal(saved.width,320);assert.equal(saved.height,240);assert.equal(navigationPose(app).scale,8);
  beginPair(app,-805,1195);movePair(app,194,196,422);endPair(app);assert.equal(navigationPose(app).scale,1);
  beginPair(app);movePair(app,5145,5245,5422);endPair(app);const limited=navigationPose(app);assert.ok(limited.x>0&&limited.x<=46.8+1e-8);assert.ok(limited.y>0&&limited.y<422);
  assert.equal(JSON.stringify(app.view.recipe),recipe);assert.equal(app.changes,before);assert.equal(app.calls.browser,1);app.view.dispose();
});
test('comparison seam follows the contained image after zoom and pan',async()=>{
  const app=harness({photoWidth:320,photoHeight:240});await app.view.process(photo);const before=app.changes,recipe=JSON.stringify(app.view.recipe);
  app.host.querySelector('.mg-compare').events.get('click')();assert.equal(app.host.classList.contains('comparing'),true);
  beginPair(app);movePair(app,115,315,392);endPair(app);
  const pose=navigationPose(app);assert.ok(Math.abs(pose.scale-2)<1e-9);assert.ok(Math.abs(pose.x-20)<1e-9);assert.ok(Math.abs(pose.y+30)<1e-9);
  const width=390*.76*2,height=width*240/320,left=215-width/2,top=392-height/2;
  assert.ok(Math.abs(parseFloat(app.host.style.getPropertyValue('--split-left'))-215)<1e-8);
  assert.ok(Math.abs(parseFloat(app.host.style.getPropertyValue('--split-top'))-top)<1e-8);
  assert.ok(Math.abs(parseFloat(app.host.style.getPropertyValue('--split-height'))-height)<1e-8);
  app.emit('pointerdown',{pointerId:5,clientX:left+width*.25,clientY:392});app.emit('pointerup',{pointerId:5});
  assert.ok(Math.abs(parseFloat(app.host.style.getPropertyValue('--split-left'))-(left+width*.25))<1e-8);
  app.host.querySelector('.mg-seam').events.get('keydown')({key:'ArrowRight',preventDefault(){}});
  assert.ok(Math.abs(parseFloat(app.host.style.getPropertyValue('--split-left'))-(left+width*.30))<1e-8);
  assert.equal(app.host.classList.contains('comparing'),true);assert.equal(JSON.stringify(app.view.recipe),recipe);assert.equal(app.changes,before);app.view.dispose();
});
test('a double two-finger tap recentres the view without resetting tone',async()=>{
  const app=harness({photoWidth:320,photoHeight:240});await app.view.process(photo);app.emit('keydown',{key:'ArrowRight'});app.emit('keydown',{key:'ArrowUp'});app.flush();const recipe=JSON.stringify(app.view.recipe),before=app.changes;
  beginPair(app);movePair(app,115,315,392);endPair(app);assert.equal(navigationPose(app).scale,2);
  beginPair(app);app.advance(30);endPair(app);app.advance(100);beginPair(app);app.advance(30);endPair(app);
  assert.deepEqual(navigationPose(app),{scale:1,x:0,y:0});assert.equal(JSON.stringify(app.view.recipe),recipe);assert.equal(app.changes,before);assert.equal(app.host.classList.contains('peeking'),false);assert.equal(app.timers.size,0);app.view.dispose();
});
test('navigation survives expression changes but reopening starts at fit and controls ignore pinches',async()=>{
  const app=harness({photoWidth:320,photoHeight:240});await app.view.process(photo);beginPair(app);movePair(app,115,315,392);endPair(app);const pose=navigationPose(app);
  app.view.select(4);app.view.snapshot(true);assert.deepEqual(navigationPose(app),pose);
  const before=app.changes;app.emit('pointerdown',{pointerId:41,target:{closest:()=>true}});app.emit('pointerdown',{pointerId:42,target:{closest:()=>true}});app.emit('pointermove',{pointerId:41,clientX:50});app.emit('pointermove',{pointerId:42,clientX:350});app.emit('pointerup',{pointerId:41});app.emit('pointerup',{pointerId:42});
  assert.deepEqual(navigationPose(app),pose);assert.equal(app.changes,before);assert.equal(app.timers.size,0);
  const recipe=JSON.parse(JSON.stringify(app.view.recipe));await app.view.restore(photo,raw('Saved model'),recipe);assert.deepEqual(navigationPose(app),{scale:1,x:0,y:0});assert.deepEqual(JSON.parse(JSON.stringify(app.view.recipe)),recipe);app.view.dispose();
});
