import { Viewfinder } from './vendor/viewfinder.mjs';
import { createDepthScene } from './vendor/scene.mjs';
import { attachStudioControls } from './vendor/studio.mjs';
import { snapshotBlob, savePhoto } from './vendor/photo.mjs';
import { attachPhotoGestures } from './vendor/photo-gestures.mjs';
import { createPhotoView } from './vendor/photo-view.mjs';
import { createMarigoldView } from './vendor/marigold-view.mjs';
import { COLOR_SCHEMES, readColorScheme, saveColorScheme } from './vendor/color-schemes.mjs';
import { PX10Printer } from './vendor/print/printer.mjs';
import { cloudPrintJob } from './vendor/print/cloud-raster.mjs';
import { createPrintClient } from './vendor/print-client.mjs';
import { createArchive } from './vendor/archive.mjs';
import { createEntropiDocument } from './vendor/entropi-document.mjs';
import { bindExportGesture, pickEntropiDocument } from './vendor/entropi-ui.mjs';

const $=id=>document.getElementById(id),video=$('video'),photo=$('photo'),finder=new Viewfinder($('viewfinder'));
const allowedOrigins=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
const gallery=createArchive();
let currentDocument=null,photoRight=null,archiveState={id:null,pending:null,suppressed:false},documentTimer=0,photoReceivedAt=null;
let facingMode='environment',shutterDelay=0,shutterTimer=null,shutterCountdown=0,galleryOpen=false;
let mode='camera',stream=null,photoBlob=null,photoUrl=null,photoReady=false,photoName='entropi.jpg',scene=null,task=null,artTask=null,generation=0,captureGeneration=0,cameraGeneration=0,openingCamera=false,hadCamera=false,capturing=false,printing=false,retryScene=false,printTimer=0,pointer=null,lastTap=0,captureAfter=0;
const photoView=createPhotoView(photo);
const depthArt=createMarigoldView($('marigold-view'),{onStatus:progress,onGesture:()=>{pointer=null;lastTap=0;captureAfter=performance.now()+400},onChange:()=>{clearTimeout(documentTimer);documentTimer=setTimeout(()=>void persistDocument().catch(error=>printFeedback(failureText(error,saveFailure))),400)}});
const paletteSelection={photo:readColorScheme('photo'),depth:readColorScheme('depth')};
const profileIndex=kind=>Math.max(0,COLOR_SCHEMES.findIndex(scheme=>scheme.id===paletteSelection[kind]));
const studioControls=attachStudioControls([$('studio')],(kind,level)=>{
  if(kind==='primitive'){
    const scheme=COLOR_SCHEMES[level];paletteSelection.depth=scheme.id;saveColorScheme('depth',scheme.id);
    scene?.setPalette(scheme.id);scene?.setPrimitiveLevel(scheme.primitive);schedulePreview();
  }else if(kind==='photo'){
    const scheme=COLOR_SCHEMES[level];paletteSelection.photo=scheme.id;saveColorScheme('photo',scheme.id);
    photoView.setPalette(scheme.id);finder.setPalette(scheme.id);photoView.setStyle(scheme.style);finder.setStyle(scheme.style);schedulePreview();
  }else if(kind==='image'){
    finder.monochrome=level===2;
    if(mode!=='camera'){if(capturing)state('working');else if(photoReady){if(level===2)void makeDepthArt();else if(level===0||scene){state('done');if(level===1)scene?.refresh?.()}else void makeScene()}}
  }
},()=>true,()=>{pointer=null;lastTap=0},{vathography:true,photo:profileIndex('photo'),primitive:profileIndex('depth')});
finder.monochrome=studioControls.image===2;
photoView.setStyle(COLOR_SCHEMES[studioControls.photo].style);finder.setStyle(COLOR_SCHEMES[studioControls.photo].style);
photoView.setPalette(paletteSelection.photo);finder.setPalette(paletteSelection.photo);
const photoGestures=attachPhotoGestures(photo,{enabled:()=>mode==='done'&&studioControls.image===0,onChange:pose=>{photoView.setTone(pose);finder.setTone(pose);Object.assign(liveGestures.state,{grain:pose.grain,contrast:pose.contrast});photoView.refresh();updateRecenter();schedulePreview()}});
const liveGestures=attachPhotoGestures($('capture-plane'),{toneOnly:true,enabled:()=>mode==='camera'&&studioControls.image===0,onChange:pose=>{if(pose.grain!==photoGestures.state.grain||pose.contrast!==photoGestures.state.contrast)captureAfter=performance.now()+400;Object.assign(photoGestures.state,{grain:pose.grain,contrast:pose.contrast});photoView.setTone(pose);finder.setTone(pose)}});
function updateRecenter(){$('recenter').hidden=mode!=='done'||(studioControls.image===0?photoGestures.state.scale<=1:studioControls.image===2?!depthArt.ready:!scene)}
function printFeedback(message){clearTimeout(printTimer);$('print-status').textContent=message;printTimer=setTimeout(()=>{$('print-status').textContent=''},6000)}
const printClient=createPrintClient({printer:new PX10Printer(),buildJob:cloudPrintJob,report:printFeedback});

