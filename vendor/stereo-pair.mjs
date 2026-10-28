export async function readStereoPairResponse(response){
  const header=name=>response.headers.get('X-Entropi-'+name),id=header('Pair-Id'),leftId=header('Left-Id'),rightId=header('Right-Id');
  const lengths=[Number(header('Left-Length')),Number(header('Right-Length'))];
  if(response.headers.get('Content-Type')?.split(';')[0]!=='application/octet-stream'||!/^[a-f0-9]{32}$/.test(id??'')||![leftId,rightId].every(value=>/^[a-f0-9]{12}$/.test(value??''))||leftId===rightId||!lengths.every(value=>Number.isInteger(value)&&value>=4&&value<=1048576))throw new Error('Ugyldig stereopar frå kameraet.');
  const timingText=header('Timing');let timing;
  try{if(!timingText||timingText.length>4096)throw new Error();timing=JSON.parse(timingText)}catch{throw new Error('Stereoparet manglar opptaksdata.')}
  if(timing.hardware_synchronized!==false||timing.coordinator_camera_id!==leftId||!['left_capture_us','right_capture_us','left_capture_duration_us','right_capture_duration_us','peer_requested_us','peer_headers_received_us','peer_request_started_us','peer_response_ready_us'].every(key=>Number.isSafeInteger(timing[key])&&timing[key]>=0))throw new Error('Ugyldige opptaksdata frå kameraet.');
  const bytes=new Uint8Array(lengths[0]+lengths[1]),reader=response.body?.getReader();let offset=0;
  if(!reader)throw new Error('Stereoparet manglar bilete.');
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(offset+value.length>bytes.length)throw new Error('Stereoparet har feil storleik.');bytes.set(value,offset);offset+=value.length}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  if(offset!==bytes.length)throw new Error('Ufullstendig stereopar.');
  const frames=[bytes.subarray(0,lengths[0]),bytes.subarray(lengths[0])];
  if(frames.some(frame=>frame[0]!==255||frame[1]!==216||frame.at(-2)!==255||frame.at(-1)!==217))throw new Error('Ugyldige JPEG-bilete i stereoparet.');
  return {id,leftId,rightId,timing,hardware_synchronized:false,transport:'wifi',left:new Blob([frames[0]],{type:'image/jpeg'}),right:new Blob([frames[1]],{type:'image/jpeg'})};
}
