import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const application=(await readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const photoModule=await readFile(new URL('../vendor/photo.mjs',import.meta.url),'utf8'),photoSource=photoModule.slice(photoModule.indexOf('export function photoSnapshot')).replace(/^export /gm,'');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

function harness(options={}){
  let now=1000,nextTimer=0,nextUrl=0,mediaRequests=0,stopped=0;
  const elements=new Map(),events=new Map(),timers=new Map(),urls=new Map(),saves=[],encodedSnapshots=[],sceneCalls=[],messages=[],studioBindings=[],printCalls=[],revoked=[],photoViews=[];
  const snapshot={width:384,height:1,data:new Uint8ClampedArray(384*4)},nativeSnapshot={width:640,height:960,data:new Uint8ClampedArray(640*960*4)};let printDisposed=false;
  const studioControls={image:options.image??0,primitive:0,photo:1,dispose(){}},finders=[];
  const photoGestureState={scale:1,x:0,y:0,width:390,height:844,grain:1,contrast:1},liveGestureState={...photoGestureState};let photoGestureBinding,liveGestureBinding;
  const opener={postMessage:(data,origin)=>messages.push({data,origin})};
  class Element{
    constructor(id='',tagName='DIV'){
      this.id=id;this.tagName=tagName;this.hidden=false;this.disabled=false;this.textContent='';this.style={};this.children=[];this.attributes=new Map();this.listeners=new Map();this.classes=new Set();
      this.classList={add:value=>this.classes.add(value),remove:value=>this.classes.delete(value),contains:value=>this.classes.has(value),toggle:(value,active)=>{if(active??!this.classes.has(value))this.classes.add(value);else this.classes.delete(value)}};
    }
    addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback)}
    setAttribute(name,value){this.attributes.set(name,String(value))}
    getAttribute(name){return this.attributes.get(name)??null}
    removeAttribute(name){this.attributes.delete(name);if(name==='src')this.src=''}
    closest(selector){return selector.split(',').some(tag=>tag.trim().toUpperCase()===this.tagName)?this:null}
    replaceChildren(...children){this.children=children}
    appendChild(child){this.children.push(child);return child}
    async emit(name,details={}){for(const callback of this.listeners.get(name)??[])callback({type:name,target:this,currentTarget:this,isPrimary:true,pointerId:1,clientX:100,clientY:100,preventDefault(){},...details});await flush()}
    click(){void this.emit('click')}
    async decode(){if(options.decode)await options.decode()}
  }
  for(const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    const element=new Element(match[2],match[1].toUpperCase());element.hidden=/\bhidden\b/.test(match[0]);
    if(element.tagName==='IMG'){element.naturalWidth=16;element.naturalHeight=12}
    element.className=match[0].match(/\bclass="([^"]+)"/)?.[1]??'';
    for(const name of match[0].match(/\bclass="([^"]+)"/)?.[1].split(/\s+/)??[])element.classes.add(name);
    elements.set(element.id,element);
  }
  elements.get('progress').firstElementChild=new Element('','I');
  Object.assign(elements.get('video'),{videoWidth:640,videoHeight:480,play:async()=>{if(options.play)await options.play(elements.get('video').srcObject)},pause(){}});
  const document={hidden:options.hidden??false,referrer:options.referrer??'http://192.168.4.1/',getElementById:id=>elements.get(id),addEventListener(name,callback){if(!events.has(name))events.set(name,[]);events.get(name).push(callback)},createElement(tag){
    const element=new Element('',tag.toUpperCase());
    if(tag==='canvas'){element.getContext=()=>({drawImage(){},getImageData:(x,y,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)})});element.toBlob=(callback,type)=>options.toBlob?options.toBlob(callback,type):callback(new Blob(['camera-jpeg'],{type}))}
    return element;
  }};
  const media={getTracks:()=>[{stop(){stopped++}}]};
  class BrowserURL extends URL{static createObjectURL(blob){const url='blob:test/'+(++nextUrl);urls.set(url,blob);return url}static revokeObjectURL(url){revoked.push(url)}}
  const context=vm.createContext({
    document,window:{opener,addEventListener:document.addEventListener},URL:BrowserURL,Blob,AbortController,DOMException,
    File:class extends Blob{constructor(parts,name,properties){super(parts,properties);this.name=name}},
    Image:class{naturalWidth=1600;naturalHeight=1200;async decode(){if(options.decode)await options.decode()}},
    navigator:{standalone:options.standalone,mediaDevices:{getUserMedia:async()=>{mediaRequests++;return options.media?await options.media(media):media}}},matchMedia:()=>({matches:!!options.displayStandalone}),
    Viewfinder:class{constructor(){this.tone={grain:1,contrast:1};this.captures=[];finders.push(this)}capture(source){const canvas=document.createElement('canvas');canvas.width=320;canvas.height=480;this.captures.push({source,canvas});return canvas}setStyle(level){this.style=level}setTone(pose){this.tone={grain:pose.grain,contrast:pose.contrast}}clear(){}dispose(){}},
    attachStudioControls:(hosts,onChange,enabled,onGesture)=>{studioBindings.push({hosts,onChange,enabled,onGesture});return studioControls},
    attachPhotoGestures:(image,binding)=>{const state=binding.toneOnly?liveGestureState:photoGestureState;if(binding.toneOnly)liveGestureBinding=binding;else photoGestureBinding=binding;return {state,reset(){Object.assign(state,{scale:1,x:0,y:0});binding.onChange(state)},refresh(){binding.onChange(state)},dispose(){}}},
    createPhotoView:image=>{const viewer={image,source:null,sources:[],style:0,tone:{grain:1,contrast:1},shown:false,shows:[],refreshes:0,snapshots:[],disposed:false,setSource(source=image){this.source=source;this.sources.push(source)},setStyle(level){this.style=level},setTone(pose){for(const key of ['grain','contrast'])if(pose[key]!==undefined)this.tone[key]=pose[key]},show(visible){this.shown=Boolean(visible);this.shows.push(this.shown)},refresh(){this.refreshes++},snapshot(pose,native=false){const result={...context.photoSnapshot(image,pose,native),style:this.style,tone:{...this.tone}};this.snapshots.push({pose:{...pose},native,result});return result},dispose(){this.disposed=true}};photoViews.push(viewer);return viewer},
    snapshotBlob:image=>{encodedSnapshots.push(image);return new Blob(['rendered-png'],{type:'image/png'})},savePhoto:(blob,name,isCurrent)=>{saves.push({blob,name,isCurrent});return Promise.resolve()},
    PX10Printer:class{},cloudPrintJob:()=>new Uint8Array(),
    createPrintClient:()=>({print:(image,isCurrent)=>{printCalls.push({image,isCurrent});return Promise.resolve(true)},dispose(){printDisposed=true}}),
    createDepthScene:async(host,blob,progress,signal,quality)=>{sceneCalls.push({host,blob,progress,signal,quality});return options.scene?{setPrimitiveLevel(){},snapshot:native=>native?nativeSnapshot:snapshot,...await options.scene(host,blob,progress,signal,quality)}:{dispose(){},setPrimitiveLevel(){},snapshot:native=>native?nativeSnapshot:snapshot}},
    performance:{now:()=>now},Date:class extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}},
    setTimeout:(callback,delay=0)=>{const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(photoSource+'\n'+application,context,{filename:'app.mjs'});
  async function tick(duration){now+=duration;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}await flush()}
  async function emit(name,details={}){for(const callback of events.get(name)??[])callback({type:name,...details});await flush()}
  function changeStudio(kind,level){studioControls[kind]=level;for(const binding of studioBindings)binding.onChange(kind,level)}
  function gestureStudio(){for(const binding of studioBindings)binding.onGesture?.()}
  function gesturePhoto(pose){if(!photoGestureBinding.enabled())return false;Object.assign(photoGestureState,pose);photoGestureBinding.onChange(photoGestureState);return true}
  function gestureLive(pose){if(!liveGestureBinding.enabled())return false;Object.assign(liveGestureState,pose);liveGestureBinding.onChange(liveGestureState);return true}
  return {get:id=>elements.get(id),opener,sceneCalls,studioControls,changeStudio,gestureStudio,gesturePhoto,gestureLive,photoGestureState,liveGestureState,finders,photoViews,messages,urls,revoked,saves,encodedSnapshots,printCalls,snapshot,nativeSnapshot,tick,emit,media,async visibility(hidden){document.hidden=hidden;await emit('visibilitychange')},get printDisposed(){return printDisposed},get mediaRequests(){return mediaRequests},get stopped(){return stopped}};
}

