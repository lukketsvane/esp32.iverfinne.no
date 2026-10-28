export function downloadFile(blob,name,isCurrent=()=>true){
  if(!isCurrent())return;
  if(!(blob instanceof Blob)||!blob.size)throw new Error('Fila er ikkje klar.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;
  try{document.body.append(link);link.click()}
  finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
}

export async function savePhoto(blob,name='entropi.jpg',isCurrent=()=>true){
  if(!isCurrent())return;
  if(!blob?.size||!blob.type.startsWith('image/'))throw new Error('Fotoet er ikkje klart.');
  downloadFile(blob,name,isCurrent);
}

export function snapshotBlob(image){
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d');if(!context)throw new Error('Fotoet kunne ikkje lesast.');
  const pixels=context.createImageData(image.width,image.height);pixels.data.set(image.data);context.putImageData(pixels,0,0);
  const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),value=>value.charCodeAt(0));
  return new Blob([bytes],{type:'image/png'});
}

export function photoSnapshot(image,pose,native=false,nearest=false){
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  if(!width||!height)throw new Error('Fotoet er ikkje klart.');
  let x=0,y=0,w=width,h=height;
  if(pose?.scale>1&&pose.width>0&&pose.height>0){
    const fit=Math.min(pose.width/width,pose.height/height)*pose.scale,left=(pose.width-width*fit)/2+pose.x,top=(pose.height-height*fit)/2+pose.y;
    x=Math.max(0,-left)/fit;y=Math.max(0,-top)/fit;w=(Math.min(pose.width,left+width*fit)-Math.max(0,left))/fit;h=(Math.min(pose.height,top+height*fit)-Math.max(0,top))/fit;
  }
  const canvas=document.createElement('canvas');canvas.width=native?Math.max(1,Math.round(w)):384;canvas.height=native?Math.max(1,Math.round(h)):Math.max(1,Math.min(1024,Math.round(384*h/w)));
  const context=canvas.getContext('2d');if(!context)throw new Error('Kunne ikkje lese fotoet.');
  context.imageSmoothingEnabled=!nearest;context.drawImage(image,x,y,w,h,0,0,canvas.width,canvas.height);
  const data=context.getImageData(0,0,canvas.width,canvas.height).data;
  return {width:canvas.width,height:canvas.height,data,photo:true};
}
