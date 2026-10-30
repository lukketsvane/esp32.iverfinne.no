export function attachGalleryNavigation(image,{enabled,onStep,onDismiss}){
  let start=null,blocked=false;
  const pointers=new Set();
  function down(event){
    if(!enabled()||event.button>0)return;
    pointers.add(event.pointerId);
    if(pointers.size!==1){blocked=true;start=null;return}
    blocked=false;start={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp};
    image.setPointerCapture?.(event.pointerId);
  }
  function finish(event){
    pointers.delete(event.pointerId);
    const origin=start;
    if(origin?.id===event.pointerId)start=null;
    if(!origin||origin.id!==event.pointerId||blocked||!enabled()||event.type!=='pointerup')return;
    const x=event.clientX-origin.x,y=event.clientY-origin.y;
    if(event.timeStamp-origin.time>1000)return;
    if(Math.abs(x)>=56&&Math.abs(x)>Math.abs(y)*1.35){event.preventDefault();onStep(x<0?1:-1)}
    else if(y>=80&&y>Math.abs(x)*1.35){event.preventDefault();onDismiss()}
  }
  function cancel(){start=null;blocked=true;pointers.clear()}
  const listeners=[['pointerdown',down],['pointerup',finish],['pointercancel',finish],['lostpointercapture',finish],['dragstart',event=>event.preventDefault()]];
  for(const [name,handler]of listeners)image.addEventListener(name,handler);
  return {cancel,dispose(){cancel();for(const [name,handler]of listeners)image.removeEventListener(name,handler)}};
}
