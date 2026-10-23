/** Shared display palettes for 2D dithering and depth-derived Gaussian splats.
 *  The source image and inferred depth are never changed. */
export const COLOR_SCHEMES = Object.freeze([
  {id:'original',label:'Original · svart-kvitt / C64',colors:[[0,0,0],[80,80,80],[176,176,176],[255,255,255]]},
  {id:'signal',label:'Signal · magenta og cyan',colors:[[0,0,0],[72,13,92],[236,42,223],[67,246,236]]},
  {id:'coral',label:'Korall · rosa og raud',colors:[[0,0,0],[90,22,43],[211,56,93],[255,112,91]]},
  {id:'ember',label:'Glød · rust og oransje',colors:[[0,0,0],[91,34,26],[222,82,45],[255,205,110]]},
  {id:'ultraviolet',label:'Ultrafiolett · fiolett og blå',colors:[[0,0,0],[42,25,102],[132,70,238],[88,215,248]]},
  {id:'chlorophyll',label:'Klorofyll · grøn og mint',colors:[[0,0,0],[18,62,41],[62,186,101],[185,255,181]]}
].map(scheme=>Object.freeze({...scheme,colors:Object.freeze(scheme.colors.map(color=>Object.freeze(color)))})));

export function resolveColorScheme(id){
  return COLOR_SCHEMES.find(scheme=>scheme.id===id)??COLOR_SCHEMES[0];
}

/** For a binary dither keep every on/off pixel, but split lit pixels into coloured inks. */
export function ditherInk(scheme,lit,brightness){
  if(!lit)return scheme.colors[0];
  return scheme.colors[brightness>=.84?3:brightness>=.34?2:1];
}

/** Tonal bands use relative camera depth, with source luminance providing local detail. */
export function gaussianInk(scheme,depth,luminance,jitter=0){
  const tone=Math.max(0,Math.min(.999999,depth*.72+luminance*.28+jitter*.09));
  return scheme.colors[Math.floor(tone*4)];
}

const storageKey=kind=>'entropi-color-'+(kind==='depth'?'depth':'photo')+'-v1';
export function readColorScheme(kind){
  try {
    const id=globalThis.localStorage?.getItem(storageKey(kind));
    if(id&&COLOR_SCHEMES.some(scheme=>scheme.id===id))return id;
  }catch{ /* Safari private mode or blocked storage. */ }
  return 'signal';
}
export function saveColorScheme(kind,id){
  try {globalThis.localStorage?.setItem(storageKey(kind),resolveColorScheme(id).id)}catch{}
}
const hex=channels=>'#'+channels.map(value=>value.toString(16).padStart(2,'0')).join('');

/** Compact accessible swatches shared by the hosted page and ESP32's local page. */
export function attachColorSchemeControls(roots,getKind,getSelection,onChoose,enabled=()=>true){
  const style=document.createElement('style');
  style.textContent=`.entropi-palette-rail{position:absolute;z-index:8;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:6px;max-width:calc(100% - 64px);pointer-events:auto;touch-action:manipulation}
.entropi-palette-choice{display:grid;place-items:center;width:38px;height:38px;flex:none;padding:0;border:0;border-radius:50%;background:transparent;color:#fff;opacity:.8;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.entropi-palette-choice span{display:block;width:19px;height:19px;border-radius:50%;box-shadow:0 0 0 1px #ffffff42;transition:box-shadow .15s,transform .15s}
.entropi-palette-choice[aria-pressed="true"]{opacity:1}.entropi-palette-choice[aria-pressed="true"] span{box-shadow:0 0 0 1px #000,0 0 0 2px #fff;transform:scale(1.07)}
.entropi-palette-choice:focus-visible{outline:1px solid white;outline-offset:1px}.entropi-palette-choice:active span{transform:scale(.9)}
@media(max-height:540px){.entropi-palette-rail{bottom:calc(62px + env(safe-area-inset-bottom,0px))}}
@media(prefers-reduced-motion:reduce){.entropi-palette-choice span{transition:none}}`;
  document.head.appendChild(style);
  const rails=[];
  for(const root of roots){
    const rail=document.createElement('div');rail.className='entropi-palette-rail';rail.setAttribute('role','group');
    const choices=[];
    for(const scheme of COLOR_SCHEMES){
      const button=document.createElement('button'),swatch=document.createElement('span');
      button.type='button';button.className='entropi-palette-choice';button.title=scheme.label;button.setAttribute('aria-label',scheme.label);
      swatch.setAttribute('aria-hidden','true');
      swatch.style.background='linear-gradient(135deg,'+hex(scheme.colors[1])+' 0 31%,'+hex(scheme.colors[2])+' 31% 65%,'+hex(scheme.colors[3])+' 65% 100%)';
      button.appendChild(swatch);rail.appendChild(button);choices.push({button,scheme});
      button.addEventListener('click',()=>{if(!enabled())return;const kind=getKind();onChoose(kind,scheme.id);refresh()});
    }
    root.appendChild(rail);rails.push({rail,choices});
  }
  function refresh(){
    const kind=getKind(),selected=getSelection(kind);
    for(const {rail,choices} of rails){
      rail.setAttribute('aria-label',kind==='depth'?'Fargar for Gaussian-3D':'Fargar for dithering');
      for(const {button,scheme} of choices)button.setAttribute('aria-pressed',String(scheme.id===selected));
    }
  }
  function dispose(){for(const {rail} of rails)rail.remove();style.remove()}
  refresh();return {refresh,dispose};
}
