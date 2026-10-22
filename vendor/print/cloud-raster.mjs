import { WIDTH, buildPrintJob } from './px10-protocol.mjs';
import { ditherRGBA } from './raster.mjs';

export function ditherCloudRGBA(rgba,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||rgba.length!==width*height*4)throw new Error('Biletdata manglar.');
  const paper=new Uint8ClampedArray(rgba.length);
  for(let i=0;i<rgba.length;i+=4){
    const ink=Math.min(255,Math.max(rgba[i],rgba[i+1],rgba[i+2])*1.7)*rgba[i+3]/255;
    paper[i]=paper[i+1]=paper[i+2]=255-ink;paper[i+3]=255;
  }
  return ditherRGBA(paper,width,height);
}

export function cloudPrintJob({data,width,height}){
  if(width!==WIDTH||!Number.isInteger(height)||height<1||height>1024||!(data instanceof Uint8Array||data instanceof Uint8ClampedArray)||data.length!==width*height*4)throw new Error('Ugyldige utskriftsdata.');
  let first=height,last=-1;
  for(let y=0;y<height;y++)for(let x=0;x<WIDTH;x++){
    const at=(y*WIDTH+x)*4;
    if(Math.max(data[at],data[at+1],data[at+2])>35){first=Math.min(first,y);last=y;break}
  }
  if(last<first)throw new Error('Punktskyen har ingen synlege punkt å skrive ut.');
  first=Math.max(0,first-8);last=Math.min(height-1,last+8);
  return buildPrintJob(ditherCloudRGBA(data.subarray(first*WIDTH*4,(last+1)*WIDTH*4),WIDTH,last-first+1));
}
