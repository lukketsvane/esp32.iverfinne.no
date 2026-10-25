#pragma once
#include <Arduino.h>

void beginRigNetwork();
void pollRigNetwork();
void checkRigNetwork();
String rigPeerOrigin();
const char *rigPeerId();
bool rigIsPrimary();
