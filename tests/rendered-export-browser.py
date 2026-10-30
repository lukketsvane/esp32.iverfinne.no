"""Browser TIFF integration: Python + Playwright + tifffile; build UI first."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import base64
import io
import json
import re
import tifffile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        if self.path == "/__export_test__":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<!doctype html><title>Export regression</title>")
        else:
            super().do_GET()

server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
scripts = re.findall(r"<script[^>]*>(.*?)</script>", (ROOT / "device/preview/index.html").read_text(encoding="utf-8"), re.S)
fixture = """async native => {
    const encode = native ? encodeRenderedTiff : (await import('/vendor/entropi-rendered-export.mjs')).encodeRenderedTiff;
    const presets = native ? PHOTO_PRESETS : (await import('/vendor/photo-adjustments.mjs')).PHOTO_PRESETS;
    const normalize = native ? normalizePhotoEdits : (await import('/vendor/photo-adjustments.mjs')).normalizePhotoEdits;
    const canvas=document.createElement('canvas'); canvas.width=32; canvas.height=24;
    canvas.getContext('2d').fillRect(0,0,32,24);
    const left=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const result={depth:new Float32Array([.2,.4,.6,.8]),width:2,height:2,
        validity:new Uint8Array([1,1,1,0]),normalized:true,polarity:'near'};
    const values=[],recipes=Array.from({length:5},(_,preset)=>({preset,position:.1,width:.9}));
    for(const {id}of presets)recipes.push({preset:1,position:.1,width:.9,edits:{preset:id,strength:.8,
        exposure:.2,contrast:.1,sharpen:.3,denoise:.4,crop:{x:.125,y:.125,width:.75,height:.75}}});
    recipes.push({preset:1,position:0,width:1,edits:{preset:'P5',strength:.6,saturation:.3,highlights:-.4,shadows:.2,temperature:.15,tint:-.1,hsl:{blue:{hue:-.4,saturation:.5,lightness:.2}},grain:{strength:.5,size:.7,color:.4},crop:{x:.125,y:.125,width:.75,height:.75}}});
    for(const recipe of recipes){
        if(recipe.edits)recipe.edits=normalize(recipe.edits);
        const blob=await encode({left,result,recipe});
        const bytes=new Uint8Array(await blob.arrayBuffer());
        values.push({recipe,data:btoa(String.fromCharCode(...bytes))});
    }
    return values;
}"""
try:
    with sync_playwright() as p:
        for engine in [p.chromium, p.webkit]:
            browser=engine.launch(headless=True)
            page=browser.new_page()
            page.goto(f"http://127.0.0.1:{server.server_port}/__export_test__")
            # Compile every generated script, then load definitions from the firmware bundle.
            for script in scripts:
                page.evaluate("script => { new Function(script); }", script)
            for script in scripts[:-1]:
                page.add_script_tag(content=script)
            outputs=[]
            for native in [False,True]:
                encoded=page.evaluate(fixture,native)
                decoded=[]
                for item in encoded:
                    recipe=item["recipe"]
                    edits=recipe.get("edits")
                    channels=2 if not edits or edits["preset"] in ["B1","B5","X1"] else 4
                    width,height=(24,18) if edits else (32,24)
                    with tifffile.TiffFile(io.BytesIO(base64.b64decode(item["data"]))) as tif:
                        image=tif.asarray()
                        assert image.shape == (height,width,channels), image.shape
                        assert image.dtype.name == "uint16", image.dtype
                        assert tif.pages[0].bitspersample == 16
                        assert tif.pages[0].samplesperpixel == channels
                        assert int(tif.pages[0].photometric) == (1 if channels == 2 else 2)
                        assert tuple(map(int,tif.pages[0].extrasamples)) == (2,)
                        assert image[:,:,-1].min() == 0
                        assert image[:,:,-1].max() == 65535
                        assert (image[:,:,:-1] % 257 != 0).any()
                        metadata=json.loads(tif.pages[0].description)
                        assert metadata["recipe"] == recipe
                        assert metadata["sensorRaw"] is False
                        assert metadata["version"] == (2 if edits else 1)
                        assert metadata["sourceWidth"] == 32 and metadata["sourceHeight"] == 24
                        if edits:
                            assert metadata["outputWidth"] == width and metadata["outputHeight"] == height
                            assert metadata["channels"] == ("rgba" if channels == 4 else "gray-alpha")
                        decoded.append(image)
                assert len(decoded) == 17
                assert len({value.tobytes() for value in decoded}) == 17
                outputs.append(decoded)
                print(json.dumps({"engine":engine.name,"bundle":"firmware" if native else "modules",
                    "depthPresets":5,"photoPresets":11,"advancedEdits":1,"sizes":[[32,24],[24,18]],"bits":16,"alpha":"verified"}),flush=True)
            assert all((a==b).all() for a,b in zip(*outputs)), "Firmware/module output mismatch"
            browser.close()
finally:
    server.shutdown()
    server.server_close()
