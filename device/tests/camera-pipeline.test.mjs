import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const compiler=['c++','g++','clang++'].find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);
const source=await readFile(new URL('../EntropiCamera/app_httpd.cpp',import.meta.url),'utf8');
function body(start){
  const offset=source.indexOf(start),open=source.indexOf('{',offset);
  assert.ok(offset>=0);
  let depth=1,end=open+1;
  while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++}
  return source.slice(offset,end);
}

test('native capture separates quality, rejects stale frames, restores settings and reuses preview memory',{
  skip:compiler?false:'No native C++ host compiler is installed.',
},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'entropi-camera-'));
  const file=join(folder,'camera.cpp'),program=join(folder,process.platform==='win32'?'camera.exe':'camera');
  try{
    await writeFile(file,`#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <utility>
using framesize_t=int;
static constexpr int FRAMESIZE_QVGA=5,FRAMESIZE_UXGA=13;
static constexpr int MALLOC_CAP_SPIRAM=1,MALLOC_CAP_8BIT=2;
static int previewSize=FRAMESIZE_QVGA,photoSize=FRAMESIZE_UXGA,previewQuality=14,photoQuality=8,ledDuty=0;
static bool cameraReady=true,locked=false,busy=false,busyOnLock=false,failAllocation=false;
static int64_t clockUs=1000000;
static unsigned allocations=0,returned=0,delayed=0,failures=0,recoveryAttempts=2;
static int failedSize=-1,failedQuality=-1;
static std::vector<bool> lights;
static std::vector<std::pair<char,int>> settings;
struct sensor_t { int (*set_framesize)(sensor_t *,framesize_t); int (*set_quality)(sensor_t *,int); };
static int setSize(sensor_t *,framesize_t value){settings.push_back({'s',value});return value==failedSize?-1:0;}
static int setQuality(sensor_t *,int value){settings.push_back({'q',value});return value==failedQuality?-1:0;}
static sensor_t sensor={setSize,setQuality};
static sensor_t *esp_camera_sensor_get(){return &sensor;}
static int64_t esp_timer_get_time(){return clockUs;}
static bool printerBusy(){return busy;}
static bool lockCamera(unsigned){locked=true;if(busyOnLock)busy=true;return true;}
static void unlockCamera(){assert(locked);locked=false;}
static void setLed(bool value){lights.push_back(value);}
static unsigned pdMS_TO_TICKS(unsigned value){return value;}
static void vTaskDelay(unsigned value){delayed+=value;clockUs+=value*1000;}
static void cameraSucceeded(){failures=0;}
static void setCameraError(const char *){failures++;}
struct camera_fb_t { uint8_t *buf;size_t len;struct {int64_t tv_sec,tv_usec;} timestamp;framesize_t size;};
static uint8_t pixels[16384]={1,2,3,4};
static std::vector<camera_fb_t> frames;
static size_t position=0;
static void enqueue(int64_t age,framesize_t size=FRAMESIZE_UXGA,size_t length=1024){
  int64_t stamp=clockUs+age;
  frames.push_back({pixels,length,{stamp/1000000,stamp%1000000},size});
}
static camera_fb_t *waitForFrame(int64_t deadline){
  if(position==frames.size()){clockUs=deadline;return nullptr;}
  clockUs+=10000;return &frames[position++];
}
static bool frameMatches(camera_fb_t *frame,framesize_t size){return frame->size==size;}
static void esp_camera_fb_return(camera_fb_t *){returned++;}
static void *allocateBytes(size_t length){allocations++;return failAllocation?nullptr:std::malloc(length);}
static void *heap_caps_malloc(size_t length,int){return allocateBytes(length);}
${body('struct PhotoFrame')} ;
#define malloc allocateBytes
${body('static bool copyFrame(')}
${body('static bool capturePhoto(')}
#undef malloc
static void reset(){
  frames.clear();settings.clear();lights.clear();position=returned=delayed=failures=allocations=0;
  clockUs=1000000;cameraReady=true;locked=busy=busyOnLock=failAllocation=false;
  failedSize=failedQuality=-1;ledDuty=0;recoveryAttempts=2;
}
static void restored(){
  assert(!locked&&!lights.empty()&&!lights.back());
  assert(settings[settings.size()-2]==std::make_pair('s',previewSize));
  assert(settings.back()==std::make_pair('q',previewQuality));
}
int main(){
  reset();
  enqueue(-10000);enqueue(1000,FRAMESIZE_QVGA);enqueue(2000);enqueue(3000);
  PhotoFrame photo;
  assert(capturePhoto(photo)&&photo.capturedUs==1003000&&returned==4&&delayed==0);
  assert(settings.front()==std::make_pair('s',photoSize)&&settings[1]==std::make_pair('q',photoQuality));
  assert(recoveryAttempts==0&&photo.length==1024&&photo.capacity==4096);restored();
  uint8_t *original=photo.data;unsigned before=allocations;
  camera_fb_t small={pixels,3000,{1,4000},FRAMESIZE_QVGA};
  for(int i=0;i<100;i++)assert(copyFrame(&small,photo));
  assert(allocations==before&&photo.data==original&&photo.length==3000);
  small.len=5000;assert(copyFrame(&small,photo)&&photo.capacity==8192&&allocations==before+1);
  original=photo.data;failAllocation=true;small.len=12000;pixels[0]=9;
  assert(!copyFrame(&small,photo)&&photo.data==original&&photo.length==5000&&photo.capacity==8192&&photo.data[0]==1);
  free(photo.data);pixels[0]=1;
  reset();enqueue(1000,FRAMESIZE_QVGA);PhotoFrame same;
  assert(capturePhoto(same,FRAMESIZE_QVGA)&&returned==1&&delayed==0);restored();free(same.data);
  reset();ledDuty=100;enqueue(100000);enqueue(160000);enqueue(170000);PhotoFrame flash;
  assert(capturePhoto(flash)&&flash.capturedUs==1170000&&delayed==150);restored();free(flash.data);
  reset();for(int i=0;i<6;i++)enqueue(-10000);enqueue(1000);enqueue(2000);PhotoFrame queued;
  assert(capturePhoto(queued)&&returned==8);restored();free(queued.data);
  reset();enqueue(1000);enqueue(2000);PhotoFrame oversized;
  assert(!capturePhoto(oversized,photoSize,100)&&!oversized.data&&failures==1);restored();
  reset();enqueue(-1000);PhotoFrame timeout;
  assert(!capturePhoto(timeout)&&clockUs==4000000&&failures==1);restored();
  reset();failedQuality=photoQuality;PhotoFrame unavailable;
  assert(!capturePhoto(unavailable)&&position==0&&failures==1);restored();
  reset();failedSize=photoSize;PhotoFrame resolution;
  assert(!capturePhoto(resolution)&&position==0&&failures==1);restored();
  reset();failedSize=previewSize;enqueue(1000);enqueue(2000);PhotoFrame recovery;
  assert(capturePhoto(recovery)&&!cameraReady&&failures==1);restored();free(recovery.data);
  reset();failedQuality=previewQuality;enqueue(1000);enqueue(2000);PhotoFrame quality;
  assert(capturePhoto(quality)&&!cameraReady&&failures==1);restored();free(quality.data);
  reset();busy=true;PhotoFrame printing;
  assert(!capturePhoto(printing)&&!locked&&settings.empty());
  reset();busyOnLock=true;
  assert(!capturePhoto(printing)&&!locked&&settings.empty());
  reset();failAllocation=true;enqueue(1000);enqueue(2000);PhotoFrame memory;
  assert(!capturePhoto(memory)&&!memory.data&&failures==1);restored();
}
`);
    const compiled=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',...(process.platform==='win32'?['-static']:[]),file,'-o',program],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(program,[],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr||run.error?.message);
  }finally{
    assert.equal(resolve(dirname(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('entropi-camera-'));
    await rm(folder,{recursive:true,force:true});
  }
});
