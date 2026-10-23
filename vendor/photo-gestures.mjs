export function attachPhotoGestures(image,{enabled=()=>true,onChange=()=>{},toneOnly=false}={}){
  const points=new Map(),state={scale:1,x:0,y:0,width:0,height:0,grain:1,contrast:1};let previous=null,start=null,axis=null;
  const clamp=(value,bound)=>Math.max(-bound,Math.min(bound,value));
  const measure=()=>{const values=[...points.values()];return {x:values.reduce((n,p)=>n+p.x,0)/values.length,y:values.reduce((n,p)=>n+p.y,0)/values.length,gap:values.length===2?Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y):0}};
  function draw(){
    const rect=image.parentElement.getBoundingClientRect(),width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    if(rect.width<=0||rect.height<=0)return;
    state.width=rect.width;state.height=rect.height;
    if(!toneOnly){if(width&&height){const fit=Math.min(rect.width/width,rect.height/height);state.x=clamp(state.x,Math.max(0,(width*fit*state.scale-rect.width)/2));state.y=clamp(state.y,Math.max(0,(height*fit*state.scale-rect.height)/2))}image.style.transform=state.scale===1?'':`translate(${state.x}px,${state.y}px) scale(${state.scale})`}onChange(state);
  }
  function down(event){if(event.pointerType!=='touch'||!enabled())return;points.set(event.pointerId,{x:event.clientX,y:event.clientY});image.setPointerCapture(event.pointerId);start=previous=measure();axis=null;if(points.size>1)event.preventDefault();if(toneOnly&&points.size===3)draw()}
  function move(event){
    const point=points.get(event.pointerId);if(!point)return;if(!enabled()){points.clear();previous=null;return}
    point.x=event.clientX;point.y=event.clientY;const current=measure();
    if(!toneOnly&&previous&&points.size===2&&previous.gap&&current.gap){
      const rect=image.parentElement.getBoundingClientRect(),next=Math.max(1,Math.min(8,state.scale*current.gap/previous.gap)),ratio=next/state.scale;
      state.x=current.x-rect.left-rect.width/2-(previous.x-rect.left-rect.width/2-state.x)*ratio;state.y=current.y-rect.top-rect.height/2-(previous.y-rect.top-rect.height/2-state.y)*ratio;state.scale=next;
    }else if(!toneOnly&&previous&&points.size===1&&state.scale>1){state.x+=current.x-previous.x;state.y+=current.y-previous.y}
    else if(previous&&start&&points.size===3){
      if(!axis&&Math.hypot(current.x-start.x,current.y-start.y)>=10)axis=Math.abs(current.x-start.x)>Math.abs(current.y-start.y)?'contrast':'grain';
      if(axis==='contrast')state.contrast=Math.max(.5,Math.min(3,state.contrast+(current.x-previous.x)*3.5/Math.max(1,state.width)));
      else if(axis==='grain')state.grain=Math.max(1,Math.min(8,state.grain+(current.y-previous.y)*10/Math.max(1,state.height)));
    }
    previous=current;if(toneOnly&&points.size!==3||points.size>3||points.size===1&&state.scale===1)return;event.preventDefault();event.stopImmediatePropagation();draw();
  }
  function up(event){if(points.delete(event.pointerId)){start=previous=points.size?measure():null;axis=null}}
  function reset(){for(const id of points.keys())if(image.hasPointerCapture?.(id))image.releasePointerCapture(id);points.clear();start=previous=null;axis=null;state.scale=1;state.x=state.y=0;draw()}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up]];
  for(const [name,listener] of listeners)image.addEventListener(name,listener,{passive:false});
  globalThis.addEventListener?.('resize',draw);
  return {state,reset,refresh:draw,dispose(){for(const [name,listener] of listeners)image.removeEventListener(name,listener);globalThis.removeEventListener?.('resize',draw);for(const id of points.keys())if(image.hasPointerCapture?.(id))image.releasePointerCapture(id);points.clear();if(!toneOnly)image.style.transform=''}};
}
