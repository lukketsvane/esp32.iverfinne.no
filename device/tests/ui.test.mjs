import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { COLOR_SCHEMES } from '../../vendor/color-schemes.mjs';
import { readStereoPairResponse } from '../../vendor/stereo-pair.mjs';
import { phoneHelperOrigin } from '../../vendor/model-bridge.mjs';

const html = await readFile(new URL('../EntropiCamera/camera_ui.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const application = scripts.find(script => script.includes('function takePhoto(')).replace(/__ENTROPI_(?:STUDIO|MODEL_BRIDGE|PRINT_CLIENT)__/g,'').replace('__ENTROPI_APP_ENHANCEMENTS__','window.checkPhone=checkPhone;window.showPhoto=showPhoto;function updateCameraChrome(){} async function archiveCapture(){return {id:null,warning:null}} async function persistCurrentMaster(){} async function persistCurrentPreview(){} function schedulePreviewSave(){}');
const verifiedStatus = { camera_id: 'aaaaaaaaaaaa', camera_ready: true, stream_ready: true, recovering: false, recovery_attempts: 0, last_error: '', framesize: 10, photo_framesize: 15, brightness: 0, psram: true };
const jpeg = value => new Blob([Uint8Array.of(255,216),value,Uint8Array.of(255,217)],{type:'image/jpeg'});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  let now = 0;
  let nextTimer = 1;
  let nextObjectUrl = 1;
  const timers = new Map();
  const requests = [];
  const images = [];
  const canvases = [];
  const events = new Map();
  const revoked = [];
  const objectUrls = new Map();
  const sceneCalls = [],artCalls=[],artViews=[],restoreCalls=[];
  const viewers=[];
  const printCalls = [], saves=[], encodedSnapshots=[],photoViews=[];
  let printReport=()=>{},printConfiguration;
  const snapshot={width:384,height:1,data:new Uint8ClampedArray(384*4)},nativeSnapshot={width:640,height:960,data:new Uint8ClampedArray(640*960*4)};
  const modelChecks = [];
  const preparations = [];
  const opened = [];
  const messages = [];
  const studioBindings = [];
  const studioControls = { image: options.image??(options.vathography?2:0), vathography:options.vathography===true, primitive: 0, photo:0, setImage:level=>changeStudio('image',level), dispose() {} },finders=[];
  let colorBinding=null;
  const photoGestureState={scale:1,x:0,y:0,width:390,height:844,grain:1,contrast:1},liveGestureState={...photoGestureState},photoRefreshes=[];let photoGestureBinding,liveGestureBinding,photoResets=0;
  const photoGestureController={state:photoGestureState,reset(){photoResets++;Object.assign(photoGestureState,{scale:1,x:0,y:0});photoGestureBinding.onChange(photoGestureState)},refresh(){photoRefreshes.push({working:elements.get('photo-dialog').classList.contains('working'),error:elements.get('photo-dialog').classList.contains('error')});photoGestureBinding.onChange(photoGestureState)},dispose(){}};
  const childWindow = { postMessage: (data, origin, ports) => messages.push({ data, origin, ports }) };
  class MessageChannel {
    constructor() {
      const port=()=>({closed:false,onmessage:null,start(){},close(){this.closed=true},postMessage(data){if(!this.closed)this.peer.onmessage?.({data})}});
      this.port1=port();this.port2=port();this.port1.peer=this.port2;this.port2.peer=this.port1;
    }
  }
  const elements = new Map();
  const stored = new Map(options.onboarded === false ? [] : [['entropi-onboarded', '2']]);
  if(options.secondAddress)stored.set('entropi-second-camera',options.secondAddress);
  for(const [key,value] of Object.entries(options.storage??{}))stored.set(key,value);
  const clockDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const timeout = (callback, delay = 0, interval = false) => {
    const id = nextTimer++;
    timers.set(id, { callback, at: now + delay, delay, interval });
    return id;
  };
  class Element {
    constructor(id = '', tagName = 'DIV') {
      this.id = id;
      this.tagName = tagName;
      this.hidden = false;
      this.disabled = false;
      this.open = false;
      this.value = '0';
      this.dataset = {};
      this.textContent = '';
      this.innerHTML = '';
      this.style = {};
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.classes = new Set();
      this.classList = {
        add: (...values) => values.forEach(value => this.classes.add(value)),
        remove: (...values) => values.forEach(value => this.classes.delete(value)),
        contains: value => this.classes.has(value),
        toggle: (value, enabled) => {
          const active = enabled ?? !this.classes.has(value);
          if (active) this.classes.add(value); else this.classes.delete(value);
          return active;
        },
      };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
    async emit(name, details = {}) {
      await Promise.all((this.listeners.get(name) ?? []).map(callback => callback({ type: name, target: this, currentTarget: this, button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {}, ...details })));
    }
    closest(selector) { return selector.split(',').some(tag => tag.trim().toUpperCase() === this.tagName) ? this : null; }
    showModal() { this.open = true; }
    close() {
      if (!this.open) return;
      this.open = false;
      void this.emit('close');
    }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 390, bottom: 844 }; }
  }
  for (const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[2], match[1].toUpperCase());
    element.disabled = /\bdisabled\b/.test(match[0]);
    element.hidden = /\bhidden\b/.test(match[0]);
    if(element.tagName==='CANVAS'){element.width=320;element.height=240;element.draws=0;element.getContext=()=>({drawImage(){element.draws++}})}
    elements.set(element.id, element);
  }
  const document = {
    hidden: false,
    referrer: options.referrer??'',
    activeElement: { tagName: 'BODY' },
    getElementById: id => elements.get(id),
    querySelectorAll: () => [],
    createElement: tag => {
      const element = new Element('', tag.toUpperCase());
      if (tag === 'canvas') {
        element.draws = 0;
        element.clears = 0;
        for (const dimension of ['width', 'height']) {
          let value = 0;
          Object.defineProperty(element, dimension, { get: () => value, set: next => { value = next; element.clears++; } });
        }
        element.getContext = () => ({ drawImage: () => { element.draws++; }, clearRect: () => { element.clears++; } });
        element.toBlob=(callback,type)=>options.encode?options.encode(callback,type):callback(new Blob(['framed-photo'],{type}));
        canvases.push(element);
      }
      return element;
    },
    addEventListener: (name, callback) => {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(callback);
    },
  };
  class CameraImage extends Element {
    constructor() { super('', 'IMG'); this.naturalWidth = 0; this.naturalHeight = 0; images.push(this); }
    set src(value) {
      this.source = value; this.blob = objectUrls.get(value);
      if (value.startsWith('http') && options.frames !== false && (!options.frameUrl||options.frameUrl(value))) { this.naturalWidth = 320; this.naturalHeight = 240; }
    }
    get src() { return this.source ?? ''; }
    async decode() {
      if (options.decodeFailure) throw new Error('Invalid JPEG');
      if (options.decode) await options.decode(this);
      this.naturalWidth = options.imageSize?.(this)?.[0]??1600;
      this.naturalHeight = options.imageSize?.(this)?.[1]??1200;
    }
  }
  class BrowserURL extends URL {
    static createObjectURL(blob) { const url = 'blob:test/' + nextObjectUrl++; objectUrls.set(url, blob); return url; }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  const response = (body, ok = true, headers = {}) => {
    const normalized = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    return { ok, status: ok ? 200 : 500, headers: { get: name => normalized.get(name.toLowerCase()) ?? null }, json: async () => body, blob: async () => body };
  };
  const status = structuredClone(options.status === undefined ? {...verifiedStatus,peer:options.second?{camera_id:'bbbbbbbbbbbb'}:null} : options.status);
  const pairResponse=(left=jpeg('jpeg'),right=jpeg('right-jpeg'))=>new Response(new Blob([left,right]),{headers:{'Content-Type':'application/octet-stream','X-Entropi-Pair-Id':'a'.repeat(32),'X-Entropi-Left-Id':status.camera_id,'X-Entropi-Right-Id':'bbbbbbbbbbbb','X-Entropi-Left-Length':String(left.size),'X-Entropi-Right-Length':String(right.size),'X-Entropi-Timing':JSON.stringify({hardware_synchronized:false,coordinator_camera_id:status.camera_id,left_capture_us:1000,right_capture_us:900,left_capture_duration_us:30,right_capture_duration_us:40,peer_requested_us:2000,peer_headers_received_us:3000,peer_request_started_us:2100,peer_response_ready_us:2900})}});
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const custom = options.fetch?.(String(url), requests.length, response, init, pairResponse);
    if (custom !== undefined) return await custom;
    if(String(url).startsWith('/stereo/capture'))return pairResponse();
    if(String(url)==='/peer/status')return response(structuredClone(options.secondStatus??{...verifiedStatus,camera_id:'bbbbbbbbbbbb'}));
    if(String(url).startsWith('/peer/'))return response(new Blob([String(url).includes('/preview')?'preview-jpeg':'right-jpeg'],{type:'image/jpeg'}));
    if (String(url).startsWith('/status')) return response(structuredClone(status));
    if (String(url).startsWith('/capture')) return response(new Blob(['jpeg'], { type: 'image/jpeg' }));
    return response(null);
  };
  const window = {
    addEventListener: document.addEventListener,
    opener: options.opener === true ? childWindow : options.opener ?? null,
    open: (url, name) => { opened.push({ url, name }); return options.popupBlocked ? null : childWindow; },
  };
  const context = vm.createContext({
    document, window, Image: CameraImage, URL: BrowserURL, URLSearchParams, AbortController, Blob, MessageChannel,
    File: class extends Blob { constructor(parts, name, properties) { super(parts, properties); this.name = name; } },
    navigator: {}, location: { href: 'http://192.168.4.1/' + (options.search ?? ''), search: options.search ?? '' }, Date: clockDate,
    localStorage: {
      getItem(key) { if (options.storageDenied) throw new Error('Storage denied'); return stored.get(key) ?? null; },
      setItem(key, value) { if (options.storageDenied) throw new Error('Storage denied'); stored.set(key, value); },
    },
    COLOR_SCHEMES,readStereoPairResponse,phoneHelperOrigin,
    Viewfinder: class { constructor(canvas) { this.canvas = canvas;this.tone={grain:1,contrast:1};this.captures=[];finders.push(this) }capture(source){const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1200;this.captures.push({source,url:source.src,canvas});return canvas}setStyle(level){this.style=level}setPalette(id){this.palette=id}setTone(pose){this.tone={grain:pose.grain,contrast:pose.contrast}} },
    attachStudioControls: (hosts, onChange, enabled, onGesture) => { studioBindings.push({ hosts, onChange, enabled, onGesture }); return studioControls; },
    readColorScheme:kind=>stored.get('entropi-screen-'+kind+'-v2')??'macintosh',
    saveColorScheme:(kind,id)=>stored.set('entropi-screen-'+kind+'-v2',id),
    attachColorSchemeControls:(hosts,getKind,getSelection,onChoose,enabled)=>{
      colorBinding={hosts,getKind,getSelection,onChoose,enabled};return {refresh(){},dispose(){}};
    },
    attachPhotoGestures:(image,binding)=>{if(binding.toneOnly){liveGestureBinding=binding;return {state:liveGestureState}}photoGestureBinding=binding;binding.onChange(photoGestureState);return photoGestureController},
    createPhotoView:image=>{const viewer={image,source:null,sources:[],style:0,tone:{grain:1,contrast:1},shown:false,shows:[],refreshes:0,snapshots:[],disposed:false,setSource(source=image){this.source=source;this.sources.push(source)},setStyle(level){this.style=level},setPalette(id){this.palette=id},setTone(pose){for(const key of ['grain','contrast'])if(pose[key]!==undefined)this.tone[key]=pose[key]},show(visible){this.shown=Boolean(visible);this.shows.push(this.shown)},refresh(){this.refreshes++},snapshot(pose,native=false){const result={...context.photoSnapshot(image,pose,native),style:this.style,tone:{...this.tone}};this.snapshots.push({pose:{...pose},native,result});return result},dispose(){this.disposed=true}};photoViews.push(viewer);return viewer},
    createMarigoldView:(host,binding)=>{const view={ready:false,result:null,binding,async process(blob,signal,settings){artCalls.push({blob,signal,settings});const result=options.art?await options.art(blob,signal,settings):{};if(!signal.aborted){this.ready=true;this.result=result}return result},async restore(blob,result,recipe,signal){restoreCalls.push({blob,result,recipe,signal});await options.restore?.(blob,result,recipe,signal);if(!signal.aborted){this.ready=true;this.result=result;this.recipe=recipe}},reset(){this.ready=false;this.result=null},resetTone(){},snapshot:native=>native?nativeSnapshot:snapshot,dispose(){}};artViews.push(view);return view},
    phoneModelsReady: async signal => { modelChecks.push(signal); return typeof options.modelsReady==='function'?options.modelsReady(signal):options.modelsReady!==false; },
    requestPhoneModels: async (signal,onProgress,source,origin) => { preparations.push({signal,onProgress,source,origin}); if(options.prepare)await options.prepare(signal,onProgress,source); },
    createDevicePrinter:()=>({native:true}),cloudPrintJob:image=>new Uint8Array([image.width&255]),
    createPrintClient:configuration=>{printConfiguration=configuration;printReport=configuration.report;return {print:(image,isCurrent)=>{printCalls.push({image,isCurrent});return options.print?options.print(image,isCurrent,printReport):Promise.resolve(true)},dispose(){}}},
    photoSnapshot:(image,pose,native=false)=>({width:native?1600:384,height:native?1200:288,data:new Uint8ClampedArray((native?1600*1200:384*288)*4),photo:true,image,pose:{...pose},native}),
    snapshotBlob:image=>{encodedSnapshots.push(image);return new Blob(['rendered-png'],{type:'image/png'})},
    savePhoto:(blob,name,isCurrent)=>{saves.push({blob,name,isCurrent});return Promise.resolve()},
    bindExportGesture:(button,getOptions)=>button.addEventListener('click',async()=>{const options=getOptions();if(!options||!options.isCurrent())return;try{const blob=await options.image();if(options.isCurrent())saves.push({blob,name:options.name.replace(/\.[^.]+$/,'')+'.'+(options.imageExtension??'png'),isCurrent:options.isCurrent,options})}catch(error){options.onError?.(error)}}),
    createDepthScene: async (host, blob, onProgress, signal, quality, right, ...extra) => {
      sceneCalls.push({ host, blob, onProgress, signal, quality, right, extra });
      if (options.scene) {const viewer={setPrimitiveLevel(){},setPalette(id){this.palette=id},refresh(){return true},resetView(){},snapshot:native=>native?nativeSnapshot:snapshot,...await options.scene(host,blob,onProgress,signal,quality,right)};viewers.push(viewer);return viewer}
      const error=new Error('Modellen manglar på telefonen.');error.code='PHONE_SETUP_REQUIRED';throw error;
    },
    setTimeout: (callback, delay) => timeout(callback, delay),
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => timeout(callback, delay, true),
    clearInterval: id => timers.delete(id),
    fetch,
  });
  vm.runInContext(application, context, { filename: 'camera_ui.html' });
  async function tick(duration) {
    await flush();
    const end = now + duration;
    let count = 0;
    while (true) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      if (++count > 10000) throw new Error('Timer loop');
      now = due[1].at;
      if (due[1].interval) due[1].at += due[1].delay; else timers.delete(due[0]);
      due[1].callback();
      await flush();
    }
    now = end;
    await flush();
  }
  async function emit(name, details = {}) {
    await Promise.all((events.get(name) ?? []).map(callback => callback({ type: name, ...details })));
    await flush();
  }
  function changeStudio(kind, level) { studioControls[kind] = level; for (const binding of studioBindings) binding.onChange(kind, level); }
  function gestureStudio() { for (const binding of studioBindings) binding.onGesture?.(); }
  function gesturePhoto(pose){if(!photoGestureBinding.enabled())return false;Object.assign(photoGestureState,pose);photoGestureBinding.onChange(photoGestureState);return true}
  function gestureLive(pose){if(!liveGestureBinding.enabled())return false;Object.assign(liveGestureState,pose);liveGestureBinding.onChange(liveGestureState);return true}
  return { get live(){return images.findLast(image=>/^https?:.*\/stream\?/.test(image.src))??{src:''}}, checkModels:()=>window.checkPhone(), showPhoto:(blob,master=null,id=null)=>window.showPhoto(blob,new AbortController().signal,null,master,id), status, elements, document, images, canvases, requests, revoked, objectUrls, sceneCalls, artCalls, artViews, restoreCalls, viewers, printCalls, printConfiguration, saves, encodedSnapshots, photoViews, nativeSnapshot, reportPrint:message=>printReport(message), photoGestureState, liveGestureState, finders, photoRefreshes, gesturePhoto, gestureLive, get photoResets(){return photoResets}, snapshot, modelChecks, preparations, studioControls, changeStudio, gestureStudio, opened, messages, childWindow, stored, response, pairResponse, tick, emit, get: id => elements.get(id), choosePalette:id=>{if(!colorBinding)throw Error('Palettes not mounted');colorBinding.onChoose(colorBinding.getKind(),id)}, paletteKind:()=>colorBinding?.getKind(), selectedPalette:()=>colorBinding?.getSelection(colorBinding.getKind()) };
}

