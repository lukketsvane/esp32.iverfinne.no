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
            self.wfile.write(json.dumps(dict(camera_id='fixture', camera_ready=True, stream_ready=True, psram=True, framesize=6, photo_framesize=10,transport='usb',width=640,height=480,brightness=0,ae_level=0)).encode())
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
                    stream_requests=[]
                    page.on('request',lambda request:stream_requests.append(request.url) if request.url.split('?')[0].endswith('/stream') else None)
                    page.goto(origin + ('/device-app' if app == 'device' else '/'))
                    ids = dict(open='open-archive', grid='archive-grid', edit='archive-edit') if app == 'device' else dict(open='open-gallery', grid='phone-vault-grid', edit='phone-vault-edit')
                    def reopen():
                        if app == 'device' and page.locator('#photo-dialog').evaluate('(dialog)=>dialog.open'):
                            page.locator('#close-photo').click()
                        elif not page.locator('#'+ids['open']).is_visible():
                            page.locator('#close-photo' if app == 'device' else '#reset').click()
                        gallery=page.locator('#'+ids['open'])
                        placement=gallery.bounding_box()
                        assert placement['x']>=width-70 and placement['y']<=20,placement
                        gallery.click()
                        try:
                            page.locator('#'+ids['grid']+' button').first.click()
                        except Exception:
                            print(json.dumps(dict(engine=engine.name,app=app,viewport=[width,height],errors=errors,state=page.evaluate('({fixtureError:window.galleryFixtureError,records:window.galleryRecords?.length,text:document.body.innerText})'))),flush=True)
                            raise
                        page.locator('#'+ids['edit']).click()
                        page.locator('.mg-edit-tool[data-tool="light"]').wait_for(state='visible')
                    def set_range(value):
                        page.locator('.mg-edit-range').evaluate('(input,value)=>{input.value=String(value);input.dispatchEvent(new Event("input",{bubbles:true}))}', value)
                    def open_setting(name):
                        group='light' if name in ['exposure','contrast','highlights','shadows'] else 'color' if name in ['saturation','temperature','tint'] else 'texture'
                        node=page.locator(f'.mg-edit-tool[data-tool="{group}"]')
                        if node.get_attribute('aria-pressed')!='true':
                            node.click()
                        if group=='color' and page.locator('.mg-hsl-options').is_visible():
                            page.locator('.mg-hsl-back').click()
                        page.locator(f'.mg-edit-option[data-setting="{name}"]').click()
                    def two_touch(dx=0, dy=0, factor=1, steps=8):
                        box=page.locator('.mg-view').bounding_box()
                        cx,cy=box['x']+box['width']/2,box['y']+box['height']/2
                        if engine.name=='chromium':
                            cdp=context.new_cdp_session(page)
                            def points(t):
                                half=20*(1+(factor-1)*t)
                                return [{'id':1,'x':cx+dx*t-half,'y':cy+dy*t},{'id':2,'x':cx+dx*t+half,'y':cy+dy*t}]
                            try:
                                cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':points(0)})
                                for step in range(1,steps+1):
                                    cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':points(step/steps)})
                                cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                            finally:
                                cdp.detach()
                        else:
                            page.locator('.mg-view').evaluate('''async(host,args)=>{
                                const [cx,cy,dx,dy,factor,steps]=args,capture=host.setPointerCapture;
                                host.setPointerCapture=()=>{};
                                const send=(type,id,x,y)=>host.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:id===1,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y}));
                                try{
                                    send('pointerdown',1,cx-20,cy);send('pointerdown',2,cx+20,cy);
                                    for(let step=1;step<=steps;step++){const t=step/steps,half=20*(1+(factor-1)*t);send('pointermove',1,cx+dx*t-half,cy+dy*t);send('pointermove',2,cx+dx*t+half,cy+dy*t);await new Promise(requestAnimationFrame)}
                                    send('pointerup',1,cx+dx-20*factor,cy+dy);send('pointerup',2,cx+dx+20*factor,cy+dy);
                                }finally{host.setPointerCapture=capture}
                            }''',[cx,cy,dx,dy,factor,steps])
                    def navigation_geometry():
                        return page.locator('.mg-view').evaluate('''host=>{
                            const art=host.querySelector('.mg-art'),box=art.getBoundingClientRect(),parent=host.getBoundingClientRect(),fit=Math.min(box.width/art.width,box.height/art.height),w=art.width*fit,h=art.height*fit,left=box.left+(box.width-w)/2,top=box.top+(box.height-h)/2,seam=host.querySelector('.mg-seam'),line=seam.getBoundingClientRect(),original=[...host.querySelectorAll('.mg-original')].find(node=>!node.hidden);
                            return {scale:Number(host.style.getPropertyValue('--view-scale')||1),x:parseFloat(host.style.getPropertyValue('--view-x'))||0,y:parseFloat(host.style.getPropertyValue('--view-y'))||0,viewport:visualViewport.scale,source:[art.width,art.height],box:[box.width,box.height],image:{left,top,width:w,height:h},host:{left:parent.left,top:parent.top,width:parent.width,height:parent.height},split:Number(seam.getAttribute('aria-valuenow'))/100,seam:{left:line.left,top:line.top,height:line.height},transform:getComputedStyle(art).transform,originalTransform:original?getComputedStyle(original).transform:null};
                        }''')
                    def assert_split_aligned():
                        g=navigation_geometry();picture=g['image'];parent=g['host'];line=g['seam']
                        assert abs(line['left']-(picture['left']+picture['width']*g['split']))<max(2,picture['width']*.005+.1),g
                        top=max(parent['top'],picture['top']);bottom=min(parent['top']+parent['height'],picture['top']+picture['height'])
                        assert abs(line['top']-top)<2 and abs(line['height']-max(0,bottom-top))<2,g
                        assert g['transform']==g['originalTransform'],g
                        assert abs(g['viewport']-1)<.001,g
                        return g
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
                    assert not page.locator('#recenter-photo' if app=='device' else '#recenter').is_visible()
                    if app == 'device':
                        previous = page.evaluate('''()=>({id:window.galleryRecords[0].id,recipe:structuredClone(window.galleryRecords[0].document.recipe),pose:['--view-scale','--view-x','--view-y'].map(key=>document.getElementById('marigold-view').style.getPropertyValue(key))})''')
                        stream_before=len(stream_requests)
                        page.locator('#review-gallery').click()
                        page.locator('#archive').wait_for(state='visible')
                        page.evaluate('window.dispatchEvent(new Event("online"))')
                        page.wait_for_timeout(100)
                        assert not page.locator('#photo-dialog').evaluate('(dialog)=>dialog.open')
                        assert page.evaluate('!!document.activeElement.closest("#archive")')
                        assert len(stream_requests)==stream_before,stream_requests
                        page.locator('#close-archive').click()
                        page.wait_for_function('document.getElementById("photo-dialog").open&&!document.getElementById("marigold-view").hidden')
                        restored = page.evaluate('''()=>({id:window.galleryRecords[0].id,recipe:structuredClone(window.galleryRecords[0].document.recipe),pose:['--view-scale','--view-x','--view-y'].map(key=>document.getElementById('marigold-view').style.getPropertyValue(key))})''')
                        assert restored==previous,(previous,restored)
                        assert page.evaluate('document.activeElement.id')=='review-gallery'
                        assert len(stream_requests)==stream_before,stream_requests

                    scrub('.mg-variant',1,4)
                    saved('recipe.preset===4')
                    assert page.evaluate('window.galleryRecords[0].document.recipe.position') == 0
                    scrub('.mg-edit-tool',4,1)
                    page.wait_for_function('document.querySelector(".mg-edit-tool[data-tool=color]").getAttribute("aria-pressed")==="true"')
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
                    open_setting("exposure")
                    set_range(1)
                    box=page.locator('.mg-edit-adjust').bounding_box()
                    x,y=box['x']+20,box['y']+box['height']/2
                    if engine.name=='chromium':
                        cdp=context.new_cdp_session(page)
                        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                        cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+30,'y':y}]})
                        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                        cdp.detach()
                    else:
                        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+30,y,steps=5);page.mouse.up()
                    assert float(page.locator('.mg-edit-range').input_value())>1
                    compact=page.locator('.mg-edit-panel').evaluate('(panel)=>({width:panel.getBoundingClientRect().width,background:getComputedStyle(panel).backgroundColor,range:panel.querySelector(".mg-edit-range").getBoundingClientRect().width,previews:panel.querySelectorAll("canvas").length})')
                    assert compact['width']<=100 and compact['range']<=1 and compact['previews']==0,compact
                    assert compact['background']=='rgba(0, 0, 0, 0)',compact
                    page.locator('.mg-edit-cancel').click()
                    assert page.evaluate('window.savedRecipes.length') == baseline
                    open_setting("exposure")
                    set_range(.7)
                    page.locator('.mg-edit-range').focus()
                    page.keyboard.press('ArrowRight')
                    page.locator('.mg-edit-apply').click()
                    saved('recipe.edits?.exposure>.7')
                    assert page.evaluate('window.galleryRecords[0].document.recipe.position') == 0
                    for tool, value in [('contrast',.2),('highlights',-.15),('shadows',.1),('saturation',.2),('temperature',.08),('tint',-.05),('sharpen',.35),('denoise',.25),('grain.strength',.18),('grain.size',.35),('grain.color',.25)]:
                        open_setting(tool)
                        set_range(value)
                        page.locator('.mg-edit-apply').click()
                        saved(f'recipe.edits?.{tool}==={value}')
                    page.locator('.mg-edit-tool[data-tool="color"]').click()
                    page.locator('.mg-edit-option[data-setting="hsl"]').click()
                    assert page.locator('.mg-hsl-channel').count()==6
                    for channel,component,value in [('red','hue',.2),('red','saturation',.25),('red','lightness',-.15),('blue','saturation',-.2)]:
                        page.locator(f'.mg-hsl-channel[data-channel="{channel}"]').click()
                        page.locator(f'.mg-hsl-component[data-component="{component}"]').click()
                        set_range(value)
                    page.screenshot(path=str(RESULTS/f'{engine.name}-{app}-{width}-hsl.png'))
                    page.locator('.mg-edit-apply').click()
                    saved('recipe.edits?.hsl.red.hue===.2&&recipe.edits.hsl.blue.saturation===-.2')
                    page.locator('.mg-preset-toggle').click()
                    assert page.locator('.mg-preset').count()==12
                    page.locator('.mg-preset[data-preset="P5"]').click()
                    page.screenshot(path=str(RESULTS / f'{engine.name}-{app}-{width}-presets.png'))
                    page.locator('.mg-edit-apply').click()
                    saved('recipe.edits?.preset==="P5"')
                    page.locator('.mg-preset-toggle').click()
                    page.locator('.mg-preset[data-preset="HB2"]').click()
                    set_range(.65)
                    page.locator('.mg-edit-apply').click()
                    saved('recipe.edits?.preset==="HB2"&&recipe.edits.strength===.65')
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
                    assert recipe['edits']['preset']=='HB2'
                    assert recipe['edits']['grain']['strength']==.18
                    assert recipe['edits']['hsl']['red']['hue']==.2
                    reopen()
                    page.wait_for_function('()=>{const art=document.querySelector(".mg-art");return Math.abs(art.width-art.height)<=1}')
                    open_setting("exposure")
                    assert abs(float(page.locator('.mg-edit-range').input_value())-recipe['edits']['exposure']) < .001
                    assert page.locator('.mg-editor').evaluate('(editor)=>editor.contains(document.activeElement)'),page.evaluate('document.activeElement.outerHTML')
                    page.keyboard.press('Escape')
                    page.locator('.mg-edit-panel').wait_for(state='hidden')
                    page.screenshot(path=str(RESULTS / f'{engine.name}-{app}-{width}-restored.png'))
                    untouched=page.evaluate('JSON.stringify(window.galleryRecords[0].document.recipe)')
                    fitted=navigation_geometry()
                    two_touch(dx=12,dy=9)
                    moved=navigation_geometry()
                    assert abs(moved['scale']-1)<.001 and moved['x']>8 and moved['y']>5,moved
                    two_touch(factor=2)
                    zoomed=navigation_geometry()
                    assert abs(zoomed['scale']-2)<.02,zoomed
                    assert abs(zoomed['box'][0]/fitted['box'][0]-2)<.02,zoomed
                    assert zoomed['source']==fitted['source'] and abs(zoomed['viewport']-1)<.001,zoomed
                    page.screenshot(path=str(RESULTS/f'{engine.name}-{app}-{width}-navigation.png'))
                    page.locator('.mg-compare').click()
                    compared=assert_split_aligned()
                    picture=compared['image'];line=compared['seam'];parent=compared['host']
                    y=max(parent['top']+30,min(parent['top']+parent['height']-30,line['top']+line['height']/2))
                    destination=max(parent['left']+55,min(parent['left']+parent['width']-145,picture['left']+picture['width']*.62))
                    page.mouse.move(line['left'],y);page.mouse.down();page.mouse.move(destination,y,steps=8);page.mouse.up()
                    adjusted=assert_split_aligned()
                    assert abs(adjusted['split']-compared['split'])>.03,adjusted
                    two_touch(dx=-8,dy=-7,factor=1.15)
                    transformed=assert_split_aligned()
                    assert abs(transformed['split']-adjusted['split'])<.001,transformed
                    page.screenshot(path=str(RESULTS/f'{engine.name}-{app}-{width}-split-navigation.png'))
                    page.locator('.mg-compare').click()
                    two_touch(steps=0);page.wait_for_timeout(60);two_touch(steps=0)
                    reset=navigation_geometry()
                    assert abs(reset['scale']-1)<.001 and abs(reset['x'])<.01 and abs(reset['y'])<.01,reset
                    assert abs(reset['viewport']-1)<.001,reset
                    assert page.evaluate('JSON.stringify(window.galleryRecords[0].document.recipe)')==untouched
                    assert not errors, errors
                    result = dict(engine=engine.name, app=app, viewport=[width,height], edgeScrubbing=True, edgeInput='touch' if engine.name=='chromium' else 'mouse', draftCancel=True, controls=True,adjustmentGesture=True,compactPanel=True,hsl=True,grain=True,preset='HB2', crop='1:1', reopen=True, keyboardIsolation=True, galleryTopRight=True,galleryReturn=app=='device',panZoom=True,splitAligned=True,pageZoomLocked=True,navigationInput='cdp-touch' if engine.name=='chromium' else 'pointer-events', recipe=recipe)
                    results.append(result)
                    print(json.dumps(result), flush=True)
                    context.close()
            browser.close()
finally:
    server.shutdown()
    server.server_close()
    (RESULTS / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
