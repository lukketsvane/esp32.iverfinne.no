import { loadAsset, loadCachedAsset } from '/pointcloud/assets.mjs';

const status=document.getElementById('status'),bar=document.getElementById('progress'),next=document.getElementById('ready'),retry=document.getElementById('retry'),transfer=new URL(location.href).searchParams.has('transfer');
const allowed=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
let peer=null,peerOrigin=null,manifest,ready=false,prepared=false,session=null,pending=null,closed=false,preparation=0,delivery=0,task=null;
if(transfer)try{const origin=new URL(document.referrer).origin;if(window.opener&&allowed.has(origin)){peer=window.opener;peerOrigin=origin}}catch{}
const send=data=>{if(peer&&peerOrigin)peer.postMessage(data,peerOrigin)};
function show(phase,message){status.textContent=message;bar.hidden=phase!=='working';next.hidden=phase!=='ready';retry.hidden=phase!=='error';document.documentElement.dataset.ready=String(prepared)}
function cancelDelivery(){delivery++;session=null;const waiting=pending;pending=null;waiting?.reject(new DOMException('Avbrote.','AbortError'))}
function fail(error){prepared=false;ready=false;show('error',error.message||'Telefonen kunne ikkje klargjerast.');send({type:'entropi-models-error',session,code:error.code||'PHONE_SETUP_FAILED',message:status.textContent})}

async function controlled(){
  if(!navigator.serviceWorker)throw new Error('Opne klargjeringa i Safari med internett.');
  const expected=new URL('/prepare/sw.js',location.href).href,scope=new URL('/prepare/',location.href).href;let timer,changed;
  try{await Promise.race([
    (async()=>{
      const registration=await navigator.serviceWorker.getRegistration('/prepare/');if(registration?.scope!==scope||registration?.active?.scriptURL!==expected)await navigator.serviceWorker.register('/prepare/sw.js',{scope:'/prepare/'});await navigator.serviceWorker.ready;
      if(navigator.serviceWorker.controller?.scriptURL!==expected)await new Promise(resolve=>{changed=()=>{if(navigator.serviceWorker.controller?.scriptURL===expected)resolve()};navigator.serviceWorker.addEventListener('controllerchange',changed);changed()});
    })(),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Klargjeringa kunne ikkje lagrast. Opne sida i Safari med internett og prøv igjen.')),15000)})
  ])}finally{clearTimeout(timer);if(changed)navigator.serviceWorker.removeEventListener('controllerchange',changed)}
}

async function prepare(){
  const generation=++preparation;task?.abort();const currentTask=task=new AbortController();cancelDelivery();prepared=false;ready=false;bar.removeAttribute('value');show('working','Klargjer telefonen …');
  try{
    if(transfer&&!peer)throw new Error('Opne klargjeringa frå kameraet i Safari.');
    await controlled();if(closed||generation!==preparation)return;const response=await fetch('/pointcloud/models/manifest.json',{signal:currentTask.signal});if(!response.ok)throw new Error('Modellmanifestet manglar.');manifest=await response.json();
    if(closed||generation!==preparation)return;
    if(transfer){ready=true;show('waiting','Koplar til kameraet …');send({type:'entropi-models-ready'});return}
    const total=manifest.asset.bytes+manifest.runtime.bytes;let completed=0;
    for(const key of ['asset','runtime']){
      await loadAsset(manifest[key],percent=>{if(generation===preparation)bar.value=(completed+manifest[key].bytes*percent/100)/total*100},currentTask.signal);
      await loadCachedAsset(manifest[key]);if(closed||generation!==preparation)return;completed+=manifest[key].bytes;
    }
    await navigator.storage?.persist?.().catch(()=>false);
    if(closed||generation!==preparation)return;ready=prepared=true;show('ready','Telefonen er klar.');
  }catch(error){if(!closed&&generation===preparation)fail(error)}
}

async function deliver(requestedSession){
  const generation=++delivery;session=requestedSession;bar.value=0;show('working','Klargjer kameraet …');
  try{
    for(const [index,key] of ['asset','runtime'].entries()){
      const bytes=await loadCachedAsset(manifest[key]);if(closed||generation!==delivery)return;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending=null;reject(new Error('Kameraet svara ikkje. Prøv igjen i Safari.'))},60000);
        pending={key,resolve:()=>{clearTimeout(timer);pending=null;resolve()},reject:error=>{clearTimeout(timer);pending=null;reject(error)}};
        try{peer.postMessage({type:'entropi-model-asset',session,key,bytes:bytes.buffer},peerOrigin,[bytes.buffer])}catch(error){pending.reject(error)}
      });
      if(closed||generation!==delivery)return;bar.value=(index+1)/2*100;
    }
    if(closed||generation!==delivery)return;prepared=true;send({type:'entropi-models-complete',session});show(transfer?'waiting':'ready',transfer?'Klar.':'Telefonen er klar.');if(transfer)setTimeout(()=>window.close(),150);
  }catch(error){if(!closed&&generation===delivery)fail(error)}
  finally{if(generation===delivery){session=null;pending=null}}
}

document.getElementById('open-camera').addEventListener('click',()=>{
  if(!prepared||closed)return;
  cancelDelivery();peerOrigin=null;peer=window.open('http://192.168.4.1/?connect','_blank');if(!peer)status.textContent='Tillat opning av kameraet, og prøv igjen.';
});
retry.addEventListener('click',()=>void prepare());
window.addEventListener('message',event=>{
  if(closed||event.source!==peer||!allowed.has(event.origin))return;
  const data=event.data;
  if(!transfer&&data?.type==='entropi-models-connect'&&ready&&prepared){peerOrigin=event.origin;send({type:'entropi-models-ready'});return}
  if(!ready||event.origin!==peerOrigin)return;
  if(data?.type==='entropi-models-request'&&session===null&&typeof data.session==='string'&&data.session.length>0&&data.session.length<=128)void deliver(data.session);
  else if(data?.type==='entropi-model-ack'&&data.session===session&&pending&&data.key===pending.key)pending.resolve();
  else if(data?.type==='entropi-models-cancel'&&session!==null&&data.session===session){cancelDelivery();show(prepared?'ready':'waiting',prepared?'Telefonen er klar.':'Koplar til kameraet …')}
});
window.addEventListener('pagehide',()=>{closed=true;preparation++;task?.abort();cancelDelivery();prepared=ready=false;document.documentElement.dataset.ready='false'});
window.addEventListener('pageshow',event=>{if(event.persisted){closed=false;void prepare()}});
void prepare();
