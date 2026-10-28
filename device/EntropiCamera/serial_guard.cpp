#include "serial_guard.h"
#include <Arduino.h>
#include "freertos/semphr.h"

static SemaphoreHandle_t serialMutex = nullptr;

void beginSerialGuard() {
  if (!serialMutex) serialMutex = xSemaphoreCreateMutex();
}

bool beginSerialBinary() {
  if (!serialMutex || xSemaphoreTake(serialMutex, pdMS_TO_TICKS(1000)) != pdTRUE) return false;
  Serial.flush();
  // The camera driver reports frame overflows through the ROM printf, which bypasses Serial.
  Serial.setDebugOutput(false);
  return true;
}

void endSerialBinary() {
  Serial.flush();
  Serial.setDebugOutput(true);
  xSemaphoreGive(serialMutex);
}

bool trySerialText() {
  return !serialMutex || xSemaphoreTake(serialMutex, 0) == pdTRUE;
}

void endSerialText() {
  if (serialMutex) xSemaphoreGive(serialMutex);
}
