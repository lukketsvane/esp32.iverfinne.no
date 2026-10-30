import {normalizePanorama} from './entropi-document.mjs';

const archiveName='entropi-gallery-v1';

function openArchive(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Lokal lagring er ikkje tilgjengeleg.'));return}
    const request=indexedDB.open(archiveName,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos',{keyPath:'id'});
      if(!db.objectStoreNames.contains('index'))db.createObjectStore('index',{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

function transact(db,stores,mode,action){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(stores,mode);
    let result;
    try{result=action(transaction)}catch(error){transaction.abort();reject(error);return}
    transaction.oncomplete=()=>resolve(result?.result);
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error||new Error('Lagringa vart avbroten.'));
  });
}

async function thumbnail(blob){
  const url=URL.createObjectURL(blob);
  try{
    const image=new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas');
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('Biletet kunne ikkje lesast.');
    const scale=Math.min(200/image.naturalWidth,150/image.naturalHeight,1);
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');
    if(!context)return null;
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const preview=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.68));
    canvas.width=canvas.height=1;
    return preview;
  }finally{URL.revokeObjectURL(url)}
}

export function createArchive(){
  let opening=null,persistenceRequested=false;
  const connect=()=>opening??=openArchive().catch(error=>{opening=null;throw error});
  const requestPersistence=()=>{
    if(persistenceRequested||globalThis.isSecureContext===false||!globalThis.navigator?.storage?.persist)return;
    persistenceRequested=true;
    void navigator.storage.persist().catch(()=>{});
  };
  return {
    async save(left,right=null,rendered=left,panorama=null){
      requestPersistence();
      if(!(left instanceof Blob)||!left.size||right&&(!(right instanceof Blob)||!right.size))throw new Error('Manglar gyldige originalbilete.');
      if(rendered!==null&&(!(rendered instanceof Blob)||!rendered.size))throw new Error('Manglar gyldig framkalla bilete.');
      const sweep=normalizePanorama(panorama);
      if(sweep&&(right!==null||left.size+(rendered?.size??0)+sweep.frames.reduce((sum,frame)=>sum+frame.left.size+(frame.right?.size??0),0)>128*1024*1024))throw new Error('Ugyldig panorama.');
      const db=await connect();
      const id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
      const preview=await thumbnail(rendered??left).catch(()=>null)??rendered??left;
      const info={id,created:Date.now(),stereo:!!right||!!sweep?.frames.some(frame=>frame.right),preview,pending:rendered===null,previewMatchesDocument:false};
      await transact(db,['photos','index'],'readwrite',tx=>{
        tx.objectStore('photos').put({id,left,right,preview:rendered,previewMatchesDocument:false,...(sweep?{panorama:sweep}:{})});
        tx.objectStore('index').put(info);
      });
      return info;
    },
    async savePreview(id,blob){
      requestPersistence();
      if(!id||!(blob instanceof Blob)||!blob.size)throw new Error('Manglar gyldig framkalla bilete.');
      const preview=await thumbnail(blob).catch(()=>null)??blob,db=await connect();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(['photos','index'],'readwrite'),photo=tx.objectStore('photos').get(id);let result=null;
        tx.oncomplete=()=>resolve(result);
        tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Lagringa vart avbroten.'));
        photo.onsuccess=()=>{
          if(!photo.result)return;
          const index=tx.objectStore('index').get(id);
          index.onsuccess=()=>{
            if(!index.result)return;
            try{result={...index.result,preview,pending:false,previewMatchesDocument:false};tx.objectStore('photos').put({...photo.result,preview:blob,previewMatchesDocument:false});tx.objectStore('index').put(result)}
            catch(error){reject(error);tx.abort()}
          };
        };
      });
    },
    async list(){
      const db=await connect(),records=await transact(db,['index'],'readonly',tx=>tx.objectStore('index').getAll());
      return Promise.all(records.sort((a,b)=>b.created-a.created).map(async stored=>{
        const record={...stored,previewMatchesDocument:stored.previewMatchesDocument===true};
        if(!record.pending||record.preview)return record;
        const photo=await transact(db,['photos'],'readonly',tx=>tx.objectStore('photos').get(record.id));
        return photo?.left?{...record,preview:await thumbnail(photo.left).catch(()=>null)??photo.left}:record;
      }));
    },
    async saveDocument(document,id=document.id){
      requestPersistence();
      if(!id||!(document.left instanceof Blob)||!document.result?.depth||!(document.preview instanceof Blob))throw new Error('Ugyldig Entropi-dokument.');
      const panorama=normalizePanorama(document.panorama);if(panorama){if(document.right!=null)throw new Error('Ugyldig panorama.');document={...document,panorama}}
      const db=await connect(),existing=await transact(db,['index'],'readonly',tx=>tx.objectStore('index').get(id));
      const preview=await thumbnail(document.preview).catch(()=>null)??document.preview;
      const info={id,created:existing?.created??Date.parse(document.created),stereo:!!document.right||!!panorama?.frames.some(frame=>frame.right),preview,pending:false,previewMatchesDocument:true};
      await transact(db,['photos','index'],'readwrite',tx=>{
        tx.objectStore('photos').put({id,left:document.left,right:document.right,document,preview:document.preview,previewMatchesDocument:true,...(panorama?{panorama}:{})});
        tx.objectStore('index').put(info);
      });
      return info;
    },
    async get(id){
      const db=await connect(),record=await transact(db,['photos'],'readonly',tx=>tx.objectStore('photos').get(id));
      if(!record)return record;
      // Legacy records are safe only when no independent preview can replace the master.
      const hasMaster=!!record.document?.result?.depth&&record.document.preview instanceof Blob;
      const previewMatchesDocument=hasMaster&&(record.previewMatchesDocument===true||
        record.previewMatchesDocument===undefined&&(!record.preview||record.preview===record.document.preview));
      return {...record,previewMatchesDocument};
    },
    async remove(id){
      const db=await connect();
      await transact(db,['photos','index'],'readwrite',tx=>{
        tx.objectStore('photos').delete(id);
        tx.objectStore('index').delete(id);
      });
    }
  };
}
