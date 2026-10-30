import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/entropi-ui.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const photoSource=(await readFile(new URL('../vendor/photo.mjs',import.meta.url),'utf8')).split('export async function savePhoto')[0].replace(/^export /gm,'');
const png=new Blob(['png'],{type:'image/png'}),masterBlob=new Blob(['master'],{type:'application/x-entropi'}),tiff=new Blob(['tiff'],{type:'image/tiff'}),dng=new Blob(['dng'],{type:'image/dng'});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function harness({photoSave=async()=>{},decode=async()=>({restored:true}),share=null,secure=true,deferredClose=false}={}){
  const calls={upscale:[],encode:[],tiff:[],dng:[],photo:[],decode:[],shares:[],downloads:[],revoked:[],timers:[],focus:0},urls=new Map(),closeEvents=[];let now=1000;
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.attributes=new Map();this.listeners=new Map();this.style={};this.open=false;this.disabled=false;this.textContent='';this.parent=null}
    setAttribute(name,value){this.attributes.set(name,value)}
    getAttribute(name){return this.attributes.get(name)}
    addEventListener(name,handler,options={}){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push({handler,once:options.once})}
    removeEventListener(name,handler){this.listeners.set(name,(this.listeners.get(name)??[]).filter(record=>record.handler!==handler))}
    async emit(name,event={}){for(const record of [...this.listeners.get(name)??[]]){if(record.once)this.listeners.set(name,this.listeners.get(name).filter(item=>item!==record));await record.handler({stopPropagation(){},preventDefault(){},target:this,...event})}}
    append(...elements){for(const element of elements){element.remove();this.children.push(element);element.parent=this}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(element=>element!==this);this.parent=null}
    showModal(){this.open=true}
    show(){this.open=true}
    close(){this.open=false;if(deferredClose)closeEvents.push(()=>this.emit('close'));else void this.emit('close')}
    click(){if(this.disabled)return;if(this.tag==='a')calls.downloads.push({blob:urls.get(this.href),name:this.download});return this.emit('click')}
    focus(){calls.focus++;document.activeElement=this}
    contains(element){return element===this||this.children.some(child=>child.contains(element))}
    closest(selector){for(let element=this;element;element=element.parent)if(selector==='dialog[open]'&&element.tag==='dialog'&&element.open)return element;return null}
    getBoundingClientRect(){if(this.rect)return this.rect;if(this.tag==='button'&&this.parent?.parent?.attributes.has('data-entropi-export')){const dialog=this.parent.parent,full=this.style.gridColumn==='1 / -1',column=full?1:Number(this.style.gridColumn),left=parseFloat(dialog.style.left)+4+(column-1)*52,top=parseFloat(dialog.style.top)+4+(Number(this.style.gridRow)-1)*48,width=full?156:52;return {left,top,right:left+width,bottom:top+48,width,height:48}}return {left:280,top:740,right:328,bottom:788,width:48,height:48}}
  }
  const body=new Element('body'),focus=new Element('button');
  const document=new Element('document');Object.assign(document,{body,activeElement:focus,createElement:tag=>new Element(tag),querySelector:selector=>{const find=node=>node.children.find(element=>element.tag==='dialog'&&element.attributes.has('data-entropi-export'))??node.children.map(find).find(Boolean);return selector==='dialog[data-entropi-export]'?find(body)??null:null}});
  const window=new Element('window');
  const context=vm.createContext({document,Blob,File,TextEncoder,DOMException,AbortController,Date:{now:()=>now},innerWidth:390,innerHeight:844,isSecureContext:secure,addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window),navigator:{canShare:()=>!!share,share:async payload=>{calls.shares.push(payload);return await share(payload)}},
    URL:{createObjectURL:blob=>{const url='blob:'+urls.size;urls.set(url,blob);return url},revokeObjectURL:url=>calls.revoked.push(url)},setTimeout:(handler,time)=>{calls.timers.push({handler,time,active:true});return calls.timers.length-1},clearTimeout:id=>{if(calls.timers[id])calls.timers[id].active=false},
    encodeEntropiDocument:async document=>{calls.encode.push(document);return masterBlob},decodeEntropiDocument:async file=>{calls.decode.push(file);return await decode(file)},
    warmUpscaleAssets:async()=>true,prepareUpscaleAssets:async()=>{},upscaleImage:async(blob,factor)=>{calls.upscale.push({blob,factor});return png},
    encodeRenderedTiff:document=>{calls.tiff.push(document);return tiff},encodeDepthDng:result=>{calls.dng.push(result);return dng},
    savePhoto:async(...args)=>{calls.photo.push(args);return await photoSave(...args)}
  });
  vm.runInContext(photoSource,context);vm.runInContext(source,context);
  return {api:context,calls,body,document,window,element:tag=>new Element(tag),advance:time=>{now+=time},hold:()=>{for(const timer of calls.timers)if(timer.active&&timer.time===360){timer.active=false;timer.handler()}},dialog:()=>document.querySelector('dialog[data-entropi-export]'),input:()=>body.children.find(element=>element.tag==='input'),flushClose:async()=>{for(const close of closeEvents.splice(0))await close()}};
}
function options(dialog){return dialog.children.find(element=>element.tag==='div').children}
function button(dialog,label){return options(dialog).find(element=>element.textContent===label)}
const master=()=>({id:'preserved',left:new Blob(['original'],{type:'image/jpeg'}),result:{depth:Float32Array.of(.123456,.9),width:2,height:1},recipe:{preset:2,position:.2,width:1}});

