#pragma once

#include <stdint.h>

// Debounces an active-low push button sampled at a steady interval. A button held during
// start-up is ignored until it has been released once.
struct CaptureButtonState {
  static const uint32_t settleMs = 30;
  bool started = false, armed = false, candidate = false, pressed = false;
  uint32_t changedAt = 0, pressedAt = 0, presses = 0;

  bool sample(bool low, uint32_t nowMs) {
    if (!started || low != candidate) {
      started = true;
      candidate = low;
      changedAt = nowMs;
      return false;
    }
    if (nowMs - changedAt < settleMs || (armed && candidate == pressed)) return false;
    bool press = armed && candidate && !pressed;
    pressed = candidate;
    if (!pressed) armed = true;
    if (press) {
      presses++;
      pressedAt = nowMs;
    }
    return press;
  }
};