async function photoFromDevice(app,blob=new Blob(['camera-jpeg'],{type:'image/jpeg'})){
  await app.emit('message',{source:app.opener,origin:'http://192.168.4.1',data:{type:'entropi-photo',blob,name:'entropi.jpg'}});
  return blob;
}
async function tap(app,details={}){await app.get('studio').emit('pointerdown',details);await app.get('studio').emit('pointerup',details)}

test('the website has no photo chooser and starts with the camera capture plane',()=>{
  const app=harness();
  assert.doesNotMatch(html,/<input\b[^>]*\btype=["']file["']|\bid=["']upload["']/i);
  assert.equal(app.get('capture-plane').hidden,false);
  assert.equal(app.get('save').hidden,true);
  assert.equal(app.mediaRequests,0);
});

test('the first capture gesture opens the camera and the second shows the default photo without inference',async()=>{
  const app=harness();
  await app.get('capture-plane').emit('click');
  assert.equal(app.mediaRequests,1);
  assert.equal(app.sceneCalls.length,0);
  await app.get('capture-plane').emit('click');
  assert.equal(app.sceneCalls.length,0);
  assert.match(app.get('photo').src,/^blob:/);
  assert.equal(app.get('studio').className,'studio done');
  assert.equal(app.get('finder').classList.contains('hidden'),true);
  assert.equal(app.get('scene').classList.contains('hidden'),true);
  assert.equal(app.stopped,1);
});

test('only the known camera window and origin can deliver an image',async()=>{
  const app=harness({image:1}),blob=new Blob(['jpeg'],{type:'image/jpeg'}),data={type:'entropi-photo',blob};
  assert.equal(app.messages[0].origin,'http://192.168.4.1');
  assert.equal(app.messages[0].data.type,'entropi-ready');
  await app.emit('message',{source:{},origin:'http://192.168.4.1',data});
  await app.emit('message',{source:app.opener,origin:'https://untrusted.test',data});
  assert.equal(app.sceneCalls.length,0);
  await photoFromDevice(app,blob);
  assert.equal(app.sceneCalls.length,1);
  assert.equal(app.sceneCalls[0].blob,blob);
});

test('the result saves the displayed monochrome PNG and retains its source JPEG',async()=>{
  const app=harness(),blob=await photoFromDevice(app);
  assert.equal(app.get('studio').className,'studio done');
  await app.get('save').emit('click');
  assert.equal(app.saves.length,1);assert.equal(app.saves[0].name,'entropi.png');assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.encodedSnapshots[0].photo,true);assert.equal(app.encodedSnapshots[0].width,16);assert.equal(app.encodedSnapshots[0].height,12);assert.equal(app.urls.get(app.get('photo').src),blob);
  assert.equal([...app.urls.values()].some(value=>value.type==='application/octet-stream'),false);
});

test('holding a completed scene prints its current view synchronously without capturing again',async()=>{
  const app=harness({image:1});await photoFromDevice(app);
  await app.get('studio').emit('pointerdown');await app.tick(500);await app.get('studio').emit('pointerup');
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image,app.snapshot);assert.equal(app.printCalls[0].isCurrent(),true);
  assert.equal(app.sceneCalls.length,1);await app.tick(100);await tap(app);assert.equal(app.get('studio').className,'studio done');
  await app.get('reset').emit('click');assert.equal(app.printCalls[0].isCurrent(),false);
  await app.emit('pagehide');assert.equal(app.printDisposed,true);
});

