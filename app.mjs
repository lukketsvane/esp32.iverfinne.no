import { Viewfinder } from './vendor/viewfinder.mjs';
import { createDepthScene } from './vendor/scene.mjs';
import { attachStudioControls } from './vendor/studio.mjs';
import { photoSnapshot } from './vendor/photo.mjs';
import { PX10Printer } from './vendor/print/printer.mjs';
import { cloudPrintJob } from './vendor/print/cloud-raster.mjs';
import { createPrintClient } from './vendor/print-client.mjs';

const $=id=>document.getElementById(id),video=$('video'),photo=$('photo'),finder=new Viewfinder($('viewfinder'));
const allowedOrigins=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
let mode='camera',stream=null,photoBlob=null,photoUrl=null,photoName='entropi.jpg',scene=null,task=null,generation=0,openingCamera=false,hadCamera=false,pointer=null,lastTap=0,captureAfter=0;
const studioControls=attachStudioControls([$('studio')],(kind,level)=>{if(kind==='primitive')scene?.setPrimitiveLevel(level);else if(kind==='image'&&photoBlob){if(level===0||scene){state('done');if(level===1)scene?.refresh?.()}else void makeScene()}},()=>true,()=>{pointer=null;lastTap=0});
const printClient=createPrintClient({printer:new PX10Printer(),buildJob:cloudPrintJob,report:message=>{$('status').textContent=message}});

function state(next,message=''){
  mode=next;$('studio').className='studio '+next;$('status').textContent=message;
  const splats=next==='done'&&studioControls.image===1&&scene;
  $('finder').classList.toggle('hidden',!!photoBlob);photo.hidden=!photoBlob||!!splats;$('scene').classList.toggle('hidden',!splats);$('progress').hidden=next!=='working';
  $('capture-plane').hidden=next!=='camera';$('retry').hidden=next!=='error';$('reset').hidden=next==='camera';$('save').hidden=!photoBlob;
  $('capture-plane').setAttribute('aria-label',stream?'Ta foto':'Opne kameraet');
  finder.active=!photoBlob&&!document.hidden;
}
function stopCamera(){stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null}
function clearScene(){task?.abort();task=null;scene?.dispose();scene=null;$('scene').replaceChildren()}
function clearPhoto(){if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;photoBlob=null;photo.removeAttribute('src')}
function progress(update){if(studioControls.image!==1)return;const known=Number.isFinite(update.percent);$('progress').classList.toggle('indeterminate',!known);$('progress').firstElementChild.style.width=known?Math.max(0,Math.min(100,update.percent))+'%':'';$('status').textContent=update.phase.startsWith('loading')?'Lastar modell til telefonen.':'Reknar djupn på telefonen.'}

async function startCamera(){
  if(openingCamera||stream||mode!=='camera')return;
  const current=generation;openingCamera=true;$('status').textContent='Opnar kameraet.';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera krev ein trygg HTTPS-nettlesar.');
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    if(current!==generation||mode!=='camera'||document.hidden){media.getTracks().forEach(track=>track.stop());return}
    stream=media;video.srcObject=media;await video.play();
    if(current!==generation||mode!=='camera'||document.hidden)return;
    finder.source=video;hadCamera=true;state('camera');
  }catch(error){if(current===generation&&!document.hidden){stopCamera();state('error',error.name==='NotAllowedError'?'Gi kameraet tilgang og prøv igjen.':error.message||'Kameraet kunne ikkje opnast.')}}
  finally{openingCamera=false}
}

async function makeScene(){
  if(!photoBlob||studioControls.image!==1)return;
  if(scene){state('done');return}
  state('working','Lagar 3D på telefonen.');if(task)return;
  const current=generation,blob=photoBlob,processing=task=new AbortController();progress({phase:'reading'});
  try{
    const result=await createDepthScene($('scene'),blob,update=>{if(current===generation)progress(update)},processing.signal);
    if(current!==generation||blob!==photoBlob){result.dispose();return}
    scene=result;scene.setPrimitiveLevel(studioControls.primitive);state('done');
  }catch(error){if(!processing.signal.aborted&&current===generation&&studioControls.image===1)state('error',error.message||'Kunne ikkje lage 3D.')}
  finally{if(task===processing)task=null}
}

