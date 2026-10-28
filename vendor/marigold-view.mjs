import { runMarigoldV2 } from './marigold-v2.mjs';
import { localDepthEndpoint, runLocalDepth, runBrowserDepth } from './depth-source.mjs';
import { normalizeDepth, toneDepth, decodeSpectral, VATHOGRAPHY_PRESETS } from './vathography.mjs';

export function createMarigoldView(host,{run=runMarigoldV2,local=runLocalDepth,browser=runBrowserDepth,onStatus=()=>{},onGesture=()=>{},onMarigoldRequest=()=>{}}={}){
  const output=host.querySelector('.mg-output'),original=host.querySelector('.mg-original'),seam=host.querySelector('.mg-seam'),compare=host.querySelector('.mg-compare'),rail=host.querySelector('.mg-variants');
  const art=document.createElement('canvas'),raster=document.createElement('canvas');art.className='mg-art';art.hidden=true;host.prepend(art);
  const quality=document.createElement('button');quality.type='button';quality.className='mg-quality';quality.setAttribute('aria-label','Rekn med Marigold V2 på Hugging Face');quality.title='Marigold V2';quality.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17H6a4 4 0 0 1-.7-7.94A6 6 0 0 1 17 8a4.5 4.5 0 0 1 1 8.9h-1M12 20V10m-3 3 3-3 3 3"/></svg>';host.appendChild(quality);
  const options=VATHOGRAPHY_PRESETS;
  rail.replaceChildren();
  const variants=options.map((option,index)=>{const button=document.createElement('button');button.type='button';button.className='mg-variant';button.setAttribute('aria-label',option.label);button.setAttribute('aria-pressed',String(index===0));button.appendChild(document.createElement('i'));rail.appendChild(button);return button});
  let current=null,controller=null,selection=1,comparing=false,split=.5,version=0,depth=null,position=0,bandWidth=1,frame=0,sourceWidth=0,sourceHeight=0,disposed=false,cancelConsent=null;
  const urls=[],points=new Map(),listeners=[];let previous=null;
  const listen=(element,name,handler,opts)=>{element.addEventListener(name,handler,opts);listeners.push(()=>element.removeEventListener(name,handler,opts))};
  const reset=()=>{
    version++;controller?.abort();controller=null;cancelConsent?.();current=null;depth=null;comparing=false;points.clear();previous=null;
    cancelAnimationFrame(frame);frame=0;host.hidden=true;art.hidden=true;host.classList.remove('comparing');output.removeAttribute('src');original.removeAttribute('src');
    for(const url of urls.splice(0))URL.revokeObjectURL(url);art.width=art.height=raster.width=raster.height=1;
  };
  function render(native=false){
    if(frame){cancelAnimationFrame(frame);frame=0}
    if(!depth||!current||selection>=VATHOGRAPHY_PRESETS.length)return;
    const scale=points.size&&!native?Math.min(1,768/Math.max(sourceWidth,sourceHeight)):1,width=Math.round(sourceWidth*scale),height=Math.round(sourceHeight*scale);
    const pixels=toneDepth(depth,current.width,current.height,{preset:selection,position,width:bandWidth,outputWidth:width,outputHeight:height});
    art.width=width;art.height=height;const context=art.getContext('2d');
    const image=context.createImageData(art.width,art.height);image.data.set(pixels);context.putImageData(image,0,0);
  }
  function schedule(){if(!frame&&!disposed)frame=requestAnimationFrame(()=>render())}
  function select(index){
    if(!current)return false;
    const next=Math.max(0,Math.min(options.length-1,Math.round(index))),option=options[next];
    selection=next;art.hidden=false;output.hidden=true;render();
    for(const [i,button]of variants.entries())button.setAttribute('aria-pressed',String(i===selection));
    host.setAttribute('aria-label','VATHOgraphy · '+option.label+'. Dra for djupne, knip for breidd.');return true;
  }
  const adjust=event=>{const bounds=host.getBoundingClientRect();split=Math.max(.02,Math.min(.98,(event.clientX-bounds.left)/Math.max(1,bounds.width)));host.style.setProperty('--split',(split*100)+'%');seam.setAttribute('aria-valuenow',String(Math.round(split*100)))};
  const measure=()=>{const values=[...points.values()];return {x:values.reduce((n,p)=>n+p.x,0)/values.length,y:values.reduce((n,p)=>n+p.y,0)/values.length,gap:values.length===2?Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y):0}};
  const start=event=>{if(!current||host.hidden||event.target.closest('button'))return;points.set(event.pointerId,{x:event.clientX,y:event.clientY});host.setPointerCapture?.(event.pointerId);previous=measure();if(comparing)adjust(event)};
  const move=event=>{
    if(!points.has(event.pointerId))return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});const next=measure();
    if(comparing)adjust(event);
    else if(selection<VATHOGRAPHY_PRESETS.length&&previous){const bounds=host.getBoundingClientRect();if(points.size===1)position=Math.max(-1,Math.min(1,position+(next.x-previous.x)/Math.max(1,bounds.width)));else if(next.gap>0&&previous.gap>0)bandWidth=Math.max(.25,Math.min(3,bandWidth*next.gap/previous.gap));schedule()}
    previous=next;event.preventDefault();onGesture();
  };
  const end=event=>{points.delete(event.pointerId);previous=points.size?measure():null;if(!points.size)schedule()};
  for(const [name,handler]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end]])listen(host,name,handler,{passive:false});
  listen(quality,'click',()=>{if(current)onMarigoldRequest()});
  listen(compare,'click',()=>{if(!current)return;comparing=!comparing;host.classList.toggle('comparing',comparing);compare.setAttribute('aria-pressed',String(comparing))});
  variants.forEach((button,index)=>listen(button,'click',()=>select(index)));
  listen(seam,'keydown',event=>{if(!comparing||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();split=Math.max(.02,Math.min(.98,split+(event.key==='ArrowRight'?.05:-.05)));host.style.setProperty('--split',(split*100)+'%');seam.setAttribute('aria-valuenow',String(Math.round(split*100)))});
  listen(host,'keydown',event=>{if(comparing||!current||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft'||event.key==='ArrowRight')position=Math.max(-1,Math.min(1,position+(event.key==='ArrowRight'?.02:-.02)));else bandWidth=Math.max(.25,Math.min(3,bandWidth*(event.key==='ArrowUp'?1.05:1/1.05)));schedule()});
  host.tabIndex=0;
  async function consent(signal){
    let agreed=false;try{agreed=localStorage.getItem('entropi-marigold-v2-consent')==='yes'}catch{}
    if(agreed)return;
    const dialog=document.createElement('dialog');dialog.className='mg-consent';dialog.innerHTML='<p>Marigold V2 sender fotografiet til Hugging Face for djupneberekning. Ved utilgjengeleg teneste kan ein mindre modell rekne på denne eininga.</p><div><button type="button" data-no>Avbryt</button><button type="button" data-yes>Bruk Marigold</button></div>';document.body.append(dialog);
    let stop;
    try{
      const accepted=await new Promise(resolve=>{cancelConsent=()=>resolve(false);stop=cancelConsent;dialog.querySelector('[data-no]').addEventListener('click',()=>resolve(false),{once:true});dialog.querySelector('[data-yes]').addEventListener('click',()=>resolve(true),{once:true});dialog.addEventListener('cancel',event=>{event.preventDefault();resolve(false)},{once:true});signal?.addEventListener('abort',stop,{once:true});dialog.showModal();if(signal?.aborted)stop()});
      if(!accepted)throw new DOMException('Avbrote.','AbortError');try{localStorage.setItem('entropi-marigold-v2-consent','yes')}catch{}
    }finally{signal?.removeEventListener('abort',stop);if(cancelConsent===stop)cancelConsent=null;dialog.close();dialog.remove()}
  }
  async function process(blob,signal,{provider='auto'}={}){
    reset();const myVersion=version,task=new AbortController();controller=task;
    const stop=()=>task.abort(signal.reason||new DOMException('Avbrote.','AbortError'));signal?.addEventListener('abort',stop,{once:true});
    try{
      signal?.throwIfAborted();const endpoint=localDepthEndpoint();let result;
      try{
        if(provider==='marigold'){await consent(task.signal);task.signal.throwIfAborted();result=await run(blob,{signal:task.signal,onProgress:onStatus})}
        else if(endpoint)result=await local(blob,{signal:task.signal,onProgress:onStatus,endpoint});
        else result=await browser(blob,{signal:task.signal,onProgress:onStatus});
      }catch(error){
        if(task.signal.aborted||error.name==='AbortError'||provider!=='marigold'&&!endpoint)throw error;
        onStatus({phase:'fallback'});
        if(provider==='marigold'&&endpoint){try{result=await local(blob,{signal:task.signal,onProgress:onStatus,endpoint})}catch(fallbackError){if(task.signal.aborted||fallbackError.name==='AbortError')throw fallbackError}}
        if(!result)result=await browser(blob,{signal:task.signal,onProgress:onStatus});result.fallbackReason=error.message;
      }
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      const originalURL=URL.createObjectURL(blob);urls.push(originalURL);original.src=originalURL;await original.decode();
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      sourceWidth=original.naturalWidth;sourceHeight=original.naturalHeight;
      if(!sourceWidth||!sourceHeight||sourceWidth*sourceHeight>16777216)throw new Error('Fotoet har ugyldig storleik.');
      if(!result.depth){
        const map=result.images?.get('See-through Depth')||result.images?.get('Depth');if(!(map instanceof Blob))throw new Error('Modellen leverte ikkje djupnekart.');
        const image=new Image(),url=URL.createObjectURL(map);urls.push(url);image.src=url;await image.decode();if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');raster.width=image.naturalWidth;raster.height=image.naturalHeight;
        const context=raster.getContext('2d');context.drawImage(image,0,0);result={...result,width:raster.width,height:raster.height,depth:decodeSpectral(context.getImageData(0,0,raster.width,raster.height).data,raster.width,raster.height),polarity:'far',normalized:true,source:'Marigold Spectral visualization'};
      }
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      if(!Number.isInteger(result.width)||!Number.isInteger(result.height)||result.depth.length!==result.width*result.height)throw new Error('Ugyldig djupnekart.');
      depth=result.normalized?result.depth:normalizeDepth(result.depth,{polarity:result.polarity});current=result;host.dataset.model=result.model;host.dataset.source=result.source;
      host.style.setProperty('--split','50%');seam.setAttribute('aria-valuenow','50');compare.setAttribute('aria-pressed','false');select(selection);host.hidden=false;
      onStatus({phase:'ready',model:result.model,source:result.source,width:result.width,height:result.height});return result;
    }finally{signal?.removeEventListener('abort',stop);if(controller===task)controller=null}
  }
  function snapshot(native=true){
    if(!current)throw new Error('Djupnebiletet er ikkje klart.');render(true);
    const source=art;
    const canvas=document.createElement('canvas');canvas.width=native?sourceWidth:384;canvas.height=native?sourceHeight:Math.max(1,Math.round(384*sourceHeight/sourceWidth));const context=canvas.getContext('2d');context.drawImage(source,0,0,canvas.width,canvas.height);return context.getImageData(0,0,canvas.width,canvas.height);
  }
  return {process,reset,select,snapshot,resetTone(){position=0;bandWidth=1;render()},get ready(){return !!current},get result(){return current},get selectedName(){return options[selection].label},dispose(){reset();disposed=true;for(const remove of listeners)remove();art.remove()}};
}
