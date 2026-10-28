import { inferenceSize, imageToPointCloud, pointStride, gaussianSplats } from '../pointcloud/math.mjs';
import { runStereoDepth } from './stereo-depth.mjs';
import { nearestC64, PRIMITIVE_MODES, PRIMITIVE_BAYER, normalizePrimitiveLevel, primitiveDimensions, qualityPointBudget } from '../pointcloud/primitive.mjs';
import { attachViewerGestures, progressiveIndices } from './viewer-gestures.mjs';
import { resolveColorScheme, gaussianInk } from './color-schemes.mjs';
import { renderRetroPixels } from './retro-modes.mjs';

let depthWorker=null,depthIdle=0,depthCancel=null;
function releaseDepthWorker(){clearTimeout(depthIdle);depthIdle=0;depthWorker?.terminate();depthWorker=null}
globalThis.addEventListener?.('pagehide',()=>{if(!depthCancel)releaseDepthWorker()});
globalThis.document?.addEventListener?.('visibilitychange',()=>{if(document.hidden&&!depthCancel)releaseDepthWorker()});

function estimateDepth(pixels,onProgress,signal){
  signal.throwIfAborted();depthCancel?.(new DOMException('Avbrote.','AbortError'));clearTimeout(depthIdle);
  return new Promise((resolve,reject)=>{
    const worker=depthWorker??=new Worker('/pointcloud/depth-worker-v2.mjs',{type:'module'});let finished=false;
    const finish=(error,result)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.onmessage=worker.onerror=null;if(depthCancel===finish)depthCancel=null;
      if(error||globalThis.document?.hidden)releaseDepthWorker();else depthIdle=setTimeout(releaseDepthWorker,30000);
      if(error)reject(error);else resolve(result);
    };
    const abort=()=>finish(signal.reason||new DOMException('Avbrote.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Djupneberekninga tok for lang tid. Prøv igjen.')),180000);
    depthCancel=finish;signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if(data.type==='progress')onProgress(data);
      else if(data.type==='error')finish(Object.assign(new Error(data.message),{code:data.code}));
      else if(data.type==='result')finish(null,{depth:new Float32Array(data.depth),width:data.width,height:data.height});
    };
    worker.onerror=()=>finish(new Error('Telefonen kunne ikkje berekne djupna.'));
    const copy=new Uint8ClampedArray(pixels.data);
    try{worker.postMessage({rgba:copy.buffer,width:pixels.width,height:pixels.height},[copy.buffer])}catch(error){finish(error)}
    if(signal.aborted)abort();
  });
}

