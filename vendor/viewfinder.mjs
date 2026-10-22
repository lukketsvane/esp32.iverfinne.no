export class Viewfinder {
  constructor(canvas) {
    this.canvas = canvas; this.active = true; this.disposed = false;
    this.source = null;
    canvas.width = 240; canvas.height = 360;
    this.gl = canvas.getContext('webgl', {alpha:false,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:false});
    this.fallback = this.gl ? null : canvas.getContext('2d');
    if(this.fallback) {
      this.sampleCanvas=document.createElement('canvas');this.sampleCanvas.width=canvas.width;this.sampleCanvas.height=canvas.height;
      this.sampleContext=this.sampleCanvas.getContext('2d',{willReadFrequently:true});
      this.fit(canvas.width,canvas.height);
    }
    const gl = this.gl;
    if (gl) {
      const shader = (type, code) => {
        const result = gl.createShader(type);
        if (!result) throw new Error('Kameraet kunne ikkje visast.');
        gl.shaderSource(result,code); gl.compileShader(result);
        if (!gl.getShaderParameter(result,gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('Kameraet kunne ikkje visast.'); }
        return result;
      };
      const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
      const fragment = shader(gl.FRAGMENT_SHADER, `precision mediump float;
        uniform sampler2D image; uniform float time;
        varying vec2 uv;
        void main(){
          vec2 q=uv*2.-1.; float r=dot(q,q);
          vec3 rgb=texture2D(image,uv).rgb;
          float gray=dot(rgb,vec3(.299,.587,.114));
          gray=clamp((gray-.07)*1.2,0.,1.);
          float grain=fract(sin(dot(gl_FragCoord.xy+floor(time*18.),vec2(12.9898,78.233)))*43758.5453)-.5;
          gray=gray*(1.-.12*r)*( .95+.05*sin(gl_FragCoord.y*3.14159))+grain*.008;
          gl_FragColor=vec4(vec3(max(0.,gray)),1.);
        }`);
      const program=gl.createProgram();
      if (!program) throw new Error('Kameraet kunne ikkje visast.');
      gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Kameraet kunne ikkje visast.');
      this.program=program;gl.useProgram(program);
      this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      this.time=gl.getUniformLocation(program,'time');
    }
    this.animation=0; let previous=0;
    const frame=time=>{
      if(this.disposed)return;
      this.animation=requestAnimationFrame(frame);
      if(!this.active||document.hidden||time-previous<50)return;
      previous=time;this.draw(time);
    };
    this.animation=requestAnimationFrame(frame);
  }
  draw(time) {
    const source=this.source;
    if(!source)return;
    const video=source instanceof HTMLVideoElement;
    if(video&&source.readyState<2)return;
    const width=video?source.videoWidth:source.width, height=video?source.videoHeight:source.height;
    if(!width||!height)return;
    this.fit(width,height);
    const gl=this.gl;
    if(gl&&!gl.isContextLost()) {
      try {
        gl.bindTexture(gl.TEXTURE_2D,this.texture ?? null);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);
        gl.uniform1f(this.time ?? null,time/1000);
        gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      } catch {}
    } else if(this.fallback&&this.sampleCanvas&&this.sampleContext&&this.output&&this.shade) {
      this.sampleContext.drawImage(source,0,0,this.canvas.width,this.canvas.height);
      const input=this.sampleContext.getImageData(0,0,this.canvas.width,this.canvas.height).data,output=this.output.data;
      for(let i=0;i<this.shade.length;i++) {
        const at=i*4,gray=((input[at]*.299+input[at+1]*.587+input[at+2]*.114)-18)*1.2*this.shade[i]+((i*13+Math.floor(time/55)*17)%19-9)*.1;
        output[i*4]=output[i*4+1]=output[i*4+2]=gray;
      }
      this.fallback.putImageData(this.output,0,0);
    }
  }
  fit(width,height) {
    const ratio=width/height;if(!Number.isFinite(ratio)||ratio<=0||this.ratio===ratio)return;
    this.ratio=ratio;const scale=Math.sqrt(ratio/(2/3)),w=Math.round(240*scale),h=Math.round(360/scale);
    this.canvas.width=w;this.canvas.height=h;
    if(this.canvas.parentElement){this.canvas.parentElement.style.aspectRatio=String(ratio);this.canvas.parentElement.style.width=`clamp(104px,${30*scale}vw,${148*scale}px)`}
    if(this.fallback){
      this.sampleCanvas.width=w;this.sampleCanvas.height=h;this.output=new ImageData(w,h);this.shade=new Float32Array(w*h);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const qx=(x+.5)/w*2-1,qy=(y+.5)/h*2-1;this.shade[y*w+x]=(1-.12*(qx*qx+qy*qy))*(.95+.05*Math.sin((y+.5)*Math.PI));this.output.data[(y*w+x)*4+3]=255}
    }
  }
  clear() {
    this.source=null;
    if(this.gl&&!this.gl.isContextLost()) {this.gl.clearColor(0,0,0,1);this.gl.clear(this.gl.COLOR_BUFFER_BIT);}
    else if(this.fallback) {this.fallback.fillStyle='#000';this.fallback.fillRect(0,0,this.canvas.width,this.canvas.height);}
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.animation);
    this.gl?.deleteTexture(this.texture ?? null);this.gl?.deleteBuffer(this.buffer ?? null);this.gl?.deleteProgram(this.program ?? null);
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();this.source=null;
  }
}
