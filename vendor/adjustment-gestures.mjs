// Direct image controls: this controller never creates an element or opens a surface.
export function attachAdjustmentGestures(root,{enabled=()=>true,read=()=>({}),onChange=()=>{},onDither=()=>{},onReset=()=>{},onGesture=()=>{},onClaim=()=>{}}={}){
  const points=new Map();let owned=false,disposed=false,tap=null,start=null,axis=null;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation()};
  function measure(){
    const values=[...points.values()],x=values.reduce((sum,p)=>sum+p.x,0)/values.length,y=values.reduce((sum,p)=>sum+p.y,0)/values.length;
    return {x,y,gap:Math.sqrt(values.reduce((sum,p)=>sum+(p.x-x)**2+(p.y-y)**2,0)/values.length)};
  }
  function rebase(){
    if(points.size!==4){start=null;return}
    const rect=root.getBoundingClientRect(),position=measure(),zone=(position.x-rect.left)/Math.max(1,rect.width);
    start={...position,width:Math.max(1,rect.width),height:Math.max(1,rect.height),levels:{...read()},tone:zone<1/3?'black':zone>2/3?'white':'gamma'};axis=null;
  }
  function down(event){
    if(disposed||event.pointerType!=='touch'||!enabled()||event.target.closest('a,input,select,[data-photo-save],.access-control,.studio-option'))return;
    if(!points.size)tap={time:performance.now(),count:0,moved:false};
    points.set(event.pointerId,{x:event.clientX,y:event.clientY,originX:event.clientX,originY:event.clientY});tap.count=Math.max(tap.count,points.size);
    if(points.size>=3)onGesture();
    if(points.size===4&&!owned){owned=true;onClaim();for(const id of points.keys())root.setPointerCapture(id)}
    if(owned){consume(event);root.setPointerCapture(event.pointerId);rebase()}
  }
  function move(event){
    const point=points.get(event.pointerId);if(!point)return;
    if(!enabled()){cancel();return}
    point.x=event.clientX;point.y=event.clientY;
    if(Math.hypot(point.x-point.originX,point.y-point.originY)>10)tap.moved=true;
    if(!owned)return;
    consume(event);onGesture();if(points.size!==4||!start)return;
    const current=measure(),dx=current.x-start.x,dy=current.y-start.y,spread=current.gap-start.gap;
    if(!axis){
      if(Math.max(Math.hypot(dx,dy),Math.abs(spread))<10)return;
      axis=Math.abs(spread)>Math.hypot(dx,dy)?'strength':Math.abs(dx)>Math.abs(dy)?'contrast':start.tone;
    }
    tap.moved=true;
    const initial=start.levels;
    if(axis==='contrast')onChange({contrast:clamp(initial.contrast+dx*3.5/start.width,.5,3)});
    else if(axis==='black')onChange({black:Math.round(clamp(initial.black-dy*255/start.height,0,initial.white-1))});
    else if(axis==='white')onChange({white:Math.round(clamp(initial.white-dy*255/start.height,initial.black+1,255))});
    else if(axis==='gamma')onChange({gamma:clamp(initial.gamma*2**(-dy*3/start.height),.2,3)});
    else onChange({strength:clamp(initial.strength+spread*4/start.width,0,1)});
  }
  function up(event){
    const point=points.get(event.pointerId);if(!point)return;
    if(Math.hypot(event.clientX-point.originX,event.clientY-point.originY)>10)tap.moved=true;
    const captured=owned;points.delete(event.pointerId);
    if(captured){consume(event);onGesture();if(root.hasPointerCapture?.(event.pointerId))root.releasePointerCapture(event.pointerId)}
    if(points.size){if(captured)rebase();return}
    const completed=tap;owned=false;tap=start=null;axis=null;
    if(!enabled()||completed.moved||performance.now()-completed.time>350)return;
    if(completed.count===3){onGesture();onDither()}
    else if(completed.count===4){onGesture();onReset()}
  }
  function cancel(){
    if(owned||tap?.count>=3)onGesture();
    const captured=owned?[...points.keys()]:[];points.clear();owned=false;tap=start=null;axis=null;
    for(const id of captured)if(root.hasPointerCapture?.(id))root.releasePointerCapture(id);
  }
  function interrupted(event){if(points.has(event.pointerId)&&(event.type==='pointercancel'||event.target===root)){if(owned)onGesture();cancel()}}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',interrupted],['lostpointercapture',interrupted]];
  for(const [name,listener]of listeners)root.addEventListener(name,listener,{capture:true,passive:false});
  return {cancel,dispose(){if(disposed)return;disposed=true;cancel();for(const [name,listener]of listeners)root.removeEventListener(name,listener,true)}};
}
