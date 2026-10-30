export function bindCaptureGesture(button,{onCapture,enabled}){
  let pointer=null,timer=0,armed=false,suppressClick=false;
  function cancel(){clearTimeout(timer);timer=0;pointer=null;armed=false;button.removeAttribute('data-capture-ready')}
  function down(event){
    if(event.button>0||event.isPrimary===false||button.disabled||!enabled())return;
    suppressClick=false;cancel();pointer={id:event.pointerId,x:event.clientX,y:event.clientY};
    button.setPointerCapture?.(event.pointerId);
    timer=setTimeout(()=>{timer=0;if(pointer&&enabled()){armed=true;button.setAttribute('data-capture-ready','true')}},400);
  }
  function move(event){
    if(pointer&&event.pointerId===pointer.id&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){suppressClick=true;cancel()}
  }
  function up(event){
    if(!pointer||event.pointerId!==pointer.id)return;
    const capture=armed&&enabled()&&!button.disabled;
    if(armed)suppressClick=true;
    cancel();
    if(capture){event.preventDefault();return onCapture()}
  }
  function interrupt(){if(pointer)suppressClick=true;cancel()}
  button.setAttribute('aria-description','Trykk for søkjar. Hald inne og slepp for neste foto.');
  button.setAttribute('aria-keyshortcuts','Shift+Enter');
  button.addEventListener('pointerdown',down);
  button.addEventListener('pointermove',move);
  button.addEventListener('pointerup',up);
  button.addEventListener('pointercancel',interrupt);
  button.addEventListener('lostpointercapture',interrupt);
  button.addEventListener('click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation()}},true);
  button.addEventListener('keydown',event=>{if(event.key==='Enter')suppressClick=false;if(event.key==='Enter'&&event.shiftKey&&!event.repeat&&enabled()&&!button.disabled){event.preventDefault();cancel();return onCapture()}});
  button.addEventListener('contextmenu',event=>{if(pointer)event.preventDefault()});
  document.addEventListener('pointerdown',event=>{if(pointer&&event.pointerId!==pointer.id)interrupt()},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt()});
  window.addEventListener('pagehide',interrupt);
  window.addEventListener('blur',interrupt);
}
