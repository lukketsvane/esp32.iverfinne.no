// Copyright 2015-2016 Espressif Systems (Shanghai) PTE LTD
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <SD_MMC.h>
#include <errno.h>
#include "esp_camera.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include "freertos/semphr.h"
#include "camera_ui.h"
#include "camera_assets.h"
#include "board_config.h"

static httpd_handle_t cameraHttpd = nullptr;
static httpd_handle_t streamHttpd = nullptr;
static SemaphoreHandle_t cameraMutex = nullptr;
static SemaphoreHandle_t storageMutex = nullptr;
static portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;
static Preferences preferences;
static bool preferencesReady = false;
static volatile bool cameraReady = false;
static volatile bool recovering = false;
static bool hasPsram = false;
static bool cameraInitialized = false;
static framesize_t previewSize = FRAMESIZE_QVGA;
static framesize_t photoSize = FRAMESIZE_UXGA;
static int brightness = 0;
static int ledDuty = 0;
static volatile unsigned captureFailures = 0;
static volatile unsigned previewFailures = 0;
static volatile unsigned recoveryAttempts = 0;
static uint32_t nextRecovery = 0;
static char lastError[96] = "Camera is starting";
static const char *serverError = "";
static const char *storageState = "missing";
static const char *storageError = "No microSD card";
static bool storageMounted = false;
static uint32_t nextStorageAttempt = 0;
static uint64_t photoSequence = 0;
static constexpr unsigned PAGE_SIZE = 12;

struct PhotoFrame {
  uint8_t *data = nullptr;
  size_t length = 0;
};

struct StorageLock {
  bool acquired;
  explicit StorageLock(uint32_t timeout = 250) : acquired(storageMutex && xSemaphoreTake(storageMutex, pdMS_TO_TICKS(timeout)) == pdTRUE) {}
  ~StorageLock() { if (acquired) xSemaphoreGive(storageMutex); }
};

struct StorageStatus {
  const char *state;
  const char *error;
};

static StorageStatus storageSnapshot() {
  portENTER_CRITICAL(&stateMux);
  StorageStatus status = {storageState, storageError};
  portEXIT_CRITICAL(&stateMux);
  return status;
}

static void cameraMessage(const char *error) {
  portENTER_CRITICAL(&stateMux);
  snprintf(lastError, sizeof(lastError), "%s", error);
  portEXIT_CRITICAL(&stateMux);
}

static void setServerError(const char *error) {
  portENTER_CRITICAL(&stateMux);
  serverError = error;
  portEXIT_CRITICAL(&stateMux);
}

static bool lockCamera(uint32_t timeout = 500) {
  return cameraMutex && xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(timeout)) == pdTRUE;
}

static void unlockCamera() {
  xSemaphoreGive(cameraMutex);
}

static void setCameraError(const char *error) {
  cameraMessage(error);
  captureFailures++;
  if (captureFailures >= 3) cameraReady = false;
}

static void cameraSucceeded() {
  captureFailures = 0;
  previewFailures = 0;
  cameraMessage("");
}

static void setLed(bool enabled) {
#if defined(LED_GPIO_NUM)
  ledcWrite(LED_GPIO_NUM, enabled ? ledDuty : 0);
#endif
}

static bool previewAllowed(int value) {
  return value == FRAMESIZE_QVGA || (hasPsram && value == FRAMESIZE_VGA);
}

static bool photoAllowed(int value) {
  return previewAllowed(value) || (hasPsram && value == FRAMESIZE_UXGA);
}

static bool frameMatches(camera_fb_t *frame, framesize_t size) {
  unsigned width = size == FRAMESIZE_UXGA ? 1600 : size == FRAMESIZE_VGA ? 640 : 320;
  unsigned height = size == FRAMESIZE_UXGA ? 1200 : size == FRAMESIZE_VGA ? 480 : 240;
  return frame->format == PIXFORMAT_JPEG && frame->width == width && frame->height == height && frame->len > 0;
}

