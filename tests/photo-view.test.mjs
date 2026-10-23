import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const photo=(await readFile(new URL('../vendor/photo.mjs',import.meta.url),'utf8')).replace(/^export /gm,''),view=(await readFile(new URL('../vendor/photo-view.mjs',import.meta.url),'utf8')).replace(/^import .*\n/,'').replace(/^export /gm,'');
function harness(width=16,height=12,pixels){
  const frames=new Map(),canvases=[];let serial=0,draws=0,writes=0;
  const document={createElement(){
    const canvas={width:0,height:0,style:{},hidden:false,removed:false,attributes:new Map(),pixels:new Uint8ClampedArray(),setAttribute(name,value){this.attributes.set(name,value)},remove(){this.removed=true}};
    const context={
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}},
      putImageData(image){canvas.pixels=image.data.slice();writes++},
      getImageData(){return {data:canvas.pixels.slice()}},
      drawImage(image,...args){
        draws++;const source=image.pixels,sw=image.naturalWidth||image.width,sh=image.naturalHeight||image.height,[sx,sy,cw,ch,dx,dy,dw,dh]=args.length===4?[0,0,sw,sh,...args]:args;
        canvas.pixels=new Uint8ClampedArray(canvas.width*canvas.height*4);
        for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
          const from=(Math.min(sh-1,Math.floor(sy+(y+.5)*ch/dh))*sw+Math.min(sw-1,Math.floor(sx+(x+.5)*cw/dw)))*4,to=((dy+y)*canvas.width+dx+x)*4;
          canvas.pixels.set(source.subarray(from,from+4),to);
        }
      }
    };
    canvas.context=context;canvas.getContext=()=>context;canvases.push(canvas);return canvas;
  }};
  const image={ownerDocument:document,naturalWidth:width,naturalHeight:height,src:'blob:original-jpeg',style:{opacity:'',transform:'translate(0px, 0px) scale(1)'},pixels:pixels||new Uint8ClampedArray(width*height*4).fill(255),after(canvas){this.next=canvas}};
  const context=vm.createContext({document,Uint8ClampedArray,Float32Array,Math,Number,Boolean,Error,requestAnimationFrame(callback){frames.set(++serial,callback);return serial},cancelAnimationFrame(id){frames.delete(id)}});
  vm.runInContext(photo+'\n'+view,context);
  return {image,view:context.createPhotoView(image),process:context.processPhoto,canvas:()=>image.next,canvases,flush(){for(const [id,callback]of [...frames]){frames.delete(id);callback()}},get pending(){return frames.size},get draws(){return draws},get writes(){return writes}};
}
function gray(width,height,value=(x,y)=>(x*19+y*31)%256){const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=typeof value==='function'?value(x,y):value;data[i+3]=255}return data}
const monochrome=data=>{for(let i=0;i<data.length;i+=4){assert.equal(data[i],data[i+1]);assert.equal(data[i],data[i+2])}};
const binary=data=>{monochrome(data);for(let i=0;i<data.length;i+=4)assert.ok(data[i]===0||data[i]===255)};

test('decoded color becomes cached grayscale while the original JPEG and gesture target remain intact',()=>{
  const app=harness(2,1,new Uint8ClampedArray([255,0,0,255,0,255,0,128]));app.view.show(true);assert.equal(app.image.style.opacity,'');app.view.setSource();app.view.show(true);
  assert.deepEqual([...app.canvas().pixels],[54,54,54,255,182,182,182,128]);assert.equal(app.image.src,'blob:original-jpeg');assert.equal(app.image.style.opacity,'0');assert.equal(app.canvas().hidden,false);assert.match(app.canvas().style.cssText,/pointer-events:none/);assert.match(app.canvas().style.cssText,/object-fit:contain/);assert.equal(app.canvas().attributes.get('aria-hidden'),'true');
  app.view.show(false);assert.equal(app.image.style.opacity,'');assert.equal(app.canvas().hidden,true);
});

test('Bayer, Floyd–Steinberg and Atkinson give distinct strictly black-and-white output',()=>{
  const app=harness(),input=gray(16,12),outputs=[1,2,3].map(style=>app.process(input,16,12,style,1,1));
  for(const output of outputs){binary(output);assert.ok(output.some((value,index)=>index%4===0&&value===0));assert.ok(output.some((value,index)=>index%4===0&&value===255))}
  assert.equal(new Set(outputs.map(output=>Buffer.from(output).toString('base64'))).size,3);
});

