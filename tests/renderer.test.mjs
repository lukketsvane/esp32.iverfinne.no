import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { gaussianSplats } from '../pointcloud/math.mjs';
import { nearestC64, PRIMITIVE_MODES, PRIMITIVE_BAYER, normalizePrimitiveLevel, primitiveDimensions } from '../pointcloud/primitive.mjs';
import { attachViewerGestures, progressiveIndices } from '../vendor/viewer-gestures.mjs';
import {COLOR_SCHEMES,resolveColorScheme,gaussianInk} from '../vendor/color-schemes.mjs';
import {renderRetroPixels} from '../vendor/retro-modes.mjs';
import {normalizeAdjustments,applyLevels,DEFAULT_ADJUSTMENTS} from '../vendor/image-adjustments.mjs';
import {processPhoto} from '../vendor/photo-view.mjs';

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
      uniform1f:(name,value)=>uniforms[name]=value,uniform1i:(name,value)=>uniforms[name]=value,uniform2f:(name,x,y)=>uniforms[name]=[x,y],uniformMatrix3fv:(name,transpose,value)=>uniforms[name]=Array.from(value),
      bufferData(type,data,usage){if(usage===gl.DYNAMIC_DRAW){uploads++;target.pointData=Array.from(data)}},drawArrays(mode,first,count){draws.push({mode,count})}
    };
    const gl=new Proxy(target,{get(object,key){if(key in object)return object[key];if(/^[A-Z_0-9]+$/.test(key)){if(!values.has(key))values.set(key,constant++);return values.get(key)}if(key.startsWith('create'))return ()=>({});if(key==='checkFramebufferStatus')return ()=>gl.FRAMEBUFFER_COMPLETE;return ()=>{}}});return gl;
  }
  class Indices extends Uint32Array{sort(compare){sorts++;return super.sort(compare)}}
  const context=vm.createContext({document:{createElement:()=>new Canvas()},devicePixelRatio:options.ratio??1,Event,Float32Array,Uint32Array:Indices,DataView,Map,Math,performance:{now:()=>now},matchMedia:()=>({matches:options.reduced===true}),nearestC64,resolveColorScheme,gaussianInk,renderRetroPixels,normalizeAdjustments,applyLevels,processPhoto,PRIMITIVE_MODES,PRIMITIVE_BAYER,normalizePrimitiveLevel,primitiveDimensions,attachViewerGestures,progressiveIndices,
    requestAnimationFrame:callback=>{const id=++frameId;frames.set(id,callback);return id},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{observe(){}disconnect(){}}
  });vm.runInContext(renderer,context);
  const count=256,positions=new Float32Array(count*3),colors=new Uint8Array(count*3).fill(150);for(let i=0;i<count;i++){positions[i*3]=(i%16-8)/16;positions[i*3+1]=(Math.floor(i/16)-8)/16;positions[i*3+2]=Math.sin(i)*.1}
  const sourcePixels=new Uint8ClampedArray(count*4),pixelOffsets=new Uint32Array(count);
  for(let i=0;i<count;i++){const at=i*4;pixelOffsets[i]=at;sourcePixels[at]=(i*17)%256;sourcePixels[at+1]=(i*31)%256;sourcePixels[at+2]=(i*7)%256;sourcePixels[at+3]=255}
  const cloud={count,positions,colors,pixelOffsets,sourceWidth:16,sourceHeight:16,center:[0,0,-1],stride:2,focalEstimate:16,radius:1},controller=new AbortController(),viewer=context.renderScene(host,cloud,gaussianSplats(cloud),controller.signal,sourcePixels);
  const flush=(elapsed=16)=>{now+=elapsed;for(const [id,callback]of [...frames]){frames.delete(id);callback(now)}};flush();
  return {host,viewer,controller,flush,contexts,cloud,sourcePixels,get canvas(){return host.children[0]},get gl(){return contexts.at(-1)},get sorts(){return sorts},get uploads(){return uploads},get pendingFrames(){return frames.size},set fail(value){fail=value}};
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


test('switching historic color systems recolors the cached higher-detail Gaussian points without a second inference',()=>{
  const app=harness(),start=app.uploads;
  for(const id of ['c64','zx','appleii']){
    app.viewer.setPalette(id);
    app.flush();
    assert.ok(app.uploads>start,id);
    assert.equal(app.gl.draws.at(-1).mode,app.gl.TRIANGLE_STRIP);
    assert.equal(app.gl.uniforms.level,0);
  }
  const raster=app.viewer.snapshot(true);
  assert.equal(raster.width,300);
  assert.equal(raster.height,600);
  app.viewer.dispose();
});