static bool copyFrame(camera_fb_t *frame, PhotoFrame &photo) {
  photo.data = static_cast<uint8_t *>(heap_caps_malloc(frame->len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!photo.data) photo.data = static_cast<uint8_t *>(malloc(frame->len));
  if (!photo.data) return false;
  memcpy(photo.data, frame->buf, frame->len);
  photo.length = frame->len;
  return true;
}

static bool initializeCamera() {
  if (cameraInitialized) {
    esp_camera_deinit();
    cameraInitialized = false;
  }
  cameraReady = false;
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = hasPsram ? FRAMESIZE_UXGA : FRAMESIZE_QVGA;
  config.fb_location = hasPsram ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  config.jpeg_quality = hasPsram ? 10 : 12;
  config.fb_count = hasPsram ? 2 : 1;
  config.grab_mode = hasPsram ? CAMERA_GRAB_LATEST : CAMERA_GRAB_WHEN_EMPTY;
  esp_err_t error = esp_camera_init(&config);
  if (error != ESP_OK) {
    char message[96];
    snprintf(message, sizeof(message), "Camera initialization failed (0x%x)", error);
    cameraMessage(message);
    return false;
  }
  cameraInitialized = true;
  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor) {
    cameraMessage("Camera sensor is unavailable");
    return false;
  }
  if (sensor->id.PID == OV3660_PID) {
    sensor->set_vflip(sensor, 1);
    sensor->set_saturation(sensor, -2);
  }
  if (sensor->set_framesize(sensor, previewSize) != 0 || sensor->set_brightness(sensor, brightness) != 0) {
    cameraMessage("Could not restore camera settings");
    return false;
  }
  cameraReady = true;
  cameraSucceeded();
  return true;
}

void cameraMaintenance() {
  if ((cameraReady && captureFailures < 3 && previewFailures < 3) || recoveryAttempts >= 3 || recovering || int32_t(millis() - nextRecovery) < 0) return;
  if (!lockCamera(0)) return;
  recovering = true;
  recoveryAttempts++;
  setLed(false);
  initializeCamera();
  nextRecovery = millis() + 5000;
  recovering = false;
  unlockCamera();
}

static void setStorage(const char *state, const char *error = "") {
  portENTER_CRITICAL(&stateMux);
  storageState = state;
  storageError = error;
  portEXIT_CRITICAL(&stateMux);
}

static const char *baseName(const char *name) {
  const char *slash = strrchr(name, '/');
  return slash ? slash + 1 : name;
}

static bool validPhotoName(const char *name, bool temporary = false) {
  if (strlen(name) != 32 || strncmp(name, "entropi-", 8) != 0) return false;
  for (unsigned i = 8; i < 28; i++) if (name[i] < '0' || name[i] > '9') return false;
  return strcmp(name + 28, ".jpg") == 0 || (temporary && strcmp(name + 28, ".tmp") == 0);
}

static bool mountStorage() {
  if (storageMounted) return true;
  if (int32_t(millis() - nextStorageAttempt) < 0) return false;
  nextStorageAttempt = millis() + 5000;
  SD_MMC.end();
  if (!SD_MMC.begin("/sdcard", true, false) || SD_MMC.cardType() == CARD_NONE) {
    SD_MMC.end();
    setStorage("missing", "No readable microSD card");
    return false;
  }
  File root = SD_MMC.open("/");
  if (!root || !root.isDirectory()) {
    root.close();
    SD_MMC.end();
    setStorage("error", "Could not open microSD card");
    return false;
  }
  for (File entry = root.openNextFile(); entry; entry = root.openNextFile()) {
    const char *name = baseName(entry.name());
    if (!entry.isDirectory() && validPhotoName(name, true)) {
      uint64_t sequence = strtoull(name + 8, nullptr, 10);
      if (sequence > photoSequence) photoSequence = sequence;
    }
    entry.close();
  }
  root.close();
  storageMounted = true;
  setStorage("ready");
  return true;
}

