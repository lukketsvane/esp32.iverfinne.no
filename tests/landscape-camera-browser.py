from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit, parse_qs
from io import BytesIO
import json
import os
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results'/'landscape-camera-browser'
RESULTS.mkdir(parents=True,exist_ok=True)
PRIMARY,SECONDARY='aaaaaaaaaaaa','bbbbbbbbbbbb'
frames=[]
for color,label in [((224,46,40),'CAMERA 1'),((20,162,216),'CAMERA 2')]:
    image=Image.new('RGB',(320,240),color)
    draw=ImageDraw.Draw(image)
    draw.rectangle((6,6,313,233),outline='white',width=2)
    draw.text((14,14),label,fill='white')
    output=BytesIO();image.save(output,'JPEG',quality=95);frames.append(output.getvalue())
state={}
def reset():
    state.clear()
    state.update(peer=True,known=True,fail_peer=False,ignore_primary=False,controls=[],reads=[0,0],captures=0,values=[dict(brightness=0,ae_level=0),dict(brightness=0,ae_level=0)])

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
    def send(self,body,kind='application/json',status=200):
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store');self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError): pass
    def do_GET(self):
        parsed=urlsplit(self.path);path,query=parsed.path,parse_qs(parsed.query);peer=path.startswith('/peer/');index=int(peer)
        if path=='/device-app': self.send((ROOT/'device/preview/index.html').read_bytes(),'text/html')
        elif path in ['/status','/peer/status']:
            if peer and not state['peer']: self.send(b'Unavailable',status=503);return
            state['reads'][index]+=1
            status=dict(camera_id=SECONDARY if peer else PRIMARY,camera_ready=True,stream_ready=True,transport='usb',width=320,height=240,psram=True,framesize=6,photo_framesize=10,firmware='fixture')
            if not peer and state['peer']: status['peer']=dict(camera_id=SECONDARY)
            if state['known']: status.update(state['values'][index])
            self.send(json.dumps(status).encode())
        elif path in ['/control','/peer/control']:
            field,value=query.get('var',[''])[0],int(query.get('val',['99'])[0])
            state['controls'].append(dict(peer=peer,field=field,value=value))
            if field not in ['brightness','ae_level'] or value not in range(-2,3): self.send(b'Invalid',status=400)
            elif peer and (state['fail_peer'] or not state['peer']): self.send(b'Unavailable',status=503)
            else:
                if peer or not state['ignore_primary']: state['values'][index][field]=value
                self.send(b'')
        elif path in ['/stream','/capture','/peer/preview']:
            if peer and not state['peer']: self.send(b'Unavailable',status=503);return
            if path=='/capture': state['captures']+=1
            self.send(frames[index],'image/jpeg')
        else: super().do_GET()
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length',0)))
        if self.path=='/api/capture': state['captures']+=1
        self.send(b'Unexpected capture',status=503)

