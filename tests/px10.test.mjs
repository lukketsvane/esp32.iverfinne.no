import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { WIDTH, PRINTER_NAME, packet, buildPrintJob, PacketDecoder, joinBytes } from '../vendor/print/px10-protocol.mjs';
import { ditherCloudRGBA, cloudPrintJob } from '../vendor/print/cloud-raster.mjs';
import { PX10Printer } from '../vendor/print/printer.mjs';

const UUID = short => `0000${short}-0000-1000-8000-00805f9b34fb`;
const waitFor = async predicate => {
  const until = Date.now() + 1000;
  while (!predicate()) { if (Date.now() > until) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 2)); }
};
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const advance = async (t, milliseconds) => { t.mock.timers.tick(milliseconds); await flush(); };
function fakeBLE({ name = PRINTER_NAME, legacy = false, secondary = false, write = async () => {} } = {}) {
  const writes = [], requested = [], services = [], saved = new Map();
  const notifier = new EventTarget();
  notifier.properties = {}; notifier.startNotifications = async () => notifier;
  notifier.notify = bytes => {
    notifier.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    notifier.dispatchEvent(new Event('characteristicvaluechanged'));
  };
  const writer = new EventTarget(); writer.properties = { writeWithoutResponse: true };
  writer[legacy ? 'writeValue' : 'writeValueWithoutResponse'] = async bytes => {
    await write(bytes, writes.length, notifier); writes.push(bytes.slice());
  };
  const service = { getCharacteristic: async id => {
    assert.ok([UUID('ae01'), UUID('ae02'), UUID('ae3b'), UUID('ae3c')].includes(id));
    return [UUID('ae01'), UUID('ae3b')].includes(id) ? writer : notifier;
  } };
  const device = new EventTarget(); device.id = 'px10-observed'; device.name = name;
  let connections = 0, choices = 0;
  device.gatt = {
    connected: false,
    connect: async () => { connections++; device.gatt.connected = true; return device.gatt; },
    disconnect: () => { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
    getPrimaryService: async id => {
      services.push(id);
      if (secondary && id === UUID('ae30')) throw new Error('No AE30');
      return service;
    }
  };
  let granted = [];
  const bluetooth = {
    getDevices: async () => granted,
    requestDevice: options => { choices++; requested.push(options); granted = [device]; return Promise.resolve(device); }
  };
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  return { bluetooth, device, notifier, writes, requested, services, storage, saved,
    connections: () => connections, choices: () => choices, grant: () => { granted = [device]; } };
}
function printerFor(fake, options = {}) {
  return new PX10Printer({ bluetooth: () => fake.bluetooth, storage: () => fake.storage, delay: 0, retryDelay: 2, ...options });
}

test('complete Tiny/d1 image stream matches TiMini-Print v0.9 reference bytes', () => {
  const pixels = new Uint8Array(gunzipSync(fs.readFileSync(new URL('fixtures/px10-pixels.bin.gz', import.meta.url))));
  const expected = new Uint8Array(gunzipSync(fs.readFileSync(new URL('fixtures/px10-upstream-job.bin.gz', import.meta.url))));
  assert.deepEqual(buildPrintJob(pixels), expected);
  assert.equal(Buffer.from(packet(0xa3, [0])).toString('hex'), '5178a30001000000ff');
});

test('first gesture requests only the observed PX10 and connecting consumes no paper', async t => {
  const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose());
  assert.equal(await printer.start(), false); assert.equal(fake.choices(), 0);
  assert.equal(printer.needsChoice, true);
  const choosing = printer.choose();
  assert.equal(fake.choices(), 1, 'Picker called synchronously, inside user activation');
  assert.equal(await choosing, true); assert.equal(printer.ready, true);
  assert.deepEqual(fake.requested[0], { filters: [{ name: PRINTER_NAME, services: [UUID('af30')] }], exclusionFilters: [{namePrefix: `${PRINTER_NAME} - Clone`}], optionalServices: [UUID('ae30'), UUID('af30'), UUID('ae3a')] });
  assert.equal(fake.writes.length, 0); assert.ok([...fake.saved.values()].includes(fake.device.id));
});

test('already granted PX10 restores across a reload without presenting the chooser again', async t => {
  const fake = fakeBLE(), first = printerFor(fake); await first.choose(); first.dispose();
  const reloaded = printerFor(fake); t.after(() => reloaded.dispose());
  assert.equal(await reloaded.start(), true); assert.equal(reloaded.ready, true);
  assert.equal(fake.choices(), 1); assert.equal(fake.writes.length, 0);
  assert.equal(reloaded.needsChoice, false);
});

