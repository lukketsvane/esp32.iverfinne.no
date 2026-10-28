const documentLimit=128*1024*1024,pixelLimit=16777216,metadataLimit=65536;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let n=0;n<8;n++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0});
const littleEndian=new Uint8Array(Uint32Array.of(1).buffer)[0]===1;

function invalid(message='Ugyldig Entropi-fil.'){throw new Error(message)}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
function jsonCopy(value){try{const text=JSON.stringify(value);if(text.length>metadataLimit)invalid();return JSON.parse(text)}catch{invalid('Ugyldige Entropi-metadata.')}}
function text(value,fallback=''){if(value==null)return fallback;if(typeof value!=='string'||value.length>1024)invalid();return value}
function floatCopy(values,length){if(!(values instanceof Float32Array)||values.length!==length)invalid('Ugyldige flyttalsdata.');return new Float32Array(values.buffer.slice(values.byteOffset,values.byteOffset+values.byteLength))}
function blob(value,optional=false){if(optional&&value==null)return null;if(!(value instanceof Blob)||!value.size||value.size>32*1024*1024||!['image/jpeg','image/png','image/webp'].includes(value.type))invalid('Ugyldig originalbilete.');return value}

export function createEntropiDocument({left,right=null,result,recipe={},preview=null,geometry={},capture={},id,created}={}){
  const width=result?.width,height=result?.height,length=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!Number.isSafeInteger(length)||length>pixelLimit)invalid('Ugyldig djupneoppløysing.');
  if(result.validity!=null&&!(result.validity instanceof Uint8Array))invalid('Ugyldig gyldigheitskart.');
  const depth=floatCopy(result.depth,length),validity=result.validity==null?Uint8Array.from(depth,value=>Number.isFinite(value)?1:0):new Uint8Array(result.validity);
  if(validity.length!==length)invalid('Ugyldig gyldigheitskart.');
  for(let i=0;i<length;i++)if(validity[i]!==0&&validity[i]!==1||validity[i]&&!Number.isFinite(depth[i]))invalid('Ugyldig gyldigheitskart.');
  const confidence=result.confidence==null?null:floatCopy(result.confidence,length);
  if(confidence)for(const value of confidence)if(!Number.isFinite(value)||value<0||value>1)invalid('Ugyldig tryggleikskart.');
  const quantity=result.quantity??'relative-depth',units=result.units??'relative',polarity=result.polarity??(quantity==='depth'?'far':'near');
  if(!['near','far'].includes(polarity)||!['relative-depth','disparity','depth','display-intensity'].includes(quantity)||!['relative','px','m','intensity'].includes(units))invalid();
  if(({ 'relative-depth':'relative',disparity:'px',depth:'m','display-intensity':'intensity' })[quantity]!==units)invalid('Ugyldig eining for djupnedata.');
  const tone={preset:recipe.preset??1,position:recipe.position??0,width:recipe.width??1};
  if(!Number.isInteger(tone.preset)||tone.preset<0||tone.preset>4||!Number.isFinite(tone.position)||Math.abs(tone.position)>1||!Number.isFinite(tone.width)||tone.width<.25||tone.width>3)invalid('Ugyldig framkalling.');
  const identity=id??globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),date=created??new Date().toISOString();
  if(typeof identity!=='string'||!identity.length||identity.length>128||typeof date!=='string'||!Number.isFinite(Date.parse(date)))invalid();
  const spatial=jsonCopy({referenceCamera:'left',calibration:null,...geometry}),timing=jsonCopy({left:null,right:null,synchronized:false,...capture});
  if(quantity==='depth'&&!spatial.calibration)invalid('Metrisk djupn krev kalibrering.');
  return {id:identity,created:date,left:blob(left),right:blob(right,true),preview:blob(preview,true),recipe:tone,geometry:spatial,capture:timing,result:{depth,width,height,validity,confidence,polarity,quantity,units,normalized:result.normalized===true,model:text(result.model),source:text(result.source),confidenceDefinition:confidence?text(result.confidenceDefinition,'Source confidence in [0,1]; not a calibrated probability'):null}};
}

