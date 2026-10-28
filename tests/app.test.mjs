import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createEntropiDocument } from '../vendor/entropi-document.mjs';
import { COLOR_SCHEMES } from '../vendor/color-schemes.mjs';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const application=(await readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const photoModule=await readFile(new URL('../vendor/photo.mjs',import.meta.url),'utf8'),photoSource=photoModule.slice(photoModule.indexOf('export function photoSnapshot')).replace(/^export /gm,'');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

function harness(options={}){
  let now=1000,nextTimer=0,nextUrl=0,mediaRequests=0,stopped=0;
  const elements=new Map(),events=new Map(),timers=new Map(),urls=new Map(),saves=[],encodedSnapshots=[],sceneCalls=[],messages=[],studioBindings=[],printCalls=[],revoked=[],photoViews=[],artViews=[],artCalls=[];
  const snapshot={width:384,height:1,data:new Uint8ClampedArray(384*4)},nativeSnapshot={width:640,height:960,data:new Uint8ClampedArray(640*960*4)};let printDisposed=false;
  const studioControls={image:options.image??2,primitive:0,photo:0,dispose(){}},finders=[],savedSchemes=[];
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
    append(...children){this.children.push(...children)}
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
    COLOR_SCHEMES,
    createEntropiDocument,bindExportGesture:(button,getOptions)=>button.addEventListener('click',async()=>{const options=getOptions();if(!options||!options.isCurrent())return;try{const blob=await options.image();if(options.isCurrent())saves.push({blob,name:options.name.replace(/\.[^.]+$/,'')+'.'+(options.imageExtension??'png'),isCurrent:options.isCurrent,options})}catch(error){options.onError?.(error)}}),pickEntropiDocument:async()=>options.importDocument??null,
    createArchive:()=>options.archive??({saveDocument:async document=>({id:document.id}),save:async()=>({}),savePreview:async()=>null,list:async()=>[],get:async()=>null,remove:async()=>{}}),
    location:{search:''},URLSearchParams,
    Viewfinder:class{constructor(){this.tone={grain:1,contrast:1};this.captures=[];finders.push(this)}capture(source){const canvas=document.createElement('canvas');canvas.width=320;canvas.height=480;this.captures.push({source,canvas});return canvas}setStyle(level){this.style=level}setPalette(id){this.palette=id}setTone(pose){this.tone={grain:pose.grain,contrast:pose.contrast}}clear(){}dispose(){}},
    attachStudioControls:(hosts,onChange,enabled,onGesture)=>{studioBindings.push({hosts,onChange,enabled,onGesture});return studioControls},
    readColorScheme:()=> 'macintosh',saveColorScheme:(kind,id)=>savedSchemes.push([kind,id]),attachColorSchemeControls:()=>({refresh(){},dispose(){}}),
    attachPhotoGestures:(image,binding)=>{const state=binding.toneOnly?liveGestureState:photoGestureState;if(binding.toneOnly)liveGestureBinding=binding;else photoGestureBinding=binding;return {state,reset(){Object.assign(state,{scale:1,x:0,y:0});binding.onChange(state)},refresh(){binding.onChange(state)},dispose(){}}},
    createPhotoView:image=>{const viewer={image,source:null,sources:[],style:0,tone:{grain:1,contrast:1},shown:false,shows:[],refreshes:0,snapshots:[],disposed:false,setSource(source=image){this.source=source;this.sources.push(source)},setStyle(level){this.style=level},setPalette(id){this.palette=id},setTone(pose){for(const key of ['grain','contrast'])if(pose[key]!==undefined)this.tone[key]=pose[key]},show(visible){this.shown=Boolean(visible);this.shows.push(this.shown)},refresh(){this.refreshes++},snapshot(pose,native=false){const result={...context.photoSnapshot(image,pose,native),style:this.style,tone:{...this.tone}};this.snapshots.push({pose:{...pose},native,result});return result},dispose(){this.disposed=true}};photoViews.push(viewer);return viewer},
    snapshotBlob:image=>{encodedSnapshots.push(image);return new Blob(['rendered-png'],{type:'image/png'})},savePhoto:(blob,name,isCurrent)=>{saves.push({blob,name,isCurrent});return Promise.resolve()},
    PX10Printer:class{},cloudPrintJob:()=>new Uint8Array(),
    createPrintClient:()=>({print:(image,isCurrent)=>{printCalls.push({image,isCurrent});return Promise.resolve(true)},dispose(){printDisposed=true}}),
    createMarigoldView:(host,binding)=>{const viewer={recipe:{preset:1,position:0,width:1},async restore(blob,result,recipe,signal){if(signal.aborted)throw signal.reason;this.result=result;this.recipe=recipe;this.ready=true;host.hidden=false;return result},ready:false,result:null,resets:0,disposed:false,tones:0,snapshots:[],async process(blob,signal,settings){artCalls.push({blob,signal,settings});const result=options.art?await options.art(blob,signal,settings):{model:'Test raw model',width:2,height:2,depth:Float32Array.of(.1,.2,.6,.9),polarity:'near'};if(!signal.aborted){this.result=result;this.ready=true;host.hidden=false}return result},reset(){this.resets++;this.ready=false;this.result=null;host.hidden=true},resetTone(){this.tones++},snapshot(native){const result={width:native?640:384,height:native?960:1,data:new Uint8ClampedArray(native?640*960*4:384*4),depthArt:true};this.snapshots.push({native,result});return result},dispose(){this.disposed=true},binding};artViews.push(viewer);return viewer},
    createDepthScene:async(host,blob,progress,signal,quality)=>{sceneCalls.push({host,blob,progress,signal,quality});return options.scene?{setPrimitiveLevel(){},setPalette(){},snapshot:native=>native?nativeSnapshot:snapshot,...await options.scene(host,blob,progress,signal,quality)}:{dispose(){},setPrimitiveLevel(){},setPalette(){},snapshot:native=>native?nativeSnapshot:snapshot}},
    performance:{now:()=>now},Date:class extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}},
    setTimeout:(callback,delay=0)=>{const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(photoSource+'\n'+application,context,{filename:'app.mjs'});
  async function tick(duration){now+=duration;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}await flush()}
  async function emit(name,details={}){for(const callback of events.get(name)??[])callback({type:name,...details});await flush()}
  function changeStudio(kind,level){studioControls[kind]=level;for(const binding of studioBindings)binding.onChange(kind,level)}
  studioControls.setImage=level=>changeStudio('image',level);
  function gestureStudio(){for(const binding of studioBindings)binding.onGesture?.()}
  function gesturePhoto(pose){if(!photoGestureBinding.enabled())return false;Object.assign(photoGestureState,pose);photoGestureBinding.onChange(photoGestureState);return true}
  function gestureLive(pose){if(!liveGestureBinding.enabled())return false;Object.assign(liveGestureState,pose);liveGestureBinding.onChange(liveGestureState);return true}
  return {get:id=>elements.get(id),opener,sceneCalls,artViews,artCalls,studioControls,changeStudio,gestureStudio,gesturePhoto,gestureLive,photoGestureState,liveGestureState,finders,photoViews,savedSchemes,messages,urls,revoked,saves,encodedSnapshots,printCalls,snapshot,nativeSnapshot,tick,emit,media,async visibility(hidden){document.hidden=hidden;await emit('visibilitychange')},get printDisposed(){return printDisposed},get mediaRequests(){return mediaRequests},get stopped(){return stopped}};
}