test('late Safari-extension injection is detected, and an unrelated clock is never connected', async t => {
  const fake = fakeBLE(); fake.grant(); let api;
  const printer = printerFor(fake, { bluetooth: () => api }); t.after(() => printer.dispose());
  assert.equal(printer.supported, false); assert.equal(await printer.start(), false);
  api = fake.bluetooth; assert.equal(await printer.start(), true); assert.equal(fake.choices(), 0);
  const clock = fakeBLE({ name: 'Clock' }); clock.grant();
  const unknown = printerFor(clock); t.after(() => unknown.dispose());
  assert.equal(await unknown.start(), false); assert.equal(clock.connections(), 0);
  assert.equal(await unknown.choose(), false); assert.equal(clock.writes.length, 0);
});

test('cancelled first-time setup leaves normal camera actions available, without repeated prompts', async t => {
  const fake = fakeBLE(); fake.bluetooth.requestDevice = () => Promise.reject(new DOMException('Cancelled', 'NotFoundError'));
  const printer = printerFor(fake); t.after(() => printer.dispose());
  const states = []; printer.addEventListener('status', e => states.push(e.detail.state));
  assert.equal(await printer.choose(), false); assert.equal(printer.needsChoice, false);
  assert.equal(printer.device, null); assert.equal(states.at(-1), 'cancelled');
});

test('advertisement clones cannot be connected, remembered or used for a print', async t => {
  const fake = fakeBLE({name: `${PRINTER_NAME} - Clone 1`}); fake.grant();
  const printer = printerFor(fake); t.after(() => printer.dispose());
  assert.equal(await printer.start(), false); assert.equal(fake.connections(), 0);
  assert.equal(await printer.choose(), false); assert.equal(printer.needsChoice, true);
  assert.equal(fake.saved.size, 0); assert.equal(printer.enqueue('clone', new Uint8Array(20)), false);
});

test('a stale generic-service grant permits fresh pairing with the PX10 UUIDs', async t => {
  const fake = fakeBLE(); fake.grant();
  const discover = fake.device.gatt.getPrimaryService;
  fake.device.gatt.getPrimaryService = async () => { throw new DOMException('Service was not granted', 'SecurityError'); };
  const printer = printerFor(fake); t.after(() => printer.dispose());
  assert.equal(await printer.start(), false); assert.equal(printer.device, null);
  assert.equal(printer.needsChoice, true); assert.equal(fake.saved.size, 0);
  fake.device.gatt.getPrimaryService = discover;
  assert.equal(await printer.choose(), true); assert.equal(printer.ready, true);
  await printer.send('physical', new Uint8Array(20)); assert.equal(fake.writes.length, 1);
});

test('one result prints automatically, in ordered 20-byte writes, without replaying a retry', async t => {
  const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  const events = []; printer.addEventListener('status', e => events.push(e.detail));
  const bytes = buildPrintJob(new Uint8Array(WIDTH * 4));
  assert.equal(printer.enqueue('capture-1', bytes), true);
  assert.equal(printer.enqueue('capture-1', bytes), false);
  await waitFor(() => events.some(e => e.state === 'sent'));
  assert.deepEqual(joinBytes(fake.writes), bytes); assert.ok(fake.writes.every(chunk => chunk.length <= 20));
  assert.equal(events.at(-1).physicalPrintVerified, false);
  await assert.rejects(printer.send('capture-1', bytes), /alt forsøkt/);
});

test('disconnect reconnects automatically; background/resume adds no device picker', async t => {
  const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  fake.device.gatt.disconnect(); await waitFor(() => printer.ready);
  assert.equal(fake.connections(), 2); assert.equal(fake.choices(), 1);
  printer.suspend(); fake.device.gatt.disconnect();
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(fake.connections(), 2);
  await printer.start(); assert.equal(printer.ready, true); assert.equal(fake.connections(), 3); assert.equal(fake.choices(), 1);
});

test('partial failure never resends that result after reconnecting', async t => {
  let broken = true;
  const fake = fakeBLE({ write: async (_, index) => { if (broken && index === 1) throw new Error('Radio lost'); } });
  const printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  await assert.rejects(printer.send('partial', new Uint8Array(60)), /Radio lost/);
  assert.equal(fake.writes.length, 1); broken = false; await waitFor(() => printer.ready);
  await assert.rejects(printer.send('partial', new Uint8Array(60)), /alt forsøkt/);
  assert.equal(fake.writes.length, 1);
});