function state(next,message='',sceneFailure=false){
  mode=next;retryScene=next==='error'&&sceneFailure;$('studio').className='studio '+next;$('status').textContent=message;
  const reviewing=next!=='camera'&&!capturing&&!!photoBlob,splats=reviewing&&next==='done'&&studioControls.image===1&&scene,showPhoto=reviewing&&next==='done'&&studioControls.image===0&&photoReady,showArt=reviewing&&next==='done'&&studioControls.image===2&&depthArt.ready;
  $('finder').classList.toggle('hidden',reviewing&&next==='done');photo.hidden=!showPhoto;$('scene').classList.toggle('hidden',!splats);$('marigold-view').hidden=!showArt;$('progress').hidden=next!=='working';
  $('capture-plane').hidden=next!=='camera';$('retry').hidden=next!=='error';$('reset').hidden=next==='camera';$('save').hidden=!showPhoto&&!splats&&!showArt;$('last-photo').hidden=next!=='camera'||!photoReady;$('print').hidden=!showPhoto&&!splats&&!showArt;
  photoView.show(showPhoto);
  $('studio').setAttribute('aria-busy',String(next==='working'));$('print').disabled=printing;
  updateRecenter();
  $('phone-shutter').hidden=next!=='camera';
  $('phone-shutter').disabled=openingCamera&&!stream;
  if(next!=='camera')$('phone-state').textContent='';
  if(next==='done'&&studioControls.image===0)photoGestures.refresh?.();
  if(next==='done')void persistPreview().catch(error=>printFeedback(failureText(error,saveFailure)));
  $('capture-plane').setAttribute('aria-label',stream?'Ta foto':'Opne kameraet');
  finder.active=next==='camera'&&!document.hidden;
}
function stopCamera(){++cameraGeneration;openingCamera=false;$('studio').classList.remove('opening');stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null}
function clearScene(){task?.abort();task=null;scene?.dispose();scene=null;$('scene').replaceChildren()}
function clearPhoto(){clearTimeout(documentTimer);currentDocument=null;photoRight=null;archiveState={id:null,pending:null,suppressed:false};photoReceivedAt=null;artTask?.abort();artTask=null;depthArt.reset();if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;photoBlob=null;photoReady=false;photo.removeAttribute('src');$('thumbnail').removeAttribute('src')}
function progress(update){if(studioControls.image===0||mode==='camera'||capturing)return;const known=Number.isFinite(update.percent);$('progress').classList.toggle('indeterminate',!known);$('progress-bar').style.strokeDasharray=known?Math.max(0,Math.min(100,update.percent))+' 100':'';$('status').textContent=''}

