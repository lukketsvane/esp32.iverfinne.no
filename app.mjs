import { Viewfinder } from './vendor/viewfinder.mjs';
import { createDepthScene } from './vendor/scene.mjs';
import { attachStudioControls } from './vendor/studio.mjs';
import { snapshotBlob, savePhoto } from './vendor/photo.mjs';
import { attachPhotoGestures } from './vendor/photo-gestures.mjs';
import { createPhotoView } from './vendor/photo-view.mjs';
import { COLOR_SCHEMES, readColorScheme, saveColorScheme } from './vendor/color-schemes.mjs';
import { PX10Printer } from './vendor/print/printer.mjs';
import { cloudPrintJob } from './vendor/print/cloud-raster.mjs';
import { createPrintClient } from './vendor/print-client.mjs';
import { createArchive } from './vendor/archive.mjs';

const $=id=>document.getElementById(id),video=$('video'),photo=$('photo'),finder=new Viewfinder($('viewfinder'));
const allowedOrigins=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
const gallery=createArchive();
let facingMode='environment',shutterDelay=0,shutterTimer=null,shutterCountdown=0,galleryOpen=false;
let mode='camera',stream=null,photoBlob=null,photoUrl=null,photoReady=false,photoName='entropi.jpg',scene=null,task=null,generation=0,captureGeneration=0,cameraGeneration=0,openingCamera=false,hadCamera=false,capturing=false,printing=false,retryScene=false,printTimer=0,pointer=null,lastTap=0,captureAfter=0;
const photoView=createPhotoView(photo);
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
},()=>true,()=>{pointer=null;lastTap=0},{photo:profileIndex('photo'),primitive:profileIndex('depth')});
photoView.setStyle(COLOR_SCHEMES[studioControls.photo].style);finder.setStyle(COLOR_SCHEMES[studioControls.photo].style);
photoView.setPalette(paletteSelection.photo);finder.setPalette(paletteSelection.photo);
const photoGestures=attachPhotoGestures(photo,{enabled:()=>mode==='done'&&studioControls.image===0,onChange:pose=>{photoView.setTone(pose);finder.setTone(pose);Object.assign(liveGestures.state,{grain:pose.grain,contrast:pose.contrast});photoView.refresh();updateRecenter()}});
const liveGestures=attachPhotoGestures($('capture-plane'),{toneOnly:true,enabled:()=>mode==='camera'&&studioControls.image===0,onChange:pose=>{if(pose.grain!==photoGestures.state.grain||pose.contrast!==photoGestures.state.contrast)captureAfter=performance.now()+400;Object.assign(photoGestures.state,{grain:pose.grain,contrast:pose.contrast});photoView.setTone(pose);finder.setTone(pose)}});
function updateRecenter(){$('recenter').hidden=mode!=='done'||(studioControls.image===0?photoGestures.state.scale<=1:!scene)}
function printFeedback(message){clearTimeout(printTimer);$('print-status').textContent=message;printTimer=setTimeout(()=>{$('print-status').textContent=''},6000)}
const printClient=createPrintClient({printer:new PX10Printer(),buildJob:cloudPrintJob,report:printFeedback});

function state(next,message='',sceneFailure=false){
  mode=next;retryScene=next==='error'&&sceneFailure;$('studio').className='studio '+next;$('status').textContent=message;
  const reviewing=next!=='camera'&&!capturing&&!!photoBlob,splats=reviewing&&next==='done'&&studioControls.image===1&&scene,showPhoto=reviewing&&next==='done'&&studioControls.image===0&&photoReady,splatWorking=next==='working'&&studioControls.image===1;
  $('finder').classList.toggle('hidden',reviewing||splatWorking);photo.hidden=!showPhoto;$('scene').classList.toggle('hidden',!splats);$('progress').hidden=next!=='working';
  $('capture-plane').hidden=next!=='camera';$('retry').hidden=next!=='error';$('reset').hidden=next==='camera';$('save').hidden=!showPhoto&&!splats;$('last-photo').hidden=next!=='camera'||!photoReady;$('print').hidden=!showPhoto&&!splats;
  photoView.show(showPhoto);
  $('studio').setAttribute('aria-busy',String(next==='working'));$('print').disabled=printing;
  updateRecenter();
  $('phone-shutter').hidden=next!=='camera';
  $('phone-shutter').disabled=openingCamera&&!stream;
  $('phone-state').textContent=next==='camera'?(stream?'KAMERAET ER KLART':'TRYKK FOR Å OPNE KAMERAET'):next==='working'?'FRAMKALLAR BILETET':next==='done'?'BILETET ER KLART':message||'KAMERAET ER IKKJE KLART';
  if(next==='done'&&studioControls.image===0)photoGestures.refresh?.();
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
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}},audio:false});
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
    scene=result;scene.onError=error=>{if(scene===result&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message,true)};scene.setPrimitiveLevel(COLOR_SCHEMES[studioControls.primitive].primitive);scene.setPalette(paletteSelection.depth);if(mode!=='camera'&&!capturing)state('done');
  }catch(error){if(!processing.signal.aborted&&current===generation&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message||'Kunne ikkje lage splats.',true)}
  finally{if(task===processing)task=null}
}

