import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createEntropiDocument} from '../vendor/entropi-document.mjs';
import {attachGalleryNavigation} from '../vendor/gallery-navigation.mjs';

const html=await readFile(new URL('../device/EntropiCamera/camera_ui.html',import.meta.url),'utf8');
const section=(start,end)=>{
  const first=html.indexOf(start),last=html.indexOf(end,first+start.length);
  assert.ok(first>=0&&last>first,`Missing embedded section: ${start}`);
  return html.slice(first,last);
};
const pairSource=section('async function capturePair(','async function request(');
const statusSource=section('function validStatus(','function healthMessage(');
const artSource=section('async function makeArt(','async function makeScene(');
const modelNeedSource=section('function needsPhoneModels(','function renderOnboarding(');
const printSource=section('async function printCurrent(','function notifyCamera(');
const saveSource=html.split('\n').find(line=>line.startsWith("bindExportGesture($('save-photo'),"));
const jpeg=new Blob(['camera-jpeg'],{type:'image/jpeg'});
const enhancement=await readFile(new URL('../device/EntropiCamera/camera-ui-v2.js',import.meta.url),'utf8');
const persistSource=enhancement.slice(enhancement.indexOf('async function persistCurrentMaster('),enhancement.indexOf('async function openEntropiMaster('));

test('embedded archive previews use the current photo framing or native splat snapshot',async()=>{
  const source=enhancement.slice(enhancement.indexOf('async function persistCurrentPreview('),enhancement.indexOf('async function persistCurrentMaster('));
  for(const image of [0,1]){
    const writes=[],frames=[],pose={scale:2,x:4,y:-8,grain:3,contrast:1.5},rendered=new Blob(['processed'],{type:'image/png'});
    const state=vm.createContext({lockPageZoom(){},masterSaveTimer:1,clearTimeout(){},photoBlob:jpeg,captureArchiveId:'capture-1',captureArchiveSuppressed:false,studioControls:{image},sceneError:'',masterWrites:new WeakMap(),
      photoGestures:{state:pose},photoView:{snapshot(value,native){frames.push({kind:'photo',value,native});return {kind:'photo'}}},sceneViewer:{snapshot(native){frames.push({kind:'splat',native});return {kind:'splat'}}},
      snapshotBlob:()=>rendered,archiveStore:{async savePreview(id,blob){writes.push({id,blob})}},marigoldView:{ready:false},persistCurrentMaster(){throw new Error('Unexpected depth work')}
    });
    vm.runInContext(source,state);await state.persistCurrentPreview();
    assert.equal(writes[0].id,'capture-1');assert.equal(writes[0].blob,rendered);assert.equal(frames[0].native,true);assert.equal(frames[0].kind,image?'splat':'photo');if(!image)assert.equal(frames[0].value,pose);
    state.captureArchiveSuppressed=true;await state.persistCurrentPreview();assert.equal(writes.length,1);
  }
});

test('embedded import restores saved values and recipe without running depth inference',async()=>{
  const original=new Blob(['png'],{type:'image/png'}),rendered=new Blob(['frame'],{type:'image/png'}),app=archiveHarness();
  const master=createEntropiDocument({left:original,result:{depth:Float32Array.of(1,2,3,4),width:2,height:2},recipe:{preset:4,position:.1,width:1.5},preview:rendered});
  await app.state.openEntropiMaster(master,'stored-master');
  assert.equal(app.restored.length,1);assert.equal(app.restored[0].blob,original);assert.equal(app.restored[0].result,master.result);assert.equal(app.restored[0].recipe,master.recipe);
  assert.equal(app.processed.length,0);assert.equal(app.state.photoOriginal,original);assert.equal(app.state.captureArchiveId,'stored-master');assert.equal(app.state.photoDialog.open,true);
  assert.equal(app.writes.length,1);assert.equal(app.writes[0].master.id,master.id);assert.deepEqual([...app.writes[0].master.result.depth],[...master.result.depth]);
});

