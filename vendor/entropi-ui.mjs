import { encodeEntropiDocument, decodeEntropiDocument } from './entropi-document.mjs';
import { encodeDepthTiff, encodeDepthDng } from './entropi-export.mjs';
import { savePhoto } from './photo.mjs';

export async function saveEntropiFile(blob,name,isCurrent=()=>true){
  if(!isCurrent())return;
  const file=new File([blob],name,{type:blob.type});
  try{if(globalThis.isSecureContext!==false&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}}catch(error){if(error.name==='AbortError')return}
  if(!isCurrent())return;
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export function showExportOptions({image,document:master,name='entropi',isCurrent=()=>true}){
  if(!isCurrent()||document.querySelector('dialog[data-entropi-export]'))return;
  const dialog=document.createElement('dialog'),close=document.createElement('button'),options=document.createElement('div'),status=document.createElement('span'),focus=document.activeElement;
  dialog.setAttribute('data-entropi-export','');dialog.setAttribute('aria-label','Eksporter bilete');
  dialog.style.cssText='position:fixed;inset:auto 0 0;margin:0;padding:24px 16px calc(24px + env(safe-area-inset-bottom));width:100%;max-width:none;box-sizing:border-box;border:1px solid #333;background:#090909;color:#eee';
  close.type='button';close.setAttribute('aria-label','Lukk eksport');close.textContent='×';close.style.cssText='display:block;margin:0 0 16px auto;width:48px;height:48px;border:0;background:transparent;color:inherit;font:28px system-ui';
  options.style.cssText='display:flex;gap:8px;justify-content:center;flex-wrap:wrap';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  const base=name.replace(/\.[^.]+$/,'');let busy=false;
  for(const [label,extension]of [['PNG','png'],['.entropi','entropi'],['TIFF','tif'],['DNG','dng']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',extension==='entropi'?'Lagre redigerbar Entropi-fil':extension==='dng'?'Eksporter eksperimentell DNG':'Eksporter '+label);
    button.style.cssText='min-width:72px;min-height:48px;padding:12px;border:1px solid #444;background:transparent;color:inherit;font:14px system-ui';
    button.addEventListener('click',async()=>{
      if(busy||!isCurrent())return;busy=true;let handedOff=false;dialog.setAttribute('aria-busy','true');
      for(const item of options.children)item.disabled=true;
      try{
        let blob;
        if(extension==='png')blob=await image();
        else{const value=await master();blob=extension==='entropi'?await encodeEntropiDocument(value):extension==='tif'?encodeDepthTiff(value.result):encodeDepthDng(value.result)}
        if(!isCurrent()||!dialog.open)return;
        handedOff=true;dialog.close();
        if(extension==='png')await savePhoto(blob,base+'.png',isCurrent);
        else await saveEntropiFile(blob,base+'.'+extension,isCurrent);
      }catch(error){
        const existing=document.querySelector('dialog[data-entropi-export]');
        if(handedOff&&isCurrent()&&!dialog.open&&(!existing||existing===dialog)){document.body.append(dialog);dialog.showModal()}
        status.textContent=error.message||'Eksporten feila.';button.setAttribute('aria-label','Prøv '+label+' igjen');
      }
      finally{busy=false;dialog.setAttribute('aria-busy','false');for(const item of options.children)item.disabled=false}
    });
    options.append(button);
  }
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(!dialog.open){dialog.remove();focus?.focus({preventScroll:true})}});
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.append(close,options,status);document.body.append(dialog);dialog.showModal();
}

export function pickEntropiDocument(){
  return new Promise((resolve,reject)=>{
    const input=document.createElement('input');input.type='file';input.accept='.entropi';input.hidden=true;
    input.addEventListener('cancel',()=>{input.remove();resolve(null)},{once:true});
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];input.remove();
      try{resolve(file?await decodeEntropiDocument(file):null)}catch(error){reject(error)}
    },{once:true});
    document.body.append(input);input.click();
  });
}