async function acceptPhoto(blob,name='entropi.jpg'){
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>40*1024*1024){state('error','Kamerafotoet kunne ikkje lesast.');return}
  const current=++generation;++captureGeneration;capturing=false;clearScene();stopCamera();clearPhoto();photoBlob=blob;photoName=name.replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-100)||'entropi.jpg';photoUrl=URL.createObjectURL(blob);photo.src=photoUrl;$('thumbnail').src=photoUrl;
  state('working');
  void gallery.save(blob).then(refreshPhoneGalleryCount).catch(()=>printFeedback('Fotoet er ikkje arkivert automatisk. Bruk lagreknappen før du går vidare.'));
  try{await photo.decode();if(current!==generation)return;photoView.setSource();photoReady=true;photoGestures.reset();if(studioControls.image===1)await makeScene();else state('done')}
  catch(error){if(current===generation)state('error',error.message||'Fotoet kunne ikkje lesast.')}
}

async function capture(){
  if(mode!=='camera'||openingCamera||performance.now()<captureAfter)return;
  if(!stream){await startCamera();return}
  if(!video.videoWidth||video.readyState<2)return;
  const current=generation,captureId=++captureGeneration;let frame;
  capturing=true;state('working');
  try{
    frame=finder.capture(video);
    const blob=await new Promise(resolve=>frame.toBlob(resolve,'image/png'));
    if(current!==generation||captureId!==captureGeneration)return;capturing=false;if(document.hidden){state('camera');return}
    if(blob)await acceptPhoto(blob,'entropi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png');else state('error','Fotoet kunne ikkje takast.')
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
$('studio').addEventListener('pointerdown',event=>{if(!event.isPrimary||event.target.closest('button,a')&&!event.target.closest('#capture-plane')){pointer=null;lastTap=0;return}pointer=mode==='working'||mode==='done'?{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}:null});
$('studio').addEventListener('pointerup',event=>{const tap=pointer;pointer=null;const now=performance.now();if(tap&&tap.id===event.pointerId&&now-tap.time>=500&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=12&&mode==='done'){lastTap=0;printCurrent();return}if(!tap||tap.id!==event.pointerId||now-tap.time>350||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>12){lastTap=0;return}if(lastTap&&now-lastTap<350){captureAfter=now+400;reset()}else lastTap=now});
$('studio').addEventListener('pointercancel',()=>{pointer=null;lastTap=0});
$('studio').addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){pointer=null;lastTap=0}},true);
$('studio').addEventListener('contextmenu',event=>{if(!event.target.closest('button,a'))event.preventDefault()});
window.addEventListener('message',event=>{if(event.source===window.opener&&allowedOrigins.has(event.origin)&&event.data?.type==='entropi-photo')void acceptPhoto(event.data.blob,typeof event.data.name==='string'?event.data.name:'entropi.jpg')});
function resume(){finder.active=mode==='camera'&&!document.hidden&&!galleryOpen;if(!document.hidden&&mode==='camera'&&!galleryOpen)void startCamera();else if(!document.hidden){if(studioControls.image===1)scene?.refresh?.();else photoGestures.refresh?.()}}
function suspend(){stopCamera();if(capturing){++captureGeneration;capturing=false;state('camera')}finder.active=false;pointer=null;lastTap=0}
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else resume()});
window.addEventListener('pageshow',event=>{if(event.persisted)resume()});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&mode!=='camera'){event.preventDefault();reset()}else if(event.code==='Space'&&!event.repeat&&!['INPUT','BUTTON','A'].includes(document.activeElement?.tagName)){event.preventDefault();if(mode==='camera')void capture()}});
window.addEventListener('pagehide',event=>{suspend();if(!event.persisted){++generation;clearTimeout(printTimer);clearScene();clearPhoto();finder.dispose();photoGestures.dispose();liveGestures.dispose();photoView.dispose();studioControls.dispose();printClient.dispose()}});
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowedOrigins.has(origin))window.opener.postMessage({type:'entropi-ready'},origin)}catch{}
if(!document.hidden&&(navigator.standalone||globalThis.matchMedia?.('(display-mode: standalone)')?.matches))void startCamera();

let galleryItems=[],galleryCurrent=null,galleryUrls=[],galleryImageUrl=null,galleryDeleteConfirm=false;

