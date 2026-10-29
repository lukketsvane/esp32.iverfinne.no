import {normalizeDepth,toneDepth} from './vathography.mjs';
import {encodeGrayscale16Tiff} from './entropi-export.mjs';

const pixelLimit=16777216;
function checkSize(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>pixelLimit)throw new Error('Ugyldig biletstorleik.');
}

async function sourceImageSize(blob){
  const image=new Image(),url=URL.createObjectURL(blob);
  try{
    if(typeof image.decode==='function'){image.src=url;await image.decode()}
    else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Kan ikkje lese originalbiletet.'));image.src=url});
    return {width:image.naturalWidth,height:image.naturalHeight};
  }finally{URL.revokeObjectURL(url)}
}

// Render the document's current monochrome recipe at the decoded original size.
// The 16-bit values come from float depth + tone curves, never an 8-bit canvas.
export async function encodeRenderedTiff(document,{readSourceSize=sourceImageSize}={}){
  const result=document?.result,{depth,width,height}=result??{},source=document?.left;
  checkSize(width,height);
  if(!(depth instanceof Float32Array)||depth.length!==width*height)throw new Error('Ugyldig djupnekart.');
  if(!(source instanceof Blob)||!source.size||source.size>32*1024*1024||!['image/jpeg','image/png','image/webp'].includes(source.type))throw new Error('Ugyldig originalbilete.');
  const validity=result.validity??Uint8Array.from(depth,value=>Number.isFinite(value)?1:0);
  if(!(validity instanceof Uint8Array)||validity.length!==depth.length)throw new Error('Ugyldig gyldigheitsmaske.');
  let validCount=0;
  for(let i=0;i<depth.length;i++){
    if(validity[i]!==0&&validity[i]!==1||validity[i]&&!Number.isFinite(depth[i]))throw new Error('Ugyldig gyldigheitsmaske.');
    validCount+=validity[i];
  }
  if(!validCount)throw new Error('Djupnekartet manglar gyldige verdiar.');
  const {preset=1,position=0,width:bandWidth=1}=document.recipe??{};
  if(!Number.isInteger(preset)||preset<0||preset>4||!Number.isFinite(position)||Math.abs(position)>1||!Number.isFinite(bandWidth)||bandWidth<.25||bandWidth>3)throw new Error('Ugyldig framkalling.');
  const polarity=result.polarity??(result.quantity==='depth'?'far':'near');
  if(!['near','far'].includes(polarity))throw new Error('Ukjend djupneretning.');
  // Stored documents preserve the source image, not its decoded dimensions.
  // Do not substitute the smaller inference map or a thumbnail for this size.
  const {width:sourceWidth,height:sourceHeight}=await readSourceSize(source);
  checkSize(sourceWidth,sourceHeight);
  const recipe={preset,position,width:bandWidth};
  const normalized=result.normalized===true?depth:normalizeDepth(depth,{polarity,validity});
  const rgba=toneDepth(normalized,width,height,{...recipe,outputWidth:sourceWidth,outputHeight:sourceHeight,validity,bitDepth:16});
  return encodeGrayscale16Tiff(rgba,sourceWidth,sourceHeight,{
    format:'entropi-rendered-image',version:1,encoding:'uint16-display-tones',bitDepth:16,
    recipe,sourceWidth,sourceHeight,mapWidth:width,mapHeight:height,
    resampling:'bilinear-depth-before-tone',sourceValidSamples:validCount,
    validityPreserved:true,alpha:'unassociated',invalidSamples:'transparent',
    model:String(result.model??''),source:String(result.source??''),sensorRaw:false
  });
}