test('default writes stay ordered without an artificial delay or overlapping native requests', async t => {
  const times = [];let active=0,maxActive=0;
  const fake = fakeBLE({ write: async () => { times.push(Date.now());maxActive=Math.max(maxActive,++active);await Promise.resolve();active--; } });
  const printer = new PX10Printer({ bluetooth: () => fake.bluetooth, storage: () => fake.storage });
  t.after(() => printer.dispose()); await printer.choose();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const bytes = Uint8Array.from({ length: 60 }, (_, i) => i);await printer.send('unpaced', bytes);
  assert.deepEqual(times, [10000, 10000, 10000]);assert.equal(maxActive,1);
  assert.deepEqual(joinBytes(fake.writes), bytes); assert.ok(fake.writes.every(chunk => chunk.length === 20));
});

test('reported native write limits and MTU use larger ordered chunks without truncating the job',async t=>{
  for(const metadata of [{getWriteLimits:async()=>({withoutResponse:182}),getMtu:async()=>{throw new Error('Limit takes priority')}},{getMtu:async()=>185},{getWriteLimits:async()=>({mtu:185})}]){
    const fake=fakeBLE();Object.assign(fake.device.gatt,metadata);const printer=printerFor(fake);t.after(()=>printer.dispose());assert.equal(await printer.choose(),true);const bytes=Uint8Array.from({length:400},(_,i)=>i);await printer.send('large',bytes);assert.deepEqual(fake.writes.map(chunk=>chunk.length),[182,182,36]);assert.deepEqual(joinBytes(fake.writes),bytes);
  }
});

test('missing, invalid and unsupported limit metadata retain the conservative twenty-byte fallback',async t=>{
  const cases=[{},...[-1,0,NaN,Infinity,20.5,'182',null].map(withoutResponse=>({getWriteLimits:async()=>({withoutResponse})})),...[-1,0,3,185.5,'185',null].map(mtu=>({getMtu:async()=>mtu})),{getWriteLimits:async()=>{throw new DOMException('Not implemented','NotSupportedError')}}];
  for(const metadata of cases){const fake=fakeBLE();Object.assign(fake.device.gatt,metadata);const printer=printerFor(fake);t.after(()=>printer.dispose());assert.equal(await printer.choose(),true);await printer.send('safe',new Uint8Array(45));assert.deepEqual(fake.writes.map(chunk=>chunk.length),[20,20,5])}
});

test('native write sizes are capped at 512 bytes and custom fallback sizes remain available',async t=>{
  for(const [metadata,options,lengths]of [[{getWriteLimits:async()=>({withoutResponse:8192})},{},[512,512,76]],[{getMtu:async()=>8195},{},[512,512,76]],[{},{chunkSize:17},[17,17,6]]]){
    const fake=fakeBLE();Object.assign(fake.device.gatt,metadata);const printer=printerFor(fake,options);t.after(()=>printer.dispose());await printer.choose();const bytes=Uint8Array.from({length:options.chunkSize?40:1100},(_,i)=>i);await printer.send('bounded',bytes);assert.deepEqual(fake.writes.map(chunk=>chunk.length),lengths);assert.deepEqual(joinBytes(fake.writes),bytes);
  }
});

test('disconnect discards a previously negotiated size before reconnecting without metadata',async t=>{
  const fake=fakeBLE();fake.device.gatt.getWriteLimits=async()=>({withoutResponse:182});const printer=printerFor(fake);t.after(()=>printer.dispose());await printer.choose();await printer.send('first',new Uint8Array(200));assert.deepEqual(fake.writes.map(chunk=>chunk.length),[182,18]);printer.suspend();delete fake.device.gatt.getWriteLimits;fake.device.gatt.disconnect();assert.equal(await printer.start(),true);const before=fake.writes.length;await printer.send('second',new Uint8Array(45));assert.deepEqual(fake.writes.slice(before).map(chunk=>chunk.length),[20,20,5]);
});

test('metadata rejection recovers automatically before discovery without losing the reported size',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  for(const method of ['getWriteLimits','getMtu']){
    const fake=fakeBLE();let calls=0;fake.device.gatt[method]=async()=>{if(++calls===1)throw {code:'RATE_LIMIT_EXCEEDED'};return method==='getMtu'?185:{withoutResponse:182}};const printer=printerFor(fake);t.after(()=>printer.dispose());const choosing=printer.choose();await flush();assert.equal(calls,1);assert.deepEqual(fake.services,[]);await advance(t,250);assert.equal(await choosing,true);assert.equal(calls,2);assert.equal(printer.writeSize,182);assert.equal(fake.connections(),1);assert.equal(fake.choices(),1);assert.equal(printer.lastError,'');
  }
});

