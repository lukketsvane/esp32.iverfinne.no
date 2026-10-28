export const FIXED_STEREO_RIG=Object.freeze({
  id:'entropi-fixed-mount-20261028',quarterTurns:1,width:640,height:480,
  primary:'c0b62c0d5020',secondary:'c443180d5020',
  left:Object.freeze([-0.33311153511629726,0.8531260247052969,129.2297102910728,-2.497825406601401e-05,-9.677467908632407e-05,1.0]),right:Object.freeze([-0.41156521773387794,0.85165370740125,128.48048849954435,-0.0001485808470404498,-6.206023765117048e-05,1.0]),
  metric:false,hardwareSynchronized:false
});

function rigImage(image){
  const {width,height,data}=image??{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>320||height>240||
    !(data instanceof Uint8ClampedArray)||data.length!==width*height*4)throw new Error('Ugyldig stereobilete.');
  return image;
}

export function prepareFixedStereo(left,right,profile=FIXED_STEREO_RIG){
  rigImage(left);rigImage(right);
  if(left.width!==right.width||left.height!==right.height)throw new Error('Kameraa må bruke same fotooppløysing.');
  if(Math.abs(left.width/left.height-profile.width/profile.height)>.02)throw new Error('Kameraformatet passar ikkje den faste riggen.');
  const width=left.height,height=left.width,sx=profile.height/width,sy=profile.width/height;
  const rectify=(image,rows)=>{
    const [a,b,c,d,e,f]=rows,result=new Uint8ClampedArray(image.data.length);
    for(let x=0;x<width;x++)for(let y=0;y<height;y++){
      const px=(x+.5)*sx-.5,py=(y+.5)*sy-.5;
      const origin=(a*px+c-py*(d*px+f))/(py*e-b);
      const sample=(origin+.5)/sy-.5,x0=Math.floor(sample),fraction=sample-x0,x1=x0+(fraction>1e-8?1:0);
      if(!Number.isFinite(sample)||x0<0||x1>=image.width)continue;
      const first=((image.height-1-x)*image.width+x0)*4,second=((image.height-1-x)*image.width+x1)*4,to=(y*width+x)*4;
      if(image.data[first+3]<128||image.data[second+3]<128)continue;
      for(let channel=0;channel<4;channel++)result[to+channel]=image.data[first+channel]*(1-fraction)+image.data[second+channel]*fraction;
    }
    return result;
  };
  return {left:rectify(left,profile.left),right:rectify(right,profile.right),width,height,rigId:profile.id};
}

export function restoreFixedStereo(prediction,width,height,profile=FIXED_STEREO_RIG){
  const count=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>320||height>240||
    !prediction||prediction.width!==height||prediction.height!==width||
    !(prediction.depth instanceof Float32Array)||prediction.depth.length!==count||
    !(prediction.valid instanceof Uint8Array)||prediction.valid.length!==count)throw new Error('Stereoberekninga gav eit ugyldig resultat.');
  const depth=new Float32Array(count).fill(NaN),valid=new Uint8Array(count),[a,b,c,d,e,f]=profile.left;
  let matched=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const column=height-1-y,px=(column+.5)*profile.height/height-.5,py=(x+.5)*profile.width/width-.5;
    const row=Math.round((((a*px+b*py+c)/(d*px+e*py+f))+.5)*width/profile.width-.5);
    if(!Number.isFinite(row)||row<0||row>=width)continue;
    const destination=y*width+x,source=row*height+column,value=prediction.depth[source];
    if(prediction.valid[source]===1&&Number.isFinite(value)&&value>0){depth[destination]=value;valid[destination]=1;matched++}
  }
  return {depth,valid,width,height,matchedFraction:matched/count,rigId:profile.id};
}
