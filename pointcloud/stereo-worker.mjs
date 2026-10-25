import { estimateStereoDepth } from './stereo.mjs';

self.onmessage=event=>{
  try{
    const {left,right,width,height}=event.data||{};
    if(!(left instanceof ArrayBuffer)||!(right instanceof ArrayBuffer))throw new Error('Ugyldige stereobilete.');
    const result=estimateStereoDepth(new Uint8ClampedArray(left),new Uint8ClampedArray(right),width,height);
    self.postMessage({type:'result',depth:result.depth.buffer,valid:result.valid.buffer,width,height,matchedFraction:result.matchedFraction},[result.depth.buffer,result.valid.buffer]);
  }catch(error){self.postMessage({type:'error',message:error?.message||'Stereoberekninga stoppa.'})}
};