test('embedded master preserves both originals and updates the original archive record with the editable recipe',async()=>{
  const writes=[],right=new Blob(['right-jpeg'],{type:'image/jpeg'}),preview=new Blob(['preview'],{type:'image/png'});
  const result={depth:Float32Array.of(1.25,NaN,3.5,4),width:2,height:2,polarity:'near',model:'Depth Anything V2'};
  const state=vm.createContext({
    photoBlob:preview,photoOriginal:jpeg,photoPair:{left:jpeg,right},photoPanorama:null,photoReceivedAt:'2026-10-28T13:00:00Z',
    captureDocument:null,captureArchiveId:'original-record',masterSaveTimer:0,clearTimeout(){},cameraStatus:{camera_id:'primary'},secondId:'secondary',
    createEntropiDocument,masterWrites:new WeakMap(),captureArchiveSuppressed:false,snapshotBlob:()=>preview,printFeedback(){},
    marigoldView:{ready:true,result,recipe:{preset:1,position:0,width:1},snapshot(){return preview}},
    archiveStore:{async saveDocument(master,id){writes.push({master,id});return {id}}}
  });
  vm.runInContext(persistSource,state);
  const first=await state.persistCurrentMaster();
  assert.equal(first.left,jpeg);assert.equal(first.right,right);assert.equal(writes[0].id,'original-record');
  assert.deepEqual([...first.result.depth],[1.25,NaN,3.5,4]);assert.deepEqual([...first.result.validity],[1,0,1,1]);
  assert.equal(first.result.units,'relative');assert.equal(first.geometry.calibration,null);assert.equal(first.capture.capturedAt,null);
  state.marigoldView.recipe={preset:4,position:.25,width:1.5};
  const second=await state.persistCurrentMaster();
  assert.notEqual(first,second);assert.equal(first.id,second.id);assert.equal(first.recipe.preset,1);assert.equal(writes[1].id,'original-record');assert.equal(second.recipe.preset,4);
  state.archiveStore.saveDocument=async()=>{throw Object.assign(new Error('full'),{name:'QuotaExceededError'})};
  assert.equal((await state.persistCurrentMaster()).id,first.id);
});

test('a late master archive write cannot attach its record to a replacement capture',async()=>{
  let finish;const preview=new Blob(['preview'],{type:'image/png'});
  const state=vm.createContext({
    photoBlob:preview,photoOriginal:jpeg,photoPair:null,photoPanorama:null,photoReceivedAt:null,captureDocument:null,captureArchiveId:null,masterSaveTimer:0,clearTimeout(){},cameraStatus:null,secondId:'',
    createEntropiDocument,masterWrites:new WeakMap(),captureArchiveSuppressed:false,snapshotBlob:()=>preview,printFeedback(){},
    marigoldView:{ready:true,result:{depth:Float32Array.of(1),width:1,height:1},recipe:{preset:1,position:0,width:1},snapshot(){}},
    archiveStore:{saveDocument:()=>new Promise(resolve=>{finish=resolve})}
  });
  vm.runInContext(persistSource,state);
  const pending=state.persistCurrentMaster();state.photoBlob=new Blob(['new']);state.captureArchiveId='new-record';
  await Promise.resolve();finish({id:'old-record'});await pending;assert.equal(state.captureArchiveId,'new-record');
});

test('embedded master writes serialize immutable edits and deleted captures remain exportable without recreation',async()=>{
  const writes=[],finishes=[],preview=new Blob(['preview'],{type:'image/png'});
  const state=vm.createContext({
    photoBlob:preview,photoOriginal:jpeg,photoPair:null,photoPanorama:null,photoReceivedAt:null,captureDocument:null,captureArchiveId:'original',masterSaveTimer:0,clearTimeout(){},cameraStatus:null,secondId:'',
    createEntropiDocument,masterWrites:new WeakMap(),captureArchiveSuppressed:false,snapshotBlob:()=>preview,printFeedback(){},
    marigoldView:{ready:true,result:{depth:Float32Array.of(1),width:1,height:1},recipe:{preset:1,position:0,width:1},snapshot(){}},
    archiveStore:{saveDocument(master,id){writes.push({master,id});return new Promise(resolve=>finishes.push(()=>resolve({id})))}}
  });
  vm.runInContext(persistSource,state);
  const first=state.persistCurrentMaster();await Promise.resolve();assert.equal(writes.length,1);
  state.marigoldView.recipe={preset:4,position:.2,width:1.2};
  const second=state.persistCurrentMaster();await Promise.resolve();assert.equal(writes.length,1);assert.equal(writes[0].master.recipe.preset,1);
  finishes[0]();await first;await Promise.resolve();assert.equal(writes.length,2);assert.equal(writes[1].master.recipe.preset,4);
  assert.equal(writes[0].id,writes[1].id);assert.equal(writes[0].master.id,writes[1].master.id);finishes[1]();await second;
  state.captureArchiveSuppressed=true;
  const exported=await state.persistCurrentMaster();assert.equal(exported.recipe.preset,4);assert.equal(writes.length,2);
});

