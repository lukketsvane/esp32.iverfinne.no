import { Viewfinder } from './vendor/viewfinder.mjs';
import { createDepthScene } from './vendor/scene.mjs';
import { attachStudioControls } from './vendor/studio.mjs';
import { snapshotBlob, savePhoto } from './vendor/photo.mjs';
import { attachPhotoGestures } from './vendor/photo-gestures.mjs';
import { createPhotoView } from './vendor/photo-view.mjs';
import { DEFAULT_ADJUSTMENTS, normalizeAdjustments, readAdjustments, saveAdjustments } from './vendor/image-adjustments.mjs';
import { attachAdjustmentControls } from './vendor/adjustment-controls.mjs';
import { COLOR_SCHEMES, readColorScheme, saveColorScheme } from './vendor/color-schemes.mjs';
import { PX10Printer } from './vendor/print/printer.mjs';
import { cloudPrintJob } from './vendor/print/cloud-raster.mjs';
import { createPrintClient } from './vendor/print-client.mjs';

const $=id=>document.getElementById(id),video=$('video'),photo=$('photo'),finder=new Viewfinder($('viewfinder'));
const allowedOrigins=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
let mode='camera',stream=null,photoBlob=null,photoUrl=null,photoReady=false,photoName='entropi.jpg',scene=null,task=null,generation=0,captureGeneration=0,cameraGeneration=0,openingCamera=false,hadCamera=false,capturing=false,printing=false,retryScene=false,printTimer=0,pointer=null,lastTap=0,captureAfter=0;
const photoView=createPhotoView(photo);
let imageAdjustments=readAdjustments(),adjustmentControls=null;
let pixelSize=1;
try{const stored=Number(globalThis.localStorage?.getItem('entropi-pixel-size-v1'));if(Number.isFinite(stored)&&stored>=1&&stored<=8)pixelSize=stored}catch{}
const paletteSelection={photo:readColorScheme('photo'),depth:readColorScheme('depth')};
const profileIndex=kind=>Math.max(0,COLOR_SCHEMES.findIndex(scheme=>scheme.id===paletteSelection[kind]));
const studioControls=attachStudioControls([$('studio')],(kind,level)=>{
  if(kind==='primitive'){
    const scheme=COLOR_SCHEMES[level];paletteSelection.depth=scheme.id;saveColorScheme('depth',scheme.id);
    scene?.setPalette(scheme.id);scene?.setPrimitiveLevel(scheme.primitive);
  }else if(kind==='photo'){
    const scheme=COLOR_SCHEMES[level];paletteSelection.photo=scheme.id;saveColorScheme('photo',scheme.id);
    photoView.setPalette(scheme.id);finder.setPalette(scheme.id);photoView.setStyle(scheme.style);finder.setStyle(scheme.style);
  }else if(kind==='image'&&mode!=='camera'){
    if(capturing)state('working');else if(photoReady){if(level===0||scene){state('done');if(level===1)scene?.refresh?.()}else void makeScene()}
  }
},()=>!adjustmentControls?.open,()=>{pointer=null;lastTap=0},{photo:profileIndex('photo'),primitive:profileIndex('depth')});
photoView.setStyle(COLOR_SCHEMES[studioControls.photo].style);finder.setStyle(COLOR_SCHEMES[studioControls.photo].style);
photoView.setPalette(paletteSelection.photo);finder.setPalette(paletteSelection.photo);
function sizeGesture(){pointer=null;lastTap=0;captureAfter=performance.now()+400}
function applyPixelSize(value){
  const next=Number.isFinite(value)?Math.max(1,Math.min(8,value)):pixelSize,changed=next!==pixelSize;pixelSize=next;
  photoGestures.state.grain=liveGestures.state.grain=pixelSize;
  photoView.setTone({grain:pixelSize});finder.setTone({grain:pixelSize});scene?.setPixelSize(pixelSize);
  if(changed)try{globalThis.localStorage?.setItem('entropi-pixel-size-v1',String(pixelSize))}catch{}
  syncAdjustments();
}
function applyAdjustments(patch={}){
  const next=normalizeAdjustments({...imageAdjustments,...patch}),changed=Object.keys(next).some(key=>next[key]!==imageAdjustments[key]);
  imageAdjustments=next;photoGestures.state.contrast=liveGestures.state.contrast=next.contrast;
  photoView.setAdjustments(next);finder.setAdjustments(next);scene?.setAdjustments(next);
  if(changed)saveAdjustments(next);syncAdjustments();
}
function syncAdjustments(){
  if(!adjustmentControls)return;
  adjustmentControls.setContext(mode==='camera'?'camera':studioControls.image===1?'depth':'photo');
  adjustmentControls.update({...imageAdjustments,pixelSize,rotation:mode==='camera'?liveGestures.state.rotation:photoGestures.state.rotation});
}
function refreshFinderRotation(){
  const angle=liveGestures.state.rotation,radians=angle*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians)),rect=$('finder').getBoundingClientRect();
  const width=rect.width||2,height=rect.height||3,fit=Math.min(width/(width*c+height*s),height/(width*s+height*c));
  finder.setRotation(angle);$('viewfinder').style.transform=angle?`rotate(${angle}deg) scale(${fit})`:'';
}
function applyRotation(value){
  if(!Number.isFinite(value))return;
  if(mode==='camera'){liveGestures.state.rotation=value;refreshFinderRotation()}
  else {photoGestures.state.rotation=value;photoGestures.refresh();scene?.setRotation(value)}
  syncAdjustments();updateRecenter();
}
const photoGestures=attachPhotoGestures(photo,{enabled:()=>!document.hidden&&!adjustmentControls?.open&&mode==='done'&&studioControls.image===0,onGesture:sizeGesture,onChange:pose=>{applyPixelSize(pose.grain);applyAdjustments({contrast:pose.contrast});photoView.refresh(pose);scene?.setRotation(pose.rotation);syncAdjustments();updateRecenter()}});
const liveGestures=attachPhotoGestures($('capture-plane'),{toneOnly:true,enabled:()=>!document.hidden&&!adjustmentControls?.open&&mode==='camera',onGesture:sizeGesture,onChange:pose=>{captureAfter=performance.now()+400;applyPixelSize(pose.grain);applyAdjustments({contrast:pose.contrast});refreshFinderRotation();syncAdjustments()}});
applyPixelSize(pixelSize);
applyAdjustments();
adjustmentControls=attachAdjustmentControls($('studio'),{
  initial:{...imageAdjustments,pixelSize,rotation:0},
  onChange(patch){
    sizeGesture();
    if('pixelSize' in patch)applyPixelSize(patch.pixelSize);
    if('rotation' in patch)applyRotation(patch.rotation);
    if(Object.keys(patch).some(key=>key in DEFAULT_ADJUSTMENTS))applyAdjustments(patch);
  },
  onReset(){sizeGesture();applyPixelSize(1);applyAdjustments(DEFAULT_ADJUSTMENTS);applyRotation(0)},
  onOpenChange(open){sizeGesture();photoGestures.cancel();liveGestures.cancel();scene?.cancelGestures?.();studioControls.cancel?.();$('scene').style.pointerEvents=open?'none':''}
});
function updateRecenter(){$('recenter').hidden=mode!=='done'||(studioControls.image===0?photoGestures.state.scale<=1&&Math.abs(photoGestures.state.rotation%360)<.01:!scene)}
function printFeedback(message){clearTimeout(printTimer);$('print-status').textContent=message;printTimer=setTimeout(()=>{$('print-status').textContent=''},6000)}
const printClient=createPrintClient({printer:new PX10Printer(),buildJob:cloudPrintJob,report:printFeedback});

