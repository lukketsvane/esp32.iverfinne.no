import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

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
const saveSource=html.split('\n').find(line=>line.startsWith("$('save-photo').addEventListener('click',"));
const jpeg=new Blob(['camera-jpeg'],{type:'image/jpeg'});

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
    __ENTROPI_RIG_BRIDGE:options.bridge!==false,
    Image:class{
      constructor(){const size=options.dimensions?.[nextImage++]??[640,480];[this.naturalWidth,this.naturalHeight]=size}
      async decode(){}
    },
    URL:{createObjectURL:()=>`blob:frame-${nextUrl++}`,revokeObjectURL:url=>revoked.push(url)},
    request:async(...args)=>{calls.push(args);args[3]?.throwIfAborted();return args[1]==='json'?(options.capture??capture):jpeg}
  });
  vm.runInContext(pairSource+statusSource,context);
  return {context,calls,revoked,capture};
}

function artHarness(options={}){
  const inputs=[],snapshots=[],progress={classList:{add(){}},style:{}};
  const context=vm.createContext({
    photoBlob:new Blob(['framed']),photoOriginal:new Blob(['original']),photoPair:null,
    photoDialog:{open:true},studioControls:{image:2,setImage(value){this.image=value}},
    sceneGeneration:1,artTask:null,artError:'',artProvider:'auto',phoneReady:true,phoneTask:null,secondEnabled:false,needsSetup:false,AbortController,DOMException,
    $:()=>progress,refreshReview(){},controls(){},showOnboarding(){},checkPhone(){},
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

test('direct firmware capture keeps its existing two GET endpoints',async()=>{
  const app=pairHarness({bridge:false}),pair=await app.context.capturePair(new AbortController().signal);
  assert.equal(app.calls.length,2);assert.match(app.calls[0][0],/^\/capture\?/);assert.match(app.calls[1][0],/^\/peer\/capture\?/);
  assert.equal(app.calls[0][4],undefined);assert.equal(pair.transport,undefined);
});

test('invalid bridge routes and mismatched frame dimensions cannot enter review',async()=>{
  const invalid=pairHarness({capture:{left:'https://example.invalid/photo',right:'/api/frame/a/right'}});
  await assert.rejects(invalid.context.capturePair(new AbortController().signal),/gyldig stereopar/);
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

test('explicit Marigold selection replaces auto cache and persists for retry',async()=>{
  const app=artHarness(),state=app.context;
  await state.makeArt();assert.equal(app.inputs[0].settings.provider,'auto');
  await state.makeArt('marigold');assert.equal(app.inputs.length,2);assert.equal(state.marigoldView.resets,1);
  assert.equal(app.inputs[1].settings.provider,'marigold');
  await state.makeArt();assert.equal(app.inputs.length,2);
  state.marigoldView.reset();await state.makeArt();assert.equal(app.inputs[2].settings.provider,'marigold');
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

test('depth failures remain actionable while declined cloud consent returns to photo',async()=>{
  const failed=artHarness({process:async()=>{throw new Error('Depth unavailable')}});
  await failed.context.makeArt();assert.equal(failed.context.artError,'Depth unavailable');assert.equal(failed.context.artTask,null);assert.equal(failed.context.studioControls.image,2);
  const cancelled=artHarness({process:async()=>{throw new DOMException('Declined','AbortError')}});
  await cancelled.context.makeArt('marigold');assert.equal(cancelled.context.studioControls.image,0);assert.equal(cancelled.context.artError,'');
});

test('portable art requires the phone model even with a complete stereo pair; the local bridge bypasses it',async()=>{
  const app=artHarness(),state=app.context;
  state.phoneReady=false;state.secondEnabled=true;state.photoPair={left:jpeg,right:jpeg};
  let checks=0;state.checkPhone=()=>{checks++};
  assert.equal(state.needsPhoneModels(),true);await state.makeArt();assert.equal(checks,1);assert.equal(app.inputs.length,0);
  state.__ENTROPI_RIG_BRIDGE=true;
  assert.equal(state.needsPhoneModels(),false);await state.makeArt();assert.equal(checks,1);assert.equal(app.inputs.length,1);
});

test('a failed cloud fallback with missing assets selects portable setup instead of repeating cloud inference',async()=>{
  const app=artHarness({process:async()=>{throw Object.assign(new Error('Model cache missing'),{code:'PHONE_SETUP_REQUIRED'})}}),state=app.context;
  let prompts=0;state.showOnboarding=()=>{prompts++};
  await state.makeArt('marigold');
  assert.equal(state.artProvider,'auto');assert.equal(state.phoneReady,false);assert.equal(state.needsSetup,true);
  assert.equal(state.needsPhoneModels(),true);assert.equal(prompts,1);assert.equal(state.artTask,null);
});

test('art print and save use rendered snapshots and invalidate a replaced result',async()=>{
  const app=artHarness(),state=app.context,prints=[],saves=[];
  await state.makeArt();
  Object.assign(state,{
    printBusy:false,sceneVisible:false,artVisible:true,sceneViewer:null,connectGeneration:0,connecting:false,retryTimer:null,
    clearTimeout(){},stopStream(){},controls(){},printFeedback(){},resumeStream(){},
    printClient:{async print(image,isCurrent){prints.push({image,isCurrent})}},
    photoName:'entropi-test.png',snapshotBlob:image=>image,async savePhoto(image,name,isCurrent){saves.push({image,name,isCurrent})}
  });
  vm.runInContext(printSource,state);await state.printCurrent();
  assert.equal(prints[0].image.depthArt,true);assert.equal(prints[0].image.native,false);assert.equal(prints[0].isCurrent(),true);
  let save;
  state.$=()=>({addEventListener:(_,callback)=>{save=callback}});
  assert.ok(saveSource);vm.runInContext(saveSource,state);await save();
  assert.equal(saves[0].image.depthArt,true);assert.equal(saves[0].image.native,true);assert.equal(saves[0].isCurrent(),true);
  state.marigoldView.result={model:'replacement'};
  assert.equal(prints[0].isCurrent(),false);assert.equal(saves[0].isCurrent(),false);
});