test('every style keeps black and white endpoints and preserves source alpha',()=>{
  const app=harness();for(const value of [0,255])for(let style=0;style<4;style++){
    const input=gray(9,7,value);input[3]=0;input[7]=128;const output=app.process(input,9,7,style,3,3);
    for(let i=0;i<output.length;i++)assert.equal(output[i],i%4===3?input[i]:value);
  }
});

test('grain creates larger uniform cells and contrast strengthens the same grayscale tones',()=>{
  const app=harness(),input=gray(8,8),fine=app.process(input,8,8,1,1,1),coarse=app.process(input,8,8,1,4,1);binary(coarse);assert.notDeepEqual([...fine],[...coarse]);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.equal(coarse[(y*8+x)*4],coarse[(Math.floor(y/4)*4*8+Math.floor(x/4)*4)*4]);
  const tones=gray(2,1,x=>x?175:80),soft=app.process(tones,2,1,0,1,.5),strong=app.process(tones,2,1,0,1,3);assert.ok(strong[0]<soft[0]);assert.ok(strong[4]>soft[4]);
});

test('tone updates coalesce and zoom refresh never rereads or reprocesses photo pixels',()=>{
  const app=harness();app.view.setSource();const initialWrites=app.writes;app.view.setStyle(1);app.view.setTone({grain:2,contrast:1.2});app.view.setTone({grain:4,contrast:2});assert.equal(app.pending,1);assert.equal(app.writes,initialWrites);app.flush();assert.equal(app.writes,initialWrites+1);assert.equal(app.draws,1);
  app.image.style.transform='translate(20px, -7px) scale(2)';app.view.refresh();app.view.refresh();app.view.setTone({grain:4,contrast:2});assert.equal(app.canvas().style.transform,app.image.style.transform);assert.equal(app.pending,0);assert.equal(app.writes,initialWrites+1);assert.equal(app.draws,1);
});

test('save and print snapshots flush the same visible processed pixels without changing the JPEG',()=>{
  const app=harness(384,16,gray(384,16));app.view.setSource();app.view.setStyle(3);app.view.setTone({grain:2,contrast:1.6});assert.equal(app.pending,1);
  const saved=app.view.snapshot(undefined,true),printed=app.view.snapshot();assert.equal(app.pending,0);assert.equal(saved.width,384);assert.equal(saved.height,16);assert.deepEqual([...saved.data],[...app.canvas().pixels]);assert.deepEqual([...printed.data],[...saved.data]);assert.equal(saved.photo,true);assert.equal(printed.photo,true);binary(saved.data);assert.equal(app.image.src,'blob:original-jpeg');
  const crop=app.view.snapshot({scale:2,x:0,y:0,width:384,height:16},true);assert.equal(crop.width,192);assert.equal(crop.height,8);binary(crop.data);
});

test('dither snapshots disable interpolation while grayscale retains smooth resizing',()=>{
  const app=harness(384,16,gray(384,16));app.view.setSource();for(let style=0;style<4;style++){app.view.setStyle(style);app.view.snapshot();assert.equal(app.canvases.at(-1).context.imageSmoothingEnabled,style===0)}
});

test('a separately decoded source replaces stale DOM pixels and limits the longest side to 2048',()=>{
  const app=harness(1,1),decoded={naturalWidth:4096,naturalHeight:2,pixels:gray(4096,2,90)};app.view.setSource(decoded);assert.equal(app.canvas().width,2048);assert.equal(app.canvas().height,1);assert.equal(app.canvas().pixels[0],90);assert.equal(app.image.src,'blob:original-jpeg');assert.equal(app.image.naturalWidth,1);
});

test('invalid input, clamped controls and disposal cannot leave stale rendering work or opacity',()=>{
  const app=harness(4,4,gray(4,4));assert.throws(()=>app.view.snapshot(),/ikkje klart/);app.view.setSource();app.view.show(true);app.view.setStyle(9);app.view.setTone({grain:99,contrast:99});app.flush();binary(app.canvas().pixels);app.view.setStyle(2);assert.equal(app.pending,1);app.view.dispose();app.view.dispose();assert.equal(app.pending,0);assert.equal(app.canvas().removed,true);assert.equal(app.image.style.opacity,'');const writes=app.writes;app.view.setSource();app.view.show(true);app.view.setTone({grain:1});app.flush();assert.equal(app.writes,writes);assert.throws(()=>app.view.snapshot(),/ikkje klart/);
  const empty=harness(0,0);assert.throws(()=>empty.view.setSource(),/ikkje klart/);
});
