lockPageZoom();
const archiveStore=createArchive(),masterWrites=new WeakMap();
let archiveRecords=[],archiveSelected=null,archiveRecord=null,archiveViewer=null,archiveUrls=[],archiveDeleteArmed=false,archiveFocus=null,archiveGeneration=0,archiveScroll=0,archiveReturnToPhoto=false;
const archiveNavigation=attachGalleryNavigation($('archive-photo'),{enabled:()=>!$('archive').hidden&&!$('archive-detail').hidden,onStep:stepArchive,onDismiss:closeArchive});
let selfTimer=0,countdown=0,countdownTimer=null,peerPreviewBusy=false;
let sensorControlNext=null,sensorControlTask=null,sensorControlDown=null,sensorLevelTimer=0,sensorFeedbackTimer=0;
const captureControls=[['brightness','capture-brightness'],['ae_level','capture-exposure']];

function updateCameraChrome(){
  const ready=connected&&hasFrame&&!recoveryPending&&!connecting&&!busy&&!printBusy&&!sweepCapture?.active;
  $('shutter').disabled=!ready||sensorControlBusy||!$('archive').hidden||!!countdownTimer;
  $('shutter').setAttribute('aria-label',secondEnabled?'Ta stereofoto':'Ta foto');
  if(!secondEnabled)$('peer-live').hidden=true;
  studio.dataset.stereo=String(landscapeCapture()&&secondEnabled&&!$('peer-live').hidden);
  for(const [field,id] of captureControls){
    const button=$(id),value=cameraStatus?.[field],known=Number.isInteger(value)&&value>=-2&&value<=2;
    button.disabled=!ready||!known;
    if(known){button.setAttribute('aria-valuenow',String(value));button.setAttribute('aria-valuetext',value>0?'+'+value:String(value))}
    else{button.removeAttribute('aria-valuenow');button.setAttribute('aria-valuetext','Ikkje stadfesta')}
  }
}
function captureControlMessage(message){
  clearTimeout(sensorFeedbackTimer);const output=$('capture-feedback');output.textContent=message;output.hidden=!message;
  if(message)sensorFeedbackTimer=setTimeout(()=>{output.hidden=true},8000);
}
function showCaptureLevel(value){clearTimeout(sensorLevelTimer);$('capture-level').hidden=false;$('capture-level').textContent=value>0?'+'+value:String(value)}
async function setCaptureControl(field,value){
  if(!captureControls.some(([key])=>key===field)||!Number.isInteger(value)||value< -2||value>2||!connected||busy||printBusy||sweepCapture?.active||reviewing()||document.hidden)return;
  sensorControlNext={field,value};if(sensorControlBusy)return;
  sensorControlBusy=true;controls();captureControlMessage('');
  try{
    while(sensorControlNext){
      const change=sensorControlNext;sensorControlNext=null;
      const identity=cameraStatus?.camera_id,partner=secondEnabled?secondId:null,task=new AbortController();sensorControlTask=task;let applied=false;
      try{
        await request('/control?var='+change.field+'&val='+change.value,'none',8000,task.signal);
        const status=await request('/status','json',5000,task.signal);
        if(!validStatus(status)||status.camera_id!==identity||status[change.field]!==change.value)throw new Error('Innstillinga kunne ikkje stadfestast.');
        task.signal.throwIfAborted();acceptStatus(status);applied=true;
        if(partner){
          if(secondId!==partner||!secondEnabled)throw new Error('Kamera 2 er fråkopla.');
          await request('/peer/control?var='+change.field+'&val='+change.value,'none',8000,task.signal);
          const peer=await request('/peer/status','json',5000,task.signal);
          if(peer.camera_id!==partner||peer[change.field]!==change.value)throw new Error('Kamera 2 stadfesta ikkje innstillinga.');
        }
      }catch(error){
        sensorControlNext=null;
        if(!task.signal.aborted)captureControlMessage(applied?'Kamera 1 er oppdatert. Kamera 2 kunne ikkje få same innstilling. Prøv igjen.':'Kamerainnstillinga kunne ikkje stadfestast. Prøv igjen.');
      }finally{if(sensorControlTask===task)sensorControlTask=null}
    }
  }finally{sensorControlBusy=false;controls()}
}
function endCaptureControl(event){
  if(!sensorControlDown||event&&event.pointerId!==sensorControlDown.id)return;
  const down=sensorControlDown;sensorControlDown=null;down.button.dataset.active='false';
  if(down.button.hasPointerCapture?.(down.id))down.button.releasePointerCapture(down.id);
  sensorLevelTimer=setTimeout(()=>{$('capture-level').hidden=true},700);
  event?.preventDefault();event?.stopPropagation();
}
for(const [field,id] of captureControls){
  const button=$(id);
  button.addEventListener('pointerdown',event=>{
    if(button.disabled||event.isPrimary===false||event.button!==0||sensorControlDown)return;
    event.preventDefault();event.stopPropagation();const value=cameraStatus[field];
    sensorControlDown={id:event.pointerId,y:event.clientY,value,last:value,field,button};button.dataset.active='true';button.setPointerCapture(event.pointerId);showCaptureLevel(value);
  });
  button.addEventListener('pointermove',event=>{
    const down=sensorControlDown;if(!down||down.id!==event.pointerId||down.field!==field)return;
    event.preventDefault();event.stopPropagation();const value=Math.max(-2,Math.min(2,down.value+Math.round((down.y-event.clientY)/30)));
    if(value!==down.last){down.last=value;showCaptureLevel(value);void setCaptureControl(field,value)}
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,endCaptureControl);
  button.addEventListener('keydown',event=>{
    if(button.disabled||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const current=cameraStatus[field],value=event.key==='Home'?-2:event.key==='End'?2:Math.max(-2,Math.min(2,current+(['ArrowUp','ArrowRight'].includes(event.key)?1:-1)));
    showCaptureLevel(value);sensorLevelTimer=setTimeout(()=>{$('capture-level').hidden=true},1000);void setCaptureControl(field,value);
  });
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){endCaptureControl();sensorControlNext=null;sensorControlTask?.abort()}});
function cancelCountdown(){
  if(countdownTimer)clearTimeout(countdownTimer);
  countdownTimer=null;countdown=0;updateCameraChrome();
}
function shutterPress(){
  if(!connected||busy||connecting||printBusy||sweepCapture?.active||!$('archive').hidden||countdownTimer)return;
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
  const master=createEntropiDocument(captureDocument?{...captureDocument,recipe:marigoldView.recipe,preview}:{left:photoPair?.left??photoOriginal,right:photoPair?.right??null,panorama:photoPanorama,result,recipe:marigoldView.recipe,preview,geometry:{referenceCamera:'left',calibration:null,rectification:result.rigId??null},capture:{pairId:photoPair?.id??null,timing:photoPair?.timing??null,capturedAt:photoPair?.captured_at??null,receivedAt:photoReceivedAt,hardwareSynchronized:photoPair?.hardware_synchronized??false,transport:photoPair?.transport??'wifi',leftCameraId:cameraStatus?.camera_id??null,rightCameraId:secondId||null}});
  captureDocument=master;if(captureArchiveSuppressed)return master;const id=captureArchiveId??master.id;
  const write=(masterWrites.get(blob)??Promise.resolve()).then(async()=>{const record=await archiveStore.saveDocument(master,id);if(blob===photoBlob&&result===marigoldView.result)captureArchiveId=record.id}).catch(error=>{if(blob===photoBlob&&result===marigoldView.result)printFeedback('Biletet er ikkje arkivert. Lagre Entropi-fila manuelt. '+(error?.name==='QuotaExceededError'?'Lagringa er full.':''))});
  masterWrites.set(blob,write);await write;return master;
}
async function openEntropiMaster(master,id=null){
  return openArchivedCapture({left:master.left,right:master.right,document:master},id);
}
async function openArchivedCapture(record,id=null){
  if(busy||printBusy)return;
  ++connectGeneration;clearTimeout(retryTimer);stopStream();stopSecond();
  const task=new AbortController();captureTask=task;busy=true;controls();
  try{
    if(marigoldView.ready)await persistCurrentMaster();task.signal.throwIfAborted();
    closeArchive(false);onboarding.close();studioControls.setImage(2);
    await showPhoto(record.left,task.signal,record.right?{left:record.left,right:record.right}:null,record.document??null,id,{panorama:record.panorama});
    refreshReview();
  }catch(error){if(!task.signal.aborted)notice(error.message,true)}
  finally{if(captureTask===task){captureTask=null;busy=false;controls();resumeStream()}}
}
$('archive-import').addEventListener('click',async()=>{try{const master=await pickEntropiDocument();if(master)await openEntropiMaster(master)}catch(error){$('archive-notice').textContent=error.message}});
$('archive-edit').addEventListener('click',async()=>{const id=archiveSelected,opening=archiveGeneration,isCurrent=()=>!$('archive').hidden&&opening===archiveGeneration&&archiveSelected===id;if(!id||!isCurrent())return;try{const record=await archiveStore.get(id);if(isCurrent()&&record)await openArchivedCapture(record,id)}catch(error){if(isCurrent())$('archive-notice').textContent=error.message}});

