#include "px10_printer.h"
#include "px10_job.h"
#include <Arduino.h>
#include <esp32-hal-alloc-ble-mem.h>
#include <esp32-hal-bt.h>
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gattc_api.h"
#include "esp_gatt_common_api.h"
#include "esp_heap_caps.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include <sys/socket.h>

namespace {
constexpr char printerName[] = "Luxorp.PX10-DAAF";
constexpr uint16_t appId = 0x50;
constexpr uint16_t noConnection = 0xffff;
constexpr size_t maxJob = 65536;
enum class State { IDLE, QUEUED, SCANNING, CONNECTING, SENDING, RECOVERING, SENT, FAILED };
enum class Phase { IDLE, REGISTER, SCAN_PARAMS, SCANNING, STOP_SCAN, OPEN, MTU, SEARCH, NOTIFY, SUBSCRIBE, READY, WRITE, SETTLE };
enum class Kind { REGISTER, SCAN_PARAMS, SCAN_STARTED, FOUND, SCAN_DONE, SCAN_STOPPED, OPEN, CANCELLED, MTU, SERVICE, SEARCH_DONE, NOTIFY_REGISTERED, SUBSCRIBED, WRITTEN, NOTIFICATION, CONGESTION, QUEUE_FULL, DISCONNECTED, SERVICE_CHANGED };
struct Record {
  char id[33] = {};
  State state = State::IDLE;
  size_t bytes = 0;
  size_t total = 0;
  const char *message = "";
};
struct Event {
  Kind kind;
  int status = 0;
  esp_gatt_if_t interface = ESP_GATT_IF_NONE;
  uint16_t connection = noConnection;
  uint16_t handle = 0;
  uint16_t end = 0;
  uint16_t uuid = 0;
  uint16_t mtu = 23;
  uint16_t length = 0;
  uint8_t address[6] = {};
  esp_ble_addr_type_t addressType = BLE_ADDR_TYPE_PUBLIC;
  bool flag = false;
  uint8_t data[185] = {};
};
SemaphoreHandle_t jobMutex = nullptr;
QueueHandle_t events = nullptr;
TaskHandle_t worker = nullptr;
portMUX_TYPE callbackMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool eventOverflow = false;
volatile bool acceptScan = false;
Record records[8];
int latest = -1;
int active = -1;
char bootId[17] = {};
uint32_t nextSequence = 1;
bool uploading = false;
bool checkPending = false;
bool checking = false;
unsigned cameraChecks = 0;
int64_t cameraCheckCutoff = 0;
uint8_t *jobData = nullptr;
size_t jobLength = 0;
Phase phase = Phase::IDLE;
uint32_t deadline = 0;
uint32_t jobStarted = 0;
esp_gatt_if_t client = ESP_GATT_IF_NONE;
uint16_t connection = noConnection;
uint8_t peer[6] = {};
esp_ble_addr_type_t peerType = BLE_ADDR_TYPE_PUBLIC;
uint16_t primaryStart = 0, primaryEnd = 0, secondaryStart = 0, secondaryEnd = 0;
uint16_t writeHandle = 0, notifyHandle = 0, descriptorHandle = 0;
uint16_t writeSize = 20;
size_t offset = 0;
size_t pendingLength = 0;
bool pendingProbe = false;
bool connected = false;
bool channelReady = false;
bool congested = false;
bool queueFull = false;
bool paused = false;
uint32_t pausedAt = 0;
uint32_t congestedAt = 0;
unsigned probes = 0;
bool initializationFailed = false;
bool scanActive = false;
bool openPending = false;
bool retiringScan = false;
bool retiringOpen = false;
uint16_t retiringConnection = noConnection;
uint32_t retireDeadline = 0;
uint32_t retireQuiet = 0;
Px10FlowControl flow;

const char *stateName(State state) {
  static const char *names[] = {"idle", "queued", "scanning", "connecting", "sending", "recovering", "sent", "failed"};
  return names[static_cast<unsigned>(state)];
}

void lockJob() { xSemaphoreTake(jobMutex, portMAX_DELAY); }
void unlockJob() { xSemaphoreGive(jobMutex); }
bool expired(uint32_t target) { return static_cast<int32_t>(millis() - target) >= 0; }

void queueEvent(const Event &event) {
  if (!events || xQueueSend(events, &event, 0) != pdTRUE) {
    portENTER_CRITICAL(&callbackMux);
    eventOverflow = true;
    portEXIT_CRITICAL(&callbackMux);
  }
}

bool exactName(const uint8_t *data, size_t size) {
  for (size_t at = 0; at < size;) {
    uint8_t length = data[at++];
    if (!length || length > size - at) break;
    if ((data[at] == ESP_BLE_AD_TYPE_NAME_CMPL || data[at] == ESP_BLE_AD_TYPE_NAME_SHORT) &&
        length - 1 == sizeof(printerName) - 1 && !memcmp(data + at + 1, printerName, sizeof(printerName) - 1)) return true;
    at += length;
  }
  return false;
}

void gapCallback(esp_gap_ble_cb_event_t type, esp_ble_gap_cb_param_t *parameter) {
  Event event{};
  switch (type) {
    case ESP_GAP_BLE_SCAN_PARAM_SET_COMPLETE_EVT:
      event.kind = Kind::SCAN_PARAMS;
      event.status = parameter->scan_param_cmpl.status;
      break;
    case ESP_GAP_BLE_SCAN_START_COMPLETE_EVT:
      event.kind = Kind::SCAN_STARTED;
      event.status = parameter->scan_start_cmpl.status;
      break;
    case ESP_GAP_BLE_SCAN_STOP_COMPLETE_EVT:
      event.kind = Kind::SCAN_STOPPED;
      event.status = parameter->scan_stop_cmpl.status;
      break;
    case ESP_GAP_BLE_SCAN_RESULT_EVT: {
      const auto &scan = parameter->scan_rst;
      if (scan.search_evt == ESP_GAP_SEARCH_INQ_CMPL_EVT) {
        event.kind = Kind::SCAN_DONE;
        break;
      }
      if (scan.search_evt != ESP_GAP_SEARCH_INQ_RES_EVT || scan.adv_data_len + scan.scan_rsp_len > sizeof(scan.ble_adv) ||
          (!exactName(scan.ble_adv, scan.adv_data_len) && !exactName(scan.ble_adv + scan.adv_data_len, scan.scan_rsp_len))) return;
      portENTER_CRITICAL(&callbackMux);
      bool take = acceptScan;
      if (take) acceptScan = false;
      portEXIT_CRITICAL(&callbackMux);
      if (!take) return;
      event.kind = Kind::FOUND;
      memcpy(event.address, scan.bda, 6);
      event.addressType = scan.ble_addr_type;
      break;
    }
    default: return;
  }
  queueEvent(event);
}

void gattCallback(esp_gattc_cb_event_t type, esp_gatt_if_t interface, esp_ble_gattc_cb_param_t *parameter) {
  Event event{};
  event.interface = interface;
  switch (type) {
    case ESP_GATTC_REG_EVT:
      if (parameter->reg.app_id != appId) return;
      event.kind = Kind::REGISTER;
      event.status = parameter->reg.status;
      break;
    case ESP_GATTC_OPEN_EVT:
      event.kind = Kind::OPEN;
      event.status = parameter->open.status;
      event.connection = parameter->open.conn_id;
      event.mtu = parameter->open.mtu;
      memcpy(event.address, parameter->open.remote_bda, 6);
      break;
    case ESP_GATTC_CFG_MTU_EVT:
      event.kind = Kind::MTU;
      event.status = parameter->cfg_mtu.status;
      event.connection = parameter->cfg_mtu.conn_id;
      event.mtu = parameter->cfg_mtu.mtu;
      break;
    case ESP_GATTC_CANCEL_OPEN_EVT:
      event.kind = Kind::CANCELLED;
      event.status = parameter->cancel_open.status;
      memcpy(event.address, parameter->cancel_open.remote_bda, 6);
      break;
    case ESP_GATTC_SEARCH_RES_EVT:
      if (parameter->search_res.srvc_id.uuid.len != ESP_UUID_LEN_16 || !parameter->search_res.is_primary) return;
      event.kind = Kind::SERVICE;
      event.connection = parameter->search_res.conn_id;
      event.handle = parameter->search_res.start_handle;
      event.end = parameter->search_res.end_handle;
      event.uuid = parameter->search_res.srvc_id.uuid.uuid.uuid16;
      break;
    case ESP_GATTC_SEARCH_CMPL_EVT:
      event.kind = Kind::SEARCH_DONE;
      event.status = parameter->search_cmpl.status;
      event.connection = parameter->search_cmpl.conn_id;
      break;
    case ESP_GATTC_REG_FOR_NOTIFY_EVT:
      event.kind = Kind::NOTIFY_REGISTERED;
      event.status = parameter->reg_for_notify.status;
      event.handle = parameter->reg_for_notify.handle;
      break;
    case ESP_GATTC_WRITE_DESCR_EVT:
    case ESP_GATTC_WRITE_CHAR_EVT:
      event.kind = type == ESP_GATTC_WRITE_DESCR_EVT ? Kind::SUBSCRIBED : Kind::WRITTEN;
      event.status = parameter->write.status;
      event.connection = parameter->write.conn_id;
      event.handle = parameter->write.handle;
      break;
    case ESP_GATTC_NOTIFY_EVT:
      if (parameter->notify.value_len > sizeof(event.data)) {
        portENTER_CRITICAL(&callbackMux);
        eventOverflow = true;
        portEXIT_CRITICAL(&callbackMux);
        return;
      }
      event.kind = Kind::NOTIFICATION;
      event.connection = parameter->notify.conn_id;
      event.handle = parameter->notify.handle;
      event.length = parameter->notify.value_len;
      memcpy(event.data, parameter->notify.value, event.length);
      break;
    case ESP_GATTC_CONGEST_EVT:
      event.kind = Kind::CONGESTION;
      event.connection = parameter->congest.conn_id;
      event.flag = parameter->congest.congested;
      break;
    case ESP_GATTC_QUEUE_FULL_EVT:
      event.kind = Kind::QUEUE_FULL;
      event.connection = parameter->queue_full.conn_id;
      event.flag = parameter->queue_full.is_full;
      break;
    case ESP_GATTC_DISCONNECT_EVT:
      event.kind = Kind::DISCONNECTED;
      event.connection = parameter->disconnect.conn_id;
      memcpy(event.address, parameter->disconnect.remote_bda, 6);
      event.status = parameter->disconnect.reason;
      break;
    case ESP_GATTC_SRVC_CHG_EVT:
      event.kind = Kind::SERVICE_CHANGED;
      memcpy(event.address, parameter->srvc_chg.remote_bda, 6);
      break;
    default: return;
  }
  queueEvent(event);
}

void updateState(State state, const char *message = "") {
  lockJob();
  if (active >= 0) {
    records[active].state = state;
    records[active].bytes = offset;
    records[active].message = message;
  }
  bool diagnostic = checking;
  unlockJob();
  if (diagnostic) Serial.printf("Printer check: %s %s\n", stateName(state), message);
}

void setPhase(Phase next, uint32_t timeout) {
  phase = next;
  deadline = millis() + timeout;
}

void closeChannel() {
  portENTER_CRITICAL(&callbackMux);
  acceptScan = false;
  portEXIT_CRITICAL(&callbackMux);
  if (scanActive && !retiringScan) {
    retiringScan = true;
    esp_ble_gap_stop_scanning();
    retireDeadline = millis() + 10000;
  }
  if (openPending && !retiringOpen) {
    retiringOpen = true;
    esp_ble_gattc_cancel_open_params_t cancel{};
    cancel.gattc_if = client;
    memcpy(cancel.remote_bda, peer, 6);
    esp_ble_gattc_cancel_open(&cancel);
    esp_ble_gap_disconnect(peer);
    retireDeadline = millis() + 10000;
  }
  if (client != ESP_GATT_IF_NONE && notifyHandle) esp_ble_gattc_unregister_for_notify(client, peer, notifyHandle);
  if (connected) {
    retiringConnection = connection;
    esp_ble_gattc_close(client, connection);
    retireDeadline = millis() + 10000;
  }
  connected = channelReady = false;
  connection = noConnection;
  writeHandle = notifyHandle = descriptorHandle = 0;
  pendingLength = 0;
  congested = queueFull = paused = false;
  flow.reset();
}

void finish(bool success, const char *message = "") {
  if (!success) closeChannel();
  updateState(success ? State::SENT : State::FAILED, message);
  lockJob();
  uint8_t *finished = jobData;
  bool diagnostic = checking;
  jobData = nullptr;
  jobLength = 0;
  active = -1;
  checking = false;
  if (diagnostic) {
    cameraChecks = 3;
    cameraCheckCutoff = esp_timer_get_time();
  }
  unlockJob();
  free(finished);
  phase = Phase::IDLE;
  pendingLength = 0;
  if (diagnostic) Serial.printf("Printer check: %s; no print data sent; BLE=%u connected=%u internal free=%u largest=%u\n", success ? "ready" : "failed", esp_bluedroid_get_status() == ESP_BLUEDROID_STATUS_ENABLED, connected, static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)), static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)));
}

