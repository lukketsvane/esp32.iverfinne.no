import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {panoramaPoint,estimatePanoramaTransform,planPanorama,panoramaLayout,blendPanoramaFrame,mosaicPanoramaDepth,applyPanoramaMask,buildPanorama} from '../vendor/panorama.mjs';

const identity=[1,0,0,0,1,0,0,0,1];
function texture(width=320,height=240,seed=123){
  const values=new Uint8Array(width*height),data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<values.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;values[i]=seed>>>24}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let value=0,weight=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const w=(dx?1:2)*(dy?1:2);value+=values[Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx))]*w;weight+=w}
    value=value/weight*.9+12;data.set([value,value,value,255],(y*width+x)*4);
  }
  return {width,height,data};
}
function sample(image,matrix,{gain=1,offset=0}={}){
  const {width,height}=image,data=new Uint8ClampedArray(image.data.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const [sx,sy]=panoramaPoint(matrix,x,y),x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
    if(x0<0||y0<0||x0+1>=width||y0+1>=height)continue;
    const at=(y*width+x)*4;for(let c=0;c<3;c++)data[at+c]=offset+gain*(image.data[(y0*width+x0)*4+c]*(1-fx)*(1-fy)+image.data[(y0*width+x0+1)*4+c]*fx*(1-fy)+image.data[((y0+1)*width+x0)*4+c]*(1-fx)*fy+image.data[((y0+1)*width+x0+1)*4+c]*fx*fy);data[at+3]=255;
  }
  return {width,height,data};
}

test('registration recovers translated overlap through an exposure change',async()=>{
  const reference=texture(),expected=[1,0,64,0,1,4,0,0,1],candidate=sample(reference,expected,{gain:.8,offset:20});
  const result=await estimatePanoramaTransform(reference,candidate);
  assert.ok(result.inliers>=18);assert.ok(result.overlap>.65&&result.overlap<.85);
  for(const point of [[20,20],[150,100],[240,200]]){
    const actual=panoramaPoint(result.matrix,...point),target=panoramaPoint(expected,...point);
    assert.ok(Math.hypot(actual[0]-target[0],actual[1]-target[1])<1);
  }
});

test('registration recovers a modest projective sweep with rotation',async()=>{
  const reference=texture(),expected=[1.01,.02,36,-.012,1,7,.00008,.00003,1],candidate=sample(reference,expected);
  const result=await estimatePanoramaTransform(reference,candidate);
  for(const point of [[30,30],[140,100],[240,190]]){
    const actual=panoramaPoint(result.matrix,...point),target=panoramaPoint(expected,...point);
    assert.ok(Math.hypot(actual[0]-target[0],actual[1]-target[1])<1.6);
  }
});

test('unrelated, flat, transparent, and insufficient-overlap frames are rejected',async()=>{
  const reference=texture(),flat={...reference,data:new Uint8ClampedArray(reference.data.length).fill(128)},transparent={...reference,data:reference.data.slice()};
  for(let i=3;i<transparent.data.length;i+=4)transparent.data[i]=0;
  for(const candidate of [texture(320,240,773),flat,transparent,sample(reference,[1,0,270,0,1,0,0,0,1])])await assert.rejects(estimatePanoramaTransform(reference,candidate),error=>error.code==='PANORAMA_OVERLAP');
});

test('planning skips a bad middle frame and keeps stable source indices',async()=>{
  const reference=texture(),later=sample(reference,[1,0,64,0,1,0,0,0,1]),result=await planPanorama([reference,texture(320,240,991),later]);
  assert.deepEqual(result.accepted,[true,false,true]);assert.deepEqual(result.transforms[0],identity);assert.equal(result.transforms[1],null);assert.ok(result.registration[1].reason);
  assert.ok(Math.abs(result.transforms[2][2]-64)<1);
});

