"""Exercise ordinary photos alongside editable VATHO masters through the real gallery chooser."""
import argparse
import re
from hashlib import sha256
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LOCAL = "http://localhost:7391"
SURFACES = {
    "phone": ("open-gallery", "phone-vault-import", "phone-vault-grid", "phone-vault-status", "phone-vault-errors"),
    "device": ("open-archive", "archive-import", "archive-grid", "archive-notice", "archive-errors"),
}


def serve(route, surface):
    path = urlsplit(route.request.url).path.lstrip("/") or (
        "index.html" if surface == "phone" else "device/preview/index.html")
    target = (ROOT / path).resolve()
    if target.is_relative_to(ROOT) and target.is_file():
        if target.suffix == ".mjs":
            route.fulfill(path=target, content_type="text/javascript")
        else:
            route.fulfill(path=target)
    else:
        route.fulfill(status=404)


def photo_files(folder, originals):
    paths, expected = [], {}
    for n in range(14):
        size = (7680, 4320) if n == 13 else (96 + 3*n, 172 - 4*n)
        extension = "jpg" if n == 11 else "webp" if n == 12 else "png"
        name = "ai_reconstruction_8k" if n == 13 else f"IMG_{932+n:04}_vathography_mist"
        path = folder / f"{name}.{extension}"
        if n < len(originals):
            source = originals[n]
            path = folder / f"{n:02}-{source.parent.name}-{source.name}"
            copyfile(source, path)
            with Image.open(path) as image:
                size = image.size
        else:
            image = Image.new("RGB", size, (19 + n*11, 77, 198 - n*9))
            draw = ImageDraw.Draw(image)
            for x in range(0, size[0], max(1, size[0]//23)):
                draw.line((x, 0, size[0]-x, size[1]), fill=(234, 185, 23), width=max(1, size[0]//500))
            image.save(path)
        expected[sha256(path.read_bytes()).hexdigest()] = list(size)
        paths.append(path)
    return paths, expected


def masters(page, folder):
    payloads = page.evaluate("""async () => {
      const {createEntropiDocument,encodeEntropiDocument} = await import('/vendor/entropi-document.mjs');
      const {encodeVathographyPNG} = await import('/vendor/vathography-png.mjs');
      const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 16;
      const ctx = canvas.getContext('2d');ctx.fillStyle='gray';ctx.fillRect(0,0,20,16);
      const image = await new Promise(resolve => canvas.toBlob(resolve));
      const result = [];
      for (let i=0;i<3;i++) {
        const master = createEntropiDocument({id:'mixed-'+i,left:image,preview:image,
          result:{width:2,height:2,depth:Float32Array.of(i,.25,.5,1),polarity:'near'}});
        const file = await encodeEntropiDocument(master);
        const blob = i === 1 ? await encodeVathographyPNG(image,file) : file;
        result.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
      }
      return result;
    }""")
    paths = []
    for i, data in enumerate(payloads):
        path = folder / (f"native-{i}.png" if i == 1 else f"native-{i}.entropi")
        path.write_bytes(bytes(data))
        paths.append(path)
    return paths


def inspect_records(page):
    return page.evaluate("""async () => {
      const {createArchive} = await import('/vendor/archive.mjs'), archive=createArchive();
      const data={photos:{},masters:{}};
      for (const {id} of await archive.list()) {
        const record=await archive.get(id);
        if (record.document) {
          data.masters[record.document.id]=Array.from(record.document.result.depth);
        } else {
          const img=new Image(), url=URL.createObjectURL(record.left);img.src=url;
          try {
            let bytes;
            try { bytes=await record.left.arrayBuffer(); } catch(e) { throw new Error('Read failed '+record.sourceName+' '+record.left.type+' '+record.left.size+': '+e); }
            try { await img.decode(); } catch(e) { throw new Error('Decode failed '+record.sourceName+' '+record.left.type+' '+record.left.size+' '+Array.from(new Uint8Array(bytes.slice(0,12)))+': '+e); }
            const digest=await crypto.subtle.digest('SHA-256',bytes);
            const hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
            data.photos[hex]=[img.naturalWidth,img.naturalHeight];
          } finally {URL.revokeObjectURL(url); img.src='';}
        }
      }
      return data;
    }""")


def choose(page, selector, paths):
    with page.expect_file_chooser() as event:
        page.locator("#" + selector).click()
    assert event.value.is_multiple()
    event.value.set_files([str(path) for path in paths])


def exercise(browser_type, surface, folder, origin, baseline, originals):
    profile = folder / f"{browser_type.name}-{surface}-profile"
    context = browser_type.launch_persistent_context(profile, viewport={"width":390,"height":844},
                                                      service_workers="block")
    try:
        page = context.new_page()
        page.set_default_timeout(45000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        if origin == LOCAL:
            page.route(re.compile(r"^https?://"), lambda route: serve(route,surface)
                       if urlsplit(route.request.url).netloc == urlsplit(LOCAL).netloc else route.abort())
        page.goto(origin + "/", wait_until="domcontentloaded")
        photos, expected = photo_files(folder, originals)
        native = masters(page, folder)
        opener, picker, grid, status, details = SURFACES[surface]
        page.locator("#" + opener).click()
        choose(page, picker, [*photos[:5], native[0], *photos[5:10], native[1], *photos[10:], native[2]])
        count = 3 if baseline else 17
        page.wait_for_function("([id,n])=>document.getElementById(id).querySelectorAll('button').length===n",
                               arg=[grid,count], timeout=120000)
        print(browser_type.name,surface,"first batch",count,"/ 17",page.locator("#"+status).inner_text()[:160],flush=True)
        if not baseline:
            # The archive must own its bytes even if the imported files subsequently move.
            for fixture in [*photos,*native]:
                fixture.unlink()
            page.reload(wait_until="domcontentloaded")
            page.locator("#"+opener).click()
            page.wait_for_function("id=>document.getElementById(id).querySelectorAll('button').length===17",arg=grid)
            index = page.evaluate("""async () => {
                const {createArchive}=await import('/vendor/archive.mjs'),a=createArchive(),items=await a.list();
                for (let i=0;i<items.length;i++) {
                  if ((await a.get(items[i].id)).sourceName==='ai_reconstruction_8k.png') return i;
                }
                return -1;
            }""")
            assert index>=0
            page.locator("#"+grid+" button").nth(index).click()
            photo_id = "phone-vault-image" if surface=="phone" else "archive-photo"
            page.wait_for_function("id=>{const im=document.getElementById(id);return im.complete&&im.naturalWidth===7680&&im.naturalHeight===4320}", arg=photo_id,timeout=10000)
            print(browser_type.name,surface,"reopened the full-size 8K gallery detail after sources removed and reload",flush=True)
            page.locator("#"+("phone-vault-back" if surface=="phone" else "archive-back")).click()
        records = inspect_records(page)
        assert records["masters"] == {f"mixed-{i}":[i,.25,.5,1] for i in range(3)}, records["masters"]
        if baseline:
            assert not records["photos"]
            return
        assert records["photos"] == expected, (records["photos"],expected)
        assert not page.locator("#"+details).is_visible()
        new_good = folder / "another.png"
        Image.new("RGB", (43,31), "cyan").save(new_good)
        bad = folder / "broken.png"
        bad.write_bytes(b"This is not an image")
        choose(page,picker,[bad,new_good])
        page.wait_for_function("id=>document.getElementById(id).querySelectorAll('button').length===18",arg=grid)
        detail = page.locator("#"+details)
        assert detail.is_visible() and not detail.evaluate("d=>d.open")
        summary = page.locator("#"+status).inner_text()
        assert len(summary) < 120 and "broken.png" not in summary, summary
        detail.locator("summary").click()
        assert "broken.png" in detail.inner_text()
        detail.locator("summary").click()
        page.set_viewport_size({"width":390,"height":380})
        grid_el = page.locator("#"+grid)
        assert grid_el.evaluate("g=>g.scrollHeight>g.clientHeight")
        grid_el.hover()
        page.mouse.wheel(0,1000)
        page.wait_for_function("id=>document.getElementById(id).scrollTop>0",arg=grid)
        assert not errors, errors
        print(browser_type.name,surface,"17/17 stored, 14 SHA/dimension matches incl 7680x4320, "
              "3 exact numerical masters; corrupt neighbor isolated, compact details and real grid scroll passed",flush=True)
    finally:
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=("chromium","webkit","both"), default="both")
    parser.add_argument("--surface", choices=("phone","device","both"), default="both")
    parser.add_argument("--origin", default=LOCAL, help="Local source fixture, or the live phone origin")
    parser.add_argument("--baseline", action="store_true", help="Reproduce the original 3/17 incident")
    parser.add_argument("--originals", nargs="+", type=Path, default=[], help="Check up to eleven actual PNGs strictly inside the local routed fixture")
    args = parser.parse_args()
    if args.originals and (args.origin.rstrip("/") != LOCAL or len(args.originals)>11):
        parser.error("Originals are allowed only within the routed local fixture, up to eleven files")
    with TemporaryDirectory() as directory, sync_playwright() as browsers:
        for engine in ("chromium","webkit") if args.engine=="both" else (args.engine,):
            for surface in SURFACES if args.surface=="both" else (args.surface,):
                if args.origin!=LOCAL and surface!="phone":
                    parser.error("The public site hosts the phone entry point")
                exercise(getattr(browsers,engine),surface,Path(directory),args.origin.rstrip("/"),args.baseline,args.originals)
