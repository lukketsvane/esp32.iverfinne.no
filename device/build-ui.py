import gzip
import re
from urllib.parse import quote
from pathlib import Path

root = Path(__file__).resolve().parent
sketch = root / "EntropiCamera"
shared = root.parent
source = (sketch / "camera_ui.html").read_text(encoding="utf-8")
renderer = (shared / "vendor/viewfinder.mjs").read_text(encoding="utf-8").replace("export class Viewfinder", "class Viewfinder", 1)
renderer = re.sub(r"^import .*?;\s*", "", renderer, flags=re.MULTILINE)
scene = (shared / "vendor/scene.mjs").read_text(encoding="utf-8").replace("export async function", "async function")
scene = re.sub(r"^import .*?;\s*", "", scene, flags=re.MULTILINE)
math = (shared / "pointcloud/math.mjs").read_text(encoding="utf-8").replace("export ", "")
primitive = (shared / "pointcloud/primitive.mjs").read_text(encoding="utf-8").replace("export ", "")
gestures = (shared / "vendor/viewer-gestures.mjs").read_text(encoding="utf-8").replace("export ", "")
scene = "const createDepthScene = (() => {\n" + math + "\n" + primitive + "\n" + gestures + "\n" + scene + "\nreturn createDepthScene;\n})();"
studio = (shared / "vendor/studio.mjs").read_text(encoding="utf-8").replace("export ", "")
studio += "\n" + (shared / "vendor/photo-gestures.mjs").read_text(encoding="utf-8").replace("export ", "")
printing = (shared / "vendor/print-client.mjs").read_text(encoding="utf-8").replace("export ", "")
printing = "const createPrintClient = (() => {\n" + printing + "\nreturn createPrintClient;\n})();"
printing += "\n" + (shared / "vendor/photo.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_view = (shared / "vendor/photo-view.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_view = re.sub(r"^import .*?;\s*", "", photo_view, flags=re.MULTILINE)
printing += "\n" + photo_view
assets = (shared / "pointcloud/assets.mjs").read_text(encoding="utf-8").replace("export ", "")
bridge = (shared / "vendor/model-bridge.mjs").read_text(encoding="utf-8").replace("export ", "")
bridge = re.sub(r"^import .*?;\s*", "", bridge, flags=re.MULTILINE)
bridge = "const { requestPhoneModels, phoneModelsReady } = (() => {\n" + assets + "\n" + bridge + "\nreturn { requestPhoneModels, phoneModelsReady };\n})();"
source = source.replace("__ENTROPI_VIEWFINDER__", renderer).replace("__ENTROPI_SCENE__", scene).replace("__ENTROPI_STUDIO__", studio).replace("__ENTROPI_PRINT_CLIENT__", printing).replace("__ENTROPI_MODEL_BRIDGE__", bridge)
source = source.replace("__ENTROPI_ICON__", "data:image/svg+xml," + quote((shared / "favicon.svg").read_text(encoding="utf-8"), safe=""))

def array(name, payload):
    rows = [", ".join(f"0x{byte:02x}" for byte in payload[i:i + 16]) for i in range(0, len(payload), 16)]
    return f"const unsigned char {name}[] PROGMEM = {{\n  " + ",\n  ".join(rows) + "\n};\n"

payload = gzip.compress(source.encode(), mtime=0)
(sketch / "camera_ui.h").write_text("#pragma once\n\n" + array("camera_ui_html_gz", payload), encoding="utf-8", newline="\n")
headers = ["#pragma once\n\nstruct CameraAsset { const char *uri; const unsigned char *data; size_t length; const char *type; };\n"]
entries = []
for i, path in enumerate(sorted((shared / "pointcloud").rglob("*"))):
    if not path.is_file() or path.suffix not in {".mjs", ".json", ".txt"}:
        continue
    data = gzip.compress(path.read_bytes(), mtime=0)
    name = f"camera_asset_{i}"
    headers.append(array(name, data))
    mime = "application/javascript" if path.suffix == ".mjs" else "application/json" if path.suffix == ".json" else "text/plain"
    entries.append(f'  {{"/{path.relative_to(shared).as_posix()}", {name}, sizeof({name}), "{mime}"}}')
headers.append("const CameraAsset cameraAssets[] = {\n" + ",\n".join(entries) + "\n};\n")
(sketch / "camera_assets.h").write_text("\n".join(headers), encoding="utf-8", newline="\n")
preview = root / "preview"
preview.mkdir(exist_ok=True)
(preview / "index.html").write_text(source, encoding="utf-8", newline="\n")
print(f"Camera UI: {len(payload)} gzip bytes; {len(entries)} local assets")
