function census(rgba,width,height){
  const count=width*height,gray=new Uint8Array(count),codes=new Uint32Array(count),textured=new Uint8Array(count);
  for(let i=0;i<count;i++)gray[i]=(77*rgba[i*4]+150*rgba[i*4+1]+29*rgba[i*4+2])>>8;
  for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
    const i=y*width+x,center=gray[i];let code=0,sum=0,squared=0,opaque=true;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const j=i+dy*width+dx,value=gray[j];sum+=value;squared+=value*value;
      if(rgba[j*4+3]<128)opaque=false;
      if(dx||dy)code=(code<<1)|(value<center?1:0);
    }
    codes[i]=code;textured[i]=opaque&&squared/25-(sum/25)**2>=36?1:0;
  }
  return {codes,textured};
}

function bitCount(value){
  value-=value>>>1&0x55555555;
  value=(value&0x33333333)+(value>>>2&0x33333333);
  return ((value+(value>>>4)&0x0f0f0f0f)*0x01010101)>>>24;
}

export function estimateStereoDepth(left,right,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<24||height<16||width>320||height>320||width*height>76800)throw new Error('Ugyldig stereooppløysing.');
  const count=width*height;
  if(!(left instanceof Uint8ClampedArray)||!(right instanceof Uint8ClampedArray)||left.length!==count*4||right.length!==count*4)throw new Error('Ugyldige stereobilete.');
  const a=census(left,width,height),b=census(right,width,height),limit=Math.min(64,Math.floor(width/3));
  const costs=[new Uint16Array(count).fill(65535),new Uint16Array(count).fill(65535)];
  const alternatives=[new Uint16Array(count).fill(65535),new Uint16Array(count).fill(65535)];
  const disparities=[new Uint8Array(count),new Uint8Array(count)],row=width+1,integral=new Uint32Array(row*(height+1));
  for(let d=1;d<=limit;d++){
    for(let y=0;y<height;y++){
      let total=0;const source=y*width,previous=y*row,next=previous+row;
      for(let x=0;x<width;x++){
        total+=x>=d?bitCount(a.codes[source+x]^b.codes[source+x-d]):24;
        integral[next+x+1]=integral[previous+x+1]+total;
      }
    }
    for(let y=4;y<height-4;y++)for(let x=d+4;x<width-4;x++){
      const i=y*width+x,j=i-d;
      if(!a.textured[i]||!b.textured[j])continue;
      const top=(y-2)*row,bottom=(y+3)*row;
      const cost=integral[bottom+x+3]-integral[bottom+x-2]-integral[top+x+3]+integral[top+x-2];
      for(let side=0;side<2;side++){
        const index=side?j:i,best=costs[side],second=alternatives[side];
        if(cost<best[index]){second[index]=best[index];best[index]=cost;disparities[side][index]=d}
        else if(cost<second[index])second[index]=cost;
      }
    }
  }
  const reliable=(side,i)=>costs[side][i]<=150&&alternatives[side][i]!==65535&&alternatives[side][i]-costs[side][i]>=Math.max(12,costs[side][i]*.15);
  const candidates=new Uint8Array(count),valid=new Uint8Array(count),depth=new Float32Array(count).fill(NaN);
  for(let y=4;y<height-4;y++)for(let x=5;x<width-4;x++){
    const i=y*width+x,d=disparities[0][i],j=i-d;
    if(d&&reliable(0,i)&&reliable(1,j)&&Math.abs(d-disparities[1][j])<=1)candidates[i]=1;
  }
  let matched=0,minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=4;y<height-4;y++)for(let x=5;x<width-4;x++){
    const i=y*width+x;if(!candidates[i])continue;
    const d=disparities[0][i];let neighbours=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const j=i+dy*width+dx;if(candidates[j]&&Math.abs(d-disparities[0][j])<=1)neighbours++;
    }
    if(neighbours>=3){depth[i]=d;valid[i]=1;matched++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
  }
  let textured=0;for(let i=0;i<count;i++)if(a.textured[i])textured++;
  const required=Math.max(64,count*.01,textured*.08);
  if(matched<required||maxX-minX<Math.max(12,width*.25)||maxY-minY<Math.max(8,height*.25))throw new Error('For få sikre samsvar. Hald kameraet i ro og bruk eit motiv med tydelege detaljar.');
  return {depth,width,height,valid,matchedFraction:matched/count};
}
