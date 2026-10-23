export async function savePhoto(blob,name='entropi.jpg',isCurrent=()=>true){
  if(!isCurrent())return;
  if(!blob?.size||!blob.type.startsWith('image/'))throw new Error('Fotoet er ikkje klart.');
  const file=new File([blob],name,{type:blob.type});
  try{if(globalThis.isSecureContext!==false&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}}catch(error){if(error.name==='AbortError')return}
  if(!isCurrent())return;
  const apple=/iPad|iPhone|iPod/.test(navigator.userAgent||'')||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
  if(globalThis.isSecureContext===false||apple){
    if(!isCurrent()||document.querySelector('dialog[data-photo-save]'))return;
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Fotoet kunne ikkje opnast.'));reader.readAsDataURL(blob)});
    if(!isCurrent()||document.querySelector('dialog[data-photo-save]'))return;
    const dialog=document.createElement('dialog'),image=document.createElement('img'),back=document.createElement('button'),hint=document.createElement('p'),focus=document.activeElement;
    dialog.setAttribute('data-photo-save','');dialog.setAttribute('aria-label','Lagre foto');
    dialog.style.cssText='position:fixed;inset:0;margin:0;padding:0;border:0;width:100%;height:100%;max-width:none;max-height:none;background:#000;color:#aaa;overflow:hidden;touch-action:auto';
    image.src=data;image.alt='Fotoet ditt';image.style.cssText='display:block;width:100%;height:100%;object-fit:contain;filter:none;touch-action:auto;-webkit-touch-callout:default;-webkit-user-select:auto;user-select:auto';
    back.type='button';back.setAttribute('aria-label','Tilbake til biletet');back.style.cssText='position:absolute;left:calc(12px + env(safe-area-inset-left));top:calc(12px + env(safe-area-inset-top));width:44px;height:44px;padding:0;border:0;outline:0;background:transparent;color:#aaa;box-shadow:none';
    back.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>';
    hint.textContent='Hald inne for å lagre';hint.style.cssText='position:absolute;bottom:calc(20px + env(safe-area-inset-bottom));left:0;width:100%;margin:0;text-align:center;font:12px -apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none';
    back.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{image.removeAttribute('src');dialog.remove();focus?.focus({preventScroll:true})},{once:true});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation()});
    dialog.append(image,back,hint);document.body.append(dialog);dialog.showModal();return;
  }
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export function snapshotBlob(image){
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d');if(!context)throw new Error('Fotoet kunne ikkje lesast.');
  const pixels=context.createImageData(image.width,image.height);pixels.data.set(image.data);context.putImageData(pixels,0,0);
  const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),value=>value.charCodeAt(0));
  return new Blob([bytes],{type:'image/png'});
}

export function photoSnapshot(image,pose,native=false){
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  if(!width||!height)throw new Error('Fotoet er ikkje klart.');
  let x=0,y=0,w=width,h=height;
  if(pose?.scale>1&&pose.width>0&&pose.height>0){
    const fit=Math.min(pose.width/width,pose.height/height)*pose.scale,left=(pose.width-width*fit)/2+pose.x,top=(pose.height-height*fit)/2+pose.y;
    x=Math.max(0,-left)/fit;y=Math.max(0,-top)/fit;w=(Math.min(pose.width,left+width*fit)-Math.max(0,left))/fit;h=(Math.min(pose.height,top+height*fit)-Math.max(0,top))/fit;
  }
  const canvas=document.createElement('canvas');canvas.width=native?Math.max(1,Math.round(w)):384;canvas.height=native?Math.max(1,Math.round(h)):Math.max(1,Math.min(1024,Math.round(384*h/w)));
  const context=canvas.getContext('2d');if(!context)throw new Error('Kunne ikkje lese fotoet.');
  context.drawImage(image,x,y,w,h,0,0,canvas.width,canvas.height);
  const data=context.getImageData(0,0,canvas.width,canvas.height).data;
  for(let i=0;i<data.length;i+=4){const value=Math.round(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722);data[i]=data[i+1]=data[i+2]=value}
  return {width:canvas.width,height:canvas.height,data,photo:true};
}
