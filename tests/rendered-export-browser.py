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
    const canvas=document.createElement('canvas'); canvas.width=32; canvas.height=24;
    canvas.getContext('2d').fillRect(0,0,32,24);
    const left=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const result={depth:new Float32Array([.2,.4,.6,.8]),width:2,height:2,
        validity:new Uint8Array([1,1,1,0]),normalized:true,polarity:'near'};
    const values=[];
    for(let preset=0;preset<5;preset++){
        const blob=await encode({left,result,recipe:{preset,position:.1,width:.9}});
        const bytes=new Uint8Array(await blob.arrayBuffer());
        values.push(btoa(String.fromCharCode(...bytes)));
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
                for preset,data in enumerate(encoded):
                    with tifffile.TiffFile(io.BytesIO(base64.b64decode(data))) as tif:
                        image=tif.asarray()
                        assert image.shape == (24,32,2), image.shape
                        assert image.dtype.name == "uint16", image.dtype
                        assert tif.pages[0].bitspersample == 16
                        assert image[:,:,1].min() == 0
                        assert image[:,:,1].max() == 65535
                        metadata=json.loads(tif.pages[0].description)
                        assert metadata["recipe"]["preset"] == preset
                        assert metadata["sensorRaw"] is False
                        decoded.append(image)
                assert len({value.tobytes() for value in decoded}) == 5
                outputs.append(decoded)
                print(json.dumps({"engine":engine.name,"bundle":"firmware" if native else "modules",
                    "presets":len(decoded),"size":[32,24],"bits":16,"alpha":"verified"}),flush=True)
            assert all((a==b).all() for a,b in zip(*outputs)), "Firmware/module output mismatch"
            browser.close()
finally:
    server.shutdown()
    server.server_close()
