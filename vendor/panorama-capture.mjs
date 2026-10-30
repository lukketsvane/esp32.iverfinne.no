import {bindLiveCaptureGesture} from './live-capture-gesture.mjs';
import {createSweepCapture} from './sweep-capture.mjs';
import {buildPanorama} from './panorama.mjs';

export function createPanoramaCapture({surface,viewport,enabled,capture,onResult,onState=()=>{},onError=()=>{}}){
  const indicator=document.createElement('div'),bar=document.createElement('i'),label=document.createElement('span');
  indicator.id='scan-progress';indicator.className='scan-progress';indicator.hidden=true;indicator.append(bar,label);viewport.parentElement.append(indicator);
  surface.setAttribute('aria-description','Trykk for foto. Hald inne for panorama, opptil 15 sekund. Slepp for å fullføre. Skift+mellomrom startar og stoppar. Escape avbryt.');
  let run=null,phase='',elapsed=0,count=0,errorTimer=0;
  function update(next=phase){
    const changed=next!==phase;
    phase=next;indicator.hidden=!phase;surface.dataset.panorama=phase;
    bar.style.transform='scaleX('+Math.min(1,elapsed/15000)+')';
    label.textContent=phase==='recording'?(elapsed/1000).toFixed(1)+' s · '+count:'Set saman …';
    surface.setAttribute('aria-busy',String(phase==='processing'));if(changed)onState(phase);
  }
  function cancel(){gesture.cancel();if(run){run.controller.abort();run.capture?.cancel()}}
  function start(){
    if(run||!enabled())return false;
    const current={controller:new AbortController()};run=current;elapsed=count=0;clearTimeout(errorTimer);
    void (async()=>{
      let failure=null;
      try{
        update('recording');current.capture=createSweepCapture({capture,onFrame:n=>{count=n;update()}});
        const frames=await current.capture.done;current.controller.signal.throwIfAborted();gesture.finish();update('processing');
        const panorama=await buildPanorama(frames,{signal:current.controller.signal});current.controller.signal.throwIfAborted();
        await onResult(panorama,current.controller.signal);
      }catch(error){if(error.name!=='AbortError'&&!current.controller.signal.aborted)failure=error}
      finally{if(run===current){run=null;update('');if(failure){indicator.hidden=false;label.textContent=failure.message;bar.style.transform='scaleX(0)';errorTimer=setTimeout(()=>{if(!run)indicator.hidden=true},6500);onError(failure)}}}
    })();
    return true;
  }
  const gesture=bindLiveCaptureGesture(surface,{enabled:()=>!run&&enabled(),hitTest:event=>{const r=viewport.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom},onStart:start,onFinish:()=>{run?.capture?.finish();if(run)update('processing')},onCancel:()=>{if(run){run.controller.abort();run.capture?.cancel()}},onProgress:progress=>{elapsed=progress.elapsedMs;if(run&&phase==='recording')update()}});
  const hidden=()=>{if(document.hidden)cancel()},escape=event=>{if(event.key==='Escape'&&run){event.preventDefault();event.stopImmediatePropagation();cancel()}};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',cancel);window.addEventListener('keydown',escape,true);
  return {get active(){return !!run},get recording(){return phase==='recording'},cancel,dispose(){cancel();clearTimeout(errorTimer);gesture.dispose();indicator.remove();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',cancel);window.removeEventListener('keydown',escape,true)}};
}
