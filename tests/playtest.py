from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = "http://127.0.0.1:8080"
OUT = Path("tests/artifacts")
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, viewport in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("desktop", {"width": 1024, "height": 800})]:
        page = browser.new_page(viewport=viewport, device_scale_factor=1)
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(ROOT, wait_until="networkidle")
        assert page.locator("#menu").get_attribute("open") is not None
        page.locator("#playBtn").click()
        canvas = page.locator("#game")
        box = canvas.bounding_box()
        assert box and box["width"] > 300 and box["height"] > 500
        page.screenshot(path=str(OUT / f"{name}-table.png"), full_page=True)
        state = page.evaluate("window.__TRI_ECHO__.state()")
        assert state["hole"]["r"] >= 30
        control = page.locator("#cueFace")
        assert control.is_visible()
        control_box = control.bounding_box()
        page.mouse.move(control_box["x"] + control_box["width"] / 2, control_box["y"] + control_box["height"] / 2)
        page.mouse.down()
        page.mouse.move(control_box["x"] + control_box["width"] * .78, control_box["y"] + control_box["height"] * .25, steps=4)
        page.mouse.up()
        contact_state = page.evaluate("window.__TRI_ECHO__.state()")
        assert contact_state["contact"]["x"] > .35
        assert contact_state["contact"]["y"] < -.25
        x = box["x"] + box["width"] * state["cue"]["x"]
        y = box["y"] + box["height"] * state["cue"]["y"]
        spaces = [
            (x-box["x"]-20, -1, 0),
            (box["x"]+box["width"]-x-20, 1, 0),
            (y-box["y"]-20, 0, -1),
            (box["y"]+box["height"]-y-20, 0, 1),
        ]
        available, dx, dy = max(spaces, key=lambda item: item[0])
        pull = min(180, available)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x+dx*pull, y+dy*pull, steps=5)
        page.screenshot(path=str(OUT / f"{name}-aim.png"), full_page=True)
        page.mouse.up()
        page.wait_for_timeout(100)
        shot_state = page.evaluate("window.__TRI_ECHO__.state()")
        assert shot_state["active"] is True
        assert shot_state["maxSpeed"] >= 2400
        assert shot_state["cueSpeed"] >= 2000, shot_state
        assert shot_state["contact"]["x"] > .35
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / f"{name}-shot.png"), full_page=True)
        assert errors == [], errors
        if name == "iphone":
            assert page.evaluate("navigator.serviceWorker.ready.then(() => true)")
            page.context.set_offline(True)
            page.reload(wait_until="domcontentloaded")
            assert page.locator("#playBtn").is_visible()
            page.context.set_offline(False)
        page.close()
    browser.close()