void searchServices() {
  primaryStart = primaryEnd = secondaryStart = secondaryEnd = 0;
  setPhase(Phase::SEARCH, 10000);
  if (esp_ble_gattc_search_service(client, connection, nullptr) != ESP_OK) finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
}

void readyChannel() {
  channelReady = true;
  phase = Phase::READY;
  lockJob();
  bool diagnostic = checking;
  unlockJob();
  if (diagnostic) finish(true);
  else updateState(State::SENDING);
}

void subscribe() {
  esp_bt_uuid_t uuid{};
  uuid.len = ESP_UUID_LEN_16;
  uuid.uuid.uuid16 = ESP_GATT_UUID_CHAR_CLIENT_CONFIG;
  esp_gattc_descr_elem_t descriptor{};
  uint16_t count = 1;
  if (esp_ble_gattc_get_descr_by_char_handle(client, connection, notifyHandle, uuid, &descriptor, &count) != ESP_GATT_OK || !count) {
    finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
    return;
  }
  descriptorHandle = descriptor.handle;
  uint8_t enable[2] = {1, 0};
  setPhase(Phase::SUBSCRIBE, 5000);
  if (esp_ble_gattc_write_char_descr(client, connection, descriptorHandle, sizeof(enable), enable, ESP_GATT_WRITE_TYPE_RSP, ESP_GATT_AUTH_REQ_NONE) != ESP_OK)
    finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
}

