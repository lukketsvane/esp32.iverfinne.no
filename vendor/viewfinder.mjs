import {processPhoto} from './photo-view.mjs';

export class Viewfinder {
  constructor(canvas){
    this.canvas=canvas;this.active=true;this.disposed=false;this.source=null;this.style=0;this.grain=1;this.contrast=1;
    this.context=canvas.getContext('2d');this.sampleCanvas=canvas.ownerDocument.createElement('canvas');this.sampleContext=this.sampleCanvas.getContext('2d',{willReadFrequently:true});
    this.fit();let previous=-Infinity;
    const frame=time=>{if(this.disposed)return;this.animation=requestAnimationFrame(frame);if(!this.active||document.hidden||time-previous<50)return;previous=time;this.draw(time)};
    this.animation=requestAnimationFrame(frame);
  }
  setStyle(level){this.style=Number.isFinite(level)?Math.max(0,Math.min(3,Math.round(level))):0}
  setTone({grain=this.grain,contrast=this.contrast}={}){if(Number.isFinite(grain))this.grain=Math.max(1,Math.min(8,Math.round(grain)));if(Number.isFinite(contrast))this.contrast=Math.max(.5,Math.min(3,contrast))}
  draw(time=0){
    const source=this.source;if(!source||!this.context||!this.sampleContext)return;
    const video=source instanceof HTMLVideoElement;if(video&&source.readyState<2)return;
    const width=video?source.videoWidth:source.naturalWidth||source.width,height=video?source.videoHeight:source.naturalHeight||source.height;if(!width||!height)return;
    this.fit();
    try{
      const ratio=width/height/(2/3),cw=width*Math.min(1,1/ratio),ch=height*Math.min(1,ratio);
      this.sampleContext.drawImage(source,(width-cw)/2,(height-ch)/2,cw,ch,0,0,this.canvas.width,this.canvas.height);
      const input=this.sampleContext.getImageData(0,0,this.canvas.width,this.canvas.height).data;
      for(let i=0;i<this.warp.length;i++){const at=this.warp[i],gray=at<0?0:((input[at]*.299+input[at+1]*.587+input[at+2]*.114)-18)*1.2*this.shade[i]+((i*13+Math.floor(time/55)*17)%19-9)*.35;this.pixels[i*4]=this.pixels[i*4+1]=this.pixels[i*4+2]=gray}
      this.output.data.set(processPhoto(this.pixels,this.canvas.width,this.canvas.height,this.style,this.grain,this.contrast));this.context.putImageData(this.output,0,0);
    }catch{}
  }
  fit(){
    const rect=this.canvas.getBoundingClientRect?.(),w=rect?.width>0?Math.max(1,Math.round(Math.min(rect.width,240))):240,h=Math.max(1,Math.round(w*1.5));if(this.canvas.width===w&&this.canvas.height===h)return;
    this.canvas.width=this.sampleCanvas.width=w;this.canvas.height=this.sampleCanvas.height=h;this.output=this.context?.createImageData(w,h);
    this.warp=new Int32Array(w*h).fill(-1);this.shade=new Float32Array(w*h);this.pixels=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const qx=(x+.5)/w*2-1,qy=(y+.5)/h*2-1,r=qx*qx+qy*qy,sx=(qx*(1+.28*r)*.5+.5)*w,sy=(qy*(1+.28*r)*.5+.5)*h,i=y*w+x;if(sx>=0&&sx<w&&sy>=0&&sy<h)this.warp[i]=(Math.floor(sy)*w+Math.floor(sx))*4;this.shade[i]=(1-.36*r)*(.95+.05*Math.sin((y+.5)*Math.PI));this.pixels[i*4+3]=255}
    this.canvas.style.imageRendering='pixelated';
  }
  clear(){this.source=null;if(this.context){this.context.fillStyle='#000';this.context.fillRect(0,0,this.canvas.width,this.canvas.height)}}
  dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.animation);this.source=null;this.sampleCanvas.width=this.sampleCanvas.height=1;this.output=this.pixels=this.warp=this.shade=null}
}
