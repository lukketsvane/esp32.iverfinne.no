#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <ctype.h>

static constexpr size_t STEREO_MAX_JPEG = 1024 * 1024;

static bool stereoHex(const char *value, size_t length) {
  if (!value || strlen(value) != length) return false;
  for (size_t i = 0; i < length; i++)
    if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
  return true;
}

static bool stereoNumber(const char *value, int64_t &number) {
  if (!value || !*value) return false;
  int64_t result = 0;
  for (; *value; value++) {
    if (*value < '0' || *value > '9' || result > (INT64_MAX - (*value - '0')) / 10) return false;
    result = result * 10 + (*value - '0');
  }
  number = result;
  return true;
}

struct StereoHeaders {
  int64_t length = -1;
  int64_t capturedUs = -1;
  int64_t startedUs = -1;
  int64_t readyUs = -1;
  char pair[33] = {};
  char camera[13] = {};
  bool jpeg = false;
  bool hasType = false;

  bool add(char *line) {
    char *value = strchr(line, ':');
    if (!value || value == line) return false;
    *value++ = 0;
    for (char *p = line; *p; p++) *p = static_cast<char>(tolower(static_cast<unsigned char>(*p)));
    while (*value == ' ' || *value == '\t') value++;
    char *end = value + strlen(value);
    while (end > value && (end[-1] == ' ' || end[-1] == '\t')) *--end = 0;
    if (!strcmp(line, "transfer-encoding")) return false;
    if (!strcmp(line, "content-length")) return length < 0 && stereoNumber(value, length);
    if (!strcmp(line, "content-type")) {
      if (hasType) return false;
      hasType = true;
      jpeg = !strcmp(value, "image/jpeg");
    } else if (!strcmp(line, "x-entropi-pair-id")) {
      if (*pair || !stereoHex(value, 32)) return false;
      memcpy(pair, value, sizeof(pair));
    } else if (!strcmp(line, "x-entropi-camera-id")) {
      if (*camera || !stereoHex(value, 12)) return false;
      memcpy(camera, value, sizeof(camera));
    } else if (!strcmp(line, "x-entropi-capture-us")) {
      return capturedUs < 0 && stereoNumber(value, capturedUs);
    } else if (!strcmp(line, "x-entropi-capture-started-us")) {
      return startedUs < 0 && stereoNumber(value, startedUs);
    } else if (!strcmp(line, "x-entropi-response-ready-us")) {
      return readyUs < 0 && stereoNumber(value, readyUs);
    }
    return true;
  }

  bool captureMatches(const char *expectedPair, const char *expectedCamera) const {
    return length >= 4 && length <= static_cast<int64_t>(STEREO_MAX_JPEG) && jpeg &&
           stereoHex(expectedPair, 32) && stereoHex(expectedCamera, 12) &&
           !strcmp(pair, expectedPair) && !strcmp(camera, expectedCamera) &&
           startedUs >= 0 && capturedUs >= startedUs && readyUs >= capturedUs;
  }
};

template <typename Client>
static bool stereoReadLine(Client &client, char *line, size_t capacity, int64_t deadline,
                           int64_t (*now)(), void (*idle)()) {
  if (!line || capacity < 2) return false;
  size_t used = 0;
  while (now() < deadline) {
    if (client.available()) {
      int next = client.read();
      if (next < 0) return false;
      if (next == '\n') {
        if (used && line[used - 1] == '\r') used--;
        line[used] = 0;
        return true;
      }
      if ((next < 32 && next != '\r' && next != '\t') || used + 1 >= capacity) return false;
      line[used++] = static_cast<char>(next);
    } else {
      if (!client.connected()) return false;
      idle();
    }
  }
  return false;
}

template <typename Client>
static bool stereoReadHeaders(Client &client, StereoHeaders &headers, size_t limit, int64_t deadline,
                              int64_t (*now)(), void (*idle)(), unsigned expectedStatus = 200) {
  char line[512];
  if (!stereoReadLine(client, line, sizeof(line), deadline, now, idle) || strlen(line) < 13 ||
      (strncmp(line, "HTTP/1.0 ", 9) && strncmp(line, "HTTP/1.1 ", 9)) || line[12] != ' ' ||
      expectedStatus < 100 || expectedStatus > 599 ||
      line[9] != static_cast<char>('0' + expectedStatus / 100) ||
      line[10] != static_cast<char>('0' + expectedStatus / 10 % 10) ||
      line[11] != static_cast<char>('0' + expectedStatus % 10)) return false;
  size_t bytes = 0;
  for (unsigned i = 0; i < 48; i++) {
    if (!stereoReadLine(client, line, sizeof(line), deadline, now, idle)) return false;
    if (!*line) return headers.length >= 0 && static_cast<uint64_t>(headers.length) <= limit;
    bytes += strlen(line);
    if (bytes > 8192 || !headers.add(line)) return false;
  }
  return false;
}

template <typename Client>
static bool stereoReadBody(Client &client, uint8_t *body, size_t length, int64_t deadline,
                           int64_t (*now)(), void (*idle)()) {
  size_t used = 0;
  while (used < length && now() < deadline) {
    int available = client.available();
    if (available > 0) {
      size_t count = static_cast<size_t>(available);
      if (count > length - used) count = length - used;
      int read = client.read(body + used, count);
      if (read <= 0) return false;
      used += static_cast<size_t>(read);
    } else {
      if (!client.connected()) return false;
      idle();
    }
  }
  return used == length;
}
