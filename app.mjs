import { Viewfinder } from './vendor/viewfinder.mjs';
import { createDepthScene } from './vendor/scene.mjs';

const $=id=>document.getElementById(id),video=$('video'),finder=new Viewfinder($('viewfinder'));
const allowedOrigins=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
const photoIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1"/><path d="m3 17 6-5 4 4 3-3 5 4"/></svg>',cubeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10"/></svg>';
let stream=null,photoBlob=null,photoUrl=null,photoName='entropi.jpg',scene=null,task=null,generation=0,photoGeneration=0,sceneVisible=false,resumeCamera=false,openingCamera=false;

function stopCamera(){stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null;finder.clear();$('capture').disabled=$('capture-plane').disabled=true;$('camera').textContent='Start kamera'}
function clearScene(){++generation;task?.abort();task=null;scene?.dispose();scene=null;sceneVisible=false;$('scene').replaceChildren();$('scene').hidden=true;$('photo').hidden=false;$('toggle').hidden=true}
function label(id,text){$(id).setAttribute('aria-label',text);$(id).title=text}
function setMode(visible){sceneVisible=visible;$('scene').hidden=!visible;$('photo').hidden=visible;$('toggle').innerHTML=visible?photoIcon:cubeIcon;label('toggle',visible?'Vis foto':'Vis 3D')}

async function startCamera(){
  if(openingCamera||stream)return;
  openingCamera=true;$('camera').disabled=true;$('status').textContent='Opnar kameraet …';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera krev HTTPS. Du kan framleis velje eit foto.');
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    if(photoBlob){media.getTracks().forEach(track=>track.stop());return}
    stream=media;video.srcObject=media;await video.play();finder.source=video;finder.active=true;
    $('capture').disabled=$('capture-plane').disabled=false;$('camera').textContent='Kamera på';$('status').textContent='Trykk på søkjaren for å ta foto.';
  }catch(error){stopCamera();$('status').textContent=error.name==='NotAllowedError'?'Gi kameraet tilgang, eller vel eit foto.':error.message||'Kameraet kunne ikkje opnast.'}
  finally{openingCamera=false;$('camera').disabled=false}
}

async function makeScene(){
  if(!photoBlob)return;
  clearScene();const current=generation;task=new AbortController();const signal=task.signal;
  $('status').textContent='Lagar 3D på telefonen …';
  try{
    const result=await createDepthScene($('scene'),photoBlob,update=>{
      if(current===generation)$('status').textContent=(update.phase.startsWith('loading')?'Lastar modell til telefonen':'Reknar djupn på telefonen')+(update.percent===undefined?' …':' · '+update.percent+' %');
    },signal);
    if(current!==generation){result.dispose();return}
    scene=result;$('toggle').hidden=false;setMode(true);$('status').textContent='';
  }catch(error){if(signal.aborted||current!==generation)return;setMode(false);$('toggle').hidden=false;label('toggle','Prøv 3D');$('status').textContent=error.message||'Kunne ikkje lage 3D.'}
}

async function openPhoto(blob,name='entropi.jpg'){
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>40*1024*1024){$('status').textContent='Vel ei biletefil under 40 MB.';return}
  const current=++photoGeneration,url=URL.createObjectURL(blob),image=new Image();image.src=url;
  try{await image.decode()}catch{URL.revokeObjectURL(url);if(current===photoGeneration)$('status').textContent='Biletet kunne ikkje lesast.';return}
  if(current!==photoGeneration){URL.revokeObjectURL(url);return}
  resumeCamera=!!stream;stopCamera();clearScene();if(photoUrl)URL.revokeObjectURL(photoUrl);
  photoBlob=blob;photoUrl=url;photoName=name.replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-100)||'entropi.jpg';$('photo').src=url;
  finder.active=false;$('finder').hidden=$('capture-plane').hidden=$('capture-controls').hidden=true;
  $('review').hidden=$('review-controls').hidden=$('back').hidden=false;$('studio').classList.add('reviewing');setMode(false);void makeScene();
}

async function capture(){
  if(!stream||!video.videoWidth||photoBlob)return;
  $('capture').disabled=$('capture-plane').disabled=true;
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));canvas.width=canvas.height=1;
  if(blob)await openPhoto(blob,'entropi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg');
  else{$('capture').disabled=$('capture-plane').disabled=false;$('status').textContent='Fotoet kunne ikkje takast. Prøv igjen.'}
}

function reset(){
  ++photoGeneration;clearScene();if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;photoBlob=null;$('photo').removeAttribute('src');$('file').value='';
  $('finder').hidden=$('capture-plane').hidden=$('capture-controls').hidden=false;$('review').hidden=$('review-controls').hidden=$('back').hidden=true;
  $('studio').classList.remove('reviewing');finder.active=true;$('status').textContent='Opne kameraet eller vel eit foto.';if(resumeCamera)void startCamera();resumeCamera=false;
}

async function save(){
  const blob=photoBlob;if(!blob)return;
  const name=photoName,file=new File([blob],name,{type:blob.type});
  try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}}catch(error){if(error.name==='AbortError')return}
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

$('camera').addEventListener('click',()=>void startCamera());
$('capture').addEventListener('click',()=>void capture());$('capture-plane').addEventListener('click',()=>void capture());
$('upload').addEventListener('click',()=>$('file').click());$('file').addEventListener('change',()=>{const file=$('file').files[0];if(file)void openPhoto(file,file.name)});
$('back').addEventListener('click',reset);$('save').addEventListener('click',()=>void save());$('toggle').addEventListener('click',()=>scene?setMode(!sceneVisible):void makeScene());
window.addEventListener('message',event=>{if(event.source===window.opener&&allowedOrigins.has(event.origin)&&event.data?.type==='entropi-photo')void openPhoto(event.data.blob,typeof event.data.name==='string'?event.data.name:'entropi.jpg')});
document.addEventListener('visibilitychange',()=>{finder.active=!document.hidden&&!photoBlob});
window.addEventListener('pagehide',()=>{stopCamera();clearScene();if(photoUrl)URL.revokeObjectURL(photoUrl);finder.dispose()},{once:true});
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowedOrigins.has(origin))window.opener.postMessage({type:'entropi-ready'},origin)}catch{}