async function connectedCamera(options = {}) {
  const app = harness(options);
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, false);
  assert.equal(app.get('studio').classList.contains('connected'), true);
  if(options.splats)app.changeStudio('image',1);
  return app;
}

test('depth mode keeps its grayscale preview when the second camera connects and restores the saved photo palette on mode changes',async()=>{
  const app=await connectedCamera({image:2,second:true,storage:{'entropi-screen-photo-v2':'gameboy'}});
  assert.equal(app.studioControls.image,2);assert.equal(app.finders[0].monochrome,true);
  assert.ok(app.requests.some(request=>request.url.startsWith('/peer/preview')));
  app.changeStudio('image',0);assert.equal(app.finders[0].monochrome,false);assert.equal(app.finders[0].palette,'gameboy');
  app.changeStudio('image',2);assert.equal(app.finders[0].monochrome,true);assert.equal(app.finders[0].palette,'gameboy');
  await app.tick(10000);assert.equal(app.studioControls.image,2);
});

test('a missing peer leaves mono unchanged and ignores obsolete saved addresses',async()=>{
  const app=await connectedCamera({secondAddress:'http://192.168.4.2'});
  assert.doesNotMatch(html,/second-address|connect-second|disconnect-second|second-feedback|entropi-second-camera|stereo-dialog|capture-pair|save-left|save-right/);
  await app.tick(10000);assert.equal(app.requests.some(request=>request.url.startsWith('/peer/')),false);
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.studioControls.image,0);assert.equal(app.sceneCalls.length,0);
  assert.ok(app.requests.every(request=>request.url.startsWith('/')));
});

test('obsolete calibration links and stored shifts cannot alter the fixed rig capture',async()=>{
  const app=await connectedCamera({search:'?kalibrer=1',storage:{'entropi-stereo-vshift-v1':'110'},second:true,scene:async()=>({dispose(){}})});
  assert.equal(app.get('studio').hidden,false);
  assert.doesNotMatch(html,/calibration-screen|vertical-shift|shift-reset|shift-suggest|setup-calibrate|kalibrer|stereo-vshift|RETT INN LINSENE/);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls.length,1);
  assert.ok(app.sceneCalls[0].blob instanceof Blob);
  assert.ok(app.sceneCalls[0].right instanceof Blob);
  assert.equal(app.sceneCalls[0].extra.length,0);
  assert.equal(app.get('save-stereo'),undefined);
  assert.equal(app.stored.get('entropi-stereo-vshift-v1'),'110');
});

test('automatic pairing waits for a decoded fresh preview without blocking the mono shutter',async()=>{
  const preview=deferred(),decoded=deferred();let previewImage;
  const app=await connectedCamera({second:true,fetch:url=>url.startsWith('/peer/preview')?preview.promise:undefined,decode:image=>{previewImage=image;return decoded.promise}});
  assert.equal(app.studioControls.image,0);assert.equal(app.get('capture-plane').disabled,false);
  const blob=new Blob(['preview'],{type:'image/jpeg'});preview.resolve(app.response(blob));await flush();
  assert.equal(app.studioControls.image,0);decoded.resolve();await flush();
  assert.equal(app.studioControls.image,1);assert.equal(app.finders.length,1);assert.equal(app.get('onboarding').open,false);
  assert.equal(previewImage.blob,blob);assert.ok(app.revoked.includes(previewImage.src));
  assert.equal(app.images.filter(image=>image.src.startsWith('http')).length,1);
  assert.equal(app.stored.get('entropi-second-camera'),undefined);
});

for(const [label,peer] of Object.entries({missing:null,duplicate:{camera_id:verifiedStatus.camera_id},malformed:{camera_id:'camera2'},numeric:{camera_id:123456789012},empty:{}}))test(`an advertised ${label} peer never starts pairing`,async()=>{
  const app=await connectedCamera({status:{...verifiedStatus,peer}});await app.tick(10000);
  assert.equal(app.requests.some(request=>request.url.startsWith('/peer/')),false);
  await app.get('capture-plane').emit('click');assert.equal(app.get('photo-dialog').open,true);assert.equal(app.studioControls.image,0);
});

for(const [label,status] of Object.entries({duplicate:{...verifiedStatus},legacy:{...verifiedStatus,camera_id:undefined},unexpected:{...verifiedStatus,camera_id:'cccccccccccc'},unready:{...verifiedStatus,camera_id:'bbbbbbbbbbbb',stream_ready:false}}))test(`secondary ${label} status preserves mono capture`,async()=>{
  const app=await connectedCamera({second:true,secondStatus:status});
  assert.equal(app.requests.some(request=>request.url.startsWith('/peer/preview')),false);
  await app.get('capture-plane').emit('click');assert.equal(app.get('photo-dialog').open,true);assert.equal(app.studioControls.image,0);
  assert.equal(app.requests.some(request=>request.url.startsWith('/stereo/capture')),false);
});

for(const [label,blob] of Object.entries({empty:new Blob([],{type:'image/jpeg'}),html:new Blob(['offline'],{type:'text/html'})}))test(`an ${label} secondary preview cannot enable pairing`,async()=>{
  const app=await connectedCamera({second:true,fetch:(url,count,response)=>url.startsWith('/peer/preview')?response(blob):undefined});
  await app.get('capture-plane').emit('click');assert.equal(app.get('photo-dialog').open,true);assert.equal(app.studioControls.image,0);
  assert.equal(app.requests.some(request=>request.url.startsWith('/stereo/capture')),false);
});

test('a corrupt secondary JPEG preserves the primary live camera',async()=>{
  const app=await connectedCamera({second:true,decode:async image=>{if(await image.blob.text()==='preview-jpeg')throw Error('Bad JPEG')}});
  assert.equal(app.studioControls.image,0);assert.equal(app.get('capture-plane').disabled,false);
  await app.get('capture-plane').emit('click');assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.requests.some(request=>request.url.startsWith('/stereo/capture')),false);
});

test('a timed out secondary request leaves mono usable and retries on the next heartbeat',async()=>{
  let checks=0;
  const app=await connectedCamera({second:true,fetch:(url,count,response,init)=>url==='/peer/status'&&++checks===1?new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))):undefined});
  await app.tick(5100);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.studioControls.image,0);
  await app.tick(5000);assert.equal(checks,2);assert.equal(app.studioControls.image,1);
});

test('a newly advertised peer joins automatically on a later primary heartbeat',async()=>{
  const app=await connectedCamera();app.status.peer={camera_id:'bbbbbbbbbbbb'};
  await app.tick(10000);assert.equal(app.studioControls.image,1);
  assert.equal(app.requests.filter(request=>request.url==='/peer/status').length,1);
  assert.equal(app.get('capture-plane').disabled,false);
});

test('capturing mono cancels pending pairing and rejects its late response',async()=>{
  const pending=deferred(),app=await connectedCamera({second:true,fetch:url=>url==='/peer/status'?pending.promise:undefined});
  await app.get('capture-plane').emit('click');pending.resolve(app.response({...verifiedStatus,camera_id:'bbbbbbbbbbbb'}));await app.tick(0);
  assert.equal(app.requests.find(request=>request.url==='/peer/status').init.signal.aborted,true);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.studioControls.image,0);assert.equal(app.sceneCalls.length,0);
  assert.equal(app.requests.some(request=>request.url.startsWith('/peer/preview')),false);
});

for(const reason of ['hidden','primary disconnected'])test(`a pending secondary preview cannot pair after ${reason}`,async()=>{
  const pending=deferred(),app=await connectedCamera({second:true,fetch:url=>url.startsWith('/peer/preview')?pending.promise:undefined});
  if(reason==='hidden'){app.document.hidden=true;await app.emit('visibilitychange')}else await app.live.emit('error');
  pending.resolve(app.response(new Blob(['preview'],{type:'image/jpeg'})));await app.tick(0);
  assert.equal(app.requests.find(request=>request.url.startsWith('/peer/preview')).init.signal.aborted,true);
  assert.equal(app.studioControls.image,0);assert.equal(app.get('capture-plane').disabled,true);
});

test('a changed advertised identity invalidates an older pairing response',async()=>{
  const pending=deferred(),app=await connectedCamera({second:true,fetch:url=>url==='/peer/status'?pending.promise:undefined});
  app.status.peer={camera_id:'cccccccccccc'};await app.tick(10000);
  pending.resolve(app.response({...verifiedStatus,camera_id:'bbbbbbbbbbbb'}));await app.tick(0);
  assert.equal(app.studioControls.image,0);assert.equal(app.get('capture-plane').disabled,false);
  assert.equal(app.requests.some(request=>request.url.startsWith('/peer/preview')),false);
});

test('pairing preserves a mode chosen while secondary verification is pending',async()=>{
  const pending=deferred(),app=await connectedCamera({second:true,scene:async()=>({dispose(){}}),fetch:url=>url==='/peer/status'?pending.promise:undefined});
  app.changeStudio('image',1);app.changeStudio('image',0);
  pending.resolve(app.response({...verifiedStatus,camera_id:'bbbbbbbbbbbb'}));await app.tick(0);
  assert.equal(app.studioControls.image,0);await app.get('capture-plane').emit('click');
  assert.equal(app.requests.filter(request=>request.url.includes('/capture')).length,1);assert.equal(app.sceneCalls.length,0);
});

test('a mode selected before primary connection is not treated as an automatic stereo choice',async()=>{
  const app=harness({second:true,frames:false});app.changeStudio('image',1);await app.tick(0);
  app.live.naturalWidth=320;app.live.naturalHeight=240;await app.tick(150);
  assert.equal(app.studioControls.image,1);app.status.peer=null;await app.tick(10000);
  assert.equal(app.studioControls.image,1);assert.equal(app.get('capture-plane').disabled,false);
});

test('the existing shutter captures both originals and produces one scene with the same save control',async()=>{
  const pending=deferred(),app=await connectedCamera({second:true,modelsReady:false,scene:async()=>({dispose(){}}),fetch:url=>url.startsWith('/stereo/capture')?pending.promise:undefined});
  const capture=app.get('capture-plane').emit('click');await flush();
  assert.equal(app.requests.filter(request=>request.url.includes('/capture')).length,1);
  await app.get('capture-plane').emit('click');assert.equal(app.requests.filter(request=>request.url.includes('/capture')).length,1);
  const leftBlob=jpeg('left-original'),rightBlob=jpeg('right-original');
  pending.resolve(app.pairResponse(leftBlob,rightBlob));await capture;await app.tick(0);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.get('scene').hidden,false);assert.equal(app.get('photo').hidden,true);
  assert.equal(app.sceneCalls.length,1);assert.deepEqual(new Uint8Array(await app.sceneCalls[0].blob.arrayBuffer()),new Uint8Array(await leftBlob.arrayBuffer()));assert.deepEqual(new Uint8Array(await app.sceneCalls[0].right.arrayBuffer()),new Uint8Array(await rightBlob.arrayBuffer()));
  assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);assert.equal(app.get('onboarding').open,false);
  assert.equal(app.get('save-photo').hidden,false);await app.get('save-photo').emit('click');
  assert.equal(app.saves.length,1);assert.equal(app.saves[0].blob.type,'image/png');assert.match(app.saves[0].name,/\.png$/);
  assert.equal(app.encodedSnapshots[0],app.nativeSnapshot);
});

