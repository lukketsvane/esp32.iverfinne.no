"""Check the real depth edit, loop preview and exported GIF in both camera surfaces."""
import argparse
import hashlib
import runpy
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image
from playwright.sync_api import sync_playwright

HELPERS = runpy.run_path(str(Path(__file__).with_name("gallery-image-import-browser.py")))
ORIGIN = HELPERS["LOCAL"]
WIDTH, HEIGHT = 32, 24
FRAMES = 60

FIXTURE = """async () => {
  const {createEntropiDocument, encodeEntropiDocument} = await import('/vendor/entropi-document.mjs');
  const {toneDepth} = await import('/vendor/vathography.mjs');
  const {loopToneParameters} = await import('/vendor/vathography-loop.mjs');
  const {rgbaToGrayIndices} = await import('/vendor/gif-encoder.mjs');
  const width=32, height=24, canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');context.fillStyle='#777';context.fillRect(0,0,width,height);
  const photo=await new Promise(resolve=>canvas.toBlob(resolve));
  const depth=Float32Array.from({length:width*height},(_,i)=>((i*71)%499)/498);
  const recipe={preset:1,position:0,width:1};
  const source=await encodeEntropiDocument(createEntropiDocument({id:'depth-loop-edit',left:photo,preview:photo,
    result:{width,height,depth,polarity:'near',normalized:true},recipe}));
  window.toneFrame=(mode, phase, position)=> {
    const base={position,width:1};
    const tone=mode ? loopToneParameters(base,mode,phase) : base;
    return Array.from(rgbaToGrayIndices(toneDepth(depth,width,height,{preset:1,...tone})));
  };
  window.visibleTone=()=> {
    const art=document.querySelector('#marigold-view .mg-art');
    return Array.from(rgbaToGrayIndices(art.getContext('2d').getImageData(0,0,art.width,art.height).data));
  };
  return Array.from(new Uint8Array(await source.arrayBuffer()));
}"""

# Only animation timestamps are controlled. Import, dragging, selection and download use the page UI.
SAMPLE = """({mode,position})=>{
  const request=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
  let id=-1, queue=new Map();
  window.requestAnimationFrame=fn=>{queue.set(--id,fn);return id};
  window.cancelAnimationFrame=n=>{if(!queue.delete(n))cancel.call(window,n)};
  const step=time=>{const batch=[...queue.values()];queue.clear();for(const fn of batch)fn(time)};
  const play=document.querySelector('#mg-loop-play'), out={};
  try {
    play.click();
    if(play.getAttribute('aria-pressed')!=='true')throw Error('Loop did not start');
    for(const i of [0,5,15,30,45,59,60,75]){
      step(10000+50*i);
      const actual=window.visibleTone(), expected=window.toneFrame(mode,i/60,position);
      if(actual.length!==expected.length || !actual.every((v,j)=>v===expected[j]))
        throw Error(mode+' preview mismatch at '+i+'; first pixels '+actual.slice(0,4)+' vs '+expected.slice(0,4));
      if(i<60)out[i]=actual;
    }
    play.click();step(14000);
    if(play.getAttribute('aria-pressed')!=='false')throw Error('Loop did not stop');
    return {frames:out,restored:window.visibleTone()};
  } finally {
    window.requestAnimationFrame=request;window.cancelAnimationFrame=cancel;
    for(const fn of queue.values())request.call(window,fn);
  }
}"""


