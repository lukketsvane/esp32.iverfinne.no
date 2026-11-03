import {METHODS, PALETTES, PRESETS, DEFAULT_GRADE, DEFAULT_DITHER, paletteColors, processPixels} from './dither-core.mjs';
import {encodeGIF} from './gif-codec.mjs';
import {extractPalette} from './palette-extract.mjs';
const $ = name => document.getElementById(name);
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
const fmt = v => String(v).padStart(2,'0');
const RESOLUTIONS = [{value:6,label:'QVGA · 320 × 240'},{value:10,label:'VGA · 640 × 480'},{value:15,label:'UXGA · 1600 × 1200'}];
const MODES={alternate:'Veksle',pingpong:'Ping-pong',crossfade:'Kryssfade',overlay:'Overlegg',wiggle:'Wiggle',still:'Still',anaglyph:'Raud/cyan',difference:'Skilnad',sidebyside:'Side ved side',split:'Delt vising',checker:'Sjakkbrett'};
const GRADES=[['exposure','Eksponering',-2,2,.05],['contrast','Kontrast',-100,100,1],['saturation','Metning',-100,100,1],['temperature','Varme',-100,100,1],['tint','Toning',-100,100,1],['shadows','Skuggar',-100,100,1],['highlights','Høglys',-100,100,1],['fade','Fade',0,100,1],['grain','Filmkorn',0,100,1],['vignette','Vignett',0,100,1],['sharpen','Skarpleik',0,100,1]];
const DITHERS=[['strength','Rasterblanding',0,100,1,'%'],['pixel','Pikselstorleik',1,12,1,'px'],['threshold','Terskel',-100,100,1,''],['diffusion','Feilspreiing',0,160,5,'%'],['seed','Støy-frø',1,99,1,'']];
const PALETTE_LABELS={mono:'Monokrom / mjuk',ink:'Svart/kvitt',gray4:'Grå / 4 fargar',gray8:'Grå / 8 fargar',gameboy:'Game Boy',lcd:'LCD-skjerm',sepia:'Sepia',blueprint:'Blueprint',cobalt:'Kobolt',amber:'Amber',cga:'CGA',thermal:'Thermal',pico8:'PICO-8',rgb8:'RGB / 8 fargar',rgb27:'RGB / 27 fargar',rgb64:'RGB / 64 fargar',custom:'Eigen palett'};
const getStore=(key,fallback)=>{try{const s=localStorage.getItem('entropi-v2-'+key);return s?JSON.parse(s):fallback}catch{return fallback}};
const S={cams:[{online:null,error:'',framesize:6,photo_framesize:15,psram:null,storage:'ukjent',busy:false,diagnostics:'Ikkje testa'},{online:null,error:'0x106 (tidlegare rapportert, ikkje verifisert no)',framesize:6,photo_framesize:15,psram:null,storage:'ukjent',busy:false,diagnostics:'Ikkje testa'}],api:getStore('api',['http://192.168.4.1','']),adapter:getStore('adapter','firmware'),imgs:[null,null],imageUrls:[null,null],names:['',''],mode:getStore('mode','alternate'),swap:false,depth:0,speed:500,blend:50,compare:100,playing:false,epoch:0,grade:{...DEFAULT_GRADE,...getStore('grade',{})},dither:{...DEFAULT_DITHER,...getStore('dither',{})},entries:[],galleryLoaded:0,mediaURLs:new Set(),exporting:false};
let worker,renderTimer=0,liveTimer=0,renderBusy=false,needsRender=false,frameId=0,pendingGif=new Map(),lastProcessed=false,dbP=null,dbUnusable=false;
const W=960,H=540;
const beforeCtx=$('before').getContext('2d',{willReadFrequently:true}),viewCtx=$('canvas').getContext('2d');
const source=document.createElement('canvas');source.width=W;source.height=H;
const sourceCtx=source.getContext('2d',{willReadFrequently:true});
const say=(v,busy=false)=>{$('render-status').textContent=v;$('render-status').classList.toggle('busy',busy)};
function log(message){const now=new Date().toLocaleTimeString('nn-NO',{hour12:false});$('log').textContent=`[${now}] ${message}\n`+$('log').textContent.slice(0,9000)}
function persist(){try{for(const k of ['api','adapter','mode','grade','dither'])localStorage.setItem('entropi-v2-'+k,JSON.stringify(S[k]))}catch{}}
function warnAPI(){const https=location.protocol==='https:'&&S.api.some(v=>v.startsWith('http:'));
 const populated=S.api.map(x=>String(x||'').trim()).filter(Boolean);const same=populated.length===2&&populated[0].replace(/\/$/,'')===populated[1].replace(/\/$/,'');
 const message=https?'HTTPS kan blokkere HTTP mot ESP32 (mixed content og CORS). Bruk «OPNE UI» medan du er på kameraet sitt Wi-Fi, eller ein autorisert bridge med same opphav. ':'Firmware: GET /status, GET /control?var=photo_framesize&val=6|10|15 og GET /capture (JPEG). ';
 $('api-hint').textContent=message+(same?'Begge kort har same adresse. To separate ENTROPI-aksesspunkt på 192.168.4.1 kan ikkje styrast samtidig. Kople dei til kvar si eintydige adresse eller ta bileta etter tur. ':'')+'Kamera 2 må ha ei faktisk, tilgjengeleg adresse. Ein sensorfeil er ikkje det same som ein nettverksfeil.';}
