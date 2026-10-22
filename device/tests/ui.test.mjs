import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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
  const printCalls = [];
  const snapshot={width:384,height:1,data:new Uint8ClampedArray(384*4)};
  const modelChecks = [];
  const preparations = [];
  const opened = [];
  const messages = [];
  const studioBindings = [];
  const studioControls = { quality: 2, primitive: 0, dispose() {} };
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
  const qualities = [6, 10].map(size => {
    const element = new Element('', 'BUTTON');
    element.dataset.size = String(size);
    return element;
  });
  const photoQualities = [6, 10, 15].map(size => {
    const element = new Element('', 'BUTTON');
    element.dataset.photoSize = String(size);
    return element;
  });
  const closer = new Element('', 'BUTTON');
  closer.dataset.close = 'settings-dialog';
  const document = {
    hidden: false,
    activeElement: { tagName: 'BODY' },
    getElementById: id => elements.get(id),
    querySelectorAll: selector => selector === '[data-size]' ? qualities : selector === '[data-photo-size]' ? photoQualities : selector === '[data-close]' ? [closer] : [],
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
    if (String(url).startsWith('/control?')) {
      const query = new URL(String(url), 'http://192.168.4.1').searchParams;
      status[query.get('var')] = Number(query.get('val'));
    }
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
    Viewfinder: class { constructor(canvas) { this.canvas = canvas; } },
    attachStudioControls: (hosts, onChange, enabled, onGesture) => { studioBindings.push({ hosts, onChange, enabled, onGesture }); return studioControls; },
    phoneModelsReady: async signal => { modelChecks.push(signal); return typeof options.modelsReady==='function'?options.modelsReady(signal):options.modelsReady!==false; },
    requestPhoneModels: async (signal,onProgress,source) => { preparations.push({signal,onProgress,source}); if(options.prepare)await options.prepare(signal,onProgress,source); },
    createPrintClient:()=>({print:(image,isCurrent)=>{printCalls.push({image,isCurrent});return Promise.resolve(true)},dispose(){}}),
    createDepthScene: async (host, blob, onProgress, signal, quality) => {
      sceneCalls.push({ host, blob, onProgress, signal, quality });
      if (options.scene) return { setPrimitiveLevel() {}, snapshot:()=>snapshot, ...await options.scene(host, blob, onProgress, signal, quality) };
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
  return { elements, qualities, photoQualities, document, images, canvases, requests, revoked, objectUrls, sceneCalls, printCalls, snapshot, modelChecks, preparations, studioControls, changeStudio, gestureStudio, opened, messages, childWindow, stored, response, tick, emit, get: id => elements.get(id) };
}

async function connectedCamera(options = {}) {
  const app = harness(options);
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, false);
  assert.equal(app.get('studio').classList.contains('connected'), true);
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
  assert.match(app.get('notice').textContent, /ikkje teke/);
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
  assert.match(app.get('save-photo').href, /^blob:/);
  await app.get('close-photo').emit('click');
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.images[0].src, /:81\/stream/);
  assert.equal(app.document.activeElement, app.get('capture-plane'));
  assert.equal(app.get('capture-plane').disabled, false);
});

test('rejected exposure control restores the last confirmed value', async () => {
  const app = await connectedCamera({ fetch: (url, count, response) => url.startsWith('/control') ? response(null, false) : undefined });
  app.get('brightness').value = '2';
  await app.get('brightness').emit('input');
  await app.get('brightness').emit('change');
  assert.equal(Number(app.get('brightness').value), 0);
  assert.equal(Number(app.get('brightness-value').value), 0);
  assert.match(app.get('settings-feedback').textContent, /ikkje stadfesta/);
  assert.equal(app.get('capture-plane').disabled, false);
});

