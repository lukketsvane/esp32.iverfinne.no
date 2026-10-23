#pragma once

#include <stddef.h>
#include <stdint.h>

static bool jpegDimensions(const uint8_t *data, size_t length, unsigned &width, unsigned &height) {
  width = height = 0;
  if (!data || length < 4 || data[0] != 0xff || data[1] != 0xd8 || data[length - 2] != 0xff || data[length - 1] != 0xd9) return false;
  size_t offset = 2;
  while (offset + 1 < length) {
    if (data[offset++] != 0xff) return false;
    while (offset < length && data[offset] == 0xff) offset++;
    if (offset >= length) return false;
    uint8_t marker = data[offset++];
    if (marker == 0 || marker == 0xd8 || marker == 0xd9 || marker == 0xda) return false;
    if (marker == 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (length - offset < 2) return false;
    size_t segment = (size_t(data[offset]) << 8) | data[offset + 1];
    if (segment < 2 || segment > length - offset) return false;
    bool startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;
    if (startOfFrame) {
      if (segment < 8 || !data[offset + 7] || segment != size_t(8 + 3 * data[offset + 7])) return false;
      unsigned nextHeight = (unsigned(data[offset + 3]) << 8) | data[offset + 4];
      unsigned nextWidth = (unsigned(data[offset + 5]) << 8) | data[offset + 6];
      if (!nextWidth || !nextHeight) return false;
      width = nextWidth;
      height = nextHeight;
      return true;
    }
    offset += segment;
  }
  return false;
}