function cards(){const container=$('cams');container.replaceChildren();S.cams.forEach((cam,i)=>{
 const el=document.createElement('article');el.className='camera-card';
 const head=document.createElement('div');head.className='camera-head';const title=document.createElement('strong');title.textContent=`CAM / 0${i+1}`;const status=document.createElement('span');status.className='status-dot'+(cam.online===true?' live':cam.online===false?' error':'');status.textContent=cam.busy?'TESTAR ...':cam.online===null?(cam.networkFailed?'INGEN KONTAKT':'IKKJE VERIFISERT'):cam.online?'SENSOR KLAR':'SENSORFEIL';head.append(title,status);
 const meta=document.createElement('div');meta.className='camera-metadata';
 const facts=[['SENSOR',cam.error||'Ingen registrert'],['FOTO',String(RESOLUTIONS.find(x=>x.value===cam.photo_framesize)?.label||cam.photo_framesize)],['PSRAM',cam.psram===null?'Ukjent':cam.psram?'JA':'NEI'],['SD',cam.storage],['SISTE BILETE',S.imgs[i]?'LOKALT LASTA':'INGEN'],['OPPLØYSINGSTEST',cam.diagnostics],['API',S.api[i]||'IKKJE SETT']];
 for(const [k,v]of facts){let d=document.createElement('div');d.className='datum';const key=document.createElement('small');key.textContent=k;const value=document.createElement('span');value.textContent=v;d.append(key,value);meta.append(d)}
 const actions=document.createElement('div');actions.className='camera-actions';const sel=document.createElement('select');sel.setAttribute('aria-label',`Oppløysing kamera ${i+1}`);for(const r of RESOLUTIONS){if(S.adapter==='firmware'&&cam.psram===false&&r.value!==6)continue;const o=document.createElement('option');o.value=String(r.value);o.textContent=r.label;sel.append(o)}sel.value=String(cam.photo_framesize);sel.disabled=!!cam.busy;sel.onchange=()=>setResolution(i,Number(sel.value));
 const shot=document.createElement('button');shot.className='button mini strong';shot.textContent='TA BILETE';shot.disabled=!!cam.busy;shot.onclick=()=>shoot(i);
 const test=document.createElement('button');test.className='button mini';test.textContent='STATUS ↻';test.disabled=!!cam.busy;test.onclick=()=>statusCamera(i);const sweep=document.createElement('button');sweep.className='button mini';sweep.textContent='TEST 320 → 1600';sweep.disabled=!!cam.busy||S.adapter!=='firmware';sweep.title='Test kvar støtta oppløysing, mål JPEG og still tilbake originalinnstillinga';sweep.onclick=()=>runResolutionDiagnostic(i);
 const open=document.createElement('a');open.className='button mini';open.textContent='OPNE UI ↗';let base=S.api[i]?.trim();try{let url=new URL(base,location.href);if(!['http:','https:'].includes(url.protocol))throw Error();open.href=url.href;open.target='_blank';open.rel='noopener noreferrer'}catch{open.href='#diagnostics';open.title='Legg inn gyldig kameraadresse fyrst'}
 actions.append(sel,shot,test,sweep,open);el.append(head,meta,actions);container.append(el);
 });let n=S.cams.filter(c=>c.online).length;$('connection').textContent=`${n} AV 2 SENSORAR`; $('connection').classList.toggle('live',n>0);}
async function fetchWithTimeout(url,options={}){const c=new AbortController(),timer=setTimeout(()=>c.abort(),7000);try{return await fetch(url,{...options,signal:c.signal,cache:'no-store'})}finally{clearTimeout(timer)}}
const cameraURL=(i,path)=>{const base=S.api[i]?.trim();if(!base)throw Error('Kameraadresse manglar');let url=new URL(base,location.href);if(!/^https?:$/.test(url.protocol))throw Error('Berre HTTP og HTTPS er støtta');if(location.protocol==='https:'&&url.protocol==='http:')throw Error('HTTPS blokkerer dette HTTP-kameraet. Opne lokal kamera-UI eller bruk ein same-origin bridge.');return new URL(path,url.href.replace(/\/?$/,'/')).toString()};
async function statusCamera(i){const c=S.cams[i];c.busy=true;c.networkFailed=false;cards();try{const r=await fetchWithTimeout(cameraURL(i,'status'));if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();
 if(S.adapter==='firmware'){if(typeof j.camera_ready!=='boolean')throw Error('Ukjent firmware-status');c.online=j.camera_ready===true;c.error=String(j.last_error||'');c.framesize=Number(j.framesize||6);c.photo_framesize=Number(j.photo_framesize||6);c.psram=typeof j.psram==='boolean'?j.psram:null;c.storage=String(j.storage?.state||'ukjent');if(j.recovering)c.error='Sensoren prøver å starte att: '+(j.last_error||'');}
 else{c.online=j.online!==false;c.error=String(j.error||'');c.photo_framesize=typeof j.resolution==='string'?({QVGA:6,VGA:10,UXGA:15}[j.resolution]||6):Number(j.photo_framesize??j.resolution??6);c.psram=null;c.storage='Ukjent';if(j.lastImage&&typeof j.lastImage==='string'){const remote=new URL(j.lastImage,cameraURL(i,'status')).href;await loadRemote(i,remote)}}
 log(`Kamera ${i+1} svarar; sensor ${c.online?'klar':'ikkje klar'}; ${c.error||'ingen sensorfeil'}`);
 }catch(e){c.online=null;c.networkFailed=true;c.error='Tilkoplingsfeil: '+e.message;log(`Kamera ${i+1} nettverk: ${e.message}. Ingen sensordiagnose kan stadfestast.`)}finally{c.busy=false;cards()}}
