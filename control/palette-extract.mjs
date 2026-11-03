/** Deterministic weighted median-cut palette extraction. No network, canvas or dependencies. */
const hex=v=>'#'+v.map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join('');
const components=['r','g','b'];
export function extractPalette(data,width,height,count=8){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data?.length!==width*height*4)throw Error('Ugyldig bilete for palett');
 if(!Number.isInteger(count)||count<2||count>32)throw Error('Paletten må ha 2–32 fargar');
 const step=Math.max(1,Math.floor(Math.sqrt(width*height/16000)));const buckets=new Map();
 for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
  const i=(y*width+x)*4;if(data[i+3]<128)continue;
  const r=data[i]>>3,g=data[i+1]>>3,b=data[i+2]>>3,key=r*1024+g*32+b;
  const old=buckets.get(key);if(old)old.weight++;else buckets.set(key,{r:r*8+4,g:g*8+4,b:b*8+4,weight:1});
 }
 if(!buckets.size)return ['#111111','#eeeeee'];
 const samples=[...buckets.values()];let boxes=[samples];
 const spread=box=>components.map(c=>Math.max(...box.map(x=>x[c]))-Math.min(...box.map(x=>x[c])));
 while(boxes.length<count){
  let best=-1,bestScore=-1;
  for(let i=0;i<boxes.length;i++){
   const box=boxes[i];if(box.length<2)continue;
   let ranges=spread(box),weight=box.reduce((sum,p)=>sum+p.weight,0);
   const score=Math.max(...ranges)*Math.sqrt(weight);
   if(score>bestScore){bestScore=score;best=i}
  }
  if(best<0)break;
  const box=boxes[best],ranges=spread(box);let channel=components[ranges.indexOf(Math.max(...ranges))];
  box.sort((a,b)=>a[channel]-b[channel]||a.r-b.r||a.g-b.g||a.b-b.b);
  const total=box.reduce((sum,x)=>sum+x.weight,0);let sum=0,cut=0;
  while(cut<box.length-1&&sum<total/2)sum+=box[cut++].weight;
  boxes.splice(best,1,box.slice(0,cut),box.slice(cut));
 }
 const colors=boxes.map(box=>{
  const weight=box.reduce((sum,p)=>sum+p.weight,0);
  return {rgb:components.map(c=>box.reduce((sum,p)=>sum+p[c]*p.weight,0)/weight),weight};
 });
 colors.sort((a,b)=>(a.rgb[0]*.2126+a.rgb[1]*.7152+a.rgb[2]*.0722)-(b.rgb[0]*.2126+b.rgb[1]*.7152+b.rgb[2]*.0722));
 const unique=[...new Set(colors.map(x=>hex(x.rgb)))];
 return unique.length===1?[unique[0],unique[0]==='#ffffff'?'#000000':'#ffffff']:unique;
}
