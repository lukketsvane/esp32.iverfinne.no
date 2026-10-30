import { loadAsset, loadCachedAsset } from './assets.mjs';
import { upscaleSize, sourceTile, cropTensor, writeOutputTile, pngStream } from './upscale-core.mjs';

let busy=false;
self.onmessage=async event=>{
  if(busy)return;busy=true;let session;
  const progress=(phase,percent)=>self.postMessage({type:'progress',phase,percent});
  try{
    const {width,height,factor}=event.data,source=new Uint8ClampedArray(event.data.rgba),size=upscaleSize(width,height,factor);
    if(source.length!==width*height*4)throw new Error('Ugyldige biletdata.');
    const response=await fetch(new URL('./models/manifest.json',import.meta.url),{cache:'force-cache'});if(!response.ok)throw new Error('AI-modellen manglar.');
    const manifest=await response.json();if(!manifest.upscale)throw new Error('AI-modellen manglar.');
    const phoneOnly=location.protocol==='http:'&&(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||location.port==='19304');
    const model=phoneOnly?await loadCachedAsset(manifest.upscale):await loadAsset(manifest.upscale,percent=>progress('loading-model',percent));
    let provider='wasm',ort;
    if(!phoneOnly&&manifest.runtimeGPU&&self.navigator?.gpu)try{if(await navigator.gpu.requestAdapter())provider='webgpu'}catch{}
    const start=async()=>{
      ort=await import(provider==='webgpu'?'./vendor/ort.webgpu.min.mjs':'./vendor/ort.wasm.min.mjs');
      const runtime=provider==='webgpu'?manifest.runtimeGPU:manifest.runtime;
      ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;ort.env.logLevel='error';
      ort.env.wasm.wasmBinary=phoneOnly?await loadCachedAsset(runtime):await loadAsset(runtime,percent=>progress('loading-runtime',percent));
      progress('starting',0);return await ort.InferenceSession.create(model,{executionProviders:[provider],graphOptimizationLevel:'all'});
    };
    try{session=await start()}catch(error){if(provider!=='webgpu')throw error;provider='wasm';session=await start()}
    const infer=async patch=>{
      const input=new ort.Tensor('float32',patch.data,[1,3,patch.height,patch.width]);let outputs;
      try{
        outputs=await session.run({[session.inputNames[0]]:input});const value=outputs[session.outputNames[0]],w=value.dims.at(-1),h=value.dims.at(-2);
        if(w!==patch.width*4||h!==patch.height*4||value.data.length!==w*h*3)throw new Error('AI-modellen gav feil biletstorleik.');
        const data=new Float32Array(value.data);if(!data.every(Number.isFinite))throw new Error('AI-modellen gav ugyldige verdiar.');
        return {data,width:w,height:h};
      }finally{input.dispose();for(const output of Object.values(outputs||{}))output.dispose()}
    };
    const tile=factor===8?32:96,padding=factor===8?48:36,total=Math.ceil(width/tile)*Math.ceil(height/tile);
    const encoder=pngStream(size.width,size.height,{model:manifest.upscale.model,modelSha256:manifest.upscale.sha256,factor,sourceWidth:width,sourceHeight:height,neuralPasses:factor===8?2:1,executionProvider:provider,nativeScale:4,output:'rendered-artwork',sensorRaw:false});
    let completed=0;
    for(let top=0;top<height;top+=tile){
      const rows=Math.min(tile,height-top),strip=new Uint8ClampedArray(size.width*rows*factor*4);
      for(let left=0;left<width;left+=tile){
        const columns=Math.min(tile,width-left);let result=await infer(sourceTile(source,width,height,left,top,tile,padding)),outputPadding=padding;
        if(factor===8){const patch=cropTensor(result.data,result.width,result.height,padding*4-36,padding*4-36,tile*4+72);result=null;result=await infer(patch);outputPadding=36}
        writeOutputTile(strip,size.width,source,width,height,left,top,columns,rows,factor,result,outputPadding);completed++;progress('upscaling',Math.round(completed/total*100));
      }
      await encoder.write(strip,rows*factor);
    }
    const blob=await encoder.finish();self.postMessage({type:'result',blob,width:size.width,height:size.height});
  }catch(error){self.postMessage({type:'error',code:error?.code||'UPSCALE_FAILED',message:error?.message||'AI-oppskaleringa stoppa.'})}
  finally{await session?.release();busy=false}
};
