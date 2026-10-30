let depthWorker=null,depthIdle=0,depthCancel=null;
function releaseDepthWorker(){clearTimeout(depthIdle);depthIdle=0;depthWorker?.terminate();depthWorker=null}
globalThis.addEventListener?.('pagehide',()=>{if(!depthCancel)releaseDepthWorker()});
globalThis.document?.addEventListener?.('visibilitychange',()=>{if(document.hidden&&!depthCancel)releaseDepthWorker()});

export function estimateDepth(pixels,onProgress=()=>{},signal){
  signal?.throwIfAborted();depthCancel?.(new DOMException('Avbrote.','AbortError'));clearTimeout(depthIdle);
  return new Promise((resolve,reject)=>{
    const worker=depthWorker??=new Worker('/pointcloud/depth-worker-v2.mjs',{type:'module'});let finished=false;
    const finish=(error,result)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.onmessage=worker.onerror=null;if(depthCancel===finish)depthCancel=null;
      if(error||globalThis.document?.hidden)releaseDepthWorker();else depthIdle=setTimeout(releaseDepthWorker,30000);
      if(error)reject(error);else resolve(result);
    };
    const abort=()=>finish(signal.reason||new DOMException('Avbrote.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Djupneberekninga tok for lang tid. Prøv igjen.')),180000);
    depthCancel=finish;signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if(finished)return;
      if(data.type==='progress')onProgress(data);
      else if(data.type==='error')finish(Object.assign(new Error(data.message),{code:data.code}));
      else if(data.type==='result'){
        if(!Number.isInteger(data.width)||!Number.isInteger(data.height)||data.width<1||data.height<1||data.width*data.height>16777216||!(data.depth instanceof ArrayBuffer)||data.depth.byteLength!==data.width*data.height*4)return finish(new Error('Ugyldig djupnekart.'));
        finish(null,{depth:new Float32Array(data.depth),width:data.width,height:data.height});
      }
    };
    worker.onerror=()=>finish(new Error('Telefonen kunne ikkje berekne djupna.'));
    const copy=new Uint8ClampedArray(pixels.data);
    try{worker.postMessage({rgba:copy.buffer,width:pixels.width,height:pixels.height},[copy.buffer])}catch(error){finish(error)}
    if(signal?.aborted)abort();
  });
}
