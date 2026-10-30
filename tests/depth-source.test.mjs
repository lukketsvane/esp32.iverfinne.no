import test from 'node:test';
import assert from 'node:assert/strict';
import {localDepthEndpoint,runLocalDepth,runBrowserDepth} from '../vendor/depth-source.mjs';

const endpoint='http://localhost:19304/api/depth';
const bytes=Uint8Array.of(0,0,128,63,0,0,32,192,0,0,128,62,0,0,128,67);
const photo=new Blob([Uint8Array.of(255,216,255,217)],{type:'image/jpeg'});
const response=(headers={},body=bytes,status=200)=>new Response(body,{status,headers:{'X-Depth-Width':'2','X-Depth-Height':'2','X-Depth-Polarity':'near','X-Depth-Model':'Depth Anything V2 Small',...headers}});

test('automatic local inference is confined to loopback origins',()=>{
  for(const origin of ['http://localhost:19304','http://127.0.0.1:19304','http://[::1]:19304'])assert.equal(localDepthEndpoint(new URL(origin+'/camera'),null),origin+'/api/depth');
  for(const origin of ['https://esp32.iverfinne.no','http://192.168.4.1','http://localhost.example.org','http://127.0.0.2'])assert.equal(localDepthEndpoint(new URL(origin),null),null);
  assert.equal(localDepthEndpoint(undefined,null),null);
});

test('explicit inference endpoints require the camera origin',()=>{
  const location=new URL('https://esp32.iverfinne.no/camera');
  assert.equal(localDepthEndpoint(location,'/api/depth'),'https://esp32.iverfinne.no/api/depth');
  assert.equal(localDepthEndpoint(location,'https://esp32.iverfinne.no/depth'),'https://esp32.iverfinne.no/depth');
  for(const value of ['https://other.test/depth','http://esp32.iverfinne.no/depth','https://esp32.iverfinne.no:8443/depth','//other.test/depth'])assert.throws(()=>localDepthEndpoint(location,value),/same opphav/);
});

test('original image bytes are posted once and little-endian float predictions retain metadata',async()=>{
  const calls=[],progress=[];
  const result=await runLocalDepth(photo,{endpoint,onProgress:value=>progress.push(value),fetcher:async(url,options)=>{calls.push({url,options});return response()}});
  assert.equal(calls.length,1);assert.equal(calls[0].url,endpoint);assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.body,photo);assert.equal(calls[0].options.headers['Content-Type'],'image/jpeg');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual([...result.depth],[1,-2.5,.25,256]);assert.equal(result.width,2);assert.equal(result.height,2);
  assert.equal(result.polarity,'near');assert.equal(result.model,'Depth Anything V2 Small');assert.equal(result.source,'local');assert.ok(result.images instanceof Map);
  assert.deepEqual(progress,[{phase:'estimating'}]);
  const far=await runLocalDepth(photo,{endpoint,fetcher:async()=>response({'X-Depth-Polarity':'far'})});
  assert.equal(far.polarity,'far');assert.deepEqual(far.depth,result.depth);
});

test('invalid dimensions, incomplete buffers, unknown polarity and HTTP failure reject',async()=>{
  for(const headers of [
    {'X-Depth-Width':'0'},{'X-Depth-Height':'1'},{'X-Depth-Width':'2.5'},
    {'X-Depth-Height':'Infinity'},{'X-Depth-Width':'NaN'},
    {'X-Depth-Width':'4097','X-Depth-Height':'4096'},
  ])await assert.rejects(runLocalDepth(photo,{endpoint,fetcher:async()=>response(headers)}),/oppløysing/);
  for(const body of [bytes.subarray(0,12),new Uint8Array(20)])await assert.rejects(runLocalDepth(photo,{endpoint,fetcher:async()=>response({},body)}),/Ufullstendig/);
  await assert.rejects(runLocalDepth(photo,{endpoint,fetcher:async()=>response({'X-Depth-Polarity':'inverse'})}),/djupneretning/);
  await assert.rejects(runLocalDepth(photo,{endpoint,fetcher:async()=>response({},new Uint8Array(),503)}),/HTTP 503/);
  await assert.rejects(runLocalDepth(photo,{endpoint:null,fetcher:async()=>{throw new Error('must not fetch')}}),/ikkje sett opp/);
});