async function setResolution(i,v){const c=S.cams[i],old=c.photo_framesize;c.busy=true;cards();try{if(S.adapter==='firmware'){
 const url=cameraURL(i,`control?var=photo_framesize&val=${v}`);const r=await fetchWithTimeout(url);if(!r.ok)throw Error('HTTP '+r.status+'; sensoren må vere initialisert');
 }else{const url=cameraURL(i,'resolution');const r=await fetchWithTimeout(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resolution:({6:'QVGA',10:'VGA',15:'UXGA'})[v]||'QVGA'})});if(!r.ok)throw Error('HTTP '+r.status)}
 c.photo_framesize=v;log(`Kamera ${i+1} oppløysing endra til ${RESOLUTIONS.find(r=>r.value===v)?.label}`);
 }catch(e){c.photo_framesize=old;log(`Oppløysing kamera ${i+1}: ${e.message}`)}finally{c.busy=false;cards()}}
async function imageDimensions(blob){
 const url=URL.createObjectURL(blob),img=new Image();
 try{return await new Promise((resolve,reject)=>{img.onload=()=>resolve([img.naturalWidth,img.naturalHeight]);img.onerror=()=>reject(Error('JPEG kunne ikkje dekodast'));img.src=url})}
 finally{URL.revokeObjectURL(url)}
}
async function runResolutionDiagnostic(i){
 const c=S.cams[i];if(c.busy||S.adapter!=='firmware')return;
 c.busy=true;c.diagnostics='Testar ...';cards();let original=c.photo_framesize;
 let lastConfirmed=original,restored=false,sensorReady=false;const measurements=[];
 try{
  const status=await fetchWithTimeout(cameraURL(i,'status'));
  if(!status.ok)throw Error('Status HTTP '+status.status);
  const state=await status.json();
  if(typeof state.camera_ready!=='boolean')throw Error('Ugyldig statusformat');
  c.online=state.camera_ready;c.networkFailed=false;c.error=String(state.last_error||'');c.psram=!!state.psram;
  c.photo_framesize=Number(state.photo_framesize??original);original=c.photo_framesize;lastConfirmed=original;
  if(!state.camera_ready){c.diagnostics='Sensor starta ikkje';log(`Kamera ${i+1}: avbryt oppløysingstest. Sensoren er ikkje initialisert (${c.error||'ukjend feil'}). 0x106 kan ikkje løysast av fotostorleik åleine.`);return}
  sensorReady=true;
  const sizes=state.psram?[6,10,15]:[6];
  for(const size of sizes){const resolution=RESOLUTIONS.find(x=>x.value===size);const expected=({6:[320,240],10:[640,480],15:[1600,1200]})[size];
   const started=performance.now();try{
    let r=await fetchWithTimeout(cameraURL(i,`control?var=photo_framesize&val=${size}`));if(!r.ok)throw Error('Control HTTP '+r.status);
    lastConfirmed=size;c.photo_framesize=size;
    r=await fetchWithTimeout(cameraURL(i,'capture'));if(!r.ok)throw Error('Capture HTTP '+r.status);
    const blob=await r.blob();if(!blob.size)throw Error('Tom JPEG');
    const dimensions=await imageDimensions(blob);if(dimensions[0]!==expected[0]||dimensions[1]!==expected[1])throw Error(`Feil biletdimensjon ${dimensions.join('×')}`);
    const ms=Math.round(performance.now()-started);measurements.push(`${resolution.label.split(' · ')[0]} ${ms} ms`);
    log(`Kamera ${i+1}: ${resolution.label}, ${ms} ms, ${Math.round(blob.size/1024)} kB, JPEG verifisert`);
   }catch(e){measurements.push(`${resolution.label.split(' · ')[0]} FEIL`);log(`Kamera ${i+1}: ${resolution.label} feila: ${e.message}`)}
  }
  c.diagnostics=measurements.join(' / ');
 }catch(e){c.networkFailed=true;c.online=null;c.error='Tilkoplingsfeil: '+e.message;c.diagnostics='Avbroten';log(`Kamera ${i+1}: test avbroten (${e.message})`)}
 finally{
  if(sensorReady){try{if(lastConfirmed!==original){const r=await fetchWithTimeout(cameraURL(i,`control?var=photo_framesize&val=${original}`));if(!r.ok)throw Error('HTTP '+r.status)}restored=true;c.photo_framesize=original}catch(e){c.photo_framesize=lastConfirmed;log(`Kamera ${i+1}: kunne ikkje stille tilbake originaloppløysinga (${e.message}). Siste stadfesta verdi: ${lastConfirmed}.`)}}
  if(restored)log(`Kamera ${i+1}: fotostorleik gjenoppretta til ${original}`);
  c.busy=false;cards();
 }
}
async function loadRemote(i,url){const r=await fetchWithTimeout(url);if(!r.ok)throw Error('HTTP '+r.status);let blob=await r.blob();if(!blob.type.startsWith('image/'))throw Error('Svaret er ikkje eit bilete');await loadBlob(i,blob,'Kamera '+(i+1))}
async function shoot(i){let c=S.cams[i];if(c.busy)return;c.busy=true;cards();try{let url=cameraURL(i,'capture'),response=await fetchWithTimeout(url,S.adapter==='firmware'?{}:{method:'POST'});if(!response.ok)throw Error('HTTP '+response.status);let blob;
 if(S.adapter==='firmware'){blob=await response.blob();if(blob.type&&!blob.type.includes('image')&&blob.type!=='application/octet-stream')throw Error('Firmware returnerte ikkje JPEG')}
 else{let j=await response.json();if(!j.imageUrl&&!j.url)throw Error('JSON manglar imageUrl');let imgurl=new URL(j.imageUrl||j.url,url).href;const imageResponse=await fetchWithTimeout(imgurl);if(!imageResponse.ok)throw Error('Biletet kan ikkje hentast');blob=await imageResponse.blob()}
 await loadBlob(i,blob,`ESP32 ${i+1}`);await saveGallery(blob,`ESP32 / 0${i+1}`,i);log(`Kamera ${i+1}: nytt foto mottatt (${Math.round(blob.size/1024)} kB)`);
 }catch(e){log(`Opptak kamera ${i+1}: ${e.message}`)}finally{c.busy=false;cards()}}
