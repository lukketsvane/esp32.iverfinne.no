import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const compiler=[process.env.CXX,'c++','g++','clang++'].filter(Boolean).find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);

test('peer response framing rejects mismatched pairs, malformed headers, truncation and deadlines',{
  skip:compiler?false:'No native C++ host compiler is installed; run with CXX or on the Linux test host.',
},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'entropi-stereo-'));
  const header=fileURLToPath(new URL('../EntropiCamera/stereo_protocol.h',import.meta.url)).replaceAll('\\','/');
  const source=join(folder,'stereo.cpp'),program=join(folder,process.platform==='win32'?'stereo.exe':'stereo');
  try{
    await writeFile(source,`#include <cassert>
#include <algorithm>
#include <string>
#include ${JSON.stringify(header)}
int64_t tick=0;
int64_t now(){return tick;}
void idle(){tick++;}
struct Client {
  std::string bytes;
  size_t offset=0;
  int64_t release=0,delay=0;
  bool open=false;
  int available(){return tick>=release?static_cast<int>(std::min(size_t(7),bytes.size()-offset)):0;}
  int read(){if(!available())return -1;int value=static_cast<unsigned char>(bytes[offset++]);release=tick+delay;return value;}
  int read(uint8_t *target,size_t length){size_t count=std::min(length,static_cast<size_t>(available()));memcpy(target,bytes.data()+offset,count);offset+=count;release=tick+delay;return static_cast<int>(count);}
  bool connected(){return open||offset<bytes.size();}
};
const char *pair="0123456789abcdef0123456789abcdef",*camera="c443180d5020";
std::string fields="Content-Length: 4\\r\\nContent-Type: image/jpeg\\r\\nX-Entropi-Pair-Id: "+std::string(pair)+"\\r\\nX-Entropi-Camera-Id: "+camera+"\\r\\nX-Entropi-Capture-Started-Us: 20\\r\\nX-Entropi-Capture-Us: 25\\r\\nX-Entropi-Response-Ready-Us: 30\\r\\n";
std::string response(const std::string &headers){return "HTTP/1.1 200 OK\\r\\n"+headers+"\\r\\n";}
bool parse(const std::string &text,StereoHeaders &headers,size_t limit=STEREO_MAX_JPEG){tick=0;Client client;client.bytes=text;return stereoReadHeaders(client,headers,limit,1000,now,idle);}
std::string changed(std::string text,const std::string &from,const std::string &to){size_t at=text.find(from);assert(at!=std::string::npos);text.replace(at,from.size(),to);return text;}
int main(){
  StereoHeaders headers;assert(parse(response(fields),headers));assert(headers.captureMatches(pair,camera));
  assert(!headers.captureMatches("1123456789abcdef0123456789abcdef",camera));
  assert(!headers.captureMatches(pair,"c443180d5021"));
  for(const std::string &bad:{
    changed(fields,"Content-Length: 4\\r\\n",""),changed(fields,"Content-Length: 4","Content-Length: -4"),
    changed(fields,"Content-Length: 4","Content-Length: 9223372036854775808"),
    changed(fields,"Content-Length: 4","Content-Length: 4x"),fields+"Content-Length: 4\\r\\n",
    fields+"Transfer-Encoding: chunked\\r\\n",fields+"X-Entropi-Pair-Id: "+pair+"\\r\\n",
    fields+"X-Entropi-Capture-Us: 25\\r\\n",changed(fields,pair,"short"),
    changed(fields,camera,"C443180d5020"),fields+"Invalid header\\r\\n"}){
    StereoHeaders result;assert(!parse(response(bad),result));
  }
  for(const std::string &bad:{changed(fields,"image/jpeg","text/plain"),changed(fields,"Started-Us: 20","Started-Us: 26"),
    changed(fields,"Ready-Us: 30","Ready-Us: 24"),changed(fields,"X-Entropi-Capture-Us: 25\\r\\n","")}){
    StereoHeaders result;assert(parse(response(bad),result));assert(!result.captureMatches(pair,camera));
  }
  for(const std::string &bad:{changed(response(fields),"200 OK","503 Unavailable"),response(fields+"Long: "+std::string(512,'x')+"\\r\\n"),"HTTP/1.1 200 OK\\r\\n"+fields}){
    StereoHeaders result;assert(!parse(bad,result));
  }
  std::string many=fields;for(int i=0;i<48;i++)many+="Ignored: value\\r\\n";
  StereoHeaders tooMany;assert(!parse(response(many),tooMany));
  std::string large=fields;for(int i=0;i<20;i++)large+="Ignored: "+std::string(480,'x')+"\\r\\n";
  StereoHeaders tooLarge;assert(!parse(response(large),tooLarge));
  StereoHeaders oversized;assert(!parse(response(fields),oversized,3));
  StereoHeaders zero;assert(parse(response("Content-Length: 0\\r\\n"),zero));assert(!zero.captureMatches(pair,camera));
  Client slow;slow.bytes=response(fields);slow.delay=1;tick=0;StereoHeaders timeout;
  assert(!stereoReadHeaders(slow,timeout,STEREO_MAX_JPEG,30,now,idle));assert(tick==30);
  Client stalled;stalled.open=true;tick=0;char line[4];assert(!stereoReadLine(stalled,line,sizeof(line),7,now,idle));assert(tick==7);
  uint8_t bytes[8]={9,9,9,9,9,9,9,9};Client body;body.bytes="ABCDextra";tick=0;
  assert(stereoReadBody(body,bytes+2,4,10,now,idle));assert(body.offset==4);assert(!memcmp(bytes+2,"ABCD",4));assert(bytes[0]==9&&bytes[1]==9&&bytes[6]==9&&bytes[7]==9);
  Client truncated;truncated.bytes="ABC";tick=0;assert(!stereoReadBody(truncated,bytes,4,10,now,idle));
  Client partial;partial.bytes="ABC";partial.open=true;tick=0;assert(!stereoReadBody(partial,bytes,4,10,now,idle));assert(tick==10);
  Client late;late.bytes="ABCD";late.release=11;tick=0;assert(!stereoReadBody(late,bytes,4,10,now,idle));assert(late.offset==0);
}
`);
    const compiled=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',...(process.platform==='win32'?['-static']:[]),source,'-o',program],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(program,[],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr||run.error?.message);
  }finally{
    assert.equal(resolve(dirname(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('entropi-stereo-'));
    await rm(folder,{recursive:true,force:true});
  }
});
