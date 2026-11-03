/* ENTROPI / image operations. Pure, dependency-free: safe in a module worker or Node tests. */
export const PALETTES = Object.freeze({
  mono: ['#111312','#f0eee7'],
  ink: ['#070b10','#ffffff'],
  gray4: ['#121518','#60686e','#adb5b8','#f3f2e9'],
  gray8: ['#0d1013','#303638','#535a5d','#757d80','#969fa0','#b6bdbe','#d7dcda','#f9f9f4'],
  gameboy: ['#0f380f','#306230','#8bac0f','#9bbc0f'],
  lcd: ['#101c1a','#39514a','#93b4a3','#e9f2db'],
  sepia: ['#201e1b','#605343','#b39970','#f1e3bb'],
  blueprint: ['#102a46','#315a7e','#82b8d4','#e4f1ee'],
  cobalt: ['#080f24','#2c4d8f','#7bb5f7','#e9f5ff'],
  amber: ['#1a1008','#5a3417','#d18a30','#ffdfa2'],
  cga: ['#000000','#55ffff','#ff55ff','#ffffff'],
  thermal: ['#100b2d','#5857c4','#d78b6b','#fff1b8'],
  pico8: ['#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f','#c2c3c7','#fff1e8','#ff004d','#ffa300','#ffec27','#00e436','#29adff','#83769c','#ff77a8','#ffccaa'],
  rgb8: ['#000000','#0000ff','#00ff00','#00ffff','#ff0000','#ff00ff','#ffff00','#ffffff'],
  rgb27: Array.from({length:27},(_,i)=>`#${[Math.floor(i/9)%3,Math.floor(i/3)%3,i%3].map(n=>(n*127.5|0).toString(16).padStart(2,'0')).join('')}`),
  rgb64: Array.from({length:64},(_,i)=>`#${[Math.floor(i/16)%4,Math.floor(i/4)%4,i%4].map(n=>(n*85).toString(16).padStart(2,'0')).join('')}`)
});
export const METHODS = Object.freeze({
  none:'Ingen', posterize:'Rein kvantisering',
  bayer2:'Bayer 2×2',bayer4:'Bayer 4×4',bayer8:'Bayer 8×8',bayer16:'Bayer 16×16',
  noise:'Tilfeldig støy',ign:'Interleaved gradientstøy',
  halftone:'Halvtonar / prikkar',lines:'Rasterlinjer',crosshatch:'Krysskravur',
  floyd:'Floyd–Steinberg',atkinson:'Atkinson',jjn:'Jarvis–Judice–Ninke',stucki:'Stucki',burkes:'Burkes',sierra:'Sierra',sierra2:'Sierra 2-raders',sierraLite:'Sierra Lite'
});
export const PRESETS = Object.freeze({
  Newspaper: {method:'bayer4',palette:'ink',pixel:2,strength:100,threshold:0,diffusion:100,grain:6},
  Macintosh: {method:'atkinson',palette:'ink',pixel:2,strength:100,threshold:0,diffusion:100,grain:0},
  'Game Boy': {method:'floyd',palette:'gameboy',pixel:3,strength:100,threshold:0,diffusion:100,grain:0},
  Photocopy: {method:'halftone',palette:'mono',pixel:3,strength:100,threshold:16,diffusion:100,grain:12},
  Risograph: {method:'bayer8',palette:'thermal',pixel:2,strength:100,threshold:0,diffusion:100,grain:6},
  Blueprint: {method:'sierra',palette:'blueprint',pixel:2,strength:100,threshold:0,diffusion:100,grain:0},
  'CRT 1984': {method:'lines',palette:'cga',pixel:3,strength:95,threshold:0,diffusion:100,grain:4},
  '8-bit colour': {method:'burkes',palette:'rgb8',pixel:2,strength:100,threshold:0,diffusion:100,grain:0},
  'Fine grain': {method:'stucki',palette:'gray8',pixel:1,strength:90,threshold:0,diffusion:100,grain:8},
  'LCD terminal': {method:'bayer2',palette:'lcd',pixel:3,strength:100,threshold:0,diffusion:100,grain:0},
  'Pixel art': {method:'posterize',palette:'pico8',pixel:6,strength:100,threshold:0,diffusion:100,grain:0},
  'Soft halftone': {method:'halftone',palette:'sepia',pixel:4,strength:80,threshold:-8,diffusion:100,grain:4}
});
const clamp=(x,min=0,max=255)=>Math.min(max,Math.max(min,x));
const hash=(x,y,seed=1)=>{let z=Math.imul(x+Math.imul(y,1301081)+Math.imul(seed,137),0x45d9f3b);z^=z>>>16;z=Math.imul(z,0x45d9f3b);z^=z>>>16;return(z>>>0)/4294967296};
const luma=(r,g,b)=>r*.2126+g*.7152+b*.0722;
function parseHex(s){if(typeof s!=='string')return null;let m=s.trim().match(/^#?([a-f0-9]{3}|[a-f0-9]{6})$/i);if(!m)return null;let h=m[1];if(h.length===3)h=[...h].map(v=>v+v).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}
export function paletteColors(key='mono',custom=''){
 const hex=key==='custom'?String(custom).split(/[\s,;]+/):PALETTES[key]||PALETTES.mono;
 const colors=hex.map(parseHex).filter(Boolean);
 return colors.length>=2?colors.slice(0,256):PALETTES.mono.map(parseHex);
}
function nearest(r,g,b,p){let best=p[0],distance=Infinity;for(const c of p){const dr=r-c[0],dg=g-c[1],db=b-c[2];const d=dr*dr*.26+dg*dg*.59+db*db*.15;if(d<distance){distance=d;best=c}}return best}
const KERNELS={
 floyd:{div:16,taps:[[1,0,7],[-1,1,3],[0,1,5],[1,1,1]]},
 atkinson:{div:8,taps:[[1,0,1],[2,0,1],[-1,1,1],[0,1,1],[1,1,1],[0,2,1]]},
 jjn:{div:48,taps:[[1,0,7],[2,0,5],[-2,1,3],[-1,1,5],[0,1,7],[1,1,5],[2,1,3],[-2,2,1],[-1,2,3],[0,2,5],[1,2,3],[2,2,1]]},
 stucki:{div:42,taps:[[1,0,8],[2,0,4],[-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2],[-2,2,1],[-1,2,2],[0,2,4],[1,2,2],[2,2,1]]},
 burkes:{div:32,taps:[[1,0,8],[2,0,4],[-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2]]},
 sierra:{div:32,taps:[[1,0,5],[2,0,3],[-2,1,2],[-1,1,4],[0,1,5],[1,1,4],[2,1,2],[-1,2,2],[0,2,3],[1,2,2]]},
 sierra2:{div:16,taps:[[1,0,4],[2,0,3],[-2,1,1],[-1,1,2],[0,1,3],[1,1,2],[2,1,1]]},
 sierraLite:{div:4,taps:[[1,0,2],[-1,1,1],[0,1,1]]}
};
function bayer(size){if(size===2)return [0,2,3,1];const half=size/2,old=bayer(half),out=new Array(size*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++)out[y*size+x]=4*old[(y%half)*half+(x%half)]+[0,2,3,1][(y>=half?2:0)+(x>=half?1:0)];return out}
const BAYER={bayer2:bayer(2),bayer4:bayer(4),bayer8:bayer(8),bayer16:bayer(16)};
function orderedOffset(method,x,y,seed){
 if(BAYER[method]){let n=+method.slice(5),v=BAYER[method][(y%n)*n+x%n];return (v+.5)/(n*n)-.5}
 if(method==='noise')return hash(x,y,seed)-.5;
 if(method==='ign')return (52.9829189*((0.06711056*x+0.00583715*y+seed*.103)%1)%1+.00001)-.5;
 if(method==='halftone'){let u=x*.70710678+y*.70710678,v=y*.70710678-x*.70710678;let cx=u-Math.round(u/6)*6,cy=v-Math.round(v/6)*6;return .5-(Math.hypot(cx,cy)/4.243)}
 if(method==='lines'){let a=.43;let t=x*Math.sin(a)+y*Math.cos(a);return .5-2*Math.abs((t/5)%1-.5)}
 if(method==='crosshatch'){let a=(x+y)/7,b=(x-y)/7;return .5-(Math.abs(((a%1)+1)%1-.5)+Math.abs(((b%1)+1)%1-.5))}
 return 0;
}
export const DEFAULT_GRADE=Object.freeze({exposure:0,contrast:0,saturation:0,temperature:0,tint:0,fade:0,highlights:0,shadows:0,grain:0,vignette:0,sharpen:0});
export const DEFAULT_DITHER=Object.freeze({enabled:true,method:'floyd',palette:'mono',custom:'#111111 #eeeeee',pixel:2,strength:100,threshold:0,diffusion:100,seed:1,serpentine:true,invert:false});
function gradeImage(src,w,h,g){const dst=new Uint8ClampedArray(src.length);const exposure=Math.pow(2,Number(g.exposure||0)),contrast=1+Number(g.contrast||0)/100,sat=1+Number(g.saturation||0)/100;
 const temp=Number(g.temperature||0)*.58,tint=Number(g.tint||0)*.42,fade=Number(g.fade||0)*.45,shadows=Number(g.shadows||0)*.65,high=Number(g.highlights||0)*.65,grain=Number(g.grain||0)*.85,vign=Number(g.vignette||0)/100;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=(y*w+x)*4;let r=src[p]*exposure,gg=src[p+1]*exposure,b=src[p+2]*exposure;
  r=(r-127.5)*contrast+127.5;gg=(gg-127.5)*contrast+127.5;b=(b-127.5)*contrast+127.5;
  const L=luma(r,gg,b);r=L+(r-L)*sat;gg=L+(gg-L)*sat;b=L+(b-L)*sat;
  const sh=Math.pow(1-clamp(L)/255,2)*shadows,hi=Math.pow(clamp(L)/255,2)*high;
  r+=sh+hi+temp+tint/2;gg+=sh+hi-tint;b+=sh+hi-temp+tint/2;
  if(fade){r=r*(1-fade/255)+fade;gg=gg*(1-fade/255)+fade;b=b*(1-fade/255)+fade}
  if(grain){const gn=(hash(x,y,13)-.5)*grain;r+=gn;gg+=gn;b+=gn}
  if(vign){const dx=(x/(w||1)-.5)*2,dy=(y/(h||1)-.5)*2;const shade=1-vign*.55*Math.pow(Math.min(1,Math.hypot(dx,dy)/1.42),1.6);r*=shade;gg*=shade;b*=shade}
  dst[p]=clamp(r);dst[p+1]=clamp(gg);dst[p+2]=clamp(b);dst[p+3]=src[p+3];
 }
 if(g.sharpen>0){const copy=dst.slice(),s=Number(g.sharpen)/125;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;dst[i]=clamp(copy[i]*(1+4*s)-(copy[i-4]+copy[i+4]+copy[i-w*4]+copy[i+w*4])*s)}}
 return dst;
}
/** Process a complete RGBA frame; no global state or canvas required. */
export function processPixels(input,width,height,opts={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>30e6||input.length!==width*height*4)throw Error('Ugyldige biletdimensjonar');
 const g={...DEFAULT_GRADE,...opts.grade},d={...DEFAULT_DITHER,...opts.dither};const graded=gradeImage(input,width,height,g);
 if(!d.enabled||d.method==='none'||Number(d.strength)<=0)return graded;
 const scale=Math.min(16,Math.max(1,Math.floor(Number(d.pixel)||1))),w=Math.ceil(width/scale),h=Math.ceil(height/scale),low=new Float32Array(w*h*3),alpha=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let n=0,r=0,gg=0,b=0,aa=0;for(let yy=y*scale;yy<Math.min(height,(y+1)*scale);yy++)for(let xx=x*scale;xx<Math.min(width,(x+1)*scale);xx++) {const i=(yy*width+xx)*4;r+=graded[i];gg+=graded[i+1];b+=graded[i+2];aa+=graded[i+3];n++}
  const k=(y*w+x)*3;low[k]=r/n;low[k+1]=gg/n;low[k+2]=b/n;alpha[y*w+x]=aa/n;
 }
 const palette=paletteColors(d.palette,d.custom),kernel=KERNELS[d.method],result=new Uint8ClampedArray(w*h*3),strength=clamp(Number(d.strength)||0,0,100)/100;
 const threshold=clamp(Number(d.threshold)||0,-100,100)*1.2,diffusion=clamp(Number(d.diffusion)||0,0,160)/100;
 for(let y=0;y<h;y++){
  const rev=!!d.serpentine&&kernel&&y%2===1;
  for(let step=0;step<w;step++){
   const x=rev?w-1-step:step,k=(y*w+x)*3;
   const offset=!kernel&&d.method!=='posterize'?orderedOffset(d.method,x,y,Number(d.seed)||1)*110:0;
   const r=clamp(low[k]+threshold+offset),gg=clamp(low[k+1]+threshold+offset),b=clamp(low[k+2]+threshold+offset);
   const closest=nearest(r,gg,b,palette);
   const col=d.invert?palette[palette.length-1-palette.indexOf(closest)]:closest;
   result[k]=col[0];result[k+1]=col[1];result[k+2]=col[2];
   if(kernel){for(const [dx,dy,weight] of kernel.taps){let xx=x+(rev?-dx:dx),yy=y+dy;if(xx<0||xx>=w||yy>=h)continue;let i=(yy*w+xx)*3;let factor=weight/kernel.div*diffusion;low[i]+=(low[k]-closest[0])*factor;low[i+1]+=(low[k+1]-closest[1])*factor;low[i+2]+=(low[k+2]-closest[2])*factor}}
  }
 }
 const output=new Uint8ClampedArray(graded.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=(y*width+x)*4,b=(Math.floor(y/scale)*w+Math.floor(x/scale))*3;output[a]=graded[a]*(1-strength)+result[b]*strength;output[a+1]=graded[a+1]*(1-strength)+result[b+1]*strength;output[a+2]=graded[a+2]*(1-strength)+result[b+2]*strength;output[a+3]=graded[a+3]}
 return output;
}
