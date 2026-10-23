export function createPrintClient({printer,buildJob,report=()=>{}}={}){
  const attempted=new WeakSet();let disposed=false,busy=false,pending=null,completed=null;
  const valid=image=>image&&image.width===384&&Number.isInteger(image.height)&&image.height>0&&image.height<=1024&&(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)&&image.data.length===image.width*image.height*4;
  const fresh=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
  const pagehide=()=>pending?.();window.addEventListener('pagehide',pagehide);
  printer?.addEventListener('status',event=>{if(!disposed&&event.detail.state==='failed')report(event.detail.message||'Skrivaren svara ikkje.')});
  try{void printer?.start().catch(()=>{})}catch{}
  async function print(image,isCurrent=()=>true){
    if(disposed||busy||!isCurrent()||attempted.has(image))return false;
    if(!valid(image)){report('Utskriftsbiletet er ugyldig.');return false}
    busy=true;
    try{
      if(printer){
        const connecting=printer.device?printer.start():printer.choose();
        if(!await connecting||!printer.ready){if(!disposed)report(printer.lastError||(printer.supported?'Skrivaren er ikkje tilkopla.':'Bluetooth er ikkje tilgjengeleg i denne nettlesaren.'));return false}
        if(disposed||!isCurrent())return false;
        const job=buildJob(image);if(disposed||!isCurrent())return false;
        const accepted=printer.enqueue('entropi-'+fresh(),job);if(accepted){attempted.add(image);report('Sender til skrivaren …')}return accepted;
      }
      try{completed?.close()}catch{}completed=null;
      const origin='https://esp32.iverfinne.no',session=fresh(),popup=window.open(origin+'/print/#'+session,'entropi-print-'+session);
      if(!popup){report('Tillat opning av skrivarsida og prøv igjen.');return false}
      return await new Promise(resolve=>{
        let finished=false,sent=false;
        const finish=(ok,message)=>{
          if(finished)return;finished=true;clearTimeout(timer);clearInterval(poll);window.removeEventListener('message',messageReceived);pending=null;
          if(ok){attempted.add(image);completed=popup}else try{popup.close()}catch{}
          if(message&&!disposed)report(message);resolve(ok);
        };
        const messageReceived=event=>{
          if(finished||event.source!==popup||event.origin!==origin||event.data?.session!==session)return;
          if(disposed||!isCurrent()){finish(false);return}
          const data=event.data;
          if(data.type==='entropi-print-ready'&&!sent){
            sent=true;const bytes=new Uint8Array(image.data);
            popup.postMessage({type:'entropi-print-image',session,width:image.width,height:image.height,photo:image.photo===true,data:bytes.buffer},origin,[bytes.buffer]);
          }else if(data.type==='entropi-print-started'&&sent)attempted.add(image);
          else if(data.type==='entropi-print-result'&&sent&&typeof data.ok==='boolean')finish(data.ok,data.ok?'Sendt til skrivaren.':data.message||'Utskrifta vart avbroten.');
        };
        const timer=setTimeout(()=>finish(false,'Skrivarsida svara ikkje. Prøv igjen.'),300000);
        const poll=setInterval(()=>{if(disposed||!isCurrent()||popup.closed)finish(false)},250);
        pending=()=>finish(false);window.addEventListener('message',messageReceived);
      });
    }catch(error){if(!disposed)report(error.message||'Kunne ikkje skrive ut.');return false}
    finally{busy=false}
  }
  return {print,dispose(){if(disposed)return;disposed=true;window.removeEventListener('pagehide',pagehide);pending?.();try{completed?.close()}catch{}completed=null;printer?.dispose()}};
}
