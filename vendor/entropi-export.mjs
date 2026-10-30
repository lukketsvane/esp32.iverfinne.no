export function quantizeDepth(result,{min,max,invert=false}={}){
  const {depth,width,height,validity}=result??{};
  if(!(depth instanceof Float32Array)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216||depth.length!==width*height)throw new Error('Ugyldig djupnekart.');
  if(validity!=null&&(!(validity instanceof Uint8Array)||validity.length!==depth.length))throw new Error('Ugyldig gyldigheitsmaske.');
  if(typeof invert!=='boolean')throw new Error('Ugyldig verdiretning.');
  const polarity=result.polarity??(result.quantity==='depth'?'far':'near');
  if(!['near','far'].includes(polarity))throw new Error('Ukjend djupneretning.');
  let low=Infinity,high=-Infinity,invalidCount=0;
  for(let i=0;i<depth.length;i++){
    if(validity&&(validity[i]!==0&&validity[i]!==1||validity[i]&&!Number.isFinite(depth[i])))throw new Error('Ugyldig gyldigheitsmaske.');
    if(Number.isFinite(depth[i])&&(!validity||validity[i])){low=Math.min(low,depth[i]);high=Math.max(high,depth[i])}
    else invalidCount++;
  }
  if(low===Infinity)throw new Error('Djupnekartet manglar gyldige verdiar.');
  min??=low;max??=high;
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<min)throw new Error('Ugyldig verdiområde.');
  const pixels=new Uint16Array(depth.length),span=max-min;let clippedCount=0;
  for(let i=0;i<depth.length;i++){
    if(!Number.isFinite(depth[i])||validity&&!validity[i])continue;
    const value=depth[i];if(value<min||value>max)clippedCount++;
    const sample=span?Math.max(0,Math.min(1,(value-min)/span)):.5;
    pixels[i]=Math.round((invert?1-sample:sample)*65535);
  }
  const quantity=result.quantity??'relative-depth',units=result.units??result.unit??'relative';
  if(result.units!=null&&result.unit!=null&&result.units!==result.unit)throw new Error('Motstridande djupneeiningar.');
  if(!['relative-depth','disparity','depth','display-intensity'].includes(quantity)||!['relative','px','m','intensity'].includes(units)||quantity==='depth'&&units!=='m'||quantity==='disparity'&&units!=='px'||quantity==='relative-depth'&&units!=='relative'||quantity==='display-intensity'&&units!=='intensity')throw new Error('Ugyldig djupneeining.');
  return {pixels,width,height,mapping:{encoding:'uint16-linear',min,max,invert,polarity,quantity,units,invalidCount,invalidDisplayValue:0,validityPreserved:false,clippedCount,maxQuantizationError:span/131070,model:String(result.model??''),source:String(result.source??''),sensorRaw:false}};
}

function tiffValue(type,value){
  if(type===2)return new TextEncoder().encode(value+'\0');
  const values=Array.isArray(value)?value:[value],size={1:1,3:2,4:4,5:8,10:8}[type],bytes=new Uint8Array(values.length*size),view=new DataView(bytes.buffer);
  values.forEach((number,index)=>{
    const offset=index*size;
    if(type===1)view.setUint8(offset,number);
    else if(type===3)view.setUint16(offset,number,true);
    else if(type===4)view.setUint32(offset,number,true);
    else{view[type===10?'setInt32':'setUint32'](offset,number[0],true);view[type===10?'setInt32':'setUint32'](offset+4,number[1],true)}
  });
  return bytes;
}

function encodeValueImage(result,options,dng){
  const {pixels,width,height,mapping}=quantizeDepth(result,options);
  const description=JSON.stringify({format:'entropi-value-image',version:1,...mapping,experimentalDng:dng}).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const tags=[
    [254,4,0],[256,4,width],[257,4,height],[258,3,16],[259,3,1],[262,3,dng?34892:1],
    [270,2,description],[273,4,0],[274,3,1],[277,3,1],[278,4,height],[279,4,pixels.length*2],
    [282,5,[[72,1]]],[283,5,[[72,1]]],[284,3,1],[296,3,2],[305,2,'Entropi'],[339,3,1]
  ];
  if(dng)tags.push([271,2,'Entropi'],[272,2,'Numerical Values'],[50706,1,[1,4,0,0]],[50707,1,[1,1,0,0]],
    [50708,2,'Entropi Numerical Values'],[50714,3,0],[50717,4,65535],[50718,5,[[1,1],[1,1]]],
    [50719,4,[0,0]],[50720,4,[width,height]],[50730,10,[[0,1]]],[50734,5,[[1,1]]]);
  return encodeTiff16(pixels,tags,dng?'image/dng':'image/tiff');
}