static void storageFailed(const char *error) {
  uint64_t total = SD_MMC.totalBytes();
  uint64_t used = SD_MMC.usedBytes();
  setStorage(total && used >= total - min<uint64_t>(total, 4096) ? "full" : "error", error);
  storageMounted = false;
  nextStorageAttempt = millis() + 5000;
}

static bool savePhoto(const PhotoFrame &photo, char *savedName, size_t capacity) {
  savedName[0] = 0;
  StorageLock lock;
  if (!lock.acquired || !storageMounted) return false;
  uint64_t total = SD_MMC.totalBytes();
  uint64_t used = SD_MMC.usedBytes();
  if (total && (used >= total || total - used < photo.length + 4096)) {
    setStorage("full", "MicroSD card is full");
    return false;
  }
  char name[40], finalPath[44], temporaryPath[44];
  do {
    if (photoSequence == UINT64_MAX) {
      setStorage("error", "Photo numbering is exhausted");
      return false;
    }
    photoSequence++;
    snprintf(name, sizeof(name), "entropi-%020llu.jpg", static_cast<unsigned long long>(photoSequence));
    snprintf(finalPath, sizeof(finalPath), "/%s", name);
    snprintf(temporaryPath, sizeof(temporaryPath), "/entropi-%020llu.tmp", static_cast<unsigned long long>(photoSequence));
  } while (SD_MMC.exists(finalPath) || SD_MMC.exists(temporaryPath));
  if (preferencesReady) preferences.putULong64("photo_seq", photoSequence);
  File file = SD_MMC.open(temporaryPath, FILE_WRITE);
  if (!file) {
    storageFailed("Could not create photo on microSD card");
    return false;
  }
  size_t written = 0;
  while (written < photo.length) {
    size_t count = file.write(photo.data + written, min<size_t>(16384, photo.length - written));
    if (!count) break;
    written += count;
  }
  file.flush();
  bool complete = written == photo.length && file.size() == photo.length;
  file.close();
  if (!complete || !SD_MMC.rename(temporaryPath, finalPath)) {
    storageFailed(complete ? "Could not commit photo on microSD card" : "Photo write was incomplete");
    return false;
  }
  File saved = SD_MMC.open(finalPath, FILE_READ);
  bool confirmed = saved && saved.size() == photo.length;
  saved.close();
  if (!confirmed) {
    storageFailed("Could not verify saved photo on microSD card");
    return false;
  }
  snprintf(savedName, capacity, "%s", name);
  setStorage("ready");
  return true;
}

static String quoted(const char *value) {
  String result = "\"";
  for (const char *p = value; *p; p++) {
    if (*p == '"' || *p == '\\') result += '\\';
    if (static_cast<unsigned char>(*p) >= 32) result += *p;
  }
  return result + "\"";
}

static String storageJson() {
  StorageStatus status = storageSnapshot();
  return "{\"state\":" + quoted(status.state) + ",\"error\":" + quoted(status.error) + "}";
}

static esp_err_t sendJson(httpd_req_t *request, const String &json) {
  httpd_resp_set_type(request, "application/json");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  return httpd_resp_send(request, json.c_str(), json.length());
}

static bool queryValue(httpd_req_t *request, const char *key, char *value, size_t capacity) {
  char query[128];
  size_t length = httpd_req_get_url_query_len(request);
  return length && length < sizeof(query) && httpd_req_get_url_query_str(request, query, sizeof(query)) == ESP_OK &&
    httpd_query_key_value(query, key, value, capacity) == ESP_OK;
}