bool selectService(uint16_t start, uint16_t end, uint16_t writeUuid, uint16_t notifyUuid) {
  if (!start || !end) return false;
  esp_bt_uuid_t uuid{};
  uuid.len = ESP_UUID_LEN_16;
  uuid.uuid.uuid16 = writeUuid;
  esp_gattc_char_elem_t characteristic{};
  uint16_t count = 1;
  if (esp_ble_gattc_get_char_by_uuid(client, connection, start, end, uuid, &characteristic, &count) != ESP_GATT_OK || !count || !(characteristic.properties & ESP_GATT_CHAR_PROP_BIT_WRITE_NR)) return false;
  uint16_t writer = characteristic.char_handle;
  uuid.uuid.uuid16 = notifyUuid;
  count = 1;
  if (esp_ble_gattc_get_char_by_uuid(client, connection, start, end, uuid, &characteristic, &count) != ESP_GATT_OK || !count || !(characteristic.properties & ESP_GATT_CHAR_PROP_BIT_NOTIFY)) return false;
  writeHandle = writer;
  notifyHandle = characteristic.char_handle;
  return true;
}

void openPrinter() {
  updateState(State::CONNECTING);
  setPhase(Phase::OPEN, 10000);
  openPending = esp_ble_gattc_open(client, peer, peerType, true) == ESP_OK;
  if (!openPending) finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
}

