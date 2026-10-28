import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const compiler=[process.env.CXX,'c++','g++','clang++'].filter(Boolean).find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);

test('the capture button debounces contact bounce, ignores a button held at start-up and survives millis() wrap',{
  skip:compiler?false:'No native C++ host compiler is installed; run with CXX or on the Linux test host.',
},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'entropi-button-'));
  const header=fileURLToPath(new URL('../EntropiCamera/capture_button_state.h',import.meta.url)).replaceAll('\\','/');
  const source=join(folder,'button.cpp'),program=join(folder,process.platform==='win32'?'button.exe':'button');
  try{
    await writeFile(source,`#include <cassert>
#include ${JSON.stringify(header)}
bool hold(CaptureButtonState &button,bool low,uint32_t &t,uint32_t duration){bool fired=false;for(uint32_t end=t+duration;t!=end;t+=5)fired|=button.sample(low,t);return fired;}
int main(){
  CaptureButtonState button;uint32_t t=0;
  assert(!hold(button,false,t,100));
  for(int i=0;i<6;i++,t+=5)assert(!button.sample(i%2==0,t));
  assert(button.presses==0&&!button.pressed);
  assert(hold(button,true,t,40));assert(button.presses==1&&button.pressed&&button.pressedAt>=t-15);
  assert(!hold(button,true,t,500));assert(button.presses==1);
  assert(!hold(button,false,t,40));assert(!button.pressed);
  assert(hold(button,true,t,40));assert(button.presses==2);
  assert(!hold(button,false,t,20));assert(!hold(button,true,t,20));assert(button.presses==2);
  CaptureButtonState held;t=0;
  assert(!hold(held,true,t,500));assert(held.presses==0);
  assert(!hold(held,false,t,40));assert(hold(held,true,t,40));assert(held.presses==1);
  CaptureButtonState wrap;t=UINT32_MAX-99;
  assert(!hold(wrap,false,t,100));assert(t<1000);assert(hold(wrap,true,t,40));assert(wrap.presses==1);
}
`);
    const compiled=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',...(process.platform==='win32'?['-static']:[]),source,'-o',program],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(program,[],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr||run.error?.message);
  }finally{
    assert.equal(resolve(dirname(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('entropi-button-'));
    await rm(folder,{recursive:true,force:true});
  }
});

test('only the primary reads the button, on a pin that is neither a camera nor a boot strapping pin',async()=>{
  const source=await readFile(new URL('../EntropiCamera/capture_button.cpp',import.meta.url),'utf8');
  const pins=await readFile(new URL('../EntropiCamera/camera_pins.h',import.meta.url),'utf8');
  assert.match(source,/#define ENTROPI_BUTTON_GPIO \(ENTROPI_SECONDARY_CAMERA \? -1 : 13\)/);
  assert.match(source,/ENTROPI_BUTTON_GPIO != 13 && ENTROPI_BUTTON_GPIO != 14\r?\n#error/);
  assert.match(source,/pinMode\(ENTROPI_BUTTON_GPIO, INPUT_PULLUP\)/);
  const used=[...pins.matchAll(/#define \w+_GPIO_NUM\s+(-?\d+)/g)].map(match=>Number(match[1]));
  for(const pin of [13,14])assert.equal(used.includes(pin),false,`GPIO${pin} is used by the camera`);
});