static esp_err_t statusHandler(httpd_req_t *request) {
  char error[sizeof(lastError)];
  portENTER_CRITICAL(&stateMux);
  snprintf(error, sizeof(error), "%s", serverError[0] ? serverError : lastError);
  portEXIT_CRITICAL(&stateMux);
  String json = "{\"camera_ready\":" + String(cameraReady ? "true" : "false");
  json += ",\"stream_ready\":" + String(streamHttpd && cameraReady && !recovering ? "true" : "false");
  json += ",\"last_error\":" + quoted(error);
  json += ",\"recovering\":" + String(recovering ? "true" : "false");
  json += ",\"recovery_attempts\":" + String(recoveryAttempts);
  json += ",\"psram\":" + String(hasPsram ? "true" : "false");
  json += ",\"framesize\":" + String(static_cast<int>(previewSize));
  json += ",\"photo_framesize\":" + String(static_cast<int>(photoSize));
  json += ",\"brightness\":" + String(brightness);
  json += ",\"led_intensity\":" + String(ledDuty);
  json += ",\"storage\":" + storageJson() + "}";
  return sendJson(request, json);
}

static esp_err_t unavailable(httpd_req_t *request, const char *message) {
  httpd_resp_set_status(request, "503 Service Unavailable");
  httpd_resp_set_type(request, "text/plain");
  return httpd_resp_send(request, message, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t controlHandler(httpd_req_t *request) {
  char variable[32], text[16];
  if (!queryValue(request, "var", variable, sizeof(variable)) || !queryValue(request, "val", text, sizeof(text)))
    return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Missing control");
  char *end;
  long value = strtol(text, &end, 10);
  if (!text[0] || *end) return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Invalid value");
  bool preview = strcmp(variable, "framesize") == 0;
  bool photo = strcmp(variable, "photo_framesize") == 0;
  bool light = strcmp(variable, "brightness") == 0;
  bool flash = strcmp(variable, "led_intensity") == 0;
  if ((!preview && !photo && !light && !flash) || (preview && !previewAllowed(value)) || (photo && !photoAllowed(value)) ||
      (light && (value < -2 || value > 2)) || (flash && (value < 0 || value > 255)))
    return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Unsupported setting");
  if (!lockCamera(1000)) return unavailable(request, "Camera is busy");
  sensor_t *sensor = cameraReady ? esp_camera_sensor_get() : nullptr;
  if (!sensor) {
    unlockCamera();
    return unavailable(request, "Camera is unavailable");
  }
  int result = preview ? sensor->set_framesize(sensor, static_cast<framesize_t>(value)) : light ? sensor->set_brightness(sensor, value) : 0;
  if (result == 0) {
    if (preview) previewSize = static_cast<framesize_t>(value);
    if (photo) photoSize = static_cast<framesize_t>(value);
    if (light) brightness = value;
    if (flash) ledDuty = value;
    if (preferencesReady) preferences.putInt(variable, value);
  } else {
    setCameraError("Could not change camera setting");
  }
  unlockCamera();
  if (result != 0) return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Setting was not applied");
  return httpd_resp_send(request, "", 0);
}

static bool capturePhoto(PhotoFrame &photo) {
  if (!lockCamera(1000)) return false;
  sensor_t *sensor = cameraReady ? esp_camera_sensor_get() : nullptr;
  if (!sensor) {
    unlockCamera();
    return false;
  }
  bool success = false;
  bool configured = sensor->set_framesize(sensor, photoSize) == 0;
  setLed(true);
  vTaskDelay(pdMS_TO_TICKS(150));
  int64_t cutoff = esp_timer_get_time();
  if (configured) {
    for (unsigned attempt = 0; attempt < 4; attempt++) {
      if (esp_timer_get_time() - cutoff > 3000000) break;
      camera_fb_t *frame = esp_camera_fb_get();
      if (!frame) break;
      int64_t timestamp = int64_t(frame->timestamp.tv_sec) * 1000000 + frame->timestamp.tv_usec;
      bool fresh = timestamp >= cutoff && frameMatches(frame, photoSize);
      if (fresh) success = copyFrame(frame, photo);
      esp_camera_fb_return(frame);
      if (fresh) break;
    }
  }
  setLed(false);
  bool restored = sensor->set_framesize(sensor, previewSize) == 0;
  if (!restored) {
    cameraReady = false;
    setCameraError("Could not restore preview after photo");
  } else if (!success) {
    setCameraError(configured ? "Could not capture a fresh photo" : "Could not select photo resolution");
  } else {
    cameraSucceeded();
  }
  unlockCamera();
  return success;
}

static esp_err_t captureHandler(httpd_req_t *request) {
  PhotoFrame photo;
  if (!capturePhoto(photo)) return unavailable(request, "Could not capture photo");
  char savedName[40];
  savePhoto(photo, savedName, sizeof(savedName));
  StorageStatus storage = storageSnapshot();
  httpd_resp_set_type(request, "image/jpeg");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(request, "X-Storage-State", storage.state);
  httpd_resp_set_hdr(request, "X-Storage-Error", storage.error);
  if (savedName[0]) httpd_resp_set_hdr(request, "X-Photo-Name", savedName);
  esp_err_t result = httpd_resp_send(request, reinterpret_cast<const char *>(photo.data), photo.length);
  free(photo.data);
  return result;
}

static esp_err_t photosHandler(httpd_req_t *request) {
  char before[40] = {};
  if (httpd_req_get_url_query_len(request) && (!queryValue(request, "before", before, sizeof(before)) || !validPhotoName(before)))
    return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Invalid gallery cursor");
  char names[PAGE_SIZE + 1][40] = {};
  unsigned count = 0;
  StorageLock lock;
  if (lock.acquired && storageMounted) {
    File root = SD_MMC.open("/");
    if (!root || !root.isDirectory()) {
      storageFailed("Could not read microSD gallery");
    } else {
      errno = 0;
      for (File entry = root.openNextFile(); entry; entry = root.openNextFile()) {
        const char *name = baseName(entry.name());
        if (!entry.isDirectory() && validPhotoName(name) && (!before[0] || strcmp(name, before) < 0)) {
          unsigned position = 0;
          while (position < count && strcmp(names[position], name) > 0) position++;
          if (position <= PAGE_SIZE) {
            unsigned end = min<unsigned>(count, PAGE_SIZE);
            for (unsigned i = end; i > position; i--) strcpy(names[i], names[i - 1]);
            snprintf(names[position], sizeof(names[position]), "%s", name);
            if (count < PAGE_SIZE + 1) count++;
          }
        }
        entry.close();
        errno = 0;
      }
      if (errno) {
        count = 0;
        storageFailed("Could not finish reading microSD gallery");
      }
      root.close();
    }
  }
  String json = "{\"photos\":[";
  for (unsigned i = 0; i < min<unsigned>(count, PAGE_SIZE); i++) {
    if (i) json += ',';
    json += "{\"name\":" + quoted(names[i]) + "}";
  }
  json += "],\"next\":";
  json += count > PAGE_SIZE ? quoted(names[PAGE_SIZE - 1]) : String("null");
  json += ",\"storage\":" + storageJson() + "}";
  return sendJson(request, json);
}

static esp_err_t sendFile(httpd_req_t *request, const char *path, const char *type, size_t expected = 0) {
  StorageLock lock;
  if (!lock.acquired) return unavailable(request, "MicroSD card is busy");
  if (!storageMounted) return unavailable(request, storageSnapshot().error);
  File file = SD_MMC.open(path, FILE_READ);
  if (!file || file.isDirectory()) return httpd_resp_send_err(request, HTTPD_404_NOT_FOUND, "File was not found");
  if (expected && file.size() != expected) return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "File is incomplete");
  httpd_resp_set_type(request, type);
  httpd_resp_set_hdr(request, "Cache-Control", "private, max-age=86400");
  uint8_t buffer[1024];
  size_t remaining = file.size();
  esp_err_t result = ESP_OK;
  while (remaining && result == ESP_OK) {
    size_t count = file.read(buffer, min<size_t>(remaining, sizeof(buffer)));
    if (!count) {
      storageFailed("Could not read complete file from microSD card");
      result = ESP_FAIL;
      break;
    }
    remaining -= count;
    result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(buffer), count);
  }
  file.close();
  if (result == ESP_OK) result = httpd_resp_send_chunk(request, nullptr, 0);
  return result;
}

