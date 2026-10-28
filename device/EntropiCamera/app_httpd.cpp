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
#include "esp_camera.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/semphr.h"
#include "lwip/sockets.h"
#include "camera_ui.h"
#include "camera_assets.h"
#include "board_config.h"
#include "jpeg_frame.h"
#include "stereo_protocol.h"
#include "px10_printer.h"
#include "rig_network.h"

static httpd_handle_t cameraHttpd = nullptr;
static httpd_handle_t streamHttpd = nullptr;
static SemaphoreHandle_t cameraMutex = nullptr;
static SemaphoreHandle_t stereoMutex = nullptr;
static portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;
static Preferences preferences;
static bool preferencesReady = false;
static volatile bool cameraReady = false;
static volatile bool recovering = false;
static volatile bool recoveryRequested = false;
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
static uint32_t streamStackFree = UINT32_MAX;
static uint32_t activeStreams = 0;
static uint32_t streamFrames = 0;
static uint32_t lastStreamFrameMs = 0;
struct StreamActivity {
  StreamActivity() { portENTER_CRITICAL(&stateMux); activeStreams++; portEXIT_CRITICAL(&stateMux); }
  ~StreamActivity() { portENTER_CRITICAL(&stateMux); activeStreams--; portEXIT_CRITICAL(&stateMux); }
  void sent() {
    uint32_t now = millis();
    portENTER_CRITICAL(&stateMux);
    streamFrames++;
    lastStreamFrameMs = now;
    portEXIT_CRITICAL(&stateMux);
  }
};
struct PhotoFrame {
  uint8_t *data = nullptr;
  size_t length = 0;
  int64_t startedUs = 0;
  int64_t capturedUs = 0;
};

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

