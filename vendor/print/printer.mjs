import { PRINTER_NAME, PacketDecoder } from './px10-protocol.mjs';

const UUID = short => `0000${short}-0000-1000-8000-00805f9b34fb`;
const STORAGE_KEY = 'entropi.px10.device.v1';
const COOLDOWN_KEY = 'entropi.px10.cooldown.v1';
const QUOTA_MESSAGE = 'Vent eitt minutt før nytt forsøk.';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const messageOf = error => typeof error?.message === 'string' ? error.message : String(error);
const isQuota = error => ['RATE_LIMIT', 'RATE_LIMIT_EXCEEDED'].includes(error?.code) || /rate.?limit|too many BLE requests/i.test(messageOf(error));

async function bounded(promise, milliseconds, message) {
   let timer;
  try {
     const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return await Promise.race([promise, timeout]);
  } finally { clearTimeout(timer); }
}

export class PX10Printer extends EventTarget {

  constructor({ bluetooth = () => globalThis.navigator?.bluetooth,
    storage = () => globalThis.localStorage, chunkSize = 20, delay = 50,
    connectionTimeout = 25000, writeTimeout = 10000, pauseTimeout = 45000,
    retryDelay = 1000, maxJobAge = 90000 } = {}) {
    super();
    this.bluetooth = bluetooth;
    this.storage = storage;
    this.chunkSize = chunkSize;
    this.delay = delay;
    this.connectionTimeout = connectionTimeout;
    this.writeTimeout = writeTimeout;
    this.pauseTimeout = pauseTimeout;
    this.retryDelay = retryDelay;
    this.maxJobAge = maxJobAge;
     this.device = null;
     this.writer = null;
     this.notifier = null;
    this.active = false; this.disposed = false; this.busy = false;
    this.choiceDismissed = false; this.choosing = false;
    this.paused = false; this.version = 0; this.failures = 0;
    this.cooldownUntil = 0; this.lastError = '';
    try { this.cooldownUntil = Number(this.storage()?.getItem(COOLDOWN_KEY)) || 0; } catch {}
    if (this.coolingDown) this.lastError = QUOTA_MESSAGE;
     this.connecting = null;
     this.restoring = null;
     this.retryTimer = null;
     this.queue = [];
     this.seen = new Set();
     this.attempted = new Set();
    this.decoder = new PacketDecoder();
    this.onDisconnect = () => {
      this.version++; this.clearChannel();
      if (this.active) { this.emit('reconnecting'); this.scheduleReconnect(); }
    };

    this.onNotification = event => {
      const value = event.target.value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      for (const frame of this.decoder.feed(bytes)) {
        if (frame.opcode === 0xae && frame.flags === 1 && frame.payload.length === 1) {
          if (frame.payload[0] === 0x10) this.paused = true;
          else if (frame.payload[0] === 0) this.paused = false;
        }
      }
    };
  }

  get supported() { return typeof this.bluetooth()?.requestDevice === 'function'; }
  get ready() { return !!this.writer && !!this.device?.gatt?.connected; }
  get coolingDown() { return Date.now() < this.cooldownUntil; }
  get needsChoice() {
    return this.supported && !this.device && !this.choosing && !this.choiceDismissed && !this.disposed;
  }

  emit(state, detail = {}) {
    if (state === 'failed' && detail.message) this.lastError = detail.message;
    if (state === 'connected') this.lastError = '';
    if (!this.disposed) this.dispatchEvent(new CustomEvent('status', { detail: { state, ...detail } }));
  }
  quota(error, detail = {}) {
    if (!isQuota(error)) return false;
    if (this.coolingDown) return true;
    this.cooldownUntil = Date.now() + 60000;
    try { this.storage()?.setItem(COOLDOWN_KEY, String(this.cooldownUntil)); } catch {}
    this.suspend(); this.queue.length = 0; this.version++; this.clearChannel();
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.emit('failed', { ...detail, message: QUOTA_MESSAGE });
    return true;
  }
  savedId() { try { return this.storage()?.getItem(STORAGE_KEY) || ''; } catch { return ''; } }

  remember(device) {
    try { if (device.id) this.storage()?.setItem(STORAGE_KEY, device.id); } catch {  }
  }
  clearChannel() {
    this.notifier?.removeEventListener('characteristicvaluechanged', this.onNotification);
    this.writer = null; this.notifier = null; this.paused = false;
    this.decoder = new PacketDecoder();
  }