async function archiveCapture(original,pair,panorama=null){
  try{
    const record=await archiveStore.save(pair?.left??original,pair?.right??null,null,panorama);
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
  if(sweepCapture?.active||busy||printBusy)return;
  const opening=++archiveGeneration;
  if($('archive').hidden&&!archiveReturnToPhoto)archiveFocus=document.activeElement;
  disarmArchiveDelete();cancelCountdown();++connectGeneration;connecting=false;clearTimeout(retryTimer);stopStream();
  $('archive').hidden=false;
  studio.inert=true;$('close-archive').focus({preventScroll:true});
  $('archive-grid').hidden=false;$('archive-detail').hidden=true;
  archiveSelected=null;archiveRecord=null;archiveScroll=0;archiveNavigation.cancel();
  clearArchiveUrls();
  const grid=$('archive-grid');grid.replaceChildren();
  try{
    await persistCurrentPreview();
    if($('archive').hidden||opening!==archiveGeneration)return;
    const records=await archiveStore.list();if($('archive').hidden||opening!==archiveGeneration)return;archiveRecords=records;
    if(!archiveRecords.length){
      const empty=document.createElement('p');empty.className='vault-empty sr';empty.textContent='Ingen bilete enno.';grid.append(empty);
    }
    for(const record of archiveRecords){
      const button=document.createElement('button');button.className='vault-item';button.type='button';
      button.setAttribute('aria-label',(record.pending?'Ikkje framkalla. ':'')+(record.stereo?'Stereoopptak ':'Foto ')+archiveDate(record.created));
      const image=document.createElement('img');image.alt='';image.loading='lazy';image.decoding='async';if(record.preview)image.src=archiveUrl(record.preview);button.append(image);
      if(record.pending){button.classList.add('pending');const mark=document.createElement('span');mark.className='archive-pending-mark';mark.setAttribute('aria-hidden','true');button.append(mark)}
      button.addEventListener('click',()=>void openArchivedPhoto(record.id));
      grid.append(button);
    }
  }catch(error){
    if($('archive').hidden||opening!==archiveGeneration)return;
    const empty=document.createElement('p');empty.className='vault-empty sr';empty.textContent=error?.message||'Lagringa kunne ikkje opnast.';grid.append(empty);
  }
}
async function openArchivedPhoto(id){
  if(!$('archive-grid').hidden)archiveScroll=$('archive-grid').scrollTop;
  disarmArchiveDelete();archiveNavigation.cancel();
  const opening=++archiveGeneration,isCurrent=()=>!$('archive').hidden&&opening===archiveGeneration&&archiveSelected===id;
  archiveSelected=id;archiveRecord=null;archiveDeleteArmed=false;
  const record=await archiveStore.get(id).catch(()=>null);
  if(!record||!isCurrent())return;
  archiveRecord=record;
  const pending=!record.preview&&!record.document;
  if(archiveViewer)URL.revokeObjectURL(archiveViewer);
  archiveViewer=URL.createObjectURL(record.preview??record.document?.preview??record.left);
  $('archive-photo').src=archiveViewer;
  $('archive-photo').alt=(pending?'Originalopptak, ikkje framkalla':'Arkivert kamerabilete')+'. '+(archiveRecords.findIndex(record=>record.id===id)+1)+' av '+archiveRecords.length;
  $('archive-detail').classList.toggle('pending',pending);
  $('archive-detail-info').textContent=archiveDate(archiveRecords.find(entry=>entry.id===id)?.created??Date.now())+'  ·  '+(record.right?'STEREO':'FOTO');
  $('archive-left').setAttribute('aria-label',record.document?'Eksporter VATHOgraphy':pending?(record.right?'Lagre venstre original':'Lagre original'):'Lagre biletet');
  $('archive-right').hidden=!record.right;
  $('archive-edit').hidden=!record.document&&!pending;
  $('archive-edit').setAttribute('aria-label',pending?'Framkall originalopptaket':'Opne VATHOgraphy');
  $('archive-delete').setAttribute('aria-label','Slett');$('archive-delete').dataset.armed='false';
  $('archive-notice').textContent='';
  $('archive-grid').hidden=true;$('archive-detail').hidden=false;
  (pending?$('archive-edit'):$('archive-left')).focus({preventScroll:true});
}
function stepArchive(direction){
  if($('archive').hidden||$('archive-detail').hidden)return;
  const next=archiveRecords[archiveRecords.findIndex(record=>record.id===archiveSelected)+direction];
  if(next)void openArchivedPhoto(next.id);
}
function backArchive(){
  const index=archiveRecords.findIndex(record=>record.id===archiveSelected),grid=$('archive-grid');
  ++archiveGeneration;archiveSelected=null;archiveRecord=null;archiveNavigation.cancel();disarmArchiveDelete();
  $('archive-detail').hidden=true;grid.hidden=false;grid.scrollTop=archiveScroll;
  $('archive-notice').textContent='';
  (grid.children[index]??$('close-archive')).focus({preventScroll:true});
}
function closeArchive(restore=true){
  if($('archive').hidden)return;
  disarmArchiveDelete();archiveNavigation.cancel();$('archive').hidden=true;++archiveGeneration;archiveSelected=null;archiveRecord=null;archiveDeleteArmed=false;
  $('archive-photo').removeAttribute('src');
  clearArchiveUrls();studio.inert=false;const returnToPhoto=restore!==false&&archiveReturnToPhoto&&!!photoUrl;archiveReturnToPhoto=false;if(returnToPhoto){photoDialog.showModal();refreshReview();if(studioControls.image===2)void makeArt();else if(studioControls.image===1)void makeScene()}(archiveFocus&&archiveFocus.isConnected!==false&&!archiveFocus.hidden&&archiveFocus.tagName!=='BODY'?archiveFocus:$('open-archive')).focus({preventScroll:true});archiveFocus=null;if(!returnToPhoto)resumeStream();
}
$('open-archive').addEventListener('click',()=>void showArchive());
$('review-gallery').addEventListener('click',()=>{if(busy||printBusy||sweepCapture?.active)return;archiveReturnToPhoto=true;archiveFocus=$('review-gallery');photoDialog.dataset.galleryClose='true';photoDialog.close();void showArchive()});
$('close-archive').addEventListener('click',closeArchive);
$('archive-back').addEventListener('click',backArchive);

function archivedExportOptions(kind){
  const id=archiveSelected,record=archiveRecord,opening=archiveGeneration,isCurrent=()=>!$('archive').hidden&&opening===archiveGeneration&&archiveSelected===id;if(!id||!record||!isCurrent())return;
  const blob=kind==='right'?record.right:record.preview??record.document?.preview??record.left;if(!blob)return;
  return {image:()=>blob,document:kind==='left'&&record.document?()=>record.document:undefined,defaultFormat:kind==='left'&&record.previewMatchesDocument?'tif':'png',imageExtension:blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg',name:'entropi-'+id+'-'+kind,isCurrent,onError:error=>{if(isCurrent())$('archive-notice').textContent=error.message}};
}
for(const kind of ['left','right'])bindExportGesture($('archive-'+kind),()=>archivedExportOptions(kind));
let archiveDeleteTimer=0;
function disarmArchiveDelete(){clearTimeout(archiveDeleteTimer);archiveDeleteTimer=0;archiveDeleteArmed=false;$('archive-delete').setAttribute('aria-label','Slett');$('archive-delete').dataset.armed='false'}
for(const name of ['pointerdown','click','focusin'])$('archive').addEventListener(name,event=>{if(!event.target.closest('#archive-delete'))disarmArchiveDelete()},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden){disarmArchiveDelete();archiveNavigation.cancel()}});
$('archive-delete').addEventListener('click',async()=>{
  const id=archiveSelected;if(!id)return;
  if(!archiveDeleteArmed){
    archiveDeleteArmed=true;$('archive-delete').setAttribute('aria-label','Trykk igjen for å slette');$('archive-delete').dataset.armed='true';archiveDeleteTimer=setTimeout(disarmArchiveDelete,3000);return;
  }
  disarmArchiveDelete();const current=id===captureArchiveId,blob=photoBlob;
  if(current){captureArchiveSuppressed=true;clearTimeout(masterSaveTimer);masterSaveTimer=0;await masterWrites.get(blob)}
  try{await archiveStore.remove(id);void showArchive()}catch(error){if(current&&blob===photoBlob)captureArchiveSuppressed=false;$('archive-notice').textContent=error.message}
});
window.addEventListener('keydown',event=>{
  if(event.defaultPrevented||$('archive').hidden)return;
  if(event.key==='Escape'&&!$('archive').hidden){event.preventDefault();if(!$('archive-detail').hidden)backArchive();else closeArchive()}
  else if(!$('archive-detail').hidden&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();stepArchive(event.key==='ArrowRight'?1:-1)}
  else if(event.key==='Tab'){
    const controls=[$('archive-import'),$('close-archive'),...($('archive-detail').hidden?Array.from($('archive-grid').children):[$('archive-edit'),$('archive-left'),$('archive-right'),$('archive-delete'),$('archive-back')])].filter(button=>button.tagName==='BUTTON'&&!button.hidden&&!button.disabled);
    event.preventDefault();const index=controls.indexOf(document.activeElement),next=index<0?(event.shiftKey?controls.length-1:0):(index+(event.shiftKey?-1:1)+controls.length)%controls.length;
    controls[next]?.focus({preventScroll:true});
  }
});