test('a pending metadata request falls back after one second and cannot change an active channel later',async t=>{
  let release,queried=false;const fake=fakeBLE();fake.device.gatt.getWriteLimits=()=>{queried=true;return new Promise(resolve=>{release=resolve})};const printer=printerFor(fake);t.after(()=>printer.dispose());t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const choosing=printer.choose();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(queried,true);assert.equal(printer.ready,false);t.mock.timers.tick(999);await Promise.resolve();assert.equal(printer.ready,false);t.mock.timers.tick(1);assert.equal(await choosing,true);release({withoutResponse:182});for(let i=0;i<10;i++)await Promise.resolve();await printer.send('fallback',new Uint8Array(45));assert.deepEqual(fake.writes.map(chunk=>chunk.length),[20,20,5]);
});

test('a fragmented pause received mid-job still stops immediate writes until the printer resumes',async t=>{
  const fake=fakeBLE({write:async(_,index,notifier)=>{if(index===0){const pause=packet(0xae,[0x10]);pause[3]=1;notifier.notify(pause.slice(0,4));notifier.notify(pause.slice(4))}}}),printer=printerFor(fake);t.after(()=>printer.dispose());await printer.choose();t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const bytes=Uint8Array.from({length:60},(_,i)=>i),sending=printer.send('pause-midway',bytes);for(let i=0;i<20;i++)await Promise.resolve();assert.equal(printer.paused,true);assert.equal(fake.writes.length,1);t.mock.timers.tick(20);for(let i=0;i<10;i++)await Promise.resolve();assert.equal(fake.writes.length,1);const resume=packet(0xae,[0]);resume[3]=1;fake.notifier.notify(resume);t.mock.timers.tick(20);await sending;assert.deepEqual(fake.writes.map(chunk=>chunk.length),[20,20,20]);assert.deepEqual(joinBytes(fake.writes),bytes);
});

test('discovery rejection retries the same service without switching channels or reconnecting', async t => {
  const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose());
  const discover = fake.device.gatt.getPrimaryService, events = [];
  printer.addEventListener('status', event => events.push(event.detail));
  let calls = 0;
  fake.device.gatt.getPrimaryService = async id => {
    if (++calls === 1) { fake.services.push(id); throw Object.assign(new Error('Too many BLE requests'), { code: 'RATE_LIMIT' }); }
    return discover(id);
  };
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const choosing = printer.choose(); await flush(); assert.equal(calls, 1);
  await advance(t, 249); assert.equal(calls, 1); await advance(t, 1);
  assert.equal(await choosing, true); assert.equal(printer.ready, true); assert.equal(printer.lastError, '');
  assert.deepEqual(fake.services, [UUID('ae30'), UUID('ae30')]); assert.equal(fake.connections(), 1); assert.equal(fake.choices(), 1);
  assert.equal(events.some(event => event.state === 'recovering'), true); assert.equal(events.some(event => /rate.?limit|too many/i.test(event.message || '')), false);
});

test('restore retries automatically while the chooser stays synchronous and is never automatically reopened', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose());
  let restores = 0; fake.bluetooth.getDevices = async () => { if (++restores === 1) throw {code:'RATE_LIMIT_EXCEEDED'}; return [fake.device]; };
  const restoring = printer.start(); await flush(); assert.equal(restores, 1);
  await advance(t, 250); assert.equal(await restoring, true); assert.equal(restores, 2); assert.equal(fake.choices(), 0);
  const firstTime = fakeBLE(), chooser = printerFor(firstTime); t.after(() => chooser.dispose());
  let choices = 0; firstTime.bluetooth.requestDevice = () => { choices++; return Promise.reject(new Error('Too many BLE requests')); };
  const choosing = chooser.choose(); assert.equal(choices, 1); assert.equal(await choosing, false);
  assert.equal(chooser.lastError, 'Nådde ikkje skrivaren. Prøv igjen.'); await advance(t, 120000); assert.equal(choices, 1);
});

