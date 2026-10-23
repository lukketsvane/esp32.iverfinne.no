import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/viewfinder.mjs',import.meta.url),'utf8')).replace(/^import .*\r?\n/gm,'').replace('export class','class'),processor=(await readFile(new URL('../vendor/photo-view.mjs',import.meta.url),'utf8')).split('export function createPhotoView')[0].replace(/^import .*\r?\n/gm,'').replace('export function','function');
function finder(){
  const draws=[],painted=[],parent={style:{}},frames=new Map();let next=0;
  const output={createImageData:(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}),putImageData:image=>painted.push(image.data.slice()),fillRect(){}};
  const sample={drawImage:(...args)=>draws.push(args),getImageData:(x,y,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4){data[i]=(i*7)%256;data[i+1]=(i*13+80)%256;data[i+2]=(i*23+40)%256;data[i+3]=255}return {data}}};
  const document={hidden:false,createElement:()=>({getContext:()=>sample})},canvas={parentElement:parent,ownerDocument:document,style:{},getContext:()=>output};
  const context=vm.createContext({document,HTMLVideoElement:class{},Float32Array,Uint8ClampedArray,Math,Number,requestAnimationFrame:callback=>{frames.set(++next,callback);return next},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(processor+'\n'+source+'\nglobalThis.finder=new Viewfinder(globalThis.canvas);',Object.assign(context,{canvas}));
  return {view:context.finder,canvas,parent,draws,painted,document,frames,frame(time){const [id,callback]=frames.entries().next().value;frames.delete(id);callback(time)}};
}

test('landscape and portrait viewfinders show the entire captured frame without cropping',()=>{
  const {view,canvas,parent,draws}=finder();
  for(const [width,height] of [[1920,1080],[1600,1200],[1080,1920]]){
    const image={width,height};view.source=image;view.draw(1000);
    assert.deepEqual(draws.at(-1),[image,0,0,canvas.width,canvas.height]);
    assert.equal(Number(parent.style.aspectRatio),width/height);
    assert.ok(Math.abs(canvas.width/canvas.height-width/height)<.01);
    assert.ok(Math.abs(canvas.width*canvas.height-86400)<500);
  }
  view.dispose();
});

test('an unchanged camera format reuses its output buffer and rotation updates it',()=>{
  const {view}=finder();view.source={width:1600,height:1200};view.draw(1000);
  const pixels=view.output;view.draw(1100);assert.equal(view.output,pixels);
  view.source={width:1200,height:1600};view.draw(1200);assert.notEqual(view.output,pixels);view.dispose();
});

test('all live photo styles are monochrome and the three dithers remain strictly binary',()=>{
  const app=finder();app.view.source={width:320,height:240};const hashes=[];
  for(let style=0;style<4;style++){app.view.setStyle(style);app.view.draw();const data=app.painted.at(-1);let middle=0;for(let i=0;i<data.length;i+=4){assert.equal(data[i],data[i+1]);assert.equal(data[i],data[i+2]);if(data[i]!==0&&data[i]!==255)middle++}assert.equal(middle>0,style===0);hashes.push(Buffer.from(data).toString('base64'))}
  assert.equal(new Set(hashes).size,4);app.view.setTone({grain:4,contrast:2});app.view.draw();assert.notEqual(Buffer.from(app.painted.at(-1)).toString('base64'),hashes[3]);app.view.dispose();
});

test('the animation samples at most twenty frames per second and skips inactive or hidden camera work',()=>{
  const app=finder();app.view.source={width:320,height:240};for(const time of [0,16,32,48,50,66,100])app.frame(time);assert.equal(app.draws.length,3);app.document.hidden=true;app.frame(150);assert.equal(app.draws.length,3);app.document.hidden=false;app.view.active=false;app.frame(200);assert.equal(app.draws.length,3);app.view.active=true;app.frame(250);assert.equal(app.draws.length,4);app.view.dispose();assert.equal(app.frames.size,0);assert.equal(app.view.source,null);
});

test('visible preview pixels match the finder size to avoid resampling ordered dither into moire',()=>{
  const app=finder();let width=166;app.canvas.getBoundingClientRect=()=>({width});app.view.source={width:640,height:480};app.view.draw();assert.equal(app.canvas.width,166);assert.equal(app.canvas.height,125);const buffer=app.view.output;app.view.draw();assert.equal(app.view.output,buffer);width=200;app.view.draw();assert.equal(app.canvas.width,200);assert.equal(app.canvas.height,150);assert.notEqual(app.view.output,buffer);app.view.dispose();
});
