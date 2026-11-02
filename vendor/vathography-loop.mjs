// Deterministic depth-sweep animation. Frame zero and frame N are identical,
// including the first derivative. Export samples 0..N-1, never duplicates N.
export const VATHO_LOOP_FPS=20;
export const VATHO_LOOP_SECONDS=3;
export const VATHO_LOOP_FRAMES=VATHO_LOOP_FPS*VATHO_LOOP_SECONDS;
export const VATHO_GIF_MAX_EDGE=512;
const TAU=2*Math.PI;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export function loopPhase(time,durationMs=VATHO_LOOP_SECONDS*1000){
  if(!Number.isFinite(time)||!Number.isFinite(durationMs)||durationMs<=0)throw new RangeError('Ugyldig animasjonstid.');
  return ((time%durationMs)+durationMs)%durationMs/durationMs;
}
export function loopFramePhase(index,total=VATHO_LOOP_FRAMES){
  if(!Number.isInteger(index)||!Number.isInteger(total)||total<2||index<0||index>=total)throw new RangeError('Ugyldig GIF-ramme.');
  return index/total;
}
export function depthSweepIntensity(value,phase){
  if(!Number.isFinite(value))return {light:0,shadow:0};
  const p=((phase%1)+1)%1,cycle=(1-Math.cos(TAU*p))/2,fade=Math.sin(Math.PI*p)**2;
  const centre=-.12+1.24*cycle,band=clamp(1-Math.abs(value-centre)/.19,0,1);
  return {light:fade*.78*band*band,shadow:fade*.08*(1-band)};
}

export function sampleLoopDepth(values,srcWidth,srcHeight,width,height,{validity=null,crop=null}={}){
  if(!Number.isInteger(srcWidth)||!Number.isInteger(srcHeight)||srcWidth<1||srcHeight<1||
     !Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
     values?.length!==srcWidth*srcHeight||validity&&validity.length!==values.length)throw new RangeError('Ugyldig djupnedata.');
  const x0=clamp(crop?.x??0,0,1),y0=clamp(crop?.y??0,0,1);
  const x1=clamp(x0+(crop?.width??1),x0,1),y1=clamp(y0+(crop?.height??1),y0,1);
  const field=new Float32Array(width*height);
  for(let y=0;y<height;y++){
    const sy=Math.min(srcHeight-1,Math.floor((y0+(y+.5)/height*(y1-y0))*srcHeight));
    for(let x=0;x<width;x++){
      const sx=Math.min(srcWidth-1,Math.floor((x0+(x+.5)/width*(x1-x0))*srcWidth));
      const sourceIndex=sy*srcWidth+sx,depth=values[sourceIndex];
      field[y*width+x]=validity&&validity[sourceIndex]!==1?NaN:depth;
    }
  }
  return field;
}

export function renderLoopFrame(base,field,phase,out=new Uint8ClampedArray(base?.length||0)){
  if(!base||base.length%4||!field||field.length*4!==base.length||out.length!==base.length)throw new RangeError('Ugyldig animasjonsramme.');
  if(!Number.isFinite(phase))throw new RangeError('Ugyldig animasjonsfase.');
  for(let i=0;i<field.length;i++){
    const {light,shadow}=depthSweepIntensity(field[i],phase),j=i*4,fade=1-shadow;
    for(let c=0;c<3;c++){const color=base[j+c];out[j+c]=Math.round(color*fade+(255-color)*light)}
    out[j+3]=base[j+3];
  }
  return out;
}
