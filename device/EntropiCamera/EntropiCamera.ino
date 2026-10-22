#include <Arduino.h>
#include <WiFi.h>

const char *ssid = "ENTROPI";

void startCameraServer();

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(ssid)) {
    Serial.println("Could not start Wi-Fi");
  }
  startCameraServer();
  Serial.print("Entropi: http://");
  Serial.println(WiFi.softAPIP());
}

void loop() {
  delay(2);
}
