#include "capture_button.h"
#include "capture_button_state.h"

#ifndef ENTROPI_SECONDARY_CAMERA
#define ENTROPI_SECONDARY_CAMERA 0
#endif
// A normally open push button between this pin and GND acts as the shutter on the primary camera.
// GPIO13 and GPIO14 are free while the microSD slot is unused and neither is a boot strapping pin.
// Build with -DENTROPI_BUTTON_GPIO=-1 to disable the button.
#ifndef ENTROPI_BUTTON_GPIO
#define ENTROPI_BUTTON_GPIO (ENTROPI_SECONDARY_CAMERA ? -1 : 13)
#endif
#if ENTROPI_BUTTON_GPIO >= 0 && ENTROPI_BUTTON_GPIO != 13 && ENTROPI_BUTTON_GPIO != 14
#error "ENTROPI_BUTTON_GPIO must be 13, 14 or -1 on the AI Thinker ESP32-CAM"
#endif

static portMUX_TYPE buttonMux = portMUX_INITIALIZER_UNLOCKED;
static CaptureButtonState buttonState;
static bool buttonRunning = false;

static void buttonWorker(void *) {
  for (;;) {
    bool low = digitalRead(ENTROPI_BUTTON_GPIO) == LOW;
    uint32_t now = millis();
    portENTER_CRITICAL(&buttonMux);
    buttonState.sample(low, now);
    portEXIT_CRITICAL(&buttonMux);
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

void beginCaptureButton() {
#if ENTROPI_BUTTON_GPIO >= 0
  pinMode(ENTROPI_BUTTON_GPIO, INPUT_PULLUP);
  buttonRunning = xTaskCreate(buttonWorker, "entropi-button", 2048, nullptr, 1, nullptr) == pdPASS;
#endif
}

bool captureButtonSnapshot(CaptureButtonSnapshot &snapshot) {
  if (!buttonRunning) return false;
  uint32_t now = millis();
  portENTER_CRITICAL(&buttonMux);
  snapshot.pin = ENTROPI_BUTTON_GPIO;
  snapshot.pressed = buttonState.pressed;
  snapshot.presses = buttonState.presses;
  uint32_t age = now - buttonState.pressedAt;
  portEXIT_CRITICAL(&buttonMux);
  snapshot.ageMs = !snapshot.presses ? -1 : age > INT32_MAX ? INT32_MAX : static_cast<int32_t>(age);
  return true;
}

void checkCaptureButton() {
  CaptureButtonSnapshot snapshot;
  if (!captureButtonSnapshot(snapshot)) {
    Serial.println("Button: disabled");
    return;
  }
  Serial.printf("Button: gpio=%d pressed=%u presses=%lu age_ms=%ld\n", snapshot.pin, snapshot.pressed,
                static_cast<unsigned long>(snapshot.presses), static_cast<long>(snapshot.ageMs));
}
