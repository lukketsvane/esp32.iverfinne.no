import { encodeEntropiDocument, decodeEntropiDocument } from './entropi-document.mjs';
import { encodeVathographyPNG, readVathographyPNG } from './vathography-png.mjs';
import { encodeDepthDng } from './entropi-export.mjs';
import { encodeRenderedTiff } from './entropi-rendered-export.mjs';
import { downloadFile, savePhoto } from './photo.mjs';
import { warmUpscaleAssets, prepareUpscaleAssets, upscaleImage } from './upscale.mjs';

export async function saveEntropiFile(blob,name,isCurrent=()=>true){
  downloadFile(blob,name,isCurrent);
}

const exportFormats=[['PNG','png'],['VATHO PNG','vpng'],['.entropi','entropi'],['TIFF','tif'],['DNG','dng']],upscaleFormats=[['AI 2×','ai2'],['AI 4×','ai4'],['AI 8×','ai8']];
const exportStatusStyle='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';

async function prepareExport({image,document:master,animation,name='entropi',imageExtension='png',isCurrent=()=>true},extension,{signal,onProgress=()=>{}}={}){
  let blob;
  if(extension==='gif'){
    if(typeof animation!=='function')throw new Error('Framkall VATHOgraphy før GIF-eksport.');
    blob=await animation({signal,onProgress});
    if(blob?.type!=='image/gif'||!blob.size)throw new Error('GIF-eksporten feila.');
    return {blob,name:name.replace(/\.[^.]+$/,'')+'-loop.gif',image:false};
  }
  if(/^ai[248]$/.test(extension)){const factor=Number(extension.slice(2));await prepareUpscaleAssets(signal,onProgress);blob=await upscaleImage(await image(),factor,{signal,onProgress,isCurrent});return {blob,name:name.replace(/\.[^.]+$/,'')+'-ai-'+factor+'x.png',image:true}}
  if(extension==='png')blob=await image();
  else{
    if(typeof master!=='function')throw new Error('Framkalla eit djupnebilete før eksport.');
    const value=await master();
    if(extension==='vpng'){
      const displayed=await image(),preview=displayed.type==='image/png'?displayed:value.preview?.type==='image/png'?value.preview:null;
      if(!preview)throw new Error('VATHO-PNG krev ei PNG-førehandsvising.');
      blob=await encodeVathographyPNG(preview,await encodeEntropiDocument(value));
    }else blob=extension==='entropi'?await encodeEntropiDocument(value):extension==='tif'?await encodeRenderedTiff(value):encodeDepthDng(value.result);
  }
  return {blob,name:name.replace(/\.[^.]+$/,'')+(extension==='vpng'?'-vatho.png':'.'+(extension==='png'?imageExtension:extension)),image:extension==='png'||extension==='vpng'};
}

async function handOffExport(file,isCurrent){
  if(!isCurrent())return;
  if(file.image)await savePhoto(file.blob,file.name,isCurrent);
  else await saveEntropiFile(file.blob,file.name,isCurrent);
}