function state(next,message='',sceneFailure=false){
  photoGestures.cancel?.();liveGestures.cancel?.();scene?.cancelGestures?.();
  mode=next;retryScene=next==='error'&&sceneFailure;$('studio').className='studio '+next;$('status').textContent=message;
  const reviewing=next!=='camera'&&!capturing&&!!photoBlob,splats=reviewing&&next==='done'&&studioControls.image===1&&scene,showPhoto=reviewing&&next==='done'&&studioControls.image===0&&photoReady,splatWorking=next==='working'&&studioControls.image===1;
  $('finder').classList.toggle('hidden',reviewing||splatWorking);photo.hidden=!showPhoto;$('scene').classList.toggle('hidden',!splats);$('progress').hidden=next!=='working';
  $('capture-plane').hidden=next!=='camera';$('retry').hidden=next!=='error';$('reset').hidden=next==='camera';$('save').hidden=!showPhoto&&!splats;$('last-photo').hidden=next!=='camera'||!photoReady;$('print').hidden=!showPhoto&&!splats;
  photoView.show(showPhoto);
  $('studio').setAttribute('aria-busy',String(next==='working'));$('print').disabled=printing;
  updateRecenter();
  if(next==='done'&&studioControls.image===0)photoGestures.refresh?.();
  syncAdjustments();
  $('capture-plane').setAttribute('aria-label',stream?'Ta foto':'Opne kameraet');
  finder.active=!reviewing&&!splatWorking&&!document.hidden;
}
function stopCamera(){++cameraGeneration;openingCamera=false;$('studio').classList.remove('opening');stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null}
function clearScene(){task?.abort();task=null;scene?.dispose();scene=null;$('scene').replaceChildren()}
function clearPhoto(){if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;photoBlob=null;photoReady=false;photo.removeAttribute('src');$('thumbnail').removeAttribute('src')}
function progress(update){if(studioControls.image!==1||mode==='camera'||capturing)return;const known=Number.isFinite(update.percent);$('progress').classList.toggle('indeterminate',!known);$('progress').firstElementChild.style.width=known?Math.max(0,Math.min(100,update.percent))+'%':'';$('status').textContent=''}

