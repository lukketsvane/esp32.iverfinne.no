import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {WIDTH,buildPrintJob,PacketDecoder,packet,joinBytes} from '../../vendor/print/px10-protocol.mjs';

const compiler=['c++','g++','clang++'].find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);
const frames=bytes=>new PacketDecoder().feed(bytes);
const encode=values=>joinBytes(values.map(value=>packet(value.opcode,value.payload)));

test('native printer validation accepts real JS jobs and rejects unsafe or malformed data before BLE',{
  skip:compiler?false:'No native C++ host compiler is installed; firmware compile still validates this header.',
},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'entropi-print-job-'));
  try{
    const valid=[buildPrintJob(new Uint8Array(WIDTH)),buildPrintJob(new Uint8Array(WIDTH).fill(1)),
      buildPrintJob(Uint8Array.from({length:WIDTH*201},(_,i)=>i%7<3?1:0)),
      buildPrintJob(new Uint8Array(WIDTH*200)),buildPrintJob(new Uint8Array(WIDTH*1024)),
      buildPrintJob(Uint8Array.from({length:WIDTH*1024},(_,i)=>i%2))];
    const row=valid[0],base=frames(row),unsafe=frames(row);unsafe[1].payload[0]=255;
    const wrongWidth=frames(row);wrongWidth[4].payload=new Uint8Array([127,127,127,2]);
    const zeroRun=frames(row);zeroRun[4].payload=new Uint8Array([0,127,127,127,3]);
    const shortPacked=frames(valid[5]);shortPacked[4].payload=new Uint8Array(47);
    const wrongFlag=row.slice();wrongFlag[3]=1;
    const corrupt=row.slice();corrupt[6]^=1;
    const unknown=base.slice();unknown.splice(5,0,{opcode:0xa6,payload:new Uint8Array([5])});
    const missingFeed=frames(valid[3]);missingFeed.splice(204,1);
    const extraFeed=base.slice();extraFeed.splice(4,0,{opcode:0xbd,payload:new Uint8Array([10])});
    const tooMany=frames(valid[4]);tooMany.splice(tooMany.length-5,0,base[4]);
    const invalid=[new Uint8Array(),new Uint8Array(65537),encode(unsafe),encode(wrongWidth),encode(zeroRun),
      encode(shortPacked),wrongFlag,corrupt,encode(unknown),encode(missingFeed),encode(extraFeed),encode(tooMany),
      joinBytes([row,packet(0xa3,[0])]),...Array.from({length:row.length},(_,length)=>row.slice(0,length)),
      ...[1,7,8,37,1024,valid[5].length-1].map(length=>valid[5].slice(0,length))];
    assert.ok(valid[5].length<=65536);
    const paths=[];
    for(const [index,bytes]of [...valid,...invalid].entries()){const path=join(folder,index+'.bin');await writeFile(path,bytes);paths.push(path)}
    const header=fileURLToPath(new URL('../EntropiCamera/px10_job.h',import.meta.url)).replaceAll('\\','/');
    const source=join(folder,'print-job.cpp'),program=join(folder,process.platform==='win32'?'print-job.exe':'print-job');
    await writeFile(source,`#include <cassert>
#include <fstream>
#include <iterator>
#include <vector>
#include ${JSON.stringify(header)}
int main(int argc,char **argv){
  for(int i=1;i<argc;i++){
    std::ifstream input(argv[i],std::ios::binary);
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)),std::istreambuf_iterator<char>());
    assert(validatePx10Job(bytes.data(),bytes.size())==(i<=${valid.length}));
  }
  assert(!validatePx10Job(nullptr,42));
  uint32_t sequence=0;
  assert(px10JobId("0123456789abcdef00000001abcdef12","0123456789abcdef",sequence)&&sequence==1);
  assert(px10JobId("0123456789abcdefffffffffabcdef12","0123456789abcdef",sequence)&&sequence==0xffffffff);
  for(const char *id : {"0123456789abcdef00000000abcdef12","0123456789abcdef00000001abcdef1", "0123456789abcdef00000001abcdef123", "0123456789abcdef00000001ABCDEF12", "0123456789abcdee00000001abcdef12"})
    assert(!px10JobId(id,"0123456789abcdef",sequence));
  assert(!px10JobId(nullptr,"0123456789abcdef",sequence));
  Px10FlowControl flow;bool paused=false;
  uint8_t pause[]={0x51,0x78,0xae,1,1,0,0x10,0x70,0xff};
  const uint8_t resume[]={0x51,0x78,0xae,1,1,0,0,0,0xff};
  flow.feed(pause,2,paused);assert(!paused);flow.feed(pause+2,7,paused);assert(paused);
  for(auto byte : resume){flow.feed(&byte,1,paused);}assert(!paused);
  pause[3]=0;flow.feed(pause,sizeof(pause),paused);assert(!paused);pause[3]=1;
  pause[7]^=1;flow.feed(pause,sizeof(pause),paused);assert(!paused);pause[7]^=1;
  const uint8_t noise[]={0,0xff,0x51};flow.feed(noise,sizeof(noise),paused);
  flow.feed(pause,sizeof(pause),paused);assert(paused);flow.feed(resume,sizeof(resume),paused);assert(!paused);
  flow.feed(pause,4,paused);flow.reset();flow.feed(pause+4,5,paused);assert(!paused);
}
`);
    const compiled=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',...(process.platform==='win32'?['-static']:[]),source,'-o',program],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(program,paths,{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
  }finally{
    assert.equal(resolve(dirname(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('entropi-print-job-'));
    await rm(folder,{recursive:true,force:true});
  }
});