void scanPrinter() {
  updateState(State::SCANNING);
  portENTER_CRITICAL(&callbackMux);
  acceptScan = true;
  portEXIT_CRITICAL(&callbackMux);
  setPhase(Phase::SCANNING, 8000);
  scanActive = esp_ble_gap_start_scanning(6) == ESP_OK;
  if (!scanActive) finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
}

void scanParameters() {
  esp_ble_scan_params_t parameters{};
  parameters.scan_type = BLE_SCAN_TYPE_ACTIVE;
  parameters.own_addr_type = BLE_ADDR_TYPE_PUBLIC;
  parameters.scan_filter_policy = BLE_SCAN_FILTER_ALLOW_ALL;
  parameters.scan_interval = 0x50;
  parameters.scan_window = 0x30;
  parameters.scan_duplicate = BLE_SCAN_DUPLICATE_DISABLE;
  setPhase(Phase::SCAN_PARAMS, 5000);
  if (esp_ble_gap_set_scan_params(&parameters) != ESP_OK) finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
}

void initializeBle() {
  Serial.printf("Printer BLE init: internal free=%u largest=%u\n", static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)), static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)));
  bool good = btStartMode(BT_MODE_BLE);
  if (good && esp_bluedroid_get_status() == ESP_BLUEDROID_STATUS_UNINITIALIZED) good = esp_bluedroid_init() == ESP_OK;
  if (good && esp_bluedroid_get_status() == ESP_BLUEDROID_STATUS_INITIALIZED) good = esp_bluedroid_enable() == ESP_OK;
  if (good) good = esp_ble_gap_register_callback(gapCallback) == ESP_OK && esp_ble_gattc_register_callback(gattCallback) == ESP_OK && esp_ble_gatt_set_local_mtu(185) == ESP_OK;
  setPhase(Phase::REGISTER, 5000);
  if (good) good = esp_ble_gattc_app_register(appId) == ESP_OK;
  Serial.printf("Printer BLE init: %s internal free=%u largest=%u\n", good ? "started" : "failed", static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)), static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)));
  if (!good) {
    initializationFailed = true;
    finish(false, "Start kameraet på nytt.");
  }
}

