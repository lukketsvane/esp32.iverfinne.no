"""Exercise real phone capture gestures and IndexedDB with an isolated synthetic camera."""
import argparse
import json
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://camera.test"
FIXTURE = """
(() => {
  navigator.serviceWorker?.register && Object.defineProperty(navigator.serviceWorker, 'register', {value: async () => ({})});
  window.__ENTROPI_DEPTH_ENDPOINT = '/fixture-depth';
  const scene = document.createElement('canvas'); scene.width=1024; scene.height=240;
  const ctx=scene.getContext('2d');
  let seed=92953;
  function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  ctx.fillStyle='#425469';ctx.fillRect(0,0,1024,240);
  for(let i=0;i<9000;i++) {
    ctx.fillStyle='rgb('+[0,0,0].map(()=>Math.floor(rand()*255)).join(',')+')';
    ctx.fillRect(rand()*1024,rand()*240,3+rand()*12,3+rand()*12);
  }
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
  const feed=canvas.getContext('2d');let offset=0;
  const draw=()=>feed.drawImage(scene,offset,0,320,240,0,0,320,240);
  window.panFixtureTo=x=>{offset=x;draw()};
  draw();
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value:async()=>{
    const stream=canvas.captureStream(15);
    const interval=setInterval(draw,50);
    stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(interval));
    return stream;
  }});
})();
"""


def serve(route):
    path = urlsplit(route.request.url).path.lstrip("/")
    if path == "fixture-depth":
        # No neural model download; this test validates capture, registration and storage.
        route.fulfill(body=bytes(range(64))*64,
                      headers={"Content-Type":"application/octet-stream","X-Depth-Width":"32","X-Depth-Height":"32"})
        return
    target = (ROOT / (path or "index.html")).resolve()
    if target.is_relative_to(ROOT) and target.is_file():
        if target.suffix == ".mjs":
            route.fulfill(path=target,content_type="text/javascript")
        else:
            route.fulfill(path=target)
    else:
        route.fulfill(status=404)


def exercise(context, scenario, baseline, engine):
    page = context.new_page()
    errors = []
    page.on("pageerror",lambda e:errors.append(str(e)))
    try:
        page.goto(ORIGIN)
        page.wait_for_selector("#capture-plane")
        finder = page.locator("#viewfinder").bounding_box()
        x,y = finder["x"]+finder["width"]/2,finder["y"]+finder["height"]/2
        if not page.evaluate("document.querySelector('#video').videoWidth"):
            page.mouse.click(x,y)
        page.wait_for_function("document.querySelector('#video').readyState >= 2")
        page.evaluate("async()=>{window.db=(await import('/vendor/archive.mjs')).createArchive()}")
        previous = page.evaluate("async()=>(await db.list()).map(i=>i.id)")
        touch = context.new_cdp_session(page) if engine == "chromium" else None
        if touch:
            touch.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":x,"y":y}]})
        else:
            page.mouse.move(x,y)
            page.mouse.down()
        if scenario != "tap":
            page.wait_for_function("document.querySelector('#capture-plane').dataset.panorama==='recording'")
            def frame(count):
                page.wait_for_function(
                    "n=>Number(document.querySelector('#scan-progress span').textContent.match(/(\\d+)$/)?.[1]) >= n",
                    arg=count,timeout=9000)
            frame(1)
            if scenario == "cancel":
                page.keyboard.press("Escape")
            if scenario in ("stationary","disjoint","pan"):
                if scenario != "stationary":
                    page.evaluate("x=>panFixtureTo(x)",64 if scenario=="pan" else 640)
                frame(2)
            if scenario == "pan":
                page.evaluate("panFixtureTo(112)");frame(3)
        if touch:
            touch.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
        else:
            page.mouse.up()
        if scenario == "cancel":
            page.wait_for_timeout(700)
            assert page.evaluate("async()=>(await db.list()).length")==len(previous)
            assert page.locator("#scan-progress").is_hidden()
            return {"saved":0}
        deadline=time.monotonic()+25
        while time.monotonic()<deadline:
            count=page.evaluate("async()=>(await db.list()).length")
            overlay=page.locator("#scan-progress").inner_text() if page.locator("#scan-progress").is_visible() else ""
            if count>len(previous) or (baseline and ("Ingen overlappande" in overlay or "Panorama treng" in overlay)):
                break
            page.wait_for_timeout(100)
        else:
            info=page.evaluate("""()=>({status:document.querySelector('#status').textContent,phase:document.querySelector('#studio').className,feedback:document.querySelector('#print-status').textContent,overlay:document.querySelector('#scan-progress').textContent})""")
            raise AssertionError((scenario,info,errors))
        summary = page.evaluate("""async ids=>{
          const added=(await db.list()).filter(i=>!ids.includes(i.id)), output=[];
          for(const item of added){
            const photo=await db.get(item.id), im=new Image();
            im.src=URL.createObjectURL(photo.left);await im.decode();URL.revokeObjectURL(im.src);
            output.push({width:im.naturalWidth,height:im.naturalHeight,frames:photo.panorama?.acceptedFrames??0,
                         sourceFrames:photo.panorama?.frames?.length??0});
          }
          const status=document.querySelector('#scan-progress');
          return {saved:output.length,originals:output,visibleOverlay:status.hidden?'':status.innerText};
        }""",previous)
        if not baseline:
            assert summary["saved"]==1,summary
            photo=summary["originals"][0]
            if scenario=="pan":
                assert photo["width"]>360 and photo["frames"]>=2,photo
            else:
                assert photo["frames"]==0 and photo["sourceFrames"]==0,photo
            page.wait_for_function("document.querySelector('#scan-progress').hidden",timeout=10000)
            assert not errors,errors
        return summary
    finally:
        page.close()


if __name__=="__main__":
    args=argparse.ArgumentParser()
    args.add_argument("--baseline",action="store_true",help="Print observed behavior without asserting the fixes")
    args.add_argument("--engine",default="chromium",choices=["chromium","webkit"])
    args.add_argument("cases",nargs="*",default=["tap","short","stationary","disjoint","pan","cancel"])
    args=args.parse_args()
    with TemporaryDirectory() as temp, sync_playwright() as browsers:
        context=getattr(browsers,args.engine).launch_persistent_context(temp,viewport={"width":390,"height":844},has_touch=True,service_workers="block")
        try:
            context.add_init_script(FIXTURE)
            context.route("**/*",serve)
            for case in args.cases:
                print(args.engine,case,json.dumps(exercise(context,case,args.baseline,args.engine)),flush=True)
        finally:
            context.close()