test('native printer terminal cleanup releases BLE after retirement and keeps completed jobs final',{
  skip:compiler?false:'No native C++ host compiler is installed; CI executes the native lifecycle regression.',
},async()=>{
  const native=await readFile(new URL('../EntropiCamera/px10_printer.cpp',import.meta.url),'utf8');
  const take=name=>{
    const start=native.indexOf(`void ${name}(`),body=native.indexOf('{',start);let depth=1,end=body+1;
    assert.ok(start>=0);
    while(depth&&end<native.length){if(native[end]==='{')depth++;else if(native[end]==='}')depth--;end++}
    assert.equal(depth,0);return native.slice(start,end);
  };
  const folder=await mkdtemp(join(tmpdir(),'entropi-print-lifecycle-'));
  try{
    const source=join(folder,'lifecycle.cpp'),program=join(folder,process.platform==='win32'?'lifecycle.exe':'lifecycle');
    await writeFile(source,`#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <vector>
enum {ESP_OK=0,ESP_GATT_IF_NONE=-1,ESP_BLUEDROID_STATUS_UNINITIALIZED=0,ESP_BLUEDROID_STATUS_INITIALIZED=1,ESP_BLUEDROID_STATUS_ENABLED=2,ESP_BT_CONTROLLER_STATUS_IDLE=0,ESP_BT_CONTROLLER_STATUS_INITED=1,ESP_BT_CONTROLLER_STATUS_ENABLED=2,MALLOC_CAP_INTERNAL=1};
enum class State {QUEUED,SENDING,SENT,FAILED};enum class Phase {IDLE,WRITE};
struct Record {State state=State::SENDING;size_t bytes=0;const char *message="";};
struct Cancel {int gattc_if;uint8_t remote_bda[6];};using esp_ble_gattc_cancel_open_params_t=Cancel;
struct SerialType {template<typename... Args>void printf(const char *,Args...) {}} Serial;
struct Flow {void reset(){}} flow;
uint32_t now=0,retireDeadline=0,retireQuiet=0;uint32_t millis(){return now;}int64_t esp_timer_get_time(){return int64_t(now)*1000;}
bool expired(uint32_t target){return int32_t(now-target)>=0;}int locks=0;void lockJob(){locks++;}void unlockJob(){assert(locks==1);locks--;}
bool acceptScan=false,scanActive=false,retiringScan=false,openPending=false,retiringOpen=false,connected=false,channelReady=false,congested=false,queueFull=false,paused=false,eventOverflow=false;
bool cleaningUp=false,cleanupSuccess=false,cleanupDiagnostic=false,checking=false,initializationFailed=false;
const char *cleanupMessage="";uint8_t *jobData=nullptr;size_t jobLength=0,pendingLength=0,offset=0;unsigned cameraChecks=0;int64_t cameraCheckCutoff=0;
const uint16_t noConnection=0xffff;uint16_t connection=noConnection,retiringConnection=noConnection,writeHandle=0,notifyHandle=0,descriptorHandle=0,primaryStart=0,primaryEnd=0,secondaryStart=0,secondaryEnd=0,writeSize=20;
uint8_t peer[6]={};int client=ESP_GATT_IF_NONE,callbackMux=0,events=1,active=-1;Record records[8];Phase phase=Phase::IDLE;
void portENTER_CRITICAL(int*){}void portEXIT_CRITICAL(int*){}
int esp_ble_gap_stop_scanning(){return 0;}int esp_ble_gattc_cancel_open(Cancel*){return 0;}int esp_ble_gap_disconnect(uint8_t*){return 0;}int esp_ble_gattc_unregister_for_notify(int,uint8_t*,uint16_t){return 0;}int esp_ble_gattc_close(int,uint16_t){return 0;}
int host=ESP_BLUEDROID_STATUS_ENABLED,controller=ESP_BT_CONTROLLER_STATUS_ENABLED,failAt=0;std::vector<int>calls;
int esp_bluedroid_get_status(){return host;}int esp_bt_controller_get_status(){return controller;}
int esp_bluedroid_disable(){calls.push_back(1);if(failAt==1)return 1;host=ESP_BLUEDROID_STATUS_INITIALIZED;return 0;}
int esp_bluedroid_deinit(){calls.push_back(2);if(failAt==2)return 1;host=ESP_BLUEDROID_STATUS_UNINITIALIZED;return 0;}
int esp_bt_controller_disable(){calls.push_back(3);if(failAt==3)return 1;controller=ESP_BT_CONTROLLER_STATUS_INITED;return 0;}
int esp_bt_controller_deinit(){calls.push_back(4);if(failAt==4)return 1;controller=ESP_BT_CONTROLLER_STATUS_IDLE;return 0;}
void xQueueReset(int){calls.push_back(5);}size_t heap_caps_get_free_size(int){return 60000;}size_t heap_caps_get_largest_free_block(int){return 40000;}unsigned uxTaskGetStackHighWaterMark(void*){return 2048;}
#include <cstring>
${take('closeChannel')}
${take('finish')}
${take('cleanupBle')}
void reset(){now=100;calls.clear();failAt=0;host=2;controller=2;client=4;connected=channelReady=true;connection=7;retiringConnection=noConnection;retiringScan=retiringOpen=scanActive=openPending=false;retireQuiet=0;cleaningUp=false;initializationFailed=false;checking=true;cameraChecks=0;active=0;offset=100;jobLength=100;jobData=static_cast<uint8_t*>(malloc(100));records[0]=Record{};}
int main(){
  for(bool success:{false,true}){
    reset();finish(success,success?"":"stopped");assert(cleaningUp&&!checking&&!jobData&&active==0&&records[0].state==State::SENDING&&cameraChecks==0);
    cleanupBle();assert(calls.empty()&&cleaningUp);
    retiringConnection=noConnection;retireQuiet=now+100;now+=99;cleanupBle();assert(calls.empty()&&cleaningUp);
    now++;cleanupBle();assert((calls==std::vector<int>{1,2,3,4,5}));assert(!cleaningUp&&!initializationFailed&&host==0&&controller==0&&client==ESP_GATT_IF_NONE&&active==-1&&cameraChecks==3);
    assert(records[0].state==(success?State::SENT:State::FAILED)&&records[0].bytes==100);
  }
  reset();finish(false,"stopped");now=retireDeadline;cleanupBle();assert(!cleaningUp&&host==0&&controller==0&&retiringConnection==noConnection);
  for(int failure=1;failure<=4;failure++){
    reset();finish(true);failAt=failure;retiringConnection=noConnection;now=retireQuiet;cleanupBle();assert(!cleaningUp&&initializationFailed&&records[0].state==State::SENT&&calls.back()==failure);
  }
  reset();finish(true);retiringConnection=noConnection;now=retireQuiet;cleanupBle();host=2;controller=2;client=5;connected=channelReady=true;connection=8;active=1;offset=50;jobData=static_cast<uint8_t*>(malloc(50));jobLength=50;checking=false;
  finish(true);retiringConnection=noConnection;now=retireQuiet;cleanupBle();assert(!cleaningUp&&!initializationFailed&&records[1].state==State::SENT&&records[0].state==State::SENT&&locks==0);
}
`);
    const compiled=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',...(process.platform==='win32'?['-static']:[]),source,'-o',program],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(program,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
  }finally{
    assert.equal(resolve(dirname(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('entropi-print-lifecycle-'));
    await rm(folder,{recursive:true,force:true});
  }
});
