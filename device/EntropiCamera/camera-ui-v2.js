const archiveStore=createArchive(),masterWrites=new WeakMap();
let archiveRecords=[],archiveSelected=null,archiveRecord=null,archiveViewer=null,archiveUrls=[],archiveDeleteArmed=false;
let selfTimer=0,countdown=0,countdownTimer=null,peerPreviewBusy=false,peerFinder=null;

function updateCameraChrome(){
  const ready=connected&&!connecting&&!busy&&!printBusy;
  $('shutter').disabled=!ready||!$('archive').hidden||!!countdownTimer;
}

function cancelCountdown(){
  if(countdownTimer)clearTimeout(countdownTimer);
  countdownTimer=null;countdown=0;updateCameraChrome();
}
function shutterPress(){
  if(!connected||busy||connecting||printBusy||!$('archive').hidden||countdownTimer)return;
  if(!selfTimer){void takePhoto();return}
  countdown=selfTimer;
  const tick=()=>{
    if(document.hidden||!connected||busy||!$('archive').hidden){cancelCountdown();return}
    if(!countdown){notice('');countdownTimer=null;updateCameraChrome();void takePhoto();return}
    notice(String(countdown));updateCameraChrome();countdown--;countdownTimer=setTimeout(tick,1000);
  };
  tick();
}
$('shutter').addEventListener('click',shutterPress);
$('timer-cycle').addEventListener('click',()=>{
  selfTimer=selfTimer===0?3:selfTimer===3?10:0;
  $('timer-cycle').dataset.delay=String(selfTimer);
  $('timer-cycle').setAttribute('aria-label',selfTimer?'Utløysar med '+selfTimer+' sekund forsinking':'Utløysar utan forsinking');
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelCountdown()});

function scheduleMasterSave(){
  clearTimeout(masterSaveTimer);const blob=photoBlob,result=marigoldView.result;
  masterSaveTimer=setTimeout(()=>{masterSaveTimer=0;if(blob===photoBlob&&result===marigoldView.result)void persistCurrentMaster().catch(error=>printFeedback(error.message))},300);
}
function schedulePreviewSave(){clearTimeout(masterSaveTimer);masterSaveTimer=setTimeout(()=>{masterSaveTimer=0;void persistCurrentPreview().catch(error=>printFeedback(error.message))},300)}
async function persistCurrentPreview(){
  clearTimeout(masterSaveTimer);masterSaveTimer=0;
  if(!photoBlob||captureArchiveSuppressed)return;
  if(studioControls.image===2){if(marigoldView.ready)return persistCurrentMaster();return}
  if(studioControls.image===1&&(!sceneViewer||sceneError))return;
  const blob=photoBlob,id=captureArchiveId;if(!id)return;
  const preview=snapshotBlob(studioControls.image===1?sceneViewer.snapshot(true):photoView.snapshot(photoGestures.state,true));
  const write=(masterWrites.get(blob)??Promise.resolve()).then(()=>archiveStore.savePreview(id,preview));
  masterWrites.set(blob,write.catch(()=>null));await write;
}
async function persistCurrentMaster(){
  clearTimeout(masterSaveTimer);masterSaveTimer=0;
  if(!marigoldView.ready||!photoOriginal)throw new Error('Djupnebiletet er ikkje klart.');
  const blob=photoBlob,result=marigoldView.result,preview=snapshotBlob(marigoldView.snapshot(true));
  const master=createEntropiDocument(captureDocument?{...captureDocument,recipe:marigoldView.recipe,preview}:{left:photoPair?.left??photoOriginal,right:photoPair?.right??null,result,recipe:marigoldView.recipe,preview,geometry:{referenceCamera:'left',calibration:null},capture:{capturedAt:photoPair?.captured_at??null,receivedAt:photoReceivedAt,hardwareSynchronized:photoPair?.hardware_synchronized??false,transport:photoPair?.transport??'wifi',leftCameraId:cameraStatus?.camera_id??null,rightCameraId:secondId||null}});
  captureDocument=master;if(captureArchiveSuppressed)return master;const id=captureArchiveId??master.id;
  const write=(masterWrites.get(blob)??Promise.resolve()).then(async()=>{const record=await archiveStore.saveDocument(master,id);if(blob===photoBlob&&result===marigoldView.result)captureArchiveId=record.id}).catch(error=>{if(blob===photoBlob&&result===marigoldView.result)printFeedback('Biletet er ikkje arkivert. Lagre Entropi-fila manuelt. '+(error?.name==='QuotaExceededError'?'Lagringa er full.':''))});
  masterWrites.set(blob,write);await write;return master;
}
async function openEntropiMaster(master,id=null){
  if(busy||printBusy)return;
  ++connectGeneration;clearTimeout(retryTimer);stopStream();stopSecond();
  const task=new AbortController();captureTask=task;busy=true;controls();
  try{
    if(marigoldView.ready)await persistCurrentMaster();task.signal.throwIfAborted();
    closeArchive();onboarding.close();
    await showPhoto(master.left,task.signal,master.right?{left:master.left,right:master.right}:null,master,id);
    studioControls.setImage(2);refreshReview();
    await persistCurrentMaster().catch(error=>printFeedback(error.message));
  }catch(error){if(!task.signal.aborted)notice(error.message,true)}
  finally{if(captureTask===task){captureTask=null;busy=false;controls();resumeStream()}}
}
$('archive-import').addEventListener('click',async()=>{try{const master=await pickEntropiDocument();if(master)await openEntropiMaster(master)}catch(error){$('archive-notice').textContent=error.message}});
$('archive-edit').addEventListener('click',async()=>{const id=archiveSelected;if(!id)return;try{const record=await archiveStore.get(id);if(archiveSelected===id&&record?.document)await openEntropiMaster(record.document,id)}catch(error){$('archive-notice').textContent=error.message}});