export function showExportOptions(settings){
  const {document:master,isCurrent=()=>true,onError=()=>{},anchor=document.activeElement}=settings;
  if(!isCurrent()||document.querySelector('dialog[data-entropi-export]'))return null;
  void warmUpscaleAssets();
  const dialog=document.createElement('dialog'),options=document.createElement('div'),status=document.createElement('span'),focus=document.activeElement;
  const viewport=globalThis.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??globalThis.innerWidth??390,height=viewport?.height??globalThis.innerHeight??844;
  const bounds=anchor?.getBoundingClientRect?.()??{left:left+width/2-24,top:top+height-72,width:48},formats=[...(master?exportFormats:[exportFormats[0]]),...(typeof settings.animation==='function'?[['Loop GIF','gif']]:[]),...upscaleFormats],plainCount=formats.length-upscaleFormats.length,size=(plainCount+1)*48+8;
  dialog.setAttribute('data-entropi-export','');dialog.setAttribute('aria-label','Eksporter bilete');dialog.setAttribute('role','menu');
  dialog.style.cssText='position:fixed;inset:auto;margin:0;padding:4px;width:164px;max-width:calc(100vw - 24px);box-sizing:border-box;border:0;border-radius:25px;background:linear-gradient(180deg,#ffffff1f,#ffffff04 58%),rgba(24,24,27,.62);color:#f5f5f7;box-shadow:inset 0 1px 0 #ffffff38,inset 0 0 0 1px #ffffff1c,0 10px 40px #0007,0 2px 8px #0004;backdrop-filter:blur(24px) saturate(180%) brightness(1.08);-webkit-backdrop-filter:blur(24px) saturate(180%) brightness(1.08);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;z-index:2147483647';
  dialog.style.maxHeight=Math.max(48,height-24)+'px';dialog.style.overflowY='auto';
  dialog.style.left=Math.max(left+12,Math.min(left+width-176,bounds.left+bounds.width/2-82))+'px';
  dialog.style.top=Math.max(top+12,Math.min(top+height-size-12,bounds.top-size-10))+'px';
  options.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr))';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.cssText=exportStatusStyle;
  let busy=false,selected=-1,disposed=false,exportTask=null;
  const parent=anchor?.closest?.('dialog[open]')||document.body;
  const select=index=>{selected=index;Array.from(options.children).forEach((button,i)=>{button.setAttribute('aria-current',i===index?'true':'false');button.tabIndex=i===index?0:-1;button.style.transform=i===index?'scale(1.08)':'none';button.style.color=i===index?'#fff':'#d4d4d8'})};
  const close=()=>{disposed=true;exportTask?.abort();dialog.close()};
  const dismiss=event=>{if(!dialog.contains(event.target)&&!anchor?.contains?.(event.target))close()};
  const hidden=()=>{if(document.hidden&&dialog.getAttribute('data-ai-export')!=='true')close()};
  const choose=async index=>{
    if(index<0||busy||disposed||!isCurrent())return;
    const [label,extension]=formats[index],button=options.children[index];busy=true;let handedOff=false;dialog.setAttribute('aria-busy','true');dialog.setAttribute('data-ai-export',String(extension.startsWith('ai')));
    for(const item of options.children)item.disabled=true;
    try{
      exportTask=new AbortController();const file=await prepareExport(settings,extension,{signal:exportTask.signal,onProgress:update=>{if(Number.isFinite(update.percent)){button.textContent=Math.round(update.percent)+'%';button.setAttribute('aria-label',label+' '+Math.round(update.percent)+'%')}}});
      if(disposed||!isCurrent()||!dialog.open)return;
      handedOff=true;dialog.close();
      await handOffExport(file,isCurrent);
    }catch(error){
      const existing=document.querySelector('dialog[data-entropi-export]');
      if(handedOff&&!disposed&&isCurrent()&&!dialog.open&&(!existing||existing===dialog)){parent.append(dialog);dialog.show();focus?.focus({preventScroll:true});listen()}
      if(error.name!=='AbortError'&&!disposed&&isCurrent()){status.textContent=error.message||'Eksporten feila.';button.setAttribute('aria-label','Prøv '+label+' igjen');onError(error)}
    }finally{exportTask=null;button.textContent=label;busy=false;dialog.setAttribute('aria-busy','false');for(const item of options.children)item.disabled=false}
  };
  for(const [index,[label,extension]]of formats.entries()){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','menuitem');button.tabIndex=index===0?0:-1;button.setAttribute('aria-label',extension==='vpng'?'Lagre PNG med original og redigerbare djupnedata':extension==='gif'?'Lagre saumlaus VATHOgraphy-GIF i endelaus løkke':extension==='entropi'?'Lagre redigerbar Entropi-fil':extension==='dng'?'Eksporter eksperimentell DNG':extension.startsWith('ai')?'AI-oppskaler '+extension.slice(2)+' gonger':'Eksporter '+label);
    button.style.cssText='display:grid;place-items:center;min-width:48px;width:100%;height:48px;padding:0 8px;border:0;outline:0;box-shadow:none;background:transparent;color:#d4d4d8;font:600 12px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;letter-spacing:.02em;touch-action:none';
    button.style.gridColumn=index<plainCount?'1 / -1':String(index-plainCount+1);button.style.gridRow=index<plainCount?String(plainCount-index+1):'1';
    button.addEventListener('click',event=>{event.stopPropagation();return choose(index)});options.append(button);
  }
  const unlisten=()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('visibilitychange',hidden);globalThis.removeEventListener?.('pagehide',close)};
  const listen=()=>{document.addEventListener('pointerdown',dismiss,true);document.addEventListener('visibilitychange',hidden);globalThis.addEventListener?.('pagehide',close)};
  dialog.addEventListener('close',()=>{if(!dialog.open){dialog.remove();unlisten();anchor?.setAttribute('aria-expanded','false');focus?.focus({preventScroll:true})}});
  dialog.addEventListener('cancel',()=>{disposed=true;exportTask?.abort()});
  dialog.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close()}
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();select((selected+(event.key==='ArrowUp'?1:formats.length-1)+formats.length)%formats.length);options.children[selected].focus({preventScroll:true})}
    else if(event.key==='Home'||event.key==='End'){event.preventDefault();select(event.key==='Home'?formats.length-1:0);options.children[selected].focus({preventScroll:true})}
    else if(event.key==='Tab')close();
  });
  dialog.append(options,status);parent.append(dialog);dialog.show();focus?.focus({preventScroll:true});anchor?.setAttribute('aria-expanded','true');listen();
  if(!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)dialog.animate?.([{opacity:0,transform:'translateY(6px) scale(.96)'},{opacity:1,transform:'none'}],{duration:130,easing:'cubic-bezier(.2,.8,.2,1)'});
  return {dialog,close,choose:()=>choose(selected),focus:()=>{select(0);options.children[0].focus({preventScroll:true})},point(x,y){select(Array.from(options.children).findIndex(button=>{const rect=button.getBoundingClientRect();return x>=rect.left-12&&x<=rect.right+12&&y>=rect.top&&y<=rect.bottom}));return selected}};
}