void beginOperation() {
  offset = pendingLength = 0;
  probes = 0;
  pendingProbe = false;
  jobStarted = millis();
  if (initializationFailed) {
    finish(false, "Start kameraet på nytt.");
  } else if (channelReady && connected) {
    readyChannel();
  } else if (client != ESP_GATT_IF_NONE) {
    scanParameters();
  } else initializeBle();
}

void handleEvent(const Event &event) {
  if ((event.kind == Kind::SCAN_STOPPED || event.kind == Kind::SCAN_DONE) && retiringScan) {
    if (event.kind == Kind::SCAN_DONE || event.status == ESP_BT_STATUS_SUCCESS) {
      retiringScan = scanActive = false;
      retireQuiet = millis() + 100;
    }
    return;
  }
  if ((event.kind == Kind::OPEN || event.kind == Kind::CANCELLED) && retiringOpen && !memcmp(peer, event.address, 6)) {
    if (event.kind == Kind::OPEN || event.status == ESP_GATT_OK) {
      retiringOpen = openPending = false;
      if (event.kind == Kind::OPEN && event.status == ESP_GATT_OK) {
        retiringConnection = event.connection;
        esp_ble_gattc_close(event.interface, event.connection);
      }
      retireQuiet = millis() + 100;
    }
    return;
  }
  if (event.kind == Kind::DISCONNECTED && event.connection == retiringConnection && !memcmp(peer, event.address, 6)) {
    retiringConnection = noConnection;
    retireQuiet = millis() + 100;
    return;
  }
  if (event.kind == Kind::REGISTER) {
    if (phase != Phase::REGISTER) return;
    if (event.status != ESP_GATT_OK) {
      initializationFailed = true;
      finish(false, "Start kameraet på nytt.");
    } else {
      client = event.interface;
      scanParameters();
    }
    return;
  }
  if (event.interface != ESP_GATT_IF_NONE && event.interface != client) return;
  if (event.kind == Kind::SCAN_PARAMS && phase == Phase::SCAN_PARAMS) {
    if (event.status == ESP_BT_STATUS_SUCCESS) scanPrinter();
    else finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
  } else if (event.kind == Kind::SCAN_STARTED && phase == Phase::SCANNING && event.status != ESP_BT_STATUS_SUCCESS) {
    scanActive = false;
    finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
  } else if (event.kind == Kind::FOUND && phase == Phase::SCANNING) {
    memcpy(peer, event.address, 6);
    peerType = event.addressType;
    Serial.printf("Printer found: %s %02x:%02x:%02x:%02x:%02x:%02x\n", printerName, peer[0], peer[1], peer[2], peer[3], peer[4], peer[5]);
    setPhase(Phase::STOP_SCAN, 2000);
    if (esp_ble_gap_stop_scanning() != ESP_OK) finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
  } else if (event.kind == Kind::SCAN_STOPPED && phase == Phase::STOP_SCAN) {
    if (event.status == ESP_BT_STATUS_SUCCESS) { scanActive = false; openPrinter(); }
    else finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
  } else if (event.kind == Kind::SCAN_DONE && phase == Phase::STOP_SCAN) {
    scanActive = false;
    openPrinter();
  } else if (event.kind == Kind::SCAN_DONE && phase == Phase::SCANNING) {
    scanActive = false;
    finish(false, "Fann ikkje skrivaren. Slå han på og prøv igjen.");
  } else if (event.kind == Kind::OPEN) {
    if (phase != Phase::OPEN || memcmp(peer, event.address, 6)) {
      if (event.status == ESP_GATT_OK) esp_ble_gattc_close(event.interface, event.connection);
      return;
    }
    openPending = false;
    if (event.status != ESP_GATT_OK) {
      finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
      return;
    }
    connection = event.connection;
    connected = true;
    writeSize = event.mtu > 3 ? min<uint16_t>(event.mtu - 3, 512) : 20;
    flow.reset();
    congested = queueFull = paused = false;
    setPhase(Phase::MTU, 5000);
    if (esp_ble_gattc_send_mtu_req(client, connection) != ESP_OK) searchServices();
  } else if (event.kind == Kind::MTU && phase == Phase::MTU && event.connection == connection) {
    if (event.status == ESP_GATT_OK && event.mtu > 3) writeSize = min<uint16_t>(event.mtu - 3, 512);
    searchServices();
  } else if (event.kind == Kind::SERVICE && phase == Phase::SEARCH && event.connection == connection) {
    if (event.uuid == 0xae30) { primaryStart = event.handle; primaryEnd = event.end; }
    if (event.uuid == 0xae3a) { secondaryStart = event.handle; secondaryEnd = event.end; }
  } else if (event.kind == Kind::SEARCH_DONE && phase == Phase::SEARCH && event.connection == connection) {
    if (event.status != ESP_GATT_OK || (!selectService(primaryStart, primaryEnd, 0xae01, 0xae02) && !selectService(secondaryStart, secondaryEnd, 0xae3b, 0xae3c))) {
      finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
      return;
    }
    setPhase(Phase::NOTIFY, 5000);
    if (esp_ble_gattc_register_for_notify(client, peer, notifyHandle) != ESP_OK) finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
  } else if (event.kind == Kind::NOTIFY_REGISTERED && phase == Phase::NOTIFY && event.handle == notifyHandle) {
    if (event.status == ESP_GATT_OK) subscribe();
    else finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
  } else if (event.kind == Kind::SUBSCRIBED && phase == Phase::SUBSCRIBE && event.connection == connection && event.handle == descriptorHandle) {
    if (event.status == ESP_GATT_OK) readyChannel();
    else finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
  } else if (event.kind == Kind::WRITTEN && phase == Phase::WRITE && event.connection == connection && event.handle == writeHandle && pendingLength) {
    if (event.status != ESP_GATT_OK) {
      finish(false, "Utskrifta stoppa. Prøv igjen.");
      return;
    }
    offset += pendingLength;
    pendingLength = 0;
    updateState(pendingProbe ? State::RECOVERING : State::SENDING);
    if (pendingProbe) setPhase(Phase::SETTLE, 100);
    else phase = Phase::READY;
  } else if (event.kind == Kind::NOTIFICATION && event.connection == connection && event.handle == notifyHandle) {
    bool before = paused;
    flow.feed(event.data, event.length, paused);
    if (paused && !before) pausedAt = millis();
  } else if ((event.kind == Kind::CONGESTION || event.kind == Kind::QUEUE_FULL) && event.connection == connection) {
    bool before = congested || queueFull;
    if (event.kind == Kind::CONGESTION) congested = event.flag;
    else queueFull = event.flag;
    if (!before && (congested || queueFull)) congestedAt = millis();
  } else if (event.kind == Kind::DISCONNECTED && event.connection == connection && !memcmp(peer, event.address, 6)) {
    connected = channelReady = false;
    connection = noConnection;
    lockJob();
    bool running = jobData || checking;
    unlockJob();
    if (running) finish(false, offset ? "Utskrifta stoppa. Prøv igjen." : "Nådde ikkje skrivaren. Prøv igjen.");
    else closeChannel();
  } else if (event.kind == Kind::SERVICE_CHANGED && !memcmp(peer, event.address, 6)) {
    lockJob();
    bool running = jobData || checking;
    unlockJob();
    if (running) finish(false, "Nådde ikkje skrivaren. Prøv igjen.");
    else closeChannel();
  }
}

