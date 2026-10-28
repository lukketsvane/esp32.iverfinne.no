export function attachStudioControls(roots,onChange,enabled=()=>true,onGesture=()=>{},initial={}){
  const vathography=initial.vathography===true;
  const style=document.createElement('style');
  style.textContent='.studio-rail{position:absolute;inset:0 calc(2px + env(safe-area-inset-right)) 0 auto;width:44px;z-index:6;pointer-events:none;opacity:.5;transition:opacity .15s}.studio-rail[hidden]{display:none}.studio-rail.active{opacity:1}.studio-option{position:absolute;right:0;top:12.5%;width:44px;height:44px;transform:translateY(-50%);padding:0;border:0;background:transparent;color:#fff;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent}.studio-option:nth-child(2){top:37.5%}.studio-option:nth-child(3){top:62.5%}.studio-option:nth-child(4){top:87.5%}.primitive-rail .studio-option:nth-child(1){top:10%}.primitive-rail .studio-option:nth-child(2){top:30%}.primitive-rail .studio-option:nth-child(3){top:50%}.primitive-rail .studio-option:nth-child(4){top:70%}.primitive-rail .studio-option:nth-child(5){top:90%}.studio-option i{position:absolute;right:0;top:21px;width:8px;height:2px;background:currentColor;opacity:.7;box-shadow:0 0 3px #000}.studio-option i.chosen{width:16px;opacity:1}.studio-option:focus-visible{outline:0}.studio-option:focus-visible i{width:20px;opacity:1}.image-rail .studio-option{top:25%}.image-rail .studio-option:nth-child(2){top:75%}.primitive-rail{inset:0 auto 0 calc(2px + env(safe-area-inset-left))}.primitive-rail .studio-option{left:0;right:auto}.primitive-rail i{left:0;right:auto}@media(prefers-reduced-motion:reduce){.studio-rail,}';
  style.textContent+=`.primitive-rail .studio-option i{opacity:.2;transform:translateX(-4px);transition:opacity .65s ease 1.6s,transform .65s ease 1.6s}
.primitive-rail .studio-option i.chosen{opacity:.35}
.primitive-rail:is(.active,:active,:has(:focus-visible)) .studio-option i{opacity:.7;transform:translateX(0);transition-duration:.12s;transition-delay:0s}
.primitive-rail:is(.active,:active,:has(:focus-visible)) .studio-option i.chosen{opacity:1}
@media(hover:hover){.primitive-rail:hover .studio-option i{opacity:.7;transform:translateX(0);transition-duration:.12s;transition-delay:0s}.primitive-rail:hover .studio-option i.chosen{opacity:1}}
@media(prefers-reduced-motion:reduce){.primitive-rail .studio-option i{transition:none;transform:none}}`;
  style.textContent+='.image-rail .studio-option:nth-child(1){top:16.666%}.image-rail .studio-option:nth-child(2){top:50%}.image-rail .studio-option:nth-child(3){top:83.333%}';
  if(!vathography)document.head.appendChild(style);
  const controls={image:vathography?2:initial.image??2,primitive:initial.primitive??0,photo:initial.photo??0,vathography,setImage:level=>change('image',level),dispose},rails=[],touches=new Set();
  const labels={image:['Foto','Gaussian-3D','Djupnekunst']};
  let owner=null,ignoreClickUntil=0;
  for(const root of vathography?[]:roots){
    for(const kind of ['image','primitive']){
      const rail=document.createElement('div'),options=[],levels=kind==='image'?[0,1,2]:Array.from({length:9},(_,i)=>i);
      rail.className='studio-rail '+kind+'-rail';rail.setAttribute('role','group');rail.setAttribute('aria-label',kind==='image'?'Bilettype':'Historisk skjermprofil');
      for(const level of levels){
        const button=document.createElement('button'),tick=document.createElement('i');button.type='button';button.className='studio-option';if(kind==='primitive')button.style.top=((level+.5)/9*100)+'%';button.setAttribute('aria-label',kind==='primitive'?'Profil '+(level+1):labels.image[level]);tick.setAttribute('aria-hidden','true');button.appendChild(tick);rail.appendChild(button);options.push({button,tick,level});
        button.addEventListener('click',()=>{if(!enabled())return;onGesture();change(kind,level)});
      }
      root.appendChild(rail);rails.push({kind,rail,options});
    }
  }
  function update(){for(const {kind,rail,options} of rails){const selected=kind==='primitive'&&controls.image===0?'photo':kind;rail.classList.toggle('active',owner?.kind===kind);rail.hidden=kind==='primitive'&&controls.image===2;rail.setAttribute('aria-label',kind==='primitive'?'Historisk skjermprofil':'Bilettype');for(const {button,tick,level} of options){button.setAttribute('aria-label',kind==='primitive'?'Profil '+(level+1):labels.image[level]);button.setAttribute('aria-pressed',String(level===controls[selected]));tick.classList.toggle('chosen',level===controls[selected])}}}
  function change(kind,level){if(kind==='primitive'&&controls.image===0)kind='photo';const next=Math.max(0,Math.min(kind==='image'?2:8,Math.round(level)));if(!Number.isFinite(next)||controls[kind]===next)return;controls[kind]=next;if(kind==='image'&&next===0&&owner?.kind==='primitive')owner=null;update();onChange(kind,next)}
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation()};
  const auxiliary=event=>event.target.closest('.access-control,.studio-option,.mg-variant,.mg-compare,.mg-quality,.mg-consent');
  const band=()=>Math.max(24,window.innerWidth*.07);
  const select=event=>{const length=owner.kind==='image'?3:9,level=Math.min(length-1,Math.max(0,Math.floor(event.clientY/Math.max(1,window.innerHeight)*length)));change(owner.kind,level)};
  function down(event){
    if(event.pointerType!=='touch'||event.target.closest('#scene canvas,.scene canvas,.cloud canvas'))return;
    if(touches.size){touches.add(event.pointerId);consume(event);return}
    if(!enabled()||!event.isPrimary||event.target.closest('[data-photo-save]'))return;
    if(event.target.closest('.studio-option')){owner={id:event.pointerId,native:true};touches.add(event.pointerId);return}
    if(auxiliary(event))return;
    const kind=controls.image!==2&&event.clientX>=0&&event.clientX<=band()?'primitive':event.clientX>=window.innerWidth-band()&&event.clientX<=window.innerWidth?'image':null;
    if(!kind)return;owner={kind,id:event.pointerId};touches.add(event.pointerId);ignoreClickUntil=Date.now()+1000;consume(event);onGesture();select(event);update();
  }
  function move(event){if(event.pointerType!=='touch'||!touches.size||owner?.native&&owner.id===event.pointerId)return;consume(event);if(owner?.id===event.pointerId)select(event)}
  function up(event){if(event.pointerType!=='touch'||!touches.size)return;const native=owner?.native&&owner.id===event.pointerId;touches.delete(event.pointerId);if(!native){consume(event);ignoreClickUntil=Date.now()+400}if(owner?.id===event.pointerId){owner=null;update()}}
  function click(event){if(Date.now()<ignoreClickUntil&&!auxiliary(event)&&(event.clientX<=band()||event.clientX>=window.innerWidth-band()))consume(event)}
  function blur(){touches.clear();owner=null;ignoreClickUntil=0;update()}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['click',click],['blur',blur]];
  if(!vathography)for(const [name,listener] of listeners)window.addEventListener(name,listener,{capture:true,passive:false});
  function dispose(){for(const [name,listener] of listeners)window.removeEventListener(name,listener,true);for(const {rail} of rails)rail.remove();style.remove();touches.clear()}
  update();return controls;
}
