export function createDevicePrinter({fetch:request=globalThis.fetch.bind(globalThis),interval=500,timeout=40000}={}){
  const states=new Set(['queued','scanning','connecting','sending','recovering','sent','failed']);
  let disposed=false,active=null,wake=null;
  const resumed=()=>{if(!globalThis.document?.hidden)wake?.()};
  const pagehide=event=>{if(!event.persisted)dispose()};
  globalThis.addEventListener?.('pagehide',pagehide);globalThis.addEventListener?.('pageshow',resumed);globalThis.document?.addEventListener('visibilitychange',resumed);
  function dispose(){if(disposed)return;disposed=true;active?.abort();wake?.();globalThis.removeEventListener?.('pagehide',pagehide);globalThis.removeEventListener?.('pageshow',resumed);globalThis.document?.removeEventListener('visibilitychange',resumed)}
  async function print(id,bytes,isCurrent=()=>true){
    if(disposed||active||!isCurrent())throw new DOMException('Avbrote.','AbortError');
    if(!/^[a-f0-9]{32}$/.test(id)||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>65536)throw new Error('Utskriftsdata er ugyldige.');
    const task=active=new AbortController();let submitted=false;
    const current=()=>{task.signal.throwIfAborted();if(!submitted&&!isCurrent())throw new DOMException('Avbrote.','AbortError')};
    async function fetch(path,init={}){
      current();const controller=new AbortController(),abort=()=>controller.abort(task.signal.reason),timer=setTimeout(()=>controller.abort(new Error('Skrivaren svara ikkje. Prøv igjen.')),timeout);task.signal.addEventListener('abort',abort,{once:true});
      let interrupted;const cancelled=new Promise((resolve,reject)=>{interrupted=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',interrupted,{once:true})});
      try{const result=await Promise.race([(async()=>{const response=await request(path,{cache:'no-store',...init,signal:controller.signal});return {ok:response.ok,status:response.status,data:response.ok?await response.json():null}})(),cancelled]);current();return result}finally{clearTimeout(timer);task.signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',interrupted)}
    }
    function status(data){
      if(!data||data.id!==id||!states.has(data.state)||!Number.isInteger(data.bytes)||!Number.isInteger(data.total)||data.bytes<0||data.bytes>data.total||data.total!==bytes.length||data.state==='sent'&&data.bytes!==data.total)throw new Error('Utskriftsstatusen kunne ikkje stadfestast.');
      return data;
    }
    async function read(){const response=await fetch('/print-status?id='+id);if(!response.ok)throw new Error('Utskrifta kunne ikkje stadfestast. Prøv igjen.');return status(response.data)}
    function wait(){return new Promise((resolve,reject)=>{let timer;const finish=error=>{clearTimeout(timer);task.signal.removeEventListener('abort',abort);wake=null;error?reject(error):resolve()},done=()=>finish(),abort=()=>finish(new DOMException('Avbrote.','AbortError'));wake=done;timer=setTimeout(done,interval);task.signal.addEventListener('abort',abort,{once:true})})}
    try{
      const latest=await fetch('/print-status');if(!latest.ok)throw new Error('Skrivaren kunne ikkje nåast. Prøv igjen.');const head=latest.data;
      if(!head||!/^[a-f0-9]{16}$/.test(head.boot)||!Number.isInteger(head.sequence)||head.sequence<1||head.sequence>0xffffffff||!['idle',...states].includes(head.state))throw new Error('Utskriftsstatusen kunne ikkje stadfestast.');
      if(!['idle','sent','failed'].includes(head.state))throw new Error('Ei utskrift er alt i gang.');
      id=head.boot+head.sequence.toString(16).padStart(8,'0')+id.slice(-8);current();
      let response;submitted=true;
      try{response=await fetch('/print?id='+id,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes})}catch(error){current()}
      if(response&&[400,409].includes(response.status))throw new Error(response.status===409?'Ei utskrift er alt i gang.':'Utskriftsdata vart avviste.');
      let data=response&&[200,202].includes(response.status)?status(response.data):await read();
      while(true){
        current();if(data.state==='sent')return {...data,physicalPrintVerified:false};if(data.state==='failed')throw new Error(typeof data.message==='string'&&data.message?data.message:'Utskrifta vart avbroten. Prøv igjen.');
        await wait();current();data=await read();
      }
    }finally{if(active===task)active=null}
  }
  return {print,dispose};
}