test('dragging out and back or adding another finger cancels a hold instead of printing',async()=>{
  const app=harness();await photoFromDevice(app);
  await app.get('studio').emit('pointerdown',{clientX:100});await app.get('studio').emit('pointermove',{clientX:150});await app.tick(600);await app.get('studio').emit('pointerup',{clientX:100});
  await app.get('studio').emit('pointerdown',{pointerId:1});await app.get('studio').emit('pointerdown',{pointerId:2,isPrimary:false});await app.tick(600);await app.get('studio').emit('pointerup',{pointerId:1});
  assert.equal(app.printCalls.length,0);assert.equal(app.get('studio').className,'studio done');
});

test('model failure requires selecting the retained photo before exporting its monochrome PNG',async()=>{
  const app=harness({image:1,scene:async()=>{throw new Error('Djupnemodellen manglar.')}}),blob=await photoFromDevice(app);
  assert.equal(app.get('studio').className,'studio error');
  assert.match(app.get('status').textContent,/Djupnemodellen manglar/);
  assert.equal(app.get('save').hidden,true);await app.get('save').emit('click');assert.equal(app.saves.length,0);app.changeStudio('image',0);assert.equal(app.get('save').hidden,false);await app.get('save').emit('click');
  assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.saves[0].name,'entropi.png');assert.equal(app.encodedSnapshots[0].photo,true);assert.equal(app.urls.get(app.get('photo').src),blob);
});

test('normal processing uses only progress while actionable model errors remain visible',async()=>{
  const pending=deferred(),app=harness({image:1,scene:()=>pending.promise});await photoFromDevice(app);assert.equal(app.get('status').textContent,'');assert.equal(app.get('progress').hidden,false);app.sceneCalls[0].progress({phase:'loading-model',percent:35});assert.equal(app.get('status').textContent,'');assert.equal(app.get('progress').firstElementChild.style.width,'35%');pending.reject(new Error('Internett manglar. Klargjer telefonen først.'));await app.tick(0);assert.equal(app.get('studio').className,'studio error');assert.match(app.get('status').textContent,/Internett manglar/);const css=await readFile(new URL('../style.css',import.meta.url),'utf8');assert.match(css,/\.studio\.error #status\{/);assert.doesNotMatch(css,/\.studio\.(?:working|opening) #status/);
});

test('selected splats stay black through decoding and inference without exposing a source photo or processed canvas',async()=>{
  const decoding=deferred(),processing=deferred(),app=harness({image:1,decode:()=>decoding.promise,scene:()=>processing.promise});await photoFromDevice(app);assert.equal(app.get('studio').className,'studio working');assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);assert.equal(app.get('scene').classList.contains('hidden'),true);
  decoding.resolve();await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('studio').className,'studio working');assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shows.some(Boolean),false);assert.equal(app.get('progress').hidden,false);assert.equal(app.get('status').textContent,'');assert.equal(app.get('save').hidden,true);assert.equal(app.get('print').hidden,true);await app.get('save').emit('click');await app.get('print').emit('click');assert.equal(app.saves.length,0);assert.equal(app.printCalls.length,0);
  processing.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('studio').className,'studio done');assert.equal(app.get('scene').classList.contains('hidden'),false);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);
});