test('a failed second capture cannot replace the previous single-camera photograph',async()=>{
  const app=await connectedCamera({modelsReady:false,fetch:(url,count,response)=>url.startsWith('/stereo/capture')?response(null,false):undefined});
  await app.get('capture-plane').emit('click');const original=app.get('photo').src;
  await app.get('close-photo').emit('click');await app.tick(150);app.status.peer={camera_id:'bbbbbbbbbbbb'};await app.tick(10000);
  await app.get('capture-plane').emit('click');await app.tick(150);
  assert.equal(app.get('photo-dialog').open,false);assert.equal(app.get('photo').src,original);assert.equal(app.sceneCalls.length,0);assert.equal(app.get('retry-capture').hidden,false);
  app.changeStudio('image',0);await app.get('last-photo').emit('click');await app.get('save-photo').emit('click');
  assert.equal(app.saves.length,1);assert.equal(app.get('photo').src,original);
});

test('suspending a pending stereo capture rejects late images and releases temporary URLs',async()=>{
  const pending=deferred(),app=await connectedCamera({second:true,fetch:url=>url.startsWith('/stereo/capture')?pending.promise:undefined});
  const before=app.revoked.length,capture=app.get('capture-plane').emit('click');await flush();app.document.hidden=true;await app.emit('visibilitychange');
  assert.equal(app.requests.find(request=>request.url.startsWith('/stereo/capture')).init.signal.aborted,true);
  pending.resolve(app.pairResponse());await capture;
  assert.equal(app.get('photo-dialog').open,false);assert.equal(app.sceneCalls.length,0);assert.equal(app.revoked.length-before,2);
});

test('completed stereo review survives backgrounding and returning revalidates the peer',async()=>{
  const app=await connectedCamera({second:true,modelsReady:false,scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);
  const original=app.get('photo').src,requests=app.requests.length;
  app.document.hidden=true;await app.emit('visibilitychange');app.document.hidden=false;await app.emit('visibilitychange');await app.tick(10150);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.get('scene').hidden,false);assert.equal(app.get('photo').src,original);
  assert.equal(app.requests.length,requests);assert.equal(app.sceneCalls.length,1);await app.get('save-photo').emit('click');assert.equal(app.saves.length,1);
  await app.get('close-photo').emit('click');await app.tick(150);await app.tick(300);assert.equal(app.get('capture-plane').disabled,false);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/peer/preview')).length,2);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls.length,2);assert.ok(app.sceneCalls[1].right);assert.equal(app.modelChecks.length,0);
});

test('a vanished peer restores mono and recovery does not keep switching the selected mode',async()=>{
  const app=await connectedCamera({second:true});assert.equal(app.studioControls.image,1);
  app.status.peer=null;await app.tick(10000);assert.equal(app.studioControls.image,0);assert.equal(app.get('capture-plane').disabled,false);
  await app.get('capture-plane').emit('click');assert.equal(app.requests.filter(request=>request.url.includes('/capture')).length,1);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.modelChecks.length,0);await app.get('close-photo').emit('click');await app.tick(150);
  app.status.peer={camera_id:'bbbbbbbbbbbb'};await app.tick(10000);
  assert.equal(app.studioControls.image,0);await app.get('capture-plane').emit('click');
  assert.equal(app.requests.filter(request=>request.url.startsWith('/stereo/capture')).length,1);assert.equal(app.sceneCalls.length,0);
});

test('secondary health failure preserves a mode explicitly chosen by the user',async()=>{
  let ready=true;
  const app=await connectedCamera({second:true,fetch:(url,count,response)=>url==='/peer/status'?response({...verifiedStatus,camera_id:'bbbbbbbbbbbb',stream_ready:ready}):undefined});
  app.changeStudio('image',0);app.changeStudio('image',1);ready=false;await app.tick(10000);
  assert.equal(app.studioControls.image,1);assert.equal(app.get('capture-plane').disabled,false);
  ready=true;await app.tick(10000);assert.equal(app.studioControls.image,1);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/peer/preview')).length,2);
});

test('an older primary heartbeat cannot restart streams during stereo capture',async()=>{
  const heartbeat=deferred(),photo=deferred();let statusCalls=0;
  const app=await connectedCamera({second:true,scene:async()=>({dispose(){}}),fetch:url=>url==='/status'&&++statusCalls>1?heartbeat.promise:url.startsWith('/stereo/capture')?photo.promise:undefined});
  await app.tick(10000);const capture=app.get('capture-plane').emit('click');await flush();
  heartbeat.reject(new Error('Disconnected'));await app.tick(2000);assert.equal(statusCalls,2);assert.equal(app.live.src,'');
  photo.resolve(app.pairResponse());await capture;await app.tick(0);assert.equal(app.get('save-photo').hidden,false);
});

test('different photo dimensions cannot enter stereo reconstruction',async()=>{
  const right=jpeg('right-mismatch-original');
  const app=await connectedCamera({second:true,fetch:(url,count,response,init,pair)=>url.startsWith('/stereo/capture')?pair(undefined,right):undefined,imageSize:image=>image.blob.size===right.size?[800,600]:[1600,1200]});
  await app.get('capture-plane').emit('click');assert.equal(app.sceneCalls.length,0);assert.equal(app.get('photo-dialog').open,false);assert.equal(app.get('retry-capture').hidden,false);
});

test('automatic stereo mismatch returns to photo and explicit 3D still explains the error',async()=>{
  const app=await connectedCamera({second:true,modelsReady:false,scene:async()=>{throw new Error('For få sikre samsvar.')}});await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls.length,1);assert.ok(app.sceneCalls[0].right);
  assert.equal(app.studioControls.image,0);assert.equal(app.get('save-photo').hidden,false);
  assert.equal(app.get('retry-scene').hidden,true);
  assert.match(app.get('print-status').textContent,/Hald motivet stille.*meir lys/);
  assert.doesNotMatch(app.get('print-status').textContent,/justering|rett inn/);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);
  app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.sceneCalls.length,2);assert.equal(app.get('retry-scene').hidden,false);
  app.changeStudio('image',0);assert.equal(app.get('save-photo').hidden,false);
  await app.get('save-photo').emit('click');assert.equal(app.saves.length,1);
});

test('capture stays unavailable until both camera status and a decoded live frame exist', async () => {
  const app = harness({ frames: false });
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, true);
  assert.equal(app.get('studio').classList.contains('connected'), false);
  app.live.naturalWidth = 320;
  app.live.naturalHeight = 240;
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, false);
  assert.equal(app.get('studio').classList.contains('connected'), true);
});

for (const [label, status] of Object.entries({ missing: {}, null: null, 'string frame size': { ...verifiedStatus, framesize: '10' }, 'missing brightness': { ...verifiedStatus, brightness: undefined }, 'missing readiness': { ...verifiedStatus, camera_ready: undefined } })) {
  test(`invalid status (${label}) cannot report a connected camera`, async () => {
    const app = harness({ status });
    await app.tick(150);
    assert.equal(app.get('capture-plane').disabled, true);
    assert.equal(app.get('studio').classList.contains('connected'), false);
    assert.match(app.get('connection-label').textContent, /Fråkopla/);
    assert.equal(app.live.src, '');
  });
}

test('a failed capture retains the last live frame and permits another attempt', async () => {
  const app = await connectedCamera({ fetch: (url, count, response) => url.startsWith('/capture') ? response(null, false) : undefined });
  const source = app.canvases[0];
  assert.ok(source.draws > 0);
  const clears = source.clears;
  await app.get('capture-plane').emit('click');await app.tick(150);
  assert.equal(source.clears, clears);
  assert.equal(app.get('photo-dialog').open, false);
  assert.equal(app.get('capture-plane').disabled, false);
  assert.match(app.get('notice').textContent, /ikkje takast/);
  assert.match(app.live.src, /:81\/stream/);
});

test('repeated shutter input sends only one capture request while capture is pending', async () => {
  const pending = deferred();
  const app = await connectedCamera({ fetch: url => url.startsWith('/capture') ? pending.promise : undefined });
  const first = app.get('capture-plane').emit('click');
  const second = app.get('capture-plane').emit('click');
  await flush();
  assert.equal(app.requests.filter(request => request.url.startsWith('/capture')).length, 1);
  assert.equal(app.get('capture-plane').disabled, true);
  pending.resolve(app.response(new Blob(['jpeg'], { type: 'image/jpeg' })));
  await Promise.all([first, second]);
  assert.equal(app.get('photo-dialog').open, true);
});

test('leaving photo review removes the dialog and resumes the live stream', async () => {
  const app = await connectedCamera({scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open, true);
  assert.equal(app.live.src, '');
  assert.match(app.get('photo').src, /^blob:/);
  await app.get('close-photo').emit('click');await app.tick(150);
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.live.src, /:81\/stream/);
  assert.equal(app.document.activeElement, app.get('capture-plane'));
  assert.equal(app.get('capture-plane').disabled, false);
});



test('suspension clears connected UI and resume waits for a fresh status and frame', async () => {
  const pending = deferred();
  let statusReads = 0;
  const app = await connectedCamera({ fetch: url => {
    if (url.startsWith('/status') && ++statusReads > 1) return pending.promise;
  } });
  app.document.hidden = true;
  await app.emit('visibilitychange');
  assert.equal(app.get('capture-plane').disabled, true);
  assert.equal(app.get('studio').classList.contains('connected'), false);
  assert.equal(app.live.src, '');
  app.document.hidden = false;
  await app.emit('visibilitychange');
  assert.equal(app.get('capture-plane').disabled, true);
  pending.resolve(app.response({ ...verifiedStatus }));
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, false);
});

test('hidden page cannot accept an in-flight connection response as connected', async () => {
  const pending = deferred();
  const app = harness({ fetch: url => url.startsWith('/status') ? pending.promise : undefined });
  await flush();
  app.document.hidden = true;
  await app.emit('visibilitychange');
  pending.resolve(app.response({ ...verifiedStatus }));
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, true);
  assert.equal(app.get('studio').classList.contains('connected'), false);
  assert.equal(app.live.src, '');
});

test('the connection helper remains usable when optional browser storage is denied', async () => {
  const app = await connectedCamera({ storageDenied: true });
  await app.get('connection').emit('click');
  assert.equal(app.get('onboarding').open, true);
  assert.equal(app.get('onboarding-title').textContent,'Kameraet er klart');
  assert.equal(app.get('onboarding-next').hidden,false);
  assert.equal(app.get('onboarding-copy').hidden,false);
  await app.get('close-onboarding').emit('click');
  assert.equal(app.get('onboarding').open, false);
  assert.equal(app.preparations.length,0);
  assert.equal(app.modelChecks.length,0);
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open, true);
});

test('the connection helper exposes the open ENTROPI network without password fields or copying', async () => {
  const app=harness({search:'?setup',frames:false});await app.tick(150);
  assert.equal(app.get('onboarding').open,true);
  assert.equal(app.get('onboarding-title').textContent,'Finn kameraet');
  assert.match(app.get('onboarding-copy').textContent,/Slå på begge kameraa, vel ENTROPI under Wi-Fi/);
  assert.equal(app.get('onboarding-next').getAttribute('aria-label'),'Prøv igjen');
  assert.match(html,/vel ENTROPI under Wi-Fi og hald tilkoplinga utan internett/);
  assert.equal(app.get('password'),undefined);
  assert.equal(app.get('copy-password'),undefined);
  assert.doesNotMatch(html,/entropi2026|copy-password|navigator\.clipboard|\bid=["']password["']/i);
});



for (const stream_ready of [true, false]) {
  test(`sensor failure retains actionable diagnostics without starting a stream (${stream_ready})`, async () => {
    const app = harness({ status: { ...verifiedStatus, camera_ready: false, stream_ready, last_error: 'Sensor not found (0x105)' } });
    await app.tick(150);
    assert.equal(app.get('capture-plane').disabled, true);
    assert.equal(app.get('studio').classList.contains('connected'), false);
    assert.equal(app.live.src, '');
    assert.match(app.get('notice').textContent, /Sensor not found/);
    assert.doesNotMatch(app.get('notice').textContent, /Wi-Fi|fråkopla/i);
    assert.equal(app.get('last-photo').hidden, true);
  });
}

test('a camera without a ready stream never reports a live connection', async () => {
  const app = harness({ status: { ...verifiedStatus, stream_ready: false, last_error: 'Stream server unavailable' } });
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, true);
  assert.equal(app.live.src, '');
  assert.match(app.get('notice').textContent, /Stream server unavailable/);
});

test('an invalid JPEG cannot open review', async () => {
  const app = await connectedCamera({ decodeFailure: true });
  await app.get('capture-plane').emit('click');await app.tick(150);
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.get('notice').textContent, /ikkje takast/);
  assert.equal(app.get('capture-plane').disabled, false);
});

test('an HTML capture response cannot be mistaken for a photo', async () => {
  const app = await connectedCamera({ fetch: (url, count, response) => url.startsWith('/capture') ? response(new Blob(['error'], { type: 'text/html' })) : undefined });
  await app.get('capture-plane').emit('click');await app.tick(150);
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.get('notice').textContent, /ikkje takast/);
  assert.equal(app.get('capture-plane').disabled, false);
});

test('photo mode opens the original JPEG immediately without models or preparation',async()=>{
  const app=await connectedCamera({modelsReady:false,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.studioControls.image,0);assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.get('photo').hidden,false);assert.equal(app.get('scene').hidden,true);
  assert.equal(app.sceneCalls.length,0);assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('scene-progress').hidden,true);
  assert.equal(app.get('save-photo').tagName,'BUTTON');assert.equal(app.get('save-photo').getAttribute('href'),null);assert.equal(app.get('save-photo').getAttribute('download'),null);
  assert.match(html,/\.review img\{[^}]*filter:grayscale\(1\)/);assert.doesNotMatch(html,/toggle-scene/);
});

