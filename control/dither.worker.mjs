import {processPixels} from './dither-core.mjs';
import {encodeGIF} from './gif-codec.mjs';
self.onmessage=({data})=>{
 const {type,id,width,height,frame,frames,settings,palette,custom,delay}=data;
 try {
  if(type==='frame'){
   const out=processPixels(new Uint8ClampedArray(frame),width,height,settings);
   self.postMessage({type:'frame',id,width,height,buffer:out.buffer},[out.buffer]);
  }else if(type==='gif'){
   const processed=[];
   for(let i=0;i<frames.length;i++){
    processed.push(processPixels(new Uint8ClampedArray(frames[i]),width,height,settings));
    self.postMessage({type:'progress',id,value:Math.round(80*(i+1)/frames.length)});
   }
   const gif=encodeGIF(processed,width,height,palette,custom,delay);
   self.postMessage({type:'gif',id,buffer:gif.buffer},[gif.buffer]);
  }
 }catch(error){self.postMessage({type:'error',id,message:error.message||String(error)})}
};