test('format chooser stays quiet until selection and PNG uses the existing photo save path',async()=>{
  const app=harness();let images=0,documents=0;
  app.api.showExportOptions({name:'capture.jpg',image:()=>{images++;return png},document:()=>{documents++;return master()}});
  const dialog=app.dialog();assert.deepEqual(options(dialog).map(item=>item.textContent),['PNG','.entropi','TIFF','DNG','AI 2×','AI 4×','AI 8×']);assert.equal(images,0);assert.equal(documents,0);
  app.api.showExportOptions({image:()=>png,document:master});assert.equal(app.body.children.length,1);
  await button(dialog,'PNG').click();assert.equal(images,1);assert.equal(documents,0);assert.equal(app.calls.photo[0][0],png);assert.equal(app.calls.photo[0][1],'capture.png');assert.equal(app.calls.downloads.length,0);assert.equal(app.dialog(),null);
});

test('master export preserves the document, TIFF receives its recipe and DNG receives numerical depth',async()=>{
  for(const [label,blob,extension]of [['.entropi',masterBlob,'entropi'],['TIFF',tiff,'tif'],['DNG',dng,'dng']]){
    const app=harness(),document=master(),values=document.result.depth.slice();let renders=0;
    app.api.showExportOptions({name:'capture.png',image:()=>{renders++;return png},document:()=>document});
    await button(app.dialog(),label).click();assert.equal(renders,0);assert.deepEqual(document.result.depth,values);assert.equal(document.id,'preserved');assert.equal(app.calls.downloads[0].blob,blob);assert.equal(app.calls.downloads[0].name,'capture.'+extension);
    if(label==='.entropi')assert.equal(app.calls.encode[0],document);else assert.equal(app.calls[label==='TIFF'?'tiff':'dng'][0],label==='TIFF'?document:document.result);
  }
});

test('changing capture or cancelling while preparing prevents download and duplicate submissions',async()=>{
  for(const action of ['stale','cancel']){
    const app=harness(),pending=deferred();let current=true,reads=0;
    app.api.showExportOptions({image:()=>png,document:()=>{reads++;return pending.promise},isCurrent:()=>current});
    const dialog=app.dialog(),exportButton=button(dialog,'.entropi'),first=exportButton.emit('click'),second=exportButton.emit('click');
    assert.equal(reads,1);assert.ok(options(dialog).every(item=>item.disabled));
    if(action==='stale')current=false;else dialog.close();
    pending.resolve(master());await Promise.all([first,second]);assert.equal(app.calls.downloads.length,0);assert.equal(app.calls.photo.length,0);if(action==='cancel')assert.equal(app.dialog(),null);
  }
});

test('preparation failures keep the chooser available for a successful retry',async()=>{
  const app=harness();let fail=true;
  app.api.showExportOptions({image:()=>png,document:()=>{if(fail)throw new Error('Storage unavailable');return master()}});
  const dialog=app.dialog(),exportButton=button(dialog,'.entropi');await exportButton.click();
  assert.equal(app.dialog(),dialog);assert.equal(dialog.open,true);assert.ok(options(dialog).every(item=>!item.disabled));assert.equal(dialog.children.find(item=>item.tag==='span').textContent,'Storage unavailable');
  fail=false;await exportButton.click();assert.equal(app.calls.downloads.length,1);assert.equal(app.dialog(),null);
});