  attach(device) {
    if (device.name !== PRINTER_NAME || !device.gatt) throw new Error('Vel den fysiske Luxorp.PX10-DAAF, ikkje ein Clone.');
    if (this.device === device) return;
    this.release();
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.onDisconnect);
  }
  release() {
    this.version++; this.clearChannel();
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
      if (this.device.gatt?.connected) this.device.gatt.disconnect();
    }
    this.device = null;
  }

  start() {
    if (this.disposed || this.coolingDown) return Promise.resolve(false);
    this.active = true;
    if (this.device) return this.link().then(() => { void this.drain(); return true; }).catch(() => false);
    if (this.restoring) return this.restoring;
    const bluetooth = this.bluetooth();
    const getDevices = bluetooth?.getDevices?.bind(bluetooth);
    if (typeof getDevices !== 'function') return Promise.resolve(false);
    this.restoring = (async () => {
      try {
        const devices = await bounded(getDevices(), 5000, 'Kunne ikkje hente skrivaren.');
        if (this.disposed || this.choosing || this.device) return false;
        const remembered = this.savedId();
        const device = devices.find(device => device.id === remembered && device.name === PRINTER_NAME)
          || devices.find(device => device.name === PRINTER_NAME);
        if (!device) return false;
        this.attach(device);
        if (this.active) await this.link();
        void this.drain(); return true;
      } catch (error) { this.quota(error); return false; }
      finally { this.restoring = null; }
    })();
    return this.restoring;
  }

  choose() {
    const bluetooth = this.bluetooth();
    if (this.disposed || this.coolingDown || typeof bluetooth?.requestDevice !== 'function' || this.choosing) return Promise.resolve(false);
    if (this.device) return this.start();
    this.active = true; this.choosing = true; this.choiceDismissed = false;
    this.emit('choosing');
    let request;
    try {
      request = bluetooth.requestDevice({
        filters: [{ name: PRINTER_NAME, services: [UUID('af30')] }],
        exclusionFilters: [{ namePrefix: `${PRINTER_NAME} - Clone` }],
        optionalServices: [UUID('ae30'), UUID('af30'), UUID('ae3a')]
      });
    } catch (error) { request = Promise.reject(error); }
    return (async () => {
      try {
        const device = await request;
        if (this.disposed) return false;
        this.attach(device); await this.link(); void this.drain(); return true;
      } catch (error) {
        if (this.quota(error)) return false;
        const cancelled = error instanceof Error && ['NotFoundError', 'AbortError'].includes(error.name);
        if (!this.device) this.choiceDismissed = cancelled;
        this.emit(cancelled ? 'cancelled' : 'failed', { message: messageOf(error) });
        return false;
      } finally { this.choosing = false; }
    })();
  }

  link() {
    if (this.disposed || this.coolingDown || !this.active || !this.device) return Promise.resolve(false);
    if (this.ready) return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    clearTimeout(this.retryTimer ?? undefined); this.retryTimer = null;
    const device = this.device, version = ++this.version;
    this.clearChannel(); this.emit('connecting');
    const current = () => !this.disposed && version === this.version && device === this.device;
    const task = (async () => {
      try {
        const pending = device.gatt.connect().then(server => {
          if (this.disposed && device.gatt.connected) device.gatt.disconnect();
          return server;
        });
        const server = await bounded(pending, this.connectionTimeout, 'PX10 svarte ikkje.');
        if (!current()) throw new Error('Tilkoplinga vart avbroten.');
        const channels = await bounded((async () => {
          let service, writeID = 'ae01', notifyID = 'ae02';
          try { service = await server.getPrimaryService(UUID('ae30')); }
          catch (error) { if (isQuota(error)) throw error; service = await server.getPrimaryService(UUID('ae3a')); writeID = 'ae3b'; notifyID = 'ae3c'; }
          return { writer: await service.getCharacteristic(UUID(writeID)), notifier: await service.getCharacteristic(UUID(notifyID)) };
        })(), 10000, 'PX10 svarte ikkje under tilkoplinga.');
        const { writer, notifier } = channels;
        if (!current()) throw new Error('Tilkoplinga vart avbroten.');
        if (!writer.properties?.writeWithoutResponse) throw new Error('PX10 manglar skrivekanalen.');
        this.notifier = notifier;
        notifier.addEventListener('characteristicvaluechanged', this.onNotification);
        await bounded(notifier.startNotifications(), 10000, 'PX10 svarte ikkje.');
        if (!current()) throw new Error('Tilkoplinga vart avbroten.');
        this.writer = writer; this.failures = 0; this.remember(device); this.emit('connected');
        return true;
      } catch (error) {
        if (current() && !this.quota(error)) {
          this.version++; this.clearChannel(); this.failures++;
          if (device.gatt.connected) device.gatt.disconnect();
          const missingGrant = error instanceof Error && ['NotAllowedError', 'SecurityError', 'NotFoundError'].includes(error.name);
          if (missingGrant) { this.release(); this.choiceDismissed = false; }
          this.emit(missingGrant ? 'failed' : 'reconnecting', { message: messageOf(error) });
        }
        throw error;
      }
    })();
    this.connecting = task;
    void task.finally(() => {
      if (this.connecting === task) this.connecting = null;
      if (!this.ready) this.scheduleReconnect();
    }).catch(() => {});
    return task;
  }

  scheduleReconnect() {
    if (this.disposed || !this.active || !this.device || this.ready || this.retryTimer) return;
    const wait = Math.min(20000, this.retryDelay * 2 ** Math.min(this.failures, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.link().then(() => this.drain()).catch(() => {});
    }, wait);
  }
  suspend() { this.active = false; clearTimeout(this.retryTimer ?? undefined); this.retryTimer = null; }

  enqueue(id, bytes) {
    if (this.disposed || this.coolingDown || !this.device || this.seen.has(id) || this.queue.length >= 4) return false;
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Utskriftsdata manglar.');
    this.seen.add(id); this.queue.push({ id, bytes: bytes.slice(), created: Date.now() });
    void this.drain(); return true;
  }
  async drain() {
    if (this.busy || this.disposed || !this.active || !this.queue.length) return;
    if (!this.ready) {
      try { if (!await this.link()) return; } catch { return; }
      if (this.busy || this.disposed || !this.active || !this.ready) return;
    }
    const job = this.queue.shift();
    if (!job) return;
    if (Date.now() - job.created > this.maxJobAge) {
      this.emit('failed', { message: 'Utskrifta er for gammal.' });
      void this.drain(); return;
    }
    try { await this.send(job.id, job.bytes); } catch {  }
    void this.drain();
  }

  async send(id, bytes) {
    if (this.coolingDown) throw new Error(this.lastError);
    if (this.disposed || this.busy || !this.ready || !this.writer) throw new Error('PX10 er ikkje klar.');
    if (this.attempted.has(id)) throw new Error('Biletet er alt forsøkt sendt.');
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Utskriftsdata manglar.');
    this.busy = true; this.attempted.add(id);
    const version = this.version, writer = this.writer;
    let sent = 0; this.emit('sending', { progress: 0 });
    try {
      for (let offset = 0; offset < bytes.length; offset += this.chunkSize) {
        const pausedAt = Date.now();
        while (this.paused) {
          if (this.disposed || !this.ready || version !== this.version) throw new Error('Tilkoplinga vart broten.');
          if (Date.now() - pausedAt > this.pauseTimeout) throw new Error('PX10 har stoppa.');
          await sleep(20);
        }
        if (this.disposed || !this.ready || version !== this.version) throw new Error('Tilkoplinga vart broten.');
        const chunk = bytes.slice(offset, offset + this.chunkSize);
        const method = writer.writeValueWithoutResponse || writer.writeValue;
        if (typeof method !== 'function') throw new Error('Skrivekanalen manglar.');
        await bounded(method.call(writer, chunk), this.writeTimeout, 'PX10 svarte ikkje under sendinga.');
        if (this.disposed || !this.ready || version !== this.version) throw new Error('Tilkoplinga vart broten.');
        sent += chunk.length;
        this.emit('sending', { progress: sent / bytes.length });
        if (offset + this.chunkSize < bytes.length) await sleep(this.delay);
      }
      this.emit('sent', { bytes: sent, physicalPrintVerified: false });
      return { bytes: sent, physicalPrintVerified: false };
    } catch (error) {
      if (this.quota(error, { bytes: sent })) throw error;
      this.emit('failed', { message: messageOf(error), bytes: sent });
      this.version++; this.clearChannel();
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
      this.scheduleReconnect(); throw error;
    } finally { this.busy = false; }
  }

  dispose() {
    this.disposed = true; this.suspend(); this.queue.length = 0; this.release();
  }
}