const cameraFailures={InsecureContextError:'Kamera krev ein trygg HTTPS-nettlesar.',NotAllowedError:'Gi kameraet tilgang og prøv igjen.',SecurityError:'Gi kameraet tilgang og prøv igjen.',NotFoundError:'Fann ikkje noko kamera på eininga.',OverconstrainedError:'Fann ikkje noko kamera på eininga.',NotReadableError:'Kameraet er i bruk av ein annan app. Lukk han og prøv igjen.',AbortError:'Kameraet vart avbrote. Prøv igjen.'};
const saveFailure='Biletet kunne ikkje lagrast på eininga.';
function failureText(error,fallback){return error?.name==='QuotaExceededError'?'Lagringa på eininga er full.':error?.name==='Error'&&error.message?error.message:fallback}
async function startCamera(){
  if(openingCamera||stream||mode!=='camera'||document.hidden||galleryOpen)return;
  const current=generation,attempt=++cameraGeneration;openingCamera=true;$('studio').classList.add('opening');$('status').textContent='';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Object.assign(new Error('Insecure context'),{name:'InsecureContextError'});
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}},audio:false});
    if(attempt!==cameraGeneration||current!==generation||mode!=='camera'||document.hidden){media.getTracks().forEach(track=>track.stop());return}
    stream=media;video.srcObject=media;await video.play();
    if(attempt!==cameraGeneration||current!==generation||mode!=='camera'||document.hidden)return;
    finder.source=video;hadCamera=true;state('camera');
  }catch(error){if(attempt===cameraGeneration&&current===generation&&mode==='camera'&&!document.hidden){stopCamera();state('error',cameraFailures[error?.name]??'Kameraet kunne ikkje opnast.')}}
  finally{if(attempt===cameraGeneration){openingCamera=false;$('studio').classList.remove('opening')}}
}

async function makeScene(){
  if(!photoReady||studioControls.image!==1||mode==='camera')return;
  if(scene){state('done');scene.refresh?.();return}
  state('working');if(task)return;
  const current=generation,blob=photoBlob,processing=task=new AbortController();progress({phase:'reading'});
  try{
    const result=await createDepthScene($('scene'),blob,update=>{if(current===generation)progress(update)},processing.signal,undefined,photoRight);
    if(current!==generation||blob!==photoBlob){result.dispose();return}
    scene=result;scene.onError=error=>{if(scene===result&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message,true)};scene.setPrimitiveLevel(COLOR_SCHEMES[studioControls.primitive].primitive);scene.setPalette(paletteSelection.depth);if(studioControls.image===1&&mode!=='camera'&&!capturing)state('done');
  }catch(error){if(!processing.signal.aborted&&current===generation&&studioControls.image===1&&mode!=='camera'&&!capturing)state('error',error.message||'Kunne ikkje lage splats.',true)}
  finally{if(task===processing)task=null}
}

async function makeDepthArt(){
  if(!photoReady||studioControls.image!==2||mode==='camera')return;
  if(depthArt.ready){state('done');return}
  state('working');if(artTask)return;
  const current=generation,blob=photoBlob,processing=artTask=new AbortController();progress({phase:'reading'});
  try{
    if(currentDocument?.result)await depthArt.restore(blob,currentDocument.result,currentDocument.recipe,processing.signal);
    else await depthArt.process(blob,processing.signal,photoRight?{right:photoRight}:undefined);
    if(current!==generation||blob!==photoBlob)return;
    if(studioControls.image===2&&mode!=='camera'&&!capturing)state('done');else $('marigold-view').hidden=true;
  }catch(error){
    if(current!==generation||blob!==photoBlob||processing!==artTask)return;
    if(studioControls.image===2&&mode!=='camera'&&!capturing){if(error.name==='AbortError'){studioControls.setImage(0);state('done')}else state('error',error.message||'Kunne ikkje lage djupnebiletet.',true)}
  }finally{if(artTask===processing)artTask=null}
}

