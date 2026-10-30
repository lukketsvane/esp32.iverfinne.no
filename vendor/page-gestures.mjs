export function lockPageZoom(target=document){
  const prevent=event=>{if(event.cancelable)event.preventDefault()};
  const multitouch=event=>{if(event.touches?.length>1)prevent(event)};
  const gestures=['gesturestart','gesturechange','gestureend'];
  for(const name of gestures)target.addEventListener(name,prevent,{passive:false});
  target.addEventListener('touchmove',multitouch,{passive:false});
  target.addEventListener('dblclick',prevent,{passive:false});
  return ()=>{for(const name of gestures)target.removeEventListener(name,prevent);target.removeEventListener('touchmove',multitouch);target.removeEventListener('dblclick',prevent)};
}
