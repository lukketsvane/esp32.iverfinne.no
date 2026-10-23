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

test('default writes remain ordered and at least 50 milliseconds apart', async t => {
  const times = [], fake = fakeBLE({ write: async () => { times.push(Date.now()); } });
  const printer = new PX10Printer({ bluetooth: () => fake.bluetooth, storage: () => fake.storage });
  t.after(() => printer.dispose()); await printer.choose();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const bytes = Uint8Array.from({ length: 60 }, (_, i) => i), sending = printer.send('paced', bytes);
  await flush(); assert.deepEqual(times, [10000]);
  t.mock.timers.tick(49); await flush(); assert.equal(times.length, 1);
  t.mock.timers.tick(1); await flush(); assert.deepEqual(times, [10000, 10050]);
  t.mock.timers.tick(50); await sending;
  assert.deepEqual(times, [10000, 10050, 10100]);
  assert.deepEqual(joinBytes(fake.writes), bytes); assert.ok(fake.writes.every(chunk => chunk.length === 20));
});

test('discovery quota stops alternate discovery and all connection requests until explicit retry after a minute', async t => {
  const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose());
  const discover = fake.device.gatt.getPrimaryService, events = [];
  printer.addEventListener('status', event => events.push(event.detail));
  fake.device.gatt.getPrimaryService = async id => {
    fake.services.push(id); throw Object.assign(new Error('Native quota'), { code: 'RATE_LIMIT' });
  };
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  assert.equal(await printer.choose(), false);
  assert.deepEqual(fake.services, [UUID('ae30')]); assert.equal(fake.connections(), 1);
  assert.equal(printer.lastError, 'Vent eitt minutt før nytt forsøk.');
  assert.equal(events.at(-1).state, 'failed'); assert.equal(events.filter(event => event.state === 'failed').length, 1);
  assert.equal(printer.active, false); assert.equal(printer.retryTimer, null);
  t.mock.timers.tick(59999);
  assert.equal(await printer.start(), false); assert.equal(await printer.choose(), false); assert.equal(await printer.link(), false);
  assert.equal(fake.connections(), 1); assert.equal(fake.choices(), 1);
  fake.device.gatt.getPrimaryService = discover;
  t.mock.timers.tick(1); await Promise.resolve(); assert.equal(fake.connections(), 1);
  assert.equal(await printer.start(), true); assert.equal(printer.ready, true); assert.equal(printer.lastError, '');
  assert.equal(fake.connections(), 2); assert.equal(fake.writes.length, 0);
});

test('restore and chooser quotas are exposed without repeated native requests', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  for (const [method, error] of [
    ['getDevices', { code: 'RATE_LIMIT_EXCEEDED', message: 'Native quota' }],
    ['requestDevice', new Error('Too many BLE requests')]
  ]) {
    const fake = fakeBLE(), printer = printerFor(fake); t.after(() => printer.dispose());
    let calls = 0; fake.bluetooth[method] = () => { calls++; return Promise.reject(error); };
    assert.equal(await printer[method === 'getDevices' ? 'start' : 'choose'](), false);
    assert.equal(printer.lastError, 'Vent eitt minutt før nytt forsøk.');
    assert.equal(await printer.start(), false); assert.equal(await printer.choose(), false);
    t.mock.timers.tick(60000); await Promise.resolve();
    assert.equal(calls, 1); assert.equal(fake.connections(), 0); assert.equal(printer.retryTimer, null);
  }
});

test('partial write quota clears queued jobs, blocks retries and never replays after cooldown', async t => {
  let release, limited = true;
  const fake = fakeBLE({ write: async (_, index) => {
    if (index === 0) await new Promise(resolve => { release = resolve; });
    if (limited && index === 1) throw new Error('Rate limit exceeded — too many BLE requests');
  } });
  const printer = printerFor(fake); t.after(() => printer.dispose()); await printer.choose();
  const events = []; printer.addEventListener('status', event => events.push(event.detail));
  t.mock.timers.enable({ apis: ['Date'], now: 10000 });
  const sending = printer.send('partial-quota', new Uint8Array(60));
  assert.equal(printer.enqueue('queued', new Uint8Array(20)), true); release();
  await assert.rejects(sending, /Rate limit/);
  assert.equal(fake.writes.length, 1); assert.equal(printer.queue.length, 0); assert.equal(printer.retryTimer, null);
  assert.equal(events.at(-1).message, 'Vent eitt minutt før nytt forsøk.'); assert.equal(events.at(-1).bytes, 20);
  assert.equal(events.some(event => event.state === 'sent' || event.state === 'reconnecting'), false);
  assert.equal(printer.enqueue('blocked', new Uint8Array(20)), false);
  assert.equal(await printer.start(), false); assert.equal(await printer.choose(), false); assert.equal(await printer.link(), false);
  await assert.rejects(printer.send('blocked', new Uint8Array(20)), /Vent eitt minutt/);
  assert.equal(fake.connections(), 1); assert.equal(fake.choices(), 1);
  t.mock.timers.tick(60000); await Promise.resolve(); assert.equal(fake.connections(), 1);
  limited = false; assert.equal(await printer.start(), true); assert.equal(printer.lastError, '');
  await assert.rejects(printer.send('partial-quota', new Uint8Array(60)), /alt forsøkt/);
  assert.equal(printer.enqueue('queued', new Uint8Array(20)), false); assert.equal(fake.writes.length, 1);
  await printer.send('fresh', new Uint8Array(20)); assert.equal(fake.writes.length, 2);
});

test('quota cooldown survives helper replacement and storage failure still blocks the current instance', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const fake = fakeBLE(); let requests = 0;
  const getDevices = fake.bluetooth.getDevices;
  fake.bluetooth.getDevices = () => { requests++; return Promise.reject({ code: 'RATE_LIMIT' }); };
  const first = printerFor(fake); assert.equal(await first.start(), false); first.dispose();
  const reloaded = printerFor(fake); t.after(() => reloaded.dispose());
  assert.equal(reloaded.lastError, 'Vent eitt minutt før nytt forsøk.');
  assert.equal(await reloaded.start(), false); assert.equal(await reloaded.choose(), false);
  assert.equal(requests, 1); assert.equal(fake.choices(), 0); assert.equal(fake.connections(), 0);
  t.mock.timers.tick(60000); await Promise.resolve(); assert.equal(requests, 1);
  fake.bluetooth.getDevices = getDevices; fake.grant();
  assert.equal(await reloaded.start(), true); assert.equal(reloaded.lastError, ''); assert.equal(fake.connections(), 1);
  const denied = printerFor(fake, { storage: () => { throw new Error('Storage denied'); } });
  t.after(() => denied.dispose());
  fake.bluetooth.getDevices = () => { requests++; return Promise.reject(new Error('Rate-limit exceeded')); };
  assert.equal(await denied.start(), false); assert.equal(await denied.start(), false); assert.equal(await denied.choose(), false);
  assert.equal(denied.lastError, 'Vent eitt minutt før nytt forsøk.'); assert.equal(requests, 2); assert.equal(fake.choices(), 0);
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