function renderScene(host, cloud, bytes, signal, sourcePixels) {
  const points=new Float32Array(cloud.count*8),depths=new Float32Array(cloud.count),indices=Uint32Array.from(progressiveIndices(cloud.count)),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),colors=new Float32Array(cloud.count*4),rotation=new Float32Array(9);
  let order=indices.slice();
  for(let i=0;i<cloud.count;i++){const color=nearestC64(bytes[i*32+24],bytes[i*32+25],bytes[i*32+26]);for(let c=0;c<3;c++)colors[i*4+c]=color[c]/255;colors[i*4+3]=bytes[i*32+27]/255}
  const pointers=new Map(),focal=1/Math.tan(24*Math.PI/180),initialYaw=-Math.atan(.16),initialPitch=Math.atan(.045/Math.hypot(.16,1)),near=.01,far=Math.max(100,cloud.radius*1000);
  const fitDistance=(width,height)=>Math.max(.3,cloud.radius/Math.sin(Math.atan(Math.min(1,width/height)/focal))*1.08);
  let canvas=null,gpu=null,gestures=null,observer=null,yaw=initialYaw,pitch=initialPitch,zoom=1,panX=0,panY=0,pointScale=1,opacity=1,density=1,definition=.5,frame=0,disposed=false,primitiveLevel=0,targetWidth=0,targetHeight=0,geometryDirty=true,uploadDirty=true,needsGPU=false,paletteId='original',reveal=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?1:0,revealAt=null;
  function recolor(){
    const scheme=resolveColorScheme(paletteId),retro=scheme.mode?renderRetroPixels(sourcePixels,cloud.sourceWidth,cloud.sourceHeight,scheme.id):null;
    let minZ=Infinity,maxZ=-Infinity;
    for(let i=0;i<cloud.count;i++){
      const z=cloud.positions[i*3+2];minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
    const span=Math.max(1e-6,maxZ-minZ);
    for(let i=0;i<cloud.count;i++){
      const base=i*32+24,r=bytes[base],g=bytes[base+1],b=bytes[base+2];
      const z=cloud.positions[i*3+2],depth=(z-minZ)/span,light=(r*.2126+g*.7152+b*.0722)/255;
      const ink=retro?retro.subarray(cloud.pixelOffsets[i],cloud.pixelOffsets[i]+3):gaussianInk(scheme,depth,light,(i*17%31)/31-.5);
      for(let c=0;c<3;c++)colors[i*4+c]=ink[c]/255;
      colors[i*4+3]=bytes[base+3]/255;
    }
    geometryDirty=true;
  }
  function createGPU(next){
    const gl=next.getContext('webgl',{alpha:false,antialias:false});
    if(!gl)throw new Error('3D-vising er ikkje tilgjengeleg på telefonen.');
  const shaders = [];let program,buffer,screenProgram,screenBuffer,target,texture;
  const failed = () => {
    for(const item of shaders)gl.deleteShader(item);for(const item of [program,screenProgram])if(item)gl.deleteProgram(item);for(const item of [buffer,screenBuffer])if(item)gl.deleteBuffer(item);if(target)gl.deleteFramebuffer(target);if(texture)gl.deleteTexture(texture);gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw new Error('Telefonen kunne ikkje starte 3D-visinga.');
  };
  const shader = (type, source) => {
    const item = gl.createShader(type);shaders.push(item);gl.shaderSource(item, source);gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) failed();
    return item;
  };
  program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec3 aPosition;attribute float aScale;attribute vec4 aColor;uniform mat3 uRotation;uniform vec3 uRevealOrigin;uniform float uDistance,uFocal,uAspect,uHeight,uMaxPoint,uPointScale,uReveal;uniform vec2 uClip,uPan;varying vec4 vColor;varying float vReveal;void main(){vec3 p=uRotation*aPosition;p.xy+=uPan;float depth=uDistance-p.z;gl_Position=vec4(p.x*uFocal/uAspect,p.y*uFocal,depth*uClip.x+uClip.y,depth);gl_PointSize=clamp(aScale*uPointScale*uHeight*uFocal*3.0/max(depth,.02),1.0,uMaxPoint);vColor=aColor;float rank=fract(sin(dot(aPosition-uRevealOrigin,vec3(12.9898,78.233,37.719)))*43.7585453);vReveal=uReveal>=1.0?1.0:1.0-smoothstep(uReveal*.97,uReveal,rank);}'));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec4 vColor;varying float vReveal;uniform float uOpacity;void main(){vec2 p=gl_PointCoord*2.0-1.0;float r=dot(p,p);if(r>1.0)discard;float alpha=vColor.a*uOpacity*vReveal*exp(-4.5*r);if(alpha<.0039)discard;gl_FragColor=vec4(vColor.rgb,alpha);}'));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) failed();
  gl.useProgram(program);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DEPTH_TEST);gl.clearColor(0,0,0,1);
  buffer = gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  const attributes=[];
  for (const [name,size,offset] of [['aPosition',3,0],['aScale',1,12],['aColor',4,16]]) {
    attributes.push([gl.getAttribLocation(program,name),size,offset]);
  }
  const uniforms=Object.fromEntries(['uRotation','uDistance','uFocal','uAspect','uHeight','uMaxPoint','uClip','uPan','uPointScale','uOpacity','uReveal','uRevealOrigin'].map(name=>[name,gl.getUniformLocation(program,name)]));
  screenProgram=gl.createProgram();
  gl.attachShader(screenProgram,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(screenProgram,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform sampler2D image;uniform vec2 size;uniform vec3 palette[16];uniform int count,level;uniform float dither;float bayer(vec2 pixel){int index=int(mod(pixel.y,4.))*4+int(mod(pixel.x,4.));${PRIMITIVE_BAYER.map((value,index)=>`if(index==${index})return ${value}.;`).join('')}return 0.;}void main(){vec2 pixel=min(floor(uv*size),size-1.);vec3 color=texture2D(image,(pixel+.5)/size).rgb;float threshold=(bayer(vec2(pixel.x,size.y-1.-pixel.y))+.5)/16.-.5;if(level==3){float intensity=clamp(dot(color,vec3(.2126,.7152,.0722))/(.7152+.4*.0722)+threshold*dither,0.,1.);color=vec3(0.,intensity,.4*intensity);}else color=clamp(color+threshold*dither,0.,1.);vec3 closest=palette[0];float distance=4.;for(int i=0;i<16;i++){if(i<count){vec3 delta=color-palette[i];float next=dot(delta,delta);if(next<distance){distance=next;closest=palette[i];}}}gl_FragColor=vec4(closest,1.);}`));
  gl.linkProgram(screenProgram);if(!gl.getProgramParameter(screenProgram,gl.LINK_STATUS))failed();
  screenBuffer=gl.createBuffer();const screenPosition=gl.getAttribLocation(screenProgram,'p');gl.bindBuffer(gl.ARRAY_BUFFER,screenBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const screenUniforms=Object.fromEntries(['image','size','palette[0]','count','level','dither'].map(name=>[name,gl.getUniformLocation(screenProgram,name)]));
  target=gl.createFramebuffer();texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const [key,value] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)failed();gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.uniform1f(uniforms.uMaxPoint,gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);gl.uniform2f(uniforms.uClip,(far+near)/(far-near),-2*far*near/(far-near));gl.uniform3f(uniforms.uRevealOrigin,cloud.positions[0],cloud.positions[1],cloud.positions[2]);
    return {gl,shaders,program,buffer,screenProgram,screenBuffer,target,texture,attributes,uniforms,screenPosition,screenUniforms};
  }
  function releaseGPU(){
    gestures?.dispose();gestures=null;
    if(canvas){for(const [name,listener] of listeners)canvas.removeEventListener(name,listener);canvas.remove();canvas=null}
    if(gpu){const {gl,buffer,screenBuffer,program,screenProgram,target,texture,shaders}=gpu;gl.deleteBuffer(buffer);gl.deleteBuffer(screenBuffer);gl.deleteProgram(program);gl.deleteProgram(screenProgram);gl.deleteFramebuffer(target);gl.deleteTexture(texture);for(const item of shaders)gl.deleteShader(item);gl.getExtension('WEBGL_lose_context')?.loseContext();gpu=null}
    pointers.clear();
  }
  function mount(){
    releaseGPU();
    const next=document.createElement('canvas');next.style.cssText='display:block;width:100%;height:100%;touch-action:none;-webkit-touch-callout:none;user-select:none';
    gpu=createGPU(next);canvas=next;targetWidth=targetHeight=0;uploadDirty=true;
    gestures=attachViewerGestures(canvas,{
      initialDensity:density,
      onRotate:rotate,
      onTransform(dx,dy,scale,focusX,focusY){
        const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),pixelsToWorld=2/(focal*height),distance=fitDistance(width,height),before=distance/zoom*pixelsToWorld,nextZoom=Math.max(.4,Math.min(3,zoom*scale)),after=distance/nextZoom*pixelsToWorld;
        panX+=dx*before-(focusX-width/2)*(before-after);panY-=dy*before-(focusY-height/2)*(before-after);zoom=nextZoom;redraw();
      },
      onDensity(value){density=value;const count=Math.max(1,Math.min(cloud.count,Math.round(cloud.count*value)));if(count!==order.length){order=indices.slice(0,count);geometryDirty=true;redraw()}},
      onDefinition(value){definition=value;pointScale=4**(1-2*value);opacity=4**(value-.5);redraw()},
      onTouch(active){if(active)pointers.clear()}
    });
    gestures.state.definition=definition;
    for(const [name,listener] of listeners)canvas.addEventListener(name,listener,{passive:!['wheel','webglcontextlost'].includes(name)});
    host.appendChild(canvas);needsGPU=false;
  }
  function recover(){
    try{mount();return true}catch(error){needsGPU=true;api.onError?.(Object.assign(error,{code:'SCENE_CONTEXT_LOST'}));return false}
  }
  function rebuildPoints(){
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);rotation.set([cy,sp*sy,-cp*sy,0,cp,sp,sy,-sp*cy,cp*cy]);
    for(const i of order)depths[i]=rotation[2]*cloud.positions[i*3]+rotation[5]*cloud.positions[i*3+1]+rotation[8]*cloud.positions[i*3+2];
    order.sort((a,b)=>depths[a]-depths[b]);
    for(let n=0;n<order.length;n++){
      const i=order[n],at=n*8,p=i*3,c=i*4;
      points[at]=cloud.positions[p];points[at+1]=cloud.positions[p+1];points[at+2]=cloud.positions[p+2];points[at+3]=view.getFloat32(i*32+12,true);
      points[at+4]=colors[c];points[at+5]=colors[c+1];points[at+6]=colors[c+2];points[at+7]=colors[c+3];
    }
    geometryDirty=false;uploadDirty=true;
  }
  function draw(now=performance.now(),force=false){
    if(disposed||!gpu)return;
    const {gl,program,buffer,screenProgram,screenBuffer,target,texture,attributes,uniforms,screenPosition,screenUniforms}=gpu;
    if(gl.isContextLost()){needsGPU=true;redraw();return}
    if(!host.clientWidth||!host.clientHeight){revealAt=null;if(!force)return false}
    if(reveal<1){if(revealAt!==null)reveal=Math.min(1,reveal+Math.max(0,now-revealAt)/4000);revealAt=now}
    const ratio=Math.min(globalThis.devicePixelRatio||1,2)*(1+.45*(definition-.5)),width=Math.max(1,Math.round(host.clientWidth*ratio)||canvas.width),height=Math.max(1,Math.round(host.clientHeight*ratio)||canvas.height);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    const size=primitiveDimensions(primitiveLevel,width,height);
    if(primitiveLevel&&(size.width!==targetWidth||size.height!==targetHeight)){targetWidth=size.width;targetHeight=size.height;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,targetWidth,targetHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,null)}
    gl.bindFramebuffer(gl.FRAMEBUFFER,primitiveLevel?target:null);gl.viewport(0,0,size.width,size.height);gl.useProgram(program);gl.enable(gl.BLEND);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.disableVertexAttribArray(screenPosition);
    for(const [at,count,offset] of attributes){gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,count,gl.FLOAT,false,32,offset)}
    if(geometryDirty)rebuildPoints();
    if(uploadDirty){gl.bufferData(gl.ARRAY_BUFFER,points.subarray(0,order.length*8),gl.DYNAMIC_DRAW);uploadDirty=false}
    gl.uniformMatrix3fv(uniforms.uRotation,false,rotation);gl.uniform1f(uniforms.uFocal,focal);gl.uniform1f(uniforms.uDistance,fitDistance(width,height)/zoom);gl.uniform1f(uniforms.uAspect,width/height);gl.uniform1f(uniforms.uHeight,size.height);gl.uniform2f(uniforms.uPan,panX,panY);gl.uniform1f(uniforms.uPointScale,pointScale);gl.uniform1f(uniforms.uOpacity,opacity);gl.uniform1f(uniforms.uReveal,1/cloud.count+(1-1/cloud.count)*reveal**6);
    gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.POINTS,0,order.length);
    if(primitiveLevel){
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);gl.disable(gl.BLEND);gl.useProgram(screenProgram);gl.bindBuffer(gl.ARRAY_BUFFER,screenBuffer);for(const [at] of attributes)gl.disableVertexAttribArray(at);gl.enableVertexAttribArray(screenPosition);gl.vertexAttribPointer(screenPosition,2,gl.FLOAT,false,0,0);
      const mode=PRIMITIVE_MODES[primitiveLevel],ink=resolveColorScheme(paletteId).colors,palette=new Float32Array(48);for(let i=0;i<ink.length;i++)for(let c=0;c<3;c++)palette[i*3+c]=ink[i][c]/255;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(screenUniforms.image,0);gl.uniform2f(screenUniforms.size,size.width,size.height);gl.uniform3fv(screenUniforms['palette[0]'],palette);gl.uniform1i(screenUniforms.count,ink.length);gl.uniform1i(screenUniforms.level,primitiveLevel);gl.uniform1f(screenUniforms.dither,mode.dither/255);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    return reveal<1;
  }
  function redraw(){if(!disposed&&!frame)frame=requestAnimationFrame(now=>{frame=0;if(needsGPU&&!recover())return;if(draw(now))redraw()})}
  function rotate(dx,dy){if(!dx&&!dy)return;yaw+=dx*.006;pitch=Math.max(-1.2,Math.min(1.2,pitch+dy*.006));geometryDirty=true;redraw()}
  const down=event=>{if(event.pointerType==='touch')return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId)};
  const move=event=>{const old=pointers.get(event.pointerId);if(!old)return;rotate(event.clientX-old.x,event.clientY-old.y);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY})};
  const up=event=>pointers.delete(event.pointerId);
  const wheel=event=>{event.preventDefault();zoom=Math.max(.4,Math.min(3,zoom*Math.exp(-event.deltaY*.001)));redraw()};
  const lost=event=>{event.preventDefault();canvas.dispatchEvent(new Event('pointercancel',{bubbles:true}));needsGPU=true;revealAt=null;cancelAnimationFrame(frame);frame=0;redraw()};
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['wheel',wheel],['webglcontextlost',lost]];
  function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer?.disconnect();signal.removeEventListener('abort',dispose);releaseGPU()}
  const api={dispose,onError:null,refresh(){if(disposed)return false;if(needsGPU&&!recover())return false;redraw();return true},resetView(){geometryDirty||=yaw!==initialYaw||pitch!==initialPitch;yaw=initialYaw;pitch=initialPitch;panX=panY=0;zoom=1;api.refresh()},snapshot(native=false){
    if(disposed)throw new Error('Scena er lukka.');
    if(needsGPU&&!recover())throw new Error('3D-visinga er avbroten. Prøv igjen.');
    reveal=1;revealAt=null;cancelAnimationFrame(frame);frame=0;draw(performance.now(),true);
    if(!canvas||needsGPU)throw new Error('3D-visinga er avbroten. Prøv igjen.');
    const paper=document.createElement('canvas');paper.width=native?canvas.width:384;paper.height=native?canvas.height:Math.max(1,Math.min(1024,Math.round(384*canvas.height/canvas.width)));
    const context=paper.getContext('2d');if(!context)throw new Error('Kunne ikkje lese scena.');
    context.drawImage(canvas,0,0,paper.width,paper.height);return context.getImageData(0,0,paper.width,paper.height);
  },setPrimitiveLevel(level){const next=normalizePrimitiveLevel(level);if(!disposed&&next!==primitiveLevel){primitiveLevel=next;redraw()}},setPalette(id){const next=resolveColorScheme(id).id;if(!disposed&&next!==paletteId){paletteId=next;recolor();redraw()}}};
  mount();observer=globalThis.ResizeObserver?new ResizeObserver(redraw):null;observer?.observe(host);signal.addEventListener('abort',dispose,{once:true});redraw();if(signal.aborted)dispose();return api;
}

async function stereoScene(host,left,right,onProgress,signal,quality){
  const prediction=await runStereoDepth(left,right,{signal,onProgress});
  signal.throwIfAborted();onProgress({phase:'rendering'});
  const detail=prediction.pixels,budget=qualityPointBudget(quality),measured=prediction.validity.reduce((sum,value)=>sum+(value===1?1:0),0);
  const cloud=imageToPointCloud({rgba:detail.data,width:detail.width,height:detail.height,depth:prediction.depth,depthWidth:prediction.width,depthHeight:prediction.height,valid:prediction.validity,stride:measured<=budget?1:pointStride(detail.width,detail.height,budget)});
  return renderScene(host,cloud,gaussianSplats(cloud),signal,detail.data);
}

export async function createDepthScene(host, blob, onProgress = () => {}, signal = new AbortController().signal, quality = 2, right = null) {
  signal.throwIfAborted();
  if(right)return stereoScene(host,blob,right,onProgress,signal,quality);
  const image=new Image(),url=URL.createObjectURL(blob);let inference,detail;
  onProgress({phase:'reading'});
  try {
    image.src=url;await image.decode();signal.throwIfAborted();
    const size=inferenceSize(image.naturalWidth,image.naturalHeight),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Telefonen kunne ikkje lese biletet.');
    context.drawImage(image,0,0,size.width,size.height);inference=context.getImageData(0,0,size.width,size.height);
    const scale=Math.min(1,840/Math.max(image.naturalWidth,image.naturalHeight));
    const width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
    canvas.width=width;canvas.height=height;context.drawImage(image,0,0,width,height);
    detail=context.getImageData(0,0,width,height);canvas.width=canvas.height=1;
  } finally {URL.revokeObjectURL(url)}
  const prediction=await estimateDepth(inference,onProgress,signal);signal.throwIfAborted();onProgress({phase:'rendering'});
  const cloud=imageToPointCloud({rgba:detail.data,width:detail.width,height:detail.height,depth:prediction.depth,depthWidth:prediction.width,depthHeight:prediction.height,stride:pointStride(detail.width,detail.height,qualityPointBudget(quality))});
  const bytes=gaussianSplats(cloud),viewer=renderScene(host,cloud,bytes,signal,detail.data);signal.throwIfAborted();
  return viewer;
}