test('all nine Gaussian profiles share a CSS-pixel grid at every size and device pixel ratio',()=>{
  for(const ratio of [1,2,3]){
    const app=harness({ratio,reduced:true});
    for(const grain of [1,2,4,8]){
      app.viewer.setPixelSize(grain);
      for(const scheme of COLOR_SCHEMES){
        app.viewer.setPalette(scheme.id);app.viewer.setPrimitiveLevel(scheme.primitive);app.flush();
        assert.deepEqual(app.gl.uniforms.size,[Math.ceil(300/grain),Math.ceil(600/grain)],scheme.id+' at '+grain+' CSS pixels, DPR '+ratio);
        assert.equal(app.gl.draws.at(-1).mode,app.gl.TRIANGLE_STRIP);
      }
    }
    const sorts=app.sorts,uploads=app.uploads;
    app.viewer.setPixelSize(2);app.flush();assert.equal(app.sorts,sorts);assert.equal(app.uploads,uploads);
    app.viewer.setPixelSize(4);app.gl.getExtension().loseContext();app.flush();assert.deepEqual(app.gl.uniforms.size,[75,150]);
    app.viewer.resetView();app.flush();assert.deepEqual(app.gl.uniforms.size,[75,150]);
    app.viewer.dispose();
  }
});

test('pinch changes the global pixel size without moving the model and cancellation releases fingers',()=>{
  const app=harness({reduced:true}),requests=[];
  app.viewer.onPixelSize=value=>{requests.push(value);app.viewer.setPixelSize(value)};
  const before=state(app);
  app.canvas.emit('pointerdown',{pointerId:1,clientX:100,clientY:100});app.canvas.emit('pointerdown',{pointerId:2,clientX:200,clientY:100});
  app.canvas.emit('pointermove',{pointerId:1,clientX:50,clientY:100});app.canvas.emit('pointermove',{pointerId:2,clientX:250,clientY:100});app.flush();
  assert.equal(requests.at(-1),2);assert.deepEqual(app.gl.uniforms.size,[150,300]);assert.deepEqual(state(app),before);
  app.viewer.cancelGestures();assert.equal(app.canvas.captures.size,0);
  const count=requests.length;app.canvas.emit('pointermove',{pointerId:1,clientX:0,clientY:100});app.flush();assert.equal(requests.length,count);
  app.canvas.emit('wheel',{deltaY:-1000});app.flush();assert.ok(requests.at(-1)>2);assert.deepEqual(state(app),before);
  app.viewer.setPixelSize(99);app.flush();assert.deepEqual(app.gl.uniforms.size,[38,75]);
  app.viewer.setPixelSize(0);app.flush();assert.deepEqual(app.gl.uniforms.size,[300,600]);
  app.viewer.dispose();
});

test('two-finger translation continues to pan with shared pixel sizing and does not zoom the model',()=>{
  const app=harness({reduced:true});app.viewer.setPixelSize(4);app.viewer.onPixelSize=value=>app.viewer.setPixelSize(value);app.flush();
  const before=state(app);
  app.canvas.emit('pointerdown',{pointerId:1,clientX:100,clientY:100});app.canvas.emit('pointerdown',{pointerId:2,clientX:200,clientY:100});
  app.canvas.emit('pointermove',{pointerId:1,clientX:110,clientY:100});app.canvas.emit('pointermove',{pointerId:2,clientX:210,clientY:100});app.flush();
  assert.notDeepEqual(app.gl.uniforms.uPan,before.pan);assert.equal(app.gl.uniforms.uDistance,before.distance);assert.deepEqual(app.gl.uniforms.uRotation,before.rotation);assert.deepEqual(app.gl.uniforms.size,[75,150]);
  app.viewer.cancelGestures();app.viewer.dispose();
});

