export const PHOTO_PRESETS=Object.freeze([
  {id:'A4',label:'A4',description:'Varm analog',defaultStrength:1},
  {id:'A5',label:'A5',description:'Kjøleg analog',defaultStrength:1},
  {id:'B1',label:'B1',description:'Mjukt svartkvitt',defaultStrength:1},
  {id:'B5',label:'B5',description:'Kontrastrikt svartkvitt',defaultStrength:1},
  {id:'C1',label:'C1',description:'Lyse fargar',defaultStrength:1},
  {id:'F2',label:'F2',description:'Matt blågrå',defaultStrength:1},
  {id:'G3',label:'G3',description:'Naturlege fargar',defaultStrength:1},
  {id:'HB2',label:'HB2',description:'Kjøleg filmkontrast',defaultStrength:1},
  {id:'M3',label:'M3',description:'Falma varme',defaultStrength:1},
  {id:'P5',label:'P5',description:'Blågrøn instantfilm',defaultStrength:1},
  {id:'X1',label:'X1',description:'Mørkt svartkvitt',defaultStrength:1},
].map(Object.freeze));

const recipes={
  A4:[1.05,.98,.035,.985,.8,[.026,.014,-.012],[.025,.008,-.017]],
  A5:[1.06,1.01,.025,.98,.82,[-.012,.006,.033],[-.015,.002,.018]],
  B1:[1.13,1.02,.018,.99,0,[0,0,0],[0,0,0]],
  B5:[1.42,1.08,0,1,0,[0,0,0],[0,0,0]],
  C1:[1.1,.93,.025,1,1.2,[-.028,.034,.025],[.035,-.012,.018]],
  F2:[.94,1.02,.09,.91,.65,[-.008,.01,.035],[-.018,-.003,.008]],
  G3:[1.1,.96,.015,.99,1.14,[-.009,.017,.01],[.014,.006,-.007]],
  HB2:[1.22,1.06,.018,.975,.84,[-.014,.008,.03],[.015,.005,-.01]],
  M3:[.9,.97,.07,.96,.72,[.038,.021,-.022],[-.018,.003,.026]],
  P5:[1.17,.96,.02,.96,1.08,[-.026,.032,.06],[-.025,.018,.018]],
  X1:[1.35,1.2,.035,.94,0,[0,0,0],[0,0,0]],
};
const clamp=value=>Math.max(0,Math.min(1,value));
const fullCrop=crop=>crop.x===0&&crop.y===0&&crop.width===1&&crop.height===1;
export const PHOTO_HSL_CHANNELS=Object.freeze(['red','orange','yellow','green','blue','purple']);
const colorControls=['saturation','highlights','shadows','temperature','tint'];
const hueCenters=[0,1/12,1/6,1/3,2/3,5/6,1];
const hslNeutral=hsl=>PHOTO_HSL_CHANNELS.every(key=>hsl[key].hue===0&&hsl[key].saturation===0&&hsl[key].lightness===0);
const colorNeutral=edits=>colorControls.every(key=>edits[key]===0)&&hslNeutral(edits.hsl);
const toneNeutral=edits=>edits.exposure===0&&edits.contrast===0&&edits.sharpen===0&&edits.denoise===0&&edits.grain.strength===0&&colorNeutral(edits)&&(!edits.preset||edits.strength===0);

