import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { memoryIndexedDB } from './helpers/indexeddb.mjs';

let instance=0;
const freshAssets=()=>import('../pointcloud/assets.mjs?model-cache-test='+ ++instance);
const bytes=new Uint8Array([1,2,3,4]);
const asset={local:'/models/depth-v1.onnx',url:'https://models.example/depth-v1.onnx',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};

async function environment(values,run){
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  try{await run(await freshAssets())}
  finally{for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
}

test('already persistent storage never requests another grant',async()=>{
  let checked=0,requested=0;
  await environment({navigator:{storage:{persisted:async()=>{checked++;return true},persist:async()=>{requested++;return true}}}},async api=>{
    assert.deepEqual(await Promise.all([api.requestModelPersistence(),api.requestModelPersistence()]),[true,true]);
    assert.equal(await api.requestModelPersistence(),true);
    assert.equal(checked,1);assert.equal(requested,0);
  });
});

test('one persistence request is shared by model access and concurrent callers',async()=>{
  let checked=0,requested=0;
  await environment({indexedDB:memoryIndexedDB(),navigator:{storage:{persisted:async()=>{checked++;return false},persist:async()=>{requested++;return true}}}},async api=>{
    const saving=api.storeAsset(asset,bytes);
    assert.deepEqual(await Promise.all([api.requestModelPersistence(),api.requestModelPersistence()]),[true,true]);
    assert.deepEqual(await saving,bytes);assert.deepEqual(await api.loadCachedAsset(asset),bytes);
    assert.equal(checked,1);assert.equal(requested,1);
  });
});

test('denied or failing persistence never prevents verified cached models from working',async()=>{
  for(const outcome of ['denied','persist-error','persisted-error']){
    const storage={persisted:async()=>{if(outcome==='persisted-error')throw new Error('Denied');return false},persist:async()=>{if(outcome==='persist-error')throw new Error('Denied');return false}};
    await environment({indexedDB:memoryIndexedDB(),navigator:{storage}},async api=>{
      assert.equal(await api.requestModelPersistence(),false);
      assert.deepEqual(await api.storeAsset(asset,bytes),bytes);
      assert.deepEqual(await api.loadCachedAsset(asset),bytes);
      let downloads=0;
      assert.deepEqual(await api.loadAsset(asset,()=>{},undefined,async()=>{downloads++;throw new Error('Offline')}),bytes);
      assert.equal(downloads,0);
    });
  }
});

test('model caching works when browser persistence APIs are absent',async()=>{
  for(const navigator of [undefined,{}, {storage:{}}, {storage:{persisted:async()=>true}}])await environment({indexedDB:memoryIndexedDB(),navigator},async api=>{
    assert.equal(await api.requestModelPersistence(),false);
    assert.deepEqual(await api.storeAsset(asset,bytes),bytes);
    assert.deepEqual(await api.loadCachedAsset(asset),bytes);
  });
});

test('downloaded models survive a fresh application instance and changed URLs with no network access',async()=>{
  const database=memoryIndexedDB();let downloads=0;
  await environment({indexedDB:database,navigator:{}},async api=>{
    assert.deepEqual(await api.loadAsset(asset,()=>{},undefined,async url=>{downloads++;assert.equal(url,asset.local);return new Response(bytes)}),bytes);
    assert.equal(downloads,1);
  });
  await environment({indexedDB:database,navigator:{}},async api=>{
    const revised={...asset,local:'/models/depth-v2.onnx?app=updated',url:'https://another.example/model.onnx'};
    const progress=[];
    assert.deepEqual(await api.loadCachedAsset(revised),bytes);
    assert.deepEqual(await api.loadAsset(revised,value=>progress.push(value),undefined,async()=>{downloads++;throw new Error('Offline')}),bytes);
    assert.deepEqual(progress,[100]);assert.equal(downloads,1);
  });
});

test('a failed model storage transaction rejects without downloading the fallback again',async()=>{
  await environment({indexedDB:memoryIndexedDB({failWrites:true}),navigator:{}},async api=>{
    const downloads=[];
    await assert.rejects(api.loadAsset(asset,()=>{},undefined,async url=>{downloads.push(url);return new Response(bytes)}),{code:'MODEL_STORAGE_UNAVAILABLE'});
    assert.deepEqual(downloads,[asset.local]);
    await assert.rejects(api.loadCachedAsset(asset),{code:'PHONE_SETUP_REQUIRED'});
  });
});

test('a completed write with missing or corrupt readback never redownloads or reports complete',async()=>{
  for(const stored of [undefined,new Uint8Array([9,9,9,9]).buffer]){
    const database=memoryIndexedDB(),open=database.open;
    database.open=()=>{
      const request=open();let success;
      Object.defineProperty(request,'onsuccess',{set(callback){success=callback},get(){return ()=>{
        const transaction=request.result.transaction;
        request.result.transaction=(name,mode)=>{
          const result=transaction(name),store=result.objectStore(name);
          if(mode==='readwrite')result.objectStore=()=>({...store,put:(_value,key)=>store.put(stored,key)});
          return result;
        };
        success?.();
      }}});
      return request;
    };
    await environment({indexedDB:database,navigator:{}},async api=>{
      const downloads=[],progress=[];
      await assert.rejects(api.loadAsset(asset,value=>progress.push(value),undefined,async url=>{downloads.push(url);return new Response(bytes)}),{code:'MODEL_STORAGE_UNAVAILABLE'});
      assert.deepEqual(downloads,[asset.local]);assert.equal(progress.includes(100),false);
    });
  }
});

test('download progress reaches completion only after verified storage is readable',async()=>{
  await environment({indexedDB:memoryIndexedDB(),navigator:{}},async api=>{
    const progress=[];let committed;
    await api.loadAsset(asset,value=>{progress.push(value);if(value===100)committed=api.loadCachedAsset(asset)},undefined,async()=>new Response(bytes));
    assert.deepEqual(await committed,bytes);assert.deepEqual(progress,[99,100]);
  });
});

test('unavailable model storage is distinguished from an absent cached model without downloading',async()=>{
  for(const indexedDB of [undefined,{open(){throw new Error('Storage disabled')}},{open(){const request={};queueMicrotask(()=>request.onerror?.());return request}},{open(){const request={};queueMicrotask(()=>request.onblocked?.());return request}}])await environment({indexedDB,navigator:{}},async api=>{
    await assert.rejects(api.loadCachedAsset(asset),{code:'MODEL_STORAGE_UNAVAILABLE'});
    let downloads=0;
    await assert.rejects(api.loadAsset(asset,()=>{},undefined,async()=>{downloads++;return new Response(bytes)}),{code:'MODEL_STORAGE_UNAVAILABLE'});
    assert.equal(downloads,0);
  });
  await environment({indexedDB:memoryIndexedDB(),navigator:{}},async api=>{
    await assert.rejects(api.loadCachedAsset(asset),{code:'PHONE_SETUP_REQUIRED'});
  });
});