test('switching photo to pending splats immediately hides both image layers and switching back is instant',async()=>{
  const pending=deferred(),app=harness({scene:()=>pending.promise});await photoFromDevice(app);const url=app.get('photo').src;assert.equal(app.photoViews[0].shown,true);app.changeStudio('image',1);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(app.get('progress').hidden,false);
  app.changeStudio('image',0);assert.equal(app.get('photo').hidden,false);assert.equal(app.photoViews[0].shown,true);assert.equal(app.get('photo').src,url);pending.reject(new Error('Late model failure'));await app.tick(0);assert.equal(app.get('studio').className,'studio done');assert.equal(app.photoViews[0].shown,true);
});

test('native camera capture encodes the finder framing once as PNG and keeps selected splats black during encoding',async()=>{
  const callbacks=[],types=[],app=harness({image:1,toBlob:(callback,type)=>{callbacks.push(callback);types.push(type)}});await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');assert.equal(app.finders[0].captures.length,1);assert.equal(app.get('finder').classList.contains('hidden'),true);assert.equal(app.get('photo').hidden,true);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(app.get('progress').hidden,false);assert.deepEqual(types,['image/png']);
  const blob=new Blob(['framed-color'],{type:'image/png'});callbacks[0](blob);await app.tick(0);assert.equal(app.sceneCalls[0].blob,blob);assert.equal(app.finders[0].captures[0].source,app.get('video'));assert.equal(app.finders[0].captures[0].canvas.width,1);assert.equal(app.finders[0].captures[0].canvas.height,1);app.changeStudio('image',0);app.changeStudio('image',1);assert.equal(app.finders[0].captures.length,1);
});

test('returning to the camera keeps pending splats without letting a late result reopen review',async()=>{
  const pending=deferred();let disposed=false;
  const app=harness({image:1,scene:()=>pending.promise});await photoFromDevice(app);
  assert.equal(app.get('studio').className,'studio working');
  await tap(app);await app.tick(100);await tap(app);
  assert.equal(app.get('studio').className,'studio camera');
  assert.equal(app.sceneCalls[0].signal.aborted,false);
  pending.resolve({dispose(){disposed=true}});await app.tick(0);
  assert.equal(disposed,false);
  assert.equal(app.get('studio').className,'studio camera');
});

test('a drag between taps preserves the scene instead of becoming a double tap',async()=>{
  let disposed=false;const app=harness({image:1,scene:async()=>({dispose(){disposed=true}})});await photoFromDevice(app);
  await tap(app);await app.tick(100);
  await app.get('studio').emit('pointerdown',{clientX:100});await app.get('studio').emit('pointerup',{clientX:180});
  await app.tick(100);await tap(app);
  assert.equal(app.get('studio').className,'studio done');
  assert.equal(disposed,false);
});

test('pinching clears the tap candidate and never resets the scene',async()=>{
  const app=harness({image:1});await photoFromDevice(app);await tap(app);await app.tick(100);
  await app.get('studio').emit('pointerdown',{pointerId:1,isPrimary:true});
  await app.get('studio').emit('pointerdown',{pointerId:2,isPrimary:false,clientX:200});
  await app.get('studio').emit('pointerup',{pointerId:2,isPrimary:false,clientX:240});
  await app.get('studio').emit('pointerup',{pointerId:1,isPrimary:true});
  await app.tick(100);await tap(app);
  assert.equal(app.get('studio').className,'studio done');
});

test('auxiliary button taps cannot reset the scene',async()=>{
  const app=harness({image:1});await photoFromDevice(app);
  await tap(app,{target:app.get('save')});await app.tick(100);await tap(app,{target:app.get('save')});
  assert.equal(app.get('studio').className,'studio done');
  assert.equal(app.sceneCalls[0].signal.aborted,false);
});

test('a camera permission response arriving after an incoming image is stopped',async()=>{
  const pending=deferred(),app=harness({media:()=>pending.promise});
  await app.get('capture-plane').emit('click');await photoFromDevice(app);
  pending.resolve(app.media);await app.tick(0);
  assert.equal(app.get('studio').className,'studio done');
  assert.equal(app.stopped,1);
  assert.equal(app.sceneCalls.length,0);
});