void tick() {
  lockJob();
  if (checkPending && !jobData && !checking) { checkPending = false; checking = true; }
  bool running = jobData || checking;
  unlockJob();
  if (!running) return;
  if (retiringScan || retiringOpen || retiringConnection != noConnection) {
    if (!expired(retireDeadline)) return;
    retiringScan = retiringOpen = scanActive = openPending = false;
    retiringConnection = noConnection;
    initializationFailed = true;
  }
  if (retireQuiet && !expired(retireQuiet)) return;
  retireQuiet = 0;
  if (phase == Phase::IDLE) { beginOperation(); return; }
  if (expired(jobStarted + 240000)) { finish(false, "Utskrifta stoppa. Prøv igjen."); return; }
  if (phase == Phase::MTU && expired(deadline)) { searchServices(); return; }
  if (phase != Phase::READY && phase != Phase::SETTLE && expired(deadline)) {
    if (phase == Phase::REGISTER || phase == Phase::SCAN_PARAMS || phase == Phase::NOTIFY) initializationFailed = true;
    finish(false, phase == Phase::WRITE ? "Utskrifta stoppa. Prøv igjen." : "Nådde ikkje skrivaren. Prøv igjen.");
    return;
  }
  if (phase == Phase::SETTLE) {
    if (!expired(deadline)) return;
    phase = Phase::READY;
  }
  if (phase != Phase::READY) return;
  if (offset == jobLength) { finish(true); return; }
  if (congested || queueFull) {
    if (expired(congestedAt + 40000)) finish(false, "Utskrifta stoppa. Prøv igjen.");
    return;
  }
  pendingProbe = false;
  if (paused) {
    updateState(State::RECOVERING);
    if (!expired(pausedAt + 5000)) return;
    if (probes >= 3) { finish(false, "Utskrifta stoppa. Prøv igjen."); return; }
    probes++;
    paused = false;
    pendingProbe = true;
  }
  pendingLength = min<size_t>(jobLength - offset, pendingProbe ? 20 : writeSize);
  setPhase(Phase::WRITE, 40000);
  if (esp_ble_gattc_write_char(client, connection, writeHandle, pendingLength, jobData + offset, ESP_GATT_WRITE_TYPE_NO_RSP, ESP_GATT_AUTH_REQ_NONE) != ESP_OK)
    finish(false, "Utskrifta stoppa. Prøv igjen.");
}

