#pragma once

// USB stereo frames are counted in bytes, so text from another task in the middle of one corrupts it.
// Binary writers hold the line for the whole frame; asynchronous diagnostics skip their line meanwhile.
void beginSerialGuard();
bool beginSerialBinary();
void endSerialBinary();
bool trySerialText();
void endSerialText();
