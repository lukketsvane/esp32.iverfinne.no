import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/studio.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');

function harness(options={}){
  let now=1000,gestures=0;
  const events=new Map(),changes=[];
  class Element{
    constructor(tag='DIV'){this.tagName=tag.toUpperCase();this.className='';this.children=[];this.attributes=new Map();this.listeners=new Map();this.classes=new Set();this.classList={toggle:(name,active)=>{if(active??!this.classes.has(name))this.classes.add(name);else this.classes.delete(name)},contains:name=>this.classes.has(name)}}
    setAttribute(name,value){this.attributes.set(name,String(value))}
    getAttribute(name){return this.attributes.get(name)??null}
    appendChild(child){child.parent=this;this.children.push(child);return child}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this)}
    addEventListener(name,listener){this.listeners.set(name,listener)}
    closest(selector){return selector.startsWith('.')?this.className.split(/\s+/).includes(selector.slice(1))?this:null:this.tagName===selector.toUpperCase()?this:null}
  }
  const document={head:new Element('HEAD'),createElement:tag=>new Element(tag)};
  const window={innerWidth:390,innerHeight:844,addEventListener(name,listener,options){if(!events.has(name))events.set(name,[]);events.get(name).push({listener,options})},removeEventListener(name,listener){events.set(name,(events.get(name)??[]).filter(item=>item.listener!==listener))}};
  const roots=[new Element(),new Element()],context=vm.createContext({document,window,Date:{now:()=>now}});
  vm.runInContext(source,context);
  const controls=context.attachStudioControls(roots,(kind,level)=>changes.push([kind,level]),options.enabled??(()=>true),()=>gestures++);
  function emit(name,details={}){
    const event={pointerType:'touch',pointerId:1,isPrimary:true,clientX:195,clientY:422,target:roots[0],prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...details};
    for(const {listener} of events.get(name)??[]){listener(event);if(event.stopped)break}
    return event;
  }
  return {roots,controls,changes,document,window,emit,advance:duration=>{now+=duration},get gestures(){return gestures}};
}

test('both scenes start with four ticks per side, quality two and C64 style',()=>{
  const app=harness();assert.equal(app.controls.quality,2);assert.equal(app.controls.primitive,0);
  for(const root of app.roots){
    const rails=root.children.filter(element=>element.tagName==='DIV'),ranges=root.children.filter(element=>element.tagName==='INPUT');
    assert.equal(rails.length,2);assert.deepEqual(rails.map(rail=>rail.children.length),[4,4]);
    assert.deepEqual(ranges.map(range=>range.value),['2','0']);
    assert.equal(rails[0].children[1].classList.contains('chosen'),true);assert.equal(rails[1].children[3].classList.contains('chosen'),true);
  }
  assert.equal(app.changes.length,0);
});

test('left and right touch edges choose independent four-level controls',()=>{
  const app=harness();
  assert.equal(app.emit('pointerdown',{clientX:4,clientY:100}).prevented,true);
  assert.equal(app.controls.primitive,3);assert.equal(app.controls.quality,2);
  app.emit('pointerup',{clientX:4,clientY:100});app.emit('pointerdown',{clientX:386,clientY:800});
  assert.equal(app.controls.quality,0);assert.equal(app.controls.primitive,3);
  app.emit('pointermove',{clientX:386,clientY:100});assert.equal(app.controls.quality,3);
  assert.deepEqual(app.changes,[['primitive',3],['quality',0],['quality',3]]);
});

test('an unchanged edge choice still clears a previous scene tap and consumes the ghost click',()=>{
  const app=harness(),down=app.emit('pointerdown',{clientX:4,clientY:800});
  assert.equal(app.gestures,1);assert.equal(app.changes.length,0);assert.equal(down.stopped,true);
  app.emit('pointerup',{clientX:4,clientY:800});assert.equal(app.emit('click',{clientX:4,clientY:800}).stopped,true);
  assert.equal(app.emit('click',{clientX:195,clientY:400}).prevented,false);
  app.advance(500);assert.equal(app.emit('click',{clientX:4,clientY:800}).prevented,false);
});

test('a rail gesture consumes all fingers until they lift without leaking an orbit or pinch',()=>{
  const app=harness();let viewerEvents=0;app.window.addEventListener('pointerdown',()=>viewerEvents++);
  app.emit('pointerdown',{clientX:4,clientY:800});
  assert.equal(app.emit('pointerdown',{pointerId:2,isPrimary:false,clientX:200}).stopped,true);
  app.emit('pointermove',{pointerId:2,isPrimary:false,clientX:220,clientY:100});assert.equal(app.controls.primitive,0);
  app.emit('pointerup',{clientX:4,clientY:800});assert.equal(app.emit('pointermove',{pointerId:2,isPrimary:false}).stopped,true);
  app.emit('pointerup',{pointerId:2,isPrimary:false});
  assert.equal(viewerEvents,0);assert.equal(app.emit('pointerdown').prevented,false);assert.equal(viewerEvents,1);
});

test('mouse gestures, central touches, auxiliary controls and disabled screens retain their native interaction',()=>{
  const app=harness(),button={closest:selector=>selector==='.access-control'?{}:null};
  for(const details of [{pointerType:'mouse',clientX:4},{clientX:195},{clientX:4,target:button}])assert.equal(app.emit('pointerdown',details).prevented,false);
  const disabled=harness({enabled:()=>false});assert.equal(disabled.emit('pointerdown',{clientX:4}).prevented,false);
  assert.equal(app.gestures,0);assert.equal(disabled.gestures,0);
});

test('cancel and disposal release the controls and preserve accessible keyboard selection',()=>{
  const app=harness(),range=app.roots[0].children.find(element=>element.tagName==='INPUT');
  range.value='3';range.listeners.get('input')();assert.equal(app.controls.quality,3);
  app.emit('pointerdown',{clientX:4});app.emit('pointercancel',{clientX:4});assert.equal(app.emit('pointerdown').prevented,false);
  app.controls.dispose();assert.equal(app.document.head.children.length,0);assert.equal(app.roots[0].children.length,0);assert.equal(app.roots[1].children.length,0);
  assert.equal(app.emit('pointerdown',{clientX:4}).prevented,false);
});