test('an unchanged rail gesture clears a pending result tap',async()=>{
  const app=harness();await photoFromDevice(app);await tap(app);app.gestureStudio();await app.tick(100);await tap(app);
  assert.equal(app.get('studio').className,'studio done');
});

test('a double-tap click cannot recapture until the next intentional camera gesture',async()=>{
  const app=harness();await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');
  await tap(app);await app.tick(100);await tap(app);await app.get('capture-plane').emit('click');
  assert.equal(app.get('studio').className,'studio camera');assert.equal(app.sceneCalls.length,0);
  await app.tick(401);await app.get('capture-plane').emit('click');
  assert.equal(app.get('studio').className,'studio done');assert.equal(app.sceneCalls.length,0);
});

test('photo and splats reuse one JPEG and one cached scene while styles remain independent',async()=>{
  const styles=[],app=harness({scene:async()=>({dispose(){},setPrimitiveLevel(level){styles.push(level)}})}),blob=await photoFromDevice(app);
  const url=app.get('photo').src,photoView=app.photoViews[0];app.changeStudio('photo',3);assert.equal(photoView.style,3);assert.equal(app.sceneCalls.length,0);assert.equal(app.studioControls.image,0);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.sceneCalls[0].blob,blob);assert.equal(app.sceneCalls[0].quality,undefined);
  app.changeStudio('primitive',2);assert.equal(styles.at(-1),2);
  assert.equal(photoView.shown,false);app.changeStudio('image',0);await app.tick(0);assert.equal(app.get('photo').src,url);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(photoView.shown,true);assert.equal(photoView.style,3);assert.equal(app.studioControls.primitive,2);assert.equal(photoView.sources.length,1);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').classList.contains('hidden'),false);
  await app.get('save').emit('click');assert.equal(app.encodedSnapshots[0],app.nativeSnapshot);assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.urls.get(app.get('photo').src),blob);
});

test('photo gestures and style changes feed the same rendered view to save and print without inference',async()=>{
  const app=harness(),blob=await photoFromDevice(app),view=app.photoViews[0],url=app.get('photo').src;assert.equal(view.source,app.get('photo'));assert.equal(view.shown,true);app.changeStudio('photo',2);const refreshes=view.refreshes;assert.equal(app.gesturePhoto({grain:5,contrast:2.2,scale:2,x:8,y:-4}),true);assert.deepEqual(view.tone,{grain:5,contrast:2.2});assert.ok(view.refreshes>refreshes);
  await app.get('save').emit('click');await app.get('print').emit('click');for(const output of [app.encodedSnapshots[0],app.printCalls[0].image]){assert.equal(output.style,2);assert.deepEqual(output.tone,{grain:5,contrast:2.2});assert.equal(output.photo,true)}assert.deepEqual(view.snapshots.map(call=>call.native),[true,false]);assert.equal(view.snapshots[0].pose.scale,2);assert.equal(app.sceneCalls.length,0);assert.equal(app.urls.get(url),blob);assert.equal(app.get('photo').src,url);
  await app.get('reset').emit('click');assert.equal(view.shown,false);await app.get('last-photo').emit('click');assert.equal(view.shown,true);assert.equal(view.sources.length,1);await app.emit('pagehide');assert.equal(view.disposed,true);
});

test('live Bayer and three-finger tone carry into the capture while suppressing gesture fallthrough',async()=>{
  const app=harness(),finder=app.finders[0],view=app.photoViews[0];assert.equal(finder.style,1);assert.equal(view.style,1);await app.get('capture-plane').emit('click');app.changeStudio('photo',3);assert.equal(finder.style,3);assert.equal(app.gestureLive({grain:4,contrast:1.8}),true);assert.deepEqual(finder.tone,{grain:4,contrast:1.8});await app.get('capture-plane').emit('click');assert.equal(view.sources.length,0);assert.equal(app.get('studio').className,'studio camera');await app.tick(401);await app.get('capture-plane').emit('click');assert.equal(view.sources.length,1);assert.equal(view.style,3);assert.deepEqual(view.tone,{grain:4,contrast:1.8});assert.equal(app.photoGestureState.grain,4);assert.equal(app.gestureLive({grain:1}),false);app.gesturePhoto({grain:2,contrast:2});assert.deepEqual(finder.tone,{grain:2,contrast:2});assert.equal(app.liveGestureState.grain,2);assert.equal(app.sceneCalls.length,0);
});

test('a pending splat can finish behind the photo without taking over the chosen image type',async()=>{
  const pending=deferred(),app=harness({scene:()=>pending.promise});await photoFromDevice(app);app.changeStudio('image',1);await app.tick(0);
  const signal=app.sceneCalls[0].signal;app.changeStudio('image',0);await app.tick(0);
  assert.equal(signal.aborted,false);assert.equal(app.get('studio').className,'studio done');
  pending.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(app.get('studio').className,'studio done');
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').classList.contains('hidden'),false);
});

