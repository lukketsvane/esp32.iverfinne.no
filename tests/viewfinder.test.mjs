import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/viewfinder.mjs',import.meta.url),'utf8')).replace(/^import .*\r?\n/gm,'').replace('export class','class'),processor=(await readFile(new URL('../vendor/photo-view.mjs',import.meta.url),'utf8')).split('export function createPhotoView')[0].replace(/^import .*\r?\n/gm,'').replace('export function','function');
function finder(solid=null){
  const draws=[],painted=[],parent={style:{}},frames=new Map();let next=0;
  const output={createImageData:(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}),putImageData:image=>painted.push(image.data.slice()),fillRect(){}};
  const sample={createImageData:output.createImageData,putImageData:output.putImageData,drawImage:(...args)=>draws.push(args),getImageData:(x,y,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4){data[i]=solid??(i*7)%256;data[i+1]=solid??(i*13+80)%256;data[i+2]=solid??(i*23+40)%256;data[i+3]=255}return {data}}};
  const document={hidden:false,createElement:()=>({getContext:()=>sample})},canvas={parentElement:parent,ownerDocument:document,style:{},getContext:()=>output};
  const context=vm.createContext({document,HTMLVideoElement:class{},Float32Array,Uint8ClampedArray,Math,Number,requestAnimationFrame:callback=>{frames.set(++next,callback);return next},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(processor+'\n'+source+'\nglobalThis.finder=new Viewfinder(globalThis.canvas);',Object.assign(context,{canvas}));
  return {view:context.finder,canvas,parent,draws,painted,document,frames,frame(time){const [id,callback]=frames.entries().next().value;frames.delete(id);callback(time)}};
}

test('landscape and portrait sources fill the fixed reference finder with a centered crop',()=>{
  const {view,canvas,draws}=finder();
  for(const [width,height,crop] of [[1920,1080,[600,0,720,1080]],[1600,1200,[400,0,800,1200]],[1080,1920,[0,150,1080,1620]]]){
    const image={width,height};view.source=image;view.draw(1000);
    assert.deepEqual(draws.at(-1),[image,...crop,0,0,240,360]);
    assert.equal(canvas.width/canvas.height,2/3);assert.equal(image.width,width);assert.equal(image.height,height);
  }
  view.dispose();
});

test('camera orientation changes retain the reference raster and reuse its output buffer',()=>{
  const {view}=finder();view.source={width:1600,height:1200};view.draw(1000);
  const pixels=view.output;view.draw(1100);assert.equal(view.output,pixels);
  view.source={width:1200,height:1600};view.draw(1200);assert.equal(view.output,pixels);view.dispose();
});

test('the optical finder has opaque black curved edges and a bright undistorted center',()=>{
  const app=finder(255);app.view.source={width:1600,height:1200};app.view.draw();const pixels=app.painted[0],w=app.canvas.width,h=app.canvas.height;let lit=0;
  for(let i=0;i<pixels.length;i+=4){if(pixels[i])lit++;assert.equal(pixels[i+3],255)}
  for(const at of [0,(w-1)*4,(h-1)*w*4,(h*w-1)*4])assert.equal(pixels[at],0);
  assert.ok(pixels[(Math.floor(h/2)*w+Math.floor(w/2))*4]>220);assert.ok(lit>w*h*.5&&lit<w*h*.9);app.view.dispose();
});

test('all four live photo styles remain strictly black and white',()=>{
  const app=finder();app.view.source={width:320,height:240};const hashes=[];
  for(let style=0;style<4;style++){app.view.setStyle(style);app.view.draw();const data=app.painted.at(-1);for(let i=0;i<data.length;i+=4){assert.equal(data[i],data[i+1]);assert.equal(data[i],data[i+2]);assert.ok(data[i]===0||data[i]===255)}hashes.push(Buffer.from(data).toString('base64'))}
  assert.equal(new Set(hashes).size,4);app.view.setTone({grain:4,contrast:2});app.view.draw();assert.notEqual(Buffer.from(app.painted.at(-1)).toString('base64'),hashes[3]);app.view.dispose();
});

test('live photo tone controls cannot produce gray pixels at any style or grain setting',()=>{
  const app=finder();app.canvas.getBoundingClientRect=()=>({width:24});app.view.source={width:320,height:240};
  for(let style=0;style<4;style++)for(let grain=1;grain<=8;grain++)for(const contrast of [.5,1,3]){
    app.view.setStyle(style);app.view.setTone({grain,contrast});app.view.draw();const data=app.painted.at(-1);
    for(let i=0;i<data.length;i+=4){assert.equal(data[i],data[i+1]);assert.equal(data[i],data[i+2]);assert.ok(data[i]===0||data[i]===255);assert.equal(data[i+3],255)}
  }
  app.view.dispose();
});

test('the animation samples at most twenty frames per second and skips inactive or hidden camera work',()=>{
  const app=finder();app.view.source={width:320,height:240};for(const time of [0,16,32,48,50,66,100])app.frame(time);assert.equal(app.draws.length,3);app.document.hidden=true;app.frame(150);assert.equal(app.draws.length,3);app.document.hidden=false;app.view.active=false;app.frame(200);assert.equal(app.draws.length,3);app.view.active=true;app.frame(250);assert.equal(app.draws.length,4);app.view.dispose();assert.equal(app.frames.size,0);assert.equal(app.view.source,null);
});

test('visible preview pixels match the finder size to avoid resampling ordered dither into moire',()=>{
  const app=finder();let width=166;app.canvas.getBoundingClientRect=()=>({width});app.view.source={width:640,height:480};app.view.draw();assert.equal(app.canvas.width,166);assert.equal(app.canvas.height,249);const buffer=app.view.output;app.view.draw();assert.equal(app.view.output,buffer);width=200;app.view.draw();assert.equal(app.canvas.width,200);assert.equal(app.canvas.height,300);assert.notEqual(app.view.output,buffer);app.view.dispose();
});

test('captured frames retain the finder crop and optical geometry at native resolution',()=>{
  const app=finder(255);
  for(const [width,height,expected,crop]of [[640,480,[320,480],[160,0,320,480]],[1600,1200,[800,1200],[400,0,800,1200]],[1920,1080,[720,1080],[600,0,720,1080]],[1080,1920,[1080,1620],[0,150,1080,1620]]]){
    const image={width,height},frame=app.view.capture(image);assert.deepEqual([frame.width,frame.height],expected);assert.deepEqual(app.draws.at(-1),[image,...crop,0,0,...expected]);
    const pixels=app.painted.at(-1),center=(Math.floor(frame.height/2)*frame.width+Math.floor(frame.width/2))*4;
    assert.equal(pixels[0],0);assert.equal(pixels[3],255);assert.ok(pixels[center]>220);assert.equal(image.width,width);assert.equal(image.height,height);
  }
  const limited=app.view.capture({width:6000,height:4000});assert.equal(limited.width/limited.height,2/3);assert.ok(limited.height<=2048);app.view.dispose();
});

test('capture preserves color for depth while the preview thresholds its luminance and leaves live buffers intact',()=>{
  const app=finder();app.view.source={width:160,height:240};app.canvas.getBoundingClientRect=()=>({width:160});app.view.draw(1000);
  const preview=app.painted.at(-1),buffer=app.view.output,frame=app.view.capture(),color=app.painted.at(-1);assert.equal(frame.width,160);assert.equal(frame.height,240);assert.equal(app.view.output,buffer);assert.equal(app.canvas.width,160);
  let colored=false;for(let i=0;i<color.length;i+=4){const value=Math.round(color[i]*.2126+color[i+1]*.7152+color[i+2]*.0722);assert.equal(preview[i],value>=128?255:0);colored||=color[i]!==color[i+1]||color[i]!==color[i+2];assert.equal(color[i+3],255)}assert.equal(colored,true);
  assert.throws(()=>app.view.capture({width:0,height:240}),/ikkje klart/);app.view.dispose();assert.throws(()=>app.view.capture({width:160,height:240}),/ikkje klart/);
});