test('editing during the first archive write queues the latest recipe and processed preview',async()=>{
  const initial=new Blob(['initial preview'],{type:'image/png'}),edited=new Blob(['edited preview'],{type:'image/png'}),timers=new Map(),writes=[];
  let callbacks,finish,started,latest=initial,nextTimer=0;const firstWrite=new Promise(resolve=>{started=resolve});
  const view={ready:false,result:{depth:Float32Array.of(1,2,3,4),width:2,height:2},recipe:{preset:1,position:0,width:1},snapshot:()=>latest,async process(){this.ready=true;callbacks.onChange()}};
  const progress={classList:{add(){},toggle(){}},style:{}};
  const state=vm.createContext({photoBlob:initial,photoOriginal:jpeg,photoPair:null,photoPanorama:null,panoramaDepth:null,photoReceivedAt:null,captureDocument:null,captureArchiveId:'original',masterSaveTimer:0,cameraStatus:null,secondId:'',
    photoDialog:{open:true},studioControls:{image:2},sceneGeneration:1,artTask:null,artError:'',needsSetup:false,phoneTask:null,AbortController,DOMException,
    createEntropiDocument,masterWrites:new WeakMap(),captureArchiveSuppressed:false,snapshotBlob:value=>value,printFeedback(){},refreshReview(){},needsPhoneModels:()=>false,
    $:()=>progress,createMarigoldView:(_,options)=>{callbacks=options;return view},setTimeout:callback=>{const id=++nextTimer;timers.set(id,callback);return id},clearTimeout:id=>timers.delete(id),
    archiveStore:{saveDocument(master,id){writes.push({master,id});if(writes.length>1)return Promise.resolve({id});started();return new Promise(resolve=>{finish=()=>resolve({id})})}}
  });
  const initialization=html.split('\n').find(line=>line.startsWith('const marigoldView=createMarigoldView'));
  const schedule=enhancement.slice(enhancement.indexOf('function scheduleMasterSave('),enhancement.indexOf('function schedulePreviewSave('));
  vm.runInContext(initialization+'\n'+schedule+'\n'+persistSource+'\n'+artSource,state);
  const processing=state.makeArt();await firstWrite;assert.ok(state.artTask);assert.equal(timers.size,0);
  view.recipe={preset:4,position:.4,width:1.5};latest=edited;callbacks.onChange();assert.equal(timers.size,1);
  for(const [id,callback]of [...timers]){timers.delete(id);callback()}
  assert.equal(writes.length,1);finish();await processing;await state.masterWrites.get(initial);
  assert.equal(writes.length,2);assert.deepEqual(writes[1].master.recipe,view.recipe);assert.equal(writes[1].master.preview,edited);
  assert.equal(writes[0].master.preview,initial);assert.equal(writes[0].master.recipe.position,0);assert.equal(writes[1].id,'original');assert.equal(writes[1].master.id,writes[0].master.id);
});

test('archived export uses the latest processed preview and preserves the original right image',()=>{
  const preview=new Blob(['latest processed preview'],{type:'image/png'}),master={preview:new Blob(['master preview'],{type:'image/png'}),result:{depth:Float32Array.of(1)}};
  const record={left:jpeg,right:jpeg,preview,document:master},state=vm.createContext({archiveGeneration:1,archiveSelected:'master-1',archiveRecord:record,$:()=>({hidden:false})});
  vm.runInContext(enhancement.slice(enhancement.indexOf('function archivedExportOptions('),enhancement.indexOf("for(const kind of ['left','right'])")),state);
  const left=state.archivedExportOptions('left'),right=state.archivedExportOptions('right');
  assert.equal(left.image(),preview);assert.equal(left.document(),master);assert.equal(left.imageExtension,'png');
  assert.equal(right.image(),jpeg);assert.equal(right.document,undefined);assert.equal(right.imageExtension,'jpg');
  state.archiveSelected='replacement';assert.equal(left.isCurrent(),false);assert.equal(right.isCurrent(),false);
});

test('deleting the current archive entry settles its queued writes before removal and suppresses autosaving',async()=>{
  let finish,handler;const blob=new Blob(['capture']),removed=[],writes=new WeakMap();
  writes.set(blob,new Promise(resolve=>{finish=resolve}));
  const state=vm.createContext({
    archiveSelected:'capture',captureArchiveId:'capture',archiveDeleteArmed:true,photoBlob:blob,captureArchiveSuppressed:false,masterSaveTimer:1,masterWrites:writes,
    clearTimeout(){},disarmArchiveDelete(){},$:()=>({addEventListener(_,callback){handler=callback}}),archiveStore:{async remove(id){removed.push(id)}},showArchive(){}
  });
  vm.runInContext(enhancement.slice(enhancement.indexOf("$('archive-delete').addEventListener"),enhancement.indexOf("window.addEventListener('keydown'")),state);
  const deleting=handler();assert.equal(state.captureArchiveSuppressed,true);assert.equal(state.masterSaveTimer,0);assert.deepEqual(removed,[]);
  finish();await deleting;assert.deepEqual(removed,['capture']);assert.equal(state.captureArchiveSuppressed,true);
});

