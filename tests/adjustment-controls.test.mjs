import test from 'node:test';
import assert from 'node:assert/strict';
import {attachAdjustmentControls} from '../vendor/adjustment-controls.mjs';

function harness(initial={}){
  const changes=[],openChanges=[];let resets=0;
  class Element{
    constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes=new Map();this.listeners=new Map();this.style={};this.hidden=false;this.className='';this.value='';this.focused=0}
    set value(value){this._value=this.type==='range'&&Number.isFinite(Number(value))?String(Math.max(Number(this.min),Math.min(Number(this.max),Number(value)))):String(value)}
    get value(){return this._value}
    setAttribute(key,value){this.attributes.set(key,String(value))}
    getAttribute(key){return this.attributes.get(key)??null}
    appendChild(element){element.parentElement=this;this.children.push(element);return element}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this)}
    addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler)}
    removeEventListener(type,handler){this.listeners.set(type,(this.listeners.get(type)??[]).filter(value=>value!==handler))}
    focus(){this.focused++;this.ownerDocument.activeElement=this}
    emit(type,details={}){const event={target:this,prevented:false,stopped:false,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},...details};for(const handler of this.listeners.get(type)??[])handler(event);return event}
  }
  const document={createElement:tag=>new Element(tag,document)};document.head=document.createElement('head');const root=document.createElement('main');
  const controls=attachAdjustmentControls(root,{initial,onChange:patch=>changes.push(patch),onReset:()=>resets++,onOpenChange:open=>openChanges.push(open)});
  const all=element=>[element,...element.children.flatMap(all)],elements=()=>all(root),find=predicate=>elements().find(predicate),input=name=>find(el=>el.name===name),label=text=>find(el=>el.getAttribute('aria-label')===text);
  return {root,document,controls,changes,openChanges,elements,input,label,get resets(){return resets}};
}

