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
    const result=action(transaction);
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
    canvas.width=200;canvas.height=150;
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
    async save(left,right=null){
      requestPersistence();
      if(!(left instanceof Blob)||!left.size||right&&(!(right instanceof Blob)||!right.size))throw new Error('Manglar gyldige originalbilete.');
      const db=await connect();
      const id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
      const preview=await thumbnail(left).catch(()=>null);
      const info={id,created:Date.now(),stereo:!!right,preview};
      await transact(db,['photos','index'],'readwrite',tx=>{
        tx.objectStore('photos').put({id,left,right});
        tx.objectStore('index').put(info);
      });
      return info;
    },
    async list(){
      const db=await connect(),records=await transact(db,['index'],'readonly',tx=>tx.objectStore('index').getAll());
      return records.sort((a,b)=>b.created-a.created);
    },
    async get(id){
      const db=await connect();return await transact(db,['photos'],'readonly',tx=>tx.objectStore('photos').get(id));
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
