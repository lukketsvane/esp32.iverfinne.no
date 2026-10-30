export function attachNotchRail(rail,buttons,{enabled=()=>true,onStart=()=>{},onSelect=()=>{},onTap=()=>{},onEnd=()=>{}}={}){
  const listeners=[];let gesture=null,suppressClick=false,disposed=false;
  const listen=(node,name,handler,options)=>{node.addEventListener(name,handler,options);listeners.push(()=>node.removeEventListener(name,handler,options))};
  const nearest=y=>gesture.centres.reduce((best,centre,index)=>Math.abs(centre-y)<Math.abs(gesture.centres[best]-y)?index:best,0);
  const choose=y=>{const index=nearest(y);if(index!==gesture.selected){gesture.selected=index;onSelect(index)}};
  function finish(event,cancelled=false){
    if(!gesture||event&&event.pointerId!==gesture.id)return;
    event?.stopPropagation();event?.preventDefault();const completed=gesture;
    if(!cancelled&&!completed.moved)onTap(nearest(event.clientY));
    gesture=null;suppressClick=true;if(rail.hasPointerCapture?.(completed.id))rail.releasePointerCapture(completed.id);
    onEnd({cancelled,moved:completed.moved});
  }
  listen(rail,'pointerdown',event=>{
    if(disposed||!enabled()||event.button>0)return;event.stopPropagation();event.preventDefault();if(gesture)return;
    const centres=buttons.map(button=>{const bounds=button.getBoundingClientRect();return bounds.top+bounds.height/2});
    gesture={id:event.pointerId,y:event.clientY,centres,selected:-1,moved:false};suppressClick=false;rail.setPointerCapture?.(event.pointerId);onStart();
  },{passive:false});
  listen(rail,'pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;event.stopPropagation();event.preventDefault();
    if(!gesture.moved&&Math.abs(event.clientY-gesture.y)<4)return;gesture.moved=true;choose(event.clientY);
  },{passive:false});
  listen(rail,'pointerup',event=>finish(event),{passive:false});
  for(const name of ['pointercancel','lostpointercapture'])listen(rail,name,event=>finish(event,true),{passive:false});
  listen(rail,'click',event=>{if(suppressClick&&event.detail!==0){suppressClick=false;event.preventDefault();event.stopImmediatePropagation()}},true);
  if(globalThis.addEventListener)listen(globalThis,'blur',()=>finish(null,true));
  if(globalThis.document?.addEventListener)listen(document,'visibilitychange',()=>{if(document.hidden)finish(null,true)});
  return {get active(){return !!gesture},cancel(){finish(null,true)},dispose(){if(disposed)return;finish(null,true);disposed=true;for(const remove of listeners)remove()}};
}