test('rejected writes back off at the same byte offset and never replay accepted data or overlap requests', async t => {
  let failures = 2, active = 0, maxActive = 0;
  const requested = [];
  const fake = fakeBLE({ write: async (_, index) => {
    requested.push(index); maxActive = Math.max(maxActive, ++active);
    await Promise.resolve(); active--;
    if (index === 1 && failures-- > 0) throw new Error('Rate limit exceeded — too many BLE requests');
  } });
  const printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  const events = []; printer.addEventListener('status', event => events.push(event.detail));
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const bytes = Uint8Array.from({length:60}, (_,i) => i), sending = printer.send('recover', bytes);
  await flush(); assert.deepEqual(requested, [0,1]); assert.equal(printer.busy, true);
  await advance(t, 250); assert.deepEqual(requested, [0,1,1]);
  await advance(t, 499); assert.equal(requested.length, 3); await advance(t, 1); await sending;
  assert.deepEqual(requested, [0,1,1,1,2]); assert.deepEqual(joinBytes(fake.writes), bytes); assert.equal(maxActive, 1);
  assert.equal(fake.connections(), 1); assert.equal(fake.choices(), 1); assert.equal(events.at(-1).state, 'sent');
  assert.equal(events.some(event => /rate.?limit|too many|eitt minutt/i.test(event.message || '')), false);
  await assert.rejects(printer.send('recover', bytes), /alt forsøkt/);
});

test('persistent rejection has bounded attempts, a short final error and no queued replay', async t => {
  let requests = 0;
  const fake = fakeBLE({write:async()=>{requests++;throw {code:'RATE_LIMIT'}}}), printer = printerFor(fake);
  t.after(() => printer.dispose()); await printer.choose();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const sending = printer.send('exhausted', new Uint8Array(60)), failed = assert.rejects(sending,/^Error: Nådde ikkje skrivaren\. Prøv igjen\.$/);
  assert.equal(printer.enqueue('waiting', new Uint8Array(20)), true); await flush();
  for (const delay of [250,500,1000,2000,4000,8000,16000,30000]) await advance(t,delay);
  await failed; assert.equal(requests,9); assert.equal(printer.active,false); assert.equal(printer.queue.length,0); assert.equal(printer.retryTimer,null);
  await advance(t,120000); assert.equal(requests,9); assert.equal(fake.connections(),1); assert.equal(fake.writes.length,0);
  await printer.start(); await assert.rejects(printer.send('exhausted',new Uint8Array(60)),/alt forsøkt/);assert.equal(requests,9);
});

test('old persisted cooldown is ignored and disposal cancels pending recovery without another request', async t => {
  const fake=fakeBLE();fake.saved.set('entropi.px10.cooldown.v1',String(Date.now()+60000));
  const printer=printerFor(fake);t.after(()=>printer.dispose());assert.equal(await printer.choose(),true);
  let requests=0;fake.device.gatt.connect=async()=>{requests++;throw new Error('Too many BLE requests')};
  printer.suspend();fake.device.gatt.disconnect();
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const starting=printer.start();await flush();assert.equal(requests,1);printer.dispose();await advance(t,250);
  assert.equal(await starting,false);assert.equal(requests,1);assert.equal(printer.retryTimer,null);assert.equal(fake.choices(),1);
});

test('connection, characteristic and notification setup recover only the rejected operation', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  for(const phase of ['connect','characteristic','notifications']){
    const fake=fakeBLE();let calls=0,rejected=false;
    const limited=operation=>function(...args){calls++;if(!rejected){rejected=true;return Promise.reject({code:'RATE_LIMIT'})}return operation.apply(this,args)};
    if(phase==='connect')fake.device.gatt.connect=limited(fake.device.gatt.connect);
    else if(phase==='notifications')fake.notifier.startNotifications=limited(fake.notifier.startNotifications);
    else{const discover=fake.device.gatt.getPrimaryService;fake.device.gatt.getPrimaryService=async id=>{const service=await discover(id);service.getCharacteristic=limited(service.getCharacteristic);return service}}
    const printer=printerFor(fake);t.after(()=>printer.dispose());const choosing=printer.choose();await flush();assert.equal(calls,1);assert.equal(printer.ready,false);
    await advance(t,250);assert.equal(await choosing,true);assert.equal(calls,phase==='characteristic'?3:2);assert.equal(fake.connections(),1);assert.equal(fake.choices(),1);assert.equal(fake.writes.length,0);
  }
});