function archiveHarness(){
  const elements=new Map(),events=new Map(),records=new Map(),writes=[],processed=[],restored=[],urls=new Map();let nextId=0,nextUrl=0;
  const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve()};
  class Element{
    constructor(tagName='DIV'){this.tagName=tagName;this.hidden=false;this.children=[];this.attributes=new Map();this.listeners=new Map();this.dataset={};this.style={};const names=new Set();this.classList={add:name=>names.add(name),toggle:(name,active)=>active?names.add(name):names.delete(name),contains:name=>names.has(name)}}
    addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback)}
    setAttribute(name,value){this.attributes.set(name,String(value))}
    getAttribute(name){return this.attributes.get(name)}
    removeAttribute(name){this.attributes.delete(name);if(name==='src')this.src=''}
    append(...children){this.children.push(...children)}
    replaceChildren(...children){this.children=children}
    focus(){document.activeElement=this}
    showModal(){this.open=true}
    close(){this.open=false}
    async emit(name,details={}){for(const callback of this.listeners.get(name)??[])await callback({target:this,...details});await flush()}
  }
  for(const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const element=new Element(match[1].toUpperCase());element.hidden=/\bhidden\b/.test(match[0]);elements.set(match[2],element)}
  const document={hidden:false,activeElement:null,createElement:tag=>new Element(tag.toUpperCase()),addEventListener(name,callback){if(!events.has(name))events.set(name,[]);events.get(name).push(callback)}};
  const store={
    async save(left,right,preview){const id='capture-'+ ++nextId;records.set(id,{id,left,right,preview,created:nextId,pending:preview===null,stereo:!!right});return {id}},
    async list(){return [...records.values()].map(record=>({...record,preview:record.preview??record.left}))},
    async get(id){return records.get(id)},
    async saveDocument(master,id){writes.push({master,id});records.set(id,{...records.get(id),id,left:master.left,right:master.right,document:master,preview:master.preview,pending:false});return {id}},
    async savePreview(id,preview){const record=records.get(id);if(record){record.preview=preview;record.pending=false}},
    async remove(id){records.delete(id)}
  };
  const preview=new Blob(['rendered'],{type:'image/png'}),view={ready:false,result:null,recipe:{preset:1,position:0,width:1},snapshot:()=>preview,reset(){this.ready=false;this.result=null},async process(blob,signal,settings){processed.push({blob,signal,settings});this.result={width:2,height:2,depth:Float32Array.of(1,2,3,4)};this.ready=true},async restore(blob,result,recipe,signal){restored.push({blob,result,recipe,signal});this.result=result;this.recipe=recipe;this.ready=true}};
  const state=vm.createContext({lockPageZoom(){},Blob,AbortController,DOMException,document,window:{addEventListener:document.addEventListener},createArchive:()=>store,createEntropiDocument,attachGalleryNavigation,
    $:id=>elements.get(id),studio:elements.get('studio'),photoDialog:elements.get('photo-dialog'),onboarding:elements.get('onboarding'),
    setTimeout:()=>1,clearTimeout(){},stopStream(){},stopSecond(){},resumeStream(){},controls(){},notice(){},printFeedback(){},refreshReview(){},needsPhoneModels:()=>false,bindExportGesture(){},pickEntropiDocument(){},
    connected:true,connecting:false,busy:false,printBusy:false,hasFrame:true,recoveryPending:false,sensorControlBusy:false,secondEnabled:false,landscapeCapture:()=>false,connectGeneration:0,retryTimer:0,captureTask:null,sceneGeneration:0,artTask:null,artError:'',artNeedsModel:false,phoneTask:null,needsSetup:false,masterSaveTimer:0,captureArchiveSuppressed:false,
    photoBlob:null,photoOriginal:null,photoPair:null,photoPanorama:null,panoramaDepth:null,sweepCapture:null,photoUrl:null,photoName:'',photoReceivedAt:null,captureDocument:null,captureArchiveId:null,cameraStatus:null,secondId:'',
    studioControls:{image:0,setImage(value){this.image=value}},marigoldView:view,snapshotBlob:value=>value,photoView:{setSource(){},snapshot:()=>preview},photoGestures:{state:{},reset(){}},
    finder:{capture(){return {width:2,height:2,toBlob:callback=>callback(preview)}}},Image:class{naturalWidth=2;naturalHeight=2;async decode(){}},URL:{createObjectURL(blob){const url='blob:'+ ++nextUrl;urls.set(url,blob);return url},revokeObjectURL:url=>urls.delete(url)}
  });
  state.clearScene=()=>{state.sceneGeneration++;view.reset();state.captureDocument=null;state.captureArchiveId=null;state.captureArchiveSuppressed=false};
  vm.runInContext(enhancement.slice(0,enhancement.indexOf('async function updatePeerPreview('))+'\n'+section('async function showPhoto(','async function takePhoto(')+'\n'+artSource,state);
  return {state,store,records,writes,processed,restored,urls,get:id=>elements.get(id),flush,get activeElement(){return document.activeElement},async key(key,shiftKey=false){const event={key,shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true}};for(const callback of events.get('keydown')??[])callback(event);await flush();return event}};
}

test('embedded gallery browses adjacent photos and restores the existing grid and focus',async()=>{
  const app=archiveHarness(),images=[0,1,2].map(value=>new Blob([String(value)],{type:'image/png'}));
  for(const image of images)await app.store.save(image,null,image);
  let lists=0;const list=app.store.list;app.store.list=async()=>{lists++;return list()};
  await app.state.showArchive();const grid=app.get('archive-grid'),tiles=[...grid.children];grid.scrollTop=475;
  await tiles[0].emit('click');await app.key('ArrowRight');assert.equal(app.urls.get(app.get('archive-photo').src),images[1]);assert.match(app.get('archive-photo').alt,/2 av 3/);
  await app.get('archive-back').emit('click');assert.equal(grid.scrollTop,475);assert.equal(grid.children[0],tiles[0]);assert.equal(app.activeElement,tiles[1]);assert.equal(lists,1);
  await tiles[2].emit('click');await app.key('ArrowRight');assert.equal(app.urls.get(app.get('archive-photo').src),images[2]);
  await app.key('ArrowLeft');assert.equal(app.urls.get(app.get('archive-photo').src),images[1]);
});