test('staggered two-finger panning cannot drift pixel size at either bound',()=>{
  for(const size of [1,8])for(const dx of [-20,20]){
    const app=harness({reduced:true}),sizes=[];app.viewer.setPixelSize(size);app.viewer.onPixelSize=value=>{sizes.push(value);app.viewer.setPixelSize(value)};
    app.canvas.emit('pointerdown',{pointerId:1,clientX:100,clientY:100});app.canvas.emit('pointerdown',{pointerId:2,clientX:300,clientY:100});
    for(let step=1;step<=4;step++){
      app.canvas.emit('pointermove',{pointerId:1,clientX:100+dx*step,clientY:100});app.canvas.emit('pointermove',{pointerId:2,clientX:300+dx*step,clientY:100});
      assert.equal(sizes.at(-1),size,'size '+size+', translation '+dx+', step '+step);
    }
    app.viewer.dispose();
  }
});

test('pinch remains anchored through bound reversal and reanchors after finger transitions',()=>{
  const app=harness({reduced:true}),sizes=[];app.viewer.setPixelSize(4);app.viewer.onPixelSize=value=>{sizes.push(value);app.viewer.setPixelSize(value)};
  const point=(type,id,x)=>app.canvas.emit(type,{pointerId:id,clientX:x,clientY:100});
  point('pointerdown',1,100);point('pointerdown',2,300);
  for(const [x,size]of [[1000,8],[500,8],[300,4],[120,1],[150,1],[300,4]]){point('pointermove',2,x);assert.equal(sizes.at(-1),size,'gap '+(x-100))}
  point('pointermove',2,200);assert.equal(sizes.at(-1),2);
  point('pointerdown',3,250);point('pointerup',3,250);point('pointermove',2,250);assert.equal(sizes.at(-1),3);
  point('pointerup',2,250);point('pointerdown',4,300);point('pointermove',4,500);assert.equal(sizes.at(-1),6);
  app.viewer.cancelGestures();point('pointerdown',1,100);point('pointerdown',2,300);point('pointermove',2,350);assert.equal(sizes.at(-1),7.5);
  app.viewer.dispose();
});

test('twist adds clockwise roll while preserving pinch size, pan and camera distance',()=>{
  const app=harness({reduced:true}),initial=state(app),rotations=[];
  app.viewer.onPixelSize=value=>app.viewer.setPixelSize(value);app.viewer.onRotation=value=>rotations.push(value);
  app.canvas.emit('pointerdown',{pointerId:1,clientX:100,clientY:100});app.canvas.emit('pointerdown',{pointerId:2,clientX:200,clientY:100});
  app.canvas.emit('pointermove',{pointerId:1,clientX:150,clientY:50});app.canvas.emit('pointermove',{pointerId:2,clientX:150,clientY:150});app.flush();
  assert.ok(Math.abs(app.viewer.rotation-90)<1e-9);assert.ok(Math.abs(rotations.at(-1)-90)<1e-9);assert.deepEqual(app.gl.uniforms.size,[300,600]);assert.equal(state(app).distance,initial.distance);assert.deepEqual(state(app).pan,initial.pan);
  const rotated=state(app).rotation;
  for(let column=0;column<3;column++){const at=column*3;assert.ok(Math.abs(rotated[at]-initial.rotation[at+1])<1e-6);assert.ok(Math.abs(rotated[at+1]+initial.rotation[at])<1e-6);assert.equal(rotated[at+2],initial.rotation[at+2])}
  app.viewer.cancelGestures();app.viewer.dispose();
});

test('panel rotation survives GPU recovery and reset restores initial orientation',()=>{
  const app=harness({reduced:true}),initial=state(app).rotation,changes=[];app.viewer.onRotation=value=>changes.push(value);
  app.viewer.setRotation(-135);app.flush();const rotated=state(app).rotation;assert.equal(app.viewer.rotation,-135);assert.notDeepEqual(rotated,initial);
  for(const value of [NaN,Infinity,undefined])app.viewer.setRotation(value);assert.equal(app.viewer.rotation,-135);assert.deepEqual(changes,[-135]);
  app.gl.getExtension().loseContext();app.flush();assert.equal(app.viewer.rotation,-135);assert.deepEqual(state(app).rotation,rotated);
  app.viewer.resetView();app.flush();assert.equal(app.viewer.rotation,0);assert.deepEqual(state(app).rotation,initial);assert.deepEqual(changes,[-135,0]);
  app.viewer.dispose();app.viewer.setRotation(90);assert.equal(app.viewer.rotation,0);assert.deepEqual(changes,[-135,0]);
});


