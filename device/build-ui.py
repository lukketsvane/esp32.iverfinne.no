import gzip
import re
import subprocess
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
depth_engine = (shared / "vendor/depth-engine.mjs").read_text(encoding="utf-8").replace("export ", "")
depth_engine = "const estimateDepth = (() => {\n" + depth_engine + "\nreturn estimateDepth;\n})();\n"
math = (shared / "pointcloud/math.mjs").read_text(encoding="utf-8").replace("export ", "")
primitive = (shared / "pointcloud/primitive.mjs").read_text(encoding="utf-8").replace("export ", "")
gestures = (shared / "vendor/viewer-gestures.mjs").read_text(encoding="utf-8").replace("export ", "")
alignment = (shared / "pointcloud/stereo-rig.mjs").read_text(encoding="utf-8").replace("export ", "")
stereo = re.sub(r"^import .*?;\s*", "", (shared / "vendor/stereo-depth.mjs").read_text(encoding="utf-8").replace("export ", ""), flags=re.MULTILINE)
scene = depth_engine + "const createDepthScene = (() => {\n" + math + "\n" + alignment + "\n" + stereo + "\n" + primitive + "\n" + gestures + "\n" + scene + "\nreturn createDepthScene;\n})();"
studio = (shared / "vendor/studio.mjs").read_text(encoding="utf-8").replace("export ", "")
studio += "\n" + (shared / "vendor/page-gestures.mjs").read_text(encoding="utf-8").replace("export ", "")
studio += "\n" + (shared / "vendor/photo-gestures.mjs").read_text(encoding="utf-8").replace("export ", "")
studio += "\n" + (shared / "vendor/gallery-navigation.mjs").read_text(encoding="utf-8").replace("export ", "")
studio += "\n" + (shared / "vendor/capture-gesture.mjs").read_text(encoding="utf-8").replace("export ", "")
printing = (shared / "vendor/print-client.mjs").read_text(encoding="utf-8").replace("export ", "")
printing = "const createPrintClient = (() => {\n" + printing + "\nreturn createPrintClient;\n})();"
native_print = "\n".join((shared / ("vendor/print/" + name + ".mjs")).read_text(encoding="utf-8").replace("export ", "") for name in ["px10-protocol", "raster", "cloud-raster"])
native_print = re.sub(r"^import .*?;\s*", "", native_print, flags=re.MULTILINE)
printing += "\nconst cloudPrintJob = (() => {\n" + native_print + "\nreturn cloudPrintJob;\n})();\n" + (shared / "vendor/print/device-printer.mjs").read_text(encoding="utf-8").replace("export ", "")
printing += "\n" + (shared / "vendor/photo.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_view = (shared / "vendor/photo-view.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_view = re.sub(r"^import .*?;\s*", "", photo_view, flags=re.MULTILINE)
printing += "\n" + photo_view
printing += "\n" + re.sub(r"^import .*?;\s*", "", (shared / "vendor/archive.mjs").read_text(encoding="utf-8").replace("export ", ""), flags=re.MULTILINE)
assets = (shared / "pointcloud/assets.mjs").read_text(encoding="utf-8").replace("export ", "")
bridge = (shared / "vendor/model-bridge.mjs").read_text(encoding="utf-8").replace("export ", "")
bridge = re.sub(r"^import .*?;\s*", "", bridge, flags=re.MULTILINE)
bridge = "const { requestPhoneModels, phoneModelsReady, phoneHelperOrigin } = (() => {\n" + assets + "\n" + bridge + "\nreturn { requestPhoneModels, phoneModelsReady, phoneHelperOrigin };\n})();"
source = source.replace("__ENTROPI_VIEWFINDER__", palettes + "\n" + renderer).replace("__ENTROPI_SCENE__", scene).replace("__ENTROPI_STUDIO__", studio).replace("__ENTROPI_PRINT_CLIENT__", printing).replace("__ENTROPI_MODEL_BRIDGE__", bridge)
photo_adjustments = (shared / "vendor/photo-adjustments.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_adjustments = re.sub(r"^import .*?;\s*", "", photo_adjustments, flags=re.MULTILINE)
photo_adjustments = "const { PHOTO_PRESETS, normalizePhotoEdits, photoEditsNeutral, applyPhotoEdits } = (() => {\n" + photo_adjustments + "\nreturn { PHOTO_PRESETS, normalizePhotoEdits, photoEditsNeutral, applyPhotoEdits };\n})();"
notch_rail = (shared / "vendor/notch-rail.mjs").read_text(encoding="utf-8").replace("export ", "")
notch_rail = "const { attachNotchRail } = (() => {\n" + notch_rail + "\nreturn { attachNotchRail };\n})();"
photo_editor = (shared / "vendor/photo-editor.mjs").read_text(encoding="utf-8").replace("export ", "")
photo_editor = re.sub(r"^import .*?;\s*", "", photo_editor, flags=re.MULTILINE)
photo_editor = "const { createPhotoEditor } = (() => {\n" + photo_editor + "\nreturn { createPhotoEditor };\n})();"
marigold = "\n".join((shared / name).read_text(encoding="utf-8").replace("export ", "") for name in ["pointcloud/math.mjs", "pointcloud/stereo-rig.mjs", "vendor/stereo-depth.mjs", "vendor/vathography.mjs", "vendor/depth-source.mjs", "vendor/marigold-view.mjs"])
marigold = re.sub(r"^import .*?;\s*", "", marigold, flags=re.MULTILINE)
marigold = photo_adjustments + "\n" + notch_rail + "\n" + photo_editor + "\nconst { createMarigoldView, runStereoDepth } = (() => {\n" + marigold + "\nreturn { createMarigoldView, runStereoDepth };\n})();"
source = source.replace("__ENTROPI_MARIGOLD__", marigold)
documents = []
for module, names in [("stereo-pair", "readStereoPairResponse"), ("entropi-document", "createEntropiDocument, encodeEntropiDocument, decodeEntropiDocument, normalizePanorama"), ("vathography", "normalizeDepth, toneDepth"), ("entropi-export", "encodeDepthTiff, encodeDepthDng, encodeGrayscale16Tiff, encodeRgba16Tiff"), ("entropi-rendered-export", "encodeRenderedTiff"), ("entropi-ui", "bindExportGesture, pickEntropiDocument"), ("live-capture-gesture", "bindLiveCaptureGesture"), ("sweep-capture", "createSweepCapture"), ("panorama", "buildPanorama, applyPanoramaMask"), ("panorama-capture", "createPanoramaCapture")]:
    code = (shared / ("vendor/" + module + ".mjs")).read_text(encoding="utf-8").replace("export ", "")
    code = re.sub(r"^import .*?;\s*", "", code, flags=re.MULTILINE)
    documents.append("const { " + names + " } = (() => {\n" + code + "\nreturn { " + names + " };\n})();")
upscale = "\n".join((shared / name).read_text(encoding="utf-8").replace("export ", "") for name in ["pointcloud/assets.mjs", "pointcloud/upscale-core.mjs", "vendor/upscale.mjs"])
upscale = re.sub(r"^import .*?;\s*", "", upscale, flags=re.MULTILINE)
upscale = "const { warmUpscaleAssets, prepareUpscaleAssets, upscaleImage } = (() => {\n" + upscale + "\nreturn { warmUpscaleAssets, prepareUpscaleAssets, upscaleImage };\n})();\n"
source = source.replace("__ENTROPI_DOCUMENT__", upscale + "\n".join(documents))
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

def firmware_version():
    try:
        described = subprocess.run(["git", "describe", "--always", "--dirty", "--abbrev=7"], cwd=shared, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    version = described.stdout.strip()
    return version if described.returncode == 0 and re.fullmatch(r"[0-9A-Za-z._-]{1,40}", version) else "unknown"

version = firmware_version()
(sketch / "build_info.h").write_text(f'#pragma once\n\n#define ENTROPI_FIRMWARE_VERSION "{version}"\n', encoding="utf-8", newline="\n")
print(f"Camera UI: {len(payload)} gzip bytes; {len(entries)} local assets; firmware {version}")