async function photoFromDevice(app,blob=new Blob(['camera-jpeg'],{type:'image/jpeg'})){
  await app.emit('message',{source:app.opener,origin:'http://192.168.4.1',data:{type:'entropi-photo',blob,name:'entropi.jpg'}});
  return blob;
}
async function tap(app,details={}){await app.get('studio').emit('pointerdown',details);await app.get('studio').emit('pointerup',details)}

test('VATHOgraphy freezes the native finder until processing completes or retries after failure',async()=>{
  const pending=deferred();let attempts=0;
  const app=harness({image:2,art:()=>++attempts===1?pending.promise:Promise.resolve({model:'ready'})});
  await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.get('studio').className,'studio working');assert.equal(app.finders[0].active,false);
  assert.equal(app.get('finder').classList.contains('hidden'),false);assert.equal(app.get('progress').hidden,false);
  pending.reject(new Error('Depth failed'));await app.tick(0);
  assert.equal(app.get('studio').className,'studio error');assert.equal(app.get('status').textContent,'Depth failed');
  assert.equal(app.get('finder').classList.contains('hidden'),false);assert.equal(app.finders[0].active,false);
  await app.get('retry').emit('click');await app.tick(0);
  assert.equal(app.artCalls.length,2);assert.equal(app.get('studio').className,'studio done');
  assert.equal(app.get('finder').classList.contains('hidden'),true);assert.equal(app.get('marigold-view').hidden,false);
});

