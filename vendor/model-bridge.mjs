import { loadCachedAsset, storeAsset } from '../pointcloud/assets.mjs';

const modelManifest=signal=>fetch('/pointcloud/models/manifest.json',{cache:'force-cache',signal}).then(response=>{if(!response.ok)throw new Error('Modellmanifestet manglar.');return response.json()});

export async function phoneModelsReady(signal){
  const manifest=await modelManifest(signal);
  try{for(const key of ['asset','runtime']){signal?.throwIfAborted();await loadCachedAsset(manifest[key])}signal?.throwIfAborted();return true}
  catch(error){signal?.throwIfAborted();if(error.code==='PHONE_SETUP_REQUIRED')return false;throw error}
}

export function requestPhoneModels(signal,onProgress=()=>{},source=null){
  signal?.throwIfAborted();
  const origin='https://esp32.iverfinne.no',helper=source||window.open(origin+'/prepare/?transfer','entropi-models');
  if(!helper)return Promise.reject(new Error('Tillat opning av klargjeringa og prøv igjen.'));
  const random=new Uint8Array(16);crypto.getRandomValues(random);
  const session=Array.from(random,value=>value.toString(16).padStart(2,'0')).join('');
  return new Promise((resolve,reject)=>{
    let manifest=null,ready=false,busy=false,finished=false,index=0;
    const keys=['asset','runtime'];
    const finish=error=>{
      if(finished)return;finished=true;clearTimeout(timer);window.removeEventListener('message',message);signal?.removeEventListener('abort',abort);
      if(error&&source)try{helper.postMessage({type:'entropi-models-cancel',session},origin)}catch{}
      if(!source)try{helper.close()}catch{}
      if(error)reject(error);else resolve();
    };
    const abort=()=>finish(signal.reason||new DOMException('Avbrote.','AbortError'));
    const start=()=>{if(manifest&&ready&&!finished)helper.postMessage({type:'entropi-models-request',session},origin)};
    const message=async event=>{
      if(finished||event.origin!==origin||event.source!==helper)return;
      const data=event.data;
      if(data?.type==='entropi-models-ready'){if(!ready){ready=true;clearTimeout(timer);timer=setTimeout(()=>finish(new Error('Klargjeringa tok for lang tid. Prøv igjen.')),120000);start()}return}
      if(data?.session!==session)return;
      if(data.type==='entropi-models-error'){finish(Object.assign(new Error(data.message||'Klargjer telefonen med internett éin gong.'),{code:data.code}));return}
      if(data.type==='entropi-models-complete'){if(index===keys.length&&!busy)finish();return}
      if(data.type!=='entropi-model-asset'||busy||data.key!==keys[index]||!(data.bytes instanceof ArrayBuffer))return;
      busy=true;
      try{
        const asset=manifest?.[data.key];
        if(!asset||data.bytes.byteLength!==asset.bytes)throw new Error('Modellfila kunne ikkje kontrollerast.');
        await storeAsset(asset,new Uint8Array(data.bytes));
        if(finished)return;
        index++;busy=false;onProgress({phase:'preparing',percent:index/keys.length*100});
        helper.postMessage({type:'entropi-model-ack',session,key:data.key},origin);
      }catch(error){finish(error)}
    };
    let timer=setTimeout(()=>finish(new Error('Opne esp32.iverfinne.no/start/ med internett éin gong, og prøv igjen.')),10000);
    window.addEventListener('message',message);signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return}
    if(source)helper.postMessage({type:'entropi-models-connect'},origin);
    modelManifest(signal).then(value=>{manifest=value;start()}).catch(finish);
  });
}
