import { FIXED_STEREO_RIG, prepareFixedStereo, restoreFixedStereo } from '../pointcloud/stereo-rig.mjs';

export async function runStereoDepth(left,right,{signal,onProgress=()=>{}}={}){
  signal?.throwIfAborted();onProgress({phase:'reading'});
  const urls=[],images=[];let pixels,sourceWidth,sourceHeight,canvas;
  try{
    for(const blob of [left,right]){
      const image=new Image(),url=URL.createObjectURL(blob);urls.push(url);image.src=url;await image.decode();signal?.throwIfAborted();images.push(image);
    }
    const first=images[0];sourceWidth=first.naturalWidth;sourceHeight=first.naturalHeight;
    if(!sourceWidth||!sourceHeight||sourceWidth!==images[1].naturalWidth||sourceHeight!==images[1].naturalHeight)throw new Error('Kameraa må bruke same fotooppløysing.');
    const scale=Math.min(1,320/sourceWidth,240/sourceHeight),width=Math.round(sourceWidth*scale),height=Math.round(sourceHeight*scale);
    canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Telefonen kunne ikkje lese bileta.');
    pixels=images.map(image=>{context.drawImage(image,0,0,width,height);return context.getImageData(0,0,width,height)});
  }finally{urls.forEach(url=>URL.revokeObjectURL(url));if(canvas)canvas.width=canvas.height=1}
  onProgress({phase:'matching'});signal?.throwIfAborted();
  const prepared=prepareFixedStereo(pixels[0],pixels[1]);
  const prediction=await new Promise((resolve,reject)=>{
    const worker=new Worker('/pointcloud/stereo-worker.mjs',{type:'module'});let finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result)};
    const abort=()=>finish(signal.reason||new DOMException('Avbrote.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Stereoberekninga tok for lang tid.')),30000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{try{if(data.type==='result')finish(null,restoreFixedStereo({depth:new Float32Array(data.depth),valid:new Uint8Array(data.valid),width:data.width,height:data.height},pixels[0].width,pixels[0].height));else if(data.type==='error')finish(new Error(data.message))}catch(error){finish(error)}};
    worker.onerror=()=>finish(new Error('Telefonen kunne ikkje kombinere kameraa.'));
    const {left,right,width,height}=prepared;
    try{worker.postMessage({left:left.buffer,right:right.buffer,width,height},[left.buffer,right.buffer])}catch(error){finish(error)}
    if(signal?.aborted)abort();
  });
  signal?.throwIfAborted();
  const provenance={rigId:prediction.rigId,matchedFraction:prediction.matchedFraction,metric:FIXED_STEREO_RIG.metric,hardwareSynchronized:FIXED_STEREO_RIG.hardwareSynchronized};
  return {depth:prediction.depth,validity:prediction.valid,width:prediction.width,height:prediction.height,sourceWidth,sourceHeight,polarity:'near',source:'stereo',model:'Stereo census · fixed rig',quantity:'disparity',units:'px',...provenance,provenance,pixels:pixels[0],images:new Map()};
}
