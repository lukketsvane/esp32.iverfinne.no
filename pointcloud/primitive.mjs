export const C64_PALETTE=[[0,0,0],[255,255,255],[150,40,46],[91,214,206],[159,45,173],[65,185,54],[39,36,196],[239,243,71],[159,72,21],[94,53,0],[218,95,102],[71,71,71],[120,120,120],[145,255,132],[104,100,255],[174,174,174]];
const EGA=[[0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[170,85,0],[170,170,170],[85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255]];
export const PRIMITIVE_MODES=[
  {label:'Dagens C64-fargar',width:0,height:0,pixelAspect:1,palette:[],dither:0},
  {label:'EGA: seksten fargar og grove pikslar',width:640,height:350,pixelAspect:1,palette:EGA,dither:48},
  {label:'CGA: fire fargar og rektangulære pikslar',width:320,height:200,pixelAspect:5/6,palette:[[0,0,0],[0,255,255],[255,0,255],[255,255,255]],dither:144},
  {label:'Grøn fosfor: to fargar og rutemønster',width:320,height:200,pixelAspect:5/6,palette:[[0,0,0],[0,255,102]],dither:255}
];
export const PRIMITIVE_BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export const normalizePrimitiveLevel=level=>Number.isFinite(level)?Math.max(0,Math.min(3,Math.round(level))):0;
export const qualityPointBudget=(level=2)=>[4500,10000,22000,42000][Number.isFinite(level)?normalizePrimitiveLevel(level):2];
const tones=C64_PALETTE.map(color=>({color,chroma:Math.max(...color)-Math.min(...color),u:color[0]-(color[1]+color[2])/2,v:(color[1]-color[2])*Math.sqrt(3)/2}));

export function nearestC64(red,green,blue){
  let selected=C64_PALETTE[0],best=Infinity;
  const chroma=Math.max(red,green,blue)-Math.min(red,green,blue),u=red-(green+blue)/2,v=(green-blue)*Math.sqrt(3)/2;
  for(const tone of tones){const color=tone.color,distance=(red-color[0])**2+(green-color[1])**2+(blue-color[2])**2+1.5*((u-tone.u)**2+(v-tone.v)**2)+(chroma-tone.chroma)**2;if(distance<best){best=distance;selected=color}}
  return selected;
}

export function primitiveDimensions(level,width,height){
  const dimension=value=>Number.isFinite(value)&&value>0?Math.max(1,Math.floor(value)):1;
  const w=dimension(width),h=dimension(height),selected=normalizePrimitiveLevel(level);
  if(!selected)return {width:w,height:h};
  const mode=PRIMITIVE_MODES[selected],sourceWidth=w/mode.pixelAspect,scale=Math.min(1,mode.width/sourceWidth,mode.height/h);
  return {width:Math.max(1,Math.floor(sourceWidth*scale)),height:Math.max(1,Math.floor(h*scale))};
}

