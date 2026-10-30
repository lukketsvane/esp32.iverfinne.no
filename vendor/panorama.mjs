import {runStereoDepth} from './stereo-depth.mjs';

const identity=[1,0,0,0,1,0,0,0,1];
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const failure=message=>Object.assign(new Error(message),{code:'PANORAMA_OVERLAP'});
const yieldTask=async signal=>{signal?.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted()};
function imageSize(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<32||image.height<32||image.width>4096||image.height>4096||image.width*image.height>4194304||!(image.data instanceof Uint8ClampedArray)||image.data.length!==image.width*image.height*4)throw new Error('Ugyldig panoramabilete.');
}
export function panoramaPoint(matrix,x,y){
  const divisor=matrix[6]*x+matrix[7]*y+matrix[8];
  return [(matrix[0]*x+matrix[1]*y+matrix[2])/divisor,(matrix[3]*x+matrix[4]*y+matrix[5])/divisor];
}
function multiply(a,b){return Array.from({length:9},(_,i)=>a[Math.floor(i/3)*3]*b[i%3]+a[Math.floor(i/3)*3+1]*b[i%3+3]+a[Math.floor(i/3)*3+2]*b[i%3+6])}
function inverse(m){
  const [a,b,c,d,e,f,g,h,i]=m,result=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d],det=a*result[0]+b*result[3]+c*result[6];
  return !Number.isFinite(det)||Math.abs(det)<1e-10?null:result.map(value=>value/det);
}
const corners=(matrix,width,height)=>[[0,0],[width,0],[width,height],[0,height]].map(([x,y])=>panoramaPoint(matrix,x,y));
function area(points){let value=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];value+=a[0]*b[1]-b[0]*a[1]}return value/2}
function intersection(points,width,height){
  for(const [axis,limit,sign]of [[0,0,1],[0,width,-1],[1,0,1],[1,height,-1]]){
    const next=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],insideA=(a[axis]-limit)*sign>=0,insideB=(b[axis]-limit)*sign>=0;
      if(insideA)next.push(a);
      if(insideA!==insideB){const t=(limit-a[axis])/(b[axis]-a[axis]);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])}
    }
    points=next;if(!points.length)return 0;
  }
  return Math.abs(area(points));
}
function validWarp(matrix,width,height){
  const points=corners(matrix,width,height),size=area(points);
  if([[0,0],[width,0],[width,height],[0,height]].some(([x,y])=>matrix[6]*x+matrix[7]*y+matrix[8]<=0))return null;
  if(points.some(point=>point.some(value=>!Number.isFinite(value)))||size<width*height*.45||size>width*height*2.2)return null;
  for(let i=0;i<4;i++){
    const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
    if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<=0)return null;
    const original=i%2?height:width,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<original*.5||length>original*2)return null;
  }
  const overlap=intersection(points,width,height)/Math.min(size,width*height);
  return overlap>=.25?{overlap,points}:null;
}
function solve(matrix,values){
  const n=values.length,rows=matrix.map((row,i)=>[...row,values[i]]);
  for(let column=0;column<n;column++){
    let pivot=column;for(let row=column+1;row<n;row++)if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column]))pivot=row;
    if(Math.abs(rows[pivot][column])<1e-9)return null;
    [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
    const divisor=rows[column][column];for(let j=column;j<=n;j++)rows[column][j]/=divisor;
    for(let row=0;row<n;row++)if(row!==column){const factor=rows[row][column];for(let j=column;j<=n;j++)rows[row][j]-=factor*rows[column][j]}
  }
  return rows.map(row=>row[n]);
}
function fit(matches,scale){
  const matrix=Array.from({length:8},()=>new Float64Array(8)),values=new Float64Array(8);
  for(const {from,to}of matches){
    const [x,y]=from.map(value=>value/scale),[u,v]=to.map(value=>value/scale);
    for(const [row,result]of [[[x,y,1,0,0,0,-u*x,-u*y],u],[[0,0,0,x,y,1,-v*x,-v*y],v]])for(let i=0;i<8;i++){values[i]+=row[i]*result;for(let j=0;j<8;j++)matrix[i][j]+=row[i]*row[j]}
  }
  const result=solve(matrix,values);if(!result)return null;
  return [result[0],result[1],result[2]*scale,result[3],result[4],result[5]*scale,result[6]/scale,result[7]/scale,1];
}
async function features(image,signal){
  const {width,height,data}=image,count=width*height,gray=new Float32Array(count),scores=new Float32Array(count),gradientX=new Float32Array(count),gradientY=new Float32Array(count);
  for(let i=0;i<count;i++)gray[i]=(77*data[i*4]+150*data[i*4+1]+29*data[i*4+2])/256;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;gradientX[i]=(gray[i+1]-gray[i-1])/2;gradientY[i]=(gray[i+width]-gray[i-width])/2}
  for(let y=9;y<height-9;y++){
    for(let x=9;x<width-9;x++){
      let xx=0,yy=0,xy=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=(y+dy)*width+x+dx,gx=gradientX[i],gy=gradientY[i];xx+=gx*gx;yy+=gy*gy;xy+=gx*gy}
      scores[y*width+x]=(xx+yy-Math.hypot(xx-yy,2*xy))/18;
    }
    if(y%40===0)await yieldTask(signal);
  }
  const candidates=[];
  for(let y=9;y<height-9;y++)for(let x=9;x<width-9;x++){
    const score=scores[y*width+x];if(score<40)continue;let maximum=true;
    for(let dy=-2;dy<=2&&maximum;dy++)for(let dx=-2;dx<=2;dx++)if(scores[(y+dy)*width+x+dx]>score){maximum=false;break}
    if(maximum)candidates.push({x,y,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const chosen=[],tiles=new Map();
  for(const point of candidates){
    const tile=Math.floor(point.y/32)*Math.ceil(width/32)+Math.floor(point.x/32);
    if((tiles.get(tile)||0)>=5||chosen.some(other=>Math.hypot(point.x-other.x,point.y-other.y)<7))continue;
    const descriptor=new Float32Array(81);let mean=0,square=0,index=0,opaque=true;
    for(let dy=-8;dy<=8;dy+=2)for(let dx=-8;dx<=8;dx+=2){const i=(point.y+dy)*width+point.x+dx,value=gray[i];descriptor[index++]=value;mean+=value;square+=value*value;if(data[i*4+3]<128)opaque=false}
    mean/=81;const deviation=Math.sqrt(Math.max(0,square/81-mean*mean));if(!opaque||deviation<6)continue;
    for(let i=0;i<81;i++)descriptor[i]=(descriptor[i]-mean)/deviation;
    chosen.push({...point,descriptor});tiles.set(tile,(tiles.get(tile)||0)+1);if(chosen.length>=260)break;
  }
  return chosen;
}
async function matchFeatures(reference,candidate,signal){
  const rows=candidate.length,cols=reference.length,scores=new Float32Array(rows*cols),reverse=new Int16Array(cols).fill(-1),reverseScore=new Float32Array(cols).fill(-2);
  for(let i=0;i<rows;i++){
    for(let j=0;j<cols;j++){
      let score=0;for(let k=0;k<81;k++)score+=candidate[i].descriptor[k]*reference[j].descriptor[k];score/=81;scores[i*cols+j]=score;
      if(score>reverseScore[j]){reverseScore[j]=score;reverse[j]=i}
    }
    if(i%24===0)await yieldTask(signal);
  }
  const matches=[];
  for(let i=0;i<rows;i++){
    let best=-1,score=-2,rival=-2;
    for(let j=0;j<cols;j++){const value=scores[i*cols+j];if(value>score){rival=score;score=value;best=j}else if(value>rival)rival=value}
    if(best>=0&&score>=.72&&1-score<.8*(1-rival)&&reverse[best]===i)matches.push({from:[candidate[i].x,candidate[i].y],to:[reference[best].x,reference[best].y],score});
  }
  return matches;
}
function residual(matrix,back,match){
  const a=panoramaPoint(matrix,...match.from),b=panoramaPoint(back,...match.to);
  return Math.max(Math.hypot(a[0]-match.to[0],a[1]-match.to[1]),Math.hypot(b[0]-match.from[0],b[1]-match.from[1]));
}
export async function estimatePanoramaTransform(reference,candidate,{signal}={}){
  imageSize(reference);imageSize(candidate);signal?.throwIfAborted();
  if(reference.width!==candidate.width||reference.height!==candidate.height||reference.width>320||reference.height>320)throw new Error('Panoramasamsvar krev like bilete på høgst 320 pikslar.');
  const {width,height}=reference,a=await features(reference,signal),b=await features(candidate,signal);
  if(Math.min(a.length,b.length)<18)throw failure('For lite detaljar til panorama. Prøv eit tydelegare motiv.');
  const matches=await matchFeatures(a,b,signal);if(matches.length<18)throw failure('Bileta overlappar ikkje godt nok. Sveip saktare.');
  let seed=0x9e3779b9^matches.length,best=[],bestError=Infinity,bestMatrix=null;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296};
  for(let trial=0;trial<320;trial++){
    const sample=[];while(sample.length<4){const index=Math.floor(random()*matches.length);if(!sample.includes(index))sample.push(index)}
    const matrix=fit(sample.map(index=>matches[index]),Math.max(width,height)),back=matrix&&inverse(matrix);
    if(!back)continue;const inliers=[];let error=0;
    for(const match of matches){const value=residual(matrix,back,match);if(value<=2.5){inliers.push(match);error+=value}}
    if(inliers.length>best.length||inliers.length===best.length&&error<bestError){best=inliers;bestError=error;bestMatrix=matrix}
    if(trial%48===0)await yieldTask(signal);
  }
  if(best.length<18||best.length<matches.length*.45)throw failure('Motivet flyttar seg for mykje til eit sikkert panorama.');
  bestMatrix=fit(best,Math.max(width,height))||bestMatrix;const back=inverse(bestMatrix),inliers=matches.filter(match=>residual(bestMatrix,back,match)<=2.5);
  const xs=inliers.map(match=>match.to[0]),ys=inliers.map(match=>match.to[1]),tiles=new Set(inliers.map(match=>Math.floor(match.to[0]*4/width)+4*Math.floor(match.to[1]*3/height)));
  if(inliers.length<18||tiles.size<4||Math.max(...xs)-Math.min(...xs)<width*.2||Math.max(...ys)-Math.min(...ys)<height*.2)throw failure('Samsvara dekkjer for lite av motivet.');
  const error=inliers.map(match=>residual(bestMatrix,back,match)).sort((a,b)=>a-b)[Math.floor(inliers.length/2)],warp=validWarp(bestMatrix,width,height);
  if(!warp||error>1.5)throw failure('For stor rørsle eller perspektivendring. Sveip saktare.');
  return {matrix:bestMatrix,inliers:inliers.length,matches:matches.length,error,overlap:warp.overlap};
}
export async function planPanorama(images,{signal,onProgress=()=>{}}={}){
  if(!Array.isArray(images)||images.length<2||images.length>8)throw new Error('Panorama treng mellom to og åtte bilete.');
  images.forEach(imageSize);const {width,height}=images[0];
  if(images.some(image=>image.width!==width||image.height!==height))throw new Error('Panoramabileta må ha same format.');
  const transforms=images.map(()=>null),accepted=images.map(()=>false),registration=images.map(()=>null);let anchor=0;
  while(anchor<images.length&&(await features(images[anchor],signal)).length<18){registration[anchor]={reason:'For lite detaljar i dette biletet.'};anchor++}
  if(anchor>=images.length-1)throw failure('For lite detaljar til panorama. Prøv eit tydelegare motiv.');
  transforms[anchor]=identity.slice();accepted[anchor]=true;let previous=anchor;
  for(let i=anchor+1;i<images.length;i++){
    signal?.throwIfAborted();onProgress({phase:'panorama-matching',frame:i+1,total:images.length});
    try{
      const result=await estimatePanoramaTransform(images[previous],images[i],{signal}),center=panoramaPoint(result.matrix,width/2,height/2);
      if(Math.hypot(center[0]-width/2,center[1]-height/2)<Math.max(5,width*.035))throw failure('Biletet viser ikkje nok nytt motiv.');
      transforms[i]=multiply(transforms[previous],result.matrix);accepted[i]=true;registration[i]=result;previous=i;
    }catch(error){if(signal?.aborted||error.name==='AbortError'||error.code!=='PANORAMA_OVERLAP')throw error;registration[i]={reason:error.message}}
  }
  if(accepted.filter(Boolean).length<2)throw failure('Ingen overlappande panoramabilete. Hald inne og sveip sakte over eit motiv med detaljar.');
  return {transforms,accepted,registration,analysis:{width,height,referenceFrame:anchor}};
}
export function panoramaLayout(transforms,width,height,{scale=1,maxPixels=4194304,maxEdge=4096}={}){
  if(!Array.isArray(transforms)||!transforms.length||transforms.length>8||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!Number.isFinite(scale)||scale<=0||!Number.isFinite(maxPixels)||maxPixels<1||!Number.isFinite(maxEdge)||maxEdge<1)throw new Error('Ugyldig panoramastorleik.');
  const points=[];
  for(const matrix of transforms)if(matrix){
    if(!Array.isArray(matrix)||matrix.length!==9||matrix.some(value=>!Number.isFinite(value))||!inverse(matrix))throw new Error('Ugyldig panoramatransformasjon.');
    if([[0,0],[width,0],[width,height],[0,height]].some(([x,y])=>matrix[6]*x+matrix[7]*y+matrix[8]<=0))throw failure('Sveipet går utanfor panoramaflata. Prøv eit kortare sveip.');
    points.push(...corners(matrix,width,height));
  }
  if(!points.length||points.some(point=>point.some(value=>!Number.isFinite(value))))throw new Error('Ugyldig panoramaflate.');
  const minX=Math.floor(Math.min(...points.map(point=>point[0]))),minY=Math.floor(Math.min(...points.map(point=>point[1]))),spanX=Math.ceil(Math.max(...points.map(point=>point[0])))-minX,spanY=Math.ceil(Math.max(...points.map(point=>point[1])))-minY;
  if(spanX<=0||spanY<=0||spanX>width*8||spanY>height*8)throw failure('Panoramaet vart for skeivt. Prøv eit rolegare sveip.');
  const factor=Math.min(scale,maxEdge/spanX,maxEdge/spanY,Math.sqrt(maxPixels/(spanX*spanY)));
  return {width:Math.max(1,Math.floor(spanX*factor)),height:Math.max(1,Math.floor(spanY*factor)),scale:factor,origin:[minX,minY]};
}
function outputMatrix(matrix,layout){return multiply([layout.scale,0,-layout.origin[0]*layout.scale,0,layout.scale,-layout.origin[1]*layout.scale,0,0,1],matrix)}
function bounds(matrix,width,height,output){
  const points=corners(matrix,width,height);
  return [clamp(Math.floor(Math.min(...points.map(point=>point[0]))),0,output.width),clamp(Math.floor(Math.min(...points.map(point=>point[1]))),0,output.height),clamp(Math.ceil(Math.max(...points.map(point=>point[0]))),0,output.width),clamp(Math.ceil(Math.max(...points.map(point=>point[1]))),0,output.height)];
}
export async function blendPanoramaFrame(image,matrix,target,{signal}={}){
  imageSize(image);const {width,height,data}=image,back=inverse(matrix);
  if(!back||!(target.data instanceof Uint8ClampedArray)||target.data.length!==target.width*target.height*4||!(target.weights instanceof Uint16Array)||target.weights.length!==target.width*target.height)throw new Error('Ugyldig panoramaflate.');
  const [left,top,right,bottom]=bounds(matrix,width,height,target),feather=Math.max(1,Math.min(width,height)*.15);
  for(let y=top;y<bottom;y++){
    for(let x=left;x<right;x++){
      const divisor=back[6]*(x+.5)+back[7]*(y+.5)+back[8],px=(back[0]*(x+.5)+back[1]*(y+.5)+back[2])/divisor,py=(back[3]*(x+.5)+back[4]*(y+.5)+back[5])/divisor,sx=px-.5,sy=py-.5;
      if(sx<0||sy<0||sx>width-1||sy>height-1)continue;
      const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=sx-x0,fy=sy-y0,a=(y0*width+x0)*4,b=(y0*width+x1)*4,c=(y1*width+x0)*4,d=(y1*width+x1)*4,wa=(1-fx)*(1-fy),wb=fx*(1-fy),wc=(1-fx)*fy,wd=fx*fy;
      if(data[a+3]*wa+data[b+3]*wb+data[c+3]*wc+data[d+3]*wd<128)continue;
      const weight=Math.max(1,Math.round(256*Math.min(1,Math.min(px,py,width-px,height-py)/feather))),at=y*target.width+x,previous=target.weights[at],total=previous+weight;
      for(let channel=0;channel<3;channel++){const value=data[a+channel]*wa+data[b+channel]*wb+data[c+channel]*wc+data[d+channel]*wd;target.data[at*4+channel]=(target.data[at*4+channel]*previous+value*weight)/total}
      target.data[at*4+3]=255;target.weights[at]=total;
    }
    if((y-top)%12===0)await yieldTask(signal);
  }
}
export async function mosaicPanoramaDepth(predictions,transforms,analysis,{signal,maxEdge=1024}={}){
  if(predictions.length!==transforms.length||predictions.length>8)throw new Error('Ugyldige panoramadjupnedata.');
  const layout=panoramaLayout(transforms,analysis.width,analysis.height,{maxPixels:1048576,maxEdge}),count=layout.width*layout.height,depth=new Float32Array(count).fill(NaN),validity=new Uint8Array(count),owner=new Uint8Array(count).fill(255),bestWeight=new Uint16Array(count),coverage=[];
  for(let index=0;index<transforms.length;index++){
    if(!transforms[index])continue;
    const prediction=predictions[index];
    if(!prediction||prediction.quantity!=='disparity'||prediction.units!=='px'||!(prediction.depth instanceof Float32Array)||!(prediction.validity instanceof Uint8Array)||prediction.depth.length!==prediction.width*prediction.height||prediction.validity.length!==prediction.depth.length)throw new Error('Panoramaet manglar gyldig stereodjupn.');
    const matrix=multiply(outputMatrix(transforms[index],layout),[analysis.width/prediction.width,0,0,0,analysis.height/prediction.height,0,0,0,1]),back=inverse(matrix),[left,top,right,bottom]=bounds(matrix,prediction.width,prediction.height,layout);
    for(let y=top;y<bottom;y++){
      for(let x=left;x<right;x++){
        const [px,py]=panoramaPoint(back,x+.5,y+.5),sx=Math.floor(px),sy=Math.floor(py);
        if(sx<0||sy<0||sx>=prediction.width||sy>=prediction.height)continue;
        const at=y*layout.width+x,weight=Math.max(1,Math.round(65535*Math.min(px,py,prediction.width-px,prediction.height-py)/Math.max(prediction.width,prediction.height)));
        if(weight<=bestWeight[at])continue;
        bestWeight[at]=weight;owner[at]=index;const source=sy*prediction.width+sx,value=prediction.depth[source],valid=prediction.validity[source]===1&&Number.isFinite(value)&&value>0;
        validity[at]=valid?1:0;depth[at]=valid?value:NaN;
      }
      if((y-top)%24===0)await yieldTask(signal);
    }
  }
  let covered=0,matched=0;
  for(let index=0;index<predictions.length;index++)if(transforms[index]){
    let owned=0,valid=0;for(let i=0;i<count;i++)if(owner[i]===index){owned++;valid+=validity[i]}
    covered+=owned;matched+=valid;coverage.push({frame:index,ownedPixels:owned,validPixels:valid,fraction:owned?valid/owned:0});
  }
  return {depth,validity,width:layout.width,height:layout.height,layout,coverage,matchedFraction:covered?matched/covered:0,coveredFraction:covered/count};
}
export function applyPanoramaMask(result,panorama,{alpha}={}){
  const {width,height}=result??{},count=width*height,{analysis,output,transforms}=panorama??{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||count>16777216||!(result.depth instanceof Float32Array)||result.depth.length!==count||result.validity!=null&&(!(result.validity instanceof Uint8Array)||result.validity.length!==count)||!analysis||!output||!Array.isArray(transforms)||!transforms.length||transforms.length>8||![analysis.width,analysis.height,output.width,output.height,output.scale].every(value=>Number.isFinite(value)&&value>0)||!Array.isArray(output.origin)||output.origin.length!==2||!output.origin.every(Number.isFinite)||alpha!=null&&(!(alpha instanceof Uint8ClampedArray)||alpha.length!==count*4))throw new Error('Ugyldig panoramamaske.');
  const matrices=transforms.filter(Boolean).map(matrix=>{
    if(!Array.isArray(matrix)||matrix.length!==9||!matrix.every(Number.isFinite))throw new Error('Ugyldig panoramatransformasjon.');
    const back=inverse(matrix);if(!back)throw new Error('Ugyldig panoramatransformasjon.');return back;
  });
  let depth=result.depth;const validity=result.validity?result.validity.slice():Uint8Array.from(depth,value=>Number.isFinite(value)?1:0);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=y*width+x,gx=(x+.5)*output.width/width/output.scale+output.origin[0],gy=(y+.5)*output.height/height/output.scale+output.origin[1];
    let covered=false;
    if(!alpha||alpha[at*4+3]===255)for(const matrix of matrices){
      const divisor=matrix[6]*gx+matrix[7]*gy+matrix[8],px=(matrix[0]*gx+matrix[1]*gy+matrix[2])/divisor,py=(matrix[3]*gx+matrix[4]*gy+matrix[5])/divisor;
      if(px>=.5&&py>=.5&&px<=analysis.width-.5&&py<=analysis.height-.5){covered=true;break}
    }
    if(!covered){validity[at]=0;if(Number.isFinite(depth[at])){if(depth===result.depth)depth=depth.slice();depth[at]=NaN}}
  }
  return {...result,depth,validity};
}
async function decode(blob,{signal,maxEdge=320,width,height}={}){
  if(!(blob instanceof Blob)||!blob.size||blob.size>32*1024*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('Ugyldig panoramafoto.');
  signal?.throwIfAborted();const url=URL.createObjectURL(blob),image=new Image();let canvas;
  try{
    image.src=url;await image.decode();signal?.throwIfAborted();const sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight;
    if(!sourceWidth||!sourceHeight||sourceWidth*sourceHeight>16777216)throw new Error('Panoramafotoet er for stort.');
    const scale=Math.min(1,maxEdge/Math.max(sourceWidth,sourceHeight));
    canvas=document.createElement('canvas');canvas.width=width??Math.max(1,Math.round(sourceWidth*scale));canvas.height=height??Math.max(1,Math.round(sourceHeight*scale));
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Telefonen kunne ikkje lese panoramabileta.');
    context.drawImage(image,0,0,canvas.width,canvas.height);return {data:context.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height,sourceWidth,sourceHeight};
  }finally{URL.revokeObjectURL(url);image.removeAttribute('src');if(canvas)canvas.width=canvas.height=1}
}
export async function buildPanorama(frames,{signal,onProgress=()=>{}}={}){
  if(!Array.isArray(frames)||frames.length<2||frames.length>8||frames.some(frame=>!frame||!(frame.left instanceof Blob)))throw new Error('Panorama treng mellom to og åtte kamerafoto.');
  signal?.throwIfAborted();const images=[];
  for(let i=0;i<frames.length;i++){
    onProgress({phase:'panorama-reading',frame:i+1,total:frames.length});const image=await decode(frames[i].left,{signal});
    if(images.length&&(image.width!==images[0].width||image.height!==images[0].height))throw new Error('Kameraformatet endra seg under panoramaet.');
    images.push(image);
  }
  const plan=await planPanorama(images,{signal,onProgress}),layout=panoramaLayout(plan.transforms,plan.analysis.width,plan.analysis.height,{scale:images[0].sourceWidth/plan.analysis.width}),target={...layout,data:new Uint8ClampedArray(layout.width*layout.height*4),weights:new Uint16Array(layout.width*layout.height)};
  for(let i=0;i<frames.length;i++)if(plan.accepted[i]){
    onProgress({phase:'panorama-stitching',frame:i+1,total:frames.length});
    const image=await decode(frames[i].left,{signal,maxEdge:Math.min(2048,Math.max(layout.width,layout.height))}),matrix=multiply(outputMatrix(plan.transforms[i],layout),[plan.analysis.width/image.width,0,0,0,plan.analysis.height/image.height,0,0,0,1]);
    await blendPanoramaFrame(image,matrix,target,{signal});
  }
  signal?.throwIfAborted();const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;let left;
  try{const context=canvas.getContext('2d');context.putImageData(new ImageData(target.data,layout.width,layout.height),0,0);left=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!left)throw new Error('Panoramaet kunne ikkje lagrast.')}finally{canvas.width=canvas.height=1}
  target.data=null;target.weights=null;images.length=0;
  signal?.throwIfAborted();const panorama={version:1,frames:frames.map((frame,i)=>({...frame,accepted:plan.accepted[i]})),transforms:plan.transforms,analysis:plan.analysis,output:layout,registration:plan.registration,acceptedFrames:plan.accepted.filter(Boolean).length,metric:false,hardwareSynchronized:false,depthSource:'monocular',stereo:{accepted:false,reason:null}};
  const accepted=frames.map((frame,i)=>plan.accepted[i]?i:-1).filter(i=>i>=0),predictions=frames.map(()=>null);let result=null;
  if(accepted.some(i=>!(frames[i].right instanceof Blob)))panorama.stereo.reason='Eitt eller fleire panoramabilete manglar kamera 2.';
  else{
    try{
      for(const i of accepted){signal?.throwIfAborted();onProgress({phase:'panorama-stereo',frame:i+1,total:frames.length});predictions[i]=await runStereoDepth(frames[i].left,frames[i].right,{signal})}
      const mosaic=await mosaicPanoramaDepth(predictions,plan.transforms,plan.analysis,{signal});
      panorama.stereo.coverage=mosaic.coverage;panorama.stereo.matchedFraction=mosaic.matchedFraction;
      if(mosaic.matchedFraction<.08||mosaic.coverage.some(region=>region.ownedPixels<64||region.fraction<.05))throw new Error('For lite stereodekning i delar av panoramaet.');
      panorama.stereo.accepted=true;panorama.depthSource='stereo-disparity-mosaic';
      result={depth:mosaic.depth,validity:mosaic.validity,width:mosaic.width,height:mosaic.height,sourceWidth:layout.width,sourceHeight:layout.height,polarity:'near',normalized:false,source:'stereo-panorama',model:'Stereo census · panorama',quantity:'disparity',units:'px',metric:false,hardwareSynchronized:false,matchedFraction:mosaic.matchedFraction,provenance:{kind:'per-frame-disparity-mosaic',metric:false,hardwareSynchronized:false,rigIds:[...new Set(accepted.map(i=>predictions[i].rigId))],coverage:mosaic.coverage,transforms:plan.transforms,analysis:plan.analysis,output:mosaic.layout},images:new Map()};
    }catch(error){if(signal?.aborted||error.name==='AbortError')throw error;panorama.stereo.reason=error.message}
  }
  signal?.throwIfAborted();onProgress({phase:'panorama-ready',frames:panorama.acceptedFrames,stereo:!!result});return {left,result,panorama};
}