async function startCamera(){
  if(openingCamera||stream||mode!=='camera'||document.hidden)return;
  const current=generation,attempt=++cameraGeneration;openingCamera=true;$('studio').classList.add('opening');$('status').textContent='';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera krev ein trygg HTTPS-nettlesar.');
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    if(attempt!==cameraGeneration||current!==generation||mode!=='camera'||document.hidden){media.getTracks().forEach(track=>track.stop());return}
    stream=media;video.srcObject=media;await video.play();
    if(attempt!==cameraGeneration||current!==generation||mode!=='camera'||document.hidden)return;
    finder.source=video;hadCamera=true;state('camera');
  }catch(error){if(attempt===cameraGeneration&&current===generation&&mode==='camera'&&!document.hidden){stopCamera();state('error',error.name==='NotAllowedError'?'Gi kameraet tilgang og prøv igjen.':error.message||'Kameraet kunne ikkje opnast.')}}
  finally{if(attempt===cameraGeneration){openingCamera=false;$('studio').classList.remove('opening')}}
}

async function makeScene(){
  if(!photoReady||studioControls.image!==1||mode==='camera')return;
  if(scene){state('done');scene.refresh?.();return}
  state('working');if(task)return;
  const current=generation,blob=photoBlob,processing=task=new AbortController();progress({phase:'reading'});
  try{
    const result=await createDepthScene($('scene'),blob,update=>{if(current===generation)progress(update)},processing.signal);
    if(current!==generation||blob!==photoBlob){result.dispose();return}
    scene=result;scene.onPixelSize=value=>{sizeGesture();applyPixelSize(value)};scene.setPixelSize(pixelSize);scene.setAdjustments(imageAdjustments);
    scene.onRotation=value=>{photoGestures.state.rotation=value;photoGestures.refresh();syncAdjustments();updateRecenter()};scene.setRotation(photoGestures.state.rotation);
    scene.onError=error=>{if(scene===result&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message,true)};scene.setPrimitiveLevel(COLOR_SCHEMES[studioControls.primitive].primitive);scene.setPalette(paletteSelection.depth);if(mode!=='camera'&&!capturing)state('done');
  }catch(error){if(!processing.signal.aborted&&current===generation&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message||'Kunne ikkje lage splats.',true)}
  finally{if(task===processing)task=null}
}

async function acceptPhoto(blob,name='entropi.jpg',rotation=0){
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>40*1024*1024){state('error','Kamerafotoet kunne ikkje lesast.');return}
  const current=++generation;++captureGeneration;capturing=false;clearScene();stopCamera();clearPhoto();photoBlob=blob;photoName=name.replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-100)||'entropi.jpg';photoUrl=URL.createObjectURL(blob);photo.src=photoUrl;$('thumbnail').src=photoUrl;
  state('working');
  try{await photo.decode();if(current!==generation)return;photoView.setSource();photoReady=true;photoGestures.reset();photoGestures.state.rotation=rotation;photoGestures.refresh();if(studioControls.image===1)await makeScene();else state('done')}
  catch(error){if(current===generation)state('error',error.message||'Fotoet kunne ikkje lesast.')}
}

async function capture(){
  if(mode!=='camera'||openingCamera||adjustmentControls.open||performance.now()<captureAfter)return;
  if(!stream){await startCamera();return}
  if(!video.videoWidth||video.readyState<2)return;
  const current=generation,captureId=++captureGeneration,rotation=liveGestures.state.rotation;let frame;
  capturing=true;state('working');
  try{
    frame=finder.capture(video);
    const blob=await new Promise(resolve=>frame.toBlob(resolve,'image/png'));
    if(current!==generation||captureId!==captureGeneration)return;capturing=false;if(document.hidden){state('camera');return}
    if(blob)await acceptPhoto(blob,'entropi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png',rotation);else state('error','Fotoet kunne ikkje takast.')
  }catch(error){if(current===generation&&captureId===captureGeneration&&!document.hidden)state('error',error.message||'Fotoet kunne ikkje takast.')}
  finally{if(captureId===captureGeneration)capturing=false;if(frame)frame.width=frame.height=1}
}

