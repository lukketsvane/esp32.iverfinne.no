let registration=null;
export function registerPWA(){
  if(!globalThis.isSecureContext||!navigator.serviceWorker)return Promise.resolve(null);
  return registration??=navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{registration=null;return null});
}
void registerPWA();