test('aborted requests cannot start or keep their network request alive',async()=>{
  const before=new AbortController();before.abort();let calls=0;
  await assert.rejects(runLocalDepth(photo,{endpoint,signal:before.signal,fetcher:async()=>{calls++;return response()}}),{name:'AbortError'});
  assert.equal(calls,0);
  const during=new AbortController(),reason=new DOMException('Stopped','AbortError');let networkSignal;
  const pending=runLocalDepth(photo,{endpoint,signal:during.signal,fetcher:async(url,{signal})=>{
    networkSignal=signal;
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  during.abort(reason);
  await assert.rejects(pending,error=>error===reason);assert.equal(networkSignal.aborted,true);
});

test('browser inference preserves missing-model error codes for portable setup',async()=>{
  const original={Image:globalThis.Image,document:globalThis.document,Worker:globalThis.Worker};let terminated=0;
  globalThis.Image=class{naturalWidth=28;naturalHeight=28;async decode(){}};
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:(_,__,width,height)=>({data:new Uint8ClampedArray(width*height*4)})})})};
  globalThis.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'error',message:'Klargjer telefonen.',code:'PHONE_SETUP_REQUIRED'}}))}terminate(){terminated++}};
  try{await assert.rejects(runBrowserDepth(photo),error=>error.code==='PHONE_SETUP_REQUIRED'&&error.message==='Klargjer telefonen.');assert.equal(terminated,1)}
  finally{for(const [key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});

test('depth art bypasses a cached 420px worker and sends higher resolution sensor pixels',async()=>{
  const original={Image:globalThis.Image,document:globalThis.document,Worker:globalThis.Worker};let request,terminated=0;const workerUrls=[],contexts=[];
  const legacy=message=>message.width>420||message.height>420?{type:'error',message:'Ugyldig biletoppløysing.'}:{type:'result',depth:new Float32Array(message.width*message.height).buffer,width:message.width,height:message.height};
  const cached=new Map([['/pointcloud/depth-worker.mjs',legacy]]);
  globalThis.Image=class{naturalWidth=1600;naturalHeight=1200;async decode(){}};
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>{const context={drawImage(){},getImageData:(_,__,width,height)=>({data:new Uint8ClampedArray(width*height*4)})};contexts.push(context);return context}})};
  globalThis.Worker=class{constructor(url){this.url=url;workerUrls.push(url)}postMessage(message){request=message;const old=cached.get(new URL(this.url,'http://192.168.4.1').pathname);queueMicrotask(()=>this.onmessage({data:old?old(message):{type:'result',depth:new Float32Array(message.width*message.height).buffer,width:message.width,height:message.height}}))}terminate(){terminated++}};
  try{
    const result=await runBrowserDepth(photo);
    assert.equal(request.width,518);assert.equal(request.height,392);assert.equal(request.rgba.byteLength,518*392*4);
    assert.equal(legacy(request).type,'error');assert.deepEqual(workerUrls,['/pointcloud/depth-worker-v2.mjs']);
    assert.equal(result.sourceWidth,1600);assert.equal(result.sourceHeight,1200);assert.equal(result.width,518);assert.equal(result.height,392);
    assert.match(result.model,/518 px/);assert.equal(terminated,0);assert.equal(contexts[0].imageSmoothingEnabled,true);assert.equal(contexts[0].imageSmoothingQuality,'high');
    globalThis.document.hidden=true;
    const next=await runBrowserDepth(photo);
    assert.deepEqual(workerUrls,['/pointcloud/depth-worker-v2.mjs']);assert.equal(next.width,518);assert.equal(terminated,1);
  }finally{for(const [key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});

test('oversized photographs reject before canvas allocation or inference',async()=>{
  const original={Image:globalThis.Image,document:globalThis.document,Worker:globalThis.Worker};let contextCalls=0,workers=0;
  globalThis.Image=class{naturalWidth=8192;naturalHeight=4096;async decode(){}};
  globalThis.document={createElement:()=>({getContext(){contextCalls++;throw Error('must not allocate')}})};
  globalThis.Worker=class{constructor(){workers++}};
  try{await assert.rejects(runBrowserDepth(photo),/ugyldig storleik/);assert.equal(contextCalls,0);assert.equal(workers,0)}
  finally{for(const [key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});

test('local predictions preserve actual inference model, device, revision and fallback provenance',async()=>{
  const result=await runLocalDepth(photo,{endpoint,fetcher:async()=>response({'X-Depth-Model':'Depth Anything V2 Base','X-Depth-Device':'cpu','X-Depth-Revision':'cached-revision','X-Depth-Input-Size':'770','X-Depth-Fallback':'CUDA memory exhausted'})});
  assert.equal(result.model,'Depth Anything V2 Base');
  assert.deepEqual(result.provenance,{device:'cpu',modelRevision:'cached-revision',inputSize:770,fallbackReason:'CUDA memory exhausted'});
  const legacy=await runLocalDepth(photo,{endpoint,fetcher:async()=>response()});
  assert.deepEqual(legacy.provenance,{device:null,modelRevision:null,inputSize:null,fallbackReason:null});
});
