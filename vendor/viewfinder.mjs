import {processPhoto} from './photo-view.mjs';

export class Viewfinder {
  constructor(canvas){
    this.canvas=canvas;this.active=true;this.disposed=false;this.source=null;this.style=0;this.grain=1;this.contrast=1;
    this.context=canvas.getContext('2d');this.sampleCanvas=canvas.ownerDocument.createElement('canvas');this.sampleContext=this.sampleCanvas.getContext('2d',{willReadFrequently:true});
    this.fit(240,360);let previous=-Infinity;
    const frame=time=>{if(this.disposed)return;this.animation=requestAnimationFrame(frame);if(!this.active||document.hidden||time-previous<50)return;previous=time;this.draw()};
    this.animation=requestAnimationFrame(frame);
  }
  setStyle(level){this.style=Number.isFinite(level)?Math.max(0,Math.min(3,Math.round(level))):0}
  setTone({grain=this.grain,contrast=this.contrast}={}){if(Number.isFinite(grain))this.grain=Math.max(1,Math.min(8,Math.round(grain)));if(Number.isFinite(contrast))this.contrast=Math.max(.5,Math.min(3,contrast))}
  draw(){
    const source=this.source;if(!source||!this.context||!this.sampleContext)return;
    const video=source instanceof HTMLVideoElement;if(video&&source.readyState<2)return;
    const width=video?source.videoWidth:source.naturalWidth||source.width,height=video?source.videoHeight:source.naturalHeight||source.height;if(!width||!height)return;
    this.fit(width,height);
    try{
      this.sampleContext.drawImage(source,0,0,this.canvas.width,this.canvas.height);
      const input=this.sampleContext.getImageData(0,0,this.canvas.width,this.canvas.height).data;
      for(let i=0;i<input.length;i+=4){const gray=Math.round(input[i]*.2126+input[i+1]*.7152+input[i+2]*.0722);input[i]=input[i+1]=input[i+2]=gray}
      this.output.data.set(processPhoto(input,this.canvas.width,this.canvas.height,this.style,this.grain,this.contrast));this.context.putImageData(this.output,0,0);
    }catch{}
  }
  fit(width,height){
    const ratio=width/height;if(!Number.isFinite(ratio)||ratio<=0)return;
    const scale=Math.sqrt(ratio/(2/3));if(this.ratio!==ratio&&this.canvas.parentElement){this.canvas.parentElement.style.aspectRatio=String(ratio);this.canvas.parentElement.style.width=`clamp(104px,${30*scale}vw,${148*scale}px)`}this.ratio=ratio;
    const rect=this.canvas.getBoundingClientRect?.(),w=rect?.width>0?Math.max(1,Math.round(Math.min(rect.width,Math.sqrt(86400*ratio)))):Math.round(240*scale),h=Math.max(1,Math.round(w/ratio));if(this.canvas.width===w&&this.canvas.height===h)return;
    this.canvas.width=this.sampleCanvas.width=w;this.canvas.height=this.sampleCanvas.height=h;this.output=this.context?.createImageData(w,h);
    this.canvas.style.imageRendering='pixelated';
  }
  clear(){this.source=null;if(this.context){this.context.fillStyle='#000';this.context.fillRect(0,0,this.canvas.width,this.canvas.height)}}
  dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.animation);this.source=null;this.sampleCanvas.width=this.sampleCanvas.height=1;this.output=null}
}