test('the compact panel starts hidden with an accessible icon toggle and every requested control',()=>{
  const app=harness(),toggle=app.label('Juster bilete'),panel=app.elements().find(el=>el.className==='adjustment-panel');
  assert.equal(app.controls.open,false);assert.equal(panel.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(toggle.getAttribute('aria-controls'),panel.id);assert.ok(toggle.innerHTML.includes('<svg'));assert.equal(toggle.textContent,undefined);assert.equal(toggle.getAttribute('data-adjustments'),'');assert.equal(panel.getAttribute('data-adjustments'),'');
  assert.deepEqual(['pixelSize','black','gamma','white','contrast','strength','rotation'].map(key=>[key,app.input(key).min,app.input(key).max,app.input(key).step]),[
    ['pixelSize','1','8','0.1'],['black','0','254','1'],['gamma','0.2','3','0.05'],['white','1','255','1'],['contrast','0.5','3','0.05'],['strength','0','1','0.05'],['rotation','-180','180','1']
  ]);
  assert.deepEqual(app.input('dither').children.map(el=>[el.value,el.textContent]),[['profile','Profil'],['threshold','Terskel'],['bayer','Bayer'],['floyd','Floyd–Steinberg'],['atkinson','Atkinson']]);
  assert.ok(app.elements().some(el=>el.textContent==='Knip: pikselstorleik · Vri: rotasjon'));assert.match(app.document.head.children[0].textContent,/max-height:min\(60dvh/);assert.match(app.document.head.children[0].textContent,/touch-action:pan-y/);
});

test('input and algorithm selection emit only their changed values while updates are silent',()=>{
  const app=harness({pixelSize:3.5,black:20,white:220,gamma:1.3,dither:'floyd'});assert.equal(app.input('pixelSize').value,'3.5');assert.equal(app.input('dither').value,'floyd');assert.equal(app.changes.length,0);
  app.input('gamma').value='1.8';app.input('gamma').emit('input');app.input('dither').value='atkinson';app.input('dither').emit('change');assert.deepEqual(app.changes,[{gamma:1.8},{dither:'atkinson'}]);
  app.controls.update({strength:.45,pixelSize:6.25,rotation:370});assert.equal(app.input('strength').getAttribute('aria-valuetext'),'45 %');assert.equal(app.input('pixelSize').getAttribute('aria-valuetext'),'6.25 px');assert.equal(app.input('rotation').value,'10');assert.equal(app.changes.length,2);
  app.input('rotation').value='180';app.input('rotation').emit('input');assert.deepEqual(app.changes.at(-1),{rotation:180});assert.equal(app.input('rotation').value,'180');
});

test('black and white endpoints cannot cross and invalid values preserve current controls',()=>{
  const app=harness({black:100,white:200});assert.equal(app.input('black').max,'199');assert.equal(app.input('white').min,'101');
  app.input('black').value='250';app.input('black').emit('input');assert.deepEqual(app.changes.at(-1),{black:199});assert.equal(app.input('white').min,'200');
  app.input('white').value='10';app.input('white').emit('input');assert.deepEqual(app.changes.at(-1),{white:200});
  app.controls.update({black:250,white:100,pixelSize:Infinity,gamma:NaN,dither:'unknown'});assert.equal(app.input('black').value,'99');assert.equal(app.input('white').value,'100');assert.equal(app.input('pixelSize').value,'1');assert.equal(app.input('gamma').value,'1');assert.equal(app.input('dither').value,'profile');
  app.controls.update({black:150,white:220});assert.equal(app.input('black').value,'150');assert.equal(app.input('white').value,'220');
  app.controls.update({black:0,white:20});assert.equal(app.input('black').value,'0');assert.equal(app.input('white').value,'20');
});

test('open, Escape and explicit close coordinate focus without activating page shortcuts',()=>{
  const app=harness(),toggle=app.label('Juster bilete'),close=app.label('Lukk justeringar'),panel=app.elements().find(el=>el.className==='adjustment-panel');
  toggle.emit('click');assert.equal(app.controls.open,true);assert.equal(panel.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(app.document.activeElement,close);
  const escape=panel.emit('keydown',{key:'Escape'});assert.equal(escape.prevented,true);assert.equal(escape.stopped,true);assert.equal(app.controls.open,false);assert.equal(app.document.activeElement,toggle);assert.deepEqual(app.openChanges,[true,false]);
  toggle.emit('click');const space=panel.emit('keydown',{key:' '});assert.equal(space.stopped,true);assert.equal(space.prevented,false);assert.equal(app.controls.open,true);close.emit('click');assert.equal(app.controls.open,false);app.controls.close();assert.deepEqual(app.openChanges,[true,false,true,false]);
});

test('native range gestures retain default behavior and cannot bubble into capture or print',()=>{
  const app=harness(),panel=app.elements().find(el=>el.className==='adjustment-panel'),toggle=app.label('Juster bilete');
  for(const element of [panel,toggle])for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick']){
    const event=element.emit(type,{target:app.input('black')});assert.equal(event.stopped,true,type);assert.equal(event.prevented,false,type);
  }
  const menu=panel.emit('contextmenu');assert.equal(menu.prevented,true);assert.equal(menu.stopped,true);
});

test('reset delegates to application state and context never disables working controls',()=>{
  const app=harness({black:40}),panel=app.elements().find(el=>el.className==='adjustment-panel');app.label('Nullstill justeringar').emit('click');assert.equal(app.resets,1);assert.equal(app.input('black').value,'40');assert.equal(app.changes.length,0);
  for(const context of ['camera','photo','depth']){app.controls.setContext(context);assert.equal(panel.getAttribute('data-context'),context);assert.ok(app.elements().filter(el=>['INPUT','SELECT'].includes(el.tagName)).every(el=>!el.disabled))}
});

test('dispose closes the panel and releases every node and listener without late callbacks',()=>{
  const app=harness(),toggle=app.label('Juster bilete'),gamma=app.input('gamma');toggle.emit('click');app.controls.dispose();app.controls.dispose();assert.equal(app.root.children.length,0);assert.equal(app.document.head.children.length,0);assert.equal(app.controls.open,false);assert.deepEqual(app.openChanges,[true,false]);
  gamma.value='2';gamma.emit('input');toggle.emit('click');app.controls.update({gamma:2});app.controls.setContext('depth');app.controls.close();assert.equal(app.changes.length,0);assert.deepEqual(app.openChanges,[true,false]);
});
