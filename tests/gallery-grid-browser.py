"""Exercise the mobile gallery with real browser input. Run device/build-ui.py first."""
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://entropi.test"
COUNT = 85
SURFACES = {
    "phone": ("open-gallery", "phone-vault-grid", "phone-vault-image", "phone-vault-back"),
    "device": ("open-archive", "archive-grid", "archive-photo", "archive-back"),
}


def serve(route, surface):
    path = urlsplit(route.request.url).path.lstrip("/")
    if not path:
        path = "device/preview/index.html" if surface == "device" else "index.html"
    file = (ROOT / path).resolve()
    if file.is_relative_to(ROOT) and file.is_file():
        if file.suffix == ".mjs":
            route.fulfill(path=file, content_type="text/javascript")
        else:
            route.fulfill(path=file)
    else:
        route.fulfill(status=404)


def fill_archive(page, surface):
    page.evaluate("""async ([surface, count]) => {
      const archive = surface === 'device' ? createArchive() : (await import('/vendor/archive.mjs')).createArchive();
      for (let i = 0; i < count; ++i) {
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = [[192,64],[64,192],[96,96]][i % 3];
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'hsl(' + i * 31 + ', 75%, 45%)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white'; ctx.fillText(String(i), 12, 24);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
        await archive.save(blob, null, blob);
      }
    }""", [surface, COUNT])


def geometry(grid):
    return grid.evaluate("""grid => {
      const cells = [...grid.querySelectorAll('button')];
      const rects = cells.map(cell => cell.getBoundingClientRect());
      const viewport = grid.getBoundingClientRect();
      return {
        columns: rects.filter(rect => Math.abs(rect.top - rects[0].top) < 1).length,
        square: rects.every(rect => Math.abs(rect.width - rect.height) < 1),
        filled: cells.every((cell, i) => {
          const image = cell.querySelector('img'), r = image.getBoundingClientRect(), c = rects[i];
          return getComputedStyle(image).objectFit === 'cover' && Math.abs(r.width-c.width)<1 &&
            Math.abs(r.height-c.height)<1 && Math.abs(r.left-c.left)<1 && Math.abs(r.top-c.top)<1;
        }),
        first: [rects[0].width, rects[0].height], scroll: grid.scrollTop,
        rows: [rects[0].top, rects[4].top, rects[8].top, rects.at(-1).top],
        gridHeight: grid.clientHeight, rowPitch: rects[4].top-rects[0].top,
        nonoverlap: rects.slice(4).every((r,i)=>r.top>=rects[i].bottom-1),
        max: grid.scrollHeight-grid.clientHeight, lastVisible: rects.at(-1).bottom <= viewport.bottom+1,
        x: rects[0].left + rects[0].width/2, y: viewport.top + viewport.height*.78
      };
    }""")


def scroll_gallery(page, grid, use_touch, upward=False):
    info = geometry(grid)
    x, y = info["x"], info["y"] if not upward else info["y"]-300
    session = page.context.new_cdp_session(page) if use_touch else None
    for _ in range(12):
        state = geometry(grid)
        if (upward and state["scroll"] <= 1) or (not upward and state["lastVisible"]):
            break
        if session:
            # Start on the image itself, as opposed to a gutter between cells.
            start = page.evaluate("""([x,y]) => {
              for (let py=y; py>y-150; py-=4) {
                if (document.elementFromPoint(x,py)?.closest('button')?.querySelector('img')) return py;
              }
              return null;
            }""", [x, y])
            assert start is not None, "could not start a swipe on a gallery image"
            session.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": start}]})
            for step in range(1, 13):
                session.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": start+(22 if upward else -22)*step}]})
                page.wait_for_timeout(16)
            session.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        else:
            page.mouse.move(x, y)
            page.mouse.wheel(0, -520 if upward else 520)
        page.wait_for_timeout(220)
        if geometry(grid)["scroll"] == 0:
            break
    if session:
        session.detach()


def exercise(engine, surface, profile):
    touch = engine.name == "chromium"
    context = engine.launch_persistent_context(profile, viewport={"width": 390, "height": 844},
                                                has_touch=touch, is_mobile=touch, service_workers="block")
    try:
        page = context.new_page()
        page.set_default_timeout(12000)
        page.route(ORIGIN + "/**", lambda route: serve(route, surface))
        page.goto(ORIGIN + "/")
        fill_archive(page, surface)
        opener, grid_id, photo, back = SURFACES[surface]
        page.locator("#"+opener).click()
        grid = page.locator("#"+grid_id)
        page.wait_for_function("([id,n])=>document.getElementById(id).children.length===n", arg=[grid_id,COUNT])
        before = geometry(grid)
        print(engine.name, surface, "before", before, flush=True)
        assert before["max"] > 0 and not before["lastVisible"]
        scroll_gallery(page, grid, touch)
        after = geometry(grid)
        print(engine.name, surface, "columns", before["columns"], "tile", before["first"],
              "cover", before["filled"], "scroll", after["scroll"], "of", after["max"],
              "last visible", after["lastVisible"], flush=True)
        assert before["columns"] == 4 and before["square"] and before["filled"] and before["nonoverlap"], before
        assert after["scroll"] > 0 and after["lastVisible"], after
        # Use the visible coordinate, so Playwright cannot implicitly scroll the last tile into view.
        page.wait_for_timeout(850)  # Let compositor momentum end before a separate tap.
        box = grid.locator("button").last.bounding_box()
        xy = (box["x"]+box["width"]/2, box["y"]+box["height"]/2)
        hit = page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.closest('button')===document.querySelector('#"+grid_id+" button:last-child')", list(xy))
        assert hit, (xy, "last thumbnail not reachable by hit testing", geometry(grid))
        if touch:
            grid.evaluate("""g=>g.addEventListener('click',()=>{g.dataset.testTileClick='yes'},{capture:true,once:true})""")
            page.touchscreen.tap(*xy)
            page.wait_for_timeout(450)
            if grid.get_attribute("data-test-tile-click") != "yes":
                # Chromium may consume a tap to stop momentum, even at the scroll boundary.
                # Retry only when the browser delivered no click and the same tile is still under it.
                assert abs(grid.evaluate("g=>g.scrollTop")-after["scroll"])<2
                assert page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.closest('button')===document.querySelector('#"+grid_id+" button:last-child')",list(xy))
                page.touchscreen.tap(*xy)
        else:
            page.mouse.click(*xy)
        image = page.locator("#"+photo)
        image.wait_for(state="visible")
        assert f"{COUNT} av {COUNT}" in image.get_attribute("alt")
        page.wait_for_function("id=>document.getElementById(id).naturalWidth>0", arg=photo)
        assert image.evaluate("im=>im.naturalWidth/im.naturalHeight") == 3
        page.locator("#"+back).click()
        restored = geometry(grid)
        assert restored["lastVisible"] and abs(restored["scroll"]-after["scroll"])<2, restored
        scroll_gallery(page, grid, touch, upward=True)
        assert geometry(grid)["scroll"] <= 1
        print(engine.name, surface, "opened last original and returned to first row", flush=True)
    finally:
        context.close()


if __name__ == "__main__":
    failures = []
    with TemporaryDirectory() as profiles, sync_playwright() as browsers:
        for engine in (browsers.chromium, browsers.webkit):
            for surface in SURFACES:
                try:
                    exercise(engine, surface, Path(profiles) / (engine.name+"-"+surface))
                except Exception as error:
                    failures.append((engine.name, surface, str(error)))
                    print(engine.name, surface, "failed:", str(error), flush=True)
    if failures:
        raise SystemExit(1)
