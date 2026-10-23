export function attachPhotoGestures(image,{enabled=()=>true,onChange=()=>{}}={}){
  const points=new Map(),state={scale:1,x:0,y:0,width:0,height:0,grain:1,contrast:1};let previous=null,start=null,axis=null;
  const measure=()=>{const values=[...points.values()];return {x:values.reduce((n,p)=>n+p.x,0)/values.length,y:values.reduce((n,p)=>n+p.y,0)/values.length}};
  function draw(){
    const rect=image.parentElement.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return;
    state.width=rect.width;state.height=rect.height;
    state.scale=1;state.x=state.y=0;image.style.transform='';onChange(state);
  }
  function down(event){if(event.pointerType!=='touch'||!enabled())return;points.set(event.pointerId,{x:event.clientX,y:event.clientY});image.setPointerCapture(event.pointerId);start=previous=measure();axis=null;if(points.size>1)event.preventDefault();if(points.size===3)draw()}
  function move(event){
    const point=points.get(event.pointerId);if(!point)return;if(!enabled()){points.clear();previous=null;return}
    point.x=event.clientX;point.y=event.clientY;const current=measure();
    if(previous&&start&&points.size===3){
      if(!axis&&Math.hypot(current.x-start.x,current.y-start.y)>=10)axis=Math.abs(current.x-start.x)>Math.abs(current.y-start.y)?'contrast':'grain';
      if(axis==='contrast')state.contrast=Math.max(.5,Math.min(3,state.contrast+(current.x-previous.x)*3.5/Math.max(1,state.width)));
      else if(axis==='grain')state.grain=Math.max(1,Math.min(8,state.grain+(current.y-previous.y)*10/Math.max(1,state.height)));
    }
    previous=current;if(points.size<2||points.size>3)return;event.preventDefault();event.stopImmediatePropagation();if(points.size===3)draw();
  }
  function up(event){if(points.delete(event.pointerId)){start=previous=points.size?measure():null;axis=null}}
  function reset(){for(const id of points.keys())if(image.hasPointerCapture?.(id))image.releasePointerCapture(id);points.clear();start=previous=null;axis=null;state.scale=1;state.x=state.y=0;draw()}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up]];
  for(const [name,listener] of listeners)image.addEventListener(name,listener,{passive:false});
  globalThis.addEventListener?.('resize',draw);
  return {state,reset,refresh:draw,dispose(){for(const [name,listener] of listeners)image.removeEventListener(name,listener);globalThis.removeEventListener?.('resize',draw);for(const id of points.keys())if(image.hasPointerCapture?.(id))image.releasePointerCapture(id);points.clear();image.style.transform=''}};
}
