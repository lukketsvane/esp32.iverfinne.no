import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/viewfinder.mjs',import.meta.url),'utf8')).replace('export class','class');
function finder(){
  const draws=[],parent={style:{}},output={putImageData(){},fillRect(){}};
  const sample={drawImage:(...args)=>draws.push(args),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)})};
  const canvas={parentElement:parent,getContext:type=>type==='webgl'?null:output};
  const context=vm.createContext({document:{hidden:false,createElement:()=>({getContext:()=>sample})},HTMLVideoElement:class{},ImageData:class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4)}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  vm.runInContext(source+'\nglobalThis.finder=new Viewfinder(globalThis.canvas);',Object.assign(context,{canvas}));
  return {view:context.finder,canvas,parent,draws};
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

test('an unchanged camera format reuses its pixel buffers and a rotation updates them',()=>{
  const {view}=finder();view.source={width:1600,height:1200};view.draw(1000);
  const pixels=view.output;view.draw(1100);assert.equal(view.output,pixels);
  view.source={width:1200,height:1600};view.draw(1200);assert.notEqual(view.output,pixels);view.dispose();
});
