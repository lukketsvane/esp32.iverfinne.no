import { inferenceSize } from '../pointcloud/math.mjs';

export function localDepthEndpoint(location=globalThis.location,configured=globalThis.__ENTROPI_DEPTH_ENDPOINT){
  if(configured){
    const endpoint=new URL(configured,location.href);
    if(endpoint.origin!==location.origin)throw new Error('Djupnetenesta må bruke same opphav som kameraet.');
    return endpoint.href;
  }
  return ['localhost','127.0.0.1','[::1]'].includes(location?.hostname)?new URL('/api/depth',location.href).href:null;
}

export async function runLocalDepth(blob,{signal,onProgress=()=>{},fetcher=fetch,endpoint=localDepthEndpoint()}={}){
  if(!endpoint)throw new Error('Lokal djupneteneste er ikkje sett opp.');
  signal?.throwIfAborted();
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason),timer=setTimeout(()=>controller.abort(new Error('Djupnetenesta brukte for lang tid.')),180000);
  signal?.addEventListener('abort',abort,{once:true});
  try{
    onProgress({phase:'estimating'});
    const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal:controller.signal});
    if(!response.ok)throw new Error('Lokal djupneteneste svarte med HTTP '+response.status+'.');
    const width=Number(response.headers.get('X-Depth-Width')),height=Number(response.headers.get('X-Depth-Height'));
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width*height>16777216)throw new Error('Ugyldig djupneoppløysing.');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength!==width*height*4)throw new Error('Ufullstendig djupnekart.');
    const data=new DataView(bytes),depth=new Float32Array(width*height);
    for(let i=0;i<depth.length;i++)depth[i]=data.getFloat32(i*4,true);
    const polarity=response.headers.get('X-Depth-Polarity')||'near';
    if(!['near','far'].includes(polarity))throw new Error('Ukjend djupneretning.');
    return {depth,width,height,polarity,model:response.headers.get('X-Depth-Model')||'Lokal djupnemodell',source:'local',images:new Map()};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}

export async function runBrowserDepth(blob,{signal,onProgress=()=>{}}={}){
  signal?.throwIfAborted();
  const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');
  let pixels,size,sourceWidth,sourceHeight;
  try{
    image.src=url;await image.decode();signal?.throwIfAborted();sourceWidth=image.naturalWidth;sourceHeight=image.naturalHeight;
    size=inferenceSize(sourceWidth,sourceHeight,518);canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Kunne ikkje lese fotoet.');
    context.drawImage(image,0,0,size.width,size.height);pixels=context.getImageData(0,0,size.width,size.height);
  }finally{URL.revokeObjectURL(url);canvas.width=canvas.height=1}
  return new Promise((resolve,reject)=>{
    const worker=new Worker('/pointcloud/depth-worker-v2.mjs',{type:'module'});
    let finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result)};
    const abort=()=>finish(signal.reason||new DOMException('Avbrote.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Djupneberekninga tok for lang tid.')),180000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if(data.type==='progress')onProgress(data);
      else if(data.type==='error')finish(Object.assign(new Error(data.message),{code:data.code||'DEPTH_FAILED'}));
      else if(data.type==='result')finish(null,{depth:new Float32Array(data.depth),width:data.width,height:data.height,sourceWidth,sourceHeight,polarity:'near',model:'Depth Anything V2 Small · nettlesar 518 px',source:'browser',images:new Map()});
    };
    worker.onerror=()=>finish(new Error('Djupnearbeidaren stoppa.'));
    try{worker.postMessage({rgba:pixels.data.buffer,...size},[pixels.data.buffer])}catch(error){finish(error)}
    if(signal?.aborted)abort();
  });
}
