import { Viewfinder } from './vendor/viewfinder.mjs';
import { createDepthScene } from './vendor/scene.mjs';
import { attachStudioControls } from './vendor/studio.mjs';
import { snapshotBlob, savePhoto } from './vendor/photo.mjs';
import { attachPhotoGestures } from './vendor/photo-gestures.mjs';
import { createPhotoView } from './vendor/photo-view.mjs';
import { PX10Printer } from './vendor/print/printer.mjs';
import { cloudPrintJob } from './vendor/print/cloud-raster.mjs';
import { createPrintClient } from './vendor/print-client.mjs';

const $=id=>document.getElementById(id),video=$('video'),photo=$('photo'),finder=new Viewfinder($('viewfinder'));
const allowedOrigins=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
let mode='camera',stream=null,photoBlob=null,photoUrl=null,photoReady=false,photoName='entropi.jpg',scene=null,task=null,generation=0,captureGeneration=0,openingCamera=false,hadCamera=false,capturing=false,printing=false,retryScene=false,printTimer=0,pointer=null,lastTap=0,captureAfter=0;
const photoView=createPhotoView(photo);
const studioControls=attachStudioControls([$('studio')],(kind,level)=>{if(kind==='primitive')scene?.setPrimitiveLevel(level);else if(kind==='photo')photoView.setStyle(level);else if(kind==='image'&&photoReady&&mode!=='camera'){if(level===0||scene){state('done');if(level===1)scene?.refresh?.()}else void makeScene()}},()=>true,()=>{pointer=null;lastTap=0});
const photoGestures=attachPhotoGestures(photo,{enabled:()=>mode==='done'&&studioControls.image===0,onChange:pose=>{photoView.setTone(pose);photoView.refresh();updateRecenter()}});
function updateRecenter(){$('recenter').hidden=mode!=='done'||(studioControls.image===0?photoGestures.state.scale<=1:!scene)}
function printFeedback(message){clearTimeout(printTimer);$('print-status').textContent=message;printTimer=setTimeout(()=>{$('print-status').textContent=''},6000)}
const printClient=createPrintClient({printer:new PX10Printer(),buildJob:cloudPrintJob,report:printFeedback});

function state(next,message='',sceneFailure=false){
  mode=next;retryScene=next==='error'&&sceneFailure;$('studio').className='studio '+next;$('status').textContent=message;
  const reviewing=next!=='camera'&&!capturing&&!!photoBlob,splats=reviewing&&next==='done'&&studioControls.image===1&&scene;
  $('finder').classList.toggle('hidden',reviewing);photo.hidden=!reviewing||!!splats;$('scene').classList.toggle('hidden',!splats);$('progress').hidden=next!=='working';
  $('capture-plane').hidden=next!=='camera';$('retry').hidden=next!=='error';$('reset').hidden=next==='camera';$('save').hidden=!reviewing||!photoReady;$('last-photo').hidden=next!=='camera'||!photoReady;$('print').hidden=!reviewing||next!=='done';
  photoView.show(reviewing&&next==='done'&&!splats);
  $('studio').setAttribute('aria-busy',String(next==='working'));$('print').disabled=printing;
  updateRecenter();
  if(next==='done'&&studioControls.image===0)photoGestures.refresh?.();
  $('capture-plane').setAttribute('aria-label',stream?'Ta foto':'Opne kameraet');
  finder.active=!reviewing&&!document.hidden;
}
function stopCamera(){stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null}
function clearScene(){task?.abort();task=null;scene?.dispose();scene=null;$('scene').replaceChildren()}
function clearPhoto(){if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;photoBlob=null;photoReady=false;photo.removeAttribute('src');$('thumbnail').removeAttribute('src')}
function progress(update){if(studioControls.image!==1||mode==='camera'||capturing)return;const known=Number.isFinite(update.percent);$('progress').classList.toggle('indeterminate',!known);$('progress').firstElementChild.style.width=known?Math.max(0,Math.min(100,update.percent))+'%':'';$('status').textContent=update.phase.startsWith('loading')?'Klargjer splats'+(known?' · '+Math.round(update.percent)+' %':' …'):'Lagar splats …'}

