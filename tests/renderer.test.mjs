import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { gaussianSplats } from '../pointcloud/math.mjs';
import { nearestC64, PRIMITIVE_MODES, PRIMITIVE_BAYER, normalizePrimitiveLevel, primitiveDimensions } from '../pointcloud/primitive.mjs';
import { attachViewerGestures, progressiveIndices } from '../vendor/viewer-gestures.mjs';

const source=await readFile(new URL('../vendor/scene.mjs',import.meta.url),'utf8'),renderer=source.slice(source.indexOf('function renderScene('),source.indexOf('\nexport async function createDepthScene'));
function harness(options={}){
  const frames=new Map(),contexts=[];let frameId=0,sorts=0,uploads=0,fail=false,now=0;
  const host={clientWidth:300,clientHeight:600,children:[],appendChild(canvas){canvas.parent=this;this.children.push(canvas)}};
  class Canvas extends EventTarget{
    constructor(){super();this.style={};this.width=300;this.height=600;this.captures=new Set()}
    get clientWidth(){return host.clientWidth}get clientHeight(){return host.clientHeight}
    getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight}}
    getContext(type){if(type==='2d')return {drawImage(){},getImageData:(x,y,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)})};if(type!=='webgl')return null;if(fail)return null;if(this.gl)return this.gl;this.gl=makeGL(this);contexts.push(this.gl);return this.gl}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(canvas=>canvas!==this)}
    setPointerCapture(id){this.captures.add(id)}hasPointerCapture(id){return this.captures.has(id)}releasePointerCapture(id){this.captures.delete(id)}
    emit(type,details={}){const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries({pointerType:'touch',pointerId:1,clientX:100,clientY:100,...details}))Object.defineProperty(event,key,{value});this.dispatchEvent(event)}
  }
  function makeGL(canvas){
    let constant=100;const values=new Map(),uniforms={},draws=[];
    const target={uniforms,draws,lost:false,isContextLost(){return this.lost},getParameter:()=>[1,64],getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:(program,name)=>({aPosition:0,aScale:1,aColor:2,p:0})[name],getUniformLocation:(program,name)=>name,getError:()=>0,
      getExtension:()=>({loseContext(){target.lost=true;canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}))}}),
      uniform1f:(name,value)=>uniforms[name]=value,uniform2f:(name,x,y)=>uniforms[name]=[x,y],uniformMatrix3fv:(name,transpose,value)=>uniforms[name]=Array.from(value),
      bufferData(type,data,usage){if(usage===gl.DYNAMIC_DRAW)uploads++},drawArrays(mode,first,count){draws.push({mode,count})}
    };
    const gl=new Proxy(target,{get(object,key){if(key in object)return object[key];if(/^[A-Z_0-9]+$/.test(key)){if(!values.has(key))values.set(key,constant++);return values.get(key)}if(key.startsWith('create'))return ()=>({});if(key==='checkFramebufferStatus')return ()=>gl.FRAMEBUFFER_COMPLETE;return ()=>{}}});return gl;
  }
  class Indices extends Uint32Array{sort(compare){sorts++;return super.sort(compare)}}
  const context=vm.createContext({document:{createElement:()=>new Canvas()},Event,Float32Array,Uint32Array:Indices,DataView,Map,Math,performance:{now:()=>now},matchMedia:()=>({matches:options.reduced===true}),nearestC64,PRIMITIVE_MODES,PRIMITIVE_BAYER,normalizePrimitiveLevel,primitiveDimensions,attachViewerGestures,progressiveIndices,
    requestAnimationFrame:callback=>{const id=++frameId;frames.set(id,callback);return id},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{observe(){}disconnect(){}}
  });vm.runInContext(renderer,context);
  const count=256,positions=new Float32Array(count*3),colors=new Uint8Array(count*3).fill(150);for(let i=0;i<count;i++){positions[i*3]=(i%16-8)/16;positions[i*3+1]=(Math.floor(i/16)-8)/16;positions[i*3+2]=Math.sin(i)*.1}
  const cloud={count,positions,colors,center:[0,0,-1],stride:2,focalEstimate:16,radius:1},controller=new AbortController(),viewer=context.renderScene(host,cloud,gaussianSplats(cloud),controller.signal);
  const flush=(elapsed=16)=>{now+=elapsed;for(const [id,callback]of [...frames]){frames.delete(id);callback(now)}};flush();
  return {host,viewer,controller,flush,contexts,get canvas(){return host.children[0]},get gl(){return contexts.at(-1)},get sorts(){return sorts},get uploads(){return uploads},get pendingFrames(){return frames.size},set fail(value){fail=value}};
}