test('the website has no photo chooser and starts with the camera capture plane',()=>{
  const app=harness();
  assert.doesNotMatch(html,/<input\b[^>]*\btype=["']file["']|\bid=["']upload["']/i);
  assert.equal(app.studioControls.image,2);
  assert.equal(app.finders[0].monochrome,true);
  assert.equal(app.get('capture-plane').hidden,false);
  assert.equal(app.get('save').hidden,true);
  assert.equal(app.mediaRequests,0);
});

test('the first capture gesture opens the camera and the second processes the default depth mode',async()=>{
  const app=harness();
  await app.get('capture-plane').emit('click');
  assert.equal(app.mediaRequests,1);
  assert.equal(app.sceneCalls.length,0);
  await app.get('capture-plane').emit('click');
  assert.equal(app.sceneCalls.length,0);
  assert.equal(app.artCalls.length,1);
  assert.equal(app.get('marigold-view').hidden,false);
  assert.equal(app.get('photo').hidden,true);
  assert.equal(app.finders[0].captures[0].source,app.get('video'));
  assert.equal(app.artCalls[0].blob,app.urls.get(app.get('photo').src));
  assert.match(app.get('photo').src,/^blob:/);
  assert.equal(app.get('studio').className,'studio done');
  assert.equal(app.get('finder').classList.contains('hidden'),true);
  assert.equal(app.get('scene').classList.contains('hidden'),true);
  assert.equal(app.stopped,1);
});

test('depth preview switches to monochrome without overwriting the saved photo palette or tone',async()=>{
  const app=harness(),finder=app.finders[0],view=app.photoViews[0];
  assert.equal(finder.monochrome,true);assert.equal(app.gestureLive({grain:4}),false);
  app.changeStudio('image',0);assert.equal(finder.monochrome,false);
  app.changeStudio('photo',3);assert.equal(app.gestureLive({grain:4,contrast:1.8}),true);
  for(const image of [2,1,0]){
    app.changeStudio('image',image);assert.equal(finder.monochrome,image===2);
    assert.equal(app.studioControls.photo,3);assert.equal(finder.palette,'gameboy');assert.equal(view.palette,'gameboy');
    assert.equal(finder.style,1);assert.equal(view.style,1);assert.deepEqual(finder.tone,{grain:4,contrast:1.8});assert.deepEqual(view.tone,{grain:4,contrast:1.8});
  }
  assert.deepEqual(app.savedSchemes,[['photo','gameboy']]);assert.equal(app.artCalls.length,0);assert.equal(app.sceneCalls.length,0);
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
  const app=harness({image:0}),blob=await photoFromDevice(app);
  assert.equal(app.get('studio').className,'studio done');
  await app.get('save').emit('click');
  assert.equal(app.saves.length,1);assert.equal(app.saves[0].name,'entropi.png');assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.encodedSnapshots.at(-1).photo,true);assert.equal(app.encodedSnapshots.at(-1).width,16);assert.equal(app.encodedSnapshots.at(-1).height,12);assert.equal(app.urls.get(app.get('photo').src),blob);
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
  assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.saves[0].name,'entropi.png');assert.equal(app.encodedSnapshots.at(-1).photo,true);assert.equal(app.urls.get(app.get('photo').src),blob);
});

test('normal processing uses only progress while model errors remain available to screen readers',async()=>{
  assert.match(html,/<div\b[^>]*\bid="progress"[^>]*\bhidden\b[^>]*>\s*<svg\b[^>]*>\s*<rect\b[^>]*pathLength="100"[^>]*\/>\s*<\/svg>\s*<\/div>/);
  const pending=deferred(),app=harness({image:1,scene:()=>pending.promise});assert.equal(app.get('progress').tagName,'DIV');assert.equal(app.get('progress').hidden,true);await photoFromDevice(app);assert.equal(app.get('status').textContent,'');assert.equal(app.get('progress').hidden,false);app.sceneCalls[0].progress({phase:'loading-model',percent:35});assert.equal(app.get('status').textContent,'');assert.equal(app.get('progress-bar').style.strokeDasharray,'35 100');pending.reject(new Error('Internett manglar. Klargjer telefonen først.'));await app.tick(0);assert.equal(app.get('progress').hidden,true);assert.equal(app.get('studio').className,'studio error');assert.match(app.get('status').textContent,/Internett manglar/);const css=await readFile(new URL('../style.css',import.meta.url),'utf8');assert.match(app.get('status').className,/sr-only/);assert.match(css,/\.sr-only\{[^}]*clip-path:inset\(50%\)/);assert.doesNotMatch(css,/\.studio\.(?:error|working|opening) #status/);
});

test('processing keeps the frozen finder through decoding and inference until the result is ready',async()=>{
  const decoding=deferred(),processing=deferred(),app=harness({image:1,decode:()=>decoding.promise,scene:()=>processing.promise});await photoFromDevice(app);assert.equal(app.get('studio').className,'studio working');assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);assert.equal(app.get('scene').classList.contains('hidden'),true);
  decoding.resolve();await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('studio').className,'studio working');assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shows.some(Boolean),false);assert.equal(app.get('progress').hidden,false);assert.equal(app.get('status').textContent,'');assert.equal(app.get('save').hidden,true);assert.equal(app.get('print').hidden,true);await app.get('save').emit('click');await app.get('print').emit('click');assert.equal(app.saves.length,0);assert.equal(app.printCalls.length,0);
  processing.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('studio').className,'studio done');assert.equal(app.get('scene').classList.contains('hidden'),false);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);
});

