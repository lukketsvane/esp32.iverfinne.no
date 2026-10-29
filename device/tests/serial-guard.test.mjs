import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL('../EntropiCamera/'+name,import.meta.url),'utf8').then(text=>text.replaceAll('\r\n','\n'));
const body=(source,signature)=>{
  const start=source.indexOf(signature);assert.ok(start>=0,signature);
  let depth=0;
  for(let i=source.indexOf('{',start);i<source.length;i++){
    if(source[i]==='"'||source[i]==="'"){const quote=source[i];for(i++;i<source.length&&source[i]!==quote;i++)if(source[i]==='\\')i++;continue}
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  assert.fail('Unterminated '+signature);
};

for(const [name,prefix,signature] of [['serialStereoPair','PAIR','void serialStereoPair()'],['sendSerialPhoto','PHOTO','static void sendSerialPhoto(PhotoFrame &photo)']])test(`${name} keeps other serial output out of its binary frames`,async()=>{
  const code=body(await read('app_httpd.cpp'),signature);
  const begin=code.indexOf('beginSerialBinary()'),meta=code.indexOf(`"${prefix}_META `),end=code.indexOf(`"${prefix}_END\\n"`),release=code.indexOf('endSerialBinary()');
  assert.ok(begin>0&&begin<meta,'the line is held before the metadata line');
  assert.ok(end>0&&end<release,'the line is released after the end marker');
  for(const match of code.matchAll(/Serial\.write\(/g))assert.ok(match.index>begin&&match.index<release,'every binary write happens while the line is held');
  assert.equal((code.match(/endSerialBinary\(\)/g)||[]).length,1);
  assert.match(code,/if \(!beginSerialBinary\(\)\) \{[^}]*Serial\.println\("[A-Z]+_ERROR SERIAL"\);\s*return;/);
});

test('Wi-Fi events skip their diagnostic line instead of interleaving with a binary frame',async()=>{
  const code=body(await read('EntropiCamera.ino'),'void networkEvent(');
  const lines=code.split('\n');
  assert.match(lines[1],/^\s*if \(!trySerialText\(\)\) return;$/);
  assert.match(lines.at(-2),/^\s*endSerialText\(\);$/);
  assert.equal((code.match(/\breturn\b/g)||[]).length,1,'no early return can keep the line held');
  const setup=body(await read('EntropiCamera.ino'),'void setup()');
  assert.ok(setup.indexOf('beginSerialGuard()')<setup.indexOf('WiFi.onEvent(networkEvent)'));
});

test('a binary frame mutes the ROM printf and restores it afterwards',async()=>{
  const guard=await read('serial_guard.cpp');
  assert.match(body(guard,'bool beginSerialBinary()'),/xSemaphoreTake\(serialMutex, pdMS_TO_TICKS\(1000\)\)[\s\S]*Serial\.setDebugOutput\(false\)/);
  assert.match(body(guard,'void endSerialBinary()'),/Serial\.flush\(\);\s*Serial\.setDebugOutput\(true\);\s*xSemaphoreGive\(serialMutex\);/);
  assert.match(body(guard,'bool trySerialText()'),/xSemaphoreTake\(serialMutex, 0\)/);
});

test('camera-photo and camera-preview share the guarded photo framing in USB test builds only',async()=>{
  const server=await read('app_httpd.cpp'),sketch=await read('EntropiCamera.ino');
  for(const name of ['serialCameraPhoto','serialCameraPreview']){
    const code=body(server,`void ${name}()`);
    assert.match(code,/sendSerialPhoto\(photo\);/);assert.doesNotMatch(code,/Serial\.write\(/);
  }
  assert.match(body(server,'void serialCameraPreview()'),/capturePreview\(photo\)/);
  const usb=sketch.slice(sketch.indexOf('#if defined(ENTROPI_USB_STEREO_TEST) && ENTROPI_USB_STEREO_TEST\n      else if'));
  assert.match(usb.slice(0,usb.indexOf('#endif')),/"camera-preview"\)\) serialCameraPreview\(\);/);
});

test('printer diagnostics from the printer task skip their line during a binary frame',async()=>{
  const printer=await read('px10_printer.cpp');
  assert.match(printer,/#define PRINTER_LOG\(\.\.\.\) do \{ if \(trySerialText\(\)\) \{ Serial\.printf\(__VA_ARGS__\); endSerialText\(\); \} \} while \(0\)/);
  assert.equal((printer.match(/Serial\.print/g)||[]).length,1,'only the guarded macro writes to Serial');
});
