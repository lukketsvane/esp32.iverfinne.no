import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/studio.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');

function harness(options={}){
  let now=1000,gestures=0,nextTimer=0;
  const events=new Map(),changes=[],timers=new Map();
  class Element{
    constructor(tag='DIV'){this.tagName=tag.toUpperCase();this.className='';this.children=[];this.attributes=new Map();this.listeners=new Map();this.classes=new Set();this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),toggle:(name,active)=>{if(active??!this.classes.has(name))this.classes.add(name);else this.classes.delete(name)},contains:name=>this.classes.has(name)}}
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

test('photo starts with two image buttons and four accessible photo styles',()=>{
  const app=harness();assert.equal(app.controls.image,0);assert.equal(app.controls.primitive,0);assert.equal(app.controls.photo,1);assert.equal('quality'in app.controls,false);
  for(let i=0;i<2;i++){
    const image=app.rail('image',i),primitive=app.rail('primitive',i);assert.equal(image.children.length,2);assert.equal(primitive.children.length,4);
    assert.equal(image.getAttribute('aria-label'),'Bilettype');assert.deepEqual(image.children.map(button=>button.getAttribute('aria-label')),['Svart-kvittfoto','Splats']);assert.deepEqual(image.children.map(button=>button.getAttribute('aria-pressed')),['true','false']);
    assert.equal(image.children[0].children[0].tagName,'I');assert.notEqual(primitive.hidden,true);assert.ok(primitive.children.every(button=>!button.disabled));assert.equal(app.roots[i].children.some(element=>element.tagName==='INPUT'),false);
    assert.equal(primitive.getAttribute('aria-label'),'Svartkvitt-stil');assert.deepEqual(primitive.children.map(button=>button.getAttribute('aria-label')),['Atkinson','Floyd–Steinberg','Bayer','Svart-kvitt']);assert.deepEqual(primitive.children.map(button=>button.getAttribute('aria-pressed')),['false','false','true','false']);
  }
});

test('native mouse and keyboard button activation selects once without the touch capture handler',()=>{
  const app=harness(),button=app.rail('image').children[1],target=button.children[0];
  assert.equal(app.emit('pointerdown',{clientX:386,clientY:633,target}).prevented,false);assert.equal(app.emit('pointerup',{target}).prevented,false);app.click('image',1);assert.equal(app.controls.image,1);assert.deepEqual(app.changes,[['image',1]]);
  app.click('image',0,{detail:0});assert.equal(app.controls.image,0);assert.deepEqual(app.changes,[['image',1],['image',0]]);assert.equal(app.gestures,2);
  assert.equal(app.rail('image',1).children[0].getAttribute('aria-pressed'),'true');
});

test('returning to photo mode updates both rails while preserving photo and splat style',()=>{
  const app=harness();app.click('primitive',0);app.click('image',1);app.click('primitive',1);
  app.controls.setImage(0);app.controls.setImage(0);
  assert.equal(app.controls.image,0);assert.equal(app.controls.photo,3);assert.equal(app.controls.primitive,2);
  assert.deepEqual(app.changes,[['photo',3],['image',1],['primitive',2],['image',0]]);
  for(let i=0;i<2;i++){assert.deepEqual(app.rail('image',i).children.map(button=>button.getAttribute('aria-pressed')),['true','false']);assert.equal(app.rail('primitive',i).getAttribute('aria-label'),'Svartkvitt-stil');assert.equal(app.rail('primitive',i).children[0].getAttribute('aria-pressed'),'true')}
});

test('photo and splat styles keep independent selections and mode-specific labels on both roots',()=>{
  const app=harness();app.click('primitive',2);assert.equal(app.controls.photo,1);assert.equal(app.controls.primitive,0);
  app.click('image',1);app.click('primitive',1);assert.equal(app.controls.primitive,2);assert.equal(app.controls.photo,1);
  for(let i=0;i<2;i++){const rail=app.rail('primitive',i);assert.equal(rail.getAttribute('aria-label'),'Pikselstil');assert.deepEqual(rail.children.map(button=>button.getAttribute('aria-label')),['Grøn fosfor','CGA: fire fargar','EGA: seksten fargar','C64-fargar']);assert.equal(rail.children[1].getAttribute('aria-pressed'),'true')}
  app.click('image',0);for(let i=0;i<2;i++){const rail=app.rail('primitive',i);assert.equal(rail.getAttribute('aria-label'),'Svartkvitt-stil');assert.equal(rail.children[2].getAttribute('aria-pressed'),'true');assert.ok(rail.children.every(button=>!button.disabled))}
  app.click('primitive',0);app.click('image',1);assert.equal(app.controls.photo,3);assert.equal(app.controls.primitive,2);assert.equal(app.rail('primitive').children[1].getAttribute('aria-pressed'),'true');
  assert.deepEqual(app.changes,[['image',1],['primitive',2],['image',0],['photo',3],['image',1]]);
});

test('left-edge photo scrubbing selects every black-and-white style without changing the splat style',()=>{
  const app=harness();assert.equal(app.emit('pointerdown',{clientX:4,clientY:100}).prevented,true);
  for(const clientY of [300,500,800])app.emit('pointermove',{clientX:4,clientY});app.emit('pointerup',{clientX:4});
  assert.deepEqual(app.changes,[['photo',3],['photo',2],['photo',1],['photo',0]]);assert.equal(app.controls.primitive,0);
});

