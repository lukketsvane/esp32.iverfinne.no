"""Exercise original RGB editing, export and archive restoration on both front ends."""
import argparse
import re
import runpy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

H = runpy.run_path(str(Path(__file__).with_name("gallery-image-import-browser.py")))
LOCAL = H["LOCAL"]
W, HGT = 2160, 640


def fixtures(folder):
    paths = []
    for name, size in [("landscape", (W, HGT)), ("portrait", (240, 360))]:
        image = Image.new("RGB", size, (48, 105, 170))
        draw = ImageDraw.Draw(image)
        w, h = size
        for x in range(0,w,12):
            for y in range(0,h,24):
                draw.rectangle((x,y,x+11,y+23), fill=(
                    56+int(155*x/w), 37+int(143*y/h), 46+int(50*(x/w+y/h))))
        draw.rectangle((w//8,h//8,w//3,h//2), fill=(198,137,98))
        draw.rectangle((2*w//3,h//6,7*w//8,2*h//3), fill=(45,141,188))
        path = folder / (name+".png")
        image.save(path)
        paths.append(path)
    return paths


def archive_info(page):
    return page.evaluate("""async () => {
      const {createArchive}=await import('/vendor/archive.mjs'),db=createArchive(),rows=[];
      for(const [index,item] of (await db.list()).entries()){
        const record=await db.get(item.id);
        let bytes;try{bytes=await record.left.arrayBuffer()}
        catch(e){throw new Error('Source bytes unavailable after storage: '+record.sourceName+' '+e)}
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        const hex=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
        rows.push({index,name:record.sourceName,hash:hex,id:item.id,edits:record.originalEdits});
      }return rows;
    }""")


def locator(page, key):
    return page.locator("#"+key)


def choose_record(page, refs, name):
    if not locator(page, refs["grid"]).is_visible():
        locator(page, refs["opener"]).click()
    row = next(r for r in archive_info(page) if r["name"] == name)
    locator(page,refs["grid"]).locator("button").nth(row["index"]).click()
    locator(page,refs["edit"]).click()


def pixel_read(canvas):
    return canvas.evaluate("""c=>{
      const sample=document.createElement('canvas');sample.width=64;sample.height=48;
      const ctx=sample.getContext('2d');ctx.drawImage(c,0,0,64,48);
      const px=ctx.getImageData(0,0,64,48).data;let hash=2166136261,color=0;
      for(let i=0;i<px.length;i++){hash=Math.imul(hash^px[i],16777619);if(i%4===0&&Math.abs(px[i]-px[i+2])>30)color++}
      return {hash:hash>>>0,color};
    }""")


def settle(page):
    page.evaluate("()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")


def drag_grade(page,dialog,distance):
    control=dialog.locator(".mg-edit-adjust")
    area=control.bounding_box()
    assert area, "photo drag target hidden"
    x,y=area["x"]+area["width"]*.52,area["y"]+area["height"]*.50
    target=x+distance
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(target,y,steps=8)
    page.mouse.up()


def exercise(engine,surface,folder,origin,large=False,camera=False):
    context=engine.launch_persistent_context(folder/(engine.name+"-"+surface),
        viewport={"width":390,"height":844},has_touch=True,
        service_workers="block" if origin==LOCAL else "allow")
    try:
        page=context.new_page()
        page.set_default_timeout(9000)
        errors=[]
        page.on("pageerror",lambda error:errors.append(str(error)))
        if origin==LOCAL:
            page.route(re.compile(r"^https?://"),lambda route:H["serve"](route,surface) if
                       urlsplit(route.request.url).netloc==urlsplit(LOCAL).netloc else route.abort())
        page.goto(origin,wait_until="domcontentloaded")
        opener,imp,grid,*_=H["SURFACES"][surface]
        refs=dict(opener=opener,grid=grid,edit='phone-vault-original' if surface=='phone' else 'archive-original')
        files=fixtures(folder)
        hashes={p.name:sha256(p.read_bytes()).hexdigest() for p in files}
        locator(page,opener).click()
        H["choose"](page,imp,files)
        page.wait_for_function("id=>document.getElementById(id).querySelectorAll('button').length===2",arg=grid)
        choose_record(page,refs,"landscape.png")
        test_editor(page,surface,refs,folder,hashes,engine.name)
        if large:test_large(page,surface,refs,folder,imp)
        if camera and surface=="phone" and engine.name=="chromium":
            test_camera(page,folder)
        assert not errors,errors
        print(engine.name,surface,"original RGB editing, archive and export passed",flush=True)
    finally:
        context.close()


def test_editor(page,surface,refs,folder,hashes,engine):
    dialog=page.locator("#original-photo-editor")
    art=dialog.locator(".original-photo-canvas")
    art.wait_for(state="visible")
    page.wait_for_function("el=>!el.disabled",arg=dialog.locator('[data-action="save-original-edits"]').element_handle())
    baseline=pixel_read(art)
    assert baseline["color"]>1200, ("RGB input became monochrome",baseline)

    def open_group(group):
        tool=dialog.locator(f'button.mg-edit-tool[data-tool="{group}"]')
        if tool.get_attribute("aria-pressed")!="true":
            tool.click()

    def change(group,field,fraction):
        open_group(group)
        dialog.locator(f'.mg-edit-option[data-setting="{field}"]').click()
        slider=dialog.locator(".mg-edit-range")
        before=float(slider.input_value())
        drag_grade(page,dialog,round(74*fraction))
        assert float(slider.input_value())!=before, field
        dialog.locator(".mg-edit-apply").click()
        settle(page)
        return pixel_read(art)["hash"]

    def save():
        dialog.locator('[data-action="save-original-edits"]').click()
        dialog.wait_for(state="hidden")

    print(surface,"loaded original",baseline,flush=True)
    # Buttons and sliders must remain reachable even on smaller phones.
    page.set_viewport_size({"width":320,"height":650})
    for group in ("light","color","texture","crop","preset"):
        tool=dialog.locator(f'button.mg-edit-tool[data-tool="{group}"]')
        tool.scroll_into_view_if_needed()
        assert tool.evaluate("""b=>{const r=b.getBoundingClientRect();
            return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}"""),group
    open_group("preset")
    favorites=dialog.locator(".mg-edit-choices")
    if favorites.evaluate("s=>s.scrollHeight>s.clientHeight+4"):
        if engine=="chromium":
            client=page.context.new_cdp_session(page)
            try:
                area=favorites.bounding_box()
                x=area["x"]+area["width"]/2
                for step in range(12):
                    y=area["y"]+area["height"]*(.8-step*.05)
                    client.send("Input.dispatchTouchEvent",{"type":"touchStart" if step==0 else "touchMove",
                                                             "touchPoints":[{"x":x,"y":y}]})
                client.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
            finally:
                client.detach()
        else:
            favorites.hover()
            page.mouse.wheel(0,850)
        page.wait_for_function("el=>el.scrollTop>0",arg=favorites.element_handle())
    dialog.locator(".mg-edit-cancel").click()
    page.set_viewport_size({"width":390,"height":844})
    settle(page)
    baseline=pixel_read(art)
    view=change("light","exposure",.60)
    assert view!=baseline["hash"]
    open_group("light")
    dialog.locator(".mg-edit-compare").click()
    settle(page)
    assert pixel_read(art)["hash"]==baseline["hash"], "before comparison did not show original"
    dialog.locator(".mg-edit-compare").click()
    settle(page)
    dialog.locator(".mg-edit-undo").click()
    settle(page)
    assert pixel_read(art)["hash"]==baseline["hash"], "undo failed"
    open_group("light")
    dialog.locator(".mg-edit-redo").click()
    settle(page)
    assert pixel_read(art)["hash"]==view, "redo failed"
    print(surface,"exposure, compare, undo and redo passed",flush=True)
    for group,field,fraction in (("color","temperature",.68),("color","skinTone",.82),
                                 ("light","fade",.28),("light","vignette",.58)):
        after=change(group,field,fraction)
        assert after!=view, f"{field} did not change rendered pixels"
        view=after

    print(surface,"colour and tone gestures passed",flush=True)
    open_group("preset")
    dialog.locator(".mg-suggest").click()
    preset=dialog.locator('.mg-preset[aria-pressed="true"]').get_attribute("data-preset")
    assert preset, "recommendation did not select a preset"
    dialog.locator(".mg-preset-favorite").click()
    filters=dialog.locator("select.mg-preset-filter,.mg-preset-filter select")
    if filters.count():
        filters.select_option("favorites")
        assert dialog.locator('.mg-preset:not([data-preset=""]):visible').count()==1
        filters.select_option("all")
    slider=dialog.locator(".mg-edit-range")
    slider.press("Home")
    drag_grade(page,dialog,110)
    dialog.locator(".mg-edit-apply").click()
    open_group("preset")
    dialog.locator(".mg-recipe-save").click()
    dialog.locator(".mg-edit-apply").click()
    settle(page)
    pre_geometry=pixel_read(art)["hash"]
    open_group("crop")
    dialog.locator('[data-transform="flipX"]').click()
    for field in ("geometry.straighten","geometry.skewX","geometry.skewY"):
        dialog.locator(f'[data-setting="{field}"]').click()
        slider=dialog.locator(".mg-edit-range")
        slider.press("ArrowRight")
        assert float(slider.input_value())!=0,field
    dialog.locator(".mg-edit-cancel").click()
    settle(page)
    assert pixel_read(art)["hash"]==pre_geometry, "cancel altered source view"
    open_group("crop")
    dialog.locator('[data-transform="turnRight"]').click()
    dialog.locator(".mg-edit-apply").click()
    settle(page)
    assert art.evaluate("c=>c.width<c.height"), "portrait orientation after clockwise turn"
    after_geometry=pixel_read(art)["hash"]
    assert after_geometry!=pre_geometry
    open_group("light")
    dialog.locator(".mg-edit-compare").click()
    settle(page)
    assert art.evaluate("c=>c.width<c.height"), "compare dropped rotation"
    assert pixel_read(art)["hash"]!=after_geometry, "compare retained grading"
    dialog.locator(".mg-edit-compare").click()
    dialog.locator(".mg-edit-apply").click()
    save()
    print(surface,"geometry and photo save passed",flush=True)
    rows=archive_info(page)
    assert {r["name"]:r["hash"] for r in rows}==hashes, "save altered original bytes"
    image=locator(page,"phone-vault-image" if surface=="phone" else "archive-photo")
    page.wait_for_function("el=>el.complete&&el.naturalWidth>0",arg=image.element_handle())
    save_detail=locator(page,"phone-vault-save" if surface=="phone" else "archive-left")
    with page.expect_download(timeout=20000) as dl:
        save_detail.click()
    target=folder/f"{surface}-edited.png"
    dl.value.save_as(target)
    with Image.open(target) as exported:
        assert exported.size==(HGT,W), (exported.size, "native dimensions")
        assert exported.format=="PNG", exported.format
        r,g,b=exported.convert("RGB").split()
        assert r.tobytes()!=b.tobytes(), "export became grayscale"
    page.reload(wait_until="domcontentloaded")
    choose_record(page,refs,"landscape.png")
    art.wait_for(state="visible")
    page.wait_for_function("el=>!el.disabled",arg=dialog.locator('[data-action="save-original-edits"]').element_handle())
    settle(page)
    assert pixel_read(art)["hash"]==after_geometry, "archive reload lost edits"
    dialog.locator('[data-action="cancel-original-edits"]').click()
    locator(page,"phone-vault-back" if surface=="phone" else "archive-back").click()
    choose_record(page,refs,"portrait.png")
    art.wait_for(state="visible")
    page.wait_for_function("el=>!el.disabled",arg=dialog.locator('[data-action="save-original-edits"]').element_handle())
    settle(page)
    portrait=pixel_read(art)["hash"]
    open_group("preset")
    dialog.locator(".mg-recipe-apply").click()
    dialog.locator(".mg-edit-apply").click()
    settle(page)
    assert pixel_read(art)["hash"]!=portrait, "recipe did not grade second photo"
    save()
    rows=archive_info(page)
    assert {r["name"]:r["hash"] for r in rows}==hashes
    assert len(rows)==2
    left=next(r for r in rows if r["name"]=="landscape.png")["edits"]
    right=next(r for r in rows if r["name"]=="portrait.png")["edits"]
    assert left["preset"]==right["preset"] and left["strength"]==right["strength"]
    assert left["geometry"]!=right["geometry"], "reusable film look copied the crop geometry"
    locator(page,refs["edit"]).click()
    open_group("crop")
    dialog.locator('[data-ratio="1:1"]').click()
    dialog.locator(".mg-edit-apply").click()
    save()
    with page.expect_download(timeout=20000) as dl:
        save_detail.click()
    target=folder/f"{surface}-square.png"
    dl.value.save_as(target)
    with Image.open(target) as exported:
        assert exported.size==(240,240), (exported.size, "1:1 crop native dimensions")
    assert {row["name"]:row["hash"] for row in archive_info(page)}==hashes


def test_large(page,surface,refs,folder,picker):
    # A real 8K decoded source, edited and exported from the archive UI.
    source=folder/"large-fixture.png"
    size=(7680,4320)
    image=Image.new("RGB",size,(66,110,138));img=ImageDraw.Draw(image)
    img.rectangle((100,100,1000,700),fill=(172,82,53));image.save(source)
    del img,image
    locator(page,"phone-vault-back" if surface=="phone" else "archive-back").click()
    H["choose"](page,picker,[source])
    locator(page,refs["edit"]).click()
    dialog=page.locator("#original-photo-editor")
    dialog.locator('button.mg-edit-tool[data-tool="light"]').click()
    dialog.locator('[data-setting="exposure"]').click()
    drag_grade(page,dialog,34)
    dialog.locator(".mg-edit-apply").click()
    dialog.locator('[data-action="save-original-edits"]').click()
    dialog.wait_for(state="hidden",timeout=120000)
    with page.expect_download(timeout=120000) as download:
        locator(page,"phone-vault-save" if surface=="phone" else "archive-left").click()
    result=folder/"8k-export.png";download.value.save_as(result)
    with Image.open(result) as exported:
        assert exported.size==size and exported.format=="PNG"
        center=exported.getpixel((size[0]//2,size[1]//2))
        assert tuple(center[:3])!=(66,110,138)
    print(surface,"real 8K edit rendered to",size,center,flush=True)



def test_camera(page,folder):
    # Only the sensor is simulated. The browser handles video, shutter, capture,
    # archive, editor and download using the same paths as a real phone camera.
    page.add_init_script("""navigator.mediaDevices.getUserMedia=async()=>{
        const c=document.createElement('canvas');c.width=640;c.height=360;
        const g=c.getContext('2d');
        function draw(){g.fillStyle='rgb(42,128,213)';g.fillRect(0,0,640,360);
          g.fillStyle='rgb(197,55,38)';g.fillRect(40,40,180,140)}
        draw();const stream=c.captureStream(12);
        const timer=setInterval(()=>stream.active?draw():clearInterval(timer),80);
        return stream;
      }""")
    page.reload(wait_until="domcontentloaded")
    shutter=locator(page,"phone-shutter")
    shutter.click()
    page.wait_for_function("()=>document.querySelector('#video').videoWidth===640")
    shutter.click()
    locator(page,"review-original").click()
    dialog=page.locator("#original-photo-editor")
    page.wait_for_function("el=>!el.disabled",arg=dialog.locator('[data-action="save-original-edits"]').element_handle())
    canvas=dialog.locator(".original-photo-canvas")
    assert canvas.evaluate("c=>[c.width,c.height]")==[640,360]
    info=canvas.evaluate("""c=>Array.from(c.getContext('2d').getImageData(400,200,1,1).data)""")
    assert info[2]-info[0]>140 and info[1]-info[0]>65, ("native sensor color",info)
    dialog.locator('button.mg-edit-tool[data-tool="light"]').click()
    dialog.locator('[data-setting="exposure"]').click()
    drag_grade(page,dialog,30)
    dialog.locator(".mg-edit-apply").click()
    dialog.locator('[data-action="save-original-edits"]').click()
    dialog.wait_for(state="hidden")
    with page.expect_download() as dl:
        locator(page,"phone-vault-save").click()
    target=folder/"camera-export.png"
    dl.value.save_as(target)
    with Image.open(target) as exported:
        assert exported.size==(640,360)
        assert exported.getpixel((400,200))[1] > info[1]+5
    print("phone camera shutter to editable native 640x360 RGB and saved download passed",flush=True)



if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--origin",default=LOCAL)
    parser.add_argument("--engine",choices=("chromium","webkit","both"),default="both")
    parser.add_argument("--surface",choices=("phone","device","both"),default="both")
    parser.add_argument("--large",action="store_true",help="Also grade and export a 7680×4320 colour original")
    parser.add_argument("--camera",action="store_true",help="Exercise the hosted Chromium shutter with a synthetic colour sensor")
    args=parser.parse_args()
    with TemporaryDirectory() as directory,sync_playwright() as browsers:
        for engine in ("chromium","webkit"):
            for surface in ("phone","device"):
                if args.engine in (engine,"both") and args.surface in (surface,"both"):
                    if args.origin!=LOCAL and surface!="phone":parser.error("Public origin serves phone only")
                    exercise(getattr(browsers,engine),surface,Path(directory),args.origin,args.large,args.camera)