test('rapid image switches share pending splats and reopening the same photo uses the cached result',async()=>{
  const pending=deferred();let disposed=false;const app=harness({scene:()=>pending.promise});await photoFromDevice(app);
  app.changeStudio('image',1);await app.tick(0);app.changeStudio('image',0);app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);
  const url=app.get('photo').src;await app.get('reset').emit('click');assert.equal(app.sceneCalls[0].signal.aborted,false);assert.equal(app.revoked.includes(url),false);
  pending.resolve({dispose(){disposed=true}});await app.tick(0);assert.equal(disposed,false);assert.equal(app.get('studio').className,'studio camera');
  assert.equal(app.get('last-photo').hidden,false);await app.get('last-photo').emit('click');assert.equal(app.get('studio').className,'studio done');assert.equal(app.sceneCalls.length,1);assert.equal(app.get('photo').src,url);
});

test('holding a normal photo prints the monochrome photo snapshot without starting a model',async()=>{
  const app=harness();await photoFromDevice(app);await app.get('studio').emit('pointerdown');await app.tick(500);await app.get('studio').emit('pointerup');
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image.photo,true);assert.equal(app.printCalls[0].image.width,384);assert.equal(app.sceneCalls.length,0);
});

test('a persisted page return keeps the photo, cached scene and printer client',async()=>{
  let disposed=false;const app=harness({image:1,scene:async()=>({dispose(){disposed=true}})});await photoFromDevice(app);const url=app.get('photo').src;
  await app.emit('pagehide',{persisted:true});assert.equal(disposed,false);assert.equal(app.printDisposed,false);assert.equal(app.sceneCalls[0].signal.aborted,false);
  await app.emit('pageshow',{persisted:true});await app.tick(0);assert.equal(app.get('photo').src,url);assert.equal(app.sceneCalls.length,1);
  app.changeStudio('image',0);app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);
});

test('replacing a photograph retires the old calculation and keeps the new photo selected',async()=>{
  const pending=deferred();let disposed=false;const app=harness({scene:()=>pending.promise});await photoFromDevice(app);const oldUrl=app.get('photo').src;
  app.changeStudio('image',1);await app.tick(0);app.changeStudio('image',0);const replacement=await photoFromDevice(app,new Blob(['second-jpeg'],{type:'image/jpeg'}));
  assert.equal(app.sceneCalls[0].signal.aborted,true);assert.ok(app.revoked.includes(oldUrl));assert.equal(app.urls.get(app.get('photo').src),replacement);
  pending.resolve({dispose(){disposed=true}});await app.tick(0);assert.equal(disposed,true);assert.equal(app.get('studio').className,'studio done');assert.equal(app.get('photo').hidden,false);
});

test('a late photo decode cannot undo a reset or start inference',async()=>{
  const pending=deferred(),app=harness({image:1,decode:()=>pending.promise});await photoFromDevice(app);const url=app.get('photo').src;
  await app.get('reset').emit('click');pending.resolve();await app.tick(0);assert.equal(app.get('studio').className,'studio camera');assert.equal(app.sceneCalls.length,0);assert.ok(app.revoked.includes(url));
});

test('retrying an unreadable photo returns to the camera and the next photo needs no model',async()=>{
  let reads=0;const app=harness({decode:()=>{if(++reads===1)throw new Error('unreadable JPEG')}});
  await photoFromDevice(app);const failedUrl=app.get('photo').src;assert.equal(app.get('studio').className,'studio error');
  await app.get('retry').emit('click');assert.equal(app.get('studio').className,'studio camera');assert.equal(app.mediaRequests,1);assert.ok(app.revoked.includes(failedUrl));
  await app.get('capture-plane').emit('click');assert.equal(app.get('studio').className,'studio done');assert.equal(app.sceneCalls.length,0);
});

test('backgrounding releases the camera and returning resumes it without recapturing',async()=>{
  const app=harness();await app.get('capture-plane').emit('click');await app.visibility(true);assert.equal(app.stopped,1);assert.equal(app.mediaRequests,1);
  await app.visibility(false);assert.equal(app.mediaRequests,2);assert.equal(app.sceneCalls.length,0);assert.equal(app.get('studio').className,'studio camera');
});

