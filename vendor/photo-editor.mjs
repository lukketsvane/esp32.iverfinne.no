import { PHOTO_PRESETS, normalizePhotoEdits, suggestPhotoEdits } from './photo-adjustments.mjs';
import { attachNotchRail } from './notch-rail.mjs';

export function createPhotoEditor(host,{onInput=()=>{},onChange=()=>{},onActive=()=>{},getPreview=()=>null,onCompare=visible=>host.classList.toggle('mg-before',visible)}={}){
  const fields=[['exposure','Eksponering','EV',-3,3,.05],['contrast','Kontrast','Kontrast',-1,1,.01],['highlights','Høglys','Høglys',-1,1,.01],['shadows','Skuggar','Skuggar',-1,1,.01],['saturation','Fargemetning','Metning',-1,1,.01],['temperature','Fargetemperatur','Varme',-1,1,.01],['tint','Fargestikk','Fargetone',-1,1,.01],['skinTone','Hudtone','Hudtone',-1,1,.01],['fade','Falming','Falming',0,1,.01],['vignette','Vignettering','Vignett',0,1,.01],['sharpen','Skarpleik','Skarpleik',0,1,.01],['denoise','Støyreduksjon','Støy',0,1,.01],['grain.strength','Kornstyrke','Korn',0,1,.01],['grain.size','Kornstorleik','Storleik',0,1,.01],['grain.color','Farga korn','Kornfarge',0,1,.01]];
  const groups=[['light','Lys',['exposure','contrast','highlights','shadows','fade','vignette']],['color','Farge',['saturation','temperature','tint','skinTone','hsl']],['texture','Tekstur',['sharpen','denoise','grain.strength','grain.size','grain.color']],['crop','Utsnitt',[]],['preset','Fotoprofilar',[]]];
  const channels=[['red','Raud','R'],['orange','Oransje','O'],['yellow','Gul','G'],['green','Grøn','Gr'],['blue','Blå','B'],['purple','Lilla','L']],components=[['hue','Fargetone','Tone'],['saturation','Metning','Metning'],['lightness','Lysstyrke','Lys']];
  const listeners=[],buttons=new Map(),tiles=new Map(),aspects=new Map(),options=new Map(),channelButtons=new Map(),componentButtons=new Map(),defaults=normalizePhotoEdits();
  const geometryFields=[
    ['geometry.straighten','Rett opp','Vinkel',-45,45,.25],
    ['geometry.skewX','Vassrett perspektiv','Perspektiv X',-1,1,.01],
    ['geometry.skewY','Loddrett perspektiv','Perspektiv Y',-1,1,.01]
  ];
  const geometryDefault={turns:0,flipX:false,flipY:false,straighten:0,skewX:0,skewY:0};
  const ratios={'1:1':1,'4:5':4/5,'5:4':5/4,'3:2':3/2,'2:3':2/3,'4:3':4/3,'3:4':3/4,'16:9':16/9,'9:16':9/16};
  const undoStack=[],redoStack=[];
  const storagePrefix='entropi-studio-v1-';
  function load(key){
    try{return JSON.parse(globalThis.localStorage?.getItem(storagePrefix+key)??'null')}catch{return null}
  }
  function save(key,data){
    try{if(!globalThis.localStorage)return false;globalThis.localStorage.setItem(storagePrefix+key,JSON.stringify(data));return true}catch{return false}
  }
  function presetList(key){
    const ids=load(key);
    return Array.isArray(ids)?ids.filter(id=>PHOTO_PRESETS.some(p=>p.id===id)):[];
  }
  let favorites=presetList('favorites'),recent=presetList('recent'),recipe=null,filter='all',geometryKey=null,comparing=false;
  try{const saved=load('recipe');if(saved)recipe=normalizePhotoEdits(saved)}catch{}
  const selections={light:'exposure',color:'saturation',texture:'sharpen'};
  let value=normalizePhotoEdits(),before=null,beforeRatio=null,beforeAspect='free',active=null,drag=null,adjusting=null,ratio=null,aspect='free',channel='red',component='hue',sourceWidth=1,sourceHeight=1,disposed=false;
  const make=(tag,className,parent,text)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;parent?.appendChild(node);return node};
  const button=(className,parent,label,text)=>{const node=make('button',className,parent,text);node.type='button';node.setAttribute('aria-label',label);return node};
  const listen=(node,name,handler,settings)=>{node.addEventListener(name,handler,settings);listeners.push(()=>node.removeEventListener(name,handler,settings))};
  const read=(key,edits=value)=>key.split('.').reduce((result,part)=>result?.[part],edits)??0;
  const write=(key,number)=>{const parts=key.split('.');if(parts[0]==='grain')value={...value,grain:{...value.grain,[parts[1]]:number}};else if(parts[0]==='geometry')value={...value,geometry:{...geometryDefault,...value.geometry,[parts[1]]:number}};else if(parts[0]==='hsl')value={...value,hsl:{...value.hsl,[parts[1]]:{...value.hsl?.[parts[1]],[parts[2]]:number}}};else value={...value,[key]:number}};
  const clamp=(number,low,high)=>Math.max(low,Math.min(high,number));
  const root=make('div','mg-editor',host),cropArea=make('div','mg-crop-area',root),cropFrame=make('div','mg-crop-frame',cropArea),adjustArea=make('div','mg-edit-adjust',root),rail=make('div','mg-edit-rail',root);
  cropArea.hidden=adjustArea.hidden=true;adjustArea.setAttribute('aria-hidden','true');cropFrame.tabIndex=0;cropFrame.setAttribute('role','group');cropFrame.setAttribute('aria-label','Flytt utsnittet med piltastane');
  for(const [corner,label]of [['nw','oppe til venstre'],['ne','oppe til høgre'],['sw','nede til venstre'],['se','nede til høgre']]){const handle=button('mg-crop-handle',cropFrame,'Endre utsnitt '+label);handle.dataset.corner=corner;make('i','',handle)}
  for(const [key,label]of groups){const node=button('mg-edit-tool',rail,label);node.dataset.tool=key;node.title=label;node.setAttribute('aria-pressed','false');make('i','',node);buttons.set(key,node);listen(node,'click',()=>open(key))}
  const toolRail=attachNotchRail(rail,[...buttons.values()],{enabled:()=>!disposed&&!host.hidden,onStart:()=>{onActive(true);onInput(true)},onSelect:index=>{const key=groups[index][0];if(active!==key)open(key)},onTap:index=>open(groups[index][0]),onEnd:()=>onInput(false)});
  const toggle=button('mg-preset-toggle',root,'Fotoprofilar','◫');toggle.setAttribute('aria-expanded','false');listen(toggle,'click',()=>open('preset'));
  const panel=make('div','mg-edit-panel',root),choices=make('div','mg-edit-choices',panel),optionList=make('div','mg-edit-options',choices),hslOptions=make('div','mg-hsl-options',choices),hslBack=button('mg-hsl-back',hslOptions,'Tilbake til fargeverktøya','Farge'),channelList=make('div','mg-hsl-channels',hslOptions),componentList=make('div','mg-hsl-components',hslOptions),strip=make('div','mg-preset-strip',choices),cropOptions=make('div','mg-crop-options',choices),heading=make('div','mg-edit-heading',panel),label=make('span','mg-edit-label',heading),amount=make('output','mg-edit-value',heading),range=make('input','mg-edit-range',panel),actions=make('div','mg-edit-actions',panel);
  panel.hidden=true;panel.setAttribute('role','group');range.type='range';range.setAttribute('aria-description','Dra vassrett over biletet for å justere. Bruk piltastane med tastatur.');
  const cancel=button('mg-edit-cancel',actions,'Avbryt endring','×'),reset=button('mg-edit-reset',actions,'Nullstill dette verktøyet','↺'),apply=button('mg-edit-apply',actions,'Bruk endring','✓');
  const history=make('div','mg-edit-history',root);
  const undo=button('mg-edit-undo',history,'Angre siste justering','↶'),redo=button('mg-edit-redo',history,'Gjer om siste justering','↷');
  const compare=button('mg-edit-compare',history,'Vis originalen','Før');
  history.hidden=true;
  function setCompare(visible){
    if(comparing===visible)return;
    comparing=visible;onCompare(visible);compare.setAttribute('aria-pressed',String(visible));
  }
  compare.setAttribute('aria-pressed','false');
  listen(compare,'click',()=>setCompare(!comparing));
  function addUndo(edits){
    undoStack.push(edits);if(undoStack.length>50)undoStack.shift();
    redoStack.length=0;
  }
  function isDraft(){return before!==null&&JSON.stringify(before)!==JSON.stringify(value)}
  function traverse(back){
    if(!back&&isDraft())return;
    if(isDraft())addUndo(before);
    const from=back?undoStack:redoStack,to=back?redoStack:undoStack;
    if(!from.length)return;
    to.push(normalizePhotoEdits(value));value=from.pop();
    before=active?normalizePhotoEdits(value):null;
    ratio=beforeRatio=null;aspect=beforeAspect='free';setCompare(false);
    sync();resize();onInput(false);onChange();
  }
  listen(undo,'click',()=>traverse(true));listen(redo,'click',()=>traverse(false));
  const presetTools=make('div','mg-preset-tools',choices);
  // Keep workflow controls ahead of long preset lists in a narrow mobile tray.
  strip.before?.(presetTools);
  const suggest=button('mg-suggest',presetTools,'Føreslå justeringar for dette biletet','For dette biletet');
  const filterSelect=make('select','mg-preset-filter',presetTools);
  filterSelect.setAttribute('aria-label','Vis fotoprofilar');
  for(const [id,text]of [['all','Alle profilar'],['favorites','Favorittar'],['recent','Nylege']]){
    const option=make('option','',filterSelect,text);option.value=id;
  }
  const favorite=button('mg-preset-favorite',presetTools,'Merk fotoprofil som favoritt','☆ Favoritt');
  const saveRecipe=button('mg-recipe-save',presetTools,'Lagre oppskrift','Lagre oppskrift');
  const applyRecipe=button('mg-recipe-apply',presetTools,'Bruk lagra oppskrift','Bruk oppskrift');
  const notice=make('div','mg-preset-notice',presetTools);
  notice.setAttribute('role','status');
  function useLook(look){
    const crop=value.crop,geometry=value.geometry;
    value=normalizePhotoEdits({...look,crop,geometry});
    setCompare(false);sync();onInput(false);
  }
  listen(suggest,'click',()=>{
    try{
      const image=getPreview();
      if(!image)throw new Error('missing preview');
      useLook(suggestPhotoEdits(image.data,image.width,image.height));
      notice.textContent='Forslag klart. Trykk ✓ for å bruke det.';
    }catch{notice.textContent='Fekk ikkje lese biletet.'}
  });
  listen(filterSelect,'change',()=>{filter=filterSelect.value;sync()});
  listen(favorite,'click',()=>{
    if(!value.preset)return;
    favorites=favorites.includes(value.preset)?favorites.filter(id=>id!==value.preset):[value.preset,...favorites];
    save('favorites',favorites);sync();
  });
  listen(saveRecipe,'click',()=>{
    const {crop,geometry,...look}=normalizePhotoEdits(value);
    if(save('recipe',look)){recipe=look;notice.textContent='Oppskrifta er lagra.'}
    else notice.textContent='Kunne ikkje lagre oppskrifta på denne eininga.';
    sync();
  });
  listen(applyRecipe,'click',()=>{if(recipe){useLook(recipe);notice.textContent='Oppskrift klar. Trykk ✓ for å bruke henne.'}});
  for(const [key,text,short]of [...fields,['hsl','Fargekanalar','HSL']]){const node=button('mg-edit-option',optionList,text,short);node.dataset.setting=key;options.set(key,node);listen(node,'click',()=>{selections[active]=key;sync()})}
  listen(hslBack,'click',()=>{selections.color='saturation';sync()});
  for(const [key,text,short]of channels){const node=button('mg-hsl-channel',channelList,text,short);node.dataset.channel=key;channelButtons.set(key,node);listen(node,'click',()=>{channel=key;sync()})}
  for(const [key,text,short]of components){const node=button('mg-hsl-component',componentList,text,short);node.dataset.component=key;componentButtons.set(key,node);listen(node,'click',()=>{component=key;sync()})}
  for(const option of [{id:null,label:'Av',description:'Utan fotoprofil'},...PHOTO_PRESETS]){const tile=button('mg-preset',strip,option.id?option.id+' · '+option.description:option.description,option.label);tile.dataset.preset=option.id||'';tiles.set(option.id,tile);listen(tile,'click',()=>{value={...value,preset:option.id,strength:option.defaultStrength??1};sync();onInput()})}
  function orientedSize(){
    return (value.geometry?.turns??0)%2?[sourceHeight,sourceWidth]:[sourceWidth,sourceHeight];
  }
  function chooseAspect(key){
    geometryKey=null;aspect=key;
    const [w,h]=orientedSize();
    ratio=key==='free'?null:key==='original'?w/h:ratios[key];
    if(ratio){
      const norm=ratio/(w/h),crop=value.crop;
      let width=crop.width,height=width/norm;
      if(height>crop.height){height=crop.height;width=height*norm}
      putCrop({x:crop.x+(crop.width-width)/2,y:crop.y+(crop.height-height)/2,width,height});
    }
    sync();resize();
  }
  for(const [key,text]of [['free','Fri'],['original','Original'],...Object.keys(ratios).map(key=>[key,key])]){
    const node=button('mg-crop-aspect',cropOptions,'Utsnitt '+text,text);node.dataset.ratio=key;aspects.set(key,node);
    listen(node,'click',()=>chooseAspect(key));
  }
  const geometryTools=make('div','mg-geometry-tools',choices);
  cropOptions.before?.(geometryTools);
  for(const [key,text,short]of [['turnLeft','Roter 90° til venstre','↶ 90°'],['turnRight','Roter 90° til høgre','↷ 90°'],['flipX','Spegl vassrett','Spegl X'],['flipY','Spegl loddrett','Spegl Y']]){
    const node=button('mg-transform',geometryTools,text,short);node.dataset.transform=key;
    listen(node,'click',()=>{
      setCompare(false);const g={...geometryDefault,...value.geometry},c={...value.crop};
      if(key==='flipX'||key==='flipY'){
        g[key]=!g[key];g.straighten=-g.straighten;
        if(key==='flipX'){g.skewX=-g.skewX;c.x=1-c.x-c.width}
        else{g.skewY=-g.skewY;c.y=1-c.y-c.height}
      }else{
        const right=key==='turnRight';
        g.turns=(g.turns+(right?1:3))%4;
        [g.flipX,g.flipY]=[g.flipY,g.flipX];
        [g.skewX,g.skewY]=right?[-g.skewY,g.skewX]:[g.skewY,-g.skewX];
        [c.x,c.y]=right?[1-c.y-c.height,c.x]:[c.y,1-c.x-c.width];
        [c.width,c.height]=[c.height,c.width];
        if(ratio){ratio=1/ratio;if(aspect.includes(':'))aspect=aspect.split(':').reverse().join(':')}
      }
      value={...value,geometry:g};c.x=clamp(c.x,0,1-c.width);c.y=clamp(c.y,0,1-c.height);putCrop(c);
      geometryKey=null;sync();onInput(false);
    });
  }
  const geometryButtons=new Map();
  for(const [key,text,short]of geometryFields){
    const node=button('mg-geometry-setting',geometryTools,text,short);node.dataset.setting=key;geometryButtons.set(key,node);
    listen(node,'click',()=>{geometryKey=geometryKey===key?null:key;setCompare(false);sync();resize()});
  }
  const stop=event=>{event.stopPropagation();if(event.type==='click'&&active){const button=event.target.closest('button');if(button){button.focus({preventScroll:true});if(!root.contains(document.activeElement))buttons.get(active)?.focus({preventScroll:true})}}};
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','click','dblclick','contextmenu'])listen(root,name,stop);
  listen(root,'keydown',event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();traverse(!event.shiftKey)}else if(event.key==='Escape'){event.preventDefault();close(false)}else if(event.key==='Enter'&&event.target===range){event.preventDefault();close(true)}});
  function setting(){if(active==='crop')return geometryFields.find(item=>item[0]===geometryKey);if(active==='preset')return ['strength',value.preset||'Fotoprofilar','Styrke',0,1,.01];const key=selections[active];if(key==='hsl')return ['hsl.'+channel+'.'+component,channels.find(item=>item[0]===channel)[1]+' · '+components.find(item=>item[0]===component)[1],components.find(item=>item[0]===component)[2],-1,1,.01];return fields.find(item=>item[0]===key)}
  function setAmount(number){setCompare(false);const current=setting();if(!current)return;write(current[0],Number(clamp(Math.round(number/current[5])*current[5],current[3],current[4]).toFixed(4)));sync()}
  listen(range,'input',()=>{if(!active||!setting())return;setAmount(Number(range.value));onInput(true)});listen(range,'change',()=>onInput(false));
  listen(adjustArea,'pointerdown',event=>{if(event.button>0||adjusting||!setting()||range.disabled)return;event.preventDefault();adjusting={id:event.pointerId,x:event.clientX,value:read(setting()[0]),width:Math.max(180,host.clientWidth*.7)};adjustArea.setPointerCapture?.(event.pointerId);onInput(true)});
  listen(adjustArea,'pointermove',event=>{if(adjusting?.id!==event.pointerId)return;event.preventDefault();const current=setting();setAmount(adjusting.value+(event.clientX-adjusting.x)/adjusting.width*(current[4]-current[3]));onInput(true)});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(adjustArea,name,event=>{if(adjusting?.id!==event.pointerId)return;const id=adjusting.id;adjusting=null;if(adjustArea.hasPointerCapture?.(id))adjustArea.releasePointerCapture(id);onInput(false)});
  listen(cancel,'click',()=>close(false));listen(apply,'click',()=>close(true));
  listen(reset,'click',()=>{if(active==='crop'){if(geometryKey)write(geometryKey,0);else{value={...value,crop:{...defaults.crop},geometry:{...geometryDefault}};ratio=null;aspect='free'}resize()}else if(active==='preset')value={...value,preset:null,strength:1};else if(active)write(setting()[0],read(setting()[0],defaults));sync();onInput()});
  function sync(){
    for(const [key,node]of buttons){const group=groups.find(item=>item[0]===key);node.setAttribute('aria-pressed',String(active===key));node.classList.toggle('changed',key==='crop'?value.crop.width!==1||value.crop.height!==1||Object.keys(geometryDefault).some(k=>(value.geometry?.[k]??geometryDefault[k])!==geometryDefault[k]):key==='preset'?!!value.preset:group[2].some(field=>field==='hsl'?JSON.stringify(value.hsl)!==JSON.stringify(defaults.hsl):read(field)!==read(field,defaults)))}
    toggle.textContent=value.preset||'◫';toggle.setAttribute('aria-expanded',String(active==='preset'));toggle.classList.toggle('changed',!!value.preset);
    history.hidden=!active;undo.disabled=!undoStack.length&&!isDraft();redo.disabled=!redoStack.length||isDraft();
    presetTools.hidden=active!=='preset';geometryTools.hidden=active!=='crop';
    for(const [key,node]of geometryButtons)node.setAttribute('aria-pressed',String(geometryKey===key));
    for(const [id,tile]of tiles){
      tile.setAttribute('aria-pressed',String(value.preset===id));
      tile.hidden=!!id&&filter!=='all'&&!(filter==='favorites'?favorites:recent).includes(id);
      tile.style.setProperty('order',String(filter==='recent'&&id?recent.indexOf(id)+1:0));
    }
    filterSelect.value=filter;favorite.disabled=!value.preset;const marked=favorites.includes(value.preset);
    favorite.setAttribute('aria-pressed',String(marked));favorite.textContent=marked?'★ Favoritt':'☆ Favoritt';applyRecipe.disabled=!recipe;
    for(const [key,node]of aspects)node.setAttribute('aria-pressed',String(key===aspect));
    if(!active)return;
    const group=groups.find(item=>item[0]===active),hsl=active==='color'&&selections.color==='hsl';panel.dataset.tool=active;panel.setAttribute('aria-label',group[1]);strip.hidden=active!=='preset';cropOptions.hidden=active!=='crop';hslOptions.hidden=!hsl;optionList.hidden=!group[2].length||hsl;heading.hidden=range.hidden=active==='crop'&&!geometryKey;cropArea.hidden=active!=='crop'||!!geometryKey;adjustArea.hidden=active==='crop'&&!geometryKey||active==='preset'&&!value.preset;
    for(const [key,node]of options){node.hidden=!group[2].includes(key);node.setAttribute('aria-pressed',String(selections[active]===key))}for(const [key,node]of channelButtons)node.setAttribute('aria-pressed',String(channel===key));for(const [key,node]of componentButtons)node.setAttribute('aria-pressed',String(component===key));
    if(active==='crop'&&!geometryKey)return;
    const current=setting(),number=read(current[0]);label.textContent=current[2];range.min=String(current[3]);range.max=String(current[4]);range.step=String(current[5]);range.value=String(number);range.setAttribute('aria-label',current[1]);range.disabled=active==='preset'&&!value.preset;amount.textContent=current[0]==='geometry.straighten'?number.toFixed(2)+'°':current[0]==='exposure'?(number>0?'+':'')+number.toFixed(2)+' EV':(number>0&&current[3]<0?'+':'')+Math.round(number*100);range.setAttribute('aria-valuetext',amount.textContent);heading.classList.toggle('disabled',range.disabled);
  }
  function close(commit=true){if(!active)return;const changed=JSON.stringify(value)!==JSON.stringify(before),previous=active;if(commit&&changed){
    addUndo(before);
    if(value.preset&&value.preset!==before.preset){recent=[value.preset,...recent.filter(id=>id!==value.preset)].slice(0,PHOTO_PRESETS.length);save('recent',recent)}
  }
  setCompare(false);if(!commit){value=before;ratio=beforeRatio;aspect=beforeAspect}value=normalizePhotoEdits(value);active=null;geometryKey=null;before=null;drag=adjusting=null;panel.hidden=adjustArea.hidden=cropArea.hidden=true;host.classList.remove('mg-editing','mg-cropping');sync();onActive(false);onInput(false);if(commit&&changed)onChange();buttons.get(previous)?.focus({preventScroll:true})}
  function refreshSavedLooks(){
    if(Array.isArray(load('favorites')))favorites=presetList('favorites');
    if(Array.isArray(load('recent')))recent=presetList('recent');
    try{const saved=load('recipe');if(saved)recipe=normalizePhotoEdits(saved)}catch{}
  }
  function open(key){const group=groups.find(item=>item[0]===key)||groups.find(item=>item[2].includes(key));if(!group)return;if(key!==group[0])selections[group[0]]=key;if(active===group[0]){if(key===group[0])close(true);else sync();return}close(true);before=normalizePhotoEdits(value);beforeRatio=ratio;beforeAspect=aspect;active=group[0];geometryKey=null;if(active==='preset')refreshSavedLooks();notice.textContent='';panel.hidden=false;cropArea.hidden=active!=='crop';host.classList.add('mg-editing');host.classList.toggle('mg-cropping',active==='crop');onActive(true);sync();onInput(toolRail.active);resize();choices.scrollTop=0;buttons.get(active)?.focus({preventScroll:true})}
  function resize(){if(active!=='crop')return;const [w,h]=orientedSize(),bounds=host.getBoundingClientRect(),art=host.querySelector('.mg-art')?.getBoundingClientRect(),frame=art?.width>0&&art?.height>0?art:bounds,scale=Math.min(frame.width/w,frame.height/h),width=w*scale,height=h*scale;cropArea.style.left=(frame.left-bounds.left+(frame.width-width)/2)+'px';cropArea.style.top=(frame.top-bounds.top+(frame.height-height)/2)+'px';cropArea.style.width=width+'px';cropArea.style.height=height+'px';const crop=value.crop;cropFrame.style.left=crop.x*100+'%';cropFrame.style.top=crop.y*100+'%';cropFrame.style.width=crop.width*100+'%';cropFrame.style.height=crop.height*100+'%'}
  const putCrop=crop=>{crop.width=Math.min(crop.width,1-crop.x);crop.height=Math.min(crop.height,1-crop.y);value={...value,crop};resize()};
  function moveCrop(crop,corner,dx,dy){if(!corner){putCrop({...crop,x:clamp(crop.x+dx,0,1-crop.width),y:clamp(crop.y+dy,0,1-crop.height)});return}const west=corner.includes('w'),north=corner.includes('n'),anchorX=west?crop.x+crop.width:crop.x,anchorY=north?crop.y+crop.height:crop.y,maxWidth=west?anchorX:1-anchorX,maxHeight=north?anchorY:1-anchorY;let width=clamp(crop.width+(west?-dx:dx),Math.min(.05,maxWidth),maxWidth),height=clamp(crop.height+(north?-dy:dy),Math.min(.05,maxHeight),maxHeight);if(ratio){const [w,h]=orientedSize(),norm=ratio/(w/h);if(Math.abs(dy)>Math.abs(dx)/norm)width=height*norm;width=clamp(width,Math.min(.05,maxWidth,maxHeight*norm),Math.min(maxWidth,maxHeight*norm));height=width/norm}putCrop({x:west?anchorX-width:anchorX,y:north?anchorY-height:anchorY,width,height})}
  listen(cropFrame,'pointerdown',event=>{if(event.button>0||drag)return;event.preventDefault();const bounds=cropArea.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,bounds,crop:{...value.crop},corner:event.target.closest('.mg-crop-handle')?.dataset.corner};cropFrame.setPointerCapture?.(event.pointerId)});
  listen(cropFrame,'pointermove',event=>{if(drag?.id!==event.pointerId)return;event.preventDefault();moveCrop(drag.crop,drag.corner,(event.clientX-drag.x)/drag.bounds.width,(event.clientY-drag.y)/drag.bounds.height)});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(cropFrame,name,event=>{if(drag?.id===event.pointerId)drag=null});
  listen(cropFrame,'keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?.05:.01,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;moveCrop(value.crop,event.target.closest('.mg-crop-handle')?.dataset.corner,dx,dy)});
  if(globalThis.addEventListener)listen(globalThis,'resize',resize);const observer=globalThis.ResizeObserver?new ResizeObserver(resize):null;observer?.observe(host);sync();
  return {get edits(){return normalizePhotoEdits(value)},get committed(){return normalizePhotoEdits(before||value)},get cropping(){return active==='crop'},get active(){return active},undo(){traverse(true)},redo(){traverse(false)},open,commit(){close(true)},cancel(){close(false)},resize,set(edits={},width=sourceWidth,height=sourceHeight){toolRail.cancel();undoStack.length=redoStack.length=0;geometryKey=null;setCompare(false);value=normalizePhotoEdits(edits);sourceWidth=width;sourceHeight=height;active=null;before=null;drag=adjusting=null;ratio=null;aspect='free';panel.hidden=adjustArea.hidden=cropArea.hidden=true;host.classList.remove('mg-editing','mg-cropping');sync()},dispose(){if(disposed)return;disposed=true;toolRail.dispose();observer?.disconnect();for(const remove of listeners)remove();root.remove()}};
}
