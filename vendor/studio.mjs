export function attachStudioControls(roots,onChange,enabled=()=>true,onGesture=()=>{}){
  const style=document.createElement('style');
  style.textContent='.quality-rail{position:absolute;inset:0 calc(2px + env(safe-area-inset-right)) 0 auto;width:16px;z-index:6;pointer-events:none;opacity:.5;transition:opacity .15s}.quality-rail.active{opacity:1}.quality-rail i{position:absolute;right:0;top:12.5%;width:8px;height:2px;background:#fff;opacity:.7;box-shadow:0 0 3px #000}.quality-rail i:nth-child(2){top:37.5%}.quality-rail i:nth-child(3){top:62.5%}.quality-rail i:nth-child(4){top:87.5%}.quality-rail i.chosen{width:16px;opacity:1}.primitive-rail{inset:0 auto 0 calc(2px + env(safe-area-inset-left))}.primitive-rail i{left:0;right:auto}.studio-range{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);opacity:0;pointer-events:none}';
  document.head.appendChild(style);
  const controls={quality:2,primitive:0,dispose},rails=[],touches=new Set();
  const labels={quality:['Få punkt','Fleire punkt','Mange punkt','Flest punkt'],primitive:['C64-fargar','EGA: seksten fargar','CGA: fire fargar','Grøn fosfor']};
  let owner=null,ignoreClickUntil=0;
  for(const root of roots)for(const kind of ['quality','primitive']){
    const rail=document.createElement('div'),range=document.createElement('input'),ticks=[];
    rail.className='quality-rail'+(kind==='primitive'?' primitive-rail':'');rail.setAttribute('aria-hidden','true');
    for(let level=3;level>=0;level--){const tick=document.createElement('i');rail.appendChild(tick);ticks.push(tick)}
    range.type='range';range.min='0';range.max='3';range.step='1';range.className='studio-range';range.setAttribute('aria-label',kind==='quality'?'Punktmengde for neste foto':'Pikselstil');
    range.addEventListener('input',()=>change(kind,Number(range.value)));
    root.appendChild(rail);root.appendChild(range);rails.push({kind,rail,range,ticks});
  }
  function update(){for(const {kind,rail,range,ticks} of rails){range.value=String(controls[kind]);range.setAttribute('aria-valuetext',labels[kind][controls[kind]]);rail.classList.toggle('active',owner?.kind===kind);ticks.forEach((tick,index)=>tick.classList.toggle('chosen',3-index===controls[kind]))}}
  function change(kind,level){const next=Math.max(0,Math.min(3,Math.round(level)));if(!Number.isFinite(next)||controls[kind]===next)return;controls[kind]=next;update();onChange(kind,next)}
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation()};
  const band=()=>Math.max(24,window.innerWidth*.07);
  const select=event=>change(owner.kind,3-Math.floor(event.clientY/Math.max(1,window.innerHeight)*4));
  function down(event){
    if(event.pointerType!=='touch')return;
    if(touches.size){touches.add(event.pointerId);consume(event);return}
    if(!enabled()||!event.isPrimary||event.target.closest('.access-control'))return;
    const kind=event.clientX>=0&&event.clientX<=band()?'primitive':event.clientX>=window.innerWidth-band()&&event.clientX<=window.innerWidth?'quality':null;
    if(!kind)return;owner={kind,id:event.pointerId};touches.add(event.pointerId);ignoreClickUntil=Date.now()+1000;consume(event);onGesture();select(event);update();
  }
  function move(event){if(event.pointerType!=='touch'||!touches.size)return;consume(event);if(owner?.id===event.pointerId)select(event)}
  function up(event){if(event.pointerType!=='touch'||!touches.size)return;consume(event);touches.delete(event.pointerId);ignoreClickUntil=Date.now()+400;if(owner?.id===event.pointerId){owner=null;update()}}
  function click(event){if(Date.now()<ignoreClickUntil&&!event.target.closest('.access-control')&&(event.clientX<=band()||event.clientX>=window.innerWidth-band()))consume(event)}
  function blur(){touches.clear();owner=null;ignoreClickUntil=0;update()}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['click',click],['blur',blur]];
  for(const [name,listener] of listeners)window.addEventListener(name,listener,{capture:true,passive:false});
  function dispose(){for(const [name,listener] of listeners)window.removeEventListener(name,listener,true);for(const {rail,range} of rails){rail.remove();range.remove()}style.remove();touches.clear()}
  update();return controls;
}