async function startCamera(){
  if(openingCamera||stream||mode!=='camera')return;
  const current=generation;openingCamera=true;$('studio').classList.add('opening');$('status').textContent='Opnar kameraet …';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera krev ein trygg HTTPS-nettlesar.');
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    if(current!==generation||mode!=='camera'||document.hidden){media.getTracks().forEach(track=>track.stop());return}
    stream=media;video.srcObject=media;await video.play();
    if(current!==generation||mode!=='camera'||document.hidden)return;
    finder.source=video;hadCamera=true;state('camera');
  }catch(error){if(current===generation&&mode==='camera'&&!document.hidden){stopCamera();state('error',error.name==='NotAllowedError'?'Gi kameraet tilgang og prøv igjen.':error.message||'Kameraet kunne ikkje opnast.')}}
  finally{openingCamera=false;$('studio').classList.remove('opening')}
}

async function makeScene(){
  if(!photoReady||studioControls.image!==1||mode==='camera')return;
  if(scene){state('done');scene.refresh?.();return}
  state('working','Lagar splats …');if(task)return;
  const current=generation,blob=photoBlob,processing=task=new AbortController();progress({phase:'reading'});
  try{
    const result=await createDepthScene($('scene'),blob,update=>{if(current===generation)progress(update)},processing.signal);
    if(current!==generation||blob!==photoBlob){result.dispose();return}
    scene=result;scene.onError=error=>{if(scene===result&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message,true)};scene.setPrimitiveLevel(studioControls.primitive);if(mode!=='camera'&&!capturing)state('done');
  }catch(error){if(!processing.signal.aborted&&current===generation&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message||'Kunne ikkje lage splats.',true)}
  finally{if(task===processing)task=null}
}

async function acceptPhoto(blob,name='entropi.jpg'){
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>40*1024*1024){state('error','Kamerafotoet kunne ikkje lesast.');return}
  const current=++generation;clearScene();stopCamera();clearPhoto();photoBlob=blob;photoName=name.replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-100)||'entropi.jpg';photoUrl=URL.createObjectURL(blob);photo.src=photoUrl;$('thumbnail').src=photoUrl;
  state('working','Les foto.');
  try{await photo.decode();if(current!==generation)return;photoView.setSource();photoReady=true;photoGestures.reset();state('done');if(studioControls.image===1)await makeScene()}
  catch(error){if(current===generation)state('error',error.message||'Fotoet kunne ikkje lesast.')}
}

async function capture(){
  if(mode!=='camera'||performance.now()<captureAfter)return;
  if(!stream){await startCamera();return}
  if(!video.videoWidth||video.readyState<2)return;
  const current=generation,captureId=++captureGeneration,frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;
  capturing=true;state('working','Tek foto …');
  try{
    const context=frame.getContext('2d');if(!context)throw new Error('Fotoet kunne ikkje takast.');context.drawImage(video,0,0);
    const blob=await new Promise(resolve=>frame.toBlob(resolve,'image/jpeg',.94));
    if(current!==generation||captureId!==captureGeneration)return;capturing=false;if(document.hidden){state('camera');return}
    if(blob)await acceptPhoto(blob,'entropi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg');else state('error','Fotoet kunne ikkje takast.')
  }catch(error){if(current===generation&&captureId===captureGeneration&&!document.hidden)state('error',error.message||'Fotoet kunne ikkje takast.')}
  finally{if(captureId===captureGeneration)capturing=false;frame.width=frame.height=1}
}