test('VATHOgraphy preserves a mono capture before setup and retries the same original',async()=>{
  const app=await connectedCamera({vathography:true,modelsReady:false});
  assert.equal(app.modelChecks.length,1);assert.equal(app.get('onboarding').open,false);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.get('onboarding').open,true);assert.equal(app.artCalls.length,0);
  const original=app.objectUrls.get(app.finders[0].captures[0].url),photo=app.get('photo').src;
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  await app.get('close-onboarding').emit('click');assert.equal(app.studioControls.image,2);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.get('retry-scene').hidden,false);
  await app.get('retry-scene').emit('click');await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.artCalls.length,1);assert.equal(app.artCalls[0].blob,original);assert.equal(app.get('photo').src,photo);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('marigold-view').hidden,false);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('a cold VATHOgraphy phone waits silently for peer validation and dismisses stale setup',async()=>{
  const preview=deferred(),app=await connectedCamera({vathography:true,second:true,modelsReady:false,fetch:url=>url.startsWith('/peer/preview')?preview.promise:undefined});
  assert.equal(app.modelChecks.length,1);assert.equal(app.get('onboarding').open,false);assert.equal(app.preparations.length,0);
  await app.get('connection').emit('click');assert.equal(app.get('onboarding').open,true);
  preview.resolve(app.response(jpeg('peer-preview')));await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.preparations.length,0);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.artCalls.length,1);assert.equal(app.artCalls[0].settings.right.type,'image/jpeg');
  assert.equal(app.get('marigold-view').hidden,false);assert.equal(app.get('onboarding').open,false);
});

test('an archive overlay blocks capture-plane and keyboard capture at the central guard',async()=>{
  const app=await connectedCamera();app.get('archive').hidden=false;
  await app.get('capture-plane').emit('click');await app.emit('keydown',{code:'Space',repeat:false,preventDefault(){}});
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,0);
  assert.equal(app.get('photo-dialog').open,false);
  app.get('archive').hidden=true;await app.get('capture-plane').emit('click');
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('VATHOgraphy preserves the last frame through capture, processing, accessible failure and icon retry',async()=>{
  const capture=deferred(),processing=deferred();let attempts=0;
  const app=await connectedCamera({vathography:true,fetch:url=>url.startsWith('/capture')?capture.promise:undefined,art:()=>++attempts===1?processing.promise:Promise.resolve({model:'ready'})});
  assert.equal(app.modelChecks.length,1);assert.equal(app.get('onboarding').open,false);
  const taking=app.get('capture-plane').emit('click');await flush();
  assert.equal(app.finders[0].active,false);assert.equal(app.get('review-finder').draws,1);
  assert.equal(app.get('review-finder').width,app.get('finder').width);
  assert.doesNotMatch(html,/capturing-splats[^}]+visibility:hidden/);
  capture.resolve(app.response(new Blob(['camera'],{type:'image/jpeg'})));await taking;await app.tick(0);
  assert.equal(app.get('review-finder').hidden,false);assert.equal(app.finders[0].active,false);
  assert.equal(app.get('scene-progress').hidden,false);assert.equal(app.get('save-stereo'),undefined);
  assert.equal(app.get('scene-status').hidden,true);assert.equal(app.get('scene-status').textContent,'');
  processing.reject(new Error('Klarte ikkje å lese djupna.'));await app.tick(0);
  assert.equal(app.get('review-finder').hidden,false);assert.equal(app.get('scene-progress').hidden,true);
  assert.equal(app.get('scene-status').hidden,false);assert.match(app.get('scene-status').textContent,/lese djupna/);
  assert.equal(app.get('retry-scene').hidden,false);assert.equal(app.get('retry-scene').getAttribute('aria-label'),'Prøv djupnekunst på nytt');
  assert.match(html,/<p id="scene-status" class="review-status sr"/);
  await app.get('retry-scene').emit('click');await app.tick(0);
  assert.equal(app.artCalls.length,2);assert.equal(app.get('marigold-view').hidden,false);
  assert.equal(app.get('review-finder').hidden,true);assert.equal(app.get('scene-status').hidden,true);
  assert.equal(app.get('save-photo').hidden,false);assert.equal(app.get('retry-scene').hidden,true);
});

test('splats check models only when selected and use fixed quality',async()=>{
  const styles=[],app=await connectedCamera({scene:async()=>({dispose(){},setPrimitiveLevel(level){styles.push(level)}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  const url=app.get('photo').src;app.changeStudio('primitive',3);app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.modelChecks.length,1);assert.equal(app.sceneCalls.length,1);assert.equal(app.sceneCalls[0].quality,2);
  assert.equal(app.sceneCalls[0].blob,app.objectUrls.get(url));assert.equal(styles.at(-1),2);
  assert.equal(app.get('scene').hidden,false);assert.equal(app.get('photo').hidden,true);
  assert.equal(app.get('photo').src,url);assert.equal(app.get('scene-status').textContent,'');
});

test('processing retains the live finder and its review copy until the scene is ready',async()=>{
  const capture=deferred(),scene=deferred(),app=await connectedCamera({splats:true,fetch:url=>url.startsWith('/capture')?capture.promise:undefined,scene:()=>scene.promise});const taking=app.get('capture-plane').emit('click');await flush();assert.equal(app.get('studio').classList.contains('capturing-splats'),true);assert.equal(app.get('progress').hidden,false);
  capture.resolve(app.response(new Blob(['raw-camera'],{type:'image/jpeg'})));await taking;await app.tick(0);assert.equal(app.get('photo-dialog').open,true);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);assert.equal(app.photoViews[0].shows.some(Boolean),false);assert.equal(app.get('scene').hidden,true);assert.equal(app.get('scene-progress').hidden,false);assert.equal(app.get('scene-status').textContent,'');assert.equal(app.get('save-photo').hidden,true);assert.equal(app.get('print-photo').hidden,true);await app.get('save-photo').emit('click');await app.get('print-photo').emit('click');assert.equal(app.saves.length,0);assert.equal(app.printCalls.length,0);
  scene.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('scene').hidden,false);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);app.changeStudio('image',0);assert.equal(app.get('photo').hidden,false);assert.equal(app.photoViews[0].shown,true);
});

test('camera JPEG is framed once and only the derived color PNG is used by review and depth',async()=>{
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);const finder=app.finders[0],framed=app.objectUrls.get(app.get('photo').src);assert.equal(finder.captures.length,1);assert.equal(app.objectUrls.get(finder.captures[0].url).type,'image/jpeg');assert.equal(framed.type,'image/png');assert.equal(app.sceneCalls[0].blob,framed);assert.equal(finder.captures[0].canvas.width,1);assert.equal(finder.captures[0].canvas.height,1);assert.ok(app.revoked.includes(finder.captures[0].url));
  await app.get('close-photo').emit('click');await app.tick(150);await app.get('last-photo').emit('click');app.changeStudio('image',0);app.changeStudio('image',1);assert.equal(finder.captures.length,1);assert.equal(app.sceneCalls.length,1);assert.equal(app.objectUrls.get(app.get('photo').src),framed);
});

test('failed or abandoned PNG encoding retains the last valid photo and never publishes a partial frame',async()=>{
  for(const abandon of [false,true]){
    let encode,encodes=0;const app=await connectedCamera({encode:(callback,type)=>{if(++encodes===1)callback(new Blob(['first'],{type}));else encode=callback}});await app.get('capture-plane').emit('click');const original=app.get('photo').src;await app.get('close-photo').emit('click');await app.tick(150);const taking=app.get('capture-plane').emit('click');await flush();if(abandon)await app.emit('pagehide');encode(abandon?new Blob(['late'],{type:'image/png'}):null);await taking;await app.tick(0);assert.equal(app.get('photo').src,original);assert.equal(app.revoked.includes(original),false);assert.equal(app.finders[0].captures[1].canvas.width,1);assert.equal(app.finders[0].captures[1].canvas.height,1);assert.equal(app.get('photo-dialog').open,false);
  }
});

test('the image rail reuses one JPEG and one scene while preserving its view state',async()=>{
  let disposed=false,refreshes=0;const viewer={angle:42,dispose(){disposed=true},refresh(){refreshes++}},app=await connectedCamera({scene:async()=>viewer});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  const url=app.get('photo').src;viewer.angle=81;
  app.changeStudio('image',0);assert.equal(app.get('photo').hidden,false);assert.equal(app.get('scene').hidden,true);
  app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('scene').hidden,false);assert.equal(viewer.angle,81);assert.equal(disposed,false);
  assert.equal(refreshes,2);
  assert.equal(app.sceneCalls.length,1);assert.equal(app.sceneCalls[0].signal.aborted,false);
  assert.equal(app.get('photo').src,url);assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
});

test('a scene completing after photo selection stays cached without taking over the photo',async()=>{
  const pending=deferred(),app=await connectedCamera({splats:true,scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');await app.tick(0);assert.equal(app.sceneCalls.length,1);
  app.changeStudio('image',0);assert.equal(app.get('scene-progress').hidden,true);
  pending.resolve({dispose(){}});await app.tick(0);
  assert.equal(app.get('photo').hidden,false);assert.equal(app.get('scene').hidden,true);
  assert.equal(app.get('scene-status').textContent,'');assert.equal(app.get('photo-dialog').classList.contains('working'),false);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.get('scene').hidden,false);assert.equal(app.sceneCalls.length,1);
});

test('returning to a pending splat does not start another model run',async()=>{
  const pending=deferred(),app=await connectedCamera({splats:true,scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');await app.tick(0);
  app.changeStudio('image',0);app.changeStudio('image',1);app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene-progress').hidden,false);
  pending.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('scene').hidden,false);
});

test('switching to photo while checking models suppresses setup and inference',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:()=>pending.promise,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.modelChecks.length,1);app.changeStudio('image',0);pending.resolve(false);await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.sceneCalls.length,0);assert.equal(app.preparations.length,0);
  assert.equal(app.get('photo').hidden,false);assert.equal(app.get('retry-scene').hidden,true);
  await app.get('close-photo').emit('click');await app.tick(150);assert.equal(app.get('capture-plane').disabled,false);
});

test('a late ready cache never starts splats after photo selection',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:()=>pending.promise,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);app.changeStudio('image',0);
  pending.resolve(true);await app.tick(0);assert.equal(app.sceneCalls.length,0);assert.equal(app.get('photo').hidden,false);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.modelChecks.length,1);
});

test('closing review cancels a model check before it can open setup over the camera',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:()=>pending.promise});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  await app.get('close-photo').emit('click');await app.tick(150);assert.equal(app.modelChecks[0].aborted,true);
  pending.resolve(false);await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.preparations.length,0);
});

test('missing models ask for setup only for splats and leave the JPEG available',async()=>{
  const app=await connectedCamera({modelsReady:false});await app.get('capture-plane').emit('click');
  assert.equal(app.get('onboarding').open,false);app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('onboarding').open,true);assert.equal(app.get('photo').hidden,true);
  assert.match(app.get('photo').src,/^blob:/);assert.equal(app.sceneCalls.length,0);
  assert.equal(app.get('retry-scene').getAttribute('aria-label'),'Klargjer telefonen');assert.equal(app.opened.length,0);
  let prevented=false;await app.get('onboarding').emit('cancel',{preventDefault(){prevented=true}});app.get('onboarding').close();
  assert.equal(prevented,true);assert.equal(app.get('onboarding').open,false);assert.equal(app.studioControls.image,0);assert.equal(app.get('photo').hidden,false);assert.equal(app.get('save-photo').hidden,false);assert.equal(app.get('print-photo').hidden,false);await app.get('close-photo').emit('click');await app.tick(150);
  assert.equal(app.get('capture-plane').disabled,false);
});

test('a scene model error does not replace a newly selected photo with setup',async()=>{
  const pending=deferred(),app=await connectedCamera({splats:true,scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');await app.tick(0);app.changeStudio('image',0);
  pending.reject(Object.assign(new Error('Missing model'),{code:'PHONE_SETUP_REQUIRED'}));await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('photo').hidden,false);assert.equal(app.get('scene-status').textContent,'');
});

test('explicit model preparation builds splats from the same JPEG',async()=>{
  const app=await connectedCamera({modelsReady:false,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');const url=app.get('photo').src;
  app.changeStudio('image',1);await app.tick(0);await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.preparations.length,1);assert.equal(app.sceneCalls.length,1);
  assert.equal(app.sceneCalls[0].blob,app.objectUrls.get(url));assert.equal(app.get('photo').src,url);
  assert.equal(app.get('scene').hidden,false);assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
  const viewer=app.viewers[0];await app.get('connection').emit('click');await app.get('close-onboarding').emit('click');
  assert.equal(app.studioControls.image,1);assert.equal(app.get('scene').hidden,false);assert.equal(app.get('photo').hidden,true);assert.equal(app.sceneCalls.length,1);assert.equal(app.viewers[0],viewer);assert.equal(app.get('photo').src,url);
});

test('preparation finishing in photo mode does not run or open splats',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:false,prepare:()=>pending.promise,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  await app.get('onboarding-next').emit('click');app.changeStudio('image',0);pending.resolve();await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('photo').hidden,false);assert.equal(app.sceneCalls.length,0);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);
});

test('cancelling model transfer leaves photo mode usable and ignores a late completion',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:false,prepare:()=>pending.promise,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  await app.get('onboarding-next').emit('click');await app.get('onboarding').emit('cancel');app.get('onboarding').close();
  assert.equal(app.preparations[0].signal.aborted,true);assert.equal(app.studioControls.image,0);pending.resolve();await app.tick(0);
  assert.equal(app.sceneCalls.length,0);assert.equal(app.get('onboarding').open,false);
  await app.get('close-photo').emit('click');await app.tick(150);assert.equal(app.get('capture-plane').disabled,false);
});