test('a blank first exposure is retained but skipped when later frames overlap',async()=>{
  const reference=texture(),flat={...reference,data:new Uint8ClampedArray(reference.data.length).fill(128)},later=sample(reference,[1,0,64,0,1,0,0,0,1]);
  const result=await planPanorama([flat,reference,later]);
  assert.deepEqual(result.accepted,[false,true,true]);assert.equal(result.transforms[0],null);assert.deepEqual(result.transforms[1],identity);assert.equal(result.analysis.referenceFrame,1);
});

test('a stationary hold never masquerades as a panorama',async()=>{
  const reference=texture();await assert.rejects(planPanorama([reference,reference,reference]),error=>error.code==='PANORAMA_OVERLAP');
});

test('registration and planning honor cancellation during CPU work',async()=>{
  const controller=new AbortController(),reference=texture();
  const pending=estimatePanoramaTransform(reference,sample(reference,[1,0,64,0,1,0,0,0,1]),{signal:controller.signal});
  setTimeout(()=>controller.abort(),2);await assert.rejects(pending,{name:'AbortError'});
  await assert.rejects(planPanorama([reference,reference],{signal:controller.signal}),{name:'AbortError'});
});

test('layout retains negative origins and obeys output memory and edge limits',()=>{
  const layout=panoramaLayout([identity,[1,0,-200,0,1,-10,0,0,1]],320,240,{scale:10});
  assert.deepEqual(layout.origin,[-200,-10]);assert.ok(layout.width<=4096&&layout.height<=4096);assert.ok(layout.width*layout.height<=4194304);assert.ok(Math.abs(layout.width/layout.height-520/250)<.01);
  for(const transforms of [[],[identity.slice(1)],[[0,0,0,0,0,0,0,0,1]],[[NaN,0,0,0,1,0,0,0,1]]])assert.throws(()=>panoramaLayout(transforms,320,240));
});

test('photographic blending aligns shifted pixels and leaves uncovered pixels transparent',async()=>{
  const image=texture(64,48),target={width:96,height:52,data:new Uint8ClampedArray(96*52*4),weights:new Uint16Array(96*52)};
  await blendPanoramaFrame(image,[1,0,12,0,1,2,0,0,1],target);
  for(const [x,y]of [[0,0],[20,20],[63,47]])assert.deepEqual(target.data.slice(((y+2)*96+x+12)*4,((y+2)*96+x+13)*4),image.data.slice((y*64+x)*4,(y*64+x+1)*4));
  assert.equal(target.data[3],0);assert.equal(target.data[(51*96+95)*4+3],0);
  const before=target.data.slice();await blendPanoramaFrame(image,[1,0,12,0,1,2,0,0,1],target);assert.deepEqual(target.data,before);
});

test('depth mosaic preserves unnormalized source disparities and invalid ownership',async()=>{
  const prediction=value=>({width:64,height:48,quantity:'disparity',units:'px',depth:new Float32Array(64*48).fill(value),validity:new Uint8Array(64*48).fill(1)}),left=prediction(4),right=prediction(20);
  for(let y=0;y<48;y++)for(let x=30;x<64;x++){right.validity[y*64+x]=0;right.depth[y*64+x]=NaN}
  const result=await mosaicPanoramaDepth([left,right],[identity,[1,0,32,0,1,0,0,0,1]],{width:64,height:48});
  assert.equal(result.width,96);assert.equal(result.height,48);assert.equal(result.depth[24*96+10],4);assert.equal(result.depth[24*96+55],20);assert.equal(result.validity[24*96+90],0);assert.ok(Number.isNaN(result.depth[24*96+90]));
  assert.ok(result.coverage[1].fraction<1);for(let i=0;i<result.depth.length;i++)if(result.validity[i])assert.ok(result.depth[i]===4||result.depth[i]===20);
});

test('depth mosaic refuses mono maps and missing paired-frame data',async()=>{
  const mono={width:64,height:48,quantity:'relative-depth',units:'relative',depth:new Float32Array(3072),validity:new Uint8Array(3072)};
  await assert.rejects(mosaicPanoramaDepth([mono],[identity],{width:64,height:48}),/stereodjupn/);
  await assert.rejects(mosaicPanoramaDepth([null],[identity],{width:64,height:48}),/stereodjupn/);
});

