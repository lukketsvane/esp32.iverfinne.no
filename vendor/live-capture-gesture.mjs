export function bindLiveCaptureGesture(surface,{enabled=()=>true,hitTest=()=>true,onStart=()=>{},onFinish=()=>{},onCancel=()=>{},onProgress=()=>{},holdMs=350,maxMs=15000}={}){
  if(!Number.isFinite(holdMs)||holdMs<0||!Number.isFinite(maxMs)||maxMs<=0||maxMs>15000)throw new RangeError('Ugyldig opptakstid.');
  const doc=surface.ownerDocument??globalThis.document,win=doc?.defaultView??globalThis.window??globalThis,listeners=[];
  let pending=null,recording=null,latest=null,consumedPointer=null,holdTimer=0,limitTimer=0,progressTimer=0,suppressClick=false,disposed=false;
  const now=()=>globalThis.performance?.now?.()??Date.now();
  const elapsed=run=>Math.max(0,Math.min(maxMs,now()-run.startedAt));
  const listen=(node,name,handler,options)=>{if(!node?.addEventListener)return;node.addEventListener(name,handler,options);listeners.push(()=>node.removeEventListener(name,handler,options))};
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation()};
  const release=id=>{if(id!==null&&surface.hasPointerCapture?.(id))surface.releasePointerCapture(id)};
  const clearPending=()=>{clearTimeout(holdTimer);holdTimer=0;const pointer=pending;pending=null;return pointer};
  const clearTimers=()=>{clearTimeout(limitTimer);clearTimeout(progressTimer);limitTimer=progressTimer=0};
  function notifyCancel(run,reason,error){
    if(run.cancelled)return;run.cancelled=true;run.controller.abort(error);
    try{const result=onCancel({elapsedMs:elapsed(run),reason,...(error?{error}:{})});if(result?.then)Promise.resolve(result).catch(failure=>globalThis.console?.error?.(failure))}catch(failure){globalThis.console?.error?.(failure)}
  }
  function cancel(reason='cancelled',error,block=true){
    const pointer=clearPending(),run=recording;if(pointer)suppressClick=true;
    if(run){recording=null;clearTimers();suppressClick=true;consumedPointer=block?run.pointerId:null;release(run.pointerId);notifyCancel(run,reason,error)}
    else if(!block){consumedPointer=null;if(pointer)release(pointer.id)}
  }
  function fail(run,error){
    if(recording===run)cancel('error',error);
    else if(latest===run&&run.finished)notifyCancel(run,'error',error);
  }
  function progress(run){
    if(recording!==run)return;
    try{const elapsedMs=elapsed(run),result=onProgress({elapsedMs,maxMs,progress:elapsedMs/maxMs});if(result?.then)Promise.resolve(result).catch(error=>fail(run,error))}catch(error){fail(run,error);return}
    if(recording===run)progressTimer=setTimeout(()=>progress(run),50);
  }
  function finish(reason='release'){
    const run=recording;if(!run)return;
    recording=null;run.finished=true;clearTimers();suppressClick=true;consumedPointer=reason==='release'?null:run.pointerId;release(run.pointerId);
    try{const result=onFinish({elapsedMs:elapsed(run),reason});if(result?.then)Promise.resolve(result).catch(error=>fail(run,error))}catch(error){fail(run,error)}
  }
  function begin(pointerId=null){
    if(disposed||recording||surface.disabled||doc?.hidden||!enabled())return false;
    const run={pointerId,startedAt:now(),controller:new AbortController(),finished:false,cancelled:false};recording=latest=run;suppressClick=true;
    try{
      if(pointerId!==null)surface.setPointerCapture?.(pointerId);
      const result=onStart({signal:run.controller.signal,startedAt:run.startedAt,maxMs});
      if(result===false){cancel('rejected');return false}
      if(result?.then)Promise.resolve(result).then(accepted=>{if(recording===run&&accepted===false)cancel('rejected')},error=>fail(run,error));
    }catch(error){fail(run,error);return false}
    if(recording!==run)return false;
    limitTimer=setTimeout(()=>{if(recording===run)finish('limit')},maxMs);progress(run);return recording===run;
  }
  function down(event){
    if(event.button>0||event.isPrimary===false)return;
    if(recording||consumedPointer!==null){consume(event);return}
    suppressClick=false;
    if(disposed||surface.disabled||doc?.hidden||!enabled()||!hitTest(event))return;
    clearPending();pending={id:event.pointerId,x:event.clientX,y:event.clientY};
    holdTimer=setTimeout(()=>{const pointer=clearPending();if(pointer){suppressClick=true;begin(pointer.id)}},holdMs);
  }
  function move(event){
    if(recording?.pointerId===event.pointerId||consumedPointer===event.pointerId){consume(event);return}
    if(pending?.id===event.pointerId&&Math.hypot(event.clientX-pending.x,event.clientY-pending.y)>12){suppressClick=true;clearPending()}
  }
  function up(event){
    if(recording?.pointerId===event.pointerId){consume(event);finish('release');return}
    if(consumedPointer===event.pointerId){consume(event);consumedPointer=null;return}
    if(pending?.id===event.pointerId)clearPending();
  }
  function interrupted(event){
    if(recording?.pointerId===event.pointerId||pending?.id===event.pointerId)cancel(event.type==='lostpointercapture'?'lostcapture':'pointercancel',undefined,false);
    if(consumedPointer===event.pointerId)consumedPointer=null;
  }
  for(const [name,handler]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',interrupted],['lostpointercapture',interrupted]])listen(surface,name,handler,{capture:true,passive:false});
  listen(surface,'click',event=>{if(suppressClick&&(event.detail!==0||event.pointerType)){suppressClick=false;consume(event)}},true);
  listen(surface,'contextmenu',event=>{if(pending||recording||consumedPointer!==null)event.preventDefault()},true);
  listen(doc,'pointerdown',event=>{if(pending&&pending.id!==event.pointerId||recording&&recording.pointerId!==null&&recording.pointerId!==event.pointerId)cancel('secondtouch')},true);
  listen(doc,'pointerup',event=>{if(consumedPointer===event.pointerId)consumedPointer=null},true);
  listen(doc,'visibilitychange',()=>{if(doc.hidden)cancel('hidden',undefined,false)});
  for(const name of ['pagehide','blur'])listen(win,name,()=>cancel(name,undefined,false));
  listen(win,'keydown',event=>{
    if(event.key==='Escape'&&(pending||recording)){consume(event);cancel('escape');return}
    if(!event.shiftKey||(event.code!=='Space'&&event.key!==' ')||event.repeat||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if(recording){consume(event);finish('keyboard')}
    else if(!disposed&&!surface.disabled&&!doc?.hidden&&enabled()){consume(event);const pointer=clearPending();if(pointer)release(pointer.id);begin()}
  },true);
  return {get active(){return !!recording},finish(){finish('limit')},cancel(reason='cancelled'){cancel(reason)},dispose(){if(disposed)return;disposed=true;cancel('disposed',undefined,false);for(const remove of listeners)remove()}};
}
