import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/marigold-view.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const photo=new Blob(['jpeg'],{type:'image/jpeg'});
const raw=model=>({depth:Float32Array.of(0,.3,.6,1),width:2,height:2,polarity:'far',model,source:model==='Local model'?'local':'browser',images:new Map()});
function harness({endpoint=null,localFails=false,browserFails=false,photoWidth=2,photoHeight=2}={}){
  const calls={cloud:0,local:0,browser:0},urls=[],renders=[],frames=new Map();let nextFrame=0;
  class Element{
    constructor(){this.children=[];this.events=new Map();this.attributes=new Map();this.dataset={};this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};this.naturalWidth=2;this.naturalHeight=2;this.hidden=false;this.width=2;this.height=2;this.complete=true;this.selectors=new Map()}
    querySelector(name){if(!this.selectors.has(name))this.selectors.set(name,new Element());return this.selectors.get(name)}
    addEventListener(name,handler){this.events.set(name,handler)}
    removeEventListener(name){this.events.delete(name)}
    setAttribute(name,value){this.attributes.set(name,value)}
    removeAttribute(name){this.attributes.delete(name)}
    prepend(child){this.children.unshift(child)}
    appendChild(child){this.children.push(child)}
    append(child){this.children.push(child)}
    replaceChildren(){this.children=[]}
    getContext(){return {createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){},drawImage(){},getImageData:(_,__,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)})}}
    async decode(){}
    remove(){}
    close(){}
    getBoundingClientRect(){return {left:0,width:390}}
    showModal(){throw new Error('Unexpected upload dialog')}
  }
  const host=new Element(),context=vm.createContext({
    document:{createElement:()=>new Element(),body:new Element()},Image:Element,Blob,DOMException,AbortController,
    URL:{createObjectURL:()=>{const url='blob:'+urls.length;urls.push(url);return url},revokeObjectURL(){}},
    requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame},cancelAnimationFrame:id=>frames.delete(id),
    localDepthEndpoint:()=>endpoint,
    runMarigoldV2:async()=>{calls.cloud++;throw new Error('GPU quota exceeded')},
    runLocalDepth:async()=>{calls.local++;if(localFails)throw new Error('Local service unavailable');return raw('Local model')},
    runBrowserDepth:async()=>{calls.browser++;if(browserFails)throw Object.assign(new Error('Klargjer telefonen.'),{code:'PHONE_SETUP_REQUIRED'});return raw('Browser model')},
    normalizeDepth:depth=>depth,toneDepth:(_,width,height,options)=>{renders.push(options);return new Uint8ClampedArray(width*height*4)},decodeSpectral(){throw new Error('Unexpected color map')},
    VATHOGRAPHY_PRESETS:[{label:'Band'},{label:'Mist'},{label:'Abyss'},{label:'Near'},{label:'Planes'}]
  });
  const original=host.querySelector('.mg-original');original.naturalWidth=photoWidth;original.naturalHeight=photoHeight;
  vm.runInContext(source,context);return {view:context.createMarigoldView(host),host,calls,renders,flush(){for(const [id,callback]of [...frames]){frames.delete(id);callback(100)}},emit(name,event){host.events.get(name)?.({target:{closest:()=>false},preventDefault(){},pointerId:1,clientX:100,clientY:100,...event})}};
}

test('local raw depth retains provenance without a cloud request',async()=>{
  const app=harness({endpoint:'/api/depth'}),result=await app.view.process(photo);
  assert.deepEqual(app.calls,{cloud:0,local:1,browser:0});assert.equal(app.view.ready,true);
  assert.equal(result.model,'Local model');assert.equal(result.source,'local');assert.equal(result.fallbackReason,undefined);
  assert.equal(app.host.dataset.model,'Local model');assert.equal(app.view.snapshot(true).width,2);
  app.view.resetTone();app.view.select(1);app.view.snapshot(false);assert.deepEqual(app.calls,{cloud:0,local:1,browser:0});app.view.dispose();
});

test('local service failure uses the browser model and retains the failure reason',async()=>{
  const app=harness({endpoint:'/api/depth',localFails:true}),result=await app.view.process(photo);
  assert.deepEqual(app.calls,{cloud:0,local:1,browser:1});assert.equal(result.model,'Browser model');assert.equal(result.source,'browser');assert.equal(result.fallbackReason,'Local service unavailable');app.view.dispose();
});

test('a legacy cloud selection has no upload action or consent dialog',async()=>{
  const app=harness();
  await app.view.process(photo,undefined,{provider:'marigold'});
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:1});assert.equal(app.view.ready,true);
  assert.equal(app.host.children.some(node=>node.className==='mg-quality'),false);app.view.dispose();
});

test('portable processing preserves the setup action when model cache is missing',async()=>{
  const app=harness({browserFails:true});
  await assert.rejects(app.view.process(photo),error=>error.code==='PHONE_SETUP_REQUIRED');
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:1});assert.equal(app.view.ready,false);app.view.dispose();
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
  assert.deepEqual(app.calls,{cloud:0,local:0,browser:0});assert.equal(app.view.result,result);
  assert.deepEqual({...app.view.recipe},recipe);assert.equal(app.renders.at(-1).preset,3);assert.equal(app.renders.at(-1).position,-.2);assert.equal(app.renders.at(-1).width,1.4);
  app.view.select(4);assert.equal(app.view.result,result);assert.deepEqual(result.depth,raw('Saved model').depth);
  app.view.dispose();
});

test('invalid saved expression is rejected before the current view is discarded',async()=>{
  const app=harness();await app.view.process(photo);const current=app.view.result;
  await assert.rejects(app.view.restore(photo,raw('Saved model'),{preset:40,position:0,width:1}),/Ugyldig/);
  assert.equal(app.view.result,current);assert.equal(app.view.ready,true);app.view.dispose();
});
