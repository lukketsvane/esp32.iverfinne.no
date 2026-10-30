from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from array import array
from io import BytesIO
import json
import os
import random
import time
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results'/'panorama-browser'
RESULTS.mkdir(parents=True,exist_ok=True)
DEPTH=array('f',(.1+.8*((i%64)/63*.6+(i//64)/63*.4) for i in range(4096))).tobytes()
rng=random.Random(49013)
world=Image.new('RGB',(1280,480),(95,101,108))
draw=ImageDraw.Draw(world)
for _ in range(4200):
    x,y=rng.randrange(1280),rng.randrange(480)
    w,h=rng.randrange(3,31),rng.randrange(3,31)
    color=tuple(rng.randrange(20,235) for _ in range(3))
    if rng.random()<.5: draw.rectangle((x,y,x+w,y+h),fill=color)
    else: draw.ellipse((x,y,x+w,y+h),fill=color)
world=world.filter(ImageFilter.GaussianBlur(.6))
frames=[]
for i in range(8):
    output=BytesIO();world.crop((80*i,0,80*i+640,480)).save(output,'JPEG',quality=95)
    frames.append(output.getvalue())
captures=0

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
    def send(self,body,kind='application/json',status=200,headers=None):
        self.send_response(status);self.send_header('Content-Type',kind)
        for key,value in (headers or {}).items(): self.send_header(key,str(value))
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError): pass
    def do_GET(self):
        global captures
        route=self.path.split('?')[0]
        if route=='/__reset__': captures=0;self.send(b'{}')
        elif route=='/__pure__': self.send(b'<!doctype html><title>Panorama verification</title>','text/html')
        elif route=='/device-app': self.send((ROOT/'device/preview/index.html').read_bytes(),'text/html')
        elif route=='/status': self.send(json.dumps(dict(camera_id='fixture',camera_ready=True,stream_ready=True,transport='usb',width=640,height=480,psram=True,framesize=6,photo_framesize=10)).encode())
        elif route.startswith('/fixture/frame/'): self.send(frames[int(route.rsplit('/',1)[1].split('.')[0])],'image/jpeg')
        elif route.startswith('/api/frame/'): self.send(frames[min(7,int(route.split('/')[3]))],'image/jpeg')
        elif route in ['/stream','/capture']: self.send(frames[0],'image/jpeg')
        elif route=='/peer/status': self.send(b'',status=404)
        else: super().do_GET()
    def do_POST(self):
        global captures
        self.rfile.read(int(self.headers.get('Content-Length',0)))
        if self.path=='/api/capture':
            index=captures;captures+=1
            self.send(json.dumps(dict(id=str(index),left=f'/api/frame/{index}/left',right=None,transport='usb',hardware_synchronized=False,fallback_reason='Fixture has one camera')).encode())
        elif self.path=='/api/depth': self.send(DEPTH,'application/octet-stream',headers={'X-Depth-Width':64,'X-Depth-Height':64,'X-Depth-Polarity':'near','X-Depth-Model':'Fixture gradient'})
        else: self.send(b'Blocked',status=503)

fixture="""(() => {
    window.__ENTROPI_RIG_BRIDGE=true;
    const open=indexedDB.open.bind(indexedDB);
    indexedDB.open=(name,...args)=>{const request=open(name,...args);if(name==='entropi-gallery-v1')request.addEventListener('success',()=>window.fixtureArchiveDb=request.result);return request};
    window.readRecords=()=>new Promise((resolve,reject)=>{const db=window.fixtureArchiveDb;if(!db){resolve([]);return}const request=db.transaction('photos','readonly').objectStore('photos').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    window.fixtureMoving=false;window.fixtureVideoIndex=0;
    if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{value:{}});
    navigator.mediaDevices.getUserMedia=async()=>{
        const images=await Promise.all(Array.from({length:8},async(_,i)=>{const image=new Image();image.src=new URL('/fixture/frame/'+i+'.jpg',location.href).href;await image.decode();return image}));
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');
        const draw=()=>context.drawImage(images[window.fixtureVideoIndex],0,0);
        window.resetFixtureVideo=()=>{window.fixtureVideoIndex=0;draw()};window.resetFixtureVideo();
        const stream=canvas.captureStream(15),timer=setInterval(()=>{if(window.fixtureMoving)window.fixtureVideoIndex=Math.min(7,window.fixtureVideoIndex+1);draw()},900);
        for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop()}}
        return stream;
    };
})();"""

pure="""async()=>{
    const {buildPanorama}=await import('/vendor/panorama.mjs');
    const {createEntropiDocument,encodeEntropiDocument,decodeEntropiDocument}=await import('/vendor/entropi-document.mjs');
    const frames=await Promise.all([0,1,2,3].map(async i=>({left:await(await fetch('/fixture/frame/'+i+'.jpg')).blob(),right:null,id:String(i)})));
    const sweep=await buildPanorama(frames),image=new Image(),url=URL.createObjectURL(sweep.left);image.src=url;await image.decode();URL.revokeObjectURL(url);
    if(image.naturalWidth<=800||sweep.panorama.acceptedFrames!==4||sweep.result!==null)throw new Error('Invalid real panorama output');
    const document=createEntropiDocument({left:sweep.left,preview:sweep.left,panorama:sweep.panorama,result:{depth:new Float32Array([.1,.3,.6,.9]),width:2,height:2,normalized:true,model:'Fixture gradient',source:'fixture'}});
    const reopened=await decodeEntropiDocument(await encodeEntropiDocument(document));
    const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
    for(let i=0;i<frames.length;i++)if(await digest(frames[i].left)!==await digest(reopened.panorama.frames[i].left))throw new Error('Original source changed');
    return {width:image.naturalWidth,height:image.naturalHeight,accepted:sweep.panorama.acceptedFrames,preserved:frames.length,stereo:false,transforms:reopened.panorama.transforms};
}"""

server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
results=[]
try:
    with sync_playwright() as p:
        for engine in [p.chromium,p.webkit]:
            if os.environ.get('ENTROPI_BROWSER') and os.environ['ENTROPI_BROWSER']!=engine.name: continue
            browser=engine.launch(headless=True)
            pure_page=browser.new_page();pure_page.goto(origin+'/__pure__')
            built=pure_page.evaluate(pure);pure_page.close()
            result=dict(engine=engine.name,scope='real-builder',input='synthetic overlapping JPEGs',**built)
            results.append(result);print(json.dumps(result),flush=True)
            if os.environ.get('ENTROPI_PANORAMA_PURE')=='1': browser.close();continue
            for app in ['phone','device']:
                if os.environ.get('ENTROPI_APP') and os.environ['ENTROPI_APP']!=app: continue
                context=browser.new_context(viewport={'width':390,'height':844},has_touch=True,service_workers='block',reduced_motion='reduce')
                context.add_init_script(fixture)
                context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(origin) or route.request.url.startswith('blob:') else route.abort())
                page=context.new_page();page.set_default_timeout(30000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(origin+('/device-app' if app=='device' else '/'))
                shutter='#shutter' if app=='device' else '#phone-shutter'
                camera='#close-photo' if app=='device' else '#reset'
                save='#save-photo' if app=='device' else '#save'
                if app=='phone':
                    supported=page.evaluate("typeof HTMLCanvasElement.prototype.captureStream==='function'")
                    if not supported:
                        result=dict(engine=engine.name,app=app,skipped=True,reason='Headless engine lacks canvas.captureStream camera fixture; real panorama builder remains tested')
                        results.append(result);print(json.dumps(result),flush=True);context.close();continue
                    page.locator(shutter).click();page.wait_for_function('document.querySelector("#video").videoWidth>0')
                else: page.wait_for_function('!document.querySelector("#shutter").disabled')
                storage=page.evaluate('''()=>new Promise(resolve=>{
                    const request=indexedDB.open('panorama-storage-probe',1);
                    request.onupgradeneeded=()=>request.result.createObjectStore('probe');
                    request.onerror=()=>resolve({ok:false,error:String(request.error)});
                    request.onsuccess=()=>{
                        const db=request.result,tx=db.transaction('probe','readwrite');let error='';
                        const finish=result=>{db.close();indexedDB.deleteDatabase('panorama-storage-probe');resolve(result)};
                        tx.oncomplete=()=>finish({ok:true});tx.onabort=()=>finish({ok:false,error:error||String(tx.error)});
                        try{const write=tx.objectStore('probe').put(new Blob(['probe'],{type:'image/jpeg'}),'blob');write.onerror=()=>{error=String(write.error)}}catch(cause){finish({ok:false,error:String(cause)})}
                    };
                })''')
                if not storage['ok']:
                    result=dict(engine=engine.name,app=app,skipped=True,scope='archive integration',reason='Headless engine cannot persist Blob data in IndexedDB: '+storage['error'])
                    results.append(result);print(json.dumps(result),flush=True);context.close();continue
                def records(count,panorama=False):
                    deadline=time.monotonic()+30
                    while time.monotonic()<deadline:
                        if page.evaluate('async arg=>{const r=await window.readRecords();return r.length===arg.count&&r.every(x=>x.document)&&(!arg.panorama||r.some(x=>x.panorama?.frames.length>=3))}',dict(count=count,panorama=panorama)): return
                        page.wait_for_timeout(100)
                    raise AssertionError(page.evaluate('async()=>({records:(await window.readRecords()).map(r=>({id:r.id,document:!!r.document,panorama:r.panorama?.frames.length})),text:document.body.innerText})'))
                def point():
                    box=page.locator('#finder' if app=='device' else '#viewfinder').bounding_box()
                    return box['x']+box['width']/2,box['y']+box['height']/2
                def reset_frames():
                    page.evaluate("async()=>{await fetch('/__reset__');window.fixtureMoving=false;window.resetFixtureVideo?.()}")
                def begin():
                    reset_frames();page.evaluate('window.fixtureMoving=true')
                    x,y=point();page.mouse.move(x,y);page.mouse.down()
                    try: page.wait_for_function('document.querySelector("#capture-plane").dataset.panorama==="recording"')
                    except Exception:
                        print(json.dumps(dict(engine=engine.name,app=app,errors=errors,state=page.evaluate('([x,y])=>({hit:document.elementFromPoint(x,y)?.outerHTML,surface:document.querySelector("#capture-plane").outerHTML,text:document.body.innerText,connected:typeof connected==="undefined"?null:connected,hasFrame:typeof hasFrame==="undefined"?null:hasFrame,busy:typeof busy==="undefined"?null:busy})',[x,y]))),flush=True)
                        page.screenshot(path=str(RESULTS/f'{engine.name}-{app}-failure.png'))
                        raise
                def return_camera():
                    page.locator(camera).click();page.locator(shutter).wait_for(state='visible')
                    if app=='phone': page.wait_for_function('document.querySelector("#video").videoWidth>0')
                    else: page.wait_for_function('!document.querySelector("#shutter").disabled&&!document.querySelector("#capture-plane").disabled')
                page.mouse.click(*point());records(1)
                assert page.evaluate('async()=>!(await window.readRecords())[0].panorama')
                return_camera();begin();page.keyboard.press('Escape');page.mouse.up()
                page.wait_for_function('!document.querySelector("#capture-plane").dataset.panorama')
                page.wait_for_timeout(250)
                assert page.evaluate('async()=>(await window.readRecords()).length')==1
                begin()
                page.wait_for_function('Number(document.querySelector("#scan-progress span").textContent.split(" · ")[1])>=3')
                page.mouse.up();records(2,True);page.locator(save).wait_for(state='visible')
                sweep=page.evaluate('async()=>{const r=(await window.readRecords()).find(r=>r.panorama);window.panoramaRecordId=r.id;return {id:r.id,frames:r.panorama.frames.length,accepted:r.panorama.acceptedFrames,width:r.panorama.output.width,height:r.panorama.output.height,source:r.document.result.source,model:r.document.result.model}}')
                assert sweep['frames']>=3 and sweep['accepted']>=3 and sweep['width']>700,sweep
                art=page.locator('.mg-art').bounding_box()
                assert art['width']<=390*.77,art
                page.locator('.mg-edit-tool[data-tool="crop"]').click()
                assert page.locator('.mg-editor').evaluate('(editor)=>editor.contains(document.activeElement)')
                crop=page.evaluate('()=>{const art=document.querySelector(".mg-art"),r=art.getBoundingClientRect(),s=Math.min(r.width/art.width,r.height/art.height),w=art.width*s,h=art.height*s,f=document.querySelector(".mg-crop-frame").getBoundingClientRect();return {image:{x:r.x+(r.width-w)/2,y:r.y+(r.height-h)/2,width:w,height:h},frame:{x:f.x,y:f.y,width:f.width,height:f.height}}}')
                for axis,dimension in [('x','width'),('y','height')]:
                    assert crop['frame'][axis]>=crop['image'][axis]-1 and crop['frame'][axis]+crop['frame'][dimension]<=crop['image'][axis]+crop['image'][dimension]+1,crop
                page.keyboard.press('Escape')
                page.locator('.mg-edit-panel').wait_for(state='hidden')
                page.locator(camera).wait_for(state='visible')
                page.screenshot(path=str(RESULTS/f'{engine.name}-{app}-panorama.png'))
                exported=page.evaluate("""async()=>{const record=(await window.readRecords()).find(r=>r.id===window.panoramaRecordId);const {encodeEntropiDocument,decodeEntropiDocument}=await import('/vendor/entropi-document.mjs');const {encodeRenderedTiff}=await import('/vendor/entropi-rendered-export.mjs');const reopened=await decodeEntropiDocument(await encodeEntropiDocument(record.document));const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');for(let i=0;i<record.panorama.frames.length;i++)if(await digest(record.panorama.frames[i].left)!==await digest(reopened.panorama.frames[i].left))throw new Error('Source mismatch');const tiff=await encodeRenderedTiff(reopened);return {preserved:reopened.panorama.frames.length,tiffBytes:tiff.size,tiffType:tiff.type}}""")
                assert exported['preserved']==sweep['frames'] and exported['tiffBytes']>100000 and exported['tiffType']=='image/tiff',exported
                return_camera()
                open_id='#open-archive' if app=='device' else '#open-gallery'
                grid='#archive-grid' if app=='device' else '#phone-vault-grid'
                edit='#archive-edit' if app=='device' else '#phone-vault-edit'
                page.locator(open_id).click();page.locator(grid+' button').first.click();page.locator(edit).click()
                page.locator('.mg-art').wait_for(state='visible')
                page.wait_for_function('()=>document.querySelector(".mg-art").width>700')
                limit=None
                if engine.name=='chromium' and app=='device':
                    return_camera();begin();started=time.monotonic()
                    page.wait_for_function('document.querySelector("#capture-plane").dataset.panorama!=="recording"',timeout=19000)
                    elapsed=time.monotonic()-started
                    assert 14.4<=elapsed<18,elapsed
                    records(3,True);page.mouse.up();page.wait_for_timeout(250)
                    assert page.evaluate('async()=>(await window.readRecords()).length')==3
                    limit=dict(seconds=elapsed,frames=page.evaluate('async()=>Math.max(...(await window.readRecords()).map(r=>r.panorama?.frames.length??0))'))
                    assert limit['frames']==8,limit
                assert not errors,errors
                result=dict(engine=engine.name,app=app,input='synthetic canvas camera' if app=='phone' else 'synthetic USB JPEG endpoint',depth='fixture gradient',shortTapOne=True,cancelNoArchive=True,holdOnePanorama=True,reopen=True,artMargins=True,cropAligned=True,export=exported,sweep=sweep,limit=limit)
                results.append(result);print(json.dumps(result),flush=True);context.close()
            browser.close()
finally:
    server.shutdown();server.server_close()
    (RESULTS/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