test('a stale pause probes twenty unsent bytes, settles, then restores fast negotiated writes', async t => {
  const fake=fakeBLE();fake.device.gatt.getWriteLimits=async()=>({withoutResponse:182});
  const printer=printerFor(fake);t.after(()=>printer.dispose());await printer.choose();
  const pause=packet(0xae,[0x10]);pause[3]=1;fake.notifier.notify(pause);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const bytes=Uint8Array.from({length:400},(_,i)=>i),sending=printer.send('probe',bytes);
  await advance(t,4999);assert.equal(fake.writes.length,0);await advance(t,21);
  assert.deepEqual(fake.writes.map(chunk=>chunk.length),[20]);assert.equal(printer.busy,true);
  await advance(t,99);assert.equal(fake.writes.length,1);await advance(t,1);await sending;
  assert.deepEqual(fake.writes.map(chunk=>chunk.length),[20,182,182,16]);assert.deepEqual(joinBytes(fake.writes),bytes);
  assert.equal(fake.connections(),1);assert.equal(fake.choices(),1);
});

test('fresh printer pauses are respected after probes and three unsuccessful probes end the job', async t => {
  const pause=packet(0xae,[0x10]);pause[3]=1;
  const fake=fakeBLE({write:async(_,__,notifier)=>notifier.notify(pause)}),printer=printerFor(fake);
  t.after(()=>printer.dispose());await printer.choose();fake.notifier.notify(pause);
  const states=[];printer.addEventListener('status',event=>states.push(event.detail.state));
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const bytes=Uint8Array.from({length:100},(_,i)=>i),sending=printer.send('stuck',bytes),failed=assert.rejects(sending,/Nådde ikkje skrivaren/);
  assert.equal(printer.enqueue('waiting',new Uint8Array(20)),true);
  for(let i=1;i<=3;i++){await advance(t,5000);assert.equal(fake.writes.length,i);assert.equal(printer.paused,true);await advance(t,100);assert.equal(fake.writes.length,i)}
  await advance(t,5000);await failed;assert.deepEqual(joinBytes(fake.writes),bytes.slice(0,60));
  assert.equal(printer.active,false);assert.equal(printer.queue.length,0);assert.equal(printer.retryTimer,null);assert.equal(states.includes('sent'),false);
  await advance(t,120000);assert.equal(fake.writes.length,3);assert.equal(fake.connections(),1);
});

test('disposal during probe settling cannot write the rest of the job', async t => {
  const fake=fakeBLE(),printer=printerFor(fake);t.after(()=>printer.dispose());await printer.choose();
  const pause=packet(0xae,[0x10]);pause[3]=1;fake.notifier.notify(pause);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const sending=printer.send('dispose-probe',new Uint8Array(60)),failed=assert.rejects(sending,/broten/);
  await advance(t,5000);assert.equal(fake.writes.length,1);printer.dispose();await advance(t,100);await failed;
  assert.equal(fake.writes.length,1);assert.equal(fake.connections(),1);assert.equal(printer.retryTimer,null);
});

test('a pending write survives twenty seconds in the background without duplicate requests', async t => {
  let release;
  const requests = [], fake = fakeBLE({ write: async (bytes, index) => {
    requests.push(bytes.slice());
    if (index === 0) await new Promise(resolve => { release = resolve; });
  } });
  const printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  const states = []; printer.addEventListener('status', event => states.push(event.detail.state));
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const bytes = Uint8Array.from({ length: 60 }, (_, i) => i), sending = printer.send('background', bytes);
  assert.equal(printer.busy, true); assert.equal(requests.length, 1);
  t.mock.timers.tick(20000); await Promise.resolve();
  assert.equal(await printer.start(), true); assert.equal(printer.busy, true);
  assert.equal(requests.length, 1); assert.equal(fake.writes.length, 0); assert.equal(states.includes('failed'), false);
  release(); await sending;
  assert.equal(printer.busy, false); assert.deepEqual(joinBytes(requests), bytes); assert.deepEqual(joinBytes(fake.writes), bytes);
  assert.deepEqual(requests.map(chunk => chunk.length), [20, 20, 20]);
  assert.equal(fake.connections(), 1); assert.equal(fake.choices(), 1); assert.equal(states.filter(state => state === 'sent').length, 1);
});

