export const COLOR_SCHEMES = Object.freeze([
  {id:'macintosh',label:'Macintosh 128K · 1984 · svart-kvit CRT',colors:[[0,0,0],[0,0,0],[255,255,255],[255,255,255]],tones:2,style:3,primitive:0},
  {id:'ibm5151',label:'IBM 5151 · 1981 · grøn P39-fosfor',colors:[[0,0,0],[0,45,17],[37,140,65],[157,255,174]],tones:4,style:1,primitive:3},
  {id:'ibmcga',label:'IBM CGA · 1981 · cyan, magenta, kvit',colors:[[0,0,0],[0,255,255],[255,0,255],[255,255,255]],tones:4,style:1,primitive:2},
  {id:'gameboy',label:'Game Boy DMG-01 · 1989 · grøn LCD',colors:[[15,56,15],[48,98,48],[139,172,15],[155,188,15]],tones:4,style:1,primitive:2},
  {id:'bluecrt',label:'Blå CRT · P11-fosfor',colors:[[0,0,0],[8,25,92],[42,105,235],[172,215,255]],tones:4,style:1,primitive:2},
  {id:'amber',label:'Amber CRT P3',colors:[[0,0,0],[85,34,0],[205,110,13],[255,209,97]],tones:4,style:1,primitive:2},
  {id:'appleii',label:'Apple II phosphor',colors:[[0,0,0],[23,64,0],[88,183,0],[184,255,88]],tones:4,style:1,primitive:2},
  {id:'c64',label:'Commodore 64 palette',colors:[[0,0,0],[67,57,0],[112,105,191],[255,255,255]],tones:4,style:1,primitive:2},
  {id:'zx',label:'ZX Spectrum palette',colors:[[0,0,0],[0,0,215],[215,0,215],[255,255,255]],tones:4,style:1,primitive:2}
].map(scheme=>Object.freeze({...scheme,colors:Object.freeze(scheme.colors.map(color=>Object.freeze(color)))})));

export function resolveColorScheme(id){
  return COLOR_SCHEMES.find(scheme=>scheme.id===id)??COLOR_SCHEMES[0];
}

export function ditherInk(scheme,lit,brightness){
  if(!lit)return scheme.colors[0];
  return scheme.colors[brightness>=.84?3:brightness>=.34?2:1];
}

export function gaussianInk(scheme,depth,luminance,jitter=0){
  const tone=Math.max(0,Math.min(.999999,depth*.72+luminance*.28+jitter*.09));
  const index=Math.floor(tone*scheme.tones);
  return scheme.colors[scheme.tones===2?index?3:0:index];
}

const storageKey=kind=>'entropi-screen-'+(kind==='depth'?'depth':'photo')+'-v2';
export function readColorScheme(kind){
  try{
    const id=globalThis.localStorage?.getItem(storageKey(kind));
    if(id&&COLOR_SCHEMES.some(scheme=>scheme.id===id))return id;
  }catch{}
  return 'macintosh';
}
export function saveColorScheme(kind,id){
  try{globalThis.localStorage?.setItem(storageKey(kind),resolveColorScheme(id).id)}catch{}
}
