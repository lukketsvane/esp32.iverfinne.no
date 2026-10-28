#include "rig_network.h"
#include <WiFi.h>
#include <WiFiUdp.h>
#include "esp_random.h"
#include "mbedtls/md.h"

#ifndef ENTROPI_SECONDARY_CAMERA
#define ENTROPI_SECONDARY_CAMERA 0
#endif
#ifndef ENTROPI_RIG_KEY
#define ENTROPI_RIG_KEY ""
#endif
#ifndef ENTROPI_PRIMARY_ID
#define ENTROPI_PRIMARY_ID ""
#endif
#ifndef ENTROPI_SECONDARY_ID
#define ENTROPI_SECONDARY_ID ""
#endif

static constexpr uint16_t rigPort = 45832;
static constexpr uint32_t peerLifetime = 12000;
static const char *ownId = ENTROPI_SECONDARY_CAMERA ? ENTROPI_SECONDARY_ID : ENTROPI_PRIMARY_ID;
static const char *expectedId = ENTROPI_SECONDARY_CAMERA ? ENTROPI_PRIMARY_ID : ENTROPI_SECONDARY_ID;
static WiFiUDP rigUdp, dnsUdp;
static bool configured = false, rigListening = false, dnsListening = false, dnsAdvertised = false, usingFallback = false;
static uint32_t lastChallenge = 0, lastBind = 0, lastConnected = 0;
static uint8_t challenge[16];
static portMUX_TYPE peerMux = portMUX_INITIALIZER_UNLOCKED;
static uint32_t peerAddress = 0, peerSeen = 0;

struct RigPacket {
  char magic[4];
  uint8_t type;
  char sender[12];
  char receiver[12];
  uint8_t address[4];
  uint8_t nonce[16];
  uint8_t signature[32];
};

static_assert(sizeof(RigPacket) == 81);

bool rigIsPrimary() {
  return !ENTROPI_SECONDARY_CAMERA;
}

const char *rigPeerId() {
  return configured ? expectedId : "";
}

String rigPeerOrigin() {
  portENTER_CRITICAL(&peerMux);
  uint32_t address = peerAddress, seen = peerSeen;
  portEXIT_CRITICAL(&peerMux);
  if (!address || uint32_t(millis() - seen) >= peerLifetime) return "";
  return "http://" + IPAddress(address).toString();
}

void checkRigNetwork() {
  char actualId[13];
  snprintf(actualId, sizeof(actualId), "%012llx", static_cast<unsigned long long>(ESP.getEfuseMac()));
  Serial.printf("Rig: own=%s expected_peer=%s configured=%u primary=%u peer=%s udp=%u dns=%u dhcp_dns=%u fallback=%u\n",
                actualId, expectedId, configured, rigIsPrimary(), rigPeerOrigin().c_str(), rigListening, dnsListening, dnsAdvertised, usingFallback);
  if (WiFi.status() == WL_CONNECTED) Serial.printf("Rig network: gateway=%s dns=%s\n", WiFi.gatewayIP().toString().c_str(), WiFi.dnsIP().toString().c_str());
}

static bool validId(const char *value) {
  if (strlen(value) != 12) return false;
  for (unsigned i = 0; i < 12; i++) {
    if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
  }
  return true;
}

static bool signature(const RigPacket &packet, uint8_t *output) {
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  return info && mbedtls_md_hmac(info, reinterpret_cast<const uint8_t *>(ENTROPI_RIG_KEY), strlen(ENTROPI_RIG_KEY),
                               reinterpret_cast<const uint8_t *>(&packet), offsetof(RigPacket, signature), output) == 0;
}

static void rememberPeer(IPAddress address, uint32_t now) {
  portENTER_CRITICAL(&peerMux);
  peerAddress = uint32_t(address);
  peerSeen = now;
  portEXIT_CRITICAL(&peerMux);
}

static void sendPacket(IPAddress destination, IPAddress source, uint8_t type, const uint8_t *nonce) {
  RigPacket packet = {};
  memcpy(packet.magic, "ENT1", 4);
  packet.type = type;
  memcpy(packet.sender, ownId, 12);
  memcpy(packet.receiver, expectedId, 12);
  for (unsigned i = 0; i < 4; i++) packet.address[i] = source[i];
  memcpy(packet.nonce, nonce, sizeof(packet.nonce));
  if (!signature(packet, packet.signature) || !rigUdp.beginPacket(destination, rigPort)) return;
  rigUdp.write(reinterpret_cast<const uint8_t *>(&packet), sizeof(packet));
  rigUdp.endPacket();
}

