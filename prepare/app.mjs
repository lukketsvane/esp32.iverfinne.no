import { loadAsset, loadCachedAsset } from '/pointcloud/assets.mjs';

const status=document.getElementById('status'),bar=document.getElementById('progress'),next=document.getElementById('ready'),retry=document.getElementById('retry'),openCamera=document.getElementById('open-camera'),transfer=new URL(location.href).searchParams.has('transfer');
const allowed=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
const cameraName='entropi-camera-'+crypto.randomUUID();
const scopePath=/^\/start(?:\/|$)/.test(new URL(location.href).pathname)?'/start/':'/prepare/',workerURL=new URL(scopePath+'sw.js',location.href).href;
let peer=null,peerOrigin=null,manifest,ready=false,prepared=false,downloading=false,session=null,pending=null,closed=false,preparation=0,delivery=0,task=null,cameraConnected=false,launchFailed=false,launchTimer=0,cameraPort=null,resumeDownload=false,pendingUpdate=false,cameraError='',modelError='',modelMissing=false;
if(transfer)try{const origin=new URL(document.referrer).origin;if(window.opener&&allowed.has(origin)){peer=window.opener;peerOrigin=origin}}catch{}
const send=data=>{if(peer&&peerOrigin)peer.postMessage(data,peerOrigin)};
function show(phase){
  status.textContent=transfer?modelError:cameraError;bar.hidden=!downloading&&session===null;next.hidden=transfer;
  retry.hidden=transfer?phase!=='error':prepared||downloading||!modelMissing;retry.disabled=downloading||session!==null;retry.textContent=modelError?'Prøv 3D igjen':'Klargjer 3D';retry.setAttribute('aria-label',retry.textContent);
  document.getElementById('model-hint').hidden=prepared&&!modelError;document.getElementById('model-status').textContent=transfer?'':modelError;document.getElementById('model-label').textContent=modelError?'3D · ikkje klart':prepared?'3D er klart':downloading||session!==null?'3D · klargjer …':'3D · valfritt';document.getElementById('model-summary').hidden=transfer;if(transfer)document.getElementById('model-options').open=true;
  document.getElementById('connection-title').textContent=transfer?'Klargjer 3D':cameraConnected?'Kameraet er klart':'Kople til kameraet';
  const network=document.getElementById('network');network.hidden=transfer||cameraConnected;document.getElementById('connection-hint').hidden=cameraConnected;if(launchFailed)document.getElementById('connection-help').open=true;
  openCamera.disabled=transfer||closed||!!launchTimer||session!==null&&!cameraConnected;openCamera.setAttribute('aria-disabled',String(openCamera.disabled));const action=cameraConnected?'Tilbake til kameraet':launchTimer?'Opnar kameraet …':launchFailed?'Prøv igjen':'Opne kameraet';openCamera.setAttribute('aria-label',action);document.getElementById('camera-action').textContent=action;document.documentElement.dataset.ready=String(prepared);
  applyUpdate();
}
function applyUpdate(){if(pendingUpdate&&!transfer&&!closed&&!downloading&&session===null&&(!peer||peer.closed)&&!document.hidden){pendingUpdate=false;location.reload()}}
function cancelDelivery(){delivery++;session=null;const waiting=pending;pending=null;waiting?.reject(new DOMException('Avbrote.','AbortError'))}
function stopLaunch(){clearTimeout(launchTimer);launchTimer=0}
function closeCameraPort(){if(cameraPort){cameraPort.onmessage=null;cameraPort.close();cameraPort=null}}
function waitForCamera(){stopLaunch();cameraConnected=false;launchFailed=false;cameraError='';launchTimer=setTimeout(()=>{stopLaunch();if(closed)return;launchFailed=true;cameraError='Kameraet svara ikkje.';show('ready')},10000);show('launching')}
function fail(error,keepPrepared=false){modelError=error.message||'3D kunne ikkje klargjerast.';modelMissing=true;if(!keepPrepared){prepared=false;ready=false}show('error');send({type:'entropi-models-error',session,code:error.code||'PHONE_SETUP_FAILED',message:modelError})}