export function bindExportGesture(button,getOptions){
  let pointer=null,timer=null,menu=null,busy=false,suppressUntil=0,generation=0,status;
  const stopTimer=()=>{if(timer!==null)clearTimeout(timer);timer=null};
  const cancel=()=>{stopTimer();if(pointer)try{button.releasePointerCapture?.(pointer.id)}catch{}pointer=null;menu?.close();menu=null};
  const reset=()=>{generation++;suppressUntil=Date.now()+800;cancel()};
  const settings=()=>{const value=getOptions();return value&&{...value,anchor:button}};
  const open=()=>{const value=settings();if(!value?.image||value.isCurrent?.()===false)return null;menu?.close();menu=showExportOptions(value);return menu};
  button.style.touchAction='none';button.style.webkitTouchCallout='none';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-keyshortcuts','ArrowUp Shift+F10');button.setAttribute('aria-expanded','false');
  const down=event=>{
    if(event.isPrimary===false||event.button>0||busy||button.disabled)return;
    if(menu?.dialog.open&&!pointer){event.preventDefault();event.stopPropagation();reset();return}
    event.stopPropagation();cancel();suppressUntil=0;const value=settings();if(!value||value.isCurrent?.()===false)return;
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};try{button.setPointerCapture?.(event.pointerId)}catch{}
    if(value.image)timer=setTimeout(()=>{timer=null;if(pointer){suppressUntil=Date.now()+800;open()}},360);
  };
  const move=event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    if(menu){pointer.moved||=Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>10;event.preventDefault();event.stopPropagation();menu.point(event.clientX,event.clientY)}
    else if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>10)reset();
  };
  const up=async event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    const held=pointer;stopTimer();try{button.releasePointerCapture?.(pointer.id)}catch{}pointer=null;
    if(menu){event.preventDefault();event.stopPropagation();suppressUntil=Date.now()+800;if(!held.moved&&Math.hypot(event.clientX-held.x,event.clientY-held.y)<=10)return;const choice=menu;menu=null;if(choice.point(event.clientX,event.clientY)<0)choice.close();else{busy=true;try{await choice.choose()}finally{busy=false}}}
  };
  const other=event=>{if(pointer&&event.pointerId!==pointer.id)reset()};
  const click=async event=>{
    event.stopPropagation();if(Date.now()<suppressUntil){event.preventDefault();return}if(busy||button.disabled)return;
    const value=settings();if(!value||value.isCurrent?.()===false)return;busy=true;const ticket=generation,current=()=>ticket===generation&&value.isCurrent?.()!==false;
    button.setAttribute('aria-busy','true');
    try{const file=await prepareExport(value,value.document&&value.defaultFormat!=='png'?'tif':'png');await handOffExport(file,current)}
    catch(error){if(current()){if(!status){status=document.createElement('span');status.setAttribute('role','status');status.style.cssText=exportStatusStyle;button.append(status)}status.textContent=error.message||'Eksporten feila.';value.onError?.(error)}}
    finally{busy=false;button.setAttribute('aria-busy','false')}
  };
  const keys=event=>{if(event.key==='ArrowUp'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();cancel();open()?.focus()}else if(event.key==='Escape'){event.preventDefault();reset()}};
  const context=event=>{event.preventDefault();event.stopPropagation();if(!pointer){cancel();open()?.focus()}};
  const hidden=()=>{if(document.hidden&&document.querySelector('dialog[data-entropi-export]')?.getAttribute('data-ai-export')!=='true')reset()};
  const bindings=[[button,'pointerdown',down],[button,'click',click],[button,'keydown',keys],[button,'contextmenu',context],[document,'pointerdown',other,true],[document,'pointermove',move,true],[document,'pointerup',up,true],[document,'pointercancel',reset,true],[document,'visibilitychange',hidden],[globalThis,'pagehide',reset],[globalThis,'resize',reset]];
  for(const [target,name,handler,capture]of bindings)target.addEventListener?.(name,handler,capture);
  return ()=>{reset();status?.remove();for(const [target,name,handler,capture]of bindings)target.removeEventListener?.(name,handler,capture)};
}

