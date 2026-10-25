import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/photo.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
function harness(options={}){
  const urls=new Map(),revoked=[],downloads=[],shares=[],readers=[],canvases=[],timers=[];let focused=0;
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this.style={};this.textContent=''}
    setAttribute(name,value){this.attributes.set(name,String(value))}getAttribute(name){return this.attributes.get(name)??null}removeAttribute(name){this.attributes.delete(name);if(name==='src')this.src=''}
    append(...children){for(const child of children){child.parent=this;this.children.push(child)}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this)}
    showModal(){this.open=true}close(){this.open=false;this.dispatchEvent(new Event('close'))}focus(){focused++}click(){if(this.tagName==='A')downloads.push({url:this.href,name:this.download});this.dispatchEvent(new Event('click'))}
  }
  const body=new Element('body'),focus={focus(){focused++}},document={body,activeElement:focus,querySelector:selector=>selector==='dialog[data-photo-save]'?body.children.find(child=>child.tagName==='DIALOG'&&child.attributes.has('data-photo-save'))??null:null,createElement(tag){
    const element=new Element(tag);
    if(tag==='canvas'){
      const context={drawImage(...args){element.draw=args},getImageData(x,y,width,height){const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i++)data[i]=options.pixels?.[i%options.pixels.length]??0;return {data}},createImageData(width,height){return {data:new Uint8ClampedArray(width*height*4)}},putImageData(pixels){element.pixels=pixels.data.slice()}};
      Object.defineProperty(context,'filter',{set(){throw new Error('Canvas filter is unsupported')}});element.getContext=()=>options.noContext?null:context;element.toDataURL=type=>{element.encodedType=type;return 'data:image/png;base64,iVBORw0KGgo='};canvases.push(element);
    }
    return element;
  }};
  class FileReader{readAsDataURL(blob){this.blob=blob;readers.push(this);if(!options.deferRead)queueMicrotask(()=>this.complete())}complete(){this.result='data:'+this.blob.type+';base64,cGl4ZWxz';this.onload()}fail(){this.onerror()}}
  class BrowserURL extends URL{static createObjectURL(blob){const url='blob:save/'+urls.size;urls.set(url,blob);return url}static revokeObjectURL(url){revoked.push(url)}}
  const context=vm.createContext({document,navigator:{userAgent:options.apple?'iPhone':'test',canShare:()=>options.canShare??false,share:value=>{shares.push(value);return options.share?.(value)??Promise.resolve()}},isSecureContext:options.secure??true,URL:BrowserURL,Blob,File:class extends Blob{constructor(parts,name,properties){super(parts,properties);this.name=name}},FileReader,Event,Uint8Array,Uint8ClampedArray,Math,atob,queueMicrotask,setTimeout:callback=>timers.push(callback)});
  vm.runInContext(source,context);
  return {save:context.savePhoto,snapshot:context.photoSnapshot,encode:context.snapshotBlob,document,body,shares,downloads,urls,revoked,readers,canvases,tick(){for(const callback of timers.splice(0))callback()},get focused(){return focused},get dialog(){return document.querySelector('dialog[data-photo-save]')}};
}
const png=()=>new Blob(['rendered PNG'],{type:'image/png'});

 test('PNG encoding and the native share chooser start synchronously in the initiating gesture',async()=>{
  const app=harness({canShare:true}),pixels={width:2,height:1,data:new Uint8ClampedArray([8,8,8,255,90,90,90,255])},blob=app.encode(pixels),saving=app.save(blob,'view.png');
  assert.equal(app.shares.length,1);assert.equal(app.shares[0].files[0].name,'view.png');assert.equal(app.shares[0].files[0].type,'image/png');assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[137,80,78,71,13,10,26,10]);assert.deepEqual(app.canvases[0].pixels,pixels.data);assert.equal(app.canvases[0].encodedType,'image/png');await saving;assert.equal(app.dialog,null);assert.equal(app.urls.size,0);
});