async function controlled(){
  if(!navigator.serviceWorker)throw new Error('Opne klargjeringa i nettlesaren med internett.');
  const installed=()=>[workerURL,new URL('/sw.js',location.href).href].includes(navigator.serviceWorker.controller?.scriptURL);
  if(navigator.onLine===false){if(installed())return;throw new Error('Opne klargjeringa i nettlesaren med internett.')}
  let timer,changed;
  try{await Promise.race([
    (async()=>{
      await navigator.serviceWorker.register(scopePath+'sw.js',{scope:scopePath,updateViaCache:'none'});await navigator.serviceWorker.ready;
      if(navigator.serviceWorker.controller?.scriptURL!==workerURL)await new Promise(resolve=>{changed=()=>{if(navigator.serviceWorker.controller?.scriptURL===workerURL)resolve()};navigator.serviceWorker.addEventListener('controllerchange',changed);changed()});
    })(),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Klargjeringa kunne ikkje lagrast. Opne sida i nettlesaren med internett og prøv igjen.')),15000)})
  ])}catch(error){if(!installed())throw error}finally{clearTimeout(timer);if(changed)navigator.serviceWorker.removeEventListener('controllerchange',changed)}
}

async function prepare(download=false,preserveCamera=false){
  const generation=++preparation;task?.abort();const currentTask=task=new AbortController();let stallTimer;const watch=()=>{clearTimeout(stallTimer);stallTimer=setTimeout(()=>currentTask.abort(new Error('Nedlastinga stoppa. Prøv igjen med internett.')),30000)};cancelDelivery();if(!download&&!preserveCamera){closeCameraPort();cameraConnected=false}prepared=false;ready=false;downloading=download;modelError='';modelMissing=false;bar.removeAttribute('value');show('working');
  try{
    if(transfer&&!peer)throw new Error('Opne klargjeringa frå kameraet i nettlesaren.');
    await controlled();if(closed||generation!==preparation)return;const response=await fetch('/pointcloud/models/manifest.json',{signal:currentTask.signal});if(!response.ok)throw new Error('Modellmanifestet manglar.');manifest=await response.json();
    if(closed||generation!==preparation)return;
    ready=true;if(transfer){show('waiting');send({type:'entropi-models-ready'});return}
    const total=manifest.asset.bytes+manifest.runtime.bytes;let completed=0;
    for(const key of ['asset','runtime']){
      if(download){watch();await loadAsset(manifest[key],percent=>{if(generation===preparation){watch();bar.value=(completed+manifest[key].bytes*percent/100)/total*100}},currentTask.signal);clearTimeout(stallTimer)}
      await loadCachedAsset(manifest[key]);if(closed||generation!==preparation)return;completed+=manifest[key].bytes;
    }
    await navigator.storage?.persist?.().catch(()=>false);
    if(closed||generation!==preparation)return;downloading=false;prepared=true;modelError='';show('ready');
  }catch(error){if(!closed&&generation===preparation){downloading=false;if(!download&&!transfer&&error.code==='PHONE_SETUP_REQUIRED'){modelMissing=true;show('photo')}else fail(error)}}
  finally{clearTimeout(stallTimer)}
}

async function deliver(requestedSession){
  const generation=++delivery;stopLaunch();session=requestedSession;let failed=false;bar.value=0;show('working');
  try{
    for(const [index,key] of ['asset','runtime'].entries()){
      const bytes=await loadCachedAsset(manifest[key]);if(closed||generation!==delivery)return;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending=null;reject(new Error('Kameraet svara ikkje. Prøv igjen i nettlesaren.'))},60000);
        pending={key,resolve:()=>{clearTimeout(timer);pending=null;resolve()},reject:error=>{clearTimeout(timer);pending=null;reject(error)}};
        try{peer.postMessage({type:'entropi-model-asset',session,key,bytes:bytes.buffer},peerOrigin,[bytes.buffer])}catch(error){pending.reject(error)}
      });
      if(closed||generation!==delivery)return;bar.value=(index+1)/2*100;
    }
    if(closed||generation!==delivery)return;prepared=true;modelError='';send({type:'entropi-models-complete',session});if(transfer){show('waiting');setTimeout(()=>window.close(),150)}else if(cameraConnected||launchFailed)show('ready');else waitForCamera();
  }catch(error){if(!closed&&generation===delivery){failed=true;fail(error,!transfer&&prepared&&error.code!=='PHONE_SETUP_REQUIRED')}}
  finally{if(generation===delivery){session=null;pending=null;show(failed?'error':'waiting')}}
}

