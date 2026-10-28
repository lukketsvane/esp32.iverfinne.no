import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const compiler=['c++','g++','clang++'].find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);

test('native JPEG dimensions handle real baseline/progressive frames and reject malformed headers',{
  skip:compiler?false:'No native C++ host compiler is installed; firmware compile still validates this header.',
},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'entropi-jpeg-'));
  const header=fileURLToPath(new URL('../EntropiCamera/jpeg_frame.h',import.meta.url)).replaceAll('\\','/');
  const source=join(folder,'jpeg.cpp'),program=join(folder,process.platform==='win32'?'jpeg.exe':'jpeg');
  try{
    await writeFile(source,`#include <cassert>
#include <fstream>
#include <iterator>
#include <vector>
#include ${JSON.stringify(header)}
int main(int argc,char **argv){
  assert(argc==3);
  for(int index=1;index<argc;index++){
    std::ifstream input(argv[index],std::ios::binary);
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)),std::istreambuf_iterator<char>());
    unsigned width=99,height=99;
    assert(jpegDimensions(bytes.data(),bytes.size(),width,height)&&width==640&&height==480);
    for(size_t length : {size_t(0),size_t(1),size_t(2),size_t(4),bytes.size()-2,bytes.size()-1}){
      assert(!jpegDimensions(bytes.data(),length,width,height)&&width==0&&height==0);
    }
    auto missingEnd=bytes;missingEnd.back()=0;
    assert(!jpegDimensions(missingEnd.data(),missingEnd.size(),width,height));
    auto invalidSegment=bytes;invalidSegment[4]=0xff;invalidSegment[5]=0xff;
    assert(!jpegDimensions(invalidSegment.data(),invalidSegment.size(),width,height));
    for(size_t offset=2;offset+10<bytes.size();offset++){
      if(bytes[offset]!=0xff||(bytes[offset+1]!=0xc0&&bytes[offset+1]!=0xc2))continue;
      auto zeroWidth=bytes;zeroWidth[offset+7]=zeroWidth[offset+8]=0;
      assert(!jpegDimensions(zeroWidth.data(),zeroWidth.size(),width,height));
      auto shortSof=bytes;shortSof[offset+2]=0;shortSof[offset+3]=7;
      assert(!jpegDimensions(shortSof.data(),shortSof.size(),width,height));
      break;
    }
    bytes.insert(bytes.begin()+2,0xff);
    assert(jpegDimensions(bytes.data(),bytes.size(),width,height)&&width==640&&height==480);
  }
  unsigned width=1,height=1;
  assert(!jpegDimensions(nullptr,0,width,height)&&width==0&&height==0);
  const uint8_t noSof[]={0xff,0xd8,0xff,0xda,0,2,0xff,0xd9};
  assert(!jpegDimensions(noSof,sizeof(noSof),width,height));
}
`);
    const compiled=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror',...(process.platform==='win32'?['-static']:[]),source,'-o',program],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(program,['baseline.jpg','progressive.jpg'].map(name=>fileURLToPath(new URL('./fixtures/'+name,import.meta.url))),{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr||run.error?.message);
  }finally{
    assert.equal(resolve(dirname(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('entropi-jpeg-'));
    await rm(folder,{recursive:true,force:true});
  }
});