test('a prepared opener is used only after splats request models',async()=>{
  const pending=deferred(),opener={postMessage(){}},app=await connectedCamera({search:'?connect',opener,modelsReady:false,prepare:()=>pending.promise,scene:async()=>({dispose(){}})});
  assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.preparations.length,1);assert.equal(app.preparations[0].source,opener);
  pending.resolve();await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.opened.length,0);
});

test('image holds do not print and the print icon exports a positive B&W snapshot with a current handoff',async()=>{
  const app=await connectedCamera({modelsReady:false});await app.get('capture-plane').emit('click');const target=app.get('photo');
  await app.get('photo-dialog').emit('pointerdown',{target});await app.tick(500);await app.get('photo-dialog').emit('pointerup',{target});
  assert.equal(app.printCalls.length,0);await app.get('print-photo').emit('click');
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image.photo,true);assert.equal(app.printCalls[0].image.width,384);
  assert.equal(app.printCalls[0].image.image,target);assert.equal(app.printCalls[0].isCurrent(),true);
  assert.equal(app.sceneCalls.length,0);app.changeStudio('image',1);assert.equal(app.printCalls[0].isCurrent(),false);
});

test('splat holds do not print and the print icon preserves current-view and stale-handoff guards',async()=>{
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);const target=app.get('scene');
  await app.get('photo-dialog').emit('pointerdown',{target});await app.tick(500);await app.get('photo-dialog').emit('pointerup',{target});
  assert.equal(app.printCalls.length,0);await app.get('print-photo').emit('click');
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image,app.snapshot);assert.equal(app.printCalls[0].isCurrent(),true);
  assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
  await app.get('close-photo').emit('click');await app.tick(150);assert.equal(app.printCalls[0].isCurrent(),false);
});

test('dragging or three fingers cannot become a printer hold',async()=>{
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);const target=app.get('scene');
  await app.get('photo-dialog').emit('pointerdown',{target});await app.get('photo-dialog').emit('pointermove',{target,clientX:180});await app.tick(600);await app.get('photo-dialog').emit('pointerup',{target});
  for(const pointerId of [1,2,3])await app.get('photo-dialog').emit('pointerdown',{target,pointerId,isPrimary:pointerId===1});await app.tick(600);
  for(const pointerId of [3,2,1])await app.get('photo-dialog').emit('pointerup',{target,pointerId,isPrimary:pointerId===1});
  assert.equal(app.printCalls.length,0);assert.equal(app.get('photo-dialog').open,true);
});

test('a cardless photo reopens from the same JPEG without model work or storage routes',async()=>{
  const app=await connectedCamera({modelsReady:false});await app.get('capture-plane').emit('click');const url=app.get('photo').src;
  await app.get('close-photo').emit('click');await app.tick(150);await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(app.get('photo').src,url);assert.equal(app.get('photo-dialog').open,true);assert.equal(app.sceneCalls.length,0);
  assert.equal(app.modelChecks.length,0);assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
  assert.equal(app.requests.some(r=>/^\/(photos|photo)(\?|$)/.test(r.url)),false);
  assert.doesNotMatch(html,/minnekort|\bSD\b|X-Storage|X-Photo|gallery-dialog|photo-feedback/);
});

test('closing review allows pending inference to cache without reopening review',async()=>{
  const pending=deferred();let disposed=false;const app=await connectedCamera({splats:true,scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');await app.tick(150);
  assert.equal(app.sceneCalls[0].signal.aborted,false);pending.resolve({dispose(){disposed=true}});await app.tick(0);
  assert.equal(disposed,false);assert.equal(app.get('photo-dialog').open,false);assert.equal(app.get('scene').hidden,true);
  assert.match(app.live.src,/:81\/stream/);
  await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(app.get('scene').hidden,false);assert.equal(app.sceneCalls.length,1);
});

test('a late scene from an old capture cannot replace the new scene',async()=>{
  const pending=deferred();let starts=0,disposed=false;
  const app=await connectedCamera({splats:true,scene:()=>++starts===1?pending.promise:Promise.resolve({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');await app.tick(150);
  await app.get('capture-plane').emit('click');await app.tick(0);const url=app.get('photo').src;
  assert.equal(app.sceneCalls.length,2);pending.resolve({dispose(){disposed=true}});await app.tick(0);
  assert.equal(disposed,true);assert.equal(app.get('photo').src,url);assert.equal(app.get('scene').hidden,false);
  assert.equal(app.objectUrls.get(url),app.sceneCalls[1].blob);assert.equal(app.sceneCalls[1].signal.aborted,false);
});

test('closing and reopening a completed scene preserves its view without another capture or inference',async()=>{
  let disposed=0;const viewer={yaw:0,dispose(){disposed++}},app=await connectedCamera({splats:true,scene:async()=>viewer});
  await app.get('capture-plane').emit('click');await app.tick(0);viewer.yaw=1.7;
  const url=app.get('photo').src;await app.get('close-photo').emit('click');await app.tick(150);
  assert.equal(disposed,0);assert.equal(app.get('scene').hidden,true);
  await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(viewer.yaw,1.7);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').hidden,false);
  assert.equal(app.get('photo').src,url);assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
});

test('a failed next capture retains the last completed scene',async()=>{
  let captures=0,disposed=false;
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){disposed=true}}),fetch:(url,count,response)=>url.startsWith('/capture')&&++captures===2?response(new Blob(['error'],{type:'text/html'})):undefined});
  await app.get('capture-plane').emit('click');await app.tick(0);const url=app.get('photo').src;
  await app.get('close-photo').emit('click');await app.tick(150);await app.get('capture-plane').emit('click');await app.tick(150);
  assert.equal(disposed,false);assert.equal(app.get('photo-dialog').open,false);
  await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(app.get('photo').src,url);assert.equal(app.get('scene').hidden,false);assert.equal(app.sceneCalls.length,1);
});

test('a valid new photo disposes the previous scene exactly once',async()=>{
  let disposed=0;const app=await connectedCamera({splats:true,scene:async()=>({dispose(){disposed++}})});
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');await app.tick(150);
  assert.equal(disposed,0);await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(disposed,1);assert.equal(app.sceneCalls.length,2);assert.equal(app.sceneCalls[1].signal.aborted,false);
});

test('capture failure exposes only a transparent retry glyph and preserves the original thumbnail',async()=>{
  let captures=0;
  const app=await connectedCamera({fetch:(url,count,response)=>url.startsWith('/capture')&&++captures===2?response(null,false):undefined});
  assert.equal(app.elements.has('settings-dialog'),false);assert.equal(app.elements.has('settings-button'),false);
  assert.match(html,/<p id="notice" class="sr"/);assert.doesNotMatch(html,/drop-shadow/);
  await app.get('capture-plane').emit('click');const url=app.get('photo').src;
  assert.equal(app.get('photo-icon'),undefined);assert.doesNotMatch(html,/id="photo-icon"/);assert.equal(app.get('thumbnail').hidden,false);
  await app.get('close-photo').emit('click');await app.tick(150);await app.get('capture-plane').emit('click');await app.tick(150);
  assert.equal(app.get('retry-capture').hidden,false);assert.equal(app.get('retry-capture').disabled,false);
  assert.match(app.get('notice').textContent,/ikkje takast/);assert.equal(app.get('thumbnail').src,url);
  await app.get('retry-capture').emit('click');
  assert.equal(app.get('retry-capture').hidden,true);assert.equal(app.get('notice').textContent,'');assert.equal(app.get('photo-dialog').open,true);
});

test('photo zoom and recenter preserve the same JPEG across close, reopen and mode switches',async()=>{
  const app=await connectedCamera({scene:async()=>({dispose(){}})});
  assert.equal(app.gesturePhoto({scale:2,x:4,y:5}),false);
  await app.get('capture-plane').emit('click');const url=app.get('photo').src,resets=app.photoResets;
  assert.equal(app.get('recenter-photo').hidden,true);assert.equal(app.gesturePhoto({scale:2,x:45,y:-12}),true);
  assert.equal(app.get('recenter-photo').hidden,false);
  app.changeStudio('image',1);await app.tick(0);assert.equal(app.gesturePhoto({scale:3}),false);
  app.changeStudio('image',0);assert.equal(app.photoGestureState.scale,2);
  await app.get('close-photo').emit('click');await app.tick(150);assert.equal(app.get('recenter-photo').hidden,true);
  await app.get('last-photo').emit('click');assert.equal(app.photoGestureState.x,45);assert.equal(app.photoGestureState.y,-12);
  assert.equal(app.get('photo').src,url);assert.equal(app.photoResets,resets);assert.equal(app.sceneCalls.length,1);
  await app.get('recenter-photo').emit('click');
  assert.equal(app.photoGestureState.scale,1);assert.equal(app.photoGestureState.x,0);assert.equal(app.photoGestureState.y,0);assert.equal(app.get('recenter-photo').hidden,true);
});

test('only a valid new JPEG resets photo framing and printing receives the current viewport pose',async()=>{
  let captures=0;
  const app=await connectedCamera({fetch:(url,count,response)=>url.startsWith('/capture')&&++captures===2?response(null,false):undefined});
  await app.get('capture-plane').emit('click');app.gesturePhoto({scale:2.5,x:37,y:-16});
  await app.get('print-photo').emit('click');
  assert.equal(app.printCalls[0].image.pose.scale,2.5);assert.equal(app.printCalls[0].image.pose.x,37);
  assert.equal(app.printCalls[0].image.pose.width,390);assert.equal(app.printCalls[0].image.photo,true);
  const resets=app.photoResets;await app.get('close-photo').emit('click');await app.tick(150);await app.get('capture-plane').emit('click');await app.tick(150);
  assert.equal(app.photoResets,resets);assert.equal(app.photoGestureState.scale,2.5);
  await app.get('retry-capture').emit('click');assert.equal(app.photoResets,resets+1);assert.equal(app.photoGestureState.scale,1);
});

test('native device printing holds capture and MJPEG until terminal while preserving the current photo',async()=>{
  const pending=deferred(),app=await connectedCamera({print:()=>pending.promise});assert.equal(app.printConfiguration.devicePrinter.native,true);assert.equal(typeof app.printConfiguration.buildJob,'function');
  await app.get('capture-plane').emit('click');app.gesturePhoto({scale:2,x:20,y:-10});const original=app.get('photo').src,printing=app.get('print-photo').emit('click');await flush();
  assert.equal(app.printCalls.length,1);assert.equal(app.get('print-photo').disabled,true);await app.get('close-photo').emit('click');await app.tick(150);assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.get('progress').hidden,false);assert.equal(app.live.src,'');await app.get('capture-plane').emit('click');assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  pending.resolve(true);await printing;await app.tick(150);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.get('progress').hidden,true);assert.match(app.live.src,/\/stream/);assert.equal(app.opened.length,0);await app.get('last-photo').emit('click');assert.equal(app.get('photo').src,original);assert.equal(app.photoGestureState.scale,2);assert.equal(app.photoGestureState.x,20);
});

test('returning during native printing waits for terminal status before reconnecting the finder',async()=>{
  const pending=deferred(),app=await connectedCamera({print:()=>pending.promise});
  await app.get('capture-plane').emit('click');
  const printing=app.get('print-photo').emit('click');await flush();
  await app.get('close-photo').emit('click');await app.tick(150);
  const statusReads=app.requests.filter(request=>request.url.startsWith('/status')).length;
  app.document.hidden=true;await app.emit('visibilitychange');await app.emit('pagehide',{persisted:true});
  app.document.hidden=false;await app.emit('visibilitychange');await app.emit('pageshow',{persisted:true});await app.emit('online');
  await app.tick(10000);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/status')).length,statusReads);
  assert.equal(app.live.src,'');assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.get('progress').hidden,false);
  pending.resolve(true);await printing;await app.tick(150);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/status')).length,statusReads+1);
  assert.match(app.live.src,/\/stream/);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.get('progress').hidden,true);
  assert.equal(app.printCalls.length,1);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('native printing ignores a stale heartbeat and does not poll camera health until terminal',async()=>{
  const heartbeat=deferred(),pending=deferred();let statusReads=0;
  const app=await connectedCamera({print:()=>pending.promise,fetch:url=>url.startsWith('/status')&&++statusReads===3?heartbeat.promise:undefined});
  await app.get('capture-plane').emit('click');await app.get('close-photo').emit('click');await app.tick(150);await app.tick(10000);
  await app.get('last-photo').emit('click');
  const printing=app.get('print-photo').emit('click');await flush();await app.get('close-photo').emit('click');await app.tick(150);
  heartbeat.reject(new Error('network suspended'));await app.tick(10000);
  assert.equal(statusReads,3);assert.equal(app.get('notice').textContent,'');assert.equal(app.live.src,'');
  pending.resolve(true);await printing;await app.tick(150);
  assert.equal(statusReads,4);assert.match(app.live.src,/\/stream/);assert.equal(app.get('capture-plane').disabled,false);
});

