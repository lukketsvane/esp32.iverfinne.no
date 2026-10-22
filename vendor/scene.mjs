import { inferenceSize, imageToPointCloud, pointStride, gaussianSplats } from '../pointcloud/math.mjs';

function estimateDepth(pixels, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/pointcloud/depth-worker.mjs', { type: 'module' });
    const finish = (error, result) => {
      clearTimeout(timer);signal.removeEventListener('abort', abort);worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(signal.reason || new DOMException('Avbrote.','AbortError'));
    const timer = setTimeout(() => finish(new Error('Djupneberekninga tok for lang tid. Prøv eit nytt bilete.')), 180000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data);
      else if (data.type === 'error') finish(new Error(data.message));
      else if (data.type === 'result') finish(null, { depth: new Float32Array(data.depth), width: data.width, height: data.height });
    };
    worker.onerror = () => finish(new Error('Telefonen kunne ikkje berekne djupna.'));
    const copy = new Uint8ClampedArray(pixels.data);
    try {worker.postMessage({ rgba: copy.buffer, width: pixels.width, height: pixels.height }, [copy.buffer])}
    catch(error){finish(error)}
    if (signal.aborted) abort();
  });
}

function renderScene(host, cloud, bytes, signal) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (!gl) throw new Error('3D-vising er ikkje tilgjengeleg på telefonen.');
  const shaders = [];
  const failed = () => {
    for(const item of shaders)gl.deleteShader(item);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw new Error('Telefonen kunne ikkje starte 3D-visinga.');
  };
  const shader = (type, source) => {
    const item = gl.createShader(type);shaders.push(item);gl.shaderSource(item, source);gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) failed();
    return item;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec3 aPosition;attribute float aScale;attribute vec4 aColor;uniform mat3 uRotation;uniform float uDistance,uFocal,uAspect,uHeight,uMaxPoint;uniform vec2 uClip;varying vec4 vColor;void main(){vec3 p=uRotation*aPosition;float depth=uDistance-p.z;gl_Position=vec4(p.x*uFocal/uAspect,p.y*uFocal,depth*uClip.x+uClip.y,depth);gl_PointSize=clamp(aScale*uHeight*uFocal*3.0/max(depth,.02),1.0,uMaxPoint);vColor=aColor;}'));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec4 vColor;void main(){vec2 p=gl_PointCoord*2.0-1.0;float r=dot(p,p);if(r>1.0)discard;float alpha=vColor.a*exp(-4.5*r);if(alpha<.0039)discard;gl_FragColor=vec4(vColor.rgb,alpha);}'));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) failed();
  gl.useProgram(program);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DEPTH_TEST);gl.clearColor(0,0,0,1);
  const buffer = gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for (const [name,size,offset] of [['aPosition',3,0],['aScale',1,12],['aColor',4,16]]) {
    const at=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,32,offset);
  }
  const uniforms=Object.fromEntries(['uRotation','uDistance','uFocal','uAspect','uHeight','uMaxPoint','uClip'].map(name=>[name,gl.getUniformLocation(program,name)]));
  const points=new Float32Array(cloud.count*8),depths=new Float32Array(cloud.count),order=Uint32Array.from({length:cloud.count},(_,i)=>i),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const pointers=new Map();let yaw=0,pitch=0,zoom=1,frame=0,disposed=false;
  const focal=1/Math.tan(24*Math.PI/180),distance=Math.max(.3,cloud.radius*2.8),near=.01,far=Math.max(100,distance*20);
  gl.uniform1f(uniforms.uFocal,focal);gl.uniform1f(uniforms.uMaxPoint,gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);gl.uniform2f(uniforms.uClip,(far+near)/(far-near),-2*far*near/(far-near));
  function draw() {
    frame=0;if(disposed)return;
    const ratio=Math.min(globalThis.devicePixelRatio||1,1.5),width=Math.max(1,Math.round(host.clientWidth*ratio)),height=Math.max(1,Math.round(host.clientHeight*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height)}
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const rotation=new Float32Array([cy,sp*sy,-cp*sy,0,cp,sp,sy,-sp*cy,cp*cy]);
    for(let i=0;i<cloud.count;i++)depths[i]=rotation[2]*cloud.positions[i*3]+rotation[5]*cloud.positions[i*3+1]+rotation[8]*cloud.positions[i*3+2];
    order.sort((a,b)=>depths[a]-depths[b]);
    for(let n=0;n<order.length;n++){
      const i=order[n],at=n*8;
      points.set(cloud.positions.subarray(i*3,i*3+3),at);points[at+3]=view.getFloat32(i*32+12,true);
      for(let c=0;c<4;c++)points[at+4+c]=bytes[i*32+24+c]/255;
    }
    gl.bufferData(gl.ARRAY_BUFFER,points,gl.DYNAMIC_DRAW);gl.uniformMatrix3fv(uniforms.uRotation,false,rotation);gl.uniform1f(uniforms.uDistance,distance/zoom);gl.uniform1f(uniforms.uAspect,width/height);gl.uniform1f(uniforms.uHeight,height);
    gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.POINTS,0,cloud.count);
  }
  const redraw=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(draw)};
  const down=event=>{pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId)};
  const move=event=>{
    const old=pointers.get(event.pointerId);if(!old)return;
    if(pointers.size===1){yaw+=(event.clientX-old.x)*.006;pitch=Math.max(-1.2,Math.min(1.2,pitch+(event.clientY-old.y)*.006))}
    else{
      const other=[...pointers.entries()].find(([id])=>id!==event.pointerId)[1],before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);
      if(before>2)zoom=Math.max(.4,Math.min(3,zoom*after/before));
    }
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});redraw();
  };
  const up=event=>pointers.delete(event.pointerId);
  const wheel=event=>{event.preventDefault();zoom=Math.max(.4,Math.min(3,zoom*Math.exp(-event.deltaY*.001)));redraw()};
  const lost=event=>{event.preventDefault();dispose()};
  function dispose(){
    if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer?.disconnect();signal.removeEventListener('abort',dispose);
    for(const [name,listener] of listeners)canvas.removeEventListener(name,listener);
    gl.deleteBuffer(buffer);gl.deleteProgram(program);for(const item of shaders)gl.deleteShader(item);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();pointers.clear();
  }
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['wheel',wheel],['webglcontextlost',lost]];
  for(const [name,listener] of listeners)canvas.addEventListener(name,listener,{passive:!['wheel','webglcontextlost'].includes(name)});
  const observer=globalThis.ResizeObserver?new ResizeObserver(redraw):null;observer?.observe(host);
  signal.addEventListener('abort',dispose,{once:true});host.appendChild(canvas);redraw();
  if(signal.aborted)dispose();
  return dispose;
}

export async function createDepthScene(host, blob, onProgress = () => {}, signal = new AbortController().signal) {
  signal.throwIfAborted();
  const image=new Image(),url=URL.createObjectURL(blob);let pixels;
  onProgress({phase:'reading'});
  try {
    image.src=url;await image.decode();signal.throwIfAborted();
    const size=inferenceSize(image.naturalWidth,image.naturalHeight),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Telefonen kunne ikkje lese biletet.');
    context.drawImage(image,0,0,size.width,size.height);pixels=context.getImageData(0,0,size.width,size.height);canvas.width=canvas.height=1;
  } finally {URL.revokeObjectURL(url)}
  const prediction=await estimateDepth(pixels,onProgress,signal);signal.throwIfAborted();onProgress({phase:'rendering'});
  const cloud=imageToPointCloud({rgba:pixels.data,width:pixels.width,height:pixels.height,depth:prediction.depth,depthWidth:prediction.width,depthHeight:prediction.height,stride:pointStride(pixels.width,pixels.height)});
  const bytes=gaussianSplats(cloud),dispose=renderScene(host,cloud,bytes,signal);signal.throwIfAborted();
  return {dispose};
}