openCamera.addEventListener('click',event=>{
  event.preventDefault();
  if(transfer||closed||openCamera.disabled)return;
  if(cameraConnected&&peer&&!peer.closed){try{peer.focus();return}catch{}}
  closeCameraPort();cancelDelivery();cameraConnected=false;peerOrigin=null;
  try{peer=window.open('http://192.168.4.1/?connect',cameraName)}catch{peer=null}
  if(peer)waitForCamera();else{launchFailed=true;cameraError='Tillat opning av kameraet, og prøv igjen.';show('ready')}
});
retry.addEventListener('click',()=>void prepare(!transfer,true));
document.getElementById('back').addEventListener('click',event=>{try{const previous=new URL(document.referrer);if(previous.origin===location.origin&&previous.pathname==='/'&&history.length>1){event.preventDefault();history.back()}}catch{}});
window.addEventListener('message',event=>{
  if(closed||event.source!==peer||!allowed.has(event.origin))return;
  const data=event.data;
  if(!transfer){
    if(data?.type==='entropi-camera-ready'){
      const port=event.ports?.[0];if(!port)return;closeCameraPort();cameraPort=port;
      port.onmessage=message=>{if(closed||cameraPort!==port||message.data?.type!=='entropi-camera-left')return;closeCameraPort();stopLaunch();cameraConnected=false;peerOrigin=null;cancelDelivery();show('ready')};port.start();
      stopLaunch();peerOrigin=event.origin;cameraConnected=true;launchFailed=false;cameraError='';show('ready');return;
    }
    if(data?.type==='entropi-models-connect'){peerOrigin=event.origin;bar.removeAttribute('value');show('working');send({type:'entropi-models-ready'});return}
  }
  if(transfer&&!ready||event.origin!==peerOrigin)return;
  if(data?.type==='entropi-models-request'&&session===null&&typeof data.session==='string'&&data.session.length>0&&data.session.length<=128){if(!transfer&&!prepared){send({type:'entropi-models-error',session:data.session,code:'PHONE_SETUP_REQUIRED',message:'Klargjer 3D på telefonen med internett først.'});if(!downloading){modelError='Klargjer 3D på telefonen med internett først.';modelMissing=true;show('error')}}else void deliver(data.session)}
  else if(data?.type==='entropi-model-ack'&&data.session===session&&pending&&data.key===pending.key)pending.resolve();
  else if(data?.type==='entropi-models-cancel'&&session!==null&&data.session===session){stopLaunch();cancelDelivery();show(prepared?'ready':'waiting')}
});
navigator.serviceWorker?.addEventListener('message',event=>{if(event.source!==navigator.serviceWorker.controller||event.source?.scriptURL!==workerURL||event.origin!==location.origin||event.data?.type!=='entropi-update-ready')return;pendingUpdate=true;applyUpdate()});
document.addEventListener('visibilitychange',applyUpdate);
window.addEventListener('pagehide',event=>{resumeDownload=downloading;closed=true;preparation++;task?.abort();stopLaunch();if(!event.persisted){closeCameraPort();cameraConnected=false}cancelDelivery();prepared=ready=downloading=false;document.documentElement.dataset.ready='false'});
window.addEventListener('pageshow',event=>{if(event.persisted){closed=false;const download=resumeDownload;resumeDownload=false;void prepare(download,true)}});
void prepare(!transfer&&!new URL(location.href).searchParams.has('camera'));