for(const outcome of ['success','failure'])test(`native printing retires a pending camera reconnect before its late ${outcome}`,async()=>{
  const reconnect=deferred(),pending=deferred();let statusReads=0;
  const app=await connectedCamera({print:()=>pending.promise,fetch:url=>url.startsWith('/status')&&++statusReads===3?reconnect.promise:undefined});
  await app.get('capture-plane').emit('click');await app.get('close-photo').emit('click');await app.tick(150);
  app.document.hidden=true;await app.emit('visibilitychange');app.document.hidden=false;await app.emit('visibilitychange');
  await app.get('last-photo').emit('click');
  const printing=app.get('print-photo').emit('click');await flush();await app.get('close-photo').emit('click');await app.tick(150);
  if(outcome==='success')reconnect.resolve(app.response({...verifiedStatus}));else reconnect.reject(new Error('stale camera reconnect'));
  await app.tick(0);
  assert.equal(app.get('notice').textContent,'');assert.equal(app.live.src,'');assert.equal(app.get('capture-plane').disabled,true);
  pending.resolve(true);await printing;await app.tick(150);
  assert.equal(statusReads,4);assert.equal(app.get('notice').textContent,'');assert.match(app.live.src,/\/stream/);assert.equal(app.get('capture-plane').disabled,false);
  assert.equal(app.printCalls.length,1);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('returning from working or failed splats measures photo framing after its full viewport is restored',async()=>{
  const pending=deferred(),app=await connectedCamera({scene:async()=>pending.promise});
  await app.get('capture-plane').emit('click');app.gesturePhoto({scale:2,x:33,y:-12});app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('photo-dialog').classList.contains('working'),true);app.changeStudio('image',0);
  assert.deepEqual(app.photoRefreshes.at(-1),{working:false,error:false});
  app.changeStudio('image',1);pending.reject(new Error('GPU utilgjengeleg'));await app.tick(0);
  assert.equal(app.get('photo-dialog').classList.contains('error'),true);app.changeStudio('image',0);
  assert.deepEqual(app.photoRefreshes.at(-1),{working:false,error:false});assert.equal(app.photoGestureState.scale,2);assert.equal(app.photoGestureState.x,33);
});

test('recenter resets only the cached scene view and GPU retry preserves its JPEG and inference',async()=>{
  let resets=0,refreshes=0,disposed=0,healthy=true;
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){disposed++},resetView(){resets++},refresh(){refreshes++;if(!healthy){app.viewers[0].onError(new Error('GPU utilgjengeleg'));return false}return true}})});
  await app.get('capture-plane').emit('click');await app.tick(0);const url=app.get('photo').src,viewer=app.viewers[0];
  assert.equal(app.get('recenter-photo').hidden,false);await app.get('recenter-photo').emit('click');assert.equal(resets,1);
  healthy=false;viewer.onError(new Error('GPU utilgjengeleg'));
  assert.equal(app.get('scene').hidden,true);assert.equal(app.get('retry-scene').hidden,false);assert.equal(app.get('print-photo').disabled,true);
  assert.equal(app.get('recenter-photo').hidden,true);assert.match(app.get('scene-status').textContent,/GPU/);
  await app.get('retry-scene').emit('click');assert.equal(app.get('retry-scene').hidden,false);assert.match(app.get('scene-status').textContent,/GPU/);
  healthy=true;await app.get('retry-scene').emit('click');
  assert.equal(app.get('scene').hidden,false);assert.equal(app.get('retry-scene').hidden,true);assert.equal(app.get('scene-status').hidden,true);assert.equal(app.get('print-photo').disabled,false);
  assert.equal(app.get('photo').src,url);assert.equal(app.sceneCalls.length,1);assert.equal(app.viewers[0],viewer);assert.equal(disposed,0);assert.equal(refreshes,3);
});

test('a stale GPU error cannot hide a newly captured scene',async()=>{
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);const old=app.viewers[0];
  await app.get('close-photo').emit('click');await app.tick(150);await app.get('capture-plane').emit('click');await app.tick(0);
  old.onError(new Error('Old GPU error'));
  assert.equal(app.get('scene').hidden,false);assert.equal(app.get('retry-scene').hidden,true);assert.equal(app.get('scene-status').hidden,true);assert.equal(app.sceneCalls.length,2);
});

test('loading uses only progress while failures retain an actionable retry',async()=>{
  const pending=deferred();let starts=0;
  const app=await connectedCamera({splats:true,scene:async(host,blob,report)=>{if(++starts===1){report({phase:'estimating',percent:42});return pending.promise}return {dispose(){}}}});
  for(const id of ['progress','scene-progress']){assert.match(html,new RegExp('<div\\b[^>]*\\bid="'+id+'"[^>]*\\bhidden\\b[^>]*>\\s*<svg\\b[^>]*>\\s*<rect\\b[^>]*pathLength="100"[^>]*\\/>\\s*<\\/svg>\\s*<\\/div>'));assert.equal(app.get(id).tagName,'DIV');assert.equal(app.get(id).hidden,true)}
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.get('scene-status').hidden,true);assert.equal(app.get('scene-status').textContent,'');assert.equal(app.get('scene-progress').hidden,false);
  assert.equal(app.get('scene-progress-bar').style.strokeDasharray,'42 100');assert.equal(app.get('print-photo').disabled,true);
  pending.reject(new Error('Berekninga vart avbroten.'));await app.tick(0);
  assert.equal(app.get('scene-progress').hidden,true);
  assert.equal(app.get('scene-status').hidden,false);assert.match(app.get('scene-status').textContent,/Berekninga/);
  assert.equal(app.get('retry-scene').hidden,false);await app.get('retry-scene').emit('click');await app.tick(0);
  assert.equal(app.get('scene-status').hidden,true);assert.equal(app.get('retry-scene').hidden,true);
  assert.equal(app.get('scene-progress').hidden,true);
  assert.equal(app.get('print-photo').disabled,false);assert.equal(app.sceneCalls.length,2);
});

test('the explicit print button submits once and its timed feedback survives scene refresh',async()=>{
  const pending=deferred(),app=await connectedCamera({splats:true,scene:async()=>({dispose(){}}),print:()=>pending.promise});
  await app.get('capture-plane').emit('click');await app.tick(0);
  const first=app.get('print-photo').emit('click');await flush();await app.get('print-photo').emit('click');
  assert.equal(app.printCalls.length,1);assert.equal(app.get('print-photo').disabled,true);assert.equal(app.get('print-status').hidden,true);assert.equal(app.get('print-status').textContent,'');
  app.reportPrint('Tillat opning av skrivarsida.');app.changeStudio('image',0);app.changeStudio('image',1);
  assert.equal(app.get('print-status').textContent,'Tillat opning av skrivarsida.');assert.equal(app.get('print-status').hidden,false);
  pending.resolve(false);await first;assert.equal(app.get('print-photo').disabled,false);
  await app.tick(6001);assert.equal(app.get('print-status').hidden,true);assert.equal(app.printCalls.length,1);
});

test('the visible onboarding close button cancels preparation without a late takeover',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:false,prepare:()=>pending.promise});
  await app.get('capture-plane').emit('click');const url=app.get('photo').src;app.changeStudio('image',1);await app.tick(0);
  await app.get('onboarding-next').emit('click');await app.get('close-onboarding').emit('click');
  assert.equal(app.preparations[0].signal.aborted,true);assert.equal(app.get('onboarding').open,false);
  assert.equal(app.get('scene-status').hidden,true);assert.equal(app.studioControls.image,0);assert.equal(app.get('photo').hidden,false);assert.equal(app.get('photo').src,url);assert.equal(app.photoViews[0].shown,true);
  assert.equal(app.get('save-photo').hidden,false);assert.equal(app.get('print-photo').hidden,false);assert.equal(app.get('print-photo').disabled,false);
  await app.get('save-photo').emit('click');await app.get('print-photo').emit('click');assert.equal(app.saves.length,1);assert.equal(app.printCalls.length,1);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  pending.resolve();await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('photo').hidden,false);assert.equal(app.sceneCalls.length,0);
});

test('phone setup identifies its actions and preserves progress and actionable errors',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:false,prepare:()=>pending.promise});await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('onboarding-title').textContent,'Klargjer 3D');assert.match(app.get('onboarding-copy').textContent,/internett éin gong/);assert.equal(app.get('onboarding-copy').hidden,false);assert.equal(app.get('onboarding-next').getAttribute('aria-label'),'Fullfør');assert.equal(app.get('close-onboarding').getAttribute('aria-label'),'Tilbake til biletet');assert.equal(app.get('onboarding-help').open,false);
  await app.get('onboarding-next').emit('click');assert.equal(app.get('onboarding-title').textContent,'Fullfører 3D');assert.equal(app.get('onboarding-progress').hidden,false);assert.equal(app.get('onboarding-copy').textContent,'');assert.equal(app.get('onboarding-copy').hidden,true);assert.equal(app.get('onboarding-feedback').textContent,'');app.preparations[0].onProgress({percent:37});assert.equal(app.get('onboarding-progress').value,37);assert.equal(app.get('onboarding-feedback').textContent,'');pending.reject(new Error('Internett manglar. Prøv igjen.'));await app.tick(0);assert.equal(app.get('onboarding-progress').hidden,true);assert.match(app.get('onboarding-feedback').textContent,/Internett manglar/);assert.equal(app.get('onboarding-next').hidden,false);assert.match(html,/<h1 id="onboarding-title" class="sr">/);assert.doesNotMatch(html,/class="eyebrow"|Fullfører klargjeringa på telefonen|Opnar skrivaren …/);
});

test('setup instructions and expanded connection help remain visibly readable inside the dialog',()=>{
  assert.match(html,/<p id="onboarding-copy"><\/p>/);
  assert.match(html,/id="onboarding-feedback" class="feedback"/);
  assert.match(html,/<details id="onboarding-help">[^]*?<p>Skann QR-koden på riggen og hald tilkoplinga utan internett\.<\/p><\/details>/);
  assert.match(html,/<p id="notice" class="sr"/);
});

test('a suspended capture cannot reopen review or clear a newer capture while finishing late',async()=>{
  const first=deferred(),second=deferred();let captures=0;
  const app=await connectedCamera({fetch:url=>url.startsWith('/capture')?(++captures===1?first.promise:second.promise):undefined});
  const old=app.get('capture-plane').emit('click');await flush();
  app.document.hidden=true;await app.emit('visibilitychange');
  assert.equal(app.requests.find(r=>r.url.startsWith('/capture')).init.signal.aborted,true);
  app.document.hidden=false;await app.emit('visibilitychange');await app.tick(150);
  const current=app.get('capture-plane').emit('click');await flush();
  first.resolve(app.response(new Blob(['old'],{type:'image/jpeg'})));await old;await app.tick(0);
  assert.equal(app.get('photo-dialog').open,false);assert.equal(app.get('capture-plane').disabled,true);
  second.resolve(app.response(new Blob(['current'],{type:'image/jpeg'})));await current;await app.tick(0);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(await app.objectUrls.get(app.finders[0].captures[0].url).text(),'current');assert.equal(app.objectUrls.get(app.get('photo').src).type,'image/png');
});

test('a JPEG decoded after pagehide is rejected and its object URL is released',async()=>{
  const pending=deferred(),app=await connectedCamera({decode:()=>pending.promise});
  const capture=app.get('capture-plane').emit('click');await flush();await app.emit('pagehide');
  pending.resolve();await capture;await app.tick(0);
  assert.equal(app.get('photo-dialog').open,false);assert.equal(app.get('last-photo').hidden,true);
  assert.deepEqual(app.revoked,['blob:test/1']);assert.equal(app.get('capture-plane').disabled,true);
});

test('the cached last photo remains usable while camera reconnection is pending',async()=>{
  const pending=deferred();let statuses=0;
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}}),fetch:url=>url.startsWith('/status')&&++statuses>1?pending.promise:undefined});
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');await app.tick(150);
  await app.emit('pagehide');await app.emit('pageshow');assert.equal(app.get('last-photo').disabled,false);
  await app.get('last-photo').emit('click');assert.equal(app.get('scene').hidden,false);
  pending.resolve(app.response({...verifiedStatus}));await app.tick(150);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.sceneCalls.length,1);
});

