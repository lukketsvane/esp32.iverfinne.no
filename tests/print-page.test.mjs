import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../prepare/print.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const html=await readFile(new URL('../prepare/print.html',import.meta.url),'utf8');
const session='1234567890abcdef1234567890abcdef',origin='http://192.168.4.1';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function harness(options={}){
  const events=new Map(),messages=[],jobs=[],classes=new Set();let choices=0,disposed=false,printer,focused=0;
  const opener={postMessage:(data,target)=>messages.push({data,target}),focus(){focused++}};
  const elements=new Map(['print','status'].map(id=>[id,{disabled:true,textContent:'',listeners:new Map(),setAttribute(){},addEventListener(name,callback){this.listeners.set(name,callback)},click(){return this.listeners.get('click')?.()}}]));
  class Printer extends EventTarget{
    constructor(){super();printer=this;this.ready=false;this.supported=options.supported!==false;this.device=null}
    async choose(){choices++;const connected=options.choose?await options.choose():true;this.ready=connected;return connected}
    async start(){return this.ready}
    enqueue(id,bytes){jobs.push({id,bytes});return true}
    dispose(){disposed=true}
  }
  const document={referrer:options.referrer??origin+'/',getElementById:id=>elements.get(id),body:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}}};
  vm.runInNewContext(source,{document,window:{opener:options.noOpener?null:opener,addEventListener:(name,callback)=>events.set(name,callback)},location:{hash:'#'+(options.session??session)},URL,ArrayBuffer,Uint8ClampedArray,PX10Printer:Printer,cloudPrintJob:image=>new Uint8Array([image.height,1,2])});
  async function emit(data,details={}){events.get('message')?.({data,source:opener,origin,...details});await flush()}
  const image=()=>({type:'entropi-print-image',session,width:384,height:1,data:new Uint8Array(384*4).buffer});
  return {elements,messages,jobs,classes,printer,opener,emit,image,hide:async()=>{events.get('pagehide')?.();await flush()},get focused(){return focused},get choices(){return choices},get disposed(){return disposed}};
}

test('the printer helper accepts one bounded image only from its exact opener, origin and session',async()=>{
  const app=harness();assert.equal(app.messages[0].data.type,'entropi-print-ready');assert.equal(app.messages[0].target,origin);
  await app.emit(app.image(),{source:{}});await app.emit(app.image(),{origin:'http://untrusted.test'});await app.emit({...app.image(),session:'old'});assert.equal(app.elements.get('print').disabled,true);
  await app.emit({...app.image(),data:new Uint8Array(4).buffer});assert.equal(app.elements.get('print').disabled,true);
  await app.emit(app.image());assert.equal(app.elements.get('print').disabled,false);assert.equal(app.choices,0);assert.equal(app.jobs.length,0);
});

test('one explicit helper tap opens the chooser synchronously and cannot queue the snapshot twice',async()=>{
  const app=harness();await app.emit(app.image());const clicking=app.elements.get('print').click();assert.equal(app.choices,1);await clicking;
  assert.equal(app.jobs.length,1);assert.equal(app.jobs[0].id,'entropi-'+session);assert.equal(app.messages.at(-1).data.type,'entropi-print-started');
  await app.elements.get('print').click();assert.equal(app.jobs.length,1);assert.equal(app.messages.some(message=>message.data.type==='entropi-print-result'),false);
  app.printer.dispatchEvent(new CustomEvent('status',{detail:{state:'sent',physicalPrintVerified:false}}));assert.equal(app.messages.at(-1).data.ok,true);
  assert.equal(app.disposed,false);await app.elements.get('print').click();assert.equal(app.focused,1);assert.equal(app.jobs.length,1);assert.equal(app.disposed,false);
});

test('the helper uses an unframed icon and clears successful status text',async()=>{
  assert.match(html,/button\{[^}]*border:0;outline:0;background:transparent/);assert.doesNotMatch(html,/button[^}]*border:1px|button:focus-visible\{[^}]*outline:/);
  const app=harness();await app.emit(app.image());assert.equal(app.elements.get('status').textContent,'');await app.elements.get('print').click();
  assert.equal(app.elements.get('status').textContent,'Sender …');assert.equal(app.classes.has('working'),true);
  app.printer.dispatchEvent(new CustomEvent('status',{detail:{state:'sent'}}));assert.equal(app.elements.get('status').textContent,'');assert.equal(app.classes.has('working'),false);assert.equal(app.elements.get('print').disabled,false);
});

test('cancelled pairing permits a deliberate retry while disposal prevents late enqueue',async()=>{
  let release;const app=harness({choose:()=>new Promise(resolve=>{release=resolve})});await app.emit(app.image());
  const cancelled=app.elements.get('print').click();release(false);await cancelled;assert.equal(app.jobs.length,0);assert.equal(app.elements.get('print').disabled,false);
  const late=app.elements.get('print').click();await app.hide();release(true);await late;assert.equal(app.disposed,true);assert.equal(app.jobs.length,0);
});

test('a connection quota failure shows the short guidance and permits a later explicit tap',async()=>{
  const app=harness({choose:async()=>false});app.printer.lastError='Vent eitt minutt før nytt forsøk.';await app.emit(app.image());await app.elements.get('print').click();
  assert.equal(app.elements.get('status').textContent,app.printer.lastError);assert.equal(app.elements.get('print').disabled,false);assert.equal(app.jobs.length,0);assert.equal(app.choices,1);
});

test('untrusted entry and missing Bluetooth produce an actionable error without printing',async()=>{
  for(const options of [{referrer:'https://untrusted.test/'},{session:'bad'},{noOpener:true}]){
    const app=harness(options);assert.equal(app.messages.length,0);assert.equal(app.elements.get('print').disabled,true);assert.equal(app.jobs.length,0);
  }
  const app=harness({supported:false,choose:async()=>false});await app.emit(app.image());await app.elements.get('print').click();assert.equal(app.jobs.length,0);assert.match(app.elements.get('status').textContent,/Bluetooth/);
});
