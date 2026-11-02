"""Run after device/build-ui.py with Playwright and Pillow (no camera required)."""
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGE = (ROOT / "device/preview/index.html").read_text(encoding="utf-8")
ORIGIN = "http://entropi.test/"


def exercise(browser_type, directory):
    # The archive stores Blobs in IndexedDB, which requires a persistent WebKit profile.
    context = browser_type.launch_persistent_context(Path(directory) / browser_type.name,
                                                     viewport={"width": 390, "height": 844})
    try:
        page = context.new_page()
        page.set_default_timeout(15000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("http://**/*", lambda route: route.fulfill(body=PAGE, content_type="text/html")
                   if route.request.url == ORIGIN else route.fulfill(status=404))
        page.goto(ORIGIN)
        fixture = page.evaluate("""async () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 16;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#777';
          ctx.fillRect(0, 0, 16, 16);
          const left = await new Promise(resolve => canvas.toBlob(resolve));
          const documentFile = await encodeEntropiDocument(createEntropiDocument({
            id: 'embedded-test', left,
            result: {depth: Float32Array.of(0, .25, .5, 1), width: 2, height: 2, polarity: 'near'}
          }));
          return Array.from(new Uint8Array(await documentFile.arrayBuffer()));
        }""")
        page.locator("#open-archive").click()
        with page.expect_file_chooser() as chooser:
            page.locator("#archive-import").click()
        chooser.value.set_files({"name": "fixture.entropi", "mimeType": "application/x-entropi",
                                "buffer": bytes(fixture)})
        loop = page.locator(".mg-loop")
        loop.click()
        assert loop.get_attribute("aria-pressed") == "true"
        page.wait_for_function("!document.querySelector('.mg-art').hidden")
        outputs = {}
        for label in ("VATHO PNG", "Loop GIF"):
            page.locator("#save-photo").press("ArrowUp")
            with page.expect_download(timeout=10000) as event:
                page.get_by_role("menuitem").filter(has_text=label).click()
            file = Path(directory) / event.value.suggested_filename
            event.value.save_as(file)
            outputs[label] = file

        with Image.open(outputs["Loop GIF"]) as gif:
            assert gif.format == "GIF" and gif.n_frames == 60 and gif.size == (16, 16)
            assert gif.info["loop"] == 0 and gif.info["duration"] == 50
            first = gif.convert("RGB").tobytes()
            gif.seek(15)
            assert first != gif.convert("RGB").tobytes()
        with Image.open(outputs["VATHO PNG"]) as png:
            assert png.format == "PNG" and png.size == (16, 16)
        with page.expect_file_chooser() as choosing:
            page.evaluate("() => { window.importedMaster = pickEntropiDocument(); }")
        choosing.value.set_files(str(outputs["VATHO PNG"]))
        restored = page.evaluate("""async () => {
          const {id, result, left} = await window.importedMaster;
          return [id, Array.from(result.depth), left.type];
        }""")
        assert restored == ["embedded-test", [0, .25, .5, 1], "image/png"], restored
        batch = page.evaluate("""async () => {
          const previous = await window.importedMaster;
          const archive = await encodeEntropiDocument({...previous, id: 'batch-left'});
          const other = await encodeEntropiDocument({...previous, id: 'batch-right',
            result: {...previous.result, depth: Float32Array.of(1, .5, .25, 0)}});
          const png = await encodeVathographyPNG(previous.preview, other);
          return [Array.from(new Uint8Array(await archive.arrayBuffer())),
                  Array.from(new Uint8Array(await png.arrayBuffer()))];
        }""")
        page.locator("#close-photo").click()
        page.locator("#open-archive").click()
        with page.expect_file_chooser() as choosing:
            page.locator("#archive-import").click()
        assert choosing.value.is_multiple()
        choosing.value.set_files([
            {"name": "first.entropi", "mimeType": "application/x-entropi", "buffer": bytes(batch[0])},
            {"name": "broken.entropi", "mimeType": "application/x-entropi", "buffer": b"broken"},
            {"name": "second.png", "mimeType": "image/png", "buffer": bytes(batch[1])},
        ])
        page.wait_for_function("document.querySelectorAll('#archive-grid button').length === 3")
        assert page.locator("#archive").is_visible()
        assert page.locator("#archive-notice").inner_text() == "Importerte 2 av 3 filer."
        details = page.locator("#archive-errors")
        assert details.is_visible() and not details.evaluate("element => element.open")
        details.locator("summary").click()
        assert "broken.entropi" in details.locator("li").inner_text()
        depths = page.evaluate("""async () => {
          const archive = createArchive(), depths = {};
          for (const {id} of await archive.list()) {
            const {document: master} = await archive.get(id);
            depths[master.id] = Array.from(master.result.depth);
          }
          return depths;
        }""")
        assert depths == {"embedded-test": [0, .25, .5, 1], "batch-left": [0, .25, .5, 1],
                          "batch-right": [1, .5, .25, 0]}, depths
        assert not errors, errors
        print(f"{browser_type.name}: embedded VATHO PNG, 60-frame GIF and mixed-file gallery import passed", flush=True)
    finally:
        context.close()


if __name__ == "__main__":
    with TemporaryDirectory() as directory, sync_playwright() as playwright:
        for engine in (playwright.chromium, playwright.webkit):
            exercise(engine, directory)
