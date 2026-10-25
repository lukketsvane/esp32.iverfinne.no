const archiveStore=createArchive();
let archiveRecords=[],archiveSelected=null,archiveViewer=null,archiveUrls=[],archiveDeleteArmed=false;
let selfTimer=0,countdown=0,countdownTimer=null,peerPreviewBusy=false,peerFinder=null;

function updateCameraChrome(){
  const ready=connected&&!connecting&&!busy&&!printBusy;
  const paired=secondEnabled;
  $('shutter').disabled=!ready||!$('archive').hidden||!!countdownTimer;
  $('rig-state').textContent=!connected?'SER ETTER KAMERA':paired?'TO KAMERA · SAMANKOPLA':peerId()?'KOPLAR KAMERA 2':'EITT KAMERA · KLART';
  $('rig-footnote').textContent=countdownTimer?String(countdown):busy?'TEK FOTO':paired?'STEREO · TO SENSORAR':'TRYKK FOR Å TA FOTO';
  const wide=matchMedia('(orientation: landscape) and (max-height:550px)').matches;
  $('rig-frame-label').textContent=paired?(wide?'01 · VENSTRE':'01 + 02 · STEREO'):'01 · OPTISK SØKJAR';
  $('peer-frame-label').hidden=!paired||!wide;
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
    if(!countdown){countdownTimer=null;updateCameraChrome();void takePhoto();return}
    updateCameraChrome();countdown--;countdownTimer=setTimeout(tick,1000);
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

async function refreshArchiveCount(){
  try{
    const entries=await archiveStore.list();
    $('archive-count').textContent=entries.length?entries.length+' I ARKIV':'ARKIV';
  }catch{$('archive-count').textContent='ARKIV'}
}

async function archiveCapture(original,pair){
  try{
    await archiveStore.save(pair?.left??original,pair?.right??null);
    void refreshArchiveCount();
    return '';
  }catch(error){
    return 'Biletet er ikkje arkivert automatisk. Lagre det manuelt før du tek eit nytt. '+(error?.name==='QuotaExceededError'?'Lagringa er full.':'');
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
  $('archive-grid').hidden=false;$('archive-detail').hidden=true;$('vault-hint').hidden=false;
  $('vault-count').textContent='HENTAR BILETE…';
  archiveSelected=null;
  clearArchiveUrls();
  const grid=$('archive-grid');grid.replaceChildren();
  try{
    archiveRecords=await archiveStore.list();
    $('vault-count').textContent=archiveRecords.length+' OPPTAK · LAGRA PÅ DENNE EININGA';
    $('archive-count').textContent=archiveRecords.length?archiveRecords.length+' I ARKIV':'ARKIV';
    if(!archiveRecords.length){
      const empty=document.createElement('p');empty.className='vault-empty';empty.textContent='Ingen foto er lagra enno. Ta eit bilete for å byrje arkivet.';grid.append(empty);
    }
    for(const record of archiveRecords){
      const button=document.createElement('button');button.className='vault-item';button.type='button';
      const image=document.createElement('img');image.alt='Opptak '+archiveDate(record.created);
      if(record.preview)image.src=archiveUrl(record.preview);
      const meta=document.createElement('span');meta.className='vault-item-meta';
      const date=document.createElement('span');date.textContent=archiveDate(record.created);
      const type=document.createElement('b');type.textContent=record.stereo?'STEREO':'FOTO';
      meta.append(date,type);button.append(image,meta);
      button.addEventListener('click',()=>void openArchivedPhoto(record.id));
      grid.append(button);
    }
  }catch(error){
    $('vault-count').textContent='ARKIVET ER IKKJE TILGJENGELEG';
    const empty=document.createElement('p');empty.className='vault-empty';empty.textContent=error?.message||'Lagringa kunne ikkje opnast.';grid.append(empty);
  }
}
async function openArchivedPhoto(id){
  archiveSelected=id;archiveDeleteArmed=false;
  const record=await archiveStore.get(id).catch(()=>null);
  if(!record||archiveSelected!==id)return;
  if(archiveViewer)URL.revokeObjectURL(archiveViewer);
  archiveViewer=URL.createObjectURL(record.left);
  $('archive-photo').src=archiveViewer;
  $('archive-detail-info').textContent=archiveDate(archiveRecords.find(entry=>entry.id===id)?.created??Date.now())+'  ·  '+(record.right?'STEREO':'FOTO');
  $('archive-left').textContent=record.right?'Venstre JPEG':'Original JPEG';
  $('archive-right').hidden=!record.right;
  $('archive-pair').hidden=!record.right;
  $('archive-delete').textContent='Slett frå arkivet';
  $('archive-notice').textContent='';
  $('archive-grid').hidden=true;$('vault-hint').hidden=true;$('archive-detail').hidden=false;
}
function closeArchive(){
  if($('archive').hidden)return;
  $('archive').hidden=true;archiveSelected=null;archiveDeleteArmed=false;
  $('archive-photo').removeAttribute('src');
  clearArchiveUrls();resumeStream();
}
$('open-archive').addEventListener('click',()=>void showArchive());
$('close-archive').addEventListener('click',closeArchive);
$('archive-back').addEventListener('click',()=>void showArchive());

async function exportArchived(kind){
  const id=archiveSelected;if(!id)return;
  const record=await archiveStore.get(id);
  if(!record||archiveSelected!==id)return;
  let blob=kind==='right'?record.right:record.left;
  if(kind==='pair')blob=await stereoPairImage(record);
  if(!blob)return;
  await savePhoto(blob,'entropi-'+id+'-'+kind+'.jpg',()=>archiveSelected===id&&!$('archive').hidden);
}
for(const kind of ['left','right','pair']){
  $('archive-'+kind).addEventListener('click',()=>void exportArchived(kind).catch(error=>{$('archive-notice').textContent=error.message}));
}
$('archive-delete').addEventListener('click',async()=>{
  const id=archiveSelected;if(!id)return;
  if(!archiveDeleteArmed){
    archiveDeleteArmed=true;$('archive-delete').textContent='Trykk igjen for å slette';return;
  }
  await archiveStore.remove(id);
  void refreshArchiveCount();void showArchive();
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
    peerFinder.setStyle(COLOR_SCHEMES[studioControls.photo].style);
    peerFinder.setPalette(paletteSelection.photo);
    peerFinder.setTone(photoGestures.state);
    peerFinder.draw(performance.now());
    peerFinder.source=null;
  }catch{canvas.hidden=true}
  finally{if(url)URL.revokeObjectURL(url);peerPreviewBusy=false}
}
setInterval(()=>void updatePeerPreview(),1800);
void refreshArchiveCount();