test('scene level sliders recolor cached points once per frame and default controls retain profile colors',()=>{
  const app=harness({reduced:true});app.viewer.setPalette('bluecrt');app.viewer.setPrimitiveLevel(2);app.flush();
  const original=app.gl.pointData.slice(),start=app.uploads;
  app.viewer.setAdjustments(DEFAULT_ADJUSTMENTS);app.flush();assert.deepEqual(app.gl.pointData,original);assert.equal(app.uploads,start);
  for(const controls of [{black:110},{white:145},{gamma:2.8},{contrast:2.5}]){
    app.viewer.setAdjustments(controls);app.flush();assert.notDeepEqual(app.gl.pointData,original,JSON.stringify(controls));
    app.viewer.setAdjustments(DEFAULT_ADJUSTMENTS);app.flush();assert.deepEqual(app.gl.pointData,original);
  }
  const uploads=app.uploads,sorts=app.sorts;
  for(const gamma of [1.2,1.5,1.8,2])app.viewer.setAdjustments({gamma});
  assert.equal(app.uploads,uploads);assert.equal(app.pendingFrames,1);app.flush();assert.equal(app.uploads,uploads+1);assert.equal(app.sorts,sorts+1);
  const final=app.gl.pointData.slice();app.viewer.setAdjustments({gamma:2});app.flush();assert.deepEqual(app.gl.pointData,final);assert.equal(app.uploads,uploads+1);
  app.viewer.dispose();app.viewer.setAdjustments({gamma:1});assert.equal(app.pendingFrames,0);
});

test('scene explicit dithers use the same adjusted palette pixels as photo processing for all profiles',()=>{
  const app=harness({reduced:true});
  for(const scheme of COLOR_SCHEMES){
    app.viewer.setPalette(scheme.id);app.viewer.setPrimitiveLevel(scheme.primitive);
    for(const dither of ['threshold','bayer','floyd','atkinson']){
      const controls=normalizeAdjustments({black:20,white:220,gamma:1.6,contrast:1.2,dither,strength:.8});
      app.viewer.setAdjustments(controls);app.flush();
      const expected=processPhoto(app.sourcePixels,16,16,scheme.style,1,controls.contrast,scheme.id,controls),points=app.gl.pointData;
      for(let at=0;at<points.length;at+=8){
        const index=Math.round(points[at]*16+8)+Math.round(points[at+1]*16+8)*16;
        assert.deepEqual(points.slice(at+4,at+7),Array.from(new Float32Array(Array.from(expected.slice(index*4,index*4+3),value=>value/255))),scheme.id+' '+dither+' point '+index);
      }
      assert.equal(app.gl.uniforms.dither,0);assert.equal(app.gl.uniforms.level,1,'explicit style bypasses profile green/Bayer conversion');
    }
  }
  app.viewer.dispose();
});

test('profile dithering strength and adjusted historic colors persist through profile changes and context loss',()=>{
  const app=harness({reduced:true}),controls=normalizeAdjustments({black:25,white:225,gamma:1.5,contrast:1.2,strength:.35});
  app.viewer.setAdjustments(controls);
  for(const scheme of COLOR_SCHEMES){
    app.viewer.setPalette(scheme.id);app.viewer.setPrimitiveLevel(scheme.primitive);app.flush();
    assert.equal(app.gl.uniforms.dither,PRIMITIVE_MODES[scheme.primitive].dither/255*controls.strength);
    if(scheme.mode){
      const expected=renderRetroPixels(app.sourcePixels,16,16,scheme.id,controls.contrast,1,controls),points=app.gl.pointData;
      for(let at=0;at<points.length;at+=8){
        const index=Math.round(points[at]*16+8)+Math.round(points[at+1]*16+8)*16;
        assert.deepEqual(points.slice(at+4,at+7),Array.from(new Float32Array(Array.from(expected.slice(index*4,index*4+3),value=>value/255))));
      }
    }
  }
  const before=app.gl.pointData.slice(),uploads=app.uploads,sorts=app.sorts;
  app.gl.getExtension().loseContext();app.flush();assert.deepEqual(app.gl.pointData,before);assert.equal(app.uploads,uploads+1);assert.equal(app.sorts,sorts);
  app.viewer.setAdjustments({...controls,dither:'atkinson'});app.viewer.snapshot(true);assert.equal(app.pendingFrames,0);assert.equal(app.gl.uniforms.dither,0);
  const explicit=app.gl.pointData.slice();app.gl.getExtension().loseContext();app.flush();assert.deepEqual(app.gl.pointData,explicit);assert.equal(app.gl.uniforms.dither,0);app.viewer.dispose();
});