static void receivePeers(uint32_t now) {
  for (unsigned handled = 0; handled < 4; handled++) {
    int length = rigUdp.parsePacket();
    if (!length) break;
    IPAddress source = rigUdp.remoteIP();
    RigPacket packet = {};
    int received = length == sizeof(packet) ? rigUdp.read(reinterpret_cast<uint8_t *>(&packet), sizeof(packet)) : 0;
    rigUdp.clear();
    if (received != sizeof(packet) || memcmp(packet.magic, "ENT1", 4) || memcmp(packet.sender, expectedId, 12) ||
        memcmp(packet.receiver, ownId, 12) || packet.type != (rigIsPrimary() ? 2 : 1)) continue;
    bool sameAddress = true;
    for (unsigned i = 0; i < 4; i++) sameAddress &= packet.address[i] == source[i];
    if (!sameAddress) continue;
    uint8_t expected[32], difference = 0;
    if (!signature(packet, expected)) continue;
    for (unsigned i = 0; i < sizeof(expected); i++) difference |= expected[i] ^ packet.signature[i];
    if (difference || (rigIsPrimary() && memcmp(packet.nonce, challenge, sizeof(challenge)))) continue;
    rememberPeer(source, now);
    if (!rigIsPrimary() && WiFi.status() == WL_CONNECTED) sendPacket(source, WiFi.localIP(), 2, packet.nonce);
  }
}

static void receiveDns() {
  for (unsigned handled = 0; handled < 2; handled++) {
    int length = dnsUdp.parsePacket();
    if (!length) break;
    IPAddress client = dnsUdp.remoteIP();
    uint16_t port = dnsUdp.remotePort();
    uint8_t data[512];
    int received = length <= sizeof(data) ? dnsUdp.read(data, sizeof(data)) : 0;
    dnsUdp.clear();
    if (received < 17 || (data[2] & 0xf8) || data[4] != 0 || data[5] != 1) continue;
    size_t end = 12;
    while (end < size_t(received) && data[end] && data[end] <= 63 && end + data[end] + 1 < size_t(received)) end += data[end] + 1;
    if (end >= size_t(received) || data[end] || end + 5 > size_t(received)) continue;
    end++;
    uint16_t type = (uint16_t(data[end]) << 8) | data[end + 1];
    if (data[end + 2] != 0 || data[end + 3] != 1) continue;
    end += 4;
    if (end > sizeof(data) - 16) continue;
    data[2] = 0x84 | (data[2] & 1);
    data[3] = 0;
    memset(data + 6, 0, 6);
    if (type == 1) {
      data[7] = 1;
      const uint8_t answer[] = {0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4};
      memcpy(data + end, answer, sizeof(answer));
      end += sizeof(answer);
      IPAddress address = WiFi.softAPIP();
      for (unsigned i = 0; i < 4; i++) data[end++] = address[i];
    }
    if (!dnsUdp.beginPacket(client, port)) continue;
    dnsUdp.write(data, end);
    dnsUdp.endPacket();
  }
}

void beginRigNetwork() {
  char actualId[13];
  snprintf(actualId, sizeof(actualId), "%012llx", static_cast<unsigned long long>(ESP.getEfuseMac()));
  configured = validId(ownId) && validId(expectedId) && strcmp(ownId, expectedId) && !strcmp(ownId, actualId) &&
               strlen(ENTROPI_RIG_KEY) >= 16 && strlen(ENTROPI_RIG_KEY) <= 128;
  if (rigIsPrimary()) {
    IPAddress address = WiFi.softAPIP();
    dnsAdvertised = WiFi.softAPConfig(address, WiFi.AP.gatewayIP(), WiFi.softAPSubnetMask(), IPAddress(), address);
    dnsListening = dnsUdp.begin(address, 53);
  }
  if (configured) rigListening = rigUdp.begin(rigPort);
  lastConnected = millis();
  lastBind = lastConnected;
  lastChallenge = lastConnected - 3000;
}

void pollRigNetwork() {
  uint32_t now = millis();
#if ENTROPI_SECONDARY_CAMERA
  if (WiFi.status() == WL_CONNECTED) lastConnected = now;
  else if (uint32_t(now - lastConnected) >= 15000) {
    lastConnected = now;
#if defined(ENTROPI_WIFI_SSID) && defined(ENTROPI_WIFI_PASSWORD)
    if (!usingFallback) {
      usingFallback = true;
      WiFi.setAutoReconnect(false);
      WiFi.disconnect();
      WiFi.begin("ENTROPI");
      WiFi.setAutoReconnect(true);
    } else
#endif
    {
      WiFi.reconnect();
    }
    rememberPeer(IPAddress(), now);
  }
#endif
  if (uint32_t(now - lastBind) >= 5000) {
    lastBind = now;
    if (configured && !rigListening) rigListening = rigUdp.begin(rigPort);
    if (rigIsPrimary() && !dnsListening) dnsListening = dnsUdp.begin(WiFi.softAPIP(), 53);
  }
  if (dnsListening) receiveDns();
  if (!rigListening) return;
  receivePeers(now);
  if (rigIsPrimary() && uint32_t(now - lastChallenge) >= 3000) {
    lastChallenge = now;
    esp_fill_random(challenge, sizeof(challenge));
    sendPacket(WiFi.softAPBroadcastIP(), WiFi.softAPIP(), 1, challenge);
    if (WiFi.status() == WL_CONNECTED) sendPacket(WiFi.broadcastIP(), WiFi.localIP(), 1, challenge);
  }
}
