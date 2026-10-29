import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8').then(text=>text.replaceAll('\r\n','\n'));

test('firmware reports the commit it was built from in /status and at boot',async()=>{
  const build=await read('device/build-ui.py'),server=await read('device/EntropiCamera/app_httpd.cpp'),ignore=await read('.gitignore');
  assert.match(build,/\["git", "describe", "--always", "--dirty", "--abbrev=7"\]/);
  assert.match(build,/re\.fullmatch\(r"\[0-9A-Za-z\._-\]\{1,40\}", version\)/,'only a safe version string reaches the C header');
  assert.match(build,/#define ENTROPI_FIRMWARE_VERSION/);
  assert.match(ignore,/^device\/EntropiCamera\/build_info\.h$/m);
  assert.match(server,/#if __has_include\("build_info\.h"\)\n#include "build_info\.h"\n#endif\n#ifndef ENTROPI_FIRMWARE_VERSION\n#define ENTROPI_FIRMWARE_VERSION "unknown"\n#endif/);
  assert.match(server,/json \+= ",\\"firmware\\":" \+ quoted\(ENTROPI_FIRMWARE_VERSION\);/);
  assert.match(server,/Serial\.printf\("Entropi firmware %s\\n", ENTROPI_FIRMWARE_VERSION\);/);
});