test('switching photo to pending splats immediately hides both image layers and switching back is instant',async()=>{
  const pending=deferred(),app=harness({image:0,scene:()=>pending.promise});await photoFromDevice(app);const url=app.get('photo').src;assert.equal(app.photoViews[0].shown,true);app.changeStudio('image',1);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(app.get('progress').hidden,false);
  app.changeStudio('image',0);assert.equal(app.get('photo').hidden,false);assert.equal(app.photoViews[0].shown,true);assert.equal(app.get('photo').src,url);pending.reject(new Error('Late model failure'));await app.tick(0);assert.equal(app.get('studio').className,'studio done');assert.equal(app.photoViews[0].shown,true);
});

test('native camera capture encodes the finder framing once and keeps the frozen finder visible',async()=>{
  const callbacks=[],types=[],app=harness({image:1,toBlob:(callback,type)=>{callbacks.push(callback);types.push(type)}});await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');assert.equal(app.finders[0].captures.length,1);assert.equal(app.finders[0].active,false);assert.equal(app.get('finder').classList.contains('hidden'),false);assert.equal(app.get('photo').hidden,true);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(app.get('progress').hidden,false);assert.deepEqual(types,['image/png']);
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
  const styles=[],app=harness({image:0,scene:async()=>({dispose(){},setPrimitiveLevel(level){styles.push(level)}})}),blob=await photoFromDevice(app);
  const url=app.get('photo').src,photoView=app.photoViews[0];app.changeStudio('photo',3);assert.equal(photoView.style,1);assert.equal(photoView.palette,'gameboy');assert.equal(app.sceneCalls.length,0);assert.equal(app.studioControls.image,0);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.sceneCalls[0].blob,blob);assert.equal(app.sceneCalls[0].quality,undefined);
  app.changeStudio('primitive',2);assert.equal(styles.at(-1),2);
  assert.equal(photoView.shown,false);app.changeStudio('image',0);await app.tick(0);assert.equal(app.get('photo').src,url);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(photoView.shown,true);assert.equal(photoView.style,1);assert.equal(app.studioControls.primitive,2);assert.equal(photoView.sources.length,1);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').classList.contains('hidden'),false);
  await app.get('save').emit('click');assert.equal(app.encodedSnapshots.at(-1),app.nativeSnapshot);assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.urls.get(app.get('photo').src),blob);
});

test('photo gestures and style changes feed the same rendered view to save and print without inference',async()=>{
  const app=harness({image:0}),blob=await photoFromDevice(app),view=app.photoViews[0],url=app.get('photo').src;assert.equal(view.source,app.get('photo'));assert.equal(view.shown,true);app.changeStudio('photo',2);const refreshes=view.refreshes;assert.equal(app.gesturePhoto({grain:5,contrast:2.2,scale:2,x:8,y:-4}),true);assert.deepEqual(view.tone,{grain:5,contrast:2.2});assert.ok(view.refreshes>refreshes);
  await app.get('save').emit('click');await app.get('print').emit('click');for(const output of [app.encodedSnapshots.at(-1),app.printCalls[0].image]){assert.equal(output.style,1);assert.deepEqual(output.tone,{grain:5,contrast:2.2});assert.equal(output.photo,true)}assert.deepEqual(view.snapshots.slice(-2).map(call=>call.native),[true,false]);assert.equal(view.snapshots.at(-2).pose.scale,2);assert.equal(app.sceneCalls.length,0);assert.equal(app.urls.get(url),blob);assert.equal(app.get('photo').src,url);
  await app.get('reset').emit('click');assert.equal(view.shown,false);await app.get('last-photo').emit('click');assert.equal(view.shown,true);assert.equal(view.sources.length,1);await app.emit('pagehide');assert.equal(view.disposed,true);
});

test('live Bayer and three-finger tone carry into the capture while suppressing gesture fallthrough',async()=>{
  const app=harness({image:0}),finder=app.finders[0],view=app.photoViews[0];assert.equal(finder.style,3);assert.equal(view.style,3);await app.get('capture-plane').emit('click');app.changeStudio('photo',3);assert.equal(finder.style,1);assert.equal(app.gestureLive({grain:4,contrast:1.8}),true);assert.deepEqual(finder.tone,{grain:4,contrast:1.8});await app.get('capture-plane').emit('click');assert.equal(view.sources.length,0);assert.equal(app.get('studio').className,'studio camera');await app.tick(401);await app.get('capture-plane').emit('click');assert.equal(view.sources.length,1);assert.equal(view.style,1);assert.deepEqual(view.tone,{grain:4,contrast:1.8});assert.equal(app.photoGestureState.grain,4);assert.equal(app.gestureLive({grain:1}),false);app.gesturePhoto({grain:2,contrast:2});assert.deepEqual(finder.tone,{grain:2,contrast:2});assert.equal(app.liveGestureState.grain,2);assert.equal(app.sceneCalls.length,0);
});