const state=app=>({rotation:app.gl.uniforms.uRotation,distance:app.gl.uniforms.uDistance,pan:app.gl.uniforms.uPan,pointScale:app.gl.uniforms.uPointScale,opacity:app.gl.uniforms.uOpacity,count:app.gl.draws.filter(draw=>draw.mode===app.gl.POINTS).at(-1).count});
function three(app,axis,delta){for(let id=1;id<=3;id++)app.canvas.emit('pointerdown',{pointerId:id,clientX:id*50,clientY:100});for(let id=1;id<=3;id++)app.canvas.emit('pointermove',{pointerId:id,clientX:id*50+(axis==='x'?delta:0),clientY:100+(axis==='y'?delta:0)});for(let id=1;id<=3;id++)app.canvas.emit('pointerup',{pointerId:id});app.flush()}

test('pan, zoom, definition, resize and palette changes reuse the sorted point buffer',()=>{
  const app=harness();assert.equal(app.sorts,1);assert.equal(app.uploads,1);
  app.canvas.emit('wheel',{deltaY:30});app.flush();app.viewer.setPrimitiveLevel(1);app.flush();app.viewer.setPrimitiveLevel(2);app.flush();app.host.clientWidth=400;app.viewer.refresh();app.flush();three(app,'x',30);
  app.canvas.emit('pointerdown',{pointerId:1,clientX:100,clientY:100});app.canvas.emit('pointerdown',{pointerId:2,clientX:200,clientY:100});app.canvas.emit('pointermove',{pointerId:1,clientX:110,clientY:100});app.canvas.emit('pointermove',{pointerId:2,clientX:210,clientY:100});app.canvas.emit('pointerup',{pointerId:1});app.canvas.emit('pointerup',{pointerId:2});app.flush();
  assert.equal(app.sorts,1);assert.equal(app.uploads,1);assert.notDeepEqual(app.gl.uniforms.uPan,[0,0]);
  app.canvas.emit('pointerdown',{pointerType:'mouse'});app.canvas.emit('pointermove',{pointerType:'mouse',clientX:130});app.canvas.emit('pointerup',{pointerType:'mouse'});app.flush();assert.equal(app.sorts,2);assert.equal(app.uploads,2);
  three(app,'y',90);assert.equal(app.sorts,3);assert.equal(app.uploads,3);assert.ok(state(app).count<256);app.viewer.dispose();
});

test('context loss rebuilds from cached points and preserves camera, density, definition and style',()=>{
  const app=harness(),initial=state(app);app.viewer.setPrimitiveLevel(2);three(app,'y',90);three(app,'x',30);app.canvas.emit('wheel',{deltaY:60});app.canvas.emit('pointerdown',{pointerType:'mouse'});app.canvas.emit('pointermove',{pointerType:'mouse',clientX:130,clientY:110});app.canvas.emit('pointerup',{pointerType:'mouse'});app.flush();
  const before=state(app),old=app.canvas,sorts=app.sorts,uploads=app.uploads;old.gl.getExtension().loseContext();app.flush();assert.notEqual(app.canvas,old);assert.deepEqual(state(app),before);assert.equal(app.sorts,sorts);assert.equal(app.uploads,uploads+1);assert.equal(app.gl.draws.at(-1).mode,app.gl.TRIANGLE_STRIP);
  app.viewer.resetView();app.flush();const reset=state(app);assert.deepEqual(reset.rotation,initial.rotation);assert.deepEqual(reset.pan,[0,0]);assert.equal(reset.distance,initial.distance);for(const key of ['count','pointScale','opacity'])assert.equal(reset[key],before[key]);assert.equal(app.gl.draws.at(-1).mode,app.gl.TRIANGLE_STRIP);app.viewer.dispose();
});

