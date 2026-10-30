from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results' / 'gallery-navigation-browser'
RESULTS.mkdir(parents=True, exist_ok=True)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        route = self.path.split('?')[0]
        if route in ['/device-app', '/app.mjs']:
            path = ROOT / ('device/preview/index.html' if route == '/device-app' else 'app.mjs')
            source = path.read_text(encoding='utf-8')
            source = source.replace('const archiveStore=createArchive(),', 'const archiveStore=window.galleryFixture,')
            source = source.replace('const gallery=createArchive();', 'const gallery=window.galleryFixture;')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html' if route == '/device-app' else 'text/javascript')
            self.end_headers()
            self.wfile.write(source.encode())
        elif route == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(dict(camera_id='fixture', camera_ready=True, stream_ready=True, psram=True, framesize=6, photo_framesize=10)).encode())
        elif route in ['/stream', '/capture']:
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.end_headers()
            self.wfile.write((ROOT / 'device/tests/fixtures/baseline.jpg').read_bytes())
        elif route == '/peer/status':
            self.send_response(404)
            self.end_headers()
        else:
            super().do_GET()

fixture = """(() => {
    window.__ENTROPI_RIG_BRIDGE=true;
    const records=Array.from({length:40},(_,index)=>{
        const image=new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${index*9},35%,50%)"/></svg>`],{type:'image/svg+xml'});
        return {id:String(index),created:index+1,left:image,preview:image,pending:false};
    });
    window.galleryListCalls=0;
    window.galleryFixture={list:async()=>{window.galleryListCalls++;return records},get:async id=>records.find(record=>record.id===id)};
})();"""

server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
results=[]
try:
    with sync_playwright() as p:
        for engine in [p.chromium,p.webkit]:
            browser=engine.launch(headless=True)
            for app in ['phone','device']:
                for width,height in [(390,844),(844,390)]:
                    context=browser.new_context(viewport={'width':width,'height':height},has_touch=True,service_workers='block')
                    context.add_init_script(fixture)
                    context.route('**/*',lambda route: route.continue_() if route.request.url.startswith(origin) or route.request.url.startswith('blob:') else route.abort())
                    page=context.new_page()
                    errors=[]
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    page.goto(origin+('/device-app' if app=='device' else '/'))
                    ids = dict(open='open-archive',grid='archive-grid',image='archive-photo',back='archive-back',vault='archive') if app=='device' else dict(open='open-gallery',grid='phone-vault-grid',image='phone-vault-image',back='phone-vault-back',vault='phone-vault')
                    page.locator('#'+ids['open']).click()
                    grid=page.locator('#'+ids['grid'])
                    tile=grid.locator('button').nth(12)
                    tile.scroll_into_view_if_needed()
                    before=grid.evaluate('(grid)=>{window.savedGalleryGrid=grid;window.savedGalleryTile=grid.children[13];return grid.scrollTop}')
                    assert before>0
                    tile.click()
                    image=page.locator('#'+ids['image'])
                    page.wait_for_function('(id)=>document.getElementById(id).alt.endsWith("13 av 40")',arg=ids['image'])
                    box=image.bounding_box()
                    start=(box['x']+box['width']*.65,box['y']+box['height']*.45)
                    def swipe(dx,dy):
                        if engine.name=='chromium':
                            cdp=context.new_cdp_session(page)
                            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':start[0],'y':start[1]}]})
                            for step in range(1,9):
                                cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':start[0]+dx*step/8,'y':start[1]+dy*step/8}]})
                            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                            cdp.detach()
                        else:
                            page.mouse.move(*start)
                            page.mouse.down()
                            page.mouse.move(start[0]+dx,start[1]+dy,steps=8)
                            page.mouse.up()
                    swipe(-90,0)
                    page.wait_for_function('(id)=>document.getElementById(id).alt.endsWith("14 av 40")',arg=ids['image'])
                    page.locator('#'+ids['back']).click()
                    restored=grid.evaluate('(grid)=>({same:grid===window.savedGalleryGrid,scroll:grid.scrollTop,focus:document.activeElement===window.savedGalleryTile,calls:window.galleryListCalls})')
                    assert restored['same'] and restored['focus'] and restored['calls']==1,restored
                    assert abs(restored['scroll']-before)<2,(before,restored)
                    grid.locator('button').nth(13).click()
                    page.keyboard.press('ArrowLeft')
                    page.wait_for_function('(id)=>document.getElementById(id).alt.endsWith("13 av 40")',arg=ids['image'])
                    page.screenshot(path=str(RESULTS/f'{engine.name}-{app}-{width}.png'))
                    swipe(0,90)
                    page.locator('#'+ids['vault']).wait_for(state='hidden')
                    assert not errors,errors
                    result=dict(engine=engine.name,app=app,viewport=[width,height],input='touch' if engine.name=='chromium' else 'mouse',swipe=True,keyboard=True,gridRestored=restored,dismiss=True)
                    results.append(result)
                    print(json.dumps(result),flush=True)
                    context.close()
            browser.close()
finally:
    server.shutdown()
    (RESULTS/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
