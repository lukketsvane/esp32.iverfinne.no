import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const application=(await readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const photoSource=(await readFile(new URL('../vendor/photo.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

function harness(options={}){
  let now=1000,nextTimer=0,nextUrl=0,mediaRequests=0,stopped=0;
  const elements=new Map(),events=new Map(),timers=new Map(),urls=new Map(),downloads=[],sceneCalls=[],messages=[],studioBindings=[],printCalls=[],revoked=[];
  const snapshot={width:384,height:1,data:new Uint8ClampedArray(384*4)};let printDisposed=false;
  const studioControls={image:options.image??0,primitive:0,dispose(){}};
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
    click(){if(this.tagName==='A')downloads.push({href:this.href,name:this.download});else void this.emit('click')}
    async decode(){if(options.decode)await options.decode()}
  }
  for(const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    const element=new Element(match[2],match[1].toUpperCase());element.hidden=/\bhidden\b/.test(match[0]);
    if(element.tagName==='IMG'){element.naturalWidth=1600;element.naturalHeight=1200}
    element.className=match[0].match(/\bclass="([^"]+)"/)?.[1]??'';
    for(const name of match[0].match(/\bclass="([^"]+)"/)?.[1].split(/\s+/)??[])element.classes.add(name);
    elements.set(element.id,element);
  }
  elements.get('progress').firstElementChild=new Element('','I');
  Object.assign(elements.get('video'),{videoWidth:640,videoHeight:480,play:async()=>{},pause(){}});
  const document={hidden:options.hidden??false,referrer:options.referrer??'http://192.168.4.1/',getElementById:id=>elements.get(id),addEventListener(name,callback){if(!events.has(name))events.set(name,[]);events.get(name).push(callback)},createElement(tag){
    const element=new Element('',tag.toUpperCase());
    if(tag==='canvas'){element.getContext=()=>({drawImage(){},getImageData:(x,y,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)})});element.toBlob=(callback,type)=>callback(new Blob(['camera-jpeg'],{type}))}
    return element;
  }};
  const media={getTracks:()=>[{stop(){stopped++}}]};
  class BrowserURL extends URL{static createObjectURL(blob){const url='blob:test/'+(++nextUrl);urls.set(url,blob);return url}static revokeObjectURL(url){revoked.push(url)}}
  const context=vm.createContext({
    document,window:{opener,addEventListener:document.addEventListener},URL:BrowserURL,Blob,AbortController,DOMException,
    File:class extends Blob{constructor(parts,name,properties){super(parts,properties);this.name=name}},
    Image:class{naturalWidth=1600;naturalHeight=1200;async decode(){if(options.decode)await options.decode()}},
    navigator:{standalone:options.standalone,mediaDevices:{getUserMedia:async()=>{mediaRequests++;return options.media?await options.media(media):media}}},matchMedia:()=>({matches:!!options.displayStandalone}),
    Viewfinder:class{clear(){}dispose(){}},
    attachStudioControls:(hosts,onChange,enabled,onGesture)=>{studioBindings.push({hosts,onChange,enabled,onGesture});return studioControls},
    PX10Printer:class{},cloudPrintJob:()=>new Uint8Array(),
    createPrintClient:()=>({print:(image,isCurrent)=>{printCalls.push({image,isCurrent});return Promise.resolve(true)},dispose(){printDisposed=true}}),
    createDepthScene:async(host,blob,progress,signal,quality)=>{sceneCalls.push({host,blob,progress,signal,quality});return options.scene?{setPrimitiveLevel(){},snapshot:()=>snapshot,...await options.scene(host,blob,progress,signal,quality)}:{dispose(){},setPrimitiveLevel(){},snapshot:()=>snapshot}},
    performance:{now:()=>now},Date:class extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}},
    setTimeout:(callback,delay=0)=>{const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(photoSource+'\n'+application,context,{filename:'app.mjs'});
  async function tick(duration){now+=duration;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}await flush()}
  async function emit(name,details={}){for(const callback of events.get(name)??[])callback({type:name,...details});await flush()}
  function changeStudio(kind,level){studioControls[kind]=level;for(const binding of studioBindings)binding.onChange(kind,level)}
  function gestureStudio(){for(const binding of studioBindings)binding.onGesture?.()}
  return {get:id=>elements.get(id),opener,sceneCalls,studioControls,changeStudio,gestureStudio,messages,urls,revoked,downloads,printCalls,snapshot,tick,emit,media,async visibility(hidden){document.hidden=hidden;await emit('visibilitychange')},get printDisposed(){return printDisposed},get mediaRequests(){return mediaRequests},get stopped(){return stopped}};
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

test('the result saves the original JPEG and never exposes a 3D download',async()=>{
  const app=harness(),blob=await photoFromDevice(app);
  assert.equal(app.get('studio').className,'studio done');
  await app.get('save').emit('click');
  assert.equal(app.downloads.length,1);
  assert.equal(app.downloads[0].name,'entropi.jpg');
  assert.equal(app.urls.get(app.downloads[0].href),blob);
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

test('model failure keeps the original JPEG available for saving',async()=>{
  const app=harness({image:1,scene:async()=>{throw new Error('Djupnemodellen manglar.')}}),blob=await photoFromDevice(app);
  assert.equal(app.get('studio').className,'studio error');
  assert.match(app.get('status').textContent,/Djupnemodellen manglar/);
  assert.equal(app.get('save').hidden,false);
  await app.get('save').emit('click');
  assert.equal(app.urls.get(app.downloads[0].href),blob);
  assert.equal(app.downloads[0].name,'entropi.jpg');
});

test('a double tap cancels processing and a late result cannot reopen the scene',async()=>{
  const pending=deferred();let disposed=false;
  const app=harness({image:1,scene:()=>pending.promise});await photoFromDevice(app);
  assert.equal(app.get('studio').className,'studio working');
  await tap(app);await app.tick(100);await tap(app);
  assert.equal(app.get('studio').className,'studio camera');
  assert.equal(app.sceneCalls[0].signal.aborted,true);
  pending.resolve({dispose(){disposed=true}});await app.tick(0);
  assert.equal(disposed,true);
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
  const url=app.get('photo').src;assert.equal(app.sceneCalls.length,0);assert.equal(app.studioControls.image,0);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.sceneCalls[0].blob,blob);assert.equal(app.sceneCalls[0].quality,undefined);
  app.changeStudio('primitive',2);assert.equal(styles.at(-1),2);
  app.changeStudio('image',0);await app.tick(0);assert.equal(app.get('photo').src,url);assert.equal(app.get('scene').classList.contains('hidden'),true);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').classList.contains('hidden'),false);
  await app.get('save').emit('click');assert.equal(app.urls.get(app.downloads[0].href),blob);
});

test('a pending splat can finish behind the photo without taking over the chosen image type',async()=>{
  const pending=deferred(),app=harness({scene:()=>pending.promise});await photoFromDevice(app);app.changeStudio('image',1);await app.tick(0);
  const signal=app.sceneCalls[0].signal;app.changeStudio('image',0);await app.tick(0);
  assert.equal(signal.aborted,false);assert.equal(app.get('studio').className,'studio done');
  pending.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('scene').classList.contains('hidden'),true);assert.equal(app.get('studio').className,'studio done');
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').classList.contains('hidden'),false);
});

test('rapid image switches share an in-flight calculation and resetting retires its late result',async()=>{
  const pending=deferred();let disposed=false;const app=harness({scene:()=>pending.promise});await photoFromDevice(app);
  app.changeStudio('image',1);await app.tick(0);app.changeStudio('image',0);app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);
  const url=app.get('photo').src;await app.get('reset').emit('click');assert.equal(app.sceneCalls[0].signal.aborted,true);assert.ok(app.revoked.includes(url));
  pending.resolve({dispose(){disposed=true}});await app.tick(0);assert.equal(disposed,true);assert.equal(app.get('studio').className,'studio camera');
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

test('backgrounding releases the camera and returning resumes it without recapturing',async()=>{
  const app=harness();await app.get('capture-plane').emit('click');await app.visibility(true);assert.equal(app.stopped,1);assert.equal(app.mediaRequests,1);
  await app.visibility(false);assert.equal(app.mediaRequests,2);assert.equal(app.sceneCalls.length,0);assert.equal(app.get('studio').className,'studio camera');
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
