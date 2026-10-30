from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results' / 'photo-editor-browser'
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
    window.galleryRecords=[];window.savedRecipes=[];
    let loading;
    const prepare=()=>loading??=(async()=>{
        const {createEntropiDocument}=await import(new URL('/vendor/entropi-document.mjs',location.href).href);
        const left=await (await fetch('/device/tests/fixtures/baseline.jpg')).blob();
        const depth=Float32Array.from({length:4096},(_,i)=>.1+.8*((i%64)/63*.6+Math.floor(i/64)/63*.4));
        const document=createEntropiDocument({left,preview:left,result:{depth,width:64,height:64,normalized:true,model:'Fixture gradient',source:'fixture'},recipe:{preset:1,position:0,width:1}});
        window.galleryRecords.push({id:document.id,created:Date.now(),left,preview:left,document,previewMatchesDocument:true});
    })().catch(error=>{window.galleryFixtureError=String(error.stack||error);throw error});
    window.galleryFixture={
        list:async()=>{await prepare();return window.galleryRecords},
        get:async id=>{await prepare();return window.galleryRecords.find(record=>record.id===id)},
        saveDocument:async(document,id=document.id)=>{await prepare();let record=window.galleryRecords.find(record=>record.id===id);if(!record){record={id};window.galleryRecords.push(record)}Object.assign(record,{left:document.left,preview:document.preview,document,previewMatchesDocument:true});window.savedRecipes.push(structuredClone(document.recipe));return record},
        savePreview:async(id,preview)=>{window.galleryRecords.find(record=>record.id===id).preview=preview}
    };
})();"""

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
results = []
try:
    with sync_playwright() as p:
        for engine in [p.chromium, p.webkit]:
            if os.environ.get('ENTROPI_BROWSER') and engine.name != os.environ['ENTROPI_BROWSER']:
                continue
            browser = engine.launch(headless=True)
            for app in ['phone', 'device']:
                for width, height in [(390,844), (844,390)]:
                    context = browser.new_context(viewport={'width':width,'height':height}, has_touch=True, service_workers='block', reduced_motion='reduce')
                    context.add_init_script(fixture)
                    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin) or route.request.url.startswith('blob:') else route.abort())
                    page = context.new_page()
                    page.set_default_timeout(15000)
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + ('/device-app' if app == 'device' else '/'))
                    ids = dict(open='open-archive', grid='archive-grid', edit='archive-edit') if app == 'device' else dict(open='open-gallery', grid='phone-vault-grid', edit='phone-vault-edit')
                    def reopen():
                        if app == 'device' and page.locator('#photo-dialog').evaluate('(dialog)=>dialog.open'):
                            page.locator('#close-photo').click()
                        elif not page.locator('#'+ids['open']).is_visible():
                            page.locator('#close-photo' if app == 'device' else '#reset').click()
                        page.locator('#'+ids['open']).click()
                        try:
                            page.locator('#'+ids['grid']+' button').first.click()
                        except Exception:
                            print(json.dumps(dict(engine=engine.name,app=app,viewport=[width,height],errors=errors,state=page.evaluate('({fixtureError:window.galleryFixtureError,records:window.galleryRecords?.length,text:document.body.innerText})'))),flush=True)
                            raise
                        page.locator('#'+ids['edit']).click()
                        page.locator('.mg-edit-tool[data-tool="exposure"]').wait_for(state='visible')
                    def set_range(value):
                        page.locator('.mg-edit-range').evaluate('(input,value)=>{input.value=String(value);input.dispatchEvent(new Event("input",{bubbles:true}))}', value)
                    def saved(expression):
                        page.wait_for_function('()=>{const recipe=window.galleryRecords[0]?.document?.recipe;return '+expression+'}')
                    def scrub(selector, start, end):
                        nodes = page.locator(selector)
                        first, last = nodes.nth(start).bounding_box(), nodes.nth(end).bounding_box()
                        x, y = (3 if selector=='.mg-variant' else width-3), first['y']+first['height']/2
                        target = last['y']+last['height']/2
                        if engine.name == 'chromium':
                            cdp = context.new_cdp_session(page)
                            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                            for step in range(1,9):
                                cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y+(target-y)*step/8}]})
                            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                            cdp.detach()
                        else:
                            page.mouse.move(x,y)
                            page.mouse.down()
                            page.mouse.move(x,target,steps=8)
                            page.mouse.up()
                    reopen()
                    page.wait_for_function('window.savedRecipes.length>0')
                    scrub('.mg-variant',1,4)
                    saved('recipe.preset===4')
                    assert page.evaluate('window.galleryRecords[0].document.recipe.position') == 0
                    scrub('.mg-edit-tool',4,1)
                    page.wait_for_function('document.querySelector(".mg-edit-tool[data-tool=contrast]").getAttribute("aria-pressed")==="true"')
                    page.keyboard.press('Escape')
                    baseline = page.evaluate('window.savedRecipes.length')
                    assert page.locator('.mg-edit-tool').count() == 5
                    actions = ',#close-photo,#save-photo,#print-photo' if app == 'device' else ',#reset,#save,#print'
                    hits = page.locator('.mg-edit-tool,.mg-preset-toggle,.mg-compare'+actions).evaluate_all('(nodes)=>nodes.map(node=>{const b=node.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {control:node.className,hit:hit?.closest("button")?.className,ok:hit?.closest("button")===node}})')
                    assert all(hit['ok'] for hit in hits), hits
                    for box in page.locator('.mg-edit-tool').evaluate_all('(nodes)=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})'):
                        assert box['w'] >= 44 and box['h'] >= 44, box
                        assert box['x'] >= 0 and box['y'] >= 0 and box['x']+box['w'] <= width+1 and box['y']+box['h'] <= height+1, box
                    page.screenshot(path=str(RESULTS / f'{engine.name}-{app}-{width}-quiet.png'))
                    page.locator('.mg-edit-tool[data-tool="exposure"]').click()
                    set_range(1)
                    page.locator('.mg-edit-cancel').click()
                    assert page.evaluate('window.savedRecipes.length') == baseline
                    page.locator('.mg-edit-tool[data-tool="exposure"]').click()
                    set_range(.7)
                    page.locator('.mg-edit-range').focus()
                    page.keyboard.press('ArrowRight')
                    page.locator('.mg-edit-apply').click()
                    saved('recipe.edits?.exposure>.7')
                    assert page.evaluate('window.galleryRecords[0].document.recipe.position') == 0
                    for tool, value in [('contrast',.2),('sharpen',.35),('denoise',.25)]:
                        page.locator(f'.mg-edit-tool[data-tool="{tool}"]').click()
                        set_range(value)
                        page.locator('.mg-edit-apply').click()
                        saved(f'recipe.edits?.{tool}==={value}')
                    page.locator('.mg-preset-toggle').click()
                    assert page.locator('.mg-preset').count() == 11
                    page.locator('.mg-preset[data-preset="P5"]').click()
                    page.screenshot(path=str(RESULTS / f'{engine.name}-{app}-{width}-presets.png'))
                    page.locator('.mg-edit-apply').click()
                    saved('recipe.edits?.preset==="P5"')
                    page.locator('.mg-edit-tool[data-tool="crop"]').click()
                    page.locator('.mg-crop-aspect[data-ratio="1:1"]').click()
                    handle = page.locator('.mg-crop-handle[data-corner="nw"]')
                    handle.focus()
                    page.keyboard.press('Shift+ArrowRight')
                    box = handle.bounding_box()
                    x, y = box['x']+box['width']/2, box['y']+box['height']/2
                    if engine.name == 'chromium':
                        cdp = context.new_cdp_session(page)
                        cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                        cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+12,'y':y+12}]})
                        cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                        cdp.detach()
                    else:
                        page.mouse.move(x,y)
                        page.mouse.down()
                        page.mouse.move(x+12,y+12,steps=5)
                        page.mouse.up()
                    frame = page.locator('.mg-crop-frame').bounding_box()
                    page.mouse.move(frame['x']+frame['width']/2, frame['y']+frame['height']/2)
                    page.mouse.down()
                    page.mouse.move(frame['x']+frame['width']/2+8, frame['y']+frame['height']/2, steps=5)
                    page.mouse.up()
                    page.screenshot(path=str(RESULTS / f'{engine.name}-{app}-{width}-crop.png'))
                    page.locator('.mg-edit-apply').click()
                    saved('recipe.edits?.crop.width<1||recipe.edits?.crop.height<1')
                    page.wait_for_function('()=>{const art=document.querySelector(".mg-art");return Math.abs(art.width-art.height)<=1}')
                    recipe = page.evaluate('structuredClone(window.galleryRecords[0].document.recipe)')
                    assert recipe['edits']['preset'] == 'P5'
                    reopen()
                    page.wait_for_function('()=>{const art=document.querySelector(".mg-art");return Math.abs(art.width-art.height)<=1}')
                    page.locator('.mg-edit-tool[data-tool="exposure"]').click()
                    assert abs(float(page.locator('.mg-edit-range').input_value())-recipe['edits']['exposure']) < .001
                    page.keyboard.press('Escape')
                    page.locator('.mg-edit-panel').wait_for(state='hidden')
                    page.screenshot(path=str(RESULTS / f'{engine.name}-{app}-{width}-restored.png'))
                    assert not errors, errors
                    result = dict(engine=engine.name, app=app, viewport=[width,height], edgeScrubbing=True, edgeInput='touch' if engine.name=='chromium' else 'mouse', draftCancel=True, controls=True, preset='P5', crop='1:1', reopen=True, keyboardIsolation=True, recipe=recipe)
                    results.append(result)
                    print(json.dumps(result), flush=True)
                    context.close()
            browser.close()
finally:
    server.shutdown()
    server.server_close()
    (RESULTS / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
