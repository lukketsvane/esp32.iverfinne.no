import {processPhoto} from './photo-view.mjs';

function finderSourceSize(source){
  if(!source)return {width:0,height:0};
  const video=source instanceof HTMLVideoElement;
  return {width:video?source.videoWidth:source.naturalWidth||source.width,height:video?source.videoHeight:source.naturalHeight||source.height};
}

function finderProjection(width,height){
  const warp=new Int32Array(width*height).fill(-1),shade=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const qx=(x+.5)/width*2-1,qy=(y+.5)/height*2-1,r=qx*qx+qy*qy,sx=(qx*(1+.28*r)*.5+.5)*width,sy=(qy*(1+.28*r)*.5+.5)*height,i=y*width+x;
    if(sx>=0&&sx<width&&sy>=0&&sy<height)warp[i]=(Math.floor(sy)*width+Math.floor(sx))*4;
    shade[i]=(1-.36*r)*(.95+.05*Math.sin((y+.5)*Math.PI));
  }
  return {warp,shade};
}

function paintFinderFrame(source,context,pixels,width,height,projection,time,monochrome=false){
  const size=finderSourceSize(source),ratio=size.width/size.height/(2/3),cw=size.width*Math.min(1,1/ratio),ch=size.height*Math.min(1,ratio);
  context.drawImage(source,(size.width-cw)/2,(size.height-ch)/2,cw,ch,0,0,width,height);
  const input=context.getImageData(0,0,width,height).data;
  for(let i=0;i<projection.warp.length;i++){
    const at=projection.warp[i],out=i*4,noise=((i*13+Math.floor(time/55)*17)%19-9)*.35;
    for(let channel=0;channel<3;channel++)pixels[out+channel]=at<0?0:(input[at+channel]-18)*1.2*projection.shade[i]+noise;
    if(monochrome){const gray=Math.round(pixels[out]*.2126+pixels[out+1]*.7152+pixels[out+2]*.0722);pixels[out]=pixels[out+1]=pixels[out+2]=gray}
    pixels[out+3]=255;
  }
}

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
      paintFinderFrame(source,this.sampleContext,this.pixels,this.canvas.width,this.canvas.height,this.projection,time,true);this.time=time;
      this.output.data.set(processPhoto(this.pixels,this.canvas.width,this.canvas.height,this.style,this.grain,this.contrast));this.context.putImageData(this.output,0,0);
    }catch{}
  }
  fit(){
    const rect=this.canvas.getBoundingClientRect?.(),w=rect?.width>0?Math.max(1,Math.round(Math.min(rect.width,240))):240,h=Math.max(1,Math.round(w*1.5));if(this.canvas.width===w&&this.canvas.height===h)return;
    this.canvas.width=this.sampleCanvas.width=w;this.canvas.height=this.sampleCanvas.height=h;this.output=this.context?.createImageData(w,h);
    this.projection=finderProjection(w,h);this.pixels=new Uint8ClampedArray(w*h*4);
    this.canvas.style.imageRendering='pixelated';
  }
  capture(source=this.source){
    const size=finderSourceSize(source);
    if(this.disposed||!size.width||!size.height||source instanceof HTMLVideoElement&&source.readyState<2)throw new Error('Fotoet er ikkje klart.');
    const canvas=this.canvas.ownerDocument.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('Fotoet kunne ikkje takast.');
    canvas.height=Math.max(3,Math.floor(Math.min(2048,size.height,size.width*1.5)/3)*3);canvas.width=canvas.height*2/3;
    const pixels=context.createImageData(canvas.width,canvas.height);
    paintFinderFrame(source,context,pixels.data,canvas.width,canvas.height,finderProjection(canvas.width,canvas.height),this.time??0);
    context.putImageData(pixels,0,0);return canvas;
  }
  clear(){this.source=null;if(this.context){this.context.fillStyle='#000';this.context.fillRect(0,0,this.canvas.width,this.canvas.height)}}
  dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.animation);this.source=null;this.sampleCanvas.width=this.sampleCanvas.height=1;this.output=this.pixels=this.projection=null}
}