test('edge dragging retains two image zones and four independent style levels',()=>{
  const app=harness();app.emit('pointerdown',{clientX:386,clientY:500});assert.equal(app.controls.image,1);app.emit('pointermove',{clientX:386,clientY:421});assert.equal(app.controls.image,0);app.emit('pointermove',{clientX:386,clientY:422});assert.equal(app.controls.image,1);app.emit('pointerup',{clientX:386});
  app.emit('pointerdown',{clientX:4,clientY:100});assert.equal(app.controls.primitive,3);app.emit('pointermove',{clientX:4,clientY:800});assert.equal(app.controls.primitive,0);app.emit('pointerup',{clientX:4});
  assert.deepEqual(app.changes,[['image',1],['image',0],['image',1],['primitive',3],['primitive',0]]);
});

test('an unchanged choice clears a pending scene tap and its icon feedback expires',()=>{
  const app=harness();app.click('image',0);assert.equal(app.gestures,1);assert.equal(app.changes.length,0);
  const hints=app.roots.map(root=>root.children.find(element=>element.tagName==='SPAN'));assert.ok(hints.every(hint=>hint.classList.contains('shown')));assert.match(hints[0].innerHTML,/<svg/);assert.doesNotMatch(hints[0].innerHTML,/Svart|Splats/);
  app.advance(801);assert.ok(hints.every(hint=>!hint.classList.contains('shown')));app.rail('image').children[1].listeners.get('focus')();assert.equal(app.controls.image,0);assert.ok(hints[0].classList.contains('shown'));
});

test('an edge scrub consumes extra fingers and ghost clicks without blocking explicit buttons',()=>{
  const app=harness();let viewerEvents=0;app.window.addEventListener('pointerdown',()=>viewerEvents++);app.emit('pointerdown',{clientX:386,clientY:500});assert.equal(app.emit('pointerdown',{pointerId:2,isPrimary:false,clientX:200}).stopped,true);
  app.emit('pointerup',{clientX:386});assert.equal(app.emit('pointermove',{pointerId:2,isPrimary:false}).stopped,true);app.emit('pointerup',{pointerId:2,isPrimary:false});assert.equal(viewerEvents,0);
  assert.equal(app.emit('click',{clientX:386}).prevented,true);app.click('image',0,{clientX:386});assert.equal(app.controls.image,0);assert.equal(app.emit('click',{clientX:195}).prevented,false);app.advance(500);assert.equal(app.emit('click',{clientX:386}).prevented,false);assert.equal(app.emit('pointerdown').prevented,false);
});

test('a native rail button keeps its click while consuming a second finger until release',()=>{
  const app=harness(),target=app.rail('image').children[1];assert.equal(app.emit('pointerdown',{target,clientX:386}).prevented,false);
  assert.equal(app.emit('pointerdown',{pointerId:2,isPrimary:false}).stopped,true);assert.equal(app.emit('pointermove',{pointerId:2,isPrimary:false}).stopped,true);
  assert.equal(app.emit('pointerup',{target}).prevented,false);app.click('image',1);assert.deepEqual(app.changes,[['image',1]]);
  assert.equal(app.emit('pointermove',{pointerId:2,isPrimary:false}).stopped,true);app.emit('pointerup',{pointerId:2,isPrimary:false});assert.equal(app.emit('pointerdown').prevented,false);
});

test('mouse movement, central touches, auxiliary controls and disabled contexts remain native',()=>{
  const app=harness(),button={closest:selector=>selector.includes('.access-control')?{}:null};for(const details of [{pointerType:'mouse',clientX:4},{clientX:195},{clientX:386,target:button}])assert.equal(app.emit('pointerdown',details).prevented,false);
  const disabled=harness({enabled:()=>false});assert.equal(disabled.emit('pointerdown',{clientX:386}).prevented,false);disabled.click('image',1);assert.equal(disabled.controls.image,0);assert.equal(disabled.gestures,0);
});

test('the native save image dialog keeps edge touches and context menus out of studio ownership',()=>{
  const app=harness(),dialog=new app.Element('DIALOG'),image=new app.Element('IMG');dialog.setAttribute('data-photo-save','');dialog.appendChild(image);
  for(const clientX of [4,386]){const event=app.emit('pointerdown',{clientX,target:image});assert.equal(event.prevented,false);assert.equal(event.stopped,false);assert.equal(app.emit('pointermove',{clientX,target:image}).prevented,false);assert.equal(app.emit('pointerup',{clientX,target:image}).prevented,false)}
  assert.equal(app.changes.length,0);assert.equal(app.gestures,0);
});

test('cancel and disposal release gesture ownership, feedback timers and every mounted control',()=>{
  const app=harness();app.emit('pointerdown',{clientX:386,clientY:500});app.emit('pointercancel',{clientX:386});assert.equal(app.emit('pointerdown').prevented,false);assert.equal(app.timers,1);
  app.controls.dispose();assert.equal(app.timers,0);assert.equal(app.document.head.children.length,0);assert.ok(app.roots.every(root=>root.children.length===0));assert.equal(app.emit('pointerdown',{clientX:386}).prevented,false);
});