void printerWorker(void *) {
  for (;;) {
    Event event{};
    if (xQueueReceive(events, &event, pdMS_TO_TICKS(10)) == pdTRUE) {
      handleEvent(event);
      while (xQueueReceive(events, &event, 0) == pdTRUE) handleEvent(event);
    }
    portENTER_CRITICAL(&callbackMux);
    bool overflow = eventOverflow;
    eventOverflow = false;
    portEXIT_CRITICAL(&callbackMux);
    if (overflow) {
      lockJob();
      bool running = jobData || checking;
      unlockJob();
      if (running) finish(false, "Utskrifta stoppa. Prøv igjen.");
      else closeChannel();
    }
    tick();
  }
}

bool ensureWorker() {
  if (worker) return true;
  events = xQueueCreate(16, sizeof(Event));
  if (!events) return false;
  if (xTaskCreate(printerWorker, "entropi-printer", 8192, nullptr, 2, &worker) == pdPASS) return true;
  vQueueDelete(events);
  events = nullptr;
  return false;
}

int findRecord(const char *id) {
  for (int i = 0; i < 8; i++) if (records[i].id[0] && !strcmp(records[i].id, id)) return i;
  return -1;
}

bool queryId(httpd_req_t *request, char *id, bool required) {
  char query[96];
  size_t length = httpd_req_get_url_query_len(request);
  if (!length) { id[0] = 0; return !required; }
  if (length >= sizeof(query) || httpd_req_get_url_query_str(request, query, sizeof(query)) != ESP_OK) return false;
  if (httpd_query_key_value(query, "id", id, 33) != ESP_OK) { id[0] = 0; return !required; }
  return strlen(id) == 32;
}

esp_err_t jsonStatus(httpd_req_t *request, const Record &record, const char *boot, uint32_t sequence, const char *httpStatus = "200 OK", bool close = false) {
  char json[448];
  snprintf(json, sizeof(json), "{\"id\":\"%s\",\"state\":\"%s\",\"bytes\":%u,\"total\":%u,\"message\":\"%s\",\"boot\":\"%s\",\"sequence\":%lu}", record.id, stateName(record.state), static_cast<unsigned>(record.bytes), static_cast<unsigned>(record.total), record.message, boot, static_cast<unsigned long>(sequence));
  httpd_resp_set_status(request, httpStatus);
  httpd_resp_set_type(request, "application/json");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  if (close) httpd_resp_set_hdr(request, "Connection", "close");
  esp_err_t result = httpd_resp_send(request, json, HTTPD_RESP_USE_STRLEN);
  return close ? ESP_FAIL : result;
}

esp_err_t reject(httpd_req_t *request, const char *status, const char *message, bool close = false) {
  httpd_resp_set_status(request, status);
  httpd_resp_set_type(request, "text/plain; charset=utf-8");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  if (close) httpd_resp_set_hdr(request, "Connection", "close");
  esp_err_t result = httpd_resp_send(request, message, HTTPD_RESP_USE_STRLEN);
  return close ? ESP_FAIL : result;
}
}