test('the default forty-second write timeout cannot succeed late or replay the job', async t => {
  let release, requests = 0;
  const fake = fakeBLE({ write: () => { requests++; return new Promise(resolve => { release = resolve; }); } });
  const printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  const states = []; printer.addEventListener('status', event => states.push(event.detail.state));
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const sending = printer.send('default-timeout', new Uint8Array(60)), failed = assert.rejects(sending, /svarte ikkje/);
  t.mock.timers.tick(39999); await Promise.resolve();
  assert.equal(printer.busy, true); assert.equal(requests, 1); assert.equal(states.includes('failed'), false);
  t.mock.timers.tick(1); await failed;
  assert.equal(printer.busy, false); assert.equal(printer.ready, false); assert.equal(states.filter(state => state === 'failed').length, 1);
  release(); await printer.start();
  assert.equal(printer.ready, true); assert.equal(fake.writes.length, 1); assert.equal(requests, 1); assert.equal(states.includes('sent'), false);
  await assert.rejects(printer.send('default-timeout', new Uint8Array(60)), /alt forsøkt/);
  assert.equal(requests, 1); assert.equal(fake.connections(), 2); assert.equal(fake.choices(), 1);
});

test('a stale write completion cannot disconnect a newly restored channel', async t => {
  let release, calls=0;
  const fake=fakeBLE({write:async()=>{if(++calls===1)await new Promise(resolve=>{release=resolve})}}),printer=printerFor(fake);
  t.after(()=>printer.dispose());await printer.choose();t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const states=[];printer.addEventListener('status',event=>states.push(event.detail.state));
  const sending=printer.send('old-channel',new Uint8Array(60)),failed=assert.rejects(sending,/broten/);
  fake.device.gatt.disconnect();await advance(t,2);assert.equal(printer.ready,true);assert.equal(fake.connections(),2);
  const version=printer.version,writer=printer.writer;release();await failed;
  assert.equal(printer.ready,true);assert.equal(printer.version,version);assert.equal(printer.writer,writer);assert.equal(printer.retryTimer,null);
  assert.equal(calls,1);assert.equal(states.includes('sent'),false);await advance(t,10000);assert.equal(fake.connections(),2);
  await assert.rejects(printer.send('old-channel',new Uint8Array(60)),/alt forsøkt/);assert.equal(calls,1);
  await printer.send('new-channel',new Uint8Array(20));assert.equal(calls,2);assert.equal(fake.connections(),2);assert.equal(fake.choices(),1);
});

test('an unresolved write is retired, and late completion cannot report a successful print', async t => {
  let release;
  const fake = fakeBLE({ write: () => new Promise(resolve => { release = resolve; }) });
  const printer = printerFor(fake, { writeTimeout: 5 }); t.after(() => printer.dispose());
  await printer.choose(); const states = []; printer.addEventListener('status', e => states.push(e.detail.state));
  await assert.rejects(printer.send('timeout', new Uint8Array(20)), /svarte ikkje/);
  release(); await waitFor(() => printer.ready);
  assert.equal(states.includes('sent'), false);
  await assert.rejects(printer.send('timeout', new Uint8Array(20)), /alt forsøkt/);
});

test('buffer pause/resume is respected and fragmented notifications are decoded', async t => {
  const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  const pause = packet(0xae, [0x10]); pause[3] = 1;
  fake.notifier.notify(pause.slice(0, 4)); fake.notifier.notify(pause.slice(4));
  const sending = printer.send('paused', new Uint8Array(20));
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(fake.writes.length, 0);
  const resume = packet(0xae, [0]); resume[3] = 1; fake.notifier.notify(resume);
  await sending; assert.equal(fake.writes.length, 1);
});

test('invalid notifications cannot pause a print or hide a valid frame that follows',async t=>{
  const fake=fakeBLE(),printer=printerFor(fake);t.after(()=>printer.dispose());await printer.choose();
  const corrupt=packet(0xae,[0x10]);corrupt[3]=1;corrupt[corrupt.length-2]^=1;
  fake.notifier.notify(corrupt);assert.equal(printer.paused,false);
  fake.notifier.notify(packet(0xae,[0x10]));assert.equal(printer.paused,false);
  const valid=packet(0xae,[0x10]);valid[3]=1;fake.notifier.notify(joinBytes([new Uint8Array([0,0x51,0]),valid]));assert.equal(printer.paused,true);
  const resume=packet(0xae,[0]);resume[3]=1;fake.notifier.notify(resume);await printer.send('valid-after-noise',new Uint8Array(20));assert.equal(fake.writes.length,1);
});

test('disposing during flow-control pause stops the job without writing or reconnecting',async t=>{
  const fake=fakeBLE(),printer=printerFor(fake);t.after(()=>printer.dispose());await printer.choose();
  const pause=packet(0xae,[0x10]);pause[3]=1;fake.notifier.notify(pause);
  const states=[];printer.addEventListener('status',event=>states.push(event.detail.state));
  const sending=printer.send('cancelled',new Uint8Array(60));printer.dispose();await assert.rejects(sending,/broten/);
  assert.equal(fake.writes.length,0);assert.equal(states.includes('sent'),false);assert.equal(fake.connections(),1);assert.equal(printer.retryTimer,null);
});