export function normalizePhotoEdits(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Ugyldig fotoredigering.');
  const number=(source,key,fallback,low,high)=>{
    const result=source[key]===undefined?fallback:source[key];
    if(typeof result!=='number'||!Number.isFinite(result)||result<low||result>high)throw new RangeError('Ugyldig fotoredigering: '+key+'.');
    return result===0?0:result;
  };
  const preset=value.preset===undefined?null:value.preset;
  if(preset!==null&&(typeof preset!=='string'||!Object.hasOwn(recipes,preset)))throw new RangeError('Ukjend fotoprofil.');
  const source=value.crop===undefined?{}:value.crop;
  if(!source||typeof source!=='object'||Array.isArray(source))throw new TypeError('Ugyldig utsnitt.');
  const crop={x:number(source,'x',0,0,1),y:number(source,'y',0,0,1),width:number(source,'width',1,0,1),height:number(source,'height',1,0,1)};
  if(crop.width===0||crop.height===0||crop.x+crop.width>1||crop.y+crop.height>1)throw new RangeError('Ugyldig utsnitt.');
  const object=(source,label)=>{if(!source||typeof source!=='object'||Array.isArray(source))throw new TypeError('Ugyldig fotoredigering: '+label+'.');return source};
  const grainSource=object(value.grain===undefined?{}:value.grain,'grain'),hslSource=object(value.hsl===undefined?{}:value.hsl,'hsl');
  const grain={strength:number(grainSource,'strength',0,0,1),size:number(grainSource,'size',.5,0,1),color:number(grainSource,'color',0,0,1)};
  const hsl=Object.fromEntries(PHOTO_HSL_CHANNELS.map(key=>{const channel=object(hslSource[key]===undefined?{}:hslSource[key],key);return [key,{hue:number(channel,'hue',0,-1,1),saturation:number(channel,'saturation',0,-1,1),lightness:number(channel,'lightness',0,-1,1)}]}));
  return {exposure:number(value,'exposure',0,-3,3),contrast:number(value,'contrast',0,-1,1),sharpen:number(value,'sharpen',0,0,1),denoise:number(value,'denoise',0,0,1),...Object.fromEntries(colorControls.map(key=>[key,number(value,key,0,-1,1)])),grain,hsl,preset,strength:number(value,'strength',1,0,1),crop};
}

export function photoEditsNeutral(edits={}){
  const value=normalizePhotoEdits(edits);
  return toneNeutral(value)&&fullCrop(value.crop);
}

const sample=(lut,value)=>{
  const x=clamp(value)*4096,i=Math.floor(x);
  return lut[i]+(lut[Math.min(4096,i+1)]-lut[i])*(x-i);
};
const presetLuts=new Map();
const instantColors=[[0,0,3,0],[24,18,28,17],[32,24,34,25],[48,41,48,56],[80,75,79,101],[112,105,112,130],[144,135,146,155],[176,158,181,177],[208,188,214,197],[255,234,255,242]];
function instantTone(value,channel){
  const x=clamp(value)*255;let index=0;
  while(index<instantColors.length-2&&x>instantColors[index+1][0])index++;
  const slope=i=>{const a=instantColors[i],b=instantColors[i+1];return (b[channel+1]-a[channel+1])/(b[0]-a[0])};
  const tangent=i=>i===0?slope(0):i===instantColors.length-1?slope(i-1):2/(1/slope(i-1)+1/slope(i));
  const a=instantColors[index],b=instantColors[index+1],span=b[0]-a[0],t=(x-a[0])/span,t2=t*t,t3=t2*t;
  return clamp(((2*t3-3*t2+1)*a[channel+1]+(t3-2*t2+t)*span*tangent(index)+(-2*t3+3*t2)*b[channel+1]+(t3-t2)*span*tangent(index+1))/255);
}
function presetLut(id){
  if(presetLuts.has(id))return presetLuts.get(id);
  const [contrast,gamma,black,white,saturation,shadows,highlights]=recipes[id];
  const channels=Array.from({length:3},(_,channel)=>Float64Array.from({length:4097},(_,i)=>{
    const value=i/4096,tone=black+(white-black)*clamp(.5+(value-.5)*contrast)**gamma;
    if(id==='P5')return instantTone(tone,channel);
    return clamp(tone+shadows[channel]*(1-value)**2+highlights[channel]*value**2);
  }));
  const result={channels,saturation};presetLuts.set(id,result);return result;
}