async function digest(bytes){
  if(globalThis.crypto?.subtle)return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const constants=Uint32Array.of(0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2);
  const state=Uint32Array.of(0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19),words=new Uint32Array(64),total=Math.ceil((bytes.length+9)/64)*64,block=new Uint8Array(64),view=new DataView(block.buffer),rotate=(value,bits)=>(value>>>bits)|(value<<(32-bits));
  for(let offset=0;offset<total;offset+=64){
    block.fill(0);block.set(bytes.subarray(offset,offset+64));
    if(offset<=bytes.length&&offset+64>bytes.length)block[bytes.length-offset]=128;
    if(offset+64===total){view.setUint32(56,Math.floor(bytes.length/0x20000000));view.setUint32(60,(bytes.length*8)>>>0)}
    for(let i=0;i<16;i++)words[i]=view.getUint32(i*4);
    for(let i=16;i<64;i++){const a=words[i-15],b=words[i-2];words[i]=words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10))}
    let [a,b,c,d,e,f,g,h]=state;
    for(let i=0;i<64;i++){const first=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])>>>0,second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+first)>>>0;d=c;c=b;b=a;a=(first+second)>>>0}
    for(const [i,value]of [a,b,c,d,e,f,g,h].entries())state[i]+=value;
  }
  return [...state].map(value=>value.toString(16).padStart(8,'0')).join('');
}

function floatBytes(values){const bytes=new Uint8Array(values.buffer.slice(values.byteOffset,values.byteOffset+values.byteLength));if(!littleEndian)for(let i=0;i<bytes.length;i+=4)bytes.subarray(i,i+4).reverse();return bytes}
function floats(bytes){if(bytes.length%4)invalid();const copy=bytes.slice();if(!littleEndian)for(let i=0;i<copy.length;i+=4)copy.subarray(i,i+4).reverse();return new Float32Array(copy.buffer)}
async function compress(bytes){try{const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')),packed=new Uint8Array(await new Response(stream).arrayBuffer());if(packed.length<bytes.length)return {bytes:packed,method:8}}catch{}return {bytes,method:0}}
async function expand(bytes,method,size){
  if(method===0){if(bytes.length!==size)invalid();return bytes}
  let reader;try{reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()}catch{invalid('Nettlesaren kan ikkje opne denne komprimeringa.')}
  const output=new Uint8Array(size);let offset=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(offset+value.length>size)invalid();output.set(value,offset);offset+=value.length}if(offset!==size)invalid();return output}finally{await reader.cancel().catch(()=>{})}
}

async function zip(entries){
  const chunks=[],directory=[];let offset=0,total=0;
  for(const [name,bytes]of entries){
    total+=bytes.length;if(total>documentLimit)invalid('Entropi-fila er for stor.');
    const filename=encoder.encode(name),packed=await compress(bytes),crc=crc32(bytes),local=new Uint8Array(30+filename.length),lv=new DataView(local.buffer),central=new Uint8Array(46+filename.length),cv=new DataView(central.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(8,packed.method,true);lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,packed.bytes.length,true);lv.setUint32(22,bytes.length,true);lv.setUint16(26,filename.length,true);local.set(filename,30);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(10,packed.method,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,packed.bytes.length,true);cv.setUint32(24,bytes.length,true);cv.setUint16(28,filename.length,true);cv.setUint32(42,offset,true);central.set(filename,46);
    chunks.push(local,packed.bytes);directory.push(central);offset+=local.length+packed.bytes.length;
  }
  const size=directory.reduce((sum,entry)=>sum+entry.length,0),end=new Uint8Array(22),view=new DataView(end.buffer);
  view.setUint32(0,0x06054b50,true);view.setUint16(8,entries.size,true);view.setUint16(10,entries.size,true);view.setUint32(12,size,true);view.setUint32(16,offset,true);
  if(offset+size+22>documentLimit)invalid('Entropi-fila er for stor.');
  return new Blob([...chunks,...directory,end],{type:'application/x-entropi'});
}