for(const stereo of [false,true])test(`embedded recovery develops a preserved ${stereo?'stereo pair':'mono original'} using the existing archive identity`,async()=>{
  const app=archiveHarness(),left=new Blob(['left'],{type:'image/jpeg'}),right=stereo?new Blob(['right'],{type:'image/jpeg'}):null;
  const saved=await app.store.save(left,right,null);app.get('open-archive').focus();await app.state.showArchive();
  const tile=app.get('archive-grid').children[0];assert.equal(tile.classList.contains('pending'),true);assert.match(tile.getAttribute('aria-label'),/Ikkje framkalla/);assert.equal(app.urls.get(tile.children[0].src),left);assert.equal(tile.children[1].className,'archive-pending-mark');
  await tile.emit('click');assert.equal(app.get('archive-edit').hidden,false);assert.equal(app.get('archive-detail').classList.contains('pending'),true);
  await app.get('archive-edit').emit('click');await app.flush();
  assert.equal(app.processed.length,1);assert.equal(app.processed[0].blob,left);assert.equal(app.processed[0].settings.right??null,right);assert.equal(app.state.captureArchiveId,saved.id);assert.equal(app.records.size,1);assert.equal(app.writes[0].id,saved.id);assert.equal(app.writes[0].master.left,left);assert.equal(app.writes[0].master.right,right);
  await app.state.showArchive();const finished=app.get('archive-grid').children[0];assert.equal(finished.classList.contains('pending'),false);assert.equal(app.urls.get(finished.children[0].src),app.records.get(saved.id).preview);
});

test('embedded archive traps keyboard focus, restores its opener and ignores a late closed listing',async()=>{
  const app=archiveHarness();await app.store.save(jpeg,null,null);app.get('open-archive').focus();await app.state.showArchive();
  assert.equal(app.state.studio.inert,true);assert.equal(app.activeElement,app.get('close-archive'));
  await app.key('Tab',true);assert.equal(app.activeElement,app.get('archive-import'));await app.key('Tab',true);assert.equal(app.activeElement,app.get('archive-grid').children[0]);
  await app.get('archive-grid').children[0].emit('click');await app.key('Escape');assert.equal(app.get('archive-detail').hidden,true);assert.equal(app.get('archive').hidden,false);
  await app.key('Escape');assert.equal(app.get('archive').hidden,true);assert.equal(app.state.studio.inert,false);assert.equal(app.activeElement,app.get('open-archive'));
  let finish;app.store.list=()=>new Promise(resolve=>{finish=resolve});const listing=app.state.showArchive();await app.flush();app.state.closeArchive();finish([{id:'late',pending:true,preview:jpeg}]);await listing;
  assert.equal(app.get('archive-grid').children.length,0);assert.equal(app.urls.size,0);
});

test('side-by-side stereo export is removed from review and archive',async()=>{
  assert.doesNotMatch(html,/save-stereo|archive-pair|stereoPairImage|Lagar VATHOgraphy/);
  const archive=await readFile(new URL('../device/EntropiCamera/camera-ui-v2.js',import.meta.url),'utf8');
  assert.doesNotMatch(archive,/archive-pair|stereoPairImage|kind==='pair'/);
});

function pairHarness(options={}){
  const calls=[],revoked=[];
  let nextImage=0,nextUrl=0;
  const capture={id:'pair-1',left:'/api/frame/pair-1/left',right:'/api/frame/pair-1/right',captured_at:'2026-10-25T12:00:00Z',transport:'usb',hardware_synchronized:false};
  const context=vm.createContext({
    __ENTROPI_RIG_BRIDGE:options.bridge!==false,cameraStatus:{camera_id:'primary'},secondId:'secondary',
    Image:class{
      constructor(){const size=options.dimensions?.[nextImage++]??[640,480];[this.naturalWidth,this.naturalHeight]=size}
      async decode(){}
    },
    URL:{createObjectURL:()=>`blob:frame-${nextUrl++}`,revokeObjectURL:url=>revoked.push(url)},
    request:async(...args)=>{calls.push(args);args[3]?.throwIfAborted();return args[1]==='pair'?{id:'pair-id',leftId:options.leftId??'primary',rightId:'secondary',left:jpeg,right:jpeg,timing:{},transport:'wifi'}:args[1]==='json'?(options.capture??capture):jpeg}
  });
  vm.runInContext(pairSource+statusSource,context);
  return {context,calls,revoked,capture};
}

