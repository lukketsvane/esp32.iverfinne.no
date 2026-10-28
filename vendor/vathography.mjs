export const VATHOGRAPHY_PRESETS = Object.freeze([
  Object.freeze({id:'band',label:'Lysband'}),
  Object.freeze({id:'mist',label:'Dis'}),
  Object.freeze({id:'abyss',label:'Djup'}),
  Object.freeze({id:'near',label:'Nærlys'}),
  Object.freeze({id:'planes',label:'To plan'}),
]);

const curves = [
  [[0,0],[.25,.005],[.42,.035],[.53,.17],[.66,.96],[.79,.17],[.9,.35],[1,.92]],
  [[0,0],[.2,.015],[.4,.07],[.55,.18],[.7,.48],[.85,.8],[1,.98]],
  [[0,0],[.2,.005],[.4,.06],[.52,.42],[.65,.96],[.78,.28],[.89,.1],[1,.025]],
  [[0,.98],[.2,.965],[.4,.91],[.55,.8],[.7,.5],[.85,.18],[1,0]],
  [[0,.025],[.15,.08],[.3,.98],[.43,.1],[.55,.025],[.68,.15],[.78,.98],[.9,.15],[1,.025]],
];
const clamp = (value,low,high) => Math.max(low,Math.min(high,value));

function dimensions(data,width,height,channels=1){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!Number.isSafeInteger(width*height*channels)||data?.length!==width*height*channels)throw new Error('Ugyldig djupnekart.');
}

export function normalizeDepth(depth,{polarity='near'}={}){
  if(!depth?.length||!Number.isSafeInteger(depth.length)||!['near','far'].includes(polarity))throw new Error('Ugyldig djupnekart.');
  let low=Infinity,high=-Infinity;
  for(const value of depth)if(Number.isFinite(value)){low=Math.min(low,value);high=Math.max(high,value)}
  if(low===Infinity)throw new Error('Djupnekartet manglar gyldige verdiar.');
  const output=new Float32Array(depth.length),span=high-low;
  if(!Number.isFinite(span)||span<=Number.EPSILON*Math.max(1,Math.abs(low),Math.abs(high))){output.fill(.5);return output}
  for(let i=0;i<depth.length;i++){
    const value=depth[i];
    output[i]=Number.isFinite(value)?polarity==='near'?1-(value-low)/span:(value-low)/span:.5;
  }
  return output;
}

function pchip(knots){
  const n=knots.length,h=[],delta=[],slopes=new Float64Array(n);
  for(let i=0;i<n-1;i++){h[i]=knots[i+1][0]-knots[i][0];delta[i]=(knots[i+1][1]-knots[i][1])/h[i]}
  for(let i=1;i<n-1;i++)if(delta[i-1]*delta[i]>0){const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];slopes[i]=(w1+w2)/(w1/delta[i-1]+w2/delta[i])}
  const endpoint=(a,b,u,v)=>{
    const slope=((2*a+b)*u-a*v)/(a+b);
    return Math.sign(slope)!==Math.sign(u)?0:Math.sign(u)!==Math.sign(v)&&Math.abs(slope)>3*Math.abs(u)?3*u:slope;
  };
  slopes[0]=endpoint(h[0],h[1],delta[0],delta[1]);
  slopes[n-1]=endpoint(h[n-2],h[n-3],delta[n-2],delta[n-3]);
  return value=>{
    const x=clamp(value,0,1);let i=0;
    while(i<n-2&&x>knots[i+1][0])i++;
    const t=(x-knots[i][0])/h[i],t2=t*t,t3=t2*t;
    return clamp((2*t3-3*t2+1)*knots[i][1]+(t3-2*t2+t)*h[i]*slopes[i]+(-2*t3+3*t2)*knots[i+1][1]+(t3-t2)*h[i]*slopes[i+1],0,1);
  };
}

const toneLuts=curves.map(knots=>{const evaluate=pchip(knots);return Float32Array.from({length:4097},(_,i)=>evaluate(i/4096)*255)});

