import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { COLOR_SCHEMES } from '../../vendor/color-schemes.mjs';

const html = await readFile(new URL('../EntropiCamera/camera_ui.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const application = scripts.find(script => script.includes('function takePhoto(')).replace(/__ENTROPI_(?:STUDIO|MODEL_BRIDGE|PRINT_CLIENT)__/g,'');
const verifiedStatus = { camera_ready: true, stream_ready: true, recovering: false, recovery_attempts: 0, last_error: '', framesize: 10, photo_framesize: 15, brightness: 0, psram: true };
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
  const sceneCalls = [];
  const viewers=[];
  const printCalls = [], saves=[], encodedSnapshots=[],photoViews=[];
  let printReport=()=>{},printConfiguration;
  const snapshot={width:384,height:1,data:new Uint8ClampedArray(384*4)},nativeSnapshot={width:640,height:960,data:new Uint8ClampedArray(640*960*4)};
  const modelChecks = [];
  const preparations = [];
  const opened = [];
  const messages = [];
  const studioBindings = [];
  const studioControls = { image: 0, primitive: 0, photo:0, setImage:level=>changeStudio('image',level), dispose() {} },finders=[];
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
    elements.set(element.id, element);
  }
  const document = {
    hidden: false,
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
      this.source = value;
      if (value.startsWith('http') && options.frames !== false) { this.naturalWidth = 320; this.naturalHeight = 240; }
    }
    get src() { return this.source ?? ''; }
    async decode() {
      if (options.decodeFailure) throw new Error('Invalid JPEG');
      if (options.decode) await options.decode(this);
      this.naturalWidth = 1600;
      this.naturalHeight = 1200;
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
  const status = structuredClone(options.status === undefined ? verifiedStatus : options.status);
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const custom = options.fetch?.(String(url), requests.length, response);
    if (custom !== undefined) return await custom;
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
    COLOR_SCHEMES,
    Viewfinder: class { constructor(canvas) { this.canvas = canvas;this.tone={grain:1,contrast:1};this.captures=[];finders.push(this) }capture(source){const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1200;this.captures.push({source,url:source.src,canvas});return canvas}setStyle(level){this.style=level}setPalette(id){this.palette=id}setTone(pose){this.tone={grain:pose.grain,contrast:pose.contrast}} },
    attachStudioControls: (hosts, onChange, enabled, onGesture) => { studioBindings.push({ hosts, onChange, enabled, onGesture }); return studioControls; },
    readColorScheme:kind=>stored.get('entropi-screen-'+kind+'-v2')??'macintosh',
    saveColorScheme:(kind,id)=>stored.set('entropi-screen-'+kind+'-v2',id),
    attachColorSchemeControls:(hosts,getKind,getSelection,onChoose,enabled)=>{
      colorBinding={hosts,getKind,getSelection,onChoose,enabled};return {refresh(){},dispose(){}};
    },
    attachPhotoGestures:(image,binding)=>{if(binding.toneOnly){liveGestureBinding=binding;return {state:liveGestureState}}photoGestureBinding=binding;binding.onChange(photoGestureState);return photoGestureController},
    createPhotoView:image=>{const viewer={image,source:null,sources:[],style:0,tone:{grain:1,contrast:1},shown:false,shows:[],refreshes:0,snapshots:[],disposed:false,setSource(source=image){this.source=source;this.sources.push(source)},setStyle(level){this.style=level},setPalette(id){this.palette=id},setTone(pose){for(const key of ['grain','contrast'])if(pose[key]!==undefined)this.tone[key]=pose[key]},show(visible){this.shown=Boolean(visible);this.shows.push(this.shown)},refresh(){this.refreshes++},snapshot(pose,native=false){const result={...context.photoSnapshot(image,pose,native),style:this.style,tone:{...this.tone}};this.snapshots.push({pose:{...pose},native,result});return result},dispose(){this.disposed=true}};photoViews.push(viewer);return viewer},
    phoneModelsReady: async signal => { modelChecks.push(signal); return typeof options.modelsReady==='function'?options.modelsReady(signal):options.modelsReady!==false; },
    requestPhoneModels: async (signal,onProgress,source) => { preparations.push({signal,onProgress,source}); if(options.prepare)await options.prepare(signal,onProgress,source); },
    createDevicePrinter:()=>({native:true}),cloudPrintJob:image=>new Uint8Array([image.width&255]),
    createPrintClient:configuration=>{printConfiguration=configuration;printReport=configuration.report;return {print:(image,isCurrent)=>{printCalls.push({image,isCurrent});return options.print?options.print(image,isCurrent,printReport):Promise.resolve(true)},dispose(){}}},
    photoSnapshot:(image,pose,native=false)=>({width:native?1600:384,height:native?1200:288,data:new Uint8ClampedArray((native?1600*1200:384*288)*4),photo:true,image,pose:{...pose},native}),
    snapshotBlob:image=>{encodedSnapshots.push(image);return new Blob(['rendered-png'],{type:'image/png'})},
    savePhoto:(blob,name,isCurrent)=>{saves.push({blob,name,isCurrent});return Promise.resolve()},
    createDepthScene: async (host, blob, onProgress, signal, quality) => {
      sceneCalls.push({ host, blob, onProgress, signal, quality });
      if (options.scene) {const viewer={setPrimitiveLevel(){},setPalette(id){this.palette=id},refresh(){return true},resetView(){},snapshot:native=>native?nativeSnapshot:snapshot,...await options.scene(host,blob,onProgress,signal,quality)};viewers.push(viewer);return viewer}
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
  return { elements, document, images, canvases, requests, revoked, objectUrls, sceneCalls, viewers, printCalls, printConfiguration, saves, encodedSnapshots, photoViews, nativeSnapshot, reportPrint:message=>printReport(message), photoGestureState, liveGestureState, finders, photoRefreshes, gesturePhoto, gestureLive, get photoResets(){return photoResets}, snapshot, modelChecks, preparations, studioControls, changeStudio, gestureStudio, opened, messages, childWindow, stored, response, tick, emit, get: id => elements.get(id), choosePalette:id=>{if(!colorBinding)throw Error('Palettes not mounted');colorBinding.onChoose(colorBinding.getKind(),id)}, paletteKind:()=>colorBinding?.getKind(), selectedPalette:()=>colorBinding?.getSelection(colorBinding.getKind()) };
}

async function connectedCamera(options = {}) {
  const app = harness(options);
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, false);
  assert.equal(app.get('studio').classList.contains('connected'), true);
  if(options.splats)app.changeStudio('image',1);
  return app;
}

test('capture stays unavailable until both camera status and a decoded live frame exist', async () => {
  const app = harness({ frames: false });
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, true);
  assert.equal(app.get('studio').classList.contains('connected'), false);
  app.images[0].naturalWidth = 320;
  app.images[0].naturalHeight = 240;
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
    assert.equal(app.images[0].src, '');
  });
}