test('a pending splat can finish behind the photo without taking over the chosen image type',async()=>{
  const pending=deferred(),app=harness({image:0,scene:()=>pending.promise});await photoFromDevice(app);app.changeStudio('image',1);await app.tick(0);
  const signal=app.sceneCalls[0].signal;app.changeStudio('image',0);await app.tick(0);
  assert.equal(signal.aborted,false);assert.equal(app.get('studio').className,'studio done');
  pending.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(app.get('studio').className,'studio done');
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').classList.contains('hidden'),false);
});

test('rapid image switches share pending splats and reopening the same photo uses the cached result',async()=>{
  const pending=deferred();let disposed=false;const app=harness({image:0,scene:()=>pending.promise});await photoFromDevice(app);
  app.changeStudio('image',1);await app.tick(0);app.changeStudio('image',0);app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);
  const url=app.get('photo').src;await app.get('reset').emit('click');assert.equal(app.sceneCalls[0].signal.aborted,false);assert.equal(app.revoked.includes(url),false);
  pending.resolve({dispose(){disposed=true}});await app.tick(0);assert.equal(disposed,false);assert.equal(app.get('studio').className,'studio camera');
  assert.equal(app.get('last-photo').hidden,false);await app.get('last-photo').emit('click');assert.equal(app.get('studio').className,'studio done');assert.equal(app.sceneCalls.length,1);assert.equal(app.get('photo').src,url);
});

test('holding a normal photo prints the monochrome photo snapshot without starting a model',async()=>{
  const app=harness({image:0});await photoFromDevice(app);await app.get('studio').emit('pointerdown');await app.tick(500);await app.get('studio').emit('pointerup');
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image.photo,true);assert.equal(app.printCalls[0].image.width,384);assert.equal(app.sceneCalls.length,0);
});

test('a persisted page return keeps the photo, cached scene and printer client',async()=>{
  let disposed=false;const app=harness({image:1,scene:async()=>({dispose(){disposed=true}})});await photoFromDevice(app);const url=app.get('photo').src;
  await app.emit('pagehide',{persisted:true});assert.equal(disposed,false);assert.equal(app.printDisposed,false);assert.equal(app.sceneCalls[0].signal.aborted,false);
  await app.emit('pageshow',{persisted:true});await app.tick(0);assert.equal(app.get('photo').src,url);assert.equal(app.sceneCalls.length,1);
  app.changeStudio('image',0);app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);
});

test('replacing a photograph retires the old calculation and keeps the new photo selected',async()=>{
  const pending=deferred();let disposed=false;const app=harness({image:0,scene:()=>pending.promise});await photoFromDevice(app);const oldUrl=app.get('photo').src;
  app.changeStudio('image',1);await app.tick(0);app.changeStudio('image',0);const replacement=await photoFromDevice(app,new Blob(['second-jpeg'],{type:'image/jpeg'}));
  assert.equal(app.sceneCalls[0].signal.aborted,true);assert.ok(app.revoked.includes(oldUrl));assert.equal(app.urls.get(app.get('photo').src),replacement);
  pending.resolve({dispose(){disposed=true}});await app.tick(0);assert.equal(disposed,true);assert.equal(app.get('studio').className,'studio done');assert.equal(app.get('photo').hidden,false);
});

test('a late photo decode cannot undo a reset or start inference',async()=>{
  const pending=deferred(),app=harness({image:1,decode:()=>pending.promise});await photoFromDevice(app);const url=app.get('photo').src;
  await app.get('reset').emit('click');pending.resolve();await app.tick(0);assert.equal(app.get('studio').className,'studio camera');assert.equal(app.sceneCalls.length,0);assert.ok(app.revoked.includes(url));
});

test('retrying an unreadable photo returns to the camera and the next photo needs no model',async()=>{
  let reads=0;const app=harness({image:0,decode:()=>{if(++reads===1)throw new Error('unreadable JPEG')}});
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
  let encoded;const app=harness({image:0,toBlob:callback=>encoded=callback});await app.get('capture-plane').emit('click');await app.get('capture-plane').emit('click');const fresh=await photoFromDevice(app,new Blob(['new'],{type:'image/png'})),url=app.get('photo').src;
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
  const app=harness({image:0});await photoFromDevice(app);assert.equal(app.get('print').hidden,false);
  await app.get('print').emit('click');assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image.photo,true);
  await app.get('reset').emit('click');assert.equal(app.get('print').hidden,true);assert.equal(app.printCalls[0].isCurrent(),false);
});

test('changing image type in the camera preserves live composition and defers inference',async()=>{
  const app=harness();await photoFromDevice(app);await app.get('reset').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('studio').className,'studio camera');assert.equal(app.sceneCalls.length,0);assert.equal(app.get('finder').classList.contains('hidden'),false);
  await app.get('last-photo').emit('click');assert.equal(app.sceneCalls.length,1);assert.equal(app.get('studio').className,'studio done');
});