export function toneDepth(depth,width,height,{preset=0,position=0,width:bandWidth=1,outputWidth=width,outputHeight=height}={}){
  dimensions(depth,width,height);
  if(!Number.isInteger(outputWidth)||!Number.isInteger(outputHeight)||outputWidth<1||outputHeight<1||outputWidth*outputHeight>16777216)throw new Error('Ugyldig biletstorleik.');
  const selected=typeof preset==='string'?VATHOGRAPHY_PRESETS.findIndex(item=>item.id===preset):preset;
  const lut=toneLuts[Number.isInteger(selected)&&selected>=0&&selected<toneLuts.length?selected:0];
  const shift=Number.isFinite(position)?clamp(position,-1,1):0,stretch=Number.isFinite(bandWidth)?clamp(bandWidth,.25,3):1;
  const output=new Uint8ClampedArray(outputWidth*outputHeight*4),sameSize=width===outputWidth&&height===outputHeight;
  const valueAt=index=>Number.isFinite(depth[index])?depth[index]:.5;
  for(let y=0;y<outputHeight;y++){
    const sy=clamp((y+.5)*height/outputHeight-.5,0,height-1),y0=Math.floor(sy),y1=Math.min(height-1,y0+1),dy=sy-y0;
    for(let x=0;x<outputWidth;x++){
      const i=y*outputWidth+x;
      let sample;
      if(sameSize)sample=valueAt(i);
      else{
        const sx=clamp((x+.5)*width/outputWidth-.5,0,width-1),x0=Math.floor(sx),x1=Math.min(width-1,x0+1),dx=sx-x0;
        const top=valueAt(y0*width+x0)*(1-dx)+valueAt(y0*width+x1)*dx,bottom=valueAt(y1*width+x0)*(1-dx)+valueAt(y1*width+x1)*dx;
        sample=top*(1-dy)+bottom*dy;
      }
      const index=clamp((sample-.5-shift)/stretch+.5,0,1)*4096,low=Math.floor(index),high=Math.min(4096,low+1);
      const value=Math.round(lut[low]+(lut[high]-lut[low])*(index-low)),at=i*4;
      output[at]=output[at+1]=output[at+2]=value;output[at+3]=255;
    }
  }
  return output;
}

const spectralColors=[[158,1,66],[213,62,79],[244,109,67],[253,174,97],[254,224,139],[255,255,191],[230,245,152],[171,221,164],[102,194,165],[50,136,189],[94,79,162]];
const spectralLut=Float32Array.from({length:512*3},(_,i)=>{
  const sample=Math.floor(i/3)/511*10,low=Math.floor(sample),high=Math.min(10,low+1),channel=i%3;
  return spectralColors[low][channel]+(spectralColors[high][channel]-spectralColors[low][channel])*(sample-low);
});
const spectralCache=new Int16Array(64*64*64).fill(-1);

export function decodeSpectral(rgba,width,height){
  dimensions(rgba,width,height,4);
  const output=new Float32Array(width*height);
  for(let i=0;i<output.length;i++){
    const at=i*4,r=rgba[at],g=rgba[at+1],b=rgba[at+2];
    if(!Number.isFinite(r)||!Number.isFinite(g)||!Number.isFinite(b)||r<0||r>255||g<0||g>255||b<0||b>255)throw new Error('Ugyldig Spectral-farge.');
    const key=(r>>2)*4096+(g>>2)*64+(b>>2);let selected=spectralCache[key];
    if(selected<0){
      const red=(r>>2)*4+1.5,green=(g>>2)*4+1.5,blue=(b>>2)*4+1.5;let best=Infinity;
      for(let n=0;n<512;n++){
        const base=n*3,dr=red-spectralLut[base],dg=green-spectralLut[base+1],db=blue-spectralLut[base+2],distance=dr*dr+dg*dg+db*db;
        if(distance<best){best=distance;selected=n}
      }
      spectralCache[key]=selected;
    }
    output[i]=selected/511;
  }
  return output;
}
