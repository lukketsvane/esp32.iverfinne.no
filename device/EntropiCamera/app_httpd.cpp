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
#include "esp_timer.h"
#include "freertos/semphr.h"
#include "camera_ui.h"
#include "camera_assets.h"
#include "board_config.h"
#include "jpeg_frame.h"
#include "px10_printer.h"

static httpd_handle_t cameraHttpd = nullptr;
static httpd_handle_t streamHttpd = nullptr;
static SemaphoreHandle_t cameraMutex = nullptr;
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
static uint32_t streamStackFree = UINT32_MAX;
struct PhotoFrame {
  uint8_t *data = nullptr;
  size_t length = 0;
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
  json += "}";
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
  int64_t deadline = cutoff + 3000000;
  if (configured) {
    for (unsigned attempt = 0; attempt < 4; attempt++) {
      camera_fb_t *frame = waitForFrame(deadline);
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
  if (printerBusy()) return unavailable(request, "Printer is busy");
  PhotoFrame photo;
  if (!capturePhoto(photo)) return unavailable(request, "Could not capture photo");
  httpd_resp_set_type(request, "image/jpeg");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Content-Disposition", "inline; filename=capture.jpg");
  esp_err_t result = httpd_resp_send(request, reinterpret_cast<const char *>(photo.data), photo.length);
  free(photo.data);
  return result;
}

static esp_err_t assetHandler(httpd_req_t *request) {
  size_t length = strcspn(request->uri, "?");
  for (const CameraAsset &asset : cameraAssets) {
    if (!asset.data || strlen(asset.uri) != length || strncmp(asset.uri, request->uri, length)) continue;
    httpd_resp_set_type(request, asset.type);
    httpd_resp_set_hdr(request, "Content-Encoding", "gzip");
    httpd_resp_set_hdr(request, "Cache-Control", "public, max-age=86400");
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
    sampleStreamStack();
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
  } else if (!hasPsram) {
    photoSize = FRAMESIZE_QVGA;
  }
#if defined(LED_GPIO_NUM)
  ledcAttachChannel(LED_GPIO_NUM, 5000, 8, 7);
  setLed(false);
#endif
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.max_open_sockets = 4;
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
    registerHandler(cameraHttpd, "/pointcloud/*", assetHandler);
    registerHandler(cameraHttpd, "/print", printerUploadHandler, HTTP_POST);
    registerHandler(cameraHttpd, "/print-status", printerStatusHandler);
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