test('camera permission failure arriving after reopening a saved result cannot replace it',async()=>{
  const pending=deferred(),app=harness({image:0,media:()=>pending.promise});await photoFromDevice(app);await app.get('reset').emit('click');
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
  const flags=[],native={width:20,height:30,data:new Uint8ClampedArray(20*30*4)},app=harness({image:1,scene:async()=>({dispose(){},snapshot:flag=>{flags.push(flag);return native}})});await photoFromDevice(app);flags.length=0;await app.get('save').emit('click');assert.deepEqual(flags,[true]);assert.equal(app.encodedSnapshots.at(-1),native);assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.saves[0].isCurrent(),true);
  await app.get('reset').emit('click');assert.equal(app.saves[0].isCurrent(),false);await photoFromDevice(app,new Blob(['replacement'],{type:'image/jpeg'}));assert.equal(app.saves[0].isCurrent(),false);
});

test('an unchanged live viewport tone does not delay opening the camera',async()=>{
  const app=harness({image:0});
  assert.equal(app.gestureLive({grain:1,contrast:1}),true);
  await app.get('capture-plane').emit('click');
  assert.equal(app.mediaRequests,1);
});
test('an intentional live tone adjustment still defers accidental capture',async()=>{
  const app=harness({image:0});
  assert.equal(app.gestureLive({grain:2}),true);
  await app.get('capture-plane').emit('click');
  assert.equal(app.mediaRequests,0);
  await app.tick(401);
  await app.get('capture-plane').emit('click');
  assert.equal(app.mediaRequests,1);
});

test('depth art uses the captured blob once and saves and prints the cached rendered pixels',async()=>{
  const app=harness({image:2}),blob=await photoFromDevice(app),view=app.artViews[0];
  assert.equal(app.artCalls.length,1);assert.equal(app.artCalls[0].blob,blob);assert.equal(app.sceneCalls.length,0);assert.equal(app.get('marigold-view').hidden,false);
  await app.get('save').emit('click');assert.equal(app.saves.length,1);assert.equal(app.saves[0].blob.type,'image/png');await app.get('print').emit('click');assert.equal(app.encodedSnapshots.at(-1).depthArt,true);assert.equal(app.printCalls[0].image.depthArt,true);assert.deepEqual(view.snapshots.slice(-2).map(call=>call.native),[true,false]);
  app.changeStudio('image',0);app.changeStudio('image',2);await app.tick(0);assert.equal(app.artCalls.length,1);
  await app.get('recenter').emit('click');assert.equal(view.tones,1);
  await app.get('reset').emit('click');await app.get('last-photo').emit('click');assert.equal(app.artCalls.length,1);assert.equal(app.get('marigold-view').hidden,false);
});
test('a pending depth result cannot take over another mode and a new photo aborts its old prediction',async()=>{
  const pending=deferred(),app=harness({image:0,art:()=>pending.promise});await photoFromDevice(app);app.changeStudio('image',2);await app.tick(0);app.changeStudio('image',0);
  pending.resolve({model:'Test model'});await app.tick(0);assert.equal(app.get('marigold-view').hidden,true);assert.equal(app.get('photo').hidden,false);
  app.changeStudio('image',2);await app.tick(0);assert.equal(app.artCalls.length,1);assert.equal(app.get('marigold-view').hidden,false);
  const second=deferred(),other=harness({image:2,art:()=>second.promise});await photoFromDevice(other);other.changeStudio('image',0);await photoFromDevice(other,new Blob(['new'],{type:'image/jpeg'}));assert.equal(other.artCalls[0].signal.aborted,true);second.resolve({model:'Stale'});await other.tick(0);assert.equal(other.get('marigold-view').hidden,true);assert.equal(other.get('photo').hidden,false);
});
test('depth art exposes no cloud refinement action and disposes on exit',async()=>{
  const app=harness({image:2});await photoFromDevice(app);
  assert.equal(app.artViews[0].binding.onMarigoldRequest,undefined);assert.equal(app.artCalls[0].settings,undefined);assert.equal(app.studioControls.image,2);
  await app.emit('pagehide');assert.equal(app.artViews[0].disposed,true);
});

test('master export retains raw values and identity while changing the expression',async()=>{
  const app=harness({image:2}),blob=await photoFromDevice(app);
  await app.get('save').emit('click');
  const first=await app.saves[0].options.document();
  assert.equal(first.left,blob);assert.equal(first.result.quantity,'relative-depth');assert.equal(first.result.units,'relative');
  assert.deepEqual(first.result.depth,Float32Array.of(.1,.2,.6,.9));
  app.artViews[0].recipe={preset:3,position:.25,width:1.5};
  const changed=await app.saves[0].options.document();
  assert.equal(first.id,changed.id);assert.equal(first.created,changed.created);assert.equal(changed.recipe.preset,3);
  assert.deepEqual(first.result.depth,changed.result.depth);assert.equal(app.artCalls.length,1);
  assert.equal(app.saves[0].options.isCurrent(),true);
  await app.get('reset').emit('click');assert.equal(app.saves[0].options.isCurrent(),false);
});