function reset(){++captureGeneration;capturing=false;if(!photoReady){++generation;clearScene();clearPhoto()}stopCamera();finder.clear();pointer=null;lastTap=0;state('camera');if(hadCamera)void startCamera()}
async function printCurrent(){const source=scene,blob=photoBlob,image=studioControls.image;if(printing||mode!=='done'||!photoReady||image===1&&!source)return;printing=true;$('print').disabled=true;try{await printClient.print(image===0?photoView.snapshot(photoGestures.state):source.snapshot(),()=>mode==='done'&&blob===photoBlob&&image===studioControls.image&&(image===0||source===scene))}catch(error){printFeedback(error.message)}finally{printing=false;$('print').disabled=false}}
async function save(){
  if(!photoBlob||!photoReady||mode!=='done'||studioControls.image===1&&!scene)return;
  const blob=photoBlob,source=scene,image=studioControls.image;
  try{const rendered=snapshotBlob(image===1?source.snapshot(true):photoView.snapshot(photoGestures.state,true));await savePhoto(rendered,photoName.replace(/\.[^.]+$/,'')+'.png',()=>photoBlob===blob&&mode==='done'&&studioControls.image===image&&(image===0||scene===source))}catch(error){printFeedback(error.message)}
}

$('capture-plane').addEventListener('click',()=>void capture());$('reset').addEventListener('click',reset);$('save').addEventListener('click',()=>void save());
$('last-photo').addEventListener('click',()=>{if(!photoReady)return;stopCamera();state('done');if(studioControls.image===1)void makeScene()});$('print').addEventListener('click',()=>void printCurrent());
$('recenter').addEventListener('click',()=>{if(studioControls.image===0)photoGestures.reset();else scene?.resetView?.()});
$('retry').addEventListener('click',()=>{if(retryScene&&photoReady&&studioControls.image===1)void makeScene();else{reset();void startCamera()}});
$('studio').addEventListener('pointerdown',event=>{if(adjustmentControls.open||event.target.closest('[data-adjustments]')||!event.isPrimary||event.target.closest('button,a,input,select')&&!event.target.closest('#capture-plane')){pointer=null;lastTap=0;return}pointer=mode==='working'||mode==='done'?{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}:null});
$('studio').addEventListener('pointerup',event=>{const tap=pointer;pointer=null;const now=performance.now();if(tap&&tap.id===event.pointerId&&now-tap.time>=500&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=12&&mode==='done'){lastTap=0;printCurrent();return}if(!tap||tap.id!==event.pointerId||now-tap.time>350||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>12){lastTap=0;return}if(lastTap&&now-lastTap<350){captureAfter=now+400;reset()}else lastTap=now});
$('studio').addEventListener('pointercancel',()=>{pointer=null;lastTap=0});
$('studio').addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){pointer=null;lastTap=0}},true);
$('studio').addEventListener('contextmenu',event=>{if(!event.target.closest('button,a'))event.preventDefault()});
window.addEventListener('message',event=>{if(event.source===window.opener&&allowedOrigins.has(event.origin)&&event.data?.type==='entropi-photo')void acceptPhoto(event.data.blob,typeof event.data.name==='string'?event.data.name:'entropi.jpg')});
function resume(){finder.active=mode==='camera'&&!document.hidden;if(!document.hidden&&mode==='camera')void startCamera();else if(!document.hidden){if(studioControls.image===1)scene?.refresh?.();else photoGestures.refresh?.()}}
function suspend(){stopCamera();photoGestures.cancel?.();liveGestures.cancel?.();scene?.cancelGestures?.();if(capturing){++captureGeneration;capturing=false;state('camera')}finder.active=false;pointer=null;lastTap=0}
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else resume()});
window.addEventListener('pageshow',event=>{if(event.persisted)resume()});
window.addEventListener('keydown',event=>{if(adjustmentControls.open){if(event.key==='Escape'){event.preventDefault();adjustmentControls.close()}return}if(event.key==='Escape'&&mode!=='camera'){event.preventDefault();reset()}else if(event.code==='Space'&&!event.repeat&&!['INPUT','SELECT','BUTTON','A'].includes(document.activeElement?.tagName)){event.preventDefault();if(mode==='camera')void capture()}});
window.addEventListener('pagehide',event=>{suspend();if(!event.persisted){++generation;clearTimeout(printTimer);adjustmentControls.dispose();clearScene();clearPhoto();finder.dispose();photoGestures.dispose();liveGestures.dispose();photoView.dispose();studioControls.dispose();printClient.dispose()}});
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowedOrigins.has(origin))window.opener.postMessage({type:'entropi-ready'},origin)}catch{}
if(!document.hidden&&(navigator.standalone||globalThis.matchMedia?.('(display-mode: standalone)')?.matches))void startCamera();
