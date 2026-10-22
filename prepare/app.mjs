import { loadAsset, loadCachedAsset } from '/pointcloud/assets.mjs';

const status=document.getElementById('status'),bar=document.getElementById('progress'),transfer=new URL(location.href).searchParams.has('transfer');
const allowed=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
let parentOrigin=null,manifest,ready=false,session=null,pending=null,closed=false;
try{const origin=new URL(document.referrer).origin;if(window.opener&&allowed.has(origin))parentOrigin=origin}catch{}
const send=data=>{if(parentOrigin)window.opener?.postMessage(data,parentOrigin)};
function fail(error){bar.hidden=true;status.textContent=error.message||'Telefonen kunne ikkje klargjerast.';send({type:'entropi-models-error',session,code:error.code||'PHONE_SETUP_FAILED',message:status.textContent})}

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
  try{
    if(transfer&&!parentOrigin)throw new Error('Opne klargjeringa frå kameraet i Safari.');
    await controlled();const response=await fetch('/pointcloud/models/manifest.json');if(!response.ok)throw new Error('Modellmanifestet manglar.');manifest=await response.json();
    if(transfer){ready=true;bar.hidden=true;status.textContent='Koplar til kameraet …';send({type:'entropi-models-ready'});return}
    for(const key of ['asset','runtime']){
      await loadAsset(manifest[key],percent=>{bar.value=percent;status.textContent='Klargjer telefonen …'});
      await loadCachedAsset(manifest[key]);
    }
    await navigator.storage?.persist?.().catch(()=>false);
    if(closed)return;ready=true;bar.hidden=true;status.textContent='Klar. Kople til ENTROPI.';document.documentElement.dataset.ready='true';
  }catch(error){if(!closed)fail(error)}
}

async function deliver(requestedSession){
  session=requestedSession;
  try{
    for(const key of ['asset','runtime']){
      const bytes=await loadCachedAsset(manifest[key]);if(closed)return;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending=null;reject(new Error('Kameraet svara ikkje. Prøv igjen i Safari.'))},60000);
        pending={key,resolve:()=>{clearTimeout(timer);pending=null;resolve()},reject:()=>{clearTimeout(timer);pending=null;reject(new Error('Avbrote.'))}};
        try{window.opener.postMessage({type:'entropi-model-asset',session,key,bytes:bytes.buffer},parentOrigin,[bytes.buffer])}catch{pending.reject()}
      });
    }
    if(closed)return;document.documentElement.dataset.ready='true';send({type:'entropi-models-complete',session});status.textContent='Klar.';setTimeout(()=>window.close(),150);
  }catch(error){if(!closed)fail(error)}
}

window.addEventListener('message',event=>{
  if(!transfer||!ready||event.origin!==parentOrigin||event.source!==window.opener)return;
  const data=event.data;
  if(data?.type==='entropi-models-request'&&session===null&&typeof data.session==='string'&&data.session.length>0&&data.session.length<=128)void deliver(data.session);
  else if(data?.type==='entropi-model-ack'&&data.session===session&&pending&&data.key===pending.key)pending.resolve();
});
window.addEventListener('pagehide',()=>{closed=true;pending?.reject()},{once:true});
void prepare();