test('the initial camera matches the reference 48 degree sphere fit and slight viewing angle in both orientations',()=>{
  const app=harness(),initial=state(app),focal=1/Math.tan(24*Math.PI/180),direction=[.16,.045,1],length=Math.hypot(...direction),rotation=initial.rotation;
  const transformed=[0,1,2].map(row=>direction.reduce((sum,value,column)=>sum+value*rotation[column*3+row],0)/length);assert.ok(Math.abs(transformed[0])<1e-7&&Math.abs(transformed[1])<1e-7&&Math.abs(transformed[2]-1)<1e-7);
  for(const [width,height]of [[390,844],[844,390]]){app.host.clientWidth=width;app.host.clientHeight=height;app.viewer.refresh();app.flush();const uniforms=app.gl.uniforms,halfAngle=Math.min(24*Math.PI/180,Math.atan(Math.tan(24*Math.PI/180)*width/height));assert.equal(uniforms.uFocal,focal);assert.ok(Math.abs(uniforms.uDistance-1.08/Math.sin(halfAngle))<1e-12);assert.deepEqual(uniforms.uRotation,initial.rotation)}app.viewer.dispose();
});

test('failed automatic GPU recovery reports the error and an explicit refresh can retry without new geometry',()=>{
  const app=harness(),errors=[];app.viewer.onError=error=>errors.push(error);const sorts=app.sorts;app.fail=true;app.gl.getExtension().loseContext();app.flush();assert.equal(app.canvas,undefined);assert.equal(errors.length,1);assert.equal(errors[0].code,'SCENE_CONTEXT_LOST');assert.equal(app.viewer.refresh(),false);assert.equal(errors.length,2);
  app.fail=false;assert.equal(app.viewer.refresh(),true);app.flush();assert.ok(app.canvas);assert.equal(state(app).count,256);assert.equal(app.sorts,sorts);app.controller.abort();app.flush();assert.equal(app.canvas,undefined);assert.equal(app.viewer.refresh(),false);assert.equal(errors.length,2);
});

test('reveal advances over the native point buffer without repeated sorting or uploads and then stops',()=>{
  const app=harness();assert.equal(app.gl.uniforms.uReveal,1/256);assert.equal(app.pendingFrames,1);app.flush(800);assert.equal(app.gl.uniforms.uReveal,1/256+255/256*.2**6);app.flush(800);assert.equal(app.gl.uniforms.uReveal,1/256+255/256*.4**6);app.flush(1080);assert.equal(app.gl.uniforms.uReveal,1/256+255/256*.67**6);app.flush(1320);
  assert.equal(app.gl.uniforms.uReveal,1);assert.equal(app.pendingFrames,0);assert.equal(app.sorts,1);assert.equal(app.uploads,1);assert.ok(app.gl.draws.every(draw=>draw.mode!==app.gl.POINTS||draw.count===256));
  app.viewer.setPrimitiveLevel(1);app.viewer.resetView();app.flush(1000);assert.equal(app.gl.uniforms.uReveal,1);assert.equal(app.pendingFrames,0);app.viewer.dispose();
});

test('reduced motion skips reveal and hidden host dimensions pause it without a frame loop',()=>{
  const reduced=harness({reduced:true});assert.equal(reduced.gl.uniforms.uReveal,1);assert.equal(reduced.pendingFrames,0);reduced.viewer.dispose();
  const app=harness();app.flush(1000);const before=app.gl.uniforms.uReveal;assert.equal(before,1/256+255/256*.25**6);app.host.clientWidth=0;app.flush(250);assert.equal(app.pendingFrames,0);
  app.host.clientWidth=300;app.viewer.refresh();app.flush(5000);assert.equal(app.gl.uniforms.uReveal,before);app.flush(3000);assert.equal(app.gl.uniforms.uReveal,1);assert.equal(app.pendingFrames,0);app.viewer.dispose();
});

test('context recovery preserves reveal progress and snapshots permanently finish the existing scene',()=>{
  const app=harness();app.flush(1200);const before=app.gl.uniforms.uReveal;app.gl.getExtension().loseContext();app.flush(500);assert.equal(app.gl.uniforms.uReveal,before);
  const image=app.viewer.snapshot(true);assert.equal(image.width,300);assert.equal(image.height,600);assert.equal(app.gl.uniforms.uReveal,1);assert.equal(app.pendingFrames,0);
  app.host.clientWidth=0;app.viewer.snapshot(true);assert.equal(app.canvas.width,300);app.host.clientWidth=300;app.gl.getExtension().loseContext();app.flush(1000);assert.equal(app.gl.uniforms.uReveal,1);assert.equal(app.pendingFrames,0);app.viewer.dispose();
});

test('disposal cancels an unfinished reveal and prevents further rendering',()=>{
  const app=harness(),draws=app.gl.draws.length;assert.equal(app.pendingFrames,1);app.controller.abort();assert.equal(app.pendingFrames,0);app.flush(2000);assert.equal(app.gl.draws.length,draws);assert.equal(app.canvas,undefined);
});