async function archiveCapture(original,pair){
  try{
    const record=await archiveStore.save(pair?.left??original,pair?.right??null,null);
    return {id:record.id,warning:''};
  }catch(error){
    return {id:null,warning:'Biletet er ikkje arkivert automatisk. Lagre det manuelt før du tek eit nytt. '+(error?.name==='QuotaExceededError'?'Lagringa er full.':'')};
  }
}

function clearArchiveUrls(){
  for(const url of archiveUrls)URL.revokeObjectURL(url);
  archiveUrls=[];
  if(archiveViewer){URL.revokeObjectURL(archiveViewer);archiveViewer=null}
}
function archiveUrl(blob){
  const url=URL.createObjectURL(blob);
  archiveUrls.push(url);return url;
}
function archiveDate(timestamp){
  return new Date(timestamp).toLocaleString('nn-NO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}
async function showArchive(){
  cancelCountdown();stopStream();
  $('archive').hidden=false;
  $('archive-grid').hidden=false;$('archive-detail').hidden=true;
  archiveSelected=null;
  clearArchiveUrls();
  const grid=$('archive-grid');grid.replaceChildren();
  try{
    await persistCurrentPreview();
    if($('archive').hidden)return;
    archiveRecords=await archiveStore.list();
    if(!archiveRecords.length){
      const empty=document.createElement('p');empty.className='vault-empty sr';empty.textContent='Ingen bilete enno.';grid.append(empty);
    }
    for(const record of archiveRecords){
      const button=document.createElement('button');button.className='vault-item';button.type='button';
      const image=document.createElement('img');image.alt=(record.stereo?'Stereoopptak ':'Foto ')+archiveDate(record.created);
      if(record.preview)image.src=archiveUrl(record.preview);
      button.append(image);
      button.addEventListener('click',()=>void openArchivedPhoto(record.id));
      grid.append(button);
    }
  }catch(error){
    const empty=document.createElement('p');empty.className='vault-empty sr';empty.textContent=error?.message||'Lagringa kunne ikkje opnast.';grid.append(empty);
  }
}
async function openArchivedPhoto(id){
  archiveSelected=id;archiveRecord=null;archiveDeleteArmed=false;
  const record=await archiveStore.get(id).catch(()=>null);
  if(!record||archiveSelected!==id)return;
  archiveRecord=record;
  if(archiveViewer)URL.revokeObjectURL(archiveViewer);
  archiveViewer=URL.createObjectURL(record.preview??record.document?.preview??record.left);
  $('archive-photo').src=archiveViewer;
  $('archive-detail-info').textContent=archiveDate(archiveRecords.find(entry=>entry.id===id)?.created??Date.now())+'  ·  '+(record.right?'STEREO':'FOTO');
  $('archive-left').setAttribute('aria-label',record.document?'Eksporter VATHOgraphy':record.right?'Lagre venstre':'Lagre original');
  $('archive-right').hidden=!record.right;
  $('archive-edit').hidden=!record.document;
  $('archive-delete').setAttribute('aria-label','Slett');$('archive-delete').dataset.armed='false';
  $('archive-notice').textContent='';
  $('archive-grid').hidden=true;$('archive-detail').hidden=false;
}
function closeArchive(){
  if($('archive').hidden)return;
  $('archive').hidden=true;archiveSelected=null;archiveRecord=null;archiveDeleteArmed=false;
  $('archive-photo').removeAttribute('src');
  clearArchiveUrls();resumeStream();
}
$('open-archive').addEventListener('click',()=>void showArchive());
$('close-archive').addEventListener('click',closeArchive);
$('archive-back').addEventListener('click',()=>void showArchive());

function archivedExportOptions(kind){
  const id=archiveSelected,record=archiveRecord;if(!id||!record||$('archive').hidden)return;
  const blob=kind==='right'?record.right:record.preview??record.document?.preview??record.left;if(!blob)return;
  return {image:()=>blob,document:kind==='left'&&record.document?()=>record.document:undefined,imageExtension:blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg',name:'entropi-'+id+'-'+kind,isCurrent:()=>archiveSelected===id&&!$('archive').hidden,onError:error=>{$('archive-notice').textContent=error.message}};
}
for(const kind of ['left','right'])bindExportGesture($('archive-'+kind),()=>archivedExportOptions(kind));
$('archive-delete').addEventListener('click',async()=>{
  const id=archiveSelected;if(!id)return;
  if(!archiveDeleteArmed){
    archiveDeleteArmed=true;$('archive-delete').setAttribute('aria-label','Trykk igjen for å slette');$('archive-delete').dataset.armed='true';return;
  }
  const current=id===captureArchiveId,blob=photoBlob;
  if(current){captureArchiveSuppressed=true;clearTimeout(masterSaveTimer);masterSaveTimer=0;await masterWrites.get(blob)}
  try{await archiveStore.remove(id);void showArchive()}catch(error){if(current&&blob===photoBlob)captureArchiveSuppressed=false;$('archive-notice').textContent=error.message}
});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('archive').hidden){event.preventDefault();if(!$('archive-detail').hidden)void showArchive();else closeArchive()}
});