probe='''() => {
    const read=id=>{const c=document.getElementById(id),b=c.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,pixels:Array.from(c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data),raster:[c.width,c.height],hidden:c.hidden}};
    return {left:read('finder'),right:read('peer-live'),stereo:document.getElementById('studio').dataset.stereo};
}'''
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
results=[]
try:
    with sync_playwright() as p:
        for engine in [p.chromium,p.webkit]:
            if os.environ.get('ENTROPI_BROWSER') and os.environ['ENTROPI_BROWSER']!=engine.name: continue
            reset();browser=engine.launch(headless=True)
            context=browser.new_context(viewport=dict(width=844,height=390),has_touch=True,service_workers='block',reduced_motion='reduce')
            context.add_init_script('window.__ENTROPI_RIG_BRIDGE=true;')
            context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(origin) or route.request.url.startswith('blob:') else route.abort())
            page=context.new_page();page.set_default_timeout(15000);errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(origin+'/device-app')
            page.wait_for_function('!document.getElementById("shutter").disabled&&document.getElementById("studio").dataset.stereo==="true"')
            pair=page.evaluate(probe)
            assert pair['left']['pixels'][0]>180 and pair['left']['pixels'][2]<80,pair
            assert pair['right']['pixels'][2]>180 and pair['right']['pixels'][0]<80,pair
            assert pair['left']['x']+pair['left']['width']<=pair['right']['x'],pair
            assert abs(pair['left']['width']-pair['right']['width'])<1,pair
            assert abs(pair['left']['height']-pair['right']['height'])<1,pair
            for frame in [pair['left'],pair['right']]:
                assert abs(frame['width']/frame['height']-4/3)<.02,frame
                assert abs(frame['raster'][0]/frame['raster'][1]-4/3)<.02,frame
            for control in ['capture-brightness','capture-exposure']:
                hit=page.locator('#'+control).evaluate('(el)=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button")===el}}')
                assert hit['width']>=44 and hit['height']>=44 and hit['hit'],hit
            page.screenshot(path=str(RESULTS/f'{engine.name}-stereo.png'))
            reads=state['reads'].copy()
            page.locator('#capture-brightness').focus();page.keyboard.press('ArrowUp')
            page.wait_for_function('document.getElementById("capture-brightness").getAttribute("aria-valuenow")==="1"&&!document.getElementById("shutter").disabled')
            assert [entry['brightness'] for entry in state['values']]==[1,1],state
            assert state['reads'][0]>reads[0] and state['reads'][1]>reads[1],state
            assert state['controls'][:2]==[dict(peer=False,field='brightness',value=1),dict(peer=True,field='brightness',value=1)],state
            box=page.locator('#capture-exposure').bounding_box();x,y=box['x']+box['width']/2,box['y']+box['height']/2
            if engine.name=='chromium':
                cdp=context.new_cdp_session(page);cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[dict(x=x,y=y)]))
                for step in range(1,7): cdp.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=[dict(x=x,y=y-step*10)]))
                cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]));cdp.detach()
            else:
                page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y-60,steps=6);page.mouse.up()
            page.wait_for_function('document.getElementById("capture-exposure").getAttribute("aria-valuenow")==="2"&&!document.getElementById("shutter").disabled')
            assert [entry['ae_level'] for entry in state['values']]==[2,2],state
            assert any(entry==dict(peer=True,field='ae_level',value=2) for entry in state['controls']),state
            assert state['captures']==0,state
            state['fail_peer']=True;page.locator('#capture-brightness').focus();page.keyboard.press('ArrowDown')
            page.wait_for_function('!document.getElementById("shutter").disabled&&!document.getElementById("capture-feedback").hidden&&document.getElementById("capture-feedback").textContent.includes("Kamera 1 er oppdatert")')
            assert [entry['brightness'] for entry in state['values']]==[0,1],state
            page.screenshot(path=str(RESULTS/f'{engine.name}-partial-failure.png'))
            state['fail_peer']=False;state['ignore_primary']=True;before=len(state['controls']);page.keyboard.press('ArrowUp')
            page.wait_for_function('!document.getElementById("shutter").disabled&&document.getElementById("capture-feedback").textContent.includes("Kamerainnstillinga kunne ikkje stadfestast")')
            assert len(state['controls'])==before+1 and not state['controls'][-1]['peer'],state
            assert page.locator('#capture-brightness').get_attribute('aria-valuenow')=='0'
            state['ignore_primary']=False
            page.set_viewport_size(dict(width=390,height=844))
            page.wait_for_function('document.getElementById("peer-live").hidden&&Math.abs(document.getElementById("finder").width/document.getElementById("finder").height-2/3)<.02')
            assert not page.locator('#capture-brightness').is_visible()
            portrait=page.evaluate(probe)
            assert abs(portrait['left']['width']/portrait['left']['height']-2/3)<.02,portrait
            page.screenshot(path=str(RESULTS/f'{engine.name}-portrait.png'))
            page.set_viewport_size(dict(width=844,height=390))
            page.wait_for_function('document.getElementById("studio").dataset.stereo==="true"&&document.getElementById("finder").width===320&&document.getElementById("finder").height===240')
            state['peer']=False
            page.wait_for_function('document.getElementById("peer-live").hidden&&document.getElementById("shutter").getAttribute("aria-label")==="Ta foto"')
            single=page.evaluate(probe);center=single['left']['x']+single['left']['width']/2
            assert 844*.36<center<844*.44,single
            assert single['left']['width']>pair['left']['width'],single
            assert single['left']['pixels'][0]>180 and single['left']['pixels'][2]<80,single
            page.screenshot(path=str(RESULTS/f'{engine.name}-single.png'))
            state.update(peer=True,known=False);page.reload()
            page.wait_for_function('!document.getElementById("shutter").disabled&&document.getElementById("studio").dataset.stereo==="true"')
            for control in ['capture-brightness','capture-exposure']:
                assert page.locator('#'+control).is_disabled()
                assert page.locator('#'+control).get_attribute('aria-valuenow') is None
                assert page.locator('#'+control).get_attribute('aria-valuetext')=='Ikkje stadfesta'
            assert not errors,errors
            result=dict(engine=engine.name,distinctJpegs=True,fullFrameStereo=True,rotation=True,singleCamera=True,keyboardBrightness=True,dragExposure=True,confirmedBoth=True,partialFailure=True,rejectedUnconfirmedWrite=True,unknownDisabled=True,accidentalCaptures=state['captures'])
            results.append(result);print(json.dumps(result),flush=True)
            context.close();browser.close()
finally:
    server.shutdown();server.server_close()
    (RESULTS/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
