#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

inline uint8_t px10Crc(const uint8_t *data, size_t length) {
  uint8_t crc = 0;
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (unsigned bit = 0; bit < 8; bit++) crc = uint8_t((crc << 1) ^ (crc & 128 ? 7 : 0));
  }
  return crc;
}

inline bool px10ReadPacket(const uint8_t *data, size_t length, size_t &offset,
                          uint8_t &opcode, const uint8_t *&payload, size_t &count) {
  if (offset > length || length - offset < 8) return false;
  const uint8_t *frame = data + offset;
  count = size_t(frame[4]) | (size_t(frame[5]) << 8);
  if (frame[0] != 0x51 || frame[1] != 0x78 || frame[3] != 0 || count > 48 || count > length - offset - 8) return false;
  payload = frame + 6;
  if (frame[7 + count] != 0xff || frame[6 + count] != px10Crc(payload, count)) return false;
  opcode = frame[2];
  offset += count + 8;
  return true;
}

inline bool px10Expected(const uint8_t *data, size_t length, size_t &offset,
                         uint8_t expected, uint8_t first, int second = -1) {
  uint8_t opcode;
  const uint8_t *payload;
  size_t count;
  return px10ReadPacket(data, length, offset, opcode, payload, count) && opcode == expected &&
    count == (second < 0 ? size_t(1) : size_t(2)) && payload[0] == first &&
    (second < 0 || payload[1] == second);
}

inline bool validatePx10Job(const uint8_t *data, size_t length) {
  if (!data || !length || length > 65536) return false;
  size_t offset = 0;
  if (!px10Expected(data, length, offset, 0xa4, 0x33) ||
      !px10Expected(data, length, offset, 0xaf, 0x88, 0x13) ||
      !px10Expected(data, length, offset, 0xbe, 0) ||
      !px10Expected(data, length, offset, 0xbd, 10)) return false;
  unsigned rows = 0;
  bool feed = false;
  while (offset < length) {
    uint8_t opcode;
    const uint8_t *payload;
    size_t count;
    if (!px10ReadPacket(data, length, offset, opcode, payload, count)) return false;
    if (feed) {
      if (opcode != 0xbd || count != 1 || payload[0] != 10) return false;
      feed = false;
    } else if (opcode == 0xa2 || opcode == 0xbf) {
      if (++rows > 1024 || !count || (opcode == 0xa2 && count != 48)) return false;
      if (opcode == 0xbf) {
        unsigned width = 0;
        for (size_t i = 0; i < count; i++) {
          if (!(payload[i] & 127)) return false;
          width += payload[i] & 127;
        }
        if (width != 384) return false;
      }
      feed = rows % 200 == 0;
    } else if (opcode == 0xbd && count == 1 && payload[0] == 12 && rows) {
      return px10Expected(data, length, offset, 0xa1, 0x30, 0) &&
        px10Expected(data, length, offset, 0xa1, 0x30, 0) &&
        px10Expected(data, length, offset, 0xbd, 12) &&
        px10Expected(data, length, offset, 0xa3, 0) && offset == length;
    } else return false;
  }
  return false;
}

inline bool px10JobId(const char *id, const char *boot, uint32_t &sequence) {
  sequence = 0;
  if (!id || !boot || strlen(id) != 32 || strlen(boot) != 16 || memcmp(id, boot, 16)) return false;
  for (unsigned i = 0; i < 32; i++) {
    const char digit = id[i];
    if (!((digit >= '0' && digit <= '9') || (digit >= 'a' && digit <= 'f'))) return false;
    if (i >= 16 && i < 24) sequence = (sequence << 4) | uint32_t(digit <= '9' ? digit - '0' : digit - 'a' + 10);
  }
  return sequence != 0;
}

class Px10FlowControl {
  uint8_t bytes[9] = {};
  size_t used = 0;
public:
  void reset() { used = 0; }
  void feed(const uint8_t *data, size_t length, bool &paused) {
    for (size_t i = 0; i < length; i++) {
      if (used == sizeof(bytes)) { memmove(bytes, bytes + 1, sizeof(bytes) - 1); used--; }
      bytes[used++] = data[i];
      if (used == sizeof(bytes) && bytes[0] == 0x51 && bytes[1] == 0x78 && bytes[2] == 0xae &&
          bytes[3] == 1 && bytes[4] == 1 && bytes[5] == 0 && bytes[8] == 0xff &&
          bytes[7] == px10Crc(bytes + 6, 1) && (bytes[6] == 0 || bytes[6] == 0x10)) {
        paused = bytes[6] == 0x10;
        used = 0;
      }
    }
  }
};
