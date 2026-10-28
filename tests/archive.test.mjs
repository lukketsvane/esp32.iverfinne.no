import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createEntropiDocument} from '../vendor/entropi-document.mjs';

const source=(await readFile(new URL('../vendor/archive.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const photo=text=>new Blob([text],{type:'image/jpeg'});
const master=(id='master')=>createEntropiDocument({id,created:'2026-10-28T10:00:00.000Z',left:photo('left'),right:photo('right'),preview:photo('rendered master'),result:{width:2,height:2,depth:Float32Array.of(.1,1.2345,NaN,3.5),validity:Uint8Array.of(1,0,0,1)},recipe:{preset:3,position:.2,width:1.5}});
function harness(){
  const stores=new Map(),urls=new Map(),commits=[],drawn=[];let clock=10000,failure=null,nextUrl=0;
  const db={objectStoreNames:{contains:name=>stores.has(name)},createObjectStore(name){stores.set(name,new Map())},transaction(names,mode){
    const pending=[],transaction={error:null,aborted:false,objectStore(name){
      if(!names.includes(name))throw new Error('Store outside transaction');
      return {get(id){const request={};pending.push(()=>{request.result=structuredClone(stores.get(name).get(id))});return request},getAll(){const request={};pending.push(()=>{request.result=structuredClone([...stores.get(name).values()])});return request},put(record){
        if(mode!=='readwrite')throw new Error('Readonly transaction');
        if(failure?.store===name&&failure.kind==='sync'){const error=failure.error;failure=null;throw error}
        const copy=structuredClone(record);pending.push(next=>{
          if(failure?.store===name){const error=failure.error;failure=null;throw error}
          next.get(name).set(copy.id,copy);
        });return {};
      },delete(id){pending.push(next=>next.get(name).delete(id));return {}}};
    },abort(){transaction.aborted=true;queueMicrotask(()=>transaction.onabort?.())}};
    queueMicrotask(()=>{
      if(transaction.aborted)return;
      const next=new Map([...stores].map(([name,records])=>[name,new Map(records)]));
      try{for(const operation of pending)operation(next)}catch(error){transaction.error=error;transaction.aborted=true;transaction.onerror?.();transaction.onabort?.();return}
      if(mode==='readwrite'){for(const name of names)stores.set(name,next.get(name));commits.push([...names])}
      transaction.oncomplete?.();
    });return transaction;
  }};
  class Image{async decode(){if(!urls.has(this.src))throw new Error('Unknown URL')}}
  const context=vm.createContext({Blob,Image,Date:class extends Date{static now(){return clock}},Math,Promise,globalThis:undefined,
    indexedDB:{open(){const request={result:db};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.()});return request}},
    URL:{createObjectURL(blob){const url='blob:'+ ++nextUrl;urls.set(url,blob);return url},revokeObjectURL(url){urls.delete(url)}},
    document:{createElement(){let image;return {width:0,height:0,getContext:()=>({drawImage(value){image=urls.get(value.src);drawn.push(image)}}),toBlob(callback){image.text().then(value=>callback(photo('thumbnail:'+value)))}}}},
    navigator:{storage:{persist:async()=>true}},isSecureContext:true
  });
  context.globalThis=context;vm.runInContext(source,context);
  return {archive:context.createArchive(),stores,commits,drawn,setClock(value){clock=value},fail(store,kind='async'){failure={store,kind,error:new DOMException('Storage full','QuotaExceededError')}},flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('master save updates the existing capture and preserves archive order and creation time',async()=>{
  const app=harness(),old=await app.archive.save(photo('old original'));
  app.setClock(20000);const newer=await app.archive.save(photo('newer original'));
  const document=master(),saved=await app.archive.saveDocument(document,old.id),record=await app.archive.get(old.id),list=await app.archive.list();
  assert.equal(saved.id,old.id);assert.equal(saved.created,old.created);assert.deepEqual([...list].map(item=>item.id),[newer.id,old.id]);assert.equal(list.length,2);
  assert.equal(await record.left.text(),'left');assert.equal(await record.right.text(),'right');assert.equal(record.document.id,'master');assert.equal(saved.stereo,true);
  assert.deepEqual(record.document.result.depth,document.result.depth);assert.deepEqual(record.document.result.validity,document.result.validity);assert.deepEqual(record.document.recipe,document.recipe);
  assert.deepEqual(app.commits.at(-1),['photos','index']);
});

test('thumbnail uses the rendered master and legacy captures remain readable',async()=>{
  const app=harness(),legacy=await app.archive.save(photo('legacy'),photo('legacy right')),document=master();
  await app.archive.saveDocument(document);
  const list=await app.archive.list(),saved=list.find(item=>item.id===document.id),old=await app.archive.get(legacy.id);
  assert.equal(await saved.preview.text(),'thumbnail:rendered master');assert.equal(app.drawn.at(-1),document.preview);
  assert.equal(await old.left.text(),'legacy');assert.equal(await old.right.text(),'legacy right');assert.equal(old.document,undefined);
  assert.equal(list.length,2);assert.equal(saved.created,Date.parse(document.created));assert.equal(app.stores.get('photos').size,2);
});

test('saved master is a snapshot of buffers and recipe, not a mutable object reference',async()=>{
  const app=harness(),document=master();await app.archive.saveDocument(document);
  document.result.depth[0]=999;document.result.validity[0]=0;document.recipe.preset=4;
  const saved=(await app.archive.get(document.id)).document;
  assert.equal(saved.result.depth[0],Math.fround(.1));assert.equal(saved.result.validity[0],1);assert.equal(saved.recipe.preset,3);
});

for(const kind of ['async','sync'])test(`${kind} index write failure leaves original and archive index unchanged`,async()=>{
  const app=harness(),info=await app.archive.save(photo('original'),photo('original right')),before=await app.archive.get(info.id),index=await app.archive.list(),commits=app.commits.length;
  app.fail('index',kind);
  await assert.rejects(app.archive.saveDocument(master(),info.id),error=>error.name==='QuotaExceededError');await app.flush();
  const after=await app.archive.get(info.id),afterIndex=await app.archive.list();
  assert.equal(await after.left.text(),await before.left.text());assert.equal(await after.right.text(),await before.right.text());assert.equal(after.document,undefined);
  assert.equal(afterIndex[0].created,index[0].created);assert.equal(await afterIndex[0].preview.text(),await index[0].preview.text());assert.equal(app.commits.length,commits);
});

test('invalid master input rejects before changing a capture',async()=>{
  const app=harness(),info=await app.archive.save(photo('original')),document=master();document.preview=null;
  await assert.rejects(app.archive.saveDocument(document,info.id),/Ugyldig/);
  const saved=await app.archive.get(info.id);assert.equal(await saved.left.text(),'original');assert.equal(saved.document,undefined);assert.equal(app.commits.length,1);
});
