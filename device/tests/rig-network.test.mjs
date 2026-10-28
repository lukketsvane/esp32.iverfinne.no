import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../EntropiCamera/rig_network.cpp',import.meta.url),'utf8');
const policy=source.slice(source.indexOf('void pollRigNetwork() {')).split('  if (uint32_t(now - lastBind)')[0].split('uint32_t now = millis();')[1];

function network({secondary=true,lan=false,start=0}={}){
  const active=[true],lines=[];
  for(const line of policy.split('\n')){
    if(line.startsWith('#if ')){
      const enabled=(!line.includes('ENTROPI_SECONDARY_CAMERA')||secondary)&&(!line.includes('ENTROPI_WIFI_SSID')||lan);
      active.push(active.at(-1)&&enabled);
    }else if(line.startsWith('#endif'))active.pop();
    else if(active.at(-1))lines.push(line);
  }
  const calls=[];
  const context=vm.createContext({now:start,lastConnected:start,usingFallback:false,WL_CONNECTED:3,state:0,
    uint32_t:value=>value>>>0,IPAddress:()=>0,
    rememberPeer:(address,time)=>calls.push(['peer',address,time]),
    WiFi:{status:()=>context.state,reconnect:()=>calls.push(['reconnect']),disconnect:()=>calls.push(['disconnect']),begin:ssid=>calls.push(['begin',ssid]),setAutoReconnect:value=>calls.push(['auto',value])},
  });
  const script=new vm.Script(lines.join('\n'));
  return {calls,context,poll(now,connected=false){context.now=now>>>0;context.state=connected?3:0;script.runInContext(context)}};
}

test('a secondary retries an unavailable primary at bounded intervals until it returns',()=>{
  const rig=network();
  for(const time of [0,1,1000,14999])rig.poll(time);
  assert.deepEqual(rig.calls,[]);
  rig.poll(15000);
  assert.deepEqual(rig.calls,[['reconnect'],['peer',0,15000]]);
  for(const time of [15001,16000,29999])rig.poll(time);
  assert.equal(rig.calls.length,2);
  rig.poll(30000);
  assert.equal(rig.calls.filter(call=>call[0]==='reconnect').length,2);
  rig.poll(31000,true);rig.poll(60000,true);rig.poll(74999);
  assert.equal(rig.calls.length,4);
  rig.poll(75000);
  assert.equal(rig.calls.filter(call=>call[0]==='reconnect').length,3);
});

test('secondary LAN fallback occurs once and later retries retain the ENTROPI configuration',()=>{
  const rig=network({lan:true});
  rig.poll(14999);assert.deepEqual(rig.calls,[]);
  rig.poll(15000);
  assert.deepEqual(rig.calls,[['auto',false],['disconnect'],['begin','ENTROPI'],['auto',true],['peer',0,15000]]);
  rig.poll(29999);assert.equal(rig.calls.length,5);
  rig.poll(30000);rig.poll(45000);
  assert.equal(rig.calls.filter(call=>call[0]==='begin').length,1);
  assert.equal(rig.calls.filter(call=>call[0]==='reconnect').length,2);
  assert.equal(rig.context.usingFallback,true);
});

test('a primary never runs secondary reconnect or fallback logic',()=>{
  for(const lan of [false,true]){
    const rig=network({secondary:false,lan});
    for(const time of [0,15000,60000,120000])rig.poll(time);
    assert.deepEqual(rig.calls,[]);
  }
});

test('secondary retry timing survives the millis counter wrapping',()=>{
  const start=0xfffff000,rig=network({start});
  rig.poll(start+14999);assert.deepEqual(rig.calls,[]);
  rig.poll(start+15000);
  assert.equal(rig.calls[0][0],'reconnect');
  rig.poll(start+29999);assert.equal(rig.calls.length,2);
  rig.poll(start+30000);assert.equal(rig.calls.length,4);
});
