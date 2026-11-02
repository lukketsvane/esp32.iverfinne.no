// VATHOgraphy PNG: a valid, viewable PNG with one private, safe-to-copy
// ancillary vaTh chunk containing the complete, checked .entropi document.
// Preserve this PNG as a file. Re-encoding through a canvas strips metadata.
const signature=Uint8Array.of(137,80,78,71,13,10,26,10);
const chunkType=Uint8Array.of(118,97,84,104); // vaTh: ancillary / private / reserved uppercase / safe-to-copy
const maxArchive=128*1024*1024;
const maxPng=160*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
function invalid(message='Ugyldig VATHOgraphy-PNG.'){throw new Error(message)}
function crc32(bytes){let value=0xffffffff;for(const b of bytes)value=crcTable[(value^b)&255]^(value>>>8);return(value^0xffffffff)>>>0}
function typeAt(bytes,index){return String.fromCharCode(...bytes.subarray(index,index+4))}
function validate(file){
  if(!(file instanceof Blob)||file.size<signature.length+25||file.size>maxPng)invalid('Biletet er for stort eller ikkje PNG.');
  if(file.type&&file.type!=='image/png')invalid('Berre PNG støttar dette bildefilformatet.');
}
function walkPng(bytes){
  if(bytes.length<45||!signature.every((b,i)=>bytes[i]===b))invalid('Fann ikkje PNG-signaturen.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset=8,iend=-1,embedded=null,seenIHDR=false,seenIDAT=false,count=0;
  const chunks=[];
  while(offset+12<=bytes.length){
    if(++count>100000)invalid();
    const size=view.getUint32(offset,false),end=offset+12+size;
    if(size>maxArchive||end>bytes.length||end<offset)invalid('PNG-fila har ein øydelagd datablokk.');
    const type=typeAt(bytes,offset+4);
    if(!seenIHDR){if(type!=='IHDR'||size!==13)invalid('PNG manglar korrekt biletinformasjon.');seenIHDR=true}
    if(type==='IHDR'&&offset!==8)invalid();
    if(type==='IDAT')seenIDAT=true;
    if(type==='vaTh'){
      if(embedded!==null||size<8||size>maxArchive)invalid('Ugyldig eller duplisert VATHO-datablokk.');
      const field=bytes.subarray(offset+8,offset+8+size),crcInput=bytes.subarray(offset+4,offset+8+size);
      if(view.getUint32(offset+8+size,false)!==crc32(crcInput))invalid('VATHO-datablokka er skadd.');
      if(String.fromCharCode(...field.subarray(0,4))!=='VATH'||field[4]!==1||field[5]||field[6]||field[7])invalid('Ukjend VATHO-PNG-versjon.');
      embedded=field.subarray(8);
    }
    if(type==='IEND'){
      if(size!==0||!seenIDAT||end!==bytes.length)invalid('PNG-fila har ugyldig slutt.');
      iend=offset;break;
    }
    chunks.push({start:offset,end,type});offset=end;
  }
  if(iend<0)invalid('PNG-fila manglar sluttblokk.');
  return {chunks,iend,embedded};
}
export async function encodeVathographyPNG(preview,documentFile){
  validate(preview);
  if(!(documentFile instanceof Blob)||documentFile.size<22||documentFile.size>maxArchive)invalid('Ugyldig Entropi-dokument.');
  const original=new Uint8Array(await preview.arrayBuffer());
  const {chunks,iend}=walkPng(original);
  const documentBytes=new Uint8Array(await documentFile.arrayBuffer());
  const body=new Uint8Array(8+documentBytes.length);
  body.set([86,65,84,72,1,0,0,0]);body.set(documentBytes,8);
  const chunk=new Uint8Array(body.length+12),view=new DataView(chunk.buffer);
  view.setUint32(0,body.length,false);chunk.set(chunkType,4);chunk.set(body,8);
  view.setUint32(chunk.length-4,crc32(chunk.subarray(4,chunk.length-4)),false);
  const parts=[original.subarray(0,8)];
  for(const part of chunks)if(part.type!=='vaTh')parts.push(original.subarray(part.start,part.end));
  parts.push(chunk,original.subarray(iend));
  const result=new Blob(parts,{type:'image/png'});
  if(result.size>maxPng)invalid('VATHO-PNG-fila er for stor.');
  return result;
}
export async function readVathographyPNG(file){
  validate(file);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const {embedded}=walkPng(bytes);
  return embedded===null?null:new Blob([embedded],{type:'application/x-entropi'});
}
