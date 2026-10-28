import test from 'node:test';
import assert from 'node:assert/strict';
import {readStereoPairResponse} from '../vendor/stereo-pair.mjs';

const left=Uint8Array.of(255,216,1,2,255,217),right=Uint8Array.of(255,216,3,4,5,255,217);
const timing={left_capture_us:100,right_capture_us:9000,left_capture_duration_us:200,right_capture_duration_us:220,peer_requested_us:50,peer_headers_received_us:350,peer_request_started_us:8800,peer_response_ready_us:9200,coordinator_camera_id:'c0b62c0d5020',hardware_synchronized:false};
function response(overrides={},body=new Uint8Array([...left,...right])){
  return new Response(body,{headers:{'Content-Type':'application/octet-stream','X-Entropi-Pair-Id':'a'.repeat(32),'X-Entropi-Left-Id':'c0b62c0d5020','X-Entropi-Right-Id':'c443180d5020','X-Entropi-Left-Length':String(left.length),'X-Entropi-Right-Length':String(right.length),'X-Entropi-Timing':JSON.stringify(timing),...overrides}});
}
test('coordinated pair preserves both JPEGs and separate camera clocks',async()=>{
  const pair=await readStereoPairResponse(response());
  assert.deepEqual(new Uint8Array(await pair.left.arrayBuffer()),left);assert.deepEqual(new Uint8Array(await pair.right.arrayBuffer()),right);
  assert.deepEqual(pair.timing,timing);assert.equal(pair.hardware_synchronized,false);assert.equal(pair.transport,'wifi');
});
test('coordinated pair rejects ambiguous identities, lengths, timing and incomplete bodies',async()=>{
  for(const headers of [{'X-Entropi-Pair-Id':'bad'},{'X-Entropi-Right-Id':'c0b62c0d5020'},{'X-Entropi-Left-Length':'1048577'},{'X-Entropi-Timing':'{}'},{'X-Entropi-Timing':JSON.stringify({...timing,hardware_synchronized:true})},{'X-Entropi-Timing':JSON.stringify({...timing,left_capture_us:-1})}])await assert.rejects(readStereoPairResponse(response(headers)));
  await assert.rejects(readStereoPairResponse(response({},new Uint8Array([...left,...right,0]))));
  await assert.rejects(readStereoPairResponse(response({},left)));
  await assert.rejects(readStereoPairResponse(response({},new Uint8Array(left.length+right.length))));
});
test('stream interruption cannot return a partial coordinated pair',async()=>{
  let reads=0;
  const stream=new ReadableStream({pull(controller){if(!reads++)controller.enqueue(left);else controller.error(new Error('Connection lost'))}});
  await assert.rejects(readStereoPairResponse(response({},stream)),/Connection lost/);
});
