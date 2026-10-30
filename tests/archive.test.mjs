import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createEntropiDocument,normalizePanorama} from '../vendor/entropi-document.mjs';

const source=(await readFile(new URL('../vendor/archive.mjs',import.meta.url),'utf8')).replace(/^export /gm,'').replace(/^import .*?;\s*/gm,'');
const photo=text=>new Blob([text],{type:'image/jpeg'});
const master=(id='master')=>createEntropiDocument({id,created:'2026-10-28T10:00:00.000Z',left:photo('left'),right:photo('right'),preview:photo('rendered master'),result:{width:2,height:2,depth:Float32Array.of(.1,1.2345,NaN,3.5),validity:Uint8Array.of(1,0,0,1)},recipe:{preset:3,position:.2,width:1.5}});
const sweep=()=>({frames:[{left:photo('first original'),right:photo('first right'),id:'first',timing:{left:10,right:12},accepted:true},{left:photo('rejected original'),right:null,id:'second',accepted:false}],transforms:[[1,0,0,0,1,0,0,0,1],null],metadata:{coverage:.7}});
function harness({width=1600,height=1200}={}){
  const stores=new Map(),urls=new Map(),commits=[],drawn=[],sizes=[];let clock=10000,failure=null,nextUrl=0,decodeFailure=false,decodeWait=null,thumbnailFailure=false;
  const db={objectStoreNames:{contains:name=>stores.has(name)},createObjectStore(name){stores.set(name,new Map())},transaction(names,mode){
    const pending=[],transaction={error:null,aborted:false,objectStore(name){
      if(!names.includes(name))throw new Error('Store outside transaction');
      return {get(id){const request={};pending.push(next=>{request.result=structuredClone(next.get(name).get(id));request.onsuccess?.()});return request},getAll(){const request={};pending.push(next=>{request.result=structuredClone([...next.get(name).values()]);request.onsuccess?.()});return request},put(record){
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
      try{for(const operation of pending){if(transaction.aborted)return;operation(next)}}catch(error){transaction.error=error;transaction.aborted=true;transaction.onerror?.();transaction.onabort?.();return}
      if(transaction.aborted)return;
      if(mode==='readwrite'){for(const name of names)stores.set(name,next.get(name));commits.push([...names])}
      transaction.oncomplete?.();
    });return transaction;
  }};
  class Image{naturalWidth=width;naturalHeight=height;async decode(){if(decodeWait)await decodeWait;if(decodeFailure||!urls.has(this.src))throw new Error('Image unavailable')}}
  const context=vm.createContext({Blob,Image,normalizePanorama,Date:class extends Date{static now(){return clock}},Math,Promise,globalThis:undefined,
    indexedDB:{open(){const request={result:db};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.()});return request}},
    URL:{createObjectURL(blob){const url='blob:'+ ++nextUrl;urls.set(url,blob);return url},revokeObjectURL(url){urls.delete(url)}},
    document:{createElement(){let image;const canvas={width:0,height:0,getContext:()=>({drawImage(value){image=urls.get(value.src);drawn.push(image);sizes.push([canvas.width,canvas.height])}}),toBlob(callback){if(thumbnailFailure){callback(null);return}image.text().then(value=>callback(photo('thumbnail:'+value)))}};return canvas}},
    navigator:{storage:{persist:async()=>true}},isSecureContext:true
  });
  context.globalThis=context;vm.runInContext(source,context);
  return {archive:context.createArchive(),stores,commits,drawn,sizes,setClock(value){clock=value},fail(store,kind='async'){failure={store,kind,error:new DOMException('Storage full','QuotaExceededError')}},failDecode(){decodeFailure=true},failThumbnail(){thumbnailFailure=true},waitDecode(value){decodeWait=value},flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('master save updates the existing capture and preserves archive order and creation time',async()=>{
  const app=harness(),old=await app.archive.save(photo('old original'));
  app.setClock(20000);const newer=await app.archive.save(photo('newer original'));
  const document=master(),saved=await app.archive.saveDocument(document,old.id),record=await app.archive.get(old.id),list=await app.archive.list();
  assert.equal(saved.id,old.id);assert.equal(saved.created,old.created);assert.deepEqual([...list].map(item=>item.id),[newer.id,old.id]);assert.equal(list.length,2);
  assert.equal(await record.left.text(),'left');assert.equal(await record.right.text(),'right');assert.equal(record.document.id,'master');assert.equal(saved.stereo,true);
  assert.equal(await record.preview.text(),'rendered master');assert.equal(saved.pending,false);
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

test('pending captures expose a recovery thumbnail while retaining undeveloped originals',async()=>{
  const app=harness(),left=photo('raw left'),right=photo('raw right'),processed=photo('processed frame');
  const pending=await app.archive.save(left,right,null);
  assert.equal(pending.pending,true);assert.equal(await pending.preview.text(),'thumbnail:raw left');assert.equal(app.drawn.length,1);assert.equal((await app.archive.list()).length,1);assert.equal((await app.archive.list())[0].pending,true);
  const original=await app.archive.get(pending.id);assert.equal(await original.left.text(),'raw left');assert.equal(await original.right.text(),'raw right');assert.equal(original.preview,null);
  app.setClock(20000);const newer=await app.archive.save(photo('newer'));
  const saved=await app.archive.savePreview(pending.id,processed),record=await app.archive.get(pending.id),list=await app.archive.list();
  assert.equal(saved.pending,false);assert.equal(saved.created,pending.created);assert.equal(saved.stereo,true);assert.equal(await saved.preview.text(),'thumbnail:processed frame');
  assert.equal(await record.preview.text(),'processed frame');assert.equal(await record.left.text(),'raw left');assert.equal(await record.right.text(),'raw right');
  assert.deepEqual([...list].map(item=>item.id),[newer.id,pending.id]);assert.deepEqual(app.commits.at(-1),['photos','index']);
});

test('pending panorama saves all source pairs before depth processing and copies capture metadata',async()=>{
  const app=harness(),panorama=sweep(),info=await app.archive.save(photo('stitched image'),null,null,panorama);
  panorama.frames[0].left=photo('replacement');panorama.frames[0].timing.left=999;panorama.transforms[0][2]=100;
  const record=await app.archive.get(info.id),listed=(await app.archive.list())[0];
  assert.equal(info.pending,true);assert.equal(info.stereo,true);assert.equal(listed.pending,true);assert.equal(record.document,undefined);
  assert.equal(await record.left.text(),'stitched image');assert.equal(record.right,null);assert.equal(record.preview,null);
  assert.equal(await record.panorama.frames[0].left.text(),'first original');assert.equal(await record.panorama.frames[0].right.text(),'first right');
  assert.equal(await record.panorama.frames[1].left.text(),'rejected original');assert.equal(record.panorama.frames[1].right,null);assert.equal(record.panorama.frames[1].accepted,false);
  assert.equal(record.panorama.frames[0].timing.left,10);assert.equal(record.panorama.transforms[0][2],0);
  await app.archive.savePreview(info.id,photo('preview after depth failure'));
  assert.equal(await (await app.archive.get(info.id)).panorama.frames[1].left.text(),'rejected original');
});

test('developed panorama retains every original and pair status in both record and master',async()=>{
  const app=harness(),panorama=sweep(),info=await app.archive.save(photo('stitched image'),null,null,panorama),input=master();
  input.right=null;input.panorama=panorama;const document=createEntropiDocument(input);
  await app.archive.saveDocument(document,info.id);document.panorama.frames[0].timing.left=999;
  const record=await app.archive.get(info.id),listed=(await app.archive.list())[0];
  assert.equal(listed.pending,false);assert.equal(listed.stereo,true);assert.equal(record.previewMatchesDocument,true);
  assert.equal(record.panorama.frames[0].timing.left,10);assert.equal(record.document.panorama.frames[0].timing.left,10);
  assert.equal(await record.panorama.frames[0].right.text(),'first right');assert.equal(await record.document.panorama.frames[1].left.text(),'rejected original');
  const mono=sweep();for(const frame of mono.frames)frame.right=null;
  assert.equal((await app.archive.save(photo('mono stitched'),null,null,mono)).stereo,false);
});

for(const kind of ['sync','async'])test(`${kind} failed panorama development keeps the pending source sweep intact`,async()=>{
  const app=harness(),panorama=sweep(),info=await app.archive.save(photo('stitched image'),null,null,panorama),input=master();input.right=null;input.panorama=panorama;
  const document=createEntropiDocument(input),commits=app.commits.length;app.fail('index',kind);
  await assert.rejects(app.archive.saveDocument(document,info.id),error=>error.name==='QuotaExceededError');await app.flush();
  const record=await app.archive.get(info.id),listed=(await app.archive.list())[0];
  assert.equal(listed.pending,true);assert.equal(record.document,undefined);assert.equal(record.preview,null);assert.equal(app.commits.length,commits);
  assert.equal(await record.left.text(),'stitched image');assert.equal(await record.panorama.frames[0].right.text(),'first right');assert.equal(await record.panorama.frames[1].left.text(),'rejected original');
});

test('malformed pending panoramas reject without adding partial captures',async()=>{
  const app=harness();
  for(const panorama of [{frames:[],transforms:[]},{frames:[{left:photo('first')}],transforms:[]},{frames:[{left:new Blob()}],transforms:[null]}])await assert.rejects(app.archive.save(photo('stitched'),null,null,panorama));
  await assert.rejects(app.archive.save(photo('stitched'),photo('unrelated right'),null,sweep()));
  assert.equal((await app.archive.list()).length,0);assert.equal(app.commits.length,0);
});

test('a supplied initial rendering becomes the thumbnail and full preview while retaining the original',async()=>{
  const app=harness(),info=await app.archive.save(photo('base'),null,photo('styled photograph')),record=await app.archive.get(info.id);
  assert.equal(await info.preview.text(),'thumbnail:styled photograph');assert.equal(await record.preview.text(),'styled photograph');assert.equal(await record.left.text(),'base');assert.equal(info.pending,false);
});

test('updating the visible preview preserves an editable master and both originals',async()=>{
  const app=harness(),document=master();await app.archive.saveDocument(document);
  const info=await app.archive.savePreview(document.id,photo('new visible rendering')),record=await app.archive.get(document.id);
  assert.equal(await info.preview.text(),'thumbnail:new visible rendering');assert.equal(await record.preview.text(),'new visible rendering');
  assert.equal(await record.document.preview.text(),'rendered master');assert.deepEqual(record.document.recipe,document.recipe);assert.deepEqual(record.document.result.depth,document.result.depth);
  assert.equal(await record.left.text(),'left');assert.equal(await record.right.text(),'right');
});

test('saving a master completes the same pending capture with its developed image',async()=>{
  const app=harness(),pending=await app.archive.save(photo('raw'),null,null),document=master();
  assert.equal((await app.archive.list()).length,1);await app.archive.saveDocument(document,pending.id);
  const list=await app.archive.list();assert.equal(list.length,1);assert.equal(list[0].id,pending.id);assert.equal(list[0].created,pending.created);assert.equal(list[0].pending,false);assert.equal(await list[0].preview.text(),'thumbnail:rendered master');
});

test('an absent capture or one deleted during thumbnail work is never recreated',async()=>{
  const app=harness();assert.equal(await app.archive.savePreview('absent',photo('processed')),null);assert.equal((await app.archive.list()).length,0);
  const pending=await app.archive.save(photo('raw'),null,null);let finish;
  app.waitDecode(new Promise(resolve=>{finish=resolve}));
  const updating=app.archive.savePreview(pending.id,photo('processed'));await app.archive.remove(pending.id);finish();
  assert.equal(await updating,null);assert.equal(await app.archive.get(pending.id),undefined);assert.equal((await app.archive.list()).length,0);
});

for(const kind of ['async','sync'])test(`${kind} preview write failure preserves the previous image and index together`,async()=>{
  const app=harness(),saved=await app.archive.save(photo('base'),null,photo('previous')),before=await app.archive.get(saved.id),index=(await app.archive.list())[0],commits=app.commits.length;
  app.fail('index',kind);await assert.rejects(app.archive.savePreview(saved.id,photo('replacement')),error=>error.name==='QuotaExceededError');await app.flush();
  const after=await app.archive.get(saved.id),afterIndex=(await app.archive.list())[0];
  assert.equal(await after.preview.text(),await before.preview.text());assert.equal(await after.left.text(),'base');assert.equal(await afterIndex.preview.text(),await index.preview.text());assert.equal(afterIndex.created,index.created);assert.equal(app.commits.length,commits);
});

test('thumbnail failure uses the processed blob and never falls back to an old base image',async()=>{
  for(const failure of ['failDecode','failThumbnail']){
    const app=harness(),saved=await app.archive.save(photo('base'));app[failure]();
    let info=await app.archive.savePreview(saved.id,photo('processed'));
    assert.equal(await info.preview.text(),'processed');assert.equal(await (await app.archive.get(saved.id)).preview.text(),'processed');
    info=await app.archive.saveDocument(master(),saved.id);assert.equal(await info.preview.text(),'rendered master');
    assert.equal(await (await app.archive.get(saved.id)).preview.text(),'rendered master');
  }
});

test('thumbnails fit their original aspect ratio without cropping or enlargement',async()=>{
  for(const [width,height,expected]of [[1600,1200,[200,150]],[1200,1600,[113,150]],[2000,1000,[200,100]],[40,60,[40,60]]]){
    const app=harness({width,height});await app.archive.save(photo('image'));
    assert.deepEqual(app.sizes,[expected]);
  }
});

test('invalid processed previews cannot alter an existing capture',async()=>{
  const app=harness(),saved=await app.archive.save(photo('original'));
  for(const blob of [null,new Blob(),new Uint8Array([1])])await assert.rejects(app.archive.savePreview(saved.id,blob),/gyldig/);
  assert.equal(await (await app.archive.get(saved.id)).preview.text(),'original');assert.equal(app.commits.length,1);
});

test('pending captures from an older archive acquire a recovery thumbnail without publishing or changing originals',async()=>{
  const app=harness(),saved=await app.archive.save(photo('legacy left'),photo('legacy right'),null),index=app.stores.get('index');
  index.set(saved.id,{...index.get(saved.id),preview:null});const commits=app.commits.length;
  const listed=await app.archive.list(),record=await app.archive.get(saved.id);
  assert.equal(listed.length,1);assert.equal(listed[0].pending,true);assert.equal(await listed[0].preview.text(),'thumbnail:legacy left');
  assert.equal(record.preview,null);assert.equal(await record.left.text(),'legacy left');assert.equal(await record.right.text(),'legacy right');assert.equal(app.commits.length,commits);
});

test('preview provenance follows master and independent preview transitions in photo and index records',async()=>{
  const app=harness(),capture=await app.archive.save(photo('original')),document=master();
  const check=async expected=>{
    assert.equal((await app.archive.get(capture.id)).previewMatchesDocument,expected);
    assert.equal((await app.archive.list())[0].previewMatchesDocument,expected);
  };
  assert.equal(capture.previewMatchesDocument,false);await check(false);
  assert.equal((await app.archive.saveDocument(document,capture.id)).previewMatchesDocument,true);await check(true);
  assert.equal((await app.archive.savePreview(capture.id,photo('independent rendering'))).previewMatchesDocument,false);await check(false);
  const retained=(await app.archive.get(capture.id)).document;
  assert.equal(await retained.preview.text(),'rendered master');assert.deepEqual(retained.result.depth,document.result.depth);
  assert.equal((await app.archive.saveDocument(document,capture.id)).previewMatchesDocument,true);await check(true);
});

test('legacy previews default conservatively without modifying stored records',async()=>{
  for(const variant of ['independent','same bytes','shared','missing','explicit false']){
    const app=harness(),document=master();await app.archive.saveDocument(document);
    const photos=app.stores.get('photos'),index=app.stores.get('index'),record=photos.get(document.id),info=index.get(document.id);
    delete record.previewMatchesDocument;delete info.previewMatchesDocument;
    if(variant==='independent')record.preview=photo('other rendering');
    if(variant==='same bytes')record.preview=photo('rendered master');
    if(variant==='shared'||variant==='explicit false')record.preview=record.document.preview;
    if(variant==='missing')delete record.preview;
    if(variant==='explicit false')record.previewMatchesDocument=false;
    const commits=app.commits.length,loaded=await app.archive.get(document.id),listed=(await app.archive.list())[0];
    assert.equal(loaded.previewMatchesDocument,variant==='shared'||variant==='missing',variant);
    assert.equal(listed.previewMatchesDocument,false,variant);
    assert.equal(await loaded.document.preview.text(),'rendered master');
    assert.equal(app.commits.length,commits);assert.equal(index.get(document.id).previewMatchesDocument,undefined);
    assert.equal(photos.get(document.id).previewMatchesDocument,variant==='explicit false'?false:undefined);
  }
});

for(const kind of ['async','sync'])test(`${kind} failed preview replacement preserves matching-master provenance`,async()=>{
  const app=harness(),document=master();await app.archive.saveDocument(document);
  app.fail('index',kind);await assert.rejects(app.archive.savePreview(document.id,photo('replacement')),error=>error.name==='QuotaExceededError');await app.flush();
  const record=await app.archive.get(document.id),listed=(await app.archive.list())[0];
  assert.equal(record.previewMatchesDocument,true);assert.equal(listed.previewMatchesDocument,true);
  assert.equal(await record.preview.text(),'rendered master');assert.equal(await listed.preview.text(),'thumbnail:rendered master');
});