function makeDocument(){
  if(!photoReady||!depthArt.ready)throw new Error('Djupnebiletet er ikkje klart.');
  currentDocument=createEntropiDocument({...currentDocument,left:photoBlob,right:photoRight,result:depthArt.result,recipe:depthArt.recipe,preview:snapshotBlob(depthArt.snapshot(true)),capture:currentDocument?.capture??{receivedAt:photoReceivedAt}});
  return currentDocument;
}
async function persistDocument(){
  clearTimeout(documentTimer);documentTimer=0;
  if(!photoReady||!depthArt.ready)return;
  const document=makeDocument(),session=archiveState,pending=session.pending;
  if(session.suppressed)return document;
  const write=(async()=>{await pending;if(session.suppressed)return;const record=await gallery.saveDocument(document,session.id??document.id);session.id=record.id;return record})();
  session.pending=write.catch(()=>null);await write;return document;
}
function schedulePreview(){clearTimeout(documentTimer);documentTimer=setTimeout(()=>void persistPreview().catch(error=>printFeedback(failureText(error,saveFailure))),300)}
async function persistPreview(){
  clearTimeout(documentTimer);documentTimer=0;
  if(!photoReady||mode!=='done')return;
  if(studioControls.image===2)return persistDocument();
  const session=archiveState;if(session.suppressed)return;
  const image=snapshotBlob(studioControls.image===1?scene.snapshot(true):photoView.snapshot(photoGestures.state,true)),pending=session.pending;
  const write=(async()=>{await pending;if(session.suppressed||!session.id)return;await gallery.savePreview(session.id,image)})();
  session.pending=write.catch(()=>null);await write;
}
async function acceptPhoto(blob,name='entropi.jpg',stored=null,recordId=null,right=null){
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>40*1024*1024){state('error','Kamerafotoet kunne ikkje lesast.');return}
  if(photoReady&&mode==='done')void persistPreview().catch(error=>printFeedback(failureText(error,saveFailure)));
  const current=++generation;++captureGeneration;capturing=false;clearScene();stopCamera();clearPhoto();photoBlob=blob;photoName=name.replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-100)||'entropi.jpg';photoUrl=URL.createObjectURL(blob);photo.src=photoUrl;$('thumbnail').src=photoUrl;
  state('working');
  currentDocument=stored;photoRight=stored?.right??right;photoReceivedAt=new Date().toISOString();
  if(stored||recordId)studioControls.setImage(2);
  const session=archiveState;session.id=recordId??stored?.id??null;
  session.pending=(recordId?Promise.resolve({id:recordId}):stored?gallery.saveDocument(stored):gallery.save(blob,photoRight,null)).then(record=>{session.id=record?.id??session.id;return record}).catch(()=>{printFeedback('Fotoet er ikkje arkivert automatisk. Bruk lagreknappen før du går vidare.');return null});
  try{await photo.decode();if(current!==generation)return;photoView.setSource();photoReady=true;photoGestures.reset();if(studioControls.image===1)await makeScene();else if(studioControls.image===2)await makeDepthArt();else state('done')}
  catch(error){if(current===generation)state('error',failureText(error,'Fotoet kunne ikkje lesast.'))}
}

async function capture(){
  if(mode!=='camera'||openingCamera||galleryOpen||performance.now()<captureAfter)return;
  if(studioControls.vathography)studioControls.setImage(2);
  if(!stream){await startCamera();return}
  if(!video.videoWidth||video.readyState<2)return;
  const current=generation,captureId=++captureGeneration;let frame;
  capturing=true;state('working');
  try{
    frame=finder.capture(video);
    const blob=await new Promise(resolve=>frame.toBlob(resolve,'image/png'));
    if(current!==generation||captureId!==captureGeneration)return;capturing=false;if(document.hidden){state('camera');return}
    if(blob)await acceptPhoto(blob,'entropi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png');else state('error','Fotoet kunne ikkje takast.')
  }catch(error){if(current===generation&&captureId===captureGeneration&&!document.hidden)state('error',failureText(error,'Fotoet kunne ikkje takast.'))}
  finally{if(captureId===captureGeneration)capturing=false;if(frame)frame.width=frame.height=1}
}

function reset(){if(photoReady&&mode==='done')void persistPreview().catch(error=>printFeedback(failureText(error,saveFailure)));++captureGeneration;capturing=false;if(!photoReady){++generation;clearScene();clearPhoto()}stopCamera();finder.clear();pointer=null;lastTap=0;state('camera');if(hadCamera)void startCamera()}
async function printCurrent(){const source=scene,blob=photoBlob,image=studioControls.image,result=depthArt.result;if(printing||mode!=='done'||!photoReady||image===1&&!source||image===2&&!depthArt.ready)return;printing=true;$('print').disabled=true;try{await printClient.print(image===0?photoView.snapshot(photoGestures.state):image===2?depthArt.snapshot(false):source.snapshot(),()=>mode==='done'&&blob===photoBlob&&image===studioControls.image&&(image===0||image===1&&source===scene||image===2&&result===depthArt.result))}catch(error){printFeedback(failureText(error,'Kunne ikkje skrive ut.'))}finally{printing=false;$('print').disabled=false}}
function exportOptions(){
  if(!photoBlob||!photoReady||mode!=='done'||studioControls.image===1&&!scene||studioControls.image===2&&!depthArt.ready)return;
  const blob=photoBlob,source=scene,image=studioControls.image,result=depthArt.result;
  return {image:()=>snapshotBlob(image===1?source.snapshot(true):image===2?depthArt.snapshot(true):photoView.snapshot(photoGestures.state,true)),document:image===2?async()=>{const document=makeDocument();void persistDocument().catch(error=>printFeedback(failureText(error,saveFailure)));return document}:undefined,name:photoName,onError:error=>printFeedback(failureText(error,'Kunne ikkje lagre biletet.')),isCurrent:()=>photoBlob===blob&&mode==='done'&&studioControls.image===image&&(image===0||image===1&&scene===source||image===2&&result===depthArt.result)};
}

