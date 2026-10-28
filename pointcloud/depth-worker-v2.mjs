import { env, InferenceSession, Tensor } from './vendor/ort.wasm.min.mjs';
import { normalizedImage } from './math.mjs';
import { loadAsset, loadCachedAsset } from './assets.mjs';

env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
env.logLevel = 'error';

let session=null,busy=false;
self.onmessage = async event => {
  if(busy)return;busy=true;
  const { rgba, width, height } = event.data;
  let input, outputs;
  const progress = (phase, percent) => self.postMessage({ type: 'progress', phase, percent });
  try {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 14 || height < 14 || width > 518 || height > 518 || width % 14 || height % 14) throw new Error('Ugyldig biletoppløysing.');
    if(!session){
      const response = await fetch(new URL('./models/manifest.json', import.meta.url), { cache: 'force-cache' });
      if (!response.ok) throw new Error('Modellmanifestet manglar.');
      const manifest = await response.json();
      const total = manifest.asset.bytes + manifest.runtime.bytes;
      const phoneOnly = location.protocol === 'http:' && (!['localhost','127.0.0.1','[::1]'].includes(location.hostname) || location.port === '19304');
      const model = phoneOnly ? await loadCachedAsset(manifest.asset) : await loadAsset(manifest.asset, percent => progress('loading-model', Math.round(percent * manifest.asset.bytes / total)));
      env.wasm.wasmBinary = phoneOnly ? await loadCachedAsset(manifest.runtime) : await loadAsset(manifest.runtime, percent => progress('loading-runtime', Math.round((manifest.asset.bytes + manifest.runtime.bytes * percent / 100) / total * 100)));
      progress('starting');
      session = await InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }
    input = new Tensor('float32', normalizedImage(new Uint8ClampedArray(rgba), width, height), [1,3,height,width]);
    progress('estimating');
    outputs = await session.run({ [session.inputNames[0]]: input });
    const output = outputs[session.outputNames[0]], depth = new Float32Array(output.data);
    const depthWidth = output.dims.at(-1), depthHeight = output.dims.at(-2);
    if (depth.length !== depthWidth * depthHeight) throw new Error('Ugyldig djupnekart.');
    self.postMessage({ type: 'result', depth: depth.buffer, width: depthWidth, height: depthHeight }, [depth.buffer]);
  } catch (error) { self.postMessage({ type: 'error', code: error?.code || 'DEPTH_FAILED', message: error?.message || 'Djupneberekninga stoppa.' }); await session?.release();session=null; }
  finally {
    input?.dispose();
    for (const output of Object.values(outputs || {})) output.dispose();
    busy=false;
  }
};