test('save failure reopens the chooser and a delayed close event cannot remove the retry',async()=>{
  let fail=true;const app=harness({deferredClose:true,photoSave:async()=>{if(fail)throw new Error('Photo save failed')}});
  app.api.showExportOptions({image:()=>png,document:master});const dialog=app.dialog();
  await button(dialog,'PNG').click();await app.flushClose();assert.equal(app.dialog(),dialog);assert.equal(dialog.open,true);assert.equal(dialog.children.find(item=>item.tag==='span').textContent,'Photo save failed');
  fail=false;await button(dialog,'PNG').click();await app.flushClose();assert.equal(app.dialog(),null);assert.equal(app.calls.photo.length,2);
});

test('cancelled preparation and stale save errors never reopen the chooser',async()=>{
  const pending=deferred(),cancelled=harness();cancelled.api.showExportOptions({image:()=>pending.promise,document:master});
  const first=button(cancelled.dialog(),'PNG').click();cancelled.dialog().close();pending.reject(new Error('Interrupted'));await first;assert.equal(cancelled.dialog(),null);
  let current=true;const stale=harness({photoSave:async()=>{current=false;throw new Error('Save failed')}});
  stale.api.showExportOptions({image:()=>png,document:master,isCurrent:()=>current});await button(stale.dialog(),'PNG').click();assert.equal(stale.dialog(),null);
});

test('all file formats download directly on HTTP and HTTPS even when native sharing is available',async()=>{
  for(const secure of [false,true])for(const [blob,name]of [[masterBlob,'test.entropi'],[tiff,'test.tif'],[dng,'test.dng']]){
    const app=harness({secure,share:async()=>{throw new Error('Must not share')}}),saving=app.api.saveEntropiFile(blob,name);
    assert.equal(app.calls.downloads.length,1);await saving;assert.equal(app.calls.downloads[0].blob,blob);assert.equal(app.calls.downloads[0].name,name);assert.equal(app.calls.shares.length,0);assert.equal(app.dialog(),null);assert.equal(app.body.children.length,0);assert.equal(app.calls.timers[0].time,60000);app.calls.timers[0].handler();assert.equal(app.calls.revoked.length,1);
  }
  const stale=harness();await stale.api.saveEntropiFile(masterBlob,'old.entropi',()=>false);assert.equal(stale.calls.downloads.length,0);await assert.rejects(stale.api.saveEntropiFile(new Blob([]),'empty.entropi'),/ikkje klar/);assert.equal(stale.calls.downloads.length,0);
});

test('import cancellation resolves cleanly, invalid files reject, and valid files reopen through the codec',async()=>{
  const cancelled=harness(),first=cancelled.api.pickEntropiDocument();await cancelled.input().emit('cancel');assert.equal(await first,null);assert.equal(cancelled.input(),undefined);
  const invalid=harness({decode:async()=>{throw new Error('Invalid Entropi file')}}),second=invalid.api.pickEntropiDocument(),rejected=assert.rejects(second,/Invalid Entropi/);invalid.input().files=[masterBlob];await invalid.input().emit('change');await rejected;assert.equal(invalid.input(),undefined);
  const document=master(),valid=harness({decode:async()=>document}),third=valid.api.pickEntropiDocument();valid.input().files=[masterBlob];await valid.input().emit('change');assert.equal(await third,document);assert.equal(valid.calls.decode[0],masterBlob);assert.equal(valid.input(),undefined);
});

function gesture(app,settings={}){
  const trigger=app.element('button');app.body.append(trigger);const dispose=app.api.bindExportGesture(trigger,()=>({image:()=>png,document:master,...settings}));
  const point={pointerId:1,isPrimary:true,button:0,clientX:304,clientY:764};
  return {trigger,dispose,down:()=>trigger.emit('pointerdown',point),move:(x,y)=>app.document.emit('pointermove',{...point,clientX:x,clientY:y}),up:(x=point.clientX,y=point.clientY)=>app.document.emit('pointerup',{...point,clientX:x,clientY:y}),point};
}

