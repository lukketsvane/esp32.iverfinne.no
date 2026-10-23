import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/studio.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');

function harness(options={}){
  let now=1000,gestures=0,nextTimer=0;
  const events=new Map(),changes=[],timers=new Map();
  class Element{
    constructor(tag='DIV'){this.tagName=tag.toUpperCase();this.className='';this.style={};this.children=[];this.attributes=new Map();this.listeners=new Map();this.classes=new Set();this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),toggle:(name,active)=>{if(active??!this.classes.has(name))this.classes.add(name);else this.classes.delete(name)},contains:name=>this.classes.has(name)}}
    setAttribute(name,value){this.attributes.set(name,String(value))}
    getAttribute(name){return this.attributes.get(name)??null}
    appendChild(child){child.parent=this;this.children.push(child);return child}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this)}
    addEventListener(name,listener){this.listeners.set(name,listener)}
    closest(selector){for(const option of selector.split(',')){if(option.startsWith('.')?this.className.split(/\s+/).includes(option.slice(1)):option.startsWith('[')?this.attributes.has(option.slice(1,-1)):this.tagName===option.toUpperCase())return this}return this.parent?.closest(selector)??null}
  }
  const document={head:new Element('HEAD'),createElement:tag=>new Element(tag)};
  const window={innerWidth:390,innerHeight:844,addEventListener(name,listener,options){if(!events.has(name))events.set(name,[]);events.get(name).push({listener,options})},removeEventListener(name,listener){events.set(name,(events.get(name)??[]).filter(item=>item.listener!==listener))}};
  const roots=[new Element(),new Element()],context=vm.createContext({document,window,Date:{now:()=>now},setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source,context);
  const controls=context.attachStudioControls(roots,(kind,level)=>changes.push([kind,level]),options.enabled??(()=>true),()=>gestures++);
  function emit(name,details={}){
    const event={pointerType:'touch',pointerId:1,isPrimary:true,clientX:195,clientY:422,target:roots[0],prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...details};
    for(const {listener} of events.get(name)??[]){listener(event);if(event.stopped)break}
    return event;
  }
  const rail=(kind,index=0)=>roots[index].children.find(element=>element.className.includes(kind+'-rail'));
  function click(kind,index,details={}){const button=rail(kind).children[index];if(button.disabled)return;const event=emit('click',{pointerType:'mouse',target:button.children[0],...details});if(!event.prevented)button.listeners.get('click')()}
  function advance(duration){now+=duration;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}}
  return {roots,controls,changes,document,window,emit,rail,click,advance,Element,get timers(){return timers.size},get gestures(){return gestures}};
}

test('two image modes and nine historical display profiles share the existing edge marks',()=>{
  const app=harness();
  assert.equal(app.controls.image,0);
  assert.equal(app.controls.photo,0);
  assert.equal(app.controls.primitive,0);
  for(let i=0;i<2;i++){
    const image=app.rail('image',i),profiles=app.rail('primitive',i);
    assert.equal(image.children.length,2);
    assert.equal(profiles.children.length,9);
    assert.equal(profiles.getAttribute('aria-label'),'Historisk skjermprofil');
    assert.deepEqual(profiles.children.map(button=>button.getAttribute('aria-label')),Array.from({length:9},(_,index)=>'Profil '+(index+1)));
    assert.deepEqual(profiles.children.map(button=>button.getAttribute('aria-pressed')),['true',...Array(8).fill('false')]);
    assert.equal(app.roots[i].children.some(element=>element.tagName==='INPUT'),false);
  }
});

test('native buttons select historical profiles for photo and depth independently',()=>{
  const app=harness();
  app.click('primitive',2);
  assert.equal(app.controls.photo,2);
  assert.deepEqual(app.changes,[['photo',2]]);
  app.click('image',1);
  app.click('primitive',1);
  assert.equal(app.controls.primitive,1);
  app.click('image',0);
  assert.equal(app.controls.photo,2);
  assert.deepEqual(app.changes,[['photo',2],['image',1],['primitive',1],['image',0]]);
  assert.deepEqual(app.rail('primitive').children.map(button=>button.getAttribute('aria-pressed')),['false','false','true',...Array(6).fill('false')]);
});

test('the left edge scrubs profiles in top-to-bottom order without changing the image type',()=>{
  const app=harness();
  const down=app.emit('pointerdown',{clientX:4,clientY:100});
  assert.equal(down.prevented,true);
  for(const clientY of [300,500,800])app.emit('pointermove',{clientX:4,clientY});
  app.emit('pointerup',{clientX:4});
  assert.deepEqual(app.changes,[['photo',1],['photo',3],['photo',5],['photo',8]]);
  assert.equal(app.controls.primitive,0);
  assert.equal(app.controls.image,0);
});

