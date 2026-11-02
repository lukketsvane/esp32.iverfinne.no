"""Seeded gallery scroll checks against the public deployment. Uses disposable browser profiles."""
import argparse
import hashlib
import json
import random
import re
import runpy
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright

BASE = "https://esp32.iverfinne.no"
SEED = 20261102
HELPERS = runpy.run_path(str(Path(__file__).with_name("gallery-grid-browser.py")))
COUNT = HELPERS["COUNT"]


def wait_for_release():
    last = None
    for _ in range(100):
        try:
            def asset(path):
                url = BASE + path + "?scrollcheck=" + str(time.time_ns())
                with urlopen(Request(url, headers={"Cache-Control":"no-cache"}), timeout=12) as response:
                    return response.read()
            css, sw = asset("/pwa-ui.css"), asset("/sw.js")
            match = re.search(rb"entropi-app-v\d+", sw)
            label = match.group().decode() if match else "unknown-worker"
            sha = hashlib.sha256(css).hexdigest()
            rules = re.findall(rb"\.phone-vault-grid\{([^}]+)\}", css)
            ready = any(b"grid-auto-rows:max-content" in r and b"repeat(4,minmax(0,1fr))" in r for r in rules)
            if (sha, label) != last:
                print("LIVE", BASE, label, "css", sha, "ready", ready, flush=True)
                last = (sha, label)
            if ready:
                return sha, label
        except OSError as e:
            print("release probe", repr(e), flush=True)
        time.sleep(6)
    raise TimeoutError("Public site did not receive four-column, intrinsic-row CSS")


def settle(page, grid):
    # Wait for the compositor to finish the gesture and any momentum before measuring it.
    page.wait_for_timeout(85)
    grid.evaluate("""e=>new Promise(resolve=>{
      let until=performance.now()+1500,n=0,last=e.scrollTop;
      function tick(){const pos=e.scrollTop;if(Math.abs(pos-last)<0.4)n++;else n=0;last=pos;
        if(n>=5 || performance.now()>until)return resolve(pos);requestAnimationFrame(tick);}
      requestAnimationFrame(tick);
    })""")


def target(grid, rng, sign, fraction, gap):
    # Pick an actual visible tile or gutter by hit-test. Leave the requested travel room.
    return grid.evaluate("""(g,[sign,f,gap,rx,ry])=>{
      const r=g.getBoundingClientRect(),cells=[...g.querySelectorAll('button')];
      const room=Math.floor((r.height-60)*f);
      const top=r.top+20+(sign<0?0:room),bottom=r.bottom-20-(sign<0?room:0);
      const options=[];
      for(let i=0;i<cells.length;i++){
        if(gap&&i%4===3)continue;
        const b=cells[i].getBoundingClientRect();
        const lo=Math.max(top,b.top+4),hi=Math.min(bottom,b.bottom-4);
        if(hi<=lo)continue;
        const x=gap?b.right+2:b.left+b.width*rx,y=lo+(hi-lo)*ry;
        const hit=document.elementFromPoint(x,y);
        if(!hit||!g.contains(hit))continue;
        if(gap?!!hit.closest('button'):hit.closest('button')!==cells[i])continue;
        options.push([x,y,room]);
      }
      if(!options.length)return null;
      return options[Math.min(options.length-1,Math.floor(ry*options.length))];
    }""", [sign,fraction,gap,rng.uniform(.12,.88),rng.random()])


