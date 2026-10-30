from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from time import monotonic
import base64
import hashlib
import json
import io
import os
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'/'upscale-browser'
OUT.mkdir(parents=True,exist_ok=True)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):
        pass
    def do_GET(self):
        if self.path=='/':
            self.send_response(200)
            self.send_header('Content-Type','text/html')
            self.end_headers()
            self.wfile.write(b'<!doctype html><html><body></body></html>')
        else:
            super().do_GET()

server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
results=[]
try:
    with sync_playwright() as p:
        for engine in (p.chromium,p.webkit):
            if os.environ.get('ENTROPI_BROWSER') and os.environ['ENTROPI_BROWSER']!=engine.name:
                continue
            browser=engine.launch(headless=True)
            page=browser.new_page(viewport={'width':390,'height':844})
            page.goto('http://127.0.0.1:'+str(server.server_port)+'/')
            for factor in map(int,os.environ.get('ENTROPI_UPSCALE_FACTORS','2,4,8').split(',')):
                start=monotonic()
                value=page.evaluate("""async factor=>{
                  const {upscaleImage}=await import('/vendor/upscale.mjs');
                  const image=await createImageBitmap(await (await fetch('/device/tests/fixtures/baseline.jpg')).blob());
                  const canvas=document.createElement('canvas');canvas.width=48;canvas.height=40;const context=canvas.getContext('2d');context.drawImage(image,0,0,48,40);image.close();const pixels=context.getImageData(0,0,48,40);for(let y=0;y<40;y++)for(let x=0;x<48;x++){const i=(y*48+x)*4;pixels.data[i]=(x*19+y*7)%256;pixels.data[i+1]=(x*5+y*23)%256;pixels.data[i+2]=x<24?50:220;pixels.data[i+3]=x<3?0:255}context.putImageData(pixels,0,0);
                  const source=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),progress=[];
                  const blob=await upscaleImage(source,factor,{onProgress:p=>{if(p.phase==='upscaling')progress.push(p.percent)}});
                  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
                  return {base64:btoa(binary),progress};
                }""",factor)
                data=base64.b64decode(value.pop('base64'))
                image=Image.open(io.BytesIO(data))
                image.load()
                assert image.size==(48*factor,40*factor)
                assert image.mode=='RGBA'
                assert len(set(image.getdata()))>200
                assert image.getextrema()[3]==(0,255)
                metadata=json.loads(image.info['entropi'])
                assert metadata['factor']==factor and metadata['neuralPasses']==(2 if factor==8 else 1)
                assert value['progress'][-1]==100
                path=OUT/(engine.name+'-'+str(factor)+'x.png')
                path.write_bytes(data)
                result={'browser':engine.name,'factor':factor,'width':image.width,'height':image.height,'bytes':len(data),'seconds':round(monotonic()-start,2),'sha256':hashlib.sha256(data).hexdigest(),'model':metadata['model'],'passes':metadata['neuralPasses'],'provider':metadata.get('executionProvider','wasm')}
                results.append(result)
                print(json.dumps(result),flush=True)
            browser.close()
finally:
    server.shutdown()
(OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