test('malformed status after a quality change preserves the previous verified setting', async () => {
  let statusReads = 0;
  const app = await connectedCamera({ fetch: (url, count, response) => {
    if (url.startsWith('/status') && ++statusReads > 1) return response({ framesize: 15 });
  } });
  await app.qualities.find(button => button.dataset.size === '6').emit('click');
  assert.equal(app.qualities.find(button => button.dataset.size === '10').getAttribute('aria-pressed'), 'true');
  assert.equal(app.qualities.find(button => button.dataset.size === '6').getAttribute('aria-pressed'), 'false');
  assert.equal(Number(app.get('brightness').value), 0);
  assert.match(app.get('settings-feedback').textContent, /ikkje stadfesta/);
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
  await app.get('onboarding-next').emit('click');
  assert.equal(app.get('onboarding').open, false);
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open, true);
});

test('the connection helper exposes the open ENTROPI network without password fields or copying', async () => {
  const app=harness({search:'?setup',frames:false});await app.tick(150);
  assert.equal(app.get('onboarding').open,true);
  assert.match(html,/Klargjer telefonen med internett før du koplar til ENTROPI/);
  assert.match(html,/Nettet er ope/);
  assert.equal(app.get('password'),undefined);
  assert.equal(app.get('copy-password'),undefined);
  assert.doesNotMatch(html,/entropi2026|copy-password|navigator\.clipboard|\bid=["']password["']/i);
});

test('preview and photo resolution use independent controls', async () => {
  const app = await connectedCamera();
  await app.qualities.find(button => button.dataset.size === '6').emit('click');
  await app.photoQualities.find(button => button.dataset.photoSize === '10').emit('click');
  const commands = app.requests.filter(request => request.url.startsWith('/control')).map(request => new URL(request.url, 'http://192.168.4.1').searchParams);
  assert.deepEqual(commands.map(query => [query.get('var'), query.get('val')]), [['framesize', '6'], ['photo_framesize', '10']]);
  assert.equal(app.qualities.find(button => button.dataset.size === '6').getAttribute('aria-pressed'), 'true');
  assert.equal(app.photoQualities.find(button => button.dataset.photoSize === '10').getAttribute('aria-pressed'), 'true');
});

test('preview and photo resolution stay at QVGA without PSRAM', async () => {
  const app = await connectedCamera({ status: { ...verifiedStatus, psram: false, framesize: 6, photo_framesize: 6 } });
  assert.equal(app.photoQualities.find(button => button.dataset.photoSize === '15').disabled, true);
  assert.equal(app.photoQualities.find(button => button.dataset.photoSize === '10').disabled, true);
  assert.equal(app.photoQualities.find(button => button.dataset.photoSize === '6').disabled, false);
  assert.equal(app.qualities.find(button => button.dataset.size === '10').disabled, true);
  assert.equal(app.qualities.find(button => button.dataset.size === '6').disabled, false);
  assert.equal(app.get('capture-plane').disabled, false);
});

for (const stream_ready of [true, false]) {
  test(`sensor failure retains actionable diagnostics without starting a stream (${stream_ready})`, async () => {
    const app = harness({ status: { ...verifiedStatus, camera_ready: false, stream_ready, last_error: 'Sensor not found (0x105)' } });
    await app.tick(150);
    assert.equal(app.get('capture-plane').disabled, true);
    assert.equal(app.get('studio').classList.contains('connected'), false);
    assert.equal(app.images[0].src, '');
    assert.match(app.get('notice').textContent + app.get('device-health').textContent, /Sensor not found/);
    assert.doesNotMatch(app.get('notice').textContent, /Wi-Fi|fråkopla/i);
    assert.equal(app.get('last-photo').hidden, true);
  });
}

test('a camera without a ready stream never reports a live connection', async () => {
  const app = harness({ status: { ...verifiedStatus, stream_ready: false, last_error: 'Stream server unavailable' } });
  await app.tick(150);
  assert.equal(app.get('capture-plane').disabled, true);
  assert.equal(app.images[0].src, '');
  assert.match(app.get('notice').textContent + app.get('device-health').textContent, /Stream server unavailable/);
});

test('an invalid JPEG cannot open review', async () => {
  const app = await connectedCamera({ decodeFailure: true });
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.get('notice').textContent, /ikkje teke/);
  assert.equal(app.get('capture-plane').disabled, false);
});

test('an HTML capture response cannot be mistaken for a photo', async () => {
  const app = await connectedCamera({ fetch: (url, count, response) => url.startsWith('/capture') ? response(new Blob(['error'], { type: 'text/html' })) : undefined });
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open, false);
  assert.match(app.get('notice').textContent, /ikkje teke/);
  assert.equal(app.get('capture-plane').disabled, false);
});

