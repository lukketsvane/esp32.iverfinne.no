const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function progressiveIndices(count){
  const indices=Array.from({length:count},(_,index)=>index);let seed=0x9e3779b9;
  for(let index=count-1;index>0;index--){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const other=(seed>>>0)%(index+1);[indices[index],indices[other]]=[indices[other],indices[index]]}
  return indices;
}

export function attachViewerGestures(canvas,{onRotate,onTransform,onDensity,onDefinition,initialDensity=1,onTouch=()=>{},onPinchStart=()=>{},onPinchScale=()=>{},onTwist=()=>{}}){
  const pointers=new Map(),state={density:clamp(1+Math.log10(clamp(initialDensity,1e-6,1))/6,0,1),definition:.5};
  let start=null,previous=null,axis=null,disposed=false;
  const measure=()=>{const points=[...pointers.values()];return {x:points.reduce((sum,point)=>sum+point.x,0)/points.length,y:points.reduce((sum,point)=>sum+point.y,0)/points.length,gap:points.length===2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0,angle:points.length===2?Math.atan2(points[1].y-points[0].y,points[1].x-points[0].x):0}};
  const reset=()=>{start=previous=pointers.size>0&&pointers.size<=3?measure():null;axis=null;if(pointers.size===2)onPinchStart()};
  const down=event=>{
    if(disposed||event.pointerType!=='touch')return;
    if(pointers.size===0)onTouch(true);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);reset();if(pointers.size>1)event.preventDefault();
  };
  const move=event=>{
    const point=pointers.get(event.pointerId);if(!point)return;point.x=event.clientX;point.y=event.clientY;event.stopImmediatePropagation();event.preventDefault();
    if(pointers.size>3||!previous||!start)return;
    const current=measure(),dx=current.x-previous.x,dy=current.y-previous.y;
    if(pointers.size===1){if(dx||dy)onRotate(dx,dy)}
    else if(pointers.size===2){
      const rect=canvas.getBoundingClientRect(),scale=previous.gap>0&&current.gap>0?current.gap/previous.gap:1;
      if(!start.gap&&current.gap>0){start={...start,gap:current.gap};onPinchStart()}
      if(previous.gap>0&&current.gap>0){const angle=current.angle-previous.angle,twist=Math.atan2(Math.sin(angle),Math.cos(angle))*180/Math.PI;if(twist)onTwist(twist)}
      if(dx||dy||scale!==1){onPinchScale(start.gap>0?current.gap/start.gap:1);onTransform(dx,dy,scale,current.x-rect.left,current.y-rect.top)}
    }
    else{
      if(!axis&&Math.hypot(current.x-start.x,current.y-start.y)>=10)axis=Math.abs(current.x-start.x)>Math.abs(current.y-start.y)?'definition':'density';
      if(axis==='density'){
        const next=clamp(state.density-dy*1.4/Math.max(1,canvas.clientHeight),0,1);
        if(next!==state.density){state.density=next;onDensity(10**(-6*(1-next)))}
      }else if(axis==='definition'){
        const next=clamp(state.definition+dx*1.4/Math.max(1,canvas.clientWidth),0,1);
        if(next!==state.definition){state.definition=next;onDefinition(next)}
      }
    }
    previous=current;
  };
  const up=event=>{
    if(event.pointerType!=='touch'||!pointers.delete(event.pointerId))return;
    if(pointers.size===0)onTouch(false);reset();
  };
  function cancel(){
    const captured=[...pointers.keys()];if(pointers.size)onTouch(false);pointers.clear();reset();
    for(const id of captured)if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
  }
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up]];
  for(const [name,listener] of listeners)canvas.addEventListener(name,listener,true);
  return {state,cancel,dispose(){if(disposed)return;disposed=true;for(const [name,listener] of listeners)canvas.removeEventListener(name,listener,true);cancel()}};
}