test('returning during a pending camera permission request starts a new request and retires the old response',async()=>{
  for(const failed of [false,true]){
    const first=deferred(),second=deferred();let requests=0,oldStops=0;const app=harness({media:()=>++requests===1?first.promise:second.promise}),oldMedia={getTracks:()=>[{stop(){oldStops++}}]};
    await app.get('capture-plane').emit('click');await app.visibility(true);await app.visibility(false);assert.equal(app.mediaRequests,2);assert.equal(app.get('studio').classList.contains('opening'),true);
    if(failed)first.reject(new Error('late permission error'));else first.resolve(oldMedia);await app.tick(0);assert.equal(oldStops,failed?0:1);assert.equal(app.get('video').srcObject,null);assert.equal(app.get('studio').classList.contains('opening'),true);assert.equal(app.get('studio').className,'studio camera');await app.get('capture-plane').emit('click');assert.equal(app.mediaRequests,2);
    second.resolve(app.media);await app.tick(0);assert.equal(app.get('video').srcObject,app.media);assert.equal(app.get('capture-plane').getAttribute('aria-label'),'Ta foto');assert.equal(app.get('studio').classList.contains('opening'),false);assert.equal(app.get('status').textContent,'');
  }
});

test('a stale video play completion cannot block the resumed camera or clear its opening state',async()=>{
  for(const failed of [false,true]){
    const first=deferred(),second=deferred();let starts=0,plays=0,stops=0;const media=()=>({getTracks:()=>[{stop(){stops++}}]}),app=harness({media:async()=>{starts++;return media()},play:()=>++plays===1?first.promise:second.promise});
    await app.get('capture-plane').emit('click');await app.visibility(true);assert.equal(stops,1);await app.visibility(false);assert.equal(starts,2);const current=app.get('video').srcObject;
    if(failed)first.reject(new Error('old play failure'));else first.resolve();await app.tick(0);assert.equal(app.get('video').srcObject,current);assert.equal(app.get('studio').classList.contains('opening'),true);assert.equal(app.get('status').textContent,'');assert.equal(stops,1);await app.get('capture-plane').emit('click');assert.equal(starts,2);
    second.resolve();await app.tick(0);assert.equal(app.get('video').srcObject,current);assert.equal(app.finders[0].source,app.get('video'));assert.equal(app.get('capture-plane').getAttribute('aria-label'),'Ta foto');assert.equal(app.get('studio').classList.contains('opening'),false);
  }
});

test('backgrounding an encoding capture resumes the camera and keeps the cached photo, scene and tone',async()=>{
  for(const persisted of [false,true]){
    const callbacks=[];let disposed=0;const app=harness({image:1,toBlob:callback=>callbacks.push(callback),scene:async()=>({dispose(){disposed++}})});await photoFromDevice(app);const original=app.get('photo').src;app.changeStudio('image',0);app.gesturePhoto({grain:4,contrast:1.8});await app.get('reset').emit('click');await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');assert.equal(callbacks.length,1);assert.equal(app.get('studio').className,'studio working');
    if(persisted)await app.emit('pagehide',{persisted:true});else await app.visibility(true);assert.equal(app.get('studio').className,'studio camera');assert.equal(disposed,0);assert.equal(app.get('photo').src,original);
    if(persisted)await app.emit('pageshow',{persisted:true});else await app.visibility(false);assert.equal(app.mediaRequests,2);assert.equal(app.get('video').srcObject,app.media);await app.get('capture-plane').emit('click');assert.equal(callbacks.length,2);
    callbacks[0](new Blob(['old'],{type:'image/png'}));await app.tick(0);assert.equal(app.get('studio').className,'studio working');assert.equal(app.get('photo').src,original);assert.equal(disposed,0);
    const fresh=new Blob(['new'],{type:'image/png'});callbacks[1](fresh);await app.tick(0);assert.equal(app.get('studio').className,'studio done');assert.equal(app.urls.get(app.get('photo').src),fresh);assert.equal(disposed,1);assert.deepEqual(app.photoViews[0].tone,{grain:4,contrast:1.8});assert.equal(app.sceneCalls.length,1);
  }
});

test('a new incoming photo retires an unfinished capture without waiting for its encoder',async()=>{
  let encoded;const app=harness({toBlob:callback=>encoded=callback});await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');const fresh=await photoFromDevice(app,new Blob(['new'],{type:'image/png'})),url=app.get('photo').src;
  assert.equal(app.get('studio').className,'studio done');assert.equal(app.photoViews[0].shown,true);assert.equal(app.get('save').hidden,false);encoded(new Blob(['old'],{type:'image/png'}));await app.tick(0);assert.equal(app.get('photo').src,url);assert.equal(app.urls.get(url),fresh);assert.equal(app.get('studio').className,'studio done');assert.equal(app.photoViews[0].sources.length,1);
});

test('late video play completion cannot revive the camera over a newly accepted photo',async()=>{
  for(const failed of [false,true]){
    const pending=deferred(),app=harness({play:()=>pending.promise});await app.get('capture-plane').emit('click');const blob=await photoFromDevice(app);if(failed)pending.reject(new Error('old play failed'));else pending.resolve();await app.tick(0);assert.equal(app.get('video').srcObject,null);assert.equal(app.get('studio').className,'studio done');assert.equal(app.get('status').textContent,'');assert.equal(app.finders[0].active,false);assert.equal(app.urls.get(app.get('photo').src),blob);assert.equal(app.mediaRequests,1);
  }
});