function clearShutterDelay(){
  if(shutterTimer)clearTimeout(shutterTimer);
  shutterTimer=null;shutterCountdown=0;
  $('phone-state').textContent=stream?'KAMERAET ER KLART':'TRYKK FOR Å OPNE KAMERAET';
}
$('phone-timer').addEventListener('click',()=>{
  shutterDelay=shutterDelay===0?3:shutterDelay===3?10:0;
  $('phone-timer').textContent=shutterDelay?'TIDTAKAR · '+shutterDelay+' S':'TIDTAKAR · AV';
  $('phone-timer').setAttribute('aria-label',shutterDelay?'Utløysar med '+shutterDelay+' sekund forsinking':'Utløysar utan forsinking');
});
$('phone-shutter').addEventListener('click',()=>{
  if(mode!=='camera'||shutterTimer)return;
  if(!shutterDelay){void capture();return}
  shutterCountdown=shutterDelay;
  const step=()=>{
    if(document.hidden||galleryOpen||mode!=='camera'){clearShutterDelay();return}
    if(!shutterCountdown){shutterTimer=null;$('phone-state').textContent='TEK FOTO';void capture();return}
    $('phone-state').textContent='FOTO OM '+shutterCountdown+' SEKUND';
    shutterCountdown--;shutterTimer=setTimeout(step,1000);
  };
  step();
});
$('flip-camera').addEventListener('click',()=>{
  if(mode!=='camera'||galleryOpen)return;
  facingMode=facingMode==='environment'?'user':'environment';
  stopCamera();void startCamera();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearShutterDelay()});

function clearGalleryUrls(){
  for(const url of galleryUrls)URL.revokeObjectURL(url);
  galleryUrls=[];
  if(galleryImageUrl){URL.revokeObjectURL(galleryImageUrl);galleryImageUrl=null}
}
function galleryUrl(blob){
  const url=URL.createObjectURL(blob);galleryUrls.push(url);return url;
}
async function refreshPhoneGalleryCount(){
  try{
    const items=await gallery.list();
    $('phone-archive-count').textContent=items.length?items.length+' FOTO':'ARKIV';
  }catch{$('phone-archive-count').textContent='ARKIV'}
}
async function openPhoneGallery(){
  galleryOpen=true;clearShutterDelay();
  if(mode==='camera')stopCamera();
  $('phone-vault').hidden=false;
  $('phone-vault-grid').hidden=false;
  $('phone-vault-detail').hidden=true;
  $('phone-vault-info').hidden=false;
  $('phone-vault-count').textContent='HENTAR FOTO…';
  galleryCurrent=null;clearGalleryUrls();
  const grid=$('phone-vault-grid');grid.replaceChildren();
  try{
    galleryItems=await gallery.list();
    $('phone-vault-count').textContent=galleryItems.length+' FOTO · BERRE PÅ DENNE EININGA';
    if(!galleryItems.length){
      const empty=document.createElement('p');empty.textContent='Ingen foto enno.';empty.style.cssText='color:#888;font-size:13px';grid.append(empty);
    }
    for(const item of galleryItems){
      const button=document.createElement('button'),image=document.createElement('img'),caption=document.createElement('span');
      image.alt='Opptak frå '+new Date(item.created).toLocaleDateString('nn-NO');
      if(item.preview)image.src=galleryUrl(item.preview);
      caption.textContent=new Date(item.created).toLocaleString('nn-NO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
      button.append(image,caption);button.addEventListener('click',()=>void showPhoneRecord(item.id));grid.append(button);
    }
  }catch(error){$('phone-vault-count').textContent=error.message||'Arkivet er ikkje tilgjengeleg'}
}
async function showPhoneRecord(id){
  galleryCurrent=id;galleryDeleteConfirm=false;
  const record=await gallery.get(id).catch(()=>null);
  if(!record||galleryCurrent!==id)return;
  if(galleryImageUrl)URL.revokeObjectURL(galleryImageUrl);
  galleryImageUrl=URL.createObjectURL(record.left);
  $('phone-vault-image').src=galleryImageUrl;
  $('phone-vault-grid').hidden=true;
  $('phone-vault-info').hidden=true;
  $('phone-vault-detail').hidden=false;
  $('phone-vault-remove').textContent='Slett';
}
function closePhoneGallery(){
  if(!galleryOpen)return;galleryOpen=false;galleryCurrent=null;
  $('phone-vault').hidden=true;clearGalleryUrls();$('phone-vault-image').removeAttribute('src');
  if(mode==='camera'&&hadCamera&&!document.hidden)void startCamera();
}
$('open-gallery').addEventListener('click',()=>void openPhoneGallery());
$('phone-vault-close').addEventListener('click',closePhoneGallery);
$('phone-vault-back').addEventListener('click',()=>void openPhoneGallery());
$('phone-vault-save').addEventListener('click',async()=>{
  const id=galleryCurrent;if(!id)return;
  const record=await gallery.get(id);if(!record||id!==galleryCurrent)return;
  try{await savePhoto(record.left,'entropi-'+id+'.png',()=>id===galleryCurrent&&galleryOpen)}
  catch(error){$('phone-vault-count').textContent=error.message}
});
$('phone-vault-remove').addEventListener('click',async()=>{
  if(!galleryCurrent)return;
  if(!galleryDeleteConfirm){galleryDeleteConfirm=true;$('phone-vault-remove').textContent='Trykk igjen for å slette';return}
  await gallery.remove(galleryCurrent);galleryCurrent=null;void refreshPhoneGalleryCount();void openPhoneGallery();
});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&galleryOpen){event.preventDefault();if(!$('phone-vault-detail').hidden)void openPhoneGallery();else closePhoneGallery()}
});
void refreshPhoneGalleryCount();
if(new URLSearchParams(location.search).has('gallery'))void openPhoneGallery();