test('the right edge changes image type and preserves independently selected profiles',()=>{
  const app=harness();
  app.emit('pointerdown',{clientX:386,clientY:500});
  assert.equal(app.controls.image,1);
  app.emit('pointerup',{clientX:386});
  app.click('primitive',3);
  app.click('image',0);
  assert.equal(app.controls.photo,0);
  assert.equal(app.controls.primitive,3);
});

test('profile selections have no visible labels or colored circles',()=>{
  const app=harness();
  for(const i of [1,4,6,7,8])app.click('primitive',i);
  const hints=app.roots.map(root=>root.children.find(element=>element.tagName==='SPAN'));
  assert.ok(hints.every(hint=>!hint.classList.contains('shown')));
  assert.ok(hints.every(hint=>!hint.textContent));
  assert.equal(app.document.head.children.length,1);
  assert.equal(app.timers,0);
  app.click('image',1);
  assert.ok(hints.every(hint=>hint.innerHTML.includes('<svg')));
});

test('profile controls support keyboard focus without changing the selected value',()=>{
  const app=harness(),button=app.rail('primitive').children[3];
  button.listeners.get('focus')();
  assert.equal(app.controls.photo,0);
  const hint=app.roots[0].children.find(element=>element.tagName==='SPAN');
  assert.ok(!hint.textContent);
  app.click('primitive',3,{detail:0});
  assert.equal(app.controls.photo,3);
});

test('edge ownership consumes extra fingers and ghost clicks without blocking normal controls',()=>{
  const app=harness();let external=0;
  app.window.addEventListener('pointerdown',()=>external++);
  app.emit('pointerdown',{clientX:386,clientY:500});
  assert.equal(app.emit('pointerdown',{pointerId:2,isPrimary:false}).stopped,true);
  app.emit('pointerup',{clientX:386});
  assert.equal(app.emit('pointermove',{pointerId:2,isPrimary:false}).stopped,true);
  app.emit('pointerup',{pointerId:2,isPrimary:false});
  assert.equal(external,0);
  assert.equal(app.emit('click',{clientX:386}).prevented,true);
  app.click('image',0,{clientX:386});
  app.advance(500);
  assert.equal(app.emit('click',{clientX:386}).prevented,false);
});

test('mouse, central touch, disabled context, and a photo-save dialog are not intercepted',()=>{
  const app=harness(),control={closest:selector=>selector.includes('.access-control')?{}:null};
  for(const details of [{pointerType:'mouse',clientX:4},{clientX:195},{clientX:386,target:control}])assert.equal(app.emit('pointerdown',details).prevented,false);
  const blocked=harness({enabled:()=>false});
  blocked.click('primitive',3);
  assert.equal(blocked.controls.photo,0);
  const dialog=new app.Element('DIALOG'),image=new app.Element('IMG');
  dialog.setAttribute('data-photo-save','');dialog.appendChild(image);
  assert.equal(app.emit('pointerdown',{clientX:4,target:image}).prevented,false);
});

test('adjustment descendants retain native input gestures even during an edge gesture',()=>{
  const app=harness(),panel=new app.Element('SECTION'),input=new app.Element('INPUT');panel.setAttribute('data-adjustments','');panel.appendChild(input);
  app.emit('pointerdown',{clientX:4,clientY:100});const before=app.changes.length;
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel','click']){
    const event=app.emit(name,{clientX:4,clientY:800,target:input,pointerId:2,isPrimary:false});assert.equal(event.prevented,false,name);assert.equal(event.stopped,false,name);
  }
  assert.equal(app.changes.length,before);app.controls.cancel();assert.equal(app.emit('pointermove',{clientX:4,clientY:800}).prevented,false);assert.equal(app.emit('click',{clientX:4}).prevented,false);
});

test('disabling controls mid-gesture cancels edge ownership and suppresses profile changes',()=>{
  let enabled=true;const app=harness({enabled:()=>enabled});app.emit('pointerdown',{clientX:4,clientY:100});const before=app.changes.length;enabled=false;
  for(const name of ['pointerdown','pointermove','pointerup','click'])assert.equal(app.emit(name,{clientX:4,clientY:800}).prevented,false,name);
  app.click('primitive',8);app.click('image',1);assert.equal(app.changes.length,before);enabled=true;
  assert.equal(app.emit('pointermove',{clientX:4,clientY:800}).prevented,false);assert.equal(app.changes.length,before);
  app.emit('pointerdown',{clientX:4,clientY:800});assert.equal(app.controls.photo,8);
});

test('disposal clears the silent rails and event ownership',()=>{
  const app=harness();
  app.click('primitive',2);
  assert.equal(app.timers,0);
  app.controls.dispose();
  assert.equal(app.timers,0);
  assert.equal(app.document.head.children.length,0);
  assert.ok(app.roots.every(root=>root.children.length===0));
  assert.equal(app.emit('pointerdown',{clientX:4}).prevented,false);
});