static esp_err_t photoHandler(httpd_req_t *request) {
  char name[40];
  if (!queryValue(request, "name", name, sizeof(name)) || !validPhotoName(name))
    return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Invalid photo name");
  char path[44];
  snprintf(path, sizeof(path), "/%s", name);
  httpd_resp_set_hdr(request, "X-Photo-Name", name);
  return sendFile(request, path, "image/jpeg");
}

static esp_err_t assetHandler(httpd_req_t *request) {
  size_t length = strcspn(request->uri, "?");
  for (const CameraAsset &asset : cameraAssets) {
    if (strlen(asset.uri) != length || strncmp(asset.uri, request->uri, length)) continue;
    if (!asset.data) return sendFile(request, asset.uri, asset.type, asset.length);
    httpd_resp_set_type(request, asset.type);
    httpd_resp_set_hdr(request, "Content-Encoding", "gzip");
    httpd_resp_set_hdr(request, "Cache-Control", "public, max-age=86400");
    return httpd_resp_send(request, reinterpret_cast<const char *>(asset.data), asset.length);
  }
  return httpd_resp_send_err(request, HTTPD_404_NOT_FOUND, "Asset was not found");
}

static esp_err_t streamHandler(httpd_req_t *request) {
  if (!cameraReady) return unavailable(request, "Camera is unavailable");
  httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=entropi-frame");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  unsigned staleFrames = 0;
  while (cameraReady && !recovering) {
    PhotoFrame photo;
    if (!lockCamera(250)) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    camera_fb_t *frame = cameraReady ? esp_camera_fb_get() : nullptr;
    bool stale = frame && !frameMatches(frame, previewSize);
    bool success = frame && !stale && copyFrame(frame, photo);
    if (frame) esp_camera_fb_return(frame);
    if (success) {
      previewFailures = 0;
      if (!captureFailures) cameraMessage("");
    } else if (!stale || ++staleFrames >= 4) {
      cameraMessage("Could not capture preview frame");
      previewFailures++;
      if (previewFailures >= 3) cameraReady = false;
    }
    unlockCamera();
    if (stale && staleFrames < 4) continue;
    if (!success) break;
    staleFrames = 0;
    char header[128];
    int length = snprintf(header, sizeof(header), "\r\n--entropi-frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", static_cast<unsigned>(photo.length));
    esp_err_t result = httpd_resp_send_chunk(request, header, length);
    if (result == ESP_OK) result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(photo.data), photo.length);
    free(photo.data);
    if (result != ESP_OK) return result;
    vTaskDelay(pdMS_TO_TICKS(1));
  }
  return ESP_FAIL;
}