function pickEntropiFiles(multiple){
  return new Promise(resolve=>{
    const input=document.createElement('input');
    input.type='file';input.accept=multiple?'image/*,.entropi,.png,.jpg,.jpeg,.webp,.heic,.heif,.avif':'.entropi,.png,image/png';input.multiple=multiple;input.hidden=true;
    const finish=files=>{input.remove();resolve(files)};
    input.addEventListener('cancel',()=>finish([]),{once:true});
    input.addEventListener('change',()=>finish(Array.from(input.files??[])),{once:true});
    document.body.append(input);input.click();
  });
}

async function readEntropiFile(file){
  if(file.name?.toLowerCase().endsWith('.png')||file.type==='image/png'){
    const embedded=await readVathographyPNG(file);
    if(!embedded)throw new Error('Dette er ei vanleg PNG utan innebygd VATHO-djupne.');
    return decodeEntropiDocument(embedded);
  }
  return decodeEntropiDocument(file);
}

export async function pickEntropiDocument(){
  const [file]=await pickEntropiFiles(false);
  return file?readEntropiFile(file):null;
}

const photoTypes={jpg:'jpeg',jpeg:'jpeg',png:'png',webp:'webp',gif:'gif',bmp:'bmp',avif:'avif',heic:'heic',heif:'heif',tif:'tiff',tiff:'tiff',svg:'svg+xml'};
async function readImportFile(file){
  const extension=(file.name??'').split('.').pop().toLowerCase();
  if(extension==='entropi'||file.type==='application/x-entropi')return {master:await decodeEntropiDocument(file)};
  const header=new Uint8Array(await file.slice(0,8).arrayBuffer());
  const png=header.length===8&&[137,80,78,71,13,10,26,10].every((byte,i)=>header[i]===byte);
  const type=png?'image/png':file.type?.startsWith('image/')?file.type:photoTypes[extension]?'image/'+photoTypes[extension]:null;
  if(!type)throw new Error('Dette filformatet er ikkje støtta.');
  const photo=file.type===type?file:file.slice(0,file.size,type);
  if(type==='image/png'){
    const payload=await readVathographyPNG(photo);
    if(payload)return {master:await decodeEntropiDocument(payload)};
  }
  // A picker-backed File may still hash correctly after IndexedDB reload but fail
  // to display in Chromium. Keep an independent, byte-identical image Blob.
  const parts=[],chunkSize=4*1024*1024;
  for(let offset=0;offset<photo.size;offset+=chunkSize){
    const bytes=await photo.slice(offset,offset+chunkSize).arrayBuffer();
    parts.push(new Blob([bytes]));
  }
  return {photo:new Blob(parts,{type:photo.type})};
}

export function renderImportFeedback(status,details,list,message='',errors=[]){
  status.textContent=message;
  details.open=false;
  details.hidden=errors.length===0;
  list.replaceChildren();
  for(const error of errors){
    const item=document.createElement('li');
    item.textContent=error;
    list.append(item);
  }
}

export async function importEntropiDocuments({button,archive,open,openPhoto,refresh,isCurrent,feedback}){
  if(button.disabled)return;
  button.disabled=true;
  try{
    const files=await pickEntropiFiles(true);
    if(!files.length||!isCurrent())return;
    let imported=0;
    const errors=[];
    for(const file of files){
      if(!isCurrent())return;
      try{
        const {master,photo}=await readImportFile(file);
        if(!isCurrent())return;
        if(master){
          if(files.length===1){await open(master);return}
          await archive.importDocument(master);
        }else{
          const record=await archive.save(photo,null,photo,null,file.name);
          if(files.length===1){if(isCurrent())await openPhoto(record.id);return}
        }
        imported++;
      }catch(error){errors.push(file.name+' ('+(error?.message||'ukjend feil')+')')}
    }
    if(isCurrent()){
      const summary='Importerte '+imported+' av '+files.length+(files.length===1?' fil.':' filer.');
      if(files.length===1)feedback(summary,errors);else await refresh(summary,errors);
    }
  }catch(error){if(isCurrent())feedback(error?.message||'Kunne ikkje importere filene.')}
  finally{button.disabled=false}
}
