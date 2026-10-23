#pragma once

#include "esp_http_server.h"
#include <stdint.h>

void startPrinterBridge();
bool printerBusy();
void requestPrinterCheck();
bool printerCameraCheckRequested(int64_t &cutoff);
esp_err_t printerUploadHandler(httpd_req_t *request);
esp_err_t printerStatusHandler(httpd_req_t *request);
