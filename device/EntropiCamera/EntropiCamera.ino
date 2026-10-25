#include <Arduino.h>
#include <WiFi.h>
#include "esp_bt.h"
#include "esp_heap_caps.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_wifi_ap_get_sta_list.h"
#include "px10_printer.h"
#include "rig_network.h"

#ifndef ENTROPI_SECONDARY_CAMERA
#define ENTROPI_SECONDARY_CAMERA 0
#endif

const char *ssid = "ENTROPI";

void startCameraServer();
#if defined(ENTROPI_USB_STEREO_TEST) && ENTROPI_USB_STEREO_TEST
void serialStereoPair();
#endif

void networkCheck() {
#if ENTROPI_SECONDARY_CAMERA || (defined(ENTROPI_WIFI_SSID) && defined(ENTROPI_WIFI_PASSWORD))
  Serial.printf("Network: station=%s IP=%s RSSI=%d\n", WiFi.status() == WL_CONNECTED ? "connected" : "disconnected",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
#endif
#if !ENTROPI_SECONDARY_CAMERA
  esp_netif_t *ap = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
  esp_netif_ip_info_t ip = {};
  esp_netif_dhcp_status_t dhcp = ESP_NETIF_DHCP_INIT;
  esp_err_t ipResult = ap ? esp_netif_get_ip_info(ap, &ip) : ESP_FAIL;
  esp_err_t dhcpResult = ap ? esp_netif_dhcps_get_status(ap, &dhcp) : ESP_FAIL;
  Serial.printf("Network: IP=" IPSTR " mask=" IPSTR " gateway=" IPSTR " ip_result=%s DHCP=%s dhcp_result=%s internal=%u largest=%u BT=%u\n",
                IP2STR(&ip.ip), IP2STR(&ip.netmask), IP2STR(&ip.gw), esp_err_to_name(ipResult),
                dhcp == ESP_NETIF_DHCP_STARTED ? "started" : "stopped", esp_err_to_name(dhcpResult),
                static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
                static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)),
                static_cast<unsigned>(esp_bt_controller_get_status()));
  wifi_sta_list_t clients = {};
  wifi_sta_mac_ip_list_t leases = {};
  esp_err_t result = esp_wifi_ap_get_sta_list(&clients);
  if (result == ESP_OK) result = esp_wifi_ap_get_sta_list_with_ip(&clients, &leases);
  Serial.printf("Network: clients=%d leases=%d result=%s\n", clients.num, leases.num, esp_err_to_name(result));
  for (int i = 0; i < leases.num; i++) {
    const auto &client = leases.sta[i];
    Serial.printf("Network: client=%02x:%02x:%02x:%02x:%02x:%02x IP=" IPSTR "\n",
                  client.mac[0], client.mac[1], client.mac[2], client.mac[3], client.mac[4], client.mac[5], IP2STR(&client.ip));
  }
#endif
}

void networkEvent(arduino_event_id_t event, arduino_event_info_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf("Entropi %s: http://" IPSTR "/\n", ENTROPI_SECONDARY_CAMERA ? "second camera" : "local Wi-Fi", IP2STR(&info.got_ip.ip_info.ip));
  } else if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    Serial.printf("Network: disconnected reason=%u\n", info.wifi_sta_disconnected.reason);
  } else if (event == ARDUINO_EVENT_WIFI_AP_STACONNECTED) {
    const auto &client = info.wifi_ap_staconnected;
    Serial.printf("Network: joined %02x:%02x:%02x:%02x:%02x:%02x\n",
                  client.mac[0], client.mac[1], client.mac[2], client.mac[3], client.mac[4], client.mac[5]);
  } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
    const auto &client = info.wifi_ap_stadisconnected;
    Serial.printf("Network: left %02x:%02x:%02x:%02x:%02x:%02x reason=%u\n",
                  client.mac[0], client.mac[1], client.mac[2], client.mac[3], client.mac[4], client.mac[5], client.reason);
  } else if (event == ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED) {
    const auto &client = info.wifi_ap_staipassigned;
    Serial.printf("Network: assigned %02x:%02x:%02x:%02x:%02x:%02x IP=" IPSTR "\n",
                  client.mac[0], client.mac[1], client.mac[2], client.mac[3], client.mac[4], client.mac[5], IP2STR(&client.ip));
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.onEvent(networkEvent);
#if ENTROPI_SECONDARY_CAMERA
  WiFi.mode(WIFI_STA);
#elif defined(ENTROPI_WIFI_SSID) && defined(ENTROPI_WIFI_PASSWORD)
  WiFi.mode(WIFI_AP_STA);
#else
  WiFi.mode(WIFI_AP);
#endif
#if !ENTROPI_SECONDARY_CAMERA
  if (!WiFi.softAP(ssid)) {
    Serial.println("Could not start Wi-Fi");
  }
#endif
#if defined(ENTROPI_WIFI_SSID) && defined(ENTROPI_WIFI_PASSWORD)
  WiFi.setAutoReconnect(true);
  WiFi.begin(ENTROPI_WIFI_SSID, ENTROPI_WIFI_PASSWORD);
#elif ENTROPI_SECONDARY_CAMERA
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid);
#endif
  beginRigNetwork();
  startCameraServer();
#if defined(ENTROPI_WIFI_SSID) && defined(ENTROPI_WIFI_PASSWORD)
  Serial.println("Entropi: joining local Wi-Fi");
#elif ENTROPI_SECONDARY_CAMERA
  Serial.println("Entropi: joining ENTROPI as the second camera");
#endif
#if !ENTROPI_SECONDARY_CAMERA
  Serial.print("Entropi: http://");
  Serial.println(WiFi.softAPIP());
#endif
}

void loop() {
  pollRigNetwork();
  static char command[20];
  static unsigned used = 0;
  static uint32_t lastByte = 0;
  if (used && millis() - lastByte > 1000) used = 0;
  for (unsigned count = 0; count < 32 && Serial.available(); count++) {
    char byte = Serial.read();
    lastByte = millis();
    if (byte == '\n') {
      command[used] = 0;
      if (!strcmp(command, "printer-check")) requestPrinterCheck();
      else if (!strcmp(command, "network-check")) networkCheck();
      else if (!strcmp(command, "rig-check")) checkRigNetwork();
#if defined(ENTROPI_USB_STEREO_TEST) && ENTROPI_USB_STEREO_TEST
      else if (!strcmp(command, "stereo-snap")) serialStereoPair();
#endif
      used = 0;
    } else if (byte != '\r') {
      if (used + 1 < sizeof(command)) command[used++] = byte;
      else used = 0;
    }
  }
  delay(2);
}