async function both(){await Promise.allSettled([shoot(0),shoot(1)])}
async function loadBlob(i,blob,name='Lokalt bilete'){
 if(!blob||!blob.size)throw Error('Tom biletefil');const objectURL=URL.createObjectURL(blob),img=new Image();
 try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Fila kunne ikkje dekodast'));img.src=objectURL});if(img.naturalWidth<1||img.naturalHeight<1)throw Error('Ugyldig biletdimensjon');}
 catch(e){URL.revokeObjectURL(objectURL);throw e}
 const old=S.imageUrls[i];S.imgs[i]=img;S.imageUrls[i]=objectURL;S.names[i]=name;
 $('im'+i).src=objectURL;$('imempty'+i).hidden=true;$('source-label-'+i).textContent=`${img.naturalWidth}×${img.naturalHeight}`;
 if(old)URL.revokeObjectURL(old);$('source-status').textContent=`${S.imgs.filter(Boolean).length} av 2 bilete`;cards();scheduleRender();
}
function paint(ctx,img,width,height,alpha=1,dx=0,rect){if(!img)return;const r=rect||{x:0,y:0,w:width,h:height};const scale=Math.min(r.w/img.naturalWidth,r.h/img.naturalHeight);const iw=img.naturalWidth*scale,ih=img.naturalHeight*scale;ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(img,r.x+(r.w-iw)/2+dx,r.y+(r.h-ih)/2,iw,ih);ctx.restore()}
function compose(ctx,width,height,elapsed=0){ctx.clearRect(0,0,width,height);ctx.fillStyle='#202728';ctx.fillRect(0,0,width,height);const left=S.imgs[S.swap?1:0],right=S.imgs[S.swap?0:1],a=left||right,b=right||left;if(!a)return;
 const speed=Math.max(100,S.speed),u=elapsed/speed,p=Math.floor(u)%2,v=(1-Math.cos(Math.PI*(u%2)))/2,dx=S.depth*width/W;
 const drawA=(alpha=1,offset=dx/2,rect)=>paint(ctx,a,width,height,alpha,offset,rect),drawB=(alpha=1,offset=-dx/2,rect)=>paint(ctx,b,width,height,alpha,offset,rect);
 switch(S.mode){
  case 'alternate':drawA(p===0?1:0);if(p)drawB();break;
  case 'pingpong':{const phase=[0,1,1,0][Math.floor(u)%4];phase?drawB():drawA();break}
  case 'crossfade':drawA();drawB(v);break;
  case 'overlay':drawA();drawB(S.blend/100);break;
  case 'wiggle':{Math.floor(u*2)%2?drawB():drawA();break}
  case 'anaglyph':{const layer=document.createElement('canvas');layer.width=width;layer.height=height;const tmp=layer.getContext('2d');paint(tmp,a,width,height,1,dx/2);const l=tmp.getImageData(0,0,width,height);tmp.clearRect(0,0,width,height);paint(tmp,b,width,height,1,-dx/2);const r=tmp.getImageData(0,0,width,height);const out=l.data;for(let i=0;i<out.length;i+=4){out[i]=out[i];out[i+1]=r.data[i+1];out[i+2]=r.data[i+2];out[i+3]=255}ctx.putImageData(l,0,0);break}
  case 'difference':drawA();ctx.save();ctx.globalCompositeOperation='difference';drawB();ctx.restore();break;
  case 'sidebyside':drawA(1,0,{x:0,y:0,w:width/2,h:height});drawB(1,0,{x:width/2,y:0,w:width/2,h:height});break;
  case 'split':drawA();ctx.save();ctx.beginPath();ctx.rect(width/2,0,width/2,height);ctx.clip();drawB();ctx.restore();break;
  case 'checker':{const cell=width/10;drawA();ctx.save();for(let y=0;y<height;y+=cell)for(let x=0;x<width;x+=cell)if((Math.floor(x/cell)+Math.floor(y/cell))%2){ctx.save();ctx.beginPath();ctx.rect(x,y,cell,cell);ctx.clip();drawB();ctx.restore()}ctx.restore();break}
  default:drawA();break;
 }
}
function workerReady(){try{worker=new Worker(new URL('./dither.worker.mjs',import.meta.url),{type:'module'});worker.onmessage=onWorkerMessage;worker.onerror=error=>{log('Rasterarbeidar feila: '+(error.message||'ukjend feil'));worker.terminate();worker=null;for(const item of pendingGif.values())item.reject(Error('Rasterarbeidaren stoppa'));pendingGif.clear();renderBusy=false;scheduleRender()};}catch(e){worker=null;log('Rasterarbeidar utilgjengeleg, bruker reservevising: '+e.message)}}
function onWorkerMessage({data}){if(data.type==='progress'){say(`GIF ${data.value}%`,true);return}
 if(data.type==='gif'||(data.type==='error'&&pendingGif.has(data.id))){const item=pendingGif.get(data.id);pendingGif.delete(data.id);if(data.type==='error')item.reject(Error(data.message));else item.resolve(new Blob([data.buffer],{type:'image/gif'}));return}
 renderBusy=false;
 if(data.type==='frame'){if(!S.exporting){try{const pixels=new Uint8ClampedArray(data.buffer),image=new ImageData(pixels,data.width,data.height);viewCtx.putImageData(image,0,0);lastProcessed=true;say(`${S.dither.method.toUpperCase()} · ${S.dither.palette.toUpperCase()}`)}catch(e){log('Vising: '+e.message)}}}
 else if(data.type==='error'){say('Rasterfeil');log(data.message)}
 if(needsRender){needsRender=false;queueRender()}
}
function queueRender(){if(!S.imgs.some(Boolean)){viewCtx.clearRect(0,0,W,H);beforeCtx.clearRect(0,0,W,H);$('stage-placeholder').hidden=false;return}
 $('stage-placeholder').hidden=true;
 if(renderBusy||S.exporting){needsRender=true;return}
 const elapsed=S.playing?performance.now()-S.epoch:0;compose(sourceCtx,W,H,elapsed);beforeCtx.clearRect(0,0,W,H);beforeCtx.drawImage(source,0,0);let input;
 try{input=sourceCtx.getImageData(0,0,W,H)}catch(e){log('Kan ikkje lese bildepunkt. Sjekk CORS: '+e.message);return}
 renderBusy=true;say('BEARBEIDER ...',true);
 if(worker){const id=++frameId;worker.postMessage({type:'frame',id,width:W,height:H,frame:input.data.buffer,settings:{grade:S.grade,dither:S.dither}},[input.data.buffer]);}
 else{setTimeout(()=>{try{const out=processPixels(input.data,W,H,{grade:S.grade,dither:S.dither});onWorkerMessage({data:{type:'frame',width:W,height:H,buffer:out.buffer}})}catch(e){onWorkerMessage({data:{type:'error',message:e.message}})}},0)}
}
function scheduleRender(){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{renderTimer=0;queueRender()},50)}
async function awaitLatestFrame(timeout=6500){const start=performance.now();while((renderBusy||needsRender||renderTimer)&&performance.now()-start<timeout)await new Promise(resolve=>setTimeout(resolve,40));if(renderBusy||needsRender||renderTimer)throw Error('Rasterkøyringa er ikkje ferdig enno')}
function updateCompare(){$('canvas').style.clipPath=`inset(0 0 0 ${100-S.compare}%)`;$('compare-value').textContent=S.compare+' %'}
function setPlaying(on){S.playing=on;clearInterval(liveTimer);if(on){S.epoch=performance.now();liveTimer=setInterval(()=>{if(!S.exporting)scheduleRender()},120)}$('play').textContent=on?'PAUSE ❚❚':'SPEL ▶';scheduleRender()}
function renderModes(){$('modes').replaceChildren();for(const [key,title]of Object.entries(MODES)){let b=document.createElement('button');b.className='button'+(key===S.mode?' active':'');b.setAttribute('aria-pressed',String(key===S.mode));b.textContent=title;b.onclick=()=>{S.mode=key;persist();renderModes();$('stage-mode').textContent=key.toUpperCase();scheduleRender()};$('modes').append(b)}$('stage-mode').textContent=S.mode.toUpperCase()}
function slider(container,fields,target){container.replaceChildren();for(const [key,title,min,max,step,unit='']of fields){let label=document.createElement('label');const text=document.createElement('span');text.textContent=title;const output=document.createElement('output');output.textContent=target[key]+unit;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=target[key];input.setAttribute('aria-label',title);input.oninput=()=>{target[key]=Number(input.value);output.textContent=input.value+unit;persist();scheduleRender()};label.append(text,output,input);container.append(label)}}
function renderPresets(){const host=$('presets');host.replaceChildren();for(const [name,preset]of Object.entries(PRESETS)){const b=document.createElement('button');b.className='preset';const swatches=document.createElement('span');swatches.className='swatches';for(const c of PALETTES[preset.palette]||PALETTES.mono){const i=document.createElement('i');i.style.background=c;swatches.append(i)}const title=document.createElement('span');title.textContent=name;b.append(swatches,title);b.onclick=()=>{Object.assign(S.dither,DEFAULT_DITHER,preset,{enabled:true});S.grade.grain=preset.grain||0;syncControls();log('Brukar uttrykket '+name)};host.append(b)}}
function syncControls(){renderModes();$('method').value=S.dither.method;$('palette').value=S.dither.palette;$('custom').value=S.dither.custom;$('custom-field').hidden=S.dither.palette!=='custom';$('dither-enabled').checked=S.dither.enabled;$('serpentine').checked=S.dither.serpentine;$('invert').checked=S.dither.invert;slider($('dither-sliders'),DITHERS,S.dither);slider($('grade-sliders'),GRADES,S.grade);persist();scheduleRender()}
async function saveFile(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000)}
async function canvasBlob(canvas,type='image/png',quality=.93){return await new Promise((ok,no)=>canvas.toBlob(b=>b?ok(b):no(Error('Kan ikkje eksportere canvas')),type,quality))}
async function exportImage(type){if(!S.imgs.some(Boolean)||S.exporting){log('Last inn eit bilete før eksport, eller fullfør den førre eksporten');return}
 const wasPlaying=S.playing;clearInterval(liveTimer);S.playing=false;S.exportingImage=true;
 try{scheduleRender();await awaitLatestFrame();const blob=await canvasBlob($('canvas'),type);await saveFile(blob,`entropi-${S.dither.method}-${Date.now()}.${type==='image/png'?'png':'webp'}`);log(type+' eksportert')}
 catch(e){log('Eksport: '+e.message)}finally{S.exportingImage=false;if(wasPlaying)setPlaying(true)}
}
async function exportGIF(){if(S.exporting||S.exportingImage||!S.imgs.some(Boolean)){log('GIF krev minst eitt bilete');return}S.exporting=true;$('gif').disabled=true;const wasPlaying=S.playing;setPlaying(false);say('LAGAR GIF ...',true);
 try{const count=Number($('gif-frames').value),w=Number($('gif-size').value),h=Math.round(w*9/16),duration=S.mode==='pingpong'?S.speed*4:S.mode==='wiggle'?S.speed:S.speed*2,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});const frames=[];
  for(let i=0;i<count;i++){compose(ctx,w,h,i*duration/count);const data=ctx.getImageData(0,0,w,h);frames.push(data.data.buffer)}
  const opts={grade:S.grade,dither:S.dither},id=++frameId;let blob;const gifPalette=S.dither.enabled&&S.dither.method!=='none'&&S.dither.strength>0?S.dither.palette:'rgb64';
  if(worker){blob=await new Promise((resolve,reject)=>{pendingGif.set(id,{resolve,reject});worker.postMessage({type:'gif',id,width:w,height:h,frames,settings:opts,palette:gifPalette,custom:S.dither.custom,delay:Math.max(3,Math.round(duration/count/10))},frames)})}
  else{const processed=frames.map(f=>processPixels(new Uint8ClampedArray(f),w,h,opts));blob=new Blob([encodeGIF(processed,w,h,gifPalette,S.dither.custom,Math.max(3,Math.round(duration/count/10)))],{type:'image/gif'})}
  await saveFile(blob,`entropi-${S.mode}-${S.dither.method}.gif`);log(`GIF laga: ${count} rammer, ${w}×${h}, ${Math.round(blob.size/1024)} kB`);
 }catch(e){log('GIF-feil: '+e.message)}finally{S.exporting=false;$('gif').disabled=false;if(wasPlaying)setPlaying(true);else scheduleRender()}}