test('disposal during an outstanding write cannot continue the job after that write resolves',async t=>{
  let complete;
  const fake=fakeBLE({write:()=>new Promise(resolve=>{complete=resolve})}),printer=printerFor(fake);t.after(()=>printer.dispose());await printer.choose();
  const states=[];printer.addEventListener('status',event=>states.push(event.detail.state));
  const sending=printer.send('cancelled-write',new Uint8Array(60));await waitFor(()=>!!complete);printer.dispose();complete();
  await assert.rejects(sending,/broten/);assert.equal(fake.writes.length,1);assert.equal(states.includes('sent'),false);assert.equal(printer.queue.length,0);
});

test('offline results queue while hidden, expire without sending, and are bounded', async t => {
  const fake = fakeBLE(), printer = printerFor(fake, { maxJobAge: 2 }); t.after(() => printer.dispose()); await printer.choose();
  printer.suspend();
  for (let i = 0; i < 4; i++) assert.equal(printer.enqueue(`old-${i}`, new Uint8Array(20)), true);
  assert.equal(printer.enqueue('overflow', new Uint8Array(20)), false);
  await new Promise(resolve => setTimeout(resolve, 5)); await printer.start();
  await waitFor(() => printer.queue.length === 0); assert.equal(fake.writes.length, 0);
});

test('legacy writeValue, alternate observed channel and unavailable storage still work', async t => {
  const fake = fakeBLE({ legacy: true, secondary: true });
  const printer = printerFor(fake, { storage: () => { throw new Error('Storage denied'); } }); t.after(() => printer.dispose());
  assert.equal(await printer.choose(), true); await printer.send('fallback', new Uint8Array(20));
  assert.deepEqual(fake.services, [UUID('ae30'), UUID('ae3a')]); assert.equal(fake.writes.length, 1);
});

test('late native connection after disposal is disconnected, without printing or leaking listeners', async () => {
  const fake = fakeBLE(); let release;
  fake.device.gatt.connect = () => new Promise(resolve => { release = () => { fake.device.gatt.connected = true; resolve(fake.device.gatt); }; });
  const printer = printerFor(fake); const choosing = printer.choose();
  await waitFor(() => !!release); printer.dispose(); release();
  assert.equal(await choosing, false); assert.equal(fake.device.gatt.connected, false); assert.equal(fake.writes.length, 0);
});

test('thermal cloud conversion preserves white paper, monochrome points and transparent margins', () => {
  assert.deepEqual([...ditherCloudRGBA(new Uint8ClampedArray([0,0,0,255]), 1, 1)], [0]);
  assert.deepEqual([...ditherCloudRGBA(new Uint8ClampedArray([255,255,255,255]), 1, 1)], [1]);
  assert.deepEqual([...ditherCloudRGBA(new Uint8ClampedArray([255,255,255,0]), 1, 1)], [0]);
  const rgba = new Uint8ClampedArray(WIDTH * 50 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = 255;
  rgba.fill(255, 25 * WIDTH * 4, 26 * WIDTH * 4);
  const job = cloudPrintJob({ width: WIDTH, height: 50, data: rgba });
  const frames = new PacketDecoder().feed(job);
  assert.equal(frames.filter(frame => [0xbf, 0xa2].includes(frame.opcode)).length, 17);
  rgba.fill(0); assert.throws(() => cloudPrintJob({ width: WIDTH, height: 50, data: rgba }), /ingen synlege/);
});

test('Bluetooth failures reach the UI in Nynorsk while the thrown error keeps its detail', async t => {
  const fake = fakeBLE({ write: async () => { throw new DOMException('GATT operation failed for unknown reason.', 'NetworkError'); } });
  const printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  const messages = []; printer.addEventListener('status', e => { if (e.detail.message) messages.push(e.detail.message); });
  await assert.rejects(printer.send('lost', new Uint8Array(20)), /GATT operation failed/);
  assert.equal(messages[0], 'Mista kontakten med skrivaren. Prøv igjen.');
  assert.ok(messages.every(message => !/GATT|operation/i.test(message)), messages.join(' | '));
  assert.equal(printer.lastError, 'Mista kontakten med skrivaren. Prøv igjen.');
});
