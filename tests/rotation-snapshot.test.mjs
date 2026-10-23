import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../vendor/photo.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
function harness(){
  const canvases=[];
  const document={createElement(){
    const canvas={width:0,height:0},matrix=[1,0,0,1,0,0];let pixels;
    const allocate=()=>pixels??=new Uint8ClampedArray(canvas.width*canvas.height*4);
    const context={
      fillRect(){allocate();for(let i=3;i<pixels.length;i+=4)pixels[i]=255},
      translate(x,y){matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y},
      scale(x,y){matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y},
      rotate(angle){const [a,b,c,d]=matrix,cos=Math.cos(angle),sin=Math.sin(angle);matrix[0]=a*cos+c*sin;matrix[1]=b*cos+d*sin;matrix[2]=c*cos-a*sin;matrix[3]=d*cos-b*sin},
      drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh){
        allocate();canvas.draw=[sx,sy,sw,sh,dx,dy,dw,dh];
        const [a,b,c,d,e,f]=matrix,det=a*d-b*c;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
          const px=x+.5-e,py=y+.5-f,localX=(d*px-c*py)/det,localY=(-b*px+a*py)/det;
          if(localX<dx||localX>=dx+dw||localY<dy||localY>=dy+dh)continue;
          const ix=Math.min(image.width-1,Math.max(0,Math.floor(sx+(localX-dx)/dw*sw))),iy=Math.min(image.height-1,Math.max(0,Math.floor(sy+(localY-dy)/dh*sh)));
          const from=(iy*image.width+ix)*4,to=(y*canvas.width+x)*4;pixels.set(image.data.subarray(from,from+4),to);
        }
      },
      getImageData(){return {data:allocate().slice()}}
    };
    canvas.getContext=()=>context;canvas.context=context;canvases.push(canvas);return canvas;
  }};
  const context=vm.createContext({document,Uint8ClampedArray,Math,Number,Error});vm.runInContext(source,context);
  return {snapshot:context.photoSnapshot,canvases};
}
function image(width,height,value=(x,y)=>y*width+x+1){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=value(x,y);data[i+1]=17;data[i+2]=29;data[i+3]=255}
  return {width,height,data};
}
const red=pixels=>Array.from(pixels.data).filter((_,index)=>index%4===0);

test('quarter turns preserve every source pixel with clockwise preview orientation',()=>{
  const original=image(2,3);
  for(const [rotation,width,height,expected] of [[90,3,2,[5,3,1,6,4,2]],[-90,3,2,[2,4,6,1,3,5]],[180,2,3,[6,5,4,3,2,1]],[450,3,2,[5,3,1,6,4,2]]]){
    const app=harness(),result=app.snapshot(original,{rotation},true,true);
    assert.equal(result.width,width);assert.equal(result.height,height);assert.deepEqual(red(result),expected);assert.equal(result.photo,true);
    assert.equal(app.canvases[0].context.imageSmoothingEnabled,false);
  }
});

test('oblique rotation expands the output and fills its exposed corners with opaque black',()=>{
  const app=harness(),original=image(8,4),result=app.snapshot(original,{rotation:37},true,true);
  assert.equal(result.width,9);assert.equal(result.height,9);
  for(const pixel of [0,result.width-1,(result.height-1)*result.width,result.width*result.height-1])assert.deepEqual([...result.data.slice(pixel*4,pixel*4+4)],[0,0,0,255]);
  assert.ok(red(result).some(value=>value>0));assert.ok(result.data.every((value,index)=>index%4!==3||value===255));
  assert.deepEqual([...original.data], [...image(8,4).data]);
});

test('rotated print snapshots preserve the expanded aspect ratio and the selected interpolation',()=>{
  const app=harness(),result=app.snapshot(image(640,960),{rotation:90},false,true);
  assert.equal(result.width,384);assert.equal(result.height,256);assert.equal(app.canvases[0].context.imageSmoothingEnabled,false);
  const smooth=harness();smooth.snapshot(image(4,2),{rotation:20},true,false);assert.equal(smooth.canvases[0].context.imageSmoothingEnabled,true);
});

test('zero, complete and invalid turns retain the exact unrotated path including alpha',()=>{
  const original=image(4,2);original.data[3]=128;
  for(const rotation of [undefined,0,360,-720,NaN,Infinity]){
    const app=harness(),result=app.snapshot(original,{rotation},true,true);
    assert.equal(result.width,4);assert.equal(result.height,2);assert.deepEqual([...result.data],[...original.data]);assert.deepEqual(app.canvases[0].draw,[0,0,4,2,0,0,4,2]);
  }
});
