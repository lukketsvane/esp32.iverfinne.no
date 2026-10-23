export const DITHER_TYPES=Object.freeze([
  {id:'profile',label:'Skjermprofil'},
  {id:'threshold',label:'Terskel'},
  {id:'bayer',label:'Bayer'},
  {id:'floyd',label:'Floyd–Steinberg'},
  {id:'atkinson',label:'Atkinson'}
].map(value=>Object.freeze(value)));

export const DEFAULT_ADJUSTMENTS=Object.freeze({black:0,white:255,gamma:1,contrast:1,dither:'profile',strength:1});
const adjustmentClamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;

export function normalizeAdjustments(input={}){
  const value=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const black=Math.round(adjustmentClamp(value.black,0,254,0));
  return {
    black,white:Math.round(adjustmentClamp(value.white,black+1,255,255)),
    gamma:adjustmentClamp(value.gamma,.2,3,1),contrast:adjustmentClamp(value.contrast,.5,3,1),
    dither:DITHER_TYPES.some(type=>type.id===value.dither)?value.dither:'profile',
    strength:adjustmentClamp(value.strength,0,1,1)
  };
}

const adjustmentStorageKey='entropi-image-adjustments-v1';
export function readAdjustments(){
  try{return normalizeAdjustments(JSON.parse(globalThis.localStorage?.getItem(adjustmentStorageKey)??'null'))}catch{return normalizeAdjustments()}
}
export function saveAdjustments(value){
  const normalized=normalizeAdjustments(value);
  try{globalThis.localStorage?.setItem(adjustmentStorageKey,JSON.stringify(normalized))}catch{}
  return normalized;
}

/** Input levels, gamma, then the existing black/white-anchored contrast curve. */
export function applyLevels(value,settings=DEFAULT_ADJUSTMENTS){
  const controls=settings&&typeof settings==='object'?settings:DEFAULT_ADJUSTMENTS;
  const black=adjustmentClamp(controls.black,0,254,0),white=adjustmentClamp(controls.white,black+1,255,255);
  const gamma=adjustmentClamp(controls.gamma,.2,3,1),contrast=adjustmentClamp(controls.contrast,.5,3,1);
  let adjusted=adjustmentClamp(value,0,255,0);
  if(black!==0||white!==255)adjusted=Math.max(0,Math.min(255,(adjusted-black)*255/(white-black)));
  if(gamma!==1)adjusted=255*(adjusted/255)**(1/gamma);
  if(contrast===1)return adjusted;
  return contrast<1?(adjusted<127.5?127.5*(adjusted/127.5)**contrast:255-127.5*((255-adjusted)/127.5)**contrast):Math.max(0,Math.min(255,(adjusted-127.5)*contrast+127.5));
}
