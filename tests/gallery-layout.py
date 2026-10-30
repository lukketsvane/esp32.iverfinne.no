"""Gallery regression: run with Python + Playwright (Chromium and WebKit)."""
from pathlib import Path
import json
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
device = (ROOT / "device/preview/index.html").read_text(encoding="utf-8")
device_css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", device, re.S))
phone_css = "\n".join((ROOT / name).read_text(encoding="utf-8") for name in ["style.css", "pwa-ui.css"])
image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='grey'/%3E%3C/svg%3E"
cases = [("device", device_css, "vault", "vault-grid", "vault-item"),
         ("phone", phone_css, "phone-vault", "phone-vault-grid", "")]
with sync_playwright() as p:
    for engine in [p.chromium, p.webkit]:
        browser = engine.launch(headless=True)
        for width, height in [(390, 720), (844, 390)]:
            page = browser.new_page(viewport={"width": width, "height": height})
            for label, css, outer, grid, tile in cases:
                for count in [1, 100]:
                    buttons = "".join(f'<button class="{tile}"><img src="{image}"></button>' for _ in range(count))
                    page.set_content(f'<style>{css}</style><section class="{outer}"><div class="{grid}">{buttons}</div></section>')
                    page.locator("img").first.wait_for()
                    data = page.evaluate("""sel => {
                        const g=document.querySelector(sel), tiles=[...g.children];
                        const r=tiles[0].getBoundingClientRect();
                        g.scrollTop=g.scrollHeight;
                        return {width:r.width,height:r.height,scroll:g.scrollTop,
                            bottom:tiles.at(-1).getBoundingClientRect().bottom,
                            gridBottom:g.getBoundingClientRect().bottom,
                            count:tiles.length};
                    }""", "." + grid)
                    assert data["height"] > 80, data
                    assert abs(data["height"] / data["width"] - .75) < .02, data
                    if count > 1:
                        assert data["scroll"] > 0, data
                        assert data["bottom"] <= data["gridBottom"] + 1, data
                    print(json.dumps({"engine": engine.name, "layout": label, "viewport": [width,height], **data}), flush=True)
            page.close()
        browser.close()
