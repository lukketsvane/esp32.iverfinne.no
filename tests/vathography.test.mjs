import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDepth,toneDepth,decodeSpectral,VATHOGRAPHY_PRESETS} from '../vendor/vathography.mjs';

test('raw model polarity is normalized without changing the prediction',()=>{
  const raw=Float32Array.of(2,4,8),original=raw.slice();
  const near=normalizeDepth(raw),far=normalizeDepth(raw,{polarity:'far'});
  assert.deepEqual([...near],[1,Math.fround(2/3),0]);
  assert.deepEqual([...far],[0,Math.fround(1/3),1]);
  assert.deepEqual(raw,original);
  assert.deepEqual([...normalizeDepth([5,NaN,5,Infinity])],[.5,.5,.5,.5]);
  assert.deepEqual([...normalizeDepth([0,NaN,1])],[1,.5,0]);
  assert.throws(()=>normalizeDepth([NaN,Infinity]),/gyldige/);
  assert.throws(()=>normalizeDepth([]),/Ugyldig/);
  assert.throws(()=>normalizeDepth(raw,{polarity:'inverse'}),/Ugyldig/);
});

test('reference curve knots produce the intended grayscale levels',()=>{
  const cases=[
    ['band',[[0,0],[.25,.005],[.42,.035],[.53,.17],[.66,.96],[.79,.17],[.9,.35],[1,.92]]],
    ['mist',[[0,0],[.2,.015],[.4,.07],[.55,.18],[.7,.48],[.85,.8],[1,.98]]],
    ['abyss',[[0,0],[.2,.005],[.4,.06],[.52,.42],[.65,.96],[.78,.28],[.89,.1],[1,.025]]],
    ['near',[[0,.98],[.2,.965],[.4,.91],[.55,.8],[.7,.5],[.85,.18],[1,0]]],
    ['planes',[[0,.025],[.15,.08],[.3,.98],[.43,.1],[.55,.025],[.68,.15],[.78,.98],[.9,.15],[1,.025]]],
  ];
  assert.deepEqual(VATHOGRAPHY_PRESETS.map(item=>item.id),cases.map(([name])=>name));
  for(const [preset,knots]of cases){
    const pixels=toneDepth(knots.map(([x])=>x),knots.length,1,{preset});
    for(let i=0;i<knots.length;i++){
      const expected=Math.round(knots[i][1]*255);
      assert.ok(Math.abs(pixels[i*4]-expected)<=1,preset+' at '+knots[i][0]);
      assert.equal(pixels[i*4],pixels[i*4+1]);assert.equal(pixels[i*4],pixels[i*4+2]);assert.equal(pixels[i*4+3],255);
    }
  }
});

test('PCHIP interpolation stays within each local monotone interval',()=>{
  const knots=[[0,0],[.25,.005],[.42,.035],[.53,.17],[.66,.96],[.79,.17],[.9,.35],[1,.92]];
  for(let i=0;i<knots.length-1;i++){
    const [x0,y0]=knots[i],[x1,y1]=knots[i+1],depth=Float64Array.from({length:101},(_,n)=>x0+(x1-x0)*n/100),pixels=toneDepth(depth,101,1);
    for(let n=0;n<101;n++){
      const value=pixels[n*4];assert.ok(value>=Math.floor(Math.min(y0,y1)*255)&&value<=Math.ceil(Math.max(y0,y1)*255));
      if(n)assert.ok(y1>=y0?value>=pixels[(n-1)*4]:value<=pixels[(n-1)*4]);
    }
  }
});

test('band position and width transform cached depth without changing it',()=>{
  const depth=Float32Array.of(.66,.76,.82),original=depth.slice();
  const base=toneDepth(depth,3,1),shifted=toneDepth(depth,3,1,{position:.1}),wide=toneDepth(depth,3,1,{width:2});
  assert.equal(base[0],shifted[4]);assert.equal(base[0],wide[8]);
  assert.notDeepEqual(base,shifted);assert.deepEqual(depth,original);
  assert.deepEqual(toneDepth([NaN,Infinity,-5,5],4,1).filter((_,i)=>i%4===3),Uint8ClampedArray.of(255,255,255,255));
  assert.throws(()=>toneDepth(depth,2,2),/Ugyldig/);
  assert.throws(()=>toneDepth(depth,3.5,1),/Ugyldig/);
});

test('Spectral inversion recovers standard Matplotlib controls and interpolated colors',()=>{
  const controls=[[158,1,66],[213,62,79],[244,109,67],[253,174,97],[254,224,139],[255,255,191],[230,245,152],[171,221,164],[102,194,165],[50,136,189],[94,79,162]];
  const rgba=Uint8ClampedArray.from(controls.flatMap(color=>[...color,255])),copy=rgba.slice(),actual=decodeSpectral(rgba,11,1);
  for(let i=0;i<11;i++)assert.ok(Math.abs(actual[i]-i/10)<.012,`control ${i}: ${actual[i]}`);
  assert.deepEqual(rgba,copy);assert.deepEqual(actual,decodeSpectral(rgba,11,1));
  const mids=Uint8ClampedArray.from(controls.slice(0,-1).flatMap((color,i)=>[...color.map((value,c)=>(value+controls[i+1][c])/2),255]));
  const recovered=decodeSpectral(mids,10,1);
  for(let i=0;i<10;i++)assert.ok(Math.abs(recovered[i]-(i+.5)/10)<.012);
  assert.throws(()=>decodeSpectral(rgba,10,1),/Ugyldig/);
  assert.throws(()=>decodeSpectral([NaN,0,0,255],1,1),/Spectral/);
});

test('interior tones match the independent Python SciPy PCHIP renderer',()=>{
  const samples=[.05,.13,.31,.45,.58,.62,.72,.83,.95];
  const expected=[[0,0,3,13,120,204,156,51,146],[0,2,10,24,57,77,133,195,238],[0,1,6,41,183,231,159,45,12]];
  for(let preset=0;preset<3;preset++)assert.deepEqual([...toneDepth(samples,samples.length,1,{preset})].filter((_,i)=>i%4===0),expected[preset]);
});

test('native-size rendering interpolates floating-point depth before applying the nonlinear curve',()=>{
  const depth=Float32Array.of(.53,.79),copy=depth.slice(),pixels=toneDepth(depth,2,1,{outputWidth:3,outputHeight:1});
  const expected=toneDepth([.53,.66,.79],3,1);
  assert.deepEqual(pixels,expected);
  assert.ok(pixels[4]>240);assert.ok(pixels[0]<50);assert.ok(pixels[8]<50);
  assert.deepEqual(depth,copy);
  assert.throws(()=>toneDepth(depth,2,1,{outputWidth:1.5}),/biletstorleik/);
  assert.throws(()=>toneDepth(depth,2,1,{outputWidth:4097,outputHeight:4096}),/biletstorleik/);
});

test('near light reverses atmosphere while two planes retain a dark interval',()=>{
  const ramp=Float32Array.from({length:101},(_,i)=>i/100),mist=toneDepth(ramp,101,1,{preset:'mist'}),near=toneDepth(ramp,101,1,{preset:'near'});
  for(let i=1;i<101;i++){assert.ok(mist[i*4]>=mist[(i-1)*4]);assert.ok(near[i*4]<=near[(i-1)*4])}
  const planes=toneDepth([0,.3,.55,.78,1],5,1,{preset:'planes'});
  assert.ok(planes[4]>240&&planes[12]>240);
  assert.ok(planes[0]<10&&planes[8]<10&&planes[16]<10);
});