async function updatePeerPreview(){
  const canvas=$('peer-live');
  const visible=()=>landscapeCapture()&&connected&&secondEnabled&&!busy&&!connecting&&!printBusy&&!sweepCapture?.active&&!document.hidden&&!reviewing()&&$('archive').hidden;
  if(!visible()){canvas.hidden=true;studio.dataset.stereo='false';return}
  if(peerPreviewBusy||sensorControlBusy)return;
  peerPreviewBusy=true;let url=null;const identity=secondId,generation=connectGeneration;
  try{
    const blob=await request('/peer/preview?t='+Date.now(),'blob',3500);
    if(blob.type!=='image/jpeg'||!blob.size)throw new Error('Manglar kamera 2.');
    const image=new Image();url=URL.createObjectURL(blob);image.src=url;await image.decode();
    if(!visible()||identity!==secondId||generation!==connectGeneration)return;
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('Ugyldig kamera 2.');
    const width=Math.min(640,image.naturalWidth),height=Math.round(width*image.naturalHeight/image.naturalWidth);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    canvas.getContext('2d').drawImage(image,0,0,width,height);canvas.hidden=false;updateCameraChrome();
  }catch{if(identity===secondId&&generation===connectGeneration){canvas.hidden=true;disconnectSecond()}}
  finally{if(url)URL.revokeObjectURL(url);peerPreviewBusy=false}
}
setInterval(()=>void updatePeerPreview(),500);
window.addEventListener('resize',()=>{drawLivePreview();void updatePeerPreview();updateCameraChrome()});