test('panorama coverage masks missing corners without rewriting source depth or validity',()=>{
  const transforms=[identity,[1,0,32,0,1,16,0,0,1]],output=panoramaLayout(transforms,64,48),count=output.width*output.height,result={width:output.width,height:output.height,depth:new Float32Array(count).fill(.75),validity:new Uint8Array(count).fill(1),source:'browser'},panorama={transforms,analysis:{width:64,height:48},output};
  result.validity[20*output.width+20]=0;
  const masked=applyPanoramaMask(result,panorama);
  for(const at of [5*output.width+85,60*output.width+5]){assert.equal(masked.validity[at],0);assert.ok(Number.isNaN(masked.depth[at]));assert.equal(result.depth[at],.75);assert.equal(result.validity[at],1)}
  assert.equal(masked.validity[20*output.width+20],0);assert.equal(masked.validity[30*output.width+80],1);assert.equal(masked.depth[30*output.width+80],.75);assert.equal(masked.source,'browser');
});

test('PNG alpha masks internal holes and partly covered edge pixels before depth rendering',()=>{
  const result={width:64,height:48,depth:new Float32Array(3072).fill(8)},panorama={analysis:{width:64,height:48},transforms:[identity],output:panoramaLayout([identity],64,48)},alpha=new Uint8ClampedArray(3072*4).fill(255);
  alpha[(20*64+20)*4+3]=0;alpha[(20*64+21)*4+3]=128;
  const masked=applyPanoramaMask(result,panorama,{alpha});
  assert.equal(masked.validity[20*64+20],0);assert.equal(masked.validity[20*64+21],0);assert.ok(Number.isNaN(masked.depth[20*64+20]));assert.equal(masked.validity[20*64+22],1);assert.equal(result.depth[20*64+20],8);
});

test('public builder rejects invalid capture counts before accessing browser resources',async()=>{
  for(const frames of [null,[],[{left:new Blob(['a'])}],Array(9).fill({left:new Blob(['a'])}),[{left:null},{left:null}]])await assert.rejects(buildPanorama(frames),/mellom to og åtte/);
});

