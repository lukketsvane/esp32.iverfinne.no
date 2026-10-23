#include <Arduino.h>
#include <WiFi.h>
#include "px10_printer.h"

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
      used = 0;
    } else if (byte != '\r') {
      if (used + 1 < sizeof(command)) command[used++] = byte;
      else used = 0;
    }
  }
  delay(2);
}
