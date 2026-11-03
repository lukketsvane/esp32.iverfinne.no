/* Minimal GIF89a exporter with globally indexed palette and LZW, offline only. */
import {paletteColors} from './dither-core.mjs';
const toBytes = n=>[n&255,(n>>8)&255];
export function encodeGIF(frames,width,height,paletteKey='mono',custom='',delay=8){
 if(!frames?.length||frames.length>80||width<1||height<1||width>2048||height>2048||frames.some(a=>a.length!==width*height*4))throw Error('Ugyldige GIF-rammer');
 let palette=paletteColors(paletteKey,custom);
 const bits=Math.max(1,Math.ceil(Math.log2(palette.length))),tableSize=1<<bits;
 palette=palette.concat(Array.from({length:tableSize-palette.length},()=>[0,0,0]));
 const bytes=[];const push=(...arr)=>bytes.push(...arr);
 push(...[...'GIF89a'].map(x=>x.charCodeAt(0)),...toBytes(width),...toBytes(height),0x80|((bits-1)<<4)|(bits-1),0,0);
 for(let i=0;i<tableSize;i++)push(...palette[i]);
 // Netscape extension: repeat whole animation forever.
 push(0x21,0xFF,0x0B,...[...'NETSCAPE2.0'].map(x=>x.charCodeAt(0)),3,1,0,0,0);
 const indexPalette=palette.slice(0,tableSize);
 function lookup(r,g,b){let min=Infinity,best=0;for(let i=0;i<indexPalette.length;i++){const c=indexPalette[i],rr=r-c[0],gg=g-c[1],bb=b-c[2],v=rr*rr*.26+gg*gg*.59+bb*bb*.15;if(v<min){min=v;best=i}}return best}
 for(const frame of frames){const indexed=new Uint8Array(width*height);
  for(let p=0;p<indexed.length;p++)indexed[p]=lookup(frame[4*p],frame[4*p+1],frame[4*p+2]);
  push(0x21,0xF9,4,0x08,...toBytes(Math.max(2,Math.min(65535,Math.round(delay)))),0,0); // disposal 2, no transparency
  push(0x2C,0,0,0,0,...toBytes(width),...toBytes(height),0); // image descriptor, global palette
  const minSize=Math.max(2,bits);push(minSize);
  const compressed=lzw(indexed,minSize);
  for(let i=0;i<compressed.length;i+=255){const part=compressed.subarray(i,i+255);push(part.length,...part)}push(0);
 }
 push(0x3B);return new Uint8Array(bytes);
}
function lzw(data,minSize){const clear=1<<minSize,end=clear+1;let next=end+1,size=minSize+1,dict=new Map();
 for(let i=0;i<clear;i++)dict.set(String.fromCharCode(i),i);
 const bytes=[],write=(code)=>{bitBuf|=code<<bitLen;bitLen+=size;while(bitLen>=8){bytes.push(bitBuf&255);bitBuf>>>=8;bitLen-=8}};
 let bitBuf=0,bitLen=0;write(clear);let word=String.fromCharCode(data[0]);
 for(let i=1;i<data.length;i++){
  const ch=String.fromCharCode(data[i]),test=word+ch;
  if(dict.has(test)){word=test;continue}
  write(dict.get(word));
  if(next<4096){dict.set(test,next++);if(next>(1<<size)&&size<12)size++}
  else{write(clear);dict=new Map();for(let j=0;j<clear;j++)dict.set(String.fromCharCode(j),j);next=end+1;size=minSize+1}
  word=ch;
 }
 write(dict.get(word));write(end);if(bitLen)bytes.push(bitBuf&255);
 return Uint8Array.from(bytes);
}
