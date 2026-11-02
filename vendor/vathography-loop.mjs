export const VATHO_LOOP_FPS=20;
export const VATHO_LOOP_SECONDS=3;
export const VATHO_LOOP_FRAMES=VATHO_LOOP_FPS*VATHO_LOOP_SECONDS;
export const VATHO_GIF_MAX_EDGE=512;

export const VATHO_LOOP_MODES = Object.freeze([
  {id:'sweep',label:'Sveip'},
  {id:'near',label:'Nær'},
  {id:'far',label:'Fjern'},
  {id:'double',label:'Dobbelsveip'},
  {id:'breath',label:'Pust'},
  {id:'orbit',label:'Krins'},
  {id:'weave',label:'Åttetal'},
  {id:'pulse',label:'Hjarteslag'}
].map(Object.freeze));

export function loopPhase(time,durationMs=VATHO_LOOP_SECONDS*1000){
  if(!Number.isFinite(time)||!Number.isFinite(durationMs)||durationMs<=0)throw new RangeError('Ugyldig animasjonstid.');
  return ((time%durationMs)+durationMs)%durationMs/durationMs;
}
export function loopFramePhase(index,total=VATHO_LOOP_FRAMES){
  if(!Number.isInteger(index)||!Number.isInteger(total)||total<2||index<0||index>=total)throw new RangeError('Ugyldig GIF-ramme.');
  return index/total;
}

// Moving along a circle keeps the tone inside its manual limits, including when
// the drag ended at a boundary. No clipped plateaus or seam at the resting tone.
function offsetTone(base,travel,min,max){
  if(travel===0)return base;
  const mid=(max+min)/2,radius=(max-min)/2,x=(base-mid)/radius;
  const angle=travel*Math.PI/2;
  const value=x*Math.cos(angle)+Math.sqrt(Math.max(0,1-x*x))*Math.sin(angle);
  return Math.max(min,Math.min(max,mid+radius*value));
}
export function loopToneParameters(base,mode,phase){
  const angle=2*Math.PI*loopPhase(phase,1);
  const wave=Math.sin(angle),rise=(1-Math.cos(angle))/2;
  let shift=0,spread=0;
  switch(mode){
    case 'sweep': shift=.42*wave; break;
    case 'near': shift=-.58*rise; break;
    case 'far': shift=.58*rise; break;
    case 'double': shift=.35*Math.sin(2*angle); break;
    case 'breath': shift=.14*rise; spread=.45*wave; break;
    case 'orbit': shift=.42*wave; spread=.48*rise; break;
    case 'weave': shift=.36*wave; spread=.36*Math.sin(2*angle); break;
    case 'pulse': shift=-.50*rise**5; spread=-.38*rise**5; break;
    default: throw new RangeError('Ukjend løkkemodus.');
  }
  return {position:offsetTone(base.position,shift,-1,1),width:offsetTone(base.width,spread,.25,3)};
}
