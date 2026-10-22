#include <Arduino.h>
#include <WiFi.h>
#include <DNSServer.h>

const char *ssid = "ENTROPI";
const char *password = "entropi2026";
DNSServer dnsServer;

void startCameraServer();

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(ssid, password)) {
    Serial.println("Could not start Wi-Fi");
  }
  dnsServer.start(53, "*", WiFi.softAPIP());
  startCameraServer();
  Serial.print("Entropi: http://");
  Serial.println(WiFi.softAPIP());
}

void loop() {
  dnsServer.processNextRequest();
  delay(2);
}
