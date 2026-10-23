export function attachStudioControls(roots,onChange,enabled=()=>true,onGesture=()=>{},initial={}){
  const style=document.createElement('style');
  style.textContent='.studio-rail{position:absolute;inset:0 calc(2px + env(safe-area-inset-right)) 0 auto;width:44px;z-index:6;pointer-events:none;opacity:.5;transition:opacity .15s}.studio-rail[hidden]{display:none}.studio-rail.active{opacity:1}.studio-option{position:absolute;right:0;top:12.5%;width:44px;height:44px;transform:translateY(-50%);padding:0;border:0;background:transparent;color:#fff;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent}.studio-option:nth-child(2){top:37.5%}.studio-option:nth-child(3){top:62.5%}.studio-option:nth-child(4){top:87.5%}.primitive-rail .studio-option:nth-child(1){top:10%}.primitive-rail .studio-option:nth-child(2){top:30%}.primitive-rail .studio-option:nth-child(3){top:50%}.primitive-rail .studio-option:nth-child(4){top:70%}.primitive-rail .studio-option:nth-child(5){top:90%}.studio-option i{position:absolute;right:0;top:21px;width:8px;height:2px;background:currentColor;opacity:.7;box-shadow:0 0 3px #000}.studio-option i.chosen{width:16px;opacity:1}.studio-option:focus-visible{outline:0}.studio-option:focus-visible i{width:20px;opacity:1}.image-rail .studio-option{top:25%}.image-rail .studio-option:nth-child(2){top:75%}.primitive-rail{inset:0 auto 0 calc(2px + env(safe-area-inset-left))}.primitive-rail .studio-option{left:0;right:auto}.primitive-rail i{left:0;right:auto}.studio-mode-feedback{position:absolute;right:calc(52px + env(safe-area-inset-right));top:50%;width:20px;height:20px;transform:translateY(-50%);z-index:7;pointer-events:none;opacity:0;transition:opacity .15s}.studio-mode-feedback.shown{opacity:.65}.studio-mode-feedback.profile-label{right:auto;left:calc(54px + env(safe-area-inset-left));width:max-content;height:auto;padding:6px 8px;background:#000c;color:#ddd;font-size:12px;line-height:1.4;white-space:nowrap}.studio-mode-feedback svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}@media(prefers-reduced-motion:reduce){.studio-rail,.studio-mode-feedback{transition:none}}';
  document.head.appendChild(style);
  const controls={image:0,primitive:initial.primitive??0,photo:initial.photo??0,setImage:level=>change('image',level),dispose},rails=[],feedbacks=[],touches=new Set();
  const labels={image:['Foto','Gaussian-3D'],profile:['Macintosh 128K · 1984','IBM 5151 · 1981','IBM CGA · 1981','Game Boy DMG-01 · 1989','Blå CRT · P11-fosfor']};
  const icons=['<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 5-5 4 3 3-4 4 6"/></svg>','<svg viewBox="0 0 24 24"><path d="m12 3 8 4v10l-8 4-8-4V7Zm0 9 8-5M12 12 4 7m8 5v9"/><circle cx="12" cy="3" r="1"/><circle cx="4" cy="17" r="1"/><circle cx="20" cy="17" r="1"/></svg>'];
  let owner=null,ignoreClickUntil=0,feedbackTimer=0;
  for(const root of roots){
    for(const kind of ['image','primitive']){
      const rail=document.createElement('div'),options=[],levels=kind==='image'?[0,1]:[0,1,2,3,4];
      rail.className='studio-rail '+kind+'-rail';rail.setAttribute('role','group');rail.setAttribute('aria-label',kind==='image'?'Bilettype':'Historisk skjermprofil');
      for(const level of levels){
        const button=document.createElement('button'),tick=document.createElement('i');button.type='button';button.className='studio-option';button.setAttribute('aria-label',kind==='primitive'?labels.profile[level]:labels.image[level]);tick.setAttribute('aria-hidden','true');button.appendChild(tick);rail.appendChild(button);options.push({button,tick,level});
        button.addEventListener('click',()=>{if(!enabled())return;onGesture();change(kind,level);if(kind==='image')feedback();else feedbackProfile(level)});
        button.addEventListener('focus',()=>{if(kind==='image')feedback(level);else feedbackProfile(level)});
      }
      root.appendChild(rail);rails.push({kind,rail,options});
    }
    const hint=document.createElement('span');hint.className='studio-mode-feedback';hint.setAttribute('aria-hidden','true');root.appendChild(hint);feedbacks.push(hint);
  }
  function feedback(level=controls.image){clearTimeout(feedbackTimer);for(const hint of feedbacks){hint.classList.remove('profile-label');hint.innerHTML=icons[level];hint.classList.add('shown')}feedbackTimer=setTimeout(()=>{for(const hint of feedbacks)hint.classList.remove('shown')},800)}
  function feedbackProfile(level){clearTimeout(feedbackTimer);for(const hint of feedbacks){hint.textContent=labels.profile[level];hint.classList.add('profile-label');hint.classList.add('shown')}feedbackTimer=setTimeout(()=>{for(const hint of feedbacks)hint.classList.remove('shown')},1300)}
  function update(){for(const {kind,rail,options} of rails){const selected=kind==='primitive'&&controls.image===0?'photo':kind;rail.classList.toggle('active',owner?.kind===kind);rail.setAttribute('aria-label',kind==='primitive'?'Historisk skjermprofil':'Bilettype');for(const {button,tick,level} of options){button.setAttribute('aria-label',kind==='primitive'?labels.profile[level]:labels.image[level]);button.setAttribute('aria-pressed',String(level===controls[selected]));tick.classList.toggle('chosen',level===controls[selected])}}}
  function change(kind,level){if(kind==='primitive'&&controls.image===0)kind='photo';const next=Math.max(0,Math.min(kind==='image'?1:4,Math.round(level)));if(!Number.isFinite(next)||controls[kind]===next)return;controls[kind]=next;if(kind==='image'&&next===0&&owner?.kind==='primitive')owner=null;update();onChange(kind,next)}
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation()};
  const auxiliary=event=>event.target.closest('.access-control,.studio-option');
  const band=()=>Math.max(24,window.innerWidth*.07);
  const select=event=>{const length=owner.kind==='image'?2:5,level=Math.min(length-1,Math.max(0,Math.floor(event.clientY/Math.max(1,window.innerHeight)*length)));change(owner.kind,level);if(owner.kind==='image')feedback();else feedbackProfile(level)};
  function down(event){
    if(event.pointerType!=='touch')return;
    if(touches.size){touches.add(event.pointerId);consume(event);return}
    if(!enabled()||!event.isPrimary||event.target.closest('[data-photo-save]'))return;
    if(event.target.closest('.studio-option')){owner={id:event.pointerId,native:true};touches.add(event.pointerId);return}
    if(auxiliary(event))return;
    const kind=event.clientX>=0&&event.clientX<=band()?'primitive':event.clientX>=window.innerWidth-band()&&event.clientX<=window.innerWidth?'image':null;
    if(!kind)return;owner={kind,id:event.pointerId};touches.add(event.pointerId);ignoreClickUntil=Date.now()+1000;consume(event);onGesture();select(event);update();
  }
  function move(event){if(event.pointerType!=='touch'||!touches.size||owner?.native&&owner.id===event.pointerId)return;consume(event);if(owner?.id===event.pointerId)select(event)}
  function up(event){if(event.pointerType!=='touch'||!touches.size)return;const native=owner?.native&&owner.id===event.pointerId;touches.delete(event.pointerId);if(!native){consume(event);ignoreClickUntil=Date.now()+400}if(owner?.id===event.pointerId){owner=null;update()}}
  function click(event){if(Date.now()<ignoreClickUntil&&!auxiliary(event)&&(event.clientX<=band()||event.clientX>=window.innerWidth-band()))consume(event)}
  function blur(){touches.clear();owner=null;ignoreClickUntil=0;update()}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['click',click],['blur',blur]];
  for(const [name,listener] of listeners)window.addEventListener(name,listener,{capture:true,passive:false});
  function dispose(){for(const [name,listener] of listeners)window.removeEventListener(name,listener,true);clearTimeout(feedbackTimer);for(const {rail} of rails)rail.remove();for(const hint of feedbacks)hint.remove();style.remove();touches.clear()}
  update();return controls;
}