test('an installed app starts its viewfinder while a hidden installation waits until visible',async()=>{
  for(const options of [{standalone:true},{displayStandalone:true}]){const app=harness(options);await app.tick(0);assert.equal(app.mediaRequests,1);assert.equal(app.sceneCalls.length,0);assert.equal(app.get('studio').className,'studio camera')}
  const hidden=harness({standalone:true,hidden:true});assert.equal(hidden.mediaRequests,0);await hidden.visibility(false);assert.equal(hidden.mediaRequests,1);
});

test('a camera response received in the background cannot reactivate video or replace the current state',async()=>{
  for(const failed of [false,true]){const pending=deferred(),app=harness({media:()=>pending.promise});await app.get('capture-plane').emit('click');await app.visibility(true);
    if(failed)pending.reject(new Error('late camera error'));else pending.resolve(app.media);await app.tick(0);
    assert.equal(app.get('video').srcObject,null);assert.equal(app.get('studio').className,'studio camera');assert.equal(app.sceneCalls.length,0);assert.equal(app.stopped,failed?0:1);
  }
});


test('the explicit printer action prints once and becomes stale on returning to the camera',async()=>{
  const app=harness();await photoFromDevice(app);assert.equal(app.get('print').hidden,false);
  await app.get('print').emit('click');assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image.photo,true);
  await app.get('reset').emit('click');assert.equal(app.get('print').hidden,true);assert.equal(app.printCalls[0].isCurrent(),false);
});

test('changing image type in the camera preserves live composition and defers inference',async()=>{
  const app=harness();await photoFromDevice(app);await app.get('reset').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('studio').className,'studio camera');assert.equal(app.sceneCalls.length,0);assert.equal(app.get('finder').classList.contains('hidden'),false);
  await app.get('last-photo').emit('click');assert.equal(app.sceneCalls.length,1);assert.equal(app.get('studio').className,'studio done');
});

test('camera permission failure arriving after reopening a saved result cannot replace it',async()=>{
  const pending=deferred(),app=harness({media:()=>pending.promise});await photoFromDevice(app);await app.get('reset').emit('click');
  await app.get('capture-plane').emit('click');await app.get('last-photo').emit('click');pending.reject(new Error('late camera failure'));await app.tick(0);
  assert.equal(app.get('studio').className,'studio done');assert.equal(app.get('photo').hidden,false);
});


test('an abandoned photo encoding cannot replace the camera or overwrite a newer capture',async()=>{
  const callbacks=[],app=harness({toBlob:callback=>callbacks.push(callback)});await photoFromDevice(app);const oldUrl=app.get('photo').src;
  await app.get('reset').emit('click');await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');assert.equal(callbacks.length,1);
  await app.get('reset').emit('click');await app.get('capture-plane').emit('click');assert.equal(callbacks.length,2);
  callbacks[0](new Blob(['old'],{type:'image/jpeg'}));await app.tick(0);assert.equal(app.get('studio').className,'studio working');assert.equal(app.get('photo').src,oldUrl);
  callbacks[1](new Blob(['new'],{type:'image/jpeg'}));await app.tick(0);assert.equal(app.get('studio').className,'studio done');assert.notEqual(app.get('photo').src,oldUrl);
});


test('a failed new capture retries the camera rather than reprocessing the retained splat',async()=>{
  const app=harness({image:1,toBlob:callback=>callback(null)});await photoFromDevice(app);const url=app.get('photo').src;
  await app.get('reset').emit('click');await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');assert.equal(app.get('studio').className,'studio error');
  await app.get('retry').emit('click');assert.equal(app.get('studio').className,'studio camera');assert.equal(app.sceneCalls.length,1);assert.equal(app.get('photo').src,url);
  await app.get('last-photo').emit('click');assert.equal(app.get('studio').className,'studio done');assert.equal(app.sceneCalls.length,1);
});

test('a scene save requests native rendered pixels and a pending save becomes stale after a new photo',async()=>{
  const flags=[],native={width:20,height:30,data:new Uint8ClampedArray(20*30*4)},app=harness({image:1,scene:async()=>({dispose(){},snapshot:flag=>{flags.push(flag);return native}})});await photoFromDevice(app);await app.get('save').emit('click');assert.deepEqual(flags,[true]);assert.equal(app.encodedSnapshots[0],native);assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.saves[0].isCurrent(),true);
  await app.get('reset').emit('click');assert.equal(app.saves[0].isCurrent(),false);await photoFromDevice(app,new Blob(['replacement'],{type:'image/jpeg'}));assert.equal(app.saves[0].isCurrent(),false);
});