test('photo review automatically creates a local scene while saving only the JPEG', async () => {
  let disposed=false;
  const app=await connectedCamera({scene:async(host,blob,progress)=>{progress({phase:'estimating'});return {dispose(){disposed=true}}}});
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls.length,1);
  assert.equal(app.sceneCalls[0].host,app.get('scene'));
  assert.equal(app.sceneCalls[0].blob.type,'image/jpeg');
  assert.equal(app.get('scene').hidden,false);
  assert.equal(app.get('photo').hidden,true);
  assert.equal(app.get('save-photo').href,app.get('photo').src);
  assert.match(app.get('save-photo').download,/\.jpg$/);
  assert.equal(app.get('scene-status').textContent,'');
  assert.equal([...app.objectUrls.values()].some(blob=>blob.type==='application/octet-stream'),false);
  await app.get('close-photo').emit('click');
  assert.equal(disposed,true);
  assert.equal(app.sceneCalls[0].signal.aborted,true);
});

test('the review toggle switches views while keeping the JPEG as the only download', async () => {
  const app=await connectedCamera({scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  const photoUrl=app.get('save-photo').href;
  await app.get('toggle-scene').emit('click');
  assert.equal(app.get('scene').hidden,true);
  assert.equal(app.get('photo').hidden,false);
  assert.equal(app.get('save-photo').href,app.get('photo').src);
  assert.match(app.get('save-photo').download,/\.jpg$/);
  await app.get('toggle-scene').emit('click');
  assert.equal(app.get('scene').hidden,false);
  assert.equal(app.get('photo').hidden,true);
  assert.equal(app.get('save-photo').href,photoUrl);
  assert.match(app.get('save-photo').download,/\.jpg$/);
  assert.equal([...app.objectUrls.values()].some(blob=>blob.type==='application/octet-stream'),false);
});

test('holding a scene prints its snapshot and closing review invalidates the pending print',async()=>{
  const app=await connectedCamera({scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);const target=app.get('scene');
  await app.get('photo-dialog').emit('pointerdown',{target});await app.tick(500);await app.get('photo-dialog').emit('pointerup',{target});
  assert.equal(app.printCalls.length,1);assert.equal(app.printCalls[0].image,app.snapshot);assert.equal(app.printCalls[0].isCurrent(),true);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  await app.tick(100);await reviewTap(app);assert.equal(app.get('photo-dialog').open,true);
  await app.get('close-photo').emit('click');assert.equal(app.printCalls[0].isCurrent(),false);
});

test('dragging or three fingers cannot become a printer hold',async()=>{
  const app=await connectedCamera({scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);const target=app.get('scene');
  await app.get('photo-dialog').emit('pointerdown',{target});await app.get('photo-dialog').emit('pointermove',{target,clientX:180});await app.tick(600);await app.get('photo-dialog').emit('pointerup',{target});
  for(const pointerId of [1,2,3])await app.get('photo-dialog').emit('pointerdown',{target,pointerId,isPrimary:pointerId===1});await app.tick(600);
  for(const pointerId of [3,2,1])await app.get('photo-dialog').emit('pointerup',{target,pointerId,isPrimary:pointerId===1});
  assert.equal(app.printCalls.length,0);assert.equal(app.get('photo-dialog').open,true);
});

test('missing phone models preserve the JPEG and offer phone preparation', async () => {
  const app=await connectedCamera();
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.get('photo').hidden,false);
  assert.equal(app.get('scene').hidden,true);
  assert.equal(app.get('save-photo').href,app.get('photo').src);
  assert.match(app.get('save-photo').download,/\.jpg$/);
  assert.equal(app.get('onboarding').open,true);
  assert.equal(app.get('onboarding-prepare').hidden,false);
  assert.equal(app.get('retry-scene').hidden,false);
  assert.equal(app.get('retry-scene').getAttribute('aria-label'),'Klargjer telefonen');
  assert.equal(app.opened.length,0);
});

test('a cardless capture stays available for the current session without storage routes or messages', async () => {
  const app=await connectedCamera({scene:async()=>({dispose(){}})});
  assert.equal(app.get('last-photo').hidden,true);
  await app.get('capture-plane').emit('click');await app.tick(0);
  const jpeg=app.sceneCalls[0].blob,url=app.get('save-photo').href;
  await app.get('close-photo').emit('click');await app.get('last-photo').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls[1].blob,jpeg);
  assert.equal(app.get('save-photo').href,url);
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  assert.equal(app.requests.some(request=>/^\/(photos|photo)(\?|$)/.test(request.url)),false);
  assert.doesNotMatch(html,/minnekort|\bSD\b|X-Storage|X-Photo|gallery-dialog|photo-feedback/);
});

test('explicit phone preparation retries the same JPEG after model transfer', async () => {
  let attempts=0;
  const app=await connectedCamera({scene:async()=>{if(++attempts===1)throw Object.assign(new Error('Missing'),{code:'PHONE_SETUP_REQUIRED'});return {dispose(){}}}});
  await app.get('capture-plane').emit('click');await app.tick(0);
  const jpeg=app.sceneCalls[0].blob,url=app.get('save-photo').href;
  assert.equal(app.preparations.length,0);
  await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.preparations.length,1);
  assert.equal(app.sceneCalls[1].blob,jpeg);
  assert.equal(app.get('save-photo').href,url);
  assert.equal(app.get('scene').hidden,false);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('leaving the page during phone preparation aborts transfer and cannot enable a late capture', async () => {
  const pending=deferred(),app=await connectedCamera({prepare:()=>pending.promise});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.preparations.length,1);
  await app.emit('pagehide');
  assert.equal(app.preparations[0].signal.aborted,true);
  pending.resolve();await app.tick(150);
  assert.equal(app.sceneCalls.length,1);
  assert.equal(app.get('capture-plane').disabled,true);
  assert.equal(app.images[0].src,'');
});

test('failed model transfer keeps the original JPEG and exposes a retry', async () => {
  const app=await connectedCamera({prepare:async()=>{throw new Error('Transfer failed')}});
  await app.get('capture-plane').emit('click');await app.tick(0);
  const url=app.get('save-photo').href;
  await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.get('save-photo').href,url);
  assert.equal(app.get('photo').hidden,false);
  assert.equal(app.get('retry-scene').hidden,false);
  assert.equal(app.sceneCalls.length,1);
});

test('closing review aborts processing and disposes a late scene without reopening review', async () => {
  const pending=deferred();let disposed=false;
  const app=await connectedCamera({scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');
  await app.get('close-photo').emit('click');
  assert.equal(app.sceneCalls[0].signal.aborted,true);
  pending.resolve({dispose(){disposed=true}});
  await app.tick(150);
  assert.equal(disposed,true);
  assert.equal(app.get('photo-dialog').open,false);
  assert.equal(app.get('scene').hidden,true);
  assert.equal(app.get('scene-status').textContent,'');
  assert.match(app.images[0].src,/:81\/stream/);
});

test('a late scene from a previous capture cannot replace the current photo scene', async () => {
  const pending=deferred();let starts=0,oldDisposed=false;
  const app=await connectedCamera({scene:()=>++starts===1?pending.promise:Promise.resolve({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.get('close-photo').emit('click');
  await app.get('capture-plane').emit('click');await app.tick(0);
  const current=app.get('save-photo').href;
  assert.equal(app.sceneCalls.length,2);
  assert.equal(app.sceneCalls[0].signal.aborted,true);
  assert.equal(app.sceneCalls[1].signal.aborted,false);
  pending.resolve({dispose(){oldDisposed=true}});await app.tick(0);
  assert.equal(oldDisposed,true);
  assert.equal(app.get('save-photo').href,current);
  assert.equal(app.objectUrls.get(current),app.sceneCalls[1].blob);
  assert.match(app.get('save-photo').download,/\.jpg$/);
  assert.equal([...app.objectUrls.values()].some(blob=>blob.type==='application/octet-stream'),false);
  assert.equal(app.get('photo-dialog').open,true);
});

test('a verified phone cache opens the camera without onboarding or a file chooser', async () => {
  const app=await connectedCamera({onboarded:false,storageDenied:true});
  assert.equal(app.get('onboarding').open,false);
  assert.doesNotMatch(html,/<input\b[^>]*\btype=["']file["']/i);
  assert.equal(app.opened.length,0);
});

test('first-time setup blocks photo requests until an explicit verified transfer completes',async()=>{
  const pending=deferred(),app=harness({modelsReady:false,prepare:()=>pending.promise,scene:async()=>({dispose(){}})});await app.tick(150);
  assert.equal(app.get('studio').classList.contains('connected'),true);
  assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.get('onboarding').open,true);assert.equal(app.preparations.length,0);
  await app.get('capture-plane').emit('click');assert.equal(app.requests.some(request=>request.url.startsWith('/capture')),false);
  let prevented=false;await app.get('onboarding').emit('cancel',{preventDefault(){prevented=true}});assert.equal(prevented,true);
  await app.get('onboarding-next').emit('click');await app.get('onboarding-next').emit('click');await app.tick(0);
  assert.equal(app.preparations.length,1);assert.equal(app.get('onboarding-next').hidden,true);
  pending.resolve();await app.tick(0);assert.equal(app.get('onboarding').open,false);assert.equal(app.get('capture-plane').disabled,false);
  assert.equal(app.requests.some(request=>request.url.startsWith('/capture')),false);
  await app.get('capture-plane').emit('click');assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
});

test('a prepared HTTPS opener provisions the camera before its first photo',async()=>{
  const pending=deferred(),opener={},app=harness({search:'?connect',opener,modelsReady:false,prepare:()=>pending.promise});await app.tick(150);
  assert.equal(app.preparations.length,1);assert.equal(app.preparations[0].source,opener);
  assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.opened.length,0);
  pending.resolve();await app.tick(0);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.get('onboarding').open,false);
  assert.equal(app.sceneCalls.length,0);assert.equal(app.requests.some(request=>request.url.startsWith('/capture')),false);
});

test('capture waits for the actual phone cache check rather than a previous visit flag',async()=>{
  const pending=deferred(),app=harness({modelsReady:()=>pending.promise,onboarded:true});await app.tick(150);
  assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.preparations.length,0);
  pending.resolve(false);await app.tick(0);assert.equal(app.get('onboarding').open,true);assert.equal(app.get('capture-plane').disabled,true);
});

test('returning after an interrupted cache check verifies the phone again before enabling capture',async()=>{
  const pending=deferred();let checks=0;
  const app=harness({modelsReady:()=>++checks===1?pending.promise:true});await app.tick(150);
  await app.emit('pagehide');assert.equal(app.modelChecks[0].aborted,true);
  pending.resolve(true);await app.tick(0);assert.equal(app.get('capture-plane').disabled,true);
  await app.emit('pageshow',{persisted:true});await app.tick(150);
  assert.equal(app.modelChecks.length,2);assert.equal(app.get('capture-plane').disabled,false);
  assert.equal(app.requests.some(request=>request.url.startsWith('/capture')),false);
});

test('a readiness failure explains the error without enabling capture or opening a popup',async()=>{
  const app=harness({modelsReady:async()=>{throw new Error('Manifest unavailable')}});await app.tick(150);
  assert.equal(app.get('capture-plane').disabled,true);assert.equal(app.get('onboarding').open,true);
  assert.match(app.get('onboarding-feedback').textContent,/Manifest unavailable/);assert.equal(app.opened.length,0);
});

test('the captive Wi-Fi entry shows only the Safari handoff and performs no camera or model requests',async()=>{
  const app=harness({search:'?wifi'});await app.tick(1000);
  assert.equal(app.get('safari-handoff').hidden,false);assert.equal(app.get('studio').hidden,true);
  assert.equal(app.requests.length,0);assert.equal(app.modelChecks.length,0);assert.equal(app.preparations.length,0);assert.equal(app.images.length,0);
  assert.equal(app.opened.length,0);assert.equal(app.get('onboarding').open,false);
});

test('the prepared opener hears camera readiness only after verified models and a live frame',async()=>{
  const pending=deferred(),app=harness({search:'?connect',opener:true,modelsReady:()=>pending.promise,frames:false});await app.tick(150);
  assert.equal(app.messages.length,0);
  pending.resolve(true);await app.tick(150);assert.equal(app.messages.length,0);
  app.images[0].naturalWidth=320;app.images[0].naturalHeight=240;await app.tick(150);
  assert.equal(app.messages.length,1);assert.equal(app.messages[0].data.type,'entropi-camera-ready');
  assert.equal(app.messages[0].origin,'https://esp32.iverfinne.no');
  await app.get('brightness').emit('change');await app.tick(150);
  assert.equal(app.messages.filter(message=>message.data.type==='entropi-camera-ready').length,1);
});

test('direct local entry sends no camera notifications to an unrelated opener',async()=>{
  const app=await connectedCamera({opener:true});await app.emit('pagehide');assert.equal(app.messages.length,0);
});

test('pagehide reports leaving and a restored camera reports a fresh verified connection',async()=>{
  const app=await connectedCamera({search:'?connect',opener:true}),left=[];
  const port=app.messages[0].ports[0];port.onmessage=event=>left.push(event.data.type);await app.emit('pagehide');
  assert.deepEqual(app.messages.map(message=>message.data.type),['entropi-camera-ready']);
  assert.deepEqual(left,['entropi-camera-left']);assert.equal(port.peer.closed,true);assert.equal(app.get('capture-plane').disabled,true);
  await app.emit('pageshow',{persisted:true});await app.tick(150);
  assert.equal(app.messages.at(-1).data.type,'entropi-camera-ready');assert.notEqual(app.messages.at(-1).ports[0],port);assert.equal(app.modelChecks.length,2);
});

test('returning after another tab populated the phone cache completes setup without a transfer',async()=>{
  let cached=false;const app=harness({modelsReady:()=>cached});await app.tick(150);
  assert.equal(app.get('onboarding').open,true);app.document.hidden=true;await app.emit('visibilitychange');
  cached=true;app.document.hidden=false;await app.emit('visibilitychange');await app.tick(150);
  assert.equal(app.modelChecks.length,2);assert.equal(app.get('onboarding').open,false);assert.equal(app.get('capture-plane').disabled,false);
  assert.equal(app.preparations.length,0);assert.equal(app.opened.length,0);
});

test('a failed initial cache check can recover on return without reloading the page',async()=>{
  let checks=0;const app=harness({modelsReady:async()=>{if(++checks===1)throw new Error('Temporary read failure');return true}});await app.tick(150);
  assert.match(app.get('onboarding-feedback').textContent,/Temporary read failure/);
  app.document.hidden=true;await app.emit('visibilitychange');app.document.hidden=false;await app.emit('visibilitychange');await app.tick(150);
  assert.equal(app.modelChecks.length,2);assert.equal(app.get('onboarding').open,false);assert.equal(app.get('capture-plane').disabled,false);
  await app.get('connection').emit('click');assert.equal(app.get('onboarding-feedback').textContent,'');
});

test('an aborted setup cannot keep a restored verified camera stuck in its working state',async()=>{
  const pending=deferred();let checks=0;
  const app=harness({modelsReady:()=>++checks>1,prepare:()=>pending.promise});await app.tick(150);
  await app.get('onboarding-next').emit('click');assert.equal(app.get('onboarding-next').hidden,true);
  await app.emit('pagehide');assert.equal(app.preparations[0].signal.aborted,true);
  await app.emit('pageshow',{persisted:true});await app.tick(150);
  pending.resolve();await app.tick(0);
  assert.equal(app.get('onboarding').open,false);assert.equal(app.get('capture-plane').disabled,false);assert.equal(app.modelChecks.length,2);
  assert.equal(app.requests.some(request=>request.url.startsWith('/capture')),false);
});

async function reviewTap(app,details={}) {
  const target=app.get('photo');
  await app.get('photo-dialog').emit('pointerdown',{target,...details});
  await app.get('photo-dialog').emit('pointerup',{target,...details});
}

test('a double tap cancels working review and disposes a late scene result', async () => {
  const pending=deferred();let disposed=false;
  const app=await connectedCamera({scene:()=>pending.promise});
  await app.get('capture-plane').emit('click');
  await reviewTap(app);await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,false);
  assert.equal(app.sceneCalls[0].signal.aborted,true);
  pending.resolve({dispose(){disposed=true}});await app.tick(150);
  assert.equal(disposed,true);
  assert.equal(app.get('photo-dialog').open,false);
  assert.match(app.images[0].src,/:81\/stream/);
});

test('dragging between taps cannot reset the scene', async () => {
  let disposed=false;
  const app=await connectedCamera({scene:async()=>({dispose(){disposed=true}})});
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
  const app=await connectedCamera({scene:async()=>({dispose(){disposed=true}})});
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
  const app=await connectedCamera({scene:async()=>({dispose(){}})});await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.tick(100);const target=app.get('scene');
  for(const pointerId of [1,2,3])await app.get('photo-dialog').emit('pointerdown',{target,pointerId,isPrimary:pointerId===1});
  for(const pointerId of [3,2,1])await app.get('photo-dialog').emit('pointerup',{target,pointerId,isPrimary:pointerId===1});
  await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);assert.equal(app.sceneCalls[0].signal.aborted,false);
});

test('taps from a closed review cannot reset a newly captured scene', async () => {
  const app=await connectedCamera({scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.get('close-photo').emit('click');
  await app.tick(100);await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);
  assert.equal(app.sceneCalls[1].signal.aborted,false);
});

test('point density changes the next capture while primitive style changes the current scene', async () => {
  const styles=[],app=await connectedCamera({scene:async()=>({dispose(){},setPrimitiveLevel(level){styles.push(level)}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls[0].quality,2);
  assert.equal(styles.at(-1),0);
  app.changeStudio('quality',0);app.changeStudio('primitive',3);
  assert.equal(app.sceneCalls.length,1);
  assert.equal(styles.at(-1),3);
  await app.get('close-photo').emit('click');await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.sceneCalls[1].quality,0);
  assert.equal(styles.at(-1),3);
});

test('a rail gesture clears a pending result tap even when its value is unchanged', async () => {
  const app=await connectedCamera({scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);app.gestureStudio();await app.tick(100);await reviewTap(app);
  assert.equal(app.get('photo-dialog').open,true);
});

test('the click following a result double tap cannot capture another photo', async () => {
  const app=await connectedCamera({scene:async()=>({dispose(){}})});
  await app.get('capture-plane').emit('click');await app.tick(0);
  await reviewTap(app);await app.tick(100);await reviewTap(app);
  await app.get('capture-plane').emit('click');
  assert.equal(app.get('photo-dialog').open,false);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,1);
  await app.tick(401);await app.get('capture-plane').emit('click');await app.tick(0);
  assert.equal(app.requests.filter(request=>request.url.startsWith('/capture')).length,2);
  assert.equal(app.get('photo-dialog').open,true);
});
