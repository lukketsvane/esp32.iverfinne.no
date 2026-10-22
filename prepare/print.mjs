import { PX10Printer } from '/vendor/print/printer.mjs';
import { cloudPrintJob } from '/vendor/print/cloud-raster.mjs';

const button=document.getElementById('print'),status=document.getElementById('status'),session=location.hash.slice(1),opener=window.opener;
const allowed=new Set(['http://192.168.4.1','http://127.0.0.1:19304']);
let origin=null,image=null,busy=false,started=false,complete=false,closed=false;
try{const candidate=new URL(document.referrer).origin;if(opener&&allowed.has(candidate)&&/^[a-f0-9]{32}$/.test(session))origin=candidate}catch{}
const send=data=>{if(!closed&&origin)opener.postMessage({...data,session},origin)};
const fail=message=>{document.body.classList.add('error');status.textContent=message;button.disabled=started||!image};
const printer=new PX10Printer();
printer.addEventListener('status',event=>{
  const data=event.detail;
  if(data.state==='sent'&&started){complete=true;status.textContent='Sendt til skrivaren.';button.disabled=false;button.setAttribute('aria-label','Tilbake til kameraet');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18"/></svg>';send({type:'entropi-print-result',ok:true})}
  else if(data.state==='failed'&&started){fail(data.message||'Skrivaren svara ikkje.');send({type:'entropi-print-result',ok:false,message:status.textContent})}
});
window.addEventListener('message',event=>{
  const data=event.data;
  if(closed||image||!origin||event.source!==opener||event.origin!==origin||data?.type!=='entropi-print-image'||data.session!==session)return;
  if(data.width!==384||!Number.isInteger(data.height)||data.height<1||data.height>1024||!(data.data instanceof ArrayBuffer)||data.data.byteLength!==data.width*data.height*4){fail('Utskriftsbiletet er ugyldig.');return}
  image={width:data.width,height:data.height,data:new Uint8ClampedArray(data.data),photo:data.photo===true};button.disabled=false;status.textContent='Kople til skrivaren og skriv ut.';
});
button.addEventListener('click',async()=>{
  if(complete&&!closed){try{opener.focus()}catch{}return}
  if(closed||busy||started||!image)return;
  busy=true;button.disabled=true;document.body.classList.remove('error');
  try{
    const connecting=printer.device?printer.start():printer.choose();
    if(!await connecting||!printer.ready){if(!closed)fail(printer.supported?'Skrivaren er ikkje tilkopla.':'Bluetooth er ikkje tilgjengeleg i denne nettlesaren.');return}
    if(closed)return;
    const job=cloudPrintJob(image);started=true;send({type:'entropi-print-started'});
    if(!printer.enqueue('entropi-'+session,job)){fail('Utskrifta er alt forsøkt.');send({type:'entropi-print-result',ok:false,message:status.textContent})}
    else status.textContent='Sender til skrivaren …';
  }catch(error){if(!closed){fail(error.message||'Kunne ikkje skrive ut.');send({type:'entropi-print-result',ok:false,message:status.textContent})}}
  finally{busy=false;if(!started&&!closed)button.disabled=false}
});
window.addEventListener('pagehide',()=>{closed=true;printer.dispose()},{once:true});
if(origin){void printer.start().catch(()=>{});send({type:'entropi-print-ready'})}else{button.disabled=true;fail('Opne skrivaren frå kameraet.')}
