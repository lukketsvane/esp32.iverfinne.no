export const MARIGOLD_MODALITIES=['Depth','See-through Depth','Normals','Albedo'];
export const MARIGOLD_ORIGIN='https://toshas-marigold-v2.hf.space';

function assertImage(blob){
  if(!(blob instanceof Blob)||!['image/jpeg','image/png','image/webp'].includes(blob.type)||blob.size<1||blob.size>16*1024*1024)throw new Error('Marigold treng eit gyldig fotografi på under 16 MB.');
}

function resultURL(value){
  const string=typeof value==='string'?value:value?.url;
  if(typeof string!=='string')throw new Error('Marigold returnerte ikkje eit bilete.');
  const url=new URL(string,MARIGOLD_ORIGIN);
  if(url.origin!==MARIGOLD_ORIGIN||!url.pathname.startsWith('/gradio_api/file='))throw new Error('Ugyldig Marigold-bileteadresse.');
  return url.href;
}

async function checked(response,description){
  if(!response.ok)throw new Error(description+' (HTTP '+response.status+').');
  return response;
}

async function readEventStream(response,onProgress){
  if(!response.body?.getReader)throw new Error('Marigold-køen kan ikkje lesast.');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',complete=false;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      if(buffer.length>6*1024*1024)throw new Error('Marigold returnerte for mykje data.');
      buffer=buffer.replace(/\r\n/g,'\n');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))!==-1){
        const record=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const event=record.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
        const data=record.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(event==='error')throw new Error('Marigold GPU kunne ikkje fullføre. Prøv igjen når tenesta er ledig.');
        if(event==='complete'){
          complete=true;
          try{return JSON.parse(data)}catch{throw new Error('Marigold returnerte ugyldige modellresultat.')}
        }
        if(event==='generating'||event==='progress')onProgress({phase:'processing'});
      }
    }
  }finally{if(!complete)await reader.cancel().catch(()=>{})}
  throw new Error('Marigold avslutta utan djupnekart.');
}

export async function runMarigoldV2(blob,{signal,onProgress=()=>{},fetcher=fetch,origin=MARIGOLD_ORIGIN}={}){
  assertImage(blob);
  if(origin!==MARIGOLD_ORIGIN)throw new Error('Ukjend Marigold-teneste.');
  signal?.throwIfAborted();
  const timeout=new AbortController();
  const expired=()=>timeout.abort(new Error('Marigold tok for lang tid. Prøv igjen.'));
  const timer=setTimeout(expired,180000);
  const abort=()=>timeout.abort(signal.reason||new DOMException('Avbrote.','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  const opts={signal:timeout.signal};
  const call=async(path,request)=>checked(await fetcher(origin+path,{...opts,...request}), 'Marigold-tenesta svara ikkje');
  try{
    if(signal?.aborted)abort();
    onProgress({phase:'upload'});
    const form=new FormData();
    form.append('files',blob,'entropi.'+(blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png'));
    const uploaded=await (await call('/gradio_api/upload',{method:'POST',body:form})).json();
    const path=Array.isArray(uploaded)?uploaded[0]:null;
    if(typeof path!=='string'||!path.startsWith('/tmp/gradio/')||path.length>1024)throw new Error('Marigold aksepterte ikkje fotoet.');
    onProgress({phase:'queued'});
    const input={path,orig_name:'entropi.'+(blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png'),mime_type:blob.type,meta:{_type:'gradio.FileData'}};
    const queued=await (await call('/gradio_api/call/on_process_first',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:[[input,null],null,null]})})).json();
    const eventId=queued?.event_id;
    if(typeof eventId!=='string'||!/^[a-z0-9]{16,64}$/i.test(eventId))throw new Error('Marigold kunne ikkje starte GPU-jobben.');
    const response=await call('/gradio_api/call/on_process_first/'+encodeURIComponent(eventId));
    const result=await readEventStream(response,onProgress);
    if(!Array.isArray(result)||!Array.isArray(result[0]))throw new Error('Marigold manglar resultatgalleriet.');
    const gallery=result[0],available=new Map();
    for(const item of gallery){
      if(MARIGOLD_MODALITIES.includes(item?.caption)&&!available.has(item.caption))available.set(item.caption,resultURL(item.image));
    }
    if(MARIGOLD_MODALITIES.some(kind=>!available.has(kind)))throw new Error('Marigold leverte ikkje alle dei fire djupnevisingane.');
    const images=new Map();
    for(const modality of MARIGOLD_MODALITIES){
      onProgress({phase:'downloading',modality});
      const output=await call(new URL(available.get(modality)).pathname);
      const mime=output.headers.get('content-type')?.split(';')[0]||'';
      if(!mime.startsWith('image/'))throw new Error('Marigold leverte ei ugyldig bildefil.');
      const item=await output.blob();
      if(item.size<10||item.size>24*1024*1024)throw new Error('Marigold returnerte ei ugyldig biletstorleik.');
      images.set(modality,item);
    }
    return {images,model:'Marigold V2',origin:MARIGOLD_ORIGIN};
  }catch(error){
    if(timeout.signal.aborted)throw timeout.signal.reason||new Error('Marigold vart avbroten.');
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
