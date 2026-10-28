#pragma once
#include <Arduino.h>

struct CaptureButtonSnapshot {
  int pin;
  bool pressed;
  uint32_t presses;
  int32_t ageMs;
};

void beginCaptureButton();
bool captureButtonSnapshot(CaptureButtonSnapshot &snapshot);
void checkCaptureButton();