function reset(){++captureGeneration;capturing=false;if(!photoReady){++generation;clearScene();clearPhoto()}stopCamera();finder.clear();pointer=null;lastTap=0;state('camera');if(hadCamera)void startCamera()}
async function printCurrent(){const source=scene,blob=photoBlob,image=studioControls.image;if(printing||mode!=='done'||!photoReady||image===1&&!source)return;printing=true;$('print').disabled=true;try{await printClient.print(image===0?photoView.snapshot(photoGestures.state):source.snapshot(),()=>mode==='done'&&blob===photoBlob&&image===studioControls.image&&(image===0||source===scene))}catch(error){printFeedback(error.message)}finally{printing=false;$('print').disabled=false}}
async function save(){
  if(!photoBlob)return;
  const blob=photoBlob;
  try{const image=snapshotBlob(studioControls.image===1&&scene&&mode==='done'?scene.snapshot(true):photoView.snapshot(photoGestures.state,true));await savePhoto(image,photoName.replace(/\.[^.]+$/,'')+'.png',()=>photoBlob===blob&&mode!=='camera')}catch(error){printFeedback(error.message)}
}

$('capture-plane').addEventListener('click',()=>void capture());$('reset').addEventListener('click',reset);$('save').addEventListener('click',()=>void save());
$('last-photo').addEventListener('click',()=>{if(!photoReady)return;stopCamera();state('done');if(studioControls.image===1)void makeScene()});$('print').addEventListener('click',()=>void printCurrent());
$('recenter').addEventListener('click',()=>{if(studioControls.image===0)photoGestures.reset();else scene?.resetView?.()});
$('retry').addEventListener('click',()=>{if(retryScene&&photoReady&&studioControls.image===1)void makeScene();else{reset();void startCamera()}});
$('studio').addEventListener('pointerdown',event=>{if(!event.isPrimary||event.target.closest('button,a')&&!event.target.closest('#capture-plane')){pointer=null;lastTap=0;return}pointer=mode==='working'||mode==='done'?{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}:null});
$('studio').addEventListener('pointerup',event=>{const tap=pointer;pointer=null;const now=performance.now();if(tap&&tap.id===event.pointerId&&now-tap.time>=500&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=12&&mode==='done'){lastTap=0;printCurrent();return}if(!tap||tap.id!==event.pointerId||now-tap.time>350||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>12){lastTap=0;return}if(lastTap&&now-lastTap<350){captureAfter=now+400;reset()}else lastTap=now});
$('studio').addEventListener('pointercancel',()=>{pointer=null;lastTap=0});
$('studio').addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){pointer=null;lastTap=0}},true);
$('studio').addEventListener('contextmenu',event=>{if(!event.target.closest('button,a'))event.preventDefault()});
window.addEventListener('message',event=>{if(event.source===window.opener&&allowedOrigins.has(event.origin)&&event.data?.type==='entropi-photo')void acceptPhoto(event.data.blob,typeof event.data.name==='string'?event.data.name:'entropi.jpg')});
function resume(){finder.active=mode==='camera'&&!document.hidden;if(!document.hidden&&mode==='camera')void startCamera();else if(!document.hidden){if(studioControls.image===1)scene?.refresh?.();else photoGestures.refresh?.()}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){finder.active=false;stopCamera()}else resume()});
window.addEventListener('pageshow',event=>{if(event.persisted)resume()});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&mode!=='camera'){event.preventDefault();reset()}else if(event.code==='Space'&&!event.repeat&&!['INPUT','BUTTON','A'].includes(document.activeElement?.tagName)){event.preventDefault();if(mode==='camera')void capture()}});
window.addEventListener('pagehide',event=>{stopCamera();finder.active=false;if(!event.persisted){++generation;clearTimeout(printTimer);clearScene();clearPhoto();finder.dispose();photoGestures.dispose();photoView.dispose();studioControls.dispose();printClient.dispose()}});
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowedOrigins.has(origin))window.opener.postMessage({type:'entropi-ready'},origin)}catch{}
if(!document.hidden&&(navigator.standalone||globalThis.matchMedia?.('(display-mode: standalone)')?.matches))void startCamera();