test('a failed capture retains the last live frame and permits another attempt', async () => {
  const app = await connectedCamera({ fetch: (url, count, response) => url.startsWith('/capture') ? response(null, false) : undefined });
  const source = app.canvases[0];
  assert.ok(source.draws > 0);
  const clears = source.clears;
  await app.get('capture-plane').emit('click');
  assert.equal(source.clears, clears);
  assert.equal(app.get('photo-dialog').open, false);
  assert.equal(app.get('capture-plane').disabled, false);
  assert.match(app.get('notice').textContent, /ikkje takast/);
  assert.match(app.images[0].src, /:81\/stream/);
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
  assert.equal(app.images[0].src, '');
  assert.match(app.get('photo').src, /^blob:/);
  await app.get('close-photo').emit('click');
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.images[0].src, /:81\/stream/);
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
  assert.equal(app.images[0].src, '');
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
  assert.equal(app.images[0].src, '');
});

test('the connection helper remains usable when optional browser storage is denied', async () => {
  const app = await connectedCamera({ storageDenied: true });
  await app.get('connection').emit('click');
  assert.equal(app.get('onboarding').open, true);
  assert.equal(app.get('onboarding-title').textContent,'Kameraet er klart');
  assert.equal(app.get('onboarding-next').hidden,true);
  assert.equal(app.get('onboarding-copy').hidden,true);
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
  assert.equal(app.get('onboarding-copy').textContent,'Slå på kameraet og vel ENTROPI under Wi-Fi.');
  assert.equal(app.get('onboarding-next').textContent,'Prøv igjen');
  assert.match(html,/ENTROPI er eit ope nett utan internett/);
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
    assert.equal(app.images[0].src, '');
    assert.match(app.get('notice').textContent, /Sensor not found/);
    assert.doesNotMatch(app.get('notice').textContent, /Wi-Fi|fråkopla/i);
    assert.equal(app.get('last-photo').hidden, true);
  });
}