void startPrinterBridge() {
  jobMutex = xSemaphoreCreateMutex();
  snprintf(bootId, sizeof(bootId), "%08lx%08lx", static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  if (!jobMutex) Serial.println("Printer bridge: could not allocate mutex");
}

bool printerBusy() {
  if (!jobMutex) return false;
  lockJob();
  bool busy = uploading || jobData || checking || checkPending;
  unlockJob();
  return busy;
}

void requestPrinterCheck() {
  if (!jobMutex) { Serial.println("Printer check: unavailable"); return; }
  lockJob();
  bool busy = uploading || jobData || checking || checkPending;
  bool available = !busy && ensureWorker();
  if (available) checkPending = true;
  unlockJob();
  Serial.println(available ? "Printer check: queued; read-only" : busy ? "Printer check: busy" : "Printer check: not enough memory");
}

bool printerCameraCheckRequested(int64_t &cutoff) {
  if (!jobMutex) return false;
  lockJob();
  bool requested = cameraChecks != 0;
  if (requested) {
    cameraChecks--;
    cutoff = cameraCheckCutoff;
  }
  unlockJob();
  return requested;
}

esp_err_t printerStatusHandler(httpd_req_t *request) {
  if (!jobMutex) return reject(request, "503 Service Unavailable", "Printer is unavailable");
  char id[33];
  if (!queryId(request, id, false)) return reject(request, "400 Bad Request", "Invalid print ID");
  lockJob();
  uint32_t sequence = nextSequence;
  int index = id[0] ? findRecord(id) : latest;
  Record record = index >= 0 ? records[index] : Record{};
  unlockJob();
  if (id[0] && index < 0) return reject(request, "404 Not Found", "Unknown print ID");
  return jsonStatus(request, record, bootId, sequence);
}

esp_err_t printerUploadHandler(httpd_req_t *request) {
  if (!jobMutex) return reject(request, "503 Service Unavailable", "Printer is unavailable", true);
  char id[33], type[48];
  uint32_t sequence = 0;
  if (!queryId(request, id, true) || !px10JobId(id, bootId, sequence)) return reject(request, "400 Bad Request", "Invalid print ID", true);
  if (httpd_req_get_hdr_value_str(request, "Content-Type", type, sizeof(type)) != ESP_OK || strcmp(type, "application/octet-stream") || request->content_len < 1 || request->content_len > maxJob)
    return reject(request, "400 Bad Request", "Invalid print body", true);
  lockJob();
  int duplicate = findRecord(id);
  if (duplicate >= 0) {
    Record record = records[duplicate];
    uint32_t next = nextSequence;
    unlockJob();
    return jsonStatus(request, record, bootId, next, "202 Accepted", true);
  }
  if (sequence != nextSequence || !nextSequence) {
    bool retired = sequence < nextSequence || !nextSequence;
    unlockJob();
    return reject(request, retired ? "409 Conflict" : "400 Bad Request", retired ? "Print ID is retired" : "Invalid print sequence", true);
  }
  if (uploading || jobData || checking || checkPending) {
    unlockJob();
    return reject(request, "409 Conflict", "Printer is busy", true);
  }
  uint8_t *data = static_cast<uint8_t *>(heap_caps_malloc(request->content_len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!data || !ensureWorker()) {
    free(data);
    unlockJob();
    return reject(request, "503 Service Unavailable", "Not enough printer memory", true);
  }
  uploading = true;
  unlockJob();
  int socket = httpd_req_to_sockfd(request);
  timeval timeout{1, 0};
  setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  size_t received = 0;
  uint32_t cutoff = millis() + 8000;
  while (received < request->content_len && !expired(cutoff)) {
    int length = httpd_req_recv(request, reinterpret_cast<char *>(data + received), min<size_t>(1024, request->content_len - received));
    if (length == HTTPD_SOCK_ERR_TIMEOUT) continue;
    if (length <= 0) break;
    received += length;
  }
  timeout.tv_sec = 3;
  setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  bool complete = received == request->content_len;
  bool valid = complete && validatePx10Job(data, received);
  lockJob();
  uploading = false;
  if (!valid) {
    unlockJob();
    free(data);
    return reject(request, complete ? "400 Bad Request" : "408 Request Timeout", complete ? "Unsafe or malformed print job" : "Incomplete print upload", !complete);
  }
  if (sequence != nextSequence || !nextSequence) {
    unlockJob();
    free(data);
    return reject(request, "409 Conflict", "Print ID is retired");
  }
  latest = (latest + 1) % 8;
  records[latest] = Record{};
  memcpy(records[latest].id, id, sizeof(id));
  records[latest].state = State::QUEUED;
  records[latest].total = received;
  active = latest;
  jobData = data;
  jobLength = received;
  nextSequence++;
  Record record = records[latest];
  uint32_t next = nextSequence;
  unlockJob();
  return jsonStatus(request, record, bootId, next, "202 Accepted");
}
