from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from array import array
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results'/'next-capture-browser'
RESULTS.mkdir(parents=True,exist_ok=True)
DEPTH=array('f',(.1+.8*((x%64)/63*.6+(x//64)/63*.4) for x in range(64*64))).tobytes()
requests=[]

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
    def send(self,body,kind='application/json',status=200,headers=None):
        self.send_response(status)
        self.send_header('Content-Type',kind)
        for key,value in (headers or {}).items(): self.send_header(key,str(value))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        route=self.path.split('?')[0]
        requests.append(route)
        if route in ['/device-app','/app.mjs']:
            source=(ROOT/('device/preview/index.html' if route=='/device-app' else 'app.mjs')).read_text(encoding='utf-8')
            source=source.replace('const archiveStore=createArchive(),','const archiveStore=window.galleryFixture,').replace('const gallery=createArchive();','const gallery=window.galleryFixture;')
            self.send(source.encode(),'text/html' if route=='/device-app' else 'text/javascript')
        elif route=='/status':
            self.send(json.dumps(dict(camera_id='fixture',camera_ready=True,stream_ready=True,transport='usb',width=640,height=480,psram=True,framesize=6,photo_framesize=10)).encode())
        elif route in ['/stream','/capture','/api/frame/mono/left']:
            self.send((ROOT/'device/tests/fixtures/baseline.jpg').read_bytes(),'image/jpeg')
        elif route=='/peer/status': self.send(b'',status=404)
        elif route.startswith('/print'): self.send(b'Print blocked',status=503)
        else: super().do_GET()
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length',0)))
        requests.append(self.path)
        if self.path=='/api/capture':
            self.send(json.dumps(dict(id='mono',left='/api/frame/mono/left',right=None,transport='usb',hardware_synchronized=False,fallback_reason='fixture peer unavailable')).encode())
        elif self.path=='/api/depth':
            self.send(DEPTH,'application/octet-stream',headers={'X-Depth-Width':64,'X-Depth-Height':64,'X-Depth-Polarity':'near','X-Depth-Model':'Fixture gradient'})
        else: self.send(b'Blocked',status=503)

fixture="""(() => {
    window.__ENTROPI_RIG_BRIDGE=true;window.mediaCalls=0;window.failCamera=false;
    const get=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if(get)navigator.mediaDevices.getUserMedia=async settings=>{window.mediaCalls++;if(window.failCamera)throw new DOMException('Fixture permission failure','NotAllowedError');return get(settings)};
    const records=window.galleryRecords=[];
    window.galleryFixture={
        save:async(left,right,preview)=>{const record={id:String(records.length+1),left,right,preview};records.push(record);return record},
        savePreview:async(id,preview)=>{records.find(record=>record.id===id).preview=preview},
        saveDocument:async(document,id=document.id)=>{let record=records.find(record=>record.id===id);if(!record){record={id};records.push(record)}Object.assign(record,{left:document.left,right:document.right,preview:document.preview,document});return record},
        list:async()=>records,get:async id=>records.find(record=>record.id===id)
    };
})();"""
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
results=[]
try:
    with sync_playwright() as p:
        for engine in [p.chromium,p.webkit]:
            browser=engine.launch(headless=True,args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] if engine.name=='chromium' else [])
            for app in (['phone','device'] if engine.name=='chromium' else ['device']):
                context=browser.new_context(viewport={'width':390,'height':844},has_touch=True,service_workers='block')
                context.add_init_script(fixture)
                context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(origin) or route.request.url.startswith('blob:') else route.abort())
                page=context.new_page();page.set_default_timeout(12000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(origin+('/device-app' if app=='device' else '/'))
                shutter='#shutter' if app=='device' else '#phone-shutter'
                camera='#close-photo' if app=='device' else '#reset'
                save='#save-photo' if app=='device' else '#save'
                if app=='phone':
                    page.locator(shutter).click();page.wait_for_function('document.querySelector("#video").videoWidth>0')
                else: page.wait_for_function('!document.querySelector("#shutter").disabled')
                page.locator(shutter).click();page.locator(save).wait_for(state='visible')
                page.wait_for_function('window.galleryRecords.length===1&&!!window.galleryRecords[0].document')
                first=page.locator('#photo').get_attribute('src')
                cdp=context.new_cdp_session(page) if engine.name=='chromium' else None
                def hold(cancel=False):
                    box=page.locator(camera).bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
                    if cdp: cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                    else: page.mouse.move(x,y);page.mouse.down()
                    page.wait_for_function('(id)=>document.querySelector(id).dataset.captureReady==="true"',arg=camera)
                    if cancel:
                        if cdp: cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+60,'y':y}]})
                        else: page.mouse.move(x+60,y,steps=5)
                    if cdp: cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                    else: page.mouse.up()
                hold(cancel=True)
                assert page.locator('#photo').get_attribute('src')==first
                assert page.locator(save).is_visible()
                assert page.evaluate('window.galleryRecords.length')==1
                hold()
                page.wait_for_function('(old)=>document.querySelector("#photo").src!==old',arg=first)
                page.wait_for_function('(id)=>!document.querySelector(id).disabled',arg=camera)
                page.wait_for_function('window.galleryRecords.length===2&&!!window.galleryRecords[1].document')
                second=page.locator('#photo').get_attribute('src')
                artwork=page.locator('.mg-art').evaluate('(canvas)=>canvas.toDataURL()')
                page.evaluate('window.retainedOriginal=window.galleryRecords[1].left')
                if app=='phone': page.evaluate('window.failCamera=true')
                else: page.route('**/api/capture',lambda route:route.fulfill(status=503,body='Fixture capture failure'))
                hold()
                page.wait_for_function('(id)=>!document.querySelector(id).disabled',arg=camera)
                assert page.locator('#photo').get_attribute('src')==second
                assert page.locator('.mg-art').evaluate('(canvas)=>canvas.toDataURL()')==artwork
                assert page.evaluate('window.galleryRecords.length===2&&window.galleryRecords[1].left===window.retainedOriginal')
                assert page.locator(save).is_visible()
                assert not any(route.startswith('/print') for route in requests)
                if app=='phone': page.evaluate('window.failCamera=false')
                else: page.unroute('**/api/capture')
                page.locator(camera).click()
                page.locator(shutter).wait_for(state='visible')
                assert page.locator('#photo').get_attribute('src')==second
                assert not errors,errors
                page.screenshot(path=str(RESULTS/f'{engine.name}-{app}.png'))
                result=dict(engine=engine.name,app=app,input='touch' if cdp else 'mouse',cancelledHoldPreserved=True,holdCapturedOnce=True,failureRetainedArtAndOriginal=True,tapReturns=True,printing=False)
                results.append(result);print(json.dumps(result),flush=True)
                context.close()
            browser.close()
finally:
    server.shutdown()
    (RESULTS/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