test('a camera without a ready stream never reports a live connection', async () => {
  const app = harness({ status: { ...verifiedStatus, stream_ready: false, last_error: 'Stream server unavailable' } });
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, true);
  assert.equal(app.images[0].src, '');
  assert.match(app.get('notice').textContent, /Stream server unavailable/);
});

test('an invalid JPEG cannot open review', async () => {
  const app = await connectedCamera({ decodeFailure: true });
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.get('notice').textContent, /ikkje takast/);
  assert.equal(app.get('capture-plane').disabled, false);
});

test('an HTML capture response cannot be mistaken for a photo', async () => {
  const app = await connectedCamera({ fetch: (url, count, response) => url.startsWith('/capture') ? response(new Blob(['error'], { type: 'text/html' })) : undefined });
  await app.get('capture-plane').emit('click');
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

test('splats check models only when selected and use fixed quality',async()=>{
  const styles=[],app=await connectedCamera({scene:async()=>({dispose(){},setPrimitiveLevel(level){styles.push(level)}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  const url=app.get('photo').src;app.changeStudio('primitive',3);app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.modelChecks.length,1);assert.equal(app.sceneCalls.length,1);assert.equal(app.sceneCalls[0].quality,2);
  assert.equal(app.sceneCalls[0].blob,app.objectUrls.get(url));assert.equal(styles.at(-1),2);
  assert.equal(app.get('scene').hidden,false);assert.equal(app.get('photo').hidden,true);
  assert.equal(app.get('photo').src,url);assert.equal(app.get('scene-status').textContent,'');
});

test('selected splats hide the live image and both photo layers until their scene is ready',async()=>{
  const capture=deferred(),scene=deferred(),app=await connectedCamera({splats:true,fetch:url=>url.startsWith('/capture')?capture.promise:undefined,scene:()=>scene.promise});const taking=app.get('capture-plane').emit('click');await flush();assert.equal(app.get('studio').classList.contains('capturing-splats'),true);assert.equal(app.get('progress').hidden,false);
  capture.resolve(app.response(new Blob(['raw-camera'],{type:'image/jpeg'})));await taking;await app.tick(0);assert.equal(app.get('photo-dialog').open,true);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);assert.equal(app.photoViews[0].shows.some(Boolean),false);assert.equal(app.get('scene').hidden,true);assert.equal(app.get('scene-progress').hidden,false);assert.equal(app.get('scene-status').textContent,'');assert.equal(app.get('save-photo').hidden,true);assert.equal(app.get('print-photo').hidden,true);await app.get('save-photo').emit('click');await app.get('print-photo').emit('click');assert.equal(app.saves.length,0);assert.equal(app.printCalls.length,0);
  scene.resolve({dispose(){}});await app.tick(0);assert.equal(app.get('scene').hidden,false);assert.equal(app.get('photo').hidden,true);assert.equal(app.photoViews[0].shown,false);app.changeStudio('image',0);assert.equal(app.get('photo').hidden,false);assert.equal(app.photoViews[0].shown,true);
});

test('camera JPEG is framed once and only the derived color PNG is used by review and depth',async()=>{
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);const finder=app.finders[0],framed=app.objectUrls.get(app.get('photo').src);assert.equal(finder.captures.length,1);assert.equal(app.objectUrls.get(finder.captures[0].url).type,'image/jpeg');assert.equal(framed.type,'image/png');assert.equal(app.sceneCalls[0].blob,framed);assert.equal(finder.captures[0].canvas.width,1);assert.equal(finder.captures[0].canvas.height,1);assert.ok(app.revoked.includes(finder.captures[0].url));
  await app.get('close-photo').emit('click');await app.get('last-photo').emit('click');app.changeStudio('image',0);app.changeStudio('image',1);assert.equal(finder.captures.length,1);assert.equal(app.sceneCalls.length,1);assert.equal(app.objectUrls.get(app.get('photo').src),framed);
});

test('failed or abandoned PNG encoding retains the last valid photo and never publishes a partial frame',async()=>{
  for(const abandon of [false,true]){
    let encode,encodes=0;const app=await connectedCamera({encode:(callback,type)=>{if(++encodes===1)callback(new Blob(['first'],{type}));else encode=callback}});await app.get('capture-plane').emit('click');const original=app.get('photo').src;await app.get('close-photo').emit('click');const taking=app.get('capture-plane').emit('click');await flush();if(abandon)await app.emit('pagehide');encode(abandon?new Blob(['late'],{type:'image/png'}):null);await taking;await app.tick(0);assert.equal(app.get('photo').src,original);assert.equal(app.revoked.includes(original),false);assert.equal(app.finders[0].captures[1].canvas.width,1);assert.equal(app.finders[0].captures[1].canvas.height,1);assert.equal(app.get('photo-dialog').open,false);
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
  await app.get('close-photo').emit('click');assert.equal(app.get('capture-plane').disabled,false);
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
  await app.get('close-photo').emit('click');assert.equal(app.modelChecks[0].aborted,true);
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
  assert.equal(prevented,true);assert.equal(app.get('onboarding').open,false);assert.equal(app.studioControls.image,0);assert.equal(app.get('photo').hidden,false);assert.equal(app.get('save-photo').hidden,false);assert.equal(app.get('print-photo').hidden,false);await app.get('close-photo').emit('click');
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
  await app.get('close-photo').emit('click');assert.equal(app.get('capture-plane').disabled,false);
});

test('a prepared opener is used only after splats request models',async()=>{
  const pending=deferred(),opener={postMessage(){}},app=await connectedCamera({search:'?connect',opener,modelsReady:false,prepare:()=>pending.promise,scene:async()=>({dispose(){}})});
  assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.preparations.length,1);assert.equal(app.preparations[0].source,opener);
  pending.resolve();await app.tick(0);assert.equal(app.sceneCalls.length,1);assert.equal(app.opened.length,0);
});

test('holding the photo prints a positive B&W snapshot and mode switching invalidates its handoff',async()=>{
  const app=await connectedCamera({modelsReady:false});await app.get('capture-plane').emit('click');const target=app.get('photo');
  await app.get('photo-dialog').emit('pointerdown',{target});await app.tick(500);await app.get('photo-dialog').emit('pointerup',{target});
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image.photo,true);assert.equal(app.printCalls[0].image.width,384);
  assert.equal(app.printCalls[0].image.image,target);assert.equal(app.printCalls[0].isCurrent(),true);
  assert.equal(app.sceneCalls.length,0);app.changeStudio('image',1);assert.equal(app.printCalls[0].isCurrent(),false);
});

test('holding splats prints its current view and closing review invalidates the handoff',async()=>{
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);const target=app.get('scene');
  await app.get('photo-dialog').emit('pointerdown',{target});await app.tick(500);await app.get('photo-dialog').emit('pointerup',{target});
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image,app.snapshot);assert.equal(app.printCalls[0].isCurrent(),true);
  assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
  await app.get('close-photo').emit('click');assert.equal(app.printCalls[0].isCurrent(),false);
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
  await app.get('close-photo').emit('click');await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(app.get('photo').src,url);assert.equal(app.get('photo-dialog').open,true);assert.equal(app.sceneCalls.length,0);
  assert.equal(app.modelChecks.length,0);assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
  assert.equal(app.requests.some(r=>/^\/(photos|photo)(\?|$)/.test(r.url)),false);
  assert.doesNotMatch(html,/minnekort|\bSD\b|X-Storage|X-Photo|gallery-dialog|photo-feedback/);
});

