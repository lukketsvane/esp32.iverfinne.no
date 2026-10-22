import { loadAsset, loadCachedAsset } from '/pointcloud/assets.mjs';

const status=document.getElementById('status'),bar=document.getElementById('progress'),next=document.getElementById('ready'),retry=document.getElementById('retry'),openCamera=document.getElementById('open-camera'),transfer=new URL(location.href).searchParams.has('transfer');
const allowed=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
const cameraName='entropi-camera-'+crypto.randomUUID();
let peer=null,peerOrigin=null,manifest,ready=false,prepared=false,downloading=false,photoFlow=false,session=null,pending=null,closed=false,preparation=0,delivery=0,task=null,cameraConnected=false,launchFailed=false,launchTimer=0,cameraPort=null;
if(transfer)try{const origin=new URL(document.referrer).origin;if(window.opener&&allowed.has(origin)){peer=window.opener;peerOrigin=origin}}catch{}
const send=data=>{if(peer&&peerOrigin)peer.postMessage(data,peerOrigin)};
function show(phase,message){
  status.textContent=launchTimer?'Koplar til kameraet …':message;bar.hidden=phase!=='working'&&phase!=='launching'&&!downloading;next.hidden=transfer;
  retry.hidden=transfer?phase!=='error':prepared||downloading;retry.disabled=phase==='working'||phase==='launching'||!!launchTimer||session!==null;retry.textContent=phase==='error'?'Prøv 3D igjen':'Klargjer 3D';
  const network=document.getElementById('network');network.hidden=cameraConnected||!prepared&&!photoFlow&&(phase==='working'||phase==='launching'||downloading);document.getElementById('connection-hint').hidden=cameraConnected;
  openCamera.disabled=transfer||phase==='launching'||!!launchTimer||session!==null;openCamera.textContent=cameraConnected?'Tilbake til kameraet':launchFailed?'Prøv igjen':!prepared&&network.hidden?'Berre foto':'Opne kameraet ↗';document.documentElement.dataset.ready=String(prepared);
}
function cancelDelivery(){delivery++;session=null;const waiting=pending;pending=null;waiting?.reject(new DOMException('Avbrote.','AbortError'))}
function stopLaunch(){clearTimeout(launchTimer);launchTimer=0}
function closeCameraPort(){if(cameraPort){cameraPort.onmessage=null;cameraPort.close();cameraPort=null}}
function waitForCamera(){stopLaunch();cameraConnected=false;launchFailed=false;bar.removeAttribute('value');show('launching','Koplar til kameraet …');launchTimer=setTimeout(()=>{stopLaunch();if(closed)return;launchFailed=true;show('ready','Finn ikkje kameraet. Vel ENTROPI under Wi-Fi og prøv igjen.')},10000)}
function fail(error,keepPrepared=false){if(keepPrepared){launchFailed=true;show('ready',error.message)}else{prepared=false;ready=false;show('error',error.message||'3D kunne ikkje klargjerast.')}send({type:'entropi-models-error',session,code:error.code||'PHONE_SETUP_FAILED',message:status.textContent})}

async function controlled(){
  if(!navigator.serviceWorker)throw new Error('Opne klargjeringa i nettlesaren med internett.');
  const expected=new URL('/prepare/sw.js',location.href).href,scope=new URL('/prepare/',location.href).href;let timer,changed;
  try{await Promise.race([
    (async()=>{
      const registration=await navigator.serviceWorker.getRegistration('/prepare/');if(registration?.scope!==scope||registration?.active?.scriptURL!==expected)await navigator.serviceWorker.register('/prepare/sw.js',{scope:'/prepare/'});await navigator.serviceWorker.ready;
      if(navigator.serviceWorker.controller?.scriptURL!==expected)await new Promise(resolve=>{changed=()=>{if(navigator.serviceWorker.controller?.scriptURL===expected)resolve()};navigator.serviceWorker.addEventListener('controllerchange',changed);changed()});
    })(),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Klargjeringa kunne ikkje lagrast. Opne sida i nettlesaren med internett og prøv igjen.')),15000)})
  ])}finally{clearTimeout(timer);if(changed)navigator.serviceWorker.removeEventListener('controllerchange',changed)}
}