function artHarness(options={}){
  const inputs=[],snapshots=[],progress={classList:{add(){}},style:{}};
  const context=vm.createContext({
    photoBlob:new Blob(['framed']),photoOriginal:new Blob(['original']),photoPair:null,photoPanorama:null,panoramaDepth:null,captureDocument:null,
    photoDialog:{open:true},studioControls:{image:2,setImage(value){this.image=value}},
    sceneGeneration:1,artTask:null,artError:'',artNeedsModel:false,phoneReady:true,phoneTask:null,secondEnabled:false,needsSetup:false,AbortController,DOMException,
    $:()=>progress,refreshReview(){},controls(){},showOnboarding(){},checkPhone(){},async persistCurrentMaster(){},printFeedback(){},
    marigoldView:{
      ready:false,result:null,resets:0,
      async process(blob,signal,settings){
        inputs.push({blob,signal,settings});
        const result=options.process?await options.process(blob,signal,settings):{model:'raw-depth'};
        if(!signal.aborted){this.ready=true;this.result=result}
        return result;
      },
      reset(){this.resets++;this.ready=false;this.result=null},
      snapshot(native){const image={native,depthArt:true};snapshots.push(image);return image}
    }
  });
  vm.runInContext(modelNeedSource+artSource,context);
  return {context,inputs,snapshots};
}

test('embedded application scripts remain valid JavaScript',()=>{
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length>0);
  for(const [index,match]of scripts.entries())new vm.Script(match[1].replace(/__ENTROPI_[A-Z_]+__/g,''),{filename:`camera-ui-${index}.js`});
});

test('USB capture obtains both frames from one capture ID and preserves measured metadata',async()=>{
  const app=pairHarness(),pair=await app.context.capturePair(new AbortController().signal);
  assert.equal(app.calls.length,3);
  assert.equal(app.calls[0][0],'/api/capture');assert.equal(app.calls[0][4],'POST');
  assert.equal(app.calls[1][0],app.capture.left);assert.equal(app.calls[2][0],app.capture.right);
  assert.equal(pair.left,jpeg);assert.equal(pair.right,jpeg);
  for(const key of ['id','captured_at','transport','hardware_synchronized'])assert.equal(pair[key],app.capture[key]);
  assert.equal(pair.hardware_synchronized,false);
  assert.equal(app.revoked.length,2);
});

test('USB capture accepts only an explicit mono fallback and fetches its verified primary frame once',async()=>{
  const capture={id:'mono-1',left:'/api/frame/mono-1/left',right:null,transport:'usb',hardware_synchronized:false,fallback_reason:'peer-unavailable'};
  const app=pairHarness({capture}),result=await app.context.capturePair(new AbortController().signal);
  assert.equal(result.left,jpeg);assert.equal(result.right,null);assert.equal(result.fallback_reason,'peer-unavailable');assert.equal(app.calls.length,2);assert.equal(app.calls[1][0],capture.left);
  const incomplete=pairHarness({capture:{left:capture.left}});await assert.rejects(incomplete.context.capturePair(new AbortController().signal),/gyldig opptak/);
  const empty=pairHarness({capture,dimensions:[[0,0]]});await assert.rejects(empty.context.capturePair(new AbortController().signal),/fotooppløysing/);
});

test('direct firmware capture receives an atomic pair and verifies both camera identities',async()=>{
  const app=pairHarness({bridge:false}),pair=await app.context.capturePair(new AbortController().signal);
  assert.equal(app.calls.length,1);assert.match(app.calls[0][0],/^\/stereo\/capture\?/);assert.equal(app.calls[0][1],'pair');
  assert.equal(pair.transport,'wifi');assert.equal(pair.hardware_synchronized,false);
  const wrong=pairHarness({bridge:false,leftId:'different'});await assert.rejects(wrong.context.capturePair(new AbortController().signal),/feil kamera/);
});

test('invalid bridge routes and mismatched frame dimensions cannot enter review',async()=>{
  const invalid=pairHarness({capture:{left:'https://example.invalid/photo',right:'/api/frame/a/right'}});
  await assert.rejects(invalid.context.capturePair(new AbortController().signal),/gyldig opptak/);
  assert.equal(invalid.calls.length,1);
  const mismatch=pairHarness({dimensions:[[640,480],[320,240]]});
  await assert.rejects(mismatch.context.capturePair(new AbortController().signal),/same fotooppløysing/);
  assert.equal(mismatch.revoked.length,2);
});

test('USB status requires an explicitly enabled bridge and real image dimensions',()=>{
  const app=pairHarness(),status={camera_ready:true,stream_ready:true,transport:'usb',width:640,height:480};
  assert.equal(app.context.validStatus(status),true);
  for(const change of [{width:0},{height:'480'},{transport:'wifi'},{stream_ready:undefined}])assert.equal(app.context.validStatus({...status,...change}),false);
  app.context.__ENTROPI_RIG_BRIDGE=false;
  assert.equal(app.context.validStatus(status),false);
  assert.equal(app.context.validStatus({camera_ready:true,stream_ready:true,psram:true,framesize:10,photo_framesize:15,brightness:0}),true);
});