$('capture-plane').addEventListener('click',()=>void capture());$('reset').addEventListener('click',reset);bindExportGesture($('save'),exportOptions);
$('last-photo').addEventListener('click',()=>{if(!photoReady)return;stopCamera();state('done');if(studioControls.image===1)void makeScene();else if(studioControls.image===2)void makeDepthArt()});$('print').addEventListener('click',()=>void printCurrent());
$('recenter').addEventListener('click',()=>{if(studioControls.image===0)photoGestures.reset();else if(studioControls.image===2)depthArt.resetTone();else scene?.resetView?.()});
$('retry').addEventListener('click',()=>{if(retryScene&&photoReady&&studioControls.image===1)void makeScene();else if(retryScene&&photoReady&&studioControls.image===2)void makeDepthArt();else{reset();void startCamera()}});
$('studio').addEventListener('pointercancel',()=>{pointer=null;lastTap=0});
$('studio').addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){pointer=null;lastTap=0}},true);
$('studio').addEventListener('contextmenu',event=>{if(!event.target.closest('button,a'))event.preventDefault()});
window.addEventListener('message',event=>{if(event.source===window.opener&&allowedOrigins.has(event.origin)&&event.data?.type==='entropi-photo')void acceptPhoto(event.data.blob,typeof event.data.name==='string'?event.data.name:'entropi.jpg')});
function resume(){finder.active=mode==='camera'&&!document.hidden&&!galleryOpen;if(!document.hidden&&mode==='camera'&&!galleryOpen)void startCamera();else if(!document.hidden){if(studioControls.image===1)scene?.refresh?.();else photoGestures.refresh?.()}}
function suspend(){stopCamera();if(capturing){++captureGeneration;capturing=false;state('camera')}finder.active=false;pointer=null;lastTap=0}
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else resume()});
window.addEventListener('pageshow',event=>{if(event.persisted)resume()});
window.addEventListener('keydown',event=>{if(event.defaultPrevented||galleryOpen)return;if(event.key==='Escape'&&mode!=='camera'){event.preventDefault();reset()}else if(event.code==='Space'&&!event.repeat&&!['INPUT','BUTTON','A'].includes(document.activeElement?.tagName)){event.preventDefault();if(mode==='camera')void capture()}});
window.addEventListener('pagehide',event=>{suspend();if(!event.persisted){++generation;clearTimeout(printTimer);clearScene();clearPhoto();finder.dispose();photoGestures.dispose();liveGestures.dispose();photoView.dispose();depthArt.dispose();studioControls.dispose();printClient.dispose()}});
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowedOrigins.has(origin))window.opener.postMessage({type:'entropi-ready'},origin)}catch{}
if(!document.hidden&&(navigator.standalone||globalThis.matchMedia?.('(display-mode: standalone)')?.matches))void startCamera();

let galleryItems=[],galleryCurrent=null,galleryRecord=null,galleryUrls=[],galleryImageUrl=null,galleryDeleteConfirm=false,galleryFocus=null,galleryGeneration=0;

