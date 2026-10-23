import {photoSnapshot} from './photo.mjs';
import {resolveColorScheme} from './color-schemes.mjs';
import {renderRetroPixels,toneContrast} from './retro-modes.mjs';

export function processPhoto(source,width,height,style,grain,contrast,schemeId='original'){
  grain=Number.isFinite(grain)?Math.max(1,Math.round(grain)):1;
  contrast=Math.max(.5,Math.min(3,contrast));
  const scheme=resolveColorScheme(schemeId);
  if(scheme.mode)return renderRetroPixels(source,width,height,schemeId,contrast,grain);
  const cols=Math.ceil(width/grain),rows=Math.ceil(height/grain),values=new Float32Array(cols*rows);
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    let sum=0,count=0;
    for(let py=y*grain;py<Math.min(height,(y+1)*grain);py++)for(let px=x*grain;px<Math.min(width,(x+1)*grain);px++){const at=(py*width+px)*4;sum+=source[at]*.2126+source[at+1]*.7152+source[at+2]*.0722;count++}
    values[y*cols+x]=toneContrast(sum/count,contrast);
  }
  const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const index=y*cols+x,old=values[index];
    if(scheme.tones===4){values[index]=Math.max(0,Math.min(3,Math.floor(old/256*4+(bayer[(y%4)*4+x%4]+.5)/16-.5)));continue}
    const value=old>=(style===1?(bayer[(y%4)*4+x%4]+.5)*255/16:128)?255:0;
    values[index]=value;
    if(style<=1)continue;
    const error=(old-value)/(style===2?16:8);
    if(x+1<cols)values[index+1]+=error*(style===2?7:1);
    if(style===3&&x+2<cols)values[index+2]+=error;
    if(y+1<rows){
      if(x)values[index+cols-1]+=error*(style===2?3:1);
      values[index+cols]+=error*(style===2?5:1);
      if(x+1<cols)values[index+cols+1]+=error;
    }
    if(style===3&&y+2<rows)values[index+cols*2]+=error;
  }
  const data=new Uint8ClampedArray(source.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=(y*width+x)*4,value=values[Math.floor(y/grain)*cols+Math.floor(x/grain)];
    if(scheme.tones===4){const color=scheme.colors[value];data[index]=color[0];data[index+1]=color[1];data[index+2]=color[2]}
    else data[index]=data[index+1]=data[index+2]=value;
    data[index+3]=source[index+3];
  }
  return data;
}

export function createPhotoView(image){
  const canvas=image.ownerDocument.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true}),opacity=image.style.opacity;
  if(!context)throw new Error('Kunne ikkje vise fotoet.');
  canvas.setAttribute('aria-hidden','true');canvas.hidden=true;
  canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform-origin:center;pointer-events:none;image-rendering:pixelated';
  image.after(canvas);
  let source=null,style=0,grain=1,contrast=1,palette='original',frame=0,dirty=false,disposed=false,renderedGrain=0,lastFit=1;
  const finite=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
  function sourceGrain(){
    let rect=image.getBoundingClientRect?.();
    if(!rect?.width||!rect?.height)rect=image.parentElement?.getBoundingClientRect?.();
    if(rect?.width>0&&rect?.height>0&&canvas.width&&canvas.height)lastFit=Math.min(rect.width/canvas.width,rect.height/canvas.height);
    return Math.max(1,Math.round(grain/lastFit));
  }
  function render(){
    if(frame){cancelAnimationFrame(frame);frame=0}
    if(disposed||!source)return;
    const step=sourceGrain();
    if(!dirty&&step===renderedGrain)return;
    const pixels=context.createImageData(canvas.width,canvas.height);
    pixels.data.set(processPhoto(source,canvas.width,canvas.height,style,step,contrast,palette));context.putImageData(pixels,0,0);dirty=false;renderedGrain=step;
  }
  function schedule(){if(!disposed&&source){dirty=true;if(!frame)frame=requestAnimationFrame(render)}}
  function refresh(){if(!disposed){canvas.style.transform=image.style.transform;if(source&&sourceGrain()!==renderedGrain)schedule()}}
  function show(visible){if(disposed)return;const active=Boolean(visible&&source);if(active)render();canvas.hidden=!active;image.style.opacity=active?'0':opacity;refresh()}
  function setSource(decoded=image){
    if(disposed)return;
    const width=decoded.naturalWidth||decoded.width,height=decoded.naturalHeight||decoded.height;
    if(!width||!height)throw new Error('Fotoet er ikkje klart.');
    const scale=Math.min(1,2048/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));lastFit=1;renderedGrain=0;
    context.drawImage(decoded,0,0,canvas.width,canvas.height);source=context.getImageData(0,0,canvas.width,canvas.height).data;
    dirty=true;render();refresh();
  }
  function setStyle(value){const next=Math.round(finite(value,0,3,0));if(style!==next){style=next;schedule()}}
  function setPalette(value){const next=resolveColorScheme(value).id;if(palette!==next){palette=next;schedule()}}
  function setTone(tone={}){const nextGrain=finite(tone.grain??grain,1,8,grain),nextContrast=finite(tone.contrast??contrast,.5,3,contrast);if(grain!==nextGrain||contrast!==nextContrast){grain=nextGrain;contrast=nextContrast;schedule()}}
  function snapshot(pose,native=false){if(disposed||!source)throw new Error('Fotoet er ikkje klart.');render();return photoSnapshot(canvas,pose,native,true)}
  function dispose(){if(disposed)return;disposed=true;if(frame)cancelAnimationFrame(frame);source=null;image.style.opacity=opacity;canvas.remove()}
  return {setSource,setStyle,setPalette,setTone,show,refresh,snapshot,dispose};
}
