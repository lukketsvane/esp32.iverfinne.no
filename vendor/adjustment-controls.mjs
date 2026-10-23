let adjustmentPanelId=0;

const fields=[
  ['pixelSize','Pikselstorleik',1,8,.1,1],
  ['black','Svartnivå',0,254,1,0],
  ['gamma','Mellomtonar',.2,3,.05,1],
  ['white','Kvitnivå',1,255,1,255],
  ['contrast','Kontrast',.5,3,.05,1],
  ['strength','Ditheringstyrke',0,1,.05,1],
  ['rotation','Rotasjon',-180,180,1,0]
];
const algorithms=[['profile','Profil'],['threshold','Terskel'],['bayer','Bayer'],['floyd','Floyd–Steinberg'],['atkinson','Atkinson']];

export function attachAdjustmentControls(root,{initial={},onChange=()=>{},onReset=()=>{},onOpenChange=()=>{}}={}){
  const document=root.ownerDocument||globalThis.document,id='image-adjustments-'+(++adjustmentPanelId),listeners=[],inputs=new Map(),outputs=new Map();
  const values=Object.fromEntries(fields.map(([key,,,,,value])=>[key,value]));values.dither='profile';
  let opened=false,disposed=false;
  const create=(tag,className='')=>{const element=document.createElement(tag);element.className=className;return element};
  const listen=(element,type,handler,options)=>{element.addEventListener(type,handler,options);listeners.push([element,type,handler,options])};
  const stop=event=>event.stopPropagation();
  const style=create('style');
  style.textContent=`
.studio .adjustment-toggle{left:50%;right:auto;top:calc(12px + env(safe-area-inset-top));bottom:auto;transform:translateX(-50%);z-index:9}
.studio .adjustment-toggle[aria-expanded="true"]{color:#fff}
.adjustment-panel{position:absolute;z-index:10;top:calc(60px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:min(320px,calc(100% - 32px));max-height:min(60dvh,calc(100dvh - 100px - env(safe-area-inset-top) - env(safe-area-inset-bottom)));overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;padding:8px 16px 14px;background:#101010f5;border:1px solid #ffffff24;border-radius:12px;color:#ddd;box-shadow:0 8px 32px #0008;scrollbar-width:thin}
.adjustment-panel[data-context="camera"]{top:auto;bottom:calc(16px + env(safe-area-inset-bottom));max-height:calc(50dvh - clamp(78px,22.5vw,111px) - 32px - env(safe-area-inset-bottom))}
@media(orientation:landscape){.adjustment-panel[data-context="camera"]{top:calc(60px + env(safe-area-inset-top));bottom:auto;left:auto;right:calc(16px + env(safe-area-inset-right));transform:none;width:min(320px,calc(50vw - clamp(52px,15vw,74px) - 32px - env(safe-area-inset-right)));max-height:calc(100dvh - 76px - env(safe-area-inset-top) - env(safe-area-inset-bottom))}}
.adjustment-panel[hidden]{display:none!important}
.adjustment-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
.adjustment-heading h2{margin:0;font-size:14px;font-weight:500}
.adjustment-panel button{min-width:44px;min-height:44px;padding:8px;border:0;background:transparent;color:#ccc;touch-action:manipulation}
.adjustment-close{display:grid;place-items:center;margin-right:-10px}
.adjustment-close svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round}
.adjustment-row{display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:12px;row-gap:1px;margin:2px 0 6px;font-size:12px}
.adjustment-row output{font-variant-numeric:tabular-nums;color:#aaa}
.adjustment-row input{grid-column:1/-1;width:100%;height:28px;margin:0;accent-color:#ddd;touch-action:pan-y;cursor:ew-resize}
.adjustment-row select{grid-column:1/-1;width:100%;min-height:38px;padding:6px 8px;margin:3px 0 4px;border:1px solid #ffffff2b;border-radius:5px;background:#191919;color:#ddd;font:inherit;touch-action:manipulation}
.adjustment-panel :is(button,input,select):focus-visible{outline:1px solid #bbb!important;outline-offset:3px}
.adjustment-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #ffffff18;padding-top:4px;margin-top:8px}
.adjustment-hint{font-size:10px;line-height:1.6;color:#888;margin:0}
.adjustment-reset{font-size:12px;padding-right:0!important}
html:has(.adjustment-panel:not([hidden])),html:has(.adjustment-panel:not([hidden])) body,html:has(.adjustment-panel:not([hidden])) .studio{touch-action:pan-y}
`;
  document.head.appendChild(style);
  const toggle=create('button','access-control adjustment-toggle');toggle.type='button';toggle.setAttribute('aria-label','Juster bilete');toggle.setAttribute('aria-controls',id);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('data-adjustments','');
  toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h5m4 0h7M4 12h9m4 0h3M4 18h2m4 0h10"/><circle cx="11" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></svg>';
  const panel=create('section','adjustment-panel');panel.id=id;panel.hidden=true;panel.setAttribute('data-adjustments','');panel.setAttribute('role','region');panel.setAttribute('aria-labelledby',id+'-title');
  const heading=create('div','adjustment-heading'),title=create('h2'),closeButton=create('button','adjustment-close');title.id=id+'-title';title.textContent='Bilete';closeButton.type='button';closeButton.setAttribute('aria-label','Lukk justeringar');closeButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';heading.appendChild(title);heading.appendChild(closeButton);panel.appendChild(heading);
  for(const [key,label,min,max,step] of fields){
    if(key==='strength')addDither();
    const row=create('div','adjustment-row'),text=create('label'),input=create('input'),output=create('output');
    text.textContent=label;text.setAttribute('for',id+'-'+key);input.id=id+'-'+key;input.type='range';input.name=key;input.min=String(min);input.max=String(max);input.step=String(step);input.setAttribute('aria-label',label);output.setAttribute('for',input.id);output.setAttribute('aria-hidden','true');
    row.appendChild(text);row.appendChild(output);row.appendChild(input);panel.appendChild(row);inputs.set(key,input);outputs.set(key,output);
    listen(input,'input',()=>{if(disposed)return;update({[key]:Number(input.value)});onChange({[key]:values[key]})});
  }
  function addDither(){
    const row=create('div','adjustment-row'),label=create('label'),select=create('select');label.textContent='Dithering';label.setAttribute('for',id+'-dither');select.id=id+'-dither';select.name='dither';select.setAttribute('aria-label','Dithering');
    for(const [value,name]of algorithms){const option=create('option');option.value=value;option.textContent=name;select.appendChild(option)}
    row.appendChild(label);row.appendChild(select);panel.appendChild(row);inputs.set('dither',select);
    listen(select,'change',()=>{if(disposed)return;update({dither:select.value});onChange({dither:values.dither})});
  }
  const footer=create('div','adjustment-footer'),hint=create('p','adjustment-hint'),resetButton=create('button','adjustment-reset');hint.textContent='Knip: pikselstorleik · Vri: rotasjon';resetButton.textContent='Nullstill';resetButton.type='button';resetButton.setAttribute('aria-label','Nullstill justeringar');footer.appendChild(hint);footer.appendChild(resetButton);panel.appendChild(footer);
  root.appendChild(toggle);root.appendChild(panel);
  function setOpen(value,restoreFocus=true){
    if(disposed||opened===Boolean(value))return;opened=Boolean(value);panel.hidden=!opened;toggle.setAttribute('aria-expanded',String(opened));onOpenChange(opened);
    if(opened)closeButton.focus?.({preventScroll:true});else if(restoreFocus)toggle.focus?.({preventScroll:true});
  }
  function close(){setOpen(false)}
  listen(toggle,'click',()=>setOpen(!opened));listen(closeButton,'click',close);listen(resetButton,'click',()=>{if(!disposed)onReset()});
  for(const element of [toggle,panel]){
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick'])listen(element,type,stop);
    listen(element,'contextmenu',event=>{event.preventDefault();event.stopPropagation()});
    listen(element,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&opened){event.preventDefault();close()}});
  }
  function update(patch={}){
    if(disposed)return;
    for(const [key,,min,max]of fields){if(Number.isFinite(patch[key])){let value=patch[key];if(key==='rotation'&&(value<min||value>max))value=((value+180)%360+360)%360-180;values[key]=Math.max(min,Math.min(max,value))}}
    if(algorithms.some(([key])=>key===patch.dither))values.dither=patch.dither;
    if(values.black>=values.white){if(Number.isFinite(patch.white)&&!Number.isFinite(patch.black))values.white=values.black+1;else values.black=values.white-1}
    inputs.get('black').max=String(values.white-1);inputs.get('white').min=String(values.black+1);
    for(const [key,input]of inputs){input.value=String(values[key]);if(outputs.has(key)){const number=Number(values[key].toFixed(2)),text=key==='pixelSize'?number+' px':key==='rotation'?number+'°':key==='strength'?Math.round(number*100)+' %':String(number);outputs.get(key).textContent=text;input.setAttribute('aria-valuetext',text)}}
  }
  function setContext(kind){if(disposed)return;panel.setAttribute('data-context',['camera','photo','depth'].includes(kind)?kind:'photo')}
  function dispose(){if(disposed)return;if(opened)setOpen(false,false);disposed=true;for(const [element,type,handler,options]of listeners)element.removeEventListener(type,handler,options);toggle.remove();panel.remove();style.remove()}
  update(initial);setContext('camera');
  return {update,setContext,get open(){return opened},close,dispose};
}