test('ordinary taps download TIFF from master data without showing a picker',async()=>{
  const app=harness();let reads=0;const action=gesture(app,{name:'photo.jpg',document:()=>{reads++;return master()}});
  await action.down();await action.up();await action.trigger.click();assert.equal(app.dialog(),null);assert.equal(reads,1);assert.equal(app.calls.photo.length,0);assert.equal(app.calls.downloads[0].blob,tiff);assert.equal(app.calls.downloads[0].name,'photo.tif');
  const original=harness(),plain=gesture(original,{document:null,imageExtension:'jpg',name:'original.jpg'});await plain.down();assert.equal(original.dialog(),null);await plain.up();await plain.trigger.click();assert.equal(original.calls.photo[0][1],'original.jpg');
});

test('holding and dragging upward chooses each file format on release and suppresses the ghost click',async()=>{
  for(const [label,key,extension]of [['PNG','photo','png'],['.entropi','downloads','entropi'],['TIFF','downloads','tif'],['DNG','downloads','dng']]){
    const app=harness(),action=gesture(app,{name:'capture.jpg'});await action.down();app.hold();
    const dialog=app.dialog(),rect=button(dialog,label).getBoundingClientRect();assert.equal(app.calls.photo.length+app.calls.downloads.length,0);assert.equal(options(dialog).length,7);
    await action.move(rect.left+44,rect.top+24);assert.equal(button(dialog,label).attributes.get('aria-current'),'true');
    await action.up(rect.left+44,rect.top+24);await action.trigger.click();assert.equal(app.calls[key].length,1);assert.equal(app.calls.photo.length+app.calls.downloads.length,1);assert.equal(app.dialog(),null);
    assert.equal(key==='photo'?app.calls.photo[0][1]:app.calls.downloads[0].name,'capture.'+extension);
  }
});

test('stationary hold and small hand movement keep formats open for a subsequent tap',async()=>{
  for(const drift of [0,6]){
    const app=harness(),action=gesture(app);await action.down();app.hold();const dialog=app.dialog();
    await action.move(action.point.clientX+drift,action.point.clientY);await action.up(action.point.clientX+drift,action.point.clientY);await action.trigger.click();
    assert.equal(app.dialog(),dialog);assert.equal(app.calls.photo.length+app.calls.downloads.length,0);
    await button(dialog,'TIFF').click();assert.equal(app.calls.downloads.length,1);assert.equal(app.calls.downloads[0].name,'entropi.tif');assert.equal(app.dialog(),null);
  }
});

test('a deliberate drag back to the trigger cancels rather than latching the picker',async()=>{
  const app=harness(),action=gesture(app);await action.down();app.hold();await action.move(action.point.clientX,action.point.clientY-20);await action.move(action.point.clientX,action.point.clientY);await action.up();await action.trigger.click();
  assert.equal(app.dialog(),null);assert.equal(app.calls.photo.length+app.calls.downloads.length,0);
});

test('a latched picker closes on an anchor tap, Escape or page cancellation without saving',async()=>{
  for(const kind of ['anchor','escape','pointercancel','pagehide','resize','hidden']){
    const app=harness(),action=gesture(app);await action.down();app.hold();await action.up();assert.ok(app.dialog());
    if(kind==='anchor'){app.advance(900);const icon=app.element('svg');action.trigger.append(icon);await app.document.emit('pointerdown',{...action.point,target:icon});assert.ok(app.dialog());await action.trigger.emit('pointerdown',{...action.point,target:icon});await action.up()}
    else if(kind==='escape')await action.trigger.emit('keydown',{key:'Escape'});
    else if(kind==='pointercancel')await app.document.emit('pointercancel',action.point);
    else if(kind==='pagehide'||kind==='resize')await app.window.emit(kind);
    else{app.document.hidden=true;await app.document.emit('visibilitychange')}
    await action.trigger.click();assert.equal(app.dialog(),null,kind);assert.equal(app.calls.photo.length+app.calls.downloads.length,0,kind);
  }
});

test('dragging before the hold, releasing outside, cancellation and second touches cannot save',async()=>{
  for(const kind of ['move-before','outside','pointercancel','second-touch','pagehide','hidden']){
    const app=harness(),action=gesture(app);await action.down();
    if(kind==='move-before'){await action.move(304,740);app.hold();assert.equal(app.dialog(),null)}
    else{app.hold();assert.ok(app.dialog());if(kind==='outside')await action.up(20,20);else if(kind==='pointercancel')await app.document.emit('pointercancel',action.point);else if(kind==='second-touch')await app.document.emit('pointerdown',{pointerId:2,isPrimary:false});else if(kind==='pagehide')await app.window.emit('pagehide');else{app.document.hidden=true;await app.document.emit('visibilitychange')}}
    await action.up();await action.trigger.click();assert.equal(app.dialog(),null,kind);assert.equal(app.calls.photo.length+app.calls.downloads.length,0,kind);
  }
});