test('importing a numerical master restores its expression without running a model',async()=>{
  const left=new Blob(['source'],{type:'image/jpeg'}),preview=new Blob(['preview'],{type:'image/png'});
  const stored=createEntropiDocument({left,preview,result:{width:2,height:2,depth:Float32Array.of(1.25,2.75,4.5,NaN),polarity:'near'},recipe:{preset:4,position:-.2,width:2}});
  const app=harness({importDocument:stored});
  await app.get('phone-vault-import').emit('click');
  assert.equal(app.get('studio').className,'studio done');assert.equal(app.artCalls.length,0);assert.equal(app.sceneCalls.length,0);
  assert.deepEqual(app.artViews[0].recipe,stored.recipe);
  await app.get('save').emit('click');const exported=await app.saves[0].options.document();
  assert.equal(exported.id,stored.id);assert.equal(exported.left,left);assert.deepEqual(exported.result.depth,stored.result.depth);
});

function archiveFixture(){
  const records=new Map(),writes=[],previewWrites=[],removed=[];let nextId=0;
  const state={failSave:false,failRemove:false,blockedSave:null,blockedRemove:null,records,writes,previewWrites,removed,archive:{
    async save(left,right=null,preview=left){const id='capture-'+ ++nextId;records.set(id,{id,left,right,created:nextId,preview,pending:!preview});return {id}},
    async saveDocument(document,id=document.id){writes.push({document,id});if(state.failSave)throw new DOMException('Storage full','QuotaExceededError');if(state.blockedSave)await state.blockedSave.promise;const previous=records.get(id);records.set(id,{id,left:document.left,right:document.right,document,created:previous?.created??nextId++,preview:document.preview});return {id}},
    async savePreview(id,preview){const record=records.get(id);if(!record)return null;previewWrites.push({id,preview});record.preview=preview;record.pending=false;return {id}},
    async list(){return [...records.values()].filter(record=>!record.pending).map(({id,created,preview})=>({id,created,preview}))},
    async get(id){return records.get(id)},
    async remove(id){if(state.failRemove)throw new Error('Delete failed');if(state.blockedRemove)await state.blockedRemove.promise;removed.push(id);records.delete(id);state.failSave=false}
  }};return state;
}

test('the archive displays and saves the current processed photo while retaining its original',async()=>{
  const store=archiveFixture(),app=harness({image:0,archive:store.archive}),original=await photoFromDevice(app);
  const record=store.records.get('capture-1'),first=record.preview;
  assert.equal(record.left,original);assert.notEqual(first,original);assert.equal(first.type,'image/png');assert.equal(record.pending,false);
  app.changeStudio('photo',2);app.gesturePhoto({grain:5,contrast:2,scale:2,x:8,y:-4});await app.tick(301);
  assert.notEqual(record.preview,first);assert.equal(record.left,original);assert.equal(app.encodedSnapshots.at(-1).style,1);assert.equal(app.photoViews[0].snapshots.at(-1).pose.scale,2);
  await app.get('open-gallery').emit('click');const tile=app.get('phone-vault-grid').children[0];
  assert.equal(app.urls.get(tile.children[0].src),record.preview);await tile.emit('click');
  assert.equal(app.urls.get(app.get('phone-vault-image').src),record.preview);
  await app.get('phone-vault-save').emit('click');assert.equal(app.saves.at(-1).blob,record.preview);assert.equal(app.saves.at(-1).options.document,undefined);
});

test('the archive publishes the native rendered splat and updates its current style without inference',async()=>{
  let level=0;
  const store=archiveFixture(),app=harness({image:1,archive:store.archive,scene:async()=>({dispose(){},setPrimitiveLevel(value){level=value},snapshot(native){return {splat:true,native,level,width:4,height:6,data:new Uint8ClampedArray(96)}}})}),original=await photoFromDevice(app);
  const record=store.records.get('capture-1');assert.equal(record.left,original);assert.equal(record.preview.type,'image/png');assert.equal(app.encodedSnapshots.at(-1).splat,true);assert.equal(app.encodedSnapshots.at(-1).native,true);
  const first=record.preview;app.changeStudio('primitive',2);await app.tick(301);
  assert.notEqual(record.preview,first);assert.equal(app.encodedSnapshots.at(-1).level,2);assert.equal(app.sceneCalls.length,1);assert.equal(record.left,original);
});