test('art uses the original capture or original left frame and reuses its cached prediction',async()=>{
  const app=artHarness(),state=app.context;
  await state.makeArt();assert.equal(app.inputs[0].blob,state.photoOriginal);assert.notEqual(app.inputs[0].blob,state.photoBlob);
  state.studioControls.image=0;await state.makeArt();state.studioControls.image=2;await state.makeArt();
  assert.equal(app.inputs.length,1);
  state.marigoldView.reset();state.photoPair={left:new Blob(['left']),right:new Blob(['right'])};
  await state.makeArt();assert.equal(app.inputs[1].blob,state.photoPair.left);
});

test('art exposes no cloud refinement action or provider selection',async()=>{
  const app=artHarness();await app.context.makeArt();
  assert.equal(app.inputs[0].settings.right,undefined);assert.doesNotMatch(html,/onMarigoldRequest|artProvider/);
});

test('pending art is deduplicated and an old cancellation cannot clear a newer task',async()=>{
  const finishes=[];
  const app=artHarness({process:()=>new Promise(resolve=>finishes.push(resolve))}),state=app.context;
  const old=state.makeArt(),oldTask=state.artTask;
  await state.makeArt();assert.equal(app.inputs.length,1);
  state.cancelArt();assert.equal(oldTask.signal.aborted,true);assert.equal(state.artTask,null);
  const current=state.makeArt(),currentTask=state.artTask;
  finishes[0]({model:'old'});await old;
  assert.equal(state.artTask,currentTask);assert.equal(state.marigoldView.ready,false);
  finishes[1]({model:'new'});await current;
  assert.equal(state.artTask,null);assert.equal(state.marigoldView.result.model,'new');assert.equal(state.artError,'');
});

test('depth failures remain actionable while cancelled processing returns to photo',async()=>{
  const failed=artHarness({process:async()=>{throw new Error('Depth unavailable')}});
  await failed.context.makeArt();assert.equal(failed.context.artError,'Depth unavailable');assert.equal(failed.context.artTask,null);assert.equal(failed.context.studioControls.image,2);
  const cancelled=artHarness({process:async()=>{throw new DOMException('Declined','AbortError')}});
  await cancelled.context.makeArt();assert.equal(cancelled.context.studioControls.image,0);assert.equal(cancelled.context.artError,'');
});

test('paired art tries measured stereo before model setup and requests assets only for estimated fallback',async()=>{
  const app=artHarness(),state=app.context;
  state.phoneReady=false;state.secondEnabled=true;state.photoPair={left:jpeg,right:jpeg};
  let checks=0;state.checkPhone=()=>{checks++};
  assert.equal(state.needsPhoneModels(),false);await state.makeArt();assert.equal(checks,0);assert.equal(app.inputs.length,1);assert.equal(app.inputs[0].settings.right,jpeg);
  state.marigoldView.reset();state.artNeedsModel=true;assert.equal(state.needsPhoneModels(),true);await state.makeArt();assert.equal(checks,1);
  state.__ENTROPI_RIG_BRIDGE=true;assert.equal(state.needsPhoneModels(),false);
});

test('missing model assets select portable setup instead of repeating inference',async()=>{
  const app=artHarness({process:async()=>{throw Object.assign(new Error('Model cache missing'),{code:'PHONE_SETUP_REQUIRED'})}}),state=app.context;
  let prompts=0;state.showOnboarding=()=>{prompts++};
  await state.makeArt();
  assert.equal(state.phoneReady,false);assert.equal(state.needsSetup,true);
  assert.equal(state.needsPhoneModels(),true);assert.equal(prompts,1);assert.equal(state.artTask,null);
});

test('art print and save use rendered snapshots and invalidate a replaced result',async()=>{
  const app=artHarness(),state=app.context,prints=[],saves=[];
  await state.makeArt();
  Object.assign(state,{
    printBusy:false,busy:false,sceneVisible:false,artVisible:true,sceneViewer:null,connectGeneration:0,connecting:false,retryTimer:null,
    clearTimeout(){},stopStream(){},controls(){},printFeedback(){},resumeStream(){},
    printClient:{async print(image,isCurrent){prints.push({image,isCurrent})}},
    photoName:'entropi-test.png',snapshotBlob:image=>image,bindExportGesture(button,getOptions){button.addEventListener('click',async()=>{const options=getOptions();saves.push({...options,image:await options.image()})})}
  });
  vm.runInContext(printSource,state);await state.printCurrent();
  assert.equal(prints[0].image.depthArt,true);assert.equal(prints[0].image.native,false);assert.equal(prints[0].isCurrent(),true);
  let save;
  state.$=()=>({addEventListener:(_,callback)=>{save=callback}});
  assert.ok(saveSource);vm.runInContext(saveSource,state);await save();
  assert.equal(typeof saves[0].document,'function');assert.equal(saves[0].image.depthArt,true);assert.equal(saves[0].image.native,true);assert.equal(saves[0].isCurrent(),true);
  state.marigoldView.result={model:'replacement'};
  assert.equal(prints[0].isCurrent(),false);assert.equal(saves[0].isCurrent(),false);
});

