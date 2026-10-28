import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/entropi-ui.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const png=new Blob(['png'],{type:'image/png'}),masterBlob=new Blob(['master'],{type:'application/x-entropi'}),tiff=new Blob(['tiff'],{type:'image/tiff'}),dng=new Blob(['dng'],{type:'image/dng'});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function harness({photoSave=async()=>{},decode=async()=>({restored:true}),share=null,secure=true,deferredClose=false}={}){
  const calls={encode:[],tiff:[],dng:[],photo:[],decode:[],shares:[],downloads:[],revoked:[],timers:[],focus:0},urls=new Map(),closeEvents=[];
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.attributes=new Map();this.listeners=new Map();this.style={};this.open=false;this.disabled=false;this.textContent='';this.parent=null}
    setAttribute(name,value){this.attributes.set(name,value)}
    addEventListener(name,handler,options={}){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push({handler,once:options.once})}
    async emit(name,event={}){for(const record of [...this.listeners.get(name)??[]]){if(record.once)this.listeners.set(name,this.listeners.get(name).filter(item=>item!==record));await record.handler({stopPropagation(){},...event})}}
    append(...elements){for(const element of elements){element.remove();this.children.push(element);element.parent=this}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(element=>element!==this);this.parent=null}
    showModal(){this.open=true}
    close(){this.open=false;if(deferredClose)closeEvents.push(()=>this.emit('close'));else void this.emit('close')}
    click(){if(this.disabled)return;if(this.tag==='a')calls.downloads.push({blob:urls.get(this.href),name:this.download});return this.emit('click')}
    focus(){calls.focus++}
  }
  const body=new Element('body'),focus=new Element('button');
  const document={body,activeElement:focus,createElement:tag=>new Element(tag),querySelector:selector=>selector==='dialog[data-entropi-export]'?body.children.find(element=>element.tag==='dialog'&&element.attributes.has('data-entropi-export'))??null:null};
  const context=vm.createContext({document,Blob,File,TextEncoder,DOMException,isSecureContext:secure,navigator:{canShare:()=>!!share,share:async payload=>{calls.shares.push(payload);return await share(payload)}},
    URL:{createObjectURL:blob=>{const url='blob:'+urls.size;urls.set(url,blob);return url},revokeObjectURL:url=>calls.revoked.push(url)},setTimeout:(handler,time)=>calls.timers.push({handler,time}),
    encodeEntropiDocument:async document=>{calls.encode.push(document);return masterBlob},decodeEntropiDocument:async file=>{calls.decode.push(file);return await decode(file)},
    encodeDepthTiff:result=>{calls.tiff.push(result);return tiff},encodeDepthDng:result=>{calls.dng.push(result);return dng},
    savePhoto:async(...args)=>{calls.photo.push(args);return await photoSave(...args)}
  });
  vm.runInContext(source,context);
  return {api:context,calls,body,dialog:()=>document.querySelector('dialog[data-entropi-export]'),input:()=>body.children.find(element=>element.tag==='input'),flushClose:async()=>{for(const close of closeEvents.splice(0))await close()}};
}
function options(dialog){return dialog.children.find(element=>element.tag==='div').children}
function button(dialog,label){return options(dialog).find(element=>element.textContent===label)}
const master=()=>({id:'preserved',left:new Blob(['original'],{type:'image/jpeg'}),result:{depth:Float32Array.of(.123456,.9),width:2,height:1},recipe:{preset:2,position:.2,width:1}});

test('format chooser stays quiet until selection and PNG uses the existing photo save path',async()=>{
  const app=harness();let images=0,documents=0;
  app.api.showExportOptions({name:'capture.jpg',image:()=>{images++;return png},document:()=>{documents++;return master()}});
  const dialog=app.dialog();assert.deepEqual(options(dialog).map(item=>item.textContent),['PNG','.entropi','TIFF','DNG']);assert.equal(images,0);assert.equal(documents,0);
  app.api.showExportOptions({image:()=>png,document:master});assert.equal(app.body.children.length,1);
  await button(dialog,'PNG').click();assert.equal(images,1);assert.equal(documents,0);assert.equal(app.calls.photo[0][0],png);assert.equal(app.calls.photo[0][1],'capture.png');assert.equal(app.calls.downloads.length,0);assert.equal(app.dialog(),null);
});

test('master export preserves the document and TIFF/DNG use raw predictions without rendering PNG',async()=>{
  for(const [label,blob,extension]of [['.entropi',masterBlob,'entropi'],['TIFF',tiff,'tif'],['DNG',dng,'dng']]){
    const app=harness(),document=master(),values=document.result.depth.slice();let renders=0;
    app.api.showExportOptions({name:'capture.png',image:()=>{renders++;return png},document:()=>document});
    await button(app.dialog(),label).click();assert.equal(renders,0);assert.deepEqual(document.result.depth,values);assert.equal(document.id,'preserved');assert.equal(app.calls.downloads[0].blob,blob);assert.equal(app.calls.downloads[0].name,'capture.'+extension);
    if(label==='.entropi')assert.equal(app.calls.encode[0],document);else assert.equal(app.calls[label==='TIFF'?'tiff':'dng'][0],document.result);
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

test('generic file sharing respects cancellation and falls back only on a current failed share',async()=>{
  const cancelled=harness({share:async()=>{throw new DOMException('Cancelled','AbortError')}});await cancelled.api.saveEntropiFile(masterBlob,'test.entropi');assert.equal(cancelled.calls.shares.length,1);assert.equal(cancelled.calls.downloads.length,0);
  const failed=harness({share:async()=>{throw new Error('Unavailable')}});await failed.api.saveEntropiFile(masterBlob,'test.entropi');assert.equal(failed.calls.downloads[0].blob,masterBlob);assert.equal(failed.calls.timers[0].time,60000);failed.calls.timers[0].handler();assert.equal(failed.calls.revoked.length,1);
  let current=true;const stale=harness({share:async()=>{current=false;throw new Error('Unavailable')}});await stale.api.saveEntropiFile(masterBlob,'test.entropi',()=>current);assert.equal(stale.calls.downloads.length,0);
  const local=harness({secure:false,share:async()=>{throw new Error('Must not share on HTTP')}});await local.api.saveEntropiFile(masterBlob,'test.entropi');assert.equal(local.calls.shares.length,0);assert.equal(local.calls.downloads.length,1);
});

test('import cancellation resolves cleanly, invalid files reject, and valid files reopen through the codec',async()=>{
  const cancelled=harness(),first=cancelled.api.pickEntropiDocument();await cancelled.input().emit('cancel');assert.equal(await first,null);assert.equal(cancelled.input(),undefined);
  const invalid=harness({decode:async()=>{throw new Error('Invalid Entropi file')}}),second=invalid.api.pickEntropiDocument(),rejected=assert.rejects(second,/Invalid Entropi/);invalid.input().files=[masterBlob];await invalid.input().emit('change');await rejected;assert.equal(invalid.input(),undefined);
  const document=master(),valid=harness({decode:async()=>document}),third=valid.api.pickEntropiDocument();valid.input().files=[masterBlob];await valid.input().emit('change');assert.equal(await third,document);assert.equal(valid.calls.decode[0],masterBlob);assert.equal(valid.input(),undefined);
});
