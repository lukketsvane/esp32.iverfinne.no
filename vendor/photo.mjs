export function photoSnapshot(image){
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  if(!width||!height)throw new Error('Fotoet er ikkje klart.');
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=Math.max(1,Math.min(1024,Math.round(384*height/width)));
  const context=canvas.getContext('2d');if(!context)throw new Error('Kunne ikkje lese fotoet.');
  context.filter='grayscale(1)';context.drawImage(image,0,0,canvas.width,canvas.height);
  return {width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data,photo:true};
}