async function updatePeerPreview(){
  const canvas=$('peer-live');
  const visible=()=>matchMedia('(orientation: landscape) and (max-height:550px)').matches&&connected&&secondEnabled&&!busy&&!connecting&&!printBusy&&!document.hidden&&!reviewing()&&$('archive').hidden;
  if(!visible()){
    canvas.hidden=true;if(peerFinder)peerFinder.source=null;
    return;
  }
  if(peerPreviewBusy)return;
  peerPreviewBusy=true;let url=null;
  try{
    const blob=await request('/peer/preview?t='+Date.now(),'blob',5000);
    if(blob.type!=='image/jpeg'||!blob.size)return;
    const image=new Image();url=URL.createObjectURL(blob);image.src=url;await image.decode();
    if(!visible())return;
    if(!peerFinder){peerFinder=new Viewfinder(canvas);peerFinder.active=false}
    canvas.hidden=false;peerFinder.source=image;
    peerFinder.monochrome=studioControls.image===2;
    peerFinder.setStyle(COLOR_SCHEMES[studioControls.photo].style);
    peerFinder.setPalette(paletteSelection.photo);
    peerFinder.setTone(photoGestures.state);
    peerFinder.draw(performance.now());
    peerFinder.source=null;
  }catch{canvas.hidden=true}
  finally{if(url)URL.revokeObjectURL(url);peerPreviewBusy=false}
}
setInterval(()=>void updatePeerPreview(),1800);
