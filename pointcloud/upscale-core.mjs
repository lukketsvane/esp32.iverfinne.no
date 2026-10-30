const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function chunk(kind,data){
  const bytes=new Uint8Array(data.length+12),view=new DataView(bytes.buffer);view.setUint32(0,data.length);
  for(let i=0;i<4;i++)bytes[i+4]=kind.charCodeAt(i);bytes.set(data,8);
  let crc=0xffffffff;for(let i=4;i<bytes.length-4;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);
  view.setUint32(bytes.length-4,(crc^0xffffffff)>>>0);return bytes;
}
export function upscaleSize(width,height,factor){
  if(![2,4,8].includes(factor)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216)throw new Error('Ugyldig bilete for AI-oppskalering.');
  if(width*factor>32768||height*factor>32768||width*height*factor*factor>134217728)throw new Error('Biletet er for stort for dette forstørringsnivået. Vel eit mindre utsnitt eller 2×/4×.');
  return {width:width*factor,height:height*factor};
}
export function sourceTile(rgba,width,height,left,top,size,padding){
  const edge=size+padding*2,plane=edge*edge,data=new Float32Array(plane*3);
  for(let y=0;y<edge;y++)for(let x=0;x<edge;x++){
    const sx=Math.max(0,Math.min(width-1,left+x-padding)),sy=Math.max(0,Math.min(height-1,top+y-padding)),at=(sy*width+sx)*4,i=y*edge+x;
    data[i]=rgba[at]/255;data[plane+i]=rgba[at+1]/255;data[plane*2+i]=rgba[at+2]/255;
  }
  return {data,width:edge,height:edge};
}
export function cropTensor(data,width,height,left,top,size){
  const result=new Float32Array(size*size*3),plane=width*height;
  for(let c=0;c<3;c++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)result[c*size*size+y*size+x]=Math.max(0,Math.min(1,data[c*plane+(top+y)*width+left+x]));
  return {data:result,width:size,height:size};
}
export function writeOutputTile(strip,stripWidth,source,sourceWidth,sourceHeight,left,top,tileWidth,tileHeight,factor,result,padding){
  const width=result.width,plane=width*result.height,step=factor===4?1:2,offset=padding*4;
  for(let y=0;y<tileHeight*factor;y++)for(let x=0;x<tileWidth*factor;x++){
    const output=(y*stripWidth+left*factor+x)*4,at=(offset+y*step)*width+offset+x*step;
    for(let c=0;c<3;c++){
      let value=0;for(let dy=0;dy<step;dy++)for(let dx=0;dx<step;dx++)value+=result.data[c*plane+at+dy*width+dx];
      strip[output+c]=Math.round(Math.max(0,Math.min(1,value/(step*step)))*255);
    }
    const sx=Math.max(0,Math.min(sourceWidth-1,left+(x+.5)/factor-.5)),sy=Math.max(0,Math.min(sourceHeight-1,top+(y+.5)/factor-.5)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sourceWidth-1,x0+1),y1=Math.min(sourceHeight-1,y0+1),fx=sx-x0,fy=sy-y0;
    strip[output+3]=Math.round((source[(y0*sourceWidth+x0)*4+3]*(1-fx)+source[(y0*sourceWidth+x1)*4+3]*fx)*(1-fy)+(source[(y1*sourceWidth+x0)*4+3]*(1-fx)+source[(y1*sourceWidth+x1)*4+3]*fx)*fy);
  }
}
export function pngStream(width,height,metadata){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Ugyldig PNG-storleik.');
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=6;
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',new TextEncoder().encode('entropi\0'+JSON.stringify(metadata)))],compression=new CompressionStream('deflate'),writer=compression.writable.getWriter();
  const reading=(async()=>{const reader=compression.readable.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;parts.push(chunk('IDAT',value))}}finally{reader.releaseLock()}})();reading.catch(()=>{});
  let written=0,closed=false;
  return {
    async write(rgba,rows){
      if(closed||!Number.isInteger(rows)||rows<1||written+rows>height||rgba.length!==width*rows*4)throw new Error('Ugyldig PNG-stripe.');
      const stride=width*4,filtered=new Uint8Array((stride+1)*rows);
      for(let y=0;y<rows;y++){const start=y*(stride+1),source=y*stride;filtered[start]=1;for(let x=0;x<stride;x++)filtered[start+1+x]=(rgba[source+x]-(x<4?0:rgba[source+x-4]))&255}
      await writer.write(filtered);written+=rows;
    },
    async finish(){
      if(closed||written!==height)throw new Error('Ufullstendig PNG-bilete.');
      closed=true;await writer.close();await reading;parts.push(chunk('IEND',new Uint8Array()));return new Blob(parts,{type:'image/png'});
    }
  };
}