function encodeTiff16(pixels,tags,mime,stride=1,channels=[0]){
  tags.sort((a,b)=>a[0]-b[0]);
  const entries=tags.map(([tag,type,value])=>({tag,type,value,bytes:tiffValue(type,value)}));
  let end=8+2+entries.length*12+4;
  for(const entry of entries)if(entry.bytes.length>4){entry.offset=end;end+=entry.bytes.length+(entry.bytes.length%2)}
  const pixelOffset=end,buffer=new ArrayBuffer(pixelOffset+pixels.length/stride*channels.length*2),bytes=new Uint8Array(buffer),view=new DataView(buffer);
  bytes.set([73,73,42,0]);view.setUint32(4,8,true);view.setUint16(8,entries.length,true);
  for(let i=0;i<entries.length;i++){
    const entry=entries[i],offset=10+i*12;
    view.setUint16(offset,entry.tag,true);view.setUint16(offset+2,entry.type,true);
    view.setUint32(offset+4,entry.bytes.length/({1:1,2:1,3:2,4:4,5:8,10:8}[entry.type]),true);
    if(entry.tag===273)view.setUint32(offset+8,pixelOffset,true);
    else if(entry.offset){view.setUint32(offset+8,entry.offset,true);bytes.set(entry.bytes,entry.offset)}
    else bytes.set(entry.bytes,offset+8);
  }
  let offset=pixelOffset;
  for(let i=0;i<pixels.length;i+=stride)for(const channel of channels){view.setUint16(offset,pixels[i+channel],true);offset+=2}
  return new Blob([buffer],{type:mime});
}

export function encodeDepthTiff(result,options={}){return encodeValueImage(result,options,false)}
export function encodeDepthDng(result,options={}){return encodeValueImage(result,options,true)}


// RGBA16 from the floating-point renderer, stored as grayscale + unassociated alpha.
// Packing directly into the TIFF avoids allocating another full-size pixel array.
export function encodeGrayscale16Tiff(rgba,width,height,metadata={}){
  if(!(rgba instanceof Uint16Array)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216||rgba.length!==width*height*4)throw new Error('Ugyldig 16-bits bilete.');
  for(let i=0;i<rgba.length;i+=4)if(rgba[i]!==rgba[i+1]||rgba[i]!==rgba[i+2])throw new Error('TIFF-eksporten krev graatonar.');
  const description=JSON.stringify(metadata).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const tags=[
    [254,4,0],[256,4,width],[257,4,height],[258,3,[16,16]],[259,3,1],[262,3,1],
    [270,2,description],[273,4,0],[274,3,1],[277,3,2],[278,4,height],[279,4,width*height*4],
    [282,5,[[72,1]]],[283,5,[[72,1]]],[284,3,1],[296,3,2],[305,2,'Entropi'],[338,3,2],[339,3,[1,1]]
  ];
  return encodeTiff16(rgba,tags,'image/tiff',4,[0,3]);
}

export function encodeRgba16Tiff(rgba,width,height,metadata={}){
  if(!(rgba instanceof Uint16Array)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216||rgba.length!==width*height*4)throw new Error('Ugyldig 16-bits bilete.');
  const description=JSON.stringify(metadata).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const tags=[
    [254,4,0],[256,4,width],[257,4,height],[258,3,[16,16,16,16]],[259,3,1],[262,3,2],
    [270,2,description],[273,4,0],[274,3,1],[277,3,4],[278,4,height],[279,4,width*height*8],
    [282,5,[[72,1]]],[283,5,[[72,1]]],[284,3,1],[296,3,2],[305,2,'Entropi'],[338,3,2],[339,3,[1,1,1,1]]
  ];
  return encodeTiff16(rgba,tags,'image/tiff',4,[0,1,2,3]);
}