for(const outcome of ['resolve','reject'])test(`embedded gallery ignores a stale ${outcome} after reopening the same photo`,async()=>{
  const start=enhancement.indexOf('async function openArchivedPhoto('),source=enhancement.slice(start,enhancement.indexOf('function closeArchive(',start));
  let resolve,reject,calls=0;const pending=new Promise((yes,no)=>{resolve=yes;reject=no}),elements=new Map(),urls=new Map();
  const old=new Blob(['old'],{type:'image/png'}),fresh=new Blob(['fresh'],{type:'image/png'});
  const record=preview=>({id:'same',left:old,preview});
  const get=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',classList:{toggle(){}},setAttribute(){},dataset:{},focus(){}});return elements.get(id)};
  const state=vm.createContext({$:get,archiveGeneration:1,archiveScroll:0,archiveNavigation:{cancel(){}},disarmArchiveDelete(){},archiveSelected:null,archiveRecord:null,archiveDeleteArmed:false,archiveViewer:null,archiveRecords:[{id:'same',created:0}],archiveDate:()=>'',
    archiveStore:{get:async()=>++calls===1?pending:record(fresh)},URL:{createObjectURL(blob){const url='blob:'+urls.size;urls.set(url,blob);return url},revokeObjectURL(){}}
  });
  vm.runInContext(source,state);const stale=state.openArchivedPhoto('same');
  get('archive').hidden=true;state.archiveSelected=null;state.archiveGeneration++;
  get('archive').hidden=false;state.archiveGeneration++;await state.openArchivedPhoto('same');
  const currentUrl=get('archive-photo').src,urlCount=urls.size;
  if(outcome==='resolve')resolve(record(old));else reject(new Error('Old read failed'));
  await stale;
  assert.equal(get('archive-photo').src,currentUrl);assert.equal(urls.get(currentUrl),fresh);assert.equal(urls.size,urlCount);assert.equal(state.archiveRecord.preview,fresh);
});

test('embedded right-original export remains an ordinary image when its left preview matches a master',()=>{
  const start=enhancement.indexOf('function archivedExportOptions('),source=enhancement.slice(start,enhancement.indexOf('for(const kind',start));
  const right=new Blob(['right'],{type:'image/jpeg'}),document={id:'master'},record={previewMatchesDocument:true,document,right,preview:new Blob(['rendered'],{type:'image/png'})};
  const state=vm.createContext({archiveGeneration:1,archiveSelected:'capture',archiveRecord:record,$:()=>({hidden:false})});vm.runInContext(source,state);
  const exported=state.archivedExportOptions('right');assert.equal(exported.defaultFormat,'png');assert.equal(exported.document,undefined);assert.equal(exported.image(),right);assert.equal(state.archivedExportOptions('left').defaultFormat,'tif');
});

test('embedded export and its errors stay stale after reopening the same archive image',()=>{
  const start=enhancement.indexOf('function archivedExportOptions('),source=enhancement.slice(start,enhancement.indexOf('for(const kind',start));
  const archive={hidden:false},notice={textContent:''},state=vm.createContext({archiveGeneration:1,archiveSelected:'same',archiveRecord:{preview:jpeg},$:id=>id==='archive'?archive:notice});vm.runInContext(source,state);
  const old=state.archivedExportOptions('left');assert.equal(old.isCurrent(),true);
  archive.hidden=true;state.archiveGeneration++;archive.hidden=false;state.archiveGeneration++;
  assert.equal(old.isCurrent(),false);old.onError(new Error('Stale export error'));assert.equal(notice.textContent,'');assert.equal(state.archivedExportOptions('left').isCurrent(),true);
});

for(const outcome of ['resolve','reject'])test(`embedded delayed edit ${outcome} cannot replace a reopened archive session`,async()=>{
  const source=enhancement.split('\n').find(line=>line.startsWith("$('archive-edit').addEventListener"));
  let resolve,reject,handler;const pending=new Promise((yes,no)=>{resolve=yes;reject=no}),opened=[],notice={textContent:''},archive={hidden:false};
  const state=vm.createContext({archiveGeneration:1,archiveSelected:'same',archiveStore:{get:()=>pending},openArchivedCapture:async(record,id)=>opened.push({record,id}),$:id=>id==='archive'?archive:id==='archive-notice'?notice:{addEventListener(_,callback){handler=callback}}});vm.runInContext(source,state);
  const editing=handler();archive.hidden=true;state.archiveGeneration++;archive.hidden=false;state.archiveGeneration++;
  if(outcome==='resolve')resolve({left:jpeg});else reject(new Error('Stale edit error'));await editing;
  assert.equal(opened.length,0);assert.equal(notice.textContent,'');
});
