import { encodeEntropiDocument, decodeEntropiDocument } from './entropi-document.mjs';
import { encodeDepthTiff, encodeDepthDng } from './entropi-export.mjs';
import { downloadFile, savePhoto } from './photo.mjs';

export async function saveEntropiFile(blob,name,isCurrent=()=>true){
  downloadFile(blob,name,isCurrent);
}

const exportFormats=[['PNG','png'],['.entropi','entropi'],['TIFF','tif'],['DNG','dng']];
const exportStatusStyle='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';

async function prepareExport({image,document:master,name='entropi',imageExtension='png'},extension){
  let blob;
  if(extension==='png')blob=await image();
  else{const value=await master();blob=extension==='entropi'?await encodeEntropiDocument(value):extension==='tif'?encodeDepthTiff(value.result):encodeDepthDng(value.result)}
  return {blob,name:name.replace(/\.[^.]+$/,'')+'.'+(extension==='png'?imageExtension:extension),image:extension==='png'};
}

async function handOffExport(file,isCurrent){
  if(!isCurrent())return;
  if(file.image)await savePhoto(file.blob,file.name,isCurrent);
  else await saveEntropiFile(file.blob,file.name,isCurrent);
}

export function showExportOptions(settings){
  const {document:master,isCurrent=()=>true,onError=()=>{},anchor=document.activeElement}=settings;
  if(!isCurrent()||document.querySelector('dialog[data-entropi-export]'))return null;
  const dialog=document.createElement('dialog'),options=document.createElement('div'),status=document.createElement('span'),focus=document.activeElement;
  const viewport=globalThis.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??globalThis.innerWidth??390,height=viewport?.height??globalThis.innerHeight??844;
  const bounds=anchor?.getBoundingClientRect?.()??{left:left+width/2-24,top:top+height-72,width:48},formats=master?exportFormats:[exportFormats[0]],size=formats.length*48+8;
  dialog.setAttribute('data-entropi-export','');dialog.setAttribute('aria-label','Eksporter bilete');dialog.setAttribute('role','menu');
  dialog.style.cssText='position:fixed;inset:auto;margin:0;padding:4px;width:96px;max-width:calc(100vw - 24px);box-sizing:border-box;border:0;border-radius:25px;background:linear-gradient(180deg,#ffffff1f,#ffffff04 58%),rgba(24,24,27,.62);color:#f5f5f7;box-shadow:inset 0 1px 0 #ffffff38,inset 0 0 0 1px #ffffff1c,0 10px 40px #0007,0 2px 8px #0004;backdrop-filter:blur(24px) saturate(180%) brightness(1.08);-webkit-backdrop-filter:blur(24px) saturate(180%) brightness(1.08);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;z-index:2147483647';
  dialog.style.left=Math.max(left+12,Math.min(left+width-108,bounds.left+bounds.width/2-48))+'px';
  dialog.style.top=Math.max(top+12,Math.min(top+height-size-12,bounds.top-size-10))+'px';
  options.style.cssText='display:flex;flex-direction:column-reverse';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.cssText=exportStatusStyle;
  let busy=false,selected=-1,disposed=false;
  const parent=anchor?.closest?.('dialog[open]')||document.body;
  const select=index=>{selected=index;Array.from(options.children).forEach((button,i)=>{button.setAttribute('aria-current',i===index?'true':'false');button.tabIndex=i===index?0:-1;button.style.transform=i===index?'scale(1.08)':'none';button.style.color=i===index?'#fff':'#d4d4d8'})};
  const close=()=>{disposed=true;dialog.close()};
  const dismiss=event=>{if(!dialog.contains(event.target)&&!anchor?.contains?.(event.target))close()};
  const hidden=()=>{if(document.hidden)close()};
  const choose=async index=>{
    if(index<0||busy||disposed||!isCurrent())return;
    const [label,extension]=formats[index],button=options.children[index];busy=true;let handedOff=false;dialog.setAttribute('aria-busy','true');
    for(const item of options.children)item.disabled=true;
    try{
      const file=await prepareExport(settings,extension);
      if(disposed||!isCurrent()||!dialog.open)return;
      handedOff=true;dialog.close();
      await handOffExport(file,isCurrent);
    }catch(error){
      const existing=document.querySelector('dialog[data-entropi-export]');
      if(handedOff&&!disposed&&isCurrent()&&!dialog.open&&(!existing||existing===dialog)){parent.append(dialog);dialog.show();focus?.focus({preventScroll:true});listen()}
      if(!disposed&&isCurrent()){status.textContent=error.message||'Eksporten feila.';button.setAttribute('aria-label','Prøv '+label+' igjen');onError(error)}
    }finally{busy=false;dialog.setAttribute('aria-busy','false');for(const item of options.children)item.disabled=false}
  };
  for(const [index,[label,extension]]of formats.entries()){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','menuitem');button.tabIndex=index===0?0:-1;button.setAttribute('aria-label',extension==='entropi'?'Lagre redigerbar Entropi-fil':extension==='dng'?'Eksporter eksperimentell DNG':'Eksporter '+label);
    button.style.cssText='display:grid;place-items:center;min-width:48px;width:100%;height:48px;padding:0 8px;border:0;outline:0;box-shadow:none;background:transparent;color:#d4d4d8;font:600 12px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;letter-spacing:.02em;touch-action:none';
    button.addEventListener('click',event=>{event.stopPropagation();return choose(index)});options.append(button);
  }
  const unlisten=()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('visibilitychange',hidden);globalThis.removeEventListener?.('pagehide',close)};
  const listen=()=>{document.addEventListener('pointerdown',dismiss,true);document.addEventListener('visibilitychange',hidden);globalThis.addEventListener?.('pagehide',close)};
  dialog.addEventListener('close',()=>{if(!dialog.open){dialog.remove();unlisten();anchor?.setAttribute('aria-expanded','false');focus?.focus({preventScroll:true})}});
  dialog.addEventListener('cancel',()=>{disposed=true});
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
  const open=()=>{const value=settings();if(!value?.document||value.isCurrent?.()===false)return null;menu?.close();menu=showExportOptions(value);return menu};
  button.style.touchAction='none';button.style.webkitTouchCallout='none';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-keyshortcuts','ArrowUp Shift+F10');button.setAttribute('aria-expanded','false');
  const down=event=>{
    if(event.isPrimary===false||event.button>0||busy||button.disabled)return;
    if(menu?.dialog.open&&!pointer){event.preventDefault();event.stopPropagation();reset();return}
    event.stopPropagation();cancel();suppressUntil=0;const value=settings();if(!value||value.isCurrent?.()===false)return;
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};try{button.setPointerCapture?.(event.pointerId)}catch{}
    if(value.document)timer=setTimeout(()=>{timer=null;if(pointer){suppressUntil=Date.now()+800;open()}},360);
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
    try{const file=await prepareExport(value,value.document?'tif':'png');await handOffExport(file,current)}
    catch(error){if(current()){if(!status){status=document.createElement('span');status.setAttribute('role','status');status.style.cssText=exportStatusStyle;button.append(status)}status.textContent=error.message||'Eksporten feila.';value.onError?.(error)}}
    finally{busy=false;button.setAttribute('aria-busy','false')}
  };
  const keys=event=>{if(event.key==='ArrowUp'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();cancel();open()?.focus()}else if(event.key==='Escape'){event.preventDefault();reset()}};
  const context=event=>{event.preventDefault();event.stopPropagation();if(!pointer){cancel();open()?.focus()}};
  const hidden=()=>{if(document.hidden)reset()};
  const bindings=[[button,'pointerdown',down],[button,'click',click],[button,'keydown',keys],[button,'contextmenu',context],[document,'pointerdown',other,true],[document,'pointermove',move,true],[document,'pointerup',up,true],[document,'pointercancel',reset,true],[document,'visibilitychange',hidden],[globalThis,'pagehide',reset],[globalThis,'resize',reset]];
  for(const [target,name,handler,capture]of bindings)target.addEventListener?.(name,handler,capture);
  return ()=>{reset();status?.remove();for(const [target,name,handler,capture]of bindings)target.removeEventListener?.(name,handler,capture)};
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
