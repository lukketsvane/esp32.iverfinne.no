import gzip
import re
from urllib.parse import quote
from pathlib import Path

root = Path(__file__).resolve().parent
sketch = root / "EntropiCamera"
shared = root.parent
source = (sketch / "camera_ui.html").read_text(encoding="utf-8")
source = source.replace("</style>", "</style><style>\n" + (sketch / "camera-ui-v2.css").read_text(encoding="utf-8") + "\n" + (sketch / "camera-ui-restore.css").read_text(encoding="utf-8") + "\n" + (shared / "vendor/marigold.css").read_text(encoding="utf-8") + "\n</style>", 1)
palettes = (shared / "vendor/color-schemes.mjs").read_text(encoding="utf-8").replace("export ", "")
retro = (shared / "vendor/retro-modes.mjs").read_text(encoding="utf-8").replace("export ", "")
palettes += "\n" + re.sub(r"^import .*?;\s*", "", retro, flags=re.MULTILINE)
renderer = (shared / "vendor/viewfinder.mjs").read_text(encoding="utf-8").replace("export class Viewfinder", "class Viewfinder", 1)
renderer = re.sub(r"^import .*?;\s*", "", renderer, flags=re.MULTILINE)
scene = (shared / "vendor/scene.mjs").read_text(encoding="utf-8").replace("export async function", "async function")
scene = re.sub(r"^import .*?;\s*", "", scene, flags=re.MULTILINE)
math = (shared / "pointcloud/math.mjs").read_text(encoding="utf-8").replace("export ", "")
primitive = (shared / "pointcloud/primitive.mjs").read_text(encoding="utf-8").replace("export ", "")
gestures = (shared / "vendor/viewer-gestures.mjs").read_text(encoding="utf-8").replace("export ", "")
alignment = (shared / "pointcloud/stereo-rig.mjs").read_text(encoding="utf-8").replace("export ", "")
stereo = re.sub(r"^import .*?;\s*", "", (shared / "vendor/stereo-depth.mjs").read_text(encoding="utf-8").replace("export ", ""), flags=re.MULTILINE)
scene = "const createDepthScene = (() => {\n" + math + "\n" + alignment + "\n" + stereo + "\n" + primitive + "\n" + gestures + "\n" + scene + "\nreturn createDepthScene;\n})();"
studio = (shared / "vendor/studio.mjs").read_text(encoding="utf-8").replace("export ", "")
studio += "\n" + (shared / "vendor/photo-gestures.mjs").read_text(encoding="utf-8").replace("export ", "")
printing = (shared / "vendor/print-client.mjs").read_text(encoding="utf-8").replace("export ", "")
printing = "const createPrintClient = (() => {\n" + printing + "\nreturn createPrintClient;\n})();"
native_print = "\n".join((shared / ("vendor/print/" + name + ".mjs")).read_text(encoding="utf-8").replace("export ", "") for name in ["px10-protocol", "raster", "cloud-raster"])
native_print = re.sub(r"^import .*?;\s*", "", native_print, flags=re.MULTILINE)
printing += "\nconst cloudPrintJob = (() => {\n" + native_print + "\nreturn cloudPrintJob;\n})();\n" + (shared / "vendor/print/device-printer.mjs").read_text(encoding="utf-8").replace("export ", "")
printing += "\n" + (shared / "vendor/photo.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_view = (shared / "vendor/photo-view.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_view = re.sub(r"^import .*?;\s*", "", photo_view, flags=re.MULTILINE)
printing += "\n" + photo_view
printing += "\n" + (shared / "vendor/archive.mjs").read_text(encoding="utf-8").replace("export ", "")
assets = (shared / "pointcloud/assets.mjs").read_text(encoding="utf-8").replace("export ", "")
bridge = (shared / "vendor/model-bridge.mjs").read_text(encoding="utf-8").replace("export ", "")
bridge = re.sub(r"^import .*?;\s*", "", bridge, flags=re.MULTILINE)
bridge = "const { requestPhoneModels, phoneModelsReady, phoneHelperOrigin } = (() => {\n" + assets + "\n" + bridge + "\nreturn { requestPhoneModels, phoneModelsReady, phoneHelperOrigin };\n})();"
source = source.replace("__ENTROPI_VIEWFINDER__", palettes + "\n" + renderer).replace("__ENTROPI_SCENE__", scene).replace("__ENTROPI_STUDIO__", studio).replace("__ENTROPI_PRINT_CLIENT__", printing).replace("__ENTROPI_MODEL_BRIDGE__", bridge)
marigold = "\n".join((shared / name).read_text(encoding="utf-8").replace("export ", "") for name in ["pointcloud/math.mjs", "pointcloud/stereo-rig.mjs", "vendor/stereo-depth.mjs", "vendor/vathography.mjs", "vendor/depth-source.mjs", "vendor/marigold-view.mjs"])
marigold = re.sub(r"^import .*?;\s*", "", marigold, flags=re.MULTILINE)
marigold = "const createMarigoldView = (() => {\n" + marigold + "\nreturn createMarigoldView;\n})();"
source = source.replace("__ENTROPI_MARIGOLD__", marigold)
documents = []
for module, names in [("stereo-pair", "readStereoPairResponse"), ("entropi-document", "createEntropiDocument, encodeEntropiDocument, decodeEntropiDocument"), ("entropi-export", "encodeDepthTiff, encodeDepthDng"), ("entropi-ui", "bindExportGesture, pickEntropiDocument")]:
    code = (shared / ("vendor/" + module + ".mjs")).read_text(encoding="utf-8").replace("export ", "")
    code = re.sub(r"^import .*?;\s*", "", code, flags=re.MULTILINE)
    documents.append("const { " + names + " } = (() => {\n" + code + "\nreturn { " + names + " };\n})();")
source = source.replace("__ENTROPI_DOCUMENT__", "\n".join(documents))
source = source.replace("__ENTROPI_APP_ENHANCEMENTS__", (sketch / "camera-ui-v2.js").read_text(encoding="utf-8"))
source = source.replace("__ENTROPI_ICON__", "data:image/svg+xml," + quote((shared / "favicon.svg").read_text(encoding="utf-8"), safe=""))

def array(name, payload):
    rows = [", ".join(f"0x{byte:02x}" for byte in payload[i:i + 16]) for i in range(0, len(payload), 16)]
    return f"const unsigned char {name}[] PROGMEM = {{\n  " + ",\n  ".join(rows) + "\n};\n"

payload = gzip.compress(source.encode(), mtime=0)
(sketch / "camera_ui.h").write_text("#pragma once\n\n" + array("camera_ui_html_gz", payload), encoding="utf-8", newline="\n")
headers = ["#pragma once\n\nstruct CameraAsset { const char *uri; const unsigned char *data; size_t length; const char *type; };\n"]
entries = []
paths = [shared / "apple-touch-icon.png"] + [path for path in sorted((shared / "pointcloud").rglob("*")) if path.is_file() and path.suffix in {".mjs", ".json", ".txt"}]
for i, path in enumerate(paths):
    data = gzip.compress(path.read_bytes(), mtime=0)
    name = f"camera_asset_{i}"
    headers.append(array(name, data))
    mime = {".png": "image/png", ".mjs": "application/javascript", ".json": "application/json", ".txt": "text/plain"}[path.suffix]
    entries.append(f'  {{"/{path.relative_to(shared).as_posix()}", {name}, sizeof({name}), "{mime}"}}')
headers.append("const CameraAsset cameraAssets[] = {\n" + ",\n".join(entries) + "\n};\n")
(sketch / "camera_assets.h").write_text("\n".join(headers), encoding="utf-8", newline="\n")
preview = root / "preview"
preview.mkdir(exist_ok=True)
(preview / "index.html").write_text(source, encoding="utf-8", newline="\n")
print(f"Camera UI: {len(payload)} gzip bytes; {len(entries)} local assets")
