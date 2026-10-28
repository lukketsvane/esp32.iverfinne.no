import { localDepthEndpoint, runLocalDepth, runBrowserDepth } from './depth-source.mjs';
import { runStereoDepth } from './stereo-depth.mjs';
import { normalizeDepth, toneDepth, VATHOGRAPHY_PRESETS } from './vathography.mjs';

export function createMarigoldView(host,{local=runLocalDepth,browser=runBrowserDepth,stereo=runStereoDepth,onStatus=()=>{},onGesture=()=>{},onChange=()=>{}}={}){
  const output=host.querySelector('.mg-output'),original=host.querySelector('.mg-original'),seam=host.querySelector('.mg-seam'),compare=host.querySelector('.mg-compare'),rail=host.querySelector('.mg-variants');
  const art=document.createElement('canvas');art.className='mg-art';art.hidden=true;host.prepend(art);
  const pulse=document.createElement('canvas');pulse.className='mg-pulse';pulse.hidden=true;pulse.setAttribute('aria-hidden','true');host.prepend(pulse);
  const motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const options=VATHOGRAPHY_PRESETS;
  rail.replaceChildren();
  const variants=options.map((option,index)=>{const button=document.createElement('button');button.type='button';button.className='mg-variant';button.setAttribute('aria-label',option.label);button.setAttribute('aria-pressed',String(index===0));button.appendChild(document.createElement('i'));rail.appendChild(button);return button});
  let current=null,controller=null,selection=1,comparing=false,split=.5,version=0,depth=null,position=0,bandWidth=1,frame=0,sourceWidth=0,sourceHeight=0,disposed=false,pulseFrame=0;
  const urls=[],points=new Map(),listeners=[];let previous=null,hold=0,gesture=null,lastTap=null,peeking=false,gestureChanged=false;
  const stopPulse=()=>{cancelAnimationFrame(pulseFrame);pulseFrame=0;pulse.hidden=true;pulse.width=pulse.height=1};
  const peek=value=>{peeking=value;host.classList.toggle('peeking',value)};
  const cancelHold=()=>{clearTimeout(hold);hold=0};
  const cancelGesture=()=>{stopPulse();cancelHold();peek(false);points.clear();previous=null;gesture=null;lastTap=null;if(current){if(gestureChanged)onChange();schedule()}gestureChanged=false};
  const listen=(element,name,handler,opts)=>{element.addEventListener(name,handler,opts);listeners.push(()=>element.removeEventListener(name,handler,opts))};
  const reset=()=>{
    version++;controller?.abort();controller=null;current=null;depth=null;comparing=false;cancelGesture();
    cancelAnimationFrame(frame);frame=0;host.hidden=true;art.hidden=true;host.classList.remove('comparing');output.removeAttribute('src');original.removeAttribute('src');
    for(const url of urls.splice(0))URL.revokeObjectURL(url);art.width=art.height=1;
  };
  function render(native=false){
    if(frame){cancelAnimationFrame(frame);frame=0}
    if(!depth||!current||selection>=VATHOGRAPHY_PRESETS.length)return;
    const scale=points.size&&!native?Math.min(1,768/Math.max(sourceWidth,sourceHeight)):1,width=Math.round(sourceWidth*scale),height=Math.round(sourceHeight*scale);
    const pixels=toneDepth(depth,current.width,current.height,{preset:selection,position,width:bandWidth,outputWidth:width,outputHeight:height,validity:current.validity});
    art.width=width;art.height=height;const context=art.getContext('2d');
    const image=context.createImageData(art.width,art.height);image.data.set(pixels);context.putImageData(image,0,0);
  }
  function startPulse(){
    stopPulse();if(motion?.matches||document.hidden)return;
    const scale=Math.min(1,512/Math.max(sourceWidth,sourceHeight));
    pulse.width=Math.max(1,Math.round(sourceWidth*scale));pulse.height=Math.max(1,Math.round(sourceHeight*scale));
    const context=pulse.getContext('2d');if(!context)return;
    const pixels=context.createImageData(pulse.width,pulse.height),samples=new Float32Array(pulse.width*pulse.height);
    for(let y=0;y<pulse.height;y++)for(let x=0;x<pulse.width;x++){
      const i=y*pulse.width+x,index=Math.min(current.height-1,Math.floor((y+.5)*current.height/pulse.height))*current.width+Math.min(current.width-1,Math.floor((x+.5)*current.width/pulse.width));
      samples[i]=current.validity&&current.validity[index]!==1?NaN:depth[index];
      pixels.data[i*4+3]=255;
    }
    context.putImageData(pixels,0,0);pulse.hidden=false;
    let started=null,last=-Infinity;
    const tick=now=>{
      pulseFrame=0;if(disposed||!current||host.hidden||document.hidden||motion?.matches){stopPulse();return}
      started??=now;const progress=(now-started)/1400;if(progress>=1){stopPulse();return}
      if(now-last>=1000/24){
        const centre=-.18+1.36*progress,opacity=46/255*Math.sin(Math.PI*progress);
        for(let i=0;i<samples.length;i++){
          if(!Number.isFinite(samples[i]))continue;
          const reveal=Math.max(0,Math.min(1,(centre-samples[i]+.16)/.32)),cover=1-reveal*reveal*(3-2*reveal),band=Math.max(0,1-Math.abs(samples[i]-centre)/.16),glow=opacity*band*band,alpha=glow+cover*(1-glow),shade=alpha?Math.round(255*glow/alpha):0;
          pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=shade;pixels.data[i*4+3]=Math.round(255*alpha);
        }
        context.putImageData(pixels,0,0);pulse.hidden=false;last=now;
      }
      pulseFrame=requestAnimationFrame(tick);
    };
    pulseFrame=requestAnimationFrame(tick);
  }
  function schedule(){if(!frame&&!disposed)frame=requestAnimationFrame(()=>render())}
  function select(index){
    stopPulse();if(!current)return false;
    const next=Math.max(0,Math.min(options.length-1,Math.round(index))),option=options[next];
    selection=next;art.hidden=false;output.hidden=true;render();
    for(const [i,button]of variants.entries())button.setAttribute('aria-pressed',String(i===selection));
    host.setAttribute('aria-label','VATHOgraphy Â· '+option.label+'. Dra for djupne, knip for breidd.');onChange();return true;
  }
  const adjust=event=>{const bounds=host.getBoundingClientRect();split=Math.max(.02,Math.min(.98,(event.clientX-bounds.left)/Math.max(1,bounds.width)));host.style.setProperty('--split',(split*100)+'%');seam.setAttribute('aria-valuenow',String(Math.round(split*100)))};
  const measure=()=>{const values=[...points.values()];return {x:values.reduce((n,p)=>n+p.x,0)/values.length,y:values.reduce((n,p)=>n+p.y,0)/values.length,gap:values.length===2?Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y):0}};
  const start=event=>{
    stopPulse();
    if(!current||host.hidden||event.button>0||event.target.closest('button'))return;
    cancelHold();points.set(event.pointerId,{x:event.clientX,y:event.clientY});host.setPointerCapture?.(event.pointerId);previous=measure();
    if(points.size===1){gestureChanged=false;gesture={id:event.pointerId,x:event.clientX,y:event.clientY,time:Number.isFinite(event.timeStamp)?event.timeStamp:Date.now(),moved:false};if(!comparing)hold=setTimeout(()=>{hold=0;if(!host.hidden&&current&&gesture&&!gesture.moved&&points.size===1){peek(true);lastTap=null;onGesture()}},450)}
    else{gesture=null;lastTap=null;peek(false)}
    if(comparing)adjust(event);
  };
  const move=event=>{
    if(!points.has(event.pointerId))return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});const next=measure();
    if(gesture&&!gesture.moved){if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<8)return;gesture.moved=true;lastTap=null;cancelHold();if(peeking){peek(false);previous=next;return}}
    if(comparing)adjust(event);
    else if(selection<VATHOGRAPHY_PRESETS.length&&previous){const bounds=host.getBoundingClientRect();if(points.size===1)position=Math.max(-1,Math.min(1,position+(next.x-previous.x)/Math.max(1,bounds.width)));else if(next.gap>0&&previous.gap>0)bandWidth=Math.max(.25,Math.min(3,bandWidth*next.gap/previous.gap));gestureChanged=true;schedule()}
    previous=next;event.preventDefault();onGesture();
  };
  const end=event=>{
    if(!points.has(event.pointerId))return;
    const tap=gesture,wasPeeking=peeking;cancelHold();peek(false);points.delete(event.pointerId);previous=points.size?measure():null;gesture=null;
    if(!points.size&&(art.width!==sourceWidth||art.height!==sourceHeight))schedule();
    if(event.type==='pointercancel'||event.type==='lostpointercapture'){lastTap=null;if(gestureChanged){gestureChanged=false;onChange();schedule()}return}
    if(!points.size){
      const now=Number.isFinite(event.timeStamp)?event.timeStamp:Date.now();
      if(!wasPeeking&&!comparing&&tap&&!tap.moved&&now-tap.time<300){if(lastTap&&now-lastTap.time<320&&Math.hypot(tap.x-lastTap.x,tap.y-lastTap.y)<24){lastTap=null;position=0;bandWidth=1;gestureChanged=true;onGesture()}else lastTap={x:tap.x,y:tap.y,time:now}}
      else lastTap=null;
      if(gestureChanged){gestureChanged=false;onChange();schedule()}
    }
  };
  for(const [name,handler]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end]])listen(host,name,handler,{passive:false});
  if(motion?.addEventListener)listen(motion,'change',()=>{if(motion.matches)stopPulse()});
  if(globalThis.addEventListener)listen(globalThis,'blur',cancelGesture);
  if(document.addEventListener)listen(document,'visibilitychange',()=>{if(document.hidden)cancelGesture()});
  listen(host,'contextmenu',event=>{if(!event.target.closest('button'))event.preventDefault()});
  listen(compare,'click',()=>{stopPulse();if(!current)return;comparing=!comparing;host.classList.toggle('comparing',comparing);compare.setAttribute('aria-pressed',String(comparing))});
  variants.forEach((button,index)=>listen(button,'click',()=>select(index)));
  listen(seam,'keydown',event=>{if(!comparing||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();split=Math.max(.02,Math.min(.98,split+(event.key==='ArrowRight'?.05:-.05)));host.style.setProperty('--split',(split*100)+'%');seam.setAttribute('aria-valuenow',String(Math.round(split*100)))});
  listen(host,'keydown',event=>{stopPulse();if(comparing||!current||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft'||event.key==='ArrowRight')position=Math.max(-1,Math.min(1,position+(event.key==='ArrowRight'?.02:-.02)));else bandWidth=Math.max(.25,Math.min(3,bandWidth*(event.key==='ArrowUp'?1.05:1/1.05)));schedule();onChange()});
  host.tabIndex=0;
  async function process(blob,signal,stored=null){
    const right=stored?.right instanceof Blob?stored.right:null;
    if(!stored?.result)stored=null;
    reset();const myVersion=version,task=new AbortController();controller=task;
    const stop=()=>task.abort(signal.reason||new DOMException('Avbrote.','AbortError'));signal?.addEventListener('abort',stop,{once:true});
    try{
      signal?.throwIfAborted();const endpoint=localDepthEndpoint();let result,stereoFailure;
      if(right&&!stored){try{result=await stereo(blob,right,{signal:task.signal,onProgress:onStatus})}catch(error){if(task.signal.aborted||error.name==='AbortError')throw error;stereoFailure=error.message;onStatus({phase:'fallback'})}}
      try{
        if(stored)result=stored.result;
        else if(!result&&endpoint)result=await local(blob,{signal:task.signal,onProgress:onStatus,endpoint});
        else if(!result)result=await browser(blob,{signal:task.signal,onProgress:onStatus});
      }catch(error){
        if(stored||task.signal.aborted||error.name==='AbortError'||!endpoint)throw error;
        onStatus({phase:'fallback'});
        result=await browser(blob,{signal:task.signal,onProgress:onStatus});result.fallbackReason=error.message;
      }
      if(stereoFailure){result.stereoFallbackReason=stereoFailure;result.provenance={...result.provenance,stereo:{accepted:false,reason:stereoFailure}}}
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      const originalURL=URL.createObjectURL(blob);urls.push(originalURL);original.src=originalURL;await original.decode();
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      sourceWidth=original.naturalWidth;sourceHeight=original.naturalHeight;
      if(!sourceWidth||!sourceHeight||sourceWidth*sourceHeight>16777216)throw new Error('Fotoet har ugyldig storleik.');
      if(task.signal.aborted||version!==myVersion)throw new DOMException('Avbrote.','AbortError');
      if(!result.depth||!Number.isInteger(result.width)||!Number.isInteger(result.height)||result.depth.length!==result.width*result.height)throw new Error('Ugyldig djupnekart.');
      depth=result.normalized?result.depth:normalizeDepth(result.depth,{polarity:result.polarity,validity:result.validity});current=result;host.dataset.model=result.model;host.dataset.source=result.source;
      if(stored){selection=stored.recipe.preset;position=stored.recipe.position;bandWidth=stored.recipe.width}
      host.style.setProperty('--split','50%');seam.setAttribute('aria-valuenow','50');compare.setAttribute('aria-pressed','false');select(selection);host.hidden=false;startPulse();
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
  return {process,restore,reset,select,snapshot,resetTone(){stopPulse();position=0;bandWidth=1;render();onChange()},get recipe(){return {preset:selection,position,width:bandWidth}},get ready(){return !!current},get result(){return current},get selectedName(){return options[selection].label},dispose(){reset();disposed=true;for(const remove of listeners)remove();art.remove();pulse.remove()}};
}
