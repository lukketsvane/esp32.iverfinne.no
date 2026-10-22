import hashlib
import json
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "pointcloud/models/manifest.json").read_text(encoding="utf-8"))
paths = {"asset": "models/model_quantized.onnx", "runtime": "vendor/ort-wasm-simd-threaded.wasm"}
for key, relative in paths.items():
    asset = manifest[key]
    target = root / "pointcloud" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size == asset["bytes"] and hashlib.file_digest(target.open("rb"), "sha256").hexdigest() == asset["sha256"]:
        print(f"Verified: {target}")
        continue
    temporary = target.with_suffix(target.suffix + ".part")
    digest = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(asset["url"], timeout=120) as response, temporary.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    if size != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
        raise ValueError(f"Invalid asset: {relative}")
    temporary.replace(target)
    print(f"Verified: {target} ({size} bytes)")