def drag(page, grid, session, rng, direction, gap=False):
    fraction=rng.uniform(.24,.60)
    start=target(grid,rng,direction,fraction,gap)
    assert start, ("no real hit target", direction, gap, fraction)
    x,y,distance=start
    before=grid.evaluate("e=>e.scrollTop")
    if session:
        count=rng.choice((4,5,8,11))
        dx=rng.uniform(-9,9)
        session.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":x,"y":y}]})
        for n in range(1,count+1):
            t=n/count
            session.send("Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[{"x":x+t*dx,"y":y-direction*t*distance}]})
            page.wait_for_timeout(rng.choice((4,9,15)))
        session.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
    else:
        page.mouse.move(x,y)
        page.mouse.wheel(rng.choice((-2,0,2)),direction*distance)
    settle(page,grid)
    after=grid.evaluate("e=>e.scrollTop")
    assert (after-before)*direction>3, ("gesture failed to scroll in expected direction",before,after,direction,gap)
    assert grid.is_visible(), "swipe opened detail"
    return after


def detail(page, grid, rng, touch):
    rect=grid.evaluate("""(g,f)=>{
      const a=g.getBoundingClientRect(), cells=[...g.querySelectorAll('button')];
      const visible=cells.map((b,i)=>[b,i,b.getBoundingClientRect()]).filter(([b,i,r])=>r.top>=a.top+3 && r.bottom<=a.bottom-3);
      const [b,i,r]=visible[Math.floor(visible.length*f)],x=r.left+r.width/2,y=r.top+r.height/2;
      if(document.elementFromPoint(x,y)?.closest('button')!==b)throw Error('Tile obscured');
      return [x,y,i,g.scrollTop];
    }""",rng.random())
    x,y,index,position=rect
    page.evaluate("""()=>{window.__fuzzEvents=[];
      if(window.__fuzzListening)return;window.__fuzzListening=true;
      for(const event of ['pointerdown','pointerup','touchstart','touchend','click','scroll'])
        document.addEventListener(event,e=>{const t=e.target;window.__fuzzEvents.push([e.type,t.tagName,t.id||'',t.className||'',
          Math.round(performance.now()),document.querySelector('#phone-vault-grid').scrollTop]);if(window.__fuzzEvents.length>25)window.__fuzzEvents.shift()},true);
    }""")
    tap = page.touchscreen.tap if touch else page.mouse.click
    tap(x,y)
    image=page.locator("#phone-vault-image")
    try:
        image.wait_for(state="visible",timeout=1200)
        retry=False
    except Exception:
        events=page.evaluate("window.__fuzzEvents")
        print("TAP_TRACE", json.dumps([index, position, x, y, events]),flush=True)
        # Mobile compositors can consume the first tap to end momentum. A deliberate second tap
        # on that very same visible tile must open it, and a trusted delivered click must not be lost.
        assert touch and not any(e[0]=="click" for e in events), ("delivered click did not open tile", events)
        page.wait_for_timeout(950)
        settle(page,grid)
        current=grid.evaluate("g=>g.scrollTop")
        assert abs(current-position)<2, ("hit target moved after stabilization",position,current)
        tap(x,y)
        image.wait_for(state="visible",timeout=4000)
        retry=True
    assert (str(index+1)+" av "+str(COUNT)) in image.get_attribute("alt")
    page.locator("#phone-vault-back").click()
    grid.wait_for(state="visible")
    restored=grid.evaluate("e=>e.scrollTop")
    assert abs(restored-position)<2, ("back lost scroll",restored,position)
    return retry


def run(engine, profile, release):
    touch=engine.name=="chromium"
    context=engine.launch_persistent_context(profile,viewport={"width":390,"height":844},has_touch=touch,is_mobile=touch)
    # No file or response interception: this is the deployed origin, including its real service worker.
    rows=[]
    try:
        page=context.new_page()
        page.set_default_timeout(12000)
        page.goto(BASE+"/",wait_until="domcontentloaded")
        assert page.url.rstrip("/") == BASE
        css=page.evaluate("""async()=>await (await fetch('/pwa-ui.css',{cache:'no-store'})).text()""")
        assert hashlib.sha256(css.encode()).hexdigest()==release[0], "browser is not using the verified release"
        HELPERS["fill_archive"](page,"phone")
        page.locator("#open-gallery").click()
        grid=page.locator("#phone-vault-grid")
        page.wait_for_function("n=>document.querySelectorAll('#phone-vault-grid button').length===n",arg=COUNT)
        session=context.new_cdp_session(page) if touch else None
        for case,(width,height) in enumerate(((320,650),(390,844),(430,820))):
            page.set_viewport_size({"width":width,"height":height})
            geom=HELPERS["geometry"](grid)
            assert geom["columns"]==4 and geom["square"] and geom["filled"] and geom["nonoverlap"] and geom["max"]>300, geom
            seed=SEED+case*997+(0 if touch else 10000);rng=random.Random(seed)
            counts={"tile":0,"gap":0,"detail":0,"tap_stop":0,"boundary":0}
            print("CASE",engine.name,width,height,seed,geom["max"],flush=True)
            for trial in range(14):
                pos,limit=grid.evaluate("g=>[g.scrollTop,g.scrollHeight-g.clientHeight]")
                direction=1 if pos<80 else -1 if limit-pos<80 else rng.choice((-1,1))
                gap=trial%3==1
                moved=drag(page,grid,session,rng,direction,gap)
                print("GESTURE",engine.name,width,trial,"gap" if gap else "tile",pos,moved,flush=True)
                counts["gap" if gap else "tile"]+=1
                if trial in (3,9):
                    counts["tap_stop"]+=int(detail(page,grid,rng,touch))
                    counts["detail"]+=1
            for direction in (1,-1):
                for _ in range(25):
                    pos,limit=grid.evaluate("g=>[g.scrollTop,g.scrollHeight-g.clientHeight]")
                    if (limit-pos if direction==1 else pos)<=3:break
                    drag(page,grid,session,rng,direction)
                    counts["boundary"]+=1
                else:raise AssertionError(("never reached boundary",direction))
                if direction==1:assert HELPERS["geometry"](grid)["lastVisible"]
            rows.append(dict(engine=engine.name,input="native-touch-CDP" if touch else "wheel",width=width,height=height,seed=seed,**counts))
            print("PASS",json.dumps(rows[-1]),flush=True)
        if session:session.detach()
    finally:context.close()
    return rows


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--engine",choices=("chromium","webkit","both"),default="both")
    args=parser.parse_args()
    release=wait_for_release();rows=[]
    with TemporaryDirectory() as folder,sync_playwright() as p:
        for engine in (p.chromium,p.webkit):
            if args.engine in (engine.name,"both"):
                rows+=run(engine,Path(folder)/engine.name,release)
    print("COMPLETE",json.dumps(rows),flush=True)
