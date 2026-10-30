export function createSweepCapture({capture,maxMs=15000,maxFrames=8,intervalMs=1800,onFrame=()=>{}}){
  if(typeof capture!=='function'||!Number.isFinite(maxMs)||maxMs<=0||maxMs>15000||!Number.isInteger(maxFrames)||maxFrames<2||maxFrames>8||!Number.isFinite(intervalMs)||intervalMs<0)throw new Error('Ugyldig panoramaopptak.');
  const controller=new AbortController(),frames=[],started=performance.now();
  let finished=false,cancelled=false,wake=null,lastError=null;
  function finish(){if(finished)return;finished=true;controller.abort();wake?.()}
  function cancel(){cancelled=true;finish()}
  const timer=setTimeout(finish,maxMs);
  const done=(async()=>{
    try{
      while(!finished){
        if(performance.now()-started>=maxMs){finish();break}
        if(frames.length<maxFrames){
          const at=performance.now();
          try{
            const frame=await capture(controller.signal);
            if(!finished&&performance.now()-started<maxMs){
              if(!(frame?.left instanceof Blob)||!frame.left.size||frame.right!=null&&(!(frame.right instanceof Blob)||!frame.right.size))throw new Error('Kameraet gav ikkje eit gyldig foto.');
              frames.push({...frame,capturedAt:frame.capturedAt??new Date().toISOString(),elapsedMs:Math.round(performance.now()-started)});onFrame(frames.length);
            }
          }catch(error){if(!finished)lastError=error}
          if(!finished)await new Promise(resolve=>{let wait;wake=()=>{clearTimeout(wait);wake=null;resolve()};wait=setTimeout(wake,Math.max(0,intervalMs-(performance.now()-at)))})
        }else await new Promise(resolve=>{wake=()=>{wake=null;resolve()}});
      }
      if(cancelled)throw new DOMException('Panoramaet vart avbrote.','AbortError');
      if(frames.length<2)throw new Error(lastError?.message??'Hald litt lenger og før kameraet roleg til sida. Panorama treng minst to foto.');
      return frames;
    }finally{clearTimeout(timer);controller.abort();wake?.()}
  })();
  return {finish,cancel,done,get count(){return frames.length}};
}