async function unzip(file){
  if(!(file instanceof Blob)||file.size<22||file.size>documentLimit)invalid();
  const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer),end=bytes.length-22;
  if(view.getUint32(end,true)!==0x06054b50||view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+20,true))invalid();
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
  if(!count||count>16||view.getUint16(end+8,true)!==count||start+size!==end)invalid();
  const entries=new Map(),spans=[];let cursor=start,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)invalid();
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),packed=view.getUint32(cursor+20,true),length=view.getUint32(cursor+24,true),nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true);
    if(flags!==0x800&&flags!==0||![0,8].includes(method)||nameLength<1||nameLength>128||cursor+46+nameLength+extra+comment>end||view.getUint16(cursor+34,true)||local+30>start)invalid();
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(!/^[a-z0-9][a-z0-9/.-]*$/.test(name)||name.includes('..')||name.includes('//')||entries.has(name))invalid();
    if(view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method||view.getUint32(local+14,true)!==crc||view.getUint32(local+18,true)!==packed||view.getUint32(local+22,true)!==length||view.getUint16(local+26,true)!==nameLength)invalid();
    const data=local+30+nameLength+view.getUint16(local+28,true);
    if(data+packed>start||decoder.decode(bytes.subarray(local+30,local+30+nameLength))!==name||spans.some(([from,to])=>local<to&&data+packed>from))invalid();
    spans.push([local,data+packed]);total+=length;if(total>documentLimit||name==='manifest.json'&&length>metadataLimit)invalid();
    const content=await expand(bytes.subarray(data,data+packed),method,length);if(crc32(content)!==crc)invalid('Entropi-fila er skadd.');
    entries.set(name,content);cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==end)invalid();return entries;
}

export async function encodeEntropiDocument(document){
  const value=createEntropiDocument(document),entries=new Map(),files={};
  const add=async(path,bytes,type)=>{entries.set(path,bytes);files[path]={bytes:bytes.length,sha256:await digest(bytes),type};return path};
  const originals={left:await add('sources/left',new Uint8Array(await value.left.arrayBuffer()),value.left.type),right:value.right?await add('sources/right',new Uint8Array(await value.right.arrayBuffer()),value.right.type):null};
  const {depth,validity,confidence,...result}=value.result;
  result.depth=await add('data/depth.f32',floatBytes(depth),'float32-le');result.validity=await add('data/validity.u8',validity,'uint8');result.confidence=confidence?await add('data/confidence.f32',floatBytes(confidence),'float32-le'):null;
  const preview=value.preview?await add('preview/image',new Uint8Array(await value.preview.arrayBuffer()),value.preview.type):null;
  const manifest={format:'entropi',version:1,profile:'numerical-float32',id:value.id,created:value.created,originals,result,recipe:value.recipe,geometry:value.geometry,capture:value.capture,preview,files},metadata=encoder.encode(JSON.stringify(manifest));
  if(metadata.length>metadataLimit)invalid();entries.set('manifest.json',metadata);return zip(entries);
}

export async function decodeEntropiDocument(file){
  const entries=await unzip(file);let manifest;
  try{manifest=JSON.parse(decoder.decode(entries.get('manifest.json')))}catch{invalid()}
  if(manifest?.format!=='entropi'||manifest.version!==1||manifest.profile!=='numerical-float32')invalid('Ukjend Entropi-versjon.');
  const {files,originals,result}=manifest;
  if(!files||typeof files!=='object'||Array.isArray(files)||!originals||!result||Object.keys(files).length!==entries.size-1)invalid();
  if(!manifest.id||!manifest.created||!manifest.recipe||!manifest.geometry||!manifest.capture||originals.left!=='sources/left'||originals.right!==null&&originals.right!=='sources/right'||result.depth!=='data/depth.f32'||result.validity!=='data/validity.u8'||result.confidence!==null&&result.confidence!=='data/confidence.f32'||manifest.preview!==null&&manifest.preview!=='preview/image')invalid();
  const expected=new Set([originals.left,originals.right,result.depth,result.validity,result.confidence,manifest.preview].filter(Boolean));
  if(expected.size!==Object.keys(files).length)invalid();
  for(const [path,metadata]of Object.entries(files)){
    const bytes=entries.get(path);if(!expected.has(path)||!bytes||metadata?.bytes!==bytes.length||!/^[a-f0-9]{64}$/.test(metadata.sha256)||await digest(bytes)!==metadata.sha256)invalid('Entropi-fila er skadd.');
  }
  const read=(path,type)=>{if(typeof path!=='string'||!Object.hasOwn(files,path)||type&&files[path].type!==type)invalid();return entries.get(path)};
  const image=path=>path==null?null:new Blob([read(path)],{type:files[path].type});
  const depth=floats(read(result.depth,'float32-le')),validity=read(result.validity,'uint8'),confidence=result.confidence==null?null:floats(read(result.confidence,'float32-le'));
  const value=createEntropiDocument({id:manifest.id,created:manifest.created,left:image(originals.left),right:image(originals.right),preview:image(manifest.preview),result:{...result,depth,validity,confidence},recipe:manifest.recipe,geometry:manifest.geometry,capture:manifest.capture});
  return value;
}