def test_surface(engine, surface, folder, origin):
    context = engine.launch_persistent_context(folder / (engine.name + surface),
                                               viewport={"width": 390, "height": 844},
                                               reduced_motion="reduce", service_workers="block")
    try:
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        if origin == ORIGIN:
            page.route("http://**/*", lambda route: HELPERS["serve"](route, surface))
        page.goto(origin, wait_until="domcontentloaded")
        payload = page.evaluate(FIXTURE)
        open_button, import_button, *_ = HELPERS["SURFACES"][surface]
        page.locator("#" + open_button).click()
        with page.expect_file_chooser() as picker:
            page.locator("#" + import_button).click()
        picker.value.set_files({"name": "depth.entropi", "mimeType": "application/x-entropi",
                                "buffer": bytes(payload)})
        modes = page.locator("#mg-loop-mode")
        modes.wait_for(state="visible")
        page.wait_for_function("window.visibleTone().length===32*24")
        assert page.locator(".mg-loop-art").count() == 0
        values = modes.locator("option").evaluate_all("options=>options.map(o=>o.value)")
        assert len(set(values)) >= 6

        host = page.locator("#marigold-view")
        navigation = ("#open-gallery", "#reset") if surface == "phone" else ("#review-gallery", "#close-photo")
        play = page.locator("#mg-loop-play")
        for width, height in ((320,650), (844,390), (390,844)):
            page.set_viewport_size({"width": width, "height": height})
            box = host.bounding_box()
            for key in ("#mg-loop-mode", "#mg-loop-play", *navigation):
                target = page.locator(key)
                assert target.is_visible(), (width, height, key, "hidden")
                b = target.bounding_box()
                assert target.evaluate("""el=>{
                    const r=el.getBoundingClientRect();
                    return el.contains(document.elementFromPoint(r.left+r.width/2, r.top+r.height/2));
                }"""), (width, height, key, b, "obstructed")
                if key in ("#mg-loop-mode", "#mg-loop-play"):
                    assert (b["y"]+b["height"] <= box["y"]+1 or b["y"] >= box["y"]+box["height"]-1 or
                            b["x"]+b["width"] <= box["x"]+1 or b["x"] >= box["x"]+box["width"]-1), (
                        width, height, key, b, box, "overlaps image")
            play.click()
            assert play.get_attribute("aria-pressed") == "true"
            modes.select_option(values[-1])
            assert play.get_attribute("aria-pressed") == "true"
            play.click()
            assert play.get_attribute("aria-pressed") == "false"
        box = host.bounding_box()
        x, y = int(box["x"] + .40*box["width"]), int(box["y"] + .5*box["height"])
        assert page.evaluate("([x,y])=>!!document.elementFromPoint(x,y)?.closest('#marigold-view')", [x,y])
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 40, y, steps=2)
        page.mouse.up()
        position = 40 / box["width"]
        page.wait_for_function("position=>{const frame=window.toneFrame(null,0,position);return window.visibleTone().every((v,i)=>v===frame[i])}",
                               arg=position, timeout=5000)
        base = bytes(page.evaluate("window.visibleTone()"))
        signatures = []
        for mode in values:
            modes.select_option(mode)
            sampled = page.evaluate(SAMPLE, {"mode": mode, "position": position})
            assert bytes(sampled["restored"]) == base, (mode, "stop changed base")
            save = "#save" if surface == "phone" else "#save-photo"
            page.locator(save).press("ArrowUp")
            with page.expect_download(timeout=15000) as downloading:
                page.get_by_role("menuitem").filter(has_text="Loop GIF").click()
            target = folder / f"{engine.name}-{surface}-{mode}.gif"
            downloading.value.save_as(target)
            with Image.open(target) as gif:
                assert gif.n_frames == FRAMES and gif.size == (WIDTH,HEIGHT) and gif.info["loop"] == 0
                signature = hashlib.sha256()
                for i in range(FRAMES):
                    gif.seek(i)
                    pixels = gif.convert("L").tobytes()
                    signature.update(pixels)
                    assert gif.info["duration"] == 50
                    if str(i) in sampled["frames"]:
                        assert pixels == bytes(sampled["frames"][str(i)]), (mode,i,"preview/GIF mismatch")
                signatures.append(signature.digest())
        assert len(set(signatures)) == len(values), "Two GIF modes produced identical sequences"
        # Drag while playback is active. Frame offsets must not leak back into the saved edit.
        play.click()
        page.wait_for_timeout(250)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - 24, y, steps=2)
        page.mouse.up()
        assert play.get_attribute("aria-pressed") == "true"
        play.click()
        page.wait_for_function("""position=>{
              const expected=window.toneFrame(null,0,position);
              return window.visibleTone().every((v,i)=>v===expected[i])
            }""", arg=position - 24 / box["width"], timeout=5000)
        assert not errors, errors
        print(engine.name, surface, len(values), "distinct modes, preview/GIF/depth-drag parity and exact restoration verified", flush=True)
    finally:
        context.close()


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--engine", choices=("chromium","webkit","both"), default="both")
    args.add_argument("--surface", choices=("phone","device","both"), default="both")
    args.add_argument("--origin", default=ORIGIN)
    options = args.parse_args()
    with TemporaryDirectory() as directory, sync_playwright() as browsers:
        for name in ("chromium","webkit"):
            if options.engine in ("both",name):
                for surface in ("phone","device"):
                    if options.surface in ("both",surface):
                        test_surface(getattr(browsers,name),surface,Path(directory),options.origin)