static esp_err_t indexHandler(httpd_req_t *request) {
  httpd_resp_set_type(request, "text/html; charset=utf-8");
  httpd_resp_set_hdr(request, "Content-Encoding", "gzip");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  return httpd_resp_send(request, reinterpret_cast<const char *>(camera_ui_html_gz), sizeof(camera_ui_html_gz));
}

static esp_err_t captiveHandler(httpd_req_t *request, httpd_err_code_t) {
  if (request->method != HTTP_GET && request->method != HTTP_HEAD)
    return httpd_resp_send_err(request, HTTPD_404_NOT_FOUND, "Not found");
  String location = "http://" + WiFi.softAPIP().toString() + "/";
  httpd_resp_set_status(request, "302 Found");
  httpd_resp_set_hdr(request, "Location", location.c_str());
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  return httpd_resp_send(request, "", 0);
}

static bool registerHandler(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *)) {
  httpd_uri_t route = {};
  route.uri = uri;
  route.method = HTTP_GET;
  route.handler = handler;
  if (httpd_register_uri_handler(server, &route) == ESP_OK) return true;
  setServerError("Could not register HTTP endpoint");
  return false;
}

static void deviceWorker(void *) {
  if (lockCamera(1000)) {
    initializeCamera();
    unlockCamera();
  }
  nextRecovery = millis() + 5000;
  uint32_t nextStorageCheck = 0;
  for (;;) {
    cameraMaintenance();
    if (int32_t(millis() - nextStorageCheck) >= 0) {
      StorageLock lock(0);
      if (lock.acquired) {
        if (storageMounted) {
          File root = SD_MMC.open("/");
          if (!root || !root.isDirectory()) storageFailed("MicroSD card is unavailable");
          root.close();
        } else {
          mountStorage();
        }
        nextStorageCheck = millis() + 5000;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void startCameraServer() {
  cameraMutex = xSemaphoreCreateMutex();
  storageMutex = xSemaphoreCreateMutex();
  hasPsram = psramFound();
  preferencesReady = preferences.begin("entropi", false);
  if (preferencesReady) {
    int savedPreview = preferences.getInt("framesize", FRAMESIZE_QVGA);
    int savedPhoto = preferences.getInt("photo_framesize", hasPsram ? FRAMESIZE_UXGA : FRAMESIZE_QVGA);
    int savedBrightness = preferences.getInt("brightness", 0);
    if (previewAllowed(savedPreview)) previewSize = static_cast<framesize_t>(savedPreview);
    photoSize = photoAllowed(savedPhoto) ? static_cast<framesize_t>(savedPhoto) : FRAMESIZE_QVGA;
    brightness = constrain(savedBrightness, -2, 2);
    ledDuty = constrain(preferences.getInt("led_intensity", 0), 0, 255);
    photoSequence = preferences.getULong64("photo_seq", 0);
  } else if (!hasPsram) {
    photoSize = FRAMESIZE_QVGA;
  }
#if defined(LED_GPIO_NUM)
  ledcAttachChannel(LED_GPIO_NUM, 5000, 8, 7);
  setLed(false);
#endif
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.max_uri_handlers = 8;
  config.uri_match_fn = httpd_uri_match_wildcard;
  config.stack_size = 8192;
  config.send_wait_timeout = 3;
  config.recv_wait_timeout = 3;
  config.lru_purge_enable = true;
  if (httpd_start(&cameraHttpd, &config) == ESP_OK) {
    registerHandler(cameraHttpd, "/", indexHandler);
    registerHandler(cameraHttpd, "/status", statusHandler);
    registerHandler(cameraHttpd, "/control", controlHandler);
    registerHandler(cameraHttpd, "/capture", captureHandler);
    registerHandler(cameraHttpd, "/photos", photosHandler);
    registerHandler(cameraHttpd, "/photo", photoHandler);
    registerHandler(cameraHttpd, "/pointcloud/*", assetHandler);
    httpd_register_err_handler(cameraHttpd, HTTPD_404_NOT_FOUND, captiveHandler);
  } else {
    setServerError("Could not start HTTP server");
  }
  config.server_port++;
  config.ctrl_port++;
  if (httpd_start(&streamHttpd, &config) == ESP_OK) {
    if (!registerHandler(streamHttpd, "/stream", streamHandler)) {
      httpd_stop(streamHttpd);
      streamHttpd = nullptr;
    }
  } else setServerError("Could not start stream server");
  if (!cameraMutex || !storageMutex || xTaskCreate(deviceWorker, "entropi-device", 8192, nullptr, 1, nullptr) != pdPASS)
    cameraMessage("Could not start camera maintenance");
}
