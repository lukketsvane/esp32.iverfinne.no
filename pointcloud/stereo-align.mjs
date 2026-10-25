export function shiftStereoRows(rgba,width,height,offset){
  if(!(rgba instanceof Uint8ClampedArray)||rgba.length!==width*height*4||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Ugyldig stereobilete.');
  const pixels=new Uint8ClampedArray(rgba.length),shift=Math.max(-height,Math.min(height,Math.round(Number(offset)||0))),stride=width*4;
  for(let y=0;y<height;y++){
    const origin=y-shift;
    if(origin>=0&&origin<height)pixels.set(rgba.subarray(origin*stride,(origin+1)*stride),y*stride);
  }
  return pixels;
}

export function estimateStereoVerticalShift(left,right,width,height){
  if(!(left instanceof Uint8ClampedArray)||!(right instanceof Uint8ClampedArray)||left.length!==width*height*4||right.length!==left.length||width<64||height<48)return {offset:0,confidence:0,reliable:false};
  const rows=Math.min(60,height),cols=Math.min(80,width);
  function signature(pixels){
    const gray=new Float32Array(rows*cols),profile=new Float32Array(rows);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const source=(Math.floor((y+.5)*height/rows)*width+Math.floor((x+.5)*width/cols))*4;
      gray[y*cols+x]=(77*pixels[source]+150*pixels[source+1]+29*pixels[source+2])/256;
    }
    for(let y=1;y<rows-1;y++){
      let sum=0;
      for(let x=Math.ceil(cols*.1);x<Math.floor(cols*.9);x++)sum+=Math.abs(gray[(y+1)*cols+x]-gray[(y-1)*cols+x]);
      profile[y]=sum/Math.max(1,Math.floor(cols*.9)-Math.ceil(cols*.1));
    }
    return profile;
  }
  const a=signature(left),b=signature(right),limit=Math.min(Math.floor(rows*.43),27);
  const scores=[];
  for(let dy=-limit;dy<=limit;dy++){
    const from=Math.max(1,dy+1),to=Math.min(rows-1,rows-1+dy);
    if(to-from<rows*.45)continue;
    let u=0,v=0,uu=0,vv=0,uv=0,n=0;
    for(let y=from;y<to;y++){
      const x=a[y],z=b[y-dy];
      u+=x;v+=z;uu+=x*x;vv+=z*z;uv+=x*z;n++;
    }
    const variance=(n*uu-u*u)*(n*vv-v*v);
    const score=variance>1e-6?(n*uv-u*v)/Math.sqrt(variance):0;
    scores.push({dy,score});
  }
  scores.sort((x,y)=>y.score-x.score);
  const best=scores[0]??{dy:0,score:0};
  const rival=scores.find(s=>Math.abs(s.dy-best.dy)>3)?.score??0;
  const reliable=best.score>=.38&&best.score-rival>=.09;
  return {offset:Math.round(best.dy*height/rows),confidence:Math.max(0,Math.min(1,best.score)),reliable};
}
