export function memoryIndexedDB({failWrites=false}={}){
  const stores=new Map();let initialized=false;
  return {open(){
    const request={};
    queueMicrotask(()=>{
      request.result={createObjectStore(name){stores.set(name,new Map())},close(){},transaction(name){
        const transaction={objectStore(){return {put(value,key){
          const result={};queueMicrotask(()=>{if(failWrites){transaction.onerror?.();return}stores.get(name).set(key,structuredClone(value));result.result=key;transaction.oncomplete?.()});return result;
        },get(key){const result={};queueMicrotask(()=>{result.result=structuredClone(stores.get(name)?.get(key));transaction.oncomplete?.()});return result}}}};
        return transaction;
      }};
      if(!initialized){initialized=true;request.onupgradeneeded?.()}
      request.onsuccess?.();
    });
    return request;
  }};
}