test('unfinished depth captures retain the original privately until their processed preview is ready',async()=>{
  const pending=deferred(),store=archiveFixture(),app=harness({image:2,archive:store.archive,art:()=>pending.promise}),original=await photoFromDevice(app);
  const record=store.records.get('capture-1');assert.equal(record.left,original);assert.equal(record.pending,true);assert.equal(record.preview,null);assert.equal((await store.archive.list()).length,0);
  pending.resolve({model:'Test depth',width:2,height:2,depth:Float32Array.of(.1,.2,.6,.9),polarity:'near'});await flush();
  const finished=store.records.get('capture-1');assert.equal(finished.left,original);assert.equal(finished.preview.type,'image/png');assert.equal(finished.document.left,original);assert.equal((await store.archive.list()).length,1);assert.equal(app.artCalls.length,1);
});

test('failed autosave keeps the capture archive identity for the next successful update',async()=>{
  const store=archiveFixture(),app=harness({archive:store.archive});await photoFromDevice(app);
  const initial=store.writes.length;store.failSave=true;app.artViews[0].binding.onChange();await app.tick(400);
  store.failSave=false;app.artViews[0].binding.onChange();await app.tick(400);
  assert.equal(store.writes.length,initial+2);assert.equal(store.writes.at(-2).id,'capture-1');assert.equal(store.writes.at(-1).id,'capture-1');
  assert.equal(store.records.size,1);assert.ok(store.records.get('capture-1').document);
});

test('deleting after a failed autosave does not resurrect the capture when space is freed',async()=>{
  const store=archiveFixture(),app=harness({archive:store.archive});await photoFromDevice(app);
  store.failSave=true;app.artViews[0].binding.onChange();await app.tick(400);
  await app.get('open-gallery').emit('click');await app.get('phone-vault-grid').children[0].emit('click');
  const writes=store.writes.length;
  await app.get('phone-vault-remove').emit('click');await app.get('phone-vault-remove').emit('click');
  assert.deepEqual(store.removed,['capture-1']);assert.equal(store.records.size,0);assert.equal(store.writes.length,writes);
  app.artViews[0].binding.onChange();await app.tick(400);assert.equal(store.writes.length,writes);assert.equal(store.records.size,0);
});

test('failed deletion restores autosaving for the still-existing capture',async()=>{
  const store=archiveFixture(),app=harness({archive:store.archive});await photoFromDevice(app);
  await app.get('open-gallery').emit('click');await app.get('phone-vault-grid').children[0].emit('click');
  store.failRemove=true;const writes=store.writes.length;
  await app.get('phone-vault-remove').emit('click');await app.get('phone-vault-remove').emit('click');
  assert.equal(app.get('phone-vault-status').textContent,'Delete failed');assert.equal(store.records.size,1);
  app.artViews[0].recipe={preset:4,position:.3,width:2};app.artViews[0].binding.onChange();await app.tick(400);
  assert.equal(store.writes.length,writes+1);assert.equal(store.writes.at(-1).id,'capture-1');assert.equal(store.records.get('capture-1').document.recipe.preset,4);
});

test('deletion waits for an in-flight autosave and cancels queued updates for that capture',async()=>{
  const store=archiveFixture(),app=harness({archive:store.archive});await photoFromDevice(app);
  await app.get('open-gallery').emit('click');await app.get('phone-vault-grid').children[0].emit('click');
  store.blockedSave=deferred();app.artViews[0].binding.onChange();await app.tick(400);
  app.artViews[0].binding.onChange();await app.tick(400);const writes=store.writes.length;
  await app.get('phone-vault-remove').emit('click');await app.get('phone-vault-remove').emit('click');assert.equal(store.removed.length,0);
  store.blockedSave.resolve();store.blockedSave=null;await flush();
  assert.deepEqual(store.removed,['capture-1']);assert.equal(store.records.size,0);assert.equal(store.writes.length,writes);
});

test('a delayed deletion failure cannot resume autosaving a replacement capture that was deleted',async()=>{
  const store=archiveFixture(),app=harness({archive:store.archive});await photoFromDevice(app);
  await app.get('open-gallery').emit('click');await app.get('phone-vault-grid').children[0].emit('click');
  const pending=store.blockedRemove=deferred();
  await app.get('phone-vault-remove').emit('click');await app.get('phone-vault-remove').emit('click');store.blockedRemove=null;
  await app.get('phone-vault-close').emit('click');await photoFromDevice(app,new Blob(['replacement'],{type:'image/jpeg'}));
  await app.get('open-gallery').emit('click');await app.get('phone-vault-grid').children[1].emit('click');
  await app.get('phone-vault-remove').emit('click');await app.get('phone-vault-remove').emit('click');
  assert.deepEqual(store.removed,['capture-2']);const writes=store.writes.length;
  pending.reject(new Error('Old deletion failed'));await flush();
  assert.equal(app.get('phone-vault-status').textContent,'');
  app.artViews[0].binding.onChange();await app.tick(400);
  assert.equal(store.writes.length,writes);assert.equal(store.records.has('capture-2'),false);assert.equal(store.records.has('capture-1'),true);
});