test('a cold phone and blocked cache still allow camera use without a file chooser',async()=>{
  const app=await connectedCamera({modelsReady:async()=>{throw new Error('Cache unavailable')},onboarded:false,storageDenied:true});
  assert.equal(app.get('onboarding').open,false);assert.equal(app.modelChecks.length,0);assert.equal(app.opened.length,0);
  assert.doesNotMatch(html,/<input\b[^>]*\btype=["']file["']/i);
});

test('a failed model check retries locally without asking for setup or replacing the photo',async()=>{
  let fail=true;
  const app=await connectedCamera({modelsReady:async()=>{if(fail)throw new Error('Manifest unavailable');return true},scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');const original=app.get('photo').src;app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.match(app.get('scene-status').textContent,/Manifest unavailable/);
  assert.equal(app.get('photo').src,original);assert.equal(app.opened.length,0);assert.equal(app.preparations.length,0);
  assert.equal(app.get('retry-scene').hidden,false);assert.equal(app.get('retry-scene').getAttribute('aria-label'),'Prøv 3D på nytt');
  fail=false;await app.get('retry-scene').emit('click');await app.tick(0);
  assert.equal(app.modelChecks.length,2);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('onboarding').open,false);
  assert.equal(app.get('retry-scene').hidden,true);assert.equal(app.get('scene-status').hidden,true);
});

test('a VATHOgraphy startup check failure stays silent and retries after preserving a capture',async()=>{
  let fail=true;
  const app=await connectedCamera({vathography:true,modelsReady:async()=>{if(fail)throw new Error('Manifest unavailable');return true}});
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('retry-capture').hidden,true);
  assert.equal(app.get('notice').textContent,'');assert.equal(app.preparations.length,0);
  await app.get('capture-plane').emit('click');await app.tick(0);
  const photo=app.get('photo').src;
  assert.equal(app.modelChecks.length,2);assert.equal(app.get('retry-scene').hidden,false);
  assert.match(app.get('scene-status').textContent,/Manifest unavailable/);assert.equal(app.get('onboarding').open,false);
  fail=false;await app.get('retry-scene').emit('click');await app.tick(0);
  assert.equal(app.modelChecks.length,3);assert.equal(app.get('photo').src,photo);
  assert.equal(app.artCalls.length,1);assert.equal(app.preparations.length,0);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('a genuine missing model error still opens setup',async()=>{
  const app=await connectedCamera({modelsReady:async()=>{throw Object.assign(new Error('Model missing'),{code:'PHONE_SETUP_REQUIRED'})}});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('onboarding').open,true);assert.equal(app.get('retry-scene').getAttribute('aria-label'),'Klargjer telefonen');
});

test('a failed cache recheck preserves verified readiness for the next capture',async()=>{
  let fail=false;
  const app=await connectedCamera({vathography:true,modelsReady:async()=>{if(fail)throw new Error('Manifest unavailable');return true}});
  fail=true;await app.checkModels();
  assert.equal(app.get('onboarding').open,false);assert.equal(app.modelChecks.length,2);
  await app.get('retry-capture').emit('click');await app.tick(0);
  assert.equal(app.artCalls.length,1);assert.equal(app.modelChecks.length,2);assert.equal(app.preparations.length,0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('retry-capture').hidden,true);
});

test('the legacy Wi-Fi entry shows only handoff and makes no camera or model requests',async()=>{
  const app=harness({search:'?wifi'});await app.tick(1000);
  assert.equal(app.get('safari-handoff').hidden,false);assert.equal(app.get('studio').hidden,true);
  assert.equal(app.requests.length,0);assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);assert.equal(app.images.length,0);
  assert.match(html,/id="onboarding-prepare"[^>]*href="https:\/\/esp32iverfinneno-iverfinnes-projects\.vercel\.app\/start\/"/);
});

test('the prepared opener hears readiness after a live frame without requiring models',async()=>{
  const app=harness({search:'?connect',opener:true,modelsReady:false,frames:false});await app.tick(150);
  assert.equal(app.messages.length,0);app.live.naturalWidth=320;app.live.naturalHeight=240;await app.tick(150);
  assert.equal(app.messages.length,1);assert.equal(app.messages[0].data.type,'entropi-camera-ready');
  assert.equal(app.messages[0].origin,'https://esp32iverfinneno-iverfinnes-projects.vercel.app');assert.equal(app.modelChecks.length,0);
  await app.tick(10000);assert.equal(app.messages.length,1);
});

test('camera readiness and model handoff use the exact validated helper query origin',async()=>{
  for(const origin of ['https://esp32iverfinneno-iverfinnes-projects.vercel.app','https://esp32.iverfinne.no','https://majones.iverfinne.no']){
    const app=await connectedCamera({vathography:true,search:'?connect&helper='+encodeURIComponent(origin),opener:true,referrer:'',modelsReady:false});
    assert.equal(app.messages.length,1);assert.equal(app.messages[0].origin,origin);assert.equal(app.preparations.length,0);
    assert.equal(app.get('onboarding').open,false);
    await app.get('capture-plane').emit('click');await app.tick(0);
    assert.equal(app.preparations.length,1);assert.equal(app.preparations[0].source,app.childWindow);assert.equal(app.preparations[0].origin,origin);
    assert.equal(app.artCalls.length,1);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  }
});

test('untrusted helper origins receive no readiness or automatic model handshake',async()=>{
  const app=await connectedCamera({vathography:true,search:'?connect&helper='+encodeURIComponent('https://esp32.iverfinne.no.evil.test'),opener:true,modelsReady:false});
  assert.equal(app.messages.length,0);assert.equal(app.preparations.length,0);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.preparations.length,0);assert.equal(app.get('onboarding').open,true);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('direct local entry sends no camera notifications to an unrelated opener',async()=>{
  const app=await connectedCamera({opener:true});await app.emit('pagehide');assert.equal(app.messages.length,0);
});

test('pagehide notifies its authenticated port and return reconnects without model gating',async()=>{
  const app=await connectedCamera({search:'?connect',opener:true,modelsReady:false}),left=[];
  const port=app.messages[0].ports[0];port.onmessage=event=>left.push(event.data.type);await app.emit('pagehide');
  assert.deepEqual(left,['entropi-camera-left']);assert.equal(port.peer.closed,true);assert.equal(app.get('capture-plane').disabled,true);
  await app.emit('pageshow',{persisted:true});await app.tick(150);
  assert.equal(app.messages.at(-1).data.type,'entropi-camera-ready');assert.notEqual(app.messages.at(-1).ports[0],port);
  assert.equal(app.modelChecks.length,0);assert.equal(app.get('capture-plane').disabled,false);
});

test('leaving during preparation aborts transfer without blocking photo capture on return',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:false,prepare:()=>pending.promise});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  await app.get('onboarding-next').emit('click');await app.emit('pagehide');assert.equal(app.preparations[0].signal.aborted,true);
  app.changeStudio('image',0);app.get('onboarding').close();await app.get('close-photo').emit('click');await app.tick(150);
  pending.resolve();await app.tick(0);await app.emit('pageshow',{persisted:true});await app.tick(150);
  assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.sceneCalls.length,0);
});

async function reviewTap(app,details={}) {
  const target=app.get('photo');
  await app.get('photo-dialog').emit('pointerdown',{target,...details});
  await app.get('photo-dialog').emit('pointerup',{target,...details});
}

test('double taps preserve working review and explicit close keeps its result cached', async () => {
  const pending=deferred();let disposed=false;
  const app=await connectedCamera({splats:true,scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');
  await reviewTap(app);await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);await app.get('close-photo').emit('click');await app.tick(150);
  assert.equal(app.get('photo-dialog').open,false);
  assert.equal(app.sceneCalls[0].signal.aborted,false);
  pending.resolve({dispose(){disposed=true}});await app.tick(150);
  assert.equal(disposed,false);
  assert.equal(app.get('photo-dialog').open,false);
  assert.match(app.live.src,/:81\/stream/);
});

test('dragging between taps cannot reset the scene', async () => {
  let disposed=false;
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){disposed=true}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.tick(100);
  const target=app.get('photo');
  await app.get('photo-dialog').emit('pointerdown',{target,clientX:100,clientY:100});
  await app.get('photo-dialog').emit('pointerup',{target,clientX:180,clientY:100});
  await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(disposed,false);
});

test('a pinch clears the double-tap candidate and keeps the scene open', async () => {
  let disposed=false;
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){disposed=true}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.tick(100);
  const target=app.get('photo');
  await app.get('photo-dialog').emit('pointerdown',{target,pointerId:1,isPrimary:true});
  await app.get('photo-dialog').emit('pointerdown',{target,pointerId:2,isPrimary:false,clientX:200});
  await app.get('photo-dialog').emit('pointerup',{target,pointerId:2,isPrimary:false,clientX:220});
  await app.get('photo-dialog').emit('pointerup',{target,pointerId:1,isPrimary:true});
  await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(disposed,false);
});

test('three-finger adjustment cannot close review or turn the next tap into a double tap',async()=>{
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.tick(100);const target=app.get('scene');
  for(const pointerId of [1,2,3])await app.get('photo-dialog').emit('pointerdown',{target,pointerId,isPrimary:pointerId===1});
  for(const pointerId of [3,2,1])await app.get('photo-dialog').emit('pointerup',{target,pointerId,isPrimary:pointerId===1});
  await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.sceneCalls[0].signal.aborted,false);
});

test('taps from a closed review cannot reset a newly captured scene', async () => {
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.get('close-photo').emit('click');await app.tick(150);
  await app.tick(100);await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.sceneCalls[1].signal.aborted,false);
});

test('primitive changes affect the cached scene while image mode leaves fixed quality unchanged',async()=>{
  const styles=[],app=await connectedCamera({splats:true,scene:async()=>({dispose(){},setPrimitiveLevel(level){styles.push(level)}})});
  await app.get('capture-plane').emit('click');await app.tick(0);assert.equal(app.sceneCalls[0].quality,2);
  app.changeStudio('image',0);app.changeStudio('primitive',3);app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.sceneCalls.length,1);assert.equal(styles.at(-1),2);
  await app.get('close-photo').emit('click');await app.tick(150);await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls[1].quality,2);assert.equal(styles.at(-1),2);
});

test('a rail gesture clears a pending result tap even when its value is unchanged', async () => {
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);app.gestureStudio();await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);
});

test('the click following a result double tap cannot capture another photo', async () => {
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.tick(100);await reviewTap(app);
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  await app.get('close-photo').emit('click');await app.tick(150);await app.tick(401);await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,2);
  assert.equal(app.get('photo-dialog').open,true);
});

test('save is an action that encodes the displayed native photo framing without navigating its JPEG',async()=>{
  const app=await connectedCamera();await app.get('capture-plane').emit('click');const url=app.get('photo').src;app.gesturePhoto({scale:2,x:30,y:-10});await app.get('save-photo').emit('click');assert.equal(app.get('save-photo').tagName,'BUTTON');assert.equal(app.get('save-photo').getAttribute('href'),null);assert.equal(app.saves.length,1);assert.equal(app.saves[0].blob.type,'image/png');assert.match(app.saves[0].name,/\.png$/);assert.equal(app.encodedSnapshots[0].native,true);assert.deepEqual(app.encodedSnapshots[0].pose,{scale:2,x:30,y:-10,width:390,height:844,grain:1,contrast:1});assert.equal(app.get('photo').src,url);assert.equal(app.saves[0].isCurrent(),true);
  await app.get('close-photo').emit('click');await app.tick(150);assert.equal(app.saves[0].isCurrent(),false);await app.get('capture-plane').emit('click');assert.equal(app.saves[0].isCurrent(),false);
});

test('splat saving requests its native current palette instead of the source image or print resolution',async()=>{
  let level=0;const flags=[],native={width:640,height:960,data:new Uint8ClampedArray(640*960*4)};const app=await connectedCamera({splats:true,scene:async()=>({dispose(){},setPrimitiveLevel:value=>level=value,snapshot:nativeSize=>{flags.push(nativeSize);return {...native,level}}})});await app.get('capture-plane').emit('click');await app.tick(0);app.changeStudio('primitive',2);await app.get('save-photo').emit('click');assert.deepEqual(flags,[true]);assert.equal(app.encodedSnapshots[0].width,640);assert.equal(app.encodedSnapshots[0].height,960);assert.equal(app.encodedSnapshots[0].level,2);assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.sceneCalls.length,1);
});

test('photo style and three-finger tone feed the rendered save and print source without model work',async()=>{
  const app=await connectedCamera({modelsReady:false});await app.get('capture-plane').emit('click');const view=app.photoViews[0],url=app.get('photo').src;assert.equal(view.source.naturalWidth,1600);assert.notEqual(view.source,app.get('photo'));assert.equal(view.shown,true);app.changeStudio('photo',1);const refreshes=view.refreshes;assert.equal(app.gesturePhoto({grain:4,contrast:1.8,scale:2,x:30,y:-10}),true);assert.deepEqual(view.tone,{grain:4,contrast:1.8});assert.ok(view.refreshes>refreshes);
  await app.get('save-photo').emit('click');await app.get('print-photo').emit('click');for(const output of [app.encodedSnapshots[0],app.printCalls[0].image]){assert.equal(output.style,1);assert.deepEqual(output.tone,{grain:4,contrast:1.8});assert.equal(output.photo,true)}assert.deepEqual(view.snapshots.map(call=>call.native),[true,false]);assert.equal(app.sceneCalls.length,0);assert.equal(app.modelChecks.length,0);assert.equal(app.get('photo').src,url);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  await app.get('close-photo').emit('click');await app.tick(150);assert.equal(view.shown,false);await app.get('last-photo').emit('click');assert.equal(view.shown,true);assert.equal(view.sources.length,1);assert.equal(view.style,1);assert.deepEqual(view.tone,{grain:4,contrast:1.8});
});

test('photo and splat styles stay independent while the same original JPEG and scene are reused',async()=>{
  const styles=[],app=await connectedCamera({scene:async()=>({dispose(){},setPrimitiveLevel:value=>styles.push(value)})});await app.get('capture-plane').emit('click');const view=app.photoViews[0],url=app.get('photo').src;app.changeStudio('photo',3);app.changeStudio('image',1);await app.tick(0);assert.equal(view.shown,false);app.changeStudio('primitive',2);assert.equal(styles.at(-1),2);app.changeStudio('image',0);assert.equal(view.shown,true);assert.equal(view.style,1);app.changeStudio('photo',1);app.changeStudio('image',1);await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.studioControls.primitive,2);assert.equal(view.style,1);assert.equal(view.sources.length,1);assert.equal(app.get('photo').src,url);
});

test('live dithering and tone use the captured photo style without a three-finger shutter click',async()=>{
  const app=await connectedCamera(),finder=app.finders[0],view=app.photoViews[0];assert.equal(finder.style,3);assert.equal(view.style,3);app.changeStudio('photo',2);assert.equal(finder.style,1);assert.equal(app.gestureLive({grain:3,contrast:1.5}),true);assert.deepEqual(finder.tone,{grain:3,contrast:1.5});await app.get('capture-plane').emit('click');assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,0);await app.tick(401);await app.get('capture-plane').emit('click');assert.equal(view.sources.length,1);assert.equal(view.style,1);assert.deepEqual(view.tone,{grain:3,contrast:1.5});assert.equal(app.gestureLive({grain:1}),false);app.gesturePhoto({grain:5,contrast:2});assert.deepEqual(finder.tone,{grain:5,contrast:2});assert.equal(app.liveGestureState.grain,5);assert.equal(app.sceneCalls.length,0);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});


test('historical profiles change photo and Gaussian output independently without new inference',async()=>{
  const app=await connectedCamera({scene:async()=>({dispose(){}})});
  assert.equal(app.finders[0].palette,'macintosh');
  app.changeStudio('photo',4);
  assert.equal(app.photoViews[0].palette,'bluecrt');
  assert.equal(app.finders[0].palette,'bluecrt');
  assert.equal(app.stored.get('entropi-screen-photo-v2'),'bluecrt');
  await app.get('capture-plane').emit('click');
  app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.viewers[0].palette,'macintosh');
  const inferences=app.sceneCalls.length;
  app.changeStudio('primitive',2);
  assert.equal(app.viewers[0].palette,'ibmcga');
  assert.equal(app.sceneCalls.length,inferences);
  assert.equal(app.stored.get('entropi-screen-depth-v2'),'ibmcga');
  app.changeStudio('image',0);
  assert.equal(app.photoViews[0].palette,'bluecrt');
});

test('an unchanged orientation or viewport tone cannot suppress an immediate paired shutter',async()=>{
  const app=await connectedCamera({second:true,modelsReady:false});
  app.changeStudio('image',0);
  assert.equal(app.gestureLive({grain:1,contrast:1}),true);
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.requests.filter(request=>request.url.includes('/capture')).length,1);
});

