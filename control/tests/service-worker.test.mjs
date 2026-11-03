import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const code=await readFile(new URL('../sw.js',import.meta.url),'utf8');

test('offline PWA handles /control/ app files but does not intercept firmware API /control',()=>{
 const listeners={};
 const scope={self:{location:{origin:'https://esp32.iverfinne.no'},addEventListener:(name,fn)=>listeners[name]=fn},URL,caches:{match:()=>Promise.resolve(null)},fetch:()=>Promise.resolve({ok:false})};
 vm.runInNewContext(code,scope);
 const routed=[];
 for(const url of ['https://esp32.iverfinne.no/control/','https://esp32.iverfinne.no/control/app.mjs','https://esp32.iverfinne.no/status','https://esp32.iverfinne.no/control','https://example.com/control/']){
  let wasHandled=false;listeners.fetch({request:{url,method:'GET'},respondWith:()=>{wasHandled=true}});routed.push(wasHandled)
 }
 assert.deepEqual(routed,[true,true,false,false,false]);
});