const builderSource=(await readFile(new URL('../vendor/panorama.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function builderHarness(stereo){
  const sources=new Map(),urls=new Map(),canvases=[],stereoCalls=[];let sequence=0;
  class MockImage{
    set src(url){this.source=sources.get(urls.get(url));this.naturalWidth=this.source?.width;this.naturalHeight=this.source?.height}
    async decode(){if(!this.source)throw new Error('Missing source')}
    removeAttribute(){this.source=null}
  }
  const document={createElement(){
    const canvas={width:0,height:0};let drawn=null,output=null;
    canvas.getContext=()=>({
      drawImage(image){drawn=image.source},
      getImageData(){
        const data=new Uint8ClampedArray(canvas.width*canvas.height*4);
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const at=(Math.floor(y*drawn.height/canvas.height)*drawn.width+Math.floor(x*drawn.width/canvas.width))*4;data.set(drawn.data.subarray(at,at+4),(y*canvas.width+x)*4)}
        return {data,width:canvas.width,height:canvas.height};
      },
      putImageData(image){output=image},
    });
    canvas.toBlob=callback=>callback(new Blob([output.data],{type:'image/png'}));canvases.push(canvas);return canvas;
  }};
  const context=vm.createContext({Blob,Uint8Array,Uint8ClampedArray,Uint16Array,Float32Array,Float64Array,Int16Array,Map,Set,Image:MockImage,ImageData:class{constructor(data,width,height){this.data=data;this.width=width;this.height=height}},document,URL:{createObjectURL(blob){const id=String(++sequence);urls.set(id,blob);return id},revokeObjectURL(id){urls.delete(id)}},setTimeout,runStereoDepth:async(left,right,options)=>{stereoCalls.push({left,right});return stereo?.(left,right,options,stereoCalls.length)}});
  const build=vm.runInContext(builderSource+'\nbuildPanorama',context),reference=texture(),candidate=sample(reference,[1,0,64,0,1,0,0,0,1]),left=new Blob(['left'],{type:'image/jpeg'}),next=new Blob(['next'],{type:'image/jpeg'}),right=new Blob(['right'],{type:'image/jpeg'}),nextRight=new Blob(['next right'],{type:'image/jpeg'});
  sources.set(left,reference);sources.set(next,candidate);
  return {build,frames:[{left,right,id:'first',timing:{hardware_synchronized:false}},{left:next,right:nextRight,id:'second'}],urls,canvases,stereoCalls};
}
const stereoPrediction=(value=4)=>({width:320,height:240,depth:new Float32Array(320*240).fill(value),validity:new Uint8Array(320*240).fill(1),quantity:'disparity',units:'px',rigId:'test-rig'});

test('builder retains original paired captures and emits only raw stereo disparity',async()=>{
  const harness=builderHarness((_left,_right,_options,index)=>stereoPrediction(index===1?4:20)),progress=[];
  const built=await harness.build(harness.frames,{onProgress:value=>progress.push(value)});
  assert.equal(built.left.type,'image/png');assert.equal(built.result.source,'stereo-panorama');assert.equal(built.result.quantity,'disparity');assert.equal(built.result.units,'px');assert.equal(built.result.normalized,false);assert.equal(built.result.metric,false);assert.equal(built.result.hardwareSynchronized,false);
  assert.equal(built.panorama.stereo.accepted,true);assert.equal(built.panorama.acceptedFrames,2);assert.equal(built.panorama.frames[0].left,harness.frames[0].left);assert.equal(built.panorama.frames[1].right,harness.frames[1].right);assert.equal(built.panorama.frames[0].timing,harness.frames[0].timing);
  assert.equal(harness.stereoCalls.length,2);assert.ok(built.result.width>320);
  for(let i=0;i<built.result.depth.length;i++)if(built.result.validity[i])assert.ok([4,20].includes(built.result.depth[i]));
  assert.equal(harness.urls.size,0);assert.ok(harness.canvases.every(canvas=>canvas.width===1&&canvas.height===1));assert.equal(progress.at(-1).phase,'panorama-ready');
});

test('builder requests mono fallback without inventing stereo for a missing camera',async()=>{
  const harness=builderHarness();delete harness.frames[1].right;
  const built=await harness.build(harness.frames);
  assert.equal(built.result,null);assert.equal(built.panorama.stereo.accepted,false);assert.match(built.panorama.stereo.reason,/manglar kamera 2/);assert.equal(harness.stereoCalls.length,0);assert.equal(built.panorama.depthSource,'monocular');
});

test('a paired-depth error preserves panorama sources and honestly requests fallback',async()=>{
  const harness=builderHarness(()=>{throw new Error('Sensor coverage failed')});
  const built=await harness.build(harness.frames);
  assert.equal(built.result,null);assert.equal(built.panorama.stereo.accepted,false);assert.equal(built.panorama.stereo.reason,'Sensor coverage failed');assert.equal(built.panorama.frames[1].right,harness.frames[1].right);
});

test('sparse stereo in one region cannot be hidden by a well-covered adjacent frame',async()=>{
  const harness=builderHarness((_left,_right,_options,index)=>{const result=stereoPrediction();if(index===2){result.validity.fill(0);result.depth.fill(NaN)}return result});
  const built=await harness.build(harness.frames);
  assert.equal(built.result,null);assert.equal(built.panorama.stereo.accepted,false);assert.match(built.panorama.stereo.reason,/delar av panoramaet/);assert.equal(built.panorama.stereo.coverage[1].fraction,0);
});

test('abort during stereo processing cancels the builder instead of producing mono fallback',async()=>{
  const controller=new AbortController(),harness=builderHarness((_left,_right,{signal})=>{controller.abort();signal.throwIfAborted()});
  await assert.rejects(harness.build(harness.frames,{signal:controller.signal}),{name:'AbortError'});assert.equal(harness.urls.size,0);
});
