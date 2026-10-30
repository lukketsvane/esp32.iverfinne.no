import { loadCachedAsset } from '../pointcloud/assets.mjs';
import { upscaleSize } from '../pointcloud/upscale-core.mjs';
import { requestPhoneModels } from './model-bridge.mjs';

let upscaleAssetsReady=false,upscaleReadiness=null;
const phoneUpscale=()=>location.protocol==='http:'&&(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||location.port==='19304');
export function warmUpscaleAssets(){
  if(!phoneUpscale())return Promise.resolve(true);
  return upscaleReadiness??=fetch('/pointcloud/models/manifest.json',{cache:'force-cache'}).then(response=>{if(!response.ok)throw new Error('AI-modellen manglar.');return response.json()}).then(async manifest=>{await loadCachedAsset(manifest.upscale);await loadCachedAsset(manifest.runtime);return upscaleAssetsReady=true}).catch(()=>false).finally(()=>{upscaleReadiness=null});
}
export async function prepareUpscaleAssets(signal,onProgress=()=>{}){
  signal?.throwIfAborted();
  if(phoneUpscale()&&!upscaleAssetsReady){await requestPhoneModels(signal,onProgress,null,'https://esp32.iverfinne.no','upscale');upscaleAssetsReady=true}
}
export async function upscaleImage(blob,factor,{signal,onProgress=()=>{},isCurrent=()=>true}={}){
  signal?.throwIfAborted();
  if(!(blob instanceof Blob)||!blob.type.startsWith('image/')||!blob.size||blob.size>64*1024*1024)throw new Error('Ugyldig bilete for AI-oppskalering.');
  let image,url;
  try{
    if(typeof createImageBitmap==='function')image=await createImageBitmap(blob);
    else{url=URL.createObjectURL(blob);image=new Image();image.src=url;await image.decode()}
    signal?.throwIfAborted();if(!isCurrent())throw new DOMException('Avbrote.','AbortError');
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;upscaleSize(width,height,factor);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('Telefonen kunne ikkje klargjere biletet.');
    context.drawImage(image,0,0);const rgba=context.getImageData(0,0,width,height).data;canvas.width=canvas.height=1;image.close?.();image=null;if(url){URL.revokeObjectURL(url);url=null}
    return await new Promise((resolve,reject)=>{
      const worker=new Worker('/pointcloud/upscale-worker.mjs',{type:'module'});let finished=false,timer;
      const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',abort);globalThis.removeEventListener('pagehide',abort);if(error)reject(error);else resolve(result)};
      const abort=()=>finish(signal?.reason||new DOMException('Avbrote.','AbortError'));
      const watch=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(new Error('AI-oppskaleringa svara ikkje. Prøv igjen.')),120000)};watch();
      signal?.addEventListener('abort',abort,{once:true});globalThis.addEventListener('pagehide',abort,{once:true});
      worker.onmessage=event=>{
        if(!isCurrent()){abort();return}const message=event.data;watch();
        if(message?.type==='progress')onProgress(message);
        else if(message?.type==='result'){if(!(message.blob instanceof Blob)||!message.blob.size)finish(new Error('AI-biletet manglar.'));else finish(null,message.blob)}
        else if(message?.type==='error'){if(message.code==='PHONE_SETUP_REQUIRED')upscaleAssetsReady=false;finish(Object.assign(new Error(message.message),{code:message.code}))}
      };
      worker.onerror=()=>finish(new Error('AI-oppskaleringa kunne ikkje startast.'));
      if(signal?.aborted){abort();return}worker.postMessage({rgba:rgba.buffer,width,height,factor},[rgba.buffer]);
    });
  }finally{image?.close?.();if(url)URL.revokeObjectURL(url)}
}