function clearShutterDelay(){
  if(shutterTimer)clearTimeout(shutterTimer);
  shutterTimer=null;shutterCountdown=0;
  $('phone-state').textContent='';
}
$('phone-timer').addEventListener('click',()=>{
  shutterDelay=shutterDelay===0?3:shutterDelay===3?10:0;
  $('phone-timer').dataset.delay=String(shutterDelay);
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
async function openPhoneGallery(){
  const opening=++galleryGeneration;
  if(!galleryOpen)galleryFocus=document.activeElement;
  disarmGalleryDelete();galleryOpen=true;clearShutterDelay();
  if(mode==='camera')stopCamera();
  $('phone-vault').hidden=false;
  $('studio').inert=true;$('phone-vault-close').focus({preventScroll:true});
  $('phone-vault-grid').hidden=false;
  $('phone-vault-detail').hidden=true;
  $('phone-vault-status').textContent='';
  galleryCurrent=null;clearGalleryUrls();
  const grid=$('phone-vault-grid');grid.replaceChildren();
  try{
    if(photoReady&&mode==='done')await persistPreview().catch(error=>{$('phone-vault-status').textContent=failureText(error,saveFailure)});
    const items=await gallery.list();if(!galleryOpen||opening!==galleryGeneration)return;galleryItems=items;
    if(!galleryItems.length){
      const empty=document.createElement('p');empty.className='sr-only';empty.textContent='Ingen foto enno.';grid.append(empty);
    }
    for(const item of galleryItems){
      const button=document.createElement('button');button.type='button';
      button.setAttribute('aria-label',(item.pending?'Ikkje framkalla. ':'')+'Opptak frå '+new Date(item.created).toLocaleString('nn-NO'));
      const image=document.createElement('img');image.alt='';if(item.preview)image.src=galleryUrl(item.preview);button.append(image);
      if(item.pending){button.classList.add('pending');const mark=document.createElement('span');mark.className='archive-pending-mark';mark.setAttribute('aria-hidden','true');button.append(mark)}
      button.addEventListener('click',()=>void showPhoneRecord(item.id));grid.append(button);
    }
  }catch(error){if(galleryOpen&&opening===galleryGeneration)$('phone-vault-status').textContent=failureText(error,'Arkivet er ikkje tilgjengeleg')}
}
async function showPhoneRecord(id){
  galleryCurrent=id;galleryRecord=null;galleryDeleteConfirm=false;
  $('phone-vault-status').textContent='';
  let record;
  try{record=await gallery.get(id);if(!record)throw new Error('Fotoet er ikkje tilgjengeleg.')}
  catch(error){$('phone-vault-status').textContent=failureText(error,'Kunne ikkje opne fotoet.');return}
  if(galleryCurrent!==id)return;
  galleryRecord=record;
  const pending=!record.preview&&!record.document;
  $('phone-vault-edit').hidden=!record.document&&!pending;
  $('phone-vault-edit').setAttribute('aria-label',pending?'Framkall originalopptaket':'Framkall Entropi-biletet');
  $('phone-vault-save').setAttribute('aria-label',record.document?'Eksporter VATHOgraphy':pending?'Lagre original':'Lagre biletet');
  $('phone-vault-image').alt=pending?'Originalopptak, ikkje framkalla':'Arkivert foto';
  $('phone-vault-detail').classList.toggle('pending',pending);
  if(galleryImageUrl)URL.revokeObjectURL(galleryImageUrl);
  galleryImageUrl=URL.createObjectURL(record.preview??record.document?.preview??record.left);
  $('phone-vault-image').src=galleryImageUrl;
  $('phone-vault-grid').hidden=true;
  $('phone-vault-detail').hidden=false;
  (pending?$('phone-vault-edit'):$('phone-vault-save')).focus({preventScroll:true});
  $('phone-vault-remove').setAttribute('aria-label','Slett');$('phone-vault-remove').classList.remove('armed');
}
function closePhoneGallery(){
  if(!galleryOpen)return;disarmGalleryDelete();galleryOpen=false;++galleryGeneration;galleryCurrent=null;galleryRecord=null;
  $('phone-vault').hidden=true;clearGalleryUrls();$('phone-vault-image').removeAttribute('src');
  $('studio').inert=false;(galleryFocus&&galleryFocus.isConnected!==false&&!galleryFocus.hidden&&galleryFocus.tagName!=='BODY'?galleryFocus:$('open-gallery')).focus({preventScroll:true});galleryFocus=null;
  if(mode==='camera'&&hadCamera&&!document.hidden)void startCamera();
}
$('open-gallery').addEventListener('click',()=>void openPhoneGallery());
$('phone-vault-close').addEventListener('click',closePhoneGallery);
$('phone-vault-back').addEventListener('click',()=>void openPhoneGallery());
$('phone-vault-import').addEventListener('click',async()=>{
  try{const document=await pickEntropiDocument();if(!document)return;closePhoneGallery();await acceptPhoto(document.left,document.id+'.entropi',document)}catch(error){$('phone-vault-status').textContent=failureText(error,'Kunne ikkje opne Entropi-fila.')}
});
$('phone-vault-edit').addEventListener('click',async()=>{
  const id=galleryCurrent;if(!id)return;
  try{const record=await gallery.get(id);if(id!==galleryCurrent||!record)return;closePhoneGallery();await acceptPhoto(record.left,(record.document?.id??id)+'.entropi',record.document??null,id,record.right)}catch(error){printFeedback(failureText(error,'Kunne ikkje opne fotoet.'))}
});
bindExportGesture($('phone-vault-save'),()=>{
  const id=galleryCurrent,record=galleryRecord;if(!id||!record||!galleryOpen)return;
  const image=record.preview??record.document?.preview??record.left;
  return {image:()=>image,document:record.document?()=>record.document:undefined,imageExtension:image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'png',name:'entropi-'+id,isCurrent:()=>id===galleryCurrent&&galleryOpen,onError:error=>{$('phone-vault-status').textContent=failureText(error,'Kunne ikkje lagre biletet.')}};
});
let galleryDeleteTimer=0;
function disarmGalleryDelete(){clearTimeout(galleryDeleteTimer);galleryDeleteTimer=0;galleryDeleteConfirm=false;$('phone-vault-remove').setAttribute('aria-label','Slett');$('phone-vault-remove').classList.remove('armed')}
for(const name of ['pointerdown','click','focusin'])$('phone-vault').addEventListener(name,event=>{if(!event.target.closest('#phone-vault-remove'))disarmGalleryDelete()},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden)disarmGalleryDelete()});
$('phone-vault-remove').addEventListener('click',async()=>{
  if(!galleryCurrent)return;
  if(!galleryDeleteConfirm){galleryDeleteConfirm=true;$('phone-vault-remove').setAttribute('aria-label','Trykk igjen for å slette');$('phone-vault-remove').classList.add('armed');galleryDeleteTimer=setTimeout(disarmGalleryDelete,3000);return}
  disarmGalleryDelete();$('phone-vault-status').textContent='';
  const id=galleryCurrent,session=archiveState,wasSuppressed=session.suppressed;
  if(session.id===id)session.suppressed=true;
  try{await session.pending;if(session.id===id)session.suppressed=true;await gallery.remove(id);if(galleryCurrent===id){galleryCurrent=null;void openPhoneGallery()}}
  catch(error){if(archiveState===session)session.suppressed=wasSuppressed;if(galleryCurrent===id){galleryDeleteConfirm=false;$('phone-vault-remove').setAttribute('aria-label','Slett');$('phone-vault-remove').classList.remove('armed');$('phone-vault-status').textContent=failureText(error,'Kunne ikkje slette fotoet.')}}
});
window.addEventListener('keydown',event=>{
  if(event.defaultPrevented||!galleryOpen)return;
  if(event.key==='Escape'&&galleryOpen){event.preventDefault();if(!$('phone-vault-detail').hidden)void openPhoneGallery();else closePhoneGallery()}
  else if(event.key==='Tab'){
    const controls=[$('phone-vault-import'),$('phone-vault-close'),...($('phone-vault-detail').hidden?Array.from($('phone-vault-grid').children):[$('phone-vault-edit'),$('phone-vault-save'),$('phone-vault-remove'),$('phone-vault-back')])].filter(button=>button.tagName==='BUTTON'&&!button.hidden&&!button.disabled);
    event.preventDefault();const index=controls.indexOf(document.activeElement),next=index<0?(event.shiftKey?controls.length-1:0):(index+(event.shiftKey?-1:1)+controls.length)%controls.length;
    controls[next]?.focus({preventScroll:true});
  }
});

if(new URLSearchParams(location.search).has('gallery'))void openPhoneGallery();
