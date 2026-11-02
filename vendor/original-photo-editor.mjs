import { applyPhotoEdits, photoEditsNeutral } from './photo-adjustments.mjs';
import { createPhotoEditor } from './photo-editor.mjs';

function readPixels(image,edge){
  const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  try{
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('For lite minne til å lese biletet i denne storleiken.');
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return ctx.getImageData(0,0,canvas.width,canvas.height);
  }finally{canvas.width=canvas.height=1}
}

function paint(canvas,frame){
  if(canvas.width!==frame.width)canvas.width=frame.width;
  if(canvas.height!==frame.height)canvas.height=frame.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('For lite minne til å vise biletet.');
  ctx.putImageData(new ImageData(frame.data,frame.width,frame.height),0,0);
}

async function renderOriginal(image,original,edits){
  if(photoEditsNeutral(edits))return original;
  if(image.naturalWidth*image.naturalHeight>64*1024*1024)throw new Error('Biletet er for stort til å lagre i full oppløysing.');
  const pixels=readPixels(image,Infinity);
  const frame=applyPhotoEdits(pixels.data,pixels.width,pixels.height,edits,{fullResolution:true});
  const canvas=document.createElement('canvas');
  try{
    paint(canvas,frame);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob?.size)throw new Error('Kunne ikkje lagre biletet i full oppløysing.');
    return blob;
  }finally{canvas.width=canvas.height=1}
}

// Apply the same framing to both sides of a comparison, including while positioning a crop.
export function originalPhotoPreview(source,edits,{comparing=false,cropping=false,referenceWidth=source.width,referenceHeight=source.height}={}){
  const recipe=comparing?{geometry:edits.geometry,crop:edits.crop}:{...edits};
  if(cropping)recipe.crop={x:0,y:0,width:1,height:1};
  return applyPhotoEdits(source.data,source.width,source.height,recipe,{referenceWidth,referenceHeight});
}

// Keep the original encoded bytes intact. Only the interactive view is downsampled.
export async function openOriginalPhotoEditor(record,save){
  if(document.getElementById('original-photo-editor'))return null;
  const dialog=document.createElement('dialog');
  dialog.id='original-photo-editor';
  dialog.setAttribute('aria-label','Rediger originalfoto');
  dialog.innerHTML='<header><button type="button" data-action="cancel-original-edits">Avbryt</button><span>Originalfoto</span><button type="button" data-action="save-original-edits" disabled>Lagre</button></header><div class="original-photo-stage"><canvas class="mg-art original-photo-canvas" aria-label="Førehandsvising av foto"></canvas></div><p role="status">Opnar biletet …</p>';
  const stage=dialog.querySelector('.original-photo-stage'),canvas=stage.querySelector('canvas'),status=dialog.querySelector('[role=status]');
  const cancel=dialog.querySelector('[data-action=cancel-original-edits]'),apply=dialog.querySelector('[data-action=save-original-edits]');
  const original=record.nativePhoto??record.left,image=new Image(),url=URL.createObjectURL(original);
  let editor,preview,fast,sample,comparing=false,dragging=false,scheduled=0,saving=false,result=null;
  const close=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));
  const message=error=>error?.name==='QuotaExceededError'?'Lagringa er full.':error?.message||'Kunne ikkje lagre biletet.';
  function draw(){
    scheduled=0;
    if(!editor||!dialog.open)return;
    const source=dragging?fast:preview;
    try{
      const frame=originalPhotoPreview(source,editor.edits,{comparing,cropping:editor.cropping,referenceWidth:image.naturalWidth,referenceHeight:image.naturalHeight});
      paint(canvas,frame);editor.resize();
    }catch(error){status.textContent=message(error)}
  }
  function redraw(active=false){
    dragging=active===true;
    if(!scheduled)scheduled=requestAnimationFrame(draw);
  }
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault()});
  cancel.addEventListener('click',()=>dialog.close());
  apply.addEventListener('click',async()=>{
    if(!editor||saving)return;
    editor.commit();const edits=editor.committed;
    saving=true;cancel.disabled=true;apply.disabled=true;stage.inert=true;
    status.textContent='Lagrar i full oppløysing …';
    try{
      await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
      const rendered=await renderOriginal(image,original,edits);
      result=await save(edits,rendered);
      if(!result)throw new Error('Fotoet finst ikkje lenger i arkivet.');
      dialog.close();
    }catch(error){status.textContent=message(error);stage.inert=false;cancel.disabled=false;apply.disabled=false;saving=false}
  });
  document.body.append(dialog);
  try{
    dialog.showModal();
    try{
      image.src=url;
      await Promise.race([image.decode(),close]);
      if(dialog.open){
        if(!image.naturalWidth||!image.naturalHeight)throw new Error('Biletet manglar gyldige dimensjonar.');
        preview=readPixels(image,640);fast=readPixels(image,320);sample=readPixels(image,96);
        editor=createPhotoEditor(stage,{getPreview:()=>sample,onInput:redraw,onChange:redraw,onCompare:pressed=>{comparing=pressed;redraw()}});
        editor.set(record.originalEdits,image.naturalWidth,image.naturalHeight);
        status.textContent='';draw();apply.disabled=false;
      }
    }catch(error){
      if(dialog.open)status.textContent='Kunne ikkje opne originalfotoet. '+message(error);
    }
    await close;
    return result;
  }finally{
    cancelAnimationFrame(scheduled);editor?.dispose();canvas.width=canvas.height=1;
    dialog.remove();URL.revokeObjectURL(url);
  }
}
