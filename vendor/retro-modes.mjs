import { resolveColorScheme } from './color-schemes.mjs';

const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const clamp=value=>Math.max(0,Math.min(255,value));
const distance=(red,green,blue,color)=>.9*(red-color[0])**2+1.1*(green-color[1])**2+.85*(blue-color[2])**2;
const brightness=(r,g,b)=>.2126*r+.7152*g+.0722*b;

function sampleGrid(source,width,height,gridWidth,gridHeight,contrast){
  const rgb=new Uint8Array(gridWidth*gridHeight*3);
  for(let y=0;y<gridHeight;y++)for(let x=0;x<gridWidth;x++){
    let r=0,g=0,b=0;
    for(const dy of [.25,.75])for(const dx of [.25,.75]){
      const sx=Math.min(width-1,Math.floor((x+dx)*width/gridWidth));
      const sy=Math.min(height-1,Math.floor((y+dy)*height/gridHeight));
      const at=(sy*width+sx)*4;
      r+=source[at];g+=source[at+1];b+=source[at+2];
    }
    const i=(y*gridWidth+x)*3;
    rgb[i]=clamp((r*.25-127.5)*contrast+127.5);
    rgb[i+1]=clamp((g*.25-127.5)*contrast+127.5);
    rgb[i+2]=clamp((b*.25-127.5)*contrast+127.5);
  }
  return rgb;
}

function colorCellMode(rgb,width,height,palette,mode){
  const cellWidth=mode==='c64'?4:8,cellHeight=8,indices=new Uint8Array(width*height);
  for(let top=0;top<height;top+=cellHeight)for(let left=0;left<width;left+=cellWidth){
    const offsets=[];
    for(let y=top;y<Math.min(height,top+cellHeight);y++)for(let x=left;x<Math.min(width,left+cellWidth);x++)offsets.push(y*width+x);
    const errors=new Float32Array(offsets.length*palette.length);
    for(let k=0;k<offsets.length;k++){
      const at=offsets[k]*3;
      for(let c=0;c<palette.length;c++)errors[k*palette.length+c]=distance(rgb[at],rgb[at+1],rgb[at+2],palette[c]);
    }
    let selected;
    if(mode==='c64'){
      selected=[0];
      let present=new Float32Array(offsets.length);
      for(let k=0;k<offsets.length;k++)present[k]=errors[k*palette.length];
      for(let n=0;n<3;n++){
        let candidate=0,best=Infinity;
        for(let c=1;c<palette.length;c++){
          if(selected.includes(c))continue;
          let sum=0;
          for(let k=0;k<offsets.length;k++)sum+=Math.min(present[k],errors[k*palette.length+c]);
          if(sum<best){best=sum;candidate=c}
        }
        selected.push(candidate);
        for(let k=0;k<offsets.length;k++)present[k]=Math.min(present[k],errors[k*palette.length+candidate]);
      }
    }else{
      let best=Infinity;
      for(const allowed of [[0,1,2,3,4,5,6,7],[0,8,9,10,11,12,13,14]]){
        for(let a=0;a<allowed.length;a++)for(let b=a+1;b<allowed.length;b++){
          const c0=allowed[a],c1=allowed[b];let sum=0;
          for(let k=0;k<offsets.length;k++)sum+=Math.min(errors[k*palette.length+c0],errors[k*palette.length+c1]);
          if(sum<best){best=sum;selected=[c0,c1]}
        }
      }
    }
    for(let k=0;k<offsets.length;k++){
      let nearest=selected[0],best=Infinity;
      for(const c of selected){const error=errors[k*palette.length+c];if(error<best){best=error;nearest=c}}
      indices[offsets[k]]=nearest;
    }
  }
  return indices;
}

function appleHiResMode(rgb,width,height){
  const bits=new Uint8Array(width*height),indices=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*3,threshold=(bayer[(y&3)*4+(x&3)]+.5)*255/16;
    bits[y*width+x]=brightness(rgb[at],rgb[at+1],rgb[at+2])>=threshold?1:0;
  }
  const palette=[[0,0,0],[0,214,56],[184,45,255],[255,255,255],[255,137,40],[55,112,255]];
  for(let y=0;y<height;y++)for(let left=0;left<width;left+=7){
    const end=Math.min(width,left+7);
    let phase=0,best=Infinity;
    for(let candidate=0;candidate<2;candidate++){
      let cost=0;
      for(let x=left;x<end;x++){
        const i=y*width+x,at=i*3;
        const lit=bits[i],adjacent=(x>0&&bits[i-1])||(x+1<width&&bits[i+1]);
        const color=palette[!lit?0:adjacent?3:candidate?(x%2?4:5):(x%2?1:2)];
        cost+=distance(rgb[at],rgb[at+1],rgb[at+2],color);
      }
      if(cost<best){best=cost;phase=candidate}
    }
    for(let x=left;x<end;x++){
      const i=y*width+x,lit=bits[i],adjacent=(x>0&&bits[i-1])||(x+1<width&&bits[i+1]);
      indices[i]=!lit?0:adjacent?3:phase?(x%2?4:5):(x%2?1:2);
    }
  }
  return indices;
}

export function renderRetroPixels(source,width,height,schemeId,contrast=1){
  const scheme=resolveColorScheme(schemeId);
  if(!scheme.mode)throw new Error('Ukjend skjermmodus.');
  const heightLimit=scheme.mode==='c64'?200:192;
  const pixelAspect=scheme.mode==='c64'?2:1;
  const gridHeight=Math.max(1,Math.min(heightLimit,height));
  const gridWidth=Math.max(1,Math.min(scheme.mode==='c64'?160:scheme.mode==='appleii'?280:256,Math.round(gridHeight*width/height/pixelAspect)));
  const rgb=sampleGrid(source,width,height,gridWidth,gridHeight,Math.max(1,contrast));
  const indexes=scheme.mode==='appleii'?appleHiResMode(rgb,gridWidth,gridHeight):colorCellMode(rgb,gridWidth,gridHeight,scheme.colors,scheme.mode);
  const palette=scheme.mode==='appleii'?[[0,0,0],[0,214,56],[184,45,255],[255,255,255],[255,137,40],[55,112,255]]:scheme.colors;
  const output=new Uint8ClampedArray(source.length);
  for(let y=0;y<height;y++){
    const gy=Math.min(gridHeight-1,Math.floor((y+.5)*gridHeight/height));
    for(let x=0;x<width;x++){
      const gx=Math.min(gridWidth-1,Math.floor((x+.5)*gridWidth/width));
      const at=(y*width+x)*4,color=palette[indexes[gy*gridWidth+gx]];
      if(source[at+3]<128){output[at+3]=source[at+3];continue}
      const blackBorder=source[at]===0&&source[at+1]===0&&source[at+2]===0;
      output[at]=blackBorder?0:color[0];
      output[at+1]=blackBorder?0:color[1];
      output[at+2]=blackBorder?0:color[2];
      output[at+3]=source[at+3];
    }
  }
  return output;
}
