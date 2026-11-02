import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhotoEditor} from '../vendor/photo-editor.mjs';
import {PHOTO_PRESETS} from '../vendor/photo-adjustments.mjs';
import {normalizeGeometry,transformPhotoGeometry} from '../vendor/photo-geometry.mjs';

class Node {
  constructor(){this.children=[];this.events={};this.attributes={};this.dataset={};this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}}}
  appendChild(child){this.children.push(child)}
  setAttribute(key,value){this.attributes[key]=value}
  addEventListener(name,fn){this.events[name]=fn}
  removeEventListener(){}
  querySelector(){return null}
  getBoundingClientRect(){return {left:0,top:0,width:390,height:844}}
  focus(){}
  remove(){}
  find(check){if(check(this))return this;for(const child of this.children){const hit=child.find(check);if(hit)return hit}}
}

function mount(source){
  const host=new Node(),compared=[];
  const editor=createPhotoEditor(host,{getPreview:()=>source,onCompare:value=>compared.push(value)});
  const node=name=>host.find(n=>n.className===name);
  const control=(key,value)=>host.find(n=>n.dataset[key]===value);
  const fire=(target,kind='click')=>target.events[kind]({target,preventDefault(){},stopPropagation(){}});
  const adjust=(key,value)=>{editor.open(key);const input=node('mg-edit-range');input.value=String(value);fire(input,'input');editor.commit()};
  return {host,editor,compared,node,control,fire,adjust};
}

test('editor history, persisted looks, suggestions and oriented crop preserve independent photo geometry',()=>{
  const storage=new Map();
  const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const savedStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'document',{value:{createElement:()=>new Node()},configurable:true});
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},configurable:true});
  const source={width:2,height:2,data:new Uint8ClampedArray([24,12,11,255,22,19,16,255,30,22,12,255,20,20,19,255])};
  try{
    const first=mount(source),second=mount(source);
    first.adjust('fade',.24);first.adjust('skinTone',.45);first.adjust('vignette',.3);
    first.editor.undo();assert.equal(first.editor.edits.vignette,0);assert.equal(first.editor.edits.skinTone,.45);
    first.editor.redo();assert.equal(first.editor.edits.vignette,.3);
    first.editor.open('light');first.fire(first.node('mg-edit-compare'));assert.deepEqual(first.compared,[true]);first.editor.cancel();assert.deepEqual(first.compared,[true,false]);
    first.editor.open('preset');
    first.fire(first.control('preset',PHOTO_PRESETS[0].id));first.fire(first.node('mg-preset-favorite'));first.fire(first.node('mg-recipe-save'));first.editor.commit();
    const crop={x:.1,y:.1,width:.4,height:.6};
    second.editor.set({crop},320,240);second.editor.open('preset');
    assert.equal(second.node('mg-recipe-apply').disabled,false);
    second.fire(second.node('mg-recipe-apply'));second.editor.commit();
    assert.equal(second.editor.edits.fade,.24);assert.equal(second.editor.edits.preset,PHOTO_PRESETS[0].id);
    assert.deepEqual(second.editor.edits.crop,crop);
    second.editor.open('crop');second.fire(second.control('transform','turnRight'));second.editor.commit();
    assert.equal(second.editor.edits.geometry.turns,1);
    const rotated=second.editor.edits.crop;assert.ok(Math.abs(rotated.x-.3)<1e-8&&rotated.y===.1&&rotated.width===.6&&rotated.height===.4);
    second.editor.open('preset');const filter=second.node('mg-preset-filter');filter.value='favorites';second.fire(filter,'change');
    assert.equal(second.control('preset',PHOTO_PRESETS[0].id).hidden,false);assert.equal(second.control('preset',PHOTO_PRESETS[1].id).hidden,true);
    second.fire(second.node('mg-suggest'));assert.ok(second.editor.edits.preset);assert.deepEqual(second.editor.edits.crop,rotated);assert.equal(second.editor.edits.geometry.turns,1);
    second.editor.cancel();assert.equal(second.editor.edits.fade,.24);second.editor.undo();assert.deepEqual(second.editor.edits.crop,crop);
    // A quarter turn or mirror after perspective/straighten must orient the edited pixels too.
    const samples=Uint8ClampedArray.from({length:12*8*4},(_,i)=>i%4===3?255:(i*31)%256);
    const tilted=normalizeGeometry({flipX:true,straighten:17,skewX:.3,skewY:-.6});
    const corrected=transformPhotoGeometry(samples,12,8,tilted);
    for(const [action,change] of [['turnRight',{turns:1}],['turnLeft',{turns:3}],['flipX',{flipX:true}],['flipY',{flipY:true}]]){
      second.editor.set({geometry:tilted},12,8);second.editor.open('crop');second.fire(second.control('transform',action));second.editor.commit();
      const actual=transformPhotoGeometry(samples,12,8,second.editor.edits.geometry);
      const expected=transformPhotoGeometry(corrected.data,12,8,normalizeGeometry(change));
      assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);
      assert.ok(actual.data.every((n,i)=>Math.abs(n-expected.data[i])<=1),action);
    }
    first.editor.dispose();second.editor.dispose();
  }finally{
    if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else delete globalThis.document;
    if(savedStorage)Object.defineProperty(globalThis,'localStorage',savedStorage);else delete globalThis.localStorage;
  }
});