test('native share cancellation never falls through to another save action',async()=>{
  const app=harness({canShare:true,share:async()=>{throw new DOMException('Cancelled','AbortError')}});await app.save(png(),'view.png');assert.equal(app.shares.length,1);assert.equal(app.readers.length,0);assert.equal(app.urls.size,0);assert.equal(app.downloads.length,0);assert.equal(app.dialog,null);
});

test('HTTP saving uses an inline data image with native image actions and cleans up on close',async()=>{
  const app=harness({secure:false,canShare:true});await app.save(png(),'view.png');const dialog=app.dialog,image=dialog.children[0],button=dialog.children[1];assert.equal(app.shares.length,0);assert.equal(app.downloads.length,0);assert.equal(app.urls.size,0);assert.match(image.src,/^data:image\/png;base64,/);assert.match(image.style.cssText,/-webkit-touch-callout:default/);assert.match(image.style.cssText,/filter:none/);assert.match(dialog.children[2].textContent,/Hald inne/);
  const menu=new Event('contextmenu',{cancelable:true});image.dispatchEvent(menu);assert.equal(menu.defaultPrevented,false);assert.equal(dialog.open,true);button.click();assert.equal(image.src,'');assert.equal(app.dialog,null);assert.equal(app.focused,1);
});

test('a failed native share on Apple devices uses the same inline save surface',async()=>{
  const app=harness({apple:true,canShare:true,share:async()=>{throw new Error('Unsupported file share')}});await app.save(png(),'view.png');assert.equal(app.shares.length,1);assert.ok(app.dialog);assert.equal(app.downloads.length,0);
});

test('a delayed file conversion cannot open an obsolete image or duplicate the save dialog',async()=>{
  const app=harness({secure:false,deferRead:true});let current=true;const old=app.save(png(),'old.png',()=>current);current=false;app.readers[0].complete();await old;assert.equal(app.dialog,null);
  const first=app.save(png(),'first.png'),second=app.save(png(),'second.png');app.readers[1].complete();app.readers[2].complete();await Promise.all([first,second]);assert.equal(app.body.children.length,1);assert.equal(app.dialog.children[0].src,'data:image/png;base64,cGl4ZWxz');
});

test('invalid images and failed file reads never create a save surface',async()=>{
  const app=harness({secure:false,deferRead:true});await assert.rejects(app.save(new Blob(['html'],{type:'text/html'})),/ikkje klart/);await app.save(png(),'stale.png',()=>false);assert.equal(app.readers.length,0);
  const saving=app.save(png());app.readers[0].fail();await assert.rejects(saving,/ikkje opnast/);assert.equal(app.dialog,null);assert.equal(app.downloads.length,0);
});

test('desktop download fallback releases its temporary URL after the save',async()=>{
  const app=harness();const blob=png();await app.save(blob,'view.png');assert.equal(app.downloads.length,1);assert.equal(app.downloads[0].name,'view.png');assert.equal(app.urls.get(app.downloads[0].url),blob);assert.equal(app.body.children.length,0);assert.equal(app.revoked.length,0);app.tick();assert.deepEqual(app.revoked,[app.downloads[0].url]);
});

test('photo snapshots retain full RGB values and alpha without a Canvas filter',()=>{
  const app=harness({pixels:[200,10,60,255,0,200,50,128]}),snapshot=app.snapshot({naturalWidth:4,naturalHeight:2},undefined,true);assert.equal(snapshot.width,4);assert.equal(snapshot.height,2);assert.deepEqual([...snapshot.data.slice(0,8)],[200,10,60,255,0,200,50,128]);assert.equal(snapshot.photo,true);
});

test('native photo saves contain only the visible image crop without black viewport margins',()=>{
  const app=harness({pixels:[255,0,0,255]}),image={naturalWidth:8,naturalHeight:6},snapshot=app.snapshot(image,{scale:2,x:1,y:0,width:4,height:8},true);assert.equal(snapshot.width,4);assert.equal(snapshot.height,6);assert.deepEqual(app.canvases[0].draw.slice(1),[1,0,4,6,0,0,4,6]);assert.ok(snapshot.data.every((value,index)=>value===(index%4===0||index%4===3?255:0)));
});