static void sampleStreamStack() {
  uint32_t available = uxTaskGetStackHighWaterMark(nullptr);
  portENTER_CRITICAL(&stateMux);
  streamStackFree = available;
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

static void previewResult(bool success) {
  if (success) {
    previewFailures = 0;
    recoveryAttempts = 0;
    if (!captureFailures) cameraMessage("");
  } else {
    cameraMessage("Could not capture preview frame");
    previewFailures++;
    if (previewFailures >= 3) cameraReady = false;
  }
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
  unsigned actualWidth, actualHeight;
  return frame->format == PIXFORMAT_JPEG && jpegDimensions(frame->buf, frame->len, actualWidth, actualHeight) && actualWidth == width && actualHeight == height;
}

static camera_fb_t *waitForFrame(int64_t deadline) {
  while (esp_timer_get_time() < deadline) {
    if (esp_camera_available_frames()) return esp_camera_fb_get();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
  return nullptr;
}

static bool copyFrame(camera_fb_t *frame, PhotoFrame &photo) {
  photo.data = static_cast<uint8_t *>(heap_caps_malloc(frame->len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!photo.data) photo.data = static_cast<uint8_t *>(malloc(frame->len));
  if (!photo.data) return false;
  memcpy(photo.data, frame->buf, frame->len);
  photo.length = frame->len;
  photo.capturedUs = int64_t(frame->timestamp.tv_sec) * 1000000 + frame->timestamp.tv_usec;
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
#if defined(ENTROPI_SECONDARY_CAMERA) && ENTROPI_SECONDARY_CAMERA
  if (sensor->set_hmirror(sensor, 1) != 0 || sensor->set_vflip(sensor, 1) != 0) {
    cameraMessage("Could not orient the second camera");
    return false;
  }
#endif
  if (sensor->set_framesize(sensor, previewSize) != 0 || sensor->set_brightness(sensor, brightness) != 0) {
    cameraMessage("Could not restore camera settings");
    return false;
  }
  cameraReady = true;
  cameraSucceeded();
  return true;
}

static bool requestCameraRecovery() {
  if (printerBusy() || recovering || recoveryRequested || !lockCamera(200)) return false;
  if (printerBusy() || recovering || recoveryRequested) {
    unlockCamera();
    return false;
  }
  recoveryRequested = true;
  cameraReady = false;
  setLed(false);
  cameraMessage("Camera is restarting");
  unlockCamera();
  return true;
}

void cameraMaintenance() {
  if (recovering || (!recoveryRequested && ((cameraReady && captureFailures < 3 && previewFailures < 3) ||
      recoveryAttempts >= 3 || int32_t(millis() - nextRecovery) < 0))) return;
  if (printerBusy() || !lockCamera(0)) return;
  if (recoveryRequested) {
    recoveryRequested = false;
    recoveryAttempts = 0;
  }
  recovering = true;
  recoveryAttempts++;
  setLed(false);
  initializeCamera();
  nextRecovery = millis() + 5000;
  recovering = false;
  unlockCamera();
}

static String quoted(const char *value) {
  String result = "\"";
  for (const char *p = value; *p; p++) {
    if (*p == '"' || *p == '\\') result += '\\';
    if (static_cast<unsigned char>(*p) >= 32) result += *p;
  }
  return result + "\"";
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

static String cameraStatusJson() {
  char cameraId[13];
  snprintf(cameraId, sizeof(cameraId), "%012llx", static_cast<unsigned long long>(ESP.getEfuseMac()));
  char error[sizeof(lastError)];
  uint32_t streams, frames, sentAt;
  portENTER_CRITICAL(&stateMux);
  snprintf(error, sizeof(error), "%s", serverError[0] ? serverError : lastError);
  streams = activeStreams; frames = streamFrames; sentAt = lastStreamFrameMs;
  portEXIT_CRITICAL(&stateMux);
  bool ready = cameraReady && !recovering && !recoveryRequested;
  String json = "{\"camera_ready\":" + String(ready ? "true" : "false");
  json += ",\"camera_id\":" + quoted(cameraId);
  json += ",\"stream_ready\":" + String(streamHttpd && ready ? "true" : "false");
  json += ",\"stream_active\":" + String(streams ? "true" : "false");
  json += ",\"stream_frames\":" + String(static_cast<unsigned long>(frames));
  json += ",\"stream_age_ms\":" + (frames ? String(static_cast<unsigned long>(millis() - sentAt)) : String("-1"));
  json += ",\"last_error\":" + quoted(error);
  json += ",\"recovering\":" + String(recovering || recoveryRequested ? "true" : "false");
  json += ",\"recovery_attempts\":" + String(recoveryAttempts);
  json += ",\"psram\":" + String(hasPsram ? "true" : "false");
  json += ",\"framesize\":" + String(static_cast<int>(previewSize));
  json += ",\"photo_framesize\":" + String(static_cast<int>(photoSize));
  json += ",\"brightness\":" + String(brightness);
  json += ",\"led_intensity\":" + String(ledDuty);
  json += ",\"peer\":";
  json += rigIsPrimary() && rigPeerOrigin().length() ? "{\"camera_id\":" + quoted(rigPeerId()) + "}" : "null";
  json += "}";
  return json;
}

static esp_err_t statusHandler(httpd_req_t *request) {
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "http://192.168.4.1");
  return sendJson(request, cameraStatusJson());
}

void serialCameraCheck() {
  Serial.print("CAMERA_STATUS ");
  Serial.println(cameraStatusJson());
}

void serialCameraRetry() {
  Serial.println(requestCameraRecovery() ? "CAMERA_RETRY queued" : "CAMERA_RETRY busy");
  serialCameraCheck();
}

static esp_err_t unavailable(httpd_req_t *request, const char *message) {
  httpd_resp_set_status(request, "503 Service Unavailable");
  httpd_resp_set_type(request, "text/plain");
  return httpd_resp_send(request, message, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t recoverHandler(httpd_req_t *request) {
  if (!requestCameraRecovery()) return unavailable(request, "Camera is busy");
  httpd_resp_set_status(request, "202 Accepted");
  return sendJson(request, cameraStatusJson());
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

static bool capturePhoto(PhotoFrame &photo, framesize_t targetSize = photoSize, size_t limit = SIZE_MAX) {
  photo.startedUs = esp_timer_get_time();
  if (!lockCamera(1000)) return false;
  sensor_t *sensor = cameraReady ? esp_camera_sensor_get() : nullptr;
  if (!sensor) {
    unlockCamera();
    return false;
  }
  bool success = false;
  bool configured = sensor->set_framesize(sensor, targetSize) == 0;
  setLed(true);
  vTaskDelay(pdMS_TO_TICKS(150));
  int64_t cutoff = esp_timer_get_time();
  int64_t deadline = cutoff + 3000000;
  if (configured) {
    for (unsigned attempt = 0; attempt < 4; attempt++) {
      camera_fb_t *frame = waitForFrame(deadline);
      if (!frame) break;
      int64_t timestamp = int64_t(frame->timestamp.tv_sec) * 1000000 + frame->timestamp.tv_usec;
      bool fresh = timestamp >= cutoff && frameMatches(frame, targetSize);
      if (fresh && frame->len <= limit) success = copyFrame(frame, photo);
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
    recoveryAttempts = 0;
  }
  unlockCamera();
  return success;
}

static esp_err_t captureHandler(httpd_req_t *request) {
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "http://192.168.4.1");
  if (printerBusy()) return unavailable(request, "Printer is busy");
  char pair[33], camera[13], started[24], captured[24], ready[24];
  bool paired = queryValue(request, "pair", pair, sizeof(pair));
  if (paired) {
    if (!stereoHex(pair, 32)) return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Invalid pair identifier");
    timeval timeout = {6, 0};
    if (setsockopt(httpd_req_to_sockfd(request), SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)))
      return unavailable(request, "Could not prepare paired transfer");
  }
  PhotoFrame photo;
  if (!capturePhoto(photo, photoSize, paired ? STEREO_MAX_JPEG : SIZE_MAX)) return unavailable(request, "Could not capture photo");
  if (paired) {
    snprintf(camera, sizeof(camera), "%012llx", static_cast<unsigned long long>(ESP.getEfuseMac()));
    snprintf(started, sizeof(started), "%lld", static_cast<long long>(photo.startedUs));
    snprintf(captured, sizeof(captured), "%lld", static_cast<long long>(photo.capturedUs));
    snprintf(ready, sizeof(ready), "%lld", static_cast<long long>(esp_timer_get_time()));
    httpd_resp_set_hdr(request, "X-Entropi-Pair-Id", pair);
    httpd_resp_set_hdr(request, "X-Entropi-Camera-Id", camera);
    httpd_resp_set_hdr(request, "X-Entropi-Capture-Started-Us", started);
    httpd_resp_set_hdr(request, "X-Entropi-Capture-Us", captured);
    httpd_resp_set_hdr(request, "X-Entropi-Response-Ready-Us", ready);
  }
  httpd_resp_set_type(request, "image/jpeg");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Content-Disposition", "inline; filename=capture.jpg");
  esp_err_t result = httpd_resp_send(request, reinterpret_cast<const char *>(photo.data), photo.length);
  free(photo.data);
  return result;
}

static esp_err_t previewHandler(httpd_req_t *request) {
  if (printerBusy() || !cameraReady || !lockCamera()) return unavailable(request, "Camera is unavailable");
  PhotoFrame photo;
  int64_t cutoff = esp_timer_get_time(), deadline = cutoff + 1500000;
  for (unsigned attempt = 0; attempt < 4 && !photo.data; attempt++) {
    camera_fb_t *frame = waitForFrame(deadline);
    if (!frame) break;
    int64_t timestamp = int64_t(frame->timestamp.tv_sec) * 1000000 + frame->timestamp.tv_usec;
    if (timestamp >= cutoff && frameMatches(frame, previewSize)) copyFrame(frame, photo);
    esp_camera_fb_return(frame);
  }
  previewResult(photo.data != nullptr);
  unlockCamera();
  if (!photo.data) return unavailable(request, "No fresh preview frame");
  httpd_resp_set_type(request, "image/jpeg");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  esp_err_t result = httpd_resp_send(request, reinterpret_cast<const char *>(photo.data), photo.length);
  free(photo.data);
  return result;
}

struct PeerRequest {
  NetworkClient client;
  int64_t requestedUs = 0;
  int64_t headersUs = 0;
  int64_t deadline = 0;
};

static void peerIdle() {
  vTaskDelay(1);
}

static bool beginPeerRequest(PeerRequest &request, const String &origin, const String &path, int64_t timeoutUs = 5000000, const char *method = "GET") {
  if (!origin.startsWith("http://")) return false;
  String host = origin.substring(7);
  if (!request.client.connect(host.c_str(), 80, 1000)) return false;
  timeval timeout = {2, 0};
  if (setsockopt(request.client.fd(), SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout))) return false;
  request.requestedUs = esp_timer_get_time();
  request.deadline = request.requestedUs + timeoutUs;
  String text = String(method) + " " + path + " HTTP/1.0\r\nHost: " + host + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
  return request.client.print(text) == text.length();
}

static bool readPeerResponse(PeerRequest &request, size_t limit, uint8_t **body, size_t *size,
                             StereoHeaders &headers, const char *pair = nullptr, const char *camera = nullptr, unsigned expectedStatus = 200) {
  *body = nullptr;
  *size = 0;
  if (!stereoReadHeaders(request.client, headers, limit, request.deadline, esp_timer_get_time, peerIdle, expectedStatus)) return false;
  request.headersUs = esp_timer_get_time();
  if (pair && !headers.captureMatches(pair, camera)) return false;
  size_t length = static_cast<size_t>(headers.length);
  if (!length) return true;
  uint8_t *buffer = static_cast<uint8_t *>(heap_caps_malloc(length + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!buffer) buffer = static_cast<uint8_t *>(malloc(length + 1));
  if (!buffer) return false;
  if (!stereoReadBody(request.client, buffer, length, request.deadline, esp_timer_get_time, peerIdle)) {
    free(buffer);
    return false;
  }
  buffer[length] = 0;
  *body = buffer;
  *size = length;
  return true;
}

static bool peerGet(const String &origin, const String &path, size_t limit, uint8_t **body, size_t *size, int64_t timeoutUs = 5000000) {
  *body = nullptr;
  *size = 0;
  PeerRequest request;
  StereoHeaders headers;
  return beginPeerRequest(request, origin, path, timeoutUs) && readPeerResponse(request, limit, body, size, headers);
}

static bool checkedPeerStatus(String &origin, String &id, String &status) {
  origin = rigIsPrimary() ? rigPeerOrigin() : "http://192.168.4.1";
  id = rigPeerId();
  if (!origin.length() || !stereoHex(id.c_str(), 12)) return false;
  uint8_t *data = nullptr;
  size_t length = 0;
  bool ok = peerGet(origin, "/status", 2048, &data, &length, 2000000) && length;
  if (ok) status = String(reinterpret_cast<const char *>(data));
  free(data);
  return ok && id == rigPeerId() && (!rigIsPrimary() || origin == rigPeerOrigin()) &&
         status.indexOf("\"camera_id\":" + quoted(id.c_str())) >= 0;
}

static bool requestPeerRecovery(String &status, bool &requested) {
  requested = false;
  if (!rigIsPrimary() || printerBusy()) return false;
  String origin, id;
  if (!checkedPeerStatus(origin, id, status)) return false;
  if (status.indexOf("\"camera_ready\":true") >= 0) return true;
  PeerRequest request;
  StereoHeaders headers;
  uint8_t *data = nullptr;
  size_t length = 0;
  bool ok = beginPeerRequest(request, origin, "/recover", 3000000, "POST") &&
            readPeerResponse(request, 2048, &data, &length, headers, nullptr, nullptr, 202) && length;
  if (ok) status = String(reinterpret_cast<const char *>(data));
  free(data);
  requested = ok && id == rigPeerId() && origin == rigPeerOrigin() &&
              status.indexOf("\"camera_id\":" + quoted(id.c_str())) >= 0;
  return requested;
}

static esp_err_t peerRecoverHandler(httpd_req_t *request) {
  String status;
  bool requested;
  if (!requestPeerRecovery(status, requested)) return unavailable(request, "Paired camera is busy or unavailable");
  if (requested) httpd_resp_set_status(request, "202 Accepted");
  return sendJson(request, status);
}

void serialPeerCheck() {
  String origin, id, status;
  if (checkedPeerStatus(origin, id, status)) { Serial.print("PEER_STATUS "); Serial.println(status); }
  else Serial.println("PEER_ERROR unavailable");
}

void serialPeerRetry() {
  String status;
  bool requested;
  if (!requestPeerRecovery(status, requested)) { Serial.println("PEER_RETRY unavailable"); return; }
  Serial.println(requested ? "PEER_RETRY queued" : "PEER_RETRY already_ready");
  Serial.print("PEER_STATUS "); Serial.println(status);
}

struct StereoPair {
  PhotoFrame local;
  PhotoFrame peer;
  char id[33] = {};
  char localId[13] = {};
  char peerId[13] = {};
  int64_t peerRequestedUs = 0;
  int64_t peerHeadersUs = 0;
  int64_t peerReadyUs = 0;
  bool primary = false;
  bool locked = false;
};

static void freeStereoPair(StereoPair &pair) {
  free(pair.local.data);
  free(pair.peer.data);
  pair.local.data = pair.peer.data = nullptr;
  if (pair.locked) xSemaphoreGive(stereoMutex);
  pair.locked = false;
}

static bool captureStereoPair(StereoPair &pair, const char *&error) {
  error = "BUSY";
  if (printerBusy() || !stereoMutex || xSemaphoreTake(stereoMutex, 0) != pdTRUE) return false;
  pair.locked = true;
  pair.primary = rigIsPrimary();
  String origin = pair.primary ? rigPeerOrigin() : "http://192.168.4.1";
  snprintf(pair.localId, sizeof(pair.localId), "%012llx", static_cast<unsigned long long>(ESP.getEfuseMac()));
  snprintf(pair.peerId, sizeof(pair.peerId), "%s", rigPeerId());
  snprintf(pair.id, sizeof(pair.id), "%08lx%08lx%08lx%08lx", static_cast<unsigned long>(esp_random()),
           static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  error = "PEER_OFFLINE";
  if (!origin.length() || !stereoHex(pair.peerId, 12)) return false;
  framesize_t requestedSize = photoSize;
  uint8_t *data = nullptr;
  size_t length = 0;
  if (!peerGet(origin, "/status", 2048, &data, &length) || !length) {
    free(data);
    return false;
  }
  String status(reinterpret_cast<const char *>(data));
  free(data);
  data = nullptr;
  error = "PEER_ID_OR_SENSOR";
  if (status.indexOf("\"camera_id\":" + quoted(pair.peerId)) < 0 || status.indexOf("\"camera_ready\":true") < 0) return false;
  if (status.indexOf("\"photo_framesize\":" + String(static_cast<int>(requestedSize)) + ",") < 0) {
    error = "RESOLUTION";
    if (!peerGet(origin, "/control?var=photo_framesize&val=" + String(static_cast<int>(requestedSize)), 2048, &data, &length)) {
      free(data);
      return false;
    }
    free(data);
    data = nullptr;
  }
  PeerRequest request;
  StereoHeaders headers;
  error = "PEER_CAPTURE";
  if (!beginPeerRequest(request, origin, "/capture?pair=" + String(pair.id), 12000000)) return false;
  pair.peerRequestedUs = request.requestedUs;
  error = "LOCAL_CAPTURE";
  if (!capturePhoto(pair.local, requestedSize, STEREO_MAX_JPEG)) return false;
  error = "PEER_CAPTURE";
  if (!readPeerResponse(request, STEREO_MAX_JPEG, &pair.peer.data, &pair.peer.length, headers, pair.id, pair.peerId)) return false;
  pair.peer.startedUs = headers.startedUs;
  pair.peer.capturedUs = headers.capturedUs;
  pair.peerReadyUs = headers.readyUs;
  pair.peerHeadersUs = request.headersUs;
  unsigned w1 = 0, h1 = 0, w2 = 0, h2 = 0;
  error = "SIZE_OR_JPEG";
  if (!jpegDimensions(pair.local.data, pair.local.length, w1, h1) ||
      !jpegDimensions(pair.peer.data, pair.peer.length, w2, h2) || w1 != w2 || h1 != h2) return false;
  error = "PEER_CHANGED";
  return !strcmp(pair.peerId, rigPeerId()) && (!pair.primary || origin == rigPeerOrigin());
}

static String stereoTiming(const StereoPair &pair) {
  const PhotoFrame &left = pair.primary ? pair.local : pair.peer;
  const PhotoFrame &right = pair.primary ? pair.peer : pair.local;
  char timing[640];
  snprintf(timing, sizeof(timing), "{\"left_capture_us\":%lld,\"right_capture_us\":%lld,\"left_capture_duration_us\":%lld,\"right_capture_duration_us\":%lld,\"coordinator_camera_id\":\"%s\",\"peer_requested_us\":%lld,\"peer_headers_received_us\":%lld,\"peer_request_started_us\":%lld,\"peer_response_ready_us\":%lld,\"hardware_synchronized\":false}",
           static_cast<long long>(left.capturedUs), static_cast<long long>(right.capturedUs),
           static_cast<long long>(left.capturedUs - left.startedUs), static_cast<long long>(right.capturedUs - right.startedUs), pair.localId,
           static_cast<long long>(pair.peerRequestedUs), static_cast<long long>(pair.peerHeadersUs),
           static_cast<long long>(pair.peer.startedUs), static_cast<long long>(pair.peerReadyUs));
  return String(timing);
}

static esp_err_t stereoCaptureHandler(httpd_req_t *request) {
  StereoPair pair;
  const char *error;
  if (!captureStereoPair(pair, error)) {
    freeStereoPair(pair);
    return unavailable(request, error);
  }
  const PhotoFrame &left = pair.primary ? pair.local : pair.peer;
  const PhotoFrame &right = pair.primary ? pair.peer : pair.local;
  char leftSize[16], rightSize[16];
  snprintf(leftSize, sizeof(leftSize), "%u", static_cast<unsigned>(left.length));
  snprintf(rightSize, sizeof(rightSize), "%u", static_cast<unsigned>(right.length));
  String timing = stereoTiming(pair);
  httpd_resp_set_type(request, "application/octet-stream");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "X-Entropi-Pair-Id", pair.id);
  httpd_resp_set_hdr(request, "X-Entropi-Left-Length", leftSize);
  httpd_resp_set_hdr(request, "X-Entropi-Right-Length", rightSize);
  httpd_resp_set_hdr(request, "X-Entropi-Left-Id", pair.primary ? pair.localId : pair.peerId);
  httpd_resp_set_hdr(request, "X-Entropi-Right-Id", pair.primary ? pair.peerId : pair.localId);
  httpd_resp_set_hdr(request, "X-Entropi-Timing", timing.c_str());
  esp_err_t result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(left.data), left.length);
  if (result == ESP_OK) result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(right.data), right.length);
  if (result == ESP_OK) result = httpd_resp_send_chunk(request, nullptr, 0);
  freeStereoPair(pair);
  return result;
}

#if defined(ENTROPI_USB_STEREO_TEST) && ENTROPI_USB_STEREO_TEST
void serialCameraPhoto() {
  PhotoFrame photo;
  if (printerBusy() || !capturePhoto(photo, photoSize, STEREO_MAX_JPEG)) {
    Serial.println("PHOTO_ERROR CAPTURE");
    return;
  }
  Serial.printf("PHOTO_META {\"camera_id\":\"%012llx\",\"captured_us\":%lld,\"bytes\":%u}\n",
                static_cast<unsigned long long>(ESP.getEfuseMac()),
                static_cast<long long>(photo.capturedUs), static_cast<unsigned>(photo.length));
  Serial.printf("PHOTO_BEGIN %u\n", static_cast<unsigned>(photo.length));
  for (size_t offset = 0; offset < photo.length; offset += 512) {
    size_t count = photo.length - offset < 512 ? photo.length - offset : 512;
    Serial.write(photo.data + offset, count);
    pollRigNetwork();
    delay(1);
  }
  Serial.print("PHOTO_END\n");
  free(photo.data);
}

void serialStereoPair() {
  StereoPair pair;
  const char *error;
  if (!captureStereoPair(pair, error)) {
    freeStereoPair(pair);
    Serial.printf("PAIR_ERROR %s\n", error);
    return;
  }
  const PhotoFrame &left = pair.primary ? pair.local : pair.peer;
  const PhotoFrame &right = pair.primary ? pair.peer : pair.local;
  String timing = stereoTiming(pair);
  Serial.printf("PAIR_META {\"id\":\"%s\",\"left_camera_id\":\"%s\",\"right_camera_id\":\"%s\",%s\n", pair.id,
                pair.primary ? pair.localId : pair.peerId, pair.primary ? pair.peerId : pair.localId, timing.c_str() + 1);
  Serial.printf("PAIR_BEGIN %u %u\n", static_cast<unsigned>(left.length), static_cast<unsigned>(right.length));
  for (const PhotoFrame *photo : {&left, &right}) {
    for (size_t n = 0; n < photo->length; n += 512) {
      size_t chunk = photo->length - n < 512 ? photo->length - n : 512;
      Serial.write(photo->data + n, chunk);
      pollRigNetwork();
      delay(1);
    }
  }
  Serial.print("PAIR_END\n");
  freeStereoPair(pair);
}
#endif

static esp_err_t peerHandler(httpd_req_t *request) {
  String origin = rigIsPrimary() ? rigPeerOrigin() : "";
  if (!origin.length()) return unavailable(request, "Paired camera is unavailable");
  uint8_t *data = nullptr;
  size_t length = 0;
  if (!peerGet(origin, "/status", 2048, &data, &length) || !length)
    return unavailable(request, "Paired camera did not respond");
  String status(reinterpret_cast<const char *>(data));
  free(data);
  if (status.indexOf("\"camera_id\":" + quoted(rigPeerId())) < 0 || origin != rigPeerOrigin())
    return unavailable(request, "Paired camera identity did not match");
  if (!strncmp(request->uri, "/peer/status", 12)) return sendJson(request, status);
  if (status.indexOf("\"camera_ready\":true") < 0 || status.indexOf("\"stream_ready\":true") < 0 || printerBusy())
    return unavailable(request, "Paired camera is not ready");
  bool capture = !strncmp(request->uri, "/peer/capture", 13);
  if (capture && status.indexOf("\"photo_framesize\":" + String(static_cast<int>(photoSize)) + ",") < 0) {
    if (!peerGet(origin, "/control?var=photo_framesize&val=" + String(static_cast<int>(photoSize)), 2048, &data, &length))
      return unavailable(request, "Paired camera resolution could not be matched");
    free(data);
  }
  if (!peerGet(origin, capture ? "/capture" : "/preview", 1024 * 1024, &data, &length) || length < 4) {
    free(data);
    return unavailable(request, "Paired camera image was unavailable");
  }
  unsigned width = 0, height = 0;
  bool valid = jpegDimensions(data, length, width, height) && origin == rigPeerOrigin();
  esp_err_t result;
  if (valid) {
    httpd_resp_set_type(request, "image/jpeg");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    result = httpd_resp_send(request, reinterpret_cast<const char *>(data), length);
  } else result = unavailable(request, "Paired camera did not provide a complete image");
  free(data);
  return result;
}

static esp_err_t assetHandler(httpd_req_t *request) {
  size_t length = strcspn(request->uri, "?");
  for (const CameraAsset &asset : cameraAssets) {
    if (!asset.data || strlen(asset.uri) != length || strncmp(asset.uri, request->uri, length)) continue;
    httpd_resp_set_type(request, asset.type);
    httpd_resp_set_hdr(request, "Content-Encoding", "gzip");
    httpd_resp_set_hdr(request, "Cache-Control", "no-cache");
    return httpd_resp_send(request, reinterpret_cast<const char *>(asset.data), asset.length);
  }
  return httpd_resp_send_err(request, HTTPD_404_NOT_FOUND, "Asset was not found");
}

static esp_err_t streamHandler(httpd_req_t *request) {
  sampleStreamStack();
  if (printerBusy()) return unavailable(request, "Printer is busy");
  if (!cameraReady) return unavailable(request, "Camera is unavailable");
  httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=entropi-frame");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  StreamActivity activity;
  unsigned staleFrames = 0;
  while (cameraReady && !recovering && !printerBusy()) {
    PhotoFrame photo;
    if (!lockCamera(250)) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    camera_fb_t *frame = cameraReady ? waitForFrame(esp_timer_get_time() + 1000000) : nullptr;
    bool stale = frame && !frameMatches(frame, previewSize);
    bool success = frame && !stale && copyFrame(frame, photo);
    if (frame) esp_camera_fb_return(frame);
    if (success) previewResult(true);
    else if (!stale || ++staleFrames >= 4) previewResult(false);
    unlockCamera();
    if (stale && staleFrames < 4) continue;
    if (!success) break;
    staleFrames = 0;
    char header[128];
    int length = snprintf(header, sizeof(header), "\r\n--entropi-frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", static_cast<unsigned>(photo.length));
    esp_err_t result = httpd_resp_send_chunk(request, header, length);
    if (result == ESP_OK) result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(photo.data), photo.length);
    free(photo.data);
    sampleStreamStack();
    if (result != ESP_OK) return result;
    activity.sent();
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

static esp_err_t portalHandler(httpd_req_t *request) {
  sockaddr_in local = {};
  socklen_t length = sizeof(local);
  if (!rigIsPrimary() || getsockname(httpd_req_to_sockfd(request), reinterpret_cast<sockaddr *>(&local), &length) != 0 ||
      local.sin_family != AF_INET || local.sin_addr.s_addr != static_cast<uint32_t>(WiFi.softAPIP()))
    return httpd_resp_send_err(request, HTTPD_404_NOT_FOUND, "Not found");
  httpd_resp_set_status(request, "302 Found");
  httpd_resp_set_hdr(request, "Location", "http://192.168.4.1/");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  return httpd_resp_send(request, "", 0);
}

static bool registerHandler(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *), httpd_method_t method = HTTP_GET) {
  httpd_uri_t route = {};
  route.uri = uri;
  route.method = method;
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
  for (;;) {
    cameraMaintenance();
    int64_t cutoff = 0;
    if (!printerBusy() && printerCameraCheckRequested(cutoff)) {
      unsigned width = 0, height = 0;
      size_t length = 0;
      bool valid = false, soi = false, eoi = false, fresh = false;
      if (lockCamera(500)) {
        int64_t deadline = esp_timer_get_time() + 1000000;
        for (unsigned attempt = 0; attempt < 4 && cameraReady; attempt++) {
          camera_fb_t *frame = waitForFrame(deadline);
          if (!frame) break;
          int64_t timestamp = int64_t(frame->timestamp.tv_sec) * 1000000 + frame->timestamp.tv_usec;
          length = frame->len;
          fresh = timestamp >= cutoff;
          soi = length >= 2 && frame->buf[0] == 0xff && frame->buf[1] == 0xd8;
          eoi = length >= 2 && frame->buf[length - 2] == 0xff && frame->buf[length - 1] == 0xd9;
          valid = fresh && jpegDimensions(frame->buf, length, width, height);
          esp_camera_fb_return(frame);
          if (fresh) break;
        }
        unlockCamera();
      }
      portENTER_CRITICAL(&stateMux);
      int32_t streamFree = streamStackFree == UINT32_MAX ? -1 : static_cast<int32_t>(streamStackFree);
      portEXIT_CRITICAL(&stateMux);
      Serial.printf("Printer camera check: valid=%u fresh=%u jpeg=%ux%u bytes=%u SOI=%u EOI=%u internal=%u largest=%u psram=%u stream_stack_min_free=%ld\n", valid, fresh, width, height, static_cast<unsigned>(length), soi, eoi, static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)), static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)), static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)), static_cast<long>(streamFree));
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void startCameraServer() {
  startPrinterBridge();
  cameraMutex = xSemaphoreCreateMutex();
  stereoMutex = xSemaphoreCreateMutex();
  hasPsram = psramFound();
  photoSize = hasPsram ? FRAMESIZE_UXGA : FRAMESIZE_QVGA;
  preferencesReady = preferences.begin("entropi", false);
  if (preferencesReady) {
    int savedPreview = preferences.getInt("framesize", FRAMESIZE_QVGA);
    int savedBrightness = preferences.getInt("brightness", 0);
    if (previewAllowed(savedPreview)) previewSize = static_cast<framesize_t>(savedPreview);
    brightness = constrain(savedBrightness, -2, 2);
    ledDuty = constrain(preferences.getInt("led_intensity", 0), 0, 255);
  }
#if defined(LED_GPIO_NUM)
  ledcAttachChannel(LED_GPIO_NUM, 5000, 8, 7);
  setLed(false);
#endif
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.max_open_sockets = 4;
  config.max_uri_handlers = 16;
  config.uri_match_fn = httpd_uri_match_wildcard;
  config.stack_size = 8192;
  config.send_wait_timeout = 3;
  config.recv_wait_timeout = 3;
  config.lru_purge_enable = true;
  if (httpd_start(&cameraHttpd, &config) == ESP_OK) {
    registerHandler(cameraHttpd, "/", indexHandler);
    registerHandler(cameraHttpd, "/status", statusHandler);
    registerHandler(cameraHttpd, "/recover", recoverHandler, HTTP_POST);
    registerHandler(cameraHttpd, "/control", controlHandler);
    registerHandler(cameraHttpd, "/capture", captureHandler);
    registerHandler(cameraHttpd, "/stereo/capture", stereoCaptureHandler);
    registerHandler(cameraHttpd, "/preview", previewHandler);
    registerHandler(cameraHttpd, "/peer/status", peerHandler);
    registerHandler(cameraHttpd, "/peer/recover", peerRecoverHandler, HTTP_POST);
    registerHandler(cameraHttpd, "/peer/preview", peerHandler);
    registerHandler(cameraHttpd, "/peer/capture", peerHandler);
    registerHandler(cameraHttpd, "/apple-touch-icon.png", assetHandler);
    registerHandler(cameraHttpd, "/pointcloud/*", assetHandler);
    registerHandler(cameraHttpd, "/print", printerUploadHandler, HTTP_POST);
    registerHandler(cameraHttpd, "/print-status", printerStatusHandler);
    registerHandler(cameraHttpd, "/*", portalHandler);
  } else {
    setServerError("Could not start HTTP server");
  }
  config.server_port++;
  config.ctrl_port++;
  config.max_open_sockets = 1;
  config.stack_size = 4096;
  if (httpd_start(&streamHttpd, &config) == ESP_OK) {
    if (!registerHandler(streamHttpd, "/stream", streamHandler)) {
      httpd_stop(streamHttpd);
      streamHttpd = nullptr;
    }
  } else setServerError("Could not start stream server");
  if (!cameraMutex || xTaskCreate(deviceWorker, "entropi-device", 8192, nullptr, 1, nullptr) != pdPASS)
    cameraMessage("Could not start camera maintenance");
}