test('closing review allows pending inference to cache without reopening review',async()=>{
  const pending=deferred();let disposed=false;const app=await connectedCamera({splats:true,scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');
  assert.equal(app.sceneCalls[0].signal.aborted,false);pending.resolve({dispose(){disposed=true}});await app.tick(0);
  assert.equal(disposed,false);assert.equal(app.get('photo-dialog').open,false);assert.equal(app.get('scene').hidden,true);
  assert.match(app.images[0].src,/:81\/stream/);
  await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(app.get('scene').hidden,false);assert.equal(app.sceneCalls.length,1);
});

test('a late scene from an old capture cannot replace the new scene',async()=>{
  const pending=deferred();let starts=0,disposed=false;
  const app=await connectedCamera({splats:true,scene:()=>++starts===1?pending.promise:Promise.resolve({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');
  await app.get('capture-plane').emit('click');await app.tick(0);const url=app.get('photo').src;
  assert.equal(app.sceneCalls.length,2);pending.resolve({dispose(){disposed=true}});await app.tick(0);
  assert.equal(disposed,true);assert.equal(app.get('photo').src,url);assert.equal(app.get('scene').hidden,false);
  assert.equal(app.objectUrls.get(url),app.sceneCalls[1].blob);assert.equal(app.sceneCalls[1].signal.aborted,false);
});

test('closing and reopening a completed scene preserves its view without another capture or inference',async()=>{
  let disposed=0;const viewer={yaw:0,dispose(){disposed++}},app=await connectedCamera({splats:true,scene:async()=>viewer});
  await app.get('capture-plane').emit('click');await app.tick(0);viewer.yaw=1.7;
  const url=app.get('photo').src;await app.get('close-photo').emit('click');
  assert.equal(disposed,0);assert.equal(app.get('scene').hidden,true);
  await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(viewer.yaw,1.7);assert.equal(app.sceneCalls.length,1);assert.equal(app.get('scene').hidden,false);
  assert.equal(app.get('photo').src,url);assert.equal(app.requests.filter(r=>r.url.startsWith('/capture')).length,1);
});

test('a failed next capture retains the last completed scene',async()=>{
  let captures=0,disposed=false;
  const app=await connectedCamera({splats:true,scene:async()=>({dispose(){disposed=true}}),fetch:(url,count,response)=>url.startsWith('/capture')&&++captures===2?response(new Blob(['error'],{type:'text/html'})):undefined});
  await app.get('capture-plane').emit('click');await app.tick(0);const url=app.get('photo').src;
  await app.get('close-photo').emit('click');await app.get('capture-plane').emit('click');
  assert.equal(disposed,false);assert.equal(app.get('photo-dialog').open,false);
  await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(app.get('photo').src,url);assert.equal(app.get('scene').hidden,false);assert.equal(app.sceneCalls.length,1);
});

test('a valid new photo disposes the previous scene exactly once',async()=>{
  let disposed=0;const app=await connectedCamera({splats:true,scene:async()=>({dispose(){disposed++}})});
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');
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
  await app.get('close-photo').emit('click');await app.get('capture-plane').emit('click');
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
  await app.get('close-photo').emit('click');assert.equal(app.get('recenter-photo').hidden,true);
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
  const resets=app.photoResets;await app.get('close-photo').emit('click');await app.get('capture-plane').emit('click');
  assert.equal(app.photoResets,resets);assert.equal(app.photoGestureState.scale,2.5);
  await app.get('retry-capture').emit('click');assert.equal(app.photoResets,resets+1);assert.equal(app.photoGestureState.scale,1);
});

test('native device printing holds capture and MJPEG until terminal while preserving the current photo',async()=>{
  const pending=deferred(),app=await connectedCamera({print:()=>pending.promise});assert.equal(app.printConfiguration.devicePrinter.native,true);assert.equal(typeof app.printConfiguration.buildJob,'function');
  await app.get('capture-plane').emit('click');app.gesturePhoto({scale:2,x:20,y:-10});const original=app.get('photo').src,printing=app.get('print-photo').emit('click');await flush();
  assert.equal(app.printCalls.length,1);assert.equal(app.get('print-photo').disabled,true);await app.get('close-photo').emit('click');assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.get('progress').hidden,false);assert.equal(app.images[0].src,'');await app.get('capture-plane').emit('click');assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  pending.resolve(true);await printing;assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.get('progress').hidden,true);assert.match(app.images[0].src,/\/stream/);assert.equal(app.opened.length,0);await app.get('last-photo').emit('click');assert.equal(app.get('photo').src,original);assert.equal(app.photoGestureState.scale,2);assert.equal(app.photoGestureState.x,20);
});

test('returning during native printing waits for terminal status before reconnecting the finder',async()=>{
  const pending=deferred(),app=await connectedCamera({print:()=>pending.promise});
  await app.get('capture-plane').emit('click');
  const printing=app.get('print-photo').emit('click');await flush();
  await app.get('close-photo').emit('click');
  const statusReads=app.requests.filter(request=>request.url.startsWith('/status')).length;
  app.document.hidden=true;await app.emit('visibilitychange');await app.emit('pagehide',{persisted:true});
  app.document.hidden=false;await app.emit('visibilitychange');await app.emit('pageshow',{persisted:true});await app.emit('online');
  await app.tick(10000);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/status')).length,statusReads);
  assert.equal(app.images[0].src,'');assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.get('progress').hidden,false);
  pending.resolve(true);await printing;await app.tick(150);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/status')).length,statusReads+1);
  assert.match(app.images[0].src,/\/stream/);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.get('progress').hidden,true);
  assert.equal(app.printCalls.length,1);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('native printing ignores a stale heartbeat and does not poll camera health until terminal',async()=>{
  const heartbeat=deferred(),pending=deferred();let statusReads=0;
  const app=await connectedCamera({print:()=>pending.promise,fetch:url=>url.startsWith('/status')&&++statusReads===2?heartbeat.promise:undefined});
  await app.get('capture-plane').emit('click');await app.get('close-photo').emit('click');await app.tick(10000);
  await app.get('last-photo').emit('click');
  const printing=app.get('print-photo').emit('click');await flush();await app.get('close-photo').emit('click');
  heartbeat.reject(new Error('network suspended'));await app.tick(10000);
  assert.equal(statusReads,2);assert.equal(app.get('notice').textContent,'');assert.equal(app.images[0].src,'');
  pending.resolve(true);await printing;await app.tick(150);
  assert.equal(statusReads,2);assert.match(app.images[0].src,/\/stream/);assert.equal(app.get('capture-plane').disabled,false);
});

for(const outcome of ['success','failure'])test(`native printing retires a pending camera reconnect before its late ${outcome}`,async()=>{
  const reconnect=deferred(),pending=deferred();let statusReads=0;
  const app=await connectedCamera({print:()=>pending.promise,fetch:url=>url.startsWith('/status')&&++statusReads===2?reconnect.promise:undefined});
  await app.get('capture-plane').emit('click');await app.get('close-photo').emit('click');
  app.document.hidden=true;await app.emit('visibilitychange');app.document.hidden=false;await app.emit('visibilitychange');
  await app.get('last-photo').emit('click');
  const printing=app.get('print-photo').emit('click');await flush();await app.get('close-photo').emit('click');
  if(outcome==='success')reconnect.resolve(app.response({...verifiedStatus}));else reconnect.reject(new Error('stale camera reconnect'));
  await app.tick(0);
  assert.equal(app.get('notice').textContent,'');assert.equal(app.images[0].src,'');assert.equal(app.get('capture-plane').disabled,true);
  pending.resolve(true);await printing;await app.tick(150);
  assert.equal(statusReads,3);assert.equal(app.get('notice').textContent,'');assert.match(app.images[0].src,/\/stream/);assert.equal(app.get('capture-plane').disabled,false);
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
  await app.get('close-photo').emit('click');await app.get('capture-plane').emit('click');await app.tick(0);
  old.onError(new Error('Old GPU error'));
  assert.equal(app.get('scene').hidden,false);assert.equal(app.get('retry-scene').hidden,true);assert.equal(app.get('scene-status').hidden,true);assert.equal(app.sceneCalls.length,2);
});

test('loading uses only progress while failures retain an actionable retry',async()=>{
  const pending=deferred();let starts=0;
  const app=await connectedCamera({splats:true,scene:async(host,blob,report)=>{if(++starts===1){report({phase:'estimating',percent:42});return pending.promise}return {dispose(){}}}});
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.get('scene-status').hidden,true);assert.equal(app.get('scene-status').textContent,'');assert.equal(app.get('scene-progress').hidden,false);
  assert.equal(app.get('scene-progress-bar').style.width,'42%');assert.equal(app.get('print-photo').disabled,true);
  pending.reject(new Error('Berekninga vart avbroten.'));await app.tick(0);
  assert.equal(app.get('scene-status').hidden,false);assert.match(app.get('scene-status').textContent,/Berekninga/);
  assert.equal(app.get('retry-scene').hidden,false);await app.get('retry-scene').emit('click');await app.tick(0);
  assert.equal(app.get('scene-status').hidden,true);assert.equal(app.get('retry-scene').hidden,true);
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
  assert.equal(app.get('onboarding-title').textContent,'Klargjer 3D');assert.match(app.get('onboarding-copy').textContent,/internett éin gong/);assert.equal(app.get('onboarding-copy').hidden,false);assert.equal(app.get('onboarding-next').textContent,'Fullfør');assert.equal(app.get('close-onboarding').getAttribute('aria-label'),'Tilbake til biletet');assert.equal(app.get('onboarding-help').open,false);
  await app.get('onboarding-next').emit('click');assert.equal(app.get('onboarding-title').textContent,'Fullfører 3D');assert.equal(app.get('onboarding-progress').hidden,false);assert.equal(app.get('onboarding-copy').textContent,'');assert.equal(app.get('onboarding-copy').hidden,true);assert.equal(app.get('onboarding-feedback').textContent,'');app.preparations[0].onProgress({percent:37});assert.equal(app.get('onboarding-progress').value,37);assert.equal(app.get('onboarding-feedback').textContent,'');pending.reject(new Error('Internett manglar. Prøv igjen.'));await app.tick(0);assert.equal(app.get('onboarding-progress').hidden,true);assert.match(app.get('onboarding-feedback').textContent,/Internett manglar/);assert.equal(app.get('onboarding-next').hidden,false);assert.match(html,/<h1 id="onboarding-title" class="sr">/);assert.doesNotMatch(html,/class="eyebrow"|Fullfører klargjeringa på telefonen|Opnar skrivaren …/);
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
  await app.get('capture-plane').emit('click');await app.tick(0);await app.get('close-photo').emit('click');
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

test('a model check failure explains setup only after requesting splats',async()=>{
  const app=await connectedCamera({modelsReady:async()=>{throw new Error('Manifest unavailable')}});
  await app.get('capture-plane').emit('click');app.changeStudio('image',1);await app.tick(0);
  assert.equal(app.get('onboarding').open,true);assert.match(app.get('onboarding-feedback').textContent,/Manifest unavailable/);
  assert.equal(app.get('photo').src,app.get('photo').src);assert.equal(app.opened.length,0);
});

test('the legacy Wi-Fi entry shows only handoff and makes no camera or model requests',async()=>{
  const app=harness({search:'?wifi'});await app.tick(1000);
  assert.equal(app.get('safari-handoff').hidden,false);assert.equal(app.get('studio').hidden,true);
  assert.equal(app.requests.length,0);assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);assert.equal(app.images.length,0);
  assert.match(html,/<code>esp32\.iverfinne\.no\/start\/<\/code>/);assert.match(html,/id="onboarding-prepare"[^>]*href="https:\/\/esp32\.iverfinne\.no\/start\/"/);
});

test('the prepared opener hears readiness after a live frame without requiring models',async()=>{
  const app=harness({search:'?connect',opener:true,modelsReady:false,frames:false});await app.tick(150);
  assert.equal(app.messages.length,0);app.images[0].naturalWidth=320;app.images[0].naturalHeight=240;await app.tick(150);
  assert.equal(app.messages.length,1);assert.equal(app.messages[0].data.type,'entropi-camera-ready');
  assert.equal(app.messages[0].origin,'https://esp32.iverfinne.no');assert.equal(app.modelChecks.length,0);
  await app.tick(10000);assert.equal(app.messages.length,1);
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
  app.changeStudio('image',0);app.get('onboarding').close();await app.get('close-photo').emit('click');
  pending.resolve();await app.tick(0);await app.emit('pageshow',{persisted:true});await app.tick(150);
  assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.sceneCalls.length,0);
});

async function reviewTap(app,details={}) {
  const target=app.get('photo');
  await app.get('photo-dialog').emit('pointerdown',{target,...details});
  await app.get('photo-dialog').emit('pointerup',{target,...details});
}

test('a double tap leaves working review while its result stays cached for the last photo', async () => {
  const pending=deferred();let disposed=false;
  const app=await connectedCamera({splats:true,scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');
  await reviewTap(app);await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,false);
  assert.equal(app.sceneCalls[0].signal.aborted,false);
  pending.resolve({dispose(){disposed=true}});await app.tick(150);
  assert.equal(disposed,false);
  assert.equal(app.get('photo-dialog').open,false);
  assert.match(app.images[0].src,/:81\/stream/);
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
  await reviewTap(app);await app.get('close-photo').emit('click');
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
  await app.get('close-photo').emit('click');await app.get('capture-plane').emit('click');await app.tick(0);
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
  assert.equal(app.get('photo-dialog').open,false);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  await app.tick(401);await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,2);
  assert.equal(app.get('photo-dialog').open,true);
});

test('save is an action that encodes the displayed native photo framing without navigating its JPEG',async()=>{
  const app=await connectedCamera();await app.get('capture-plane').emit('click');const url=app.get('photo').src;app.gesturePhoto({scale:2,x:30,y:-10});await app.get('save-photo').emit('click');assert.equal(app.get('save-photo').tagName,'BUTTON');assert.equal(app.get('save-photo').getAttribute('href'),null);assert.equal(app.saves.length,1);assert.equal(app.saves[0].blob.type,'image/png');assert.match(app.saves[0].name,/\.png$/);assert.equal(app.encodedSnapshots[0].native,true);assert.deepEqual(app.encodedSnapshots[0].pose,{scale:2,x:30,y:-10,width:390,height:844,grain:1,contrast:1});assert.equal(app.get('photo').src,url);assert.equal(app.saves[0].isCurrent(),true);
  await app.get('close-photo').emit('click');assert.equal(app.saves[0].isCurrent(),false);await app.get('capture-plane').emit('click');assert.equal(app.saves[0].isCurrent(),false);
});

test('splat saving requests its native current palette instead of the source image or print resolution',async()=>{
  let level=0;const flags=[],native={width:640,height:960,data:new Uint8ClampedArray(640*960*4)};const app=await connectedCamera({splats:true,scene:async()=>({dispose(){},setPrimitiveLevel:value=>level=value,snapshot:nativeSize=>{flags.push(nativeSize);return {...native,level}}})});await app.get('capture-plane').emit('click');await app.tick(0);app.changeStudio('primitive',2);await app.get('save-photo').emit('click');assert.deepEqual(flags,[true]);assert.equal(app.encodedSnapshots[0].width,640);assert.equal(app.encodedSnapshots[0].height,960);assert.equal(app.encodedSnapshots[0].level,2);assert.equal(app.saves[0].blob.type,'image/png');assert.equal(app.sceneCalls.length,1);
});

test('photo style and three-finger tone feed the rendered save and print source without model work',async()=>{
  const app=await connectedCamera({modelsReady:false});await app.get('capture-plane').emit('click');const view=app.photoViews[0],url=app.get('photo').src;assert.equal(view.source.naturalWidth,1600);assert.notEqual(view.source,app.get('photo'));assert.equal(view.shown,true);app.changeStudio('photo',1);const refreshes=view.refreshes;assert.equal(app.gesturePhoto({grain:4,contrast:1.8,scale:2,x:30,y:-10}),true);assert.deepEqual(view.tone,{grain:4,contrast:1.8});assert.ok(view.refreshes>refreshes);
  await app.get('save-photo').emit('click');await app.get('print-photo').emit('click');for(const output of [app.encodedSnapshots[0],app.printCalls[0].image]){assert.equal(output.style,1);assert.deepEqual(output.tone,{grain:4,contrast:1.8});assert.equal(output.photo,true)}assert.deepEqual(view.snapshots.map(call=>call.native),[true,false]);assert.equal(app.sceneCalls.length,0);assert.equal(app.modelChecks.length,0);assert.equal(app.get('photo').src,url);assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  await app.get('close-photo').emit('click');assert.equal(view.shown,false);await app.get('last-photo').emit('click');assert.equal(view.shown,true);assert.equal(view.sources.length,1);assert.equal(view.style,1);assert.deepEqual(view.tone,{grain:4,contrast:1.8});
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