function makeColorTransform(edits){
  const gains=[2**(.2*edits.temperature+.08*edits.tint),2**(-.16*edits.tint),2**(-.2*edits.temperature+.08*edits.tint)],bands=PHOTO_HSL_CHANNELS.map(key=>edits.hsl[key]),selective=!hslNeutral(edits.hsl);
  return rgb=>{
    let r=rgb[0]*gains[0],g=rgb[1]*gains[1],b=rgb[2]*gains[2];
    if(edits.highlights||edits.shadows){
      const luma=clamp(r*.2126+g*.7152+b*.0722),delta=.3*(edits.shadows*(1-luma)**3+edits.highlights*luma**3);
      r+=delta*(delta>=0?1-r:r);g+=delta*(delta>=0?1-g:g);b+=delta*(delta>=0?1-b:b);
    }
    const luma=r*.2126+g*.7152+b*.0722,saturation=1+edits.saturation;
    r=clamp(luma+(r-luma)*saturation);g=clamp(luma+(g-luma)*saturation);b=clamp(luma+(b-luma)*saturation);
    if(selective){
      const high=Math.max(r,g,b),low=Math.min(r,g,b),chroma=high-low;
      if(chroma>1e-8){
        let light=(high+low)/2,sat=chroma/(1-Math.abs(2*light-1)),hue=(high===r?(g-b)/chroma:high===g?(b-r)/chroma+2:(r-g)/chroma+4)/6;
        hue=(hue+1)%1;let band=0;while(band<5&&hue>=hueCenters[band+1])band++;
        let t=(hue-hueCenters[band])/(hueCenters[band+1]-hueCenters[band]);t=t*t*(3-2*t);
        const a=bands[band],z=bands[(band+1)%6],shift=a.lightness+(z.lightness-a.lightness)*t;
        hue=(hue+(a.hue+(z.hue-a.hue)*t)/12+1)%1;sat=clamp(sat*(1+a.saturation+(z.saturation-a.saturation)*t));
        light=clamp(light+.5*shift*(shift>=0?1-light:light));
        const c=(1-Math.abs(2*light-1))*sat,sector=hue*6,x=c*(1-Math.abs(sector%2-1)),m=light-c/2;
        if(sector<1){r=c;g=x;b=0}else if(sector<2){r=x;g=c;b=0}else if(sector<3){r=0;g=c;b=x}else if(sector<4){r=0;g=x;b=c}else if(sector<5){r=x;g=0;b=c}else{r=c;g=0;b=x}
        r+=m;g+=m;b+=m;
      }
    }
    rgb[0]=r;rgb[1]=g;rgb[2]=b;
  };
}
function grainHash(x,y,seed){
  let n=Math.imul(x^seed,374761393)^Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/2147483647.5-1;
}
function grainNoise(x,y,fx,fy,seed){
  const a=grainHash(x,y,seed),b=grainHash(x+1,y,seed),c=grainHash(x,y+1,seed),d=grainHash(x+1,y+1,seed);
  return (a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
}

export function applyPhotoEdits(rgba,width,height,edits={}, {bitDepth=8,referenceWidth=width,referenceHeight=height}={}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216||rgba?.length!==width*height*4)throw new RangeError('Ugyldig biletstorleik.');
  if(bitDepth!==8&&bitDepth!==16||bitDepth===16&&!(rgba instanceof Uint16Array)||bitDepth===8&&!(rgba instanceof Uint8Array||rgba instanceof Uint8ClampedArray))throw new TypeError('Ugyldig pikselformat.');
  if(!Number.isInteger(referenceWidth)||!Number.isInteger(referenceHeight)||referenceWidth<1||referenceHeight<1)throw new RangeError('Ugyldig kjeldestorleik.');
  const value=normalizePhotoEdits(edits),{crop}=value;
  if(toneNeutral(value)&&fullCrop(crop))return {data:rgba,width,height};
  const left=Math.min(width-1,Math.round(crop.x*width)),top=Math.min(height-1,Math.round(crop.y*height));
  const right=Math.min(width,Math.max(left+1,Math.round((crop.x+crop.width)*width))),bottom=Math.min(height,Math.max(top+1,Math.round((crop.y+crop.height)*height)));
  const outputWidth=right-left,outputHeight=bottom-top,data=bitDepth===16?new Uint16Array(outputWidth*outputHeight*4):new Uint8ClampedArray(outputWidth*outputHeight*4);
  if(toneNeutral(value)){
    for(let y=top;y<bottom;y++)data.set(rgba.subarray((y*width+left)*4,(y*width+right)*4),(y-top)*outputWidth*4);
    return {data,width:outputWidth,height:outputHeight};
  }
  const maximum=bitDepth===16?65535:255,inverse=1/maximum,gain=2**value.exposure,contrast=2**(2*value.contrast);
  const tone=value.exposure===0&&value.contrast===0?null:Float64Array.from({length:4097},(_,i)=>{
    const encoded=i/4096,linear=encoded<=.04045?encoded/12.92:((encoded+.055)/1.055)**2.4,exposed=linear*gain;
    const result=value.exposure===0?encoded:exposed<=.0031308?12.92*exposed:1.055*exposed**(1/2.4)-.055;
    return clamp(.5+(result-.5)*contrast);
  });
  const preset=value.preset&&value.strength>0?presetLut(value.preset):null,strength=value.strength;
  const adjustColor=colorNeutral(value)?null:makeColorTransform(value),rgb=new Float64Array(3),grain=value.grain,grainCell=.75+5.25*grain.size*grain.size,grainAmount=.12*grain.strength*Math.min(1,grainCell*Math.min(width/referenceWidth,height/referenceHeight));
  let grayLut=null;
  if(!value.denoise&&!value.sharpen&&grain.strength===0&&(bitDepth===8||outputWidth*outputHeight>65535)){
    grayLut=bitDepth===16?new Uint16Array((maximum+1)*3):new Uint8ClampedArray((maximum+1)*3);
    for(let i=0;i<=maximum;i++){
      const encoded=i*inverse,base=tone?sample(tone,encoded):encoded,luma=base*.2126+base*.7152+base*.0722;
      for(let channel=0;channel<3;channel++)rgb[channel]=preset?base+(sample(preset.channels[channel],luma+(base-luma)*preset.saturation)-base)*strength:base;
      if(adjustColor)adjustColor(rgb);
      for(let channel=0;channel<3;channel++)grayLut[i*3+channel]=Math.round(clamp(rgb[channel])*maximum);
    }
  }
  const spatial=Math.exp(-.5/(.7*Math.min(width/referenceWidth,height/referenceHeight))**2),range=1/(.012+.075*value.denoise)**2;
  const sourceIndex=(x,y)=>(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4;
  const rowLength=(outputWidth+2)*3;
  const readRow=(y,row)=>{
    for(let x=left-1;x<=right;x++){
      const at=sourceIndex(x,y),out=(x-left+1)*3,r=rgba[at]*inverse,g=rgba[at+1]*inverse,b=rgba[at+2]*inverse;
      let red=r,green=g,blue=b;
      if(value.denoise>0&&rgba[at+3]>0){
        let sum=0,rs=0,gs=0,bs=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const index=sourceIndex(x+dx,y+dy),alpha=rgba[index+3]*inverse;if(alpha===0)continue;
          const nr=rgba[index]*inverse,ng=rgba[index+1]*inverse,nb=rgba[index+2]*inverse,delta=Math.max(Math.abs(nr-r),Math.abs(ng-g),Math.abs(nb-b));
          const edge=1/(1+delta*delta*range),weight=alpha*(dx?spatial:1)*(dy?spatial:1)*edge*edge;
          sum+=weight;rs+=nr*weight;gs+=ng*weight;bs+=nb*weight;
        }
        if(sum>0){red+=(rs/sum-r)*value.denoise;green+=(gs/sum-g)*value.denoise;blue+=(bs/sum-b)*value.denoise}
      }
      row[out]=red;row[out+1]=green;row[out+2]=blue;
    }
  };
  let previous,current,next;
  if(value.sharpen>0){previous=new Float32Array(rowLength);current=new Float32Array(rowLength);next=new Float32Array(rowLength);readRow(top-1,previous);readRow(top,current);readRow(top+1,next)}
  else if(value.denoise>0)current=new Float32Array(rowLength);
  for(let y=top;y<bottom;y++){
    if(value.denoise>0&&value.sharpen===0)readRow(y,current);
    for(let x=left;x<right;x++){
      const at=(y*width+x)*4,out=((y-top)*outputWidth+x-left)*4,alpha=rgba[at+3];
      data[out+3]=alpha;
      if(alpha===0){data[out]=rgba[at];data[out+1]=rgba[at+1];data[out+2]=rgba[at+2];continue}
      if(grayLut&&rgba[at]===rgba[at+1]&&rgba[at]===rgba[at+2]){
        const index=rgba[at]*3;data[out]=grayLut[index];data[out+1]=grayLut[index+1];data[out+2]=grayLut[index+2];continue;
      }
      const index=(x-left+1)*3;
      let r=current?current[index]:rgba[at]*inverse,g=current?current[index+1]:rgba[at+1]*inverse,b=current?current[index+2]:rgba[at+2]*inverse;
      if(value.sharpen>0){
        let sum=0,rs=0,gs=0,bs=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const opacity=rgba[sourceIndex(x+dx,y+dy)+3]*inverse;if(opacity===0)continue;
          const row=dy<0?previous:dy>0?next:current,from=index+dx*3,weight=opacity*(dx?spatial:1)*(dy?spatial:1);
          sum+=weight;rs+=row[from]*weight;gs+=row[from+1]*weight;bs+=row[from+2]*weight;
        }
        if(sum>0){r=clamp(r+(r-rs/sum)*2*value.sharpen);g=clamp(g+(g-gs/sum)*2*value.sharpen);b=clamp(b+(b-bs/sum)*2*value.sharpen)}
      }
      if(tone){r=sample(tone,r);g=sample(tone,g);b=sample(tone,b)}
      if(preset){
        const luma=r*.2126+g*.7152+b*.0722;
        r+=(sample(preset.channels[0],luma+(r-luma)*preset.saturation)-r)*strength;
        g+=(sample(preset.channels[1],luma+(g-luma)*preset.saturation)-g)*strength;
        b+=(sample(preset.channels[2],luma+(b-luma)*preset.saturation)-b)*strength;
      }
      if(adjustColor){rgb[0]=r;rgb[1]=g;rgb[2]=b;adjustColor(rgb);r=rgb[0];g=rgb[1];b=rgb[2]}
      if(grain.strength>0){
        const sx=((x+.5)*referenceWidth/width-.5)/grainCell,sy=((y+.5)*referenceHeight/height-.5)/grainCell,ix=Math.floor(sx),iy=Math.floor(sy);
        let fx=sx-ix,fy=sy-iy;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);
        const mono=grainNoise(ix,iy,fx,fy,0x2f6e2b1),luma=clamp(r*.2126+g*.7152+b*.0722),amount=grainAmount*(.35+.65*Math.sqrt(4*luma*(1-luma))),color=grain.color;
        r+=amount*(color?mono*(1-color)+grainNoise(ix,iy,fx,fy,0x51ed270b)*color:mono);
        g+=amount*(color?mono*(1-color)+grainNoise(ix,iy,fx,fy,0x68bc21eb)*color:mono);
        b+=amount*(color?mono*(1-color)+grainNoise(ix,iy,fx,fy,0x02e5be93)*color:mono);
      }
      data[out]=Math.round(clamp(r)*maximum);data[out+1]=Math.round(clamp(g)*maximum);data[out+2]=Math.round(clamp(b)*maximum);
    }
    if(value.sharpen>0&&y+1<bottom){const row=previous;previous=current;current=next;next=row;readRow(y+2,next)}
  }
  return {data,width:outputWidth,height:outputHeight};
}