test('keyboard and context menu expose formats inside the current review dialog and Escape dismisses',async()=>{
  const app=harness(),review=app.element('dialog');review.show();app.body.append(review);const action=gesture(app);review.append(action.trigger);
  await action.trigger.emit('keydown',{key:'ArrowUp'});let dialog=app.dialog();assert.equal(dialog.parent,review);assert.equal(options(dialog)[0].attributes.get('aria-current'),'true');
  await dialog.emit('keydown',{key:'ArrowUp'});assert.equal(button(dialog,'.entropi').attributes.get('aria-current'),'true');await dialog.emit('keydown',{key:'Escape'});assert.equal(app.dialog(),null);assert.equal(app.calls.downloads.length,0);
  await action.trigger.emit('contextmenu');dialog=app.dialog();await button(dialog,'TIFF').click();assert.equal(app.calls.downloads[0].name,'entropi.tif');
});

test('pointer menus preserve trigger focus while keyboard menus explicitly focus their first format',async()=>{
  const app=harness(),action=gesture(app);action.trigger.focus();await action.down();app.hold();
  assert.equal(app.document.activeElement,action.trigger);assert.equal(app.dialog().children.some(element=>element.textContent==='×'),false);await action.up();
  await action.trigger.emit('keydown',{key:'ArrowUp'});assert.equal(app.document.activeElement,button(app.dialog(),'PNG'));
});

test('stale or hidden pending exports and duplicate taps cannot download or reopen controls',async()=>{
  for(const kind of ['stale','hidden']){
    const app=harness(),pending=deferred();let current=true,reads=0;const action=gesture(app,{document:()=>{reads++;return pending.promise},isCurrent:()=>current});
    const first=action.trigger.click(),second=action.trigger.click();assert.equal(reads,1);
    if(kind==='stale')current=false;else await app.window.emit('pagehide');pending.resolve(master());await Promise.all([first,second]);assert.equal(app.calls.downloads.length,0);assert.equal(app.calls.photo.length,0);assert.equal(app.dialog(),null);
  }
});

test('failed direct saves remain quiet, notify the caller and permit retry; disposal removes gestures',async()=>{
  const app=harness();let fail=true;const errors=[],action=gesture(app,{document:null,image:()=>{if(fail)throw new Error('Unavailable');return png},onError:error=>errors.push(error.message)});
  await action.trigger.click();assert.deepEqual(errors,['Unavailable']);assert.equal(app.dialog(),null);assert.equal(action.trigger.children[0].textContent,'Unavailable');
  fail=false;await action.trigger.click();assert.equal(app.calls.photo.length,1);action.dispose();await action.down();app.hold();await action.trigger.click();assert.equal(app.dialog(),null);assert.equal(app.calls.photo.length,1);
});


test('independent archive previews default to the displayed image while retaining master export',async()=>{
  const app=harness(),document=master(),action=gesture(app,{image:()=>png,document:()=>document,defaultFormat:'png'});
  await action.trigger.click();assert.equal(app.calls.photo[0][0],png);assert.equal(app.calls.tiff.length,0);
  await action.down();app.hold();await button(app.dialog(),'TIFF').click();assert.equal(app.calls.tiff[0],document);assert.equal(app.calls.downloads[0].blob,tiff);
});

test('AI export uses the displayed image at each chosen scale and preserves the master',async()=>{
  for(const factor of [2,4,8]){
    const app=harness(),document=master(),values=document.result.depth.slice();let reads=0;
    app.api.showExportOptions({name:'capture.jpg',image:()=>png,document:()=>{reads++;return document}});
    await button(app.dialog(),'AI '+factor+'×').click();
    assert.equal(app.calls.upscale.length,1);assert.equal(app.calls.upscale[0].factor,factor);assert.equal(app.calls.upscale[0].blob,png);
    assert.equal(app.calls.photo[0][1],'capture-ai-'+factor+'x.png');assert.equal(reads,0);assert.deepEqual(document.result.depth,values);assert.equal(app.dialog(),null);
  }
});
