import { localDepthEndpoint, runLocalDepth, runBrowserDepth } from './depth-source.mjs';
import { runStereoDepth } from './stereo-depth.mjs';
import { normalizeDepth, toneDepth, VATHOGRAPHY_PRESETS } from './vathography.mjs';
import { normalizePhotoEdits, photoEditsNeutral, applyPhotoEdits } from './photo-adjustments.mjs';
import { createPhotoEditor } from './photo-editor.mjs';
import { attachNotchRail } from './notch-rail.mjs';
import { applyPanoramaMask } from './panorama.mjs';

export function createMarigoldView(host,{local=runLocalDepth,browser=runBrowserDepth,stereo=runStereoDepth,onStatus=()=>{},onGesture=()=>{},onChange=()=>{}}={}){
  const output=host.querySelector('.mg-output'),original=host.querySelector('.mg-original'),seam=host.querySelector('.mg-seam'),compare=host.querySelector('.mg-compare'),rail=host.querySelector('.mg-variants');
  const art=document.createElement('canvas');art.className='mg-art';art.hidden=true;host.prepend(art);
  const croppedOriginal=document.createElement('canvas');croppedOriginal.className='mg-original mg-original-crop';croppedOriginal.hidden=true;host.appendChild(croppedOriginal);
  const pulse=document.createElement('canvas');pulse.className='mg-pulse';pulse.hidden=true;pulse.setAttribute('aria-hidden','true');host.prepend(pulse);
  const motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const options=VATHOGRAPHY_PRESETS;
  rail.replaceChildren();
  const variants=options.map((option,index)=>{const button=document.createElement('button');button.type='button';button.className='mg-variant';button.setAttribute('aria-label',option.label);button.setAttribute('aria-pressed',String(index===0));button.appendChild(document.createElement('i'));rail.appendChild(button);return button});
  let current=null,controller=null,selection=1,comparing=false,split=.5,version=0,depth=null,position=0,bandWidth=1,frame=0,sourceWidth=0,sourceHeight=0,disposed=false,pulseFrame=0,editing=false,originalCropKey='',railStartSelection=1;
  const urls=[],points=new Map(),listeners=[];let previous=null,hold=0,gesture=null,lastTap=null,peeking=false,gestureChanged=false;
  const stopPulse=()=>{cancelAnimationFrame(pulseFrame);pulseFrame=0;pulse.hidden=true;pulse.width=pulse.height=1};
  const peek=value=>{peeking=value;host.classList.toggle('peeking',value)};
  const cancelHold=()=>{clearTimeout(hold);hold=0};
  const cancelGesture=()=>{stopPulse();cancelHold();peek(false);points.clear();previous=null;gesture=null;lastTap=null;multiTap=lastMultiTap=null;navigationStart=null;gestureMode=null;if(current){if(gestureChanged)onChange();schedule()}gestureChanged=false};
  const listen=(element,name,handler,opts)=>{element.addEventListener(name,handler,opts);listeners.push(()=>element.removeEventListener(name,handler,opts))};
  const reset=()=>{
    version++;controller?.abort();controller=null;current=null;depth=null;comparing=false;depthRail.cancel();cancelGesture();resetNavigation();editor.set();
    cancelAnimationFrame(frame);frame=0;host.hidden=true;art.hidden=true;host.classList.remove('comparing');output.removeAttribute('src');original.removeAttribute('src');
    for(const url of urls.splice(0))URL.revokeObjectURL(url);art.width=art.height=1;croppedOriginal.width=croppedOriginal.height=1;croppedOriginal.hidden=true;original.hidden=false;originalCropKey='';editing=false;
  };
  const editor=createPhotoEditor(host,{onInput:(interactive=true)=>{editing=interactive;stopPulse();schedule()},onChange,onActive:active=>{cancelGesture();if(active){comparing=false;host.classList.remove('comparing');compare.setAttribute('aria-pressed','false');if(editor.cropping)resetNavigation()}onGesture()},getPreview:()=>{
    if(!current)return null;const scale=Math.min(1,96/Math.max(sourceWidth,sourceHeight)),width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
    return {data:toneDepth(depth,current.width,current.height,{preset:selection,position,width:bandWidth,outputWidth:width,outputHeight:height,validity:current.validity}),width,height};
  }});
  const depthRail=attachNotchRail(rail,variants,{enabled:()=>!!current&&!host.hidden&&!editor.cropping,onStart:()=>{railStartSelection=selection;cancelGesture();editor.commit();comparing=false;host.classList.remove('comparing');compare.setAttribute('aria-pressed','false');onGesture()},onSelect:index=>{if(index!==selection)select(index,{persist:false,preview:true})},onTap:index=>{if(index!==selection)select(index,{persist:false,preview:true})},onEnd:()=>{if(current){if(selection!==railStartSelection)onChange();schedule()}}});
  function render(native=false,committed=false){
    if(frame){cancelAnimationFrame(frame);frame=0}
    if(!depth||!current||selection>=VATHOGRAPHY_PRESETS.length)return;
    const scale=(points.size||editing||depthRail.active)&&!native?Math.min(1,(editing||depthRail.active?512:768)/Math.max(sourceWidth,sourceHeight)):1,width=Math.round(sourceWidth*scale),height=Math.round(sourceHeight*scale);
    const pixels=toneDepth(depth,current.width,current.height,{preset:committed&&depthRail.active?railStartSelection:selection,position,width:bandWidth,outputWidth:width,outputHeight:height,validity:current.validity});
    const edits=committed?editor.committed:editor.edits;if(editor.cropping&&!committed)edits.crop={x:0,y:0,width:1,height:1};
    const adjusted=applyPhotoEdits(pixels,width,height,edits,{referenceWidth:sourceWidth,referenceHeight:sourceHeight});
    art.width=adjusted.width;art.height=adjusted.height;const context=art.getContext('2d');
    const image=context.createImageData(art.width,art.height);image.data.set(adjusted.data);context.putImageData(image,0,0);
    const crop=edits.crop,cropped=crop.width!==1||crop.height!==1;original.hidden=cropped;croppedOriginal.hidden=!cropped;
    if(cropped){const key=JSON.stringify(crop);if(key!==originalCropKey){const left=Math.min(sourceWidth-1,Math.round(crop.x*sourceWidth)),top=Math.min(sourceHeight-1,Math.round(crop.y*sourceHeight));croppedOriginal.width=Math.max(1,Math.round((crop.x+crop.width)*sourceWidth)-left);croppedOriginal.height=Math.max(1,Math.round((crop.y+crop.height)*sourceHeight)-top);croppedOriginal.getContext('2d').drawImage(original,left,top,croppedOriginal.width,croppedOriginal.height,0,0,croppedOriginal.width,croppedOriginal.height);originalCropKey=key}}
    updateSplit();
  }
  function startPulse(){
    stopPulse();if(motion?.matches||document.hidden||editor.edits.crop.width!==1||editor.edits.crop.height!==1)return;
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
  function select(index,{persist=true,preview=false}={}){
    stopPulse();if(!current)return false;editor.commit();
    const next=Math.max(0,Math.min(options.length-1,Math.round(index))),option=options[next];
    selection=next;art.hidden=false;output.hidden=true;if(preview)schedule();else render();
    for(const [i,button]of variants.entries())button.setAttribute('aria-pressed',String(i===selection));
    host.setAttribute('aria-label','VATHOgraphy · '+option.label+'. Éin finger for djupne. To fingrar for panorering og zoom. Tre fingrar for bandbreidd. Dobbelttrykk med to fingrar for å sentrere.');if(persist)onChange();return true;
  }
  let viewPose={scale:1,x:0,y:0},navigationStart=null,multiTap=null,lastMultiTap=null,gestureMode=null;
  function imageBounds(box=art.getBoundingClientRect()){
    const factor=Math.min(box.width/Math.max(1,art.width),box.height/Math.max(1,art.height)),width=art.width*factor,height=art.height*factor;
    return {left:box.left+(box.width-width)/2,top:box.top+(box.height-height)/2,width,height};
  }
  function updateSplit(){
    if(!current||host.hidden)return;
    const parent=host.getBoundingClientRect(),box=art.getBoundingClientRect(),bounds=imageBounds(box),left=bounds.left+split*bounds.width,top=Math.max(parent.top,bounds.top),bottom=Math.min(parent.top+parent.height,bounds.top+bounds.height);
    host.style.setProperty('--split',(100*(left-box.left)/Math.max(1,box.width))+'%');host.style.setProperty('--split-left',(left-parent.left)+'px');host.style.setProperty('--split-top',(top-parent.top)+'px');host.style.setProperty('--split-height',Math.max(0,bottom-top)+'px');seam.setAttribute('aria-valuenow',String(Math.round(split*100)));
  }
  function setNavigation(next){
    const bounds=imageBounds(),parent=host.getBoundingClientRect(),baseWidth=bounds.width/viewPose.scale,baseHeight=bounds.height/viewPose.scale,scale=Math.max(1,Math.min(8,next.scale)),maxX=Math.max(0,(parent.width-baseWidth)/2)+baseWidth*(scale-1)/2,maxY=Math.max(0,(parent.height-baseHeight)/2)+baseHeight*(scale-1)/2;
    viewPose={scale,x:Math.max(-maxX,Math.min(maxX,next.x)),y:Math.max(-maxY,Math.min(maxY,next.y))};
    host.style.setProperty('--view-scale',String(viewPose.scale));host.style.setProperty('--view-x',viewPose.x+'px');host.style.setProperty('--view-y',viewPose.y+'px');updateSplit();
  }
  function resetNavigation(){
    viewPose={scale:1,x:0,y:0};host.style.setProperty('--view-scale','1');host.style.setProperty('--view-x','0px');host.style.setProperty('--view-y','0px');updateSplit();
  }
  function navigate(from,to){
    const start=navigationStart;if(!start)return;
    const bounds=art.getBoundingClientRect(),centreX=bounds.left+bounds.width/2-viewPose.x,centreY=bounds.top+bounds.height/2-viewPose.y,scale=Math.max(1,Math.min(8,start.pose.scale*(start.measure.gap>0&&to.gap>0?to.gap/start.measure.gap:1))),factor=scale/start.pose.scale;
    setNavigation({scale,x:to.x-centreX-(start.measure.x-centreX-start.pose.x)*factor,y:to.y-centreY-(start.measure.y-centreY-start.pose.y)*factor});
  }
  const adjust=event=>{const bounds=imageBounds();split=Math.max(.02,Math.min(.98,(event.clientX-bounds.left)/Math.max(1,bounds.width)));updateSplit()};
  const measure=()=>{const values=[...points.values()],x=values.reduce((n,p)=>n+p.x,0)/values.length,y=values.reduce((n,p)=>n+p.y,0)/values.length;return {x,y,gap:values.length>1?2*Math.sqrt(values.reduce((n,p)=>n+(p.x-x)**2+(p.y-y)**2,0)/values.length):0}};
  const start=event=>{
    stopPulse();
    if(!current||host.hidden||event.button>0||depthRail.active||editor.active||event.target.closest('button,input,.mg-editor,.mg-variants'))return;
    cancelHold();points.set(event.pointerId,{x:event.clientX,y:event.clientY});host.setPointerCapture?.(event.pointerId);previous=measure();
    const now=Number.isFinite(event.timeStamp)?event.timeStamp:Date.now();
    if(points.size===1){gestureMode=comparing?'compare':'tone';gestureChanged=false;gesture={id:event.pointerId,x:event.clientX,y:event.clientY,time:now,moved:false};if(!comparing)hold=setTimeout(()=>{hold=0;if(!host.hidden&&current&&gesture&&!gesture.moved&&points.size===1){peek(true);lastTap=null;lastMultiTap=null;onGesture()}},450)}
    else{
      gesture=null;lastTap=null;peek(false);event.preventDefault();onGesture();
      if(points.size===2){gestureMode='view';navigationStart={pose:{...viewPose},measure:{...previous}};multiTap={x:previous.x,y:previous.y,gap:previous.gap,time:now,moved:false}}
      else{gestureMode='width';navigationStart=null;multiTap=lastMultiTap=null}
    }
  };
  const move=event=>{
    if(!points.has(event.pointerId))return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});const next=measure();
    if(gesture&&!gesture.moved){if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<8)return;gesture.moved=true;lastTap=lastMultiTap=null;cancelHold();if(peeking){peek(false);previous=next;return}}
    if(multiTap&&(Math.hypot(next.x-multiTap.x,next.y-multiTap.y)>=8||Math.abs(next.gap-multiTap.gap)>=8)){multiTap.moved=true;lastMultiTap=null}
    if(gestureMode==='view'&&points.size===2&&previous)navigate(previous,next);
    else if(gestureMode==='width'&&points.size>=3&&previous?.gap>0&&next.gap>0){bandWidth=Math.max(.25,Math.min(3,bandWidth*next.gap/previous.gap));gestureChanged=true;schedule()}
    else if(gestureMode==='compare'&&points.size===1)adjust(event);
    else if(gestureMode==='tone'&&points.size===1&&previous){const bounds=host.getBoundingClientRect();position=Math.max(-1,Math.min(1,position+(next.x-previous.x)/Math.max(1,bounds.width)));gestureChanged=true;schedule()}
    previous=next;event.preventDefault();onGesture();
  };
  const end=event=>{
    if(!points.has(event.pointerId))return;
    const tap=gesture,wasPeeking=peeking;if(gestureMode==='compare'&&points.size===1&&tap&&!tap.moved&&event.type==='pointerup')adjust({clientX:tap.x});cancelHold();peek(false);points.delete(event.pointerId);previous=points.size?measure():null;gesture=null;
    if(!points.size&&(art.width!==sourceWidth||art.height!==sourceHeight))schedule();
    if(event.type==='pointercancel'||event.type==='lostpointercapture'){lastTap=multiTap=lastMultiTap=null;if(!points.size)gestureMode=null;navigationStart=null;if(gestureChanged){gestureChanged=false;onChange();schedule()}return}
    if(!points.size){
      const now=Number.isFinite(event.timeStamp)?event.timeStamp:Date.now();
      if(multiTap){if(!multiTap.moved&&now-multiTap.time<300){if(lastMultiTap&&now-lastMultiTap.time<360&&Math.hypot(multiTap.x-lastMultiTap.x,multiTap.y-lastMultiTap.y)<30){resetNavigation();lastMultiTap=null;onGesture()}else lastMultiTap={x:multiTap.x,y:multiTap.y,time:now}}else lastMultiTap=null;multiTap=null}
      else{lastMultiTap=null;if(!wasPeeking&&!comparing&&tap&&!tap.moved&&now-tap.time<300){if(lastTap&&now-lastTap.time<320&&Math.hypot(tap.x-lastTap.x,tap.y-lastTap.y)<24){lastTap=null;position=0;bandWidth=1;gestureChanged=true;onGesture()}else lastTap={x:tap.x,y:tap.y,time:now}}else lastTap=null}
      gestureMode=null;navigationStart=null;if(gestureChanged){gestureChanged=false;onChange();schedule()}
    }
  };
  for(const [name,handler]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end]])listen(host,name,handler,{passive:false});
  if(motion?.addEventListener)listen(motion,'change',()=>{if(motion.matches)stopPulse()});
  if(globalThis.addEventListener){listen(globalThis,'blur',cancelGesture);listen(globalThis,'resize',()=>{if(current){setNavigation(viewPose);editor.resize()}})}
  if(document.addEventListener)listen(document,'visibilitychange',()=>{if(document.hidden)cancelGesture()});
  listen(host,'contextmenu',event=>{if(!event.target.closest('button'))event.preventDefault()});
  listen(compare,'click',()=>{stopPulse();if(!current)return;editor.commit();comparing=!comparing;host.classList.toggle('comparing',comparing);compare.setAttribute('aria-pressed',String(comparing));updateSplit()});
  variants.forEach((button,index)=>listen(button,'click',()=>select(index)));
  listen(seam,'keydown',event=>{if(!comparing||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();split=Math.max(.02,Math.min(.98,split+(event.key==='ArrowRight'?.05:-.05)));updateSplit()});
  listen(host,'keydown',event=>{stopPulse();if(comparing||editor.active||!current||event.target.closest('button,input,.mg-editor')||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft'||event.key==='ArrowRight')position=Math.max(-1,Math.min(1,position+(event.key==='ArrowRight'?.02:-.02)));else bandWidth=Math.max(.25,Math.min(3,bandWidth*(event.key==='ArrowUp'?1.05:1/1.05)));schedule();onChange()});
  host.tabIndex=0;
  async function process(blob,signal,stored=null){
    const right=stored?.right instanceof Blob?stored.right:null;
    const panorama=stored?.panorama??null;
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
      if(panorama){
        const mask=document.createElement('canvas');mask.width=result.width;mask.height=result.height;
        try{const context=mask.getContext('2d',{willReadFrequently:true});context.drawImage(original,0,0,mask.width,mask.height);result=applyPanoramaMask(result,panorama,{alpha:context.getImageData(0,0,mask.width,mask.height).data})}finally{mask.width=mask.height=1}
      }
      depth=result.normalized?result.depth:normalizeDepth(result.depth,{polarity:result.polarity,validity:result.validity});current=result;host.dataset.model=result.model;host.dataset.source=result.source;
      if(stored){selection=stored.recipe.preset;position=stored.recipe.position;bandWidth=stored.recipe.width}
      editor.set(stored?.recipe.edits,sourceWidth,sourceHeight);
      split=.5;compare.setAttribute('aria-pressed','false');select(selection);host.hidden=false;updateSplit();startPulse();
      onStatus({phase:'ready',model:result.model,source:result.source,width:result.width,height:result.height});return result;
    }finally{signal?.removeEventListener('abort',stop);if(controller===task)controller=null}
  }
  function snapshot(native=true){
    if(!current)throw new Error('Djupnebiletet er ikkje klart.');render(true,true);
    const source=art;
    const canvas=document.createElement('canvas');canvas.width=native?source.width:384;canvas.height=native?source.height:Math.max(1,Math.round(384*source.height/source.width));const context=canvas.getContext('2d');context.drawImage(source,0,0,canvas.width,canvas.height);if(editor.active||depthRail.active)schedule();return context.getImageData(0,0,canvas.width,canvas.height);
  }
  async function restore(blob,result,recipe,signal){
    if(!recipe||!Number.isInteger(recipe.preset)||recipe.preset<0||recipe.preset>=options.length||!Number.isFinite(recipe.position)||Math.abs(recipe.position)>1||!Number.isFinite(recipe.width)||recipe.width<.25||recipe.width>3)throw new Error('Ugyldig uttrykk i Entropi-fila.');
    normalizePhotoEdits(recipe.edits);
    return process(blob,signal,{result,recipe});
  }
  return {process,restore,reset,select,snapshot,resetView:resetNavigation,resetTone(){stopPulse();editor.commit();resetNavigation();position=0;bandWidth=1;render();onChange()},get recipe(){const recipe={preset:depthRail.active?railStartSelection:selection,position,width:bandWidth},edits=editor.committed;if(!photoEditsNeutral(edits))recipe.edits=edits;return recipe},get ready(){return !!current},get result(){return current},get selectedName(){return options[selection].label},dispose(){reset();disposed=true;depthRail.dispose();editor.dispose();for(const remove of listeners)remove();art.remove();pulse.remove();croppedOriginal.remove()}};
}
