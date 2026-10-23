import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
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
    const compiled=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',source,'-o',program],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(program,paths,{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
  }finally{
    assert.equal(resolve(dirname(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('entropi-print-job-'));
    await rm(folder,{recursive:true,force:true});
  }
});
