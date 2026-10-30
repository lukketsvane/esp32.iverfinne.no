import { PHOTO_PRESETS, normalizePhotoEdits, applyPhotoEdits } from './photo-adjustments.mjs';
import { attachNotchRail } from './notch-rail.mjs';

export function createPhotoEditor(host,{onInput=()=>{},onChange=()=>{},onActive=()=>{},getPreview=()=>null}={}){
  const tools=[['exposure','Eksponering',-3,3,.05],['contrast','Kontrast',-1,1,.01],['sharpen','Skarpleik',0,1,.01],['denoise','Støyreduksjon',0,1,.01],['crop','Utsnitt']];
  const listeners=[],buttons=new Map(),tiles=new Map(),aspects=new Map();
  let value=normalizePhotoEdits(),before=null,beforeRatio=null,beforeAspect='free',active=null,drag=null,ratio=null,aspect='free',sourceWidth=1,sourceHeight=1,disposed=false;
  const make=(tag,className,parent,text)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;parent?.appendChild(node);return node};
  const button=(className,parent,label,text)=>{const node=make('button',className,parent,text);node.type='button';node.setAttribute('aria-label',label);return node};
  const listen=(node,name,handler,options)=>{node.addEventListener(name,handler,options);listeners.push(()=>node.removeEventListener(name,handler,options))};
  const root=make('div','mg-editor',host),cropArea=make('div','mg-crop-area',root),cropFrame=make('div','mg-crop-frame',cropArea),rail=make('div','mg-edit-rail',root);
  cropArea.hidden=true;cropFrame.tabIndex=0;cropFrame.setAttribute('role','group');cropFrame.setAttribute('aria-label','Flytt utsnittet med piltastane');
  for(const [corner,label]of [['nw','oppe til venstre'],['ne','oppe til høgre'],['sw','nede til venstre'],['se','nede til høgre']]){const handle=button('mg-crop-handle',cropFrame,'Endre utsnitt '+label);handle.dataset.corner=corner;make('i','',handle)}
  for(const [key,label] of tools){const node=button('mg-edit-tool',rail,label);node.dataset.tool=key;node.title=label;node.setAttribute('aria-pressed','false');make('i','',node);buttons.set(key,node);listen(node,'click',()=>open(key))}
  const toolRail=attachNotchRail(rail,[...buttons.values()],{enabled:()=>!disposed&&!host.hidden,onStart:()=>{onActive(true);onInput(true)},onSelect:index=>{const key=tools[index][0];if(active!==key)open(key)},onTap:index=>open(tools[index][0]),onEnd:()=>onInput(false)});
  const toggle=button('mg-preset-toggle',root,'Fotoprofilar','◫');toggle.setAttribute('aria-expanded','false');listen(toggle,'click',()=>open('preset'));
  const panel=make('div','mg-edit-panel',root),strip=make('div','mg-preset-strip',panel),cropOptions=make('div','mg-crop-options',panel),heading=make('div','mg-edit-heading',panel),label=make('span','mg-edit-label',heading),amount=make('output','mg-edit-value',heading),range=make('input','mg-edit-range',panel),actions=make('div','mg-edit-actions',panel);
  panel.hidden=true;panel.setAttribute('role','group');range.type='range';
  const cancel=button('mg-edit-cancel',actions,'Avbryt endring','×'),reset=button('mg-edit-reset',actions,'Nullstill dette verktøyet','Nullstill'),apply=button('mg-edit-apply',actions,'Bruk endring','✓');
  for(const option of [{id:null,label:'–',description:'Utan fotoprofil'},...PHOTO_PRESETS]){
    const tile=button('mg-preset',strip,option.id?option.id+' · '+option.description:option.description);tile.dataset.preset=option.id||'';
    const canvas=make('canvas','mg-preset-preview',tile);canvas.width=canvas.height=1;make('span','',tile,option.label);tiles.set(option.id,{tile,canvas});
    listen(tile,'click',()=>{value={...value,preset:option.id,strength:option.defaultStrength??1};sync();onInput()});
  }
  for(const [key,text] of [['free','Fri'],['original','Original'],['1:1','1:1'],['4:5','4:5'],['16:9','16:9']]){
    const node=button('mg-crop-aspect',cropOptions,'Utsnitt '+text,text);node.dataset.ratio=key;aspects.set(key,node);
    listen(node,'click',()=>{aspect=key;ratio=key==='free'?null:key==='original'?sourceWidth/sourceHeight:key==='1:1'?1:key==='4:5'?4/5:16/9;if(ratio){const norm=ratio/(sourceWidth/sourceHeight),crop=value.crop;let width=crop.width,height=width/norm;if(height>crop.height){height=crop.height;width=height*norm}value={...value,crop:{x:crop.x+(crop.width-width)/2,y:crop.y+(crop.height-height)/2,width,height}}}sync();resize()});
  }
  const stop=event=>event.stopPropagation();
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','click','dblclick','contextmenu'])listen(root,name,stop);
  listen(root,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close(false)}else if(event.key==='Enter'&&event.target===range){event.preventDefault();close(true)}});
  listen(range,'input',()=>{const key=active==='preset'?'strength':active;if(!key||key==='crop')return;value={...value,[key]:Number(range.value)};sync();onInput()});
  listen(range,'change',()=>onInput(false));
  listen(cancel,'click',()=>close(false));listen(apply,'click',()=>close(true));
  listen(reset,'click',()=>{if(active==='crop'){value={...value,crop:{x:0,y:0,width:1,height:1}};ratio=null;aspect='free';resize()}else if(active==='preset')value={...value,preset:null,strength:1};else if(active)value={...value,[active]:0};sync();onInput()});
  function sync(){
    for(const [key,node]of buttons){node.setAttribute('aria-pressed',String(active===key));node.classList.toggle('changed',key==='crop'?value.crop.width!==1||value.crop.height!==1:value[key]!==0)}
    toggle.textContent=value.preset||'◫';toggle.setAttribute('aria-expanded',String(active==='preset'));toggle.classList.toggle('changed',!!value.preset);
    for(const [id,{tile}]of tiles)tile.setAttribute('aria-pressed',String(value.preset===id));
    for(const [key,node]of aspects)node.setAttribute('aria-pressed',String(key===aspect));
    if(!active)return;
    const setting=active==='preset'?['strength',value.preset||'Fotoprofilar',0,1,.01]:tools.find(item=>item[0]===active);
    label.textContent=setting[1];panel.setAttribute('aria-label',setting[1]);strip.hidden=active!=='preset';cropOptions.hidden=active!=='crop';heading.hidden=active==='crop';range.hidden=active==='crop';
    if(active!=='crop'){const number=value[setting[0]];range.min=String(setting[2]);range.max=String(setting[3]);range.step=String(setting[4]);range.value=String(number);range.setAttribute('aria-label',setting[1]);range.disabled=active==='preset'&&!value.preset;amount.textContent=active==='exposure'?(number>0?'+':'')+number.toFixed(2)+' EV':(number>0&&active==='contrast'?'+':'')+Math.round(number*100);range.setAttribute('aria-valuetext',amount.textContent)}
  }
  function thumbnails(){
    const preview=getPreview();if(!preview)return;
    for(const [id,{canvas}]of tiles){const pixels=applyPhotoEdits(preview.data,preview.width,preview.height,{...value,preset:id,strength:PHOTO_PRESETS.find(item=>item.id===id)?.defaultStrength??1},{referenceWidth:sourceWidth,referenceHeight:sourceHeight});canvas.width=pixels.width;canvas.height=pixels.height;const context=canvas.getContext('2d'),image=context.createImageData(pixels.width,pixels.height);image.data.set(pixels.data);context.putImageData(image,0,0)}
  }
  function close(commit=true){
    if(!active)return;
    const changed=JSON.stringify(value)!==JSON.stringify(before),previous=active;
    if(!commit){value=before;ratio=beforeRatio;aspect=beforeAspect}
    value=normalizePhotoEdits(value);active=null;before=null;drag=null;panel.hidden=true;cropArea.hidden=true;host.classList.remove('mg-editing','mg-cropping');sync();onActive(false);onInput(false);
    if(commit&&changed)onChange();(previous==='preset'?toggle:buttons.get(previous))?.focus({preventScroll:true});
  }
  function open(key){
    if(active===key){close(true);return}close(true);before=normalizePhotoEdits(value);beforeRatio=ratio;beforeAspect=aspect;active=key;panel.hidden=false;cropArea.hidden=key!=='crop';host.classList.add('mg-editing');host.classList.toggle('mg-cropping',key==='crop');onActive(true);sync();onInput(toolRail.active);resize();if(key==='preset')thumbnails();
  }
  function resize(){
    if(active!=='crop')return;const bounds=host.getBoundingClientRect(),scale=Math.min(bounds.width/sourceWidth,bounds.height/sourceHeight),width=sourceWidth*scale,height=sourceHeight*scale;
    cropArea.style.left=(bounds.width-width)/2+'px';cropArea.style.top=(bounds.height-height)/2+'px';cropArea.style.width=width+'px';cropArea.style.height=height+'px';const crop=value.crop;
    cropFrame.style.left=crop.x*100+'%';cropFrame.style.top=crop.y*100+'%';cropFrame.style.width=crop.width*100+'%';cropFrame.style.height=crop.height*100+'%';
  }
  const clamp=(number,low,high)=>Math.max(low,Math.min(high,number));
  const putCrop=crop=>{crop.width=Math.min(crop.width,1-crop.x);crop.height=Math.min(crop.height,1-crop.y);value={...value,crop};resize()};
  function moveCrop(crop,corner,dx,dy){
    if(!corner){putCrop({...crop,x:clamp(crop.x+dx,0,1-crop.width),y:clamp(crop.y+dy,0,1-crop.height)});return}
    const west=corner.includes('w'),north=corner.includes('n'),anchorX=west?crop.x+crop.width:crop.x,anchorY=north?crop.y+crop.height:crop.y,maxWidth=west?anchorX:1-anchorX,maxHeight=north?anchorY:1-anchorY;
    let width=clamp(crop.width+(west?-dx:dx),Math.min(.05,maxWidth),maxWidth),height=clamp(crop.height+(north?-dy:dy),Math.min(.05,maxHeight),maxHeight);
    if(ratio){const norm=ratio/(sourceWidth/sourceHeight);if(Math.abs(dy)>Math.abs(dx)/norm)width=height*norm;width=clamp(width,Math.min(.05,maxWidth,maxHeight*norm),Math.min(maxWidth,maxHeight*norm));height=width/norm}
    putCrop({x:west?anchorX-width:anchorX,y:north?anchorY-height:anchorY,width,height});
  }
  listen(cropFrame,'pointerdown',event=>{if(event.button>0)return;event.preventDefault();const bounds=cropArea.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,bounds,crop:{...value.crop},corner:event.target.closest('.mg-crop-handle')?.dataset.corner};cropFrame.setPointerCapture?.(event.pointerId)});
  listen(cropFrame,'pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;event.preventDefault();moveCrop(drag.crop,drag.corner,(event.clientX-drag.x)/drag.bounds.width,(event.clientY-drag.y)/drag.bounds.height);
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(cropFrame,name,event=>{if(drag?.id===event.pointerId)drag=null});
  listen(cropFrame,'keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?.05:.01,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;moveCrop(value.crop,event.target.closest('.mg-crop-handle')?.dataset.corner,dx,dy)});
  if(globalThis.addEventListener)listen(globalThis,'resize',resize);
  const observer=globalThis.ResizeObserver?new ResizeObserver(resize):null;observer?.observe(host);sync();
  return {get edits(){return normalizePhotoEdits(value)},get committed(){return normalizePhotoEdits(before||value)},get cropping(){return active==='crop'},get active(){return active},open,commit(){close(true)},cancel(){close(false)},resize,set(edits={},width=sourceWidth,height=sourceHeight){toolRail.cancel();value=normalizePhotoEdits(edits);sourceWidth=width;sourceHeight=height;active=null;before=null;drag=null;ratio=null;aspect='free';panel.hidden=true;cropArea.hidden=true;host.classList.remove('mg-editing','mg-cropping');sync()},dispose(){if(disposed)return;disposed=true;toolRail.dispose();observer?.disconnect();for(const remove of listeners)remove();root.remove()}};
}
