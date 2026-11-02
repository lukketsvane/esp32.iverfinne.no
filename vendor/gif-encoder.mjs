// Dependency-free GIF89a encoder for deterministic, endlessly looping
// grayscale VATHOgraphy frames. All frames cover the full image; no ghost trails.
const ascii=s=>Uint8Array.from([...s].map(c=>c.charCodeAt(0)));
function word(n){return [n&255,(n>>>8)&255]}
function lzw(pixels){
  if(!(pixels instanceof Uint8Array)||pixels.length===0)throw new TypeError('Ugyldige GIF-pikslar.');
  const clear=256,end=257,dictionary=new Map();
  let next=258,width=9,bits=0,buffer=0;
  const bytes=[];
  const emit=code=>{
    buffer|=code<<bits;bits+=width;
    while(bits>=8){bytes.push(buffer&255);buffer>>>=8;bits-=8}
  };
  emit(clear);
  let prefix=pixels[0];
  for(let i=1;i<pixels.length;i++){
    const value=pixels[i],key=(prefix<<8)|value,found=dictionary.get(key);
    if(found!==undefined){prefix=found;continue}
    emit(prefix);
    if(next<4096){
      dictionary.set(key,next++);
      // GIF LZW has decoder one-dictionary-entry behind the encoder.
      // Promote the code width after the last code in the old width was emitted.
      if(next>(1<<width)&&width<12)width++;
    }else{
      emit(clear);dictionary.clear();next=258;width=9;
    }
    prefix=value;
  }
  emit(prefix);emit(end);
  if(bits)bytes.push(buffer&255);
  const blocks=[];
  for(let i=0;i<bytes.length;i+=255){
    const chunk=bytes.slice(i,i+255);
    blocks.push(chunk.length,...chunk);
  }
  blocks.push(0);
  return Uint8Array.from(blocks);
}
export function rgbaToGrayIndices(rgba){
  if(!rgba||rgba.length%4)throw new RangeError('Ugyldig RGBA-ramme.');
  const out=new Uint8Array(rgba.length/4);
  for(let i=0;i<out.length;i++){
    const at=i*4;out[i]=Math.max(0,Math.min(255,Math.round(rgba[at]*.2126+rgba[at+1]*.7152+rgba[at+2]*.0722)));
  }
  return out;
}
export class GrayGifEncoder {
  constructor(width,height,{fps=20}={}){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||width*height>1048576)throw new RangeError('Ugyldig GIF-oppløysing.');
    if(!Number.isInteger(fps)||fps<1||fps>50||100%fps!==0)throw new RangeError('GIF krev heiltal i hundredelar av eit sekund.');
    this.width=width;this.height=height;this.delay=100/fps;this.count=0;
    const header=Uint8Array.from([...ascii('GIF89a'),...word(width),...word(height),0xf7,0,0]);
    const colors=new Uint8Array(256*3);
    for(let i=0;i<256;i++)colors.set([i,i,i],i*3);
    const extension=Uint8Array.from([0x21,0xff,0x0b,...ascii('NETSCAPE2.0'),0x03,0x01,0,0,0]);
    this.parts=[header,colors,extension];
  }
  addFrame(indexedPixels){
    if(!(indexedPixels instanceof Uint8Array)||indexedPixels.length!==this.width*this.height)throw new RangeError('GIF-ramma har feil storleik.');
    this.parts.push(Uint8Array.from([
      0x21,0xf9,0x04,0x04,...word(this.delay),0x00,0x00,
      0x2c,0,0,0,0,...word(this.width),...word(this.height),0,
      0x08
    ]),lzw(indexedPixels));
    this.count++;
  }
  finish(){
    if(this.count<2)throw new Error('GIF-løkkja krev minst to rammer.');
    return new Blob([...this.parts,Uint8Array.of(0x3b)],{type:'image/gif'});
  }
}
