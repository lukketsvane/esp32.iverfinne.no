import { localDepthEndpoint, runLocalDepth, runBrowserDepth } from './depth-source.mjs';
import { normalizeDepth, toneDepth, VATHOGRAPHY_PRESETS } from './vathography.mjs';

export function createMarigoldView(host,{local=runLocalDepth,browser=runBrowserDepth,onStatus=()=>{},onGesture=()=>{},onChange=()=>{}}={}){
  const output=host.querySelector('.mg-output'),original=host.querySelector('.mg-original'),seam=host.querySelector('.mg-seam'),compare=host.querySelector('.mg-compare'),rail=host.querySelector('.mg-variants');
  const art=document.createElement('canvas');art.className='mg-art';art.hidden=true;host.prepend(art);
  const options=VATHOGRAPHY_PRESETS;
  rail.replaceChildren();
  const variants=options.map((option,index)=>{const button=document.createElement('button');button.type='button';button.className='mg-variant';button.setAttribute('aria-label',option.label);button.setAttribute('aria-pressed',String(index===0));button.appendChild(document.createElement('i'));rail.appendChild(button);return button});
  let current=null,controller=null,selection=1,comparing=false,split=.5,version=0,depth=null,position=0,bandWidth=1,frame=0,sourceWidth=0,sourceHeight=0,disposed=false;
  const urls=[],points=new Map(),listeners=[];let previous=null;
  const listen=(element,name,handler,opts)=>{element.addEventListener(name,handler,opts);listeners.push(()=>element.removeEventListener(name,handler,opts))};
  const reset=()=>{
    version++;controller?.abort();controller=null;current=null;depth=null;comparing=false;points.clear();previous=null;
    cancelAnimationFrame(frame);frame=0;host.hidden=true;art.hidden=true;host.classList.remove('comparing');output.removeAttribute('src');original.removeAttribute('src');
    for(const url of urls.splice(0))URL.revokeObjectURL(url);art.width=art.height=1;
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
    host.setAttribute('aria-label','VATHOgraphy · '+option.label+'. Dra for djupne, knip for breidd.');onChange();return true;
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
  const end=event=>{points.delete(event.pointerId);previous=points.size?measure():null;if(!points.size){schedule();onChange()}};
  for(const [name,handler]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end]])listen(host,name,handler,{passive:false});
  listen(compare,'click',()=>{if(!current)return;comparing=!comparing;host.classList.toggle('comparing',comparing);compare.setAttribute('aria-pressed',String(comparing))});
  variants.forEach((button,index)=>listen(button,'click',()=>select(index)));
  listen(seam,'keydown',event=>{if(!comparing||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();split=Math.max(.02,Math.min(.98,split+(event.key==='ArrowRight'?.05:-.05)));host.style.setProperty('--split',(split*100)+'%');seam.setAttribute('aria-valuenow',String(Math.round(split*100)))});
  listen(host,'keydown',event=>{if(comparing||!current||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft'||event.key==='ArrowRight')position=Math.max(-1,Math.min(1,position+(event.key==='ArrowRight'?.02:-.02)));else bandWidth=Math.max(.25,Math.min(3,bandWidth*(event.key==='ArrowUp'?1.05:1/1.05)));schedule();onChange()});
  host.tabIndex=0;
  async function process(blob,signal,stored=null){
    if(!stored?.result)stored=null;
    reset();const myVersion=version,task=new AbortController();controller=task;
    const stop=()=>task.abort(signal.reason||new DOMException('Avbrote.','AbortError'));signal?.addEventListener('abort',stop,{once:true});
    try{
      signal?.throwIfAborted();const endpoint=localDepthEndpoint();let result;
      try{
        if(stored)result=stored.result;
        else if(endpoint)result=await local(blob,{signal:task.signal,onProgress:onStatus,endpoint});
        else result=await browser(blob,{signal:task.signal,onProgress:onStatus});
      }catch(error){
        if(stored||task.signal.aborted||error.name==='AbortError'||!endpoint)throw error;
        onStatus({phase:'fallback'});
        result=await browser(blob,{signal:task.signal,onProgress:onStatus});result.fallbackReason=error.message;
      }
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      const originalURL=URL.createObjectURL(blob);urls.push(originalURL);original.src=originalURL;await original.decode();
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      sourceWidth=original.naturalWidth;sourceHeight=original.naturalHeight;
      if(!sourceWidth||!sourceHeight||sourceWidth*sourceHeight>16777216)throw new Error('Fotoet har ugyldig storleik.');
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      if(!result.depth||!Number.isInteger(result.width)||!Number.isInteger(result.height)||result.depth.length!==result.width*result.height)throw new Error('Ugyldig djupnekart.');
      const measured=result.validity?Float32Array.from(result.depth,(value,index)=>result.validity[index]?value:NaN):result.depth;
      depth=result.normalized?measured:normalizeDepth(measured,{polarity:result.polarity});current=result;host.dataset.model=result.model;host.dataset.source=result.source;
      if(stored){selection=stored.recipe.preset;position=stored.recipe.position;bandWidth=stored.recipe.width}
      host.style.setProperty('--split','50%');seam.setAttribute('aria-valuenow','50');compare.setAttribute('aria-pressed','false');select(selection);host.hidden=false;
      onStatus({phase:'ready',model:result.model,source:result.source,width:result.width,height:result.height});return result;
    }finally{signal?.removeEventListener('abort',stop);if(controller===task)controller=null}
  }
  function snapshot(native=true){
    if(!current)throw new Error('Djupnebiletet er ikkje klart.');render(true);
    const source=art;
    const canvas=document.createElement('canvas');canvas.width=native?sourceWidth:384;canvas.height=native?sourceHeight:Math.max(1,Math.round(384*sourceHeight/sourceWidth));const context=canvas.getContext('2d');context.drawImage(source,0,0,canvas.width,canvas.height);return context.getImageData(0,0,canvas.width,canvas.height);
  }
  async function restore(blob,result,recipe,signal){
    if(!recipe||!Number.isInteger(recipe.preset)||recipe.preset<0||recipe.preset>=options.length||!Number.isFinite(recipe.position)||Math.abs(recipe.position)>1||!Number.isFinite(recipe.width)||recipe.width<.25||recipe.width>3)throw new Error('Ugyldig uttrykk i Entropi-fila.');
    return process(blob,signal,{result,recipe});
  }
  return {process,restore,reset,select,snapshot,resetTone(){position=0;bandWidth=1;render();onChange()},get recipe(){return {preset:selection,position,width:bandWidth}},get ready(){return !!current},get result(){return current},get selectedName(){return options[selection].label},dispose(){reset();disposed=true;for(const remove of listeners)remove();art.remove()}};
}