async function prepare(download=false,preserveCamera=false){
  const generation=++preparation;task?.abort();const currentTask=task=new AbortController();cancelDelivery();if(!download&&!preserveCamera){closeCameraPort();cameraConnected=false}prepared=false;ready=false;downloading=download;bar.removeAttribute('value');show('working','Klargjer …');
  try{
    if(transfer&&!peer)throw new Error('Opne klargjeringa frå kameraet i nettlesaren.');
    await controlled();if(closed||generation!==preparation)return;const response=await fetch('/pointcloud/models/manifest.json',{signal:currentTask.signal});if(!response.ok)throw new Error('Modellmanifestet manglar.');manifest=await response.json();
    if(closed||generation!==preparation)return;
    ready=true;if(transfer){show('waiting','Koplar til kameraet …');send({type:'entropi-models-ready'});return}
    const total=manifest.asset.bytes+manifest.runtime.bytes;let completed=0;
    for(const key of ['asset','runtime']){
      if(download)await loadAsset(manifest[key],percent=>{if(generation===preparation)bar.value=(completed+manifest[key].bytes*percent/100)/total*100},currentTask.signal);
      await loadCachedAsset(manifest[key]);if(closed||generation!==preparation)return;completed+=manifest[key].bytes;
    }
    await navigator.storage?.persist?.().catch(()=>false);
    if(closed||generation!==preparation)return;downloading=false;prepared=true;show('ready','');
  }catch(error){if(!closed&&generation===preparation){downloading=false;if(!download&&!transfer&&error.code==='PHONE_SETUP_REQUIRED')show('photo','3D krev internett første gong.');else fail(error)}}
}

async function deliver(requestedSession){
  const generation=++delivery;stopLaunch();session=requestedSession;bar.value=0;show('working','Klargjer kameraet …');
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
    if(closed||generation!==delivery)return;prepared=true;send({type:'entropi-models-complete',session});if(transfer){show('waiting','Klar.');setTimeout(()=>window.close(),150)}else waitForCamera();
  }catch(error){if(!closed&&generation===delivery)fail(error,!transfer&&prepared&&error.code!=='PHONE_SETUP_REQUIRED')}
  finally{if(generation===delivery){session=null;pending=null;if(!launchTimer){openCamera.disabled=transfer;retry.disabled=false}}}
}

openCamera.addEventListener('click',()=>{
  if(transfer||closed||openCamera.disabled)return;
  if(cameraConnected&&peer&&!peer.closed){try{peer.focus();return}catch{}}
  if(!prepared&&document.getElementById('network').hidden){preparation++;task?.abort();downloading=false;photoFlow=true;show('photo','');return}
  photoFlow=true;closeCameraPort();cancelDelivery();cameraConnected=false;peerOrigin=null;
  try{peer=window.open('http://192.168.4.1/?connect',cameraName)}catch{peer=null}
  if(peer)waitForCamera();else{launchFailed=true;show('ready','Tillat opning av kameraet, og prøv igjen.')}
});
retry.addEventListener('click',()=>void prepare(!transfer,true));
document.getElementById('back').addEventListener('click',event=>{try{const previous=new URL(document.referrer);if(previous.origin===location.origin&&previous.pathname==='/'&&history.length>1){event.preventDefault();history.back()}}catch{}});
window.addEventListener('message',event=>{
  if(closed||event.source!==peer||!allowed.has(event.origin))return;
  const data=event.data;
  if(!transfer){
    if(data?.type==='entropi-camera-ready'){
      const port=event.ports?.[0];if(!port)return;closeCameraPort();cameraPort=port;
      port.onmessage=message=>{if(closed||cameraPort!==port||message.data?.type!=='entropi-camera-left')return;closeCameraPort();stopLaunch();cameraConnected=false;peerOrigin=null;cancelDelivery();show('ready',prepared?'':'3D krev internett første gong.')};port.start();
      stopLaunch();peerOrigin=event.origin;cameraConnected=true;launchFailed=false;show('ready','Kameraet er klart.');return;
    }
    if(data?.type==='entropi-models-connect'){stopLaunch();peerOrigin=event.origin;cameraConnected=false;bar.removeAttribute('value');show('working','Klargjer kameraet …');send({type:'entropi-models-ready'});return}
  }
  if(transfer&&!ready||event.origin!==peerOrigin)return;
  if(data?.type==='entropi-models-request'&&session===null&&typeof data.session==='string'&&data.session.length>0&&data.session.length<=128){if(!transfer&&!prepared){send({type:'entropi-models-error',session:data.session,code:'PHONE_SETUP_REQUIRED',message:'Klargjer 3D på telefonen med internett først.'});if(!downloading)show('error','Klargjer 3D på telefonen med internett først.')}else void deliver(data.session)}
  else if(data?.type==='entropi-model-ack'&&data.session===session&&pending&&data.key===pending.key)pending.resolve();
  else if(data?.type==='entropi-models-cancel'&&session!==null&&data.session===session){stopLaunch();cancelDelivery();show(prepared?'ready':'waiting',prepared?'':'Koplar til kameraet …')}
});
window.addEventListener('pagehide',event=>{closed=true;preparation++;task?.abort();stopLaunch();if(!event.persisted){closeCameraPort();cameraConnected=false}cancelDelivery();prepared=ready=downloading=false;document.documentElement.dataset.ready='false'});
window.addEventListener('pageshow',event=>{if(event.persisted){closed=false;void prepare(false,true)}});
void prepare(!transfer&&!new URL(location.href).searchParams.has('camera'));