async function acceptPhoto(blob,name='entropi.jpg'){
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>40*1024*1024){state('error','Kamerafotoet kunne ikkje lesast.');return}
  const current=++generation;clearScene();stopCamera();clearPhoto();photoBlob=blob;photoName=name.replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-100)||'entropi.jpg';photoUrl=URL.createObjectURL(blob);photo.src=photoUrl;
  state('working','Les foto.');
  try{await photo.decode();if(current!==generation)return;state('done');if(studioControls.image===1)await makeScene()}
  catch(error){if(current===generation)state('error',error.message||'Fotoet kunne ikkje lesast.')}
}

async function capture(){
  if(mode!=='camera'||performance.now()<captureAfter)return;
  if(!stream){await startCamera();return}
  if(!video.videoWidth)return;
  const current=generation,frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;
  state('working','Tek foto.');frame.getContext('2d').drawImage(video,0,0);
  const blob=await new Promise(resolve=>frame.toBlob(resolve,'image/jpeg',.94));frame.width=frame.height=1;
  if(current!==generation)return;
  if(blob)await acceptPhoto(blob,'entropi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg');else state('error','Fotoet kunne ikkje takast.')
}

function reset(){++generation;clearScene();stopCamera();clearPhoto();finder.clear();pointer=null;lastTap=0;state('camera');if(hadCamera)void startCamera()}
function printCurrent(){const source=scene,blob=photoBlob,image=studioControls.image;if(!blob||image===1&&!source)return;try{void printClient.print(image===0?photoSnapshot(photo):source.snapshot(),()=>blob===photoBlob&&image===studioControls.image&&(image===0||source===scene))}catch(error){$('status').textContent=error.message}}
async function save(){
  if(!photoBlob)return;
  const blob=photoBlob,file=new File([blob],photoName,{type:blob.type});
  try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}}catch(error){if(error.name==='AbortError')return}
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=photoName;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

$('capture-plane').addEventListener('click',()=>void capture());$('reset').addEventListener('click',reset);$('save').addEventListener('click',()=>void save());
$('retry').addEventListener('click',()=>{if(photoBlob)void makeScene();else{reset();void startCamera()}});
$('studio').addEventListener('pointerdown',event=>{if(!event.isPrimary||event.target.closest('button,a')&&!event.target.closest('#capture-plane')){pointer=null;lastTap=0;return}pointer=mode==='working'||mode==='done'?{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}:null});
$('studio').addEventListener('pointerup',event=>{const tap=pointer;pointer=null;const now=performance.now();if(tap&&tap.id===event.pointerId&&now-tap.time>=500&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=12&&mode==='done'){lastTap=0;printCurrent();return}if(!tap||tap.id!==event.pointerId||now-tap.time>350||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>12){lastTap=0;return}if(lastTap&&now-lastTap<350){captureAfter=now+400;reset()}else lastTap=now});
$('studio').addEventListener('pointercancel',()=>{pointer=null;lastTap=0});
$('studio').addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){pointer=null;lastTap=0}},true);
$('studio').addEventListener('contextmenu',event=>{if(!event.target.closest('button,a'))event.preventDefault()});
window.addEventListener('message',event=>{if(event.source===window.opener&&allowedOrigins.has(event.origin)&&event.data?.type==='entropi-photo')void acceptPhoto(event.data.blob,typeof event.data.name==='string'?event.data.name:'entropi.jpg')});
function resume(){finder.active=!photoBlob&&!document.hidden;if(!document.hidden&&mode==='camera')void startCamera();else if(!document.hidden&&studioControls.image===1)scene?.refresh?.()}
document.addEventListener('visibilitychange',()=>{if(document.hidden){finder.active=false;stopCamera()}else resume()});
window.addEventListener('pageshow',event=>{if(event.persisted)resume()});
window.addEventListener('pagehide',event=>{stopCamera();finder.active=false;if(!event.persisted){++generation;clearScene();clearPhoto();finder.dispose();studioControls.dispose();printClient.dispose()}});
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowedOrigins.has(origin))window.opener.postMessage({type:'entropi-ready'},origin)}catch{}
if(!document.hidden&&(navigator.standalone||globalThis.matchMedia?.('(display-mode: standalone)')?.matches))void startCamera();