function openDB(){if(dbUnusable||!('indexedDB'in window))return Promise.resolve(null);if(dbP)return dbP;dbP=new Promise(resolve=>{const req=indexedDB.open('entropi-gallery-v2',1);req.onupgradeneeded=()=>req.result.createObjectStore('photos',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=req.onblocked=()=>{dbUnusable=true;resolve(null)}});return dbP}
function txStore(db,mode,callback){return new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode);let out;const req=callback(tx.objectStore('photos'));req.onsuccess=()=>out=req.result;tx.oncomplete=()=>resolve(out);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Lagring feila'))})}
async function photoThumb(blob){
 let bitmap=null,objectURL=null,img;
 try{
  if(typeof createImageBitmap==='function')try{bitmap=await createImageBitmap(blob)}catch{}
  if(bitmap)img=bitmap;
  else{objectURL=URL.createObjectURL(blob);img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Miniatyrbiletet kunne ikkje lesast'));img.src=objectURL})}
  const iw=img.width||img.naturalWidth,ih=img.height||img.naturalHeight;
  if(!iw||!ih)throw Error('Ugyldig biletdimensjon');
  const c=document.createElement('canvas');c.width=c.height=320;const ctx=c.getContext('2d');const s=Math.max(320/iw,320/ih),w=iw*s,h=ih*s;
  ctx.drawImage(img,(320-w)/2,(320-h)/2,w,h);return await canvasBlob(c,'image/jpeg',.75)
 }finally{bitmap?.close?.();if(objectURL)URL.revokeObjectURL(objectURL)}
}
async function saveGallery(blob,label,camera=0){try{const thumb=await photoThumb(blob),record={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,blob,thumb,label,camera,created:Date.now()},db=await openDB();if(db)await txStore(db,'readwrite',store=>store.put(record));else {S.fallback=S.fallback||[];S.fallback.push(record)}S.entries.unshift(record.id);S.galleryLoaded++;addGalleryTiles([record],true);$('count').textContent=S.entries.length+' bilete';$('gallery-empty').hidden=true;log('Lagra bilete lokalt');}catch(e){log('Galleri kunne ikkje lagrast: '+e.message)}}
function addGalleryTiles(records,prepend=false){const fragment=document.createDocumentFragment();for(const r of records){const t=document.createElement('button');t.className='tile';t.title='Opne '+r.label;t.setAttribute('aria-label','Opne '+r.label);const img=document.createElement('img');const url=URL.createObjectURL(r.thumb);S.mediaURLs.add(url);img.loading='lazy';img.src=url;img.alt=r.label;const text=document.createElement('span');text.textContent=r.label;t.append(img,text);t.onclick=()=>loadGalleryEntry(r.id);fragment.append(t)}const host=$('gallery');if(prepend)host.prepend(fragment);else host.append(fragment)}
async function getRecord(id){const db=await openDB();return db?txStore(db,'readonly',store=>store.get(id)):(S.fallback||[]).find(x=>x.id===id)}
async function loadGalleryEntry(id){const record=await getRecord(id);if(!record)return;const target=Number($('gallery-target').value)||0;await loadBlob(target,record.blob,record.label)}
async function showMore(){const part=S.entries.slice(S.galleryLoaded,S.galleryLoaded+36),records=(await Promise.all(part.map(getRecord))).filter(Boolean);addGalleryTiles(records);S.galleryLoaded+=part.length;$('more').hidden=S.galleryLoaded>=S.entries.length}
async function refreshGallery(){const db=await openDB();if(db){try{S.entries=(await txStore(db,'readonly',store=>store.getAllKeys())).reverse()}catch{S.entries=[]}}else S.entries=(S.fallback||[]).map(x=>x.id).reverse();$('count').textContent=S.entries.length+' bilete';$('gallery-empty').hidden=!!S.entries.length;S.galleryLoaded=0;await showMore()}
function binds(){for(let i=0;i<2;i++){$('api'+i).value=S.api[i]||'';$('upload'+i).onchange=async e=>{const f=e.target.files[0];if(f){await loadBlob(i,f,f.name);await saveGallery(f,f.name,i)}e.target.value=''}};
 $('adapter').value=S.adapter;
 $('refresh').onclick=()=>Promise.allSettled([statusCamera(0),statusCamera(1)]);$('both').onclick=both;
 document.querySelectorAll('[data-shoot]').forEach(b=>b.onclick=()=>shoot(Number(b.dataset.shoot)));
 $('swap').onclick=()=>{S.swap=!S.swap;scheduleRender()};
 $('upload-many').onchange=async e=>{const files=[...e.target.files];let i=0;for(const f of files){if(!f.type.startsWith('image/'))continue;if(i<2)await loadBlob(i,f,f.name);await saveGallery(f,f.name,i%2);i++}e.target.value=''};
 $('demo').onclick=async()=>{const response=await fetch('./demo.jpg');if(!response.ok)throw Error('Demo ikkje tilgjengeleg');const blob=await response.blob();await loadBlob(0,blob,'Demo / venstre');await loadBlob(1,blob,'Demo / høgre');log('Demo lasta. Desse bileta kjem ikkje frå ESP32.')} ;
 [['depth','depth-value','px',-180,180],['speed','speed-value','ms',120,2000],['blend','blend-value','%',0,100],['compare','compare-value','%',0,100]].forEach(([k,out,unit,min,max])=>{$(k).oninput=e=>{S[k]=clamp(Number(e.target.value),min,max);$(out).textContent=S[k]+' '+unit;if(k==='compare')updateCompare();else if(k==='speed'&&S.playing){S.epoch=performance.now();scheduleRender()}else scheduleRender()}});
 $('play').onclick=()=>setPlaying(!S.playing);
 let pointer=null;$('stage').addEventListener('pointerdown',e=>{if(pointer||(e.button!==0&&e.pointerType==='mouse'))return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,original:S.depth,drag:false}});
 $('stage').addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId)return;
  const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
  if(!pointer.drag){if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)*1.15){pointer=null;return}if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy)*1.25)return;pointer.drag=true;$('stage').setPointerCapture?.(e.pointerId)}
  const width=$('stage').clientWidth||1;S.depth=clamp(Math.round(pointer.original+dx*W/width),-180,180);$('depth').value=S.depth;$('depth-value').textContent=S.depth+' px';scheduleRender()});
 ['pointerup','pointercancel','lostpointercapture'].forEach(evt=>$('stage').addEventListener(evt,e=>{if(pointer?.id===e.pointerId)pointer=null}));
 const original=$('original');let held=false,prior=100;const setBefore=on=>{if(on&&!held){held=true;prior=S.compare;S.compare=0}else if(!on&&held){held=false;S.compare=prior}original.setAttribute('aria-pressed',String(on));updateCompare()};original.addEventListener('pointerdown',()=>setBefore(true));['pointerup','pointerleave','pointercancel'].forEach(e=>original.addEventListener(e,()=>setBefore(false)));original.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter')setBefore(true)});original.addEventListener('keyup',()=>setBefore(false));
 $('png').onclick=()=>exportImage('image/png');$('webp').onclick=()=>exportImage('image/webp');$('gif').onclick=exportGIF;$('add').onclick=async()=>{if(!S.imgs.some(Boolean))return;try{await awaitLatestFrame();await saveGallery(await canvasBlob($('canvas')),'ENTROPI / raster',0)}catch(e){log(e.message)}};
 document.querySelectorAll('[data-extract-palette]').forEach(button=>button.onclick=()=>{
  if(!S.imgs.some(Boolean)){log('Last inn eit bilete før du hentar ein palett');return}
  try{compose(sourceCtx,W,H,0);const data=sourceCtx.getImageData(0,0,W,H);
   const colors=extractPalette(data.data,W,H,Number(button.dataset.extractPalette));
   S.dither.palette='custom';S.dither.custom=colors.join(' ');syncControls();log(`Henta ${colors.length} fargar frå fotoet, lokalt i nettlesaren`)
  }catch(e){log('Palettuttrekk: '+e.message)}
 });
 $('method').onchange=e=>{S.dither.method=e.target.value;persist();scheduleRender()};$('palette').onchange=e=>{S.dither.palette=e.target.value;$('custom-field').hidden=e.target.value!=='custom';persist();scheduleRender()};$('custom').oninput=e=>{S.dither.custom=e.target.value;persist();scheduleRender()};for(const key of ['enabled','serpentine','invert']){const id=key==='enabled'?'dither-enabled':key;$(id).onchange=e=>{S.dither[key]=e.target.checked;persist();scheduleRender()}};
 $('reset').onclick=()=>{S.grade={...DEFAULT_GRADE};S.dither={...DEFAULT_DITHER};syncControls()};$('reset-grade').onclick=()=>{S.grade={...DEFAULT_GRADE};syncControls()};$('reset-dither').onclick=()=>{S.dither={...DEFAULT_DITHER};syncControls()};
 $('save-api').onclick=()=>{S.api=[$('api0').value.trim(),$('api1').value.trim()];S.adapter=$('adapter').value;persist();warnAPI();cards();log('Kameraadresser lagra')};$('adapter').onchange=e=>{S.adapter=e.target.value;persist();cards();warnAPI()};$('clear-log').onclick=()=>$('log').textContent='';$('more').onclick=showMore;
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInterval(liveTimer)}else if(S.playing){S.epoch=performance.now();setPlaying(true)}});
}
function init(){if(!MODES[S.mode])S.mode='alternate';if(!METHODS[S.dither.method])S.dither.method='floyd';if(!PALETTES[S.dither.palette]&&S.dither.palette!=='custom')S.dither.palette='mono';for(const [name,title] of Object.entries(METHODS)){$('method').add(new Option(title,name))}for(const [name,title] of Object.entries(PALETTE_LABELS)){$('palette').add(new Option(title,name))}
 binds();workerReady();syncControls();renderPresets();cards();updateCompare();warnAPI();refreshGallery().catch(e=>log(e.message));queueRender();log('Rasterverkstaden klar. Ingen sensorstatus er verifisert før testing.')}
init();
if('serviceWorker'in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(e=>log('Offline-cache: '+e.message));
