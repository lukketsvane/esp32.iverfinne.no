import { Viewfinder } from './vendor/viewfinder.mjs';
import { createDepthScene } from './vendor/scene.mjs';
import { attachStudioControls } from './vendor/studio.mjs';
import { PX10Printer } from './vendor/print/printer.mjs';
import { cloudPrintJob } from './vendor/print/cloud-raster.mjs';
import { createPrintClient } from './vendor/print-client.mjs';

const $=id=>document.getElementById(id),video=$('video'),finder=new Viewfinder($('viewfinder'));
const allowedOrigins=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
let mode='camera',stream=null,photoBlob=null,photoName='entropi.jpg',scene=null,task=null,generation=0,openingCamera=false,hadCamera=false,pointer=null,lastTap=0,captureAfter=0;
const studioControls=attachStudioControls([$('studio')],(kind,level)=>{if(kind==='primitive')scene?.setPrimitiveLevel(level)},()=>true,()=>{pointer=null;lastTap=0});
const printClient=createPrintClient({printer:new PX10Printer(),buildJob:cloudPrintJob,report:message=>{$('status').textContent=message}});

function state(next,message=''){
  mode=next;$('studio').className='studio '+next;$('status').textContent=message;
  $('finder').classList.toggle('hidden',next==='done');$('scene').classList.toggle('hidden',next!=='done');$('progress').hidden=next!=='working';
  $('capture-plane').hidden=next!=='camera'&&next!=='working';$('retry').hidden=next!=='error';$('reset').hidden=next==='camera';$('save').hidden=next==='camera'||!photoBlob;
  $('capture-plane').setAttribute('aria-label',next==='working'?'Dobbelttrykk for å avbryte berekninga':stream?'Ta foto':'Opne kameraet');
  finder.active=next!=='done'&&!document.hidden;
}
function stopCamera(){stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null}
function clearScene(){task?.abort();task=null;scene?.dispose();scene=null;$('scene').replaceChildren()}
function progress(update){const known=Number.isFinite(update.percent);$('progress').classList.toggle('indeterminate',!known);$('progress').firstElementChild.style.width=known?Math.max(0,Math.min(100,update.percent))+'%':'';$('status').textContent=update.phase.startsWith('loading')?'Lastar modell til telefonen.':'Reknar djupn på telefonen.'}

async function startCamera(){
  if(openingCamera||stream||mode!=='camera')return;
  const current=generation;openingCamera=true;$('status').textContent='Opnar kameraet.';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera krev ein trygg HTTPS-nettlesar.');
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    if(current!==generation||mode!=='camera'){media.getTracks().forEach(track=>track.stop());return}
    stream=media;video.srcObject=media;await video.play();
    if(current!==generation||mode!=='camera')return;
    finder.source=video;hadCamera=true;state('camera');
  }catch(error){if(current===generation){stopCamera();state('error',error.name==='NotAllowedError'?'Gi kameraet tilgang og prøv igjen.':error.message||'Kameraet kunne ikkje opnast.')}}
  finally{openingCamera=false}
}

async function acceptPhoto(blob,name='entropi.jpg',frame){
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>40*1024*1024){state('error','Kamerafotoet kunne ikkje lesast.');return}
  const current=++generation;clearScene();stopCamera();photoBlob=blob;photoName=name.replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-100)||'entropi.jpg';task=new AbortController();const signal=task.signal;
  state('working','Lagar 3D på telefonen.');progress({phase:'reading'});
  try{
    if(!frame){
      const image=new Image(),url=URL.createObjectURL(blob);
      try{image.src=url;await image.decode();signal.throwIfAborted();frame=document.createElement('canvas');frame.width=image.naturalWidth;frame.height=image.naturalHeight;frame.getContext('2d').drawImage(image,0,0)}finally{URL.revokeObjectURL(url)}
    }
    if(current!==generation)return;
    finder.source=frame;
    const result=await createDepthScene($('scene'),blob,update=>{if(current===generation)progress(update)},signal,studioControls.quality);
    if(current!==generation){result.dispose();return}
    scene=result;scene.setPrimitiveLevel(studioControls.primitive);finder.clear();state('done');
  }catch(error){if(!signal.aborted&&current===generation)state('error',error.message||'Kunne ikkje lage 3D.')}
  finally{if(frame&&(current!==generation||mode==='done')){frame.width=frame.height=1}}
}

async function capture(){
  if(mode!=='camera'||performance.now()<captureAfter)return;
  if(!stream){await startCamera();return}
  if(!video.videoWidth)return;
  const current=generation,frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;
  state('working','Tek foto.');frame.getContext('2d').drawImage(video,0,0);
  const blob=await new Promise(resolve=>frame.toBlob(resolve,'image/jpeg',.94));
  if(current!==generation){frame.width=frame.height=1;return}
  if(blob)await acceptPhoto(blob,'entropi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg',frame);
  else{frame.width=frame.height=1;state('error','Fotoet kunne ikkje takast.')}
}

function reset(){++generation;clearScene();stopCamera();photoBlob=null;finder.clear();pointer=null;lastTap=0;state('camera');if(hadCamera)void startCamera()}
async function save(){
  if(!photoBlob)return;
  const blob=photoBlob,file=new File([blob],photoName,{type:blob.type});
  try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}}catch(error){if(error.name==='AbortError')return}
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=photoName;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

$('capture-plane').addEventListener('click',()=>void capture());$('reset').addEventListener('click',reset);$('save').addEventListener('click',()=>void save());
$('retry').addEventListener('click',()=>{if(photoBlob)void acceptPhoto(photoBlob,photoName);else{reset();void startCamera()}});
$('studio').addEventListener('pointerdown',event=>{if(!event.isPrimary||event.target.closest('button,a')&&!event.target.closest('#capture-plane')){pointer=null;lastTap=0;return}pointer=mode==='working'||mode==='done'?{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}:null});
$('studio').addEventListener('pointerup',event=>{const tap=pointer;pointer=null;const now=performance.now();if(tap&&tap.id===event.pointerId&&now-tap.time>=500&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=12&&mode==='done'&&scene){lastTap=0;const source=scene;try{void printClient.print(source.snapshot(),()=>source===scene)}catch(error){$('status').textContent=error.message}return}if(!tap||tap.id!==event.pointerId||now-tap.time>350||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>12){lastTap=0;return}if(lastTap&&now-lastTap<350){captureAfter=now+400;reset()}else lastTap=now});
$('studio').addEventListener('pointercancel',()=>{pointer=null;lastTap=0});
$('studio').addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){pointer=null;lastTap=0}},true);
$('scene').addEventListener('contextmenu',event=>event.preventDefault());
window.addEventListener('message',event=>{if(event.source===window.opener&&allowedOrigins.has(event.origin)&&event.data?.type==='entropi-photo')void acceptPhoto(event.data.blob,typeof event.data.name==='string'?event.data.name:'entropi.jpg')});
document.addEventListener('visibilitychange',()=>{finder.active=!document.hidden&&mode!=='done'});
window.addEventListener('pagehide',()=>{++generation;clearScene();stopCamera();finder.dispose();studioControls.dispose();printClient.dispose()},{once:true});
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowedOrigins.has(origin))window.opener.postMessage({type:'entropi-ready'},origin)}catch{}