test('paired depth art processes both originals before checking a downloaded model and reuses its result',async()=>{
  const app=await connectedCamera({second:true,modelsReady:false,art:async()=>({source:'stereo',model:'Stereo'})});app.changeStudio('image',2);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.modelChecks.length,0);assert.equal(app.artCalls.length,1);assert.equal(app.sceneCalls.length,0);
  assert.equal(app.artCalls[0].blob,app.objectUrls.get(app.finders[0].captures[0].url));
  assert.equal(app.artCalls[0].blob.type,'image/jpeg');assert.deepEqual(new Uint8Array(await app.artCalls[0].settings.right.arrayBuffer()),new Uint8Array(await jpeg('right-jpeg').arrayBuffer()));
  assert.equal(app.get('marigold-view').hidden,false);assert.equal(app.get('onboarding').open,false);
  app.changeStudio('image',0);app.changeStudio('image',2);await app.tick(0);
  assert.equal(app.modelChecks.length,0);assert.equal(app.artCalls.length,1);
});

test('rejected stereo with missing fallback assets opens setup and preparation resumes the same pair',async()=>{
  let prepared=false;
  const app=await connectedCamera({second:true,modelsReady:false,prepare:async()=>{prepared=true},art:async()=>{if(!prepared)throw Object.assign(new Error('Fallback model missing'),{code:'PHONE_SETUP_REQUIRED'});return {source:'browser',model:'fallback'}}});app.changeStudio('image',2);
  await app.get('capture-plane').emit('click');await app.tick(0);
  const raw=app.objectUrls.get(app.finders[0].captures[0].url),right=app.artCalls[0].settings.right;
  assert.equal(app.modelChecks.length,0);assert.equal(app.artCalls.length,1);assert.equal(app.get('onboarding').open,true);
  assert.equal(app.get('onboarding-title').textContent,'Klargjer djupnekunst');assert.match(app.get('onboarding-copy').textContent,/Hent modellen med internett éin gong/);
  assert.equal(app.get('onboarding-prepare').hidden,false);assert.equal(app.get('retry-scene').getAttribute('aria-label'),'Klargjer telefonen');
  app.get('onboarding').close();await app.get('retry-scene').emit('click');assert.equal(app.get('onboarding').open,true);assert.equal(app.artCalls.length,1);
  await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.preparations.length,1);assert.equal(app.artCalls.length,2);assert.equal(app.artCalls[1].blob,raw);assert.equal(app.artCalls[1].settings.right,right);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/stereo/capture')).length,1);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('marigold-view').hidden,false);
});

test('cancelling fallback setup keeps the existing pair and rejects a late preparation',async()=>{
  const pending=deferred(),app=await connectedCamera({second:true,modelsReady:false,prepare:()=>pending.promise,art:async()=>{throw Object.assign(new Error('Fallback model missing'),{code:'PHONE_SETUP_REQUIRED'})}});app.changeStudio('image',2);
  await app.get('capture-plane').emit('click');await app.tick(0);const photo=app.get('photo').src;
  await app.get('onboarding-next').emit('click');await app.get('close-onboarding').emit('click');
  assert.equal(app.studioControls.image,0);assert.equal(app.preparations[0].signal.aborted,true);assert.equal(app.get('photo').hidden,false);
  pending.resolve();await app.tick(0);
  assert.equal(app.artCalls.length,1);assert.equal(app.get('photo').src,photo);assert.equal(app.get('onboarding').open,false);
});

test('a fresh stereo capture can succeed after cancelling setup for a rejected previous pair',async()=>{
  let attempts=0;
  const app=await connectedCamera({second:true,vathography:true,modelsReady:false,art:async()=>{if(++attempts===1)throw Object.assign(new Error('Fallback model missing'),{code:'PHONE_SETUP_REQUIRED'});return {source:'stereo',model:'Stereo'}}});
  if(app.get('onboarding').open)await app.get('close-onboarding').emit('click');
  await app.get('capture-plane').emit('click');await app.tick(0);assert.equal(app.artCalls.length,1);assert.equal(app.get('onboarding').open,true);
  await app.get('close-onboarding').emit('click');await app.get('close-photo').emit('click');await app.tick(150);await app.tick(200);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.artCalls.length,2);assert.equal(app.artViews[0].result.source,'stereo');assert.equal(app.get('marigold-view').hidden,false);assert.equal(app.get('onboarding').open,false);assert.equal(app.preparations.length,0);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/stereo/capture')).length,2);
});

test('a late portable model check cannot take over photo mode or start repeated art requests',async()=>{
  const pending=deferred(),app=await connectedCamera({modelsReady:()=>pending.promise});app.changeStudio('image',2);
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.get('scene-progress').hidden,false);assert.equal(app.modelChecks.length,1);
  app.changeStudio('image',0);app.changeStudio('image',2);app.changeStudio('image',0);
  pending.resolve(true);await app.tick(0);
  assert.equal(app.modelChecks.length,1);assert.equal(app.artCalls.length,0);assert.equal(app.get('photo').hidden,false);assert.equal(app.get('onboarding').open,false);
  app.changeStudio('image',2);await app.tick(0);assert.equal(app.artCalls.length,1);
});

test('a corrupt portable depth cache prompts setup and retries after preparation',async()=>{
  let attempts=0;
  const app=await connectedCamera({second:true,art:async()=>{if(!attempts++)throw Object.assign(new Error('Modellen må klargjerast på nytt.'),{code:'PHONE_SETUP_REQUIRED'});return {model:'restored'}}});
  app.changeStudio('image',2);await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.artCalls.length,1);assert.equal(app.get('onboarding').open,true);assert.equal(app.get('onboarding-title').textContent,'Klargjer djupnekunst');
  await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.preparations.length,1);assert.equal(app.artCalls.length,2);assert.equal(app.artViews[0].result.model,'restored');assert.equal(app.get('marigold-view').hidden,false);
});

test('a saved master retries its original depth and recipe without models after a restoration failure',async()=>{
  const original=new Blob(['saved original'],{type:'image/png'}),master={result:{width:2,height:2,depth:Float32Array.of(1,2,3,4)},recipe:{preset:4,position:.2,width:1.5}};
  let attempts=0;const app=await connectedCamera({vathography:true,modelsReady:false,restore:async()=>{if(++attempts===1)throw new Error('Temporary restore failure')}});
  await app.showPhoto(original,master,'saved-master');await app.tick(0);
  const photo=app.get('photo').src;
  assert.equal(app.restoreCalls.length,1);assert.equal(app.get('retry-scene').hidden,false);assert.match(app.get('scene-status').textContent,/Temporary restore failure/);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.preparations.length,0);assert.equal(app.artCalls.length,0);
  await app.get('retry-scene').emit('click');await app.tick(0);
  assert.equal(app.restoreCalls.length,2);assert.equal(app.restoreCalls[1].blob,original);assert.equal(app.restoreCalls[1].result,master.result);assert.equal(app.restoreCalls[1].recipe,master.recipe);
  assert.equal(app.artCalls.length,0);assert.equal(app.modelChecks.length,1);assert.equal(app.preparations.length,0);assert.equal(app.get('photo').src,photo);
  assert.equal(app.get('retry-scene').hidden,true);assert.equal(app.get('marigold-view').hidden,false);
});

test('a late startup cache failure cannot hide a restored numerical master or require a model',async()=>{
  const probe=deferred(),app=await connectedCamera({vathography:true,modelsReady:()=>probe.promise}),master={result:{width:1,height:1,depth:Float32Array.of(7)},recipe:{preset:1,position:0,width:1}};
  await app.showPhoto(jpeg('saved'),master,'master');probe.reject(new Error('Model manifest unavailable'));await app.tick(0);
  assert.equal(app.restoreCalls.length,1);assert.equal(app.artCalls.length,0);assert.equal(app.get('marigold-view').hidden,false);
  assert.equal(app.get('retry-scene').hidden,true);assert.equal(app.get('onboarding').open,false);assert.equal(app.preparations.length,0);
});

test('a replaced saved-master restoration cannot overwrite a newer restored capture',async()=>{
  const pending=deferred(),first={result:{width:1,height:1,depth:Float32Array.of(1)},recipe:{preset:1,position:0,width:1}},second={result:{width:1,height:1,depth:Float32Array.of(2)},recipe:{preset:4,position:.1,width:1.4}};
  const app=await connectedCamera({vathography:true,modelsReady:false,restore:async(_blob,result)=>{if(result===first.result)await pending.promise}});
  const opening=app.showPhoto(jpeg('old'),first,'old');await flush();
  await app.showPhoto(jpeg('new'),second,'new');const photo=app.get('photo').src;
  pending.resolve();await opening;await app.tick(0);
  assert.equal(app.restoreCalls[0].signal.aborted,true);assert.equal(app.artViews[0].result,second.result);assert.equal(app.artViews[0].recipe,second.recipe);
  assert.equal(app.get('photo').src,photo);assert.equal(app.get('marigold-view').hidden,false);assert.equal(app.artCalls.length,0);
});

for(const type of ['image/png','image/webp'])test(`a pending ${type} archive original can develop while live capture remains JPEG-only`,async()=>{
  const original=new Blob(['pending original'],{type}),app=await connectedCamera({vathography:true});
  await assert.rejects(app.showPhoto(original),/Ugyldig bilete/);
  await app.showPhoto(original,null,'pending-record');await app.tick(0);
  assert.equal(app.artCalls.length,1);assert.equal(app.artCalls[0].blob,original);assert.equal(app.get('marigold-view').hidden,false);
});

test('repeated capture and close cycles require a fresh stream image before the next shutter is ready',async()=>{
  const app=await connectedCamera(),source=app.canvases[0],originalClears=source.clears;
  for(let cycle=0;cycle<3;cycle++){
    const previous=app.live,draws=source.draws;
    await app.get('capture-plane').emit('click');const photo=app.get('photo').src;
    assert.equal(previous.src,'');assert.equal(app.get('photo-dialog').open,true);assert.equal(source.clears,originalClears);assert.equal(source.draws,draws);
    await app.get('close-photo').emit('click');await app.tick(0);
    assert.equal(app.get('capture-plane').disabled,true);assert.notEqual(app.live,previous);assert.match(app.live.src,/\/stream\?t=\d+&r=\d+/);
    await app.tick(150);assert.equal(app.get('capture-plane').disabled,false);assert.ok(source.draws>draws);assert.equal(app.get('photo').src,photo);assert.equal(app.get('photo-dialog').open,false);
  }
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,3);
});

test('a resumed stream with no new frame retries automatically instead of accepting the old image dimensions',async()=>{
  let streamStarts=0;const app=await connectedCamera({frameUrl:()=>++streamStarts!==2}),previous=app.live,source=app.canvases[0];
  await app.get('capture-plane').emit('click');await app.get('close-photo').emit('click');await app.tick(150);
  assert.equal(previous.naturalWidth,320);assert.notEqual(app.live,previous);assert.equal(app.live.naturalWidth,0);assert.equal(app.get('capture-plane').disabled,true);const draws=source.draws;
  await app.tick(7900);assert.equal(source.draws,draws);assert.equal(app.get('capture-plane').disabled,true);assert.match(app.get('notice').textContent,/Ingen kamerabilete/);
  await app.tick(1700);assert.equal(streamStarts,3);assert.equal(app.get('capture-plane').disabled,false);assert.ok(source.draws>draws);assert.equal(app.get('photo-dialog').open,false);
});

test('callbacks from a retired stream cannot disconnect or satisfy a replacement stream',async()=>{
  let frames=true;const app=await connectedCamera({frameUrl:()=>frames}),previous=app.live;
  await app.get('capture-plane').emit('click');frames=false;await app.get('close-photo').emit('click');await app.tick(150);
  const replacement=app.live,statusReads=app.requests.filter(request=>request.url.startsWith('/status')).length;
  await previous.emit('error');await app.tick(150);assert.equal(app.live,replacement);assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.get('notice').textContent,'');
  replacement.naturalWidth=320;replacement.naturalHeight=240;await app.tick(150);assert.equal(app.get('capture-plane').disabled,false);
  await previous.emit('error');await app.tick(150);assert.equal(app.live,replacement);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.requests.filter(request=>request.url.startsWith('/status')).length,statusReads);
});

const buttonStatus={...verifiedStatus,peer:null,button_presses:0,button_age_ms:-1};
function buttonFetch(button,next){return (url,count,response,...rest)=>url==='/button'?response({...button}):next?.(url,count,response,...rest)}

test('the hardware button takes a photo only for fresh presses made while the page watches',async()=>{
  const button={presses:4,age_ms:200};
  const app=await connectedCamera({status:buttonStatus,fetch:buttonFetch(button)});
  await app.tick(600);
  assert.ok(app.requests.some(request=>request.url==='/button'));
  assert.equal(app.requests.some(request=>request.url.startsWith('/capture')),false);
  Object.assign(button,{presses:5,age_ms:5000});await app.tick(300);
  assert.equal(app.requests.some(request=>request.url.startsWith('/capture')),false);
  Object.assign(button,{presses:6,age_ms:40});await app.tick(300);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  assert.equal(app.get('photo-dialog').open,true);
});

test('a hardware press returns from review, and a press during a capture is not replayed afterwards',async()=>{
  const button={presses:0,age_ms:-1},pending=deferred();
  const app=await connectedCamera({status:buttonStatus,fetch:buttonFetch(button,(url,count,response)=>url.startsWith('/capture')?pending.promise.then(()=>response(new Blob(['jpeg'],{type:'image/jpeg'}))):undefined)});
  await app.tick(300);
  const clicked=app.get('capture-plane').emit('click');
  Object.assign(button,{presses:1,age_ms:10});await app.tick(500);
  pending.resolve();await clicked;await app.tick(10);
  assert.equal(app.get('photo-dialog').open,true);
  await app.tick(1000);
  assert.equal(app.get('photo-dialog').open,true);
  Object.assign(button,{presses:2,age_ms:10});await app.tick(300);
  assert.equal(app.get('photo-dialog').open,false);
  await app.tick(300);assert.equal(app.get('capture-plane').disabled,false);
  Object.assign(button,{presses:3,age_ms:10});await app.tick(600);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,2);
  assert.equal(app.get('photo-dialog').open,true);
});

test('cameras without a hardware button are never polled for presses',async()=>{
  const app=await connectedCamera();
  await app.tick(3000);
  assert.equal(app.requests.some(request=>request.url==='/button'),false);
});
